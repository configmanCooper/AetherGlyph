// resources.test.js — Aether, Focus/Sigil, Brace, sidestep, cooldown rules.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { starterLoadout } from '../shared/src/balance/loadouts.js';
import { AETHER, STAMINA, SIGIL, FOCUS, BRACE, SIDESTEP, TICK_HZ } from '../shared/src/sim/constants.js';

function freshSim(seed = 1) {
  return new Sim({ seed, loadouts: [starterLoadout(), starterLoadout()] });
}
function advance(sim, ticks, i0 = {}, i1 = {}) {
  for (let t = 0; t < ticks; t++) sim.step({ 0: i0, 1: i1 });
}

export function run() {
  const { ok, eq, near, report } = createHarness();

  // Starting resources (MASTERPLAN §3/§6).
  let sim = freshSim();
  eq(sim.wizards[0].health, 100, 'start health 100');
  eq(sim.wizards[0].aether, AETHER.start, 'start Aether 60');
  eq(sim.wizards[0].stamina, STAMINA.start, 'start Stamina 100');
  eq(sim.wizards[0].charges, SIGIL.start, 'start charges 0');

  // Aether regen 4/sec when idle (not focusing).
  sim = freshSim();
  advance(sim, TICK_HZ, {}, {}); // 1 second
  near(sim.wizards[0].aether, AETHER.start + AETHER.regenPerS, 0.3, 'Aether regen ~4/sec');

  // Aether does not regen during Focus, and Focus grants a charge after 0.95s.
  sim = freshSim();
  const focusTicks = Math.round(FOCUS.channelS * TICK_HZ) + 2;
  const beforeAether = sim.wizards[0].aether;
  advance(sim, focusTicks, { focus: true }, {});
  eq(sim.wizards[0].charges, 1, 'Focus grants 1 Sigil Charge');
  ok(sim.wizards[0].aether <= beforeAether + 0.5, 'no Aether regen during Focus');

  // Focus ignores movement input, costs stamina, and still completes.
  sim = freshSim();
  const focusStartPos = sim.wizards[0].arcPos;
  const focusStartStamina = sim.wizards[0].stamina;
  for (let t = 0; t < focusTicks; t++) {
    sim.step({ 0: { focus: true, move: 1 }, 1: {} });
  }
  eq(sim.wizards[0].charges, 1, 'Focus completes while movement input is ignored');
  eq(sim.wizards[0].arcPos, focusStartPos, 'Focus prevents movement');
  ok(sim.wizards[0].stamina < focusStartStamina, 'Focus consumes stamina over time');
  sim = freshSim();
  sim.wizards[0].stamina = 0;
  sim.step({ 0: { focus: true }, 1: {} });
  ok(!sim.wizards[0].focusing, 'insufficient stamina prevents Focus');

  // Brace costs stamina instead of Aether and converts incoming force to Aether.
  sim = freshSim();
  const a0 = sim.wizards[0].aether;
  const s0 = sim.wizards[0].stamina;
  sim.step({ 0: { brace: true }, 1: {} });
  ok(sim.wizards[0].aether >= a0, 'Brace costs no Aether');
  ok(sim.wizards[0].stamina < s0, 'Brace costs stamina while held');
  ok(sim.wizards[0].braceTicks > 0, 'Brace active');
  sim.wizards[0].aether = 0;
  const bracedDamage = sim.dealDamage(sim.wizards[1], sim.wizards[0], 20, { source: 'test' });
  near(bracedDamage, 5, 0.01, 'Brace reduces incoming damage by 75%');
  near(sim.wizards[0].aether, 5, 0.01, 'Brace absorbs 25% of incoming damage as Aether');
  sim = freshSim();
  sim.wizards[0].stamina = 50;
  advance(sim, TICK_HZ, { brace: true }, {});
  near(sim.wizards[0].stamina, 48, 0.06, 'held Brace costs 3 stamina/sec with idle regeneration');
  sim = freshSim();
  sim.wizards[0].stamina = 0;
  sim.step({ 0: { brace: true }, 1: {} });
  ok(sim.wizards[0].braceTicks <= 0, 'insufficient stamina prevents Brace');

  // Sidestep consumes 5 stamina plus a movement charge.
  sim = freshSim();
  const dodgeStamina = sim.wizards[0].stamina;
  sim.step({ 0: { sidestep: 1 }, 1: {} });
  eq(sim.wizards[0].sidestepCharges, SIDESTEP.charges - 1, 'Sidestep consumes a charge');
  near(dodgeStamina - sim.wizards[0].stamina, STAMINA.dodgeCost, 0.01, 'Sidestep costs 5 stamina');
  advance(sim, Math.round(SIDESTEP.rechargeS * TICK_HZ) + 2, {}, {});
  eq(sim.wizards[0].sidestepCharges, SIDESTEP.charges, 'Sidestep recharges');

  sim = freshSim();
  sim.wizards[0].stamina = 4;
  const noDodgePos = sim.wizards[0].arcPos;
  sim.step({ 0: { sidestep: 1 }, 1: {} });
  eq(sim.wizards[0].sidestepCharges, SIDESTEP.charges, 'insufficient stamina prevents Dodge');
  eq(sim.wizards[0].arcPos, noDodgePos, 'failed Dodge does not move');

  // Stamina movement cost and idle regeneration.
  sim = freshSim();
  advance(sim, TICK_HZ, { move: 1 }, {});
  near(sim.wizards[0].stamina, STAMINA.start - 1.5, 0.05, 'moving costs 1.5 stamina per second');
  sim.wizards[0].stamina = 50;
  advance(sim, TICK_HZ, {}, {});
  near(sim.wizards[0].stamina, 51, 0.05, 'idle stamina regenerates at 1 per second');
  sim.applyStatus(sim.wizards[0], 'Haste', 1);
  sim.wizards[0].stamina = 50;
  advance(sim, TICK_HZ, {}, {});
  near(sim.wizards[0].stamina, 51.5, 0.05, 'Haste raises idle stamina regeneration to 1.5 per second');
  sim = freshSim();
  sim.applyStatus(sim.wizards[0], 'Sloth', 1);
  sim.wizards[0].stamina = 50;
  advance(sim, TICK_HZ, {}, {});
  near(sim.wizards[0].stamina, 50.7, 0.05, 'Sloth lowers idle stamina regeneration by 30 percent');
  sim.applyStatus(sim.wizards[0], 'Haste', 1);
  sim.wizards[0].stamina = 50;
  advance(sim, TICK_HZ, {}, {});
  near(sim.wizards[0].stamina, 51.05, 0.05, 'Sloth lowers Haste stamina regeneration by 30 percent');
  delete sim.wizards[0].statuses.Sloth;
  sim.wizards[0].stamina = 100;
  advance(sim, TICK_HZ, { move: 1 }, {});
  near(sim.wizards[0].stamina, 98.875, 0.05, 'Haste reduces movement stamina cost by 25%');
  sim = freshSim();
  sim.wizards[0].stamina = 0;
  const exhaustedPos = sim.wizards[0].arcPos;
  let rejectEvents = sim.step({ 0: { move: 1 }, 1: {} });
  eq(sim.wizards[0].arcPos, exhaustedPos, 'insufficient stamina prevents movement');
  eq(rejectEvents.find((e) => e.type === 'actionRejected')?.reason, 'stamina',
    'failed movement reports insufficient Stamina');
  rejectEvents = sim.step({ 0: { move: 1 }, 1: {} });
  ok(!rejectEvents.some((e) => e.type === 'actionRejected'),
    'held failed movement does not spam repeated rejection events');
  sim.step({ 0: {}, 1: {} });
  sim.wizards[0].stamina = 0;
  rejectEvents = sim.step({ 0: { move: 1 }, 1: {} });
  eq(rejectEvents.find((e) => e.type === 'actionRejected')?.reason, 'stamina',
    'a new movement attempt reports failure again');

  sim = freshSim();
  sim.wizards[0].stamina = 0.2;
  let lowStaminaMoveRejects = 0;
  for (let tick = 0; tick < TICK_HZ * 3; tick++) {
    const events = sim.step({ 0: { move: 1 }, 1: {} });
    lowStaminaMoveRejects += events.filter((e) =>
      e.type === 'actionRejected' && e.action === 'move' && e.reason === 'stamina').length;
  }
  eq(lowStaminaMoveRejects, 1,
    'intermittent low-Stamina movement does not repeat warnings until movement is released');

  sim = freshSim();
  sim.wizards[0].stamina = 0;
  rejectEvents = sim.step({ 0: { brace: true }, 1: {} });
  eq(rejectEvents.find((e) => e.type === 'actionRejected' && e.action === 'brace')?.reason, 'stamina',
    'failed Brace reports insufficient Stamina');

  sim = freshSim();
  sim.wizards[0].braceTicks = 2;
  sim.applyStatus(sim.wizards[0], 'Stunned', 1);
  rejectEvents = sim.step({ 0: { brace: true }, 1: {} });
  eq(rejectEvents.find((e) => e.type === 'actionRejected' && e.action === 'brace')?.reason, 'stunned',
    'Brace attempted while Stunned reports why it failed');
  eq(sim.wizards[0].braceTicks, 1, 'failed Brace input does not erase an already-active Brace window');

  sim = freshSim();
  sim.wizards[0].stamina = 0;
  rejectEvents = sim.step({ 0: { focus: true }, 1: {} });
  eq(rejectEvents.find((e) => e.type === 'actionRejected' && e.action === 'focus')?.reason, 'stamina',
    'failed Focus reports insufficient Stamina');

  sim = freshSim();
  sim.wizards[0].sidestepCharges = 0;
  rejectEvents = sim.step({ 0: { sidestep: 1 }, 1: {} });
  eq(rejectEvents.find((e) => e.type === 'actionRejected' && e.action === 'sidestep')?.reason, 'no-dodges',
    'failed Dodge reports that no Dodge charges are ready');

  sim = freshSim();
  sim.applyStatus(sim.wizards[0], 'Rooted', 1);
  rejectEvents = sim.step({ 0: { move: 1 }, 1: {} });
  eq(rejectEvents.find((e) => e.type === 'actionRejected' && e.action === 'move')?.reason, 'rooted',
    'Rooted movement attempt reports why it failed');

  sim = freshSim();
  sim.wizards[0].arcPos = 1;
  const edgeStamina = sim.wizards[0].stamina;
  rejectEvents = sim.step({ 0: { move: 1 }, 1: {} });
  ok(!rejectEvents.some((e) => e.type === 'actionRejected'),
    'holding movement against the arena edge fails silently');
  eq(sim.wizards[0].stamina, edgeStamina, 'edge movement consumes no Stamina');

  // Cannot afford a spell -> no cast starts.
  sim = freshSim();
  sim.wizards[0].aether = 5;
  rejectEvents = sim.step({ 0: { cast: 4, castQuality: 1 }, 1: {} }); // Stone Shard costs 18
  ok(!sim.wizards[0].casting, 'insufficient Aether blocks cast');
  const aetherReject = rejectEvents.find((e) => e.type === 'castRejected');
  eq(aetherReject?.reason, 'aether', 'failed cast reports insufficient Aether');
  ok(aetherReject?.required > aetherReject?.available, 'Aether rejection reports required and available amounts');

  sim = freshSim();
  sim.wizards[0].aether = 100;
  rejectEvents = sim.step({ 0: { cast: 7, castQuality: 1 }, 1: {} });
  const chargeReject = rejectEvents.find((e) => e.type === 'castRejected');
  eq(chargeReject?.reason, 'charges', 'failed cast reports insufficient Sigil Charges');
  eq(chargeReject?.required, 1, 'Sigil rejection reports the required charge count');

  // Cooldown: after a cast resolves, the same spell is on cooldown.
  sim = freshSim();
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} }); // Ember Bolt
  const windup = Math.round(0.25 * TICK_HZ) + 2;
  advance(sim, windup, {}, {});
  ok((sim.wizards[0].cooldowns[1] || 0) > 0, 'spell goes on cooldown after resolving');

  // A spare Sigil Charge empowers zero-charge spells automatically.
  sim = freshSim();
  sim.wizards[0].charges = 1;
  sim.wizards[0].aether = 100;
  sim.step({ 0: { cast: 1, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 60 && sim.projectiles.length === 0; t++) sim.step({ 0: {}, 1: {} });
  eq(sim.wizards[0].charges, 0, 'zero-charge damaging spell consumes one spare Sigil Charge');
  near(sim.projectiles[0].quality, 1.1, 0.001, 'empowered damaging spell gains 10% damage potency');

  sim = freshSim();
  sim.wizards[0].charges = 1;
  sim.wizards[0].aether = 100;
  sim.step({ 0: { cast: 10, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 60 && !sim.wizards[0].shield; t++) sim.step({ 0: {}, 1: {} });
  near(sim.wizards[0].shield.ticks, Math.round(12.6 * 1.2 * TICK_HZ), 2,
    'empowered defensive spell lasts 20% longer');

  sim = freshSim();
  sim.wizards[0].charges = 1;
  sim.wizards[0].aether = 100;
  sim.step({ 0: { cast: 13, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 60 && sim.wizards[0].castsResolved < 1; t++) sim.step({ 0: {}, 1: {} });
  eq(sim.wizards[0].charges, 1, 'instant Dispel does not waste a charge when no empowerment bonus applies');

  sim = freshSim();
  sim.wizards[0].charges = 1;
  sim.wizards[0].aether = 100;
  sim.step({ 0: { cast: 8, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 100 && sim.projectiles.length === 0; t++) sim.step({ 0: {}, 1: {} });
  eq(sim.wizards[0].charges, 0, 'spell with a required Sigil Charge consumes only its normal charge');
  near(sim.projectiles[0].quality, 1, 0.001, 'required-charge spell receives no spare-charge damage bonus');

  // Aether Leech can drain the target's final Aether.
  sim = freshSim();
  sim.wizards[0].aether = 100;
  sim.wizards[1].aether = 10;
  sim.step({ 0: { cast: 24, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 90 && sim.wizards[0].castsResolved < 1; t++) sim.step({ 0: {}, 1: {} });
  eq(sim.wizards[1].aether, 0, 'Aether Leech drains the target all the way to zero');

  // Sigil decay: an idle charge decays after 8s of inactivity.
  sim = freshSim();
  advance(sim, focusTicks, { focus: true }, {}); // gain 1 charge
  eq(sim.wizards[0].charges, 1, 'charge gained before decay test');
  advance(sim, Math.round(SIGIL.decayS * TICK_HZ) + 4, {}, {}); // idle past decay window
  eq(sim.wizards[0].charges, 0, 'idle Sigil Charge decays');

  return report('resources');
}
