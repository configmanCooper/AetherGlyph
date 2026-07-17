// server.js — Aetherglyph Phase 3 authoritative online service.
//
// Express serves the static client + shared/design modules and a Render-style
// health endpoint (unchanged from Phase 1); Socket.IO adds the authoritative
// 1v1 duel service (rooms, quick match, reconnect). The server OWNS every match
// simulation — clients never set health, resources, spell ids, or results.
//
// Hardened connection gate (adapted from the Garden & Griddle reference):
// strict configurable Origin allowlist with localhost/dev + private-LAN support,
// a protocol/balance/roster compatibility gate, bounded payloads, security
// headers, per-event acknowledgements, and a graceful SIGTERM drain.
//
// SINGLE INSTANCE ONLY: one process owns each live match. Horizontal scaling
// requires external match ownership leases + fencing tokens and is NOT enabled
// (see render.yaml + README).

import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { RoomManager } from './server/roomManager.js';
import { createRatingStore } from './server/ratings.js';
import { randomSecret } from './server/tokens.js';
import { NET } from './shared/src/protocol/net.js';
import {
  PROTOCOL_VERSION, BALANCE_VERSION, ROSTER_CHECKSUM, APP_PHASE, versionTag,
} from './shared/src/protocol/version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

function parseOrigins(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Origin gate: allow no-origin (native app / same-origin), localhost/127.0.0.1
// dev, an explicit allowlist, and (only when no allowlist is configured) the
// private LAN so two devices on the same Wi-Fi can play during development.
function makeOriginGate(allowed) {
  const LOCALHOST = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;
  const CAPACITOR = /^(?:capacitor|ionic|https?):\/\/localhost$/i;
  const PRIVATE_LAN = /^https?:\/\/(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$/i;
  return (origin, cb) => {
    if (!origin) return cb(null, true);
    if (LOCALHOST.test(origin) || CAPACITOR.test(origin)) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    if (!allowed.length && PRIVATE_LAN.test(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'));
  };
}

export function createGameServer(opts = {}) {
  const app = express();
  const server = http.createServer(app);
  const allowedOrigins = opts.allowedOrigins || parseOrigins(process.env.ALLOWED_ORIGINS);
  const secret = opts.secret || process.env.SESSION_SECRET || randomSecret();

  const io = new Server(server, {
    cors: { origin: makeOriginGate(allowedOrigins), methods: ['GET', 'POST'] },
    maxHttpBufferSize: 16 * 1024, // bounded payloads (cast trace cap is 2 KB)
    pingTimeout: 20000,
    pingInterval: 12000,
    perMessageDeflate: { threshold: 1024 },
  });

  let rooms = null;
  let ratingStore = opts.ratingStore || null;

  // Security headers + hardening.
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true, phase: APP_PHASE, service: 'aetherglyph', time: Date.now(),
      version: versionTag(), rating: ratingStore ? ratingStore.kind : 'pending',
      ...(rooms ? rooms.stats() : { rooms: 0, queue: 0, matches: 0 }),
    });
  });

  // Serve shared modules and the client (correct MIME via express.static).
  app.use('/shared', express.static(join(ROOT, 'shared')));
  app.use('/client', express.static(join(ROOT, 'client')));
  app.use('/design', express.static(join(ROOT, 'design')));
  app.get('/MASTERPLAN.md', (_req, res) => res.sendFile(join(ROOT, 'MASTERPLAN.md')));
  app.get('/', (_req, res) => res.redirect('/client/index.html'));

  // Compatibility gate: reject mismatched protocol/balance/roster up front with
  // a clear reason (never a silent mismatch).
  io.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    if (Number(auth.protocol) !== PROTOCOL_VERSION
      || Number(auth.balance) !== BALANCE_VERSION
      || String(auth.roster) !== String(ROSTER_CHECKSUM)) {
      const err = new Error('Incompatible client — update required');
      err.data = { code: 'incompatible', server: versionTag() };
      return next(err);
    }
    next();
  });

  async function listen(port) {
    if (!ratingStore) ratingStore = await createRatingStore();
    rooms = new RoomManager(io, {
      secret,
      ratingStore,
      graceMs: opts.graceMs,
      intermissionMs: opts.intermissionMs,
      log: (...a) => console.warn('[rooms]', ...a),
    });
    io.on('connection', (socket) => rooms.register(socket));
    const target = port === undefined ? Number(process.env.PORT || 8130) : port;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(target, () => { server.off('error', reject); resolve(); });
    });
    return server.address().port;
  }

  async function close(reason) {
    if (rooms) rooms.close(reason);
    await new Promise((resolve) => io.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (ratingStore && ratingStore.close) { try { await ratingStore.close(); } catch { /* best effort */ } }
  }

  return { app, server, io, get rooms() { return rooms; }, listen, close, secret };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  // Warn early if assets have not been prepared.
  if (!existsSync(join(ROOT, 'client', 'vendor', 'three.module.js'))) {
    console.warn('[server] client/vendor/three.module.js missing — run `npm run vendor:three`.');
  }
  if (!existsSync(join(ROOT, 'client', 'vendor', 'socket.io.esm.min.js'))) {
    console.warn('[server] client/vendor/socket.io.esm.min.js missing — run `npm run vendor:socketio`.');
  }
  if (!existsSync(join(ROOT, 'shared', 'src', 'balance', 'spellData.generated.js'))) {
    console.warn('[server] generated spell data missing — run `npm run gen:spells`.');
  }

  const gameServer = createGameServer();
  gameServer.listen().then((port) => {
    console.log(`Aetherglyph (Phase ${APP_PHASE} online) on http://localhost:${port}  [${versionTag()}]`);
    console.log(`  play:   http://localhost:${port}/client/index.html`);
    console.log(`  health: http://localhost:${port}/healthz`);
    console.log(`  tick=${NET.TICK_HZ}Hz snapshots=${NET.SNAPSHOT_HZ}Hz`);
  }).catch((err) => { console.error('[server] failed to start:', err); process.exit(1); });

  // Graceful SIGTERM/SIGINT drain for Render deploys.
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[server] draining active matches for shutdown...');
    if (gameServer.rooms) gameServer.rooms.drain('Server maintenance');
    setTimeout(() => { gameServer.close('Server maintenance').finally(() => process.exit(0)); }, 400).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
