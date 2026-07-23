// stage-demo-web.js — assemble the offline-only Android demo web bundle.

import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, WWW, stageWeb } from './stage-web.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEMO_WWW = join(ROOT, 'www-demo');

const DEMO_MESSAGE =
  'Thanks for playing the demo! For online functionality, please purchase the full version of Aetherglyph: Arcane Duels';

function write(rel, content) {
  const target = join(DEMO_WWW, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

export function stageDemoWeb({ log = () => {} } = {}) {
  stageWeb();
  rmSync(DEMO_WWW, { recursive: true, force: true });
  cpSync(WWW, DEMO_WWW, { recursive: true });

  write('client/src/app/edition.js', `export const DEMO_BUILD = true;
export const DEMO_ONLINE_MESSAGE = ${JSON.stringify(DEMO_MESSAGE)};
`);

  write('client/src/net/onlineMatch.js', `export class OnlineMatch {
  constructor() { throw new Error('Online play is unavailable in the Aetherglyph demo.'); }
}
`);

  write('client/src/net/net.js', `const ID_KEY = 'aeg-demo-client-id';
const NAME_KEY = 'aeg-demo-name';
export function clientIdentity() {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = 'demo-' + Date.now().toString(36);
    localStorage.setItem(ID_KEY, id);
  }
  return { clientId: id, name: localStorage.getItem(NAME_KEY) || '' };
}
export function setDisplayName(name) {
  localStorage.setItem(NAME_KEY, String(name || '').slice(0, 24));
}
export function loadResume() { return null; }
`);

  write('client/src/net/serverConfig.js', `export function effectiveServerUrl() { return ''; }
export function getStoredServerUrl() { return ''; }
export function setStoredServerUrl() {
  return { ok: false, error: 'Online play is unavailable in the demo.', url: '' };
}
export function describeServerTarget() { return 'Online play unavailable in demo'; }
`);

  const clientIndexPath = join(DEMO_WWW, 'client', 'index.html');
  const clientIndex = readFileSync(clientIndexPath, 'utf8')
    .replace(/\s*"socket\.io-client"\s*:\s*"[^"]+",?\s*/g, '\n');
  writeFileSync(clientIndexPath, clientIndex, 'utf8');

  const manifestPaths = [
    join(DEMO_WWW, 'manifest.webmanifest'),
    join(DEMO_WWW, 'client', 'manifest.webmanifest'),
  ];
  for (const path of manifestPaths) {
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.name = 'Aetherglyph: Arcane Duels Demo';
    manifest.short_name = 'Aetherglyph Demo';
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  write('client/privacy.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aetherglyph Demo Privacy</title></head><body>
<h1>Aetherglyph Demo Privacy</h1>
<p>The demo is an offline-only game. It has no Internet permission, account system, advertising, analytics, or online-play connection.</p>
<p>Progress and settings are stored only on this device and can be removed from Settings &gt; Delete My Data or by uninstalling the app.</p>
</body></html>`);
  write('client/account-deletion.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aetherglyph Demo Data Deletion</title></head><body>
<h1>Delete Aetherglyph Demo Data</h1>
<p>The demo creates no account and stores no remote data.</p>
<p>Use Settings &gt; Delete My Data to erase local progress, or uninstall the app.</p>
</body></html>`);

  for (const rel of [
    'MASTERPLAN.md',
    'client/sw.js',
    'client/vendor/socket.io.esm.min.js',
    'shared/src/protocol/events.js',
  ]) {
    rmSync(join(DEMO_WWW, rel), { force: true });
  }

  log(`[stage-demo] staged offline-only demo at ${DEMO_WWW}`);
  return { demoWww: DEMO_WWW, message: DEMO_MESSAGE };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  try {
    stageDemoWeb({ log: (message) => console.log(message) });
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(1);
  }
}
