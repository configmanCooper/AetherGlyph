// onlineMatch.test.js - client reload-resume behavior with an injected socket.

import { createHarness } from './tiny.js';
import { OnlineMatch } from '../client/src/net/onlineMatch.js';
import { EVENTS } from '../shared/src/protocol/events.js';

class FakeSocket {
  constructor() {
    this.connected = true;
    this.handlers = new Map();
    this.resumePayload = null;
  }

  on(name, fn) {
    const list = this.handlers.get(name) || [];
    list.push(fn);
    this.handlers.set(name, list);
  }

  emit(name, payload, ack) {
    if (name === EVENTS.RESUME) {
      this.resumePayload = payload;
      ack({
        ok: true,
        matchId: 'reload-match',
        slot: 1,
        epoch: 2,
        token: 'rotated-token',
      });
    }
  }

  trigger(name, payload) {
    for (const fn of this.handlers.get(name) || []) fn(payload);
  }

  removeAllListeners() { this.handlers.clear(); }
  disconnect() { this.connected = false; }
}

export async function run() {
  const { ok, eq, report } = createHarness();
  const socket = new FakeSocket();
  let start = null;
  let status = null;
  const online = new OnlineMatch({
    loadoutIds: [1, 6, 31, 28, 22, 10, 13, 16],
    identity: { id: 'reload-account', name: 'Reload' },
    socketFactory: () => socket,
    resumeLoader: () => ({ matchId: 'reload-match', token: 'stored-token' }),
    onMatchStart: (p) => { start = p; },
    onStatus: (p) => { status = p; },
  });

  const connected = online.connect();
  socket.trigger('connect');
  await connected;

  eq(socket.resumePayload.token, 'stored-token', 'fresh client submits persisted token after connect');
  eq(online.inMatch, true, 'successful reload resume restores in-match state');
  eq(online.matchId, 'reload-match', 'reload resume restores match id');
  eq(online.resumeToken, 'rotated-token', 'reload resume stores rotated token');
  ok(start && start.resumed === true, 'reload resume invokes match-start UI callback');
  eq(status.state, 'resumed', 'reload resume reports resumed status');
  online.dispose();
  return report('onlineMatch');
}
