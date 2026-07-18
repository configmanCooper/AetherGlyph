$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Stage the no-build web app into www/ (the Capacitor webDir), then push it and
# the native plugins into the android/ project.
node scripts/stage-web.js
if ($LASTEXITCODE -ne 0) { throw 'Web staging failed.' }

npx --no-install cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }

Write-Host 'Staged web app + Capacitor plugins synced to android/.' -ForegroundColor Green
