// reactions.test.js — environmental reaction matrix: priority ordering, each
// named reaction, zone limits, once/sec cooldown, non-recursion, Tenacity.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { spellWithGesture } from '../shared/src/balance/loadouts.js';
import { REACTIONS, sortByPriority, priorityOf, prismaticUtility } from '../shared/src/sim/reactions.js';
import { REACTION, REACTION_PRIORITY, ZONE, TICK_HZ } from '../shared/src/sim/constants.js';
import { effectFor } from '../shared/src/sim/spellEffects.js';

function mk(ids0, ids1 = [1]) {
  const sim = new Sim({ seed: 5, loadouts: [ids0.map(spellWithGesture), ids1.map(spellWithGesture)] });
  sim.wizards[0].arcPos = 0; sim.wizards[1].arcPos = 0;
  sim.wizards[0].aether = 100; sim.wizards[0].charges = 3;
  sim.wizards[1].aether = 100; sim.wizards[1].charges = 3;
  return sim;
}
// Cast spell id for wizard w, run until it resolves + settles; return events.
function fire(sim, id, who = 0, ticks = 150) {
  const other = who === 0 ? 1 : 0;
  sim.step({ [who]: { cast: id, castQuality: 1 }, [other]: {} });
  const evs = [];
  for (let t = 0; t < ticks && !sim.ended; t++) {
    for (const e of sim.step({ 0: {}, 1: {} })) evs.push(e);
  }
  return evs;
}
function reactionNames(evs) { return evs.filter((e) => e.type === 'reaction').map((e) => e.name); }

