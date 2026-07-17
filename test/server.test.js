// server.test.js — focused authoritative-server integration tests over a real
// Socket.IO connection (socket.io-client). Spins the service on an ephemeral
// port and drives the wire protocol end-to-end. Run: npm run test:server
//
// Covers: compatibility rejection, private room create/join, quick match,
// invalid loadout, forged spell id ignored, valid trace classified,
// oversized/malformed/too-fast trace rejection, duplicate/stale sequence
// rejection, authoritative damage/resource state, reconnect token rotation +
// resume, disconnect forfeit, and match termination.

import { io } from 'socket.io-client';
import { createGameServer } from '../server.js';
import { PROTOCOL_VERSION, BALANCE_VERSION, ROSTER_CHECKSUM } from '../shared/src/protocol/version.js';
import { EVENTS, ERR } from '../shared/src/protocol/events.js';
import { boundTrace } from '../shared/src/protocol/net.js';
import { GESTURE_TEMPLATES } from '../shared/src/gesture/templates.js';
import { presetLoadout } from '../shared/src/balance/loadouts.js';

let pass = 0, fail = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; fails.push(msg); console.error('  ✗', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(pred, timeoutMs = 4000, stepMs = 40) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (pred()) return true; await sleep(stepMs); }
  return pred();
}

function goodAuth(clientId) {
  return { protocol: PROTOCOL_VERSION, balance: BALANCE_VERSION, roster: ROSTER_CHECKSUM, clientId };
}

function connect(url, auth) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], auth, reconnection: false, forceNew: true, timeout: 4000 });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => reject(err));
  });
}

