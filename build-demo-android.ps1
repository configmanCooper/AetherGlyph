[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$localTools = Join-Path $root 'build-tools'
$sharedTools = 'C:\Users\rocma\CLI\Fish-Friends-Play\build-tools'
$tools = if (Test-Path $localTools) { $localTools } elseif (Test-Path $sharedTools) { $sharedTools } else { $localTools }

$jdk = Get-ChildItem (Join-Path $tools 'jdk') -Directory |
  Where-Object { $_.Name -like 'jdk-17*' } |
  Select-Object -First 1
if (!$jdk) { throw 'JDK 17 not found. Run setup-android.ps1.' }

$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = Join-Path $tools 'android-sdk'
if (!(Test-Path $env:ANDROID_HOME)) { throw 'Android SDK not found. Run setup-android.ps1.' }

Set-Location $root
node scripts/stage-demo-web.js
if ($LASTEXITCODE -ne 0) { throw 'Demo web staging failed.' }

$demoKeystore = Join-Path $root 'android\aetherglyph-demo-upload.keystore'
$demoProperties = Join-Path $root 'android\demo-keystore.properties'
if (!(Test-Path $demoKeystore) -or !(Test-Path $demoProperties)) {
  $bytes = New-Object byte[] 36
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $password = [Convert]::ToBase64String($bytes)
  & "$($env:JAVA_HOME)\bin\keytool.exe" -genkeypair -v `
    -keystore $demoKeystore -alias aetherglyphdemo -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $password -keypass $password `
    -dname 'CN=configmanCooper Demo, OU=Games, O=configmanCooper, L=NA, ST=NA, C=US'
  if ($LASTEXITCODE -ne 0) { throw 'Demo upload-key generation failed.' }
  @"
storeFile=aetherglyph-demo-upload.keystore
storePassword=$password
keyAlias=aetherglyphdemo
keyPassword=$password
"@ | Set-Content $demoProperties -Encoding ASCII
  Write-Host 'Created ignored demo upload key. Back up android\aetherglyph-demo-upload.keystore and demo-keystore.properties.' -ForegroundColor Yellow
}

"sdk.dir=$($env:ANDROID_HOME -replace '\\','/')" |
  Set-Content (Join-Path $root 'android\local.properties') -Encoding ASCII

$assets = Join-Path $root 'android\app\src\main\assets'
$public = Join-Path $assets 'public'
$config = Join-Path $assets 'capacitor.config.json'
$plugins = Join-Path $assets 'capacitor.plugins.json'
if (!(Test-Path $plugins)) {
  & (Join-Path $root 'sync-android.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Initial Capacitor sync failed.' }
}

$backup = Join-Path $env:TEMP "aetherglyph-demo-assets-$PID"
if (Test-Path $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Copy-Item -LiteralPath $assets -Destination (Join-Path $backup 'assets') -Recurse -Force

try {
  if (Test-Path $public) { Remove-Item -LiteralPath $public -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $root 'www-demo') -Destination $public -Recurse -Force

  @{
    appId = 'com.configmancooper.aetherglyph.demo'
    appName = 'Aetherglyph: Arcane Duels Demo'
    webDir = 'www-demo'
    android = @{
      backgroundColor = '#0a0713'
      allowMixedContent = $false
    }
  } | ConvertTo-Json -Depth 4 | Set-Content $config -Encoding UTF8

  Push-Location (Join-Path $root 'android')
  try {
    & .\gradlew.bat --no-daemon assembleDemo bundleDemo
    if ($LASTEXITCODE -ne 0) { throw "Demo Gradle build failed ($LASTEXITCODE)." }
  } finally {
    Pop-Location
  }

  $version = (& node -p "require('./package.json').version").Trim()
  $dist = Join-Path $root 'dist'
  New-Item -ItemType Directory -Path $dist -Force | Out-Null
  Get-ChildItem $dist -Filter 'Aetherglyph-Demo-*' -ErrorAction SilentlyContinue | Remove-Item -Force

  $apkSource = Join-Path $root 'android\app\build\outputs\apk\demo\app-demo.apk'
  $aabSource = Join-Path $root 'android\app\build\outputs\bundle\demo\app-demo.aab'
  if (!(Test-Path $apkSource)) { throw 'Missing signed demo APK.' }
  if (!(Test-Path $aabSource)) { throw 'Missing signed demo AAB.' }

  $apkDest = Join-Path $dist "Aetherglyph-Demo-$version.apk"
  $aabDest = Join-Path $dist "Aetherglyph-Demo-$version.aab"
  Copy-Item $apkSource $apkDest -Force
  Copy-Item $aabSource $aabDest -Force

  $buildTools = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0'
  $apksigner = Join-Path $buildTools 'apksigner.bat'
  $aapt = Join-Path $buildTools 'aapt2.exe'
  & $apksigner verify --verbose $apkDest | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Demo APK signature verification failed.' }
  $permissions = (& $aapt dump permissions $apkDest | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect demo APK permissions.' }
  if ($permissions -match 'android\.permission\.(?:INTERNET|ACCESS_NETWORK_STATE)') {
    throw 'Demo APK unexpectedly contains a network permission.'
  }

  Write-Host ''
  Write-Host 'Demo artifacts:' -ForegroundColor Green
  Get-Item $apkDest, $aabDest |
    Select-Object Name, @{n='MB';e={[math]::Round($_.Length / 1MB, 2)}} |
    Format-Table -AutoSize
} finally {
  if (Test-Path $assets) { Remove-Item -LiteralPath $assets -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $backup 'assets') -Destination $assets -Recurse -Force
  Remove-Item -LiteralPath $backup -Recurse -Force
}
