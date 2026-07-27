// gust.test.js — Gust Wall light-projectile deflection (SOLO-MODES-PLAN §9 L10).
//
// A fresh Gust Wall blows away a LIGHT projectile aimed at the caster; HEAVY
// projectiles (Stone Shard, the charged/area heavies) punch straight through.
// Deterministic events; the window expires so a late shot is not deflected.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { makeLoadout } from '../shared/src/balance/loadouts.js';
import { SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';
import { effectFor, isHeavyProjectile, isLightProjectile } from '../shared/src/sim/spellEffects.js';

// Cast a Gust Wall (player 0) then have the opponent fire `spellId` so it lands
// during the deflect window (mid-window ≈ tick 170). Returns whether it was
// deflected and whether the player took damage.
function scenario(spellId, { gustAt = 0, land = 170, steps = 460 } = {}) {
  const sim = new Sim({ seed: 7, loadouts: [makeLoadout([33]), makeLoadout([spellId])] });
  sim.wizards[1].charges = 3; sim.wizards[1].aether = 100; // afford any heavy
  const sp = SPELLS_BY_ID[spellId], eff = effectFor(spellId);
  const windup = Math.round(sp.min_cast_s * 60), travel = Math.round(eff.travelS * 60);
  const fireAt = Math.max(1, gustAt + land - windup - travel);
  let deflected = false, damaged = false;
  for (let i = 0; i < steps; i++) {
    const p0 = i === gustAt ? { cast: 33, castQuality: 1 } : {};
    const p1 = i === fireAt ? { cast: spellId, castQuality: 1 } : {};
    for (const e of sim.step({ 0: p0, 1: p1 })) {
      if (e.type === 'deflect' && e.by === 0) deflected = true;
      if (e.type === 'damage' && e.target === 0) damaged = true;
    }
  }
  return { deflected, damaged };
}

export function run() {
  const { ok, eq, report } = createHarness();

  // --- classification: derived from effect shape -------------------------
  const LIGHT = [1, 2, 3, 5, 28];        // small single-target bolts
  const HEAVY = [4, 6, 7, 8, 9, 30, 34]; // piercing / charged / area shots
  let classOk = true;
  for (const id of LIGHT) if (!isLightProjectile(effectFor(id)) || isHeavyProjectile(effectFor(id))) classOk = false;
  for (const id of HEAVY) if (!isHeavyProjectile(effectFor(id))) classOk = false;
  ok(classOk, 'light bolts classify light; piercing/charged/area shots classify heavy');

  // --- light projectiles are deflected -----------------------------------
  let lightOk = true;
  for (const id of LIGHT) {
    const r = scenario(id);
    if (!r.deflected || r.damaged) { lightOk = false; console.log('    light not deflected:', id, JSON.stringify(r)); }
  }
  ok(lightOk, 'a Gust Wall deflects every light projectile (no damage)');

  // --- heavy projectiles pass through ------------------------------------
  let heavyOk = true;
  for (const id of HEAVY) {
    const r = scenario(id);
    if (r.deflected || !r.damaged) { heavyOk = false; console.log('    heavy wrongly stopped:', id, JSON.stringify(r)); }
  }
  ok(heavyOk, 'heavy projectiles blow through a Gust Wall and deal damage');

  // --- the deflect window opens after windup and lasts 5.5 s -------------
  {
    const sim = new Sim({ seed: 1, loadouts: [makeLoadout([33]), makeLoadout([1])] });
    let opened = -1;
    for (let i = 0; i < 90; i++) {
      sim.step({ 0: i === 0 ? { cast: 33, castQuality: 1 } : {}, 1: {} });
      if (opened < 0 && sim.wizards[0].deflectTicks > 0) opened = i;
    }
    ok(opened > 0, 'the deflect window opens only after the Gust cast resolves (non-zero windup)');
    eq(sim.wizards[0].deflectTicks, Math.round(5.5 * 60) - (sim.tick - opened - 1), 'deflect window counts down from 5.5 s');
  }

  // --- a late shot (after the window) is NOT deflected --------------------
  {
    const r = scenario(1, { land: 410 }); // Gust window is ~[37,367]; land at ~410
    ok(!r.deflected && r.damaged, 'a light shot arriving after the Gust window expires is not deflected');
  }

  // --- determinism -------------------------------------------------------
  {
    const once = () => { const r = scenario(1); return `${r.deflected}:${r.damaged}`; };
    eq(once(), once(), 'deflection is deterministic for the same seed/timing');
  }

  return report('gust');
}
