# Publishing Aetherglyph: Arcane Duels on Google Play

Phase 4 packages the no-build web app as a Capacitor Android application. The web
app is staged into a Capacitor `webDir` (`www/`), synced into the checked-in
`android/` project, and built into an App Bundle with the shared JDK 17 + Android
SDK.

## 1. Build artifacts

```powershell
.\setup-android.ps1     # one-time: accept SDK licenses, create the upload key
.\build-android.ps1     # stage web -> cap sync -> gradle -> dist\
```

`build-android.ps1` writes to `dist\` (version is read from `package.json`):

- `Aetherglyph-<version>-debug.apk` — always (signed with the local debug key)
- `Aetherglyph-<version>-release.aab` — when an upload key exists (**upload this to Play**)
- `Aetherglyph-<version>-release.apk` — when an upload key exists (sideload/testing)

If **no** upload key exists yet, the release outputs are produced **unsigned** and
named `…-release-unsigned.aab` / `…-release-unsigned.apk`. Sign them before
uploading (see “Signing”).

Flags: `.\build-android.ps1 -Fast` skips the stage+sync step and rebuilds from the
already-synced assets.

## 2. Play Console setup

Create the app as a **paid game** at **$0.99**. (A free app can never later be
changed to paid.) No ads. No in-app purchases.

| Field | Value |
| --- | --- |
| App id | `com.configmancooper.aetherglyph` |
| App name | Aetherglyph: Arcane Duels |
| Version code | `10705` |
| Version name | `1.7.5` |
| Minimum Android | 7.0 / API 24 |
| Target / compile Android | API 36 |
| Orientation | User-selectable: Auto rotate, Portrait, or Landscape |
| Category | Games → Strategy (Casual acceptable) |
| Ads | No |
| In-app purchases | No |
| Internet required | Yes |

Listing copy is in `store-listing-android.md`. Graphics are generated into
`play-assets\` (icon 512, feature graphic 1024×500) and screenshots into
`play-assets\screenshots\`:

```powershell
npm run android:assets        # app icon, adaptive fg/bg, splash, Play 512, feature graphic
npm run android:screenshots   # deterministic phone screenshots (needs local Edge/Chrome)
```

## 3. Signing

Release signing reads an **ignored** `android\keystore.properties`; no secret is
ever committed. `setup-android.ps1` creates the upload keystore on first run,
reading the password from `AETHER_KEYSTORE_PASSWORD` or a secure prompt.

```
android\aetherglyph-upload.keystore   # git-ignored — BACK THIS UP SECURELY
android\keystore.properties           # git-ignored — storeFile/passwords/alias
```

Enable **Play App Signing**: you upload an AAB signed with the *upload* key and
Google re-signs with the app-signing key. Use the **same upload key for every
update** — losing it blocks future updates.

**Signing an unsigned artifact produced before the key existed:**

- Recommended — create the key and rebuild:
  ```powershell
  .\setup-android.ps1
  .\build-android.ps1
  # -> dist\Aetherglyph-<version>-release.aab is now signed
  ```
- Or sign the existing unsigned AAB directly with the upload key:
  ```powershell
  & "$env:JAVA_HOME\bin\jarsigner.exe" -keystore android\aetherglyph-upload.keystore `
    dist\Aetherglyph-<version>-release-unsigned.aab aetherglyph
  ```

## 4. Data Safety form

- **Network communication:** online multiplayer connects to the authoritative
  service (`aetherglyph.onrender.com`, or a user-configured URL).
- **Collected/processed:** an anonymous, device-local random identifier; optional
  display name; in-match inputs; IP address and short-lived connection/security
  logs (retained ≤ 30 days); a numeric skill rating tied to the anonymous id.
- **Not collected:** name, email, real account, precise location, contacts,
  camera, microphone, photos, advertising id. No analytics/ad SDKs. No data sale.
- **Encryption in transit:** yes (HTTPS/WSS; production cleartext disabled).
- **Deletion:** in-app *Settings → Delete my data*; server rating record on
  request. See `https://aetherglyph.onrender.com/account-deletion.html`.

## 5. Privacy & account deletion (required for online play)

- Privacy policy: `https://aetherglyph.onrender.com/privacy.html`
- Account/data deletion: `https://aetherglyph.onrender.com/account-deletion.html`

Both are served by the game service and are also bundled offline in the app
(`Settings → Privacy & deletion`). Accounts are anonymous, so deletion is the
in-app data wipe plus an optional server record-deletion request.

## 6. Permissions

Requested: `INTERNET`, `ACCESS_NETWORK_STATE`, and `VIBRATE` (added by
`@capacitor/haptics`). Nothing else — no camera, microphone, location, contacts,
photos, or broad storage.

## 7. Release checklist

- [ ] `npm test`, `npm run test:server`, `npm run test:browser`, `npm run test:packaging` pass
- [ ] `npm run android:assets` regenerated icons/splash/store art
- [ ] `.\build-android.ps1` produced a **signed** `.aab` in `dist\`
- [ ] Version code/name bumped in `android\app\build.gradle`, `package.json`, and `client\sw.js` `CACHE_VERSION`
- [ ] Paid ($0.99), no ads, no IAP set in Play Console
- [ ] Data Safety form completed; privacy + deletion URLs live and returning HTTP 200
- [ ] Internal testing track + Play **pre-launch report** (low-memory + current devices) reviewed
- [ ] Authoritative service deployed on a **paid** Render instance (free tier sleeps)
- [ ] Landscape, back-button, background/resume, and offline tutorial verified on a device

## 8. Service limitation (read this)

The online service is **single-instance only** — one process owns each live match
in memory. Do **not** raise `numInstances` in `render.yaml`; horizontal scaling
requires match-ownership leases + fencing tokens and a shared queue/room store,
which are not implemented. See `README.md` and `docs/DEPLOYMENT.md`.
