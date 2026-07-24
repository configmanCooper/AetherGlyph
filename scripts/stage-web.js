// stage-web.js — deterministically assemble the no-build web app into the
// Capacitor webDir (www/). The packaged app is served from the native origin
// (https://localhost), so we preserve the SAME absolute path layout the Node
// server uses — /client, /shared, /design at the webDir root. Client imports are
// relative so the same payload also works below a GitHub Pages project path.
// No path rewriting, no bundling, no build step.
//
// node_modules is NEVER copied. Only the vendored client libs, shared modules,
// design data, and a real root index.html end up in www/.
//
// Run: `npm run stage:web` (also invoked by sync-android.ps1 before cap sync).

import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
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
  ['index.html', 'the root GitHub Pages entry is missing'],
  ['.nojekyll', 'the GitHub Pages Jekyll opt-out is missing'],
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
  ['index.html', 'index.html'],
  ['.nojekyll', '.nojekyll'],
  ['MASTERPLAN.md', 'MASTERPLAN.md'],
  ['client/manifest.webmanifest', 'manifest.webmanifest'],
];

function skipCruft(src) {
  return !/[\\/]node_modules([\\/]|$)|[\\/]\.git([\\/]|$)|[\\/](?:\.DS_Store|Thumbs\.db)$/.test(src);
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

  log(`[stage-web] staged www/ from client, shared, design (+ root index, .nojekyll, manifest, MASTERPLAN)`);
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
