// loadouts.js — loadout construction, validation, and curated archetype presets.
//
// The canonical spell NUMBERS come from spellData.generated.js (generated from
// design/spells.csv); this file only chooses which to equip, validates a build
// against the §8 rules, and pairs each spell with a gesture template key.
// Combat behaviour for every spell is authored in ../sim/spellEffects.js.

import { SPELLS_BY_ID, SPELL_CATALOG } from './spellData.generated.js';
import { effectFor, categoryOf } from '../sim/spellEffects.js';

// --- §8 loadout-construction rules ---------------------------------------
export const LOADOUT = {
  size: 8,
  pointBudget: 14,
  maxHeavy: 2,          // at most two 3-point spells
  maxPerSchool: 3,      // at most three spells from one school
};

// gestureKey references a hand-authored template in ../gesture/templates.js.
// All 40 roster spells have templates; keys remain unique per spell.
export const GESTURE_KEYS = {
  1: 'flickRight', 2: 'lineUp', 3: 'zigzag', 4: 'vShape', 5: 'arcUp',
  6: 'wideArc', 7: 'longZigzag', 8: 'triangleCW', 9: 'spiralIn',
  10: 'bracket', 11: 'circle', 12: 'checkmark', 13: 'circleCCW', 14: 'doubleStroke',
  15: 'lowSquare', 16: 'spiralUp', 17: 'figureEight', 18: 'loopCW', 19: 'flameOutline',
  20: 'diamond', 21: 'downArc', 22: 'jaggedX', 23: 'slowSpiral', 24: 'downHook',
  25: 'knot', 26: 'uRoot', 27: 'twinLoops', 28: 'arc', 29: 'burst5',
  30: 'twinLines', 31: 'wavyLine', 32: 'cloudArc', 33: 'fanStrokes', 34: 'quakeSlash',
  35: 'looseCircle', 36: 'triTap', 37: 'eightTap', 38: 'hourglass', 39: 'phoenixWing',
  40: 'starLine',
};

// Back-compat starter set (Phase 1 smoke path).
export const STARTER_SPELL_IDS = [1, 2, 4, 3, 28, 10, 11, 12];
export const STARTER_GESTURE_KEYS = {
  1: 'flickRight', 2: 'lineUp', 4: 'vShape', 3: 'zigzag',
  28: 'arc', 10: 'bracket', 11: 'circle', 12: 'checkmark',
};

export function spellWithGesture(id) {
  const spell = SPELLS_BY_ID[id];
  if (!spell) throw new Error(`Loadout references unknown spell id ${id}`);
  return { ...spell, gestureKey: GESTURE_KEYS[id] || `spell${id}` };
}

// Turn a list of spell ids into equipped spell objects (no validation — used by
// presets, the bot, and after the UI has validated a build).
export function makeLoadout(ids) {
  return ids.map(spellWithGesture);
}

export function starterLoadout() {
  return STARTER_SPELL_IDS.map((id) => ({ ...SPELLS_BY_ID[id], gestureKey: STARTER_GESTURE_KEYS[id] }));
}

export function loadoutPoints(loadout) {
  return loadout.reduce((sum, s) => sum + (s.loadout_points || 0), 0);
}

// A spell "answers" projectiles / zones / statuses if it is defensive or a
// cleanse / deflect / relocation tool (§8 defensive-coverage warning).
const ANSWER_IDS = new Set([10, 11, 12, 13, 14, 15, 33, 20]); // Ward,Barrier,Reflect,Dispel,Blink,Wall,Gust,Grounding

export function hasDefensiveAnswer(ids) {
  return ids.some((id) => {
    const eff = effectFor(id);
    return ANSWER_IDS.has(id) || (eff && categoryOf(eff) === 'defense');
  });
}

