// tutorialCampaign.test.js — declarative campaign schema validation:
//   - unique lesson ids (and unique objective ids within a lesson),
//   - every objective/medal predicate is registered (no silent no-ops),
//   - every loadout references known spells with real combat effects,
//   - every taught/drilled/trial spell has a gesture template,
//   - taught+drilled+trial coverage equals spell ids 1-40,
//   - ranked readiness is granted only by Lesson 12,
//   - secrets are optional and never gate the required path,
//   - formal duel loadouts are legal 8/14 builds.

import { createHarness } from './tiny.js';
import {
  CAMPAIGN, CAMPAIGN_BY_ID, REQUIRED_LESSON_IDS,
  campaignCoverageIds, lessonCoverageIds,
} from '../client/src/tutorial/campaign.js';
import { isPredicateRegistered } from '../client/src/tutorial/objectives.js';
import { SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';
import { effectFor } from '../shared/src/sim/spellEffects.js';
import { GESTURE_KEYS, validateLoadout } from '../shared/src/balance/loadouts.js';
import { GESTURE_TEMPLATES } from '../shared/src/gesture/templates.js';

export function run() {
  const { ok, eq, report } = createHarness();

  // --- unique ids --------------------------------------------------------
  const ids = CAMPAIGN.map((l) => l.id);
  eq(new Set(ids).size, ids.length, 'lesson ids are unique');

  // --- per-lesson schema -------------------------------------------------
  let predsOk = true, spellsOk = true, templatesOk = true, objIdsOk = true;
  const problems = [];
  for (const l of CAMPAIGN) {
    const oids = new Set();
    for (const o of l.objectives) {
      if (!isPredicateRegistered(o.predicate)) { predsOk = false; problems.push(`${l.id}:${o.predicate}`); }
      if (oids.has(o.id)) objIdsOk = false;
      oids.add(o.id);
    }
    if (l.medal && !isPredicateRegistered(l.medal.predicate)) { predsOk = false; problems.push(`${l.id} medal:${l.medal.predicate}`); }
    for (const id of [...l.playerLoadout, ...l.opponentLoadout]) {
      if (!SPELLS_BY_ID[id] || !effectFor(id)) { spellsOk = false; problems.push(`${l.id} spell ${id}`); }
    }
    for (const id of lessonCoverageIds(l)) {
      const key = GESTURE_KEYS[id];
      if (!key || !GESTURE_TEMPLATES[key]) { templatesOk = false; problems.push(`${l.id} template ${id}`); }
    }
  }
  ok(predsOk, 'every objective and medal predicate is registered');
  ok(spellsOk, 'every loadout spell is a known spell with a combat effect');
  ok(templatesOk, 'every taught/drilled/trial spell has a gesture template');
  ok(objIdsOk, 'objective ids are unique within each lesson');
  if (problems.length) console.log('    schema problems:', problems.slice(0, 8).join(' | '));

  // --- full spell coverage 1-40 -----------------------------------------
  const cov = campaignCoverageIds();
  const missing = [];
  for (let i = 1; i <= 40; i++) if (!cov.has(i)) missing.push(i);
  eq(missing.length, 0, `taught/drilled/trial coverage equals spell ids 1-40 (missing: ${missing.join(',') || 'none'})`);

  // --- ranked readiness only from Lesson 12 -----------------------------
  const rewardLessons = CAMPAIGN.filter((l) => l.reward && l.reward.rankedReady).map((l) => l.id);
  eq(rewardLessons.length, 1, 'exactly one lesson grants ranked readiness');
  eq(rewardLessons[0], 'L12', 'only Lesson 12 grants ranked readiness');

  // --- required path + optional secrets ---------------------------------
  ok(REQUIRED_LESSON_IDS.every((id) => !CAMPAIGN_BY_ID[id].optional), 'required path contains no optional lessons');
  ok(REQUIRED_LESSON_IDS.includes('L12'), 'Lesson 12 is on the required path');
  const secretTrials = CAMPAIGN.filter((l) => l.secret);
  eq(secretTrials.length, 4, 'there are four secret trials');
  ok(secretTrials.every((l) => l.optional), 'every secret trial is optional (never gates ranked)');
  ok(secretTrials.every((l) => !(l.reward && l.reward.rankedReady)), 'no secret trial grants ranked readiness');

  // --- formal duels use legal loadouts ----------------------------------
  let formalLegal = true;
  for (const l of CAMPAIGN.filter((x) => x.formal)) {
    if (!validateLoadout(l.playerLoadout).valid) { formalLegal = false; console.log('    illegal player loadout', l.id); }
    if (!validateLoadout(l.opponentLoadout).valid) { formalLegal = false; console.log('    illegal opponent loadout', l.id); }
  }
  ok(formalLegal, 'every formal duel uses a legal 8-spell / 14-point loadout');

  // --- teaching loadouts are non-empty, distinct, known -----------------
  let teachingOk = true;
  for (const l of CAMPAIGN.filter((x) => !x.formal)) {
    if (!l.playerLoadout.length) teachingOk = false;
    if (new Set(l.playerLoadout).size !== l.playerLoadout.length) teachingOk = false;
  }
  ok(teachingOk, 'teaching loadouts are non-empty and have no duplicate spells');

  return report('tutorialCampaign');
}
