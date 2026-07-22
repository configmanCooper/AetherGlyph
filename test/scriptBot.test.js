// scriptBot.test.js — the scripted teaching instructor is legal and deterministic.
//   - it only ever emits casts the Sim accepts (never an illegal/rejected cast),
//   - it obeys resources/cooldowns/charges via the same intent path,
//   - the same config + seed replays an identical intent sequence,
//   - its focus/wall behaviours actually sustain a channel to teach from.

import { createHarness } from './tiny.js';
import { ScriptBot, makeScriptBot, canWizardCast } from '../client/src/tutorial/scriptBot.js';
import { Sim } from '../shared/src/sim/sim.js';
import { makeLoadout } from '../shared/src/balance/loadouts.js';
import { AETHER, SIGIL, MATCH } from '../shared/src/sim/constants.js';

// Drive a lesson-like sim: idle player vs a scripted instructor. Collect events.
function driveScript(config, playerIds, botIds, { seed = 3, ticks = 900, arena = null } = {}) {
  const sim = new Sim({ seed, loadouts: [makeLoadout(playerIds), makeLoadout(botIds)], rules: { timer: false, pressure: false } });
  if (arena) { const b = sim.wizards[1]; if (arena.botCharges != null) b.charges = arena.botCharges; }
  const bot = makeScriptBot(1, config);
  const events = [];
  const intents = [];
  for (let t = 0; t < ticks && !sim.ended; t++) {
    const intent = bot.act(sim);
    intents.push(intent.cast != null ? `c${intent.cast}` : intent.focus ? 'f' : '.');
    for (const e of sim.step({ 0: {}, 1: intent })) events.push(e);
  }
  return { sim, events, intents };
}

