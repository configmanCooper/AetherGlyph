// tutorialProgress.test.js — the versioned local solo profile store: defaults,
// save/load round-trip, migration, corruption recovery, guide/medal/clue/secret
// persistence, ranked gating, Delete My Data, and the guarantee that no live
// combat state or raw gesture trace is ever persisted.

import { createHarness } from './tiny.js';
import * as P from '../client/src/tutorial/progress.js';

export function run() {
  const { ok, eq, report } = createHarness();

  // --- defaults ----------------------------------------------------------
  const d = P.defaultProfile();
  eq(d.schemaVersion, 1, 'default schemaVersion is 1');
  eq(d.currentLessonId, 'PROLOGUE', 'default current lesson is the Prologue');
  eq(d.rankedReady, false, 'default profile is not ranked-ready');
  eq(Object.keys(d.secretsFound).length, 4, 'four secrets tracked');
  ok(Object.values(d.secretsFound).every((v) => v === false), 'no secrets found by default');

  // --- save / load round-trip -------------------------------------------
  const store = P.memoryStorage();
  const prof = P.defaultProfile();
  P.setGuideStage(prof, 1, 2);
  P.awardMedal(prof, 'L02-nimble');
  P.setClue(prof, 'hourglassMovement');
  P.completeLesson(prof, 'PROLOGUE', 'L01');
  P.recordRejection(prof, 'below-threshold');
  P.saveProfile(prof, store);
  const loaded = P.loadProfile(store);
  eq(loaded.spellGuideStage['1'], 2, 'guide stage persists');
  ok(P.hasMedal(loaded, 'L02-nimble'), 'medal persists');
  ok(P.hasClue(loaded, 'hourglassMovement'), 'clue persists');
  ok(loaded.completedLessons.includes('PROLOGUE'), 'lesson completion persists');
  eq(loaded.currentLessonId, 'L01', 'current lesson advanced');
  eq(loaded.stats.rejectionReasons['below-threshold'], 1, 'rejection stats persist');

  // --- ranked readiness only via Lesson 12 ------------------------------
  const p2 = P.defaultProfile();
  P.completeLesson(p2, 'L11', 'L12');
  eq(p2.rankedReady, false, 'completing Lesson 11 does not grant ranked readiness');
  P.completeLesson(p2, 'L12', 'A13');
  eq(p2.rankedReady, true, 'completing Lesson 12 grants ranked readiness');
  eq(P.RANKED_UNLOCK_LESSON, 'L12', 'ranked unlock lesson is L12');

  // --- corruption recovery (never throws on startup) --------------------
  const badStore = P.memoryStorage({ 'aeg.solo.v1': '{ this is not json' });
  const recovered = P.loadProfile(badStore);
  eq(recovered.schemaVersion, 1, 'corrupt JSON recovers to a fresh default profile');
  eq(recovered.currentLessonId, 'PROLOGUE', 'corrupt profile resets to the Prologue');

  // --- validation strips forbidden combat/raw fields --------------------
  const dirty = {
    schemaVersion: 1, currentLessonId: 'L05',
    liveSim: { tick: 99, projectiles: [{ id: 1 }] }, rawTraces: [[{ x: 1, y: 2 }]],
    wizards: [{ health: 3, aether: 5 }],
    rankedReady: 'yes', spellGuideStage: { 1: 9, notAnId: 2 },
  };
  const clean = P.validateProfile(dirty);
  ok(!('liveSim' in clean), 'live sim state is stripped on validation');
  ok(!('rawTraces' in clean), 'raw gesture traces are stripped on validation');
  ok(!('wizards' in clean), 'combat wizard snapshots are stripped on validation');
  eq(clean.rankedReady, false, 'non-boolean rankedReady is coerced to false');
  eq(clean.spellGuideStage['1'], 3, 'guide stage is clamped to the max (3)');
  ok(!('notAnId' in clean.spellGuideStage), 'non-numeric guide-stage keys are dropped');
  const json = JSON.stringify(P.saveProfile(clean, P.memoryStorage()));
  ok(!/health|projectile|rawTrace|wizards/i.test(json), 'serialized profile stores no combat/raw data');

  // --- migration (unversioned legacy blob -> current schema) ------------
  const legacyStore = P.memoryStorage({
    'aeg.solo.v1': JSON.stringify({ currentLessonId: 'L03', completedLessons: ['PROLOGUE', 'L01', 'L02'] }),
  });
  const migrated = P.loadProfile(legacyStore);
  eq(migrated.schemaVersion, 1, 'legacy blob migrates to the current schema');
  ok(migrated.completedLessons.includes('L02'), 'legacy completion data is preserved through migration');

  // --- calibration + secret persistence, keep-on-reset ------------------
  const p3 = P.defaultProfile();
  P.setCalibration(p3, { hand: 'left', guideScale: 0.9, comfortableDurationMs: 800 });
  P.discoverSecret(p3, 38);
  const store3 = P.memoryStorage();
  P.saveProfile(p3, store3);
  const l3 = P.loadProfile(store3);
  eq(l3.calibration.hand, 'left', 'calibration handedness persists');
  eq(l3.calibration.comfortableDurationMs, 800, 'calibration duration persists');
  ok(P.isSecretFound(l3, 38), 'secret discovery persists');
  const kept = P.resetProfileKeepingCalibration(l3);
  eq(kept.calibration.hand, 'left', 'reset keeps calibration');
  eq(kept.currentLessonId, 'PROLOGUE', 'reset returns to the Prologue');
  ok(!P.isSecretFound(kept, 38), 'reset clears discoveries');

  // --- Delete My Data ----------------------------------------------------
  P.deleteProfile(store3);
  eq(store3.getItem('aeg.solo.v1'), null, 'deleteProfile removes the solo key');
  eq(P.loadProfile(store3).currentLessonId, 'PROLOGUE', 'loading after delete yields defaults');

  return report('tutorialProgress');
}
