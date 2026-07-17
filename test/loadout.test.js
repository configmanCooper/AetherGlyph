// loadout.test.js — §8 loadout construction rules, validation, presets.

import { createHarness } from './tiny.js';
import {
  validateLoadout, PRESETS, presetLoadout, makeLoadout, LOADOUT, hasDefensiveAnswer,
} from '../shared/src/balance/loadouts.js';
import { SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';

export function run() {
  const { ok, eq, report } = createHarness();

  // A clean legal build validates.
  const legal = [1, 6, 31, 28, 22, 10, 13, 16];
  const v = validateLoadout(legal);
  ok(v.valid, 'a legal 8-spell build validates');
  eq(v.errors.length, 0, 'legal build has no errors');

  // Wrong size.
  ok(!validateLoadout([1, 2, 3]).valid, 'fewer than 8 spells is invalid');
  ok(!validateLoadout([1, 2, 3, 4, 5, 6, 7, 8, 9]).valid, 'more than 8 spells is invalid');

  // Over point budget (four 3-pointers + more already exceeds 14, but also
  // trips the heavy limit — pick a build that only breaks the budget).
  const over = [8, 9, 6, 5, 22, 15, 16, 17]; // 3+3+2+2+2+2+2+2 = 18 pts, 2 heavy
  const ov = validateLoadout(over);
  ok(ov.errors.some((e) => /budget/i.test(e)), 'over-budget build reports a budget error');

  // Too many 3-point spells (three heavies).
  const heavy = [7, 8, 9, 1, 2, 3, 10, 13]; // 7,8,9 are 3-pt
  const hv = validateLoadout(heavy);
  ok(hv.errors.some((e) => /three-point/i.test(e)), 'three heavy spells is invalid');

  // Too many from one school (four Arcane).
  const school = [10, 11, 13, 14, 1, 2, 3, 4]; // Ward,Barrier,Dispel,Blink = 4 Arcane
  const sc = validateLoadout(school);
  ok(sc.errors.some((e) => /Arcane/.test(e)), 'four spells from one school is invalid');

  // Duplicate spell.
  ok(!validateLoadout([1, 1, 2, 3, 4, 5, 6, 7]).valid, 'duplicate spell is invalid');

  // Defensive-coverage warning (no defensive answer) — does NOT block.
  const noDefense = [1, 6, 8, 21, 22, 3, 4, 7]; // legal schools, but no ward/dispel/etc
  const nd = validateLoadout(noDefense);
  ok(!hasDefensiveAnswer(noDefense), 'noDefense build has no defensive answer');
  ok(nd.valid, 'a legal-but-fragile build still validates');
  ok(nd.warnings.length >= 1, 'missing defensive answer produces a warning');

  // Every curated preset is a legal build.
  let allLegal = true;
  for (const p of PRESETS) { if (!validateLoadout(p.ids).valid) allLegal = false; }
  ok(allLegal, 'every curated archetype preset is legal');
  ok(PRESETS.length >= 6, 'several archetype presets are provided');

  // Secret spells are selectable for Phase 2 (present in a preset, castable).
  const prismatic = PRESETS.find((p) => p.ids.includes(40));
  ok(prismatic && SPELLS_BY_ID[40].secret === true, 'a secret spell (Prismatic Beam) is selectable in a preset');

  // presetLoadout / makeLoadout attach a gestureKey to each spell.
  const load = presetLoadout('storm-tempo');
  eq(load.length, LOADOUT.size, 'preset loadout has 8 spells');
  ok(load.every((s) => s.gestureKey), 'every equipped spell has a gestureKey');
  const custom = makeLoadout([1, 2, 3, 4, 5, 6, 7, 8]);
  ok(custom.every((s) => s.gestureKey && s.id), 'makeLoadout builds equip-ready spell objects');

  return report('loadout');
}
