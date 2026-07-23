// gesture.test.js — recognizer resample/normalize, per-spell classification,
// ambiguity rejection, loadout-only classification, diagnostics.

import { createHarness } from './tiny.js';
import { Recognizer, resample, normalize, preprocess } from '../shared/src/gesture/recognizer.js';
import { GESTURE_TEMPLATES, buildTemplates } from '../shared/src/gesture/templates.js';
import { starterLoadout, STARTER_GESTURE_KEYS, GESTURE_KEYS } from '../shared/src/balance/loadouts.js';

// Add small deterministic jitter to a path to simulate a human trace.
function jitter(pts, amp, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s / 4294967296) - 0.5; };
  return pts.map((p) => ({ x: p.x + rnd() * amp, y: p.y + rnd() * amp }));
}

function denseNoisyPath(points, samplesPerEdge, noise, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296) - 0.5; };
  const out = [];
  for (let edge = 0; edge < points.length - 1; edge++) {
    for (let i = 0; i < samplesPerEdge; i++) {
      const t = i / samplesPerEdge;
      out.push({
        x: points[edge].x + (points[edge + 1].x - points[edge].x) * t + rnd() * noise,
        y: points[edge].y + (points[edge + 1].y - points[edge].y) * t + rnd() * noise,
      });
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
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
  const full = new Recognizer(templates);

  let fullCorrect = 0, fullTotal = 0;
  for (const [id, key] of Object.entries(GESTURE_KEYS)) {
    for (const variant of GESTURE_TEMPLATES[key]) {
      fullTotal++;
      const result = full.recognize(variant);
      if (result.accepted && result.spellId === Number(id)) fullCorrect++;
    }
  }
  eq(fullCorrect, fullTotal, `full-roster duel recognition identifies every canonical glyph (${fullCorrect}/${fullTotal})`);

  let blinkQuakeCorrect = 0;
  for (const [key, expected] of [['doubleStroke', 14], ['quakeSlash', 34]]) {
    for (let seed = 1; seed <= 100; seed++) {
      const rough = jitter(GESTURE_TEMPLATES[key][0], 20, seed * 193);
      const result = full.recognize(rough);
      if (result.accepted && result.spellId === expected) blinkQuakeCorrect++;
    }
  }
  eq(blinkQuakeCorrect, 200,
    'rough Blink and Quake traces remain distinct through their horizontal/vertical opening strokes');

  const roughDiamond = resample(GESTURE_TEMPLATES.diamond[0], 7);
  let barrierCorrect = 0, groundingCorrect = 0, circleDiamondCrosscasts = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const barrier = full.recognize(jitter(GESTURE_TEMPLATES.circle[0], 8, seed * 197));
    const grounding = full.recognize(jitter(roughDiamond, 4, seed * 197));
    if (barrier.accepted && barrier.spellId === 11) barrierCorrect++;
    if (grounding.accepted && grounding.spellId === 20) groundingCorrect++;
    if ((barrier.accepted && barrier.spellId === 20) || (grounding.accepted && grounding.spellId === 11)) {
      circleDiamondCrosscasts++;
    }
  }
  ok(barrierCorrect >= 190, `rough Barrier circles remain recognizable (${barrierCorrect}/200)`);
  ok(groundingCorrect >= 170, `rough Grounding diamonds remain recognizable (${groundingCorrect}/200)`);
  eq(circleDiamondCrosscasts, 0, 'rough circles and diamonds never cross-cast as each other');

  let denseBarrier = 0, denseGrounding = 0, denseCrosscasts = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const barrier = full.recognize(denseNoisyPath(GESTURE_TEMPLATES.circle[0], 4, 5, seed * 211));
    const grounding = full.recognize(denseNoisyPath(GESTURE_TEMPLATES.diamond[0], 12, 5, seed * 211));
    if (barrier.accepted && barrier.spellId === 11) denseBarrier++;
    if (grounding.accepted && grounding.spellId === 20) denseGrounding++;
    if ((barrier.accepted && barrier.spellId === 20) || (grounding.accepted && grounding.spellId === 11)) {
      denseCrosscasts++;
    }
  }
  ok(denseBarrier >= 195, `dense noisy phone circles remain Barrier Dome (${denseBarrier}/200)`);
  ok(denseGrounding >= 190, `dense noisy phone diamonds remain Grounding Mantle (${denseGrounding}/200)`);
  eq(denseCrosscasts, 0, 'dense noisy circles and diamonds never cross-cast');

  const sparseCircle = GESTURE_TEMPLATES.circle[0].filter((_, i) => i % 4 === 0);
  const sparseDispel = GESTURE_TEMPLATES.circleCCW[0].filter((_, i) => i % 4 === 0);
  const sparseDiamond = resample(GESTURE_TEMPLATES.diamond[0], 7);
  let sparseBarrier = 0, sparseDispelCorrect = 0, sparseGrounding = 0, sparseCircleCrosscasts = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const barrier = full.recognize(jitter(sparseCircle, 6, seed * 223));
    const dispel = full.recognize(jitter(sparseDispel, 6, seed * 223));
    const grounding = full.recognize(jitter(sparseDiamond, 4, seed * 223));
    if (barrier.accepted && barrier.spellId === 11) sparseBarrier++;
    if (dispel.accepted && dispel.spellId === 13) sparseDispelCorrect++;
    if (grounding.accepted && grounding.spellId === 20) sparseGrounding++;
    if (barrier.accepted && barrier.spellId === 20) sparseCircleCrosscasts++;
  }
  ok(sparseBarrier >= 190, `sparse phone circles remain Barrier Dome (${sparseBarrier}/200)`);
  ok(sparseDispelCorrect >= 180, `sparse counterclockwise circles remain Dispel (${sparseDispelCorrect}/200)`);
  ok(sparseGrounding >= 180, `sparse phone diamonds remain Grounding Mantle (${sparseGrounding}/200)`);
  eq(sparseCircleCrosscasts, 0, 'sparse Barrier circles never cross-cast as Grounding Mantle');

  const fiveCircle = full.recognize(resample(GESTURE_TEMPLATES.circle[0], 5));
  const fiveDiamond = full.recognize(resample(GESTURE_TEMPLATES.diamond[0], 5));
  eq(fiveCircle.reason, 'ambiguous', 'five-sample closed loop is rejected instead of guessed as Grounding');
  eq(fiveDiamond.reason, 'ambiguous', 'five-sample diamond is rejected until enough geometry exists');
  const sixCircle = resample(GESTURE_TEMPLATES.circle[0], 6);
  const sixDiamond = resample(GESTURE_TEMPLATES.diamond[0], 6);
  let sixPointCrosscasts = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const barrier = full.recognize(jitter(sixCircle, 4, seed * 227));
    const grounding = full.recognize(jitter(sixDiamond, 4, seed * 227));
    if ((barrier.accepted && barrier.spellId === 20) || (grounding.accepted && grounding.spellId === 11)) {
      sixPointCrosscasts++;
    }
  }
  eq(sixPointCrosscasts, 0, 'six-sample closed traces remain neutral instead of cross-casting');
  for (let count = 7; count <= 11; count++) {
    eq(full.recognize(resample(GESTURE_TEMPLATES.circle[0], count)).spellId, 11,
      `${count}-sample circle remains Barrier Dome`);
    eq(full.recognize(resample(GESTURE_TEMPLATES.diamond[0], count)).spellId, 20,
      `${count}-sample diamond remains Grounding Mantle`);
  }

  const forgivingBarrier = full.recognize(jitter(GESTURE_TEMPLATES.circle[0], 10, 188));
  ok(forgivingBarrier.accepted && forgivingBarrier.spellId === 11,
    `high-scoring round Barrier accepts a narrow margin (${forgivingBarrier.margin.toFixed(3)})`);
  eq(forgivingBarrier.requiredMargin, 0.005, 'round Barrier uses the reduced ambiguity margin');

  let fireballCorrect = 0, groundingVsFireball = 0, stoneWallCorrect = 0, veilCorrect = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const fireball = full.recognize(denseNoisyPath(GESTURE_TEMPLATES.triangleCW[0], 4, 5, seed * 233));
    const grounding = full.recognize(denseNoisyPath(GESTURE_TEMPLATES.diamond[0], 4, 5, seed * 233));
    const wall = full.recognize(jitter(GESTURE_TEMPLATES.lowSquare[0], 12, seed * 229));
    const veil = full.recognize(jitter(GESTURE_TEMPLATES.knot[0], 10, seed * 229));
    if (fireball.accepted && fireball.spellId === 8) fireballCorrect++;
    if ((fireball.accepted && fireball.spellId === 20) || (grounding.accepted && grounding.spellId === 8)) groundingVsFireball++;
    if (wall.accepted && wall.spellId === 15) stoneWallCorrect++;
    if (veil.accepted && veil.spellId === 25) veilCorrect++;
  }
  ok(fireballCorrect >= 195, `rough Fireball triangles remain Fireball (${fireballCorrect}/200)`);
  eq(groundingVsFireball, 0, 'Fireball triangles and Grounding diamonds never cross-cast');
  ok(stoneWallCorrect >= 195, `rough Stone Wall U-shapes meet confidence (${stoneWallCorrect}/200)`);
  ok(veilCorrect >= 195, `wider Veil ribbon remains recognizable (${veilCorrect}/200)`);
  let arcaneMissileCorrect = 0, basicFlickMiscasts = 0, phoenixMissileMiscasts = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const missile = full.recognize(jitter(GESTURE_TEMPLATES.arcUp[0], 12, seed * 239));
    const flick = full.recognize(jitter(GESTURE_TEMPLATES.flickRight[0], 8, seed * 239));
    const phoenix = full.recognize(jitter(GESTURE_TEMPLATES.phoenixWing[0], 8, seed * 239));
    if (missile.accepted && missile.spellId === 5) arcaneMissileCorrect++;
    if (flick.accepted && flick.spellId === 5) basicFlickMiscasts++;
    if (phoenix.accepted && phoenix.spellId === 5) phoenixMissileMiscasts++;
  }
  ok(arcaneMissileCorrect >= 195, `rough Arcane Missile arcs remain recognizable (${arcaneMissileCorrect}/200)`);
  eq(basicFlickMiscasts, 0, 'Ember Bolt flicks do not become Arcane Missile');
  eq(phoenixMissileMiscasts, 0, 'Phoenix Covenant wings do not become Arcane Missile');
  eq(full.recognize(GESTURE_TEMPLATES.arcUp[0]).requiredMargin, 0.01,
    'high-confidence Arcane Missile uses the forgiving ambiguity margin');
  const chainNearMiss = [
    { x: -5.1, y: 23.1 }, { x: 33.4, y: 77.5 }, { x: 37.8, y: 28.4 },
    { x: 59.6, y: 78.1 }, { x: 81.4, y: 27.0 }, { x: 94.4, y: 77.4 },
  ];
  const forgivingChain = full.recognize(chainNearMiss);
  ok(forgivingChain.accepted && forgivingChain.spellId === 7,
    `0.82-style long zigzag casts Chain Lightning (${forgivingChain.best.score.toFixed(2)})`);
  eq(forgivingChain.requiredMargin, 0.02,
    'high-confidence Chain Lightning uses the forgiving ambiguity margin');
  let chainCorrect = 0, sparkChainMiscasts = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const chain = full.recognize(jitter(GESTURE_TEMPLATES.longZigzag[0], 25, seed * 193));
    const spark = full.recognize(jitter(GESTURE_TEMPLATES.zigzag[0], 16, seed * 193));
    if (chain.accepted && chain.spellId === 7) chainCorrect++;
    if (spark.accepted && spark.spellId === 7) sparkChainMiscasts++;
  }
  ok(chainCorrect >= 165, `rough Chain Lightning zigzags remain recognizable (${chainCorrect}/200)`);
  eq(sparkChainMiscasts, 0, 'rough Spark Dart zigzags never cross-cast as Chain Lightning');
  let thunderclapCorrect = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const thunder = full.recognize(jitter(GESTURE_TEMPLATES.twinLines[0], 12, seed * 241));
    if (thunder.accepted && thunder.spellId === 30) thunderclapCorrect++;
  }
  ok(thunderclapCorrect >= 195, `rough Thunderclap twin lines remain recognizable (${thunderclapCorrect}/200)`);
  eq(full.recognize(GESTURE_TEMPLATES.twinLines[0]).requiredMargin, 0.015,
    'high-confidence Thunderclap uses the forgiving ambiguity margin');
  const concussiveXs = GESTURE_TEMPLATES.arc.flat().map((point) => point.x);
  ok(Math.min(...concussiveXs) >= 0 && Math.max(...concussiveXs) <= 100,
    'Concussive Blast guide stays fully inside the draw pad');
  const veilXs = GESTURE_TEMPLATES.knot[0].map((point) => point.x);
  const veilYs = GESTURE_TEMPLATES.knot[0].map((point) => point.y);
  ok(Math.max(...veilXs) - Math.min(...veilXs) >= 60 && Math.max(...veilYs) - Math.min(...veilYs) >= 55,
    'Veil Hex guide is spread out for readability');

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
