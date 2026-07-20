// casting.test.js — projectile resolution, damage, shields, reflect, counters.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { starterLoadout } from '../shared/src/balance/loadouts.js';
import { effectFor } from '../shared/src/sim/spellEffects.js';
import { TICK_HZ } from '../shared/src/sim/constants.js';

function freshSim(seed = 1) {
  const sim = new Sim({ seed, loadouts: [starterLoadout(), starterLoadout()] });
  // Align both wizards so aimed projectiles land unless a wizard dodges.
  sim.wizards[0].arcPos = 0;
  sim.wizards[1].arcPos = 0;
  return sim;
}
function idleFor(sim, ticks) { for (let t = 0; t < ticks; t++) sim.step({ 0: {}, 1: {} }); }

export function run() {
  const { ok, eq, near, report } = createHarness();

  // Ember Bolt: windup then travel, deals ~8 damage + Burning to a still target.
  let sim = freshSim();
  const startHp = sim.wizards[1].health;
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  ok(sim.wizards[0].casting && sim.wizards[0].casting.spellId === 1, 'Ember Bolt windup started');
  idleFor(sim, 60);
  ok(sim.wizards[1].health < startHp, 'Ember Bolt damaged the target');
  near(startHp - sim.wizards[1].health, 8, 1.2, 'Ember Bolt ~8 damage');
  ok(sim.wizards[1].statuses.Burning, 'Ember Bolt applied Burning');
  ok(sim.wizards[0].aether < 60 && sim.wizards[0].aether > 45, 'Ember Bolt spent ~12 Aether (net of regen)');

  // A target that strafes away after release dodges (homing-free bolt).
  sim = freshSim();
  const hp2 = sim.wizards[1].health;
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });     // begin windup
  idleFor(sim, 18);                                        // let the bolt release (aimed at pos 0)
  ok(sim.projectiles.length >= 1, 'bolt released before dodge');
  sim.step({ 0: {}, 1: { sidestep: 1 } });                 // defender jumps the arc
  idleFor(sim, 60);
  eq(sim.wizards[1].health, hp2, 'dodged Ember Bolt deals no damage');

  // Ward absorbs a bolt; caster takes no damage.
  sim = freshSim();
  sim.wizards[1].shield = { absorb: 30, ticks: Math.round(4.2 * TICK_HZ), frontal: true };
  const hp3 = sim.wizards[1].health;
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  idleFor(sim, 60);
  eq(sim.wizards[1].health, hp3, 'Ward fully absorbs Ember Bolt');

  // Piercing (Stone Shard) partially bypasses a Ward.
  sim = freshSim();
  sim.wizards[1].shield = { absorb: 30, ticks: Math.round(4.2 * TICK_HZ), frontal: true };
  const hp4 = sim.wizards[1].health;
  sim.step({ 0: { cast: 4, castQuality: 1 }, 1: {} }); // Stone Shard 14 piercing
  idleFor(sim, 80);
  ok(sim.wizards[1].health < hp4, 'piercing Stone Shard bypasses part of Ward');

  // Reflect bounces a reflectable projectile back at the caster (white-box).
  sim = freshSim();
  sim.wizards[1].reflectTicks = Math.round(1.2 * TICK_HZ);
  sim.projectiles.push({
    id: 999, owner: 0, spellId: 1, eff: effectFor(1),
    ticks: 1, quality: 1, targetPos: sim.wizards[1].arcPos,
  });
  const casterHp = sim.wizards[0].health;
  sim.step({ 0: {}, 1: {} }); // projectile resolves -> reflected
  const reflected = sim.projectiles.find((p) => p.owner === 1 && p.spellId === 1);
  ok(reflected, 'Reflect produced a return projectile');
  ok(sim.wizards[1].charges >= 0.5, 'perfect Reflect grants half a Sigil Charge');
  idleFor(sim, 60);
  ok(sim.wizards[0].health < casterHp, 'reflected bolt hits the original caster');

  // Barrier prevents offensive casting while active.
  sim = freshSim();
  sim.wizards[0].barrier = { absorb: 60, ticks: Math.round(4.5 * TICK_HZ) };
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  ok(!sim.wizards[0].casting, 'Barrier blocks offensive cast');

  // Concussive Blast interrupts an enemy Focus channel (counter).
  sim = freshSim();
  // wizard1 begins focusing; wizard0 fires Concussive Blast (id 28).
  sim.step({ 0: { cast: 28, castQuality: 1 }, 1: { focus: true } });
  for (let t = 0; t < 60; t++) sim.step({ 0: {}, 1: { focus: true } });
  ok(!sim.wizards[1].focusing || sim.wizards[1].charges === 0, 'Concussive interrupts Focus');
  ok(sim.wizards[0].countersLanded >= 1, 'interrupt counts as a counter landed');

  // A rejected deliberate trace incurs recovery but no Aether cost.
  sim = freshSim();
  const aBefore = sim.wizards[0].aether;
  sim.step({ 0: { cast: 99, castWasGesture: true }, 1: {} }); // id 99 not in loadout
  ok(sim.wizards[0].recoveryTicks > 0, 'rejected trace triggers recovery');
  ok(sim.wizards[0].aether >= aBefore - 0.5, 'rejected trace costs no Aether');

  return report('casting');
}
