// net.js — low-level client networking helpers: a stable anonymous identity
// persisted locally, a configured Socket.IO connection, and a small latency
// probe for the connection-quality indicator. The authoritative match logic
// lives in onlineMatch.js.

import { io } from 'socket.io-client';
import {
  PROTOCOL_VERSION, BALANCE_VERSION, ROSTER_CHECKSUM,
} from '../../../shared/src/protocol/version.js';

const ID_KEY = 'aeth-client-id';
const NAME_KEY = 'aeth-name';
const RESUME_KEY = 'aeth-resume';

// A stable, anonymous client id persisted locally (no account required). Used
// as the rating account key and to bind resume tokens.
export function clientIdentity() {
  let id = null; let name = '';
  try {
    id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = `anon-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      localStorage.setItem(ID_KEY, id);
    }
    name = localStorage.getItem(NAME_KEY) || '';
  } catch {
    id = id || `anon-${Math.random().toString(36).slice(2, 10)}`;
  }
  return { id, name };
}

export function setDisplayName(name) {
  try { localStorage.setItem(NAME_KEY, String(name || '').slice(0, 24)); } catch { /* ignore */ }
}

// Persist the single-use resume token locally so a transient reconnect (or a
// reload) can re-attach to an in-progress match. Live combat state is NEVER
// stored — only the opaque token + match id.
export function saveResume(matchId, token) {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ matchId, token, at: Date.now() })); } catch { /* ignore */ }
}
export function loadResume() {
  try { return JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); } catch { return null; }
}
export function clearResume() {
  try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
}

// Open a Socket.IO connection with the compatibility handshake auth. `url`
// empty => same origin (the server that served the client).
export function openSocket(url, identity) {
  const auth = {
    protocol: PROTOCOL_VERSION,
    balance: BALANCE_VERSION,
    roster: ROSTER_CHECKSUM,
    clientId: identity.id,
    name: identity.name,
  };
  return io(url || undefined, {
    transports: ['websocket'],
    auth,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 9000,
  });
}

export function qualityFromRtt(rtt) {
  if (rtt == null) return 'unknown';
  if (rtt < 90) return 'good';
  if (rtt < 180) return 'fair';
  return 'poor';
}