function emitAck(socket, ev, payload, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${ev}`)), timeout);
    socket.emit(ev, payload, (res) => { clearTimeout(t); resolve(res); });
  });
}

function once(socket, ev, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`event timeout: ${ev}`)), timeout);
    socket.once(ev, (p) => { clearTimeout(t); resolve(p); });
  });
}

const emberIds = presetLoadout('ember-rush').map((s) => s.id);   // includes Ember Bolt (1)
const tideIds = presetLoadout('tide-control').map((s) => s.id);

async function main() {
  const gs = createGameServer({
    secret: 'test-secret',
    allowedOrigins: [],
    graceMs: 700,
    intermissionMs: 160,
  });
  const port = await gs.listen(0);
  const url = `http://127.0.0.1:${port}`;
  const openSockets = [];
  const track = (s) => { openSockets.push(s); return s; };

  try {
    // --- 1. Compatibility rejection --------------------------------------
    await (async () => {
      try {
        track(await connect(url, { protocol: 999, balance: 1, roster: 'x', clientId: 'bad' }));
        ok(false, 'incompatible client should be rejected at handshake');
      } catch (err) {
        ok(/incompatible|update/i.test(err.message) || (err.data && err.data.code === 'incompatible'),
          'incompatible client rejected with clear reason');
      }
    })();

    // --- 2. Invalid loadout ----------------------------------------------
    {
      const s = track(await connect(url, goodAuth('acc-inv')));
      const res = await emitAck(s, EVENTS.CREATE_ROOM, { loadout: [1, 2, 3] }); // too few
      eq(res.ok, false, 'invalid loadout rejected');
      eq(res.code, ERR.INVALID_LOADOUT, 'invalid loadout code reported');
      s.disconnect();
    }

    // --- 3. Private room create/join + match start -----------------------
    const host = track(await connect(url, goodAuth('acc-host')));
    const joiner = track(await connect(url, goodAuth('acc-join')));
    const created = await emitAck(host, EVENTS.CREATE_ROOM, { loadout: emberIds, name: 'Host' });
    ok(created.ok && created.code && created.slot === 0, 'private room created with code, host is slot 0');

    const hostStartP = once(host, EVENTS.MATCH_START);
    const joinStartP = once(joiner, EVENTS.MATCH_START);
    const joined = await emitAck(joiner, EVENTS.JOIN_ROOM, { code: created.code, loadout: tideIds, name: 'Join' });
    ok(joined.ok && joined.slot === 1, 'joined private room as slot 1');
    const hostStart = await hostStartP;
    const joinStart = await joinStartP;
    eq(hostStart.slot, 0, 'host match-start slot 0');
    eq(joinStart.slot, 1, 'joiner match-start slot 1');
    ok(typeof hostStart.token === 'string' && hostStart.token.length > 10, 'host receives a resume token');
    eq(hostStart.ranked, false, 'private match is unranked (does not affect rating)');

    // --- 4. Valid trace classified + forged spell id ignored -------------
    // Collect host snapshots to observe authoritative state.
    const snaps = [];
    host.on(EVENTS.SNAPSHOT, (m) => snaps.push(m));

    const flick = boundTrace(GESTURE_TEMPLATES.flickRight[0]); // Ember Bolt (id 1)
    const castRes = await emitAck(host, EVENTS.CAST, { seq: 1, points: flick, durationMs: 320, hint: 999 });
    ok(castRes.ok && castRes.accepted, 'valid drawn trace accepted by server');
    eq(castRes.spellId, 1, 'server classifies trace to Ember Bolt (ignores forged hint 999)');

    // A garbage trace with a forged heavy-spell hint must NOT cast that spell.
    const garbage = [{ x: 50, y: 50 }, { x: 51, y: 51 }, { x: 50, y: 51 }, { x: 51, y: 50 }, { x: 50, y: 50 }];
    const forged = await emitAck(host, EVENTS.CAST, { seq: 2, points: garbage, durationMs: 300, hint: 8 });
    eq(forged.ok, false, 'ambiguous/garbage trace with forged Fireball hint is not accepted');

    // --- 5. Authoritative damage / resource state ------------------------
    // Poll snapshots for the authoritative outcome (robust to tick timing).
    const damaged = await waitUntil(() => snaps.some((m) => m.state && m.state.wizards[1].health < 100), 4000);
    ok(damaged, 'opponent took authoritative damage from the drawn Ember Bolt');
    let minOppHealth = 100, minSelfAether = 100, sawSelf100 = true;
    for (const m of snaps) {
      const w = m.state && m.state.wizards;
      if (!w) continue;
      minOppHealth = Math.min(minOppHealth, w[1].health);
      minSelfAether = Math.min(minSelfAether, w[0].aether);
      if (w[0].health < 100) sawSelf100 = false;
    }
    ok(minSelfAether < 60, `caster spent Aether authoritatively (min ${minSelfAether.toFixed(1)})`);
    ok(sawSelf100, 'still caster took no damage (state is server-owned, not client-set)');

    // --- 6. Oversized / malformed / too-fast rejection (spaced for rate) --
    const bigTrace = Array.from({ length: 60 }, (_, i) => ({ x: i, y: (i * 7) % 90 }));
    const over = await emitAck(host, EVENTS.CAST, { seq: 3, points: bigTrace, durationMs: 400 });
    eq(over.code, ERR.OVERSIZE, 'oversized trace rejected (too many points)');
    await sleep(360);
    const nan = await emitAck(host, EVENTS.CAST, { seq: 4, points: [{ x: 1, y: 2 }, { x: NaN, y: 3 }, { x: 4, y: 5 }, { x: 6, y: 7 }], durationMs: 400 });
    eq(nan.code, ERR.MALFORMED, 'malformed (non-finite) trace rejected');
    await sleep(360);
    const tooFast = await emitAck(host, EVENTS.CAST, { seq: 5, points: flick, durationMs: 10 });
    eq(tooFast.code, ERR.TOO_FAST, 'implausibly fast trace rejected');

    // --- 7. Duplicate / stale sequence rejection -------------------------
    await sleep(360);
    const dup = await emitAck(host, EVENTS.CAST, { seq: 5, points: flick, durationMs: 320 }); // seq already used
    eq(dup.code, ERR.STALE, 'duplicate/stale sequence rejected');
    await sleep(360);
    const stale = await emitAck(host, EVENTS.CAST, { seq: 2, points: flick, durationMs: 320 }); // older than lastCastSeq
    eq(stale.code, ERR.STALE, 'older sequence rejected as stale');

    // --- 8. Reconnect: token rotation + resume ---------------------------
    const oppStatusP = once(joiner, EVENTS.OPPONENT_STATUS);
    host.disconnect();
    const oppStatus = await oppStatusP;
    eq(oppStatus.state, 'disconnected', 'opponent notified of disconnect');

    const host2 = track(await connect(url, goodAuth('acc-host'))); // same identity
    const resumeSnapP = once(host2, EVENTS.SNAPSHOT);
    const resumeRes = await emitAck(host2, EVENTS.RESUME, { token: hostStart.token });
    ok(resumeRes.ok, 'valid resume token re-attaches the player');
    ok(resumeRes.token && resumeRes.token !== hostStart.token, 'resume rotates to a fresh single-use token');
    const resumeSnap = await resumeSnapP;
    ok(resumeSnap.full === true && resumeSnap.state && resumeSnap.state.wizards.length === 2,
      'resumed client receives a full authoritative snapshot');

    // Old token can no longer be used (single-use rotation).
    const host3 = track(await connect(url, goodAuth('acc-host')));
    const reuse = await emitAck(host3, EVENTS.RESUME, { token: hostStart.token });
    eq(reuse.ok, false, 'the old resume token is rejected after rotation');
    eq(reuse.code, ERR.BAD_TOKEN, 'reused token reports bad-token');
    host3.disconnect();
    host2.disconnect();
    joiner.disconnect();

    // --- 9. Quick match --------------------------------------------------
    {
      const q1 = track(await connect(url, goodAuth('acc-q1')));
      const q2 = track(await connect(url, goodAuth('acc-q2')));
      const q1Start = once(q1, EVENTS.MATCH_START);
      const q2Start = once(q2, EVENTS.MATCH_START);
      const r1 = await emitAck(q1, EVENTS.QUICK_MATCH, { loadout: emberIds });
      ok(r1.ok, 'quick match enqueues');
      const r2 = await emitAck(q2, EVENTS.QUICK_MATCH, { loadout: tideIds });
      ok(r2.ok, 'second quick match enqueues');
      const s1 = await q1Start; const s2 = await q2Start;
      ok(s1.ranked === true && s2.ranked === true, 'quick match starts a ranked match');
      ok((s1.slot === 0 && s2.slot === 1) || (s1.slot === 1 && s2.slot === 0), 'quick match assigns distinct slots');
      q1.disconnect(); q2.disconnect();
    }

    // --- 10. Disconnect forfeit + match termination ----------------------
    {
      const h = track(await connect(url, goodAuth('acc-fh')));
      const j = track(await connect(url, goodAuth('acc-fj')));
      const cr = await emitAck(h, EVENTS.CREATE_ROOM, { loadout: emberIds });
      const jStart = once(j, EVENTS.MATCH_START);
      await emitAck(j, EVENTS.JOIN_ROOM, { code: cr.code, loadout: tideIds });
      await jStart;
      const matchEndP = once(j, EVENTS.MATCH_END, 4000);
      h.disconnect(); // never reconnect -> grace (700ms) expires -> forfeit
      const end = await matchEndP;
      eq(end.winner, 'win', 'remaining player wins by forfeit after grace');
      eq(end.reason, 'disconnect', 'forfeit reason is disconnect');
      await sleep(150);
      eq(gs.rooms.stats().matches, 0, 'match terminated and cleaned up after forfeit');
      j.disconnect();
    }

    // --- 11. Disconnect during intermission resumes the next round -------
    {
      const h = track(await connect(url, goodAuth('acc-ih')));
      const j = track(await connect(url, goodAuth('acc-ij')));
      const cr = await emitAck(h, EVENTS.CREATE_ROOM, { loadout: emberIds });
      const hStartP = once(h, EVENTS.MATCH_START);
      const jStartP = once(j, EVENTS.MATCH_START);
      await emitAck(j, EVENTS.JOIN_ROOM, { code: cr.code, loadout: tideIds });
      const hStart = await hStartP;
      await jStartP;
      const loc = h.data && h.data.loc;
      const match = [...gs.rooms.matches.values()].find((m) => m.seats.some((s) => s.accountId === 'acc-ih'));
      ok(!!match, 'intermission reconnect test locates authoritative match');
      match.sim.endMatch(0, 'health');
      match.stepOnce();
      eq(match.state, 'intermission', 'forced round end enters intermission');
      h.disconnect();
      await sleep(220); // original intermission timer would have expired while paused
      const h2 = track(await connect(url, goodAuth('acc-ih')));
      const resumed = await emitAck(h2, EVENTS.RESUME, { token: hStart.token });
      ok(resumed.ok, 'player resumes after disconnect during intermission');
      const nextRound = await waitUntil(() => match.state === 'live' && match.series.roundIndex === 1, 1000);
      ok(nextRound, 'intermission timer is rearmed and next round begins after resume');
      h2.disconnect();
      j.disconnect();
    }
  } catch (err) {
    ok(false, `unexpected error: ${err && err.stack ? err.stack : err}`);
  } finally {
    for (const s of openSockets) { try { s.disconnect(); } catch { /* ignore */ } }
    await gs.close('test-complete');
  }

  console.log(`\nserver: ${pass}/${pass + fail} passed`);
  if (fail) { console.log(`FAILED (${fail}):`); for (const f of fails) console.log('  -', f); process.exit(1); }
  process.exit(0);
}

main();