export function run() {
  const { ok, eq, report } = createHarness();

  // --- 1. legality: the bot never emits an illegal / rejected cast -------
  const configs = [
    { cfg: { behavior: 'periodic', spellId: 1, startTick: 30, periodTicks: 90 }, p: [1], b: [1] },
    { cfg: { behavior: 'focus-loop', startTick: 60 }, p: [28], b: [1] },
    { cfg: { behavior: 'on-mark-defend', defendId: 11 }, p: [18, 5], b: [11] },
    { cfg: { behavior: 'wall-focus', wallId: 15, startTick: 60 }, p: [15, 34], b: [15] },
    { cfg: { behavior: 'sequence', steps: [{ tick: 60, cast: 5 }, { tick: 200, cast: 8 }] }, p: [12, 11], b: [5, 8] },
  ];
  let anyRejected = false, resourcesLegal = true;
  for (const { cfg, p, b } of configs) {
    const arena = cfg.behavior === 'sequence' ? { botCharges: 1 } : null;
    const { sim, events } = driveScript(cfg, p, b, { arena });
    for (const e of events) if (e.type === 'castRejected' && e.caster === 1) anyRejected = true;
    const w = sim.wizards[1];
    if (w.aether < -0.001 || w.aether > AETHER.max + 0.001) resourcesLegal = false;
    if (w.charges < 0 || w.charges > SIGIL.max) resourcesLegal = false;
    if (w.health < 0 || w.health > MATCH.startHealth) resourcesLegal = false;
  }
  ok(!anyRejected, 'the ScriptBot never emits an illegal (rejected) cast');
  ok(resourcesLegal, 'the ScriptBot keeps its resources within legal bounds');

  // --- 2. focus-loop actually sustains a focus (teachable moment) --------
  const focusRun = driveScript({ behavior: 'focus-loop', startTick: 20 }, [28], [1, 2, 3], { ticks: 500 });
  const focusCompletes = focusRun.events.filter((e) => e.type === 'focusComplete' && e.caster === 1).length;
  ok(focusCompletes >= 1, 'focus-loop sustains a Focus channel to completion (does not start-and-cancel)');
  const focusCasts = focusRun.events.filter((e) => e.type === 'cast' && e.caster === 1);
  ok(focusCasts.length >= 1, 'focus-loop spends a charge on a spell after reaching three charges');
  const castTick = focusRun.events.findIndex((e) => e.type === 'cast' && e.caster === 1);
  ok(focusRun.events.slice(castTick + 1).some((e) => e.type === 'focusStart' && e.caster === 1),
    'focus-loop resumes Focusing after spending a charge');

  {
    const defendSim = new Sim({
      seed: 4,
      loadouts: [makeLoadout([18, 5]), makeLoadout([11])],
      rules: { timer: false, pressure: false, cooldownScale: 0.05 },
    });
    defendSim.wizards[1].aether = 100;
    defendSim.applyStatus(defendSim.wizards[1], 'Marked', 1);
    const defendBot = makeScriptBot(1, {
      behavior: 'on-mark-defend', defendId: 11, triggerStatus: 'Marked', recastDelayTicks: 180,
    });
    let firstBarrierEnd = null, secondBarrierStart = null, barrierStarts = 0;
    for (let tick = 0; tick < 1000 && secondBarrierStart == null; tick++) {
      const events = defendSim.step({ 0: {}, 1: defendBot.act(defendSim) });
      for (const e of events) {
        if (e.type === 'castStart' && e.caster === 1 && e.spellId === 11) {
          barrierStarts += 1;
          if (barrierStarts === 2) secondBarrierStart = defendSim.tick;
        }
      }
      if (barrierStarts === 1 && !defendSim.wizards[1].barrier && defendSim.wizards[1].castsResolved >= 1
          && firstBarrierEnd == null) firstBarrierEnd = defendSim.tick;
    }
    ok(firstBarrierEnd != null && secondBarrierStart != null,
      'on-mark defender eventually raises a second Barrier while Mark remains');
    ok(secondBarrierStart - firstBarrierEnd >= 180,
      'on-mark defender waits a few seconds before replacing an expired Barrier');
  }

  // --- 3. wall-focus places cover then channels behind it ---------------
  const wallRun = driveScript({ behavior: 'wall-focus', wallId: 15, startTick: 30 }, [15], [15], { ticks: 300 });
  const madeCover = wallRun.events.some((e) => e.type === 'zone' && e.owner === 1 && e.kind === 'Cover');
  const focusedBehind = wallRun.events.some((e) => e.type === 'focusStart' && e.caster === 1);
  ok(madeCover && focusedBehind, 'wall-focus raises cover then Focuses behind it');

  // --- 4. determinism: same config + seed => identical intent sequence ---
  const s1 = driveScript({ behavior: 'periodic', spellId: 1, startTick: 30, periodTicks: 90 }, [1], [1], { seed: 55, ticks: 400 });
  const s2 = driveScript({ behavior: 'periodic', spellId: 1, startTick: 30, periodTicks: 90 }, [1], [1], { seed: 55, ticks: 400 });
  eq(s1.intents.join(''), s2.intents.join(''), 'same config + seed replays an identical intent sequence');

  const repeatedFreeze = driveScript({
    behavior: 'sequence', loop: true, loopEveryTicks: 1200,
    steps: [{ tick: 60, cast: 2 }, { tick: 300, cast: 27 }],
  }, [13, 1], [2, 27], { ticks: 2600 });
  const freezePatternCasts = repeatedFreeze.events.filter((e) =>
    e.type === 'cast' && e.caster === 1 && (e.spellId === 2 || e.spellId === 27));
  ok(freezePatternCasts.filter((e) => e.spellId === 2).length >= 2
      && freezePatternCasts.filter((e) => e.spellId === 27).length >= 2,
  'looping sequence repeats the Frost Lance/Frost Bind teaching pattern');

  // --- 5. canWizardCast gate matches the sim's own acceptance -----------
  const sim = new Sim({ seed: 1, loadouts: [makeLoadout([18]), makeLoadout([1])], rules: { timer: false, pressure: false } });
  eq(canWizardCast(sim, 0, 18), false, 'Amplify (charge-cost) is not castable with 0 charges');
  sim.wizards[0].charges = 1;
  eq(canWizardCast(sim, 0, 18), true, 'Amplify becomes castable once a charge is available');
  eq(canWizardCast(sim, 0, 99), false, 'an unequipped spell id is never castable');

  // --- 6. Rain Conducts gives repeated, slowed return-lightning attempts ---
  {
    const rainSim = new Sim({
      seed: 7,
      loadouts: [makeLoadout([32, 3]), makeLoadout([3])],
      rules: { timer: false, pressure: false, projectileTravelScale: 2.5 },
    });
    rainSim.applyStatus(rainSim.wizards[1], 'Soaked', 1);
    const returnBot = makeScriptBot(1, {
      behavior: 'return-lightning', spellId: 3, delayTicks: 90, periodTicks: 180,
    });
    let starts = 0, firstStart = null, travelTicks = null;
    let dodged = false, playerDamaged = false;
    const dodgedProjectiles = new Set();
    for (let i = 0; i < 1400 && !rainSim.ended; i++) {
      const incoming = rainSim.projectiles.find((p) => p.owner === 1 && p.spellId === 3);
      const shouldDodge = incoming && incoming.ticks <= 1 && !dodgedProjectiles.has(incoming.id);
      if (shouldDodge) dodgedProjectiles.add(incoming.id);
      const playerIntent = shouldDodge ? { sidestep: 1 } : {};
      const evs = rainSim.step({ 0: playerIntent, 1: returnBot.act(rainSim) });
      for (const e of evs) {
        if (e.type === 'castStart' && e.caster === 1 && e.spellId === 3) {
          starts += 1;
          if (firstStart == null) firstStart = e.tick;
        }
        if (e.type === 'cast' && e.caster === 1 && e.spellId === 3) {
          if (travelTicks == null) {
            travelTicks = rainSim.projectiles.find((p) => p.owner === 1 && p.spellId === 3)?.totalTicks;
          }
        }
        if (e.type === 'miss' && e.target === 0 && e.spellId === 3) dodged = true;
        if (e.type === 'damage' && e.target === 0 && e.source === 'Spark Dart') playerDamaged = true;
      }
    }
    ok(starts >= 2, 'return-lightning gives the player repeated evade attempts');
    ok(firstStart >= 90, 'return lightning waits for the teaching delay');
    eq(travelTicks, Math.round(0.32 * 60 * 2.5), 'Rain Conducts slows Spark travel for an actionable Dodge window');
    ok(dodged, 'tapping Dodge after Spark release makes the tutorial lightning miss');
    ok(!playerDamaged, 'the correctly dodged tutorial lightning does not damage the player');
  }

  // --- 7. Wards and Angles fires only after the student's Ward is active ---
  {
    const wardSim = new Sim({
      seed: 8,
      loadouts: [makeLoadout([10, 6]), makeLoadout([1])],
      rules: { timer: false, pressure: false },
    });
    const wardBot = makeScriptBot(1, { behavior: 'ward-drill', spellId: 1 });
    let castBeforeWard = false, blocked = false;
    for (let i = 0; i < 180 && !wardSim.ended; i++) {
      const player = i === 20 ? { cast: 10, castQuality: 1 } : {};
      const events = wardSim.step({ 0: player, 1: wardBot.act(wardSim) });
      for (const e of events) {
        if (e.type === 'castStart' && e.caster === 1 && !wardSim.wizards[0].shield) castBeforeWard = true;
      }
      if (wardSim.wizards[0].shield && wardSim.wizards[0].shield.absorb < 30) blocked = true;
    }
    ok(!castBeforeWard, 'Ward drill does not attack before the student raises Ward');
    ok(blocked, 'Ward drill fires a bolt that is absorbed by the active Ward');
    eq(wardSim.wizards[0].health, MATCH.startHealth, 'a correct Ward prevents the teaching bolt from damaging health');
  }

  return report('scriptBot');
}
