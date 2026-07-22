// runner.js — deterministic TutorialRunner state machine (SOLO-MODES-PLAN §7).
//
// The runner drives the REAL shared Sim with a fixed-tick accumulator, a scripted
// instructor (ScriptBot) or the fair DuelBot, and the production recognizer for
// player casts. It consumes simulation events through the ObjectiveTracker rather
// than duplicating any combat logic, evaluates objective predicates, fades the
// per-spell guide, awards medals/clues/secrets, and checkpoints the local solo
// profile after every lesson/exam stage.
//
// States: INTRO, CALIBRATE, ARMING, ACTIVE, ATTEMPT_FAILED, REMEDIATE, SUCCESS,
// PAUSED. Narration shows in INTRO; the active pad shows only guide + ink; a
// rejected/failed attempt is explained after release and remediation never
// auto-casts for the player.

import { Sim } from '../../../shared/src/sim/sim.js';
import { TICK_HZ } from '../../../shared/src/sim/constants.js';
import { makeLoadout } from '../../../shared/src/balance/loadouts.js';
import { DuelBot } from '../../../shared/src/bot/bot.js';
import { PracticeBot } from '../../../shared/src/bot/practiceBot.js';
import { qualityFromScore } from '../../../shared/src/gesture/quality.js';
import { ObjectiveTracker, evaluatePredicate, parsePredicate } from './objectives.js';
import { makeScriptBot } from './scriptBot.js';
import { evaluateMedal } from './medals.js';
import { SECRETS_BY_TRIAL } from './secrets.js';
import {
  loadProfile, saveProfile, defaultProfile,
  completeLesson, awardMedal, setClue, discoverSecret, setGuideStage,
  setCalibration, recordAttempt, recordRejection,
} from './progress.js';
import { CAMPAIGN_BY_ID, nextLessonId } from './campaign.js';

const TICK_MS = 1000 / TICK_HZ;
const MAX_CATCHUP = 6;
const TUTORIAL_COOLDOWN_SCALE = 0.35;
const REPEATED_CAST_COOLDOWN_SCALE = 0.08;

function hasRepeatedCastObjective(lesson) {
  const counts = new Map();
  for (const objective of (lesson.objectives || [])) {
    if (objective.expectSpell) counts.set(objective.expectSpell, (counts.get(objective.expectSpell) || 0) + 1);
    const match = String(objective.predicate || '').match(/^(?:land|cast)-spell:\d+:(\d+)$/);
    if (match && Number(match[1]) >= 2) return true;
  }
  return [...counts.values()].some((count) => count >= 2);
}

// Build the shared Sim rules for a lesson (kept in one place so the initial arm
// and every series-round re-arm stay identical).
function lessonRules(lesson) {
  const cooldownScale = lesson.cooldownScale
    ?? (hasRepeatedCastObjective(lesson) ? REPEATED_CAST_COOLDOWN_SCALE : TUTORIAL_COOLDOWN_SCALE);
  return {
    timer: !!lesson.timerEnabled,
    pressure: !!lesson.pressureEnabled,
    projectileTravelScale: lesson.projectileTravelScale || 1,
    cooldownScale,
  };
}

export const STATES = Object.freeze({
  INTRO: 'INTRO', CALIBRATE: 'CALIBRATE', ARMING: 'ARMING', ACTIVE: 'ACTIVE',
  ATTEMPT_FAILED: 'ATTEMPT_FAILED', REMEDIATE: 'REMEDIATE', SUCCESS: 'SUCCESS', PAUSED: 'PAUSED',
});

// States in which the simulation clock advances.
const LIVE_STATES = new Set([STATES.ACTIVE, STATES.ATTEMPT_FAILED, STATES.REMEDIATE]);

// Friendly recognition messages (SOLO-MODES-PLAN §8).
export const REJECT_MESSAGES = {
  'too-few-points': 'Hold and draw a longer stroke across the pad.',
  'below-threshold': 'Follow the shape from the start dot in the shown direction.',
  ambiguous: 'Make the defining corner, loop, or direction more distinct.',
  'wrong-spell': 'That was a valid glyph, but this objective needs the highlighted spell.',
  'no-templates': 'Internal content error; this lesson is unavailable.',
  'round-lost': 'The round ended before you met the objectives. Try again.',
  'wasted-dispel': 'Dispel only works when a harmful status is active. The lesson has restarted.',
  'series-lost': 'The best-of-three ended in the AI\'s favour. Replay to try again.',
};

