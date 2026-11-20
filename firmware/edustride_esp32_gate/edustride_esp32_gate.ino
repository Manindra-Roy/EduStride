/*
 * EduStride Biometric Attendance & Gate Entry/Exit Scanner
 * Hardware:
 *   - ESP32-CP2102-TypeC-38Pins
 *   - 0.96" I2C 4-pin SSD1306 OLED (SDA=21, SCL=22, VCC=3V3)
 *   - R307S Optical Fingerprint Sensor (TXD->GPIO16, RXD->GPIO17, VCC=3V3)
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

// Hardware objects
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
HardwareSerial fpSerial(2); // ESP32 Hardware UART2
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fpSerial);

// Runtime state synced wirelessly with EduStride backend
bool sensingEnabled = true;
bool sensorReady = false;
bool ledCurrentlyOn = false;
bool otaInitialized = false;
bool otaInProgress = false;
String lastServerTime = "--:--";
unsigned long lastHeartbeatMs = 0;
unsigned long messageHoldUntilMs = 0;
unsigned long lastWifiCheckMs = 0;

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
// OLED DISPLAY HELPERS
// ============================================================================
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
  if (!sensorReady) {
    showOledStatus("EDUSTRIDE GATE", "SENSOR ERROR!", "Check R307S Wiring", "TX->16 RX->17 3V3");
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    showOledStatus("EDUSTRIDE GATE", "Wi-Fi Offline", "Reconnecting...", WIFI_SSID);
    return;
  }
  if (!sensingEnabled) {
    showOledStatus("EDUSTRIDE GATE", "SENSING PAUSED", "Turned OFF in App", "Time: " + lastServerTime);
  } else {
    showOledStatus("EDUSTRIDE GATE", "READY - SCAN FINGER", "Place finger gently", "Time: " + lastServerTime);
  }
}

void setSensorLed(bool on) {
  if (!sensorReady) return;
  if (ledCurrentlyOn != on) {
    finger.LEDcontrol(on);
    ledCurrentlyOn = on;
  }
}

// ============================================================================
// HTTP / HTTPS CLIENT HELPER (Works with both local HTTP and Render HTTPS)
// ============================================================================
bool isHttpsUrl(const String& url) {
  return url.startsWith("https://") || url.startsWith("HTTPS://");
}

int performHttpRequest(const String& method, const String& path, const String& jsonBody, String& responseOut) {
  if (WiFi.status() != WL_CONNECTED) return -1;

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

  if (!began) return -2;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-device-key", DEVICE_API_KEY);

  int httpCode = -1;
  if (method == "GET") {
    httpCode = http.GET();
  } else if (method == "POST") {
    httpCode = http.POST(jsonBody);
  }

  if (httpCode > 0) {
    responseOut = http.getString();
  }
  http.end();
  return httpCode;
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
// REMOTE FINGERPRINT ENROLLMENT & DELETION (Triggered from Mobile App)
// ============================================================================
void executeRemoteEnroll(int slotId, const String& studentName) {
  Serial.printf("[ENROLL] Starting slot #%d for %s\n", slotId, studentName.c_str());
  setSensorLed(true);
  sendCommandAck("ENROLL", "IN_PROGRESS", slotId, "Place finger on sensor (Step 1/2)...");
  showOledStatus("ENROLL SLOT #" + String(slotId), studentName, "Place Finger (1/2)", "Hold steady...");
  beepNotice();

  // Step 1: Wait for first finger placement
  unsigned long startWait = millis();
  int p = -1;
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (millis() - startWait > ENROLL_STEP_TIMEOUT_MS) {
      showOledStatus("ENROLL TIMEOUT", studentName, "No finger detected", "Try again in App");
      beepError();
      sendCommandAck("ENROLL", "FAILED", slotId, "Timed out waiting for first finger placement.");
      messageHoldUntilMs = millis() + 3000;
      return;
    }
    delay(60);
  }

  if (finger.image2Tz(1) != FINGERPRINT_OK) {
    showOledStatus("ENROLL FAILED", "Poor finger image", "Clean & retry", "");
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Could not capture clear first fingerprint image.");
    messageHoldUntilMs = millis() + 3000;
    return;
  }

  // Ask student to lift finger
  beepEntry();
  showOledStatus("ENROLL SLOT #" + String(slotId), "Step 1 Captured!", "REMOVE FINGER", "Wait a moment...");
  sendCommandAck("ENROLL", "IN_PROGRESS", slotId, "First scan captured! Lift finger, then place again (Step 2/2)...");

  delay(1200);
  startWait = millis();
  while (finger.getImage() != FINGERPRINT_NOFINGER) {
    if (millis() - startWait > 10000) break;
    delay(60);
  }

  // Step 2: Wait for second placement of same finger
  showOledStatus("ENROLL SLOT #" + String(slotId), studentName, "Place SAME Finger", "Step 2 of 2...");
  startWait = millis();
  p = -1;
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (millis() - startWait > ENROLL_STEP_TIMEOUT_MS) {
      showOledStatus("ENROLL TIMEOUT", studentName, "Step 2 timed out", "Retry from App");
      beepError();
      sendCommandAck("ENROLL", "FAILED", slotId, "Timed out waiting for second finger placement.");
      messageHoldUntilMs = millis() + 3000;
      return;
    }
    delay(60);
  }

  if (finger.image2Tz(2) != FINGERPRINT_OK) {
    showOledStatus("ENROLL FAILED", "Step 2 image error", "Retry from App", "");
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Could not capture clear second fingerprint image.");
    messageHoldUntilMs = millis() + 3000;
    return;
  }

  if (finger.createModel() != FINGERPRINT_OK) {
    showOledStatus("NO MATCH", "Fingers did not", "match! Retry", "");
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Two finger scans did not match. Please retry.");
    messageHoldUntilMs = millis() + 3000;
    return;
  }

  if (finger.storeModel(slotId) != FINGERPRINT_OK) {
    showOledStatus("STORAGE ERROR", "Could not save", "Slot #" + String(slotId), "");
    beepError();
    sendCommandAck("ENROLL", "FAILED", slotId, "Failed writing fingerprint model to R307S flash.");
    messageHoldUntilMs = millis() + 3000;
    return;
  }

  finger.getTemplateCount();
  showOledStatus("ENROLLED OK!", studentName, "Saved in Slot #" + String(slotId), "Ready to scan");
  beepEnrollOk();
  sendCommandAck("ENROLL", "COMPLETED", slotId, "Successfully enrolled " + studentName + " in Slot #" + String(slotId) + "!");
  messageHoldUntilMs = millis() + 3500;
}

void executeRemoteDelete(int slotId, const String& studentName) {
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
}

// ============================================================================
// HEARTBEAT SYNC WITH BACKEND (Polls every 2s)
// ============================================================================
void pollServerStatus() {
  if (WiFi.status() != WL_CONNECTED) return;

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

  bool prevSensing = sensingEnabled;
  sensingEnabled = doc["sensing_enabled"] | true;
  if (doc["server_time_ist"].is<const char*>()) {
    lastServerTime = doc["server_time_ist"].as<String>();
  }

  // Hardware LED safety: immediately power off optical LED when paused from mobile app
  setSensorLed(sensingEnabled);

  if (prevSensing != sensingEnabled) {
    beepNotice();
    messageHoldUntilMs = 0; // Immediately update OLED
    showIdleScreen();
  }

  // Check for remote ENROLL / DELETE / CLEAR_ALL command from mobile app
  JsonObject cmd = doc["pending_command"];
  if (!cmd.isNull()) {
    String action = cmd["action"] | "NONE";
    String status = cmd["status"] | "IDLE";
    int slotId = cmd["slot_id"] | 0;
    String studentName = cmd["student_name"] | "Student";

    if (status == "PENDING" && sensorReady) {
      if (action == "ENROLL" && slotId >= 1 && slotId <= 1000) {
        executeRemoteEnroll(slotId, studentName);
        setSensorLed(sensingEnabled);
      } else if (action == "DELETE" && slotId >= 1 && slotId <= 1000) {
        executeRemoteDelete(slotId, studentName);
        setSensorLed(sensingEnabled);
      } else if (action == "CLEAR_ALL") {
        finger.emptyDatabase();
        finger.getTemplateCount();
        sendCommandAck("CLEAR_ALL", "COMPLETED", 0, "Sensor memory cleared.");
      }
    }
  }
}

// ============================================================================
// FINGERPRINT SCAN & SERVER SUBMISSION
// ============================================================================
void scanAndSubmitFingerprint() {
  if (!sensorReady || !sensingEnabled || WiFi.status() != WL_CONNECTED) return;

  uint8_t p = finger.getImage();
  if (p == FINGERPRINT_NOFINGER) return;
  if (p != FINGERPRINT_OK) return;

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) return;

  p = finger.fingerFastSearch();
  if (p == FINGERPRINT_NOTFOUND) {
    showOledStatus("NOT RECOGNIZED", "Unknown Finger", "Please try again", "or enroll in App");
    beepError();
    messageHoldUntilMs = millis() + 2200;
    return;
  }
  if (p != FINGERPRINT_OK) return;

  int matchedSlot = finger.fingerID;
  int confidence = finger.confidence;
  Serial.printf("[SCAN] Matched Slot #%d (confidence %d)\n", matchedSlot, confidence);

  showOledStatus("VERIFYING...", "Slot #" + String(matchedSlot), "Syncing EduStride", "Please wait...");

  StaticJsonDocument<128> reqDoc;
  reqDoc["slot_id"] = matchedSlot;
  reqDoc["confidence"] = confidence;

  String reqPayload;
  serializeJson(reqDoc, reqPayload);

  String respStr;
  int httpCode = performHttpRequest("POST", "/api/biometric/device/scan", reqPayload, respStr);

  if (httpCode <= 0) {
    showOledStatus("NETWORK ERROR", "Server unreachable", "Check Wi-Fi/URL", "");
    beepError();
    messageHoldUntilMs = millis() + 2800;
    return;
  }

  StaticJsonDocument<512> respDoc;
  if (deserializeJson(respDoc, respStr)) {
    showOledStatus("SERVER ERROR", "Invalid response", "HTTP " + String(httpCode), "");
    beepError();
    messageHoldUntilMs = millis() + 2500;
    return;
  }

  String status = respDoc["status"] | "ERROR";
  String studentName = respDoc["student_name"] | "";
  String classLevel = respDoc["class_level"] | "";
  String eventType = respDoc["event_type"] | "";
  String timeStr = respDoc["time_str"] | lastServerTime;

  if (status == "OK") {
    if (eventType == "ENTRY") {
      showOledStatus("ENTRY LOGGED", studentName, "Class " + classLevel + " - Present", "In: " + timeStr);
      beepEntry();
    } else {
      int durMins = respDoc["duration_minutes"] | -1;
      String durText = durMins >= 0 ? ("Stay: " + String(durMins) + "m") : ("Out: " + timeStr);
      showOledStatus("EXIT LOGGED", studentName, "Out: " + timeStr, durText);
      beepExit();
    }
    messageHoldUntilMs = millis() + 3500;
  } else if (status == "COOLDOWN") {
    int waitSec = respDoc["wait_seconds"] | 0;
    showOledStatus("ALREADY SCANNED", studentName, "Wait " + String(waitSec) + "s before", "scanning again");
    beepNotice();
    messageHoldUntilMs = millis() + 2500;
  } else if (status == "PAUSED") {
    sensingEnabled = false;
    setSensorLed(false);
    showIdleScreen();
    beepNotice();
  } else {
    String msg = respDoc["message"] | "Unassigned Slot";
    showOledStatus("SCAN REJECTED", "Slot #" + String(matchedSlot), msg.substring(0, 21), "");
    beepError();
    messageHoldUntilMs = millis() + 2800;
  }

  // Wait briefly until finger is removed so the same placement doesn't immediately re-trigger
  unsigned long liftWait = millis();
  while (finger.getImage() != FINGERPRINT_NOFINGER && millis() - liftWait < 3000) {
    delay(60);
  }
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
    showOledStatus("EDUSTRIDE GATE", "Booting v" + String(FIRMWARE_VERSION), "Init R307S Sensor...", "");
  }

  // 3. Init R307S Fingerprint Sensor on UART2 (GPIO16=RX2, GPIO17=TX2)
  fpSerial.begin(FP_BAUD_RATE, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  delay(250);
  finger.begin(FP_BAUD_RATE);

  if (finger.verifyPassword()) {
    sensorReady = true;
    finger.getTemplateCount();
    Serial.printf("[R307S] Sensor OK! Stored templates: %d\n", finger.templateCount);
    setSensorLed(true);
  } else {
    sensorReady = false;
    Serial.println("[R307S] Sensor NOT detected! Check VCC(3V3), GND, TXD->GPIO16, RXD->GPIO17.");
    showOledStatus("R307S NOT FOUND", "Check sensor wires", "TXD->16  RXD->17", "VCC->3V3 GND->GND");
    beepError();
    delay(2500);
  }

  // 4. Connect 2.4GHz Wi-Fi & Perform First Sync
  ensureWifiConnected();
  pollServerStatus();
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

  // Poll backend every 2 seconds for remote ON/OFF switch & enroll/delete commands
  if (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatMs = now;
    pollServerStatus();
  }

  // Refresh idle OLED screen once any temporary scan/status message expires
  if (messageHoldUntilMs > 0 && now >= messageHoldUntilMs) {
    messageHoldUntilMs = 0;
    showIdleScreen();
  } else if (messageHoldUntilMs == 0) {
    // Only scan when not displaying a recent result message and sensing is ON
    scanAndSubmitFingerprint();
  }

  delay(40);
}
