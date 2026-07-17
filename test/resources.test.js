// resources.test.js — Aether, Focus/Sigil, Brace, sidestep, cooldown rules.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { starterLoadout } from '../shared/src/balance/loadouts.js';
import { AETHER, SIGIL, FOCUS, BRACE, SIDESTEP, TICK_HZ } from '../shared/src/sim/constants.js';

function freshSim(seed = 1) {
  return new Sim({ seed, loadouts: [starterLoadout(), starterLoadout()] });
}
function advance(sim, ticks, i0 = {}, i1 = {}) {
  for (let t = 0; t < ticks; t++) sim.step({ 0: i0, 1: i1 });
}

export function run() {
  const { ok, eq, near, report } = createHarness();

  // Starting resources (MASTERPLAN §3/§6).
  let sim = freshSim();
  eq(sim.wizards[0].health, 100, 'start health 100');
  eq(sim.wizards[0].aether, AETHER.start, 'start Aether 60');
  eq(sim.wizards[0].charges, SIGIL.start, 'start charges 0');

  // Aether regen 8/sec when idle (not focusing).
  sim = freshSim();
  advance(sim, TICK_HZ, {}, {}); // 1 second
  near(sim.wizards[0].aether, AETHER.start + AETHER.regenPerS, 0.3, 'Aether regen ~8/sec');

  // Aether does not regen during Focus, and Focus grants a charge after 0.95s.
  sim = freshSim();
  const focusTicks = Math.round(FOCUS.channelS * TICK_HZ) + 2;
  const beforeAether = sim.wizards[0].aether;
  advance(sim, focusTicks, { focus: true }, {});
  eq(sim.wizards[0].charges, 1, 'Focus grants 1 Sigil Charge');
  ok(sim.wizards[0].aether <= beforeAether + 0.5, 'no Aether regen during Focus');

  // Focus interrupted by movement does not grant a charge.
  sim = freshSim();
  for (let t = 0; t < focusTicks; t++) {
    sim.step({ 0: { focus: true, move: (t === 10 ? 1 : 0) }, 1: {} });
  }
  eq(sim.wizards[0].charges, 0, 'moving mid-Focus cancels the channel');

  // Brace costs 12 Aether and reduces damage while active.
  sim = freshSim();
  const a0 = sim.wizards[0].aether;
  sim.step({ 0: { brace: true }, 1: {} });
  near(sim.wizards[0].aether, a0 + AETHER.regenPerS / TICK_HZ - BRACE.aetherCost, 0.5, 'Brace costs 12 Aether');
  ok(sim.wizards[0].braceTicks > 0, 'Brace active');

  // Sidestep consumes a movement charge and recharges over time.
  sim = freshSim();
  sim.step({ 0: { sidestep: 1 }, 1: {} });
  eq(sim.wizards[0].sidestepCharges, SIDESTEP.charges - 1, 'Sidestep consumes a charge');
  advance(sim, Math.round(SIDESTEP.rechargeS * TICK_HZ) + 2, {}, {});
  eq(sim.wizards[0].sidestepCharges, SIDESTEP.charges, 'Sidestep recharges');

  // Cannot afford a spell -> no cast starts.
  sim = freshSim();
  sim.wizards[0].aether = 5;
  sim.step({ 0: { cast: 4, castQuality: 1 }, 1: {} }); // Stone Shard costs 18
  ok(!sim.wizards[0].casting, 'insufficient Aether blocks cast');

  // Cooldown: after a cast resolves, the same spell is on cooldown.
  sim = freshSim();
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} }); // Ember Bolt
  const windup = Math.round(0.25 * TICK_HZ) + 2;
  advance(sim, windup, {}, {});
  ok((sim.wizards[0].cooldowns[1] || 0) > 0, 'spell goes on cooldown after resolving');

  // Sigil decay: an idle charge decays after 8s of inactivity.
  sim = freshSim();
  advance(sim, focusTicks, { focus: true }, {}); // gain 1 charge
  eq(sim.wizards[0].charges, 1, 'charge gained before decay test');
  advance(sim, Math.round(SIGIL.decayS * TICK_HZ) + 4, {}, {}); // idle past decay window
  eq(sim.wizards[0].charges, 0, 'idle Sigil Charge decays');

  return report('resources');
}
