// stage-web.js — deterministically assemble the no-build web app into the
// Capacitor webDir (www/). The packaged app is served from the native origin
// (https://localhost), so we preserve the SAME absolute path layout the Node
// server uses — /client, /shared, /design at the webDir root — which means the
// client's absolute import-map paths (/client/vendor/..., /shared/src/...) and
// static links (/design/spells.csv, /MASTERPLAN.md) resolve unchanged. No path
// rewriting, no bundling, no build step.
//
// node_modules is NEVER copied. Only the vendored client libs, shared modules,
// design data, and a real root index.html end up in www/.
//
// Run: `npm run stage:web` (also invoked by sync-android.ps1 before cap sync).

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const WWW = join(ROOT, 'www');

// Files that MUST exist before staging (produced by `npm install` +
// `npm run gen:spells`). We fail loudly with the exact fix rather than shipping
// a broken package.
const REQUIRED = [
  ['client/index.html', 'the client is missing'],
  ['client/src/app/main.js', 'the client is missing'],
  ['client/styles/style.css', 'the client is missing'],
  ['client/manifest.webmanifest', 'the web manifest is missing'],
  ['client/sw.js', 'the service worker is missing'],
  ['client/icons/icon-512.png', 'run `npm run android:assets` to generate icons'],
  ['client/vendor/three.module.js', 'run `npm run vendor:three` (or `npm install`)'],
  ['client/vendor/socket.io.esm.min.js', 'run `npm run vendor:socketio` (or `npm install`)'],
  ['shared/src/balance/spellData.generated.js', 'run `npm run gen:spells`'],
];

// Directories copied verbatim into the webDir root (layout preserved).
const COPY_DIRS = ['client', 'shared', 'design'];

// Single files copied to the webDir root so absolute links keep working offline.
const COPY_FILES = [
  ['MASTERPLAN.md', 'MASTERPLAN.md'],
  ['client/manifest.webmanifest', 'manifest.webmanifest'],
];

function skipCruft(src) {
  return !/[\\/]node_modules([\\/]|$)|[\\/]\.git([\\/]|$)|[\\/](?:\.DS_Store|Thumbs\.db)$/.test(src);
}

function rootIndexHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <meta name="theme-color" content="#0a0713" />
  <title>Aetherglyph: Arcane Duels</title>
  <link rel="manifest" href="./manifest.webmanifest" />
  <link rel="apple-touch-icon" href="./client/icons/icon-192.png" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%E2%9C%A6%3C/text%3E%3C/svg%3E" />
  <meta http-equiv="refresh" content="0; url=./client/index.html" />
  <style>
    html, body { margin: 0; height: 100%; background: #0a0713; color: #ece7f6;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
    .boot { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      letter-spacing: 2px; color: #8b6bff; }
  </style>
  <script>window.location.replace('./client/index.html');</script>
</head>
<body>
  <div class="boot">Aetherglyph…</div>
  <noscript><p style="text-align:center"><a href="./client/index.html" style="color:#8b6bff">Enter Aetherglyph</a></p></noscript>
</body>
</html>
`;
}

export function stageWeb({ log = () => {} } = {}) {
  const missing = [];
  for (const [rel, hint] of REQUIRED) {
    if (!existsSync(join(ROOT, rel))) missing.push(`${rel} (${hint})`);
  }
  if (missing.length) {
    throw new Error(`stage-web: missing prerequisites:\n  - ${missing.join('\n  - ')}`);
  }

  rmSync(WWW, { recursive: true, force: true });
  mkdirSync(WWW, { recursive: true });

  for (const dir of COPY_DIRS) {
    cpSync(join(ROOT, dir), join(WWW, dir), { recursive: true, filter: skipCruft });
  }
  for (const [src, dest] of COPY_FILES) {
    copyFileSync(join(ROOT, src), join(WWW, dest));
  }

  writeFileSync(join(WWW, 'index.html'), rootIndexHtml(), 'utf8');

  log(`[stage-web] staged www/ from client, shared, design (+ root index, manifest, MASTERPLAN)`);
  return { www: WWW };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  try {
    stageWeb({ log: (m) => console.log(m) });
    console.log('[stage-web] done.');
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  }
}
