// onlineMatch.test.js - client reload-resume behavior with an injected socket.

import { createHarness } from './tiny.js';
import { OnlineMatch, formatOnlinePopulation } from '../client/src/net/onlineMatch.js';
import { EVENTS } from '../shared/src/protocol/events.js';

class FakeSocket {
  constructor() {
    this.connected = true;
    this.handlers = new Map();
    this.resumePayload = null;
    this.joinPayload = null;
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
        ranked: false,
      });
    } else if (name === EVENTS.JOIN_ROOM) {
      this.joinPayload = payload;
      ack({
        ok: true, state: 'private-lobby', code: payload.code,
        slot: 0, readyCount: 0, playerCount: 2, selfReady: false, resumed: true,
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
  eq(start.ranked, false, 'reload resume preserves unranked match labeling');
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
  eq(online.privateCode, 'ABCDE', 'disconnect retains private lobby state for automatic reclaim');
  eq(status.state, 'lobby-reconnecting', 'private lobby disconnect reports reconnecting state');
  online.dispose();

  const lobbySocket = new FakeSocket();
  let lobbyRoom = null;
  let lobbyStatus = null;
  const lobbyOnline = new OnlineMatch({
    loadoutIds: [1, 6, 31, 28, 22, 10, 13, 16],
    identity: { id: 'lobby-account', name: 'Lobby' },
    socketFactory: () => lobbySocket,
    resumeLoader: () => null,
    privateCode: 'ABCDE',
    onRoom: (payload) => { lobbyRoom = payload; },
    onStatus: (payload) => { lobbyStatus = payload; },
  });
  const lobbyConnected = lobbyOnline.connect();
  lobbySocket.trigger('connect');
  await lobbyConnected;
  await new Promise((resolve) => setTimeout(resolve, 0));
  eq(lobbySocket.joinPayload.code, 'ABCDE', 'reconnect automatically reclaims the saved private lobby code');
  eq(lobbyRoom.state, 'private-lobby', 'automatic lobby reclaim restores private-lobby state');
  eq(lobbyStatus.state, 'lobby-resumed', 'automatic lobby reclaim reports resumed status');
  const unready = await lobbyOnline.privateUnready();
  eq(unready.ok, true, 'client can unready before editing lobby guides');
  await lobbyOnline.quickMatch(false);
  const unrankedQuick = lobbySocket.emitted.findLast(
    (entry) => entry.name === EVENTS.QUICK_MATCH_UNRANKED,
  );
  ok(!!unrankedQuick, 'client uses the dedicated unranked event so legacy servers cannot rank it');
  await lobbyOnline.quickMatch();
  const rankedQuick = lobbySocket.emitted.findLast((entry) => entry.name === EVENTS.QUICK_MATCH);
  ok(!!rankedQuick, 'client keeps the legacy ranked event as the compatibility default');
  lobbyOnline.dispose();
  return report('onlineMatch');
}
