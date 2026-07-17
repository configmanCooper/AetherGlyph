// spellEffects.js — structured combat behaviour for the Phase 1 starter loadout.
//
// The canonical cost / cooldown / charges / min-cast values are NOT duplicated
// here; the sim reads those from the generated catalog. This module only adds
// the combat-shape data (damage, projectile travel, applied status, defensive
// behaviour) that the free-text `effect` column in the CSV cannot express in a
// machine-usable way. Keyed by spell id.

export const PROJECTILE = 'projectile';
export const SHIELD = 'shield';
export const BARRIER = 'barrier';
export const REFLECT = 'reflect';

// travelS: seconds for a projectile to cross the arena (before dodge check).
// homing: 0..1 fraction it re-aims toward the defender's live position.
// dodgeRadius: arc distance beyond which the projectile misses a moving target.
export const SPELL_EFFECTS = {
  // --- Offensive projectiles ------------------------------------------------
  1: { // Ember Bolt
    type: PROJECTILE, damage: 8, status: { name: 'Burning', stacks: 1 },
    travelS: 0.45, homing: 0, dodgeRadius: 0.30, school: 'Ember', reflectable: true,
  },
  2: { // Frost Lance
    type: PROJECTILE, damage: 10, status: { name: 'Chilled', stacks: 1 },
    travelS: 0.5, homing: 0, dodgeRadius: 0.28, school: 'Tide', reflectable: true,
  },
  3: { // Spark Dart
    type: PROJECTILE, damage: 6, status: { name: 'Static', stacks: 1 },
    travelS: 0.32, homing: 0.15, dodgeRadius: 0.30, school: 'Storm', reflectable: true,
  },
  4: { // Stone Shard
    type: PROJECTILE, damage: 14, piercing: true, status: null,
    travelS: 0.55, homing: 0, dodgeRadius: 0.24, school: 'Stone', reflectable: false,
  },
  28: { // Concussive Blast
    type: PROJECTILE, damage: 6, knockback: true, interrupt: true, status: null,
    travelS: 0.28, homing: 0, dodgeRadius: 0.34, school: 'Gale', reflectable: false,
  },

  // --- Defensive ------------------------------------------------------------
  10: { // Ward — frontal shield
    type: SHIELD, absorb: 30, durationS: 1.4, frontal: true, school: 'Arcane',
  },
  11: { // Barrier Dome — 360 barrier; caster cannot use offense while active
    type: BARRIER, absorb: 60, durationS: 1.5, blocksOffense: true, school: 'Arcane',
  },
  12: { // Reflect — timed projectile reflect window
    type: REFLECT, windowS: 0.4, school: 'Gale',
  },
};

export function effectFor(spellId) {
  return SPELL_EFFECTS[spellId] || null;
}
