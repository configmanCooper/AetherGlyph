// spellVfxProfiles.js — data-driven visual identity for every spell (ids 1-40).
//
// PURE DATA + validators. This module has NO Three.js / DOM dependency so it can
// be imported directly by Node tests (test/spellVfx.test.js) AND by the browser
// renderer (spellVfx.js). It answers a single question for the VFX system:
// "what does spell N look like?" — never how the sim behaves.
//
// Each profile carries:
//   kind        UNIQUE per spell — the readable identity used by tests + the dev
//               gallery hook. Guarantees no two spells share a silhouette label.
//   family      which renderer builder draws it (many spells share a builder,
//               parameterised by colors/motion). Kept in sync via VFX_FAMILIES.
//   school      MUST equal the catalog school (cross-checked in tests).
//   role        broad effect class: projectile | shield | barrier | beam | zone
//               | reflect | dispel | blink | buff | hex | control | secret.
//   target      where the effect anchors: travel | self | enemy | link | zone.
//   colors      { core, glow, trail } 24-bit ints (validated in-range).
//   silhouette  short shape word (non-empty).
//   motion      short motion descriptor (non-empty).
//   windup      cast-cue style keyword (drives the pre-release tell).
//   budget      { meshes, particles, trail } worst-case object counts (capped).
//   reducedSafe every profile must degrade to a static, readable form.
//
// Palettes stay school-consistent for readability; uniqueness comes from the
// silhouette + motion, not from wild recoloring.

export const VFX_BUDGET_CAP = Object.freeze({ meshes: 26, particles: 72, trail: 24 });

// School palettes (core = hot inner, glow = signature mid, trail = deep tail).
export const VFX_SCHOOL_PALETTE = Object.freeze({
  Ember:     { core: 0xffe0a3, glow: 0xff6a3d, trail: 0xb3260a, accent: 0xffb347 },
  Tide:      { core: 0xdff4ff, glow: 0x54c8ff, trail: 0x1f6fb0, accent: 0x9fe6ff },
  Storm:     { core: 0xfff7c0, glow: 0xffe14d, trail: 0xc9a400, accent: 0xfff59a },
  Stone:     { core: 0xd8c19a, glow: 0xb08a5a, trail: 0x6a4e2e, accent: 0x8f7a52 },
  Gale:      { core: 0xeafff8, glow: 0x9be8d8, trail: 0x4fb9a3, accent: 0xc7f5ea },
  Arcane:    { core: 0xe6d2ff, glow: 0xb98bff, trail: 0x6a3fb0, accent: 0xd4b3ff },
  Umbra:     { core: 0x9a86c4, glow: 0x7a6f99, trail: 0x241d38, accent: 0xb39ddb },
  Prismatic: { core: 0xffffff, glow: 0xff66cc, trail: 0x66ffff, accent: 0xffe066 },
});

// Every family a profile may reference MUST have a builder in spellVfx.js. The
// renderer imports this set and asserts full coverage at module load.
export const VFX_FAMILIES = Object.freeze([
  // projectiles
  'orb', 'spear', 'dart', 'spike', 'missile', 'wave', 'lightning', 'fireball',
  'comet', 'airpulse', 'thunderring', 'quakewave',
  // stateful defensive / channel
  'ward', 'dome', 'beam',
  // environmental zones (dispatched further by zone kind)
  'zone',
  // instant self / enemy / link releases
  'reflect', 'dispel', 'blink', 'haste', 'surge', 'mark', 'attunement',
  'grounding', 'weaken', 'sunder', 'sloth', 'leech', 'veil', 'entangle',
  'frostbind', 'eclipse', 'mirror', 'phoenix',
]);

const P = VFX_SCHOOL_PALETTE;

// Convenience for per-spell color triples pulled from the school palette.
function pal(school, over = {}) {
  const base = P[school];
  return { core: over.core ?? base.core, glow: over.glow ?? base.glow, trail: over.trail ?? base.trail };
}

