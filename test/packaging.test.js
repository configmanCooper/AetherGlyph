// packaging.test.js — validates the Android/Play packaging is complete and safe.
// Run: `npm run test:packaging`.
//
// Checks: staged web completeness, NO CDN dependencies (fully offline), packaged
// vs same-origin server URL behavior, capacitor/app-id/version/API values across
// package.json + capacitor.config + gradle + manifest, ignored signing material,
// and the service-worker scope + cache version.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { createHarness } from './tiny.js';
import { stageWeb, ROOT, WWW } from '../scripts/stage-web.js';
import { PACKAGED_SERVER_URL, resolveServerUrl } from '../client/src/net/serverConfig.js';

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

function isIgnored(rel) {
  try { execSync(`git check-ignore -q -- "${rel}"`, { cwd: ROOT, stdio: 'ignore' }); return true; }
  catch { return false; }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const { ok, eq, report } = createHarness();

// Fresh staging so the checks reflect the current source.
stageWeb();

const pkg = readJson('package.json');
const version = pkg.version;
ok(!!pkg.dependencies['@capacitor/screen-orientation'], 'screen orientation plugin is packaged');
ok(read('android/capacitor.settings.gradle').includes("include ':capacitor-screen-orientation'"),
  'Android settings include the ScreenOrientation plugin project');
ok(read('android/app/capacitor.build.gradle').includes("implementation project(':capacitor-screen-orientation')"),
  'Android app depends on the ScreenOrientation plugin');

// --- 1. staged web completeness -------------------------------------------
const requiredStaged = [
  'index.html',
  'manifest.webmanifest',
  'client/index.html',
  'client/src/app/main.js',
  'client/src/app/native.js',
  'client/src/net/serverConfig.js',
  'client/src/input/gestureInput.js',
  'client/src/tutorial/campaign.js',
  'client/src/tutorial/runner.js',
  'client/src/tutorial/objectives.js',
  'client/src/tutorial/progress.js',
  'client/src/tutorial/scriptBot.js',
  'client/src/tutorial/medals.js',
  'client/src/tutorial/secrets.js',
  'client/src/tutorial/calibration.js',
  'client/src/ui/coach.js',
  'client/src/game/localMatch.js',
  'client/styles/style.css',
  'client/manifest.webmanifest',
  'client/sw.js',
  'client/privacy.html',
  'client/account-deletion.html',
  'client/icons/icon-192.png',
  'client/icons/icon-512.png',
  'client/icons/maskable-512.png',
  'client/vendor/three.module.js',
  'client/vendor/socket.io.esm.min.js',
  'shared/src/balance/spellData.generated.js',
  'shared/src/bot/practiceBot.js',
  'shared/src/bot/combos.js',
  'shared/src/gesture/quality.js',
  'shared/src/analytics/coach.js',
  'shared/src/protocol/version.js',
  'design/spells.csv',
];
for (const rel of requiredStaged) {
  ok(existsSync(join(WWW, rel)), `staged www/${rel}`);
}
// Root index must hand off to the real client entry.
ok(/client\/index\.html/.test(read('www/index.html')), 'root index.html redirects into /client/index.html');
// node_modules must never be staged.
ok(!existsSync(join(WWW, 'node_modules')), 'www/ contains no node_modules');

// --- 2. no CDN dependencies (offline-first) --------------------------------
const CDN_HOSTS = [
  'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'esm.sh', 'cdn.skypack.dev',
  'ajax.googleapis.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.socket.io',
  'code.jquery.com', 'stackpath.bootstrapcdn.com', 'googletagmanager.com', 'google-analytics.com',
];
const textFiles = walk(WWW).filter((f) => /\.(html|js|mjs|css|webmanifest|json)$/i.test(f));
let cdnHits = [];
for (const f of textFiles) {
  const body = readFileSync(f, 'utf8');
  for (const host of CDN_HOSTS) {
    if (body.includes(host)) cdnHits.push(`${host} in ${f.replace(ROOT, '').replace(/\\/g, '/')}`);
  }
}
ok(cdnHits.length === 0, `no CDN references in staged assets${cdnHits.length ? ': ' + cdnHits.slice(0, 3).join('; ') : ''}`);
// Vendored libs must be real files, not redirect stubs.
ok(statSync(join(WWW, 'client/vendor/three.module.js')).size > 100000, 'three is vendored locally (large file)');
ok(statSync(join(WWW, 'client/vendor/socket.io.esm.min.js')).size > 10000, 'socket.io client is vendored locally');

// --- 3. packaged vs same-origin server URL behavior ------------------------
eq(PACKAGED_SERVER_URL, 'https://aetherglyph.onrender.com', 'packaged default is the Render https origin');
eq(resolveServerUrl({ native: true, origin: 'https://localhost', override: '' }), PACKAGED_SERVER_URL,
  'native build defaults to the packaged Render service');
eq(resolveServerUrl({ native: false, origin: 'https://aetherglyph.onrender.com', override: '' }), '',
  'same-origin web build stays same-origin');
eq(resolveServerUrl({ native: true, origin: 'https://localhost', override: 'http://evil.example.com' }), PACKAGED_SERVER_URL,
  'insecure override ignored -> native default');

// --- 4. capacitor / app id / version / API values --------------------------
const cap = readJson('capacitor.config.json');
eq(cap.appId, 'com.configmancooper.aetherglyph', 'capacitor appId');
eq(cap.appName, 'Aetherglyph: Arcane Duels', 'capacitor appName');
eq(cap.webDir, 'www', 'capacitor webDir is www');
eq(cap.server.androidScheme, 'https', 'androidScheme https (no cleartext origin)');
eq(cap.android.allowMixedContent, false, 'allowMixedContent false');
ok(Array.isArray(cap.server.allowNavigation) && cap.server.allowNavigation.includes('aetherglyph.onrender.com'),
  'allowNavigation includes the Render service');

const appGradle = read('android/app/build.gradle');
ok(appGradle.includes('applicationId "com.configmancooper.aetherglyph"'), 'gradle applicationId');
ok(appGradle.includes('versionCode 10400'), 'gradle versionCode 10400');
ok(appGradle.includes(`versionName "${version}"`), `gradle versionName ${version} matches package.json`);
ok(appGradle.includes('keystore.properties'), 'gradle reads keystore.properties for signing');
ok(appGradle.includes('signingConfig signingConfigs.release'), 'gradle applies the release signing config when present');
eq(readJson('package-lock.json').version, version, 'package-lock version matches package.json');
const publishingGuide = read('PUBLISHING-ANDROID.md');
ok(publishingGuide.includes('| Version code | `10400` |'), 'publishing guide versionCode 10400');
ok(publishingGuide.includes(`| Version name | \`${version}\` |`), `publishing guide versionName ${version}`);

const vars = read('android/variables.gradle');
ok(/minSdkVersion\s*=\s*24/.test(vars), 'minSdk 24');
ok(/compileSdkVersion\s*=\s*36/.test(vars), 'compileSdk 36');
ok(/targetSdkVersion\s*=\s*36/.test(vars), 'targetSdk 36');

const strings = read('android/app/src/main/res/values/strings.xml');
ok(strings.includes('Aetherglyph: Arcane Duels'), 'android app_name is the full title');

const manifestXml = read('android/app/src/main/AndroidManifest.xml');
ok(!manifestXml.includes('android:screenOrientation="landscape"'), 'Android activity allows portrait and landscape');
ok(manifestXml.includes('android:usesCleartextTraffic="false"'), 'no cleartext traffic in production');
ok(manifestXml.includes('android:networkSecurityConfig="@xml/network_security_config"'), 'network security config referenced');
ok(manifestXml.includes('android.permission.INTERNET'), 'INTERNET permission declared');
ok(manifestXml.includes('android.permission.ACCESS_NETWORK_STATE'), 'ACCESS_NETWORK_STATE permission declared');
ok(!/CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|READ_CONTACTS/.test(manifestXml), 'no sensitive permissions requested');
ok(existsSync(join(ROOT, 'android/app/src/main/res/xml/network_security_config.xml')), 'network_security_config.xml exists');
ok(!existsSync(join(ROOT, 'android/app/src/debug/AndroidManifest.xml')), 'no ineffective debug cleartext override is shipped');

// web manifest values (source + staged copy)
const wm = readJson('client/manifest.webmanifest');
eq(wm.name, 'Aetherglyph: Arcane Duels', 'web manifest name');
eq(wm.orientation, 'any', 'installable web app supports portrait and landscape');
ok(['fullscreen', 'standalone'].includes(wm.display), 'web manifest display is app-like');
ok(typeof wm.start_url === 'string' && wm.start_url.length > 0, 'web manifest has start_url');
eq(wm.theme_color, '#0a0713', 'web manifest theme color matches app');
const sizes = (wm.icons || []).map((i) => i.sizes);
ok(sizes.includes('192x192') && sizes.includes('512x512'), 'web manifest has 192 + 512 icons');
ok((wm.icons || []).some((i) => /maskable/.test(i.purpose || '')), 'web manifest has a maskable icon');

// --- 5. ignored signing material -------------------------------------------
const gitignore = read('.gitignore');
for (const entry of ['android/keystore.properties', 'android/*.keystore', 'android/local.properties', 'www/']) {
  ok(gitignore.includes(entry), `.gitignore lists ${entry}`);
}
ok(isIgnored('android/keystore.properties'), 'git ignores android/keystore.properties');
ok(isIgnored('android/aetherglyph-upload.keystore'), 'git ignores the upload keystore');
ok(isIgnored('android/local.properties'), 'git ignores android/local.properties');
ok(isIgnored('www'), 'git ignores the generated www/ staging dir');
// The project source and config MUST remain trackable (not ignored).
ok(!isIgnored('capacitor.config.json'), 'capacitor.config.json is tracked (not ignored)');
ok(!isIgnored('android/app/build.gradle'), 'android/app/build.gradle is tracked (not ignored)');
// No secret files should be present-and-committable.
ok(!existsSync(join(ROOT, 'android/keystore.properties')) || isIgnored('android/keystore.properties'),
  'any keystore.properties present is git-ignored');

// --- 6. service worker scope + cache version -------------------------------
const sw = read('client/sw.js');
const cacheMatch = sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/);
ok(!!cacheMatch, 'sw.js declares CACHE_VERSION');
eq(cacheMatch && cacheMatch[1], version, 'sw.js CACHE_VERSION matches package.json version');
ok(sw.includes("startsWith('/socket.io/')") || sw.includes('/socket.io/'), 'sw.js excludes Socket.IO traffic');
ok(sw.includes('self.location.origin'), 'sw.js only handles same-origin requests (scope-safe)');

