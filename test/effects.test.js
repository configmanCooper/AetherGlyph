// effects.test.js — every roster spell has an executable, non-no-op effect,
// and each category produces the right kind of observable state change.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { spellWithGesture } from '../shared/src/balance/loadouts.js';
import { SPELL_CATALOG } from '../shared/src/balance/spellData.generated.js';
import { effectFor, everySpellHasEffect, categoryOf } from '../shared/src/sim/spellEffects.js';

// Cast one spell in isolation and report the observable deltas it produced.
function castIsolated(id, prime = {}) {
  const sim = new Sim({ seed: 3, loadouts: [[spellWithGesture(id)], [spellWithGesture(1)]] });
  const w = sim.wizards[0], o = sim.wizards[1];
  w.aether = 100; w.charges = 3; w.arcPos = 0; o.arcPos = 0;
  if (prime.selfStatus) sim.applyStatus(w, prime.selfStatus, prime.selfStacks || 1);
  if (prime.oppStatus) sim.applyStatus(o, prime.oppStatus, prime.oppStacks || 1);

  let dmg = false, oppStatus = false, zoneMade = false, minOppAether = o.aether, selfDef = false;
  const selfStatusStart = new Set(Object.keys(w.statuses));
  sim.step({ 0: { cast: id, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 200 && !sim.ended; t++) {
    sim.step({ 0: {}, 1: {} });
    if (o.health < 100 - 0.001) dmg = true;
    if (Object.keys(o.statuses).length > 0) oppStatus = true;
    if (sim.zones.length > 0) zoneMade = true;
    if (w.shield || w.barrier || w.reflectTicks > 0 || w.mirrorTicks > 0 || w.evadeTicks > 0 || w.channel) selfDef = true;
    minOppAether = Math.min(minOppAether, o.aether);
  }
  const selfBuff = ['Haste', 'Grounded', 'AetherSurge', 'Attunement', 'Phoenix']
    .some((n) => sim.hasStatus(w, n) || selfStatusStart.has(n));
  const drained = minOppAether < 59;
  const blinkMoved = Math.abs(w.arcPos) > 0.01;
  const dispelled = prime.selfStatus && !sim.hasStatus(w, prime.selfStatus);
  return { dmg, oppStatus, zoneMade, selfDef, selfBuff, drained, blinkMoved, dispelled, sim, w, o };
}

// Priming so conditional / cleanse spells demonstrate an effect.
const PRIME = {
  13: { selfStatus: 'Chilled' },   // Dispel removes it
  27: { oppStatus: 'Chilled' },    // Frost Bind freezes a chilled target
  7:  { oppStatus: 'Soaked' },     // Chain Lightning stun
  30: { oppStatus: 'Soaked' },     // Thunderclap stun
};

export function run() {
  const { ok, eq, report } = createHarness();

  // Phase 2 invariant: every roster id has an authored effect.
  eq(everySpellHasEffect(SPELL_CATALOG.map((s) => s.id)), true, 'all 40 spells have an authored effect');

  // Every spell resolves to at least one observable effect (no silent no-ops).
  let noops = [];
  for (const spell of SPELL_CATALOG) {
    const r = castIsolated(spell.id, PRIME[spell.id] || {});
    const seen = r.dmg || r.oppStatus || r.zoneMade || r.selfDef || r.selfBuff || r.drained || r.blinkMoved || r.dispelled;
    if (!seen) noops.push(`${spell.id} ${spell.name}`);
  }
  ok(noops.length === 0, `no silent no-op spells (${noops.join('; ') || 'all effective'})`);

  // Category-representative behaviour.
  ok(castIsolated(1).dmg, 'Ember Bolt (offense) deals damage');
  ok(castIsolated(21).oppStatus, 'Weaken (debuff) applies a status to the opponent');
  ok(castIsolated(16).selfBuff, 'Haste (buff) applies a self buff');
  ok(castIsolated(10).selfDef, 'Ward (defense) raises a shield');
  ok(castIsolated(31).zoneMade, 'Oil Script (environmental) creates a zone');
  ok(castIsolated(24).drained, 'Aether Leech drains opponent Aether');
  ok(castIsolated(14).blinkMoved, 'Blink relocates the caster');
  ok(castIsolated(13, { selfStatus: 'Chilled' }).dispelled, 'Dispel strips a harmful status');

  // Control: Entangle roots, Frost Bind freezes only when Chilled.
  ok(castIsolated(26).oppStatus, 'Entangle roots the opponent');
  const fb = castIsolated(27, { oppStatus: 'Chilled' });
  ok(fb.oppStatus, 'Frost Bind freezes a Chilled target');
  const fbNo = castIsolated(27, {});
  ok(!fbNo.oppStatus, 'Frost Bind fizzles with no Chilled setup (no free hard control)');

  // Every offense-category spell actually deals damage on a still target.
  let offenseDmg = true;
  for (const spell of SPELL_CATALOG) {
    if (categoryOf(effectFor(spell.id)) !== 'offense') continue;
    if (!castIsolated(spell.id).dmg) offenseDmg = false;
  }
  ok(offenseDmg, 'every offense spell deals damage');

  return report('effects');
}