// Guide stage names (0 Full .. 3 None).
export const GUIDE_STAGE_NAMES = ['Full', 'Dotted', 'Start', 'None'];

// "Constraint" predicates express a rule that must HOLD at completion (e.g. never
// drop below 20 Aether, never waste a Dispel, finish without a status). They are
// monotonic true→false, so they must be re-evaluated every tick and NOT latched
// once true — otherwise the player could satisfy them on tick 1 and then violate
// the rule freely. Action predicates latch when achieved.
const CONSTRAINT_PREDICATES = new Set([
  'aether-min', 'no-wasted-dispel', 'no-self-status', 'took-no-damage', 'sidestep-charges-kept',
]);

export class TutorialRunner {
  constructor(lesson, opts = {}) {
    if (typeof lesson === 'string') lesson = CAMPAIGN_BY_ID[lesson];
    if (!lesson) throw new Error('TutorialRunner: unknown lesson');
    this.lesson = lesson;
    this.playerId = 0;
    this.botId = 1;
    this.seed = (opts.seed ?? ((Date.now() & 0x7fffffff))) >>> 0;
    this.reduced = opts.reduced || false;
    this.recognizer = opts.recognizer || null;
    this.storage = opts.storage || null;
    this.profile = opts.profile || (this.storage ? loadProfile(this.storage) : defaultProfile());

    this.state = STATES.INTRO;
    this.prePauseState = STATES.INTRO;
    this.sim = null;
    this.bot = null;
    this.tracker = new ObjectiveTracker({ playerId: this.playerId, botId: this.botId });
    this.input = { move: 0, sidestep: 0, focus: false, brace: false, pendingCast: null, pendingQuality: 1 };
    this.objectiveStatus = {};
    for (const o of lesson.objectives) this.objectiveStatus[o.id] = false;
    this.failReason = null;
    this.lastDiag = null;
    this.lastAttempt = null;
    this.remediationLevel = 0;
    this.acc = 0;
    this.events = [];
    this.result = null;

    // Best-of-three series state (Academy 16, Final Exam). A bestOfThree lesson
    // runs up to three fresh rounds with the SAME loadouts; the player must win
    // two. Between rounds the runner checkpoints the profile and re-arms.
    this.bestOfThree = !!lesson.bestOfThree;
    this.seriesScore = [0, 0]; // [player, bot] round wins
    this.seriesRound = 0;

    // Guide stages are tracked per taught spell so multi-spell lessons can switch
    // the pad to the spell required by the current objective.
    this.guideStages = new Map();
    for (const taught of lesson.taughtSpells || []) {
      if (typeof taught === 'object') this.guideStages.set(taught.id, taught.enterStage ?? 0);
    }
    this.focusSpell = null;
    this.guideStage = 3;
    this._syncGuideToObjective(false);

    // callbacks (all optional)
    this.onState = opts.onState || null;
    this.onObjective = opts.onObjective || null;
    this.onReject = opts.onReject || null;
    this.onComplete = opts.onComplete || null;
    this.onGuide = opts.onGuide || null;
    this.onSeriesRound = opts.onSeriesRound || null;
  }

  // ------------------------------------------------------------- state helpers
  _setState(s) {
    this.state = s;
    if (this.onState) this.onState(s, this);
  }

  get player() { return this.sim ? this.sim.wizards[this.playerId] : null; }
  get enemy() { return this.sim ? this.sim.wizards[this.botId] : null; }
  get alpha() { return Math.min(1, this.acc / TICK_MS); }

  objectivesComplete() { return this.lesson.objectives.every((o) => this.objectiveStatus[o.id]); }

  currentObjective() { return this.lesson.objectives.find((o) => !this.objectiveStatus[o.id]) || null; }

  _currentExpectSpell() {
    const o = this.currentObjective();
    return o && o.expectSpell != null ? o.expectSpell : null;
  }

