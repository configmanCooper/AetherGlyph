// copy-three.js — vendor the Three.js ESM build from node_modules into the
// client so the game works fully offline with no CDN dependency.
// Runs on `npm install` (postinstall) and via `npm run vendor:three`.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
const DEST_DIR = join(ROOT, 'client', 'vendor');
const DEST = join(DEST_DIR, 'three.module.js');

if (!existsSync(SRC)) {
  console.warn('[vendor:three] node_modules/three not found. Run `npm install` first.');
  process.exit(0);
}

mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(SRC, DEST);
console.log(`[vendor:three] copied ${SRC} -> ${DEST}`);
