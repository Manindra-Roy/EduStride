# EduStride Android APK Build Automation Script
$ErrorActionPreference = "Stop"

Write-Host "=== Step 1: Locating Java/JDK ===" -ForegroundColor Cyan
# Search for JDK 17
$javaPaths = Get-ChildItem -Path "C:\Program Files\Microsoft" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*jdk-17*" }
if (-not $javaPaths) {
    $javaPaths = Get-ChildItem -Path "C:\Program Files\Java" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*jdk-17*" }
}

if (-not $javaPaths) {
    Write-Error "JDK 17 could not be found. Please wait for winget install to finish and run this script again."
}

$javaHome = $javaPaths[0].FullName
$env:JAVA_HOME = $javaHome
$env:PATH = "$javaHome\bin;" + $env:PATH
Write-Host "Using JAVA_HOME: $javaHome" -ForegroundColor Green

Write-Host "=== Step 2: Setting up Android SDK ===" -ForegroundColor Cyan
$sdkDir = "C:\Users\manin\Desktop\EduStride\android\sdk"
if (-not (Test-Path $sdkDir)) {
    New-Item -ItemType Directory -Force -Path $sdkDir | Out-Null
}

$env:ANDROID_HOME = $sdkDir
$cmdlineToolsDir = "$sdkDir\cmdline-tools"
$latestToolsDir = "$cmdlineToolsDir\latest"

if (-not (Test-Path "$latestToolsDir\bin\sdkmanager.bat")) {
    Write-Host "Android Command Line Tools not found. Downloading..." -ForegroundColor Yellow
    $zipUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    $zipFile = "$sdkDir\cmdline-tools.zip"
    
    # Download
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile
    
    Write-Host "Extracting Command Line Tools..." -ForegroundColor Yellow
    Expand-Archive -Path $zipFile -DestinationPath "$sdkDir\temp_extract" -Force
    
    # Restructure cmdline-tools to the format sdkmanager expects
    if (-not (Test-Path $cmdlineToolsDir)) {
        New-Item -ItemType Directory -Force -Path $cmdlineToolsDir | Out-Null
    }
    
    Move-Item -Path "$sdkDir\temp_extract\cmdline-tools" -Destination $latestToolsDir -Force
    Remove-Item -Path $zipFile -Force
    Remove-Item -Path "$sdkDir\temp_extract" -Recurse -Force
    Write-Host "Command Line Tools installed successfully." -ForegroundColor Green
} else {
    Write-Host "Android Command Line Tools already present." -ForegroundColor Green
}

Write-Host "=== Step 3: Installing Android SDK Platform & Build Tools ===" -ForegroundColor Cyan
# Accept licenses and install platform-34 and build-tools-34
Write-Host "Accepting Android SDK Licenses..." -ForegroundColor Yellow
$sdkmanager = "$latestToolsDir\bin\sdkmanager.bat"

# Pipe multiple 'y' strings to accept licenses
@("y", "y", "y", "y", "y", "y", "y") | & $sdkmanager --sdk_root=$sdkDir --licenses

Write-Host "Installing Build Tools (34.0.0) and Platform (android-34)..." -ForegroundColor Yellow
& $sdkmanager --sdk_root=$sdkDir "platforms;android-34" "build-tools;34.0.0"

Write-Host "=== Step 4: Compiling APK via Gradle ===" -ForegroundColor Cyan
$gradleDir = "C:\Users\manin\Desktop\EduStride\android\gradle-bin"
$gradleBin = "$gradleDir\gradle-8.5\bin\gradle.bat"

if (-not (Test-Path $gradleBin)) {
    Write-Host "Gradle 8.5 not found. Downloading..." -ForegroundColor Yellow
    $gradleZipUrl = "https://services.gradle.org/distributions/gradle-8.5-bin.zip"
    $gradleZipFile = "$gradleDir\gradle-8.5-bin.zip"
    
    if (-not (Test-Path $gradleDir)) {
        New-Item -ItemType Directory -Force -Path $gradleDir | Out-Null
    }
    
    Invoke-WebRequest -Uri $gradleZipUrl -OutFile $gradleZipFile
    Write-Host "Extracting Gradle..." -ForegroundColor Yellow
    Expand-Archive -Path $gradleZipFile -DestinationPath $gradleDir -Force
    Remove-Item -Path $gradleZipFile -Force
}

cd C:\Users\manin\Desktop\EduStride\android
# Run Gradle build using portable Gradle
& $gradleBin assembleDebug

Write-Host "=== Step 5: Locating Compiled APK ===" -ForegroundColor Cyan
$apkSource = "C:\Users\manin\Desktop\EduStride\android\app\build\outputs\apk\debug\app-debug.apk"
$apkDest = "C:\Users\manin\Desktop\EduStride\android\EduStride.apk"

if (Test-Path $apkSource) {
    Copy-Item -Path $apkSource -Destination $apkDest -Force
    Write-Host "Success! The compiled APK has been saved to: $apkDest" -ForegroundColor Green
} else {
    Write-Error "Build failed: Compiled APK not found."
}
