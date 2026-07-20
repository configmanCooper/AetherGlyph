// main.js — Aetherglyph Phase 2 client entry. Wires the shared sim, renderer,
// HUD, gesture recognition, movement, audio, the loadout builder, an on-screen
// cast bar, and a best-of-three series into a playable offline slice.

import { Arena } from '../render/arena.js';
import { HUD } from '../ui/hud.js';
import { Audio } from '../audio/audio.js';
import { GestureInput } from '../input/gestureInput.js';
import { MovementControl } from '../input/movement.js';
import { LocalMatch } from '../game/localMatch.js';
import { OnlineMatch } from '../net/onlineMatch.js';
import { clientIdentity, setDisplayName, loadResume } from '../net/net.js';
import { effectiveServerUrl, getStoredServerUrl, setStoredServerUrl, describeServerTarget } from '../net/serverConfig.js';
import { isNativeApp, onBackButton, onAppStateChange, exitApp, nativeImpact } from './native.js';
import { TutorialRunner, STATES } from '../tutorial/runner.js';
import { CAMPAIGN, CAMPAIGN_BY_ID, REQUIRED_LESSON_IDS, chapters,
  lessonUnlocked, lockReason, groupProgress, firstAvailableLessonId, EXAM_GROUPS } from '../tutorial/campaign.js';
import {
  loadProfile, saveProfile, deleteProfile, completionPercent,
  setPractice, recordPracticeResult,
} from '../tutorial/progress.js';
import { SECRETS } from '../tutorial/secrets.js';
import { Calibration } from '../tutorial/calibration.js';

import { Recognizer } from '@shared/gesture/recognizer.js';
import { buildTemplates, GESTURE_TEMPLATES } from '@shared/gesture/templates.js';
import {
  makeLoadout, validateLoadout,
  PRESETS, PRESETS_BY_KEY, STARTER_SPELL_IDS, GESTURE_KEYS,
} from '@shared/balance/loadouts.js';
import { SPELL_CATALOG, SPELLS_BY_ID } from '@shared/balance/spellData.generated.js';
import { chooseOpponentLoadout, PRACTICE_PROFILES } from '@shared/bot/practiceBot.js';
import { coachReport } from '@shared/analytics/coach.js';
import { renderCoachReport } from '../ui/coach.js';
import { versionTag } from '@shared/protocol/version.js';
import { SPELL_VFX, VFX_IDS, REACTION_VFX, REACTION_VFX_NAMES } from '../render/spellVfxProfiles.js';
import { vfxFamilyCoverage, reactionVfxCoverage } from '../render/spellVfx.js';

const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------------ singletons
const arena = new Arena($('#scene'));
const hud = new HUD($('#hud'));
const audio = new Audio();

const settings = { lefthand: false, reduced: false, audio: true, haptics: true, devcast: false };

// Loadout + practice state.
let playerIds = STARTER_SPELL_IDS.slice();       // the equipped 8 spells (ids)
let playerLoadout = makeLoadout(playerIds);
let recognizer = null;
const LAB_PAGE_SIZE = 8;
const LAB_PUBLIC_IDS = [
  ...STARTER_SPELL_IDS,
  ...SPELL_CATALOG.filter((s) => !s.secret && !STARTER_SPELL_IDS.includes(s.id)).map((s) => s.id),
];
let labPage = 0;
let labSelectedId = LAB_PUBLIC_IDS[0];
let labCooldowns = false;
let activeGuideLoadout = [];
let selectedGuideId = null;

let match = null;
let running = false;
let pausedForVisibility = false;
let mode = null;
let tutorial = null;        // active TutorialRunner (mode === 'tutorial')
let tutorialLesson = null;  // its lesson definition
let calibrator = null;      // active Calibration capture (first-run)

// Practice vs AI configuration (persisted in aeg.solo.v1 under `practice`).
let practice = null;        // loaded from the solo profile on boot
let practiceSeed = null;    // the seed the panel previewed the opponent with
let lastCoach = null;       // last coaching report (for summary/detailed re-render)

// A guide template path (0..100 space) for a spell id, for the tutorial/lab pad.
function guideTemplateFor(spellId) {
  const key = GESTURE_KEYS[spellId];
  const variants = key ? GESTURE_TEMPLATES[key] : null;
  return variants ? variants[0] : null;
}

function setDrawHint(text) {
  const hint = document.querySelector('#draw-pad .pad-hint');
  if (hint) hint.textContent = text || 'draw spell';
}

function resetLastCast() {
  const el = $('#last-cast');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

function showLastCast(spellId) {
  const spell = SPELLS_BY_ID[spellId];
  const el = $('#last-cast');
  if (!spell || !el) return;
  el.textContent = `Last cast: ${spell.name}`;
  el.classList.remove('hidden');
}

function selectEquippedGuide(id) {
  selectedGuideId = id;
  gesture.setGuide(guideTemplateFor(id), { stage: 1, showGhost: false });
  setDrawHint(`draw ${SPELLS_BY_ID[id].name} — follow the dotted line`);
  if (mode === 'practice' && match) match.assisted = true;
  renderEquippedGuideBar();
}

function renderEquippedGuideBar() {
  hud.buildSpellbar(activeGuideLoadout, (id) => selectEquippedGuide(id), {
    selectedId: selectedGuideId,
    guideMode: true,
  });
}

// Best-of-three series (online only; the local bot-duel series was replaced by
// single-round Practice vs AI).
let series = null;

// Online duel session (OnlineMatch adapter). `match` points at it while online.
let online = null;
let onlineRoundIndex = 0;

function haptic(kind) {
  if (!settings.haptics) return;
  // Prefer native haptics (@capacitor/haptics) in the packaged app; fall back to
  // the Web Vibration API in the browser.
  const style = { accept: 'LIGHT', reject: 'MEDIUM', counter: 'MEDIUM', damage: 'HEAVY', round: 'HEAVY' }[kind] || 'LIGHT';
  if (nativeImpact(style)) return;
  if (!navigator.vibrate) return;
  const map = { accept: 12, reject: [8, 30, 8], counter: [20, 20, 20], damage: 40, round: [60, 40, 120] };
  navigator.vibrate(map[kind] || 10);
}

// ------------------------------------------------------------------ input wiring
const dummyInput = { move: 0, sidestep: 0, focus: false, brace: false, pendingCast: null, pendingQuality: 1 };

function castSpell(id, quality = 1) {
  if (mode === 'online') return; // online casting is authoritative — gesture pad only
  audio.unlock();
  if (match) { match.input.pendingCast = id; match.input.pendingQuality = quality; }
}

const gesture = new GestureInput($('#draw-canvas'), {
  recognizer: null,
  reduced: settings.reduced,
  haptics: haptic,
  onCast: (spellId, quality, diag, trace) => {
    audio.unlock(); audio.accept();
    hud.setDiag(diag);
    if (mode === 'online') {
      if (online && trace) online.sendCastTrace(trace); // server reclassifies + is authoritative
      return;
    }
    if (mode === 'tutorial' && tutorial) {
      tutorial.notePlayerCast(spellId, quality, diag);
      return;
    }
    castSpell(spellId, quality);
  },
  onReject: (diag) => {
    audio.unlock(); audio.reject(); hud.setDiag(diag);
    if (mode === 'tutorial' && tutorial) tutorial.noteReject(diag);
  },
});

function rebuildForLoadout() {
  playerLoadout = makeLoadout(playerIds);
  recognizer = new Recognizer(buildTemplates()).forLoadout(playerLoadout);
  gesture.recognizer = recognizer;
  activeGuideLoadout = playerLoadout;
  selectedGuideId = null;
  renderEquippedGuideBar();
  buildDevcast();
  updatePracticeSummaries();
}

const movement = new MovementControl($('#move-pad'), $('#move-stick'), dummyInput, { lefthand: settings.lefthand });

function bindHold(btn, key) {
  const el = $(btn);
  const set = (v) => { if (match) match.input[key] = v; el.classList.toggle('active', v); };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); audio.unlock(); set(true); });
  el.addEventListener('pointerup', (e) => { e.preventDefault(); set(false); });
  el.addEventListener('pointerleave', () => set(false));
  el.addEventListener('pointercancel', () => set(false));
}
bindHold('#btn-focus', 'focus');
bindHold('#btn-brace', 'brace');
$('#btn-sidestep').addEventListener('pointerdown', (e) => {
  e.preventDefault(); audio.unlock();
  if (match) match.input.sidestep = dummyInput.__lastDir || 1;
});

