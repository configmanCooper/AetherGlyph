// protection.test.js — protective spells last 3x longer than the original
// active windows. Locks the canonical duration data (spellEffects.js +
// constants.js) AND proves the deterministic sim actually reads the new,
// longer windows. Anti-stall / zone-duration rules stay intact.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { spellWithGesture } from '../shared/src/balance/loadouts.js';
import { effectFor } from '../shared/src/sim/spellEffects.js';
import { STATUSES, ZONE, TICK_HZ } from '../shared/src/sim/constants.js';

const sToTicks = (s) => Math.max(0, Math.round(s * TICK_HZ));

// Cast one spell in isolation and report the first-observed value of a field
// (before per-tick decay eats into it), so we can read the granted window.
function firstSeen(id, pick, prime = {}) {
  const sim = new Sim({ seed: 5, loadouts: [[spellWithGesture(id)], [spellWithGesture(1)]] });
  const w = sim.wizards[0], o = sim.wizards[1];
  w.aether = 100; w.charges = 3; w.arcPos = 0; o.arcPos = 0.4;
  if (prime.selfStatus) sim.applyStatus(w, prime.selfStatus, 1);
  sim.step({ 0: { cast: id, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 240 && !sim.ended; t++) {
    const v = pick(w, sim);
    if (v && v > 0) return v;
    sim.step({ 0: {}, 1: {} });
  }
  return pick(w, sim) || 0;
}

export function run() {
  const { ok, eq, near, report } = createHarness();

  // ---- 1. canonical duration data is exactly the 3x target -----------------
  eq(effectFor(10).durationS, 4.2, 'Ward active duration is 4.2s (was 1.4s)');
  eq(effectFor(11).durationS, 4.5, 'Barrier Dome lasts 4.5s (was 1.5s)');
  eq(effectFor(12).windowS, 1.2, 'Reflect window is 1.2s (was 0.4s)');
  eq(effectFor(14).evadeS, 1.05, 'Blink evade lasts 1.05s (was 0.35s)');
  eq(STATUSES.Grounded.durationS, 15, 'Grounded status lasts 15s (was 5s)');
  eq(effectFor(37).durationS, 12, 'Mirror Twin decoy lasts 12s (was 4s)');
  eq(effectFor(39).durationS, 15, 'Phoenix Covenant aura lasts 15s (was 5s)');
  eq(STATUSES.Phoenix.durationS, 15, 'Phoenix status default duration is 15s');

  // ---- 2. exact 3x multiplier over the documented prior windows ------------
  near(effectFor(10).durationS / 1.4, 3, 1e-6, 'Ward is exactly 3x its old window');
  near(effectFor(11).durationS / 1.5, 3, 1e-6, 'Barrier Dome is exactly 3x');
  near(effectFor(12).windowS / 0.4, 3, 1e-6, 'Reflect is exactly 3x');
  near(effectFor(14).evadeS / 0.35, 3, 1e-6, 'Blink evade is exactly 3x');
  near(STATUSES.Grounded.durationS / 5, 3, 1e-6, 'Grounded is exactly 3x');
  near(effectFor(37).durationS / 4, 3, 1e-6, 'Mirror Twin is exactly 3x');
  near(effectFor(39).durationS / 5, 3, 1e-6, 'Phoenix Covenant is exactly 3x');

  // ---- 3. environmental durations are UNCHANGED (not "protective") ----------
  eq(ZONE.durations.Grounded, 3, 'the environmental Grounded strip keeps its own 3s zone duration');
  eq(ZONE.durations.Cover, 24, 'Stone Wall stays a 24s environmental cover zone');

  // ---- 4. the sim actually grants the new longer windows -------------------
  near(firstSeen(10, (w) => w.shield && w.shield.ticks), sToTicks(4.2), 2, 'Ward grants a ~4.2s shield in-sim');
  near(firstSeen(11, (w) => w.barrier && w.barrier.ticks), sToTicks(4.5), 2, 'Barrier Dome grants a ~4.5s barrier in-sim');
  near(firstSeen(12, (w) => w.reflectTicks), sToTicks(1.2), 2, 'Reflect grants a ~1.2s window in-sim');
  near(firstSeen(14, (w) => w.evadeTicks), sToTicks(1.05), 2, 'Blink grants a ~1.05s evade in-sim');
  near(firstSeen(37, (w) => w.mirrorTicks), sToTicks(12), 2, 'Mirror Twin holds a ~12s decoy in-sim');
  near(firstSeen(20, (w) => w.statuses.Grounded && w.statuses.Grounded.ticks), sToTicks(15), 2,
    'Grounding Mantle grants ~15s of Grounded in-sim');
  near(firstSeen(39, (w) => w.statuses.Phoenix && w.statuses.Phoenix.ticks), sToTicks(15), 2,
    'Phoenix Covenant grants a ~15s aura in-sim');

  // ---- 5. anti-stall: Barrier still blocks the caster's own offence --------
  const sim = new Sim({ seed: 7, loadouts: [[spellWithGesture(11), spellWithGesture(1)], [spellWithGesture(1)]] });
  sim.wizards[0].aether = 100; sim.wizards[0].charges = 3; sim.wizards[0].arcPos = 0; sim.wizards[1].arcPos = 0;
  sim.step({ 0: { cast: 11, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 90 && !sim.wizards[0].barrier; t++) sim.step({ 0: {}, 1: {} });
  ok(sim.wizards[0].barrier && sim.wizards[0].barrier.ticks > 0, 'Barrier Dome is up');
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  ok(!sim.wizards[0].casting, 'Barrier still blocks the caster from starting an offensive cast (intentional)');

  return report('protection');
}