// Validate a set of spell ids against the §8 construction rules. Returns
// { valid, errors, warnings, points, schoolCounts, heavyCount }.
export function validateLoadout(ids) {
  const errors = [];
  const warnings = [];
  const list = Array.isArray(ids) ? ids : [];

  // Existence + effect coverage.
  const unknown = list.filter((id) => !SPELLS_BY_ID[id]);
  if (unknown.length) errors.push(`Unknown spell id(s): ${unknown.join(', ')}`);
  const noEffect = list.filter((id) => SPELLS_BY_ID[id] && !effectFor(id));
  if (noEffect.length) errors.push(`Spell(s) without combat effect: ${noEffect.join(', ')}`);

  // Distinct.
  const seen = new Set();
  const dupes = new Set();
  for (const id of list) { if (seen.has(id)) dupes.add(id); seen.add(id); }
  if (dupes.size) errors.push(`Duplicate spell(s): ${[...dupes].join(', ')}`);

  // Size.
  if (list.length !== LOADOUT.size) errors.push(`Loadout must have exactly ${LOADOUT.size} spells (has ${list.length}).`);

  // Point budget.
  const points = list.reduce((s, id) => s + (SPELLS_BY_ID[id]?.loadout_points || 0), 0);
  if (points > LOADOUT.pointBudget) errors.push(`Over budget: ${points}/${LOADOUT.pointBudget} points.`);

  // At most two 3-point spells.
  const heavyCount = list.filter((id) => (SPELLS_BY_ID[id]?.loadout_points || 0) >= 3).length;
  if (heavyCount > LOADOUT.maxHeavy) errors.push(`At most ${LOADOUT.maxHeavy} three-point spells (has ${heavyCount}).`);

  // At most three spells from the same school.
  const schoolCounts = {};
  for (const id of list) {
    const sc = SPELLS_BY_ID[id]?.school;
    if (sc) schoolCounts[sc] = (schoolCounts[sc] || 0) + 1;
  }
  for (const [sc, n] of Object.entries(schoolCounts)) {
    if (n > LOADOUT.maxPerSchool) errors.push(`At most ${LOADOUT.maxPerSchool} ${sc} spells (has ${n}).`);
  }

  // Defensive-coverage warning (does not block).
  if (list.length && !hasDefensiveAnswer(list)) {
    warnings.push('No equipped spell answers projectiles, zones, or statuses. Add a Ward, Dispel, Reflect, Blink, Gust, or Grounding.');
  }

  return { valid: errors.length === 0, errors, warnings, points, schoolCounts, heavyCount };
}

// --- Curated archetype presets (§8) --------------------------------------
// Each preset is a legal 8-spell / 14-point build. Secret spells are included
// in some presets and are selectable for Phase 2 development; final unlock
// progression arrives in the solo/ranked phase.
export const PRESETS = [
  { key: 'ember-rush',      name: 'Ember Rush',      ids: [1, 6, 31, 28, 22, 10, 13, 16],
    blurb: 'Cheap pressure, interrupt Focus, finish with Flame Wave.' },
  { key: 'tide-control',    name: 'Tide Control',    ids: [2, 9, 27, 13, 10, 23, 24, 22],
    blurb: 'Chill, Soak, Freeze, and punish movement.' },
  { key: 'storm-tempo',     name: 'Storm Tempo',     ids: [3, 7, 30, 32, 28, 12, 13, 10],
    blurb: 'Static stacks, Soaked burst, reaction punishes.' },
  { key: 'stone-warden',    name: 'Stone Warden',    ids: [4, 15, 22, 10, 13, 28, 12, 24],
    blurb: 'Cover, Sunder, and counter-punch.' },
  { key: 'gale-trickster',  name: 'Gale Trickster',  ids: [12, 33, 35, 29, 14, 13, 1, 22],
    blurb: 'Deflect, relocate zones, obscure intent.' },
  { key: 'arcane-combo',    name: 'Arcane Combo',    ids: [18, 5, 10, 22, 8, 28, 16, 1],
    blurb: 'Mark, Amplify, precise heavy payoff.' },
  { key: 'umbra-attrition', name: 'Umbra Attrition', ids: [21, 23, 24, 36, 13, 10, 1, 3],
    blurb: 'Weaken, Leech, traps, resource denial.' },
  { key: 'prismatic-hybrid',name: 'Prismatic Hybrid',ids: [40, 1, 2, 3, 32, 33, 13, 10],
    blurb: 'Change school to exploit shared weather.' },
];

export const PRESETS_BY_KEY = Object.freeze(
  PRESETS.reduce((m, p) => { m[p.key] = p; return m; }, {}),
);

export function presetLoadout(key) {
  const p = PRESETS_BY_KEY[key] || PRESETS[0];
  return makeLoadout(p.ids);
}

// The full roster (for the loadout builder UI).
export function allSpells() { return SPELL_CATALOG.slice(); }