// Keyboard dev fallback (normal play uses drawing / the cast bar).
let kbMove = 0;
window.addEventListener('keydown', (e) => {
  if (!match) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= playerLoadout.length) castSpell(playerLoadout[n - 1].id, 1);
  else if (e.key === 'a') kbMove = -1;
  else if (e.key === 'd') kbMove = 1;
  else if (e.key === 'f') match.input.focus = true;
  else if (e.key === 'b') match.input.brace = true;
  else if (e.key === ' ') { match.input.sidestep = dummyInput.__lastDir || 1; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  if (!match) return;
  if (e.key === 'a' && kbMove === -1) kbMove = 0;
  else if (e.key === 'd' && kbMove === 1) kbMove = 0;
  else if (e.key === 'f') match.input.focus = false;
  else if (e.key === 'b') match.input.brace = false;
});

// Dev quick-cast buttons (mirror of the equipped loadout).
function buildDevcast() {
  const wrap = $('#devcast');
  wrap.innerHTML = '';
  playerLoadout.forEach((s, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1} ${s.name}`;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); castSpell(s.id, 1); });
    wrap.appendChild(b);
  });
}

// ------------------------------------------------------------------ match flow
function applyInputBridge() {
  if (!match) return;
  const move = kbMove !== 0 ? kbMove : dummyInput.move;
  match.input.move = move;
  if (move !== 0) dummyInput.__lastDir = move;
  if (dummyInput.sidestep !== 0) { match.input.sidestep = dummyInput.sidestep; dummyInput.sidestep = 0; }
}

// Glyph Laboratory: no opponent, no combat pressure (untimed sandbox).
function labPageIds() {
  const start = labPage * LAB_PAGE_SIZE;
  return LAB_PUBLIC_IDS.slice(start, start + LAB_PAGE_SIZE);
}

function selectLabSpell(id) {
  labSelectedId = id;
  // A guide is visual help only. Recognition always compares against the full
  // public laboratory catalog, exactly like Blank mode.
  gesture.recognizer = new Recognizer(buildTemplates()).forLoadout(makeLoadout(LAB_PUBLIC_IDS));
  gesture.setGuide(guideTemplateFor(id), { stage: 1, showGhost: false });
  setDrawHint(`draw ${SPELLS_BY_ID[id].name} — follow the dotted line`);
  const canvas = $('#draw-canvas');
  if (canvas) {
    canvas.dataset.guideSpell = String(id);
    canvas.dataset.guideStage = 'dotted';
  }
  renderLabSpellbar();
}

function selectLabBlank() {
  labSelectedId = null;
  gesture.recognizer = new Recognizer(buildTemplates()).forLoadout(makeLoadout(LAB_PUBLIC_IDS));
  gesture.setGuide(null);
  setDrawHint('blank guide — draw any public spell from memory');
  const canvas = $('#draw-canvas');
  if (canvas) {
    delete canvas.dataset.guideSpell;
    canvas.dataset.guideStage = 'blank';
  }
  renderLabSpellbar();
}

function toggleLabCooldowns() {
  labCooldowns = !labCooldowns;
  if (match?.sim?.setSandboxCooldowns) match.sim.setSandboxCooldowns(labCooldowns);
  toast(`Glyph Laboratory cooldowns ${labCooldowns ? 'on' : 'off'}.`);
  renderLabSpellbar();
}

function renderLabSpellbar() {
  const pageIds = labPageIds();
  const pages = Math.ceil(LAB_PUBLIC_IDS.length / LAB_PAGE_SIZE);
  hud.buildSpellbar(makeLoadout(pageIds), (id) => selectLabSpell(id), {
    selectedId: labSelectedId,
    guideMode: true,
    onBlank: () => selectLabBlank(),
    blankSelected: labSelectedId == null,
    onCooldownToggle: () => toggleLabCooldowns(),
    cooldownsEnabled: labCooldowns,
    onNext: () => {
      labPage = (labPage + 1) % pages;
      labSelectedId = labPageIds()[0];
      selectLabSpell(labSelectedId);
    },
    pageLabel: `${labPage + 1}/${pages}`,
  });
}

function startLab() {
  mode = 'lab';
  document.body.classList.add('mode-lab');
  document.body.classList.remove('mode-tutorial');
  series = null;
  resetLastCast();
  labPage = 0;
  labSelectedId = LAB_PUBLIC_IDS[0];
  labCooldowns = false;
  const labLoadout = makeLoadout(LAB_PUBLIC_IDS);
  match = new LocalMatch({
    mode: 'lab',
    botActive: false,
    playerLoadout: labLoadout,
    timed: false,
    seed: (Date.now() & 0x7fffffff) >>> 0,
    onEnd: null,
  });
  running = true;
  hud.showDiag = true;
  hud.setDiag(null);
  hud.setSeries(null);
  arena.reset();
  showOverlay(false);
  $('#hud').classList.remove('hidden');
  $('#coach').classList.add('hidden');
  document.body.classList.remove('mode-tutorial');
  $('#spellbar').classList.remove('hidden');
  $('#devcast').classList.toggle('hidden', !settings.devcast);
  renderLabSpellbar();
  selectLabSpell(labSelectedId);
  toast('Glyph Laboratory — draw freely. No opponent.');
}

// Resolve the player + opponent loadouts for the configured practice round, then
// launch a single fair Practice vs AI round.
function resolvePracticeSeed() {
  if (practice.fixedSeed != null && Number.isFinite(practice.fixedSeed)) return practice.fixedSeed >>> 0;
  return (Date.now() & 0x7fffffff) >>> 0;
}

function resolvePlayerPracticeIds() {
  if (practice.playerPreset && practice.playerPreset !== 'current' && PRESETS_BY_KEY[practice.playerPreset]) {
    return PRESETS_BY_KEY[practice.playerPreset].ids.slice();
  }
  return playerIds.slice();
}

function resolveOpponentPracticeIds(playerPracticeIds, seed) {
  if (practice.opponentPreset && practice.opponentPreset !== 'auto' && PRESETS_BY_KEY[practice.opponentPreset]) {
    return PRESETS_BY_KEY[practice.opponentPreset].ids.slice();
  }
  // Auto: a legal loadout chosen fairly for the difficulty vs the visible build.
  return chooseOpponentLoadout(practice.difficulty, playerPracticeIds, (seed ^ 0x5a5a) >>> 0);
}

function startPractice() {
  mode = 'practice';
  document.body.classList.remove('mode-lab', 'mode-tutorial');
  series = null;
  resetLastCast();
  const seed = practiceSeed != null ? practiceSeed : resolvePracticeSeed();
  const playerPracticeIds = resolvePlayerPracticeIds();
  const oppIds = resolveOpponentPracticeIds(playerPracticeIds, seed);
  const pLoadout = makeLoadout(playerPracticeIds);
  const bLoadout = makeLoadout(oppIds);
  // Scope the recognizer to the loadout actually used this round.
  gesture.recognizer = new Recognizer(buildTemplates()).forLoadout(pLoadout);
  activeGuideLoadout = pLoadout;
  selectedGuideId = practice.templates ? pLoadout[0].id : null;
  renderEquippedGuideBar();

  match = new LocalMatch({
    mode: 'practice',
    difficulty: practice.difficulty,
    playerLoadout: pLoadout,
    botLoadout: bLoadout,
    timed: practice.timed,
    assisted: practice.templates,
    seed,
    onEnd: (sim) => onPracticeEnd(sim),
  });
  running = true;
  hud.showDiag = true;
  hud.setDiag(null);
  hud.setSeries(null);
  arena.reset();
  showOverlay(false);
  $('#hud').classList.remove('hidden');
  $('#coach').classList.add('hidden');
  $('#coach-report').classList.add('hidden');
  document.body.classList.remove('mode-tutorial');
  $('#spellbar').classList.remove('hidden');
  $('#devcast').classList.toggle('hidden', !settings.devcast);
  // Templates on = per-spell assistance (a guide) and an assisted coaching flag.
  gesture.setGuide(practice.templates ? guideTemplateFor(pLoadout[0].id) : null, {
    stage: practice.templates ? 1 : 3,
    showGhost: false,
  });
  setDrawHint('draw spell');
  toast(`Practice vs ${PRACTICE_PROFILES[practice.difficulty].label} AI — draw to cast.`);
}

function onPracticeEnd(sim) {
  running = false;
  const win = sim.winner === 0;
  audio.roundEnd(win); haptic('round');

  // Build the local coaching report from the non-draining event history.
  const report = coachReport(match.coachLog());
  lastCoach = report;

  // Record the difficulty-comparison stat (assisted rounds are excluded).
  const profile = soloProfile();
  recordPracticeResult(profile, practice.difficulty, win, !!match.assisted);
  saveProfile(profile, localStorage);

  const title = sim.winner === 'draw' ? 'Draw' : win ? 'Victory' : 'Defeat';
  $('#result-title').textContent = `${title} · ${PRACTICE_PROFILES[practice.difficulty].label} AI`;
  $('#result-text').textContent =
    `${sim.endReason === 'timer' ? 'Time!' : 'Knockout!'} ` +
    `HP ${Math.round(sim.wizards[0].health)} vs ${Math.round(sim.wizards[1].health)}.`;
  renderCoachReport($('#coach-report'), report, { detail: practice.coaching });
  $('#btn-next-round').classList.add('hidden');
  const rb = document.querySelector('#panel-result [data-action="rematch"]');
  if (rb) rb.textContent = 'Practice again';
  showPanel('panel-result'); showOverlay(true);
}

// ------------------------------------------------------------------ tutorial
function soloProfile() { return loadProfile(localStorage); }

// Tutorial hub: progress summary, continue/replay, chapter list, offline label.
function openTutorialHub() {
  renderTutorialHub();
  showPanel('panel-tutorial');
}

function renderTutorialHub() {
  const p = soloProfile();
  const pct = completionPercent(p, REQUIRED_LESSON_IDS);
  const cur = CAMPAIGN_BY_ID[p.currentLessonId] || CAMPAIGN[0];
  const medalCount = Object.keys(p.medals).length;
  const clueCount = Object.keys(p.clues).length;
  const secretCount = Object.values(p.secretsFound).filter(Boolean).length;
  const grandmaster = p.medals && p.medals.grandmaster === true;

  const sum = $('#tut-summary');
  if (sum) {
    sum.innerHTML =
      `<div class="tut-stat"><span class="k">Chapter</span><span class="v">${cur ? chapterLabel(cur.chapter) : '—'}</span></div>` +
      `<div class="tut-stat"><span class="k">Next lesson</span><span class="v">${cur ? cur.title : 'Complete'}</span></div>` +
      `<div class="tut-stat"><span class="k">Progress</span><span class="v">${pct}%</span></div>` +
      `<div class="tut-stat"><span class="k">Medals</span><span class="v">${medalCount}</span></div>` +
      `<div class="tut-stat"><span class="k">Clues</span><span class="v">${clueCount}</span></div>` +
      `<div class="tut-stat"><span class="k">Secrets</span><span class="v">${secretCount}/4</span></div>` +
      `<div class="tut-stat ranked ${p.rankedReady ? 'on' : ''}"><span class="k">Ranked</span>` +
      `<span class="v">${p.rankedReady ? 'Ready ✓' : 'Locked (win Lesson 12)'}</span></div>` +
      (grandmaster ? '<div class="tut-stat ranked on"><span class="k">Title</span><span class="v">Grandmaster ★</span></div>' : '');
  }

  const list = $('#tut-chapters');
  if (list) {
    list.innerHTML = '';
    for (const ch of chapters()) {
      const sec = document.createElement('section');
      sec.className = 'tut-chapter';
      sec.innerHTML = `<h3>${ch.title}</h3>`;
      if (ch.chapter === 'exam') {
        renderExamChapter(sec, ch, p);
      } else {
        const row = document.createElement('div');
        row.className = 'tut-lessons';
        for (const l of ch.lessons) row.appendChild(lessonButton(l, p));
        sec.appendChild(row);
      }
      list.appendChild(sec);
    }
  }
}

// The final exam renders as locked/unlockable sub-groups with progress counters
// and accessible remaining-requirement text (SOLO-MODES-PLAN §9).
const EXAM_SUBGROUP_ORDER = ['exam-gauntlet', 'exam-scenarios', 'exam-duel', 'exam-grandmaster'];
const EXAM_SUBGROUP_TITLES = {
  'exam-gauntlet': 'Gesture Gauntlet', 'exam-scenarios': 'Tactical Scenarios',
  'exam-duel': 'Final Duel', 'exam-grandmaster': 'Grandmaster Trial',
};

function renderExamChapter(sec, ch, p) {
  const byGroup = {};
  for (const l of ch.lessons) (byGroup[l.group] ||= []).push(l);
  for (const g of EXAM_SUBGROUP_ORDER) {
    const lessons = byGroup[g];
    if (!lessons) continue;
    const sub = document.createElement('div');
    sub.className = 'tut-subgroup';
    let head = EXAM_SUBGROUP_TITLES[g] || g;
    if (EXAM_GROUPS[g]) {
      const gp = groupProgress(p, g);
      head += ` — ${gp.done}/${gp.total} (need ${gp.need}${gp.met ? ' ✓' : ''})`;
    }
    const h = document.createElement('h4');
    h.className = 'tut-subhead';
    h.textContent = head;
    sub.appendChild(h);
    const row = document.createElement('div');
    row.className = 'tut-lessons';
    for (const l of lessons) row.appendChild(lessonButton(l, p));
    sub.appendChild(row);
    sec.appendChild(sub);
  }
}

// Build a single lesson tile. Locked stages are disabled, carry a visible + ARIA
// remaining-requirement line, and cannot be started (also guarded on start).
function lessonButton(l, p) {
  const done = p.completedLessons.includes(l.id);
  const isNext = l.id === p.currentLessonId;
  const unlocked = lessonUnlocked(l, p);
  const btn = document.createElement('button');
  btn.className = 'tut-lesson' + (done ? ' done' : '') + (isNext ? ' next' : '') + (unlocked ? '' : ' locked');
  btn.dataset.lesson = l.id;
  if (!unlocked) {
    const reason = lockReason(l, p) || 'Locked';
    btn.innerHTML = `<span class="tl-title">${l.title}</span><span class="tl-lock">🔒 ${reason}</span>`;
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-label', `${l.title} — ${reason}`);
    return btn;
  }
  const badge = done ? '✓' : (l.optional ? '☆' : '');
  btn.innerHTML = `<span class="tl-title">${l.title}</span><span class="tl-badge">${badge}</span>`;
  btn.setAttribute('aria-label', `${l.title}${done ? ' (completed)' : ''}${l.optional ? ' (optional)' : ''}`);
  btn.addEventListener('click', () => startTutorialLesson(l.id));
  return btn;
}

function chapterLabel(chapter) {
  return { prologue: 'Prologue', core: 'Core Lessons', academy: 'Academy', exam: 'Final Exam', secret: 'Secret Trials' }[chapter] || chapter;
}

// Build the scoped production recognizer + runner for a lesson and show its intro.
function startTutorialLesson(lessonId) {
  const lesson = CAMPAIGN_BY_ID[lessonId];
  if (!lesson) return;
  const profile = soloProfile();
  // Start guard: locked exam stages can never be started, even if reached via a
  // stale Continue pointer or a direct call — surface why and return to the hub.
  if (!lessonUnlocked(lesson, profile)) {
    toast(lockReason(lesson, profile) || 'This exam stage is locked.');
    openTutorialHub();
    return;
  }
  tutorialLesson = lesson;
  mode = 'tutorial';
  series = null;
  const recognizer = new Recognizer(buildTemplates()).forLoadout(makeLoadout(lesson.playerLoadout));
  gesture.recognizer = recognizer;

  tutorial = new TutorialRunner(lesson, {
    recognizer, profile, storage: localStorage,
    reduced: settings.reduced, seed: (Date.now() & 0x7fffffff) >>> 0,
    onState: (s) => onTutorialState(s),
    onObjective: (o) => onTutorialObjective(o),
    onReject: (r) => onTutorialReject(r),
    onComplete: (res) => onTutorialComplete(res),
    onGuide: (g) => onTutorialGuide(g),
    onSeriesRound: (info) => onTutorialSeriesRound(info),
  });

  showLessonIntro(lesson);
}

// Best-of-three round result (Academy 16 / Final Exam): update the series score
// and toast a checkpoint between rounds.
function onTutorialSeriesRound(info) {
  hud.setSeries(info.score, info.round);
  if (!info.decided) {
    audio.roundEnd(info.score[0] > info.score[1]);
    toast(`Round ${info.round} done — series ${info.score[0]}–${info.score[1]}. Next round…`);
  }
}

// Narration is shown BEFORE input becomes active (never over the draw pad).
function showLessonIntro(lesson) {
  $('#lesson-title').textContent = lesson.title;
  const nar = $('#lesson-narration');
  nar.innerHTML = '';
  for (const line of lesson.narration || []) {
    const li = document.createElement('li'); li.textContent = line; nar.appendChild(li);
  }
  const obj = $('#lesson-objectives');
  obj.innerHTML = '';
  for (const o of lesson.objectives) {
    const li = document.createElement('li'); li.textContent = o.text; obj.appendChild(li);
  }
  $('#lesson-offline').textContent = lesson.formal
    ? 'Offline · fair rules · timer on'
    : 'Offline · single-player · no timer';
  showPanel('panel-lesson-intro');
  showOverlay(true);
}

// Begin the active lesson: run first-run calibration if needed, then arm the sim.
function beginTutorialLesson() {
  if (!tutorial) return;
  tutorial.begin();
  if (tutorial.state === STATES.CALIBRATE) {
    const cal = tutorial.profile.calibration || {};
    // Only the FIRST run captures the interactive line/circle/V; later lessons
    // reuse the stored comfort values without re-prompting.
    if (cal.done) {
      tutorial.calibrate({ ...cal, hand: settings.lefthand ? 'left' : 'right' });
      armTutorialLesson();
    } else {
      runCalibration();
    }
    return;
  }
  armTutorialLesson();
}

// Interactive first-run calibration: draw a line, a circle, and a V. The result
// tunes guide sizing + comfort only (recognition thresholds are unchanged).
function runCalibration() {
  showPanel('panel-calibrate');
  showOverlay(true);
  const canvas = $('#calib-canvas');
  calibrator = new Calibration(canvas, {
    reduced: settings.reduced,
    onStep: (label, i, n) => {
      $('#calib-step').textContent = label;
      $('#calib-progress').textContent = `${i + 1} / ${n}`;
    },
    onComplete: (result) => finishCalibration(result),
  });
  // Defer start until the panel is laid out so the canvas has a size.
  requestAnimationFrame(() => { calibrator.start(); });
}

function finishCalibration(result) {
  const hand = settings.lefthand ? 'left' : 'right';
  if (tutorial) tutorial.calibrate({ ...result, hand });
  applyCalibration(result);
  calibrator = null;
  armTutorialLesson();
}

function skipCalibration() {
  const hand = settings.lefthand ? 'left' : 'right';
  const cal = tutorial ? (tutorial.profile.calibration || {}) : {};
  if (tutorial) tutorial.calibrate({ guideScale: cal.guideScale, comfortableDurationMs: cal.comfortableDurationMs, hand, done: true });
  applyCalibration(cal);
  calibrator = null;
  armTutorialLesson();
}

function applyCalibration(cal) {
  if (cal && Number.isFinite(cal.guideScale)) gesture.setGuideScale(cal.guideScale);
}

// Arm the sim + show HUD/coach for the current tutorial lesson (post-calibration).
function armTutorialLesson() {
  if (!tutorial) return;
  document.body.classList.remove('mode-lab');
  resetLastCast();
  match = tutorial;
  running = true;
  hud.showDiag = false;
  hud.setDiag(null);
  hud.setSeries(tutorial.bestOfThree ? tutorial.seriesScore : null, tutorial.seriesRound || 0);
  arena.reset();
  buildCoachPanel(tutorialLesson);
  showOverlay(false);
  $('#hud').classList.remove('hidden');
  $('#spellbar').classList.add('hidden'); // tutorial casts by drawing only
  $('#devcast').classList.add('hidden');
  $('#coach').classList.remove('hidden');
  document.body.classList.add('mode-tutorial');
  // The draw canvas has no layout size while the HUD is hidden. Resize and draw
  // the lesson guide only after revealing it, otherwise the correct template is
  // rendered into a 1x1 transparent canvas.
  gesture.resize();
  onTutorialGuide({ spellId: tutorial.focusSpell ? tutorial.focusSpell.id : null, stage: tutorial.guideStage });
  updateCoachState();
  toast(tutorialLesson.bestOfThree ? 'Best-of-three — win two rounds.' : (tutorialLesson.formal ? 'Formal duel — win the round.' : 'Draw to cast.'));
}

function buildCoachPanel(lesson) {
  $('#coach-title').textContent = lesson.title;
  const ul = $('#coach-objectives');
  ul.innerHTML = '';
  for (const o of lesson.objectives) {
    const li = document.createElement('li');
    li.className = 'coach-obj';
    li.dataset.obj = o.id;
    li.innerHTML = `<span class="co-mark" aria-hidden="true">○</span><span class="co-text">${o.text}</span>`;
    ul.appendChild(li);
  }
  $('#coach-offline').textContent = lesson.formal ? 'Offline duel' : 'Offline lesson';
}

function updateCoachObjectives() {
  if (!tutorial) return;
  document.querySelectorAll('#coach-objectives .coach-obj').forEach((li) => {
    const done = tutorial.objectiveStatus[li.dataset.obj];
    li.classList.toggle('done', !!done);
    const mark = li.querySelector('.co-mark');
    if (mark) mark.textContent = done ? '✓' : '○';
  });
}

function updateCoachState() {
  if (!tutorial) return;
  const gi = $('#coach-guide');
  if (gi) gi.textContent = `Guide: ${tutorial.focusSpell ? 'Dotted' : 'None'}`;
  const failed = tutorial.state === STATES.ATTEMPT_FAILED;
  $('#coach-remediate').classList.toggle('hidden', !failed);
  const fr = $('#coach-fail');
  if (failed && tutorial.failReason) {
    fr.textContent = ({
      'too-few-points': 'Draw a longer stroke across the pad.',
      'below-threshold': 'Follow the shape from the start dot in the shown direction.',
      ambiguous: 'Make the defining corner or direction more distinct.',
      'wrong-spell': 'Valid glyph — but this objective needs the highlighted spell.',
      'round-lost': 'The round ended first. Try again.',
    })[tutorial.failReason] || tutorial.failReason;
    fr.classList.remove('hidden');
  } else {
    fr.classList.add('hidden');
  }
}

function onTutorialState(s) {
  updateCoachState();
  // A lost round (formal duel, or a rare teaching-lesson death) is not a mere
  // recognition failure — surface the result panel with a clean replay path so
  // the player is never stuck on an ended simulation.
  if (s === STATES.ATTEMPT_FAILED && tutorial && (tutorial.failReason === 'round-lost' || tutorial.failReason === 'series-lost')) {
    running = false;
    const seriesLost = tutorial.failReason === 'series-lost';
    $('#result-title').textContent = `${tutorialLesson.title} — ${seriesLost ? 'series lost' : 'round lost'}`;
    $('#result-text').textContent = seriesLost
      ? `The best-of-three ended ${tutorial.seriesScore[0]}–${tutorial.seriesScore[1]}. Replay the lesson to try again.`
      : 'The round ended before you met the objectives. Replay the lesson to try again.';
    $('#btn-next-round').classList.add('hidden');
    const rb = document.querySelector('#panel-result [data-action="rematch"]');
    if (rb) rb.textContent = 'Replay lesson';
    $('#coach-report').classList.add('hidden');
    showPanel('panel-result'); showOverlay(true);
  }
}

function onTutorialObjective() {
  audio.unlock(); haptic('accept');
  updateCoachObjectives();
}

function onTutorialReject(r) {
  audio.reject();
  updateCoachState();
  if (r && r.message) toast(r.message);
}

function onTutorialGuide(g) {
  const canvas = $('#draw-canvas');
  if (!g || g.spellId == null) {
    gesture.setGuide(null);
    setDrawHint('draw without a guide');
    if (canvas) {
      delete canvas.dataset.guideSpell;
      canvas.dataset.guideStage = 'none';
    }
  } else {
    // Every instructional spell keeps a visible dotted template. Exam gauntlets
    // remain guide-free because they intentionally provide no focus spell.
    gesture.setGuide(guideTemplateFor(g.spellId), { stage: 1, showGhost: false });
    const spell = SPELLS_BY_ID[g.spellId];
    setDrawHint(`draw ${spell ? spell.name : 'spell'} — follow the dotted line`);
    if (canvas) {
      canvas.dataset.guideSpell = String(g.spellId);
      canvas.dataset.guideStage = 'dotted';
    }
  }
  updateCoachState();
}

function onTutorialComplete(res) {
  running = false;
  audio.roundEnd(true); haptic('round');
  const lesson = tutorialLesson;
  const bits = [];
  if (res.medal) bits.push(`Medal earned: ${res.medal.text || res.medal.id}.`);
  if (res.clues && res.clues.length) bits.push('A secret clue was revealed.');
  if (res.secretFound) bits.push(`Secret discovered: ${SECRETS.find((s) => s.spellId === res.secretFound)?.name || 'a hidden glyph'}!`);
  if (lesson.reward && lesson.reward.rankedReady) bits.push('Ranked play unlocked — all public spells available.');

  $('#result-title').textContent = `${lesson.title} complete`;
  $('#result-text').textContent = bits.join(' ') || 'Objective complete. Well drawn.';
  const nextId = nextRequiredLesson(lesson.id);
  const nextBtn = $('#btn-next-round');
  if (nextId) { nextBtn.textContent = 'Continue'; nextBtn.classList.remove('hidden'); }
  else nextBtn.classList.add('hidden');
  const rematchBtn = document.querySelector('#panel-result [data-action="rematch"]');
  if (rematchBtn) rematchBtn.textContent = 'Replay lesson';
  $('#coach-report').classList.add('hidden');
  showPanel('panel-result'); showOverlay(true);
  // remember next lesson for the Continue button
  window.__tutNext = nextId;
}

function nextRequiredLesson(lessonId) {
  const idx = CAMPAIGN.findIndex((l) => l.id === lessonId);
  for (let i = idx + 1; i < CAMPAIGN.length; i++) return CAMPAIGN[i].id;
  return null;
}

// Remediation controls (Show Me / Try again) from the coach panel.
function tutorialShowMe() {
  if (!tutorial) return;
  tutorial.remediate();               // regress a guide stage (never auto-casts)
  gesture.playGhost();                // replay the canonical trace
  updateCoachState();
}
function tutorialTryAgain() {
  if (!tutorial) return;
  tutorial.retry();
  updateCoachState();
}

// ------------------------------------------------------------------ main loop
function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'castStart') {
      const sp = SPELLS_BY_ID[e.spellId];
      if (sp) audio.castStart(sp.school);
      if (e.caster === 1 && sp && sp.charges >= 1) audio.heavyWarn();
    } else if (e.type === 'cast') {
      const sp = SPELLS_BY_ID[e.spellId];
      if (sp) audio.cast(sp.school);
      if (e.caster === 0) showLastCast(e.spellId);
      if (mode === 'tutorial' && tutorialLesson?.id === 'L07'
          && e.caster === 1 && e.spellId === 3) {
        toast('Lightning released — wait until it gets close, then tap Dodge!');
      }
    } else if (e.type === 'damage') {
      audio.damage(); if (e.target === 0) haptic('damage');
    } else if (e.type === 'castRejected' && e.caster === 0 && e.reason === 'cooldown') {
      const spell = SPELLS_BY_ID[e.spellId];
      const seconds = Number(e.cooldownSeconds) || 0;
      const remaining = seconds < 10 ? `${seconds.toFixed(1)} seconds` : `${Math.ceil(seconds)} seconds`;
      audio.reject(); haptic('reject');
      toast(`${spell ? spell.name : 'That spell'} is on cooldown — ${remaining} remaining.`);
    } else if (e.type === 'reflect') { audio.reflect(); haptic('counter'); }
    else if (e.type === 'shield' || e.type === 'barrier') audio.shield();
    else if (e.type === 'focusComplete') audio.focus();
    else if (e.type === 'reaction') { audio.shield(); toast(`Reaction: ${e.name}`); }
    else if (e.type === 'phoenixSave') toast('Phoenix Covenant saved the wizard!');
    else if (e.type === 'interrupt' || e.type === 'controlResisted') haptic('counter');
  }
  arena.handleEvents(events, match.sim);
}

let lastT = performance.now();
let idleRenderAcc = 0;
function frame(now) {
  const dt = Math.min(64, now - lastT); lastT = now;
  if (match && running) {
    idleRenderAcc = 0;
    applyInputBridge();
    match.update(dt);
    const evs = match.drainEvents();
    if (evs.length) handleEvents(evs);
    hud.update(match.sim);
    arena.update(match.sim, match.alpha, dt);
  } else if (match) {
    idleRenderAcc = 0;
    arena.update(match.sim, match.alpha, dt);
  } else {
    // The detailed academy is decorative while menus are open. Rendering it at
    // 20 FPS keeps menu/touch input responsive on low-end phones and software GL
    // without affecting live-duel frame rate.
    idleRenderAcc += dt;
    if (idleRenderAcc >= 50) {
      arena.renderIdle(idleRenderAcc);
      idleRenderAcc = 0;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ loadout builder
let draftIds = [];

// ------------------------------------------------------------------ practice vs AI
// Fill the player + opponent selects (once) and reflect saved settings.
function buildPracticeSelects() {
  const player = $('#prac-player');
  const opp = $('#prac-opp');
  if (player && !player.dataset.built) {
    const cur = document.createElement('option'); cur.value = 'current'; cur.textContent = 'Current loadout'; player.appendChild(cur);
    for (const p of PRESETS) { const o = document.createElement('option'); o.value = p.key; o.textContent = p.name; player.appendChild(o); }
    player.dataset.built = '1';
    player.addEventListener('change', (e) => { practice.playerPreset = e.target.value; onPracticeConfigChange(); });
  }
  if (opp && !opp.dataset.built) {
    const auto = document.createElement('option'); auto.value = 'auto'; auto.textContent = 'Auto (fair for difficulty)'; opp.appendChild(auto);
    for (const p of PRESETS) { const o = document.createElement('option'); o.value = p.key; o.textContent = p.name; opp.appendChild(o); }
    opp.dataset.built = '1';
    opp.addEventListener('change', (e) => { practice.opponentPreset = e.target.value; onPracticeConfigChange(); });
  }
  wirePracticeControls();
}

let _pracWired = false;
function wirePracticeControls() {
  if (_pracWired) return;
  _pracWired = true;
  $('#prac-diff').addEventListener('change', (e) => { practice.difficulty = e.target.value; onPracticeConfigChange(); });
  $('#prac-timed').addEventListener('change', (e) => { practice.timed = e.target.value !== 'untimed'; onPracticeConfigChange(); });
  $('#prac-coaching').addEventListener('change', (e) => { practice.coaching = e.target.value; onPracticeConfigChange(); });
  $('#prac-templates').addEventListener('change', (e) => { practice.templates = e.target.checked; onPracticeConfigChange(); });
  $('#prac-fixseed').addEventListener('change', (e) => {
    const box = $('#prac-seed'); box.disabled = !e.target.checked;
    practice.fixedSeed = e.target.checked ? (parseInt(box.value, 10) || 0) : null;
    onPracticeConfigChange();
  });
  $('#prac-seed').addEventListener('change', (e) => {
    if ($('#prac-fixseed').checked) { practice.fixedSeed = parseInt(e.target.value, 10) || 0; onPracticeConfigChange(); }
  });
}

function reflectPracticeControls() {
  $('#prac-diff').value = practice.difficulty;
  $('#prac-player').value = PRESETS_BY_KEY[practice.playerPreset] ? practice.playerPreset : 'current';
  $('#prac-opp').value = PRESETS_BY_KEY[practice.opponentPreset] ? practice.opponentPreset : 'auto';
  $('#prac-timed').value = practice.timed ? 'timed' : 'untimed';
  $('#prac-coaching').value = practice.coaching;
  $('#prac-templates').checked = !!practice.templates;
  const fixed = practice.fixedSeed != null;
  $('#prac-fixseed').checked = fixed;
  $('#prac-seed').disabled = !fixed;
  if (fixed) $('#prac-seed').value = String(practice.fixedSeed);
}

function openPractice() {
  buildPracticeSelects();
  reflectPracticeControls();
  onPracticeConfigChange();
  showPanel('panel-practice');
}

// Persist settings and refresh the (shown-by-default) opponent + player preview.
function onPracticeConfigChange() {
  const profile = soloProfile();
  setPractice(profile, {
    difficulty: practice.difficulty, playerPreset: practice.playerPreset,
    opponentPreset: practice.opponentPreset, coaching: practice.coaching,
    timed: practice.timed, templates: practice.templates,
  });
  saveProfile(profile, localStorage);
  // Fix a seed for the preview so the shown opponent matches the round we start.
  practiceSeed = resolvePracticeSeed();
  updatePracticeSummaries();
}

function updatePracticeSummaries() {
  const oppEl = $('#prac-opp-preview');
  const pEl = $('#prac-player-summary');
  if (!practice) return;
  const playerPracticeIds = resolvePlayerPracticeIds();
  if (pEl) {
    const names = makeLoadout(playerPracticeIds).map((s) => s.name).join(', ');
    const pts = playerPracticeIds.reduce((a, id) => a + (SPELLS_BY_ID[id]?.loadout_points || 0), 0);
    pEl.textContent = `Your loadout (${pts} pts): ${names}`;
  }
  if (oppEl) {
    const seed = practiceSeed != null ? practiceSeed : resolvePracticeSeed();
    const oppIds = resolveOpponentPracticeIds(playerPracticeIds, seed);
    const names = oppIds.map((id) => SPELLS_BY_ID[id]?.name).join(', ');
    const auto = practice.opponentPreset === 'auto';
    oppEl.innerHTML = `<strong>Opponent${auto ? ' (auto)' : ''}:</strong> ${names}`;
  }
}

function openLoadoutBuilder() {
  draftIds = playerIds.slice();
  renderPresetButtons();
  renderCatalog();
  renderLoadoutState();
  showPanel('panel-loadout');
}

function renderPresetButtons() {
  const wrap = $('#loadout-presets');
  wrap.innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'preset-btn';
    b.innerHTML = `<strong>${p.name}</strong><small>${p.blurb}</small>`;
    b.addEventListener('click', () => { draftIds = p.ids.slice(); renderCatalog(); renderLoadoutState(); });
    wrap.appendChild(b);
  }
}

const CATEGORY_ORDER = ['Offensive', 'Defensive', 'Buff', 'Debuff', 'Control', 'Environmental', 'Secret'];

function renderCatalog() {
  const wrap = $('#loadout-catalog');
  wrap.innerHTML = '';
  for (const cat of CATEGORY_ORDER) {
    const group = document.createElement('div');
    group.className = 'cat-group';
    group.innerHTML = `<h4>${cat}</h4>`;
    const row = document.createElement('div');
    row.className = 'cat-row';
    for (const s of SPELL_CATALOG.filter((x) => x.category === cat)) {
      const chip = document.createElement('button');
      const picked = draftIds.includes(s.id);
      chip.className = 'spell-chip' + (picked ? ' picked' : '') + (s.secret ? ' secret' : '');
      chip.innerHTML = `<span class="chip-name">${s.name}</span>` +
        `<span class="chip-meta">${s.school} · ${s.loadout_points}p${s.charges ? ' · ' + '#'.repeat(s.charges) : ''}</span>`;
      chip.title = s.effect;
      chip.addEventListener('click', () => toggleDraft(s.id));
      row.appendChild(chip);
    }
    group.appendChild(row);
    wrap.appendChild(group);
  }
}

function toggleDraft(id) {
  const i = draftIds.indexOf(id);
  if (i >= 0) draftIds.splice(i, 1);
  else if (draftIds.length < 8) draftIds.push(id);
  else toast('Loadout is full (8 spells). Remove one first.');
  renderCatalog();
  renderLoadoutState();
}

function renderLoadoutState() {
  const v = validateLoadout(draftIds);
  const picked = $('#loadout-picked');
  picked.innerHTML = draftIds.map((id) => {
    const s = SPELLS_BY_ID[id];
    return `<span class="picked-chip">${s.name} <em>${s.loadout_points}p</em></span>`;
  }).join('') || '<span class="muted">No spells selected.</span>';

  const status = $('#loadout-status');
  const schools = Object.entries(v.schoolCounts).map(([k, n]) => `${k} ${n}`).join(' · ');
  let html = `<div class="ls-line">${draftIds.length}/8 spells · ${v.points}/14 points · ${v.heavyCount} heavy · ${schools || 'no schools'}</div>`;
  for (const err of v.errors) html += `<div class="ls-err">✗ ${err}</div>`;
  for (const warn of v.warnings) html += `<div class="ls-warn">! ${warn}</div>`;
  if (v.valid) html += '<div class="ls-ok">✓ Legal loadout</div>';
  status.innerHTML = html;
  const saveBtn = $('[data-action="save-loadout"]');
  if (saveBtn) saveBtn.disabled = !v.valid;
}

function saveLoadout() {
  const v = validateLoadout(draftIds);
  if (!v.valid) { toast('Loadout is not legal yet.'); return; }
  playerIds = draftIds.slice();
  rebuildForLoadout();
  toast('Loadout saved.');
  openPractice();
}

// ------------------------------------------------------------------ online duel
function updateOnlineSummary() {
  const el = $('#online-loadout-summary');
  if (!el) return;
  const names = playerLoadout.map((s) => s.name).join(', ');
  const pts = playerLoadout.reduce((a, s) => a + s.loadout_points, 0);
  el.textContent = `Your loadout (${pts} pts): ${names}`;
}

function openOnline() {
  updateOnlineSummary();
  const id = clientIdentity();
  $('#online-name').value = id.name || '';
  $('#online-error').textContent = '';
  $('#online-code').value = '';
  showPanel('panel-online');
  updateConnBadges({ state: online && online.connected ? 'connected' : 'idle', rttMs: online ? online.rtt : null });
}

function onlineErrorText(ack) {
  const code = ack && ack.code;
  const map = {
    'invalid-loadout': 'Your loadout is not legal. Edit it first.',
    'no-room': 'No duel found with that code.',
    'bad-code': 'Enter a valid 5-character code.',
    'room-full': 'That room is already full.',
    incompatible: 'Update required — client and server versions differ.',
    'in-match': 'Already in a duel or queue.',
    draining: 'Server is restarting. Try again shortly.',
    offline: 'Cannot reach the server.',
    timeout: 'The server did not respond.',
  };
  return map[code] || (ack && ack.errors && ack.errors[0]) || 'Something went wrong. Try again.';
}

function showOnlineError(msg) {
  const el = $('#online-error');
  if (el) el.textContent = msg;
  showPanel('panel-online');
}

async function ensureOnline() {
  if (online && online.connected) return online;
  if (!online) { online = new OnlineMatch({ url: effectiveServerUrl(), loadoutIds: playerIds }); wireOnlineCallbacks(online); }
  await online.connect();
  return online;
}

function wireOnlineCallbacks(o) {
  o.onMatchStart = () => onOnlineMatchStart();
  o.onRoundEnd = (p) => onOnlineRoundEnd(p);
  o.onMatchEnd = (p) => onOnlineMatchEnd(p);
  o.onStatus = (p) => onOnlineStatus(p);
  o.onRoom = () => {};
  o.onConnection = (p) => updateConnBadges(p);
  o.onError = (err) => onOnlineError(err);
  o.onCastAck = (ack) => { if (ack && !ack.ok && ack.code === 'rate') toast('Slow down — too many casts.'); };
}

async function startOnlineAction(kind, code) {
  const nm = $('#online-name').value.trim();
  if (nm) setDisplayName(nm);
  rebuildForLoadout(); // ensure the recognizer matches the equipped loadout
  try { await ensureOnline(); } catch (err) { onOnlineError(err); return; }
  online.setLoadout(playerIds);
  if (nm) online.identity.name = nm;
  let ack;
  if (kind === 'quick') ack = await online.quickMatch();
  else if (kind === 'create') ack = await online.createRoom();
  else if (kind === 'join') ack = await online.joinRoom(String(code || '').toUpperCase());
  if (!ack || !ack.ok) { showOnlineError(onlineErrorText(ack)); return; }
  showWaiting(kind, ack);
}

function showWaiting(kind, ack) {
  mode = 'online-wait';
  const codeBox = $('#wait-code');
  if (kind === 'create') {
    $('#wait-title').textContent = 'Waiting for opponent';
    $('#wait-text').textContent = 'Share your code. The duel starts when they join.';
    $('#wait-code-value').textContent = ack.code;
    codeBox.classList.remove('hidden');
  } else if (kind === 'join') {
    $('#wait-title').textContent = 'Joining duel…';
    $('#wait-text').textContent = 'Connecting to the room.';
    codeBox.classList.add('hidden');
  } else {
    $('#wait-title').textContent = 'Finding a duel…';
    $('#wait-text').textContent = 'Matching you with an opponent of similar rating.';
    codeBox.classList.add('hidden');
  }
  showPanel('panel-online-wait');
}

function copyRoomCode() {
  const code = $('#wait-code-value').textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Code copied')).catch(() => toast(code));
  else toast(code);
}

function cancelOnline() {
  if (online) online.leave();
  mode = null;
  showPanel('panel-online');
}

function onOnlineMatchStart() {
  mode = 'online';
  document.body.classList.remove('mode-lab', 'mode-tutorial');
  resetLastCast();
  match = online;
  series = null;
  onlineRoundIndex = 0;
  running = true;
  hud.showDiag = false;
  hud.setDiag(null);
  hud.setSeries([0, 0], 0);
  arena.reset();
  showOverlay(false);
  $('#hud').classList.remove('hidden');
  $('#spellbar').classList.add('hidden');  // online: draw to cast
  $('#devcast').classList.add('hidden');
  gesture.setGuide(null);
  setNetStatus('connected');
  toast('Duel found! Draw glyphs to cast.');
}

function onOnlineRoundEnd(p) {
  onlineRoundIndex += 1;
  if (Array.isArray(p.score)) hud.setSeries(p.score, onlineRoundIndex);
  const label = p.winner === 'win' ? 'Round won' : p.winner === 'loss' ? 'Round lost' : 'Round drawn';
  audio.roundEnd(p.winner === 'win'); haptic('round');
  toast(`${label} — series ${p.score ? p.score[0] : 0}–${p.score ? p.score[1] : 0}`);
}

function onOnlineMatchEnd(p) {
  running = false;
  const win = p.winner === 'win';
  audio.roundEnd(win); haptic('round');
  $('#result-title').textContent = win ? 'Series won!' : p.winner === 'draw' ? 'Series drawn' : 'Series lost';
  const reason = p.reason === 'disconnect' ? ' (opponent left)' : p.reason === 'forfeit' ? ' (opponent forfeited)'
    : p.reason === 'connection-lost' ? ' (you lost connection)' : '';
  const score = Array.isArray(p.score) ? `${p.score[0]}–${p.score[1]}` : '';
  $('#result-text').textContent = `Online duel${score ? ` ${score}` : ''}${reason}.`;
  $('#btn-next-round').classList.add('hidden');
  $('#coach-report').classList.add('hidden');
  setNetStatus(null);
  showPanel('panel-result'); showOverlay(true);
}

function onOnlineStatus(p) {
  const s = p && p.state;
  if (s === 'reconnecting') { setNetStatus('reconnecting'); toast('Connection lost — reconnecting…'); }
  else if (s === 'resuming') setNetStatus('resuming');
  else if (s === 'resumed') { setNetStatus('connected'); toast('Reconnected.'); }
  else if (s === 'resume-failed') { setNetStatus('lost'); toast('Could not rejoin the duel.'); }
  else if (s === 'disconnected') { setNetStatus('opponent'); toast('Opponent disconnected — waiting…'); }
  else if (s === 'returned') { setNetStatus('connected'); toast('Opponent reconnected.'); }
  else if (s === 'aborted') { setNetStatus('lost'); toast('Server restarting — duel ended.'); }
}

function onOnlineError(err) {
  const code = err && (err.code || (err.data && err.data.code));
  if (code === 'incompatible') toast('Update required — version mismatch.');
  else toast(err && err.message ? `Network: ${err.message}` : 'Network error.');
  if (mode === 'online-wait' || !online || !online.inMatch) showOnlineError(onlineErrorText({ code }));
}

function setNetStatus(kind) {
  const el = $('#net-status');
  if (!el) return;
  if (!kind) { el.classList.add('hidden'); return; }
  const map = {
    connected: '● online', reconnecting: '◌ reconnecting…', resuming: '◌ rejoining…',
    opponent: '◌ opponent away…', lost: '✕ disconnected',
  };
  el.classList.remove('hidden');
  el.textContent = map[kind] || kind;
  el.className = `net-status ns-${kind}`;
}

function updateConnBadges(p) {
  const q = p && p.quality;
  const rtt = p && p.rttMs != null ? ` · ${Math.round(p.rttMs)}ms` : '';
  let text = 'connecting…';
  if (p && p.state === 'connected') text = `${q && q !== 'unknown' ? q : 'connected'}${rtt}`;
  else if (p && p.state === 'disconnected') text = 'disconnected';
  else if (p && p.state === 'error') text = 'server unreachable';
  else if (p && p.state === 'idle') text = 'not connected';
  for (const id of ['#conn-quality', '#conn-quality-wait']) {
    const el = $(id);
    if (el) { el.textContent = text; el.className = `conn-badge cq-${(p && p.state) || 'idle'}${q ? ' q-' + q : ''}`; }
  }
  if (mode === 'online' && online && online.inMatch && p && p.state === 'connected') setNetStatus('connected');
}

function disposeOnline() { if (online) { online.dispose(); online = null; } }

// ------------------------------------------------------------------ menu / overlay
function showOverlay(v) { $('#overlay').classList.toggle('hidden', !v); }
function showPanel(id) {
  document.querySelectorAll('#overlay .panel').forEach((p) => p.classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
}

document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.unlock();
    const a = btn.dataset.action;
    if (a === 'tutorial') openTutorialHub();
    else if (a === 'lab') startLab();
    else if (a === 'practice-ai') openPractice();
    else if (a === 'start-practice') startPractice();
    else if (a === 'online') openOnline();
    else if (a === 'online-quick') startOnlineAction('quick');
    else if (a === 'online-create') startOnlineAction('create');
    else if (a === 'online-join') startOnlineAction('join', $('#online-code').value);
    else if (a === 'online-cancel') cancelOnline();
    else if (a === 'online-copy') copyRoomCode();
    else if (a === 'loadout') openLoadoutBuilder();
    else if (a === 'settings') openSettings();
    else if (a === 'server-save') saveServerUrl();
    else if (a === 'server-reset') resetServerUrl();
    else if (a === 'privacy') openPrivacy();
    else if (a === 'delete-data') deleteMyData();
    else if (a === 'tut-continue') startTutorialLesson(resolveContinueLesson());
    else if (a === 'tut-begin') beginTutorialLesson();
    else if (a === 'tut-showme') tutorialShowMe();
    else if (a === 'tut-tryagain') tutorialTryAgain();
    else if (a === 'calib-skip') skipCalibration();
    else if (a === 'save-loadout') saveLoadout();
    else if (a === 'clear-loadout') { draftIds = []; renderCatalog(); renderLoadoutState(); }
    else if (a === 'next-round') { if (mode === 'tutorial') continueTutorial(); }
    else if (a === 'back' || a === 'menu') returnToMainMenu();
    else if (a === 'rematch') {
      $('#coach-report').classList.add('hidden');
      if (mode === 'tutorial') { if (tutorialLesson) startTutorialLesson(tutorialLesson.id); }
      else if (mode === 'online') {
        running = false; match = null; mode = null; setNetStatus(null);
        hud.setSeries(null); $('#hud').classList.add('hidden');
        openOnline(); showOverlay(true);
      } else if (mode === 'practice') startPractice();
      else startLab();
    }
  });
});

function continueTutorial() {
  const p = soloProfile();
  const nextId = window.__tutNext;
  if (nextId && CAMPAIGN_BY_ID[nextId] && !p.completedLessons.includes(nextId) && lessonUnlocked(CAMPAIGN_BY_ID[nextId], p)) {
    startTutorialLesson(nextId);
    return;
  }
  const avail = firstAvailableLessonId(p);
  if (avail) startTutorialLesson(avail);
  else openTutorialHub();
}

// The Continue button stays on a playable, unlocked lesson: the saved position if
// still startable, otherwise the first unlocked incomplete lesson in campaign order.
function resolveContinueLesson() {
  const p = soloProfile();
  const cur = CAMPAIGN_BY_ID[p.currentLessonId];
  if (cur && !p.completedLessons.includes(cur.id) && lessonUnlocked(cur, p)) return cur.id;
  return firstAvailableLessonId(p) || p.currentLessonId;
}

$('#btn-menu').addEventListener('click', () => { running = false; if (mode === 'online' && online) online.setActive(false); if (mode === 'tutorial' && tutorial) tutorial.pause(); showPanel('panel-main'); showOverlay(true); });

// ------------------------------------------------------------------ settings
function applySettings() {
  document.body.classList.toggle('lefthand', settings.lefthand);
  document.body.classList.toggle('reduced', settings.reduced);
  movement.setLefthand(settings.lefthand);
  gesture.setReduced(settings.reduced);
  arena.setReduced(settings.reduced);
  audio.setEnabled(settings.audio);
  $('#devcast').classList.toggle('hidden', !settings.devcast || !match || mode === 'online');
}
$('#set-lefthand').addEventListener('change', (e) => { settings.lefthand = e.target.checked; applySettings(); });
$('#set-reduced').addEventListener('change', (e) => { settings.reduced = e.target.checked; applySettings(); });
$('#set-audio').addEventListener('change', (e) => { settings.audio = e.target.checked; applySettings(); });
$('#set-haptics').addEventListener('change', (e) => { settings.haptics = e.target.checked; });
$('#set-devcast').addEventListener('change', (e) => { settings.devcast = e.target.checked; applySettings(); });

// ----------------------------------------------------- server URL + local data
function openSettings() {
  const input = $('#set-server-url');
  if (input) input.value = getStoredServerUrl();
  setServerStatus(describeServerTarget(), '');
  showPanel('panel-settings');
}
function setServerStatus(msg, cls) {
  const el = $('#server-url-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'server-status' + (cls ? ' ' + cls : '');
}
function saveServerUrl() {
  const res = setStoredServerUrl($('#set-server-url').value);
  if (!res.ok) { setServerStatus(res.error, 'err'); return; }
  $('#set-server-url').value = res.url;
  disposeOnline(); // reconnect to the new target on the next online action
  setServerStatus(`Saved. ${describeServerTarget()}`, 'ok');
  toast('Online service updated.');
}
function resetServerUrl() {
  setStoredServerUrl('');
  $('#set-server-url').value = '';
  disposeOnline();
  setServerStatus(`Reset. ${describeServerTarget()}`, 'ok');
  toast('Using the default service.');
}
function openPrivacy() {
  window.location.href = './privacy.html';
}
function deleteMyData() {
  if (!window.confirm('Delete all local data? This erases your device identity, name, settings, and your solo progress — tutorial completion, calibration, medals, secret-clue and secret-spell discoveries, Practice vs AI settings and results, and local coaching statistics. This cannot be undone.')) return;
  if (online) { try { online.leave(); } catch { /* ignore */ } disposeOnline(); }
  try {
    ['aeth-client-id', 'aeth-name', 'aeth-resume', 'aeth-server-url'].forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
  try { deleteProfile(localStorage); } catch { /* ignore */ } // solo progress / calibration / medals / clues / secrets / practice settings + results / coaching stats
  tutorial = null; tutorialLesson = null;
  initPractice();
  const su = $('#set-server-url'); if (su) su.value = '';
  const on = $('#online-name'); if (on) on.value = '';
  setServerStatus('Local data deleted, including solo progress, calibration, medals, clues, secret discoveries, Practice settings + results, and coaching stats.', 'ok');
  toast('Your local data was deleted.');
}

// Full teardown back to the main menu (shared by the Back/Menu buttons and the
// Android hardware back button).
function returnToMainMenu() {
  running = false; match = null; series = null; tutorial = null; tutorialLesson = null; calibrator = null;
  if (online) { if (mode === 'online' || mode === 'online-wait') online.leave(); disposeOnline(); }
  mode = null; setNetStatus(null); hud.setSeries(null);
  gesture.setGuide(null);
  document.body.classList.remove('mode-tutorial', 'mode-lab');
  $('#coach-report').classList.add('hidden');
  $('#hud').classList.add('hidden'); $('#coach').classList.add('hidden'); showPanel('panel-main'); showOverlay(true);
}

// Android hardware/gesture back: close subpanels first, confirm before
// abandoning a live online duel, otherwise pause/exit consistently.
function nativeBack() {
  const overlayShown = !$('#overlay').classList.contains('hidden');
  if (overlayShown) {
    const active = document.querySelector('#overlay .panel:not(.hidden)');
    const id = active && active.id;
    if (id === 'panel-online-wait') { cancelOnline(); return; }
    if (!id || id === 'panel-main') {
      if (mode === 'online' && online && online.inMatch
        && !window.confirm('Leave Aetherglyph? Your online duel will be forfeited.')) return;
      exitApp();
      return;
    }
    returnToMainMenu(); // any other subpanel -> back to the main menu
    return;
  }
  // A live match is on screen (overlay hidden).
  if (mode === 'online' && online && online.inMatch) {
    running = false; online.setActive(false);
    if (window.confirm('Abandon this online duel? You will forfeit the match.')) returnToMainMenu();
    else if (!document.hidden) { online.setActive(true); running = true; }
    return;
  }
  // Offline match -> open the pause menu (mirrors the corner menu button).
  running = false; showPanel('panel-main'); showOverlay(true);
}

// ------------------------------------------------------------------ misc
let toastTimer = null;
function toast(msg) {
  if (!msg) return;
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// Background/foreground handling shared by the browser Page Visibility API and
// the native app lifecycle. Captures the pre-background running state once so a
// duplicate background event (both APIs can fire) does not clobber resume.
function onBackgroundChange(hidden) {
  if (hidden) {
    if (!pausedForVisibility) pausedForVisibility = running;
    running = false;
    if (mode === 'online' && online) online.setActive(false); // stop issuing inputs while backgrounded
    if (mode === 'tutorial' && tutorial) tutorial.pause();
  } else {
    if (mode === 'online' && online) {
      online.setActive(true);
      if (online.inMatch) { running = true; setNetStatus(online.connected ? 'connected' : 'reconnecting'); }
    } else if (mode === 'tutorial' && tutorial) {
      if (tutorial.state === STATES.PAUSED) tutorial.resume();
      if (tutorial.sim && !tutorial.sim.ended && pausedForVisibility) running = true;
    } else if (pausedForVisibility && match && !match.sim.ended) {
      running = true;
    }
    pausedForVisibility = false;
  }
}
document.addEventListener('visibilitychange', () => onBackgroundChange(document.hidden));

// ------------------------------------------------------------------ boot
function initPractice() {
  const profile = soloProfile();
  practice = { ...profile.practice, fixedSeed: null };
  practiceSeed = null;
  // Apply the stored calibration guide size to the pad up front.
  if (profile.calibration && Number.isFinite(profile.calibration.guideScale)) {
    gesture.setGuideScale(profile.calibration.guideScale);
  }
}
initPractice();
rebuildForLoadout();
console.log('Aetherglyph client', versionTag());
showOverlay(true);
showPanel('panel-main');

// Minimal, harmless test hook for the headless browser smoke (test/browser).
// It only inspects or ends the CURRENT offline local match early — it cannot
// touch an authoritative online match (that Sim lives on the server), so it
// gives no gameplay advantage. Never referenced by normal play.
if (typeof window !== 'undefined') {
  window.__aegTest = {
    info: () => ({
      mode,
      difficulty: match && match.difficulty,
      botActive: !!(match && match.botActive),
      hasBot: !!(match && match.bot),
      selectedGuideId,
      assisted: !!(match && match.assisted),
      playerCasting: match?.sim?.wizards?.[0]?.casting?.spellId ?? null,
      playerCastsResolved: match?.sim?.wizards?.[0]?.castsResolved ?? 0,
      playerBraceTicks: match?.sim?.wizards?.[0]?.braceTicks ?? 0,
      labCooldowns,
    }),
    forceEnd: (winner = 0) => {
      try { if (match && match.sim && typeof match.sim.endMatch === 'function' && !match.sim.ended) match.sim.endMatch(winner, 'health'); } catch { /* ignore */ }
    },
  };

  // Dev-only VFX gallery hook. Not wired to any production UI element; it only
  // asks the renderer to draw a representative object for a given spell so a
  // headless smoke test (or a developer) can confirm every visual family draws
  // without WebGL errors and that the produced VFX kinds are distinct. It never
  // touches the simulation, so it grants no gameplay effect.
  window.__aegVfx = {
    profiles: () => VFX_IDS.map((id) => ({ id, kind: SPELL_VFX[id].kind, family: SPELL_VFX[id].family, school: SPELL_VFX[id].school })),
    spawn: (id) => { try { return arena.debugSpawn(Number(id)); } catch (e) { return { error: String(e && e.message || e) }; } },
    spawnZone: (kind) => { try { return arena.debugSpawnZone(String(kind)); } catch (e) { return { error: String(e && e.message || e) }; } },
    spawnGuard: (kind) => { try { return arena.debugSpawnGuard(String(kind)); } catch (e) { return { error: String(e && e.message || e) }; } },
    spawnReaction: (name) => { try { return arena.debugSpawnReaction(String(name)); } catch (e) { return { error: String(e && e.message || e) }; } },
    productionReaction: (name) => { try { return arena.debugProductionReaction(String(name)); } catch (e) { return { error: String(e && e.message || e) }; } },
    reactionProfiles: () => REACTION_VFX_NAMES.map((n) => ({ name: n, kind: REACTION_VFX[n].kind, vfx: REACTION_VFX[n].vfx, anchor: REACTION_VFX[n].anchor })),
    reactionCoverage: () => { try { return reactionVfxCoverage(); } catch { return ['error']; } },
    productionRelease: (id) => { try { return arena.debugProductionRelease(Number(id)); } catch (e) { return { error: String(e && e.message || e) }; } },
    productionMotion: () => { try { return arena.debugProductionMotion(); } catch { return null; } },
    productionCount: () => { try { return arena.debugProductionCount(); } catch { return -1; } },
    playerHitSafety: (id) => { try { return arena.debugPlayerHitSafety(Number(id)); } catch { return []; } },
    kinds: () => { try { return arena.debugKinds(); } catch { return []; } },
    clear: () => { try { arena.debugClear(); } catch { /* ignore */ } },
    coverage: () => { try { return vfxFamilyCoverage(); } catch { return ['error']; } },
    academy: () => { try { return arena.academyStats(); } catch (e) { return { error: String(e && e.message || e) }; } },
    setReduced: (v) => { try { arena.setReduced(!!v); } catch { /* ignore */ } },
  };
}

const storedResume = loadResume();
if (storedResume && storedResume.token) {
  mode = 'online-wait';
  $('#wait-title').textContent = 'Rejoining duel...';
  $('#wait-text').textContent = 'Restoring the authoritative match state.';
  $('#wait-code').classList.add('hidden');
  showPanel('panel-online-wait');
  ensureOnline().catch((err) => onOnlineError(err));
}

// ------------------------------------------------------- native shell + PWA
// All no-ops in a plain browser; only active in the Capacitor Android app.
if (isNativeApp) {
  onBackButton(() => nativeBack());
  onAppStateChange((isActive) => onBackgroundChange(!isActive));
}

// Optional production offline fallback for the SAME-ORIGIN web build only. Never
// in the native shell (assets ship natively) and never on localhost/LAN dev, so
// dev cache iteration is unaffected. Registered from /client/ => scope /client/.
function registerServiceWorker() {
  if (isNativeApp || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const loc = window.location;
  if (loc.protocol !== 'https:') return;
  if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* fallback is best-effort */ });
}
registerServiceWorker();
