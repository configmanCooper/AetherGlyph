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

  // Stone Wall intercepts non-piercing projectiles before they reach the wizard.
  sim = freshSim();
  sim.wizards[0].arcPos = -1;
  sim.wizards[1].arcPos = 0.7;
  const missedCover = sim.addZone(1, 'Cover', { center: -1 });
  const cover = sim.addZone(1, 'Cover', { center: 0 });
  const coveredHp = sim.wizards[1].health;
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  let coverBlocked = false;
  for (let t = 0; t < 90 && !coverBlocked; t++) {
    const events = sim.step({ 0: {}, 1: {} });
    coverBlocked = events.some((event) => event.type === 'coverBlock' && event.spellId === 1);
  }
  ok(coverBlocked, 'Stone Wall collides with Ember Bolt before the target');
  eq(sim.wizards[1].health, coveredHp, 'a Stone Wall-blocked projectile deals no wizard damage');
  ok(cover.hp < 26, 'blocked projectile lowers Stone Wall HP');
  eq(missedCover.hp, 26, 'projectile checks every wall and leaves non-intersecting cover untouched');

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
  ok(sim.wizards[1].shield && sim.wizards[1].shield.absorb < 30, 'Ward collision lowers Ward HP');

  // A barrier at or below zero HP is destroyed and only overflow reaches health.
  sim = freshSim();
  sim.wizards[1].barrier = { absorb: 5, ticks: Math.round(4.5 * TICK_HZ) };
  const barrierHp = sim.wizards[1].health;
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  idleFor(sim, 60);
  ok(sim.wizards[1].barrier === null, 'Barrier Dome is destroyed when its HP reaches zero');
  ok(sim.wizards[1].health < barrierHp && sim.wizards[1].health > barrierHp - 5,
    'only barrier overflow damage reaches the wizard');

  // Blink invisibility prevents a homing missile from updating its aim.
  sim = freshSim();
  sim.wizards[0].aether = 100;
  sim.step({ 0: { cast: 5, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 60 && sim.projectiles.length === 0; t++) sim.step({ 0: {}, 1: {} });
  const missile = sim.projectiles[0];
  ok(!!missile, 'Arcane Missile released for homing test');
  const hiddenAim = missile.targetPos;
  sim.wizards[1].arcPos = 0.8;
  sim.wizards[1].invisibleTicks = 180;
  for (let t = 0; t < 5; t++) sim.step({ 0: {}, 1: {} });
  near(missile.targetPos, hiddenAim, 1e-6, 'homing does not track an invisible Blink target');
  sim.wizards[1].invisibleTicks = 0;
  sim.step({ 0: {}, 1: {} });
  ok(missile.targetPos > hiddenAim, 'homing resumes after the target becomes visible');

  sim = freshSim(44);
  sim.wizards[0].aether = 100;
  sim.step({ 0: { cast: 5, castQuality: 1 }, 1: {} });
  sim.wizards[1].arcPos = -0.91;
  sim.wizards[1].invisibleTicks = 180;
  for (let t = 0; t < 60 && sim.projectiles.length === 0; t++) sim.step({ 0: {}, 1: {} });
  ok(Math.abs(sim.projectiles[0].targetPos - sim.wizards[1].arcPos) > 1e-6,
    'a target that Blinks during windup receives seeded random aim at release');

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

  // Guide selection does not restrict casting. With normal resource/charge
  // requirements met, every roster spell can begin from the starter guide set.
  let unrestricted = 0;
  for (let id = 1; id <= 40; id++) {
    sim = freshSim(id);
    sim.wizards[0].aether = 100;
    sim.wizards[0].charges = 3;
    if (sim.beginCast(sim.wizards[0], id, 1)) unrestricted++;
  }
  eq(unrestricted, 40, 'all 40 spells can begin regardless of selected guides');

  // A rejected deliberate trace incurs recovery but no Aether cost.
  sim = freshSim();
  const aBefore = sim.wizards[0].aether;
  sim.step({ 0: { cast: 99, castWasGesture: true }, 1: {} }); // unknown spell id
  ok(sim.wizards[0].recoveryTicks > 0, 'rejected trace triggers recovery');
  ok(sim.wizards[0].aether >= aBefore - 0.5, 'rejected trace costs no Aether');

  return report('casting');
}
