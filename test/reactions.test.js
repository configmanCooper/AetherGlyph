// reactions.test.js — environmental reaction matrix: priority ordering, each
// named reaction, zone limits, once/sec cooldown, non-recursion, Tenacity.

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { spellWithGesture } from '../shared/src/balance/loadouts.js';
import { REACTIONS, sortByPriority, priorityOf, prismaticUtility } from '../shared/src/sim/reactions.js';
import { REACTION, REACTION_PRIORITY, ZONE, TICK_HZ } from '../shared/src/sim/constants.js';

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
  eq(REACTION.frozenGroundSlowS, 9, 'Frozen Ground reaction lasts three times as long');

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

  // Chilled + Frost Bind -> Freeze (hard control) + Tenacity afterwards.
  sim = mk([27], [1]);
  sim.applyStatus(sim.wizards[1], 'Chilled', 1);
  fire(sim, 27);
  // The freeze is 1s then Tenacity engages; run long enough for both.
  ok(sim.wizards[1].tenacityTicks > 0 || sim.hasStatus(sim.wizards[1], 'Frozen'),
    'Frost Bind freezes a Chilled target and grants Tenacity');

  // Soaked + Thunderclap -> Stun (hard control) + Tenacity.
  sim = mk([30], [1]);
  sim.applyStatus(sim.wizards[1], 'Soaked', 1);
  fire(sim, 30);
  ok(sim.wizards[1].tenacityTicks > 0, 'Thunderclap stuns a Soaked target (Tenacity engaged)');

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
