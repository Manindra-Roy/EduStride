/*
 * EduStride Biometric Attendance & Gate Entry/Exit Scanner
 * Hardware:
 *   - ESP32-CP2102-TypeC-38Pins
 *   - 0.96" I2C 4-pin SSD1306 OLED (SDA=21, SCL=22, VCC=3V3)
 *   - R307S Optical Fingerprint Sensor (6-Wire Pro Mode: 5V->VIN, GND->GND, TXD->GPIO16, RXD->GPIO17, TOUCH->GPIO4, 3.3VT->3V3)
 *   - Buzzer (GPIO 25)
 *
 * Required Arduino Libraries (install via Library Manager):
 *   1. Adafruit Fingerprint Sensor Library (by Adafruit)
 *   2. Adafruit SSD1306 (by Adafruit)
 *   3. Adafruit GFX Library (by Adafruit)
 *   4. ArduinoJson (by Benoit Blanchon, v6 or v7)
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_Fingerprint.h>
#include <ArduinoJson.h>
#include "config.h"

// Backward-compatible defaults for 6-Wire Pro Mode (R307S Pin 5 TOUCH -> GPIO 4, Pin 6 3.3VT -> 3V3)
#ifndef FP_TOUCH_PIN
#define FP_TOUCH_PIN     4
#endif
#ifndef FP_USE_TOUCH_PIN
#define FP_USE_TOUCH_PIN true
#endif

// Hardware objects
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
HardwareSerial fpSerial(2); // ESP32 Hardware UART2
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fpSerial);

// Runtime state synced wirelessly with EduStride backend
volatile bool sensingEnabled = true;
volatile bool prevSensingObserved = true;
bool sensorReady = false;
bool ledCurrentlyOn = false;
int touchIdleLevel = HIGH; // Auto-calibrated at boot (works with both Active-LOW & Active-HIGH R307S!)
bool otaInitialized = false;
volatile bool otaInProgress = false;
volatile bool scanInProgress = false;
volatile bool commandInProgress = false;
volatile bool wifiBusy = false;
String lastServerTime = "--:--";
unsigned long lastHeartbeatMs = 0;
unsigned long messageHoldUntilMs = 0;
unsigned long lastWifiCheckMs = 0;
unsigned long lastSensorRetryMs = 0;

// Dual-core FreeRTOS synchronization (Core 0 = HTTPS Heartbeat, Core 1 = R307S + 30 FPS OLED + OTA)
SemaphoreHandle_t netMutex = nullptr;
SemaphoreHandle_t stateMutex = nullptr;
bool hasQueuedCommand = false;
String queuedCmdAction = "NONE";
int queuedCmdSlot = 0;
String queuedCmdStudent = "";

// ============================================================================
// VECTOR / COZMO / EMO STYLE DESK-ROBOT EYE ENGINE (128x64 OLED, ~33 FPS)
// ============================================================================
enum FaceMood {
  FACE_IDLE,
  FACE_SLEEPY,
  FACE_HAPPY,
  FACE_WINK,
  FACE_FOCUSED,
  FACE_CHEEKY,
  FACE_ERROR
};

// Smooth physics-interpolated eye parameters (sleek 30x30 keeps 3.3V OLED current low!)
float eyeCurX = 0.0f, eyeTargetX = 0.0f;
float eyeCurY = 0.0f, eyeTargetY = 0.0f;
float eyeLeftH = 30.0f, eyeTargetLeftH = 30.0f;
float eyeRightH = 30.0f, eyeTargetRightH = 30.0f;
float eyeLeftW = 30.0f, eyeTargetLeftW = 30.0f;
float eyeRightW = 30.0f, eyeTargetRightW = 30.0f;

// Dirty-frame tracker: ONLY push I2C OLED updates when pixels actually change!
int lastDrawnX = 999, lastDrawnY = 999;
int lastDrawnLH = -1, lastDrawnRH = -1, lastDrawnLW = -1, lastDrawnRW = -1;
bool lastDrawnHappy = false;
bool lastDrawnWifi = false;

// Idle personality timers
unsigned long lastFrameMs = 0;
unsigned long lastFpScanMs = 0;
unsigned long nextBlinkMs = 0;
unsigned long nextBehaviorMs = 0;
unsigned long idleHappyUntilMs = 0;
uint8_t blinkPhase = 0;       // 0=open, 1=closing, 2=closed, 3=opening
uint8_t pendingDoubleBlink = 0;
uint8_t sleepZFrame = 0;
unsigned long lastSleepZMs = 0;
FaceMood activeEventMood = FACE_IDLE;
String activeEventCaption = "";
unsigned long eventStartMs = 0;

// ============================================================================
// BUZZER HELPERS (Supports both Active and Passive Buzzers via config.h)
// ============================================================================
void buzzerOn(int freqHz = 2200) {
#if BUZZER_IS_ACTIVE
  digitalWrite(BUZZER_PIN, HIGH);
#else
  tone(BUZZER_PIN, freqHz);
#endif
}

void buzzerOff() {
#if BUZZER_IS_ACTIVE
  digitalWrite(BUZZER_PIN, LOW);
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

void beepEntry()   { beepPattern(1, 130, 0, 2400); }
void beepExit()    { beepPattern(2, 100, 90, 2000); }
void beepError()   { beepPattern(1, 450, 0, 900); }
void beepNotice()  { beepPattern(2, 60, 60, 1600); }
void beepEnrollOk(){ beepPattern(3, 90, 80, 2600); }

// ============================================================================
// VECTOR / COZMO / EMO DESK-ROBOT EYE RENDERER (128x64 SSD1306)
// ============================================================================
void drawCenteredFooter(const String& footerText) {
  if (footerText.length() == 0) return;
  String clean = footerText.substring(0, 21);
  int16_t textWidth = clean.length() * 6;
  int16_t x = (SCREEN_WIDTH - textWidth) / 2;
  if (x < 0) x = 0;
  display.fillRect(0, 53, SCREEN_WIDTH, 11, SSD1306_BLACK);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(x, 55);
  display.print(clean);
}

void renderRoboEyes(FaceMood mood, const String& caption, unsigned long now) {
  display.clearDisplay();

  // Subtle 2px Wi-Fi indicator dot in top-right corner
  if (WiFi.status() == WL_CONNECTED) {
    display.fillCircle(124, 3, 1, SSD1306_WHITE);
  }

  bool hasCaption = caption.length() > 0;
  int baseCenterY = hasCaption ? 25 : 32;

  // Base eye geometry (huge glowing Vector/EMO eyes filling the 128x64 OLED!)
  int lW = (int)roundf(eyeLeftW);
  int rW = (int)roundf(eyeRightW);
  int lH = (int)roundf(eyeLeftH);
  int rH = (int)roundf(eyeRightH);

  // Subtle Cozmo/Vector 3D perspective scaling when glancing left/right
  int gx = (int)roundf(eyeCurX);
  int gy = (int)roundf(eyeCurY);
  if (mood == FACE_IDLE && blinkPhase == 0) {
    if (gx < -3) { lH += 3; rH -= 3; rW -= 2; }
    else if (gx > 3) { rH += 3; lH -= 3; lW -= 2; }
  }

  if (lH < 3) lH = 3;
  if (rH < 3) rH = 3;
  if (lW < 18) lW = 18;
  if (rW < 18) rW = 18;

  // Center coordinates of left and right eyes
  int gap = 14;
  int lCx = 64 - (gap / 2) - (lW / 2) + gx;
  int rCx = 64 + (gap / 2) + (rW / 2) + gx;
  int lCy = baseCenterY + gy;
  int rCy = baseCenterY + gy;

  // Add subtle shake on angry/error mood
  if (mood == FACE_ERROR) {
    int shake = ((now / 60) % 2 == 0) ? -3 : 3;
    lCx += shake;
    rCx += shake;
  }

  // Add subtle joyful bounce on happy mood
  if (mood == FACE_HAPPY) {
    int bounce = ((now / 150) % 2 == 0) ? -2 : 1;
    lCy += bounce;
    rCy += bounce;
  }

  int lX = lCx - (lW / 2);
  int lY = lCy - (lH / 2);
  int rX = rCx - (rW / 2);
  int rY = rCy - (rH / 2);

  int lRad = min(10, min(lW / 2, lH / 2));
  int rRad = min(10, min(rW / 2, rH / 2));

  switch (mood) {
    case FACE_IDLE: {
      display.fillRoundRect(lX, lY, lW, lH, lRad, SSD1306_WHITE);
      display.fillRoundRect(rX, rY, rW, rH, rRad, SSD1306_WHITE);

      // Optional brief happy-squint idle moment (EMO's signature curved lower cheek mask!)
      if (idleHappyUntilMs > now && blinkPhase == 0 && lH > 20) {
        display.fillRoundRect(lX - 2, lCy + 4, lW + 4, lH, 12, SSD1306_BLACK);
        display.fillRoundRect(rX - 2, rCy + 4, rW + 4, rH, 12, SSD1306_BLACK);
      }
      break;
    }

    case FACE_SLEEPY: {
      // Cozy Vector/EMO sleeping arcs (thick downward curved eyelids) + floating z Z
      int sY = hasCaption ? 28 : 34;
      display.fillRoundRect(20, sY - 5, 36, 12, 6, SSD1306_WHITE);
      display.fillRoundRect(22, sY - 10, 32, 10, 5, SSD1306_BLACK);

      display.fillRoundRect(72, sY - 5, 36, 12, 6, SSD1306_WHITE);
      display.fillRoundRect(74, sY - 10, 32, 10, 5, SSD1306_BLACK);

      // Animated gently rising "z  Z"
      display.setTextColor(SSD1306_WHITE);
      display.setTextSize(1);
      int zOff = (sleepZFrame % 4) * 2;
      display.setCursor(98, 16 - zOff);
      display.print("z");
      display.setCursor(109, 8 - zOff);
      display.print("Z");
      break;
    }

    case FACE_HAPPY: {
      // Iconic EMO / Vector joyful happy squint arches (bright glowing "^  ^" crescents)
      int hW = 38, hH = 34;
      int hlX = 64 - 7 - hW;
      int hrX = 64 + 7;
      int hY = lCy - (hH / 2);

      display.fillRoundRect(hlX, hY, hW, hH, 12, SSD1306_WHITE);
      display.fillRoundRect(hrX, hY, hW, hH, 12, SSD1306_WHITE);
      // Carve curved joyful lower cheek smile from below
      display.fillCircle(hlX + hW / 2, hY + hH + 6, 22, SSD1306_BLACK);
      display.fillCircle(hrX + hW / 2, hY + hH + 6, 22, SSD1306_BLACK);
      break;
    }

    case FACE_WINK: {
      // Playful Vector wink: Left eye happy curved arch, Right eye wide glowing rounded eye
      int hW = 36, hH = 32;
      int hlX = 64 - 7 - hW;
      int hrX = 64 + 7;
      int hY = lCy - (hH / 2);

      // Left winking arch
      display.fillRoundRect(hlX, hY, hW, hH, 12, SSD1306_WHITE);
      display.fillCircle(hlX + hW / 2, hY + hH + 5, 21, SSD1306_BLACK);

      // Right sparkling open eye
      display.fillRoundRect(hrX, hY - 2, hW, hH + 4, 10, SSD1306_WHITE);
      break;
    }

    case FACE_FOCUSED: {
      // Wide attentive eyes looking down toward sensor
      display.fillRoundRect(lX, lY + 3, lW, lH, lRad, SSD1306_WHITE);
      display.fillRoundRect(rX, rY + 3, rW, rH, rRad, SSD1306_WHITE);
      break;
    }

    case FACE_CHEEKY: {
      // Sassy half-lidded side-eye (for cooldown / already scanned)
      display.fillRoundRect(lX + 5, lY, lW, 28, 9, SSD1306_WHITE);
      display.fillRoundRect(rX + 5, rY, rW, 28, 9, SSD1306_WHITE);
      // Heavy flat upper eyelids (unimpressed Vector look!)
      display.fillRect(lX + 3, lY - 2, lW + 4, 13, SSD1306_BLACK);
      display.fillRect(rX + 3, rY - 2, rW + 4, 13, SSD1306_BLACK);
      break;
    }

    case FACE_ERROR: {
      // Iconic Vector / EMO grumpy slanted eyebrows (masking inner-top corners!)
      int eW = 36, eH = 30;
      int elX = lCx - eW / 2;
      int erX = rCx - eW / 2;
      int eY = lCy - eH / 2;

      display.fillRoundRect(elX, eY, eW, eH, 9, SSD1306_WHITE);
      display.fillRoundRect(erX, eY, eW, eH, 9, SSD1306_WHITE);
      // Diagonal angry/confused brow cutouts sloping inward
      display.fillTriangle(elX, eY - 1, elX + eW + 2, eY - 1, elX + eW + 2, eY + 14, SSD1306_BLACK);
      display.fillTriangle(erX - 2, eY - 1, erX + eW, eY - 1, erX - 2, eY + 14, SSD1306_BLACK);
      break;
    }
  }

  drawCenteredFooter(caption);
  display.display();
}

void drawCuteFace(FaceMood mood, const String& caption) {
  activeEventMood = mood;
  activeEventCaption = caption;
  eventStartMs = millis();
  eyeCurX = 0; eyeTargetX = 0;
  eyeCurY = 0; eyeTargetY = 0;
  eyeLeftW = 36; eyeRightW = 36;
  eyeLeftH = 34; eyeRightH = 34;
  renderRoboEyes(mood, caption, eventStartMs);
}

void showOledStatus(const String& header, const String& line1, const String& line2 = "", const String& line3 = "") {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Top Header Bar
  display.fillRect(0, 0, SCREEN_WIDTH, 14, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(4, 3);
  display.print(header.substring(0, 20));

  // Main Body
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 20);
  display.println(line1.substring(0, 21));

  if (line2.length() > 0) {
    display.setCursor(0, 34);
    display.println(line2.substring(0, 21));
  }
  if (line3.length() > 0) {
    display.setCursor(0, 48);
    display.println(line3.substring(0, 21));
  }
  display.display();
}

void showIdleScreen() {
  activeEventCaption = "";
  lastDrawnX = 999; // Force next dirty check to sync cleanly
  if (WiFi.status() != WL_CONNECTED) {
    renderRoboEyes(FACE_FOCUSED, "Wi-Fi Reconnecting...", millis());
    return;
  }
  if (!sensingEnabled) {
    renderRoboEyes(FACE_SLEEPY, "PAUSED IN APP", millis());
  } else {
    // Pure full-screen Vector / EMO desk robot eyes!
    renderRoboEyes(FACE_IDLE, "", millis());
  }
}

void animateIdleFace(unsigned long now) {
  if (otaInProgress) return;

  // Keep event moods (bounce on Happy / shake on Error) animated during hold window
  if (messageHoldUntilMs > 0) {
    if (now - lastFrameMs >= 90) {
      lastFrameMs = now;
      renderRoboEyes(activeEventMood, activeEventCaption, now);
    }
    return;
  }

  if (WiFi.status() != WL_CONNECTED) return;

  // Sleepy Paused Mode (when turned OFF from EduStride mobile app)
  if (!sensingEnabled) {
    if (now - lastSleepZMs >= 650) {
      lastSleepZMs = now;
      sleepZFrame = (sleepZFrame + 1) % 8;
      renderRoboEyes(FACE_SLEEPY, "PAUSED IN APP", now);
    }
    return;
  }

  // Smooth ~18 FPS physics tick, BUT only sends I2C to OLED when eyes actually move/blink!
  if (now - lastFrameMs < 55) return;
  lastFrameMs = now;

  // 1. Trigger natural single or double blinks every 3.0 - 6.0s
  if (blinkPhase == 0 && now >= nextBlinkMs) {
    blinkPhase = 1; // start closing
    eyeTargetLeftH = 3.0f;
    eyeTargetRightH = 3.0f;
    eyeTargetLeftW = 35.0f;  // Pixar squash-and-stretch width pop!
    eyeTargetRightW = 35.0f;
    if ((now % 4) == 0) pendingDoubleBlink = 1;
  }

  if (blinkPhase == 1 && eyeLeftH <= 6.0f && eyeRightH <= 6.0f) {
    blinkPhase = 2; // snap open
    eyeTargetLeftH = 30.0f;
    eyeTargetRightH = 30.0f;
    eyeTargetLeftW = 30.0f;
    eyeTargetRightW = 30.0f;
  } else if (blinkPhase == 2 && eyeLeftH >= 28.0f && eyeRightH >= 28.0f) {
    blinkPhase = 0;
    eyeLeftH = 30.0f; eyeRightH = 30.0f;
    eyeLeftW = 30.0f; eyeRightW = 30.0f;
    if (pendingDoubleBlink > 0) {
      pendingDoubleBlink = 0;
      nextBlinkMs = now + 180; // quick cute double blink!
    } else {
      nextBlinkMs = now + 3000 + (now % 3200);
    }
  }

  // 2. Random lively Vector / EMO curiosity & glance behaviors every 3.0 - 6.0s
  if (blinkPhase == 0 && now >= nextBehaviorMs) {
    nextBehaviorMs = now + 3000 + (now % 3000);
    uint8_t pick = (now / 37) % 10;

    eyeTargetLeftW = 30.0f;
    eyeTargetRightW = 30.0f;
    eyeTargetLeftH = 30.0f;
    eyeTargetRightH = 30.0f;

    switch (pick) {
      case 0: // Center calm
      case 1:
        eyeTargetX = 0.0f; eyeTargetY = 0.0f;
        break;
      case 2: // Glance left
        eyeTargetX = -12.0f; eyeTargetY = -1.0f;
        break;
      case 3: // Glance right
        eyeTargetX = 12.0f; eyeTargetY = -1.0f;
        break;
      case 4: // Curious look up-left
        eyeTargetX = -9.0f; eyeTargetY = -6.0f;
        break;
      case 5: // Curious look up-right
        eyeTargetX = 9.0f; eyeTargetY = -6.0f;
        break;
      case 6: // Glance down toward sensor
        eyeTargetX = 0.0f; eyeTargetY = 6.0f;
        break;
      case 7: // Curious inquisitive asymmetric eyes
        eyeTargetX = -4.0f; eyeTargetY = -2.0f;
        eyeTargetLeftH = 35.0f; eyeTargetRightH = 22.0f;
        break;
      case 8: // Curious asymmetric right!
        eyeTargetX = 4.0f; eyeTargetY = -2.0f;
        eyeTargetLeftH = 22.0f; eyeTargetRightH = 35.0f;
        break;
      case 9: // Brief sweet happy-squint moment!
        eyeTargetX = 0.0f; eyeTargetY = -2.0f;
        idleHappyUntilMs = now + 1500;
        break;
    }
  }

  // 3. Smooth exponential easing interpolation (snap when close so I2C sleeps cleanly!)
  const float posEase = 0.36f;
  const float sizeEase = (blinkPhase > 0) ? 0.60f : 0.34f;

  eyeCurX   += (eyeTargetX - eyeCurX) * posEase;
  eyeCurY   += (eyeTargetY - eyeCurY) * posEase;
  eyeLeftH  += (eyeTargetLeftH - eyeLeftH) * sizeEase;
  eyeRightH += (eyeTargetRightH - eyeRightH) * sizeEase;
  eyeLeftW  += (eyeTargetLeftW - eyeLeftW) * sizeEase;
  eyeRightW += (eyeTargetRightW - eyeRightW) * sizeEase;

  if (fabsf(eyeTargetX - eyeCurX) < 0.4f) eyeCurX = eyeTargetX;
  if (fabsf(eyeTargetY - eyeCurY) < 0.4f) eyeCurY = eyeTargetY;
  if (fabsf(eyeTargetLeftH - eyeLeftH) < 0.4f) eyeLeftH = eyeTargetLeftH;
  if (fabsf(eyeTargetRightH - eyeRightH) < 0.4f) eyeRightH = eyeTargetRightH;
  if (fabsf(eyeTargetLeftW - eyeLeftW) < 0.4f) eyeLeftW = eyeTargetLeftW;
  if (fabsf(eyeTargetRightW - eyeRightW) < 0.4f) eyeRightW = eyeTargetRightW;

  int curX = (int)roundf(eyeCurX);
  int curY = (int)roundf(eyeCurY);
  int curLH = (int)roundf(eyeLeftH);
  int curRH = (int)roundf(eyeRightH);
  int curLW = (int)roundf(eyeLeftW);
  int curRW = (int)roundf(eyeRightW);
  bool curHappy = (idleHappyUntilMs > now && blinkPhase == 0 && curLH > 18);
  bool curWifi = (WiFi.status() == WL_CONNECTED);

  // Dirty-frame check: SKIP I2C display.display() completely when eyes are resting!
  if (curX == lastDrawnX && curY == lastDrawnY &&
      curLH == lastDrawnLH && curRH == lastDrawnRH &&
      curLW == lastDrawnLW && curRW == lastDrawnRW &&
      curHappy == lastDrawnHappy && curWifi == lastDrawnWifi) {
    return;
  }

  lastDrawnX = curX; lastDrawnY = curY;
  lastDrawnLH = curLH; lastDrawnRH = curRH;
  lastDrawnLW = curLW; lastDrawnRW = curRW;
  lastDrawnHappy = curHappy; lastDrawnWifi = curWifi;

  renderRoboEyes(FACE_IDLE, "", now);
}

void setSensorLed(bool on, bool force = false) {
  if (!sensorReady) return;
  if (force || ledCurrentlyOn != on) {
    finger.LEDcontrol(on);
    ledCurrentlyOn = on;
  }
}

void setIdleSensorLed(bool force = false) {
#if FP_USE_TOUCH_PIN
  // 6-Wire Pro Mode: optical LED stays 100% OFF & ice-cool until Pin 5 TOUCH wakes it!
  setSensorLed(false, force);
#else
  setSensorLed(sensingEnabled, force);
#endif
}

void calibrateTouchPin() {
#if FP_USE_TOUCH_PIN
  pinMode(FP_TOUCH_PIN, INPUT_PULLUP);
  delay(60);
  int highCount = 0;
  for (int i = 0; i < 15; i++) {
    if (digitalRead(FP_TOUCH_PIN) == HIGH) highCount++;
    delay(4);
  }
  touchIdleLevel = (highCount >= 8) ? HIGH : LOW;
  Serial.printf("[R307S] 6-Wire Touch Wake READY on GPIO %d (idle=%s, active=%s)\n",
                FP_TOUCH_PIN,
                touchIdleLevel == HIGH ? "HIGH" : "LOW",
                touchIdleLevel == HIGH ? "LOW" : "HIGH");
#endif
}

bool isFingerTouchingSensor() {
#if FP_USE_TOUCH_PIN
  if (digitalRead(FP_TOUCH_PIN) == touchIdleLevel) return false;
  delay(25); // 25ms debounce to reject electrical noise
  return (digitalRead(FP_TOUCH_PIN) != touchIdleLevel);
#else
  return true;
#endif
}

// ============================================================================
// HTTP / HTTPS CLIENT HELPER (Works with both local HTTP and Render HTTPS)
// ============================================================================
bool isHttpsUrl(const String& url) {
  return url.startsWith("https://") || url.startsWith("HTTPS://");
}

int performHttpRequest(const String& method, const String& path, const String& jsonBody, String& responseOut) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  if (netMutex && xSemaphoreTake(netMutex, pdMS_TO_TICKS(9000)) != pdTRUE) {
    return -3;
  }

  wifiBusy = true;
  String baseUrl = String(SERVER_BASE_URL);
  while (baseUrl.endsWith("/")) {
    baseUrl.remove(baseUrl.length() - 1);
  }
  String fullUrl = baseUrl + path;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);

  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  bool began = false;

  if (isHttpsUrl(fullUrl)) {
    secureClient.setInsecure(); // Allows Render / Let's Encrypt TLS without manual CA pinning
    began = http.begin(secureClient, fullUrl);
  } else {
    began = http.begin(plainClient, fullUrl);
  }

  int httpCode = -2;
  if (began) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-device-key", DEVICE_API_KEY);

    if (method == "GET") {
      httpCode = http.GET();
    } else if (method == "POST") {
      httpCode = http.POST(jsonBody);
    }

    if (httpCode > 0) {
      responseOut = http.getString();
    }
    http.end();
  }

  wifiBusy = false;
  if (netMutex) {
    xSemaphoreGive(netMutex);
  }
  return httpCode;
}

// ============================================================================
// R307S PROVEN DIRECT CAPTURE HELPER (Immediate getImage -> image2Tz!)
// ============================================================================
uint8_t lastCaptureErrCode = 0;

bool captureCleanFingerToSlot(uint8_t tzSlot, unsigned long timeoutMs) {
  unsigned long startWait = millis();
  lastCaptureErrCode = 0;

  while (millis() - startWait < timeoutMs) {
    uint8_t p = finger.getImage();
    if (p == FINGERPRINT_OK) {
      // Immediately convert the captured frame (standard Adafruit R307S flow — no frame discard!)
      uint8_t tz = finger.image2Tz(tzSlot);
      if (tz == FINGERPRINT_OK) {
        return true;
      }
      lastCaptureErrCode = tz;
      Serial.printf("[R307S] image2Tz(%d) err=0x%02X (retrying)\n", tzSlot, tz);
    } else if (p != FINGERPRINT_NOFINGER) {
      lastCaptureErrCode = p;
    }
    if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
    delay(50);
  }
  return false;
}

void sendCommandAck(const String& action, const String& status, int slotId, const String& message) {
  StaticJsonDocument<256> doc;
  doc["action"] = action;
  doc["status"] = status;
  if (slotId > 0) doc["slot_id"] = slotId;
  doc["message"] = message;

  String payload;
  serializeJson(doc, payload);
  String resp;
  performHttpRequest("POST", "/api/biometric/device/command-ack", payload, resp);
}

// ============================================================================
// REMOTE FINGERPRINT ENROLLMENT & DELETION (Auto-retries Step 2 up to 4 times!)
// ============================================================================
void executeRemoteEnroll(int slotId, const String& studentName) {
  commandInProgress = true;
  Serial.printf("[ENROLL] Starting slot #%d for %s\n", slotId, studentName.c_str());
  sendCommandAck("ENROLL", "IN_PROGRESS", slotId, "Place finger on sensor (Step 1/2)...");
  showOledStatus("ENROLL SLOT #" + String(slotId), studentName, "Place Finger (1/2)", "Hold steady...");
  beepNotice();

  // Wake R307S LED cleanly for Step 1 capture
  setSensorLed(true, true);
  delay(50);

  // Step 1: Wait for first finger placement into Buffer 1
  if (!captureCleanFingerToSlot(1, ENROLL_STEP_TIMEOUT_MS)) {
    setIdleSensorLed(true);
    String errHex = String(lastCaptureErrCode, HEX);
    showOledStatus("ENROLL TIMEOUT", studentName, "Step 1 err: 0x" + errHex, "Try again in App");
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Step 1 failed/timed out (code 0x" + errHex + ").");
    messageHoldUntilMs = millis() + 3000;
    commandInProgress = false;
    return;
  }

  // Try Step 2 + createModel() up to 3 times without throwing away Step 1!
  bool modelCreated = false;
  uint8_t lastModelErr = 0;

  for (int tryIdx = 1; tryIdx <= 3; tryIdx++) {
    setSensorLed(false, true); // Turn LED OFF while waiting for finger lift (keeps prism cool!)
    beepEntry();
    showOledStatus("ENROLL SLOT #" + String(slotId), tryIdx == 1 ? "Step 1 Captured!" : ("Retry Step 2 (" + String(tryIdx) + "/3)"), "REMOVE FINGER", "Wait a moment...");
    if (tryIdx == 1) {
      sendCommandAck("ENROLL", "IN_PROGRESS", slotId, "Step 1 OK! Lift finger, then place again (Step 2/2)...");
    } else {
      sendCommandAck("ENROLL", "IN_PROGRESS", slotId, "Did not match — lift & place SAME finger again (Try " + String(tryIdx) + "/3)...");
    }

    delay(1000);
    unsigned long liftStart = millis();
    while (millis() - liftStart < 9000) {
#if FP_USE_TOUCH_PIN
      if (digitalRead(FP_TOUCH_PIN) == touchIdleLevel) break;
#else
      if (finger.getImage() == FINGERPRINT_NOFINGER) break;
#endif
      delay(50);
    }

    showOledStatus("ENROLL SLOT #" + String(slotId), studentName, "Place SAME Finger", "Step 2 of 2...");
    setSensorLed(true, true); // Wake LED crisp & cold for Step 2!
    delay(50);
    if (!captureCleanFingerToSlot(2, ENROLL_STEP_TIMEOUT_MS)) {
      lastModelErr = lastCaptureErrCode;
      continue;
    }

    lastModelErr = finger.createModel();
    Serial.printf("[ENROLL] createModel() try %d -> 0x%02X\n", tryIdx, lastModelErr);
    if (lastModelErr == FINGERPRINT_OK) {
      modelCreated = true;
      break;
    }

    beepError();
    delay(400);
  }

  setIdleSensorLed(true); // Immediately back to cool idle!

  if (!modelCreated) {
    String errHex = String(lastModelErr, HEX);
    showOledStatus("NO MATCH (0x" + errHex + ")", "Fingers did not", "match! Retry", "");
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Two finger scans did not match after 3 tries (code 0x" + errHex + "). Please retry.");
    messageHoldUntilMs = millis() + 3500;
    commandInProgress = false;
    return;
  }

  uint8_t storeErr = finger.storeModel(slotId);
  if (storeErr != FINGERPRINT_OK) {
    String errHex = String(storeErr, HEX);
    showOledStatus("STORAGE ERROR", "Slot #" + String(slotId), "Code: 0x" + errHex, "");
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Failed writing fingerprint to R307S flash (code 0x" + errHex + ").");
    messageHoldUntilMs = millis() + 3000;
    commandInProgress = false;
    return;
  }

  finger.getTemplateCount();
  drawCuteFace(FACE_HAPPY, "Enrolled #" + String(slotId) + "!");
  beepEnrollOk();
  sendCommandAck("ENROLL", "COMPLETED", slotId, "Successfully enrolled " + studentName + " in Slot #" + String(slotId) + "!");
  messageHoldUntilMs = millis() + 3000;
  commandInProgress = false;
}

void executeRemoteDelete(int slotId, const String& studentName) {
  commandInProgress = true;
  Serial.printf("[DELETE] Removing slot #%d (%s)\n", slotId, studentName.c_str());
  showOledStatus("REMOVING PRINT", studentName, "Clearing Slot #" + String(slotId), "");
  uint8_t p = finger.deleteModel(slotId);
  if (p == FINGERPRINT_OK) {
    finger.getTemplateCount();
    sendCommandAck("DELETE", "COMPLETED", slotId, "Deleted Slot #" + String(slotId) + " from sensor.");
    showOledStatus("REMOVED", studentName, "Slot #" + String(slotId) + " freed", "");
    beepNotice();
  } else {
    sendCommandAck("DELETE", "FAILED", slotId, "Failed to erase slot from R307S sensor.");
    beepError();
  }
  messageHoldUntilMs = millis() + 2500;
  commandInProgress = false;
}

// ============================================================================
// HEARTBEAT SYNC WITH BACKEND (Runs on Core 0 — NEVER blocks R307S or OLED!)
// ============================================================================
void pollServerStatus() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (otaInProgress || scanInProgress || commandInProgress) return;

  String path = "/api/biometric/device/status?firmware=" + String(FIRMWARE_VERSION)
              + "&templates=" + String(finger.templateCount)
              + "&ip=" + WiFi.localIP().toString();

  String response;
  int code = performHttpRequest("GET", path, "", response);
  if (code != 200) {
    Serial.printf("[HEARTBEAT] HTTP %d\n", code);
    return;
  }

  StaticJsonDocument<768> doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err) {
    Serial.printf("[HEARTBEAT] JSON parse error: %s\n", err.c_str());
    return;
  }

  bool newSensing = doc["sensing_enabled"] | true;
  String newTime = doc["server_time_ist"].is<const char*>() ? doc["server_time_ist"].as<String>() : "";

  JsonObject cmd = doc["pending_command"];
  String cmdAction = "NONE";
  String cmdStatus = "IDLE";
  int cmdSlot = 0;
  String cmdStudent = "Student";
  if (!cmd.isNull()) {
    cmdAction = cmd["action"] | "NONE";
    cmdStatus = cmd["status"] | "IDLE";
    cmdSlot = cmd["slot_id"] | 0;
    cmdStudent = cmd["student_name"] | "Student";
  }

  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
    sensingEnabled = newSensing;
    if (newTime.length() > 0) lastServerTime = newTime;
    if (cmdStatus == "PENDING" && cmdAction != "NONE" && !hasQueuedCommand) {
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
  for (;;) {
    if (!otaInProgress && !scanInProgress && !commandInProgress && WiFi.status() == WL_CONNECTED) {
      pollServerStatus();
    }
    vTaskDelay(pdMS_TO_TICKS(5500)); // Calm 5.5s poll (inside 20s online threshold; keeps 3.3V rail quiet!)
  }
}

uint8_t searchStoredTemplates() {
  // Exact Step 1 (ae961db) fast search for up to 160 students; automatic full search beyond 160
  if (finger.templateCount <= 160) {
    return finger.fingerFastSearch();
  }
  return finger.fingerSearch();
}

// ============================================================================
// 6-WIRE ZERO-HEAT TOUCH WAKE & FINGERPRINT SCAN (Core 1)
// ============================================================================
void scanAndSubmitFingerprint() {
  if (!sensorReady || !sensingEnabled || WiFi.status() != WL_CONNECTED) return;

#if FP_USE_TOUCH_PIN
  // 6-Wire Pro Mode: ZERO UART polling & ZERO LED heat until hardware TOUCH pin triggers!
  if (!isFingerTouchingSensor()) return;

  // Wait briefly if a background heartbeat Wi-Fi burst is finishing (<400ms)
  unsigned long waitWifiStart = millis();
  while (wifiBusy && millis() - waitWifiStart < 700) {
    delay(15);
  }
  if (wifiBusy) return;

  scanInProgress = true;
  drawCuteFace(FACE_FOCUSED, "Reading Finger...");

  // Wake optical LED crisp & cold ONLY while finger is pressed!
  setSensorLed(true, true);
  delay(55); // Let optical backlight hit 100% brightness & finger flatten on prism

  int matchedSlot = -1;
  int confidence = 0;
  bool capturedAny = false;

  for (int attempt = 0; attempt < 3; attempt++) {
    if (digitalRead(FP_TOUCH_PIN) == touchIdleLevel) break; // User lifted finger early

    uint8_t p = finger.getImage();
    if (p == FINGERPRINT_OK) {
      capturedAny = true;
      if (finger.image2Tz() == FINGERPRINT_OK) {
        if (searchStoredTemplates() == FINGERPRINT_OK) {
          matchedSlot = finger.fingerID;
          confidence = finger.confidence;
          break;
        }
      }
    }
    delay(75);
  }

  // IMMEDIATELY extinguish optical LED after ~0.2s flash — ZERO heat build-up!
  setSensorLed(false, true);

  if (!capturedAny && matchedSlot < 0) {
    // Accidental quick tap/brush — silently return to cute idle eyes
    scanInProgress = false;
    showIdleScreen();
    return;
  }
#else
  if (wifiBusy) return;
  scanInProgress = true;

  uint8_t p = finger.getImage();
  if (p == FINGERPRINT_NOFINGER || p != FINGERPRINT_OK) {
    scanInProgress = false;
    return;
  }

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) {
    scanInProgress = false;
    return;
  }

  int matchedSlot = -1;
  int confidence = 0;

  p = searchStoredTemplates();
  if (p == FINGERPRINT_OK) {
    matchedSlot = finger.fingerID;
    confidence = finger.confidence;
  } else if (p == FINGERPRINT_NOTFOUND) {
    delay(90);
    if (finger.getImage() == FINGERPRINT_OK && finger.image2Tz() == FINGERPRINT_OK) {
      if (searchStoredTemplates() == FINGERPRINT_OK) {
        matchedSlot = finger.fingerID;
        confidence = finger.confidence;
      }
    }
  } else {
    scanInProgress = false;
    return;
  }
#endif

  if (matchedSlot < 0) {
    drawCuteFace(FACE_ERROR, "Unknown! Try Again");
    beepError();
    messageHoldUntilMs = millis() + 1800;
    // Wait until finger lifts so holding doesn't re-beep immediately
#if FP_USE_TOUCH_PIN
    unsigned long liftWaitErr = millis();
    while (digitalRead(FP_TOUCH_PIN) != touchIdleLevel && millis() - liftWaitErr < 2500) {
      delay(40);
    }
#endif
    scanInProgress = false;
    return;
  }

  Serial.printf("[SCAN] Matched Slot #%d (confidence %d)\n", matchedSlot, confidence);
  drawCuteFace(FACE_FOCUSED, "Syncing Slot #" + String(matchedSlot));

  StaticJsonDocument<128> reqDoc;
  reqDoc["slot_id"] = matchedSlot;
  reqDoc["confidence"] = confidence;

  String reqPayload;
  serializeJson(reqDoc, reqPayload);

  String respStr;
  int httpCode = performHttpRequest("POST", "/api/biometric/device/scan", reqPayload, respStr);

  if (httpCode <= 0) {
    drawCuteFace(FACE_ERROR, "Server Unreachable");
    beepError();
    messageHoldUntilMs = millis() + 2400;
    scanInProgress = false;
    return;
  }

  StaticJsonDocument<512> respDoc;
  if (deserializeJson(respDoc, respStr)) {
    drawCuteFace(FACE_ERROR, "Server Error " + String(httpCode));
    beepError();
    messageHoldUntilMs = millis() + 2200;
    scanInProgress = false;
    return;
  }

  String status = respDoc["status"] | "ERROR";
  String studentName = respDoc["student_name"] | "";
  String eventType = respDoc["event_type"] | "";

  if (status == "OK") {
    if (eventType == "ENTRY") {
      drawCuteFace(FACE_HAPPY, "IN: " + studentName.substring(0, 17));
      beepEntry();
    } else {
      drawCuteFace(FACE_WINK, "OUT: " + studentName.substring(0, 16));
      beepExit();
    }
    messageHoldUntilMs = millis() + 3000;
  } else if (status == "COOLDOWN") {
    int waitSec = respDoc["wait_seconds"] | 0;
    drawCuteFace(FACE_CHEEKY, "Scanned! Wait " + String(waitSec) + "s");
    beepNotice();
    messageHoldUntilMs = millis() + 2200;
  } else if (status == "PAUSED") {
    sensingEnabled = false;
    setSensorLed(false);
    showIdleScreen();
    beepNotice();
  } else {
    String msg = respDoc["message"] | "Unassigned Slot";
    drawCuteFace(FACE_ERROR, msg.substring(0, 21));
    beepError();
    messageHoldUntilMs = millis() + 2400;
  }

  // Wait briefly until finger is lifted so the same touch doesn't immediately re-trigger
  unsigned long liftWait = millis();
#if FP_USE_TOUCH_PIN
  while (digitalRead(FP_TOUCH_PIN) != touchIdleLevel && millis() - liftWait < 3000) {
    delay(40);
  }
#else
  while (finger.getImage() != FINGERPRINT_NOFINGER && millis() - liftWait < 2000) {
    delay(45);
  }
#endif
  scanInProgress = false;
}

// ============================================================================
// WI-FI OTA (OVER-THE-AIR WIRELESS FLASHING) SETUP
// ============================================================================
void initOtaIfReady() {
  if (otaInitialized || WiFi.status() != WL_CONNECTED) return;

  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPort(OTA_PORT);
  if (String(OTA_PASSWORD).length() > 0) {
    ArduinoOTA.setPassword(OTA_PASSWORD);
  }

  ArduinoOTA.onStart([]() {
    otaInProgress = true;
    setSensorLed(false);
    buzzerOff();
    Serial.println("[OTA] Wireless firmware update starting...");
    showOledStatus("WI-FI OTA UPDATE", "Receiving firmware", "Do NOT unplug power!", "Progress: 0%");
  });

  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    static int lastPct = -1;
    int pct = total > 0 ? (int)((progress * 100U) / total) : 0;
    if (pct != lastPct && (pct % 5 == 0 || pct == 100)) {
      lastPct = pct;
      Serial.printf("[OTA] Progress: %u%%\r\n", pct);
      showOledStatus("WI-FI OTA UPDATE", "Flashing firmware...", "Do NOT unplug power!", "Progress: " + String(pct) + "%");
    }
  });

  ArduinoOTA.onEnd([]() {
    Serial.println("\n[OTA] Update complete! Rebooting...");
    showOledStatus("OTA COMPLETE!", "Firmware flashed OK", "Rebooting ESP32...", "");
    beepEnrollOk();
  });

  ArduinoOTA.onError([](ota_error_t error) {
    otaInProgress = false;
    setIdleSensorLed(true);
    Serial.printf("[OTA] Error[%u]\n", error);
    showOledStatus("OTA FAILED", "Error code: " + String(error), "Resuming normal mode", "");
    beepError();
    messageHoldUntilMs = millis() + 3000;
  });

  ArduinoOTA.begin();
  otaInitialized = true;
  Serial.printf("[OTA] Ready! Hostname: %s.local | IP: %s | Port: %d\n",
                OTA_HOSTNAME, WiFi.localIP().toString().c_str(), OTA_PORT);
}

// ============================================================================
// WI-FI CONNECTION HELPER
// ============================================================================
void ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    initOtaIfReady();
    return;
  }

  Serial.printf("[WIFI] Connecting to %s...\n", WIFI_SSID);
  showOledStatus("CONNECTING WI-FI", WIFI_SSID, "Please wait...", "");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(300);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    initOtaIfReady();
    showOledStatus("WI-FI CONNECTED", "IP: " + WiFi.localIP().toString(), "OTA Ready (.local)", "Syncing EduStride...");
    beepEntry();
    delay(1200);
  } else {
    Serial.println("\n[WIFI] Connection timeout; will retry in background.");
    showOledStatus("WI-FI FAILED", "Check 2.4GHz SSID", "& Password in", "config.h");
    beepError();
    messageHoldUntilMs = millis() + 3000;
  }
}

// ============================================================================
// ARDUINO SETUP & MAIN LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== EduStride Biometric Gate Scanner Booting ===");

  // 1. Safe Buzzer Init (immediately LOW)
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerOff();

  // 2. Init 0.96" I2C OLED (SDA=21, SCL=22)
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    Serial.println("[OLED] SSD1306 allocation failed! Check SDA=21, SCL=22, 3V3, GND.");
  } else {
    // Balanced 50% OLED contrast cuts 3.3V current draw in half to keep R307S optical rail rock-solid!
    display.ssd1306_command(SSD1306_SETCONTRAST);
    display.ssd1306_command(0x55);
    showOledStatus("EDUSTRIDE GATE", "Booting v" + String(FIRMWARE_VERSION), "Init R307S Sensor...", "");
  }

  // Create FreeRTOS mutexes for dual-core safety
  netMutex = xSemaphoreCreateMutex();
  stateMutex = xSemaphoreCreateMutex();

  // 3. Calibrate 6-Wire Touch Pin (GPIO 4) & Init R307S on UART2 (GPIO16=RX2, GPIO17=TX2)
  calibrateTouchPin();
  fpSerial.begin(FP_BAUD_RATE, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  delay(250);
  finger.begin(FP_BAUD_RATE);

  if (finger.verifyPassword()) {
    sensorReady = true;
    finger.getParameters(); // Populate real R307S capacity (1000) & security_level
    if (finger.capacity == 0) finger.capacity = 1000;
    if (finger.security_level != 3) {
      // Restore R307S factory default security level (3)
      finger.setSecurityLevel(3);
      delay(50);
    }
    finger.getTemplateCount();
    Serial.printf("[R307S] Sensor OK! Capacity=%d | Security=%d | Stored templates: %d\n",
                  finger.capacity, finger.security_level, finger.templateCount);
    setIdleSensorLed(true); // In 6-Wire Pro Mode: keeps optical LED OFF & cool until finger touches!
  } else {
    sensorReady = false;
    Serial.println("[R307S] Sensor NOT detected! Check 5V->VIN, GND, TXD->GPIO16, RXD->GPIO17.");
    showOledStatus("R307S NOT FOUND", "Check sensor wires", "TXD->16  RXD->17", "5V->VIN  GND->GND");
    beepError();
    delay(2500);
  }

  // 4. Connect 2.4GHz Wi-Fi & Perform First Sync
  ensureWifiConnected();
  pollServerStatus();
  prevSensingObserved = sensingEnabled;
  setIdleSensorLed(true);

  // Start non-blocking HTTPS heartbeat task on Core 0 so Core 1 is 100% dedicated to fast finger scanning & 30 FPS OLED!
  xTaskCreatePinnedToCore(
    heartbeatTask,
    "HeartbeatTask",
    8192,
    nullptr,
    1,
    nullptr,
    0
  );

  nextBlinkMs = millis() + 2000;
  nextBehaviorMs = millis() + 3000;
  showIdleScreen();
}

void loop() {
  // Always handle incoming wireless Wi-Fi OTA update requests first
  if (otaInitialized && WiFi.status() == WL_CONNECTED) {
    ArduinoOTA.handle();
  }
  if (otaInProgress) {
    delay(5);
    return;
  }

  unsigned long now = millis();

  // Auto-reconnect Wi-Fi every 15 seconds if dropped
  if (WiFi.status() != WL_CONNECTED && now - lastWifiCheckMs > 15000) {
    lastWifiCheckMs = now;
    ensureWifiConnected();
  }

  // Auto-recover R307S sensor if it wasn't ready during early power-up
  if (!sensorReady && now - lastSensorRetryMs >= 5000) {
    lastSensorRetryMs = now;
    if (finger.verifyPassword()) {
      sensorReady = true;
      finger.getParameters();
      if (finger.capacity == 0) finger.capacity = 1000;
      if (finger.security_level != 3) {
        finger.setSecurityLevel(3);
        delay(50);
      }
      finger.getTemplateCount();
      setIdleSensorLed(true);
      Serial.printf("[R307S] Recovered! Capacity=%d | Templates: %d\n", finger.capacity, finger.templateCount);
    }
  }

  // React immediately on Core 1 if Core 0 heartbeat toggled sensing ON/OFF
  if (prevSensingObserved != sensingEnabled) {
    prevSensingObserved = sensingEnabled;
    setIdleSensorLed(true);
    beepNotice();
    messageHoldUntilMs = 0;
    showIdleScreen();
  }

  // Execute any queued remote ENROLL / DELETE / CLEAR_ALL command safely on Core 1
  String runAction = "NONE";
  int runSlot = 0;
  String runStudent = "";
  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    if (hasQueuedCommand) {
      runAction = queuedCmdAction;
      runSlot = queuedCmdSlot;
      runStudent = queuedCmdStudent;
      hasQueuedCommand = false;
      queuedCmdAction = "NONE";
    }
    xSemaphoreGive(stateMutex);
  }

  if (runAction != "NONE" && sensorReady) {
    if (runAction == "ENROLL" && runSlot >= 1 && runSlot <= 1000) {
      executeRemoteEnroll(runSlot, runStudent);
      setIdleSensorLed(true);
    } else if (runAction == "DELETE" && runSlot >= 1 && runSlot <= 1000) {
      executeRemoteDelete(runSlot, runStudent);
      setIdleSensorLed(true);
    } else if (runAction == "CLEAR_ALL") {
      commandInProgress = true;
      finger.emptyDatabase();
      finger.getTemplateCount();
      sendCommandAck("CLEAR_ALL", "COMPLETED", 0, "Sensor memory cleared.");
      commandInProgress = false;
    }
  }

  // Refresh idle OLED screen once any temporary scan/status message expires
  if (messageHoldUntilMs > 0 && now >= messageHoldUntilMs) {
    messageHoldUntilMs = 0;
    showIdleScreen();
  }

  // Smooth dirty-only Vector/EMO eye animation
  animateIdleFace(now);

  // 6-Wire Pro Mode: instant GPIO 4 touch check (2us, zero heat!); 4-Wire fallback: calm 180ms poll
  unsigned long scanIntervalMs = FP_USE_TOUCH_PIN ? 20 : 180;
  if (messageHoldUntilMs == 0 && now - lastFpScanMs >= scanIntervalMs) {
    lastFpScanMs = now;
    scanAndSubmitFingerprint();
  }

  delay(8);
}
