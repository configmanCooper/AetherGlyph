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
import { TutorialRunner, STATES, GUIDE_STAGE_NAMES } from '../tutorial/runner.js';
import { CAMPAIGN, CAMPAIGN_BY_ID, REQUIRED_LESSON_IDS, chapters } from '../tutorial/campaign.js';
import {
  loadProfile, saveProfile, deleteProfile, completionPercent,
} from '../tutorial/progress.js';
import { SECRETS } from '../tutorial/secrets.js';

import { Recognizer } from '@shared/gesture/recognizer.js';
import { buildTemplates, GESTURE_TEMPLATES } from '@shared/gesture/templates.js';
import {
  starterLoadout, makeLoadout, presetLoadout, validateLoadout,
  PRESETS, PRESETS_BY_KEY, STARTER_SPELL_IDS, GESTURE_KEYS,
} from '@shared/balance/loadouts.js';
import { SPELL_CATALOG, SPELLS_BY_ID } from '@shared/balance/spellData.generated.js';
import { versionTag } from '@shared/protocol/version.js';

const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------------ singletons
const arena = new Arena($('#scene'));
const hud = new HUD($('#hud'));
const audio = new Audio();

const settings = { lefthand: false, reduced: false, audio: true, haptics: true, devcast: false };

// Loadout + series state.
let playerIds = STARTER_SPELL_IDS.slice();       // the equipped 8 spells (ids)
let playerLoadout = makeLoadout(playerIds);
let botKey = 'tide-control';
let recognizer = null;

let match = null;
let running = false;
let pausedForVisibility = false;
let mode = null;
let tutorial = null;        // active TutorialRunner (mode === 'tutorial')
let tutorialLesson = null;  // its lesson definition

// A guide template path (0..100 space) for a spell id, for the tutorial/lab pad.
function guideTemplateFor(spellId) {
  const key = GESTURE_KEYS[spellId];
  const variants = key ? GESTURE_TEMPLATES[key] : null;
  return variants ? variants[0] : null;
}

// Best-of-three series.
let series = null; // { score:[0,0], round:0, difficulty, botKey, baseSeed }

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
  hud.buildSpellbar(playerLoadout, (id) => castSpell(id, 1));
  buildDevcast();
  updateDuelSummary();
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
  else if (e.key === ' ') { match.input.sidestep = dummyInput.__lastDir || 1; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  if (!match) return;
  if (e.key === 'a' && kbMove === -1) kbMove = 0;
  else if (e.key === 'd' && kbMove === 1) kbMove = 0;
  else if (e.key === 'f') match.input.focus = false;
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

// Start a single practice/tutorial round (starter loadout smoke path).
function startMatch(newMode, opts = {}) {
  mode = newMode;
  match = new LocalMatch({
    mode: newMode,
    difficulty: opts.difficulty || 'apprentice',
    botActive: newMode === 'duel',
    playerLoadout,
    botLoadout: newMode === 'duel' ? presetLoadout(botKey) : starterLoadout(),
    seed: opts.seed,
    onEnd: (sim) => onRoundEnd(sim),
  });
  running = true;
  hud.showDiag = (newMode === 'practice');
  hud.setDiag(null);
  hud.setSeries(newMode === 'duel' && series ? series.score : null, series ? series.round : 0);
  arena.reset();
  showOverlay(false);
  $('#hud').classList.remove('hidden');
  $('#coach').classList.add('hidden');
  document.body.classList.remove('mode-tutorial');
  $('#spellbar').classList.remove('hidden');
  $('#devcast').classList.toggle('hidden', !settings.devcast);
  gesture.recognizer = recognizer; // restore the full player-loadout recognizer (tutorials scope it)
  gesture.setGuide(newMode === 'practice' ? guideTemplateFor(playerLoadout[0].id) : null, { stage: 0 });
  toast(newMode === 'duel' ? 'Duel! Draw or tap a spell.' : 'Glyph Laboratory — draw freely.');
}

// Start a best-of-three series against the bot.
function startSeries(difficulty) {
  series = { score: [0, 0], round: 0, difficulty, botKey, baseSeed: (Date.now() & 0x7fffffff) >>> 0 };
  startSeriesRound();
}
function startSeriesRound() {
  const seed = (series.baseSeed + series.round * 0x9e3779b9) >>> 0;
  startMatch('duel', { difficulty: series.difficulty, seed });
}

function onRoundEnd(sim) {
  running = false;
  const win = sim.winner === 0;
  audio.roundEnd(win); haptic('round');

  if (mode === 'duel' && series) {
    if (sim.winner === 0) series.score[0] += 1;
    else if (sim.winner === 1) series.score[1] += 1;
    series.round += 1;
    hud.setSeries(series.score, series.round - 1);

    const seriesWin = series.score[0] >= 2;
    const seriesLoss = series.score[1] >= 2;
    const done = seriesWin || seriesLoss || series.round >= 3;
    const roundTitle = sim.winner === 'draw' ? 'Round drawn' : win ? 'Round won' : 'Round lost';

    if (done) {
      const finalWin = series.score[0] > series.score[1];
      const finalDraw = series.score[0] === series.score[1];
      $('#result-title').textContent = finalDraw ? 'Series drawn' : finalWin ? 'Series won!' : 'Series lost';
      $('#result-text').textContent = `Final score ${series.score[0]}–${series.score[1]}.`;
      $('#btn-next-round').classList.add('hidden');
      series = null;
    } else {
      $('#result-title').textContent = roundTitle;
      $('#result-text').textContent =
        `Series ${series.score[0]}–${series.score[1]}. ` +
        `HP ${Math.round(sim.wizards[0].health)} vs ${Math.round(sim.wizards[1].health)}.`;
      $('#btn-next-round').classList.remove('hidden');
    }
    showPanel('panel-result'); showOverlay(true);
    return;
  }

  // Practice single round.
  const title = sim.winner === 'draw' ? 'Draw' : win ? 'Victory' : 'Defeat';
  $('#result-title').textContent = title;
  $('#result-text').textContent =
    `${sim.endReason === 'timer' ? 'Time!' : 'Knockout!'} You ${win ? 'won' : sim.winner === 'draw' ? 'drew' : 'lost'} — ` +
    `HP ${Math.round(sim.wizards[0].health)} vs ${Math.round(sim.wizards[1].health)}.`;
  $('#btn-next-round').classList.add('hidden');
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
      `<span class="v">${p.rankedReady ? 'Ready ✓' : 'Locked (win Lesson 12)'}</span></div>`;
  }

  const list = $('#tut-chapters');
  if (list) {
    list.innerHTML = '';
    for (const ch of chapters()) {
      const sec = document.createElement('section');
      sec.className = 'tut-chapter';
      sec.innerHTML = `<h3>${ch.title}</h3>`;
      const row = document.createElement('div');
      row.className = 'tut-lessons';
      for (const l of ch.lessons) {
        const done = p.completedLessons.includes(l.id);
        const isNext = l.id === p.currentLessonId;
        const btn = document.createElement('button');
        btn.className = 'tut-lesson' + (done ? ' done' : '') + (isNext ? ' next' : '');
        const badge = done ? '✓' : (l.optional ? '☆' : '');
        btn.innerHTML = `<span class="tl-title">${l.title}</span><span class="tl-badge">${badge}</span>`;
        btn.setAttribute('aria-label', `${l.title}${done ? ' (completed)' : ''}${l.optional ? ' (optional)' : ''}`);
        btn.addEventListener('click', () => startTutorialLesson(l.id));
        row.appendChild(btn);
      }
      sec.appendChild(row);
      list.appendChild(sec);
    }
  }
}