export function run() {
  const { ok, eq, report } = createHarness();

  eq(ZONE.durations.Oil, 21, 'Oil lasts three times the original duration');
  eq(ZONE.durations.Wet, 21, 'Wet lasts three times the original duration');
  eq(ZONE.durations.Fog, 18, 'Fog lasts three times the original duration');
  eq(ZONE.durations.Snare, 24, 'Snare lasts three times the original duration');
  eq(ZONE.durations.Cover, 24, 'Cover lasts three times the original duration');
  eq(ZONE.durations.Hourglass, 18, 'Hourglass lasts three times the original duration');
  eq(ZONE.durations.Fire, 12, 'Fire lasts three times the original duration');
  eq(ZONE.durations.Gust, 1.8, 'Gust lasts three times the original duration');
  eq(ZONE.durations.Grounded, 3, 'Grounded strip lasts three times the original duration');
  eq(ZONE.snareRootS, 2, 'Rune Snare roots for 2 seconds');
  eq(REACTION.frozenGroundSlowS, 9, 'Frozen Ground reaction lasts three times as long');

  const rainSim = mk([32, 13], [1]);
  fire(rainSim, 32);
  ok(rainSim.hasStatus(rainSim.wizards[0], 'Wet') && rainSim.hasStatus(rainSim.wizards[1], 'Wet'),
    'Rain Glyph makes both duelists Wet');
  for (let t = 0; t < 230; t++) rainSim.step({ 0: {}, 1: {} });
  ok(rainSim.hasStatus(rainSim.wizards[0], 'Soaked') && rainSim.hasStatus(rainSim.wizards[1], 'Soaked'),
    'five continuous seconds of shared Rain upgrades both duelists to Soaked');
  fire(rainSim, 13);
  ok(!rainSim.hasStatus(rainSim.wizards[0], 'Soaked') && rainSim.hasStatus(rainSim.wizards[0], 'Wet'),
    'Dispel downgrades Soaked to Wet instead of removing both layers');

  const priorityDispel = mk([13], [1]);
  priorityDispel.applyStatus(priorityDispel.wizards[0], 'Rooted', 1);
  priorityDispel.applyStatus(priorityDispel.wizards[0], 'Sundered', 1);
  priorityDispel.applyStatus(priorityDispel.wizards[0], 'Soaked', 1);
  fire(priorityDispel, 13);
  ok(!priorityDispel.hasStatus(priorityDispel.wizards[0], 'Rooted')
      && !priorityDispel.hasStatus(priorityDispel.wizards[0], 'Sundered')
      && priorityDispel.hasStatus(priorityDispel.wizards[0], 'Soaked'),
    'Dispel honors priority before considering the Soaked-to-Wet downgrade');

  const wetDispel = mk([13], [1]);
  wetDispel.addZone(1, 'Wet', {});
  wetDispel.applyStatus(wetDispel.wizards[0], 'Wet', 1);
  wetDispel.wizards[0].wetExposureTicks = Math.round(ZONE.soakAfterS * TICK_HZ) - 1;
  wetDispel.resolveDispel(wetDispel.wizards[0], wetDispel.wizards[1], effectFor(13));
  eq(wetDispel.wizards[0].wetExposureTicks, 0, 'dispelling Wet resets accumulated Rain exposure');
  wetDispel.step({ 0: {}, 1: {} });
  ok(!wetDispel.hasStatus(wetDispel.wizards[0], 'Soaked'),
    'cleansed Wet does not immediately rebound into Soaked on the next Rain tick');

  const snareSim = mk([36]);
  snareSim.wizards[0].arcPos = -0.7;
  snareSim.wizards[1].arcPos = 0.62;
  let snareZone = null, snareTriggered = false, snareRootTicks = 0;
  snareSim.step({ 0: { cast: 36, castQuality: 1 }, 1: {} });
  for (let t = 0; t < 120 && !snareZone; t++) {
    const events = snareSim.step({ 0: {}, 1: {} });
    snareZone ||= events.find((event) => event.type === 'zone' && event.kind === 'Snare') || null;
    if (events.some((event) => event.type === 'snare' && event.target === 1)) snareTriggered = true;
  }
  ok(snareZone && Math.abs(snareZone.center - (-0.06)) < 0.02,
    'Rune Snare is placed just ahead of the opponent instead of under its caster');
  ok(!snareTriggered && !snareSim.hasStatus(snareSim.wizards[1], 'Rooted'),
    'a stationary opponent is not rooted before stepping into Rune Snare');
  const stepDirection = Math.sign(snareZone.center - snareSim.wizards[1].arcPos);
  for (let t = 0; t < 30 && !snareTriggered; t++) {
    const events = snareSim.step({ 0: {}, 1: { move: stepDirection } });
    if (events.some((event) => event.type === 'snare' && event.target === 1)) {
      snareTriggered = true;
      snareRootTicks = snareSim.wizards[1].statuses.Rooted?.ticks || 0;
    }
  }
  ok(snareTriggered, 'the opponent triggers Rune Snare after stepping into it');
  ok(snareRootTicks >= 118 && snareRootTicks <= 120,
    `Rune Snare applies about 2 seconds of Root (${snareRootTicks} ticks)`);

  // Priority table is data-versioned and covers every reaction category.
  eq(REACTION_PRIORITY.join(','), 'douse,ground,freeze,conduct,ignite,spread,cover',
    'reaction priority order matches environment-matrix.md');
  for (const r of REACTIONS) ok(REACTION_PRIORITY.includes(r.category), `${r.name} category is in the priority table`);

  // sortByPriority: douse before ignite before cover.
  const sorted = sortByPriority([
    { name: 'C', category: 'cover' }, { name: 'I', category: 'ignite' }, { name: 'D', category: 'douse' },
  ]);
  eq(sorted.map((x) => x.name).join(''), 'DIC', 'sortByPriority orders douse<ignite<cover');
  ok(priorityOf('douse') < priorityOf('cover'), 'priorityOf ranks douse before cover');

  // Oil + Ember -> Flash Fire (ignite): oil consumed, Fire zone created.
  let sim = mk([31, 1]);
  fire(sim, 31); // place Oil
  const flash = reactionNames(fire(sim, 1));
  ok(flash.includes('FlashFire'), 'Oil + Ember -> Flash Fire');
  eq(sim.zonesOfKind('Oil').length, 0, 'Oil consumed by ignition');
  ok(sim.zonesOfKind('Fire').length >= 1, 'Flash Fire leaves a fire zone');

  // Oil + Rain -> Washed Ground (douse): oil removed.
  sim = mk([31, 32]);
  fire(sim, 31);
  const washed = reactionNames(fire(sim, 32));
  ok(washed.includes('WashedGround'), 'Oil + Rain -> Washed Ground');
  eq(sim.zonesOfKind('Oil').length, 0, 'Oil washed away');

  // Wet + Storm -> Conductive Arc: opponent becomes Soaked.
  sim = mk([32, 3]);
  fire(sim, 32);
  const cond = reactionNames(fire(sim, 3));
  ok(cond.includes('ConductiveArc'), 'Wet + Storm -> Conductive Arc');
  ok(sim.hasStatus(sim.wizards[1], 'Soaked'), 'Conductive Arc applies Soaked');

  // The reaction event additively carries spatial fields (targetId + center) so
  // the renderer can anchor its VFX (e.g. a caster->target lightning arc) without
  // altering deterministic behaviour or breaking existing consumers.
  sim = mk([32, 3]);
  fire(sim, 32);
  const arcEvent = fire(sim, 3).find((e) => e.type === 'reaction' && e.name === 'ConductiveArc');
  ok(arcEvent && arcEvent.casterId === 0 && arcEvent.targetId === 1,
    'Conductive Arc event identifies caster + target for a caster->target arc');
  ok(arcEvent && typeof arcEvent.center === 'number',
    'reaction event carries a numeric world center for VFX anchoring');
  ok(arcEvent && 'name' in arcEvent && 'category' in arcEvent,
    'reaction event preserves its original name + category (backward compatible)');

  // Wet + Frost -> Frozen Ground: a Frozen slow surface appears.
  sim = mk([32, 2, 1]);
  fire(sim, 32);
  const froze = reactionNames(fire(sim, 2));
  ok(froze.includes('FrozenGround'), 'Wet + Frost -> Frozen Ground');
  ok(sim.zonesOfKind('Frozen').length >= 1, 'Frozen Ground surface created');
  const frozenStart = sim.wizards[0].arcPos;
  sim.step({ 0: { move: 1 }, 1: {} });
  const frozenDelta = sim.wizards[0].arcPos - frozenStart;
  sim.removeZones((z) => z.kind === 'Frozen', 'test');
  const normalStart = sim.wizards[0].arcPos;
  sim.step({ 0: { move: 1 }, 1: {} });
  const normalDelta = sim.wizards[0].arcPos - normalStart;
  ok(frozenDelta < normalDelta, 'standing on Frozen Ground slows movement');

  // Frozen Ground + Ember -> Steam Veil: frozen ends, Fog appears.
  sim.addZone(0, 'Frozen', { center: 0 });
  const steam = reactionNames(fire(sim, 1));
  ok(steam.includes('SteamVeil'), 'Frozen Ground + Ember -> Steam Veil');
  ok(sim.zonesOfKind('Fog').length >= 1, 'Steam Veil creates Fog');

  // Burning + Rain -> Doused: burning stacks + fire zones removed.
  sim = mk([1, 32], [1]);
  fire(sim, 1);                       // apply Burning to opponent
  ok(sim.hasStatus(sim.wizards[1], 'Burning'), 'Burning applied before douse');
  const doused = reactionNames(fire(sim, 32));
  ok(doused.includes('Doused'), 'Burning + Rain -> Doused');
  ok(!sim.hasStatus(sim.wizards[1], 'Burning'), 'Doused removes Burning');

  // Fog + Gust -> Cleared Air: fog dispersed.
  sim = mk([35, 33]);
  fire(sim, 35);
  const cleared = reactionNames(fire(sim, 33));
  ok(cleared.includes('ClearedAir'), 'Fog + Gust -> Cleared Air');
  eq(sim.zonesOfKind('Fog').length, 0, 'Fog cleared by Gust');

  // Stone Wall + Quake -> Rubble: cover destroyed.
  sim = mk([15, 34]);
  fire(sim, 15);
  ok(sim.zones.some((z) => z.kind === 'Cover'), 'Stone Wall cover created');
  const rubble = reactionNames(fire(sim, 34));
  ok(rubble.includes('Rubble'), 'Stone Wall + Quake -> Rubble');
  eq(sim.zones.filter((z) => z.kind === 'Cover').length, 0, 'Quake destroys cover');

  // Chilled + Frost Bind -> earned 3s Freeze, then Tenacity.
  sim = mk([27], [1]);
  sim.applyStatus(sim.wizards[1], 'Chilled', 1);
  sim.step({ 0: { cast: 27, castQuality: 1 }, 1: {} });
  let frostTicks = 0;
  for (let t = 0; t < 120 && frostTicks === 0; t++) {
    sim.step({ 0: {}, 1: {} });
    frostTicks = sim.wizards[1].statuses.Frozen?.ticks || 0;
  }
  ok(frostTicks >= 178 && frostTicks <= 180, `Frost Bind grants about 3 seconds of Freeze (${frostTicks} ticks)`);
  const frozenPos = sim.wizards[1].arcPos;
  sim.step({ 0: {}, 1: { move: 1, cast: 1, castQuality: 1 } });
  eq(sim.wizards[1].arcPos, frozenPos, 'Frost Bind target cannot move');
  ok(!sim.wizards[1].casting, 'Frost Bind target cannot cast');
  for (let t = 0; t < 185 && sim.hasStatus(sim.wizards[1], 'Frozen'); t++) sim.step({ 0: {}, 1: {} });
  ok(sim.wizards[1].tenacityTicks > 0, 'Frost Bind grants Tenacity after the 3s Freeze');

  // Soaked + Thunderclap -> Stun (hard control) + Tenacity.
  sim = mk([30], [1]);
  sim.applyStatus(sim.wizards[1], 'Soaked', 1);
  sim.step({ 0: { cast: 30, castQuality: 1 }, 1: {} });
  let stunTicks = 0;
  for (let t = 0; t < 120 && stunTicks === 0; t++) {
    sim.step({ 0: {}, 1: {} });
    stunTicks = sim.wizards[1].statuses.Stunned?.ticks || 0;
  }
  ok(stunTicks >= 118 && stunTicks <= 120, `Thunderclap grants about 2 seconds of Stun (${stunTicks} ticks)`);
  const stunnedPos = sim.wizards[1].arcPos;
  sim.step({ 0: {}, 1: { move: 1, cast: 1, castQuality: 1 } });
  eq(sim.wizards[1].arcPos, stunnedPos, 'Thunderclap target cannot move while stunned');
  ok(!sim.wizards[1].casting, 'Thunderclap target cannot cast while stunned');

  sim = mk([30], [1]);
  sim.applyStatus(sim.wizards[1], 'Soaked', 1);
  sim.wizards[1].barrier = { absorb: 60, ticks: 600 };
  fire(sim, 30, 0, 90);
  ok(!sim.hasStatus(sim.wizards[1], 'Stunned'),
    'a fully barrier-absorbed Thunderclap does not apply Stun');

  // Two zones per player: a third owned zone replaces the oldest.
  sim = mk([31, 32, 35], [1]);
  fire(sim, 31); fire(sim, 32); fire(sim, 35);
  const owned = sim.zones.filter((z) => z.owner === 0);
  ok(owned.length <= ZONE.maxPerPlayer, `at most ${ZONE.maxPerPlayer} zones per player (has ${owned.length})`);

  // Reaction cooldown: the same reaction cannot trigger twice within a second.
  sim = mk([31, 1], [1]);
  fire(sim, 31);
  fire(sim, 1);                                   // FlashFire #1
  fire(sim, 31);                                  // new Oil quickly
  const second = reactionNames(fire(sim, 1, 0, 20)); // immediately try again
  ok(!second.includes('FlashFire'), 'Flash Fire respects once/sec cooldown');

  // Non-recursion: a single triggering cast yields at most one reaction.
  sim = mk([31, 1], [1]);
  fire(sim, 31);
  const one = reactionNames(fire(sim, 1));
  ok(one.length <= 1, 'at most one reaction per triggering event (no recursive chains)');

  // Prismatic mixed-resonance utility table.
  eq(prismaticUtility('Tide', 'Storm').key, 'static', 'Tide+Storm -> Static utility');
  eq(prismaticUtility('Stone', 'Ember').key, 'cover', 'Stone+Ember -> cover damage utility');
  eq(prismaticUtility('Ember', 'Ember').key, 'none', 'repeated school -> no utility modifier');

  return report('reactions');
}
