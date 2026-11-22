# EduStride Android APK Build Automation Script (with automatic versioned releases)
# Usage:
#   .\build_apk.ps1                    -> builds current version in app/build.gradle (auto-uses release if keystore env vars are set)
#   .\build_apk.ps1 -Release           -> requests a signed release APK (falls back to debug with warning if no keystore is configured)
#   .\build_apk.ps1 -Bump patch        -> increments versionCode + patch (e.g. 1.1.0 -> 1.1.1)
#   .\build_apk.ps1 -Bump minor        -> increments versionCode + minor (e.g. 1.1.0 -> 1.2.0)
#   .\build_apk.ps1 -Bump major        -> increments versionCode + major (e.g. 1.1.0 -> 2.0.0)
param(
    [ValidateSet("none", "patch", "minor", "major")]
    [string]$Bump = "none",
    [switch]$Release
)

$ErrorActionPreference = "Stop"

$androidDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $androidDir

Write-Host "=== Step 0: Managing Android App Version ===" -ForegroundColor Cyan
$gradleFile = Join-Path $androidDir "app\build.gradle"
$gradleText = Get-Content -Path $gradleFile -Raw

$codeMatch = [regex]::Match($gradleText, 'versionCode\s+(\d+)')
$nameMatch = [regex]::Match($gradleText, 'versionName\s+"(\d+)\.(\d+)\.(\d+)"')
if (-not $codeMatch.Success -or -not $nameMatch.Success) {
    Write-Error "Could not parse versionCode / versionName in $gradleFile"
}

$versionCode = [int]$codeMatch.Groups[1].Value
$major = [int]$nameMatch.Groups[1].Value
$minor = [int]$nameMatch.Groups[2].Value
$patch = [int]$nameMatch.Groups[3].Value