  _syncGuideToObjective(emit = true) {
    const objective = this.currentObjective();
    const expected = objective && objective.guideSpell != null
      ? objective.guideSpell
      : this._currentExpectSpell();
    const objectiveIndex = objective ? this.lesson.objectives.indexOf(objective) : 0;
    const expectedLoadoutSpell = !this.lesson.gauntlet
      && expected != null && this.lesson.playerLoadout.includes(expected)
      ? { id: expected, enterStage: 1, exitStage: 1 }
      : null;
    const taught = (this.lesson.taughtSpells || []).find((t) =>
      typeof t === 'object' && t.id === expected)
      || expectedLoadoutSpell
      || this.focusSpell
      || (this.lesson.taughtSpells && this.lesson.taughtSpells[Math.min(
        Math.max(0, objectiveIndex),
        Math.max(0, this.lesson.taughtSpells.length - 1),
      )])
      || (this.lesson.taughtSpells && this.lesson.taughtSpells[0])
      || null;
    this.focusSpell = taught;
    this.guideStage = taught ? (this.guideStages.get(taught.id) ?? taught.enterStage ?? 0) : 3;
    if (emit) this._emitGuide();
  }

  // ------------------------------------------------------------- flow: begin
  begin() {
    if (this.state !== STATES.INTRO) return this.state;
    if (this.lesson.calibrate) { this._setState(STATES.CALIBRATE); return this.state; }
    return this.arm();
  }

  // Store first-run calibration and proceed to arming.
  calibrate(data = {}) {
    if (this.state !== STATES.CALIBRATE && this.state !== STATES.INTRO) return this.state;
    if (data && this.profile) setCalibration(this.profile, { ...this.profile.calibration, ...data });
    if (this.storage) saveProfile(this.profile, this.storage);
    return this.arm();
  }

  // Build the sim + opponent, apply any scenario presets, checkpoint, go ACTIVE.
  arm() {
    const lesson = this.lesson;
    const loadouts = [makeLoadout(lesson.playerLoadout), makeLoadout(lesson.opponentLoadout)];
    this.sim = new Sim({
      seed: this.seed,
      loadouts,
      rules: lessonRules(lesson),
    });
    this._applyArena(lesson.arena);
    this.bot = this._buildOpponent(lesson.opponent);
    this.tracker.reset();
    // Prime the tracker baseline against the initial state.
    this.tracker.update([], this.sim);

    // Checkpoint: mark this lesson as the current position (§12 save-on-arm).
    if (this.profile) {
      this.profile.currentLessonId = lesson.id;
      recordAttempt(this.profile, lesson.id);
      if (this.storage) saveProfile(this.profile, this.storage);
    }

    this._syncGuideToObjective();
    this._setState(STATES.ACTIVE);
    return this.state;
  }

  _applyArena(arena) {
    if (!arena) return;
    const p = this.sim.wizards[this.playerId];
    const b = this.sim.wizards[this.botId];
    if (arena.playerHealth != null) p.health = arena.playerHealth;
    if (arena.playerAether != null) p.aether = arena.playerAether;
    if (arena.playerCharges != null) p.charges = arena.playerCharges;
    if (arena.botHealth != null) b.health = arena.botHealth;
    if (arena.botAether != null) b.aether = arena.botAether;
    if (arena.botCharges != null) b.charges = arena.botCharges;
  }

  _buildOpponent(opponent) {
    if (!opponent) return makeScriptBot(this.botId, { behavior: 'idle' });
    if (opponent.type === 'practice') {
      // The fair Practice AI (Very Easy/Easy/Medium/Hard) — identical to Practice vs AI.
      return new PracticeBot(this.botId, { difficulty: opponent.difficulty || 'medium', seed: (this.seed ^ 0x5a5a) >>> 0 });
    }
    if (opponent.type === 'duel') {
      return new DuelBot(this.botId, { difficulty: opponent.difficulty || 'apprentice', seed: (this.seed ^ 0x5a5a) >>> 0 });
    }
    return makeScriptBot(this.botId, opponent.config || { behavior: 'idle' });
  }

  // ------------------------------------------------------------- input (gesture)
  // Submit a released trace. Returns { accepted, reason, spellId }. On accept the
  // cast is queued for the next tick; on reject the runner enters ATTEMPT_FAILED
  // and explains the failure. Never auto-casts.
  submitTrace(points, durationMs = 0) {
    if (this.state !== STATES.ACTIVE && this.state !== STATES.ATTEMPT_FAILED) return { ignored: true };
    if (!this.recognizer) return { ignored: true, reason: 'no-recognizer' };
    const diag = this.recognizer.recognize(points);
    this.lastDiag = diag;
    if (diag.accepted) {
      const q = qualityFromScore(diag.best.score);
      return this._acceptCast(diag.spellId, q, diag);
    }
    return this._rejectAttempt(diag.reason, diag);
  }

