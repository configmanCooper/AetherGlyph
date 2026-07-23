# Aetherglyph Demo — Android / Google Play

The demo is a separate Android package:

- **Application ID:** `com.configmancooper.aetherglyph.demo`
- **Store name:** Aetherglyph: Arcane Duels Demo
- **Price:** Free
- **Offline content:** Tutorial, Practice vs AI, Glyph Laboratory, settings,
  progression, and every other offline feature
- **Online Duel:** opens the purchase notice and cannot connect

## Build

```powershell
.\build-demo-android.ps1
```

This produces:

- `dist\Aetherglyph-Demo-<version>.apk`
- `dist\Aetherglyph-Demo-<version>.aab`

The build script stages an isolated demo bundle, replaces networking modules with
offline stubs, removes Socket.IO and the production server hostname, removes
Android Internet/network-state permissions, signs the artifacts, verifies the APK
signature and permissions, and restores the full-edition Android assets.

## Signing backup

The first build creates these ignored files:

- `android\aetherglyph-demo-upload.keystore`
- `android\demo-keystore.properties`

Back up both files securely. Google Play updates to the demo listing must continue
using this upload key. Never commit either file.

## Verification

```powershell
npm run test:demo
npm run test:demo-browser
```
