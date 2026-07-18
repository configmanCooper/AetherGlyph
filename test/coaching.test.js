// coaching.test.js — pure coaching reducer (shared/src/analytics/coach.js).
//
// Verifies known mistakes yield the correct primary recommendation, positive play
// is reinforced, the reducer is deterministic, and it stores NO raw gesture traces
// (only discrete domain events reach it, and none survive into the report).

import { createHarness } from './tiny.js';
import { coachReport } from '../shared/src/analytics/coach.js';

const ev = (type, data = {}) => ({ tick: data.tick || 0, type, ...data });

export function run() {
  const { ok, eq, near, report } = createHarness();

  // --- 1. a fizzled hex without its setup is the top recommendation ------
  {
    const r = coachReport({
      playerId: 0, botId: 1, difficulty: 'medium', winner: 1,
      events: [ev('hexFizzle', { caster: 0, spellId: 27, reason: 'setup-missing' }),
        ev('hexFizzle', { caster: 0, spellId: 27, reason: 'setup-missing' }),
        ev('cast', { caster: 0, spellId: 2 })],
    });
    ok(/Frost Bind/.test(r.recommendation) && /fizzled/.test(r.recommendation),
      'a repeated hex fizzle recommends landing its setup first');
    eq(r.outcome, 'loss', 'a bot win maps to a loss for the player');
  }

  // --- 2. many rejected casts recommend accuracy -------------------------
  {
    const r = coachReport({
      playerId: 0, botId: 1, winner: 'draw',
      events: [ev('castRejected', { caster: 0, spellId: 1 }), ev('castRejected', { caster: 0, spellId: 1 }),
        ev('castRejected', { caster: 0, spellId: 2 }), ev('cast', { caster: 0, spellId: 1 })],
    });
    ok(/rejected/.test(r.recommendation), 'frequent rejections recommend cleaner glyph accuracy');
    ok(r.acceptRate < 0.7, 'accept rate reflects the rejections');
  }

  // --- 3. decayed charges are called out ---------------------------------
  {
    const r = coachReport({
      playerId: 0, botId: 1, winner: 0,
      events: [ev('cast', { caster: 0, spellId: 1 }), ev('chargeDecay', { caster: 0 }), ev('chargeDecay', { caster: 0 })],
    });
    ok(/decay/i.test(r.recommendation), 'wasted Sigil Charges recommend spending before decay');
    eq(r.chargeDecays, 2, 'charge decays are counted');
  }

  // --- 4. a setup applied but never cashed in ----------------------------
  {
    const r = coachReport({
      playerId: 0, botId: 1, winner: 0,
      events: [ev('status', { target: 1, status: 'Marked', stacks: 1 }),
        ev('statusEnd', { target: 1, status: 'Marked' }),
        ev('cast', { caster: 0, spellId: 18 })],
    });
    eq(r.setupsExpired, 1, 'a Mark that expired unused is counted as an expired setup');
    ok(/cash/i.test(r.recommendation) || /setup/i.test(r.recommendation), 'an expired setup recommends cashing it in');
  }

  // --- 5. a consumed setup + damage economy ------------------------------
  {
    const r = coachReport({
      playerId: 0, botId: 1, winner: 0,
      events: [ev('status', { target: 1, status: 'Marked', stacks: 1 }),
        ev('cast', { caster: 0, spellId: 18 }),  // Amplify (20 aether)
        ev('cast', { caster: 0, spellId: 5 }),   // Arcane Missile (20 aether)
        ev('damage', { attacker: 0, target: 1, amount: 20, source: 'Arcane Missile' }),
        ev('statusEnd', { target: 1, status: 'Marked' })],
    });
    eq(r.setupsConsumed, 1, 'a Mark consumed by a hit is counted as a consumed setup');
    eq(r.setupsExpired, 0, 'a consumed setup is not counted as expired');
    near(r.damagePerAether, 20 / 40, 0.001, 'damage per Aether uses cast Aether costs');
  }

  // --- 6. positive reinforcement: blocked damage -------------------------
  {
    const r = coachReport({
      playerId: 0, botId: 1, winner: 0, blockedDamage: 30,
      events: [ev('shield', { caster: 0, absorb: 30 }), ev('cast', { caster: 0, spellId: 10 })],
    });
    ok(/block/i.test(r.reinforcement) || /defenses/i.test(r.reinforcement), 'good blocking is reinforced');
    eq(r.blockedDamage, 30, 'blocked damage is carried into the report');
  }

  // --- 7. positive reinforcement: counters -------------------------------
  {
    const r = coachReport({
      playerId: 0, botId: 1, winner: 0,
      events: [ev('reflect', { by: 0, spellId: 1 }), ev('deflect', { by: 0, spellId: 3 })],
    });
    ok(/counter/i.test(r.reinforcement), 'reflects/deflects are reinforced as counters');
    eq(r.countersLanded, 2, 'reflect + deflect count as counters');
  }

  // --- 8. deterministic report -------------------------------------------
  {
    const events = [ev('cast', { caster: 0, spellId: 1 }), ev('damage', { target: 1, amount: 8, source: 'Ember Bolt' }),
      ev('castRejected', { caster: 0, spellId: 1 }), ev('reaction', { name: 'FlashFire', casterId: 0 })];
    const a = coachReport({ playerId: 0, botId: 1, winner: 0, events });
    const b = coachReport({ playerId: 0, botId: 1, winner: 0, events });
    eq(JSON.stringify(a), JSON.stringify(b), 'the reducer is deterministic for identical input');
  }

  // --- 9. assisted rounds are flagged + noted ----------------------------
  {
    const r = coachReport({ playerId: 0, botId: 1, winner: 0, assisted: true, events: [ev('cast', { caster: 0, spellId: 1 })] });
    ok(r.assisted === true, 'assisted flag is preserved');
    ok(r.lines.some((l) => /assisted/i.test(l)), 'a line notes the round was assisted / excluded from difficulty stats');
  }

  // --- 10. stores NO raw gesture traces ----------------------------------
  {
    // Even if a stray trace-like field is smuggled onto an event, it must not
    // survive into the report (the reducer reads only known discrete fields).
    const r = coachReport({
      playerId: 0, botId: 1, winner: 0,
      events: [{ tick: 1, type: 'cast', caster: 0, spellId: 1, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], trace: [5, 6] }],
    });
    const json = JSON.stringify(r);
    ok(!/"points"/.test(json) && !/"trace"/.test(json), 'no raw trace/points arrays leak into the coaching report');
    ok(!/"x":/.test(json), 'no coordinate data appears anywhere in the report');
  }

  return report('coaching');
}
