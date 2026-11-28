<#
.SYNOPSIS
  Terminal compiler & flasher for EduStride ESP32 Biometric Gate (USB-C and Wireless Wi-Fi OTA)

.EXAMPLES
  .\flash.ps1 -Setup                                      # Configure ESP32 core and required libraries
  .\flash.ps1 -Build                                      # Compile sketch and verify zero errors
  .\flash.ps1 -Build -PartitionScheme min_spiffs          # Compile with larger 1.9MB OTA app partitions
  .\flash.ps1 -UsbPort COM3                               # Compile + Flash via USB-C (first-time bootstrap)
  .\flash.ps1 -UsbPort COM3 -PartitionScheme min_spiffs   # Bootstrap with larger OTA partition layout
  .\flash.ps1 -OtaIp 192.168.1.45                         # Compile + Flash WIRELESSLY over Wi-Fi OTA!
  .\flash.ps1 -OtaIp edustride-gate.local                 # Compile + Flash over Wi-Fi using mDNS hostname!
  .\flash.ps1 -Monitor COM3                               # Open live 115200 baud Serial Monitor
#>
param(
  [switch]$Setup,
  [switch]$Build,
  [string]$UsbPort = "",
  [string]$OtaIp = "",
  [string]$OtaPassword = "",
  [string]$Monitor = "",
  [string]$PartitionScheme = "min_spiffs"
)

$ErrorActionPreference = "Stop"

$SketchDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir = Join-Path $SketchDir "build"
$Fqbn = "esp32:esp32:esp32"
if ($PartitionScheme) {
  $Fqbn = "${Fqbn}:PartitionScheme=${PartitionScheme}"
}

function Ensure-ArduinoCli {
  $globalCli = Get-Command "arduino-cli" -ErrorAction SilentlyContinue
  if ($globalCli) {
    return $globalCli.Source
  }

  $officialPaths = @(
    "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe",
    "C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
  )
  foreach ($candidate in $officialPaths) {
    if (Test-Path $candidate) {
      Write-Host "Using official Arduino IDE CLI: $candidate" -ForegroundColor Green
      return $candidate
    }
  }

  throw "arduino-cli not found. Install Arduino IDE or run 'winget install ArduinoSA.CLI' and retry."
}

function Run-Setup($cli) {
  Write-Host "=== Configuring ESP32 Board Manager & Installing Libraries ===" -ForegroundColor Cyan
  $hasConfig = $false
  try {
    & $cli config dump 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $hasConfig = $true }
  } catch {
    $hasConfig = $false
  }
  if (-not $hasConfig) {
    & $cli config init 2>$null | Out-Null
  }
  & $cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
  & $cli core update-index

  $coreList = & $cli core list | Out-String
  if ($coreList -notmatch "esp32:esp32") {
    Write-Host "Installing esp32:esp32 board core (this takes ~1-3 minutes on first run)..." -ForegroundColor Yellow
    & $cli core install esp32:esp32
  } else {
    Write-Host "esp32:esp32 core already installed." -ForegroundColor Green
  }

  $libs = @(
    "Adafruit Fingerprint Sensor Library",
    "Adafruit SSD1306",
    "Adafruit GFX Library",
    "ArduinoJson"
  )
  foreach ($lib in $libs) {
    Write-Host "Ensuring library: $lib" -ForegroundColor Yellow
    & $cli lib install $lib
  }
  Write-Host "=== Toolchain Setup Complete! ===" -ForegroundColor Green
}

function Ensure-ConfigExists {
  $cfgPath = Join-Path $SketchDir "config.h"
  if (-not (Test-Path $cfgPath)) {
    throw "Missing config.h at $cfgPath. Run 'Copy-Item config.example.h config.h' inside $SketchDir and fill in your Wi-Fi, API key, and OTA password."
  }
  return $cfgPath
}

