// loadouts.js — curated Phase 1 starter loadout.
//
// Phase 1 exposes a curated 8-spell "Adept Starter" loadout drawn from the
// canonical roster. The spell NUMBERS come from spellData.generated.js (which
// is generated from design/spells.csv); this file only chooses which 8 to
// equip and pairs each with a gesture template key. Combat behaviour for these
// eight is authored in ../sim/spellEffects.js.

import { SPELLS_BY_ID } from './spellData.generated.js';

// The eight starter spells were chosen to (a) span offensive / defensive /
// control categories, (b) demonstrate statuses + counters, and (c) have
// visually well-separated gestures so the template recognizer is reliable.
//
// gestureKey references a template in ../gesture/templates.js.
export const STARTER_SPELL_IDS = [1, 2, 4, 3, 28, 10, 11, 12];

export const STARTER_GESTURE_KEYS = {
  1: 'flickRight',   // Ember Bolt   — horizontal right flick
  2: 'lineUp',       // Frost Lance  — vertical up line
  4: 'vShape',       // Stone Shard  — V
  3: 'zigzag',       // Spark Dart   — short zigzag
  28: 'arc',         // Concussive Blast — pushing arc
  10: 'bracket',     // Ward         — open right bracket
  11: 'circle',      // Barrier Dome — clockwise circle
  12: 'checkmark',   // Reflect      — check mark
};

export function starterLoadout() {
  return STARTER_SPELL_IDS.map((id) => {
    const spell = SPELLS_BY_ID[id];
    if (!spell) throw new Error(`Starter loadout references unknown spell id ${id}`);
    return { ...spell, gestureKey: STARTER_GESTURE_KEYS[id] };
  });
}

// Total loadout points of the starter set (for the point-budget check in §8).
export function loadoutPoints(loadout) {
  return loadout.reduce((sum, s) => sum + (s.loadout_points || 0), 0);
}