export const SPELL_VFX = Object.freeze({
  // === Offensive projectiles ==============================================
  1: { kind: 'emberBolt', family: 'orb', school: 'Ember', role: 'projectile', target: 'travel',
    silhouette: 'orb', motion: 'flaming orb with an ember tail', windup: 'ember-gather',
    colors: pal('Ember'), budget: { meshes: 3, particles: 10, trail: 12 }, reducedSafe: true },
  2: { kind: 'frostLance', family: 'spear', school: 'Tide', role: 'projectile', target: 'travel',
    silhouette: 'spear', motion: 'long crystalline ice spear with a cold trail', windup: 'frost-shards',
    colors: pal('Tide'), budget: { meshes: 4, particles: 8, trail: 14 }, reducedSafe: true },
  3: { kind: 'sparkDart', family: 'dart', school: 'Storm', role: 'projectile', target: 'travel',
    silhouette: 'dart', motion: 'jagged electric dart with a short branching arc', windup: 'spark-crackle',
    colors: pal('Storm'), budget: { meshes: 4, particles: 6, trail: 10 }, reducedSafe: true },
  4: { kind: 'stoneShard', family: 'spike', school: 'Stone', role: 'projectile', target: 'travel',
    silhouette: 'spike', motion: 'rotating angular rock spike', windup: 'stone-rise',
    colors: pal('Stone'), budget: { meshes: 3, particles: 8, trail: 8 }, reducedSafe: true },
  5: { kind: 'arcaneMissile', family: 'missile', school: 'Arcane', role: 'projectile', target: 'travel',
    silhouette: 'rocket', motion: 'pointed magic missile with a ringed arcane trail', windup: 'arcane-converge',
    colors: pal('Arcane'), budget: { meshes: 5, particles: 10, trail: 16 }, reducedSafe: true },
  6: { kind: 'wave', family: 'wave', school: 'Ember', role: 'projectile', target: 'travel',
    silhouette: 'wall', motion: 'broad traveling curved wall/cone of flame', windup: 'ember-sweep',
    colors: pal('Ember'), budget: { meshes: 8, particles: 24, trail: 0 }, reducedSafe: true },
  7: { kind: 'lightning', family: 'lightning', school: 'Storm', role: 'projectile', target: 'travel',
    silhouette: 'bolt', motion: 'animated branching lightning between caster and target', windup: 'spark-crackle',
    colors: pal('Storm'), budget: { meshes: 6, particles: 12, trail: 0 }, reducedSafe: true },
  8: { kind: 'fireball', family: 'fireball', school: 'Ember', role: 'projectile', target: 'travel',
    silhouette: 'turbulent-core', motion: 'turbulent fire core in an outer flame shell with smoke/ember trail',
    windup: 'ember-gather', colors: pal('Ember'), budget: { meshes: 6, particles: 28, trail: 18 }, reducedSafe: true },
  9: { kind: 'comet', family: 'comet', school: 'Tide', role: 'projectile', target: 'travel',
    silhouette: 'faceted-body', motion: 'large faceted ice body with a frosty comet tail', windup: 'frost-shards',
    colors: pal('Tide'), budget: { meshes: 6, particles: 22, trail: 20 }, reducedSafe: true },

  // === Defensive ==========================================================
  10: { kind: 'ward', family: 'ward', school: 'Arcane', role: 'shield', target: 'self',
    silhouette: 'rune-disc', motion: 'frontal hexagonal rune shield', windup: 'arcane-converge',
    colors: pal('Arcane'), budget: { meshes: 6, particles: 0, trail: 0 }, reducedSafe: true },
  11: { kind: 'barrierDome', family: 'dome', school: 'Arcane', role: 'barrier', target: 'self',
    silhouette: 'dome', motion: 'layered spherical arcane dome with orbiting rings', windup: 'arcane-converge',
    colors: pal('Arcane'), budget: { meshes: 7, particles: 0, trail: 0 }, reducedSafe: true },
  12: { kind: 'reflect', family: 'reflect', school: 'Gale', role: 'reflect', target: 'self',
    silhouette: 'mirror-plane', motion: 'sharp mirrored flash / rune plane', windup: 'gale-flick',
    colors: pal('Gale'), budget: { meshes: 4, particles: 6, trail: 0 }, reducedSafe: true },
  13: { kind: 'dispel', family: 'dispel', school: 'Arcane', role: 'dispel', target: 'self',
    silhouette: 'cleanse-ring', motion: 'counterclockwise cleansing ring burst', windup: 'arcane-converge',
    colors: pal('Arcane'), budget: { meshes: 4, particles: 14, trail: 0 }, reducedSafe: true },
  14: { kind: 'blink', family: 'blink', school: 'Arcane', role: 'blink', target: 'self',
    silhouette: 'afterimage', motion: 'afterimage streak between origin and destination', windup: 'arcane-flick',
    colors: pal('Arcane'), budget: { meshes: 5, particles: 8, trail: 0 }, reducedSafe: true },
  15: { kind: 'stoneWall', family: 'zone', school: 'Stone', role: 'zone', target: 'zone',
    silhouette: 'stone-columns', motion: 'jagged destructible stone wall of columns', windup: 'stone-rise',
    colors: pal('Stone'), budget: { meshes: 8, particles: 0, trail: 0 }, reducedSafe: true },

  // === Buffs ==============================================================
  16: { kind: 'haste', family: 'haste', school: 'Gale', role: 'buff', target: 'self',
    silhouette: 'wind-streaks', motion: 'wind streaks spiraling around the caster', windup: 'gale-flick',
    colors: pal('Gale'), budget: { meshes: 6, particles: 16, trail: 0 }, reducedSafe: true },
  17: { kind: 'aetherSurge', family: 'surge', school: 'Arcane', role: 'buff', target: 'self',
    silhouette: 'ribbon-eight', motion: 'rising figure-eight arcane energy ribbons', windup: 'arcane-converge',
    colors: pal('Arcane'), budget: { meshes: 6, particles: 18, trail: 0 }, reducedSafe: true },
  18: { kind: 'amplifyMark', family: 'mark', school: 'Arcane', role: 'hex', target: 'enemy',
    silhouette: 'target-rune', motion: 'target-mark rune hovering over the opponent', windup: 'arcane-loop',
    colors: pal('Arcane'), budget: { meshes: 4, particles: 6, trail: 0 }, reducedSafe: true },
  19: { kind: 'emberAttunement', family: 'attunement', school: 'Ember', role: 'buff', target: 'self',
    silhouette: 'flame-sigils', motion: 'orbiting flame sigils around the caster', windup: 'ember-gather',
    colors: pal('Ember'), budget: { meshes: 6, particles: 12, trail: 0 }, reducedSafe: true },
  20: { kind: 'groundingMantle', family: 'grounding', school: 'Stone', role: 'buff', target: 'self',
    silhouette: 'stone-plates', motion: 'stone/metal plates with grounding lines', windup: 'stone-rise',
    colors: pal('Stone'), budget: { meshes: 8, particles: 6, trail: 0 }, reducedSafe: true },

  // === Debuffs ============================================================
  21: { kind: 'weaken', family: 'weaken', school: 'Umbra', role: 'hex', target: 'enemy',
    silhouette: 'drooping-arc', motion: 'drooping dark arc / sagging aura', windup: 'umbra-sink',
    colors: pal('Umbra', { core: 0xb39ddb }), budget: { meshes: 4, particles: 10, trail: 0 }, reducedSafe: true },
  22: { kind: 'sunder', family: 'sunder', school: 'Stone', role: 'hex', target: 'enemy',
    silhouette: 'cracked-x', motion: 'cracked-X fracture bursting on the target', windup: 'stone-rise',
    colors: pal('Stone', { glow: 0xd85a2a }), budget: { meshes: 5, particles: 12, trail: 0 }, reducedSafe: true },
  23: { kind: 'slothHex', family: 'sloth', school: 'Umbra', role: 'hex', target: 'enemy',
    silhouette: 'clock-spiral', motion: 'slow dark spiral of clock motes', windup: 'umbra-sink',
    colors: pal('Umbra', { core: 0xb39ddb }), budget: { meshes: 4, particles: 14, trail: 0 }, reducedSafe: true },
  24: { kind: 'aetherLeech', family: 'leech', school: 'Umbra', role: 'hex', target: 'link',
    silhouette: 'siphon-ribbon', motion: 'siphon ribbon pulling from target to caster', windup: 'umbra-hook',
    colors: pal('Umbra', { core: 0xc39bff, glow: 0x9a6bd8 }), budget: { meshes: 4, particles: 16, trail: 0 }, reducedSafe: true },
  25: { kind: 'veilHex', family: 'veil', school: 'Umbra', role: 'hex', target: 'enemy',
    silhouette: 'knot', motion: 'knot-like purple distortion around the target', windup: 'umbra-knot',
    colors: pal('Umbra', { core: 0xc39bff, glow: 0x8a5fd0 }), budget: { meshes: 5, particles: 8, trail: 0 }, reducedSafe: true },

  // === Control ============================================================
  26: { kind: 'entangle', family: 'entangle', school: 'Stone', role: 'control', target: 'enemy',
    silhouette: 'roots', motion: 'roots and vines rising around the target', windup: 'stone-rise',
    colors: pal('Stone', { glow: 0x6f8f3a, core: 0x9fbf5a }), budget: { meshes: 8, particles: 8, trail: 0 }, reducedSafe: true },
  27: { kind: 'frostBind', family: 'frostbind', school: 'Tide', role: 'control', target: 'enemy',
    silhouette: 'shackles', motion: 'icy shackle rings snapping shut', windup: 'frost-shards',
    colors: pal('Tide'), budget: { meshes: 6, particles: 10, trail: 0 }, reducedSafe: true },
  28: { kind: 'concussiveBlast', family: 'airpulse', school: 'Gale', role: 'projectile', target: 'travel',
    silhouette: 'air-ring', motion: 'compressed air shockwave disc', windup: 'gale-flick',
    colors: pal('Gale'), budget: { meshes: 4, particles: 8, trail: 6 }, reducedSafe: true },
  29: { kind: 'eclipseGlare', family: 'eclipse', school: 'Umbra', role: 'control', target: 'enemy',
    silhouette: 'eclipse-halo', motion: 'dark starburst with an eclipse halo', windup: 'umbra-sink',
    colors: pal('Umbra', { core: 0x1a1526, glow: 0xb39ddb }), budget: { meshes: 6, particles: 14, trail: 0 }, reducedSafe: true },
  30: { kind: 'thunderclap', family: 'thunderring', school: 'Storm', role: 'projectile', target: 'travel',
    silhouette: 'clap-ring', motion: 'radial lightning clap / shock ring', windup: 'spark-crackle',
    colors: pal('Storm'), budget: { meshes: 6, particles: 14, trail: 4 }, reducedSafe: true },

  // === Environmental ======================================================
  31: { kind: 'oilScript', family: 'zone', school: 'Ember', role: 'zone', target: 'zone',
    silhouette: 'puddle', motion: 'glossy dark puddle with an iridescent edge', windup: 'ember-sweep',
    colors: pal('Ember', { core: 0x2a2a1a, glow: 0x6a5a3a, trail: 0x120f08 }), budget: { meshes: 5, particles: 0, trail: 0 }, reducedSafe: true },
  32: { kind: 'rainGlyph', family: 'zone', school: 'Tide', role: 'zone', target: 'zone',
    silhouette: 'rain-shafts', motion: 'vertical rain shafts and splash ripples over a Wet zone', windup: 'tide-cloud',
    colors: pal('Tide', { core: 0x9fdcff, glow: 0x2f6fa8, trail: 0x184a78 }), budget: { meshes: 8, particles: 28, trail: 0 }, reducedSafe: true },
  33: { kind: 'gustWall', family: 'zone', school: 'Gale', role: 'zone', target: 'zone',
    silhouette: 'wind-wall', motion: 'curved translucent wind wall that sweeps across with streaks', windup: 'gale-flick',
    colors: pal('Gale'), budget: { meshes: 8, particles: 12, trail: 0 }, reducedSafe: true },
  34: { kind: 'quake', family: 'quakewave', school: 'Stone', role: 'projectile', target: 'travel',
    silhouette: 'fracture', motion: 'ground fracture lines with a rock burst', windup: 'stone-slam',
    colors: pal('Stone'), budget: { meshes: 8, particles: 20, trail: 0 }, reducedSafe: true },
  35: { kind: 'fogCloud', family: 'zone', school: 'Gale', role: 'zone', target: 'zone',
    silhouette: 'fog-bank', motion: 'dense drifting fog bank of layered puffs', windup: 'gale-swirl',
    colors: pal('Gale', { core: 0x8a93a6, glow: 0xaab3c6, trail: 0x5a6070 }), budget: { meshes: 7, particles: 0, trail: 0 }, reducedSafe: true },
  36: { kind: 'runeSnare', family: 'zone', school: 'Arcane', role: 'zone', target: 'zone',
    silhouette: 'trap-glyph', motion: 'luminous triangular trap glyph', windup: 'arcane-loop',
    colors: pal('Arcane'), budget: { meshes: 5, particles: 6, trail: 0 }, reducedSafe: true },

  // === Secret =============================================================
  37: { kind: 'mirrorTwin', family: 'mirror', school: 'Arcane', role: 'secret', target: 'self',
    silhouette: 'decoy', motion: 'translucent wizard decoy / afterimage', windup: 'arcane-loop',
    colors: pal('Arcane'), budget: { meshes: 6, particles: 4, trail: 0 }, reducedSafe: true },
  38: { kind: 'hourglassField', family: 'zone', school: 'Arcane', role: 'zone', target: 'zone',
    silhouette: 'hourglass', motion: 'rotating hourglass and rings with slowed motes', windup: 'arcane-converge',
    colors: pal('Arcane', { core: 0xd8b24a, glow: 0xe8c766, trail: 0x8a6a1a }), budget: { meshes: 8, particles: 18, trail: 0 }, reducedSafe: true },
  39: { kind: 'phoenixCovenant', family: 'phoenix', school: 'Ember', role: 'secret', target: 'self',
    silhouette: 'phoenix-wings', motion: 'phoenix-wing flame aura enveloping the caster', windup: 'ember-gather',
    colors: pal('Ember', { core: 0xffd27a, glow: 0xff7a1a }), budget: { meshes: 8, particles: 26, trail: 0 }, reducedSafe: true },
  40: { kind: 'prismaticBeam', family: 'beam', school: 'Prismatic', role: 'beam', target: 'self',
    silhouette: 'spectral-beam', motion: 'continuous multicolor beam with concentric spectral rings',
    windup: 'prismatic-charge', colors: pal('Prismatic'), budget: { meshes: 10, particles: 24, trail: 0 }, reducedSafe: true },
});

