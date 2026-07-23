import { createHarness } from './tiny.js';
import { MenuDuel, MENU_PUBLIC_SPELL_IDS } from '../client/src/game/menuDuel.js';
import { SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';
import { MATCH } from '../shared/src/sim/constants.js';

export function run() {
  const { ok, eq, report } = createHarness();

  eq(MENU_PUBLIC_SPELL_IDS.length, 36, 'title duel includes all 36 public spells');
  ok(MENU_PUBLIC_SPELL_IDS.every((id) => !SPELLS_BY_ID[id].secret),
    'title duel excludes every secret spell');

  const duel = new MenuDuel({ seed: 99 });
  ok(duel.bots.every((bot) => bot.difficulty === 'hard'),
    'both title duelists use Hard AI decision profiles');
  duel.stepTicks(7200);
  ok(!duel.sim.ended, 'title duel never ends');
  ok(duel.sim.wizards.every((wizard) => wizard.health > 0 && wizard.health <= MATCH.startHealth),
    'title duel wizards remain alive within normal health bounds');
  ok(duel.castVariety().size >= 28,
    `title duel shows broad variety within two minutes (${duel.castVariety().size} spells)`);
  const castGaps = duel.castStartTicks.slice(1).map((tick, i) => tick - duel.castStartTicks[i]);
  ok(castGaps.length > 10 && Math.min(...castGaps) >= 2 * 60,
    `title duel waits at least two seconds between spell starts (${Math.min(...castGaps)} ticks)`);
  ok(duel.arcRanges.every((range) => range.max - range.min >= 0.2),
    'both title wizards visibly move around within their side of the arena');
  duel.stepTicks(7200);
  eq(duel.castVariety().size, 36,
    'title duel eventually cycles through every public spell');
  ok(duel.sim.wizards[0].arcPos > 0 && duel.sim.wizards[1].arcPos < 0,
    'title duel keeps the player-side wizard right and back wizard left');

  const replayA = new MenuDuel({ seed: 123 });
  const replayB = new MenuDuel({ seed: 123 });
  replayA.stepTicks(900);
  replayB.stepTicks(900);
  eq(replayA.sim.hash(), replayB.sim.hash(), 'title duel is deterministic for a fixed seed');

  return report('menuDuel');
}
