// protection.test.js — locks the requested protection-duration tuning
// (spellEffects.js + constants.js) and proves the deterministic sim actually
// reads the longer windows. Anti-stall / zone-duration rules stay intact.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { spellWithGesture } from '../shared/src/balance/loadouts.js';
import { effectFor } from '../shared/src/sim/spellEffects.js';
import { STATUSES, ZONE, TICK_HZ } from '../shared/src/sim/constants.js';

const sToTicks = (s) => Math.max(0, Math.round(s * TICK_HZ));

// Cast one spell in isolation and report the first-observed value of a field
// (before per-tick decay eats into it), so we can read the granted window.
function firstSeen(id, pick, prime = {}) {
  const spell = spellWithGesture(id);
  const sim = new Sim({ seed: 5, loadouts: [[spell], [spellWithGesture(1)]] });
  const w = sim.wizards[0], o = sim.wizards[1];
  w.aether = 100; w.charges = spell.charges || 0; w.arcPos = 0; o.arcPos = 0.4;
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

  // ---- 1. canonical duration data matches the latest requested targets ------
  eq(effectFor(10).durationS, 12.6, 'Ward active duration is 12.6s');
  eq(effectFor(11).durationS, 9, 'Barrier Dome lasts 9s');
  eq(effectFor(12).windowS, 3.6, 'Reflect window is 3.6s');
  eq(effectFor(14).evadeS, 1.05, 'Blink evade lasts 1.05s (was 0.35s)');
  eq(effectFor(14).invisibleS, 3, 'Blink invisibility lasts 3s');
  eq(STATUSES.Grounded.durationS, 15, 'Grounded status lasts 15s (was 5s)');
  eq(effectFor(37).durationS, 12, 'Mirror Twin decoy lasts 12s (was 4s)');
  eq(effectFor(39).durationS, 15, 'Phoenix Covenant aura lasts 15s (was 5s)');
  eq(STATUSES.Phoenix.durationS, 15, 'Phoenix status default duration is 15s');

  // ---- 2. requested multipliers over the immediately previous windows -------
  near(effectFor(10).durationS / 4.2, 3, 1e-6, 'Ward is 3x its previous 4.2s window');
  near(effectFor(11).durationS / 4.5, 2, 1e-6, 'Barrier Dome is 2x its previous 4.5s window');
  near(effectFor(12).windowS / 1.2, 3, 1e-6, 'Reflect is 3x its previous 1.2s window');
  near(effectFor(14).evadeS / 0.35, 3, 1e-6, 'Blink evade is exactly 3x');
  near(STATUSES.Grounded.durationS / 5, 3, 1e-6, 'Grounded is exactly 3x');
  near(effectFor(37).durationS / 4, 3, 1e-6, 'Mirror Twin is exactly 3x');
  near(effectFor(39).durationS / 5, 3, 1e-6, 'Phoenix Covenant is exactly 3x');

  // ---- 3. environmental durations are UNCHANGED (not "protective") ----------
  eq(ZONE.durations.Grounded, 3, 'the environmental Grounded strip keeps its own 3s zone duration');
  eq(ZONE.durations.Cover, 24, 'Stone Wall stays a 24s environmental cover zone');

  // ---- 4. the sim actually grants the new longer windows -------------------
  near(firstSeen(10, (w) => w.shield && w.shield.ticks), sToTicks(12.6), 2, 'Ward grants a ~12.6s shield in-sim');
  near(firstSeen(11, (w) => w.barrier && w.barrier.ticks), sToTicks(9), 2, 'Barrier Dome grants a ~9s barrier in-sim');
  near(firstSeen(12, (w) => w.reflectTicks), sToTicks(3.6), 2, 'Reflect grants a ~3.6s window in-sim');
  near(firstSeen(14, (w) => w.evadeTicks), sToTicks(1.05), 2, 'Blink grants a ~1.05s evade in-sim');
  near(firstSeen(14, (w) => w.invisibleTicks), sToTicks(3), 2, 'Blink grants ~3s of invisibility in-sim');
  near(firstSeen(37, (w) => w.mirrorTicks), sToTicks(12), 2, 'Mirror Twin holds a ~12s decoy in-sim');
  near(firstSeen(20, (w) => w.statuses.Grounded && w.statuses.Grounded.ticks), sToTicks(15), 2,
    'Grounding Mantle grants ~15s of Grounded in-sim');
  near(firstSeen(39, (w) => w.statuses.Phoenix && w.statuses.Phoenix.ticks), sToTicks(15), 2,
    'Phoenix Covenant grants a ~15s aura in-sim');
  const blinkSim = new Sim({ seed: 6, loadouts: [[spellWithGesture(14)], [spellWithGesture(1)]] });
  blinkSim.wizards[0].aether = 100;
  blinkSim.step({ 0: { cast: 14, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 60 && blinkSim.wizards[0].invisibleTicks <= 0; t++) blinkSim.step({ 0: {}, 1: {} });
  ok(blinkSim.snapshot().wizards[0].invisibleTicks > 0, 'authoritative snapshots include Blink invisibility');
  const visibleHash = blinkSim.hash();
  blinkSim.wizards[0].invisibleTicks -= 1;
  ok(blinkSim.hash() !== visibleHash, 'deterministic state hashes include Blink invisibility');

  // ---- 5. anti-stall: Barrier still blocks the caster's own offence --------
  const sim = new Sim({ seed: 7, loadouts: [[spellWithGesture(11), spellWithGesture(1)], [spellWithGesture(1)]] });
  sim.wizards[0].aether = 100; sim.wizards[0].charges = 3; sim.wizards[0].arcPos = 0; sim.wizards[1].arcPos = 0;
  sim.step({ 0: { cast: 11, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 90 && !sim.wizards[0].barrier; t++) sim.step({ 0: {}, 1: {} });
  ok(sim.wizards[0].barrier && sim.wizards[0].barrier.ticks > 0, 'Barrier Dome is up');
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  ok(!sim.wizards[0].casting, 'Barrier still blocks the caster from starting an offensive cast (intentional)');

  // ---- 6. Barrier blocks hostile resource/status/weather effects ------------
  let guarded = new Sim({
    seed: 8,
    loadouts: [[spellWithGesture(24), spellWithGesture(21)], [spellWithGesture(1)]],
  });
  guarded.wizards[0].aether = 100;
  guarded.wizards[1].aether = 100;
  guarded.wizards[1].barrier = { absorb: 60, ticks: 600 };
  guarded.step({ 0: { cast: 24, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 120 && guarded.wizards[0].casting; t++) guarded.step({ 0: {}, 1: {} });
  eq(guarded.wizards[1].aether, 100, 'Barrier blocks Aether Leech');

  guarded.wizards[0].recoveryTicks = 0;
  guarded.step({ 0: { cast: 21, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 120 && guarded.wizards[0].casting; t++) guarded.step({ 0: {}, 1: {} });
  ok(!guarded.hasStatus(guarded.wizards[1], 'Weakened'), 'Barrier blocks hostile hex statuses');

  guarded = new Sim({
    seed: 9,
    loadouts: [[spellWithGesture(3)], [spellWithGesture(1)]],
  });
  guarded.wizards[0].aether = 100;
  guarded.wizards[0].arcPos = 0;
  guarded.wizards[1].arcPos = 0;
  guarded.wizards[1].barrier = { absorb: 1, ticks: 600 };
  guarded.step({ 0: { cast: 3, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 120 && !guarded.ended; t++) guarded.step({ 0: {}, 1: {} });
  ok(guarded.wizards[1].health < 100, 'projectile overflow can damage through a broken Barrier');
  ok(!guarded.hasStatus(guarded.wizards[1], 'Static'),
    'a projectile that collided with Barrier cannot deliver its status rider');

  guarded = new Sim({ seed: 10, loadouts: [[spellWithGesture(32)], [spellWithGesture(1)]] });
  guarded.wizards[0].aether = 100;
  guarded.wizards[1].barrier = { absorb: 60, ticks: 600 };
  guarded.addZone(0, 'Wet', { durationS: 6 });
  for (let t = 0; t < 5 * TICK_HZ; t++) guarded.step({ 0: {}, 1: {} });
  ok(!guarded.hasStatus(guarded.wizards[1], 'Wet') && !guarded.hasStatus(guarded.wizards[1], 'Soaked'),
    'Barrier blocks Wet and Soaked weather exposure');

  return report('protection');
}
