// match.js — headless match harness tying the pure Sim to two intent sources.
//
// Used by tests, the balance runner, and the offline client (bot duel /
// practice). Intent sources are functions (sim) => intent; a DuelBot's `act`
// method fits directly. Runs to a natural end (health/timer) with a hard tick
// cap safety net so a match can never hang.

import { Sim } from './sim.js';
import { starterLoadout } from '../balance/loadouts.js';
import { TICK_HZ, MATCH } from './constants.js';

const HARD_TICK_CAP = Math.ceil((MATCH.roundLimitS + 2) * TICK_HZ);

export function createMatch(opts = {}) {
  const loadouts = opts.loadouts || [starterLoadout(), starterLoadout()];
  return new Sim({ seed: opts.seed ?? 12345, loadouts });
}

// sources: [fn0, fn1] each (sim) => intent. Returns a result summary.
export function runMatch(sim, sources, opts = {}) {
  const cap = opts.tickCap || HARD_TICK_CAP;
  const collectEvents = opts.collectEvents ? [] : null;
  let steps = 0;
  while (!sim.ended && steps < cap) {
    const intents = {
      0: sources[0] ? sources[0](sim) : {},
      1: sources[1] ? sources[1](sim) : {},
    };
    const evs = sim.step(intents);
    if (collectEvents) for (const e of evs) collectEvents.push(e);
    steps += 1;
  }
  return {
    ended: sim.ended,
    winner: sim.winner,
    endReason: sim.endReason,
    ticks: sim.tick,
    timeS: sim.timeS,
    health: [sim.wizards[0].health, sim.wizards[1].health],
    hitCap: steps >= cap,
    events: collectEvents,
  };
}
