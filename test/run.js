// run.js — Aetherglyph headless test suite entry. No test framework deps.
// Runs each focused module and aggregates pass/fail. `npm test`.

import { run as spells } from './spells.test.js';
import { run as determinism } from './determinism.test.js';
import { run as resources } from './resources.test.js';
import { run as casting } from './casting.test.js';
import { run as status } from './status.test.js';
import { run as bot } from './bot.test.js';
import { run as gesture } from './gesture.test.js';
import { run as effects } from './effects.test.js';
import { run as reactions } from './reactions.test.js';
import { run as loadout } from './loadout.test.js';
import { run as series } from './series.test.js';
import { run as secret } from './secret.test.js';
import { run as templates } from './templates.test.js';
import { run as net } from './net.test.js';
import { run as onlineMatch } from './onlineMatch.test.js';
import { run as serverConfig } from './serverConfig.test.js';
import { run as tutorialProgress } from './tutorialProgress.test.js';
import { run as tutorialCampaign } from './tutorialCampaign.test.js';
import { run as tutorialRunner } from './tutorialRunner.test.js';
import { run as scriptBot } from './scriptBot.test.js';
import { run as practiceBot } from './practiceBot.test.js';
import { run as coaching } from './coaching.test.js';
import { run as gust } from './gust.test.js';
import { run as lab } from './lab.test.js';
import { run as spellVfx } from './spellVfx.test.js';
import { run as cooldowns } from './cooldowns.test.js';
import { run as protection } from './protection.test.js';

console.log('Aetherglyph Phase 2 test suite');
console.log('--------------------------------');

const modules = [
  ['spells', spells],
  ['determinism', determinism],
  ['resources', resources],
  ['casting', casting],
  ['status', status],
  ['effects', effects],
  ['reactions', reactions],
  ['loadout', loadout],
  ['series', series],
  ['secret', secret],
  ['templates', templates],
  ['net', net],
  ['onlineMatch', onlineMatch],
  ['serverConfig', serverConfig],
  ['bot', bot],
  ['gesture', gesture],
  ['tutorialProgress', tutorialProgress],
  ['tutorialCampaign', tutorialCampaign],
  ['tutorialRunner', tutorialRunner],
  ['scriptBot', scriptBot],
  ['practiceBot', practiceBot],
  ['coaching', coaching],
  ['gust', gust],
  ['lab', lab],
  ['spellVfx', spellVfx],
  ['cooldowns', cooldowns],
  ['protection', protection],
];

let pass = 0, fail = 0;
for (const [, fn] of modules) {
  const r = await fn();
  pass += r.pass; fail += r.fail;
}

console.log('--------------------------------');
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
