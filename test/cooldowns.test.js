// cooldowns.test.js — every spell has a deliberate cooldown in [2, 60] seconds,
// the exact reviewed target table is honoured, the generated catalog matches the
// canonical CSV, and cooldowns scale sensibly with spell power.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHarness } from './tiny.js';
import { parseCsv, rowsToSpells } from '../scripts/generate-spells.js';
import { SPELL_CATALOG, SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';
import { Sim } from '../shared/src/sim/sim.js';
import { spellWithGesture } from '../shared/src/balance/loadouts.js';
import { TICK_HZ } from '../shared/src/sim/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '..', 'design', 'spells.csv');

// The single reviewed source-of-truth cooldown table (seconds), keyed by id.
const TARGET_COOLDOWNS = {
  1: 3, 2: 4, 3: 2, 4: 5, 5: 5, 6: 9, 7: 18, 8: 24, 9: 24,
  10: 8, 11: 18, 12: 7, 13: 10, 14: 6, 15: 24,
  16: 14, 17: 20, 18: 16, 19: 16, 20: 18,
  21: 9, 22: 12, 23: 12, 24: 14, 25: 20,
  26: 12, 27: 14, 28: 6, 29: 16, 30: 20,
  31: 10, 32: 12, 33: 8, 34: 24, 35: 14, 36: 16,
  37: 32, 38: 45, 39: 60, 40: 50,
};

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
  // The extremes are explicitly present so the range endpoints stay meaningful.
  eq(Math.min(...SPELL_CATALOG.map((s) => s.cooldown_s)), 2, 'shortest cooldown is 2s (Spark Dart)');
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

  // ---- 4. representative power ordering -------------------------------------
  const cd = (id) => SPELLS_BY_ID[id].cooldown_s;
  // Cheap spammable basics are the shortest.
  ok(cd(3) <= cd(1) && cd(1) < cd(6), 'basic bolts (Spark Dart <= Ember Bolt) are shorter than Flame Wave');
  // Heavy charged offensives out-cost light single-target bolts.
  ok(cd(8) > cd(6) && cd(9) > cd(2), 'heavy nukes (Fireball/Ice Comet) cost more than light bolts');
  // The four secret spells carry the heaviest cooldowns of the roster.
  const secretCds = [37, 38, 39, 40].map(cd);
  const nonSecretMax = SPELL_CATALOG.filter((s) => !s.secret).reduce((m, s) => Math.max(m, s.cooldown_s), 0);
  ok(Math.min(...secretCds) > nonSecretMax, 'every secret spell out-cools every non-secret spell');
  // The signature ultimate (Phoenix) is the single longest.
  ok(cd(39) >= cd(40) && cd(39) >= cd(38) && cd(39) >= cd(37), 'Phoenix Covenant has the longest cooldown');
  // Strong control / lockdown costs more than a light interrupt.
  ok(cd(30) > cd(28), 'Thunderclap (hard stun) out-cools Concussive Blast (light interrupt)');
  // Protective utility scaled up with its new, longer active windows.
  ok(cd(11) > cd(10) && cd(15) > cd(14), 'Barrier Dome > Ward and Stone Wall > Blink (stronger protection, longer cooldown)');

  // ---- 5. shared simulation enforces cooldowns for every adapter ------------
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
