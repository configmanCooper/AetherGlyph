// secret.test.js — the four secret spells work, are gated/countered, and are
// no stronger-by-default (capped like everything else).

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { spellWithGesture } from '../shared/src/balance/loadouts.js';
import { SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';
import { effectFor } from '../shared/src/sim/spellEffects.js';
import { TICK_HZ, ZONE, MOVE } from '../shared/src/sim/constants.js';

function mk(ids0, ids1 = [1]) {
  const sim = new Sim({ seed: 8, loadouts: [ids0.map(spellWithGesture), ids1.map(spellWithGesture)] });
  sim.wizards[0].arcPos = 0; sim.wizards[1].arcPos = 0;
  sim.wizards[0].aether = 100; sim.wizards[0].charges = 3;
  sim.wizards[1].aether = 100; sim.wizards[1].charges = 3;
  return sim;
}
function resolveCastOf(sim, id, who = 0, ticks = 200) {
  const other = who === 0 ? 1 : 0;
  sim.step({ [who]: { cast: id, castQuality: 1 }, [other]: {} });
  const evs = [];
  for (let t = 0; t < ticks && !sim.ended; t++) for (const e of sim.step({ 0: {}, 1: {} })) evs.push(e);
  return evs;
}

export function run() {
  const { ok, eq, near, report } = createHarness();

  // All four secrets exist, are flagged secret, and have executable effects.
  for (const id of [37, 38, 39, 40]) {
    ok(SPELLS_BY_ID[id].secret === true, `${SPELLS_BY_ID[id].name} is flagged secret`);
    ok(!!effectFor(id), `${SPELLS_BY_ID[id].name} has an authored effect`);
  }

  // Mirror Twin (37): a decoy eats the first non-area projectile aimed at caster.
  let sim = mk([37], [1]);
  resolveCastOf(sim, 37, 0, 90);       // caster raises a decoy
  ok(sim.wizards[0].mirrorTicks > 0, 'Mirror Twin puts up a decoy');
  const hpBefore = sim.wizards[0].health;
  resolveCastOf(sim, 1, 1, 60);        // opponent fires Ember Bolt at the caster
  eq(sim.wizards[0].health, hpBefore, 'decoy soaks the first shot (no damage)');
  ok(sim.wizards[0].mirrorTicks === 0, 'decoy is consumed after eating a shot');

  // Hourglass Field (38): slows only hostile projectiles by 75%.
  sim = mk([38, 1], [1]);
  resolveCastOf(sim, 38, 0, 90);
  ok(sim.zonesOfKind('Hourglass').length >= 1 && sim.hourglassActive(), 'Hourglass Field creates a slowing zone');
  const start0 = sim.wizards[0].arcPos;
  const start1 = sim.wizards[1].arcPos;
  sim.step({ 0: { move: 1 }, 1: { move: 1 } });
  near(sim.wizards[0].arcPos - start0, MOVE.speedPerS / TICK_HZ, 1e-9,
    'Hourglass does not slow its caster movement');
  near(sim.wizards[1].arcPos - start1, MOVE.speedPerS / TICK_HZ, 1e-9,
    'Hourglass does not slow enemy movement');

  const ember = effectFor(1);
  sim.projectiles = [
    {
      id: 1001, owner: 0, spellId: 1, eff: ember, ticks: 100, totalTicks: 100,
      quality: 1, originPos: -0.5, targetPos: 0.5,
    },
    {
      id: 1002, owner: 1, spellId: 1, eff: ember, ticks: 100, totalTicks: 100,
      quality: 1, originPos: 0.5, targetPos: -0.5,
    },
  ];
  sim.advanceProjectiles();
  near(sim.projectiles.find((p) => p.owner === 0).ticks, 99, 1e-9,
    'Hourglass leaves the caster projectile at full speed');
  near(sim.projectiles.find((p) => p.owner === 1).ticks, 99.75, 1e-9,
    'Hourglass reduces enemy projectile speed by 75%');

  function trackedTarget(withHourglass) {
    const trackingSim = mk([38], [5]);
    trackingSim.wizards[0].arcPos = 1;
    trackingSim.wizards[1].arcPos = 0;
    if (withHourglass) trackingSim.addZone(0, 'Hourglass', { durationS: 18 });
    trackingSim.projectiles = [{
      id: 2001, owner: 1, spellId: 5, eff: effectFor(5), ticks: 100, totalTicks: 100,
      quality: 1, originPos: 0, targetPos: 0,
    }];
    const advances = withHourglass ? 396 : 99;
    for (let i = 0; i < advances; i++) trackingSim.advanceProjectiles();
    return trackingSim.projectiles[0].targetPos;
  }
  const normalTracking = trackedTarget(false);
  const hourglassTracking = trackedTarget(true);
  ok(normalTracking < 0.3, 'homing projectiles make only a slight in-flight correction');
  near(hourglassTracking, normalTracking, 0.001,
    'Hourglass does not grant a homing projectile extra tracking time');

  sim = mk([38], [5]);
  sim.addZone(0, 'Hourglass', { durationS: 18 });
  sim.projectiles = [{
    id: 2002, owner: 1, spellId: 5, eff: effectFor(5), ticks: 33, totalTicks: 33,
    quality: 1, originPos: 0, targetPos: 0,
  }];
  const dodgeHp = sim.wizards[0].health;
  const dodgeEvents = [];
  dodgeEvents.push(...sim.step({ 0: { sidestep: 1 }, 1: {} }));
  dodgeEvents.push(...sim.step({ 0: { sidestep: 1 }, 1: {} }));
  for (let i = 0; i < 140 && sim.projectiles.length; i++) {
    dodgeEvents.push(...sim.step({ 0: {}, 1: {} }));
  }
  ok(dodgeEvents.some((event) => event.type === 'miss' && event.spellId === 5),
    'two Dodges evade an Hourglass-slowed homing projectile');
  eq(sim.wizards[0].health, dodgeHp,
    'Hourglass-slowed homing projectile deals no damage after two Dodges');

  // Phoenix Covenant (39): a lethal hit leaves the caster at 1 health, once.
  sim = mk([39], [1]);
  resolveCastOf(sim, 39, 0, 90);
  ok(sim.hasStatus(sim.wizards[0], 'Phoenix'), 'Phoenix aura is active');
  sim.wizards[0].health = 20;
  const saved = sim.dealDamage(sim.wizards[1], sim.wizards[0], 100, { source: 'Test', ignoreCap: true });
  eq(sim.wizards[0].health, 1, 'Phoenix leaves the caster at 1 health on a lethal hit');
  ok(sim.wizards[0].phoenixUsed, 'Phoenix save consumed');
  // A second lethal hit is NOT prevented (once per round).
  sim.dealDamage(sim.wizards[1], sim.wizards[0], 100, { source: 'Test', ignoreCap: true });
  eq(sim.wizards[0].health, 0, 'Phoenix does not save a second time in the round');

  // Prismatic Beam (40): channels damage capped at 28; interruptible.
  sim = mk([40], [1]);
  const hp = sim.wizards[1].health;
  resolveCastOf(sim, 40, 0, 220);
  const dealt = hp - sim.wizards[1].health;
  ok(dealt > 0, 'Prismatic Beam deals channel damage');
  ok(dealt <= 28.001, 'Prismatic Beam total damage is capped at 28');

  // Prismatic Beam is interruptible mid-channel (counter: Interrupt).
  sim = mk([40], [28]); // opponent has Concussive Blast (interrupt)
  sim.step({ 0: { cast: 40, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 90 && !sim.wizards[0].channel && !sim.ended; t++) sim.step({ 0: {}, 1: {} });
  ok(sim.wizards[0].channel, 'Prismatic channel is active');
  // Fire the interrupt.
  sim.step({ 0: {}, 1: { cast: 28, castQuality: 1 } });
  for (let t = 0; t < 120 && sim.wizards[0].channel; t++) sim.step({ 0: {}, 1: {} });
  ok(!sim.wizards[0].channel, 'Concussive Blast interrupts the Prismatic channel');

  // Secret spells are not stronger-by-default: no single resolved hit > 30.
  ok(effectFor(40).totalDamage <= 30 && effectFor(39).damage == null, 'secrets obey the damage caps');

  return report('secret');
}
