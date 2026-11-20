/*
 * EduStride Biometric Attendance & Gate Entry/Exit Scanner (Clean Remake v2.0)
 *
 * Hardware:
 *   - ESP32-CP2102-TypeC-38Pins
 *   - 0.96" I2C 4-pin SSD1306 OLED (SDA=21, SCL=22, VCC=3V3)
 *   - R307S Optical Fingerprint Sensor (5V->VIN, GND->GND, TXD->GPIO16, RXD->GPIO17, optional TOUCH->GPIO4 & 3.3VT->3V3)
 *   - Buzzer (GPIO 25)
 *
 * Design Principles (Clean Remake):
 *   1. Exact proven Adafruit R307S capture flow (getImage -> image2Tz -> fingerFastSearch).
 *   2. NEVER sends LEDcontrol(false) on idle or OTA (prevents R307S optical LED latching OFF across reboots!).
 *   3. Hybrid Touch + Calm Polling: instant wake on GPIO 4 if TOUCH toggles + calm 160ms cool polling fallback.
 *   4. Zero Wi-Fi / R307S overlap: Core 0 heartbeat (5.5s) never collides with optical capture.
 *   5. Cute Vector/EMO OLED desk-robot eyes with dirty-only rendering & balanced contrast for clean 3.3V power.
 *   6. Built-in Wireless Wi-Fi OTA (ArduinoOTA).
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

#ifndef FP_TOUCH_PIN
#define FP_TOUCH_PIN 4
#endif

// Hardware instances
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
HardwareSerial fpSerial(2); // ESP32 Hardware UART2 (RX=16, TX=17)
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fpSerial);

// Runtime state synced with EduStride backend
volatile bool sensingEnabled = true;
volatile bool prevSensingObserved = true;
volatile bool otaInProgress = false;
volatile bool scanInProgress = false;
volatile bool commandInProgress = false;
volatile bool wifiBusy = false;

bool sensorReady = false;
bool otaInitialized = false;
int touchIdleLevel = HIGH;

String lastServerTime = "--:--";
unsigned long messageHoldUntilMs = 0;
unsigned long lastWifiCheckMs = 0;
unsigned long lastSensorRetryMs = 0;
unsigned long lastFpPollMs = 0;

// Dual-core FreeRTOS sync (Core 0 = HTTPS Heartbeat, Core 1 = R307S + OLED + OTA)
SemaphoreHandle_t netMutex = nullptr;
SemaphoreHandle_t stateMutex = nullptr;
bool hasQueuedCommand = false;
String queuedCmdAction = "NONE";
int queuedCmdSlot = 0;
String queuedCmdStudent = "";

// ============================================================================
// VECTOR / EMO DESK-ROBOT EYE ENGINE (128x64 OLED, Dirty-Only Rendering)
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

float eyeCurX = 0.0f, eyeTargetX = 0.0f;
float eyeCurY = 0.0f, eyeTargetY = 0.0f;
float eyeLeftH = 30.0f, eyeTargetLeftH = 30.0f;
float eyeRightH = 30.0f, eyeTargetRightH = 30.0f;
float eyeLeftW = 30.0f, eyeTargetLeftW = 30.0f;
float eyeRightW = 30.0f, eyeTargetRightW = 30.0f;

int lastDrawnX = 999, lastDrawnY = 999;
int lastDrawnLH = -1, lastDrawnRH = -1, lastDrawnLW = -1, lastDrawnRW = -1;
bool lastDrawnHappy = false;
bool lastDrawnWifi = false;

unsigned long lastFrameMs = 0;
unsigned long nextBlinkMs = 0;
unsigned long nextBehaviorMs = 0;
unsigned long idleHappyUntilMs = 0;
uint8_t blinkPhase = 0;
uint8_t pendingDoubleBlink = 0;
uint8_t sleepZFrame = 0;
unsigned long lastSleepZMs = 0;

FaceMood activeEventMood = FACE_IDLE;
String activeEventCaption = "";

// ============================================================================
// BUZZER HELPERS
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

void beepEntry()    { beepPattern(1, 130, 0, 2400); }
void beepExit()     { beepPattern(2, 100, 90, 2000); }
void beepError()    { beepPattern(1, 400, 0, 900); }
void beepNotice()   { beepPattern(2, 60, 60, 1600); }
void beepEnrollOk() { beepPattern(3, 90, 80, 2600); }

// ============================================================================
// OLED DISPLAY & VECTOR / EMO ROBOT EYES
// ============================================================================
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
  display.clearDisplay();

  // Subtle Wi-Fi connected dot
  if (WiFi.status() == WL_CONNECTED) {
    display.fillCircle(124, 3, 1, SSD1306_WHITE);
  }

  bool hasCaption = caption.length() > 0;
  int baseCenterY = hasCaption ? 25 : 32;

  int lW = max(18, (int)roundf(eyeLeftW));
  int rW = max(18, (int)roundf(eyeRightW));
  int lH = max(3, (int)roundf(eyeLeftH));
  int rH = max(3, (int)roundf(eyeRightH));

  int gx = (int)roundf(eyeCurX);
  int gy = (int)roundf(eyeCurY);
  if (mood == FACE_IDLE && blinkPhase == 0) {
    if (gx < -3)      { lH += 3; rH = max(3, rH - 3); rW = max(18, rW - 2); }
    else if (gx > 3)  { rH += 3; lH = max(3, lH - 3); lW = max(18, lW - 2); }
  }

  int gap = 14;
  int lCx = 64 - (gap / 2) - (lW / 2) + gx;
  int rCx = 64 + (gap / 2) + (rW / 2) + gx;
  int lCy = baseCenterY + gy;
  int rCy = baseCenterY + gy;

  if (mood == FACE_ERROR) {
    int shake = ((now / 70) % 2 == 0) ? -3 : 3;
    lCx += shake;
    rCx += shake;
  } else if (mood == FACE_HAPPY) {
    int bounce = ((now / 160) % 2 == 0) ? -2 : 1;
    lCy += bounce;
    rCy += bounce;
  }

  int lX = lCx - (lW / 2);
  int lY = lCy - (lH / 2);
  int rX = rCx - (rW / 2);
  int rY = rCy - (rH / 2);

  int lRad = min(9, min(lW / 2, lH / 2));
  int rRad = min(9, min(rW / 2, rH / 2));

  switch (mood) {
    case FACE_IDLE:
      display.fillRoundRect(lX, lY, lW, lH, lRad, SSD1306_WHITE);
      display.fillRoundRect(rX, rY, rW, rH, rRad, SSD1306_WHITE);
      if (idleHappyUntilMs > now && blinkPhase == 0 && lH > 18) {
        display.fillRoundRect(lX - 2, lCy + 3, lW + 4, lH, 10, SSD1306_BLACK);
        display.fillRoundRect(rX - 2, rCy + 3, rW + 4, rH, 10, SSD1306_BLACK);
      }
      break;

    case FACE_SLEEPY: {
      int sY = hasCaption ? 28 : 34;
      display.fillRoundRect(22, sY - 5, 34, 12, 6, SSD1306_WHITE);
      display.fillRoundRect(24, sY - 10, 30, 10, 5, SSD1306_BLACK);
      display.fillRoundRect(72, sY - 5, 34, 12, 6, SSD1306_WHITE);
      display.fillRoundRect(74, sY - 10, 30, 10, 5, SSD1306_BLACK);
      display.setTextColor(SSD1306_WHITE);
      display.setTextSize(1);
      int zOff = (sleepZFrame % 4) * 2;
      display.setCursor(98, 16 - zOff); display.print("z");
      display.setCursor(109, 8 - zOff); display.print("Z");
      break;
    }

    case FACE_HAPPY: {
      int hW = 34, hH = 30;
      int hlX = 64 - 7 - hW, hrX = 64 + 7;
      int hY = lCy - (hH / 2);
      display.fillRoundRect(hlX, hY, hW, hH, 11, SSD1306_WHITE);
      display.fillRoundRect(hrX, hY, hW, hH, 11, SSD1306_WHITE);
      display.fillCircle(hlX + hW / 2, hY + hH + 5, 20, SSD1306_BLACK);
      display.fillCircle(hrX + hW / 2, hY + hH + 5, 20, SSD1306_BLACK);
      break;
    }

    case FACE_WINK: {
      int hW = 34, hH = 30;
      int hlX = 64 - 7 - hW, hrX = 64 + 7;
      int hY = lCy - (hH / 2);
      display.fillRoundRect(hlX, hY, hW, hH, 11, SSD1306_WHITE);
      display.fillCircle(hlX + hW / 2, hY + hH + 5, 20, SSD1306_BLACK);
      display.fillRoundRect(hrX, hY - 2, hW, hH + 4, 9, SSD1306_WHITE);
      break;
    }

    case FACE_FOCUSED:
      display.fillRoundRect(lX, lY + 3, lW, lH, lRad, SSD1306_WHITE);
      display.fillRoundRect(rX, rY + 3, rW, rH, rRad, SSD1306_WHITE);
      break;

    case FACE_CHEEKY:
      display.fillRoundRect(lX + 5, lY, lW, 26, 8, SSD1306_WHITE);
      display.fillRoundRect(rX + 5, rY, rW, 26, 8, SSD1306_WHITE);
      display.fillRect(lX + 3, lY - 2, lW + 4, 12, SSD1306_BLACK);
      display.fillRect(rX + 3, rY - 2, rW + 4, 12, SSD1306_BLACK);
      break;

    case FACE_ERROR: {
      int eW = 34, eH = 28;
      int elX = lCx - eW / 2, erX = rCx - eW / 2;
      int eY = lCy - eH / 2;
      display.fillRoundRect(elX, eY, eW, eH, 8, SSD1306_WHITE);
      display.fillRoundRect(erX, eY, eW, eH, 8, SSD1306_WHITE);
      display.fillTriangle(elX, eY - 1, elX + eW + 2, eY - 1, elX + eW + 2, eY + 13, SSD1306_BLACK);
      display.fillTriangle(erX - 2, eY - 1, erX + eW, eY - 1, erX - 2, eY + 13, SSD1306_BLACK);
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

void showOledStatus(const String& header, const String& line1, const String& line2 = "", const String& line3 = "") {
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
  if (!sensorReady) {
    showOledStatus("R307S NOT FOUND", "Check sensor wires", "5V->VIN  GND->GND", "TXD->16  RXD->17");
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    renderRoboEyes(FACE_FOCUSED, "Wi-Fi Reconnecting...", millis());
    return;
  }
  if (!sensingEnabled) {
    renderRoboEyes(FACE_SLEEPY, "PAUSED IN APP", millis());
  } else {
    renderRoboEyes(FACE_IDLE, "", millis());
  }
}

void animateIdleFace(unsigned long now) {
  if (otaInProgress || !sensorReady) return;

  if (messageHoldUntilMs > 0) {
    if (now - lastFrameMs >= 95) {
      lastFrameMs = now;
      renderRoboEyes(activeEventMood, activeEventCaption, now);
    }
    return;
  }

  if (WiFi.status() != WL_CONNECTED) return;

  if (!sensingEnabled) {
    if (now - lastSleepZMs >= 650) {
      lastSleepZMs = now;
      sleepZFrame = (sleepZFrame + 1) % 8;
      renderRoboEyes(FACE_SLEEPY, "PAUSED IN APP", now);
    }
    return;
  }

  if (now - lastFrameMs < 55) return;
  lastFrameMs = now;

  // Natural blinks
  if (blinkPhase == 0 && now >= nextBlinkMs) {
    blinkPhase = 1;
    eyeTargetLeftH = 3.0f; eyeTargetRightH = 3.0f;
    eyeTargetLeftW = 35.0f; eyeTargetRightW = 35.0f;
    if ((now % 4) == 0) pendingDoubleBlink = 1;
  }
  if (blinkPhase == 1 && eyeLeftH <= 6.0f && eyeRightH <= 6.0f) {
    blinkPhase = 2;
    eyeTargetLeftH = 30.0f; eyeTargetRightH = 30.0f;
    eyeTargetLeftW = 30.0f; eyeTargetRightW = 30.0f;
  } else if (blinkPhase == 2 && eyeLeftH >= 28.0f && eyeRightH >= 28.0f) {
    blinkPhase = 0;
    eyeLeftH = 30.0f; eyeRightH = 30.0f;
    eyeLeftW = 30.0f; eyeRightW = 30.0f;
    if (pendingDoubleBlink > 0) {
      pendingDoubleBlink = 0;
      nextBlinkMs = now + 180;
    } else {
      nextBlinkMs = now + 3000 + (now % 3200);
    }
  }

  // Curious glances
  if (blinkPhase == 0 && now >= nextBehaviorMs) {
    nextBehaviorMs = now + 3000 + (now % 3000);
    eyeTargetLeftW = 30.0f; eyeTargetRightW = 30.0f;
    eyeTargetLeftH = 30.0f; eyeTargetRightH = 30.0f;
    switch ((now / 37) % 10) {
      case 0: case 1: eyeTargetX = 0.0f;   eyeTargetY = 0.0f;  break;
      case 2:         eyeTargetX = -12.0f; eyeTargetY = -1.0f; break;
      case 3:         eyeTargetX = 12.0f;  eyeTargetY = -1.0f; break;
      case 4:         eyeTargetX = -9.0f;  eyeTargetY = -6.0f; break;
      case 5:         eyeTargetX = 9.0f;   eyeTargetY = -6.0f; break;
      case 6:         eyeTargetX = 0.0f;   eyeTargetY = 6.0f;  break;
      case 7:         eyeTargetX = -4.0f;  eyeTargetY = -2.0f; eyeTargetLeftH = 35.0f; eyeTargetRightH = 22.0f; break;
      case 8:         eyeTargetX = 4.0f;   eyeTargetY = -2.0f; eyeTargetLeftH = 22.0f; eyeTargetRightH = 35.0f; break;
      case 9:         eyeTargetX = 0.0f;   eyeTargetY = -2.0f; idleHappyUntilMs = now + 1500; break;
    }
  }

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

  int curX = (int)roundf(eyeCurX), curY = (int)roundf(eyeCurY);
  int curLH = (int)roundf(eyeLeftH), curRH = (int)roundf(eyeRightH);
  int curLW = (int)roundf(eyeLeftW), curRW = (int)roundf(eyeRightW);
  bool curHappy = (idleHappyUntilMs > now && blinkPhase == 0 && curLH > 18);
  bool curWifi = (WiFi.status() == WL_CONNECTED);

  // Dirty-only optimization: zero I2C traffic when eyes are resting!
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

// ============================================================================
// HTTP / HTTPS CLIENT (Thread-safe via netMutex + wifiBusy flag)
// ============================================================================
int performHttpRequest(const String& method, const String& path, const String& jsonBody, String& responseOut) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  if (netMutex && xSemaphoreTake(netMutex, pdMS_TO_TICKS(9000)) != pdTRUE) return -3;

  wifiBusy = true;

  String baseUrl = String(SERVER_BASE_URL);
  while (baseUrl.endsWith("/")) baseUrl.remove(baseUrl.length() - 1);
  String fullUrl = baseUrl + path;

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);

  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  bool began = false;

  if (fullUrl.startsWith("https://") || fullUrl.startsWith("HTTPS://")) {
    secureClient.setInsecure();
    began = http.begin(secureClient, fullUrl);
  } else {
    began = http.begin(plainClient, fullUrl);
  }

  int httpCode = -2;
  if (began) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-device-key", DEVICE_API_KEY);
    httpCode = (method == "POST") ? http.POST(jsonBody) : http.GET();
    if (httpCode > 0) responseOut = http.getString();
    http.end();
  }

  wifiBusy = false;
  if (netMutex) xSemaphoreGive(netMutex);
  return httpCode;
}

void sendCommandAck(const String& action, const String& status, int slotId, const String& message) {
  StaticJsonDocument<256> doc;
  doc["action"] = action;
  doc["status"] = status;
  if (slotId > 0) doc["slot_id"] = slotId;
  doc["message"] = message;
  String payload, resp;
  serializeJson(doc, payload);
  performHttpRequest("POST", "/api/biometric/device/command-ack", payload, resp);
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
  finger.getTemplateCount();

  // Clear any previously latched LED-OFF state from older firmware — NEVER call LEDcontrol(false)!
  finger.LEDcontrol(true);
  delay(30);

  Serial.printf("[R307S] Sensor READY! Capacity=%d | Security=%d | Templates=%d\n",
                finger.capacity, finger.security_level, finger.templateCount);
  return true;
}

uint8_t searchStoredTemplates() {
  if (finger.templateCount <= 160) {
    return finger.fingerFastSearch();
  }
  return finger.fingerSearch();
}

// ============================================================================
// OFFICIAL ADAFRUIT R307S ENROLLMENT FLOW (Clean, Direct, Proven)
// ============================================================================
uint8_t waitAndCaptureBuffer(uint8_t bufferSlot, unsigned long timeoutMs) {
  unsigned long startMs = millis();
  uint8_t lastErr = FINGERPRINT_NOFINGER;

  while (millis() - startMs < timeoutMs) {
    uint8_t p = finger.getImage();
    if (p == FINGERPRINT_OK) {
      uint8_t tz = finger.image2Tz(bufferSlot);
      if (tz == FINGERPRINT_OK) {
        return FINGERPRINT_OK;
      }
      lastErr = tz;
      Serial.printf("[ENROLL] image2Tz(%d) -> 0x%02X (retrying)\n", bufferSlot, tz);
    } else if (p != FINGERPRINT_NOFINGER) {
      lastErr = p;
      Serial.printf("[ENROLL] getImage() -> 0x%02X\n", p);
    }
    if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
    delay(60);
  }
  return lastErr;
}

void executeRemoteEnroll(int slotId, const String& studentName) {
  commandInProgress = true;
  Serial.printf("[ENROLL] Slot #%d -> %s\n", slotId, studentName.c_str());

  // Make sure no stray UART bytes exist and backlight is enabled
  while (fpSerial.available()) fpSerial.read();
  finger.LEDcontrol(true);

  sendCommandAck("ENROLL", "IN_PROGRESS", slotId, "Place finger flat on sensor (Step 1/2)...");
  showOledStatus("ENROLL SLOT #" + String(slotId), studentName, "Place Finger (1/2)", "Press flat & hold");
  beepNotice();

  // Step 1: Capture into Buffer 1
  uint8_t err1 = waitAndCaptureBuffer(1, ENROLL_STEP_TIMEOUT_MS);
  if (err1 != FINGERPRINT_OK) {
    String errHex = String(err1, HEX);
    showOledStatus("STEP 1 FAILED", studentName, "R307S err: 0x" + errHex, "Check power & retry");
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Step 1 failed (R307S code 0x" + errHex + "). Please retry.");
    messageHoldUntilMs = millis() + 3000;
    commandInProgress = false;
    return;
  }

  // Step 2: Up to 3 clean attempts while preserving Buffer 1
  bool matched = false;
  uint8_t lastErr = 0;

  for (int attempt = 1; attempt <= 3; attempt++) {
    beepEntry();
    showOledStatus("ENROLL SLOT #" + String(slotId),
                   attempt == 1 ? "Step 1 OK!" : ("Retry Step 2 (" + String(attempt) + "/3)"),
                   "REMOVE FINGER", "Wait a moment...");
    sendCommandAck("ENROLL", "IN_PROGRESS", slotId,
                   attempt == 1
                     ? "Step 1 captured! Lift finger, then place SAME finger again (Step 2/2)..."
                     : ("Slight mismatch — lift & place SAME finger flat again (Try " + String(attempt) + "/3)..."));

    // Standard Adafruit lift-wait using optical sensor itself (never fooled by Touch pin!)
    delay(1500);
    unsigned long liftStart = millis();
    while (finger.getImage() != FINGERPRINT_NOFINGER && millis() - liftStart < 10000) {
      delay(60);
    }

    showOledStatus("ENROLL SLOT #" + String(slotId), studentName, "Place SAME Finger", "Step 2 of 2...");
    uint8_t err2 = waitAndCaptureBuffer(2, ENROLL_STEP_TIMEOUT_MS);
    if (err2 != FINGERPRINT_OK) {
      lastErr = err2;
      continue;
    }

    lastErr = finger.createModel();
    Serial.printf("[ENROLL] createModel try %d -> 0x%02X\n", attempt, lastErr);
    if (lastErr == FINGERPRINT_OK) {
      matched = true;
      break;
    }

    beepError();
    delay(350);
  }

  if (!matched) {
    String errHex = String(lastErr, HEX);
    showOledStatus("NO MATCH (0x" + errHex + ")", "Fingers did not", "match! Clean glass", "& retry from App");
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Finger scans did not match after 3 tries (code 0x" + errHex + ").");
    messageHoldUntilMs = millis() + 3500;
    commandInProgress = false;
    return;
  }

  uint8_t storeErr = finger.storeModel(slotId);
  if (storeErr != FINGERPRINT_OK) {
    String errHex = String(storeErr, HEX);
    showOledStatus("SAVE ERROR", "Slot #" + String(slotId), "Code: 0x" + errHex, "");
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Failed saving template to R307S flash (code 0x" + errHex + ").");
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
  showOledStatus("REMOVING PRINT", studentName, "Clearing Slot #" + String(slotId), "");
  uint8_t p = finger.deleteModel(slotId);
  if (p == FINGERPRINT_OK) {
    finger.getTemplateCount();
    sendCommandAck("DELETE", "COMPLETED", slotId, "Deleted Slot #" + String(slotId) + " from sensor.");
    showOledStatus("REMOVED", studentName, "Slot #" + String(slotId) + " freed", "");
    beepNotice();
  } else {
    sendCommandAck("DELETE", "FAILED", slotId, "Failed to erase slot (code 0x" + String(p, HEX) + ").");
    beepError();
  }
  messageHoldUntilMs = millis() + 2500;
  commandInProgress = false;
}

// ============================================================================
// CORE 0 BACKGROUND HEARTBEAT (Calm 5.5s interval, never blocks scanning!)
// ============================================================================
void pollServerStatus() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (otaInProgress || scanInProgress || commandInProgress) return;

  String path = "/api/biometric/device/status?firmware=" + String(FIRMWARE_VERSION)
              + "&templates=" + String(finger.templateCount)
              + "&ip=" + WiFi.localIP().toString();

  String response;
  int code = performHttpRequest("GET", path, "", response);
  if (code != 200) return;

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, response)) return;

  bool newSensing = doc["sensing_enabled"] | true;
  String newTime = doc["server_time_ist"].is<const char*>() ? doc["server_time_ist"].as<String>() : "";

  JsonObject cmd = doc["pending_command"];
  String cmdAction = "NONE", cmdStatus = "IDLE", cmdStudent = "Student";
  int cmdSlot = 0;
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
    vTaskDelay(pdMS_TO_TICKS(5500));
  }
}

// ============================================================================
// FINGERPRINT SCAN & SERVER SUBMISSION (Core 1 — Exact Adafruit Flow!)
// ============================================================================
void scanAndSubmitFingerprint() {
  if (!sensorReady || !sensingEnabled || WiFi.status() != WL_CONNECTED) return;
  if (wifiBusy) return; // Never read R307S during a Wi-Fi TX burst

  scanInProgress = true;

  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK) {
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
    // 1 quick retry 110ms later in case first touch was still settling
    delay(110);
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

  if (matchedSlot < 0) {
    drawCuteFace(FACE_ERROR, "Unknown! Try Again");
    beepError();
    messageHoldUntilMs = millis() + 1800;
    unsigned long lw = millis();
    while (finger.getImage() != FINGERPRINT_NOFINGER && millis() - lw < 1500) delay(50);
    scanInProgress = false;
    return;
  }

  Serial.printf("[SCAN] Matched Slot #%d (confidence %d)\n", matchedSlot, confidence);
  drawCuteFace(FACE_FOCUSED, "Syncing Slot #" + String(matchedSlot));

  StaticJsonDocument<128> reqDoc;
  reqDoc["slot_id"] = matchedSlot;
  reqDoc["confidence"] = confidence;
  String reqPayload, respStr;
  serializeJson(reqDoc, reqPayload);

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
    showIdleScreen();
    beepNotice();
  } else {
    String msg = respDoc["message"] | "Unassigned Slot";
    drawCuteFace(FACE_ERROR, msg.substring(0, 21));
    beepError();
    messageHoldUntilMs = millis() + 2400;
  }

  // Wait for finger lift so same press doesn't re-trigger
  unsigned long liftWait = millis();
  while (finger.getImage() != FINGERPRINT_NOFINGER && millis() - liftWait < 2000) {
    delay(50);
  }
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
    messageHoldUntilMs = millis() + 3000;
  });

  ArduinoOTA.begin();
  otaInitialized = true;
  Serial.printf("[OTA] Ready! %s.local | IP: %s | Port: %d\n",
                OTA_HOSTNAME, WiFi.localIP().toString().c_str(), OTA_PORT);
}

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
    delay(1000);
  } else {
    showOledStatus("WI-FI FAILED", "Check 2.4GHz SSID", "& Password in", "config.h");
    beepError();
    messageHoldUntilMs = millis() + 3000;
  }
}

// ============================================================================
// SETUP & MAIN LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== EduStride Gate Scanner v2.0 (Clean Remake) ===");

  pinMode(BUZZER_PIN, OUTPUT);
  buzzerOff();

  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  if (display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    display.ssd1306_command(SSD1306_SETCONTRAST);
    display.ssd1306_command(0x55);
    showOledStatus("EDUSTRIDE GATE", "Clean Remake v2.0", "Init R307S Sensor...", "");
  }

  netMutex = xSemaphoreCreateMutex();
  stateMutex = xSemaphoreCreateMutex();

  calibrateTouchPin();
  fpSerial.begin(FP_BAUD_RATE, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  delay(300);
  finger.begin(FP_BAUD_RATE);

  if (!initR307Sensor()) {
    Serial.println("[R307S] Sensor NOT detected! Check 5V->VIN, GND, TXD->16, RXD->17.");
    showOledStatus("R307S NOT FOUND", "Check sensor wires", "5V->VIN  GND->GND", "TXD->16  RXD->17");
    beepError();
    delay(2500);
  }

  ensureWifiConnected();
  pollServerStatus();
  prevSensingObserved = sensingEnabled;

  xTaskCreatePinnedToCore(heartbeatTask, "HeartbeatTask", 8192, nullptr, 1, nullptr, 0);

  nextBlinkMs = millis() + 2000;
  nextBehaviorMs = millis() + 3000;
  showIdleScreen();
}

void loop() {
  if (otaInitialized && WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
  if (otaInProgress) { delay(5); return; }

  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED && now - lastWifiCheckMs > 15000) {
    lastWifiCheckMs = now;
    ensureWifiConnected();
  }

  if (!sensorReady && now - lastSensorRetryMs >= 5000) {
    lastSensorRetryMs = now;
    if (initR307Sensor()) {
      showIdleScreen();
    }
  }

  if (prevSensingObserved != sensingEnabled) {
    prevSensingObserved = sensingEnabled;
    beepNotice();
    messageHoldUntilMs = 0;
    showIdleScreen();
  }

  // Execute queued remote ENROLL / DELETE / CLEAR_ALL command safely on Core 1
  String runAction = "NONE", runStudent = "";
  int runSlot = 0;
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
    } else if (runAction == "DELETE" && runSlot >= 1 && runSlot <= 1000) {
      executeRemoteDelete(runSlot, runStudent);
    } else if (runAction == "CLEAR_ALL") {
      commandInProgress = true;
      finger.emptyDatabase();
      finger.getTemplateCount();
      sendCommandAck("CLEAR_ALL", "COMPLETED", 0, "Sensor memory cleared.");
      commandInProgress = false;
    }
  }

  if (messageHoldUntilMs > 0 && now >= messageHoldUntilMs) {
    messageHoldUntilMs = 0;
    showIdleScreen();
  }

  animateIdleFace(now);

  // Hybrid Scan Trigger: instant wake if GPIO 4 Touch triggers OR calm 160ms cool polling!
  if (messageHoldUntilMs == 0) {
    bool touchWake = touchPinTriggered();
    if (touchWake || (now - lastFpPollMs >= 160)) {
      lastFpPollMs = now;
      scanAndSubmitFingerprint();
    }
  }

  delay(10);
}
