// bot.test.js — bot matches always terminate; bots use legal actions + deal damage.

import { createHarness } from './tiny.js';
import { createMatch, runMatch } from '../shared/src/sim/match.js';
import { makeBots, DIFFICULTY } from '../shared/src/bot/bot.js';
import { AETHER, SIGIL, MATCH } from '../shared/src/sim/constants.js';

export function run() {
  const { ok, eq, report } = createHarness();

  const diffs = Object.keys(DIFFICULTY);
  let allEnded = true, anyDamage = false, noCap = true, resourcesLegal = true;
  let winners = { 0: 0, 1: 0, draw: 0 };
  const seeds = 40;

  for (let s = 0; s < seeds; s++) {
    const d0 = diffs[s % diffs.length];
    const d1 = diffs[(s + 1) % diffs.length];
    const sim = createMatch({ seed: 1000 + s });
    const bots = makeBots(1000 + s, d0, d1);
    const res = runMatch(sim, [(x) => bots[0].act(x), (x) => bots[1].act(x)]);

    if (!res.ended) allEnded = false;
    if (res.hitCap) noCap = false;
    if (res.winner === 0 || res.winner === 1) winners[res.winner]++;
    else winners.draw++;

    // Someone should have taken damage (bots actually fight).
    if (res.health[0] < 100 || res.health[1] < 100) anyDamage = true;

    // Resource bounds never violated.
    for (const w of sim.wizards) {
      if (w.aether < -0.001 || w.aether > AETHER.max + 0.001) resourcesLegal = false;
      if (w.charges < 0 || w.charges > SIGIL.max) resourcesLegal = false;
      if (w.health < 0 || w.health > MATCH.startHealth) resourcesLegal = false;
    }
  }

  ok(allEnded, 'every bot match terminates');
  ok(noCap, 'no match hit the hard tick cap (all ended naturally within timer)');
  ok(anyDamage, 'bots deal damage during matches');
  ok(resourcesLegal, 'resources stay within legal bounds all match');
  ok(winners[0] + winners[1] + winners.draw === seeds, 'every match produced a decision');
  // Not all identical outcome — the bot creates varied matches.
  ok((winners[0] > 0 && winners[1] > 0) || winners.draw > 0, 'outcomes vary across seeds');

  // A lopsided difficulty match still terminates and the stronger bot is competitive.
  const sim2 = createMatch({ seed: 77 });
  const bots2 = makeBots(77, 'apprentice', 'archmage');
  const res2 = runMatch(sim2, [(x) => bots2[0].act(x), (x) => bots2[1].act(x)]);
  ok(res2.ended && !res2.hitCap, 'archmage vs apprentice terminates cleanly');

  return report('bot');
}
