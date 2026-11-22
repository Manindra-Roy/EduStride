/*
 * EduStride Biometric Attendance & Gate Entry/Exit Scanner (v2.4)
 *
 * Hardware:
 *   - ESP32-CP2102-TypeC-38Pins
 *   - 0.96" I2C 4-pin SSD1306 OLED (SDA=21, SCL=22, VCC=3V3)
 *   - R307S Optical Fingerprint Sensor (5V->VIN, GND->GND, TXD->GPIO16, RXD->GPIO17, optional TOUCH->GPIO4 & 3.3VT->3V3)
 *   - Buzzer (GPIO 25)
 *
 * Design Principles:
 *   1. Exact proven Adafruit R307S capture flow (getImage -> image2Tz -> fingerFastSearch).
 *   2. NEVER sends LEDcontrol(false) on idle or OTA (prevents R307S optical LED latching OFF across reboots!).
 *   3. Pure 6-Wire Touch Wake on GPIO 4 (LED stays 100% dark & cool while idle, flashes only on finger touch!).
 *   4. Zero Wi-Fi / R307S overlap: Core 0 heartbeat (5.5s) never collides with optical capture.
 *   5. Cute Vector/EMO OLED desk-robot eyes with dirty-only rendering & balanced contrast for clean 3.3V power.
 *   6. Built-in Wireless Wi-Fi OTA (ArduinoOTA) & strict Root CA TLS verification.
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Wire.h>
#include <time.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_Fingerprint.h>
#include <ArduinoJson.h>
#include "config.h"

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "2.4.0-ota"
#endif
#ifndef FP_TOUCH_PIN
#define FP_TOUCH_PIN 4
#endif
#ifndef FP_USE_TOUCH_PIN
#define FP_USE_TOUCH_PIN true
#endif
#ifndef BUZZER_ACTIVE_LOW
#define BUZZER_ACTIVE_LOW false
#endif
#ifndef HEARTBEAT_INTERVAL_MS
#define HEARTBEAT_INTERVAL_MS 5500
#endif
#ifndef HTTP_TIMEOUT_MS
#define HTTP_TIMEOUT_MS 12000
#endif
#ifndef ALLOW_INSECURE_TLS
#define ALLOW_INSECURE_TLS false
#endif

// Hardware instances
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
HardwareSerial fpSerial(2); // ESP32 Hardware UART2 (RX=16, TX=17)
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fpSerial);

// Persistent network clients (strictly accessed under netMutex; reset cleanly on Wi-Fi disconnect/errors)
WiFiClient sharedPlainClient;
WiFiClientSecure sharedSecureClient;
bool tlsConfigured = false;
bool wifiEventsRegistered = false;
volatile bool wifiResetNeeded = false;
volatile uint8_t lastWifiDisconnectReason = 0;

// Cached Wi-Fi RSSI bars (updated every 5s so we never spam WiFi.RSSI() at 30 FPS!)
int cachedWifiBars = 0;
unsigned long lastRssiSampleMs = 0;

// Runtime state synced with EduStride backend
volatile bool sensingEnabled = true;
volatile bool prevSensingObserved = true;
volatile bool otaInProgress = false;
volatile bool scanInProgress = false;
volatile bool commandInProgress = false;
volatile bool wifiBusy = false;
volatile int cachedTemplateCount = 0;

bool oledReady = false;
bool sensorReady = false;
bool otaInitialized = false;
volatile bool ntpSynced = false;
volatile bool ntpRequestPending = false;
unsigned long lastNtpRequestMs = 0;
bool ntpEverRequested = false;
int touchIdleLevel = HIGH;

// Fixed char buffer protected by stateMutex (zero cross-core String heap races!)
char lastServerTime[16] = "--:--";
bool messageHolding = false;
unsigned long messageHoldUntilMs = 0;
unsigned long lastWifiCheckMs = 0;
unsigned long lastSensorRetryMs = 0;
unsigned long lastFpPollMs = 0;

// Dual-core FreeRTOS sync (Core 0 = HTTPS Heartbeat + Offline Flush, Core 1 = R307S + OLED + OTA)
SemaphoreHandle_t netMutex = nullptr;
SemaphoreHandle_t stateMutex = nullptr;
bool hasQueuedCommand = false;
String queuedCmdId = "";
String queuedCmdAction = "NONE";
int queuedCmdSlot = 0;
String queuedCmdStudent = "";

// Monotonic scan sequence + random boot nonce for backend scan_id idempotency
uint32_t bootNonce = 0;
uint32_t nextScanSeq = 0;

// Offline scan ring buffer (preserves scans during brief Wi-Fi drops, 5xx errors, or cloud cold-starts)
struct OfflineScanItem {
  uint32_t seq;
  int slotId;
  int confidence;
  time_t scannedAt; // UTC epoch seconds (0 if NTP not yet synced)
  char scanId[40];
};
const int OFFLINE_QUEUE_CAPACITY = 32;
OfflineScanItem offlineQueue[OFFLINE_QUEUE_CAPACITY];
int offlineQueueHead = 0;
int offlineQueueCount = 0;

// ============================================================================
// VECTOR / EMO DESK-ROBOT EYE ENGINE v2.4 (30 FPS, Squash-Stretch, Dirty-Only)
// ============================================================================
enum FaceMood {
  FACE_IDLE,
  FACE_SLEEPY,
  FACE_HAPPY,
  FACE_EXCITED,
  FACE_WINK,
  FACE_FOCUSED,
  FACE_SCANNING,
  FACE_CURIOUS,
  FACE_SURPRISED,
  FACE_CHEEKY,
  FACE_ERROR
};

enum EnrollIconType {
  ENROLL_ICON_SCAN,
  ENROLL_ICON_LIFT,
  ENROLL_ICON_OK,
  ENROLL_ICON_WARN
};

// Wrap-safe millis() deadline helpers (immune to 49.7-day uint32 rollover)
inline bool deadlineReached(unsigned long now, unsigned long deadline) {
  return (long)(now - deadline) >= 0;
}

inline void setMessageHold(unsigned long durationMs) {
  messageHoldUntilMs = millis() + durationMs;
  messageHolding = true;
}

inline void clearMessageHold() {
  messageHolding = false;
  messageHoldUntilMs = 0;
}

float eyeCurX = 0.0f, eyeTargetX = 0.0f;
float eyeCurY = 0.0f, eyeTargetY = 0.0f;
float eyeLeftH = 30.0f, eyeTargetLeftH = 30.0f;
float eyeRightH = 30.0f, eyeTargetRightH = 30.0f;
float eyeLeftW = 30.0f, eyeTargetLeftW = 30.0f;
float eyeRightW = 30.0f, eyeTargetRightW = 30.0f;

int lastDrawnX = 999, lastDrawnY = 999;
int lastDrawnLH = -1, lastDrawnRH = -1, lastDrawnLW = -1, lastDrawnRW = -1;
bool lastDrawnHappy = false;
bool lastDrawnCurious = false;
int lastDrawnRssiBars = -1;
int lastDrawnOfflineCnt = -1;
char lastDrawnTimeStr[16] = "";

unsigned long lastFrameMs = 0;
unsigned long nextBlinkMs = 0;
unsigned long nextBehaviorMs = 0;
bool idleHappyActive = false;
unsigned long idleHappyUntilMs = 0;
bool idleCuriousActive = false;
unsigned long idleCuriousUntilMs = 0;
uint8_t blinkPhase = 0; // 0=open, 1=closing, 2=overshoot-open, 3=settle
uint8_t pendingDoubleBlink = 0;
uint8_t sleepZFrame = 0;
unsigned long lastSleepZMs = 0;

FaceMood activeEventMood = FACE_IDLE;
String activeEventCaption = "";
volatile bool enrollCancelRequested = false;

// ============================================================================
// BUZZER HELPERS (Supports active-HIGH, active-LOW 3-pin modules, and passive)
// ============================================================================
void buzzerOn(int freqHz = 2200) {
#if BUZZER_IS_ACTIVE
  digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_LOW ? LOW : HIGH);
#else
  tone(BUZZER_PIN, freqHz);
#endif
}

void buzzerOff() {
#if BUZZER_IS_ACTIVE
  digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_LOW ? HIGH : LOW);
#else
  noTone(BUZZER_PIN);
#endif
}

void beepPattern(int count, int onMs, int offMs, int freqHz = 2200) {
  for (int i = 0; i < count; i++) {
    buzzerOn(freqHz);
    delay(onMs);
    buzzerOff();
    if (i < count - 1) delay(offMs);
  }
}

void beepEntry()    { beepPattern(1, 130, 0, 2400); }
void beepExit()     { beepPattern(2, 100, 90, 2000); }
void beepError()    { beepPattern(1, 400, 0, 900); }
void beepNotice()   { beepPattern(2, 60, 60, 1600); }
void beepEnrollOk() { beepPattern(3, 90, 80, 2600); }

// ============================================================================
// OLED DISPLAY, TOP STATUS BAR, SPARKLES & VECTOR / EMO ROBOT EYES
// ============================================================================
int getWifiSignalBars() {
  if (WiFi.status() != WL_CONNECTED) {
    cachedWifiBars = 0;
    return 0;
  }
  unsigned long now = millis();
  if (cachedWifiBars == 0 || now - lastRssiSampleMs >= 5000) {
    lastRssiSampleMs = now;
    int rssi = WiFi.RSSI();
    if (rssi >= -60) cachedWifiBars = 3;
    else if (rssi >= -75) cachedWifiBars = 2;
    else cachedWifiBars = 1;
  }
  return cachedWifiBars;
}

void getStatusStripSnapshot(int& qCountOut, char* timeOut, size_t timeSize) {
  qCountOut = 0;
  if (timeSize > 0) {
    strncpy(timeOut, "--:--", timeSize - 1);
    timeOut[timeSize - 1] = '\0';
  }
  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
    qCountOut = offlineQueueCount;
    if (timeSize > 0) {
      strncpy(timeOut, lastServerTime, timeSize - 1);
      timeOut[timeSize - 1] = '\0';
    }
    xSemaphoreGive(stateMutex);
  }
}

int getOfflineQueueCountSnapshot() {
  int count = 0;
  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    count = offlineQueueCount;
    xSemaphoreGive(stateMutex);
  }
  return count;
}

void drawTopStatusStrip(unsigned long now) {
  if (!oledReady) return;
  int qCount = 0;
  char timeBuf[16];
  getStatusStripSnapshot(qCount, timeBuf, sizeof(timeBuf));

  // Top-left: Offline queue badge (if scans buffered) or subtle IST clock
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  if (qCount > 0) {
    display.setCursor(1, 0);
    display.print("Q:");
    display.print(qCount);
  } else if (timeBuf[0] != '\0' && strcmp(timeBuf, "--:--") != 0) {
    timeBuf[8] = '\0';
    display.setCursor(1, 0);
    display.print(timeBuf);
  }

  // Top-right: 3-bar Wi-Fi signal strength meter
  int bars = getWifiSignalBars();
  if (bars == 0) {
    // Blinking tiny 'x' when Wi-Fi disconnected
    if ((now / 500) % 2 == 0) {
      display.drawLine(120, 1, 125, 6, SSD1306_WHITE);
      display.drawLine(125, 1, 120, 6, SSD1306_WHITE);
    }
  } else {
    display.fillRect(117, 5, 2, 2, SSD1306_WHITE);
    if (bars >= 2) display.fillRect(121, 3, 2, 4, SSD1306_WHITE);
    else           display.drawRect(121, 3, 2, 4, SSD1306_WHITE);
    if (bars >= 3) display.fillRect(125, 1, 2, 6, SSD1306_WHITE);
    else           display.drawRect(125, 1, 2, 6, SSD1306_WHITE);
  }
}

void drawSparkle(int cx, int cy, int r) {
  display.drawLine(cx - r, cy, cx + r, cy, SSD1306_WHITE);
  display.drawLine(cx, cy - r, cx, cy + r, SSD1306_WHITE);
  if (r >= 3) {
    display.drawPixel(cx - 1, cy - 1, SSD1306_WHITE);
    display.drawPixel(cx + 1, cy - 1, SSD1306_WHITE);
    display.drawPixel(cx - 1, cy + 1, SSD1306_WHITE);
    display.drawPixel(cx + 1, cy + 1, SSD1306_WHITE);
  }
}

void drawCenteredFooter(const String& footerText) {
  if (footerText.length() == 0) return;
  String clean = footerText.substring(0, 21);
  int16_t textWidth = clean.length() * 6;
  int16_t x = max(0, (SCREEN_WIDTH - textWidth) / 2);
  display.fillRect(0, 53, SCREEN_WIDTH, 11, SSD1306_BLACK);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(x, 55);
  display.print(clean);
}

void renderRoboEyes(FaceMood mood, const String& caption, unsigned long now) {
  if (!oledReady) return;
  display.clearDisplay();
  drawTopStatusStrip(now);

  bool hasCaption = caption.length() > 0;
  int baseCenterY = hasCaption ? 29 : 35;

  int lW = max(18, (int)roundf(eyeLeftW));
  int rW = max(18, (int)roundf(eyeRightW));
  int lH = max(3, (int)roundf(eyeLeftH));
  int rH = max(3, (int)roundf(eyeRightH));

  int gx = (int)roundf(eyeCurX);
  int gy = (int)roundf(eyeCurY);
  if (mood == FACE_IDLE && blinkPhase == 0) {
    // 3D perspective parallax: near eye grows slightly, far eye shrinks
    if (gx < -3)      { lH += 3; lW += 1; rH = max(3, rH - 3); rW = max(18, rW - 2); }
    else if (gx > 3)  { rH += 3; rW += 1; lH = max(3, lH - 3); lW = max(18, lW - 2); }
  }

  int gap = 14;
  int lCx = 64 - (gap / 2) - (lW / 2) + gx;
  int rCx = 64 + (gap / 2) + (rW / 2) + gx;
  int lCy = baseCenterY + gy;
  int rCy = baseCenterY + gy;

  if (mood == FACE_ERROR) {
    int shake = ((now / 65) % 2 == 0) ? -3 : 3;
    lCx += shake;
    rCx += shake;
  } else if (mood == FACE_HAPPY || mood == FACE_EXCITED) {
    int bounce = ((now / 140) % 2 == 0) ? -2 : 1;
    lCy += bounce;
    rCy += bounce;
  } else if (mood == FACE_WINK) {
    int bob = ((now / 180) % 2 == 0) ? -1 : 1;
    lCy += bob;
    rCy += bob;
  }

  int lX = lCx - (lW / 2);
  int lY = lCy - (lH / 2);
  int rX = rCx - (rW / 2);
  int rY = rCy - (rH / 2);

  int lRad = min(10, min(lW / 2, lH / 2));
  int rRad = min(10, min(rW / 2, rH / 2));

  switch (mood) {
    case FACE_IDLE:
      display.fillRoundRect(lX, lY, lW, lH, lRad, SSD1306_WHITE);
      display.fillRoundRect(rX, rY, rW, rH, rRad, SSD1306_WHITE);
      if (idleHappyActive && !deadlineReached(now, idleHappyUntilMs) && blinkPhase == 0 && lH > 18) {
        // Gentle smiling lower eyelid arc
        display.fillRoundRect(lX - 2, lCy + 3, lW + 4, lH, 10, SSD1306_BLACK);
        display.fillRoundRect(rX - 2, rCy + 3, rW + 4, rH, 10, SSD1306_BLACK);
      } else if (idleCuriousActive && !deadlineReached(now, idleCuriousUntilMs) && blinkPhase == 0 && lH > 18) {
        // Playful quizzical raised eyebrow on left eye
        display.fillTriangle(rX - 1, rY - 1, rX + rW + 1, rY - 1, rX + rW + 1, rY + 8, SSD1306_BLACK);
      }
      break;

    case FACE_SLEEPY: {
      int sY = hasCaption ? 30 : 36;
      // Gentle breathing pulse on sleepy closed lids
      int breath = ((now / 900) % 2 == 0) ? 0 : 1;
      display.fillRoundRect(22, sY - 5 + breath, 34, 12, 6, SSD1306_WHITE);
      display.fillRoundRect(24, sY - 10 + breath, 30, 10, 5, SSD1306_BLACK);
      display.fillRoundRect(72, sY - 5 + breath, 34, 12, 6, SSD1306_WHITE);
      display.fillRoundRect(74, sY - 10 + breath, 30, 10, 5, SSD1306_BLACK);
      display.setTextColor(SSD1306_WHITE);
      display.setTextSize(1);
      int zOff = (sleepZFrame % 4) * 2;
      display.setCursor(96, 20 - zOff); display.print("z");
      display.setCursor(107, 12 - zOff); display.print("Z");
      break;
    }

    case FACE_HAPPY:
    case FACE_EXCITED: {
      int hW = 34, hH = 28;
      int hlX = 64 - 7 - hW, hrX = 64 + 7;
      int hY = lCy - (hH / 2);
      display.fillRoundRect(hlX, hY, hW, hH, 11, SSD1306_WHITE);
      display.fillRoundRect(hrX, hY, hW, hH, 11, SSD1306_WHITE);
      display.fillCircle(hlX + hW / 2, hY + hH + 6, 20, SSD1306_BLACK);
      display.fillCircle(hrX + hW / 2, hY + hH + 6, 20, SSD1306_BLACK);
      if (mood == FACE_EXCITED) {
        // Twinkling celebration sparkles around happy eyes
        bool phase = ((now / 150) % 2 == 0);
        drawSparkle(10, phase ? 18 : 22, phase ? 3 : 2);
        drawSparkle(117, phase ? 24 : 18, phase ? 2 : 3);
        drawSparkle(64, phase ? 13 : 15, phase ? 3 : 2);
      }
      break;
    }

    case FACE_WINK: {
      int hW = 34, hH = 28;
      int hlX = 64 - 7 - hW, hrX = 64 + 7;
      int hY = lCy - (hH / 2);
      display.fillRoundRect(hlX, hY, hW, hH, 11, SSD1306_WHITE);
      display.fillCircle(hlX + hW / 2, hY + hH + 6, 20, SSD1306_BLACK);
      display.fillRoundRect(hrX, hY - 2, hW, hH + 4, 9, SSD1306_WHITE);
      // Small farewell sparkle near winking eye
      if ((now / 220) % 2 == 0) drawSparkle(12, 20, 2);
      break;
    }

    case FACE_FOCUSED:
      display.fillRoundRect(lX, lY + 3, lW, max(18, lH - 4), lRad, SSD1306_WHITE);
      display.fillRoundRect(rX, rY + 3, rW, max(18, rH - 4), rRad, SSD1306_WHITE);
      break;

    case FACE_SCANNING: {
      // Focused attentive eyes + smooth sweeping laser scan bar below
      int fH = 22;
      int fY = baseCenterY - (fH / 2) - 2;
      display.fillRoundRect(lX, fY, lW, fH, 7, SSD1306_WHITE);
      display.fillRoundRect(rX, fY, rW, fH, 7, SSD1306_WHITE);
      // Sweeping biometric scan line across the eye visor
      int sweepPos = (int)((now / 28) % 36);
      int scanY = (sweepPos < 18) ? (fY + 2 + sweepPos) : (fY + 2 + (36 - sweepPos));
      display.drawFastHLine(lX + 2, scanY, lW - 4, SSD1306_BLACK);
      display.drawFastHLine(rX + 2, scanY, rW - 4, SSD1306_BLACK);
      // Animated activity dots above caption
      int activeDot = (int)((now / 140) % 3);
      for (int d = 0; d < 3; d++) {
        int dx = 54 + d * 10;
        if (d == activeDot) display.fillCircle(dx, 48, 2, SSD1306_WHITE);
        else                display.drawCircle(dx, 48, 1, SSD1306_WHITE);
      }
      break;
    }

    case FACE_CURIOUS:
      display.fillRoundRect(lX, lY - 3, lW, lH + 5, 9, SSD1306_WHITE);
      display.fillRoundRect(rX, lY + 4, rW, max(14, rH - 7), 7, SSD1306_WHITE);
      break;

    case FACE_SURPRISED:
      display.fillRoundRect(lX - 2, lY - 4, lW + 4, lH + 7, 11, SSD1306_WHITE);
      display.fillRoundRect(rX - 2, rY - 4, rW + 4, rH + 7, 11, SSD1306_WHITE);
      break;

    case FACE_CHEEKY:
      display.fillRoundRect(lX + 5, lY, lW, 24, 8, SSD1306_WHITE);
      display.fillRoundRect(rX + 5, rY, rW, 24, 8, SSD1306_WHITE);
      display.fillRect(lX + 3, lY - 2, lW + 4, 11, SSD1306_BLACK);
      display.fillRect(rX + 3, rY - 2, rW + 4, 11, SSD1306_BLACK);
      break;

    case FACE_ERROR: {
      int eW = 34, eH = 26;
      int elX = lCx - eW / 2, erX = rCx - eW / 2;
      int eY = lCy - eH / 2;
      display.fillRoundRect(elX, eY, eW, eH, 8, SSD1306_WHITE);
      display.fillRoundRect(erX, eY, eW, eH, 8, SSD1306_WHITE);
      display.fillTriangle(elX, eY - 1, elX + eW + 2, eY - 1, elX + eW + 2, eY + 12, SSD1306_BLACK);
      display.fillTriangle(erX - 2, eY - 1, erX + eW, eY - 1, erX - 2, eY + 12, SSD1306_BLACK);
      break;
    }
  }

  drawCenteredFooter(caption);
  display.display();
}

void drawCuteFace(FaceMood mood, const String& caption) {
  activeEventMood = mood;
  activeEventCaption = caption;
  eyeCurX = 0; eyeTargetX = 0;
  eyeCurY = 0; eyeTargetY = 0;
  eyeLeftW = 30; eyeRightW = 30;
  eyeLeftH = 30; eyeRightH = 30;
  lastDrawnX = 999;
  renderRoboEyes(mood, caption, millis());
}

void playBootAnimation() {
  if (!oledReady || !sensorReady) return;
  // Wake-up sequence: closed slits -> flutter open -> glance L/R -> cheerful sparkle!
  const int steps[] = {3, 8, 18, 33, 29, 30};
  for (int i = 0; i < 6; i++) {
    eyeCurX = 0; eyeCurY = 0;
    eyeLeftH = eyeRightH = steps[i];
    eyeLeftW = eyeRightW = (i == 0) ? 35.0f : 30.0f;
    renderRoboEyes(FACE_IDLE, "EduStride Ready!", millis());
    delay(55);
  }
  eyeCurX = -9; renderRoboEyes(FACE_IDLE, "EduStride Ready!", millis()); delay(140);
  eyeCurX = 9;  renderRoboEyes(FACE_IDLE, "EduStride Ready!", millis()); delay(140);
  eyeCurX = 0;  renderRoboEyes(FACE_EXCITED, "EduStride Ready!", millis()); delay(260);
  lastDrawnX = 999;
}

// Graphical enrollment screen with animated fingerprint/arrow icon & live countdown bar
void drawEnrollScreen(const String& header, const String& studentName, const String& prompt1, const String& prompt2, int progressPct, EnrollIconType iconType) {
  if (!oledReady) return;
  lastDrawnX = 999;
  unsigned long now = millis();
  display.clearDisplay();

  // Inverted top header bar
  display.fillRect(0, 0, SCREEN_WIDTH, 13, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(3, 3);
  display.print(header.substring(0, 20));

  // Left animated icon box (x: 2..30, y: 17..49)
  const int icX = 16, icY = 33;
  if (iconType == ENROLL_ICON_SCAN) {
    // Stylized fingerprint concentric rounded loops
    display.drawRoundRect(icX - 11, icY - 13, 22, 26, 10, SSD1306_WHITE);
    display.drawRoundRect(icX - 8,  icY - 9,  16, 18, 7,  SSD1306_WHITE);
    display.drawRoundRect(icX - 5,  icY - 5,  10, 10, 4,  SSD1306_WHITE);
    display.fillCircle(icX, icY, 2, SSD1306_WHITE);
    // Animated horizontal scanner sweep bar
    int phase = (int)((now / 45) % 44);
    int scanY = (phase < 22) ? (icY - 11 + phase) : (icY - 11 + (44 - phase));
    display.drawFastHLine(icX - 13, scanY, 26, SSD1306_WHITE);
  } else if (iconType == ENROLL_ICON_LIFT) {
    // Animated bouncing upward arrow
    int dy = ((now / 180) % 3) * -2;
    display.fillTriangle(icX, icY - 10 + dy, icX - 8, icY + 1 + dy, icX + 8, icY + 1 + dy, SSD1306_WHITE);
    display.fillRect(icX - 3, icY + 1 + dy, 6, 10, SSD1306_WHITE);
    display.drawFastHLine(icX - 10, icY + 13, 20, SSD1306_WHITE);
  } else if (iconType == ENROLL_ICON_OK) {
    display.drawCircle(icX, icY, 12, SSD1306_WHITE);
    display.drawLine(icX - 6, icY, icX - 2, icY + 5, SSD1306_WHITE);
    display.drawLine(icX - 2, icY + 5, icX + 7, icY - 5, SSD1306_WHITE);
    display.drawLine(icX - 6, icY + 1, icX - 2, icY + 6, SSD1306_WHITE);
    display.drawLine(icX - 2, icY + 6, icX + 7, icY - 4, SSD1306_WHITE);
  } else {
    display.drawTriangle(icX, icY - 12, icX - 12, icY + 10, icX + 12, icY + 10, SSD1306_WHITE);
    display.fillRect(icX - 1, icY - 5, 2, 8, SSD1306_WHITE);
    display.fillRect(icX - 1, icY + 5, 2, 2, SSD1306_WHITE);
  }

  // Right text panel (x: 34..127)
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(34, 17);
  display.print(studentName.substring(0, 15));
  display.drawFastHLine(34, 27, 92, SSD1306_WHITE);
  display.setCursor(34, 31);
  display.print(prompt1.substring(0, 15));
  display.setCursor(34, 42);
  display.print(prompt2.substring(0, 15));

  // Bottom live progress / countdown bar (y: 55..62)
  int clamped = max(0, min(100, progressPct));
  display.drawRoundRect(2, 55, 124, 8, 3, SSD1306_WHITE);
  int fillW = (120 * clamped) / 100;
  if (fillW > 0) {
    display.fillRoundRect(4, 57, fillW, 4, 2, SSD1306_WHITE);
  }

  display.display();
}

void showOledStatus(const String& header, const String& line1, const String& line2 = "", const String& line3 = "") {
  if (!oledReady) return;
  lastDrawnX = 999;
  display.clearDisplay();
  display.fillRect(0, 0, SCREEN_WIDTH, 14, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(4, 3);
  display.print(header.substring(0, 20));

  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 20);
  display.println(line1.substring(0, 21));
  if (line2.length() > 0) { display.setCursor(0, 34); display.println(line2.substring(0, 21)); }
  if (line3.length() > 0) { display.setCursor(0, 48); display.println(line3.substring(0, 21)); }
  display.display();
}

void showIdleScreen() {
  activeEventCaption = "";
  lastDrawnX = 999;
  if (!oledReady) return;
  if (!sensorReady) {
    showOledStatus("R307S NOT FOUND", "Check sensor wires", "5V->VIN  GND->GND", "TXD->16  RXD->17");
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    renderRoboEyes(FACE_FOCUSED, "Offline Mode (Wi-Fi)", millis());
    return;
  }
  if (!sensingEnabled) {
    renderRoboEyes(FACE_SLEEPY, "PAUSED IN APP", millis());
  } else {
    renderRoboEyes(FACE_IDLE, "", millis());
  }
}

void animateIdleFace(unsigned long now) {
  if (!oledReady || otaInProgress || !sensorReady) return;

  if (messageHolding) {
    if (now - lastFrameMs >= 70) {
      lastFrameMs = now;
      renderRoboEyes(activeEventMood, activeEventCaption, now);
    }
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastFrameMs >= 500) {
      lastFrameMs = now;
      renderRoboEyes(FACE_FOCUSED, "Offline Mode (Wi-Fi)", now);
    }
    return;
  }

  if (!sensingEnabled) {
    if (now - lastSleepZMs >= 550) {
      lastSleepZMs = now;
      sleepZFrame = (sleepZFrame + 1) % 8;
      renderRoboEyes(FACE_SLEEPY, "PAUSED IN APP", now);
    }
    return;
  }

  // Smooth ~30 FPS animation tick
  if (now - lastFrameMs < 33) return;
  lastFrameMs = now;

  // Expire mood overlays using rollover-safe signed subtraction
  if (idleHappyActive && deadlineReached(now, idleHappyUntilMs)) idleHappyActive = false;
  if (idleCuriousActive && deadlineReached(now, idleCuriousUntilMs)) idleCuriousActive = false;

  // Organic squash-and-stretch blinks with spring overshoot
  if (blinkPhase == 0 && deadlineReached(now, nextBlinkMs)) {
    blinkPhase = 1;
    eyeTargetLeftH = 3.0f; eyeTargetRightH = 3.0f;
    eyeTargetLeftW = 36.0f; eyeTargetRightW = 36.0f;
    if ((now % 4) == 0) pendingDoubleBlink = 1;
  }
  if (blinkPhase == 1 && eyeLeftH <= 5.5f && eyeRightH <= 5.5f) {
    blinkPhase = 2; // Spring overshoot slightly taller & narrower on snap-open
    eyeTargetLeftH = 34.0f; eyeTargetRightH = 34.0f;
    eyeTargetLeftW = 28.0f; eyeTargetRightW = 28.0f;
  } else if (blinkPhase == 2 && eyeLeftH >= 31.5f && eyeRightH >= 31.5f) {
    blinkPhase = 3; // Settle back to crisp resting 30x30
    eyeTargetLeftH = 30.0f; eyeTargetRightH = 30.0f;
    eyeTargetLeftW = 30.0f; eyeTargetRightW = 30.0f;
  } else if (blinkPhase == 3 && fabsf(eyeLeftH - 30.0f) < 0.8f) {
    blinkPhase = 0;
    eyeLeftH = 30.0f; eyeRightH = 30.0f;
    eyeLeftW = 30.0f; eyeRightW = 30.0f;
    if (pendingDoubleBlink > 0) {
      pendingDoubleBlink = 0;
      nextBlinkMs = now + 170;
    } else {
      nextBlinkMs = now + 2800 + (now % 3400);
    }
  }

  // Expressive idle personality behaviors
  if (blinkPhase == 0 && deadlineReached(now, nextBehaviorMs)) {
    nextBehaviorMs = now + 2600 + (now % 3200);
    eyeTargetLeftW = 30.0f; eyeTargetRightW = 30.0f;
    eyeTargetLeftH = 30.0f; eyeTargetRightH = 30.0f;
    switch ((now / 37) % 12) {
      case 0: case 1: eyeTargetX = 0.0f;   eyeTargetY = 0.0f;  break;
      case 2:         eyeTargetX = -13.0f; eyeTargetY = -1.0f; break;
      case 3:         eyeTargetX = 13.0f;  eyeTargetY = -1.0f; break;
      case 4:         eyeTargetX = -10.0f; eyeTargetY = -5.0f; break;
      case 5:         eyeTargetX = 10.0f;  eyeTargetY = -5.0f; break;
      case 6:         eyeTargetX = 0.0f;   eyeTargetY = 5.0f;  break;
      case 7:         eyeTargetX = -5.0f;  eyeTargetY = -2.0f; eyeTargetLeftH = 35.0f; eyeTargetRightH = 22.0f; break;
      case 8:         eyeTargetX = 5.0f;   eyeTargetY = -2.0f; eyeTargetLeftH = 22.0f; eyeTargetRightH = 35.0f; break;
      case 9:         eyeTargetX = 0.0f;   eyeTargetY = -2.0f; idleHappyUntilMs = now + 1700; idleHappyActive = true; break;
      case 10:        eyeTargetX = -4.0f;  eyeTargetY = -2.0f; idleCuriousUntilMs = now + 1600; idleCuriousActive = true; break;
      case 11:        eyeTargetX = 0.0f;   eyeTargetY = -4.0f; eyeTargetLeftH = 33.0f; eyeTargetRightH = 33.0f; break;
    }
  }

  const float posEase = 0.32f;
  const float sizeEase = (blinkPhase == 1 || blinkPhase == 2) ? 0.56f : 0.30f;
  eyeCurX   += (eyeTargetX - eyeCurX) * posEase;
  eyeCurY   += (eyeTargetY - eyeCurY) * posEase;
  eyeLeftH  += (eyeTargetLeftH - eyeLeftH) * sizeEase;
  eyeRightH += (eyeTargetRightH - eyeRightH) * sizeEase;
  eyeLeftW  += (eyeTargetLeftW - eyeLeftW) * sizeEase;
  eyeRightW += (eyeTargetRightW - eyeRightW) * sizeEase;

  if (fabsf(eyeTargetX - eyeCurX) < 0.35f) eyeCurX = eyeTargetX;
  if (fabsf(eyeTargetY - eyeCurY) < 0.35f) eyeCurY = eyeTargetY;
  if (fabsf(eyeTargetLeftH - eyeLeftH) < 0.35f) eyeLeftH = eyeTargetLeftH;
  if (fabsf(eyeTargetRightH - eyeRightH) < 0.35f) eyeRightH = eyeTargetRightH;
  if (fabsf(eyeTargetLeftW - eyeLeftW) < 0.35f) eyeLeftW = eyeTargetLeftW;
  if (fabsf(eyeTargetRightW - eyeRightW) < 0.35f) eyeRightW = eyeTargetRightW;

  int curX = (int)roundf(eyeCurX), curY = (int)roundf(eyeCurY);
  int curLH = (int)roundf(eyeLeftH), curRH = (int)roundf(eyeRightH);
  int curLW = (int)roundf(eyeLeftW), curRW = (int)roundf(eyeRightW);
  bool curHappy = (idleHappyActive && blinkPhase == 0 && curLH > 18);
  bool curCurious = (idleCuriousActive && blinkPhase == 0 && curLH > 18);
  int curRssiBars = getWifiSignalBars();

  int curOfflineCnt = 0;
  char timeBuf[16];
  getStatusStripSnapshot(curOfflineCnt, timeBuf, sizeof(timeBuf));

  // Dirty-only optimization: zero I2C traffic when eyes & status bar are resting!
  if (curX == lastDrawnX && curY == lastDrawnY &&
      curLH == lastDrawnLH && curRH == lastDrawnRH &&
      curLW == lastDrawnLW && curRW == lastDrawnRW &&
      curHappy == lastDrawnHappy && curCurious == lastDrawnCurious &&
      curRssiBars == lastDrawnRssiBars && curOfflineCnt == lastDrawnOfflineCnt &&
      strncmp(timeBuf, lastDrawnTimeStr, sizeof(lastDrawnTimeStr)) == 0) {
    return;
  }

  lastDrawnX = curX; lastDrawnY = curY;
  lastDrawnLH = curLH; lastDrawnRH = curRH;
  lastDrawnLW = curLW; lastDrawnRW = curRW;
  lastDrawnHappy = curHappy; lastDrawnCurious = curCurious;
  lastDrawnRssiBars = curRssiBars; lastDrawnOfflineCnt = curOfflineCnt;
  strncpy(lastDrawnTimeStr, timeBuf, sizeof(lastDrawnTimeStr) - 1);
  lastDrawnTimeStr[sizeof(lastDrawnTimeStr) - 1] = '\0';
  renderRoboEyes(FACE_IDLE, "", now);
}

// ============================================================================
// HTTP / HTTPS CLIENT (Thread-safe via netMutex + Strict Root CA Verification)
// ============================================================================
// MUST be called while holding netMutex!
void syncNtpClockLocked(bool force = false) {
  time_t nowSec = 0;
  time(&nowSec);
  if (nowSec > 1700000000) {
    if (!ntpSynced) {
      ntpSynced = true;
      Serial.printf("[NTP] Clock synced! Epoch=%ld\n", (long)nowSec);
    }
    ntpRequestPending = false;
    return;
  }

  if (WiFi.status() != WL_CONNECTED) return;

  unsigned long now = millis();
  if (!ntpEverRequested || force || (unsigned long)(now - lastNtpRequestMs) >= 60000UL) {
    ntpEverRequested = true;
    lastNtpRequestMs = now;
    ntpRequestPending = false;
    configTime(19800, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
    Serial.println("[NTP] Requested SNTP time sync...");
  }
}

void syncNtpClock(bool force = false) {
  if (netMutex && xSemaphoreTake(netMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    syncNtpClockLocked(force);
    xSemaphoreGive(netMutex);
  }
}

int performHttpRequest(const String& method, const String& path, const String& jsonBody, String& responseOut, unsigned long timeoutOverrideMs = 0) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  unsigned long effectiveTimeoutMs = (timeoutOverrideMs > 0) ? timeoutOverrideMs : (unsigned long)HTTP_TIMEOUT_MS;
  if (netMutex && xSemaphoreTake(netMutex, pdMS_TO_TICKS(effectiveTimeoutMs + 2000)) != pdTRUE) return -3;

  wifiBusy = true;

  if (wifiResetNeeded) {
    wifiResetNeeded = false;
    sharedSecureClient.stop();
    tlsConfigured = false;
    sharedPlainClient.stop();
  }

  // Opportunistically check/throttle NTP sync from this single synchronized path
  if (!ntpSynced || ntpRequestPending) {
    syncNtpClockLocked(ntpRequestPending);
  }

  String baseUrl = String(SERVER_BASE_URL);
  while (baseUrl.endsWith("/")) baseUrl.remove(baseUrl.length() - 1);
  String fullUrl = baseUrl + path;

  bool isHttps = (fullUrl.startsWith("https://") || fullUrl.startsWith("HTTPS://"));
  int httpCode = -2;

  // Up to 2 attempts: recovers transparently if a Render/Cloudflare Keep-Alive socket closed while idle
  for (int netAttempt = 0; netAttempt < 2; netAttempt++) {
    HTTPClient http;
    http.setTimeout(effectiveTimeoutMs);
    http.setReuse(true);

    bool began = false;
    if (isHttps) {
      if (!tlsConfigured) {
#if ALLOW_INSECURE_TLS
        sharedSecureClient.setInsecure();
#elif defined(SERVER_ROOT_CA)
        sharedSecureClient.setCACert(SERVER_ROOT_CA);
#else
        sharedSecureClient.useBuiltinCACertBundle();
#endif
        tlsConfigured = true;
      }
      began = http.begin(sharedSecureClient, fullUrl);
    } else {
      began = http.begin(sharedPlainClient, fullUrl);
    }

    if (began) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Connection", "keep-alive");
      http.addHeader("x-device-id", DEVICE_ID);
      http.addHeader("x-device-key", DEVICE_API_KEY);
      httpCode = (method == "POST") ? http.POST(jsonBody) : http.GET();
      if (httpCode > 0) {
        responseOut = http.getString();
        http.end();
        break;
      } else {
        Serial.printf("[HTTP] %s %s failed (code=%d, attempt=%d)\n", method.c_str(), path.c_str(), httpCode, netAttempt + 1);
        http.end();
        if (isHttps) {
          sharedSecureClient.stop();
          tlsConfigured = false;
        } else {
          sharedPlainClient.stop();
        }
        if (netAttempt == 0) delay(120);
      }
    } else {
      httpCode = -2;
      break;
    }
  }

  wifiBusy = false;
  if (netMutex) xSemaphoreGive(netMutex);
  return httpCode;
}

int sendCommandAck(const String& action, const String& status, int slotId, const String& message, const String& cmdId = "", const String& step = "", int progress = -1, int duplicateSlotId = -1) {
  JsonDocument doc;
  doc["action"] = action;
  doc["status"] = status;
  if (slotId > 0) doc["slot_id"] = slotId;
  if (cmdId.length() > 0) doc["command_id"] = cmdId;
  if (step.length() > 0) doc["step"] = step;
  if (progress >= 0) doc["progress"] = progress;
  if (duplicateSlotId > 0) doc["duplicate_slot_id"] = duplicateSlotId;
  doc["message"] = message;
  String payload;
  serializeJson(doc, payload);

  bool isTerminal = (status == "COMPLETED" || status == "FAILED");
  int maxAttempts = isTerminal ? 3 : 1;
  int lastCode = -1;

  for (int attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      unsigned long backoffMs = (attempt == 1) ? 400UL : 800UL;
      unsigned long waitStart = millis();
      while (millis() - waitStart < backoffMs) {
        if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
        delay(25);
      }
    }
    String resp;
    lastCode = performHttpRequest("POST", "/api/biometric/device/command-ack", payload, resp);
    if (lastCode == 200 || lastCode == 201 || lastCode == 400 || lastCode == 403 || lastCode == 404) {
      break;
    }
    if (isTerminal) {
      Serial.printf("[ACK] %s/%s attempt %d/%d failed (HTTP %d)\n",
                    action.c_str(), status.c_str(), attempt + 1, maxAttempts, lastCode);
    }
  }
  return lastCode;
}

uint32_t generateScanId(char* outBuf, size_t outSize) {
  uint32_t seq = 0;
  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    seq = ++nextScanSeq;
    xSemaphoreGive(stateMutex);
  } else {
    seq = ++nextScanSeq;
  }
  snprintf(outBuf, outSize, "%.16s-%08lx-%lu", DEVICE_ID, (unsigned long)bootNonce, (unsigned long)seq);
  return seq;
}

bool enqueueOfflineScan(int slotId, int confidence, uint32_t seq, const char* scanId, time_t scannedAt = 0) {
  if (scannedAt == 0) {
    time(&scannedAt);
    if (scannedAt < 1700000000) scannedAt = 0;
  }

  if (!stateMutex || xSemaphoreTake(stateMutex, pdMS_TO_TICKS(150)) != pdTRUE) return false;
  if (offlineQueueCount >= OFFLINE_QUEUE_CAPACITY) {
    // Drop oldest entry to keep ring buffer moving
    offlineQueueHead = (offlineQueueHead + 1) % OFFLINE_QUEUE_CAPACITY;
    offlineQueueCount--;
  }
  int tail = (offlineQueueHead + offlineQueueCount) % OFFLINE_QUEUE_CAPACITY;
  offlineQueue[tail].seq = seq;
  offlineQueue[tail].slotId = slotId;
  offlineQueue[tail].confidence = confidence;
  offlineQueue[tail].scannedAt = scannedAt;
  strncpy(offlineQueue[tail].scanId, scanId, sizeof(offlineQueue[tail].scanId) - 1);
  offlineQueue[tail].scanId[sizeof(offlineQueue[tail].scanId) - 1] = '\0';
  offlineQueueCount++;
  int countSnapshot = offlineQueueCount;
  xSemaphoreGive(stateMutex);
  Serial.printf("[OFFLINE] Queued Slot #%d id=%s (pending=%d)\n", slotId, scanId, countSnapshot);
  return true;
}

void flushOfflineScans() {
  if (WiFi.status() != WL_CONNECTED || otaInProgress || scanInProgress || commandInProgress) return;

  for (int i = 0; i < 4; i++) { // Flush up to 4 per heartbeat cycle to avoid starving heartbeats
    OfflineScanItem item;
    bool hasItem = false;
    if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      if (offlineQueueCount > 0) {
        item = offlineQueue[offlineQueueHead];
        hasItem = true;
      }
      xSemaphoreGive(stateMutex);
    }
    if (!hasItem) return;

    JsonDocument reqDoc;
    reqDoc["slot_id"] = item.slotId;
    reqDoc["confidence"] = item.confidence;
    reqDoc["scan_id"] = item.scanId;
    if (item.scannedAt > 1700000000) {
      reqDoc["scanned_at"] = (long)item.scannedAt;
    }
    String payload, resp;
    serializeJson(reqDoc, payload);
    int code = performHttpRequest("POST", "/api/biometric/device/scan", payload, resp);
    // Only pop on terminal statuses — preserve scans across 5xx, 408, 429, or transport drops!
    if (code == 200 || code == 201 || code == 400 || code == 403 || code == 404) {
      if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(150)) == pdTRUE) {
        // Verify head sequence matches so a concurrent full-queue enqueue never double-pops!
        if (offlineQueueCount > 0 && offlineQueue[offlineQueueHead].seq == item.seq) {
          offlineQueueHead = (offlineQueueHead + 1) % OFFLINE_QUEUE_CAPACITY;
          offlineQueueCount--;
        }
        xSemaphoreGive(stateMutex);
      }
      Serial.printf("[OFFLINE] Flushed Slot #%d id=%s -> HTTP %d\n", item.slotId, item.scanId, code);
    } else {
      Serial.printf("[OFFLINE] Keeping Slot #%d id=%s for retry (HTTP %d)\n", item.slotId, item.scanId, code);
      return;
    }
  }
}

// ============================================================================
// R307S INITIALIZATION & HYBRID TOUCH HELPER
// ============================================================================
void calibrateTouchPin() {
  pinMode(FP_TOUCH_PIN, INPUT_PULLUP);
  delay(60);
  int highs = 0;
  for (int i = 0; i < 15; i++) {
    if (digitalRead(FP_TOUCH_PIN) == HIGH) highs++;
    delay(4);
  }
  touchIdleLevel = (highs >= 8) ? HIGH : LOW;
  Serial.printf("[R307S] Touch pin GPIO %d calibrated (idle=%s)\n",
                FP_TOUCH_PIN, touchIdleLevel == HIGH ? "HIGH" : "LOW");
}

bool touchPinTriggered() {
  return (digitalRead(FP_TOUCH_PIN) != touchIdleLevel);
}

bool initR307Sensor() {
  while (fpSerial.available()) fpSerial.read();
  if (!finger.verifyPassword()) {
    sensorReady = false;
    return false;
  }

  sensorReady = true;
  finger.getParameters();
  if (finger.capacity == 0) finger.capacity = 1000;
  if (finger.security_level > 2) {
    finger.setSecurityLevel(2); // Balanced forgiving matching for dry fingers
    delay(50);
    finger.security_level = 2;
  }
  if (finger.getTemplateCount() == FINGERPRINT_OK) {
    cachedTemplateCount = finger.templateCount;
  }

  // Clear any previously latched LED-OFF state from older firmware — NEVER call LEDcontrol(false)!
  finger.LEDcontrol(true);
  delay(30);

  Serial.printf("[R307S] Sensor READY! Capacity=%d | Security=%d | Templates=%d\n",
                finger.capacity, finger.security_level, cachedTemplateCount);
  return true;
}

uint8_t searchStoredTemplates() {
  if (cachedTemplateCount <= 160) {
    return finger.fingerFastSearch();
  }
  return finger.fingerSearch();
}

// ============================================================================
// UPGRADED R307S ENROLLMENT & SENSOR SYNC ENGINE v2.3
// - Human-readable R307S error decoder
// - 2-frame settled capture + 2-read clean lift detection
// - Duplicate finger detection before saving (prevents enrolling same finger twice)
// - 3-attempt Step 2 + Auto-Rebase recovery (fixes bad Step 1 tip grazes!)
// - Post-store flash verification (loadModel check)
// - Hardware-to-DB SYNC_SLOTS audit & orphan cleanup via ReadIndexTable (0x1F)
// - Live mid-enrollment cancellation check (~2.5s responsiveness when canceled in App)
// ============================================================================
const uint8_t ENROLL_ERR_CANCELLED = 0xFD; // Distinct from FINGERPRINT_BADPACKET (0xFE) & TIMEOUT (0xFF)

String describeFpError(uint8_t code) {
  switch (code) {
    case FINGERPRINT_NOFINGER:       return "Timed out waiting for finger";
    case FINGERPRINT_IMAGEFAIL:      return "Sensor imaging error (wipe glass)";
    case FINGERPRINT_IMAGEMESS:      return "Blurry print (hold finger still & flat)";
    case FINGERPRINT_FEATUREFAIL:    return "Weak ridges (press flat center / moisten dry finger)";
    case FINGERPRINT_ENROLLMISMATCH: return "Second press didn't match first press";
    case FINGERPRINT_BADLOCATION:    return "Invalid sensor slot number";
    case FINGERPRINT_FLASHERR:       return "R307S flash write error";
    case FINGERPRINT_PACKETRECIEVEERR:
    case FINGERPRINT_BADPACKET:      return "Sensor UART framing glitch (check TXD/RXD wires)";
    default:                         return "Sensor error 0x" + String(code, HEX);
  }
}

bool checkRemoteEnrollCancelled(const String& cmdId) {
  if (cmdId.length() == 0 || WiFi.status() != WL_CONNECTED) return false;
  String response;
  String path = "/api/biometric/device/status?firmware=" + String(FIRMWARE_VERSION)
              + "&templates=" + String((int)cachedTemplateCount)
              + "&ip=" + WiFi.localIP().toString();
  int code = performHttpRequest("GET", path, "", response);
  if (code != 200) return false;

  JsonDocument doc;
  if (deserializeJson(doc, response)) return false;

  JsonObject cmd = doc["pending_command"].as<JsonObject>();
  if (cmd.isNull()) return true;
  String serverCmdId = cmd["command_id"] | "";
  String serverAction = cmd["action"] | "NONE";
  String serverStatus = cmd["status"] | "IDLE";

  if (serverAction != "ENROLL" || serverStatus == "IDLE" || (serverCmdId.length() > 0 && serverCmdId != cmdId)) {
    return true;
  }
  return false;
}

uint8_t waitAndCaptureBuffer(uint8_t bufferSlot, unsigned long timeoutMs, const String& header, const String& studentName, const String& prompt1, const String& prompt2, const String& cmdId) {
  unsigned long startMs = millis();
  unsigned long lastUiMs = 0;
  unsigned long lastCancelCheckMs = startMs;
  uint8_t lastErr = FINGERPRINT_NOFINGER;

  while (fpSerial.available()) fpSerial.read();

  while (millis() - startMs < timeoutMs) {
    unsigned long now = millis();
    unsigned long elapsed = now - startMs;
    int remainPct = (elapsed >= timeoutMs) ? 0 : (int)(((timeoutMs - elapsed) * 100UL) / timeoutMs);

    if (now - lastUiMs >= 90) {
      lastUiMs = now;
      drawEnrollScreen(header, studentName, prompt1, prompt2, remainPct, ENROLL_ICON_SCAN);
    }

    uint8_t p = finger.getImage();
    if (p == FINGERPRINT_OK) {
      drawEnrollScreen(header, studentName, "Hold steady...", "Capturing print", remainPct, ENROLL_ICON_SCAN);
      // Wait 220ms so the finger pad flattens fully on the prism (prevents partial fingertip graze)
      delay(220);
      uint8_t pSettled = finger.getImage();
      // Prefer the crisp settled frame; if finger just lifted, still convert the frame already in buffer
      if (pSettled == FINGERPRINT_OK || pSettled == FINGERPRINT_NOFINGER) {
        uint8_t tz = finger.image2Tz(bufferSlot);
        if (tz == FINGERPRINT_OK) {
          return FINGERPRINT_OK;
        }
        lastErr = tz;
        Serial.printf("[ENROLL] image2Tz(%d) -> 0x%02X (%s)\n", bufferSlot, tz, describeFpError(tz).c_str());
        drawEnrollScreen(header, studentName, "Press FLATTER", "Hold steady...", remainPct, ENROLL_ICON_SCAN);
        delay(180);
      } else {
        lastErr = pSettled;
      }
    } else if (p != FINGERPRINT_NOFINGER) {
      lastErr = p;
      Serial.printf("[ENROLL] getImage() -> 0x%02X (%s)\n", p, describeFpError(p).c_str());
    } else if (now - lastCancelCheckMs >= 2600) {
      // Only check remote cancel when no finger is actively on the prism
      lastCancelCheckMs = now;
      if (checkRemoteEnrollCancelled(cmdId)) {
        enrollCancelRequested = true;
        return ENROLL_ERR_CANCELLED;
      }
    }

    if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
    delay(45);
  }
  return lastErr;
}

void waitCleanFingerLift(const String& header, const String& studentName, unsigned long timeoutMs = 10000) {
  unsigned long liftStart = millis();
  int consecutiveNoFinger = 0;
  while (millis() - liftStart < timeoutMs) {
    unsigned long elapsed = millis() - liftStart;
    int liftPct = (elapsed >= timeoutMs) ? 0 : (int)(((timeoutMs - elapsed) * 100UL) / timeoutMs);
    drawEnrollScreen(header, studentName, "LIFT FINGER", "Remove cleanly", liftPct, ENROLL_ICON_LIFT);
    if (elapsed >= 650) {
      if (finger.getImage() == FINGERPRINT_NOFINGER) {
        consecutiveNoFinger++;
        if (consecutiveNoFinger >= 2) break; // Two consecutive clean reads guarantee lift
      } else {
        consecutiveNoFinger = 0;
      }
    }
    if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
    delay(90);
  }
  delay(180);
}

void executeRemoteEnroll(int slotId, const String& studentName, const String& cmdId) {
  commandInProgress = true;
  enrollCancelRequested = false;
  Serial.printf("[ENROLL] Slot #%d -> %s (cmd=%s)\n", slotId, studentName.c_str(), cmdId.c_str());

  while (fpSerial.available()) fpSerial.read();
  delay(30);
  finger.LEDcontrol(true);

  String step1Header = "ENROLL #" + String(slotId) + " (1/2)";
  sendCommandAck("ENROLL", "IN_PROGRESS", slotId, "Press finger FLAT on center of glass & hold 1 sec (Step 1/2)...", cmdId, "SCAN_1", 25);
  drawEnrollScreen(step1Header, studentName, "Press Finger", "FLAT (1/2)", 100, ENROLL_ICON_SCAN);
  beepNotice();

  // Step 1: Settled capture into Buffer 1
  uint8_t err1 = waitAndCaptureBuffer(1, ENROLL_STEP_TIMEOUT_MS, step1Header, studentName, "Press Finger", "FLAT (1/2)", cmdId);
  if (err1 == ENROLL_ERR_CANCELLED) {
    drawCuteFace(FACE_CHEEKY, "Enroll Cancelled");
    beepNotice();
    setMessageHold(2000);
    commandInProgress = false;
    return;
  }
  if (err1 != FINGERPRINT_OK) {
    String reason = describeFpError(err1);
    drawEnrollScreen("STEP 1 FAILED", studentName, reason.substring(0, 15), "Retry from App", 0, ENROLL_ICON_WARN);
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Step 1 failed: " + reason + " (0x" + String(err1, HEX) + ").", cmdId, "FAILED", 0);
    setMessageHold(3000);
    commandInProgress = false;
    return;
  }

  // Duplicate finger check: prevent enrolling the same finger into two different slots!
  if (searchStoredTemplates() == FINGERPRINT_OK && finger.fingerID != slotId) {
    int existingSlot = finger.fingerID;
    Serial.printf("[ENROLL] Duplicate finger! Already enrolled in Slot #%d\n", existingSlot);
    drawEnrollScreen("DUPLICATE PRINT!", studentName, "Already in", "Slot #" + String(existingSlot), 0, ENROLL_ICON_WARN);
    beepError();
    sendCommandAck(
      "ENROLL",
      "FAILED",
      slotId,
      "Duplicate finger! Already enrolled in Slot #" + String(existingSlot) + ".",
      cmdId,
      "DUPLICATE",
      0,
      existingSlot
    );
    setMessageHold(3500);
    commandInProgress = false;
    return;
  }

  // Ask user to lift finger cleanly with animated upward-arrow icon
  beepEntry();
  sendCommandAck("ENROLL", "IN_PROGRESS", slotId, "Step 1 captured! Lift finger cleanly, then press SAME finger flat (Step 2/2)...", cmdId, "LIFT_FINGER", 52);
  waitCleanFingerLift("STEP 1 OK!", studentName, 10000);

  // Step 2: Up to 3 attempts + Safe Auto-Rebase Recovery (always requires clean lift + 2nd press & duplicate check!)
  String step2Header = "ENROLL #" + String(slotId) + " (2/2)";
  sendCommandAck("ENROLL", "IN_PROGRESS", slotId, "Press the SAME finger flat on the center of glass (Step 2/2)...", cmdId, "SCAN_2", 72);

  uint8_t lastErr = FINGERPRINT_NOFINGER;
  bool matched = false;
  const int maxStep2Attempts = 3;

  for (int attempt = 1; attempt <= maxStep2Attempts && !matched; attempt++) {
    String p1 = (attempt == 1) ? "Press SAME" : (attempt == 3 ? "Final Confirm" : "Try 2/3");
    String p2 = (attempt == 1) ? "Finger (2/2)" : "Press FLAT!";

    if (attempt > 1) {
      String retryMsg = (attempt == 3)
        ? "Re-calibrated base print! Lift & press SAME finger flat once more to confirm..."
        : "Ridges didn't align — lift & press SAME finger flat in center (Attempt 2/3)...";
      sendCommandAck("ENROLL", "IN_PROGRESS", slotId, retryMsg, cmdId, "SCAN_2", 70 + (attempt * 6));
      waitCleanFingerLift("RETRY " + String(attempt) + "/" + String(maxStep2Attempts), studentName, 6000);
    }

    lastErr = waitAndCaptureBuffer(2, ENROLL_STEP_TIMEOUT_MS, step2Header, studentName, p1, p2, cmdId);
    if (lastErr == ENROLL_ERR_CANCELLED) {
      drawCuteFace(FACE_CHEEKY, "Enroll Cancelled");
      beepNotice();
      setMessageHold(2000);
      commandInProgress = false;
      return;
    }

    if (lastErr == FINGERPRINT_OK) {
      lastErr = finger.createModel();
      Serial.printf("[ENROLL] Attempt %d createModel -> 0x%02X\n", attempt, lastErr);
      if (lastErr == FINGERPRINT_OK) {
        matched = true;
      } else if (attempt == 2 && lastErr == FINGERPRINT_ENROLLMISMATCH) {
        // Auto-Rebase: Step 1 was likely an off-center graze — promote this crisp finger into Buffer 1,
        // ALWAYS re-run duplicate check, and require a clean lift + second press on Attempt 3!
        drawEnrollScreen("RE-ALIGNING", studentName, "Hold steady...", "Updating base", 78, ENROLL_ICON_SCAN);
        delay(200);
        if (finger.getImage() == FINGERPRINT_OK && finger.image2Tz(1) == FINGERPRINT_OK) {
          Serial.println("[ENROLL] Auto-Rebased Buffer 1 from fresh settled frame!");
          if (searchStoredTemplates() == FINGERPRINT_OK && finger.fingerID != slotId) {
            int existingSlot = finger.fingerID;
            Serial.printf("[ENROLL] Duplicate finger detected after rebase! Already in Slot #%d\n", existingSlot);
            drawEnrollScreen("DUPLICATE PRINT!", studentName, "Already in", "Slot #" + String(existingSlot), 0, ENROLL_ICON_WARN);
            beepError();
            sendCommandAck(
              "ENROLL",
              "FAILED",
              slotId,
              "Duplicate finger! Already enrolled in Slot #" + String(existingSlot) + ".",
              cmdId,
              "DUPLICATE",
              0,
              existingSlot
            );
            setMessageHold(3500);
            commandInProgress = false;
            return;
          }
        }
        beepNotice();
      } else {
        beepNotice();
      }
    }
  }

  if (!matched) {
    String reason = describeFpError(lastErr);
    drawEnrollScreen("NO MATCH", studentName, reason.substring(0, 15), "Retry in App", 0, ENROLL_ICON_WARN);
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Enrollment failed after 3 attempts: " + reason + " (0x" + String(lastErr, HEX) + ").", cmdId, "FAILED", 0);
    setMessageHold(3500);
    commandInProgress = false;
    return;
  }

  drawEnrollScreen("SAVING SLOT #" + String(slotId), studentName, "Writing flash", "Verifying...", 92, ENROLL_ICON_OK);
  uint8_t storeErr = finger.storeModel(slotId);
  if (storeErr != FINGERPRINT_OK) {
    String reason = describeFpError(storeErr);
    drawEnrollScreen("SAVE ERROR", studentName, "Slot #" + String(slotId), reason.substring(0, 15), 0, ENROLL_ICON_WARN);
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Failed saving template to R307S flash: " + reason + " (0x" + String(storeErr, HEX) + ").", cmdId, "FAILED", 0);
    setMessageHold(3000);
    commandInProgress = false;
    return;
  }

  // Post-store flash verification: confirm template loads cleanly back from R307S flash!
  uint8_t verifyErr = finger.loadModel(slotId);
  if (verifyErr != FINGERPRINT_OK) {
    drawEnrollScreen("VERIFY ERROR", studentName, "Slot #" + String(slotId), "Flash mismatch", 0, ENROLL_ICON_WARN);
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Template flash verification failed for Slot #" + String(slotId) + " (0x" + String(verifyErr, HEX) + "). Please retry.", cmdId, "FAILED", 0);
    setMessageHold(3000);
    commandInProgress = false;
    return;
  }

  if (finger.getTemplateCount() == FINGERPRINT_OK) {
    cachedTemplateCount = finger.templateCount;
  }
  drawCuteFace(FACE_EXCITED, "Enrolled #" + String(slotId) + "!");
  beepEnrollOk();
  sendCommandAck("ENROLL", "COMPLETED", slotId, "Verified & enrolled " + studentName + " in Slot #" + String(slotId) + "!", cmdId, "DONE", 100);
  setMessageHold(3200);
  commandInProgress = false;
}

// Read occupied slots (1..1000) via R307S ReadIndexTable (0x1F, pages 0..3), with full loadModel fallback
int readOccupiedHardwareSlots(uint16_t* outSlots, int maxSlots) {
  int count = 0;
  bool indexTableOk = true;
  bool slotZeroOccupied = false;

  while (fpSerial.available()) fpSerial.read();

  for (uint8_t page = 0; page < 4; page++) {
    bool pageOk = false;
    Adafruit_Fingerprint_Packet respPkt(FINGERPRINT_COMMANDPACKET, 0, nullptr);

    for (int retry = 0; retry < 3; retry++) {
      if (retry > 0) {
        while (fpSerial.available()) fpSerial.read();
        delay(40);
      }
      uint8_t cmdData[2] = { 0x1F, page };
      Adafruit_Fingerprint_Packet pkt(FINGERPRINT_COMMANDPACKET, 2, cmdData);
      finger.writeStructuredPacket(pkt);
      if (finger.getStructuredPacket(&pkt) == FINGERPRINT_OK &&
          pkt.type == FINGERPRINT_ACKPACKET &&
          pkt.length >= 35 &&
          pkt.data[0] == FINGERPRINT_OK) {
        respPkt = pkt;
        pageOk = true;
        break;
      }
      Serial.printf("[SYNC] ReadIndexTable page %d retry %d/3 failed (type=0x%02X len=%u status=0x%02X)\n",
                    page, retry + 1, pkt.type, pkt.length, pkt.data[0]);
    }

    if (!pageOk) {
      indexTableOk = false;
      break;
    }

    for (int byteIdx = 0; byteIdx < 32; byteIdx++) {
      uint8_t mask = respPkt.data[1 + byteIdx];
      if (mask == 0) continue;
      for (int bit = 0; bit < 8; bit++) {
        if (mask & (1 << bit)) {
          uint16_t slot = (uint16_t)(page * 256 + byteIdx * 8 + bit);
          if (slot == 0) {
            slotZeroOccupied = true;
          } else if (slot >= 1 && slot <= 1000 && count < maxSlots) {
            outSlots[count++] = slot;
          }
        }
      }
    }
    if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
  }

  if (indexTableOk) {
    if (slotZeroOccupied) {
      Serial.println("[SYNC] Found orphan Slot #0 occupied — erasing to prevent templateCount drift!");
      finger.deleteModel(0);
    }
    return count;
  }

  // Fallback for rare clones without 0x1F: probe FULL 1..min(capacity, 1000) so slots > 300 are NEVER wiped!
  Serial.println("[SYNC] ReadIndexTable unavailable — running full loadModel scan (1..1000)...");
  if (finger.loadModel(0) == FINGERPRINT_OK) {
    Serial.println("[SYNC] Found orphan Slot #0 occupied (fallback) — erasing!");
    finger.deleteModel(0);
  }

  count = 0;
  int limit = min((int)finger.capacity, 1000);
  if (limit <= 0) limit = 1000;
  for (int s = 1; s <= limit && count < maxSlots; s++) {
    if (finger.loadModel(s) == FINGERPRINT_OK) {
      outSlots[count++] = (uint16_t)s;
    }
    if ((s % 20) == 0) {
      if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
      yield();
    }
    if ((s % 50) == 0) {
      int pct = 25 + (s * 28) / limit;
      drawEnrollScreen("SENSOR SYNC", "Full Flash Scan", "Slot " + String(s) + "/" + String(limit), "Found: " + String(count), pct, ENROLL_ICON_SCAN);
    }
  }
  return count;
}

void executeRemoteSyncSlots(const String& cmdId) {
  commandInProgress = true;
  Serial.printf("[SYNC] Starting R307S <-> DB slot audit (cmd=%s)\n", cmdId.c_str());
  drawEnrollScreen("SENSOR SYNC", "Auditing R307S", "Reading 1000", "flash slots...", 25, ENROLL_ICON_SCAN);
  sendCommandAck("SYNC_SLOTS", "IN_PROGRESS", 0, "Reading R307S hardware index table...", cmdId, "READING_SENSOR", 30);

  static uint16_t hwSlots[1000];
  int hwCount = readOccupiedHardwareSlots(hwSlots, 1000);
  Serial.printf("[SYNC] Found %d occupied slots on R307S hardware\n", hwCount);

  drawEnrollScreen("SENSOR SYNC", "Comparing DB", "Found " + String(hwCount), "sensor prints", 55, ENROLL_ICON_SCAN);

  // Pre-allocate JSON payload to avoid heap fragmentation across up to 1,000 slots
  String payload;
  payload.reserve(64 + hwCount * 5);
  payload += "{\"command_id\":\"";
  payload += cmdId;
  payload += "\",\"hardware_slots\":[";
  for (int i = 0; i < hwCount; i++) {
    if (i > 0) payload += ",";
    payload += String(hwSlots[i]);
  }
  payload += "]}";

  String respStr;
  int httpCode = performHttpRequest("POST", "/api/biometric/device/sync-slots", payload, respStr);
  if (httpCode != 200) {
    drawEnrollScreen("SYNC FAILED", "Server Error", "HTTP " + String(httpCode), "Try again", 0, ENROLL_ICON_WARN);
    beepError();
    sendCommandAck("SYNC_SLOTS", "FAILED", 0, "Could not reach server to sync slots (HTTP " + String(httpCode) + ").", cmdId, "FAILED", 0);
    setMessageHold(2800);
    commandInProgress = false;
    return;
  }

  JsonDocument respDoc;
  if (deserializeJson(respDoc, respStr)) {
    beepError();
    sendCommandAck("SYNC_SLOTS", "FAILED", 0, "Invalid JSON response during slot sync.", cmdId, "FAILED", 0);
    commandInProgress = false;
    return;
  }

  int ghostsRemoved = respDoc["ghosts_removed"] | 0;
  int validCount = respDoc["valid_count"] | 0;
  JsonArray orphans = respDoc["orphan_slots"].as<JsonArray>();
  int orphanTotal = orphans.size();
  int orphansErased = 0;

  for (int i = 0; i < orphanTotal; i++) {
    int slotToErase = orphans[i] | 0;
    if (slotToErase >= 1 && slotToErase <= 1000) {
      int pct = 60 + ((i + 1) * 35) / max(1, orphanTotal);
      drawEnrollScreen("CLEANING ORPHAN", "Erasing Slot", "Slot #" + String(slotToErase), String(i + 1) + "/" + String(orphanTotal), pct, ENROLL_ICON_SCAN);
      if (finger.deleteModel(slotToErase) == FINGERPRINT_OK) {
        orphansErased++;
      }
      if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
    }
  }

  if (finger.getTemplateCount() == FINGERPRINT_OK) {
    cachedTemplateCount = finger.templateCount;
  }

  String summary = "Sync complete! " + String(validCount) + " valid prints matched";
  if (orphansErased > 0 || ghostsRemoved > 0) {
    summary += " (" + String(orphansErased) + " orphan R307S slot(s) erased, " + String(ghostsRemoved) + " stale DB record(s) cleaned).";
  } else {
    summary += " — sensor and database are 100% in sync!";
  }

  drawCuteFace(FACE_EXCITED, "Synced: " + String(cachedTemplateCount) + " OK!");
  beepEnrollOk();
  sendCommandAck("SYNC_SLOTS", "COMPLETED", 0, summary, cmdId, "DONE", 100);
  setMessageHold(3000);
  commandInProgress = false;
}

void executeRemoteDelete(int slotId, const String& studentName, const String& cmdId) {
  commandInProgress = true;
  showOledStatus("REMOVING PRINT", studentName, "Clearing Slot #" + String(slotId), "");
  sendCommandAck("DELETE", "IN_PROGRESS", slotId, "Erasing Slot #" + String(slotId) + " from sensor...", cmdId, "DELETING", 40);
  uint8_t p = finger.deleteModel(slotId);
  if (p == FINGERPRINT_OK) {
    if (finger.getTemplateCount() == FINGERPRINT_OK) {
      cachedTemplateCount = finger.templateCount;
    }
    sendCommandAck("DELETE", "COMPLETED", slotId, "Deleted Slot #" + String(slotId) + " from sensor.", cmdId, "DONE", 100);
    showOledStatus("REMOVED", studentName, "Slot #" + String(slotId) + " freed", "");
    beepNotice();
  } else {
    sendCommandAck("DELETE", "FAILED", slotId, "Failed to erase slot (code 0x" + String(p, HEX) + ").", cmdId, "FAILED", 0);
    beepError();
  }
  setMessageHold(2500);
  commandInProgress = false;
}

// ============================================================================
// CORE 0 BACKGROUND HEARTBEAT (Configurable interval + Offline Queue Flush)
// ============================================================================
void pollServerStatus() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (otaInProgress || scanInProgress || commandInProgress) return;

  String path = "/api/biometric/device/status?firmware=" + String(FIRMWARE_VERSION)
              + "&templates=" + String((int)cachedTemplateCount)
              + "&ip=" + WiFi.localIP().toString();

  String response;
  int code = performHttpRequest("GET", path, "", response);
  if (code != 200) return;

  JsonDocument doc;
  if (deserializeJson(doc, response)) return;

  bool newSensing = doc["sensing_enabled"] | true;
  const char* newTime = doc["server_time_ist"] | "";

  JsonObject cmd = doc["pending_command"].as<JsonObject>();
  String cmdId = "", cmdAction = "NONE", cmdStatus = "IDLE", cmdStudent = "Student";
  int cmdSlot = 0;
  if (!cmd.isNull()) {
    cmdId = cmd["command_id"] | "";
    cmdAction = cmd["action"] | "NONE";
    cmdStatus = cmd["status"] | "IDLE";
    cmdSlot = cmd["slot_id"] | 0;
    cmdStudent = cmd["student_name"] | "Student";
  }

  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
    sensingEnabled = newSensing;
    if (newTime && newTime[0] != '\0') {
      strncpy(lastServerTime, newTime, sizeof(lastServerTime) - 1);
      lastServerTime[sizeof(lastServerTime) - 1] = '\0';
    }
    if (cmdStatus == "PENDING" && cmdAction != "NONE" && !hasQueuedCommand) {
      queuedCmdId = cmdId;
      queuedCmdAction = cmdAction;
      queuedCmdSlot = cmdSlot;
      queuedCmdStudent = cmdStudent;
      hasQueuedCommand = true;
    }
    xSemaphoreGive(stateMutex);
  }
}

void heartbeatTask(void* param) {
  (void)param;
  const TickType_t pollDelayTicks = pdMS_TO_TICKS(max(2000, HEARTBEAT_INTERVAL_MS));
  for (;;) {
    if (!otaInProgress && !scanInProgress && !commandInProgress && WiFi.status() == WL_CONNECTED) {
      if (!ntpSynced || ntpRequestPending) syncNtpClock(ntpRequestPending);
      flushOfflineScans();
      pollServerStatus();
    }
    vTaskDelay(pollDelayTicks);
  }
}

// ============================================================================
// FINGERPRINT SCAN & SERVER SUBMISSION (Core 1 — Exact Adafruit Flow!)
// ============================================================================
void waitForFingerLiftAfterScan(unsigned long maxWaitMs = 3000) {
#if FP_USE_TOUCH_PIN
  unsigned long liftWait = millis();
  while (touchPinTriggered() && millis() - liftWait < maxWaitMs) {
    if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
    delay(40);
  }
#else
  unsigned long liftWait = millis();
  while (finger.getImage() != FINGERPRINT_NOFINGER && millis() - liftWait < maxWaitMs) {
    if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
    delay(60);
  }
#endif
}

void scanAndSubmitFingerprint() {
  if (!sensorReady || !sensingEnabled) return;
  // Wait briefly if a background heartbeat Wi-Fi burst is finishing
  unsigned long waitWifiStart = millis();
  while (wifiBusy && millis() - waitWifiStart < 700) {
    delay(15);
  }
  if (wifiBusy) return;

  scanInProgress = true;
  drawCuteFace(FACE_SCANNING, "Reading Finger...");

  // Fast-path capture: try reading immediately on touch, only settle 75ms on retries
  int matchedSlot = -1;
  int confidence = 0;
  bool capturedAny = false;

  for (int attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) delay(75);
    uint8_t p = finger.getImage();
    if (p == FINGERPRINT_OK) {
      if (finger.image2Tz() == FINGERPRINT_OK) {
        capturedAny = true; // Only flag as real finger attempt once ridge features extract cleanly
        if (searchStoredTemplates() == FINGERPRINT_OK) {
          matchedSlot = finger.fingerID;
          confidence = finger.confidence;
          break;
        }
      }
    }
#if FP_USE_TOUCH_PIN
    if (!touchPinTriggered()) break;
#endif
  }

  if (!capturedAny && matchedSlot < 0) {
    scanInProgress = false;
    showIdleScreen();
    return;
  }

  if (matchedSlot < 0) {
    drawCuteFace(FACE_ERROR, "Unknown! Try Again");
    beepError();
    setMessageHold(1800);
    waitForFingerLiftAfterScan(2500);
    scanInProgress = false;
    return;
  }

  // Generate unique idempotent scan_id & capture timestamp right on match
  char scanId[40];
  uint32_t scanSeq = generateScanId(scanId, sizeof(scanId));
  time_t scanEpoch = 0;
  time(&scanEpoch);
  if (scanEpoch < 1700000000) scanEpoch = 0;

  Serial.printf("[SCAN] Matched Slot #%d (conf=%d, id=%s)\n", matchedSlot, confidence, scanId);

  // If Wi-Fi is down, save directly to offline ring buffer so scan is never lost
  if (WiFi.status() != WL_CONNECTED) {
    enqueueOfflineScan(matchedSlot, confidence, scanSeq, scanId, scanEpoch);
    drawCuteFace(FACE_CHEEKY, "Saved Offline #" + String(matchedSlot));
    beepEntry();
    setMessageHold(2400);
    waitForFingerLiftAfterScan(3000);
    scanInProgress = false;
    return;
  }

  // Preserve strict FIFO ordering if offline backlog is waiting to flush
  if (getOfflineQueueCountSnapshot() > 0) {
    enqueueOfflineScan(matchedSlot, confidence, scanSeq, scanId, scanEpoch);
    drawCuteFace(FACE_CHEEKY, "Queued Sync #" + String(matchedSlot));
    beepNotice();
    setMessageHold(2200);
    waitForFingerLiftAfterScan(3000);
    scanInProgress = false;
    return;
  }

  drawCuteFace(FACE_SCANNING, "Syncing Slot #" + String(matchedSlot));

  JsonDocument reqDoc;
  reqDoc["slot_id"] = matchedSlot;
  reqDoc["confidence"] = confidence;
  reqDoc["scan_id"] = scanId;
  String reqPayload, respStr;
  serializeJson(reqDoc, reqPayload);

  // Single outer call (performHttpRequest already handles up to 2 attempts cleanly without 62s stalls)
  unsigned long scanTimeoutMs = min((unsigned long)HTTP_TIMEOUT_MS, 8000UL);
  int httpCode = performHttpRequest("POST", "/api/biometric/device/scan", reqPayload, respStr, scanTimeoutMs);

  // Enqueue offline on transport failures, timeouts, rate limits, or 5xx server errors
  if (httpCode <= 0 || httpCode == 408 || httpCode == 429 || httpCode >= 500) {
    enqueueOfflineScan(matchedSlot, confidence, scanSeq, scanId, scanEpoch);
    drawCuteFace(FACE_CHEEKY, "Queued Sync #" + String(matchedSlot));
    beepNotice();
    setMessageHold(2400);
    waitForFingerLiftAfterScan(3000);
    scanInProgress = false;
    return;
  }

  JsonDocument respDoc;
  if (deserializeJson(respDoc, respStr)) {
    drawCuteFace(FACE_ERROR, "Server Error " + String(httpCode));
    beepError();
    setMessageHold(2200);
    waitForFingerLiftAfterScan(3000);
    scanInProgress = false;
    return;
  }

  String status = respDoc["status"] | "ERROR";
  String studentName = respDoc["student_name"] | "";
  String eventType = respDoc["event_type"] | "";

  if (status == "OK") {
    if (eventType == "ENTRY") {
      drawCuteFace(FACE_EXCITED, "IN: " + studentName.substring(0, 17));
      beepEntry();
    } else {
      drawCuteFace(FACE_WINK, "OUT: " + studentName.substring(0, 16));
      beepExit();
    }
    setMessageHold(3000);
  } else if (status == "COOLDOWN") {
    int waitSec = respDoc["wait_seconds"] | 0;
    drawCuteFace(FACE_CHEEKY, "Scanned! Wait " + String(waitSec) + "s");
    beepNotice();
    setMessageHold(2200);
  } else if (status == "PAUSED") {
    sensingEnabled = false;
    prevSensingObserved = false; // Prevent duplicate beepNotice() on next loop() tick
    showIdleScreen();
    beepNotice();
  } else {
    String msg = respDoc["message"] | "Unassigned Slot";
    drawCuteFace(FACE_ERROR, msg.substring(0, 21));
    beepError();
    setMessageHold(2400);
  }

  waitForFingerLiftAfterScan(3000);
  scanInProgress = false;
}

// ============================================================================
// WI-FI & WIRELESS OTA (ArduinoOTA — NEVER touches R307S LED!)
// ============================================================================
void initOtaIfReady() {
  if (otaInitialized || WiFi.status() != WL_CONNECTED) return;

  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPort(OTA_PORT);
  if (String(OTA_PASSWORD).length() > 0) ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    otaInProgress = true;
    buzzerOff();
    showOledStatus("WI-FI OTA UPDATE", "Receiving firmware", "Do NOT unplug power!", "Progress: 0%");
  });

  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    static int lastPct = -1;
    int pct = total > 0 ? (int)((progress * 100U) / total) : 0;
    if (pct != lastPct && (pct % 5 == 0 || pct == 100)) {
      lastPct = pct;
      showOledStatus("WI-FI OTA UPDATE", "Flashing firmware...", "Do NOT unplug power!", "Progress: " + String(pct) + "%");
    }
  });

  ArduinoOTA.onEnd([]() {
    showOledStatus("OTA COMPLETE!", "Firmware flashed OK", "Rebooting ESP32...", "");
    beepEnrollOk();
  });

  ArduinoOTA.onError([](ota_error_t error) {
    otaInProgress = false;
    showOledStatus("OTA FAILED", "Error code: " + String(error), "Resuming normal mode", "");
    beepError();
    setMessageHold(3000);
  });

  ArduinoOTA.begin();
  otaInitialized = true;
  Serial.printf("[OTA] Ready! %s.local | IP: %s | Port: %d\n",
                OTA_HOSTNAME, WiFi.localIP().toString().c_str(), OTA_PORT);
}

void onWifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      lastWifiDisconnectReason = 0;
      wifiResetNeeded = true;
      ntpRequestPending = true; // Handled synchronously under netMutex (never call configTime here!)
      Serial.printf("[WIFI] Got IP: %s (RSSI %d dBm)\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      lastWifiDisconnectReason = info.wifi_sta_disconnected.reason;
      cachedWifiBars = 0;
      wifiResetNeeded = true;
      Serial.printf("[WIFI] Disconnected (reason=%d)\n", lastWifiDisconnectReason);
      break;
    default:
      break;
  }
}

void ensureWifiConnected(bool isBoot = false) {
  if (WiFi.status() == WL_CONNECTED) {
    initOtaIfReady();
    return;
  }

  if (!wifiEventsRegistered) {
    WiFi.onEvent(onWifiEvent);
    wifiEventsRegistered = true;
  }

  // During normal loop(), NEVER block Core 1 or beep — keep offline scanning 100% responsive!
  if (!isBoot) {
    Serial.println("[WIFI] Offline — issuing non-blocking WiFi.reconnect()...");
    WiFi.reconnect();
    return;
  }

  Serial.printf("[WIFI] Connecting to %s...\n", WIFI_SSID);
  showOledStatus("CONNECTING WI-FI", WIFI_SSID, "2.4 GHz Network", "Please wait...");

  // Clean ESP32 Core 3.x STA startup (prevents NVS flash wear, stale auth state & TX brownout spikes)
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setHostname(OTA_HOSTNAME);
  WiFi.disconnect(false, false);
  delay(120);
  WiFi.setTxPower(WIFI_POWER_17dBm); // Prevents AMS1117 3.3V brownout spikes during RF association
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long timeoutMs = 20000UL;
  unsigned long start = millis();
  int dots = 0;
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(300);
    Serial.print(".");
    dots = (dots + 1) % 4;
    if ((millis() - start) % 1500 < 320) {
      String progressLine = "Connecting";
      for (int i = 0; i < dots; i++) progressLine += ".";
      showOledStatus("CONNECTING WI-FI", WIFI_SSID, progressLine, "Status: " + String((int)WiFi.status()));
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! IP: %s | RSSI: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    initOtaIfReady();
    beepEntry();

    // Wait up to ~6 seconds for NTP sync on boot so clock is valid before first HTTPS TLS handshake
    syncNtpClock(true);
    unsigned long ntpStart = millis();
    int ntpDots = 0;
    while (!ntpSynced && millis() - ntpStart < 6000UL) {
      time_t nowSec = 0;
      time(&nowSec);
      if (nowSec > 1700000000) {
        syncNtpClock(false);
        break;
      }
      ntpDots = (ntpDots + 1) % 4;
      String ntpLine = "Syncing clock";
      for (int i = 0; i < ntpDots; i++) ntpLine += ".";
      showOledStatus("WI-FI CONNECTED", "IP: " + WiFi.localIP().toString(), ntpLine, "Securing HTTPS...");
      if (otaInitialized) ArduinoOTA.handle();
      delay(250);
    }

    showOledStatus("WI-FI CONNECTED", "IP: " + WiFi.localIP().toString(), "OTA Ready (.local)", ntpSynced ? "Clock & TLS Ready" : "Syncing EduStride...");
    delay(500);
  } else {
    String errHint = "Check 2.4GHz SSID";
    if (WiFi.status() == WL_NO_SSID_AVAIL) errHint = "SSID Not Found!";
    else if (lastWifiDisconnectReason == 15 || lastWifiDisconnectReason == 202 || lastWifiDisconnectReason == 204) {
      errHint = "Wrong Password!";
    } else if (lastWifiDisconnectReason > 0) {
      errHint = "Reason code: " + String(lastWifiDisconnectReason);
    }
    Serial.printf("\n[WIFI] Failed! status=%d reason=%d\n", (int)WiFi.status(), lastWifiDisconnectReason);
    showOledStatus("WI-FI FAILED", WIFI_SSID, errHint, "Offline Mode Active");
    beepError();
    setMessageHold(3000);
  }
}

// ============================================================================
// SETUP & MAIN LOOP
// ============================================================================
// Match Core 1 loopTask stack to Core 0 heartbeatTask (16 KB) so mbedTLS Root CA handshakes never overflow stack!
SET_LOOP_TASK_STACK_SIZE(16 * 1024);

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n=== EduStride Gate Scanner %s ===\n", FIRMWARE_VERSION);

  bootNonce = esp_random();

  // Pre-set inactive buzzer level before enabling output to avoid boot chirp on active-LOW modules
  buzzerOff();
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerOff();

  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  oledReady = display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR);
  if (oledReady) {
    display.ssd1306_command(SSD1306_SETCONTRAST);
    display.ssd1306_command(0x55);
    showOledStatus("EDUSTRIDE GATE", "FW " + String(FIRMWARE_VERSION), "Init R307S Sensor...", "");
  } else {
    Serial.println("[OLED] SSD1306 not detected on I2C — continuing headless.");
  }

  netMutex = xSemaphoreCreateMutex();
  stateMutex = xSemaphoreCreateMutex();

#if FP_USE_TOUCH_PIN
  calibrateTouchPin();
#endif
  // Configure UART2 with explicit custom pins and verify sensor directly (never call finger.begin() afterward!)
  fpSerial.begin(FP_BAUD_RATE, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  delay(300);

  if (!initR307Sensor()) {
    Serial.println("[R307S] Sensor NOT detected! Check 5V->VIN, GND, TXD->16, RXD->17.");
    showOledStatus("R307S NOT FOUND", "Check sensor wires", "5V->VIN  GND->GND", "TXD->16  RXD->17");
    beepError();
    delay(2500);
  }

  ensureWifiConnected(true);
  pollServerStatus();
  prevSensingObserved = sensingEnabled;

  // 16 KB stack on Core 0 matches Core 1 (SET_LOOP_TASK_STACK_SIZE) for safe mbedTLS Root CA verification
  xTaskCreatePinnedToCore(heartbeatTask, "HeartbeatTask", 16384, nullptr, 1, nullptr, 0);

  nextBlinkMs = millis() + 2000;
  nextBehaviorMs = millis() + 3000;
  playBootAnimation();
  showIdleScreen();
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    initOtaIfReady();
    if (otaInitialized) ArduinoOTA.handle();
  }
  if (otaInProgress) { delay(5); return; }

  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED && now - lastWifiCheckMs >= 30000UL) {
    lastWifiCheckMs = now;
    ensureWifiConnected(false);
  }

  if (!sensorReady && now - lastSensorRetryMs >= 5000UL) {
    lastSensorRetryMs = now;
    if (initR307Sensor()) {
      showIdleScreen();
    }
  }

  if (prevSensingObserved != sensingEnabled) {
    prevSensingObserved = sensingEnabled;
    beepNotice();
    clearMessageHold();
    showIdleScreen();
  }

  // Execute queued remote ENROLL / DELETE / SYNC_SLOTS / CLEAR_ALL command safely on Core 1
  String runCmdId = "", runAction = "NONE", runStudent = "";
  int runSlot = 0;
  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    if (hasQueuedCommand) {
      runCmdId = queuedCmdId;
      runAction = queuedCmdAction;
      runSlot = queuedCmdSlot;
      runStudent = queuedCmdStudent;
      hasQueuedCommand = false;
      queuedCmdId = "";
      queuedCmdAction = "NONE";
    }
    xSemaphoreGive(stateMutex);
  }

  if (runAction != "NONE") {
    if (!sensorReady) {
      // Never silently drop a command when R307S is disconnected — report FAILED immediately!
      sendCommandAck(runAction, "FAILED", runSlot, "R307S fingerprint sensor not detected on ESP32! Check 5V/GND/TXD/RXD wiring.", runCmdId, "FAILED", 0);
      beepError();
    } else if (runAction == "ENROLL" && runSlot >= 1 && runSlot <= 1000) {
      executeRemoteEnroll(runSlot, runStudent, runCmdId);
    } else if (runAction == "DELETE" && runSlot >= 1 && runSlot <= 1000) {
      executeRemoteDelete(runSlot, runStudent, runCmdId);
    } else if (runAction == "SYNC_SLOTS") {
      executeRemoteSyncSlots(runCmdId);
    } else if (runAction == "CLEAR_ALL") {
      commandInProgress = true;
      showOledStatus("CLEARING MEMORY", "Erasing all prints", "Please wait...", "");
      sendCommandAck("CLEAR_ALL", "IN_PROGRESS", 0, "Clearing all stored templates from R307S flash...", runCmdId, "CLEARING", 40);
      uint8_t clrErr = finger.emptyDatabase();
      if (finger.getTemplateCount() == FINGERPRINT_OK) {
        cachedTemplateCount = finger.templateCount;
      }
      if (clrErr == FINGERPRINT_OK) {
        sendCommandAck("CLEAR_ALL", "COMPLETED", 0, "Sensor memory cleared.", runCmdId, "DONE", 100);
        showOledStatus("MEMORY CLEARED", "All slots erased", "0 stored prints", "");
        beepNotice();
      } else {
        sendCommandAck("CLEAR_ALL", "FAILED", 0, "Failed to clear memory (code 0x" + String(clrErr, HEX) + ").", runCmdId, "FAILED", 0);
        showOledStatus("CLEAR FAILED", "Code: 0x" + String(clrErr, HEX), "", "");
        beepError();
      }
      setMessageHold(2500);
      commandInProgress = false;
    } else {
      Serial.printf("[CMD] Rejected invalid command action=%s slot=%d\n", runAction.c_str(), runSlot);
      sendCommandAck(runAction, "FAILED", runSlot, "Unsupported command or out-of-range slot #" + String(runSlot) + " (valid: 1..1000).", runCmdId, "FAILED", 0);
      beepError();
    }
  }

  if (messageHolding && deadlineReached(now, messageHoldUntilMs)) {
    clearMessageHold();
    showIdleScreen();
  }

  animateIdleFace(now);

#if FP_USE_TOUCH_PIN
  // Pure 6-Wire Touch Trigger: LED stays 100% DARK & cool while idle, flashes ONLY when finger touches!
  if (sensingEnabled && sensorReady && !messageHolding && now - lastFpPollMs >= 20) {
    lastFpPollMs = now;
    if (touchPinTriggered()) {
      delay(15); // 15ms hardware debounce
      if (touchPinTriggered()) {
        scanAndSubmitFingerprint();
      }
    }
  }
#else
  // 4-Wire Fallback Mode: periodic optical polling without capacitive touch wire
  if (sensingEnabled && sensorReady && !messageHolding && now - lastFpPollMs >= 250) {
    lastFpPollMs = now;
    if (finger.getImage() == FINGERPRINT_OK) {
      scanAndSubmitFingerprint();
    }
  }
#endif

  delay(10);
}
