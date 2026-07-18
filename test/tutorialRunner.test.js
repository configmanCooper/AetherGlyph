// tutorialRunner.test.js — deterministic TutorialRunner state machine:
//   - every lesson is completable by its intended-action student and never
//     self-completes with no input,
//   - a real drawn cast advances objectives; a wrong spell is flagged,
//   - rejected traces enter ATTEMPT_FAILED and remediation restores ACTIVE
//     (no soft locks, never auto-casts),
//   - pause freezes the sim and arming writes a checkpoint,
//   - same seed + same student replays identically.
import { createHarness } from './tiny.js';
import { TutorialRunner, STATES } from '../client/src/tutorial/runner.js';
import { CAMPAIGN, CAMPAIGN_BY_ID, makeStudent } from '../client/src/tutorial/campaign.js';
import { Recognizer } from '../shared/src/gesture/recognizer.js';
import { buildTemplates, GESTURE_TEMPLATES } from '../shared/src/gesture/templates.js';
import { makeLoadout } from '../shared/src/balance/loadouts.js';
import { memoryStorage, loadProfile, defaultProfile } from '../client/src/tutorial/progress.js';

function recognizerFor(lesson) {
  return new Recognizer(buildTemplates()).forLoadout(makeLoadout(lesson.playerLoadout));
}

