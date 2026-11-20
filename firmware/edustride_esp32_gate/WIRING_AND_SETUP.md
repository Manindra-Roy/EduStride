# EduStride ESP32 Biometric Gate Scanner — Wiring, Hard-Wire Safety & Setup Guide

Complete hardware guide for building the EduStride wireless fingerprint attendance & Entry/Exit gate device using:
- **ESP32-CP2102-TypeC-38Pins**
- **0.96 Inch I2C 4-Pin Blue OLED (SSD1306)**
- **R307S Optical Fingerprint Sensor Module**
- **Buzzer**
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
   - Power the **R307S from `3V3`** first (official R307S operates at 3.3V and outputs safe 3.3V UART signals).
5. **NEVER trust R307S wire colors blindly:**
   - Verify **Pin 1 (`VCC`)** and **Pin 2 (`GND`)** directly from the silkscreen / triangle arrow on the back of your R307S PCB before powering on. Reversing VCC & GND destroys the sensor immediately.
6. **Insulate unused wires:** Tape or heat-shrink R307S Pin 5 (`TOUCH`) and Pin 6 (`3.3VT`) so bare tips cannot short against the board.

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
| **R307S Fingerprint Sensor** | Pin 1 `VCC` | `3V3` *(Primary Safe)* | ~50mA typical; keeps UART TX at safe 3.3V |
| **R307S Fingerprint Sensor** | Pin 2 `GND` | `GND` | Common ground |
| **R307S Fingerprint Sensor** | Pin 3 `TXD` (Sensor Out) | `GPIO 16` (`RX2`) | UART2 RX (57600 baud). *Direct only if R307S VCC = 3.3V!* |
| **R307S Fingerprint Sensor** | Pin 4 `RXD` (Sensor In) | `GPIO 17` (`TX2`) | UART2 TX (57600 baud) |
| **R307S Fingerprint Sensor** | Pin 5 `TOUCH` / Pin 6 `3.3VT` | *Not connected* | Insulate ends with electrical tape |
| **Buzzer** | `+` (or `I/O`) | `GPIO 25` | See protection circuit below |
| **Buzzer** | `-` (`GND`) | `GND` | Common ground |

---

## 3. Protection Circuits

### A. Buzzer Protection (ESP32 GPIO Safe Limit = 12–20mA)
- **3-Pin Buzzer Module (`VCC`, `GND`, `I/O` with onboard transistor):** Connect `VCC → 3V3`, `GND → GND`, `I/O → GPIO 25` directly (<1mA GPIO draw — safe).
- **Bare 2-Pin 3.3V Piezo Buzzer:** Place a **`150Ω–220Ω` resistor** in series between `GPIO 25` and Buzzer `+`.
- **Bare 2-Pin 5V Loud Magnetic Buzzer:** Drive via an NPN transistor (`BC547` or `2N2222`) + `1kΩ` base resistor + `1N4148` flyback diode:
  ```text
  5V (VIN) ──┬── [ Buzzer + ] ── [ Buzzer - ] ── Collector (BC547/2N2222)
             └───|<| (1N4148 cathode to 5V) ───┘
  GPIO 25 ── [ 1kΩ ] ────────────────────────── Base
  GND ───────────────────────────────────────── Emitter
  ```

### B. 5V Fallback Voltage Divider (ONLY if your seller shipped a 5V-only R307)
Test the R307S on **`3V3`** first. If Serial Monitor reports `R307S NOT FOUND` and the optical LED never flickers at 3.3V, connect R307 `VCC → VIN (5V)` **ONLY WITH** this resistor divider on `TXD → GPIO 16`:
```text
R307 TXD (5V) ── [ 1kΩ ] ──┬── ESP32 GPIO 16 (RX2, safe ~3.33V)
                           │
                        [ 2kΩ ]
                           │
                          GND
```

### C. Power Stability Recommendations (12V 48W Supply)
- Add an optional **1A inline fuse** on the 5V buck output wire for dead-short protection (since a 48W supply can deliver 4A).
- Add an optional **`100µF–470µF` (10V+ electrolytic) capacitor** across `3V3` and `GND` (white stripe = `GND`) to prevent brownout resets during simultaneous Wi-Fi TX + sensor LED spikes.

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
   - Select Board: **`ESP32 Dev Module`**.
3. **Install Required Libraries** (Sketch → Include Library → Manage Libraries):
   - `Adafruit Fingerprint Sensor Library` (by Adafruit)
   - `Adafruit SSD1306` (by Adafruit)
   - `Adafruit GFX Library` (by Adafruit)
   - `ArduinoJson` (by Benoit Blanchon)
4. **Configure `config.h`**:
   - Open the **EduStride Mobile App (or Web Portal)** → **Gate Scanner** → expand **ESP32 Setup Credentials**.
   - Copy `SERVER_BASE_URL`, `DEVICE_ID`, and `DEVICE_API_KEY` into `config.h`.
   - Enter your **2.4 GHz** `WIFI_SSID` and `WIFI_PASSWORD`.
   - Set `BUZZER_IS_ACTIVE` to `true` (active buzzer) or `false` (passive buzzer).
5. **Flash Firmware**:
   - Unplug the 12V adapter, connect ESP32 via USB-C, select the COM port, and click **Upload**.
   - Open Serial Monitor at **`115200` baud** to confirm `[R307S] Sensor OK!` and `[WIFI] Connected!`.
   - Open **Gate Scanner** in the EduStride mobile app — within 2 seconds the badge turns **ESP32 Online**!
   - You can now toggle **Fingerprint Sensing ON/OFF** wirelessly and click **Enroll** next to any student to register their fingerprint right on the R307S sensor!
