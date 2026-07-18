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
  const focusRun = driveScript({ behavior: 'focus-loop', startTick: 20 }, [28], [1], { ticks: 200 });
  const focusCompletes = focusRun.events.filter((e) => e.type === 'focusComplete' && e.caster === 1).length;
  ok(focusCompletes >= 1, 'focus-loop sustains a Focus channel to completion (does not start-and-cancel)');

  // --- 3. wall-focus places cover then channels behind it ---------------
  const wallRun = driveScript({ behavior: 'wall-focus', wallId: 15, startTick: 30 }, [15], [15], { ticks: 300 });
  const madeCover = wallRun.events.some((e) => e.type === 'zone' && e.owner === 1 && e.kind === 'Cover');
  const focusedBehind = wallRun.events.some((e) => e.type === 'focusStart' && e.caster === 1);
  ok(madeCover && focusedBehind, 'wall-focus raises cover then Focuses behind it');

  // --- 4. determinism: same config + seed => identical intent sequence ---
  const s1 = driveScript({ behavior: 'periodic', spellId: 1, startTick: 30, periodTicks: 90 }, [1], [1], { seed: 55, ticks: 400 });
  const s2 = driveScript({ behavior: 'periodic', spellId: 1, startTick: 30, periodTicks: 90 }, [1], [1], { seed: 55, ticks: 400 });
  eq(s1.intents.join(''), s2.intents.join(''), 'same config + seed replays an identical intent sequence');

  // --- 5. canWizardCast gate matches the sim's own acceptance -----------
  const sim = new Sim({ seed: 1, loadouts: [makeLoadout([18]), makeLoadout([1])], rules: { timer: false, pressure: false } });
  eq(canWizardCast(sim, 0, 18), false, 'Amplify (charge-cost) is not castable with 0 charges');
  sim.wizards[0].charges = 1;
  eq(canWizardCast(sim, 0, 18), true, 'Amplify becomes castable once a charge is available');
  eq(canWizardCast(sim, 0, 99), false, 'an unequipped spell id is never castable');

  return report('scriptBot');
}
