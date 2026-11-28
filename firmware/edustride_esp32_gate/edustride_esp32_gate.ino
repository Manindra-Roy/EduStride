/*
 * EduStride Biometric Attendance & Gate Entry/Exit Scanner (v3.0)
 *
 * Hardware:
 *   - ESP32-CP2102-TypeC-38Pins
 *   - 0.96" I2C 4-pin SSD1306 OLED (SDA=21, SCL=22, VCC=3V3)
 *   - R307S Optical Fingerprint Sensor (5V->VIN, GND->GND, TXD->GPIO16, RXD->GPIO17, optional TOUCH->GPIO4 & 3.3VT->3V3)
 *   - Buzzer (GPIO 25)
 *   - Motorized Cabinet Tray Actuator (GPIO 18 PWM, 5V->Buck OUT+, GND->GND)
 *     Supports 3 live-selectable modes:
 *       1) LIMIT_360 : SG90/MG90S 360° + 2 Mouse Microswitches (GPIO 26 CLOSED, GPIO 27 OPEN)
 *       2) TIMED_360 : SG90/MG90S 360° Timed Open/Close with NVS state memory
 *       3) ANGLE_180 : SG90/MG90S 180° Positional Servo with smooth angular sweep
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Preferences.h>
#include <Wire.h>
#include <time.h>
#include "esp_timer.h"
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_Fingerprint.h>
#include <ArduinoJson.h>
#include "config.h"

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "3.1.2-ota"
#endif
#ifndef SERVER_FALLBACK_URL
#define SERVER_FALLBACK_URL ""
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
#ifndef SERVO_ENABLED
#define SERVO_ENABLED true
#endif
#ifndef SERVO_PIN
#define SERVO_PIN 18
#endif
#ifndef SERVO_DEFAULT_MODE
#define SERVO_DEFAULT_MODE 0   // 0=LIMIT_360, 1=TIMED_360, 2=ANGLE_180
#endif
#ifndef SERVO_SPEED_PCT
#define SERVO_SPEED_PCT 80
#endif
#ifndef SERVO_STOP_US
#define SERVO_STOP_US 1500
#endif
#ifndef SERVO_INVERT_DIRECTION
#define SERVO_INVERT_DIRECTION false
#endif
#ifndef SERVO_OPEN_MS
#define SERVO_OPEN_MS 1060
#endif
#ifndef SERVO_CLOSE_MS
#define SERVO_CLOSE_MS 1060
#endif
#ifndef SERVO_CLOSED_ANGLE
#define SERVO_CLOSED_ANGLE 10
#endif
#ifndef SERVO_OPEN_ANGLE
#define SERVO_OPEN_ANGLE 110
#endif
#ifndef SERVO_SWEEP_DPS
#define SERVO_SWEEP_DPS 120
#endif
#ifndef SERVO_MAX_RUN_MS
#define SERVO_MAX_RUN_MS 4500
#endif
#ifndef SERVO_AUTO_HOME_ON_BOOT
#define SERVO_AUTO_HOME_ON_BOOT false
#endif
#ifndef SERVO_LIMIT_CLOSED_PIN
#define SERVO_LIMIT_CLOSED_PIN 26
#endif
#ifndef SERVO_LIMIT_OPEN_PIN
#define SERVO_LIMIT_OPEN_PIN 27
#endif
#ifndef SERVO_LIMIT_ACTIVE_LOW
#define SERVO_LIMIT_ACTIVE_LOW true
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
String lastSecureBaseUrl = "";
String lastPlainBaseUrl = "";
bool usingFallbackServer = false;
unsigned long lastPrimaryProbeMs = 0;
const unsigned long PRIMARY_RECOVERY_INTERVAL_MS = 30000UL;
bool wifiEventsRegistered = false;
volatile bool wifiResetNeeded = false;
volatile uint8_t lastWifiDisconnectReason = 0;

// Cached Wi-Fi RSSI bars (volatile: written by sys_evt on Core 0, read by OLED on Core 1)
volatile int cachedWifiBars = 0;
unsigned long lastRssiSampleMs = 0;
uint8_t wifiReconnectFailures = 0;
unsigned long lastSensorHealthMs = 0;
uint8_t sensorHealthMisses = 0;

// Runtime state synced with EduStride backend
volatile bool devicePowerOn = true;
bool prevDevicePowerObserved = true;
bool deviceInStandby = false;
bool standbyWaitingRetract = false;
volatile bool sensingEnabled = true;
volatile bool prevSensingObserved = true;
volatile bool firstHeartbeatSynced = false;
volatile bool otaInProgress = false;
volatile bool scanInProgress = false;
volatile bool commandInProgress = false;
volatile bool servoMoving = false;
volatile bool wifiBusy = false;
volatile int cachedTemplateCount = 0;

// Edge-triggered touch wakeup & anti-stuck-LED protection (GPIO 4)
bool touchMustRelease = false;
unsigned long touchStuckStartMs = 0;
unsigned long touchCooldownUntilMs = 0;
bool traySettledActive = false;
unsigned long traySettledUntilMs = 0;

// ============================================================================
// MOTORIZED CABINET TRAY v3.0 STATE & LIVE TUNABLE CONFIG (NVS Persisted)
// ============================================================================
enum TrayMode : uint8_t {
  TRAY_MODE_LIMIT_360 = 0,
  TRAY_MODE_TIMED_360 = 1,
  TRAY_MODE_ANGLE_180 = 2
};

enum TrayState : uint8_t {
  TRAY_ST_UNKNOWN = 0,
  TRAY_ST_CLOSED,
  TRAY_ST_OPEN,
  TRAY_ST_EXTENDING,
  TRAY_ST_RETRACTING,
  TRAY_ST_HOMING,
  TRAY_ST_NUDGING_OPEN,
  TRAY_ST_NUDGING_CLOSE,
  TRAY_ST_STOPPED,
  TRAY_ST_FAULT
};

struct TrayConfig {
  bool enabled;
  uint8_t mode;
  bool invertDirection;
  int speedPct;
  int stopUs;
  int openMs;
  int closeMs;
  int closedAngle;
  int openAngle;
  int sweepSpeedDps;
  int maxRunMs;
  bool autoHomeOnBoot;
};

Preferences trayPrefs;
TrayConfig trayCfg = {
  SERVO_ENABLED,
  SERVO_DEFAULT_MODE,
  SERVO_INVERT_DIRECTION,
  SERVO_SPEED_PCT,
  SERVO_STOP_US,
  SERVO_OPEN_MS,
  SERVO_CLOSE_MS,
  SERVO_CLOSED_ANGLE,
  SERVO_OPEN_ANGLE,
  SERVO_SWEEP_DPS,
  SERVO_MAX_RUN_MS,
  SERVO_AUTO_HOME_ON_BOOT
};
TrayConfig pendingTrayCfg = trayCfg;
volatile bool hasIncomingTrayCfg = false;

volatile TrayState trayState = TRAY_ST_UNKNOWN;
volatile bool swClosedPressed = false;
volatile bool swOpenPressed = false;
char trayFaultMsg[96] = "";

bool trayBootSynced = false;
bool servoPwmAttached = false;
String serialCmdBuffer = "";

// Non-blocking motion & switch-debounce runtime registers (Core 1 only)
int64_t trayMotionStartUs = 0;
int64_t trayMotionDurationUs = 0;
int trayMotionPulseUs = 1500;
bool trayBraking = false;
unsigned long trayBrakeUntilMs = 0;
bool trayBrakeBeepError = false;
bool trayBrakeBeepNotice = false;
unsigned long trayFingerWaitStartMs = 0;
bool trayPendingRetractAfterLift = false;
unsigned long trayLastOledMs = 0;
float trayAngleCur = (float)SERVO_CLOSED_ANGLE;
float trayAngleStart = (float)SERVO_CLOSED_ANGLE;
float trayAngleTarget = (float)SERVO_CLOSED_ANGLE;
String trayActiveSubtitle = "";
String trayActiveCmdId = "";
String trayActiveCmdAction = "";
int trayActiveCmdSlot = 0;
bool trayPendingAckReady = false;
bool trayPendingAckOk = true;
String trayPendingAckMsg = "";
bool trayMotionBeepOnFinish = false;

// 15ms debouncers for mouse microswitches (GPIO 26 CLOSED, GPIO 27 OPEN)
bool swClosedRawPrev = false;
unsigned long swClosedChangeMs = 0;
bool swOpenRawPrev = false;
unsigned long swOpenChangeMs = 0;

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

// Monotonic scan sequence + NVS boot counter + RF-seeded boot nonce for backend scan_id idempotency
uint32_t bootCounter = 0;
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

String normalizeBaseUrl(const char* rawUrl) {
  if (!rawUrl) return "";
  String baseUrl = String(rawUrl);
  baseUrl.trim();
  while (baseUrl.endsWith("/")) baseUrl.remove(baseUrl.length() - 1);
  return baseUrl;
}

// MUST be called while holding netMutex!
int executeSingleServerRequest(
  const String& baseUrl,
  const String& method,
  const String& path,
  const String& jsonBody,
  String& responseOut,
  unsigned long effectiveTimeoutMs,
  int maxNetAttempts,
  unsigned long connectTimeoutOverrideMs = 0
) {
  String fullUrl = baseUrl + path;
  bool isHttps = (fullUrl.startsWith("https://") || fullUrl.startsWith("HTTPS://"));
  unsigned long connectTimeoutMs = (connectTimeoutOverrideMs > 0)
    ? min(effectiveTimeoutMs, connectTimeoutOverrideMs)
    : min(effectiveTimeoutMs, 5000UL);
  int httpCode = -2;

  // Reset persistent client socket cleanly if target host changed (e.g. primary <-> fallback)
  if (isHttps) {
    if (lastSecureBaseUrl != baseUrl) {
      sharedSecureClient.stop();
      tlsConfigured = false;
      lastSecureBaseUrl = baseUrl;
    }
  } else {
    if (lastPlainBaseUrl != baseUrl) {
      sharedPlainClient.stop();
      lastPlainBaseUrl = baseUrl;
    }
  }

  // Up to maxNetAttempts: recovers transparently if a Render/Cloudflare Keep-Alive socket closed while idle
  for (int netAttempt = 0; netAttempt < maxNetAttempts; netAttempt++) {
    HTTPClient http;
    http.setTimeout(effectiveTimeoutMs);
    http.setConnectTimeout(connectTimeoutMs);
    http.setReuse(true);

    bool began = false;
    if (isHttps) {
      if (!tlsConfigured) {
        sharedSecureClient.setHandshakeTimeout(8); // Cap mbedTLS handshake at 8s (default is 120s!)
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
        int contentLen = http.getSize();
        if (contentLen > 16384) {
          Serial.printf("[HTTP] Response too large (%d bytes) — aborting to protect heap!\n", contentLen);
          responseOut = "";
          httpCode = -4;
        } else {
          responseOut = http.getString();
        }
        http.end();
        break;
      } else {
        Serial.printf("[HTTP] %s %s%s failed (code=%d, attempt=%d)\n", method.c_str(), baseUrl.c_str(), path.c_str(), httpCode, netAttempt + 1);
        http.end();
        if (isHttps) {
          sharedSecureClient.stop();
          tlsConfigured = false;
        } else {
          sharedPlainClient.stop();
        }
        if (netAttempt + 1 < maxNetAttempts) delay(120);
      }
    } else {
      httpCode = -2;
      break;
    }
  }

  return httpCode;
}

int performHttpRequest(const String& method, const String& path, const String& jsonBody, String& responseOut, unsigned long timeoutOverrideMs = 0) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  unsigned long effectiveTimeoutMs = (timeoutOverrideMs > 0) ? timeoutOverrideMs : (unsigned long)HTTP_TIMEOUT_MS;
  if (netMutex && xSemaphoreTake(netMutex, pdMS_TO_TICKS(effectiveTimeoutMs + 4000)) != pdTRUE) return -3;

  wifiBusy = true;

  if (wifiResetNeeded) {
    wifiResetNeeded = false;
    sharedSecureClient.stop();
    tlsConfigured = false;
    sharedPlainClient.stop();
    lastSecureBaseUrl = "";
    lastPlainBaseUrl = "";
  }

  // Opportunistically check/throttle NTP sync from this single synchronized path
  if (!ntpSynced || ntpRequestPending) {
    syncNtpClockLocked(ntpRequestPending);
  }

  String primaryBase = normalizeBaseUrl(SERVER_BASE_URL);
  String fallbackBase = normalizeBaseUrl(SERVER_FALLBACK_URL);
  bool hasFallback = (fallbackBase.length() > 0 && fallbackBase != primaryBase);

  // Use single attempt for short override timeouts (e.g. 2s mid-enrollment cancel checks)
  bool isFastCheck = (timeoutOverrideMs > 0 && timeoutOverrideMs <= 3000UL);
  int maxNetAttempts = isFastCheck ? 1 : 2;
  int httpCode = -2;

  unsigned long nowMs = millis();
  bool shouldProbePrimary = usingFallbackServer && !isFastCheck &&
    ((unsigned long)(nowMs - lastPrimaryProbeMs) >= PRIMARY_RECOVERY_INTERVAL_MS);

  if (!hasFallback || !usingFallbackServer || shouldProbePrimary) {
    int primaryAttempts = shouldProbePrimary ? 1 : maxNetAttempts;
    httpCode = executeSingleServerRequest(primaryBase, method, path, jsonBody, responseOut, effectiveTimeoutMs, primaryAttempts);
    if (httpCode > 0) {
      if (usingFallbackServer) {
        usingFallbackServer = false;
        Serial.printf("[HTTP] Recovered PRIMARY server: %s\n", primaryBase.c_str());
      }
    } else if (hasFallback) {
      lastPrimaryProbeMs = millis();
      int fbCode = executeSingleServerRequest(fallbackBase, method, path, jsonBody, responseOut, min(effectiveTimeoutMs, 6000UL), 1, 2500UL);
      if (fbCode > 0) {
        httpCode = fbCode;
        if (!usingFallbackServer) {
          usingFallbackServer = true;
          Serial.printf("[HTTP] Primary unreachable -> switched to FALLBACK server: %s\n", fallbackBase.c_str());
        }
      }
    }
  } else {
    // Currently pinned to healthy local fallback; use it directly for zero-lag LAN speed
    httpCode = executeSingleServerRequest(fallbackBase, method, path, jsonBody, responseOut, min(effectiveTimeoutMs, 6000UL), 1, 2500UL);
    if (httpCode <= 0) {
      // Fallback went down (e.g., local PC stopped) — immediately try primary cloud server!
      usingFallbackServer = false;
      Serial.printf("[HTTP] Fallback unreachable -> retrying PRIMARY server: %s\n", primaryBase.c_str());
      httpCode = executeSingleServerRequest(primaryBase, method, path, jsonBody, responseOut, effectiveTimeoutMs, maxNetAttempts);
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
  snprintf(outBuf, outSize, "%.12s-b%lu-%04x-%lu",
           DEVICE_ID, (unsigned long)bootCounter, (unsigned int)(bootNonce & 0xFFFFU), (unsigned long)seq);
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
    reqDoc["offline_replay"] = true;
    if (item.scannedAt > 1700000000) {
      reqDoc["scanned_at"] = (long)item.scannedAt;
    }
    String payload, resp;
    serializeJson(reqDoc, payload);
    int code = performHttpRequest("POST", "/api/biometric/device/scan", payload, resp);

    // Only pop on truly terminal outcomes — NEVER discard valid scans on 403 PAUSED or transient errors!
    bool shouldPop = (code == 200 || code == 201 || code == 400 || code == 404);
    if (code == 403) {
      JsonDocument errDoc;
      if (!deserializeJson(errDoc, resp)) {
        const char* st = errDoc["status"] | "";
        if (strcmp(st, "INACTIVE_STUDENT") == 0) {
          shouldPop = true;
        }
      }
    }

    if (shouldPop) {
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

  // Run one baseline getImage() so R307S auto-strobes and leaves the blue prism LED cleanly OFF at idle.
  // Never call LEDcontrol(true) without capture (0x50 latches the blue LED solid ON until first scan!)
  // and never call LEDcontrol(false) (0x51 can inhibit optical capture on some R307S batches).
  finger.getImage();
  delay(20);

  Serial.printf("[R307S] Sensor READY! Capacity=%d | Security=%d | Templates=%d\n",
                finger.capacity, finger.security_level, cachedTemplateCount);
  return true;
}

uint8_t searchStoredTemplates() {
  // Always use full-capacity fingerSearch() — fingerFastSearch() only scans slots 0..162!
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
  int code = performHttpRequest("GET", path, "", response, 2000UL);
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
  // Note: Do NOT call finger.LEDcontrol(true) — R307S getImage() auto-strobes the optical LED cleanly
  // without latching it solid ON after enrollment finishes.

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
  // Require clean finger lift after enrollment so a resting finger never fires an immediate false gate ENTRY!
  touchMustRelease = true;
  touchStuckStartMs = millis();
  drawCuteFace(FACE_EXCITED, "Enrolled #" + String(slotId) + "!");
  beepEnrollOk();
  sendCommandAck("ENROLL", "COMPLETED", slotId, "Verified & enrolled " + studentName + " in Slot #" + String(slotId) + "!", cmdId, "DONE", 100);
  setMessageHold(3200);
  commandInProgress = false;
}

static inline bool isFingerprintCommError(uint8_t code) {
  return code == FINGERPRINT_PACKETRECIEVEERR ||
         code == FINGERPRINT_BADPACKET ||
         code == 0xFF; // FINGERPRINT_TIMEOUT
}

// Read occupied slots (1..1000) via R307S ReadIndexTable (0x1F, pages 0..3), with verified loadModel fallback.
// Returns >= 0 occupied count on verified read, or -1 on ANY sensor/UART communication or count-mismatch error.
int readOccupiedHardwareSlots(uint16_t* outSlots, int maxSlots, const String& cmdId, int& expectedCountOut, String& errReasonOut) {
  expectedCountOut = -1;
  errReasonOut = "";
  int count = 0;
  bool indexTableOk = true;
  bool slotZeroOccupied = false;

  while (fpSerial.available()) fpSerial.read();

  // 1. Verify the R307S is actually alive and answering on UART before trusting any slot scan
  bool sensorAlive = false;
  for (int attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      while (fpSerial.available()) fpSerial.read();
      delay(50);
    }
    if (finger.verifyPassword()) {
      sensorAlive = true;
      break;
    }
  }
  if (!sensorAlive) {
    sensorReady = false;
    errReasonOut = "R307S sensor not responding on UART — sync aborted safely.";
    Serial.println("[SYNC] ABORT: " + errReasonOut);
    return -1;
  }

  // 2. Read the sensor's internal template counter to cross-check our slot table against UART glitches
  int expectedCount = -1;
  for (int attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      while (fpSerial.available()) fpSerial.read();
      delay(40);
    }
    if (finger.getTemplateCount() == FINGERPRINT_OK) {
      expectedCount = (int)finger.templateCount;
      break;
    }
  }
  if (expectedCount < 0) {
    errReasonOut = "Failed to read R307S template count — sync aborted safely.";
    Serial.println("[SYNC] ABORT: " + errReasonOut);
    return -1;
  }
  expectedCountOut = expectedCount;

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
      if (finger.deleteModel(0) == FINGERPRINT_OK && finger.getTemplateCount() == FINGERPRINT_OK) {
        expectedCount = (int)finger.templateCount;
        expectedCountOut = expectedCount;
      } else if (expectedCount > 0) {
        expectedCount--;
        expectedCountOut = expectedCount;
      }
    }
    if (expectedCount > count) {
      errReasonOut = "R307S count mismatch (sensor=" + String(expectedCount) + ", index=" + String(count) + ") — sync aborted safely.";
      Serial.println("[SYNC] ABORT: " + errReasonOut);
      return -1;
    }
    return count;
  }

  // Fallback for rare clones without 0x1F: probe FULL 1..min(capacity, 1000) with strict UART error detection!
  Serial.println("[SYNC] ReadIndexTable unavailable — running verified full loadModel scan (1..1000)...");
  uint8_t s0 = finger.loadModel(0);
  if (isFingerprintCommError(s0)) {
    errReasonOut = "R307S UART error probing Slot #0 — sync aborted safely.";
    Serial.println("[SYNC] ABORT: " + errReasonOut);
    return -1;
  }
  if (s0 == FINGERPRINT_OK) {
    Serial.println("[SYNC] Found orphan Slot #0 occupied (fallback) — erasing!");
    if (finger.deleteModel(0) == FINGERPRINT_OK && finger.getTemplateCount() == FINGERPRINT_OK) {
      expectedCount = (int)finger.templateCount;
      expectedCountOut = expectedCount;
    } else if (expectedCount > 0) {
      expectedCount--;
      expectedCountOut = expectedCount;
    }
  }

  count = 0;
  int limit = min((int)finger.capacity, 1000);
  if (limit <= 0) limit = 1000;
  for (int s = 1; s <= limit && count < maxSlots; s++) {
    uint8_t p = finger.loadModel(s);
    if (isFingerprintCommError(p)) {
      while (fpSerial.available()) fpSerial.read();
      delay(30);
      p = finger.loadModel(s);
      if (isFingerprintCommError(p)) {
        errReasonOut = "R307S UART error at Slot #" + String(s) + " (code 0x" + String(p, HEX) + ") — sync aborted safely.";
        Serial.println("[SYNC] ABORT: " + errReasonOut);
        return -1;
      }
    }
    if (p == FINGERPRINT_OK) {
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
    // Refresh backend last_heartbeat during slow fallback scans so app doesn't mark device OFFLINE (>30s)
    if ((s % 250) == 0 && s < limit) {
      int pct = 25 + (s * 28) / limit;
      sendCommandAck("SYNC_SLOTS", "IN_PROGRESS", 0, "Scanning flash slot " + String(s) + "/" + String(limit) + "...", cmdId, "READING_SENSOR", pct);
    }
  }

  if (expectedCount > count) {
    errReasonOut = "R307S count mismatch (sensor=" + String(expectedCount) + ", scanned=" + String(count) + ") — sync aborted safely.";
    Serial.println("[SYNC] ABORT: " + errReasonOut);
    return -1;
  }
  return count;
}

void executeRemoteSyncSlots(const String& cmdId) {
  commandInProgress = true;
  Serial.printf("[SYNC] Starting R307S <-> DB slot audit (cmd=%s)\n", cmdId.c_str());
  drawEnrollScreen("SENSOR SYNC", "Auditing R307S", "Reading 1000", "flash slots...", 25, ENROLL_ICON_SCAN);
  sendCommandAck("SYNC_SLOTS", "IN_PROGRESS", 0, "Reading R307S hardware index table...", cmdId, "READING_SENSOR", 30);

  static uint16_t hwSlots[1000];
  int expectedCount = -1;
  String readErr = "";
  int hwCount = readOccupiedHardwareSlots(hwSlots, 1000, cmdId, expectedCount, readErr);
  if (hwCount < 0) {
    drawEnrollScreen("SYNC ABORTED", "Sensor Error", "DB Protected!", "Check R307S", 0, ENROLL_ICON_WARN);
    beepError();
    sendCommandAck("SYNC_SLOTS", "FAILED", 0, readErr.length() ? readErr : "R307S read failed during slot sync.", cmdId, "FAILED", 0);
    setMessageHold(3200);
    commandInProgress = false;
    return;
  }
  Serial.printf("[SYNC] Verified %d occupied slots on R307S hardware (sensor count=%d)\n", hwCount, expectedCount);

  drawEnrollScreen("SENSOR SYNC", "Comparing DB", "Found " + String(hwCount), "sensor prints", 55, ENROLL_ICON_SCAN);

  // Pre-allocate JSON payload to avoid heap fragmentation across up to 1,000 slots
  String payload;
  payload.reserve(140 + hwCount * 5);
  payload += "{\"command_id\":\"";
  payload += cmdId;
  payload += "\",\"sensor_verified\":true,\"sensor_template_count\":";
  payload += String(expectedCount);
  payload += ",\"confirm_empty\":";
  payload += (hwCount == 0 && expectedCount == 0) ? "true" : "false";
  payload += ",\"hardware_slots\":[";
  for (int i = 0; i < hwCount; i++) {
    if (i > 0) payload += ",";
    payload += String(hwSlots[i]);
  }
  payload += "]}";

  String respStr;
  int httpCode = performHttpRequest("POST", "/api/biometric/device/sync-slots", payload, respStr);
  payload = ""; // Release JSON payload buffer before parsing server response
  if (httpCode != 200) {
    drawEnrollScreen("SYNC FAILED", "Server Error", "HTTP " + String(httpCode), "Try again", 0, ENROLL_ICON_WARN);
    beepError();
    sendCommandAck("SYNC_SLOTS", "FAILED", 0, "Could not sync slots with server (HTTP " + String(httpCode) + ").", cmdId, "FAILED", 0);
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

const char* trayStateToApiString(TrayState st) {
  switch (st) {
    case TRAY_ST_CLOSED:        return "CLOSED";
    case TRAY_ST_OPEN:          return "OPEN";
    case TRAY_ST_EXTENDING:
    case TRAY_ST_NUDGING_OPEN:  return "EXTENDING";
    case TRAY_ST_RETRACTING:
    case TRAY_ST_NUDGING_CLOSE: return "RETRACTING";
    case TRAY_ST_HOMING:        return "HOMING";
    case TRAY_ST_STOPPED:       return "STOPPED";
    case TRAY_ST_FAULT:         return "FAULT";
    default:                    return "UNKNOWN";
  }
}

uint8_t parseTrayModeStr(const char* s, uint8_t fallback) {
  if (!s) return fallback;
  if (strcmp(s, "LIMIT_360") == 0) return TRAY_MODE_LIMIT_360;
  if (strcmp(s, "TIMED_360") == 0) return TRAY_MODE_TIMED_360;
  if (strcmp(s, "ANGLE_180") == 0) return TRAY_MODE_ANGLE_180;
  return fallback;
}

const char* trayModeToStr(uint8_t mode) {
  if (mode == TRAY_MODE_LIMIT_360) return "LIMIT_360";
  if (mode == TRAY_MODE_ANGLE_180) return "ANGLE_180";
  return "TIMED_360";
}

String urlEncodeMini(const char* src) {
  String out;
  if (!src) return out;
  for (size_t i = 0; src[i] != '\0' && i < 80; i++) {
    char c = src[i];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.') {
      out += c;
    } else if (c == ' ') {
      out += "%20";
    }
  }
  return out;
}

// ============================================================================
// CORE 0 BACKGROUND HEARTBEAT (Configurable interval + Offline Queue Flush)
// ============================================================================
void pollServerStatus() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (otaInProgress || scanInProgress || commandInProgress || servoMoving) return;

  char swBits[3] = { swClosedPressed ? '1' : '0', swOpenPressed ? '1' : '0', '\0' };
  char faultCopy[96] = "";
  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    strncpy(faultCopy, trayFaultMsg, sizeof(faultCopy) - 1);
    faultCopy[sizeof(faultCopy) - 1] = '\0';
    xSemaphoreGive(stateMutex);
  }

  String path = "/api/biometric/device/status?firmware=" + String(FIRMWARE_VERSION)
              + "&templates=" + String((int)cachedTemplateCount)
              + "&ip=" + WiFi.localIP().toString()
              + "&tray=" + String(trayStateToApiString(trayState))
              + "&sw=" + String(swBits);
  if (faultCopy[0] != '\0') {
    path += "&tfault=" + urlEncodeMini(faultCopy);
  }

  String response;
  int code = performHttpRequest("GET", path, "", response);
  if (code != 200) return;

  JsonDocument doc;
  if (deserializeJson(doc, response)) return;

  bool newPowerOn = doc["device_power_on"] | true;
  bool newSensing = doc["sensing_enabled"] | true;
  const char* newTime = doc["server_time_ist"] | "";

  JsonObject trayObj = doc["tray_config"].as<JsonObject>();
  bool gotTrayCfg = !trayObj.isNull();
  TrayConfig parsedTray = {
    SERVO_ENABLED, SERVO_DEFAULT_MODE, SERVO_INVERT_DIRECTION, SERVO_SPEED_PCT,
    SERVO_STOP_US, SERVO_OPEN_MS, SERVO_CLOSE_MS, SERVO_CLOSED_ANGLE,
    SERVO_OPEN_ANGLE, SERVO_SWEEP_DPS, SERVO_MAX_RUN_MS, SERVO_AUTO_HOME_ON_BOOT
  };
  if (gotTrayCfg) {
    if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      parsedTray = trayCfg;
      xSemaphoreGive(stateMutex);
    }
    parsedTray.enabled = trayObj["enabled"] | parsedTray.enabled;
    parsedTray.mode = parseTrayModeStr(trayObj["mode"] | "", parsedTray.mode);
    parsedTray.invertDirection = trayObj["invert_direction"] | parsedTray.invertDirection;
    parsedTray.speedPct = constrain((int)(trayObj["speed_pct"] | parsedTray.speedPct), 20, 100);
    parsedTray.stopUs = constrain((int)(trayObj["stop_us"] | parsedTray.stopUs), 1350, 1650);
    parsedTray.openMs = constrain((int)(trayObj["open_ms"] | parsedTray.openMs), 100, 8000);
    parsedTray.closeMs = constrain((int)(trayObj["close_ms"] | parsedTray.closeMs), 100, 8000);
    parsedTray.closedAngle = constrain((int)(trayObj["closed_angle"] | parsedTray.closedAngle), 0, 180);
    parsedTray.openAngle = constrain((int)(trayObj["open_angle"] | parsedTray.openAngle), 0, 180);
    parsedTray.sweepSpeedDps = constrain((int)(trayObj["sweep_speed_dps"] | parsedTray.sweepSpeedDps), 30, 360);
    parsedTray.maxRunMs = constrain((int)(trayObj["max_run_ms"] | parsedTray.maxRunMs), 500, 15000);
    parsedTray.autoHomeOnBoot = trayObj["auto_home_on_boot"] | parsedTray.autoHomeOnBoot;
  }

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
    devicePowerOn = newPowerOn;
    sensingEnabled = newSensing;
    firstHeartbeatSynced = true;
    if (gotTrayCfg) {
      pendingTrayCfg = parsedTray;
      hasIncomingTrayCfg = true;
    }
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
  const TickType_t activeDelayTicks = pdMS_TO_TICKS(max(2000, HEARTBEAT_INTERVAL_MS));
  const TickType_t standbyDelayTicks = pdMS_TO_TICKS(12000);
  for (;;) {
    if (!otaInProgress && !scanInProgress && !commandInProgress && !servoMoving && WiFi.status() == WL_CONNECTED) {
      if (!ntpSynced || ntpRequestPending) syncNtpClock(ntpRequestPending);
      pollServerStatus();
      if (devicePowerOn) flushOfflineScans();
    }
    vTaskDelay(devicePowerOn ? activeDelayTicks : standbyDelayTicks);
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
  touchMustRelease = true;
  touchStuckStartMs = millis();
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
    touchMustRelease = true;
    touchStuckStartMs = millis();
    touchCooldownUntilMs = millis() + 500UL;
    scanInProgress = false;
    showIdleScreen();
    return;
  }

  if (matchedSlot < 0) {
    drawCuteFace(FACE_ERROR, "Unknown! Try Again");
    beepError();
    setMessageHold(1800);
    waitForFingerLiftAfterScan(2500);
    touchMustRelease = true;
    touchStuckStartMs = millis();
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
    touchMustRelease = true;
    touchStuckStartMs = millis();
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
    touchMustRelease = true;
    touchStuckStartMs = millis();
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
    touchMustRelease = true;
    touchStuckStartMs = millis();
    scanInProgress = false;
    return;
  }

  JsonDocument respDoc;
  if (deserializeJson(respDoc, respStr)) {
    // Non-JSON response (e.g. captive portal / truncated proxy HTML): preserve scan offline safely
    enqueueOfflineScan(matchedSlot, confidence, scanSeq, scanId, scanEpoch);
    drawCuteFace(FACE_CHEEKY, "Queued Sync #" + String(matchedSlot));
    beepNotice();
    setMessageHold(2200);
    waitForFingerLiftAfterScan(3000);
    touchMustRelease = true;
    touchStuckStartMs = millis();
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
    showIdleScreen();
  } else {
    String msg = respDoc["message"] | "Unassigned Slot";
    drawCuteFace(FACE_ERROR, msg.substring(0, 21));
    beepError();
    setMessageHold(2400);
  }

  waitForFingerLiftAfterScan(3000);
  touchMustRelease = true;
  touchStuckStartMs = millis();
  scanInProgress = false;
}

// ============================================================================
// MOTORIZED CABINET TRAY CONTROLLER v3.0 (Non-Blocking 3-Mode FSM)
//   Mode 0 (LIMIT_360): SG90/MG90S 360° + 2 Mouse Microswitches (GPIO 26 CLOSED, GPIO 27 OPEN)
//   Mode 1 (TIMED_360): SG90/MG90S 360° Timed Open/Close + NVS State Memory
//   Mode 2 (ANGLE_180): SG90/MG90S 180° Positional Servo with Smooth Angular Sweep
// Uses ESP32 native 50.000000 Hz 16-bit LEDC on APB 80MHz (0.305 us/tick).
// Keeps LEDC permanently attached; writes duty=0 (flat 0V LOW) at rest.
// ============================================================================
static const uint32_t SERVO_PWM_FREQ_HZ      = 50;
static const uint8_t  SERVO_PWM_RES_BITS     = 16;
static const uint32_t SERVO_PWM_PERIOD_TICKS = (1UL << SERVO_PWM_RES_BITS);
#if ESP_ARDUINO_VERSION_MAJOR < 3
static const uint8_t  SERVO_LEDC_CHANNEL = 6;
#endif

bool readRawSwitchClosed() {
#if SERVO_ENABLED
  int lvl = digitalRead(SERVO_LIMIT_CLOSED_PIN);
  return SERVO_LIMIT_ACTIVE_LOW ? (lvl == LOW) : (lvl == HIGH);
#else
  return false;
#endif
}

bool readRawSwitchOpen() {
#if SERVO_ENABLED
  int lvl = digitalRead(SERVO_LIMIT_OPEN_PIN);
  return SERVO_LIMIT_ACTIVE_LOW ? (lvl == LOW) : (lvl == HIGH);
#else
  return false;
#endif
}

void pollTraySwitches() {
#if SERVO_ENABLED
  unsigned long now = millis();
  bool rawC = readRawSwitchClosed();
  if (rawC != swClosedRawPrev) {
    swClosedRawPrev = rawC;
    swClosedChangeMs = now;
  } else if (now - swClosedChangeMs >= 15UL && swClosedPressed != rawC) {
    swClosedPressed = rawC;
    Serial.printf("[SWITCH] CLOSED (GPIO %d) = %s\n", SERVO_LIMIT_CLOSED_PIN, rawC ? "PRESSED" : "RELEASED");
  }

  bool rawO = readRawSwitchOpen();
  if (rawO != swOpenRawPrev) {
    swOpenRawPrev = rawO;
    swOpenChangeMs = now;
  } else if (now - swOpenChangeMs >= 15UL && swOpenPressed != rawO) {
    swOpenPressed = rawO;
    Serial.printf("[SWITCH] OPEN   (GPIO %d) = %s\n", SERVO_LIMIT_OPEN_PIN, rawO ? "PRESSED" : "RELEASED");
  }
#endif
}

bool isTrayMoving() {
  TrayState st = trayState;
  return (
    st == TRAY_ST_EXTENDING ||
    st == TRAY_ST_RETRACTING ||
    st == TRAY_ST_HOMING ||
    st == TRAY_ST_NUDGING_OPEN ||
    st == TRAY_ST_NUDGING_CLOSE ||
    trayBraking ||
    trayPendingRetractAfterLift
  );
}

void setTrayFaultReason(const char* reason) {
  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    strncpy(trayFaultMsg, reason ? reason : "", sizeof(trayFaultMsg) - 1);
    trayFaultMsg[sizeof(trayFaultMsg) - 1] = '\0';
    xSemaphoreGive(stateMutex);
  } else {
    strncpy(trayFaultMsg, reason ? reason : "", sizeof(trayFaultMsg) - 1);
    trayFaultMsg[sizeof(trayFaultMsg) - 1] = '\0';
  }
}

uint32_t servoPulseUsToDuty(int pulseUs) {
  int clamped = constrain(pulseUs, 500, 2500);
  return (uint32_t)((((uint64_t)clamped * (uint64_t)SERVO_PWM_PERIOD_TICKS) + 10000ULL) / 20000ULL);
}

int angleToPulseUs(float deg) {
  float c = constrain(deg, 0.0f, 180.0f);
  return (int)(500.0f + (c * 2000.0f) / 180.0f + 0.5f);
}

int get360PulseForDirection(bool extend) {
  bool forward = trayCfg.invertDirection ? !extend : extend;
  int delta = (500 * constrain(trayCfg.speedPct, 20, 100)) / 100;
  int target = forward ? (trayCfg.stopUs + delta) : (trayCfg.stopUs - delta);
  return constrain(target, 500, 2500);
}

void servoAttachPwm() {
#if SERVO_ENABLED
  if (servoPwmAttached) return;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  bool ok = ledcAttach(SERVO_PIN, SERVO_PWM_FREQ_HZ, SERVO_PWM_RES_BITS);
  if (ok) {
    ledcWrite(SERVO_PIN, 0);
    servoPwmAttached = true;
    Serial.printf("[SERVO] LEDC 50.000Hz 16-bit PWM attached on GPIO %d\n", SERVO_PIN);
  } else {
    Serial.printf("[SERVO] ERROR: ledcAttach failed on GPIO %d!\n", SERVO_PIN);
  }
#else
  ledcSetup(SERVO_LEDC_CHANNEL, SERVO_PWM_FREQ_HZ, SERVO_PWM_RES_BITS);
  ledcAttachPin(SERVO_PIN, SERVO_LEDC_CHANNEL);
  ledcWrite(SERVO_LEDC_CHANNEL, 0);
  servoPwmAttached = true;
#endif
#endif
}

void servoWritePulseUs(int pulseUs) {
#if SERVO_ENABLED
  servoAttachPwm();
  if (!servoPwmAttached) return;
  uint32_t duty = servoPulseUsToDuty(pulseUs);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(SERVO_PIN, duty);
#else
  ledcWrite(SERVO_LEDC_CHANNEL, duty);
#endif
#else
  (void)pulseUs;
#endif
}

void servoIdleLow() {
#if SERVO_ENABLED
  if (servoPwmAttached) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWrite(SERVO_PIN, 0);
#else
    ledcWrite(SERVO_LEDC_CHANNEL, 0);
#endif
  } else {
    pinMode(SERVO_PIN, OUTPUT);
    digitalWrite(SERVO_PIN, LOW);
  }
#endif
}

void persistTrayOpenState(bool isOpen) {
  trayState = isOpen ? TRAY_ST_OPEN : TRAY_ST_CLOSED;
  setTrayFaultReason("");
  if (trayPrefs.begin("edustride_tray", false)) {
    trayPrefs.putBool("extended", isOpen);
    trayPrefs.end();
  }
}

void saveTrayConfigToNvs(const TrayConfig& cfg) {
  if (trayPrefs.begin("edustride_tray", false)) {
    trayPrefs.putBool("enabled", cfg.enabled);
    trayPrefs.putUChar("mode", cfg.mode);
    trayPrefs.putBool("invert", cfg.invertDirection);
    trayPrefs.putInt("speed_pct", cfg.speedPct);
    trayPrefs.putInt("stop_us", cfg.stopUs);
    trayPrefs.putInt("open_ms", cfg.openMs);
    trayPrefs.putInt("close_ms", cfg.closeMs);
    trayPrefs.putInt("ang_closed", cfg.closedAngle);
    trayPrefs.putInt("ang_open", cfg.openAngle);
    trayPrefs.putInt("sweep_dps", cfg.sweepSpeedDps);
    trayPrefs.putInt("max_run_ms", cfg.maxRunMs);
    trayPrefs.putBool("auto_home", cfg.autoHomeOnBoot);
    trayPrefs.end();
  }
}

void applyIncomingTrayConfigIfNeeded() {
  if (!hasIncomingTrayCfg) return;
  TrayConfig nextCfg = trayCfg;
  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(15)) == pdTRUE) {
    nextCfg = pendingTrayCfg;
    hasIncomingTrayCfg = false;
    xSemaphoreGive(stateMutex);
  } else {
    return;
  }

  bool changed = (
    nextCfg.enabled != trayCfg.enabled ||
    nextCfg.mode != trayCfg.mode ||
    nextCfg.invertDirection != trayCfg.invertDirection ||
    nextCfg.speedPct != trayCfg.speedPct ||
    nextCfg.stopUs != trayCfg.stopUs ||
    nextCfg.openMs != trayCfg.openMs ||
    nextCfg.closeMs != trayCfg.closeMs ||
    nextCfg.closedAngle != trayCfg.closedAngle ||
    nextCfg.openAngle != trayCfg.openAngle ||
    nextCfg.sweepSpeedDps != trayCfg.sweepSpeedDps ||
    nextCfg.maxRunMs != trayCfg.maxRunMs ||
    nextCfg.autoHomeOnBoot != trayCfg.autoHomeOnBoot
  );
  if (!changed) return;

  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    trayCfg = nextCfg;
    xSemaphoreGive(stateMutex);
  } else {
    trayCfg = nextCfg;
  }
  saveTrayConfigToNvs(trayCfg);
  Serial.printf("[SERVO] Live config synced: mode=%s en=%d spd=%d%% stop=%d open=%dms close=%dms ang=%d..%d max=%dms inv=%d\n",
                trayModeToStr(trayCfg.mode), trayCfg.enabled ? 1 : 0, trayCfg.speedPct, trayCfg.stopUs,
                trayCfg.openMs, trayCfg.closeMs, trayCfg.closedAngle, trayCfg.openAngle,
                trayCfg.maxRunMs, trayCfg.invertDirection ? 1 : 0);
}

void clearPendingTrayCmdAck() {
  trayActiveCmdId = "";
  trayActiveCmdAction = "";
  trayActiveCmdSlot = 0;
  commandInProgress = false;
}

void finishTrayCmdAck(bool ok, const String& msg) {
  if (trayActiveCmdId.length() > 0 && trayActiveCmdAction.length() > 0) {
    String act = trayActiveCmdAction;
    String cid = trayActiveCmdId;
    int sl = trayActiveCmdSlot;
    trayActiveCmdId = "";
    trayActiveCmdAction = "";
    trayActiveCmdSlot = 0;
    sendCommandAck(act, ok ? "COMPLETED" : "FAILED", sl, msg, cid, ok ? "DONE" : "FAILED", ok ? 100 : 0);
  }
  commandInProgress = false;
}

void servoEmergencyStop(const char* reason = "") {
#if SERVO_ENABLED
  bool wasMoving = isTrayMoving();
  trayPendingRetractAfterLift = false;
  trayBraking = false;
  trayBrakeUntilMs = 0;
  trayBrakeBeepError = false;
  trayBrakeBeepNotice = false;
  trayPendingAckReady = false;
  trayPendingAckMsg = "";
  trayActiveCmdId = "";
  trayActiveCmdAction = "";
  trayActiveCmdSlot = 0;
  commandInProgress = false;
  if (servoPwmAttached && trayCfg.mode != TRAY_MODE_ANGLE_180) {
    servoWritePulseUs(trayCfg.stopUs);
    delay(40);
  }
  servoIdleLow();
  servoMoving = false;
  if (wasMoving || trayState == TRAY_ST_EXTENDING || trayState == TRAY_ST_RETRACTING || trayState == TRAY_ST_HOMING) {
    trayState = TRAY_ST_STOPPED;
  }
  if (reason && reason[0] != '\0') {
    Serial.printf("[SERVO] Emergency stop: %s\n", reason);
  }
#else
  (void)reason;
#endif
}

void initServoTrayHardware() {
#if SERVO_ENABLED
  servoPwmAttached = false;
  servoAttachPwm();
  servoIdleLow();

  // Always configure mouse microswitch inputs (active in ALL modes for live switch testing!)
  pinMode(SERVO_LIMIT_CLOSED_PIN, SERVO_LIMIT_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  pinMode(SERVO_LIMIT_OPEN_PIN, SERVO_LIMIT_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  delay(10);
  swClosedRawPrev = readRawSwitchClosed();
  swClosedPressed = swClosedRawPrev;
  swOpenRawPrev = readRawSwitchOpen();
  swOpenPressed = swOpenRawPrev;

  bool savedOpen = false;
  if (trayPrefs.begin("edustride_tray", true)) {
    trayCfg.enabled = trayPrefs.getBool("enabled", SERVO_ENABLED);
    trayCfg.mode = trayPrefs.getUChar("mode", SERVO_DEFAULT_MODE);
    if (trayCfg.mode > TRAY_MODE_ANGLE_180) trayCfg.mode = SERVO_DEFAULT_MODE;
    trayCfg.invertDirection = trayPrefs.getBool("invert", SERVO_INVERT_DIRECTION);
    trayCfg.speedPct = constrain(trayPrefs.getInt("speed_pct", SERVO_SPEED_PCT), 20, 100);
    trayCfg.stopUs = constrain(trayPrefs.getInt("stop_us", SERVO_STOP_US), 1350, 1650);
    trayCfg.openMs = constrain(trayPrefs.getInt("open_ms", SERVO_OPEN_MS), 100, 8000);
    trayCfg.closeMs = constrain(trayPrefs.getInt("close_ms", SERVO_CLOSE_MS), 100, 8000);
    trayCfg.closedAngle = constrain(trayPrefs.getInt("ang_closed", SERVO_CLOSED_ANGLE), 0, 180);
    trayCfg.openAngle = constrain(trayPrefs.getInt("ang_open", SERVO_OPEN_ANGLE), 0, 180);
    trayCfg.sweepSpeedDps = constrain(trayPrefs.getInt("sweep_dps", SERVO_SWEEP_DPS), 30, 360);
    trayCfg.maxRunMs = constrain(trayPrefs.getInt("max_run_ms", SERVO_MAX_RUN_MS), 500, 15000);
    trayCfg.autoHomeOnBoot = trayPrefs.getBool("auto_home", SERVO_AUTO_HOME_ON_BOOT);
    savedOpen = trayPrefs.getBool("extended", false);
    trayPrefs.end();
  }

  // Real physical mouse switches override saved NVS state if pressed!
  if (swClosedPressed && !swOpenPressed) {
    trayState = TRAY_ST_CLOSED;
  } else if (swOpenPressed && !swClosedPressed) {
    trayState = TRAY_ST_OPEN;
  } else {
    trayState = savedOpen ? TRAY_ST_OPEN : TRAY_ST_CLOSED;
  }
  trayAngleCur = (trayState == TRAY_ST_OPEN) ? (float)trayCfg.openAngle : (float)trayCfg.closedAngle;

  Serial.printf("[SERVO] v3.0 Ready (GPIO %d, mode=%s, state=%s, swClosed=%d swOpen=%d)\n",
                SERVO_PIN, trayModeToStr(trayCfg.mode), trayStateToApiString(trayState),
                swClosedPressed ? 1 : 0, swOpenPressed ? 1 : 0);
#else
  trayCfg.enabled = false;
  trayState = TRAY_ST_OPEN;
  Serial.println("[SERVO] Disabled in config.h (SERVO_ENABLED = false).");
#endif
}

void drawTrayMotionOled(int pct) {
  if (!oledReady) return;
  const char* title = "MOVING TRAY";
  if (trayState == TRAY_ST_EXTENDING || trayState == TRAY_ST_NUDGING_OPEN) title = "EXTENDING TRAY";
  else if (trayState == TRAY_ST_RETRACTING || trayState == TRAY_ST_NUDGING_CLOSE) title = "RETRACTING TRAY";
  else if (trayState == TRAY_ST_HOMING) title = "HOMING TRAY";

  String line3 = String("Mode: ") + trayModeToStr(trayCfg.mode);
  String line4 = "SW C:" + String(swClosedPressed ? "1" : "0") + " O:" + String(swOpenPressed ? "1" : "0") + "  " + String(constrain(pct, 0, 100)) + "%";
  showOledStatus(title, trayActiveSubtitle, line3, line4);
}

void beginTrayDrive(TrayState motionState, int pulseUs, unsigned long durationMs, const char* subtitle, bool beepOnDone) {
  // Briefly wait for any Core 0 HTTPS burst to clear so 5V/3.3V rails stay rock-solid
  unsigned long waitStart = millis();
  while (wifiBusy && millis() - waitStart < 1200UL) {
    delay(15);
  }
  servoMoving = true;
  trayBraking = false;
  trayBrakeUntilMs = 0;
  trayBrakeBeepError = false;
  trayBrakeBeepNotice = false;
  trayState = motionState;
  trayMotionPulseUs = pulseUs;
  trayMotionDurationUs = (int64_t)durationMs * 1000LL;
  trayMotionStartUs = esp_timer_get_time();
  trayActiveSubtitle = (subtitle && subtitle[0] != '\0') ? String(subtitle) : String("Motorized Tray");
  trayMotionBeepOnFinish = beepOnDone;
  trayLastOledMs = 0;

  if (trayCfg.mode == TRAY_MODE_ANGLE_180 && (motionState == TRAY_ST_EXTENDING || motionState == TRAY_ST_RETRACTING || motionState == TRAY_ST_HOMING)) {
    trayAngleStart = trayAngleCur;
    trayAngleTarget = (motionState == TRAY_ST_EXTENDING) ? (float)trayCfg.openAngle : (float)trayCfg.closedAngle;
    float diff = fabs(trayAngleTarget - trayAngleStart);
    unsigned long sweepMs = (unsigned long)((diff * 1000.0f) / (float)max(30, trayCfg.sweepSpeedDps));
    if (sweepMs < 180UL) sweepMs = 180UL;
    trayMotionDurationUs = (int64_t)sweepMs * 1000LL;
    servoWritePulseUs(angleToPulseUs(trayAngleStart));
  } else {
    servoWritePulseUs(pulseUs);
  }
  drawTrayMotionOled(0);
}

bool startTrayExtend(const char* subtitle = "Scanner Activated", bool forceMove = false, bool beepOnDone = false) {
#if !SERVO_ENABLED
  (void)subtitle; (void)forceMove; (void)beepOnDone;
  trayState = TRAY_ST_OPEN;
  return false;
#else
  if (!trayCfg.enabled && !forceMove) return false;
  trayPendingRetractAfterLift = false;
  setTrayFaultReason("");

  if (trayCfg.mode == TRAY_MODE_LIMIT_360) {
    if (swClosedPressed && swOpenPressed) {
      String errMsg = "Both limit switches active — check wiring!";
      setTrayFaultReason(errMsg.c_str());
      trayState = TRAY_ST_FAULT;
      showOledStatus("TRAY FAULT!", "Both switches ON", "Check GPIO 26/27", "wiring/polarity");
      beepError();
      setMessageHold(3200);
      finishTrayCmdAck(false, errMsg);
      return false;
    }
    if (swOpenPressed) {
      persistTrayOpenState(true);
      Serial.println("[SERVO] Already at OPEN mouse switch.");
      return false;
    }
    beginTrayDrive(TRAY_ST_EXTENDING, get360PulseForDirection(true), (unsigned long)trayCfg.maxRunMs, subtitle, beepOnDone);
    return true;
  }
  if (trayCfg.mode == TRAY_MODE_ANGLE_180) {
    if (!forceMove && trayState == TRAY_ST_OPEN) return false;
    beginTrayDrive(TRAY_ST_EXTENDING, angleToPulseUs(trayCfg.openAngle), 600, subtitle, beepOnDone);
    return true;
  }
  // TIMED_360
  if (!forceMove && trayState == TRAY_ST_OPEN) return false;
  if (swOpenPressed && !swClosedPressed) {
    persistTrayOpenState(true);
    return false;
  }
  beginTrayDrive(TRAY_ST_EXTENDING, get360PulseForDirection(true), (unsigned long)trayCfg.openMs, subtitle, beepOnDone);
  return true;
#endif
}

bool startTrayRetract(const char* subtitle = "Scanner Paused", bool forceMove = false, bool beepOnDone = false, bool isHoming = false, bool skipPinchCheck = false) {
#if !SERVO_ENABLED
  (void)subtitle; (void)forceMove; (void)beepOnDone; (void)isHoming; (void)skipPinchCheck;
  trayState = TRAY_ST_CLOSED;
  return false;
#else
  if (!trayCfg.enabled && !forceMove && !isHoming) return false;
  setTrayFaultReason("");

  // Anti-pinch check: if a student's finger is on the R307S glass, wait briefly before closing!
#if FP_USE_TOUCH_PIN
  if (!isHoming && !skipPinchCheck && sensorReady && touchPinTriggered() && !trayPendingRetractAfterLift) {
    trayPendingRetractAfterLift = true;
    trayFingerWaitStartMs = millis();
    trayActiveSubtitle = (subtitle && subtitle[0] != '\0') ? String(subtitle) : String("Closing cabinet");
    trayMotionBeepOnFinish = beepOnDone;
    showOledStatus("REMOVE FINGER", "Closing scanner", "Lift finger to", "retract tray...");
    beepNotice();
    return true;
  }
#endif
  trayPendingRetractAfterLift = false;

  // ANGLE_180: smooth sweep to closedAngle for BOTH normal retract and TRAY_HOME (never seek limit switches!)
  if (trayCfg.mode == TRAY_MODE_ANGLE_180) {
    if (!forceMove && !isHoming && trayState == TRAY_ST_CLOSED) return false;
    beginTrayDrive(isHoming ? TRAY_ST_HOMING : TRAY_ST_RETRACTING, angleToPulseUs(trayCfg.closedAngle), 600, subtitle, beepOnDone);
    return true;
  }

  // LIMIT_360: seek CLOSED mouse switch up to maxRunMs
  if (trayCfg.mode == TRAY_MODE_LIMIT_360) {
    if (swClosedPressed && swOpenPressed) {
      String errMsg = "Both limit switches active — check wiring!";
      setTrayFaultReason(errMsg.c_str());
      trayState = TRAY_ST_FAULT;
      showOledStatus("TRAY FAULT!", "Both switches ON", "Check GPIO 26/27", "wiring/polarity");
      beepError();
      setMessageHold(3200);
      finishTrayCmdAck(false, errMsg);
      return false;
    }
    if (swClosedPressed) {
      persistTrayOpenState(false);
      Serial.println("[SERVO] Already at CLOSED mouse switch.");
      return false;
    }
    beginTrayDrive(isHoming ? TRAY_ST_HOMING : TRAY_ST_RETRACTING, get360PulseForDirection(false), (unsigned long)trayCfg.maxRunMs, subtitle, beepOnDone);
    return true;
  }

  // TIMED_360: always use closeMs (even on TRAY_HOME!) so plastic gears never grind for full maxRunMs
  if (!forceMove && !isHoming && trayState == TRAY_ST_CLOSED) return false;
  if (swClosedPressed && !swOpenPressed) {
    persistTrayOpenState(false);
    return false;
  }
  beginTrayDrive(isHoming ? TRAY_ST_HOMING : TRAY_ST_RETRACTING, get360PulseForDirection(false), (unsigned long)trayCfg.closeMs, subtitle, beepOnDone);
  return true;
#endif
}

bool startTrayNudge(bool outward, int durationMs) {
#if !SERVO_ENABLED
  (void)outward; (void)durationMs;
  return false;
#else
  if (trayCfg.mode == TRAY_MODE_ANGLE_180) {
    float step = outward ? 10.0f : -10.0f;
    trayAngleCur = constrain(trayAngleCur + step, 0.0f, 180.0f);
    servoWritePulseUs(angleToPulseUs(trayAngleCur));
    delay(220);
    servoIdleLow();
    return false;
  }
  if (outward && swOpenPressed) return false;
  if (!outward && swClosedPressed) return false;
  int ms = constrain(durationMs, 50, 3000);
  beginTrayDrive(
    outward ? TRAY_ST_NUDGING_OPEN : TRAY_ST_NUDGING_CLOSE,
    get360PulseForDirection(outward),
    (unsigned long)ms,
    outward ? "Nudge Out" : "Nudge In",
    false
  );
  return true;
#endif
}

void completeTrayMotion(TrayState finalState, bool ok, const String& ackMsg) {
  bool is360 = (trayCfg.mode != TRAY_MODE_ANGLE_180);
  if (is360) {
    // Non-blocking 80ms neutral brake, then servoIdleLow() & deferred ACK (zero Wi-Fi/servo overlap!)
    servoWritePulseUs(trayCfg.stopUs);
    trayBrakeUntilMs = millis() + 80UL;
  } else {
    // Give 180° horn 150ms to reach final angle cleanly before idling PWM
    trayBrakeUntilMs = millis() + 150UL;
  }
  trayBraking = true;
  trayBrakeBeepError = !ok;
  trayBrakeBeepNotice = ok && trayMotionBeepOnFinish;

  if (finalState == TRAY_ST_OPEN) {
    persistTrayOpenState(true);
    trayAngleCur = (float)trayCfg.openAngle;
  } else if (finalState == TRAY_ST_CLOSED) {
    persistTrayOpenState(false);
    trayAngleCur = (float)trayCfg.closedAngle;
  } else {
    trayState = finalState;
  }

  if (!ok) {
    setTrayFaultReason(ackMsg.c_str());
    showOledStatus("TRAY FAULT!", ackMsg.substring(0, 20), "Check switch/jam", "Tap Home in App");
    setMessageHold(3200);
  } else {
    clearMessageHold();
    showIdleScreen();
  }

  // Defer HTTP ACK & finish beep until after brake completes and PWM is 100% idle LOW
  trayPendingAckReady = true;
  trayPendingAckOk = ok;
  trayPendingAckMsg = ackMsg;
}

void tickServoTray() {
#if !SERVO_ENABLED
  return;
#else
  unsigned long now = millis();

  // 1. Handle non-blocking post-motion brake / settle release, then fire deferred beep & command ACK cleanly
  if (trayBraking) {
    if (deadlineReached(now, trayBrakeUntilMs)) {
      trayBraking = false;
      trayBrakeUntilMs = 0;
      servoIdleLow();
      servoMoving = false;
      traySettledActive = true;
      traySettledUntilMs = millis() + 450UL; // Let R307S capacitive touch pad settle after servo stops
      bool doErrBeep = trayBrakeBeepError;
      bool doNoticeBeep = trayBrakeBeepNotice;
      trayBrakeBeepError = false;
      trayBrakeBeepNotice = false;
      if (doErrBeep) beepError();
      else if (doNoticeBeep) beepNotice();
      if (trayPendingAckReady) {
        trayPendingAckReady = false;
        String msg = trayPendingAckMsg;
        bool ok = trayPendingAckOk;
        trayPendingAckMsg = "";
        finishTrayCmdAck(ok, msg);
      }
    }
    return;
  }

  // 2. Handle non-blocking anti-pinch finger-lift wait before retracting (never loops infinitely!)
  if (trayPendingRetractAfterLift) {
#if FP_USE_TOUCH_PIN
    bool fingerStillOn = (sensorReady && touchPinTriggered());
#else
    bool fingerStillOn = false;
#endif
    if (!fingerStillOn) {
      trayPendingRetractAfterLift = false;
      if (!startTrayRetract(trayActiveSubtitle.c_str(), true, trayMotionBeepOnFinish, false, true)) {
        if (trayState != TRAY_ST_FAULT) {
          finishTrayCmdAck(true, "Tray already at CLOSED position.");
          clearMessageHold();
          showIdleScreen();
        }
      }
    } else if (now - trayFingerWaitStartMs >= 2500UL) {
      trayPendingRetractAfterLift = false;
      // Check optically if the touch pin merely drifted (moisture/humidity) vs. a real finger on the prism
      if (sensorReady && finger.getImage() == FINGERPRINT_NOFINGER) {
#if FP_USE_TOUCH_PIN
        touchIdleLevel = digitalRead(FP_TOUCH_PIN);
        Serial.printf("[R307S] Auto-recalibrated drifted touch pin before retract (idle=%s)\n", touchIdleLevel == HIGH ? "HIGH" : "LOW");
#endif
        if (!startTrayRetract(trayActiveSubtitle.c_str(), true, trayMotionBeepOnFinish, false, true)) {
          if (trayState != TRAY_ST_FAULT) {
            finishTrayCmdAck(true, "Tray already at CLOSED position.");
            clearMessageHold();
            showIdleScreen();
          }
        }
      } else {
        // Real finger is still resting on the glass after 2.5s — abort retract safely to prevent pinching!
        String msg = "Anti-pinch: finger still on sensor after 2.5s — retract cancelled safely.";
        Serial.println("[SERVO] " + msg);
        showOledStatus("RETRACT PAUSED", "Finger detected!", "Remove finger &", "retry close");
        beepError();
        setMessageHold(2800);
        finishTrayCmdAck(false, msg);
      }
    }
    return;
  }

  TrayState st = trayState;
  bool activelyMoving = (
    st == TRAY_ST_EXTENDING ||
    st == TRAY_ST_RETRACTING ||
    st == TRAY_ST_HOMING ||
    st == TRAY_ST_NUDGING_OPEN ||
    st == TRAY_ST_NUDGING_CLOSE
  );
  if (!activelyMoving) return;

  int64_t elapsedUs = esp_timer_get_time() - trayMotionStartUs;

  // 3. Instant mouse-switch stop check (works in LIMIT_360 AND as bonus hardware safety in TIMED_360!)
  if (trayCfg.mode != TRAY_MODE_ANGLE_180) {
    if ((st == TRAY_ST_EXTENDING || st == TRAY_ST_NUDGING_OPEN) && swOpenPressed) {
      Serial.printf("[SERVO] OPEN mouse switch triggered at %lldms!\n", elapsedUs / 1000LL);
      completeTrayMotion(TRAY_ST_OPEN, true, "Tray reached OPEN switch (" + String((long)(elapsedUs / 1000LL)) + "ms).");
      return;
    }
    if ((st == TRAY_ST_RETRACTING || st == TRAY_ST_HOMING || st == TRAY_ST_NUDGING_CLOSE) && swClosedPressed) {
      Serial.printf("[SERVO] CLOSED mouse switch triggered at %lldms!\n", elapsedUs / 1000LL);
      completeTrayMotion(TRAY_ST_CLOSED, true, "Tray reached CLOSED switch (" + String((long)(elapsedUs / 1000LL)) + "ms).");
      return;
    }
  }

  // 4. Smooth angular sweep update for 180° positional servos
  if (trayCfg.mode == TRAY_MODE_ANGLE_180 && (st == TRAY_ST_EXTENDING || st == TRAY_ST_RETRACTING || st == TRAY_ST_HOMING)) {
    float frac = (trayMotionDurationUs > 0) ? min(1.0f, (float)elapsedUs / (float)trayMotionDurationUs) : 1.0f;
    float desired = trayAngleStart + (trayAngleTarget - trayAngleStart) * frac;
    if (fabs(desired - trayAngleCur) >= 0.8f || frac >= 1.0f) {
      trayAngleCur = desired;
      servoWritePulseUs(angleToPulseUs(trayAngleCur));
    }
  }

  // 5. Refresh OLED progress screen calmly every 140ms (zero I2C lag!)
  if (now - trayLastOledMs >= 140UL) {
    trayLastOledMs = now;
    int pct = (trayMotionDurationUs > 0) ? (int)((elapsedUs * 100LL) / trayMotionDurationUs) : 100;
    drawTrayMotionOled(pct);
  }

  // 6. Check deadline completion or LIMIT_360 jam fault timeout
  if (elapsedUs >= trayMotionDurationUs) {
    if (st == TRAY_ST_NUDGING_OPEN || st == TRAY_ST_NUDGING_CLOSE) {
      TrayState restored = swOpenPressed ? TRAY_ST_OPEN : (swClosedPressed ? TRAY_ST_CLOSED : TRAY_ST_STOPPED);
      completeTrayMotion(restored, true, String("Nudge ") + (st == TRAY_ST_NUDGING_OPEN ? "OUT" : "IN") + " complete (" + String((long)(trayMotionDurationUs / 1000LL)) + "ms).");
      return;
    }
    if (trayCfg.mode == TRAY_MODE_LIMIT_360) {
      // Safety cutoff: mouse switch did NOT click within max_run_ms!
      String side = (st == TRAY_ST_EXTENDING) ? "OPEN" : "CLOSED";
      String errMsg = side + " switch not hit in " + String(trayCfg.maxRunMs) + "ms";
      Serial.printf("[SERVO] FAULT: %s\n", errMsg.c_str());
      completeTrayMotion(TRAY_ST_FAULT, false, errMsg);
      return;
    }
    // TIMED_360 or ANGLE_180 reached target cleanly
    bool endedOpen = (st == TRAY_ST_EXTENDING);
    completeTrayMotion(
      endedOpen ? TRAY_ST_OPEN : TRAY_ST_CLOSED,
      true,
      String("Tray ") + (endedOpen ? "OPEN" : "CLOSED") + " (" + String(trayModeToStr(trayCfg.mode)) + ")."
    );
  }
#endif
}

// Helper for remote ENROLL: pumps non-blocking FSM cleanly until tray finishes moving
void waitTrayMotionComplete(unsigned long maxWaitMs) {
  unsigned long start = millis();
  while (isTrayMoving() && (millis() - start < maxWaitMs)) {
    pollTraySwitches();
    tickServoTray();
    if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
    delay(2);
  }
}

void printServoStatusToSerial() {
  Serial.println("----- SERVO TRAY v3.0 STATUS -----");
  Serial.printf("Enabled:        %s | Mode: %s | State: %s\n",
                trayCfg.enabled ? "YES" : "NO", trayModeToStr(trayCfg.mode), trayStateToApiString(trayState));
  Serial.printf("Signal Pin:     GPIO %d (16-bit 50.000Hz LEDC)\n", SERVO_PIN);
  Serial.printf("Mouse Switches: CLOSED(GPIO %d)=%s | OPEN(GPIO %d)=%s\n",
                SERVO_LIMIT_CLOSED_PIN, swClosedPressed ? "PRESSED" : "open",
                SERVO_LIMIT_OPEN_PIN, swOpenPressed ? "PRESSED" : "open");
  Serial.printf("360 Settings:   speed=%d%% stop=%dus open=%dms close=%dms maxRun=%dms invert=%s\n",
                trayCfg.speedPct, trayCfg.stopUs, trayCfg.openMs, trayCfg.closeMs,
                trayCfg.maxRunMs, trayCfg.invertDirection ? "true" : "false");
  Serial.printf("180 Settings:   closed=%ddeg open=%ddeg sweep=%ddps cur=%.1fdeg\n",
                trayCfg.closedAngle, trayCfg.openAngle, trayCfg.sweepSpeedDps, trayAngleCur);
  if (trayFaultMsg[0] != '\0') {
    Serial.printf("Fault:          %s\n", trayFaultMsg);
  }
  Serial.println("----------------------------------");
}

void processSerialCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  String lower = cmd;
  lower.toLowerCase();

  if (lower == "help" || lower == "?") {
    Serial.println("EduStride Motorized Tray v3.0 CLI (115200 baud):");
    Serial.println("  servo status                 -> Show mode, state, live mouse switches & config");
    Serial.println("  servo open                   -> Extend tray (non-blocking)");
    Serial.println("  servo close                  -> Retract tray (non-blocking)");
    Serial.println("  servo home                   -> Home to CLOSED mouse switch & clear FAULT");
    Serial.println("  servo stop                   -> Immediate EMERGENCY STOP");
    Serial.println("  servo nudge open <ms>        -> Nudge outward for <ms>");
    Serial.println("  servo nudge close <ms>       -> Nudge inward for <ms>");
    Serial.println("  servo state open|closed      -> Sync saved NVS state without moving motor");
    Serial.println("  servo pulse <us> <ms>        -> Raw test pulse (500..2500us) for <ms>");
    return;
  }

  if (lower == "servo status") {
    printServoStatusToSerial();
  } else if (lower == "servo stop") {
    servoEmergencyStop("Serial CLI");
    finishTrayCmdAck(true, "Stopped via Serial CLI.");
    showIdleScreen();
  } else if (lower == "servo open") {
    startTrayExtend("Serial Test", true, true);
  } else if (lower == "servo close") {
    startTrayRetract("Serial Test", true, true, false);
  } else if (lower == "servo home") {
    startTrayRetract("Serial Homing", true, true, true);
  } else if (lower == "servo state open") {
    persistTrayOpenState(true);
    Serial.println("[SERVO] Saved state = OPEN (no motion).");
  } else if (lower == "servo state closed") {
    persistTrayOpenState(false);
    Serial.println("[SERVO] Saved state = CLOSED (no motion).");
  } else if (lower.startsWith("servo nudge open ")) {
    int ms = constrain(lower.substring(17).toInt(), 50, 3000);
    startTrayNudge(true, ms);
  } else if (lower.startsWith("servo nudge close ")) {
    int ms = constrain(lower.substring(18).toInt(), 50, 3000);
    startTrayNudge(false, ms);
  } else if (lower.startsWith("servo pulse ")) {
    String rest = lower.substring(12);
    rest.trim();
    int sp = rest.indexOf(' ');
    int us = constrain((sp > 0) ? rest.substring(0, sp).toInt() : rest.toInt(), 500, 2500);
    int ms = constrain((sp > 0) ? rest.substring(sp + 1).toInt() : 1000, 50, 5000);
    Serial.printf("[SERVO] Raw pulse %dus for %dms...\n", us, ms);
    servoWritePulseUs(us);
    delay(ms);
    servoIdleLow();
    Serial.println("[SERVO] Raw pulse done.");
  } else {
    Serial.printf("[CLI] Unknown command '%s'. Type 'help' for tray commands.\n", cmd.c_str());
  }
}

void handleSerialCommands() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      processSerialCommand(serialCmdBuffer);
      serialCmdBuffer = "";
    } else if (serialCmdBuffer.length() < 80) {
      serialCmdBuffer += c;
    }
  }
}

// ============================================================================
// WI-FI & WIRELESS OTA (ArduinoOTA — NEVER touches R307S LED!)
// ============================================================================
int otaLastPct = -1;

void initOtaIfReady() {
  if (otaInitialized || WiFi.status() != WL_CONNECTED) return;

  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPort(OTA_PORT);
  if (String(OTA_PASSWORD).length() > 0) ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    otaInProgress = true;
    otaLastPct = -1;
    servoEmergencyStop();
    buzzerOff();
    // Wait for any in-flight Core 0 mbedTLS/HTTP request to finish and close sockets before flashing SPI flash
    if (netMutex && xSemaphoreTake(netMutex, pdMS_TO_TICKS(4000)) == pdTRUE) {
      sharedSecureClient.stop();
      tlsConfigured = false;
      sharedPlainClient.stop();
      xSemaphoreGive(netMutex);
    }
    if (oledReady) display.ssd1306_command(SSD1306_DISPLAYON);
    showOledStatus("WI-FI OTA UPDATE", "Receiving firmware", "Do NOT unplug power!", "Progress: 0%");
  });

  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    int pct = total > 0 ? (int)((progress * 100U) / total) : 0;
    if (pct != otaLastPct && (pct % 5 == 0 || pct == 100)) {
      otaLastPct = pct;
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
    wifiReconnectFailures = 0;
    initOtaIfReady();
    return;
  }

  if (!wifiEventsRegistered) {
    WiFi.onEvent(onWifiEvent);
    wifiEventsRegistered = true;
  }

  // During normal loop(), NEVER block Core 1 or beep — keep offline scanning 100% responsive!
  if (!isBoot) {
    wifiReconnectFailures++;
    if (wifiReconnectFailures >= 3) {
      wifiReconnectFailures = 0;
      Serial.println("[WIFI] Reconnect stalled — performing full non-blocking WiFi.begin() reset...");
      WiFi.disconnect(false, false);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    } else {
      Serial.println("[WIFI] Offline — issuing non-blocking WiFi.reconnect()...");
      WiFi.reconnect();
    }
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

void enterDeviceStandbyNow() {
  standbyWaitingRetract = false;
  deviceInStandby = true;
  buzzerOff();
  clearMessageHold();
  if (sensorReady && !scanInProgress && !commandInProgress) {
    // Ensure R307S optical prism LED finishes in its auto-OFF idle state
    finger.getImage();
  }
  if (oledReady) {
    display.clearDisplay();
    display.display();
    display.ssd1306_command(SSD1306_DISPLAYOFF);
  }
  WiFi.setSleep(true);
  Serial.println("[POWER] Entered STANDBY (OLED OFF, tray closed, scanner disabled, low-power Wi-Fi).");
}

void wakeDeviceFromStandby() {
  standbyWaitingRetract = false;
  deviceInStandby = false;
  WiFi.setSleep(false);
  nextBlinkMs = millis() + 2000UL;
  nextBehaviorMs = millis() + 3000UL;
  if (oledReady) {
    display.ssd1306_command(SSD1306_DISPLAYON);
  }
  Serial.println("[POWER] Waking up from STANDBY...");
  beepEntry();
  playBootAnimation();
  prevSensingObserved = sensingEnabled;
  if (sensingEnabled) {
    if (!startTrayExtend("Device Powered ON", false, false)) {
      showIdleScreen();
    }
  } else {
    showIdleScreen();
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n=== EduStride Gate Scanner %s ===\n", FIRMWARE_VERSION);

  // Persist monotonic boot counter in NVS so scan_id NEVER collides across power cycles
  {
    Preferences sysPrefs;
    if (sysPrefs.begin("edustride_sys", false)) {
      bootCounter = sysPrefs.getUInt("boot_cnt", 0) + 1;
      sysPrefs.putUInt("boot_cnt", bootCounter);
      sysPrefs.end();
    }
  }
  bootNonce = esp_random();

  // Pre-set inactive buzzer level before enabling output to avoid boot chirp on active-LOW modules
  buzzerOff();
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerOff();

  // Initialize motorized tray hardware safely (PWM stays detached until first server heartbeat!)
  initServoTrayHardware();

  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  Wire.setClock(400000);
  Wire.setTimeOut(50);
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

  // Configure UART2 with explicit custom pins and verify sensor directly (never call finger.begin() afterward!)
  fpSerial.begin(FP_BAUD_RATE, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  delay(300);

  if (!initR307Sensor()) {
    Serial.println("[R307S] Sensor NOT detected! Check 5V->VIN, GND, TXD->16, RXD->17.");
    showOledStatus("R307S NOT FOUND", "Check sensor wires", "5V->VIN  GND->GND", "TXD->16  RXD->17");
    beepError();
    delay(2500);
  }
#if FP_USE_TOUCH_PIN
  // Calibrate after R307S power-up & init (~600ms+ settled) so capacitive baseline is accurate
  calibrateTouchPin();
#endif

  ensureWifiConnected(true);
  // Re-seed bootNonce now that Wi-Fi RF hardware RNG entropy is active
  bootNonce ^= esp_random();
  pollServerStatus();
  applyIncomingTrayConfigIfNeeded();
  prevSensingObserved = sensingEnabled;
  if (!firstHeartbeatSynced) {
    Serial.println("[SERVO] Waiting for first server heartbeat before moving tray.");
  }

  // 16 KB stack on Core 0 matches Core 1 (SET_LOOP_TASK_STACK_SIZE) for safe mbedTLS Root CA verification
  xTaskCreatePinnedToCore(heartbeatTask, "HeartbeatTask", 16384, nullptr, 1, nullptr, 0);

  nextBlinkMs = millis() + 2000;
  nextBehaviorMs = millis() + 3000;
  // Finish blocking boot animation BEFORE starting any tray motion so tickServoTray() & mouse switches never stall!
  playBootAnimation();
  showIdleScreen();
  Serial.println("[CLI] Type 'help' in Serial Monitor for Motorized Tray v3.0 commands.");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    initOtaIfReady();
    if (otaInitialized) ArduinoOTA.handle();
  }
  if (otaInProgress) { delay(5); return; }

  pollTraySwitches();
  handleSerialCommands();
  applyIncomingTrayConfigIfNeeded();
  tickServoTray();

  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED && now - lastWifiCheckMs >= 30000UL) {
    lastWifiCheckMs = now;
    ensureWifiConnected(false);
  }

  if (!sensorReady && now - lastSensorRetryMs >= 5000UL) {
    lastSensorRetryMs = now;
    if (initR307Sensor() && !isTrayMoving()) {
      sensorHealthMisses = 0;
      lastSensorHealthMs = now;
      showIdleScreen();
    }
  } else if (sensorReady && !deviceInStandby && !isTrayMoving() && !scanInProgress && !commandInProgress && now - lastSensorHealthMs >= 60000UL) {
    // Periodic silent UART liveness probe (never flashes optical LED) to detect runtime sensor disconnect
    lastSensorHealthMs = now;
    if (finger.verifyPassword()) {
      sensorHealthMisses = 0;
    } else if (++sensorHealthMisses >= 2) {
      sensorReady = false;
      sensorHealthMisses = 0;
      Serial.println("[R307S] Runtime health check failed — marking sensor offline for auto-recovery!");
      showIdleScreen();
    }
  }

  if (!isTrayMoving() && firstHeartbeatSynced && !trayBootSynced) {
    trayBootSynced = true;
    prevDevicePowerObserved = devicePowerOn;
    prevSensingObserved = sensingEnabled;
    if (!devicePowerOn) {
      if (trayState != TRAY_ST_CLOSED && trayCfg.enabled) {
        showOledStatus("POWERING OFF", "Standby Active", "Closing cabinet...", "");
        standbyWaitingRetract = true;
        if (!startTrayRetract("Standby Mode", false, false, false)) {
          enterDeviceStandbyNow();
        }
      } else {
        enterDeviceStandbyNow();
      }
    } else {
      bool started = false;
      if (trayCfg.mode == TRAY_MODE_LIMIT_360 && trayCfg.autoHomeOnBoot && !swClosedPressed && !sensingEnabled) {
        started = startTrayRetract("Boot Homing", true, false, true);
      } else if (sensingEnabled) {
        started = startTrayExtend("Scanner Ready", false, false);
      } else {
        started = startTrayRetract("Scanner Paused", false, false, false);
      }
      if (!started) {
        clearMessageHold();
        showIdleScreen();
      }
    }
  } else if (trayBootSynced && prevDevicePowerObserved != devicePowerOn) {
    prevDevicePowerObserved = devicePowerOn;
    if (!devicePowerOn) {
      Serial.println("[POWER] App requested POWER OFF (Standby)...");
      if (isTrayMoving()) servoEmergencyStop("Power OFF");
      showOledStatus("POWERING OFF", "Standby Mode", "Closing cabinet...", "Wake from App");
      beepExit();
      standbyWaitingRetract = true;
      if (trayState != TRAY_ST_CLOSED && trayCfg.enabled) {
        if (!startTrayRetract("Powering OFF", false, false, false)) {
          enterDeviceStandbyNow();
        }
      } else {
        delay(500);
        enterDeviceStandbyNow();
      }
    } else {
      wakeDeviceFromStandby();
    }
  } else if (standbyWaitingRetract && !isTrayMoving()) {
    enterDeviceStandbyNow();
  } else if (!deviceInStandby && !standbyWaitingRetract && !isTrayMoving() && prevSensingObserved != sensingEnabled) {
    prevSensingObserved = sensingEnabled;
    bool started = sensingEnabled
      ? startTrayExtend("Activated in App", false, true)
      : startTrayRetract("Paused in App", false, true, false);
    if (!started) {
      beepNotice();
      clearMessageHold();
      showIdleScreen();
    }
  }

  // Execute queued remote command safely on Core 1 (TRAY_STOP preempts even during motion!)
  String runCmdId = "", runAction = "NONE", runStudent = "";
  int runSlot = 0;
  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    if (hasQueuedCommand && (!isTrayMoving() || queuedCmdAction == "TRAY_STOP")) {
      runCmdId = queuedCmdId;
      runAction = queuedCmdAction;
      runSlot = queuedCmdSlot;
      runStudent = queuedCmdStudent;
      hasQueuedCommand = false;
      queuedCmdId = "";
      queuedCmdAction = "NONE";
      queuedCmdStudent = "";
    }
    xSemaphoreGive(stateMutex);
  }

  if (runAction != "NONE") {
    if (runAction == "REBOOT") {
      commandInProgress = true;
      servoEmergencyStop("Remote Reboot");
      if (oledReady) display.ssd1306_command(SSD1306_DISPLAYON);
      showOledStatus("REBOOTING...", "Remote restart", "Back online in", "~15 seconds");
      beepNotice();
      sendCommandAck("REBOOT", "COMPLETED", 0, "ESP32 restarting now...", runCmdId, "DONE", 100);
      delay(350);
      ESP.restart();
    } else if (runAction == "TRAY_STOP") {
      servoEmergencyStop("Remote App STOP");
      sendCommandAck("TRAY_STOP", "COMPLETED", 0, "Emergency STOP executed on ESP32.", runCmdId, "DONE", 100);
      if (!deviceInStandby) {
        showOledStatus("TRAY STOPPED", "Emergency Halt", "Motor idle", "");
        beepNotice();
        setMessageHold(1800);
      }
    } else if (deviceInStandby || !devicePowerOn) {
      sendCommandAck(runAction, "FAILED", runSlot, "Device is Powered OFF (Standby). Wake device in app first.", runCmdId, "STANDBY", 0);
    } else if (runAction == "TRAY_OPEN") {
      commandInProgress = true;
      trayActiveCmdId = runCmdId;
      trayActiveCmdAction = "TRAY_OPEN";
      trayActiveCmdSlot = 0;
      if (!startTrayExtend("App Test Open", true, true)) {
        if (trayState != TRAY_ST_FAULT) {
          finishTrayCmdAck(true, "Tray already at OPEN position.");
          showIdleScreen();
        }
      }
    } else if (runAction == "TRAY_CLOSE") {
      commandInProgress = true;
      trayActiveCmdId = runCmdId;
      trayActiveCmdAction = "TRAY_CLOSE";
      trayActiveCmdSlot = 0;
      if (!startTrayRetract("App Test Close", true, true, false)) {
        if (trayState != TRAY_ST_FAULT) {
          finishTrayCmdAck(true, "Tray already at CLOSED position.");
          showIdleScreen();
        }
      }
    } else if (runAction == "TRAY_HOME") {
      commandInProgress = true;
      trayActiveCmdId = runCmdId;
      trayActiveCmdAction = "TRAY_HOME";
      trayActiveCmdSlot = 0;
      if (!startTrayRetract("Homing Tray...", true, true, true)) {
        if (trayState != TRAY_ST_FAULT) {
          finishTrayCmdAck(true, "Tray already homed at CLOSED switch.");
          showIdleScreen();
        }
      }
    } else if (runAction == "TRAY_NUDGE_OPEN" || runAction == "TRAY_NUDGE_CLOSE") {
      commandInProgress = true;
      bool nudgeOut = (runAction == "TRAY_NUDGE_OPEN");
      int ms = constrain(runSlot > 0 ? runSlot : 200, 50, 3000);
      trayActiveCmdId = runCmdId;
      trayActiveCmdAction = runAction;
      trayActiveCmdSlot = ms;
      if (!startTrayNudge(nudgeOut, ms)) {
        finishTrayCmdAck(true, String("Tray already at ") + (nudgeOut ? "OPEN" : "CLOSED") + " limit / nudged.");
        showIdleScreen();
      }
    } else if (runAction == "TRAY_SET_OPEN" || runAction == "TRAY_SET_CLOSED") {
      commandInProgress = true;
      bool markOpen = (runAction == "TRAY_SET_OPEN");
      persistTrayOpenState(markOpen);
      sendCommandAck(runAction, "COMPLETED", 0, String("Saved ESP32 tray state as ") + (markOpen ? "OPEN" : "CLOSED") + " (no motion).", runCmdId, "DONE", 100);
      showOledStatus("TRAY SYNCED", markOpen ? "Marked OPEN" : "Marked CLOSED", "Saved to memory", "");
      beepNotice();
      setMessageHold(1600);
      commandInProgress = false;
    } else if (!sensorReady) {
      // Never silently drop a fingerprint command when R307S is disconnected — report FAILED immediately!
      sendCommandAck(runAction, "FAILED", runSlot, "R307S fingerprint sensor not detected on ESP32! Check 5V/GND/TXD/RXD wiring.", runCmdId, "FAILED", 0);
      beepError();
    } else if (runAction == "ENROLL" && runSlot >= 1 && runSlot <= 1000) {
      bool autoRetractAfterEnroll = (trayState != TRAY_ST_OPEN) && !sensingEnabled;
      if (trayState != TRAY_ST_OPEN && trayCfg.enabled) {
        startTrayExtend("Remote Enrollment", false, false);
        waitTrayMotionComplete((unsigned long)trayCfg.maxRunMs + 1000UL);
        if (trayState == TRAY_ST_FAULT) {
          sendCommandAck("ENROLL", "FAILED", runSlot, String("Cannot enroll: tray fault (") + trayFaultMsg + ")", runCmdId, "FAILED", 0);
          beepError();
          return;
        }
      }
      executeRemoteEnroll(runSlot, runStudent, runCmdId);
      if (autoRetractAfterEnroll && !sensingEnabled && trayCfg.enabled) {
        waitForFingerLiftAfterScan(2500);
        startTrayRetract("Enroll Complete", false, false, false);
      }
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

  if (deviceInStandby) {
    // Low-power idle loop while OLED is OFF & scanner is asleep (still handles OTA & Serial!)
    delay(40);
    return;
  }

  // Refresh `now` after any long blocking command execution above
  now = millis();

  if (!isTrayMoving()) {
    if (messageHolding && deadlineReached(now, messageHoldUntilMs)) {
      clearMessageHold();
      showIdleScreen();
    }
    animateIdleFace(now);
  }

  bool trayAllowsScan = (!SERVO_ENABLED) || (!trayCfg.enabled) || (trayState == TRAY_ST_OPEN);

#if FP_USE_TOUCH_PIN
  // Pure 6-Wire Edge-Triggered Touch Wake: LED stays 100% DARK & cool while idle, flashes ONLY on new finger touch!
  if (touchMustRelease) {
    if (!touchPinTriggered()) {
      touchMustRelease = false;
      touchStuckStartMs = 0;
    } else if (sensorReady && !isTrayMoving() && !scanInProgress && !commandInProgress && (now - touchStuckStartMs >= 6000UL)) {
      // Auto-heal if capacitive touch baseline drifted or booted with finger near glass
      if (finger.getImage() == FINGERPRINT_NOFINGER) {
        touchIdleLevel = digitalRead(FP_TOUCH_PIN);
        touchMustRelease = false;
        touchStuckStartMs = 0;
        Serial.printf("[R307S] Auto-recalibrated stuck touch pin (new idle=%s)\n", touchIdleLevel == HIGH ? "HIGH" : "LOW");
      } else {
        touchStuckStartMs = now; // Real finger still resting on prism
      }
    }
  } else if (devicePowerOn && sensingEnabled && trayAllowsScan && !isTrayMoving() && sensorReady && !messageHolding
             && (touchCooldownUntilMs == 0 || deadlineReached(now, touchCooldownUntilMs))
             && (!traySettledActive || deadlineReached(now, traySettledUntilMs))
             && now - lastFpPollMs >= 20) {
    touchCooldownUntilMs = 0;
    traySettledActive = false;
    traySettledUntilMs = 0;
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
  if (devicePowerOn && sensingEnabled && trayAllowsScan && !isTrayMoving() && sensorReady && !messageHolding && now - lastFpPollMs >= 250) {
    lastFpPollMs = now;
    if (finger.getImage() == FINGERPRINT_OK) {
      scanAndSubmitFingerprint();
    }
  }
#endif

  delay(isTrayMoving() ? 2 : 10);
}