if ($Bump -ne "none") {
    $versionCode += 1
    switch ($Bump) {
        "patch" { $patch += 1 }
        "minor" { $minor += 1; $patch = 0 }
        "major" { $major += 1; $minor = 0; $patch = 0 }
    }
    $versionName = "$major.$minor.$patch"
    $gradleText = [regex]::Replace($gradleText, 'versionCode\s+\d+', "versionCode $versionCode", 1)
    $gradleText = [regex]::Replace($gradleText, 'versionName\s+"\d+\.\d+\.\d+"', "versionName `"$versionName`"", 1)
    Set-Content -Path $gradleFile -Value $gradleText -NoNewline
    Write-Host "Bumped version to v$versionName (versionCode $versionCode)" -ForegroundColor Green
} else {
    $versionName = "$major.$minor.$patch"
    Write-Host "Building current version v$versionName (versionCode $versionCode)" -ForegroundColor Green
}

Write-Host "=== Step 1: Locating Java/JDK ===" -ForegroundColor Cyan
$javaHome = $null
if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
    $javaHome = $env:JAVA_HOME
} else {
    $javaPaths = Get-ChildItem -Path "C:\Program Files\Microsoft" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*jdk-17*" }
    if (-not $javaPaths) {
        $javaPaths = Get-ChildItem -Path "C:\Program Files\Java" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*jdk-17*" }
    }
    if ($javaPaths) {
        $javaHome = $javaPaths[0].FullName
    }
}

if (-not $javaHome) {
    Write-Error "JDK 17 could not be found. Please install JDK 17 or set JAVA_HOME and run this script again."
}

$env:JAVA_HOME = $javaHome
$env:PATH = "$javaHome\bin;" + $env:PATH
Write-Host "Using JAVA_HOME: $javaHome" -ForegroundColor Green

Write-Host "=== Step 2: Setting up Android SDK ===" -ForegroundColor Cyan
$sdkDir = Join-Path $androidDir "sdk"
if (-not (Test-Path $sdkDir)) {
    New-Item -ItemType Directory -Force -Path $sdkDir | Out-Null
}

$env:ANDROID_HOME = $sdkDir
$cmdlineToolsDir = Join-Path $sdkDir "cmdline-tools"
$latestToolsDir = Join-Path $cmdlineToolsDir "latest"

if (-not (Test-Path (Join-Path $latestToolsDir "bin\sdkmanager.bat"))) {
    Write-Host "Android Command Line Tools not found. Downloading..." -ForegroundColor Yellow
    $zipUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    $zipFile = Join-Path $sdkDir "cmdline-tools.zip"

    Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile

    Write-Host "Extracting Command Line Tools..." -ForegroundColor Yellow
    $tempExtract = Join-Path $sdkDir "temp_extract"
    Expand-Archive -Path $zipFile -DestinationPath $tempExtract -Force

    if (-not (Test-Path $cmdlineToolsDir)) {
        New-Item -ItemType Directory -Force -Path $cmdlineToolsDir | Out-Null
    }

    Move-Item -Path (Join-Path $tempExtract "cmdline-tools") -Destination $latestToolsDir -Force
    Remove-Item -Path $zipFile -Force
    Remove-Item -Path $tempExtract -Recurse -Force
    Write-Host "Command Line Tools installed successfully." -ForegroundColor Green
} else {
    Write-Host "Android Command Line Tools already present." -ForegroundColor Green
}

Write-Host "=== Step 3: Checking Android SDK Platform & Build Tools ===" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $sdkDir "platforms\android-34")) -or -not (Test-Path (Join-Path $sdkDir "build-tools\34.0.0"))) {
    Write-Host "Accepting Android SDK Licenses..." -ForegroundColor Yellow
    $sdkmanager = Join-Path $latestToolsDir "bin\sdkmanager.bat"
    @("y", "y", "y", "y", "y", "y", "y") | & $sdkmanager --sdk_root=$sdkDir --licenses
    Write-Host "Installing Build Tools (34.0.0) and Platform (android-34)..." -ForegroundColor Yellow
    & $sdkmanager --sdk_root=$sdkDir "platforms;android-34" "build-tools;34.0.0"
} else {
    Write-Host "Android SDK Platform 34 & Build Tools 34.0.0 already present." -ForegroundColor Green
}

Write-Host "=== Step 4: Compiling APK via Gradle ===" -ForegroundColor Cyan
$gradleDir = Join-Path $androidDir "gradle-bin"
$gradleBin = Join-Path $gradleDir "gradle-8.5\bin\gradle.bat"

if (-not (Test-Path $gradleBin)) {
    Write-Host "Gradle 8.5 not found. Downloading..." -ForegroundColor Yellow
    $gradleZipUrl = "https://services.gradle.org/distributions/gradle-8.5-bin.zip"
    $gradleZipFile = Join-Path $gradleDir "gradle-8.5-bin.zip"

    if (-not (Test-Path $gradleDir)) {
        New-Item -ItemType Directory -Force -Path $gradleDir | Out-Null
    }

    Invoke-WebRequest -Uri $gradleZipUrl -OutFile $gradleZipFile
    Write-Host "Extracting Gradle..." -ForegroundColor Yellow
    Expand-Archive -Path $gradleZipFile -DestinationPath $gradleDir -Force
    Remove-Item -Path $gradleZipFile -Force
}

$ksPropsFile = Join-Path $androidDir "keystore.properties"
$ksMap = @{}
if (Test-Path $ksPropsFile) {
    Get-Content $ksPropsFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -match '^([^=]+)=(.*)$') {
            $ksMap[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
}

$ksPathVal = if ($ksMap["EDUSTRIDE_KEYSTORE_PATH"]) { $ksMap["EDUSTRIDE_KEYSTORE_PATH"] } else { $env:EDUSTRIDE_KEYSTORE_PATH }
$ksResolvedPath = $ksPathVal
if ($ksPathVal -and -not [System.IO.Path]::IsPathRooted($ksPathVal)) {
    $ksResolvedPath = Join-Path $androidDir $ksPathVal
}
$ksPassVal = if ($ksMap["EDUSTRIDE_KEYSTORE_PASSWORD"]) { $ksMap["EDUSTRIDE_KEYSTORE_PASSWORD"] } else { $env:EDUSTRIDE_KEYSTORE_PASSWORD }
$ksAliasVal = if ($ksMap["EDUSTRIDE_KEY_ALIAS"]) { $ksMap["EDUSTRIDE_KEY_ALIAS"] } else { $env:EDUSTRIDE_KEY_ALIAS }
$ksKeyPassVal = if ($ksMap["EDUSTRIDE_KEY_PASSWORD"]) { $ksMap["EDUSTRIDE_KEY_PASSWORD"] } else { $env:EDUSTRIDE_KEY_PASSWORD }

$hasKeystore = (
    -not [string]::IsNullOrWhiteSpace($ksResolvedPath) -and
    (Test-Path $ksResolvedPath) -and
    -not [string]::IsNullOrWhiteSpace($ksPassVal) -and
    -not [string]::IsNullOrWhiteSpace($ksAliasVal) -and
    -not [string]::IsNullOrWhiteSpace($ksKeyPassVal)
)

$useReleaseBuild = $false
if ($hasKeystore) {
    $useReleaseBuild = $true
    Write-Host "Release keystore detected. Building signed release APK (assembleRelease)..." -ForegroundColor Green
} else {
    if ($Release) {
        Write-Warning "Release build requested, but signing keystore is not configured or file was not found."
    } else {
        Write-Warning "No release keystore configured. Falling back to debug build (assembleDebug)."
    }
    Write-Warning "Configure android/keystore.properties or set EDUSTRIDE_KEYSTORE_PATH, EDUSTRIDE_KEYSTORE_PASSWORD, EDUSTRIDE_KEY_ALIAS, and EDUSTRIDE_KEY_PASSWORD to build a signed release APK."
}

$gradleTask = if ($useReleaseBuild) { "assembleRelease" } else { "assembleDebug" }

Push-Location $androidDir
try {
    & $gradleBin $gradleTask
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Gradle build ($gradleTask) failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

Write-Host "=== Step 5: Saving Versioned APK & Syncing Frontend ===" -ForegroundColor Cyan
$apkSource = if ($useReleaseBuild) {
    Join-Path $androidDir "app\build\outputs\apk\release\app-release.apk"
} else {
    Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
}
$versionedName = "EduStride-v$versionName.apk"
$releasesDir = Join-Path $androidDir "releases"
$releaseApkDest = Join-Path $releasesDir $versionedName
$apkDest = Join-Path $androidDir "EduStride.apk"
$publicDir = Join-Path $repoRoot "frontend\public"
$publicApkDest = Join-Path $publicDir $versionedName
$appVersionJs = Join-Path $repoRoot "frontend\src\config\appVersion.js"

if (Test-Path $apkSource) {
    if (-not (Test-Path $releasesDir)) {
        New-Item -ItemType Directory -Force -Path $releasesDir | Out-Null
    }
    Copy-Item -Path $apkSource -Destination $releaseApkDest -Force
    Copy-Item -Path $apkSource -Destination $apkDest -Force

    if (Test-Path $publicDir) {
        # Replace any older public APK so Vercel always serves the single latest versioned APK
        Get-ChildItem -Path $publicDir -Filter "EduStride*.apk" -ErrorAction SilentlyContinue | Remove-Item -Force
        Copy-Item -Path $apkSource -Destination $publicApkDest -Force
    }

    if (Test-Path (Split-Path -Parent $appVersionJs)) {
        # Keep frontend version config synced automatically
        $versionJsContent = @"
// Auto-synced by android/build_apk.ps1 on every Android release build
export const APP_VERSION = '$versionName';
export const APP_VERSION_CODE = $versionCode;
export const APK_FILENAME = ``EduStride-v`${APP_VERSION}.apk``;
export const APK_DOWNLOAD_URL = ``/`${APK_FILENAME}``;
"@
        Set-Content -Path $appVersionJs -Value $versionJsContent -Encoding UTF8
    }

    $buildVariantLabel = if ($useReleaseBuild) { "RELEASE (signed)" } else { "DEBUG (unsigned fallback)" }
    Write-Host "Success! Saved $buildVariantLabel versioned APK:" -ForegroundColor Green
    Write-Host "  Archive : $releaseApkDest" -ForegroundColor Green
    Write-Host "  Latest  : $apkDest" -ForegroundColor Green
    Write-Host "  Public  : $publicApkDest" -ForegroundColor Green
} else {
    Write-Error "Build failed: Compiled APK not found at $apkSource."
}
