// series.test.js — best-of-three series rules, round reset, determinism.

import { createHarness } from './tiny.js';
import { Series, runSeries, SERIES } from '../shared/src/sim/match.js';
import { presetLoadout, PRESETS } from '../shared/src/balance/loadouts.js';
import { makeBots } from '../shared/src/bot/bot.js';

function sourcesFor(seed) {
  return (sim, ri) => {
    const bots = makeBots((seed + ri * 17) >>> 0, 'magus', 'archmage');
    return [(x) => bots[0].act(x), (x) => bots[1].act(x)];
  };
}

export function run() {
  const { ok, eq, report } = createHarness();

  // Series score logic: first to 2 wins.
  const s = new Series({ loadouts: [presetLoadout('ember-rush'), presetLoadout('tide-control')] });
  s.recordRound({ winner: 0 });
  ok(!s.decided, 'series not decided at 1-0');
  s.recordRound({ winner: 1 });
  ok(!s.decided, 'series not decided at 1-1');
  s.recordRound({ winner: 0 });
  ok(s.decided && s.winner === 0, 'first to two round wins takes the series (2-1)');
  eq(s.score.join('-'), '2-1', 'series score tracked');

  // A 2-0 sweep decides in two rounds (no third round played by runSeries).
  const swept = new Series({});
  swept.recordRound({ winner: 1 });
  swept.recordRound({ winner: 1 });
  ok(swept.decided && swept.winner === 1 && swept.roundIndex === 2, '2-0 sweep decides early');

  // Round reset preserves loadouts across rounds (fresh Sim, same loadout ids).
  const series = new Series({ loadouts: [presetLoadout('storm-tempo'), presetLoadout('stone-warden')] });
  const simA = series.newRoundSim();
  const idsA = simA.wizards.map((w) => w.loadoutIds.join(','));
  series.recordRound({ winner: 0 });
  const simB = series.newRoundSim();
  const idsB = simB.wizards.map((w) => w.loadoutIds.join(','));
  eq(idsA[0], idsB[0], 'player loadout preserved across rounds');
  eq(idsA[1], idsB[1], 'opponent loadout preserved across rounds');
  ok(simB.wizards[0].health === 100 && simB.wizards[0].charges === 0, 'round state resets (full health, no charges)');
  ok(simB !== simA, 'each round uses a fresh sim');

  // A full headless best-of-three always decides and never exceeds max rounds.
  const r = runSeries({
    seed: 4242,
    loadouts: [presetLoadout('gale-trickster'), presetLoadout('arcane-combo')],
    makeSources: sourcesFor(4242),
  });
  ok(r.winner === 0 || r.winner === 1 || r.winner === 'draw', 'series produces a decision');
  ok(r.roundsPlayed <= SERIES.maxRounds, 'series never exceeds three rounds');
  ok(r.score[0] >= SERIES.roundsToWin || r.score[1] >= SERIES.roundsToWin || r.roundsPlayed === SERIES.maxRounds,
    'series ends on a 2-win or after three rounds');

  // Determinism: identical seed + loadouts -> identical series outcome.
  const cfg = { seed: 777, loadouts: [presetLoadout('umbra-attrition'), presetLoadout('prismatic-hybrid')] };
  const r1 = runSeries({ ...cfg, makeSources: sourcesFor(777) });
  const r2 = runSeries({ ...cfg, makeSources: sourcesFor(777) });
  eq(r1.score.join('-'), r2.score.join('-'), 'series score is deterministic');
  eq(r1.winner, r2.winner, 'series winner is deterministic');
  eq(r1.roundsPlayed, r2.roundsPlayed, 'series length is deterministic');

  // Every preset-vs-preset series terminates cleanly (no cap hits).
  let clean = true;
  for (let i = 0; i < PRESETS.length; i++) {
    const j = (i + 3) % PRESETS.length;
    const res = runSeries({
      seed: 900 + i,
      loadouts: [presetLoadout(PRESETS[i].key), presetLoadout(PRESETS[j].key)],
      makeSources: sourcesFor(900 + i),
    });
    if (res.rounds.some((rd) => rd.hitCap)) clean = false;
  }
  ok(clean, 'preset series never hit the hard tick cap');

  return report('series');
}
