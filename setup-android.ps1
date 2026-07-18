$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Reuse the non-admin shared JDK 17 + Android SDK. Prefer a project-local
# build-tools\ if present, otherwise the shared Fish-Friends-Play toolchain.
$localTools = Join-Path $root 'build-tools'
$sharedTools = 'C:\Users\rocma\CLI\Fish-Friends-Play\build-tools'
$tools = if (Test-Path $localTools) { $localTools } elseif (Test-Path $sharedTools) { $sharedTools } else { $localTools }

if (!(Test-Path $tools)) {
  throw 'Android toolchain not found. Install JDK 17 and the Android command-line tools under build-tools\, or keep the Fish-Friends-Play shared toolchain available.'
}

$jdk = Get-ChildItem (Join-Path $tools 'jdk') -Directory | Where-Object { $_.Name -like 'jdk-17*' } | Select-Object -First 1
if (!$jdk) { throw 'JDK 17 not found under the toolchain.' }
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = Join-Path $tools 'android-sdk'
$sdkManager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'
if (!(Test-Path $sdkManager)) { throw 'Android sdkmanager not found under the toolchain.' }

Write-Host 'Accepting licenses and installing Android API 36 + build tools...' -ForegroundColor Cyan
("y`r`n" * 60) | & $sdkManager --sdk_root="$env:ANDROID_HOME" --licenses | Out-Null
& $sdkManager --sdk_root="$env:ANDROID_HOME" 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0' | Out-Null

# Create the upload keystore + ignored keystore.properties on first run. The
# password comes from AETHER_KEYSTORE_PASSWORD or a secure prompt; it is NEVER
# committed. Keep this keystore backed up: it must sign every future update.
$keystore = Join-Path $root 'android\aetherglyph-upload.keystore'
$properties = Join-Path $root 'android\keystore.properties'
if (!(Test-Path $keystore)) {
  $password = $env:AETHER_KEYSTORE_PASSWORD
  if (!$password) {
    $secure = Read-Host 'Choose a strong upload-keystore password' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
  if (!$password) { throw 'A non-empty keystore password is required.' }
  & "$($env:JAVA_HOME)\bin\keytool.exe" -genkeypair -v `
    -keystore $keystore -alias aetherglyph -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $password -keypass $password `
    -dname 'CN=configmanCooper, OU=Games, O=configmanCooper, L=NA, ST=NA, C=US'
  @"
storeFile=aetherglyph-upload.keystore
storePassword=$password
keyAlias=aetherglyph
keyPassword=$password
"@ | Set-Content $properties -Encoding ASCII
  Write-Host 'Created android\aetherglyph-upload.keystore and android\keystore.properties (both git-ignored).' -ForegroundColor Green
} elseif (!(Test-Path $properties)) {
  throw 'The keystore exists but android\keystore.properties is missing. Restore the matching private credentials.'
}

"sdk.dir=$($env:ANDROID_HOME -replace '\\','/')" | Set-Content (Join-Path $root 'android\local.properties') -Encoding ASCII
Write-Host 'Android setup complete. JAVA_HOME + ANDROID_HOME resolved from the shared toolchain.' -ForegroundColor Green