  // Register a drawn/recognized cast (from submitTrace or the UI gesture pad).
  // Queues the real cast for the next tick; surfaces a "wrong spell" advisory but
  // lets the objective predicate govern completion. Never auto-casts.
  notePlayerCast(spellId, quality = 1, diag = null) {
    if (this.state !== STATES.ACTIVE && this.state !== STATES.ATTEMPT_FAILED) return { ignored: true };
    return this._acceptCast(spellId, quality, diag);
  }

  // Register a rejected trace (from the UI gesture pad) with a friendly reason.
  noteReject(diag) {
    if (this.state !== STATES.ACTIVE && this.state !== STATES.ATTEMPT_FAILED) return { ignored: true };
    this.lastDiag = diag;
    return this._rejectAttempt(diag && diag.reason, diag);
  }

  _acceptCast(spellId, quality, diag) {
    const expect = this._currentExpectSpell();
    const wrong = expect != null && spellId !== expect;
    this.input.pendingCast = spellId;
    this.input.pendingQuality = Math.min(1.05, quality);
    this.lastAttempt = { accepted: true, spellId, wrongSpell: wrong, reason: wrong ? 'wrong-spell' : 'accepted' };
    if (wrong) {
      this.failReason = 'wrong-spell';
      this._setState(STATES.ATTEMPT_FAILED);
      if (this.onReject) this.onReject({ reason: 'wrong-spell', message: REJECT_MESSAGES['wrong-spell'], diag });
    } else if (this.state === STATES.ATTEMPT_FAILED) {
      this._setState(STATES.ACTIVE);
    }
    return this.lastAttempt;
  }

  _rejectAttempt(reason, diag) {
    this.failReason = reason;
    this.lastAttempt = { accepted: false, reason };
    if (this.profile) recordRejection(this.profile, reason);
    this._setState(STATES.ATTEMPT_FAILED);
    if (this.onReject) this.onReject({ reason, message: REJECT_MESSAGES[reason] || reason, diag });
    return this.lastAttempt;
  }

  setMove(dir) { this.input.move = Math.sign(dir || 0); }
  sidestep(dir) { this.input.sidestep = Math.sign(dir || (this.input.move || 1)); }
  setFocus(v) { this.input.focus = !!v; }
  brace() { this.input.brace = true; }

  // ------------------------------------------------------- remediation ladder
  // Return to ACTIVE with the same guide after a failed attempt. If the round
  // already ended (a lost formal duel), re-arm a fresh round instead of leaving
  // the runner stuck on a dead simulation.
  retry() {
    if (this.state !== STATES.ATTEMPT_FAILED) return this.state;
    if (this.sim && this.sim.ended) return this.restart();
    this.failReason = null;
    this._setState(STATES.ACTIVE);
    return this.state;
  }

  // Rebuild the lesson with a fresh simulation (used to replay a lost round).
  restart() {
    this.seed = (this.seed + 0x9e3779b9) >>> 0; // vary the duel deterministically
    for (const o of this.lesson.objectives) this.objectiveStatus[o.id] = false;
    this.remediationLevel = 0;
    this.failReason = null;
    this.events = [];
    this.acc = 0;
    this.seriesScore = [0, 0];
    this.seriesRound = 0;
    this.guideStages.clear();
    for (const taught of this.lesson.taughtSpells || []) {
      if (typeof taught === 'object') this.guideStages.set(taught.id, taught.enterStage ?? 0);
    }
    this._syncGuideToObjective(false);
    this._setState(STATES.ARMING);
    return this.arm();
  }

  // Increase assistance one rung (regress the guide a stage) WITHOUT auto-casting.
  remediate() {
    if (this.state !== STATES.ATTEMPT_FAILED) return this.state;
    this._setState(STATES.REMEDIATE);
    this.remediationLevel += 1;
    if (this.focusSpell && this.guideStage > 0) {
      this.guideStage -= 1; // regress one stage (more help)
      this.guideStages.set(this.focusSpell.id, this.guideStage);
      this._emitGuide();
    }
    this.failReason = null;
    this._setState(STATES.ACTIVE);
    return this.state;
  }

