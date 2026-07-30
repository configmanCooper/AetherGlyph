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
  GAUNTLET_LESSON_IDS, SCENARIO_LESSON_IDS, EXAM_GROUPS,
  lessonUnlocked, groupProgress, lockReason, firstAvailableLessonId,
} from '../client/src/tutorial/campaign.js';
import { isPredicateRegistered } from '../client/src/tutorial/objectives.js';
import { defaultProfile } from '../client/src/tutorial/progress.js';
import { SPELLS_BY_ID } from '../shared/src/balance/spellData.generated.js';
import { effectFor } from '../shared/src/sim/spellEffects.js';
import { GESTURE_KEYS, validateLoadout } from '../shared/src/balance/loadouts.js';
import { GESTURE_TEMPLATES } from '../shared/src/gesture/templates.js';
import { MATCH, TICK_HZ } from '../shared/src/sim/constants.js';

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
  const clueProfile = defaultProfile();
  ok(secretTrials.every((l) => !lessonUnlocked(l, clueProfile)),
    'secret trials remain hidden until their tutorial clue is earned');
  for (const trial of secretTrials) {
    clueProfile.clues[trial.clue] = true;
    ok(lessonUnlocked(trial, clueProfile), `${trial.id} unlocks from clue ${trial.clue}`);
    delete clueProfile.clues[trial.clue];
  }

  // --- formal duels use legal loadouts ----------------------------------
  let formalLegal = true;
  for (const l of CAMPAIGN.filter((x) => x.formal)) {
    if (!validateLoadout(l.playerLoadout).valid) { formalLegal = false; console.log('    illegal player loadout', l.id); }
    if (!validateLoadout(l.opponentLoadout).valid) { formalLegal = false; console.log('    illegal opponent loadout', l.id); }
  }
  ok(formalLegal, 'every formal duel uses a legal 8-spell / 14-point loadout');
  ok(CAMPAIGN_BY_ID.L12.fullRoster === true,
    'First Formal Duel enables recognition for the full spell roster');
  ok(CAMPAIGN_BY_ID.L12.chooseGuides === true,
    'First Formal Duel prompts for eight public guide shortcuts');
  ok(CAMPAIGN_BY_ID.A16.fullRoster === true,
    'Eight Schools Examination enables recognition for the full spell roster');
  ok(['L12', 'A16', 'EXAM', 'EXAM_GM'].every((id) => {
    const narration = CAMPAIGN_BY_ID[id].narration.join(' ');
    return /guides?/i.test(narration) && /any spell|every spell/i.test(narration)
      && /limit|restrict/i.test(narration);
  }), 'every formal duel explains that guides do not limit which spell can be cast');
  ok(CAMPAIGN_BY_ID.L01.narration.some((line) => /joystick down|Brace button/i.test(line)),
    'Aether Breath explicitly teaches the Brace controls');
  ok(CAMPAIGN_BY_ID.L02.narration.some((line) => /joystick.*left or right.*Dodge/i.test(line)),
    'the first movement lesson explicitly teaches directional joystick Dodge');
  ok(CAMPAIGN_BY_ID.L05.narration.some((line) => /joystick up|Focus button/i.test(line)),
    'the first Focus lesson explicitly teaches the Focus controls');
  ok(CAMPAIGN_BY_ID.L03.narration.some((line) => /double-tap.*left or right.*switch guides/i.test(line)),
    'the tutorial teaches draw-pad double-tap guide switching');
  ok(CAMPAIGN_BY_ID.L04.narration.some((line) => /Chilled.*removes Burning.*Burning.*removes Chilled/i.test(line)),
    'Clean Hands teaches opposing elemental status cancellation');
  ok(CAMPAIGN_BY_ID.L07.narration.some((line) => /maximum Static.*25% damage/i.test(line)),
    'Rain Conducts teaches the strengthened Conductive Arc');
  ok(CAMPAIGN_BY_ID.L07.narration.some((line) => /Chain Lightning.*2 seconds.*Thunderclap.*4 seconds.*Knocks Down/i.test(line)),
    'Rain Conducts teaches both Storm control durations and Thunderclap backlash');
  ok(CAMPAIGN_BY_ID.L08.objectives.some((objective) => objective.predicate === 'reaction:SpreadingFlame'),
    'Fire Changes the Ground requires the player to spread a Fire zone');
  ok(CAMPAIGN_BY_ID.L09.narration.some((line) => /Chilled or Soaked/i.test(line))
      && CAMPAIGN_BY_ID.L09.narration.some((line) => /4 seconds.*strips buffs.*25%/i.test(line)),
  'The Cold Lock teaches both Frost Bind setups and Freeze vulnerability');
  ok(CAMPAIGN_BY_ID.L10.narration.some((line) => /6 seconds.*5\.5 seconds/i.test(line))
      && CAMPAIGN_BY_ID.L10.narration.some((line) => /10% more damage/i.test(line)),
  'Wind Answers teaches Gust timing and Knock Down vulnerability');
  ok(CAMPAIGN_BY_ID.L11.objectives.some((objective) => objective.predicate === 'reaction:FracturedCover'),
    'Cover and Ruin teaches the Fireball wall hole before Quake');
  ok(CAMPAIGN_BY_ID.A13.objectives.some((objective) => objective.predicate === 'veil-cooldown-tax')
      && CAMPAIGN_BY_ID.A13.narration.some((line) => /one second.*active enemy cooldown/i.test(line)),
  'Resource War teaches Veil Hex cooldown extension');
  ok(CAMPAIGN_BY_ID.L12.maxTicks >= (MATCH.roundLimitS + 5) * TICK_HZ,
    'First Formal Duel allows the complete expanded round timer');
  ok([CAMPAIGN_BY_ID.A16, CAMPAIGN_BY_ID.EXAM, CAMPAIGN_BY_ID.EXAM_GM]
    .every((lesson) => lesson.maxTicks >= (MATCH.roundLimitS * 3 + 20) * TICK_HZ),
  'best-of-three tutorials allow three complete expanded rounds');

  // --- teaching loadouts are non-empty, distinct, known -----------------
  let teachingOk = true;
  for (const l of CAMPAIGN.filter((x) => !x.formal)) {
    if (!l.playerLoadout.length) teachingOk = false;
    if (new Set(l.playerLoadout).size !== l.playerLoadout.length) teachingOk = false;
  }
  ok(teachingOk, 'teaching loadouts are non-empty and have no duplicate spells');

  // --- final exam structure + progression thresholds (§9) ---------------
  eq(GAUNTLET_LESSON_IDS.length, 12, 'the gesture gauntlet has twelve stages');
  eq(SCENARIO_LESSON_IDS.length, 5, 'the exam has five tactical scenarios');
  eq(EXAM_GROUPS['exam-gauntlet'].need, 10, 'the gauntlet threshold is 10 of 12');
  eq(EXAM_GROUPS['exam-scenarios'].need, 4, 'the scenario threshold is 4 of 5');

  // Gauntlet stages are real, no-template draws: no taught spell (guide is None),
  // one cast-spell objective with an expected spell, optional, no tap substitute.
  let gauntletOk = true;
  for (const id of GAUNTLET_LESSON_IDS) {
    const l = CAMPAIGN_BY_ID[id];
    if ((l.taughtSpells || []).length !== 0) gauntletOk = false;   // no guide is possible
    if (l.objectives.length !== 1) gauntletOk = false;
    const o = l.objectives[0];
    if (!/^cast-spell:\d+$/.test(o.predicate) || o.expectSpell == null) gauntletOk = false;
    if (!l.optional) gauntletOk = false;
  }
  ok(gauntletOk, 'every gauntlet stage is an optional, no-guide, real-draw cast checkpoint');

  // Every exam stage is optional (never gates ranked) and none grants ranked.
  const examStages = CAMPAIGN.filter((l) => l.chapter === 'exam');
  eq(examStages.length, 19, 'the exam chapter has 12 gauntlet + 5 scenarios + duel + grandmaster');
  ok(examStages.every((l) => l.optional), 'every exam stage is optional');
  ok(examStages.every((l) => !(l.reward && l.reward.rankedReady)), 'no exam stage grants ranked readiness');
  ok(CAMPAIGN_BY_ID.EXAM.bestOfThree && CAMPAIGN_BY_ID.EXAM_GM.bestOfThree, 'both duels are best-of-three');
  eq(CAMPAIGN_BY_ID.EXAM.opponent.difficulty, 'medium', 'the Final Duel faces the fair Medium AI');
  eq(CAMPAIGN_BY_ID.EXAM_GM.opponent.difficulty, 'hard', 'the Grandmaster faces the fair Hard AI');
  ok(CAMPAIGN_BY_ID.EXAM.fullRoster && CAMPAIGN_BY_ID.EXAM.chooseGuides,
    'the Final Duel recognizes all known spells and prompts for eight public guides');
  ok(CAMPAIGN_BY_ID.EXAM_GM.fullRoster && CAMPAIGN_BY_ID.EXAM_GM.noGuides,
    'the Grandmaster Trial recognizes all known spells but provides no guides');

  // Threshold progression: complete lessons step by step on a fresh profile.
  const prof = defaultProfile();
  const complete = (ids, n) => { for (let i = 0; i < n; i++) if (!prof.completedLessons.includes(ids[i])) prof.completedLessons.push(ids[i]); };
  const S01 = CAMPAIGN_BY_ID.S01, EXAM = CAMPAIGN_BY_ID.EXAM, GM = CAMPAIGN_BY_ID.EXAM_GM;

  ok(GAUNTLET_LESSON_IDS.every((id) => lessonUnlocked(CAMPAIGN_BY_ID[id], prof)), 'gauntlet stages are unlocked from the start (no prerequisites)');

  complete(GAUNTLET_LESSON_IDS, 9);
  eq(groupProgress(prof, 'exam-gauntlet').done, 9, 'nine gauntlet glyphs recorded');
  ok(!lessonUnlocked(S01, prof), '9/12 gauntlet keeps the tactical scenarios locked');
  ok(!!lockReason(S01, prof), 'a locked scenario reports an accessible remaining requirement');

  complete(GAUNTLET_LESSON_IDS, 10);
  ok(lessonUnlocked(S01, prof), '10/12 gauntlet unlocks the tactical scenarios');
  ok(!lessonUnlocked(EXAM, prof), 'the Final Duel stays locked with 0/5 scenarios');

  complete(SCENARIO_LESSON_IDS, 3);
  ok(!lessonUnlocked(EXAM, prof), '3/5 scenarios keeps the Final Duel locked');

  complete(SCENARIO_LESSON_IDS, 4);
  ok(lessonUnlocked(EXAM, prof), '10/12 gauntlet + 4/5 scenarios unlocks the Final Duel');
  ok(!lessonUnlocked(GM, prof), 'the Grandmaster trial is locked until the Final Duel is won');

  prof.completedLessons.push('EXAM');
  ok(lessonUnlocked(GM, prof), 'completing the Final Duel unlocks the Grandmaster trial');
  eq(GM.medal.id, 'grandmaster', 'the Grandmaster trial awards the persistent Grandmaster medal');
  eq(lockReason(GM, prof), null, 'an unlocked stage has no lock reason');

  // firstAvailableLessonId keeps Continue on a playable, unlocked lesson.
  eq(firstAvailableLessonId(defaultProfile()), 'PROLOGUE', 'a fresh profile continues at the Prologue');
  const allButGm = defaultProfile();
  allButGm.completedLessons = CAMPAIGN.map((l) => l.id).filter((id) => id !== 'EXAM_GM');
  ok(lessonUnlocked(GM, allButGm), 'the Grandmaster is unlocked once everything else is complete');
  eq(firstAvailableLessonId(allButGm), 'EXAM_GM', 'Continue lands on the last unlocked, uncompleted stage');

  return report('tutorialCampaign');
}
