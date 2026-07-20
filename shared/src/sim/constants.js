// constants.js — authoritative Phase 1 tuning constants pulled straight from
// MASTERPLAN.md sections 3, 6, 7. Kept DOM-free so it imports cleanly in Node
// and the browser. Times are seconds; the sim converts them to ticks.

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

// --- Match structure (MASTERPLAN §3) -------------------------------------
export const MATCH = {
  startHealth: 100,
  roundLimitS: 105,
  arcanePressureStartS: 60,
  arcanePressureStepS: 10,
  lateRoundS: 90, // shields -20% cap, healing disabled
};

// --- Aether (MASTERPLAN §6) ----------------------------------------------
export const AETHER = {
  max: 100,
  start: 60,
  regenPerS: 8,
  protectedFloor: 12, // Aether Leech cannot drain below this
};

// --- Sigil charges (MASTERPLAN §6) ---------------------------------------
export const SIGIL = {
  max: 3,
  start: 0,
  decayS: 8, // one charge decays after 8s of inactivity
};

// --- Universal actions (MASTERPLAN §4) -----------------------------------
export const FOCUS = {
  channelS: 0.95, // hold to gain one Sigil Charge; interruptible
};
export const SIDESTEP = {
  charges: 2,
  rechargeS: 2.5,
  arcDelta: 0.42, // fraction of the movement arc covered by one sidestep
};
export const BRACE = {
  durationS: 0.45,
  damageReduction: 0.4,
  aetherCost: 12,
};

// --- Movement arc (MASTERPLAN §12) ---------------------------------------
// Position is a scalar in [-1, 1] mapped onto a shallow 100-degree arc.
export const MOVE = {
  arcHalfDeg: 50,
  speedPerS: 0.9,           // free strafe speed (arc units per second)
  separationBase: 10,       // arena units between wizards (render only)
};

// --- Hard control safety / Tenacity (MASTERPLAN §7) ----------------------
export const CONTROL = {
  maxHardControlS: 1.0,
  tenacityS: 3.5, // blocks new hard control after any hard control ends
  knockbackWindowS: 4.0,
  knockbackMaxChain: 2,
};

// --- Recognition recovery (MASTERPLAN §5) --------------------------------
export const CAST = {
  rejectRecoveryS: 0.25,
  minPotency: 0.9,
  maxPotency: 1.05,
};

// --- Status effect definitions (MASTERPLAN §7) ---------------------------
// duration in seconds; other fields are read by sim/status logic.
// `harmful: true` marks statuses Dispel can strip and the HUD flags as debuffs.
// `buff: true` (kind:'buff') marks self buffs — never dispelled off the caster
// by an opponent and shown as beneficial in the HUD.
export const STATUSES = {
  // Debuffs / crowd control ------------------------------------------------
  Burning:  { durationS: 3, maxStacks: 2, dps: 2, kind: 'dot', harmful: true },
  Chilled:  { durationS: 4.5, maxStacks: 1, slow: 0.18, kind: 'slow', harmful: true },
  Sloth:    { durationS: 5.5, maxStacks: 1, slow: 0.18, kind: 'slow', harmful: true },
  Soaked:   { durationS: 6, maxStacks: 1, lightningBonus: 0.25, kind: 'flag', harmful: true },
  Static:   { durationS: 4.5, maxStacks: 3, kind: 'flag', harmful: true },
  Sundered: { durationS: 5.5, maxStacks: 1, damageTaken: 0.20, kind: 'amp', harmful: true },
  Weakened: { durationS: 5, maxStacks: 1, damageDealt: 0.22, kind: 'amp', harmful: true },
  Marked:   { durationS: 6, maxStacks: 1, markBonus: 0.35, kind: 'flag', harmful: true },
  Blinded:  { durationS: 2, maxStacks: 1, kind: 'flag', harmful: true },   // Eclipse Glare
  Veiled:   { durationS: 2, maxStacks: 1, kind: 'flag', harmful: true },   // Veil Hex (visual)
  Rooted:   { durationS: 1.5, maxStacks: 1, canCast: true, kind: 'control', harmful: true },
  Frozen:   { durationS: 1.0, maxStacks: 1, canCast: false, hard: true, kind: 'control', harmful: true },
  Stunned:  { durationS: 1.0, maxStacks: 1, canCast: false, hard: true, kind: 'control', harmful: true },
  // Self buffs -------------------------------------------------------------
  Haste:       { durationS: 6, maxStacks: 1, haste: 0.15, kind: 'buff' },
  Grounded:    { durationS: 15, maxStacks: 1, dmgReduction: 0.15, moveSlow: 0.15, kind: 'buff' },
  AetherSurge: { durationS: 6, maxStacks: 1, aetherPerS: 5, kind: 'buff' },
  Attunement:  { durationS: 6, maxStacks: 1, school: 'Ember', costMul: 0.85, kind: 'buff' },
  Phoenix:     { durationS: 15, maxStacks: 1, kind: 'buff' },
};

// Hard control that Tenacity guards against.
export const HARD_CONTROL = new Set(['Frozen', 'Stunned']);

// Harmful statuses Dispel can strip (order = Dispel removal priority).
export const DISPELLABLE = [
  'Frozen', 'Stunned', 'Rooted', 'Marked', 'Sundered', 'Weakened',
  'Burning', 'Chilled', 'Sloth', 'Soaked', 'Static', 'Blinded', 'Veiled',
];

// --- Environmental zones (MASTERPLAN §10, environment-matrix.md) ----------
// A wizard occupies a zone when |arcPos - zone.center| <= radius. Zones are
// shared: either player can exploit or be affected by any active zone.
export const ZONE = {
  maxPerPlayer: 2,        // §10 two active zones per player
  radius: 0.55,           // arc half-width a zone covers
  hourglassSlow: 0.25,    // Hourglass Field slows movement + projectiles 25%
  frozenSlow: 0.22,       // Frozen Ground slows movement while standing on it
  coverReduction: 0.5,    // Stone Wall cover reduces incoming projectile dmg
  coverHp: 26,
  durations: {
    Oil: 21, Wet: 21, Fog: 18, Frozen: 9, Snare: 24, Cover: 24,
    Hourglass: 18, Fire: 12, Gust: 1.8, Grounded: 3,
  },
};

// --- Environmental reaction rules (environment-matrix.md) ----------------
export const REACTION = {
  cooldownS: 1.0,          // same reaction cannot trigger more than once/sec
  maxLinks: 2,             // chains stop after two reaction links
  flashFireDamage: 10,     // Oil + Ember -> Flash Fire area damage
  quakeSlowS: 3.0,         // Wall + Quake rubble slow
  frozenGroundSlowS: 9,    // Wet + Frost -> Frozen Ground slow surface
};

// Deterministic reaction priority (environment-matrix.md). Lower = earlier
// when multiple reactions are legal in the same tick.
export const REACTION_PRIORITY = [
  'douse', 'ground', 'freeze', 'conduct', 'ignite', 'spread', 'cover',
];