export function run() {
  const { ok, eq, report } = createHarness();

  // --- 1. every lesson is completable + no-input never completes ---------
  let scriptedOk = 0, scriptedTotal = 0, formalOk = 0, formalTotal = 0;
  const failures = [];
  for (const lesson of CAMPAIGN) {
    if (lesson.formal) {
      formalTotal++;
      let anyWin = false;
      for (let s = 0; s < 8 && !anyWin; s++) {
        const r = new TutorialRunner(lesson, { seed: 1000 + s });
        if (r.runHeadless({ student: makeStudent(lesson, 1000 + s), maxTicks: lesson.maxTicks }).completed) anyWin = true;
      }
      const idle = new TutorialRunner(lesson, { seed: 3 }).runHeadless({ maxTicks: lesson.maxTicks }).completed;
      if (anyWin && !idle) formalOk++; else failures.push(`${lesson.id} win=${anyWin} idle=${idle}`);
    } else {
      scriptedTotal++;
      const solved = new TutorialRunner(lesson, { seed: 111 })
        .runHeadless({ student: makeStudent(lesson), maxTicks: lesson.maxTicks });
      const idle = new TutorialRunner(lesson, { seed: 111 }).runHeadless({ maxTicks: lesson.maxTicks });
      if (solved.completed && !idle.completed) scriptedOk++;
      else failures.push(`${lesson.id} solved=${solved.completed} idle=${idle.completed}`);
    }
  }
  ok(scriptedOk === scriptedTotal, `every scripted lesson completes by its intended student (${scriptedOk}/${scriptedTotal})`);
  ok(formalOk === formalTotal, `every formal duel is winnable by a skilled student (${formalOk}/${formalTotal})`);
  if (failures.length) console.log('    lesson failures:', failures.slice(0, 6).join(' | '));

  // Idle (no-input) student never completes ANY lesson.
  let idleCompletes = 0;
  for (const lesson of CAMPAIGN) {
    if (new TutorialRunner(lesson, { seed: 7 }).runHeadless({ maxTicks: lesson.maxTicks }).completed) idleCompletes++;
  }
  eq(idleCompletes, 0, 'a no-input student never auto-completes any lesson');

  // --- 2. real drawn cast + wrong-spell flag ----------------------------
  const l03 = CAMPAIGN_BY_ID.L03; // objective 1 expects Ward (10); loadout [10,6]
  const rWrong = new TutorialRunner(l03, { seed: 5, recognizer: recognizerFor(l03) });
  rWrong.arm();
  eq(rWrong.state, STATES.ACTIVE, 'runner is ACTIVE after arming');
  const wrong = rWrong.submitTrace(GESTURE_TEMPLATES.wideArc[0]); // Flame Wave (6), not Ward
  ok(wrong.accepted && wrong.spellId === 6, 'a valid Flame Wave glyph is recognized');
  ok(wrong.wrongSpell, 'casting the wrong spell for the objective is flagged');
  eq(rWrong.state, STATES.ATTEMPT_FAILED, 'wrong spell enters ATTEMPT_FAILED');
  const right = rWrong.submitTrace(GESTURE_TEMPLATES.bracket[0]); // Ward (10)
  ok(right.accepted && right.spellId === 10 && !right.wrongSpell, 'the correct Ward glyph is accepted');
  eq(rWrong.state, STATES.ACTIVE, 'a correct cast returns the runner to ACTIVE');

  // --- 3. rejection + remediation (no soft lock, no auto-cast) -----------
  const rRej = new TutorialRunner(l03, { seed: 5, recognizer: recognizerFor(l03) });
  rRej.arm();
  const rej = rRej.submitTrace([{ x: 0, y: 0 }, { x: 1, y: 1 }]); // too few points
  ok(!rej.accepted && rej.reason === 'too-few-points', 'a too-short trace is rejected with a reason');
  eq(rRej.state, STATES.ATTEMPT_FAILED, 'a rejected trace enters ATTEMPT_FAILED');
  eq(rRej.input.pendingCast, null, 'remediation never auto-casts (no pending cast queued)');
  const before = rRej.remediationLevel;
  rRej.remediate();
  eq(rRej.state, STATES.ACTIVE, 'remediation restores ACTIVE (no soft lock)');
  ok(rRej.remediationLevel > before, 'remediation increments the assistance level');

  // retry() also clears a failed attempt.
  const rRetry = new TutorialRunner(l03, { seed: 5, recognizer: recognizerFor(l03) });
  rRetry.arm();
  rRetry.submitTrace([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  rRetry.retry();
  eq(rRetry.state, STATES.ACTIVE, 'retry restores ACTIVE');

  // --- 4. pause freezes the sim; arming checkpoints ---------------------
  const store = memoryStorage();
  const prof = defaultProfile();
  const rPause = new TutorialRunner('L01', { seed: 9, profile: prof, storage: store });
  rPause.arm();
  eq(loadProfile(store).currentLessonId, 'L01', 'arming writes a checkpoint (current lesson saved)');
  for (let i = 0; i < 30; i++) rPause._stepOnce({});
  const tickAtPause = rPause.sim.tick;
  rPause.pause();
  eq(rPause.state, STATES.PAUSED, 'pause enters PAUSED');
  rPause.update(1000); // would advance ~60 ticks if live
  eq(rPause.sim.tick, tickAtPause, 'the simulation is frozen while PAUSED');
  rPause.resume();
  eq(rPause.state, STATES.ACTIVE, 'resume returns to ACTIVE');

  // Pausing before a lesson is armed restores the intro instead of inventing an
  // ACTIVE state with no simulation.
  const rIntroPause = new TutorialRunner('PROLOGUE', { seed: 9 });
  rIntroPause.pause();
  rIntroPause.resume();
  eq(rIntroPause.state, STATES.INTRO, 'resume from a pre-arm pause returns to INTRO');
  eq(rIntroPause.sim, null, 'pre-arm pause does not create a partial simulation');
  rIntroPause.begin();
  eq(rIntroPause.state, STATES.CALIBRATE, 'the Prologue can still begin after intro pause/resume');

  // --- 5. determinism ----------------------------------------------------
  const a = new TutorialRunner('L07', { seed: 424242 }).runHeadless({ student: makeStudent(CAMPAIGN_BY_ID.L07, 424242), maxTicks: 2400 });
  const b = new TutorialRunner('L07', { seed: 424242 }).runHeadless({ student: makeStudent(CAMPAIGN_BY_ID.L07, 424242), maxTicks: 2400 });
  eq(a.ticks, b.ticks, 'same seed + student yields the same tick count');
  eq(JSON.stringify(a.objectiveStatus), JSON.stringify(b.objectiveStatus), 'same seed + student yields the same objective state');

  // --- 6. constraint objectives are not latched on tick 1 ---------------
  const rCon = new TutorialRunner('L01', { seed: 2 }); // objective 'reserve' = aether-min:20
  rCon.arm();
  rCon._stepOnce({});
  ok(rCon.objectiveStatus.reserve === true, 'aether-min constraint holds while satisfied');
  rCon.sim.wizards[0].aether = 5; // overspend below the 20 Aether floor
  rCon._stepOnce({});
  eq(rCon.objectiveStatus.reserve, false, 'aether-min constraint fails once violated (not latched at start)');

  // --- 7. a lost formal round re-arms on retry (no soft lock) ------------
  const rLoss = new TutorialRunner('L12', { seed: 4 });
  rLoss.arm();
  rLoss.sim.endMatch(1, 'health'); // the instructor wins the round
  rLoss._fail('round-lost');
  eq(rLoss.state, STATES.ATTEMPT_FAILED, 'a lost formal round enters ATTEMPT_FAILED');
  const endedSim = rLoss.sim;
  rLoss.retry();
  eq(rLoss.state, STATES.ACTIVE, 'retry after a lost round re-arms to ACTIVE');
  ok(rLoss.sim !== endedSim && !rLoss.sim.ended, 'retry builds a fresh, live simulation (no dead-sim soft lock)');
  ok(rLoss.lesson.objectives.every((o) => rLoss.objectiveStatus[o.id] === false), 'retry resets the lesson objectives');

  // --- 8. multi-spell lessons switch the guide with the objective ----------
  const guides = [];
  const rGuide = new TutorialRunner('L03', { seed: 2, onGuide: (g) => guides.push(g) });
  rGuide.arm();
  eq(guides.at(-1).spellId, 10, 'L03 starts with the Ward guide');
  rGuide.objectiveStatus.block = true;
  rGuide._advanceGuideOnObjective(rGuide.lesson.objectives[0]);
  eq(rGuide.currentObjective().expectSpell, 6, 'L03 advances to the Flame Wave objective');
  eq(guides.at(-1).spellId, 6, 'guide switches to Flame Wave for the new objective');

  const l08Guides = [];
  const rL08 = new TutorialRunner('L08', { seed: 2, onGuide: (g) => l08Guides.push(g) });
  rL08.arm();
  eq(l08Guides.at(-1).spellId, 31, 'L08 starts with the Oil Script guide');
  rL08.objectiveStatus['oil-wash'] = true;
  rL08._advanceGuideOnObjective(rL08.lesson.objectives[0]);
  eq(l08Guides.at(-1).spellId, 32, 'L08 switches to Rain for the wash objective');

  const l09Guides = [];
  const rL09 = new TutorialRunner('L09', { seed: 2, onGuide: (g) => l09Guides.push(g) });
  rL09.arm();
  eq(l09Guides.at(-1).spellId, 2, 'L09 starts with Frost Lance before Frost Bind');

  // --- 9. best-of-three flow + checkpoints (Academy 16 / Final Exam) --------
  {
    const a16 = CAMPAIGN_BY_ID.A16;
    ok(a16.bestOfThree === true, 'Academy 16 is a best-of-three lesson');
    ok(CAMPAIGN_BY_ID.EXAM.bestOfThree === true, 'the Final Exam is a best-of-three lesson');

    // Winning two rounds succeeds; the runner re-arms + checkpoints between rounds.
    const rounds = [];
    const store = memoryStorage();
    const prof = defaultProfile();
    const r = new TutorialRunner(a16, { seed: 5, profile: prof, storage: store, onSeriesRound: (i) => rounds.push(i) });
    r.arm();
    eq(loadProfile(store).currentLessonId, 'A16', 'arming a bestOfThree lesson checkpoints the profile');
    r.sim.endMatch(0, 'health'); r._handleSeriesRoundEnd(); // player wins round 1
    eq(r.seriesScore[0], 1, 'a player round win advances the series score');
    ok(r.state === STATES.ACTIVE && r.sim && !r.sim.ended, 'the runner re-arms a fresh round after an undecided round');
    r.sim.endMatch(0, 'health'); r._handleSeriesRoundEnd(); // player wins round 2 -> series
    ok(r.state === STATES.SUCCESS, 'winning two rounds completes the best-of-three');
    ok(rounds.length === 2 && rounds[1].decided && rounds[1].won, 'the final series-round callback reports a decided win');

    // Losing two rounds fails with series-lost (no soft lock); retry restarts 0–0.
    const rl = new TutorialRunner(a16, { seed: 6 });
    rl.arm();
    rl.sim.endMatch(1, 'health'); rl._handleSeriesRoundEnd();
    rl.sim.endMatch(1, 'health'); rl._handleSeriesRoundEnd();
    ok(rl.state === STATES.ATTEMPT_FAILED && rl.failReason === 'series-lost', 'losing two rounds fails the series (series-lost)');
    rl.retry();
    ok(rl.seriesScore[0] === 0 && rl.seriesScore[1] === 0 && rl.state === STATES.ACTIVE, 'retry restarts the series at 0–0');
  }

  // --- 10. Grandmaster trial awards a persistent medal/title on a win -------
  {
    let won = false, medaled = false;
    for (let s = 0; s < 8 && !won; s++) {
      const r = new TutorialRunner('EXAM_GM', { seed: 1000 + s, profile: defaultProfile(), storage: memoryStorage() });
      const out = r.runHeadless({ student: makeStudent(CAMPAIGN_BY_ID.EXAM_GM, 1000 + s), maxTicks: 21000 });
      if (out.completed) { won = true; medaled = r.profile.medals.grandmaster === true; }
    }
    ok(won, 'the Grandmaster trial is winnable by a skilled student');
    ok(medaled, 'winning the Grandmaster trial awards the persistent Grandmaster medal/title');
  }

  return report('tutorialRunner');
}
