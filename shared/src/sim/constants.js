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
export const STATUSES = {
  Burning:  { durationS: 3, maxStacks: 2, dps: 2, kind: 'dot' },
  Chilled:  { durationS: 3, maxStacks: 1, slow: 0.18, kind: 'slow' },
  Soaked:   { durationS: 4, maxStacks: 1, lightningBonus: 0.25, kind: 'flag' },
  Static:   { durationS: 3, maxStacks: 3, kind: 'flag' },
  Sundered: { durationS: 4, maxStacks: 1, damageTaken: 0.20, kind: 'amp' },
  Weakened: { durationS: 4, maxStacks: 1, damageDealt: 0.22, kind: 'amp' },
  Marked:   { durationS: 5, maxStacks: 1, markBonus: 0.35, kind: 'flag' },
  Rooted:   { durationS: 1.5, maxStacks: 1, canCast: true, kind: 'control' },
  Frozen:   { durationS: 1.0, maxStacks: 1, canCast: false, hard: true, kind: 'control' },
  Stunned:  { durationS: 1.0, maxStacks: 1, canCast: false, hard: true, kind: 'control' },
};

// Hard control that Tenacity guards against.
export const HARD_CONTROL = new Set(['Frozen', 'Stunned']);
