// run.js — Aetherglyph headless test suite entry. No test framework deps.
// Runs each focused module and aggregates pass/fail. `npm test`.

import { run as spells } from './spells.test.js';
import { run as determinism } from './determinism.test.js';
import { run as resources } from './resources.test.js';
import { run as casting } from './casting.test.js';
import { run as status } from './status.test.js';
import { run as bot } from './bot.test.js';
import { run as gesture } from './gesture.test.js';

console.log('Aetherglyph Phase 1 test suite');
console.log('--------------------------------');

const modules = [
  ['spells', spells],
  ['determinism', determinism],
  ['resources', resources],
  ['casting', casting],
  ['status', status],
  ['bot', bot],
  ['gesture', gesture],
];

let pass = 0, fail = 0;
for (const [, fn] of modules) {
  const r = fn();
  pass += r.pass; fail += r.fail;
}

console.log('--------------------------------');
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
