// spellVfx.test.js — visual profile coverage for the whole 40-spell roster.
//
// Pure/data-only: validates client/src/render/spellVfxProfiles.js without any
// Three.js/WebGL dependency, so it runs inside the standard `npm test` suite.
// It guarantees every spell has a distinct, well-formed visual identity and that
// the renderer's family dispatch will always find a profile.

import { createHarness } from './tiny.js';
import { SPELL_CATALOG, SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';
import { REACTIONS } from '../shared/src/sim/reactions.js';
import {
  SPELL_VFX, VFX_IDS, VFX_FAMILIES, VFX_SCHOOL_PALETTE, VFX_BUDGET_CAP,
  getSpellVfx, everySpellHasVfx, allVfxKinds, validateAllProfiles, isValidColor, vfxColorList,
  REACTION_VFX, REACTION_VFX_NAMES, REACTION_VFX_BUILDERS,
  getReactionVfx, allReactionVfxKinds, validateAllReactionVfx,
} from '../client/src/render/spellVfxProfiles.js';

const ALLOWED_TARGETS = new Set(['travel', 'self', 'enemy', 'link', 'zone']);
const REACTION_ANCHORS = new Set(['center', 'target', 'link']);

export function run() {
  const { ok, eq, report } = createHarness();

  // ---- 1. full coverage: every roster id 1..40 has a visual profile --------
  const rosterIds = SPELL_CATALOG.map((s) => s.id);
  eq(rosterIds.length, 40, 'roster has 40 spells');
  eq(VFX_IDS.length, 40, 'VFX profile table has 40 entries');
  ok(everySpellHasVfx(rosterIds), 'every roster spell has a visual profile');
  const missing = rosterIds.filter((id) => !getSpellVfx(id));
  ok(missing.length === 0, `no spell lacks a visual profile (missing: ${missing.join(',') || 'none'})`);
  // Coverage is exactly the roster (no stray/extra ids).
  eq(VFX_IDS.join(','), rosterIds.slice().sort((a, b) => a - b).join(','), 'VFX ids match the roster exactly');

  // ---- 2. structural validity (colors, budgets, required metadata) ---------
  const structErrs = validateAllProfiles();
  ok(structErrs.length === 0, `all profiles structurally valid (${structErrs.slice(0, 3).join(' | ') || 'ok'})`);

  // ---- 3. unique effect kind / silhouette metadata -------------------------
  const kinds = allVfxKinds();
  eq(new Set(kinds).size, 40, 'every spell has a UNIQUE effect kind (distinct silhouette identity)');
  // A healthy spread of builder families (not one generic look reused everywhere).
  const families = VFX_IDS.map((id) => SPELL_VFX[id].family);
  ok(new Set(families).size >= 30, `visual families are diverse (${new Set(families).size} distinct)`);
  // Every family is declared (renderer dispatch will resolve it).
  const undeclared = VFX_IDS.filter((id) => !VFX_FAMILIES.includes(SPELL_VFX[id].family));
  ok(undeclared.length === 0, `every family is declared in VFX_FAMILIES (${undeclared.join(',') || 'ok'})`);

  // ---- 4. per-spell field validity + school consistency with the catalog ---
  let colorsOk = true, schoolsOk = true, targetsOk = true, textOk = true, reducedOk = true, budgetOk = true;
  for (const id of VFX_IDS) {
    const p = SPELL_VFX[id];
    for (const col of vfxColorList(p)) if (!isValidColor(col)) colorsOk = false;
    if (p.school !== SPELLS_BY_ID[id].school) schoolsOk = false;
    if (!VFX_SCHOOL_PALETTE[p.school]) schoolsOk = false;
    if (!ALLOWED_TARGETS.has(p.target)) targetsOk = false;
    if (!p.silhouette || !p.motion || !p.windup) textOk = false;
    if (p.reducedSafe !== true) reducedOk = false;
    const b = p.budget || {};
    if (b.meshes > VFX_BUDGET_CAP.meshes || b.particles > VFX_BUDGET_CAP.particles || b.trail > VFX_BUDGET_CAP.trail) budgetOk = false;
  }
  ok(colorsOk, 'all profile colors are valid 24-bit ints');
  ok(schoolsOk, 'every profile school matches the spell catalog school');
  ok(targetsOk, 'every profile has a valid anchor target');
  ok(textOk, 'every profile has silhouette + motion + windup descriptors');
  ok(reducedOk, 'every profile is marked reduced-motion safe');
  ok(budgetOk, 'every profile stays within the per-effect object budget caps');

  // ---- 5. required visual-direction examples -------------------------------
  eq(getSpellVfx(6).kind, 'wave', 'Flame Wave (6) kind is "wave" (a wave, not a ball)');
  eq(getSpellVfx(6).family, 'wave', 'Flame Wave (6) uses the wave family');
  eq(getSpellVfx(5).kind, 'arcaneMissile', 'Arcane Missile (5) has a missile kind');
  eq(getSpellVfx(5).family, 'missile', 'Arcane Missile (5) uses the missile family');
  eq(getSpellVfx(7).kind, 'lightning', 'Chain Lightning (7) kind is "lightning"');
  eq(getSpellVfx(7).family, 'lightning', 'Chain Lightning (7) uses the lightning family');
  eq(getSpellVfx(8).family, 'fireball', 'Fireball (8) uses the fireball family');
  eq(getSpellVfx(9).family, 'comet', 'Ice Comet (9) uses the comet family');
  eq(getSpellVfx(40).family, 'beam', 'Prismatic Beam (40) uses the beam family');
  // Silhouettes for the headline spells are visibly NOT the old generic sphere.
  ok(getSpellVfx(6).silhouette !== 'orb' && getSpellVfx(7).silhouette !== 'orb',
    'headline spells do not fall back to the generic orb silhouette');

  // ---- 6. family -> role sanity (projectiles travel, zones anchor to ground)
  const projFamilies = new Set(['orb', 'spear', 'dart', 'spike', 'missile', 'wave', 'lightning', 'fireball', 'comet', 'airpulse', 'thunderring', 'quakewave']);
  let projTargetsOk = true, zoneTargetsOk = true;
  for (const id of VFX_IDS) {
    const p = SPELL_VFX[id];
    if (projFamilies.has(p.family) && p.target !== 'travel') projTargetsOk = false;
    if (p.family === 'zone' && p.target !== 'zone') zoneTargetsOk = false;
  }
  ok(projTargetsOk, 'all projectile families anchor to travel');
  ok(zoneTargetsOk, 'all zone families anchor to the ground zone');

  // ---- 7. environmental reaction VFX: full, distinct, valid coverage --------
  // Every reaction the sim can emit (shared/src/sim/reactions.js) must have a
  // data-driven visual signifier profile so the renderer can draw it.
  const reactionNames = REACTIONS.map((r) => r.name);
  eq(REACTION_VFX_NAMES.length, reactionNames.length, 'reaction VFX table covers every sim reaction');
  const missingReaction = reactionNames.filter((n) => !getReactionVfx(n));
  ok(missingReaction.length === 0, `no reaction lacks a VFX profile (missing: ${missingReaction.join(',') || 'none'})`);
  eq(REACTION_VFX_NAMES.slice().sort().join(','), reactionNames.slice().sort().join(','),
    'reaction VFX names match the sim reaction set exactly (no stray/extra)');

  const reactionErrs = validateAllReactionVfx(reactionNames);
  ok(reactionErrs.length === 0, `all reaction profiles structurally valid (${reactionErrs.slice(0, 3).join(' | ') || 'ok'})`);

  const rKinds = allReactionVfxKinds();
  eq(new Set(rKinds).size, reactionNames.length, 'every reaction has a UNIQUE effect kind (distinct signifier)');
  // A healthy spread of distinct builders (not one generic burst reused).
  ok(REACTION_VFX_BUILDERS.length >= 12, `reaction builders are diverse (${REACTION_VFX_BUILDERS.length} distinct)`);

  let rColorsOk = true, rSchoolsOk = true, rAnchorsOk = true, rTextOk = true, rReducedOk = true, rBudgetOk = true;
  for (const name of REACTION_VFX_NAMES) {
    const p = REACTION_VFX[name];
    for (const col of [p.colors.core, p.colors.glow, p.colors.trail]) if (!isValidColor(col)) rColorsOk = false;
    if (!VFX_SCHOOL_PALETTE[p.school]) rSchoolsOk = false;
    if (!REACTION_ANCHORS.has(p.anchor)) rAnchorsOk = false;
    if (!p.silhouette || !p.motion || !p.vfx || !p.kind) rTextOk = false;
    if (p.reducedSafe !== true) rReducedOk = false;
    const b = p.budget || {};
    if (b.meshes > VFX_BUDGET_CAP.meshes || b.particles > VFX_BUDGET_CAP.particles || b.trail > VFX_BUDGET_CAP.trail) rBudgetOk = false;
  }
  ok(rColorsOk, 'all reaction profile colors are valid 24-bit ints');
  ok(rSchoolsOk, 'every reaction profile uses a known school palette');
  ok(rAnchorsOk, 'every reaction profile has a valid world anchor');
  ok(rTextOk, 'every reaction profile has kind + vfx + silhouette + motion');
  ok(rReducedOk, 'every reaction profile is marked reduced-motion safe');
  ok(rBudgetOk, 'every reaction profile stays within the per-effect object budget caps');

  // ConductiveArc is the headline Storm reaction: an electric branching LINK
  // (its own lightning-style builder), NOT a generic burst.
  eq(getReactionVfx('ConductiveArc').kind, 'reaction:conductiveArc', 'ConductiveArc has its distinct lightning kind');
  eq(getReactionVfx('ConductiveArc').vfx, 'arc', 'ConductiveArc uses the dedicated arc (lightning) builder');
  eq(getReactionVfx('ConductiveArc').anchor, 'link', 'ConductiveArc links caster and target');
  eq(getReactionVfx('ConductiveArc').school, 'Storm', 'ConductiveArc reads as a Storm/electric reaction');
  // Fire reactions read as flame, water reactions as Tide, stone as Stone.
  eq(getReactionVfx('FlashFire').school, 'Ember', 'Flash Fire reads as an Ember eruption');
  eq(getReactionVfx('SpreadingFlame').vfx, 'flameSweep', 'Spreading Flame uses a sweeping-fire builder');
  eq(getReactionVfx('Spectrum').school, 'Prismatic', 'Spectrum reads as a Prismatic/multicolor reaction');
  // Distinct builders for the visually-grouped families (must not collapse).
  const airBuilders = new Set(['ClearedAir', 'BacklitFog', 'DriftingOil'].map((n) => getReactionVfx(n).vfx));
  eq(airBuilders.size, 3, 'ClearedAir / BacklitFog / DriftingOil each have a distinct identity');
  const stoneBuilders = new Set(['Rubble', 'FracturedCover'].map((n) => getReactionVfx(n).vfx));
  eq(stoneBuilders.size, 2, 'Rubble and Fractured Cover have distinct stone identities');

  return report('spellVfx');
}
