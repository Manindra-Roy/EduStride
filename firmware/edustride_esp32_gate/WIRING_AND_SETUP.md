# EduStride ESP32 Biometric Gate Scanner — Wiring, Hard-Wire Safety & Setup Guide

Complete hardware guide for building the EduStride wireless fingerprint attendance & Entry/Exit gate device using:
- **ESP32-CP2102-TypeC-38Pins**
- **0.96 Inch I2C 4-Pin Blue OLED (SSD1306)**
- **R307S Optical Fingerprint Sensor Module**
- **Buzzer**
- **TowerPro SG90 360° Continuous Rotation Servo** *(optional motorized pop-out scanner tray + optional 2 micro limit switches)*
- **12V 48W Power Adapter + DC-DC Buck Converter**

---

## 1. CRITICAL HARD-WIRE SAFETY RULES (Read First!)

1. **NEVER connect the 12V→5V Buck Converter and PC USB-C cable at the same time:**
   - **While uploading code from PC:** Disconnect the 12V adapter; power ESP32 via **USB-C only**.
   - **Normal gate operation:** Unplug USB-C; power ESP32 via **12V adapter → 5.0V Buck Converter → `VIN` & `GND`**.
2. **ALWAYS tune the Buck Converter to `5.00V` BEFORE wiring to the ESP32:**
   - Buck converters often arrive set to ~10V–12V from the factory.
   - Power **only** the buck converter from your 12V adapter, attach a multimeter to `OUT+` / `OUT-`, turn the adjustment screw until it reads **`5.00V`** (`4.95V–5.05V`), unplug power, *then* connect to ESP32 `VIN` & `GND`.
3. **NEVER hot-plug wires:** Always unplug power before moving any jumper wire.
4. **ESP32 GPIOs are STRICTLY 3.3V (NOT 5V tolerant):**
   - Power the **0.96" OLED strictly from `3V3`** (NEVER `5V`/`VIN` — its onboard I2C pull-ups would feed 5V into GPIO 21/22).
   - Power **R307S Pin 1 (`5V`) from `VIN` (`5.00V` buck output)** so its internal onboard 3.3V regulator & optical LED get full steady voltage (`4.2V–6.0V` per datasheet). Its internal DSP outputs native **3.3V TTL** on `TXD` — verify `TXD ≈ 3.3V` with a multimeter once before connecting `GPIO 16` (only add the `1kΩ/2kΩ` divider below if a rare clone reads `>3.6V`).
5. **NEVER trust R307S wire colors blindly:**
   - Verify **Pin 1 (`5V`)** through **Pin 6 (`3.3VT`)** directly from the silkscreen / triangle arrow on the back of your R307S PCB before powering on. Reversing `5V` & `GND` destroys the sensor immediately.
6. **Power off before moving wires:** Disconnect the 12V adapter before wiring `Pin 1`, `Pin 5`, and `Pin 6`, then power back on so `GPIO 4` auto-calibrates its idle touch polarity.

---

## 2. Exact Pinout Table (ESP32-CP2102-TypeC-38Pins)

All pins below are **safe non-strapping GPIOs** (avoiding flash pins 6–11, boot pins 0/2/12/15, and input-only pins 34–39):

