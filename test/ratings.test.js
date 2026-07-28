import { createHarness } from './tiny.js';
import {
  MemoryRatingStore, DEFAULT_GLYPHS, glyphTransfer, nextGlyphs,
  quarterStart, resetGlyphTotal, seasonKey, validateTemporaryCredentials,
} from '../server/ratings.js';

export async function run() {
  const { ok, eq, report } = createHarness();

  eq(DEFAULT_GLYPHS, 100, 'new ranked wizards start with 100 Glyphs');
  eq(glyphTransfer(100, 100), 25, 'equal Glyph totals transfer 25');
  eq(glyphTransfer(100, 300), 45, 'major underdog victory approaches the high end');
  eq(glyphTransfer(300, 100), 5, 'heavy favorite victory reaches the minimum');
  eq(glyphTransfer(0, 1000), 50, 'Glyph transfer is capped at 50');

  const equal = nextGlyphs(100, 100, 0);
  eq(equal.glyphs[0], 125, 'equal winner receives 25 Glyphs');
  eq(equal.glyphs[1], 75, 'equal loser loses 25 Glyphs');
  const protectedLoser = nextGlyphs(100, 10, 0);
  eq(protectedLoser.glyphs[0], 116, 'winner receives the full calculated transfer');
  eq(protectedLoser.glyphs[1], 0, 'loser cannot fall below zero');
  eq(protectedLoser.deltas[1], -10, 'low-Glyph loser only loses available Glyphs');
  eq(nextGlyphs(100, 100, 'draw').transfer, 0, 'draws transfer no Glyphs');

  eq(resetGlyphTotal(1400), 1150, 'quarterly reset compresses 1400 to 1150');
  eq(resetGlyphTotal(1200), 1150, 'exact 300 multiple resets to fifty below it');
  eq(resetGlyphTotal(899), 550, 'quarterly reset uses the next-lowest 300 multiple');
  eq(resetGlyphTotal(100), 0, 'literal quarterly rule can reset low totals to zero');
  eq(seasonKey(new Date('2026-07-01T00:00:00Z')), '2026-Q3', 'season keys use UTC quarters');
  eq(validateTemporaryCredentials('Bad Name', '123456').code, 'invalid-username',
    'temporary usernames reject spaces');
  eq(validateTemporaryCredentials('Wizard7', '12345a').code, 'invalid-pin',
    'temporary PIN requires exactly six digits');

  const currentStart = quarterStart(new Date());
  const nextStart = new Date(Date.UTC(
    currentStart.getUTCFullYear(),
    currentStart.getUTCMonth() + 3,
    1,
  ));
  const store = await new MemoryRatingStore().init(new Date());
  const createdAccount = await store.authenticateTemporary('Wizard7', '123456');
  ok(createdAccount.ok && createdAccount.created, 'new username and PIN create an account');
  eq(createdAccount.profile.glyphs, 100, 'new username account starts with 100 Glyphs');
  const storedCredential = store.credentials.get('wizard7');
  ok(storedCredential.hash !== '123456', 'PIN is stored as a derived hash, not plaintext');
  const wrongPin = await store.authenticateTemporary('Wizard7', '654321');
  eq(wrongPin.code, 'name-taken', 'existing username rejects an incorrect PIN');
  const login = await store.authenticateTemporary('wizard7', '123456');
  ok(login.ok && !login.created, 'existing username accepts its correct PIN case-insensitively');
  eq(login.accountId, createdAccount.accountId, 'username login restores the same ranking account');
  const restoredSession = await store.resolveTemporarySession(login.token);
  eq(restoredSession.accountId, createdAccount.accountId, 'session token restores the database account');
  const concurrentStore = await new MemoryRatingStore().init();
  const concurrent = await Promise.all([
    concurrentStore.authenticateTemporary('RaceWizard', '123456'),
    concurrentStore.authenticateTemporary('racewizard', '654321'),
  ]);
  eq(concurrent.filter((result) => result.created).length, 1,
    'concurrent case-insensitive registrations create only one username account');
  eq(concurrentStore.credentials.size, 1,
    'memory account store retains one credential for a racing username');
  await concurrentStore.close();
  const players = [
    { accountId: 'glyph-a', name: 'Alpha' },
    { accountId: 'glyph-b', name: 'Beta' },
  ];

  const accountCountBeforeUnranked = store.accounts.size;
  const unranked = await store.recordResult({
    matchId: 'unranked-result',
    ranked: false,
    players,
    winnerSlot: 0,
  });
  eq(unranked.applied, false, 'unranked match does not enter ranking persistence');
  eq(store.accounts.size, accountCountBeforeUnranked, 'unranked match creates no ranking accounts');

  const ranked = await store.recordResult({
    matchId: 'ranked-result',
    ranked: true,
    players,
    winnerSlot: 0,
  });
  eq(ranked.players[0].glyphsAfter, 125, 'ranked winner gains Glyphs');
  eq(ranked.players[1].glyphsAfter, 75, 'ranked loser loses Glyphs');
  eq(ranked.players[0].rank, 1, 'ranked winner receives world rank');
  eq(ranked.players[1].rank, 2, 'ranked loser receives world rank');

  const duplicate = await store.recordResult({
    matchId: 'ranked-result',
    ranked: true,
    players,
    winnerSlot: 0,
  });
  eq(duplicate.applied, false, 'duplicate match id cannot award Glyphs twice');
  eq(await store.getGlyphs('glyph-a'), 125, 'duplicate result leaves winner total unchanged');

  const board = await store.getLeaderboard('glyph-b', 'Beta', 10);
  eq(board.top.length, 2, 'leaderboard contains ranked participants');
  eq(board.top[0].name, 'Alpha', 'leaderboard orders highest Glyph total first');
  eq(board.self.rank, 2, 'leaderboard returns the requesting wizard rank');

  const alpha = store.accounts.get('glyph-a');
  const beta = store.accounts.get('glyph-b');
  alpha.glyphs = 1400;
  beta.glyphs = 100;
  const reset = await store.ensureCurrentSeason(nextStart);
  ok(reset.applied, 'first day of the next quarter applies a reset');
  eq(alpha.glyphs, 1150, 'season reset applies the 300-minus-50 rule');
  eq(beta.glyphs, 0, 'season reset preserves the zero floor');
  const repeated = await store.ensureCurrentSeason(new Date(nextStart.getTime() + 14 * 86400000));
  eq(repeated.applied, false, 'quarterly reset is idempotent within a season');

  await store.close();

  const largeBoard = await new MemoryRatingStore().init();
  for (let i = 1; i <= 105; i++) {
    const account = largeBoard.ensureAccount(`rank-${i}`, `Wizard${i}`);
    account.rankedGames = 1;
    account.wins = i;
    account.glyphs = 1000 - i;
  }
  const topHundred = await largeBoard.getLeaderboard('rank-105', 'Wizard105', 100);
  eq(topHundred.top.length, 100, 'world rankings return only the top 100');
  eq(topHundred.self.rank, 105, 'wizard outside the top 100 still sees their world rank');
  await largeBoard.close();

  return report('ratings');
}
