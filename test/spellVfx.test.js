// spellVfx.test.js — visual profile coverage for the whole 40-spell roster.
//
// Pure/data-only: validates client/src/render/spellVfxProfiles.js without any
// Three.js/WebGL dependency, so it runs inside the standard `npm test` suite.
// It guarantees every spell has a distinct, well-formed visual identity and that
// the renderer's family dispatch will always find a profile.

import { createHarness } from './tiny.js';
import { SPELL_CATALOG, SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';
import {
  SPELL_VFX, VFX_IDS, VFX_FAMILIES, VFX_SCHOOL_PALETTE, VFX_BUDGET_CAP,
  getSpellVfx, everySpellHasVfx, allVfxKinds, validateAllProfiles, isValidColor, vfxColorList,
} from '../client/src/render/spellVfxProfiles.js';

const ALLOWED_TARGETS = new Set(['travel', 'self', 'enemy', 'link', 'zone']);

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

  return report('spellVfx');
}
