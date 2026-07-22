// cooldowns.test.js — every spell has a deliberate cooldown in [2, 60] seconds,
// the exact reviewed target table is honoured, the generated catalog matches the
// canonical CSV, and cooldowns scale sensibly with spell power.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHarness } from './tiny.js';
import { parseCsv, rowsToSpells } from '../scripts/generate-spells.js';
import { SPELL_CATALOG, SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';
import { effectFor } from '../shared/src/sim/spellEffects.js';
import { STATUSES, ZONE } from '../shared/src/sim/constants.js';
import { Sim } from '../shared/src/sim/sim.js';
import { spellWithGesture } from '../shared/src/balance/loadouts.js';
import { TICK_HZ } from '../shared/src/sim/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '..', 'design', 'spells.csv');

// The single reviewed source-of-truth cooldown table (seconds), keyed by id.
// Rebalanced so every persistent protective / buff / debuff / control /
// environment / secret spell carries a cooldown >= 2x its active effect
// duration (see the data-driven check below) while staying within [2, 60]s.
const TARGET_COOLDOWNS = {
  1: 18, 2: 18, 3: 14, 4: 5, 5: 5, 6: 18, 7: 18, 8: 24, 9: 24,
  10: 26, 11: 18, 12: 8, 13: 10, 14: 9, 15: 48,
  16: 36, 17: 36, 18: 30, 19: 36, 20: 30,
  21: 24, 22: 24, 23: 24, 24: 14, 25: 20,
  26: 15, 27: 20, 28: 6, 29: 40, 30: 20,
  31: 42, 32: 42, 33: 8, 34: 24, 35: 36, 36: 48,
  37: 32, 38: 45, 39: 60, 40: 50,
};

// The active/lingering window (seconds) a spell's effect occupies, derived from
// the SAME machine-usable effect + status + zone data the sim runs on (never a
// hand-copied number). Instantaneous spells (no lingering state) return 0 and
// are unconstrained by the 2x rule below.
function activeDurationS(eff) {
  if (!eff) return 0;
  switch (eff.type) {
    case 'shield': case 'barrier': case 'mirror': case 'phoenix': case 'channel':
      return eff.durationS || 0;
    case 'reflect': return eff.windowS || 0;
    case 'blink': return Math.max(eff.evadeS || 0, eff.invisibleS || 0);
    case 'zone': return (ZONE.durations[eff.zoneKind]) || 0;
    case 'buff': return (STATUSES[eff.self] && STATUSES[eff.self].durationS) || 0;
    case 'projectile':
      // A projectile's lingering effect is the status it leaves behind (a DoT,
      // slow or flag). Conditional, sub-second stuns are not a persistent state.
      return (eff.status && (eff.status.durationS
        || (STATUSES[eff.status.name] && STATUSES[eff.status.name].durationS))) || 0;
    case 'hex':
      if (eff.status && STATUSES[eff.status.name]) return STATUSES[eff.status.name].durationS;
      if (eff.conditionalControl && eff.conditionalControl.durationS) return eff.conditionalControl.durationS;
      return 0;
    default: return 0;
  }
}

export function run() {
  const { ok, eq, report } = createHarness();

  // ---- 1. exact per-id cooldown coverage for all 40 spells -----------------
  eq(SPELL_CATALOG.length, 40, 'catalog has all 40 spells');
  eq(Object.keys(TARGET_COOLDOWNS).length, 40, 'target table covers all 40 ids');
  let tableOk = true;
  for (const s of SPELL_CATALOG) {
    const want = TARGET_COOLDOWNS[s.id];
    if (want === undefined) { tableOk = false; continue; }
    eq(s.cooldown_s, want, `${s.name} (${s.id}) cooldown is exactly ${want}s`);
    if (s.cooldown_s !== want) tableOk = false;
  }
  ok(tableOk, 'every generated cooldown matches the reviewed target table');

  // ---- 2. every cooldown is deliberate and within [2, 60] seconds ----------
  let rangeOk = true;
  const outOfRange = [];
  for (const s of SPELL_CATALOG) {
    const cd = s.cooldown_s;
    const inRange = typeof cd === 'number' && Number.isFinite(cd) && cd >= 2 && cd <= 60;
    if (!inRange) { rangeOk = false; outOfRange.push(`${s.id}:${cd}`); }
  }
  ok(rangeOk, `all 40 cooldowns are within [2,60]s (offenders: ${outOfRange.join(',') || 'none'})`);
  // The upper endpoint stays meaningful (Phoenix is the deliberate 60s ceiling);
  // the lower endpoint need only remain within the reviewed [2,60] band.
  ok(Math.min(...SPELL_CATALOG.map((s) => s.cooldown_s)) >= 2, 'shortest cooldown is still >= 2s');
  eq(Math.max(...SPELL_CATALOG.map((s) => s.cooldown_s)), 60, 'longest cooldown is 60s (Phoenix Covenant)');

  // ---- 3. generated catalog matches the canonical CSV exactly --------------
  const csvSpells = rowsToSpells(parseCsv(readFileSync(CSV_PATH, 'utf8')));
  eq(csvSpells.length, 40, 'CSV parses to 40 spells');
  let csvMatchesGen = true;
  for (const cs of csvSpells) {
    const gen = SPELLS_BY_ID[cs.id];
    if (!gen || gen.cooldown_s !== cs.cooldown_s) { csvMatchesGen = false; }
  }
  ok(csvMatchesGen, 'generated cooldowns match design/spells.csv (regenerate with npm run gen:spells)');

  // ---- 4. data-driven rule: cooldown >= 2x active effect duration ----------
  // The core rebalance invariant: no persistent protective / buff / debuff /
  // control / environment / secret spell may be re-applied before its own effect
  // expires, so its cooldown must be at least TWICE its active window. Durations
  // are derived from the same effect/status/zone data the sim runs on, and the
  // check covers EVERY relevant spell (not a hand-picked few). Instantaneous
  // spells (0s window) are exempt from the lower bound but still capped at 60s.
  const cd = (id) => SPELLS_BY_ID[id].cooldown_s;
  const deliberateReapplyExceptions = new Set([3]); // Spark Dart stacks long-lived Static.
  const durFailures = [];
  let persistentCovered = 0;
  for (const s of SPELL_CATALOG) {
    const dur = activeDurationS(effectFor(s.id));
    if (dur > 0) {
      persistentCovered++;
      if (!deliberateReapplyExceptions.has(s.id) && s.cooldown_s < 2 * dur) {
        durFailures.push(`${s.name}(${s.id}) cd ${s.cooldown_s}s < 2x${dur}s`);
      }
    }
    if (s.cooldown_s > 60) durFailures.push(`${s.name}(${s.id}) cd ${s.cooldown_s}s > 60s cap`);
  }
  ok(durFailures.length === 0,
    `persistent spells honor the 2x-duration rule except deliberate stacking setup (offenders: ${durFailures.join('; ') || 'none'})`);
  ok(persistentCovered >= 30,
    `the 2x-duration rule actually spans the persistent roster (covered ${persistentCovered} spells)`);

  // Spot-check the headline reviewed windows explicitly (belt-and-braces on top
  // of the generic rule): active window seconds -> minimum required cooldown.
  const REVIEWED = { 10: 12.6, 11: 9, 12: 3.6, 14: 3, 15: 24, 16: 18, 17: 18, 18: 15, 19: 18, 20: 15,
    21: 12, 22: 12, 23: 12, 25: 6, 26: 3, 29: 4, 31: 21, 32: 21, 35: 18, 36: 24, 37: 12, 38: 18, 39: 15 };
  let reviewedOk = true;
  for (const [id, dur] of Object.entries(REVIEWED)) {
    if (!(cd(Number(id)) >= 2 * dur)) reviewedOk = false;
  }
  ok(reviewedOk, 'every reviewed protective/status/environment window is out-cooled by >= 2x');

  // ---- 5. representative power ordering (consistent with the new table) -----
  // Spark Dart trades a shorter cooldown for low damage and setup-focused pressure.
  ok(cd(1) === 18 && cd(2) === 18 && cd(3) === 14 && cd(6) === 18,
    'Spark Dart has a 14s cooldown while the other status-applying bolts remain at 18s');
  ok(cd(4) < cd(1) && cd(5) < cd(1), 'no-status bolts (Stone Shard/Arcane Missile) are the cheapest offense');
  // Heavy charged nukes still out-cost the light status bolts.
  ok(cd(8) > cd(6) && cd(9) > cd(2), 'heavy nukes (Fireball/Ice Comet) cost more than light bolts');
  // Protective utility scales with its active window, not its category: Ward's
  // 12.6s window out-cools Barrier Dome's 9s, and Stone Wall's 24s cover is the
  // longest-held protection so it carries the longest defensive cooldown.
  ok(cd(10) > cd(11), 'Ward (longer 12.6s window) out-cools Barrier Dome (9s)');
  ok(cd(15) > cd(10) && cd(15) > cd(14), 'Stone Wall (24s cover) out-cools Ward and Blink');
  // Strong control / lockdown costs more than a light interrupt.
  ok(cd(30) > cd(28), 'Thunderclap (hard stun) out-cools Concussive Blast (light interrupt)');
  // The signature ultimate (Phoenix) is the single longest on the roster; the
  // secret cohort is no longer required to out-cool every non-secret (Stone Wall
  // and Rune Snare now match the mid secrets at 48s).
  ok(cd(39) >= cd(40) && cd(39) >= cd(38) && cd(39) >= cd(37), 'Phoenix Covenant has the longest cooldown');
  eq(cd(39), Math.max(...SPELL_CATALOG.map((s) => s.cooldown_s)), 'Phoenix Covenant is the global cooldown ceiling');

  // ---- 6. shared simulation enforces cooldowns for every adapter ------------
  // Practice vs AI's LocalMatch and the authoritative online MatchRoom both call
  // this same Sim.step/beginCast path.
  const sim = new Sim({
    seed: 99,
    loadouts: [[spellWithGesture(1)], [spellWithGesture(1)]],
    rules: { timer: false, pressure: false },
  });
  const player = sim.wizards[0];
  player.aether = 100;
  sim.step({ 0: { cast: 1, castQuality: 1, castWasGesture: true }, 1: {} });
  for (let i = 0; i < 120 && player.castsResolved < 1; i++) sim.step({ 0: {}, 1: {} });
  ok(player.cooldowns[1] > 0, 'resolved Ember Bolt starts its shared simulation cooldown');
  const resolved = player.castsResolved;
  const rejected = player.castsRejected;
  const rejectEvents = sim.step({ 0: { cast: 1, castQuality: 1, castWasGesture: true }, 1: {} });
  eq(player.castsResolved, resolved, 'an immediate recast does not resolve during cooldown');
  eq(player.castsRejected, rejected + 1, 'an immediate gesture recast is rejected during cooldown');
  const cooldownReject = rejectEvents.find((e) => e.type === 'castRejected' && e.spellId === 1);
  eq(cooldownReject?.reason, 'cooldown', 'cooldown rejection identifies its reason');
  ok(cooldownReject?.cooldownTicks > 0 && cooldownReject?.cooldownSeconds > 0,
    'cooldown rejection reports ticks and seconds remaining');
  while (player.cooldowns[1] > 0) sim.step({ 0: {}, 1: {} });
  player.aether = 100;
  sim.step({ 0: { cast: 1, castQuality: 1, castWasGesture: true }, 1: {} });
  ok(player.casting && player.casting.spellId === 1, `recast is allowed after ${cd(1) * TICK_HZ} cooldown ticks expire`);

  return report('cooldowns');
}