| Module | Module Pin | ESP32 38-Pin Board Pin | Safety & Notes |
|---|---|---|---|
| **Buck Converter (from 12V 48W)** | `OUT+` (**5.00V**) | `VIN` (or `5V`) | Goes through onboard AMS1117-3.3V regulator |
| **Buck Converter (from 12V 48W)** | `OUT-` (`GND`) | `GND` | Common ground for all components |
| **0.96" OLED (I2C 4-Pin)** | `VCC` | `3V3` | **Strictly 3.3V** (~20mA) |
| **0.96" OLED (I2C 4-Pin)** | `GND` | `GND` | Common ground |
| **0.96" OLED (I2C 4-Pin)** | `SCL` | `GPIO 22` | Hardware I2C Clock |
| **0.96" OLED (I2C 4-Pin)** | `SDA` | `GPIO 21` | Hardware I2C Data (`0x3C`) |
| **R307S Fingerprint Sensor** | Pin 1 `5V` (`VCC`) | `VIN` (**5.00V** Buck Rail) | Datasheet `4.2–6.0V` (`50–100mA` peak); feeds internal 3.3V reg + crisp optical LED |
| **R307S Fingerprint Sensor** | Pin 2 `GND` | `GND` | Common ground |
| **R307S Fingerprint Sensor** | Pin 3 `TXD` (Sensor Out) | `GPIO 16` (`RX2`) | UART2 RX (57600 baud, native 3.3V TTL — verify with multimeter!) |
| **R307S Fingerprint Sensor** | Pin 4 `RXD` (Sensor In) | `GPIO 17` (`TX2`) | UART2 TX (57600 baud) |
| **R307S Fingerprint Sensor** | Pin 5 `TOUCH` (`WAKEUP`) | `GPIO 4` | Instant hardware finger-touch trigger (zero-heat standby! If unwired in 4-wire mode, set `#define FP_USE_TOUCH_PIN false` in `config.h`) |
| **R307S Fingerprint Sensor** | Pin 6 `3.3VT` | `3V3` | Powers internal capacitive touch IC (`<5µA`; only needed when `FP_USE_TOUCH_PIN` is `true`) |
| **Buzzer** | `+` (or `I/O`) | `GPIO 25` | See protection circuit & active-LOW note below |
| **Buzzer** | `-` (`GND`) | `GND` | Common ground |
| **SG90 360° Servo (Tray)** | **Red (`VCC`)** | **Buck `OUT+` (`5.00V`)** | **NEVER connect to `3V3`!** Draws `200–600mA` peaks; unplug while flashing via PC USB-C |
| **SG90 360° Servo (Tray)** | **Brown/Black (`GND`)** | `GND` | Common ground shared with ESP32 & Buck Converter |
| **SG90 360° Servo (Tray)** | **Orange/Yellow (`SIG`)** | `GPIO 18` | Safe non-strapping 50Hz PWM pin (detached at rest — zero buzz/creep) |
| **Limit Switch `CLOSED`** *(optional)* | `NO` / `COM` | `GPIO 26` & `GND` | Set `#define SERVO_USE_LIMIT_SWITCHES true` in `config.h` when installed |
| **Limit Switch `OPEN`** *(optional)* | `NO` / `COM` | `GPIO 27` & `GND` | Internal `INPUT_PULLUP` (triggers `LOW` when pressed) |

---

## 3. Protection Circuits

### A. Buzzer Protection (ESP32 GPIO Safe Limit = 12–20mA)
- **3-Pin Buzzer Module (`VCC`, `GND`, `I/O` with onboard transistor):** Connect `VCC → 3V3`, `GND → GND`, `I/O → GPIO 25` directly (<1mA GPIO draw — safe).
  > **Active-LOW 3-Pin Module Warning (KY-012 / HW-508):** Many common 3-pin active buzzer boards use a PNP driver transistor and beep continuously when `GPIO 25` is `LOW`. If your buzzer stays ON when idle, set `#define BUZZER_ACTIVE_LOW true` in `config.h`.
- **Bare 2-Pin 3.3V Piezo Buzzer:** Place a **`150Ω–220Ω` resistor** in series between `GPIO 25` and Buzzer `+`.
- **Bare 2-Pin 5V Loud Magnetic Buzzer:** Drive via an NPN transistor (`BC547` or `2N2222`) + `1kΩ` base resistor + `1N4148` flyback diode:
  ```text
  5V (VIN) ──┬── [ Buzzer + ] ── [ Buzzer - ] ── Collector (BC547/2N2222)
             └───|<| (1N4148 cathode to 5V) ───┘
  GPIO 25 ── [ 1kΩ ] ────────────────────────── Base
  GND ───────────────────────────────────────── Emitter
  ```

