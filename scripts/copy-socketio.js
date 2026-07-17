// copy-socketio.js — vendor the Socket.IO browser ESM client from node_modules
// into the client so online play works with no CDN dependency (mirrors
// copy-three.js). Runs on `npm install` (postinstall) and `npm run vendor:socketio`.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'node_modules', 'socket.io-client', 'dist', 'socket.io.esm.min.js');
const DEST_DIR = join(ROOT, 'client', 'vendor');
const DEST = join(DEST_DIR, 'socket.io.esm.min.js');

if (!existsSync(SRC)) {
  console.warn('[vendor:socketio] node_modules/socket.io-client not found. Run `npm install` first.');
  process.exit(0);
}

mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(SRC, DEST);
console.log(`[vendor:socketio] copied ${SRC} -> ${DEST}`);