  // ------------------------------------------------------------- pause/resume
  pause() {
    if (this.state === STATES.PAUSED || this.state === STATES.SUCCESS) return this.state;
    this.prePauseState = this.state;
    this._setState(STATES.PAUSED);
    if (this.profile && this.storage) saveProfile(this.profile, this.storage); // checkpoint
    return this.state;
  }
  resume() {
    if (this.state !== STATES.PAUSED) return this.state;
    this._setState(this.prePauseState || STATES.INTRO);
    return this.state;
  }

  // ------------------------------------------------------------------ ticking
  _buildPlayerIntent() {
    const i = this.input;
    const intent = { move: i.move, sidestep: i.sidestep, focus: i.focus, brace: i.brace };
    if (i.pendingCast != null) {
      intent.cast = i.pendingCast;
      intent.castQuality = i.pendingQuality;
      intent.castWasGesture = true;
      i.pendingCast = null;
    }
    i.sidestep = 0; // one-shot
    return intent;
  }

  // Advance exactly one simulation tick with an explicit player intent (headless)
  // or the accumulated UI input.
  _stepOnce(playerIntentOverride) {
    if (!this.sim || this.sim.ended) return [];
    const playerIntent = playerIntentOverride !== undefined ? (playerIntentOverride || {}) : this._buildPlayerIntent();
    const botIntent = this.bot ? this.bot.act(this.sim) : {};
    const evs = this.sim.step({ [this.playerId]: playerIntent, [this.botId]: botIntent });
    for (const e of evs) this.events.push(e);
    this.tracker.update(evs, this.sim);
    this._evaluateObjectives();
    if (this.sim.ended && this.state !== STATES.SUCCESS) {
      if (this.bestOfThree) this._handleSeriesRoundEnd();
      else if (!this.objectivesComplete()) this._fail('round-lost');
    }
    return evs;
  }

  // Best-of-three: record the finished round, then either decide the series
  // (win → success, loss → fail) or checkpoint and re-arm the next round.
  _handleSeriesRoundEnd() {
    const winner = this.sim.winner;
    if (winner === this.playerId) this.seriesScore[0] += 1;
    else if (winner === this.botId) this.seriesScore[1] += 1;
    this.seriesRound += 1;

    const need = 2, maxRounds = 3;
    const decided = this.seriesScore[0] >= need || this.seriesScore[1] >= need || this.seriesRound >= maxRounds;
    const won = this.seriesScore[0] > this.seriesScore[1];

    if (this.onSeriesRound) {
      this.onSeriesRound({ score: [...this.seriesScore], round: this.seriesRound, decided, won });
    }

    if (decided) {
      this.tracker.facts.seriesWon = won;
      this.tracker.facts.seriesDecided = true;
      this._evaluateObjectives();
      if (!won && this.state !== STATES.SUCCESS) this._fail('series-lost');
    } else {
      this._armNextSeriesRound();
    }
  }

  // Re-arm a fresh round with the SAME loadouts and a varied deterministic seed,
  // preserving the series score. Checkpoints the profile between rounds.
  _armNextSeriesRound() {
    this.seed = (this.seed + 0x9e3779b9) >>> 0;
    const lesson = this.lesson;
    this.sim = new Sim({
      seed: this.seed,
      loadouts: [makeLoadout(lesson.playerLoadout), makeLoadout(lesson.opponentLoadout)],
      rules: lessonRules(lesson),
    });
    this._applyArena(lesson.arena);
    this.bot = this._buildOpponent(lesson.opponent);
    this.tracker.reset();
    this.tracker.update([], this.sim);
    this.acc = 0;
    if (this.profile && this.storage) saveProfile(this.profile, this.storage); // checkpoint
    this._setState(STATES.ACTIVE);
  }

  _evaluateObjectives() {
    if (this.state === STATES.SUCCESS) return;
    for (const o of this.lesson.objectives) {
      const isConstraint = CONSTRAINT_PREDICATES.has(parsePredicate(o.predicate).name);
      if (this.objectiveStatus[o.id] && !isConstraint) continue; // action already latched
      const val = evaluatePredicate(o.predicate, this.tracker, this.sim);
      if (isConstraint) {
        // Reflect the current rule state (never latched): a violation sticks
        // because these facts are monotonic (min Aether, wasted-Dispel count…).
        this.objectiveStatus[o.id] = val;
        if (!val && o.restartOnViolation) {
          const reason = typeof o.restartOnViolation === 'string'
            ? o.restartOnViolation
            : 'constraint-violated';
          if (this.onReject) {
            this.onReject({ reason, message: REJECT_MESSAGES[reason] || reason });
          }
          this.restart();
          return;
        }
      } else if (val) {
        this.objectiveStatus[o.id] = true;
        if (this.onObjective) this.onObjective(o, this);
        this._advanceGuideOnObjective(o);
      }
    }
    // Complete only when every action is achieved AND every constraint still holds.
    if (this.objectivesComplete()) this._succeed();
  }