### B. 5V TXD Voltage Divider (ONLY if multimeter measures `TXD > 3.6V`)
Most genuine R307S modules powered at `5.00V` (`VIN`) output native `3.3V TTL` on `TXD`. Measure `TXD` against `GND` once with a multimeter; if a rare 5V-TTL clone reads `>3.6V`, add this resistor divider on `TXD → GPIO 16`:
```text
R307 TXD (5V) ── [ 1kΩ ] ──┬── ESP32 GPIO 16 (RX2, safe ~3.33V)
                           │
                        [ 2kΩ ]
                           │
                          GND
```

### C. Power Stability Recommendations (12V 48W Supply)
- Add an optional **1A inline fuse** on the 5V buck output wire for dead-short protection (since a 48W supply can deliver 4A).
- Add a **`470µF–1000µF` (10V+ electrolytic) bulk capacitor** across **`VIN` (`5V`) and `GND`** (white stripe = `GND`) right at the ESP32/R307S power junction to absorb R307S optical LED + Wi-Fi TX current transients before they dip the onboard AMS1117 regulator input.
- Add an optional **`100µF–470µF` (10V+ electrolytic) capacitor** across `3V3` and `GND` (white stripe = `GND`) for additional 3.3V rail damping.

---

## 4. Pre-Power-On Multimeter Checklist

Before plugging in power for the very first time:
1. Measure buck converter output disconnected from ESP32: verify **`4.95V – 5.05V`**.
2. With power OFF, check continuity between `VIN` and `GND`, and between `3V3` and `GND`: must **NOT** be shorted.
3. Visually confirm R307S Pin 1 (`VCC`) and Pin 2 (`GND`) against the sensor PCB markings.
4. Confirm OLED `VCC` is connected to **`3V3`** (not `VIN`).
5. Confirm **USB-C is unplugged** when testing the 12V buck converter (and **12V is unplugged** when flashing via USB-C).

---

## 5. Arduino IDE Setup & Flashing Steps

1. **Install CP2102 Driver** (Windows): If your PC does not show a COM port when plugging in the ESP32 via USB-C, install the Silicon Labs **CP210x Universal Windows Driver**.
2. **Add ESP32 Board Support in Arduino IDE**:
   - File → Preferences → Additional Boards Manager URLs:
     `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   - Tools → Board → Boards Manager → install **`esp32` by Espressif Systems**.
   - Select Board: **`ESP32 Dev Module`** (for extra OTA flash headroom, set Tools → Partition Scheme → **`Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS)`**, or pass `-PartitionScheme min_spiffs` to `flash.ps1` during initial USB-C flash).
3. **Install Required Libraries** (Sketch → Include Library → Manage Libraries):
   - `Adafruit Fingerprint Sensor Library` (by Adafruit)
   - `Adafruit SSD1306` (by Adafruit)
   - `Adafruit GFX Library` (by Adafruit)
   - `ArduinoJson` (by Benoit Blanchon)
4. **Create & Configure `config.h`**:
   - Copy the template file first:
     ```powershell
     copy config.example.h config.h
     ```
   - Open the **EduStride Mobile App (or Web Portal)** → **Gate Scanner** → expand **ESP32 Setup Credentials**.
   - Copy `SERVER_BASE_URL`, `DEVICE_ID`, and `DEVICE_API_KEY` into `config.h`.
   - Enter your **2.4 GHz** `WIFI_SSID` and `WIFI_PASSWORD`.
   - **Rotate `OTA_PASSWORD`**: Replace `"CHANGE_ME_STRONG_OTA_PASSWORD"` with a strong unique password before flashing.
   - If you are wiring only 4 sensor wires (without Pin 5 `TOUCH` / Pin 6 `3.3VT`), set `#define FP_USE_TOUCH_PIN false`.
   - Set `BUZZER_IS_ACTIVE` to `true` (active buzzer) or `false` (passive buzzer), and set `BUZZER_ACTIVE_LOW` to `true` if using an active-LOW 3-pin buzzer module (e.g. KY-012 / HW-508).
