// lab.test.js — Glyph Laboratory sandbox resources and target persistence.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { makeLoadout } from '../shared/src/balance/loadouts.js';
import { AETHER, MATCH, SIGIL, SIDESTEP } from '../shared/src/sim/constants.js';

export function run() {
  const { ok, eq, report } = createHarness();
  const publicIds = Array.from({ length: 36 }, (_, i) => i + 1);
  const sim = new Sim({
    seed: 77,
    loadouts: [makeLoadout(publicIds), makeLoadout([1])],
    rules: { timer: false, pressure: false, sandbox: true },
  });
  const player = sim.wizards[0];
  const target = sim.wizards[1];

  player.aether = 0;
  player.charges = 0;
  player.cooldowns[8] = 999;
  player.sidestepCharges = 0;
  target.health = 1;
  sim.step({ 0: { cast: 8, castQuality: 1 }, 1: {} }); // Fireball

  ok(player.casting && player.casting.spellId === 8,
    'Fireball starts in the lab despite empty resources and cooldown setup');
  eq(player.aether, AETHER.max, 'lab refills Aether before casting');
  eq(player.charges, SIGIL.max, 'lab refills Sigil Charges before casting');
  eq(player.sidestepCharges, SIDESTEP.charges, 'lab refills Sidestep charges');
  eq(target.health, MATCH.startHealth, 'lab target is restored before every tick');

  for (let i = 0; i < 240 && player.castsResolved < 1; i++) sim.step({ 0: {}, 1: {} });
  ok(player.castsResolved >= 1, 'charged public spell resolves normally in the lab sandbox');
  ok(!sim.ended, 'lab target remains available after taking damage');

  // Live-cooldown toggle: resources remain full, but a resolved spell cannot be
  // immediately recast until its cooldown expires.
  sim.setSandboxCooldowns(true);
  const before = player.castsResolved;
  sim.step({ 0: { cast: 1, castQuality: 1, castWasGesture: true }, 1: {} });
  for (let i = 0; i < 120 && player.castsResolved === before; i++) sim.step({ 0: {}, 1: {} });
  ok(player.cooldowns[1] > 0, 'lab cooldown toggle preserves the live Ember Bolt cooldown');
  const rejectedBefore = player.castsRejected;
  sim.step({ 0: { cast: 1, castQuality: 1, castWasGesture: true }, 1: {} });
  eq(player.castsRejected, rejectedBefore + 1, 'lab rejects an immediate recast while cooldowns are on');
  eq(player.aether, AETHER.max, 'lab still refills Aether while cooldowns are on');

  return report('lab');
}
