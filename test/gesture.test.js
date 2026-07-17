// gesture.test.js — recognizer resample/normalize, per-spell classification,
// ambiguity rejection, loadout-only classification, diagnostics.

import { createHarness } from './tiny.js';
import { Recognizer, resample, normalize, preprocess } from '../shared/src/gesture/recognizer.js';
import { GESTURE_TEMPLATES, buildTemplates } from '../shared/src/gesture/templates.js';
import { starterLoadout, STARTER_GESTURE_KEYS } from '../shared/src/balance/loadouts.js';

// Add small deterministic jitter to a path to simulate a human trace.
function jitter(pts, amp, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s / 4294967296) - 0.5; };
  return pts.map((p) => ({ x: p.x + rnd() * amp, y: p.y + rnd() * amp }));
}

export function run() {
  const { ok, eq, near, report } = createHarness();

  // Resample yields the requested point count.
  const rs = resample([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 24);
  eq(rs.length, 24, 'resample to 24 points');

  // Normalize centers the shape near origin.
  const nm = normalize(rs);
  const cx = nm.reduce((s, p) => s + p.x, 0) / nm.length;
  near(cx, 0, 0.001, 'normalize centers x at ~0');

  const templates = buildTemplates();
  ok(templates.length >= 8, 'templates built for starter gestures');
  const loadout = starterLoadout();
  const rec = new Recognizer(templates).forLoadout(loadout);

  // Each starter gesture's own template classifies to its spell, even jittered.
  const keyToId = {};
  for (const [id, key] of Object.entries(STARTER_GESTURE_KEYS)) keyToId[key] = Number(id);
  let correct = 0, total = 0;
  for (const [key, variants] of Object.entries(GESTURE_TEMPLATES)) {
    const expectId = keyToId[key];
    if (expectId == null) continue; // only the starter loadout is scoped into `rec`
    for (let v = 0; v < variants.length; v++) {
      for (let seed = 1; seed <= 3; seed++) {
        total++;
        const input = jitter(variants[v], 4, seed * 97 + v);
        const r = rec.recognize(input);
        if (r.accepted && r.spellId === expectId) correct++;
      }
    }
  }
  ok(correct / total >= 0.9, `starter gestures classify correctly (${correct}/${total})`);

  // A clean vertical line up = Frost Lance (id 2), not any other spell.
  const up = rec.recognize([{ x: 50, y: 95 }, { x: 50, y: 50 }, { x: 50, y: 5 }]);
  ok(up.accepted && up.spellId === 2, 'vertical line -> Frost Lance');

  // A clean horizontal line = Ember Bolt (id 1).
  const right = rec.recognize([{ x: 5, y: 50 }, { x: 50, y: 50 }, { x: 95, y: 50 }]);
  ok(right.accepted && right.spellId === 1, 'horizontal line -> Ember Bolt');

  // Diagnostics: scores sorted, best/second/margin exposed.
  ok(Array.isArray(right.scores) && right.scores.length > 0, 'diagnostics expose scores');
  ok(right.best && typeof right.margin === 'number', 'diagnostics expose best + margin');

  // Too-few-points input rejected with a reason.
  const few = rec.recognize([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  eq(few.accepted, false, 'too-few-points rejected');
  eq(few.reason, 'too-few-points', 'reason reported');

  // Loadout scoping: a recognizer restricted to a single-spell loadout only
  // classifies that spell.
  const singles = new Recognizer(templates).forLoadout([loadout[0]]);
  eq(singles.templates.every((t) => t.spellId === loadout[0].id), true, 'loadout scoping limits templates');

  // Ambiguity margin: with a high margin requirement, a shape between two
  // templates should reject rather than miscast.
  const strict = new Recognizer(templates, { marginThreshold: 0.5 }).forLoadout(loadout);
  const ambiguous = strict.recognize([{ x: 10, y: 60 }, { x: 50, y: 55 }, { x: 90, y: 52 }]);
  ok(!ambiguous.accepted ? true : ambiguous.margin >= 0.5, 'ambiguity margin enforced');

  return report('gesture');
}