export const VFX_IDS = Object.freeze(Object.keys(SPELL_VFX).map(Number).sort((a, b) => a - b));

export function getSpellVfx(id) { return SPELL_VFX[id] || null; }
export function hasVfxProfile(id) { return !!SPELL_VFX[id]; }
export function everySpellHasVfx(ids) { return ids.every((id) => !!SPELL_VFX[id]); }
export function allVfxKinds() { return VFX_IDS.map((id) => SPELL_VFX[id].kind); }
export function vfxColorList(p) { return p ? [p.colors.core, p.colors.glow, p.colors.trail] : []; }

// A color is a valid 24-bit int.
export function isValidColor(c) { return Number.isInteger(c) && c >= 0 && c <= 0xffffff; }

// Structural validation of a single profile (used by tests + a load-time guard).
export function validateProfile(id) {
  const p = SPELL_VFX[id];
  const errs = [];
  if (!p) { return [`spell ${id}: missing VFX profile`]; }
  if (!p.kind) errs.push(`spell ${id}: missing kind`);
  if (!VFX_FAMILIES.includes(p.family)) errs.push(`spell ${id}: unknown family "${p.family}"`);
  if (!VFX_SCHOOL_PALETTE[p.school]) errs.push(`spell ${id}: unknown school "${p.school}"`);
  if (!p.silhouette) errs.push(`spell ${id}: missing silhouette`);
  if (!p.motion) errs.push(`spell ${id}: missing motion`);
  if (!p.windup) errs.push(`spell ${id}: missing windup`);
  for (const key of ['core', 'glow', 'trail']) {
    if (!isValidColor(p.colors?.[key])) errs.push(`spell ${id}: invalid color ${key}=${p.colors?.[key]}`);
  }
  const b = p.budget || {};
  if (!(b.meshes >= 0 && b.meshes <= VFX_BUDGET_CAP.meshes)) errs.push(`spell ${id}: mesh budget ${b.meshes} over cap`);
  if (!(b.particles >= 0 && b.particles <= VFX_BUDGET_CAP.particles)) errs.push(`spell ${id}: particle budget ${b.particles} over cap`);
  if (!(b.trail >= 0 && b.trail <= VFX_BUDGET_CAP.trail)) errs.push(`spell ${id}: trail budget ${b.trail} over cap`);
  if (p.reducedSafe !== true) errs.push(`spell ${id}: not marked reducedSafe`);
  return errs;
}

export function validateAllProfiles() {
  const errs = [];
  for (const id of VFX_IDS) errs.push(...validateProfile(id));
  const kinds = allVfxKinds();
  if (new Set(kinds).size !== kinds.length) errs.push('duplicate kind across profiles');
  return errs;
}
