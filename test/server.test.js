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
import { MATCH } from '../shared/src/sim/constants.js';

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
    const t = setTimeout(() => reject(new Error(
      `event timeout: ${ev} client=${socket.auth?.clientId || socket.id || 'unknown'}`,
    )), timeout);
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
    privateLobbyGraceMs: 800,
    rankedRange: 50,
    rankedRangeWaitMs: 120,
    botOfferWaitMs: 120,
    requireAccounts: false,
  });
  const port = await gs.listen(0);
  const url = `http://127.0.0.1:${port}`;
  const openSockets = [];
  const track = (s) => { openSockets.push(s); return s; };

  try {
    // --- 0. Temporary username/PIN gate ----------------------------------
    {
      const accountServer = createGameServer({
        secret: 'account-test-secret',
        allowedOrigins: [],
      });
      const accountPort = await accountServer.listen(0);
      const accountUrl = `http://127.0.0.1:${accountPort}`;
      const guest = await connect(accountUrl, goodAuth('guest-device'));
      const blocked = await emitAck(guest, EVENTS.CREATE_ROOM, { loadout: emberIds });
      eq(blocked.code, ERR.AUTH_REQUIRED, 'online actions require a temporary account');
      const invalidName = await emitAck(guest, EVENTS.ACCOUNT_AUTH, {
        username: 'Bad Name', pin: '123456',
      });
      eq(invalidName.code, ERR.INVALID_USERNAME, 'account gate rejects spaces in usernames');
      const reservedName = await emitAck(guest, EVENTS.ACCOUNT_AUTH, {
        username: 'HardAIbot', pin: '123456',
      });
      eq(reservedName.code, ERR.RESERVED_NAME, 'built-in AI names are reserved');
      const createdAccount = await emitAck(guest, EVENTS.ACCOUNT_AUTH, {
        username: 'ServerWizard1', pin: '123456',
      });
      ok(createdAccount.ok && createdAccount.created && createdAccount.token,
        'valid username and six-digit PIN create a temporary account');
      const createdRoom = await emitAck(guest, EVENTS.CREATE_ROOM, {
        loadout: emberIds, name: 'ImpostorName',
      });
      ok(createdRoom.ok, 'authenticated temporary account can use Online Duel');
      eq(accountServer.rooms.privateLobbies.get(createdRoom.code).seats[0].name, 'ServerWizard1',
        'authenticated clients cannot overwrite their verified wizard name');
      await emitAck(guest, EVENTS.LEAVE, {});
      guest.disconnect();

      const wrong = await connect(accountUrl, goodAuth('other-device'));
      const wrongPin = await emitAck(wrong, EVENTS.ACCOUNT_AUTH, {
        username: 'ServerWizard1', pin: '654321',
      });
      eq(wrongPin.code, ERR.NAME_TAKEN, 'existing username rejects the wrong PIN');
      wrong.disconnect();

      let limited = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const attacker = await connect(accountUrl, goodAuth(`attacker-${attempt}`));
        limited = await emitAck(attacker, EVENTS.ACCOUNT_AUTH, {
          username: 'ServerWizard1', pin: '000000',
        });
        attacker.disconnect();
      }
      eq(limited.code, ERR.RATE,
        'username authentication limiter persists across reconnects');

      const restored = await connect(accountUrl, {
        ...goodAuth('restored-device'),
        accountToken: createdAccount.token,
      });
      const restoredStatus = await emitAck(restored, EVENTS.ACCOUNT_STATUS, {});
      ok(restoredStatus.authenticated && restoredStatus.accountId === createdAccount.accountId,
        'saved session restores the same database ranking account');
      restored.disconnect();

      const resetOwner = await connect(accountUrl, goodAuth('reset-owner'));
      const resetAccount = await emitAck(resetOwner, EVENTS.ACCOUNT_AUTH, {
        username: 'ResetWizard1', pin: '111111',
      });
      accountServer.rooms.ratingStore.credentials.get('resetwizard1').pinResetRequired = true;
      resetOwner.disconnect();
      const resetLoginSocket = await connect(accountUrl, goodAuth('reset-login'));
      const resetLogin = await emitAck(resetLoginSocket, EVENTS.ACCOUNT_AUTH, {
        username: 'ResetWizard1', pin: '111111',
      });
      ok(resetLogin.resetRequired && resetLogin.resetToken,
        'admin reset flag requires a new PIN at next login');
      const resetBlocked = await emitAck(resetLoginSocket, EVENTS.CREATE_ROOM, {
        loadout: emberIds,
      });
      eq(resetBlocked.code, ERR.AUTH_REQUIRED,
        'reset-required account cannot use Online Duel before choosing a new PIN');
      const resetPin = await emitAck(resetLoginSocket, EVENTS.ACCOUNT_PIN_RESET, {
        resetToken: resetLogin.resetToken, pin: '222222',
      });
      ok(resetPin.ok && resetPin.accountId === resetAccount.accountId,
        'player can choose a new PIN and retain the same ranking account');
      resetLoginSocket.disconnect();
      await accountServer.close('account-gate-test');
    }

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

    // --- 3. Private room create/join + two-player ready lobby ------------
    const host = track(await connect(url, goodAuth('acc-host')));
    const joiner = track(await connect(url, goodAuth('acc-join')));
    const populationP = once(host, EVENTS.POPULATION);
    const populationProbe = track(await connect(url, goodAuth('acc-population')));
    const population = await populationP;
    ok(population.online >= 3, 'server broadcasts the connected online player count');
    populationProbe.disconnect();
    const created = await emitAck(host, EVENTS.CREATE_ROOM, { loadout: emberIds, name: 'Host' });
    ok(created.ok && created.code && created.slot === 0, 'private room created with code, host is slot 0');
    eq(created.state, 'private-lobby', 'private room creator enters the lobby');
    eq(created.playerCount, 1, 'private lobby initially contains only the host');

    const hostStartP = once(host, EVENTS.MATCH_START);
    const joinStartP = once(joiner, EVENTS.MATCH_START);
    const joined = await emitAck(joiner, EVENTS.JOIN_ROOM, { code: created.code, loadout: tideIds, name: 'Join' });
    ok(joined.ok && joined.slot === 1, 'joined private room as slot 1');
    eq(joined.state, 'private-lobby', 'joining does not immediately start combat');
    await sleep(80);
    eq(gs.rooms.stats().matches, 0, 'private match waits for both players to ready');

    const hostReady = await emitAck(host, EVENTS.PRIVATE_READY, { loadout: emberIds, name: 'Host' });
    ok(hostReady.ok && hostReady.readyCount === 1, 'host can ready in the initial lobby');
    const hostUnready = await emitAck(host, EVENTS.PRIVATE_UNREADY, {});
    ok(hostUnready.ok && hostUnready.readyCount === 0, 'host can unready before editing guides');
    const joinReady = await emitAck(joiner, EVENTS.PRIVATE_READY, { loadout: tideIds, name: 'Join' });
    ok(joinReady.ok && joinReady.readyCount === 1, 'joiner can ready while host edits guides');
    await sleep(40);
    eq(gs.rooms.stats().matches, 0, 'one ready player cannot start the private match');
    const hostReadyAgain = await emitAck(host, EVENTS.PRIVATE_READY, { loadout: emberIds, name: 'Host' });
    ok(hostReadyAgain.ok && hostReadyAgain.readyCount === 2, 'second ready player starts the private match');
    const hostStart = await hostStartP;
    const joinStart = await joinStartP;
    eq(hostStart.slot, 0, 'host match-start slot 0');
    eq(joinStart.slot, 1, 'joiner match-start slot 1');
    ok(typeof hostStart.token === 'string' && hostStart.token.length > 10, 'host receives a resume token');
    eq(hostStart.ranked, false, 'private match is unranked (does not affect Glyphs)');

    // --- 4. Full-roster trace classification + forged spell id ignored ----
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
    const damaged = await waitUntil(() => snaps.some((m) =>
      m.state && m.state.wizards[1].health < MATCH.startHealth), 4000);
    ok(damaged, 'opponent took authoritative damage from the drawn Ember Bolt');
    let minOppHealth = MATCH.startHealth, minSelfAether = 100, sawSelfFull = true;
    for (const m of snaps) {
      const w = m.state && m.state.wizards;
      if (!w) continue;
      minOppHealth = Math.min(minOppHealth, w[1].health);
      minSelfAether = Math.min(minSelfAether, w[0].aether);
      if (w[0].health < MATCH.startHealth) sawSelfFull = false;
    }
    ok(minSelfAether < 60, `caster spent Aether authoritatively (min ${minSelfAether.toFixed(1)})`);
    ok(sawSelfFull, 'still caster took no damage (state is server-owned, not client-set)');

    // Frost Lance is not one of the host's eight submitted guide shortcuts, but
    // the authoritative recognizer still accepts its real glyph.
    await sleep(360);
    const lineUp = boundTrace(GESTURE_TEMPLATES.lineUp[0]);
    const outsideGuides = await emitAck(host, EVENTS.CAST, { seq: 3, points: lineUp, durationMs: 360 });
    ok(outsideGuides.ok && outsideGuides.accepted, 'server accepts a spell outside the submitted guide set');
    eq(outsideGuides.spellId, 2, 'server classifies the outside-guide trace as Frost Lance');

    // --- 6. Oversized / malformed / too-fast rejection (spaced for rate) --
    const bigTrace = Array.from({ length: 60 }, (_, i) => ({ x: i, y: (i * 7) % 90 }));
    const over = await emitAck(host, EVENTS.CAST, { seq: 4, points: bigTrace, durationMs: 400 });
    eq(over.code, ERR.OVERSIZE, 'oversized trace rejected (too many points)');
    await sleep(360);
    const nan = await emitAck(host, EVENTS.CAST, { seq: 5, points: [{ x: 1, y: 2 }, { x: NaN, y: 3 }, { x: 4, y: 5 }, { x: 6, y: 7 }], durationMs: 400 });
    eq(nan.code, ERR.MALFORMED, 'malformed (non-finite) trace rejected');
    await sleep(360);
    const tooFast = await emitAck(host, EVENTS.CAST, { seq: 6, points: flick, durationMs: 10 });
    eq(tooFast.code, ERR.TOO_FAST, 'implausibly fast trace rejected');

    // --- 7. Duplicate / stale sequence rejection -------------------------
    await sleep(360);
    const dup = await emitAck(host, EVENTS.CAST, { seq: 6, points: flick, durationMs: 320 }); // seq already used
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
    eq(resumeRes.ranked, false, 'resume acknowledgement preserves private/unranked mode');
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
    const attacker = track(await connect(url, goodAuth('acc-resume-attacker')));
    const stolen = await emitAck(attacker, EVENTS.RESUME, { token: resumeRes.token });
    eq(stolen.code, ERR.BAD_TOKEN, 'resume token cannot be used by a different account');
    attacker.disconnect();
    joiner.disconnect();

    // --- 9. Ranked and unranked quick-match queues stay separate --------
    {
      const ranked1 = track(await connect(url, goodAuth('acc-q-ranked-1')));
      const unranked1 = track(await connect(url, goodAuth('acc-q-unranked-1')));
      const ranked1Start = once(ranked1, EVENTS.MATCH_START);
      const rankedAck = await emitAck(ranked1, EVENTS.QUICK_MATCH, { loadout: emberIds });
      const unrankedAck = await emitAck(unranked1, EVENTS.QUICK_MATCH_UNRANKED, {
        loadout: tideIds,
      });
      ok(rankedAck.ok && rankedAck.ranked === true,
        'quick match defaults to the backward-compatible ranked queue');
      eq(rankedAck.glyphs, 100, 'new ranked wizard enters matchmaking with 100 Glyphs');
      ok(unrankedAck.ok && unrankedAck.ranked === false,
        'unranked quick match enters the unranked queue');
      await sleep(80);
      eq(gs.rooms.queue.length, 2, 'ranked and unranked players do not cross-match');

      const ranked2 = track(await connect(url, goodAuth('acc-q-ranked-2')));
      const ranked2Start = once(ranked2, EVENTS.MATCH_START);
      await emitAck(ranked2, EVENTS.QUICK_MATCH, { loadout: tideIds, ranked: true });
      const rankedStart1 = await ranked1Start;
      const rankedStart2 = await ranked2Start;
      ok(rankedStart1.ranked === true && rankedStart2.ranked === true,
        'two ranked players start a ranked match');
      eq(gs.rooms.queue.length, 1, 'unranked player remains queued after ranked pairing');
      const rankedUpdate1P = once(ranked1, EVENTS.RANKING_UPDATE);
      const rankedUpdate2P = once(ranked2, EVENTS.RANKING_UPDATE);
      const rankedMatch = [...gs.rooms.matches.values()].find((match) =>
        match.seats.some((seat) => seat.accountId === 'acc-q-ranked-1'));
      ok(!!rankedMatch, 'ranked quick match has an authoritative match room');
      const spectator = track(await connect(url, goodAuth('acc-spectator')));
      const activeMatches = await emitAck(spectator, EVENTS.SPECTATE_LIST, {});
      ok(activeMatches.ok && activeMatches.matches.some((item) => item.matchId === rankedMatch.matchId),
        'spectator list exposes active ranked matches');
      const spectateStartP = once(spectator, EVENTS.SPECTATE_START);
      const spectateSnapshotP = once(spectator, EVENTS.SPECTATE_SNAPSHOT);
      const spectateJoin = await emitAck(spectator, EVENTS.SPECTATE_JOIN, {
        matchId: rankedMatch.matchId,
      });
      ok(spectateJoin.ok, 'spectator can join a listed ranked match');
      const spectateStart = await spectateStartP;
      const spectateSnapshot = await spectateSnapshotP;
      eq(spectateStart.names.length, 2, 'spectator receives both wizard names');
      ok(spectateSnapshot.state?.wizards?.length === 2,
        'spectator receives a canonical two-wizard snapshot');

      const opponentEmojiP = once(ranked2, EVENTS.EMOJI_EVENT);
      const spectatorEmojiP = once(spectator, EVENTS.EMOJI_EVENT);
      const emoji = await emitAck(ranked1, EVENTS.EMOJI, { kind: 'smile' });
      ok(emoji.ok && emoji.cooldownMs === 10000, 'online emoji is accepted with ten-second cooldown');
      const opponentEmoji = await opponentEmojiP;
      const spectatorEmoji = await spectatorEmojiP;
      eq(opponentEmoji.sender, 1, 'opponent sees emoji attached to the other wizard');
      eq(spectatorEmoji.sender, rankedStart1.slot,
        'spectator sees canonical emoji sender slot');
      const emojiRate = await emitAck(ranked1, EVENTS.EMOJI, { kind: 'laugh' });
      eq(emojiRate.code, ERR.RATE, 'all emoji types share one server cooldown');

      const spectateEndP = once(spectator, EVENTS.SPECTATE_END);
      rankedMatch.endMatch(rankedStart1.slot, 'series');
      const spectateEnd = await spectateEndP;
      eq(spectateEnd.matchId, rankedMatch.matchId,
        'spectator is returned when the ranked match ends');
      const rankedUpdate1 = await rankedUpdate1P;
      const rankedUpdate2 = await rankedUpdate2P;
      eq(rankedUpdate1.ok, true, 'ranked settlement reports persistence success');
      eq(rankedUpdate1.delta, 25, 'equal-Glyph ranked winner gains 25');
      eq(rankedUpdate1.glyphsAfter, 125, 'ranked winner reaches 125 Glyphs');
      eq(rankedUpdate2.delta, -25, 'equal-Glyph ranked loser loses 25');
      eq(rankedUpdate2.glyphsAfter, 75, 'ranked loser falls to 75 Glyphs');
      const rankings = await emitAck(ranked1, EVENTS.RANKINGS_REQUEST, {});
      ok(rankings.ok && rankings.top.length === 2, 'world rankings list ranked participants');
      eq(rankings.self.glyphs, 125, 'rankings response includes the requesting wizard total');

      const unranked2 = track(await connect(url, goodAuth('acc-q-unranked-2')));
      const unranked1Start = once(unranked1, EVENTS.MATCH_START);
      const unranked2Start = once(unranked2, EVENTS.MATCH_START);
      await emitAck(unranked2, EVENTS.QUICK_MATCH_UNRANKED, { loadout: emberIds });
      const unrankedStart1 = await unranked1Start;
      const unrankedStart2 = await unranked2Start;
      ok(unrankedStart1.ranked === false && unrankedStart2.ranked === false,
        'two unranked players start an unranked match');
      const unrankedMatch = [...gs.rooms.matches.values()].find((match) =>
        match.seats.some((seat) => seat.accountId === 'acc-q-unranked-1'));
      unrankedMatch.endMatch(unrankedStart1.slot, 'series');
      await sleep(40);
      eq(gs.rooms.ratingStore.accounts.has('acc-q-unranked-1'), false,
        'unranked winner creates no ranking record');
      eq(gs.rooms.ratingStore.accounts.has('acc-q-unranked-2'), false,
        'unranked loser creates no ranking record');
      ok((rankedStart1.slot === 0 && rankedStart2.slot === 1)
          || (rankedStart1.slot === 1 && rankedStart2.slot === 0),
      'ranked quick match assigns distinct slots');
      ranked1.disconnect(); ranked2.disconnect();
      unranked1.disconnect(); unranked2.disconnect();
      spectator.disconnect();
    }

    // --- 10. Ranked search waits for ±50, then chooses closest -----------
    {
      await gs.rooms.ratingStore.getGlyphs('acc-range-low', 'Low');
      await gs.rooms.ratingStore.getGlyphs('acc-range-high', 'High');
      gs.rooms.ratingStore.accounts.get('acc-range-low').glyphs = 100;
      gs.rooms.ratingStore.accounts.get('acc-range-high').glyphs = 300;
      const low = track(await connect(url, goodAuth('acc-range-low')));
      const high = track(await connect(url, goodAuth('acc-range-high')));
      const lowStartP = once(low, EVENTS.MATCH_START);
      const highStartP = once(high, EVENTS.MATCH_START);
      await emitAck(low, EVENTS.QUICK_MATCH, { loadout: emberIds });
      await emitAck(high, EVENTS.QUICK_MATCH, { loadout: tideIds });
      await sleep(60);
      gs.rooms.matchmake();
      eq(gs.rooms.queue.length, 2, 'ranked players over 50 Glyphs apart wait initially');
      await sleep(80);
      gs.rooms.matchmake();
      const lowStart = await lowStartP;
      const highStart = await highStartP;
      ok(lowStart.ranked && highStart.ranked,
        'closest available ranked players pair after the configured wait');
      const match = [...gs.rooms.matches.values()].find((room) =>
        room.seats.some((seat) => seat.accountId === 'acc-range-low'));
      match.endMatch('draw', 'series');
      low.disconnect(); high.disconnect();
    }

    // --- 11. Five-second fallback offers the closest internal bot --------
    {
      const human = track(await connect(url, goodAuth('acc-bot-offer')));
      await gs.rooms.ratingStore.getGlyphs('acc-bot-offer', 'BotTester');
      gs.rooms.ratingStore.accounts.get('acc-bot-offer').glyphs = 100;
      const offerP = once(human, EVENTS.BOT_OFFER);
      await emitAck(human, EVENTS.QUICK_MATCH, { loadout: emberIds });
      await sleep(140);
      gs.rooms.matchmake();
      const offer = await offerP;
      eq(offer.bot.name, 'MediumAIbot', 'closest-Glyph AI bot is offered');
      eq(offer.maxReward, 20, 'ranked AI offer explains the 20-Glyph cap');
      const startP = once(human, EVENTS.MATCH_START);
      const accepted = await emitAck(human, EVENTS.BOT_OFFER_RESPONSE, {
        offerId: offer.offerId, accept: true,
      });
      ok(accepted.ok && accepted.accepted, 'player can accept the AI fallback');
      const start = await startP;
      eq(start.names[1], 'MediumAIbot', 'accepted bot occupies the opponent seat');
      eq(start.glyphs[1], 100, 'bot match exposes fixed bot Glyph total');
      const rankingP = once(human, EVENTS.RANKING_UPDATE);
      const match = [...gs.rooms.matches.values()].find((room) =>
        room.seats.some((seat) => seat.accountId === 'acc-bot-offer'));
      for (let tick = 0; tick < 900 && match.sim.wizards[1].castsResolved === 0; tick++) {
        match.stepOnce();
      }
      ok(match.sim.wizards[1].castsResolved > 0,
        'authoritative internal PracticeBot actively casts during the duel');
      match.endMatch(0, 'series');
      const ranking = await rankingP;
      eq(ranking.delta, 20, 'ranked AI win awards at most 20 Glyphs');
      human.disconnect();
    }

    // --- 12. Disconnect forfeit + match termination ----------------------
    {
      const h = track(await connect(url, goodAuth('acc-fh')));
      const j = track(await connect(url, goodAuth('acc-fj')));
      const cr = await emitAck(h, EVENTS.CREATE_ROOM, { loadout: emberIds });
      const jStart = once(j, EVENTS.MATCH_START);
      await emitAck(j, EVENTS.JOIN_ROOM, { code: cr.code, loadout: tideIds });
      await emitAck(h, EVENTS.PRIVATE_READY, { loadout: emberIds });
      await emitAck(j, EVENTS.PRIVATE_READY, { loadout: tideIds });
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

    // --- 11. Private surrender returns both players to the same room -----
    {
      const h = track(await connect(url, goodAuth('acc-sh')));
      const j = track(await connect(url, goodAuth('acc-sj')));
      const cr = await emitAck(h, EVENTS.CREATE_ROOM, { loadout: emberIds, name: 'Host' });
      const hStartP = once(h, EVENTS.MATCH_START);
      const jStartP = once(j, EVENTS.MATCH_START);
      await emitAck(j, EVENTS.JOIN_ROOM, { code: cr.code, loadout: tideIds, name: 'Join' });
      await emitAck(h, EVENTS.PRIVATE_READY, { loadout: emberIds, name: 'Host' });
      await emitAck(j, EVENTS.PRIVATE_READY, { loadout: tideIds, name: 'Join' });
      await hStartP;
      await jStartP;

      const hEndP = once(h, EVENTS.MATCH_END);
      const jEndP = once(j, EVENTS.MATCH_END);
      const hLobbyP = once(h, EVENTS.ROOM_UPDATE);
      const jLobbyP = once(j, EVENTS.ROOM_UPDATE);
      const surrendered = await emitAck(h, EVENTS.LEAVE, { surrender: true });
      ok(surrendered.ok, 'private surrender is acknowledged');
      const hEnd = await hEndP;
      const jEnd = await jEndP;
      eq(hEnd.winner, 'loss', 'surrendering private player loses');
      eq(jEnd.winner, 'win', 'private opponent wins the surrender');
      eq(hEnd.reason, 'forfeit', 'private surrender has forfeit reason');
      eq(hEnd.code, cr.code, 'private match end retains the room code');
      const hLobby = await hLobbyP;
      const jLobby = await jLobbyP;
      ok(hLobby.state === 'private-lobby' && jLobby.state === 'private-lobby',
        'both private players return to a persistent room lobby');
      eq(hLobby.code, cr.code, 'persistent lobby keeps the original code');

      const hRematchP = once(h, EVENTS.MATCH_START);
      const jRematchP = once(j, EVENTS.MATCH_START);
      const hReady = await emitAck(h, EVENTS.PRIVATE_READY, { loadout: emberIds, name: 'Host' });
      ok(hReady.ok && hReady.readyCount === 1, 'first private player can ready for rematch');
      const jReady = await emitAck(j, EVENTS.PRIVATE_READY, { loadout: tideIds, name: 'Join' });
      ok(jReady.ok && jReady.readyCount === 2, 'second ready starts the rematch');
      const hRematch = await hRematchP;
      const jRematch = await jRematchP;
      eq(hRematch.code, cr.code, 'private rematch keeps the original code');
      eq(jRematch.code, cr.code, 'both rematch clients receive the original code');

      await emitAck(h, EVENTS.LEAVE, { surrender: true });
      await sleep(40);
      await emitAck(h, EVENTS.LEAVE, {});
      h.disconnect();
      j.disconnect();
    }

    // --- 12. Disconnect during intermission resumes the next round -------
    {
      const h = track(await connect(url, goodAuth('acc-ih')));
      const j = track(await connect(url, goodAuth('acc-ij')));
      const cr = await emitAck(h, EVENTS.CREATE_ROOM, { loadout: emberIds });
      const hStartP = once(h, EVENTS.MATCH_START);
      const jStartP = once(j, EVENTS.MATCH_START);
      await emitAck(j, EVENTS.JOIN_ROOM, { code: cr.code, loadout: tideIds });
      await emitAck(h, EVENTS.PRIVATE_READY, { loadout: emberIds });
      await emitAck(j, EVENTS.PRIVATE_READY, { loadout: tideIds });
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

    // --- 13. Private lobby survives both players disconnecting -----------
    {
      const h = track(await connect(url, goodAuth('acc-lobby-h')));
      const j = track(await connect(url, goodAuth('acc-lobby-j')));
      const cr = await emitAck(h, EVENTS.CREATE_ROOM, { loadout: emberIds });
      await emitAck(j, EVENTS.JOIN_ROOM, { code: cr.code, loadout: tideIds });
      h.disconnect();
      j.disconnect();
      await sleep(200);
      ok(gs.rooms.privateLobbies.has(cr.code),
        'empty private lobby remains reserved during reconnect grace');

      const h2 = track(await connect(url, goodAuth('acc-lobby-h')));
      const j2 = track(await connect(url, goodAuth('acc-lobby-j')));
      const hResume = await emitAck(h2, EVENTS.JOIN_ROOM, { code: cr.code, loadout: emberIds });
      const jResume = await emitAck(j2, EVENTS.JOIN_ROOM, { code: cr.code, loadout: tideIds });
      ok(hResume.ok && hResume.resumed && hResume.slot === 0,
        'host reclaims the original private-lobby seat');
      ok(jResume.ok && jResume.resumed && jResume.slot === 1,
        'joiner reclaims the original private-lobby seat');
      const hStartP = once(h2, EVENTS.MATCH_START);
      const jStartP = once(j2, EVENTS.MATCH_START);
      await emitAck(h2, EVENTS.PRIVATE_READY, { loadout: emberIds });
      await emitAck(j2, EVENTS.PRIVATE_READY, { loadout: tideIds });
      const hStart = await hStartP;
      const jStart = await jStartP;
      eq(hStart.code, cr.code, 'reconnected host starts with the same private code');
      eq(jStart.code, cr.code, 'reconnected joiner starts with the same private code');
      h2.disconnect();
      j2.disconnect();
    }

    // --- 14. Abandoned private lobby expires after the grace period -------
    {
      const h = track(await connect(url, goodAuth('acc-lobby-expire')));
      const cr = await emitAck(h, EVENTS.CREATE_ROOM, { loadout: emberIds });
      h.disconnect();
      await sleep(900);
      eq(gs.rooms.privateLobbies.has(cr.code), false,
        'abandoned private lobby is removed after reconnect grace');
      const probe = track(await connect(url, goodAuth('acc-lobby-expire-probe')));
      const expired = await emitAck(probe, EVENTS.JOIN_ROOM, { code: cr.code, loadout: tideIds });
      eq(expired.code, ERR.NO_ROOM, 'expired private lobby code cannot be joined');
      probe.disconnect();
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
