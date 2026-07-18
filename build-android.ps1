[CmdletBinding()]
param([switch]$Fast)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Resolve the shared JDK 17 + Android SDK (same convention as setup-android.ps1).
$localTools = Join-Path $root 'build-tools'
$sharedTools = 'C:\Users\rocma\CLI\Fish-Friends-Play\build-tools'
$tools = if (Test-Path $localTools) { $localTools } elseif (Test-Path $sharedTools) { $sharedTools } else { $localTools }
$jdk = Get-ChildItem (Join-Path $tools 'jdk') -Directory | Where-Object { $_.Name -like 'jdk-17*' } | Select-Object -First 1
if (!$jdk) { throw 'JDK 17 not found. Run setup-android.ps1.' }
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = Join-Path $tools 'android-sdk'
if (!(Test-Path $env:ANDROID_HOME)) { throw 'Android SDK not found. Run setup-android.ps1.' }

# Stage + sync the web app unless -Fast (reuse the already-synced assets).
if (!$Fast) {
  & (Join-Path $root 'sync-android.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Sync failed.' }
}

$signed = Test-Path (Join-Path $root 'android\keystore.properties')
if (-not $signed) {
  Write-Host 'No android\keystore.properties found - RELEASE artifacts will be UNSIGNED.' -ForegroundColor Yellow
  Write-Host 'Run setup-android.ps1 to create an upload key, then re-run this script for signed output.' -ForegroundColor Yellow
}

Push-Location (Join-Path $root 'android')
try {
  & .\gradlew.bat --no-daemon assembleDebug assembleRelease bundleRelease
  if ($LASTEXITCODE -ne 0) { throw "Gradle build failed ($LASTEXITCODE)." }
} finally {
  Pop-Location
}

$version = (& node -p "require('./package.json').version").Trim()
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Get-ChildItem $dist -Filter 'Aetherglyph-*' -ErrorAction SilentlyContinue | Remove-Item -Force

function Copy-Artifact($relSource, $destName) {
  $src = Join-Path $root $relSource
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $dist $destName) -Force
    return $true
  }
  return $false
}

$results = @()

# Debug APK (always produced).
if (Copy-Artifact 'android\app\build\outputs\apk\debug\app-debug.apk' "Aetherglyph-$version-debug.apk") {
  $results += [pscustomobject]@{ Artifact = "Aetherglyph-$version-debug.apk"; Signed = 'debug key' }
} else { throw 'Missing debug APK.' }

# Release APK: signed app-release.apk, else app-release-unsigned.apk.
if (Copy-Artifact 'android\app\build\outputs\apk\release\app-release.apk' "Aetherglyph-$version-release.apk") {
  $results += [pscustomobject]@{ Artifact = "Aetherglyph-$version-release.apk"; Signed = 'yes' }
} elseif (Copy-Artifact 'android\app\build\outputs\apk\release\app-release-unsigned.apk' "Aetherglyph-$version-release-unsigned.apk") {
  $results += [pscustomobject]@{ Artifact = "Aetherglyph-$version-release-unsigned.apk"; Signed = 'NO - sign before upload' }
}

# Release AAB (the Play upload artifact). Same path signed or not.
$aabName = if ($signed) { "Aetherglyph-$version-release.aab" } else { "Aetherglyph-$version-release-unsigned.aab" }
if (Copy-Artifact 'android\app\build\outputs\bundle\release\app-release.aab' $aabName) {
  $results += [pscustomobject]@{ Artifact = $aabName; Signed = if ($signed) { 'yes' } else { 'NO - sign before upload' } }
} else { throw 'Missing release AAB.' }

Write-Host ''
Write-Host "Artifacts in dist\ (version $version):" -ForegroundColor Green
$results | ForEach-Object { '  {0,-44} signed: {1}' -f $_.Artifact, $_.Signed } | Write-Host
Get-ChildItem $dist | Select-Object Name, @{n='MB';e={[math]::Round($_.Length / 1MB, 2)}} | Format-Table -AutoSize

if (-not $signed) {
  Write-Host ''
  Write-Host 'To produce a signed AAB for Google Play:' -ForegroundColor Cyan
  Write-Host '  1. Run  .\setup-android.ps1   (creates android\aetherglyph-upload.keystore + keystore.properties)' -ForegroundColor Cyan
  Write-Host '  2. Run  .\build-android.ps1   again. dist\ will then contain a signed .aab.' -ForegroundColor Cyan
  Write-Host '  Or sign the existing unsigned .aab with jarsigner + the upload key (see PUBLISHING-ANDROID.md).' -ForegroundColor Cyan
}
