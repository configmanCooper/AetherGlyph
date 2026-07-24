# Aetherglyph — Android / Capacitor packaging

Phase 4 wraps the **no-build ES-module** web app as a Capacitor Android app and a
Google Play App Bundle, without changing the runtime architecture: the same
`client/` + `shared/` + `design/` modules run in the browser (served by
`server.js`) and in the packaged app (served from the native origin).

## Toolchain (shared, non-admin)

Scripts resolve, in order, a project-local `build-tools\` then the shared
`C:\Users\rocma\CLI\Fish-Friends-Play\build-tools`:

- JDK 17 (`build-tools\jdk\jdk-17*`) → `JAVA_HOME`
- Android SDK (`build-tools\android-sdk`) → `ANDROID_HOME` (platforms `android-36`,
  build-tools `35.0.0`)

Capacitor **6** is used deliberately: it builds with JDK 17 (Capacitor 7 requires
JDK 21). App id `com.configmancooper.aetherglyph`, app name
“Aetherglyph: Arcane Duels”.

## Web staging (`scripts/stage-web.js` → `www/`)

`npm run stage:web` deterministically assembles the Capacitor `webDir`:

- copies `client/`, `shared/`, `design/` **verbatim** to `www/` so the absolute
  import-map/static paths (`/client/vendor/…`, `/shared/src/…`, `/design/…`,
  `/MASTERPLAN.md`) resolve unchanged under the native origin (`https://localhost`).
  No path rewriting, no bundler.
- writes a **real root `www/index.html`** that hands off to `./client/index.html`.
- copies the web manifest to the root and `MASTERPLAN.md` for the in-app links.
- **never copies `node_modules`** (guarded).

Prerequisites (fail loudly if missing): vendored `client/vendor/three.module.js`
and `socket.io.esm.min.js` (`npm install`), generated spell data
(`npm run gen:spells`), and generated icons (`npm run android:assets`).

`sync-android.ps1` runs staging then `cap sync`, copying `www/` into
`android/app/src/main/assets/public/` (git-ignored) and updating plugins.

## Where online play connects (`client/src/net/serverConfig.js`)

- **Packaged app:** defaults to `https://aetherglyph.onrender.com`.
- **Same-origin web:** stays same-origin (connects to whatever served the client).
- **Override:** *Settings → Online service URL* persists a validated override.
  The Android app requires HTTPS because its WebView runs on a secure origin.
  Plain HTTP localhost/RFC-1918 overrides are available only in browser
  development. *Use default* resets it. *Delete my data* wipes the local id,
  name, resume token, settings, and override.

The server’s Origin gate already allows the native origin (`https://localhost`)
and the Render origin, so no server change is needed for the app to connect.

## Manifest + service worker

- `client/manifest.webmanifest` — portrait/landscape capable, fullscreen, `#0a0713` theme, 192/512
  + maskable icons.
- `client/sw.js` — an **optional production offline fallback** for the same-origin
  **web** build only. `main.js` registers it **only** on a production HTTPS web
  origin — never in the native shell (assets ship natively) and never on
  localhost/LAN dev, so dev cache iteration is unaffected. It never touches
  Socket.IO or cross-origin traffic. `CACHE_VERSION` tracks `package.json`
  `version` (enforced by `test:packaging`).

## Native integration (`client/src/app/native.js`)

Uses the Capacitor runtime bridge (`window.Capacitor.Plugins.*`) — no plugin
imports, so every call is a safe no-op in a plain browser:

- **Back button** (`@capacitor/app`): closes an open subpanel first; in a live
  online duel prompts to confirm forfeit; at the main menu exits; otherwise opens
  the pause menu.
- **Lifecycle** (`appStateChange`): pauses input / stops issuing online intents
  when backgrounded and resumes on foreground (shared with the Page Visibility
  handler; captured once so duplicate events don’t break resume).
- **Haptics** (`@capacitor/haptics`): native impact with a Web Vibration fallback.
- **Orientation** (`@capacitor/screen-orientation`): Settings can unlock rotation
  or lock the native activity to portrait or landscape.

## Android project (`android/`, checked in)

- `variables.gradle`: `minSdk 24`, `compileSdk 36`, `targetSdk 36`.
- `app/build.gradle`: `versionCode 10710`, `versionName "1.7.10"`; release signing
  read from an ignored `keystore.properties` (unsigned when absent).
- `AndroidManifest.xml`: `singleTask`, orientation unlocked for the in-app
  Auto/Portrait/Landscape selector,
  `usesCleartextTraffic="false"` + `@xml/network_security_config`, `INTERNET` +
  `ACCESS_NETWORK_STATE`.
- `res/xml/network_security_config.xml`: HTTPS-only, with loopback entries kept
  for Android tooling. The secure WebView does not claim unsupported HTTP LAN
  connectivity.
- `capacitor.config.json`: `androidScheme: https`, `allowMixedContent: false`,
  `allowNavigation: [aetherglyph.onrender.com]`, `backgroundColor: #0a0713`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run stage:web` | Assemble `www/` from the no-build sources |
| `npm run android:assets` | Generate app icon/adaptive/splash + Play 512 + feature graphic + PWA icons |
| `npm run android:screenshots` | Deterministic phone screenshots (needs local Edge/Chrome) |
| `.\setup-android.ps1` | Accept SDK licenses; create the upload keystore (first run) |
| `.\sync-android.ps1` | Stage web + `cap sync android` |
| `.\build-android.ps1` | Stage → sync → Gradle → named artifacts in `dist\` |
| `npm run test:packaging` | Validate staging, no-CDN, ids/versions/API, ignores, SW |

## Two-device LAN development

Run `npm start` and open `http://<lan-ip>:8130/client/index.html` in two browsers,
then create/join a private duel. A debug APK still requires an HTTPS service;
use the default Render service or expose the development server through a trusted
HTTPS endpoint. Release builds are HTTPS-only.

## Service limitation

The authoritative service is **single-instance only** (in-memory match ownership).
Do not raise `numInstances` in `render.yaml`. See `docs/DEPLOYMENT.md`.