function Read-ConfigDefine($name) {
  $cfgPath = Ensure-ConfigExists
  $content = Get-Content $cfgPath -Raw
  if ($content -match "(?m)^\s*#define\s+$name\s+`"([^`"]*)`"") {
    return $Matches[1]
  }
  if ($content -match "(?m)^\s*#define\s+$name\s+(\d+)") {
    return $Matches[1]
  }
  return ""
}

function Validate-ConfigCredentials {
  $ssid = Read-ConfigDefine "WIFI_SSID"
  $apiKey = Read-ConfigDefine "DEVICE_API_KEY"
  $otaPass = Read-ConfigDefine "OTA_PASSWORD"

  if (-not $ssid -or $ssid -eq "YOUR_2.4GHZ_WIFI_NAME") {
    Write-Warning "WIFI_SSID in config.h is still a placeholder! Update config.h so Wi-Fi & OTA can connect."
  }
  if (-not $apiKey -or $apiKey -match "^(PASTE_API_KEY|CHANGE_ME)") {
    Write-Warning "DEVICE_API_KEY in config.h is still a placeholder! Copy the key from EduStride App -> Gate Scanner -> ESP32 Setup Credentials."
  }
  if (-not $otaPass -or $otaPass -match "^CHANGE_ME") {
    Write-Warning "OTA_PASSWORD in config.h is empty or still a placeholder! Set a strong unique password before deploying."
  } elseif ($otaPass -eq "edustride-ota-2026") {
    Write-Warning "OTA_PASSWORD in config.h is still the legacy default ('edustride-ota-2026'). Rotate it to a strong unique password before production use."
  }
}

function Run-Compile($cli) {
  Ensure-ConfigExists | Out-Null
  Validate-ConfigCredentials

  Write-Host "=== Compiling EduStride ESP32 Firmware ($Fqbn) ===" -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
  & $cli compile --fqbn $Fqbn --output-dir $BuildDir $SketchDir
  if ($LASTEXITCODE -ne 0) { throw "Compilation failed!" }

  $binPath = Join-Path $BuildDir "edustride_esp32_gate.ino.bin"
  if (Test-Path $binPath) {
    $binSize = (Get-Item $binPath).Length
    $maxAppBytes = if ($PartitionScheme -eq "min_spiffs") { 1966080 } else { 1310720 }
    $pct = [math]::Round(($binSize * 100.0) / $maxAppBytes, 1)
    Write-Host ("Compiled binary size: {0:N0} bytes ({1}% of {2:N0}-byte OTA partition)" -f $binSize, $pct, $maxAppBytes) -ForegroundColor Cyan
    if ($pct -ge 90.0 -and $PartitionScheme -ne "min_spiffs") {
      Write-Warning "Binary uses $pct% of the default 1.25 MB OTA partition! Consider flashing once via USB-C with '-PartitionScheme min_spiffs' (1.875 MB per OTA slot) for extra headroom."
    }
  }

  Write-Host "Compilation succeeded! Binary saved to $BuildDir" -ForegroundColor Green
}

$cli = Ensure-ArduinoCli

if ($Setup) {
  Run-Setup $cli
}

if ($Monitor) {
  Write-Host "=== Opening Serial Monitor on $Monitor (115200 baud, Ctrl+C to exit) ===" -ForegroundColor Cyan
  & $cli monitor -p $Monitor -c baudrate=115200
  exit $LASTEXITCODE
}

if ($Build -or $UsbPort -or $OtaIp) {
  # Auto-install core/libs if esp32 core not present yet
  $installed = & $cli core list 2>$null | Out-String
  if ($installed -notmatch "esp32:esp32") {
    Run-Setup $cli
  }
  Run-Compile $cli
}

if ($UsbPort) {
  Write-Host "=== Flashing ESP32 via USB-C on $UsbPort ===" -ForegroundColor Cyan
  Write-Host "(SAFETY: Make sure 12V external buck converter is UNPLUGGED while USB-C is connected!)" -ForegroundColor Yellow
  & $cli upload -p $UsbPort --fqbn $Fqbn --input-dir $BuildDir $SketchDir
  if ($LASTEXITCODE -ne 0) { throw "USB upload failed! If ESP32 didn't enter boot mode, hold the BOOT button while uploading." }
  Write-Host "USB Flash Complete! Run '.\flash.ps1 -Monitor $UsbPort' to view the ESP32 Wi-Fi IP for future OTA updates." -ForegroundColor Green
}

if ($OtaIp) {
  $binPath = Join-Path $BuildDir "edustride_esp32_gate.ino.bin"
  if (-not (Test-Path $binPath)) { throw "Compiled binary not found at $binPath" }

  $pass = if ($OtaPassword) { $OtaPassword } else { Read-ConfigDefine "OTA_PASSWORD" }
  $otaPort = Read-ConfigDefine "OTA_PORT"
  if (-not $otaPort) { $otaPort = "3232" }

  Write-Host "=== Flashing ESP32 WIRELESSLY over Wi-Fi OTA -> ${OtaIp}:${otaPort} ===" -ForegroundColor Cyan

  # Prefer native espota.exe shipped inside the newest installed esp32 Arduino core (no Python required)
  $espotaExe = Get-ChildItem -Path "$env:LOCALAPPDATA\Arduino15\packages\esp32" -Recurse -Filter "espota.exe" -ErrorAction SilentlyContinue |
    Sort-Object {
      if ($_.FullName -match '\\(\d+\.\d+\.\d+)\\') { [version]$Matches[1] } else { [version]"0.0.0" }
    } -Descending |
    Select-Object -First 1 -ExpandProperty FullName

  if ($espotaExe) {
    $otaArgs = @("-i", $OtaIp, "-p", $otaPort, "-f", $binPath, "-r")
    if ($pass) { $otaArgs += @("--auth=$pass") }
    & $espotaExe @otaArgs
    if ($LASTEXITCODE -ne 0) { throw "Wi-Fi OTA upload failed! Verify ESP32 is powered on, on the same Wi-Fi, and OTA_PASSWORD matches." }
  } else {
    # Fallback to arduino-cli network upload
    $uploadArgs = @("upload", "--fqbn", $Fqbn, "--protocol", "network", "-p", $OtaIp, "--input-dir", $BuildDir, $SketchDir)
    if ($pass) { $uploadArgs += @("--upload-field", "password=$pass") }
    & $cli @uploadArgs
    if ($LASTEXITCODE -ne 0) { throw "Wi-Fi OTA upload failed!" }
  }

  Write-Host "Wireless Wi-Fi OTA Flash Complete! ESP32 is rebooting with new firmware." -ForegroundColor Green
}

if (-not $Setup -and -not $Build -and -not $UsbPort -and -not $OtaIp -and -not $Monitor) {
  Write-Host "Usage:" -ForegroundColor Cyan
  Write-Host "  .\flash.ps1 -Setup                                    # Configure ESP32 core & libraries"
  Write-Host "  .\flash.ps1 -Build                                    # Compile firmware"
  Write-Host "  .\flash.ps1 -Build -PartitionScheme min_spiffs        # Compile with 1.9MB OTA partitions"
  Write-Host "  .\flash.ps1 -UsbPort COM3                             # Initial flash over USB-C"
  Write-Host "  .\flash.ps1 -OtaIp 192.168.1.45                       # Wireless flash over Wi-Fi OTA"
  Write-Host "  .\flash.ps1 -Monitor COM3                             # Live serial monitor (115200 baud)"
}
