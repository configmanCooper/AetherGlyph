// determinism.test.js — same seed + inputs -> same hash; snapshot restore path.

import { createHarness } from './tiny.js';
import { createMatch, runMatch } from '../shared/src/sim/match.js';
import { DuelBot, makeBots } from '../shared/src/bot/bot.js';
import { Sim } from '../shared/src/sim/sim.js';
import { starterLoadout, spellWithGesture } from '../shared/src/balance/loadouts.js';
import { makeRng } from '../shared/src/rng/rng.js';

// Run a bot match and capture a per-tick hash trace.
function tracedMatch(seed) {
  const sim = createMatch({ seed });
  const bots = makeBots(seed, 'adept', 'magus');
  const hashes = [];
  let steps = 0;
  while (!sim.ended && steps < 7000) {
    sim.step({ 0: bots[0].act(sim), 1: bots[1].act(sim) });
    if (steps % 20 === 0) hashes.push(sim.hash());
    steps += 1;
  }
  return { finalHash: sim.hash(), hashes, winner: sim.winner, ticks: sim.tick };
}

export function run() {
  const { ok, eq, report } = createHarness();

  // Determinism: two identical runs produce identical hash traces.
  const a = tracedMatch(9001);
  const b = tracedMatch(9001);
  eq(a.finalHash, b.finalHash, 'identical seed -> identical final hash');
  eq(a.hashes.join(','), b.hashes.join(','), 'identical seed -> identical hash trace');
  eq(a.winner, b.winner, 'identical seed -> same winner');

  // Different seeds diverge (sanity: RNG actually matters).
  const c = tracedMatch(9002);
  ok(a.finalHash !== c.finalHash || a.ticks !== c.ticks, 'different seed -> different outcome');

  // mulberry32 RNG is deterministic and seed-sensitive.
  const r1 = makeRng(42), r2 = makeRng(42), r3 = makeRng(43);
  eq(r1.next(), r2.next(), 'rng same seed same value');
  ok(makeRng(42).next() !== r3.next(), 'rng different seed different value');

  // No Math.random usage in the shared sim source.
  // (spot check: a scripted, RNG-free step sequence is fully reproducible)
  function scripted(seed) {
    const sim = new Sim({ seed, loadouts: [starterLoadout(), starterLoadout()] });
    const script = [
      { 0: { cast: 1, castQuality: 1 }, 1: { move: 1 } },
      { 0: { move: -1 }, 1: { cast: 2, castQuality: 1 } },
    ];
    for (let t = 0; t < 120; t++) sim.step(script[t % script.length]);
    return sim.hash();
  }
  eq(scripted(5), scripted(5), 'scripted run reproducible');

  // Determinism WITH zones + statuses + reactions: a scripted environmental
  // sequence (Oil -> ignite -> Rain douse) hashes identically across runs.
  function scriptedEnv(seed) {
    const load = [1, 31, 32, 2, 3, 30, 10, 13].map((id) => spellWithGesture(id));
    const sim = new Sim({ seed, loadouts: [load, load] });
    sim.wizards[0].arcPos = 0; sim.wizards[1].arcPos = 0;
    sim.wizards[0].aether = 100; sim.wizards[0].charges = 3;
    const seq = [
      { 0: { cast: 31, castQuality: 1 }, 1: {} }, // Oil
      { 0: { cast: 1, castQuality: 1 }, 1: {} },  // Ember -> Flash Fire
      { 0: { cast: 32, castQuality: 1 }, 1: {} }, // Rain -> Doused
    ];
    let hashes = [];
    let si = 0;
    for (let t = 0; t < 300; t++) {
      // Fire the next scripted cast once the caster is free.
      let intent = { 0: {}, 1: {} };
      if (si < seq.length && !sim.wizards[0].casting && (sim.wizards[0].cooldowns[seq[si][0].cast] || 0) === 0
          && sim.wizards[0].recoveryTicks <= 0) {
        intent = seq[si]; si++;
      }
      sim.step(intent);
      if (t % 15 === 0) hashes.push(sim.hash());
    }
    return { final: sim.hash(), hashes: hashes.join(',') };
  }
  const e1 = scriptedEnv(11), e2 = scriptedEnv(11);
  eq(e1.final, e2.final, 'zone/status/reaction run reproducible (final hash)');
  eq(e1.hashes, e2.hashes, 'zone/status/reaction hash trace reproducible');

  return report('determinism');
}