function chapterLabel(chapter) {
  return { prologue: 'Prologue', core: 'Core Lessons', academy: 'Academy', exam: 'Final Exam', secret: 'Secret Trials' }[chapter] || chapter;
}

// Build the scoped production recognizer + runner for a lesson and show its intro.
function startTutorialLesson(lessonId) {
  const lesson = CAMPAIGN_BY_ID[lessonId];
  if (!lesson) return;
  tutorialLesson = lesson;
  mode = 'tutorial';
  series = null;
  const profile = soloProfile();
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
  });

  showLessonIntro(lesson);
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

// Begin the active lesson: (optional) calibration, arm the sim, show HUD + coach.
function beginTutorialLesson() {
  if (!tutorial) return;
  tutorial.begin();
  if (tutorial.state === STATES.CALIBRATE) {
    // Lightweight first-run calibration: capture handedness + a comfort default.
    tutorial.calibrate({ hand: settings.lefthand ? 'left' : 'right' });
  }
  match = tutorial;
  running = true;
  hud.showDiag = false;
  hud.setDiag(null);
  hud.setSeries(null);
  arena.reset();
  buildCoachPanel(tutorialLesson);
  onTutorialGuide({ spellId: tutorial.focusSpell ? tutorial.focusSpell.id : null, stage: tutorial.guideStage });
  showOverlay(false);
  $('#hud').classList.remove('hidden');
  $('#spellbar').classList.add('hidden'); // tutorial casts by drawing only
  $('#devcast').classList.add('hidden');
  $('#coach').classList.remove('hidden');
  document.body.classList.add('mode-tutorial');
  updateCoachState();
  toast(tutorialLesson.formal ? 'Formal duel — win the round.' : 'Draw to cast.');
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
  if (gi) gi.textContent = `Guide: ${GUIDE_STAGE_NAMES[tutorial.guideStage] || 'None'}`;
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
  if (s === STATES.ATTEMPT_FAILED && tutorial && tutorial.failReason === 'round-lost') {
    running = false;
    $('#result-title').textContent = `${tutorialLesson.title} — round lost`;
    $('#result-text').textContent = 'The round ended before you met the objectives. Replay the lesson to try again.';
    $('#btn-next-round').classList.add('hidden');
    const rb = document.querySelector('#panel-result [data-action="rematch"]');
    if (rb) rb.textContent = 'Replay lesson';
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
  if (!g || g.spellId == null || g.stage >= 3) { gesture.setGuide(null); }
  else gesture.setGuide(guideTemplateFor(g.spellId), { stage: g.stage, showGhost: g.stage === 0 });
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
    } else if (e.type === 'damage') {
      audio.damage(); if (e.target === 0) haptic('damage');
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
function frame(now) {
  const dt = Math.min(64, now - lastT); lastT = now;
  if (match && running) {
    applyInputBridge();
    match.update(dt);
    const evs = match.drainEvents();
    if (evs.length) handleEvents(evs);
    hud.update(match.sim);
    arena.update(match.sim, match.alpha, dt);
  } else if (match) {
    arena.update(match.sim, match.alpha, dt);
  } else {
    arena.renderIdle(dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ loadout builder
let draftIds = [];

function updateDuelSummary() {
  const el = $('#duel-loadout-summary');
  if (!el) return;
  const names = playerLoadout.map((s) => s.name).join(', ');
  const pts = playerLoadout.reduce((a, s) => a + s.loadout_points, 0);
  el.textContent = `Your loadout (${pts} pts): ${names}`;
}

function buildOpponentSelect() {
  const sel = $('#duel-opp');
  if (!sel) return;
  sel.innerHTML = '';
  for (const p of PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.key; opt.textContent = p.name;
    if (p.key === botKey) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', (e) => { botKey = e.target.value; });
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
  showPanel('panel-duel');
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
    else if (a === 'lab') { series = null; startMatch('practice'); }
    else if (a === 'practice-ai') toast('Practice vs AI (Easy/Medium/Hard) arrives in the next phase.');
    else if (a === 'duel') { updateDuelSummary(); showPanel('panel-duel'); }
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
    else if (a === 'start-duel') startSeries($('#duel-diff').value);
    else if (a === 'tut-continue') startTutorialLesson(soloProfile().currentLessonId);
    else if (a === 'tut-begin') beginTutorialLesson();
    else if (a === 'tut-showme') tutorialShowMe();
    else if (a === 'tut-tryagain') tutorialTryAgain();
    else if (a === 'save-loadout') saveLoadout();
    else if (a === 'clear-loadout') { draftIds = []; renderCatalog(); renderLoadoutState(); }
    else if (a === 'next-round') { if (mode === 'tutorial') continueTutorial(); else startSeriesRound(); }
    else if (a === 'back' || a === 'menu') returnToMainMenu();
    else if (a === 'rematch') {
      if (mode === 'tutorial') { if (tutorialLesson) startTutorialLesson(tutorialLesson.id); }
      else if (mode === 'online') {
        running = false; match = null; mode = null; setNetStatus(null);
        hud.setSeries(null); $('#hud').classList.add('hidden');
        openOnline(); showOverlay(true);
      } else if (mode === 'duel') startSeries($('#duel-diff').value);
      else startMatch(mode);
    }
  });
});

function continueTutorial() {
  const nextId = window.__tutNext;
  if (nextId) startTutorialLesson(nextId);
  else openTutorialHub();
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
  if (!window.confirm('Delete all local data? This erases your device identity, name, settings, saved duel, and your solo progress — tutorial completion, calibration, medals, secret-clue and secret-spell discoveries, and local coaching statistics. This cannot be undone.')) return;
  if (online) { try { online.leave(); } catch { /* ignore */ } disposeOnline(); }
  try {
    ['aeth-client-id', 'aeth-name', 'aeth-resume', 'aeth-server-url'].forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
  try { deleteProfile(localStorage); } catch { /* ignore */ } // solo progress / calibration / medals / clues / secrets / coaching stats
  tutorial = null; tutorialLesson = null;
  const su = $('#set-server-url'); if (su) su.value = '';
  const on = $('#online-name'); if (on) on.value = '';
  setServerStatus('Local data deleted, including solo progress, calibration, medals, clues, secret discoveries, and coaching stats.', 'ok');
  toast('Your local data was deleted.');
}

// Full teardown back to the main menu (shared by the Back/Menu buttons and the
// Android hardware back button).
function returnToMainMenu() {
  running = false; match = null; series = null; tutorial = null; tutorialLesson = null;
  if (online) { if (mode === 'online' || mode === 'online-wait') online.leave(); disposeOnline(); }
  mode = null; setNetStatus(null); hud.setSeries(null);
  gesture.setGuide(null);
  document.body.classList.remove('mode-tutorial');
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
buildOpponentSelect();
rebuildForLoadout();
console.log('Aetherglyph client', versionTag());
showOverlay(true);
showPanel('panel-main');

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