const main = read('client/src/app/main.js');
ok(main.includes("navigator.serviceWorker.register('./sw.js')"), 'main.js registers ./sw.js (scope /client/)');
ok(main.includes('isNativeApp') && /loc\.protocol\s*!==\s*'https:'/.test(main),
  'SW registration is gated to production web (never native / never non-https dev)');
ok(read('client/index.html').includes('data-action="install-app"'), 'Settings exposes an install web app action');
ok(main.includes('beforeinstallprompt') && main.includes("endsWith('.onrender.com')") && main.includes('/Android/i'),
  'Android Render install prompt is captured and gated to onrender.com');
ok(main.includes('(display-mode: standalone)') && main.includes('(display-mode: fullscreen)'),
  'installed PWA detection covers standalone and fullscreen modes');
const nativeBridge = read('client/src/app/native.js');
ok(nativeBridge.includes("plugin('ScreenOrientation')") && nativeBridge.includes('setNativeOrientation'),
  'native bridge applies the Settings orientation through Capacitor');

// --- 7. solo progress + Delete My Data disclosure --------------------------
// The tutorial ships as a real, offline, single-player campaign and its local
// progress must be named in the deletion disclosure + cleared in-app.
const deletion = read('client/account-deletion.html');
ok(deletion.includes('aeg.solo.v1'), 'account-deletion.html names the solo progress key aeg.solo.v1');
ok(/solo progress/i.test(deletion) && /calibration/i.test(deletion) && /medals/i.test(deletion),
  'account-deletion.html discloses solo progress, calibration, and medals');
ok(/secret/i.test(deletion) && /coaching/i.test(deletion),
  'account-deletion.html discloses secret discoveries and coaching statistics');
ok(main.includes('deleteProfile(localStorage)'),
  'in-app Delete My Data clears the solo profile from local storage');
ok(/solo progress/i.test(main) && /calibration/i.test(main),
  'in-app deletion confirmation names solo progress + calibration');

// The solo tutorial is offline-only: it must not reference the network/server.
const runnerSrc = read('client/src/tutorial/runner.js');
ok(!/socket\.io|OnlineMatch|serverConfig|fetch\(/.test(runnerSrc), 'the tutorial runner has no network dependency (offline-only)');

const r = report('packaging');
console.log(`\npackaging: ${r.pass} passed, ${r.fail} failed`);
process.exit(r.fail > 0 ? 1 : 0);
