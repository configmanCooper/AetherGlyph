// onlineMatch.test.js - client reload-resume behavior with an injected socket.

import { createHarness } from './tiny.js';
import { OnlineMatch, formatOnlinePopulation } from '../client/src/net/onlineMatch.js';
import { EVENTS } from '../shared/src/protocol/events.js';

class FakeSocket {
  constructor() {
    this.connected = true;
    this.handlers = new Map();
    this.resumePayload = null;
    this.emitted = [];
    this.leaveAck = { ok: true };
  }

  on(name, fn) {
    const list = this.handlers.get(name) || [];
    list.push(fn);
    this.handlers.set(name, list);
  }

  emit(name, payload, ack) {
    this.emitted.push({ name, payload });
    if (name === EVENTS.RESUME) {
      this.resumePayload = payload;
      ack({
        ok: true,
        matchId: 'reload-match',
        slot: 1,
        epoch: 2,
        token: 'rotated-token',
      });
    } else if (name === EVENTS.LEAVE && typeof ack === 'function') {
      ack(this.leaveAck);
    } else if (typeof ack === 'function') {
      ack({ ok: true });
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
  eq(formatOnlinePopulation(9999), '9999', 'population formatter shows values through 9999');
  eq(formatOnlinePopulation(10000), '9999+', 'population formatter caps larger values at 9999+');
  const socket = new FakeSocket();
  let start = null;
  let status = null;
  let population = null;
  let room = null;
  let ended = null;
  const online = new OnlineMatch({
    loadoutIds: [1, 6, 31, 28, 22, 10, 13, 16],
    identity: { id: 'reload-account', name: 'Reload' },
    socketFactory: () => socket,
    resumeLoader: () => ({ matchId: 'reload-match', token: 'stored-token' }),
    onMatchStart: (p) => { start = p; },
    onStatus: (p) => { status = p; },
    onPopulation: (p) => { population = p; },
    onRoom: (p) => { room = p; },
    onMatchEnd: (p) => { ended = p; },
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

  socket.trigger(EVENTS.POPULATION, { online: 123 });
  eq(population.online, 123, 'population updates reach the app callback');
  socket.trigger(EVENTS.ROOM_UPDATE, { state: 'private-lobby', code: 'ABCDE', readyCount: 0 });
  eq(room.code, 'ABCDE', 'private-lobby updates reach the app callback');
  eq(online.privateCode, 'ABCDE', 'private room code is retained between matches');

  socket.trigger(EVENTS.MATCH_START, {
    matchId: 'private-match', slot: 0, epoch: 1, token: 'private-token',
    code: 'ABCDE', ranked: false,
  });
  const surrendered = await online.surrender();
  eq(surrendered.ok, true, 'surrender receives a server acknowledgement');
  const leave = socket.emitted.findLast((entry) => entry.name === EVENTS.LEAVE);
  eq(leave.payload.surrender, true, 'surrender emits an explicit leave intent');
  socket.trigger(EVENTS.MATCH_END, { winner: 'loss', reason: 'forfeit', code: 'ABCDE', ranked: false });
  eq(ended.code, 'ABCDE', 'private match end preserves the room code for the lobby return');
  eq(online.privateCode, 'ABCDE', 'surrender does not discard the private room code');

  online.inMatch = true;
  socket.leaveAck = { ok: false, code: 'rate' };
  const rejectedSurrender = await online.surrender();
  eq(rejectedSurrender.ok, false, 'rejected surrender reports failure');
  eq(online.inMatch, true, 'rejected surrender keeps the local match active');
  eq(online.privateCode, 'ABCDE', 'rejected surrender keeps the private room context');
  online.inMatch = false; // simulate the between-match private lobby
  socket.trigger('disconnect');
  eq(online.privateCode, null, 'disconnect from a private lobby clears stale room state');
  eq(room.state, 'closed', 'private lobby disconnect reports a closed room to the app');
  online.dispose();
  return report('onlineMatch');
}
