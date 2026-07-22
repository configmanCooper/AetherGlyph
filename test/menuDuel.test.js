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
  duel.stepTicks(3600);
  ok(!duel.sim.ended, 'title duel never ends');
  ok(duel.sim.wizards.every((wizard) => wizard.health > 0 && wizard.health <= MATCH.startHealth),
    'title duel wizards remain alive within normal health bounds');
  eq(duel.castVariety().size, 36,
    'title duel cycles through every public spell within one minute');
  ok(duel.sim.wizards[0].arcPos > 0 && duel.sim.wizards[1].arcPos < 0,
    'title duel keeps the player-side wizard right and back wizard left');

  const replayA = new MenuDuel({ seed: 123 });
  const replayB = new MenuDuel({ seed: 123 });
  replayA.stepTicks(900);
  replayB.stepTicks(900);
  eq(replayA.sim.hash(), replayB.sim.hash(), 'title duel is deterministic for a fixed seed');

  return report('menuDuel');
}
