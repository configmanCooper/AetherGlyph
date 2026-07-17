// templates.test.js — every one of the 40 spell gestures must classify its own
// representative (jittered) trace correctly under legal loadouts, with an
// acceptable separation margin, and no template pair may be dangerously
// ambiguous.
//
// Key argument: the recognizer restricts to the equipped loadout, so classifying
// against ALL 40 templates at once is the STRICTEST case — every other spell
// competes. If a spell's own trace wins there, then in any legal 8-spell subset
// (fewer rivals) it wins by an equal-or-larger margin. We therefore assert the
// all-40 case AND spot-check real legal loadouts.

import { createHarness } from './tiny.js';
import { Recognizer, preprocess, meanDistance, distanceToScore } from '../shared/src/gesture/recognizer.js';
import { GESTURE_TEMPLATES, buildTemplates } from '../shared/src/gesture/templates.js';
import { GESTURE_KEYS, makeLoadout, validateLoadout, PRESETS } from '../shared/src/balance/loadouts.js';
import { SPELL_CATALOG, SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';

function jitter(pts, amp, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s / 4294967296) - 0.5; };
  return pts.map((p) => ({ x: p.x + rnd() * amp, y: p.y + rnd() * amp }));
}

// Greedily build a legal 8-spell / 14-point loadout that includes `reqId`.
function legalLoadoutContaining(reqId) {
  const ids = [reqId];
  const schools = {};
  let heavy = 0; let pts = 0;
  const acct = (sp) => { schools[sp.school] = (schools[sp.school] || 0) + 1; if (sp.loadout_points >= 3) heavy += 1; pts += sp.loadout_points; };
  acct(SPELLS_BY_ID[reqId]);
  const cands = SPELL_CATALOG.filter((s) => s.id !== reqId).sort((a, b) => a.loadout_points - b.loadout_points);
  for (const sp of cands) {
    if (ids.length >= 8) break;
    if ((schools[sp.school] || 0) >= 3) continue;
    if (sp.loadout_points >= 3 && heavy >= 2) continue;
    if (pts + sp.loadout_points > 14) continue;
    ids.push(sp.id); acct(sp);
  }
  return ids;
}

export function run() {
  const { ok, eq, report } = createHarness();

  const templates = buildTemplates();
  const keyToId = {};
  const idToKey = {};
  for (const [id, key] of Object.entries(GESTURE_KEYS)) { keyToId[key] = Number(id); idToKey[Number(id)] = key; }

  // Every gesture key maps to a spell and vice-versa (full roster coverage).
  eq(Object.keys(GESTURE_TEMPLATES).length, 40, '40 gesture templates authored');
  const missing = Object.values(GESTURE_KEYS).filter((k) => !GESTURE_TEMPLATES[k]);
  eq(missing.length, 0, `every equipped gesture key has a template (${missing.join(',') || 'none missing'})`);

  // --- 1. Strict all-40 classification of each own trace ------------------
  const full = new Recognizer(templates);
  let correct = 0, total = 0, minMargin = Infinity;
  const misses = [];
  for (const [key, variants] of Object.entries(GESTURE_TEMPLATES)) {
    const id = keyToId[key];
    for (let v = 0; v < variants.length; v++) {
      for (let seed = 1; seed <= 4; seed++) {
        total++;
        const r = full.recognize(jitter(variants[v], 4, seed * 131 + v * 17));
        if (r.accepted && r.spellId === id) { correct++; minMargin = Math.min(minMargin, r.margin); }
        else misses.push(`${key}#${v} -> ${r.accepted ? SPELLS_BY_ID[r.spellId]?.name : r.reason}`);
      }
    }
  }
  ok(correct === total, `all 40 gestures classify their own trace under the strict all-40 recognizer (${correct}/${total})`);
  if (misses.length) console.log('    ambiguous/miss:', misses.slice(0, 8).join(' | '));
  ok(minMargin >= 0.06, `worst separation margin meets the recognizer ambiguity threshold (min ${minMargin.toFixed(3)} >= 0.06)`);

  // --- 2. Each spell under a constructed LEGAL loadout -------------------
  let legalCorrect = 0, legalTotal = 0, buildFails = 0;
  for (let id = 1; id <= 40; id++) {
    const ids = legalLoadoutContaining(id);
    if (!validateLoadout(ids).valid) { buildFails++; continue; }
    const rec = new Recognizer(templates).forLoadout(makeLoadout(ids));
    const variants = GESTURE_TEMPLATES[idToKey[id]];
    for (let v = 0; v < variants.length; v++) {
      for (let seed = 1; seed <= 3; seed++) {
        legalTotal++;
        const r = rec.recognize(jitter(variants[v], 4, seed * 71 + id));
        if (r.accepted && r.spellId === id) legalCorrect++;
      }
    }
  }
  eq(buildFails, 0, 'a legal loadout was constructed for every one of the 40 spells');
  ok(legalCorrect === legalTotal, `every spell classifies under a legal loadout (${legalCorrect}/${legalTotal})`);

  // --- 3. Real archetype presets ----------------------------------------
  let presetCorrect = 0, presetTotal = 0;
  for (const p of PRESETS) {
    const rec = new Recognizer(templates).forLoadout(makeLoadout(p.ids));
    for (const id of p.ids) {
      const variants = GESTURE_TEMPLATES[idToKey[id]];
      for (let v = 0; v < variants.length; v++) {
        presetTotal++;
        const r = rec.recognize(jitter(variants[v], 4, v * 53 + id * 7 + 1));
        if (r.accepted && r.spellId === id) presetCorrect++;
      }
    }
  }
  ok(presetCorrect === presetTotal, `every equipped spell in all 8 archetype presets is drawable (${presetCorrect}/${presetTotal})`);

  // --- 4. Flag ambiguous template pairs ---------------------------------
  const pre = {};
  for (const [key, variants] of Object.entries(GESTURE_TEMPLATES)) pre[key] = preprocess(variants[0], 24);
  const keys = Object.keys(pre);
  const flagged = [];
  let worst = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const score = distanceToScore(meanDistance(pre[keys[i]], pre[keys[j]]));
      worst = Math.max(worst, score);
      if (score > 0.72) flagged.push([keys[i], keys[j], score]);
    }
  }
  flagged.sort((a, b) => b[2] - a[2]);
  if (flagged.length) {
    console.log(`    flagged ${flagged.length} similar template pair(s) (informational):`);
    for (const [a, b, s] of flagged.slice(0, 6)) console.log(`      ${s.toFixed(3)} ${a} <-> ${b}`);
  }
  // No pair may be similar enough to risk a miscast (kept well below acceptance).
  ok(worst < 0.86, `no template pair is dangerously ambiguous (worst similarity ${worst.toFixed(3)} < 0.86)`);

  return report('templates');
}