5. **Flash Firmware**:
   - Unplug the 12V adapter, connect ESP32 via USB-C, select the COM port, and click **Upload** (or run `.\flash.ps1 -UsbPort COM3`).
   - Open Serial Monitor at **`115200` baud** to confirm `[R307S] Sensor READY!` and `[WIFI] Connected!`.
   - Open **Gate Scanner** in the EduStride mobile app — within **~12–18 seconds** (after Wi-Fi association, NTP clock sync, first heartbeat, and app poll) the badge turns **ESP32 Online**!
   - You can now toggle **Fingerprint Sensing ON/OFF** wirelessly and click **Enroll** next to any student to register their fingerprint right on the R307S sensor!

---

## 6. Motorized Cabinet Tray v3.0 — SG90 + Mouse Microswitch Wiring & Setup

The firmware (`v3.0.0-ota+`) runs a non-blocking **3-Mode Actuator FSM** selectable live in **EduStride App → Gate Control → Settings → Motorized Cabinet Tray (v3.0)**:
- **`LIMIT_360` (Recommended with Mouse Switches):** Spins until the `OPEN` or `CLOSED` mouse microswitch clicks — **exact millimeter repeatability, zero drift forever**, plus automatic jam-protection cutoff (`max_run_ms` → `FAULT`).
- **`TIMED_360`:** Open-loop timed spin with independent `Open Time` / `Close Time` and NVS state memory.
- **`ANGLE_180`:** Smooth angular sweep (`closed_angle` ↔ `open_angle`) for 180° positional servos (e.g., `MG90S`).

### A. 3-Pin Mouse Microswitch Wiring (Zero Resistors Needed!)
Standard 3-pin computer mouse microswitches (Omron / Kailh / Huano) are ideal endstops because they need only ~50–75 g of click force (won't stall a small SG90!) and last millions of clicks.

```text
         [o]   <-- Tiny clickable plunger button on top
      ┌───────┐
      │ MOUSE │
      │SWITCH │
      └─┬─┬─┬─┘
        │ │ │
      Pin1 Pin2 Pin3
      COM   NO   NC (leave unused)
       │    │
       │    └── ESP32 GPIO 26 (CLOSED switch)  OR  GPIO 27 (OPEN switch)
       └─────── ESP32 GND (common ground)
```
1. **Pin 1 (directly under the plunger button = `COM`)** → connect to **`GND`**.
2. **Pin 2 (middle pin = `NO`, Normally Open)** → connect to **`GPIO 26`** (for the **CLOSED** endstop) or **`GPIO 27`** (for the **OPEN** endstop).
3. **Pin 3 (farthest from button = `NC`)** → leave unconnected.
4. **Instant Verification:** Power on the ESP32 and click each mouse switch with your finger:
   - In **EduStride App → Gate Control → Motorized Cabinet Tray**, the **`CLOSED (GPIO 26)`** and **`OPEN (GPIO 27)`** live badges turn **green (`CLICKED`)** within ~5 seconds!
   - On Serial Monitor (`115200` baud), you immediately see `[SWITCH] CLOSED (GPIO 26) = PRESSED` / `[SWITCH] OPEN (GPIO 27) = PRESSED`.

### B. Mechanical & Power Protection
1. **Use the `470µF–1000µF` bulk capacitor** across the `5.00V` buck output (`OUT+` / `GND`) to absorb servo startup spikes.
2. **Disconnect servo `5V` during USB-C flashing** (only power the servo from the `5.00V` buck rail, never from PC USB).
3. **Protect the plastic SG90 gears from downward finger force:** Support the R307S tray on sliding rails or a cabinet lip so the cabinet frame absorbs student downward finger presses instead of the servo horn.
4. **Leave flexible wire slack** on the 6 R307S wires so sliding in/out never pulls on the connector.

### C. Live Serial Monitor Commands (`115200` baud)
Type `help` in Serial Monitor (`.\flash.ps1 -Monitor COM3`):
- `servo status` — Shows active mode, state, live mouse switch readings, and config.
- `servo open` / `servo close` / `servo home` / `servo stop` — Non-blocking live test & emergency stop.
- `servo nudge open 200` / `servo nudge close 200` — Short alignment nudges.
- `servo state closed` / `servo state open` — Sync saved NVS position without moving the motor.
- `servo pulse 1500 2000` — Test neutral stop pulse (`stop_us`) if the shaft creeps while braking.
