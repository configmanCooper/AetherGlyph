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

  // Burning DoT: ~2 dmg/sec for 3 sec.
  sim = freshSim(); b = sim.wizards[1];
  sim.applyStatus(b, 'Burning', 1);
  const hp = b.health;
  for (let t = 0; t < Math.round(STATUSES.Burning.durationS * TICK_HZ); t++) sim.step({ 0: {}, 1: {} });
  near(hp - b.health, 6, 1.0, 'Burning deals ~6 over 3s');

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
