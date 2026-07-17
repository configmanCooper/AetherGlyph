// gesture-audit.js — dev tool: measure how well the 40 gesture templates
// separate. Prints (a) all-40 worst-case classification of each spell's own
// jittered trace and (b) the most-confusable template pairs. Run:
//   node scripts/gesture-audit.js
// Not part of `npm test`; the formal within-loadout assertions live in
// test/templates.test.js.

import { Recognizer, preprocess, meanDistance, distanceToScore } from '../shared/src/gesture/recognizer.js';
import { GESTURE_TEMPLATES, buildTemplates } from '../shared/src/gesture/templates.js';
import { GESTURE_KEYS } from '../shared/src/balance/loadouts.js';
import { SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';

const keyToId = {};
for (const [id, key] of Object.entries(GESTURE_KEYS)) keyToId[key] = Number(id);

function jitter(pts, amp, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s / 4294967296) - 0.5; };
  return pts.map((p) => ({ x: p.x + rnd() * amp, y: p.y + rnd() * amp }));
}

const templates = buildTemplates();
const full = new Recognizer(templates);

// (a) worst-case: every template competes.
let miss = 0; const lowMargin = [];
for (const [key, variants] of Object.entries(GESTURE_TEMPLATES)) {
  const id = keyToId[key];
  let bad = 0, marginSum = 0, n = 0;
  for (let v = 0; v < variants.length; v++) {
    for (let seed = 1; seed <= 4; seed++) {
      const input = jitter(variants[v], 4, seed * 131 + v * 17);
      const r = full.recognize(input);
      n++; marginSum += r.margin || 0;
      if (!(r.accepted && r.spellId === id)) bad++;
    }
  }
  const avgMargin = (marginSum / n).toFixed(3);
  if (bad > 0) { miss++; console.log(`MISS  ${key} (#${id} ${SPELLS_BY_ID[id]?.name}) bad=${bad}/${n} avgMargin=${avgMargin}`); }
  else if (marginSum / n < 0.08) { lowMargin.push([key, id, avgMargin]); }
}
console.log(`\nAll-40 worst-case misses: ${miss}`);
for (const [key, id, m] of lowMargin.sort((a, b) => a[2] - b[2])) {
  console.log(`  low-margin ${key} (#${id} ${SPELLS_BY_ID[id]?.name}) avgMargin=${m}`);
}

// (b) template-vs-template confusion matrix (canonical, first variant).
const pre = {};
for (const [key, variants] of Object.entries(GESTURE_TEMPLATES)) pre[key] = preprocess(variants[0], 24);
const pairs = [];
const keys = Object.keys(pre);
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    const score = distanceToScore(meanDistance(pre[keys[i]], pre[keys[j]]));
    pairs.push([keys[i], keys[j], score]);
  }
}
pairs.sort((a, b) => b[2] - a[2]);
console.log('\nMost-confusable template pairs (higher = more similar):');
for (const [a, b, s] of pairs.slice(0, 18)) {
  console.log(`  ${s.toFixed(3)}  ${a} (#${keyToId[a]}) <-> ${b} (#${keyToId[b]})`);
}