  // Fade the focus spell's guide one stage per completed objective (toward None).
  _advanceGuideOnObjective(objective) {
    const spellId = objective && objective.expectSpell != null
      ? objective.expectSpell
      : (this.focusSpell && this.focusSpell.id);
    const taught = (this.lesson.taughtSpells || []).find((t) =>
      typeof t === 'object' && t.id === spellId);
    if (taught) {
      const current = this.guideStages.get(taught.id) ?? taught.enterStage ?? 0;
      const exit = taught.exitStage ?? 3;
      this.guideStages.set(taught.id, Math.min(exit, current + 1));
    }
    this._syncGuideToObjective();
  }

  _emitGuide() {
    if (this.onGuide) this.onGuide({ spellId: this.focusSpell ? this.focusSpell.id : null, stage: this.guideStage });
  }

  // Advance the accumulator by real elapsed ms and step fixed ticks (UI loop).
  update(dtMs) {
    if (!LIVE_STATES.has(this.state) || !this.sim || this.sim.ended) return;
    this.acc += Math.min(dtMs, TICK_MS * MAX_CATCHUP * 3);
    let steps = 0;
    while (this.acc >= TICK_MS && steps < MAX_CATCHUP && LIVE_STATES.has(this.state) && !this.sim.ended) {
      this._stepOnce();
      this.acc -= TICK_MS;
      steps += 1;
    }
  }

  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------------------------ success
  _fail(reason) {
    this.failReason = reason;
    this._setState(STATES.ATTEMPT_FAILED);
    if (this.onReject) this.onReject({ reason, message: REJECT_MESSAGES[reason] || reason });
  }

  _succeed() {
    if (this.state === STATES.SUCCESS) return;
    const lesson = this.lesson;
    const medalResult = evaluateMedal(lesson, this.tracker, this.sim, {});
    const clues = (lesson.clues || []).slice();
    const secret = SECRETS_BY_TRIAL[lesson.id] || null;

    if (this.profile) {
      // Persist taught-spell guide stages at their exit stage.
      for (const t of lesson.taughtSpells || []) {
        if (typeof t === 'object' && t.exitStage != null) setGuideStage(this.profile, t.id, t.exitStage);
      }
      // Ranked readiness is set ONLY inside completeLesson for L12 (§24).
      completeLesson(this.profile, lesson.id, nextLessonId(lesson.id));
      if (medalResult.earned && medalResult.medal) awardMedal(this.profile, medalResult.medal.id);
      for (const c of clues) setClue(this.profile, c);
      if (secret) discoverSecret(this.profile, secret.spellId);
      if (this.storage) saveProfile(this.profile, this.storage); // checkpoint
    }

    this.result = {
      lessonId: lesson.id,
      medal: medalResult.earned ? medalResult.medal : null,
      clues,
      secretFound: secret ? secret.spellId : null,
      rankedReady: !!(this.profile && this.profile.rankedReady),
    };
    this._setState(STATES.SUCCESS);
    if (this.onComplete) this.onComplete(this.result, this);
  }

  // ---------------------------------------------------------------- headless
  // Drive the lesson to completion with an intended-student intent source. Used
  // by tests to prove a lesson IS completable by real actions and does NOT self-
  // complete with no input. Returns a summary.
  runHeadless({ student = null, maxTicks = null } = {}) {
    if (this.state === STATES.INTRO || this.state === STATES.CALIBRATE) this.arm();
    const cap = maxTicks || this.lesson.maxTicks || 2400;
    let ticks = 0;
    while (ticks < cap && this.state === STATES.ACTIVE && !this.sim.ended) {
      const intent = student ? (student(this.sim, this.tracker) || {}) : {};
      this._stepOnce(intent);
      ticks += 1;
    }
    return {
      state: this.state,
      completed: this.objectivesComplete(),
      objectiveStatus: { ...this.objectiveStatus },
      ticks: this.sim ? this.sim.tick : 0,
      facts: this.tracker.facts,
      result: this.result,
    };
  }
}
