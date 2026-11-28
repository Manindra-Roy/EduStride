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
#define SERVER_BASE_URL      "https://api.edustride.in"
// Optional local LAN dev fallback (auto-failover if cloud is unreachable; leave "" to disable)
#define SERVER_FALLBACK_URL  ""
#define DEVICE_ID            "GATE-ESP32-01"
#define DEVICE_API_KEY       "PASTE_API_KEY_FROM_EDUSTRIDE_APP"

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
#define BUZZER_ACTIVE_LOW false // Set to true for active-LOW 3-pin buzzer modules (e.g. KY-012 / HW-508)

// ============================================================================
// 3B. MOTORIZED CABINET TRAY ACTUATOR v3.0 (Live-Selectable 3 Modes in App!)
//     Mode 0 (LIMIT_360): SG90/MG90S 360° + 2 Mouse Microswitches (GPIO 26 & 27)
//     Mode 1 (TIMED_360): SG90/MG90S 360° Timed Open/Close + NVS Memory
//     Mode 2 (ANGLE_180): SG90/MG90S 180° Positional Servo with Smooth Sweep
//     CRITICAL: Power Servo Red (VCC) from 5.00V Buck OUT+ (NEVER from 3V3!).
// ============================================================================
#define SERVO_ENABLED            true   // Set false to disable motorized tray
#define SERVO_PIN                18     // Safe non-strapping PWM GPIO (Orange/Yellow wire)
#define SERVO_DEFAULT_MODE       0      // 0=LIMIT_360 (Mouse Switches), 1=TIMED_360, 2=ANGLE_180
#define SERVO_SPEED_PCT          80     // 360° motor speed (20..100%; smooth & protective for plastic gears)
#define SERVO_STOP_US            1500   // Neutral stop pulse (1350..1650, tunable live in App)
#define SERVO_INVERT_DIRECTION   false  // Flip true if open/close directions are swapped on your mount
#define SERVO_OPEN_MS            1060   // TIMED_360 fallback: ~720° (2 full rounds)
#define SERVO_CLOSE_MS           1060   // TIMED_360 fallback: ~720° (2 full rounds)
#define SERVO_CLOSED_ANGLE       10     // ANGLE_180 mode: retracted angle (0..180 deg)
#define SERVO_OPEN_ANGLE         110    // ANGLE_180 mode: extended angle (0..180 deg)
#define SERVO_SWEEP_DPS          120    // ANGLE_180 mode: smooth sweep speed (deg/sec)
#define SERVO_MAX_RUN_MS         4500   // LIMIT_360 hard jam-protection timeout (ms -> FAULT)
#define SERVO_AUTO_HOME_ON_BOOT  false  // Set true to auto-home to CLOSED switch on boot

// Mouse Microswitch Endstops (Pin 1 COM -> GND, Pin 2 Middle NO -> GPIO, uses INPUT_PULLUP)
#define SERVO_LIMIT_CLOSED_PIN   26     // Triggered (LOW) when tray clicks CLOSED mouse switch
#define SERVO_LIMIT_OPEN_PIN     27     // Triggered (LOW) when tray clicks OPEN mouse switch
#define SERVO_LIMIT_ACTIVE_LOW   true

// ============================================================================
// 4. WI-FI OTA (OVER-THE-AIR WIRELESS FLASHING) SETTINGS
// ============================================================================
#define OTA_HOSTNAME             "edustride-gate"
#define OTA_PASSWORD             "CHANGE_ME_STRONG_OTA_PASSWORD"
#define OTA_PORT                 3232

// ============================================================================
// 5. TIMING, TLS & FIRMWARE METADATA
// ============================================================================
#define FIRMWARE_VERSION         "3.1.2-ota"
#define HEARTBEAT_INTERVAL_MS    5500   // Calm 5.5s interval keeps 3.3V rail quiet for R307S
#define HTTP_TIMEOUT_MS          12000  // Handles cloud cold-starts cleanly
#define ENROLL_STEP_TIMEOUT_MS   25000

// Set to true ONLY for local self-signed HTTPS development servers.
// Production (https://api.edustride.in) uses built-in Root CA verification (ISRG / GTS / DigiCert).
#define ALLOW_INSECURE_TLS       false

#endif
