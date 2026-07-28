import { createHarness } from './tiny.js';
import { MemoryRatingStore } from '../server/ratings.js';

export async function run() {
  const { eq, report } = createHarness();
  const store = await new MemoryRatingStore().init();
  const players = [{ accountId: 'rating-a' }, { accountId: 'rating-b' }];

  const unranked = await store.recordResult({
    matchId: 'unranked-result',
    ranked: false,
    players,
    winnerSlot: 0,
  });
  eq(unranked.deltas[0], 0, 'unranked winner receives no rating change');
  eq(unranked.deltas[1], 0, 'unranked loser receives no rating change');

  const ranked = await store.recordResult({
    matchId: 'ranked-result',
    ranked: true,
    players,
    winnerSlot: 0,
  });
  eq(ranked.deltas[0], 12, 'ranked winner receives the existing Elo gain');
  eq(ranked.deltas[1], -12, 'ranked loser receives the existing Elo loss');

  return report('ratings');
}
