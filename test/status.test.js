// status.test.js — statuses, damage modifiers, hard-control cap, Tenacity.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { starterLoadout } from '../shared/src/balance/loadouts.js';
import { STATUSES, CONTROL, TICK_HZ } from '../shared/src/sim/constants.js';

function freshSim(seed = 1) {
  return new Sim({ seed, loadouts: [starterLoadout(), starterLoadout()] });
}

export function run() {
  const { ok, eq, near, report } = createHarness();
  let sim, a, b;

  eq(STATUSES.Burning.durationS, 9, 'Burning lasts 3x its baseline');
  eq(STATUSES.Chilled.durationS, 9, 'Chilled lasts 3x its baseline');
  eq(STATUSES.Soaked.durationS, 12, 'Soaked lasts 3x its baseline');
  eq(STATUSES.Static.durationS, 9, 'Static lasts 3x its baseline');
  eq(STATUSES.Sundered.durationS, 12, 'Sundered lasts 3x its baseline');
  eq(STATUSES.Weakened.durationS, 12, 'Weakened lasts 3x its baseline');
  eq(STATUSES.Marked.durationS, 15, 'Marked lasts 3x its baseline');
  eq(STATUSES.Sloth.durationS, 12, 'Sloth lasts 3x its baseline');
  eq(STATUSES.Wet.durationS, 6, 'Wet lingers for 6 seconds after rain exposure');
  eq(STATUSES.Blinded.durationS, 4, 'Eclipse Glare blindness lasts 4 seconds');
  eq(STATUSES.Veiled.durationS, 6, 'Veiled lasts 3x its baseline');
  eq(STATUSES.Rooted.durationS, 3, 'Entangle Root lasts 3 seconds');
  eq(STATUSES.KnockedDown.durationS, 2, 'Knocked Down lasts 2 seconds');
  eq(STATUSES.Haste.durationS, 18, 'Haste lasts 3x its baseline');
  eq(STATUSES.AetherSurge.durationS, 18, 'Aether Surge lasts 3x its baseline');
  eq(STATUSES.Attunement.durationS, 18, 'Attunement lasts 3x its baseline');
  eq(STATUSES.Grounded.durationS, 15, 'Grounded remains at its 3x duration');
  eq(STATUSES.Phoenix.durationS, 15, 'Phoenix remains at its 3x duration');
  eq(STATUSES.Frozen.durationS, 1, 'Freeze remains capped for anti-lock safety');
  eq(STATUSES.Stunned.durationS, 1, 'Stun remains capped for anti-lock safety');

  // Burning DoT: ~2 dmg/sec for 9 sec.
  sim = freshSim(); b = sim.wizards[1];
  sim.applyStatus(b, 'Burning', 1);
  const hp = b.health;
  for (let t = 0; t < Math.round(STATUSES.Burning.durationS * TICK_HZ); t++) sim.step({ 0: {}, 1: {} });
  near(hp - b.health, 18, 1.0, 'Burning deals ~18 over 9s');

  // Sundered increases incoming direct damage by 20%.
  sim = freshSim(); a = sim.wizards[0]; b = sim.wizards[1];
  sim.applyStatus(b, 'Sundered', 1);
  const d1 = sim.dealDamage(a, b, 10, {});
  near(d1, 12, 0.01, 'Sundered +20% damage');

  // Marked amplifies the next hit by 35% then is consumed.
  sim = freshSim(); a = sim.wizards[0]; b = sim.wizards[1];
  sim.applyStatus(b, 'Marked', 1);
  const d2 = sim.dealDamage(a, b, 10, {});
  near(d2, 13.5, 0.01, 'Marked +35% on next hit');
  ok(!b.statuses.Marked, 'Marked consumed after one hit');

  // Weakened reduces the attacker's outgoing damage by 22%.
  sim = freshSim(); a = sim.wizards[0]; b = sim.wizards[1];
  sim.applyStatus(a, 'Weakened', 1);
  const d3 = sim.dealDamage(a, b, 10, {});
  near(d3, 7.8, 0.01, 'Weakened -22% outgoing');

  // No single resolved cast exceeds 30 direct damage (§9 cap).
  sim = freshSim(); a = sim.wizards[0]; b = sim.wizards[1];
  const d4 = sim.dealDamage(a, b, 100, {});
  eq(d4, 30, 'single-hit damage capped at 30');

  // Chilled slows cast windup.
  sim = freshSim();
  const base = new Sim({ seed: 2, loadouts: [starterLoadout(), starterLoadout()] });
  base.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  const baseWindup = base.wizards[0].casting.totalTicks;
  sim.applyStatus(sim.wizards[0], 'Chilled', 1);
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  ok(sim.wizards[0].casting.totalTicks > baseWindup, 'Chilled lengthens windup');

  const moveDelta = (status) => {
    const moving = freshSim();
    moving.wizards[0].arcPos = 0;
    if (status) moving.applyStatus(moving.wizards[0], status, 1);
    moving.step({ 0: { move: 1 }, 1: {} });
    return moving.wizards[0].arcPos;
  };
  const normalMove = moveDelta(null);
  near(moveDelta('Haste') / normalMove, 1.3, 0.01, 'Haste increases movement speed by 30%');
  near(moveDelta('Sloth') / normalMove, 0.7, 0.01, 'Sloth reduces movement speed by 30%');

  // Hard control is capped at 1.0s.
  sim = freshSim(); b = sim.wizards[1];
  sim.applyStatus(b, 'Frozen', 1, { durationS: 5 });
  ok(b.statuses.Frozen.ticks <= Math.round(CONTROL.maxHardControlS * TICK_HZ) + 1,
    'Frozen capped at 1.0s');

  // Tenacity: after hard control ends, new hard control is blocked for 3.5s.
  sim = freshSim(); b = sim.wizards[1];
  sim.applyStatus(b, 'Frozen', 1);
  // advance until Frozen expires and Tenacity engages
  for (let t = 0; t < Math.round(CONTROL.maxHardControlS * TICK_HZ) + 3; t++) sim.step({ 0: {}, 1: {} });
  ok(b.tenacityTicks > 0, 'Tenacity engaged after hard control');
  const applied = sim.applyStatus(b, 'Stunned', 1);
  eq(applied, false, 'Tenacity blocks a new hard control');
  ok(!b.statuses.Stunned, 'no Stun applied under Tenacity');

  // Frozen prevents casting.
  sim = freshSim();
  sim.applyStatus(sim.wizards[0], 'Frozen', 1);
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  ok(!sim.wizards[0].casting, 'Frozen wizard cannot cast');

  // Rooted prevents movement but allows casting.
  sim = freshSim();
  sim.applyStatus(sim.wizards[0], 'Rooted', 1);
  const posBefore = sim.wizards[0].arcPos;
  sim.step({ 0: { move: 1, cast: 1, castQuality: 1 }, 1: {} });
  near(sim.wizards[0].arcPos, posBefore, 0.001, 'Rooted blocks movement');
  ok(sim.wizards[0].casting, 'Rooted still allows casting');

  return report('status');
}
