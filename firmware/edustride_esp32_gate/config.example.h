#ifndef EDUSTRIDE_GATE_CONFIG_H
#define EDUSTRIDE_GATE_CONFIG_H

// ============================================================================
// 1. WI-FI SETTINGS (ESP32 supports 2.4 GHz Wi-Fi networks ONLY)
//    Copy this file to config.h and fill in your real credentials.
// ============================================================================
#define WIFI_SSID        "YOUR_2.4GHZ_WIFI_NAME"
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"

// ============================================================================
// 2. EDUSTRIDE BACKEND SERVER & DEVICE CREDENTIALS
//    Copy SERVER_BASE_URL, DEVICE_ID, and DEVICE_API_KEY from the EduStride
//    Mobile App -> Gate Scanner -> "ESP32 Setup Credentials"
// ============================================================================
#define SERVER_BASE_URL  "https://api.edustride.in"
#define DEVICE_ID        "GATE-ESP32-01"
#define DEVICE_API_KEY   "PASTE_API_KEY_FROM_EDUSTRIDE_APP"

// ============================================================================
// 3. SAFE NON-STRAPPING GPIO PINOUT (ESP32-CP2102-TypeC-38Pins)
// ============================================================================
#define OLED_SDA_PIN     21
#define OLED_SCL_PIN     22
#define OLED_I2C_ADDR    0x3C
#define SCREEN_WIDTH     128
#define SCREEN_HEIGHT    64

#define FP_RX_PIN        16
#define FP_TX_PIN        17
#define FP_TOUCH_PIN     4      // R307S Pin 5 (TOUCH / WAKEUP) -> GPIO 4
#define FP_USE_TOUCH_PIN true   // 6-Wire Pro Mode (zero heat, instant touch wake!)
#define FP_BAUD_RATE     57600

#define BUZZER_PIN       25
#define BUZZER_IS_ACTIVE true

// ============================================================================
// 4. WI-FI OTA (OVER-THE-AIR WIRELESS FLASHING) SETTINGS
// ============================================================================
#define OTA_HOSTNAME             "edustride-gate"
#define OTA_PASSWORD             "edustride-ota-2026"
#define OTA_PORT                 3232

// ============================================================================
// 5. TIMING, TLS & FIRMWARE METADATA
// ============================================================================
#define FIRMWARE_VERSION         "2.3.0-ota"
#define HEARTBEAT_INTERVAL_MS    5500   // Calm 5.5s interval keeps 3.3V rail quiet for R307S
#define HTTP_TIMEOUT_MS          12000  // Handles cloud cold-starts cleanly
#define ENROLL_STEP_TIMEOUT_MS   25000

// Set to true ONLY for local self-signed HTTPS development servers.
// Production (https://api.edustride.in) uses built-in Root CA verification (ISRG / GTS / DigiCert).
#define ALLOW_INSECURE_TLS       false

#endif
