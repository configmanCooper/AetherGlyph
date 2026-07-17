// main.js — Aetherglyph Phase 1 client entry. Wires the shared sim, renderer,
// HUD, gesture recognition, movement, and audio into a playable offline slice.

import { Arena } from '../render/arena.js';
import { HUD } from '../ui/hud.js';
import { Audio } from '../audio/audio.js';
import { GestureInput } from '../input/gestureInput.js';
import { MovementControl } from '../input/movement.js';
import { LocalMatch } from '../game/localMatch.js';
import { LESSONS, guideFor } from '../tutorial/tutorial.js';

import { Recognizer } from '@shared/gesture/recognizer.js';
import { buildTemplates } from '@shared/gesture/templates.js';
import { starterLoadout } from '@shared/balance/loadouts.js';
import { SPELLS_BY_ID } from '@shared/balance/spellData.generated.js';
import { versionTag } from '@shared/protocol/version.js';

const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------------ singletons
const arena = new Arena($('#scene'));
const hud = new HUD($('#hud'));
const audio = new Audio();
const loadout = starterLoadout();
const recognizer = new Recognizer(buildTemplates()).forLoadout(loadout);

const settings = {
  lefthand: false, reduced: false, audio: true, haptics: true, devcast: false,
};

// Shared input object; movement + buttons mutate it, LocalMatch reads it.
let match = null;
let running = false;
let pausedForVisibility = false;
let mode = null;
let tutorialIndex = 0;
let lastGuideKey = null;

function haptic(kind) {
  if (!settings.haptics || !navigator.vibrate) return;
  const map = { accept: 12, reject: [8, 30, 8], counter: [20, 20, 20], damage: 40, round: [60, 40, 120] };
  navigator.vibrate(map[kind] || 10);
}

// ------------------------------------------------------------------ input wiring
const dummyInput = { move: 0, sidestep: 0, focus: false, brace: false, pendingCast: null, pendingQuality: 1 };

const gesture = new GestureInput($('#draw-canvas'), {
  recognizer,
  reduced: settings.reduced,
  haptics: haptic,
  onCast: (spellId, quality, diag) => {
    audio.unlock(); audio.accept();
    if (match) { match.input.pendingCast = spellId; match.input.pendingQuality = quality; }
    hud.setDiag(diag);
    if (mode === 'tutorial') checkLesson(spellId);
  },
  onReject: (diag) => { audio.unlock(); audio.reject(); hud.setDiag(diag); },
});

const movement = new MovementControl($('#move-pad'), $('#move-stick'), dummyInput, { lefthand: settings.lefthand });

// Action buttons (hold Focus/Brace, tap Dodge).
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

// Keyboard dev fallback (normal play uses drawing).
let kbMove = 0;
window.addEventListener('keydown', (e) => {
  if (!match) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= loadout.length) {
    match.input.pendingCast = loadout[n - 1].id; match.input.pendingQuality = 1; audio.unlock();
  } else if (e.key === 'a') kbMove = -1;
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

// Dev quick-cast buttons.
function buildDevcast() {
  const wrap = $('#devcast');
  wrap.innerHTML = '';
  loadout.forEach((s, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1} ${s.name}`;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); audio.unlock();
      if (match) { match.input.pendingCast = s.id; match.input.pendingQuality = 1; }
    });
    wrap.appendChild(b);
  });
}
buildDevcast();

// ------------------------------------------------------------------ match flow
function applyInputBridge() {
  // Combine the two movement sources: the touch pad (dummyInput.move) and the
  // keyboard dev-fallback (kbMove). Whichever is active wins; both idle = stop.
  if (!match) return;
  const move = kbMove !== 0 ? kbMove : dummyInput.move;
  match.input.move = move;
  if (move !== 0) dummyInput.__lastDir = move;
  if (dummyInput.sidestep !== 0) { match.input.sidestep = dummyInput.sidestep; dummyInput.sidestep = 0; }
}

function startMatch(newMode, opts = {}) {
  mode = newMode;
  match = new LocalMatch({
    mode: newMode,
    difficulty: opts.difficulty || 'apprentice',
    botActive: newMode === 'duel',
    onEnd: (sim) => onRoundEnd(sim),
  });
  running = true;
  hud.showDiag = (newMode === 'practice' || newMode === 'tutorial');
  hud.setDiag(null);
  arena.reset();
  showOverlay(false);
  $('#hud').classList.remove('hidden');
  $('#devcast').classList.toggle('hidden', !settings.devcast);
  if (newMode === 'tutorial') { tutorialIndex = 0; showLesson(); }
  else gesture.setGuide(newMode === 'practice' ? guideFor(loadout[0].gestureKey) : null);
  toast(newMode === 'duel' ? 'Duel! Draw a glyph to cast.' : newMode === 'practice' ? 'Practice — draw freely.' : '');
}

function onRoundEnd(sim) {
  running = false;
  const win = sim.winner === 0;
  audio.roundEnd(win); haptic('round');
  const title = sim.winner === 'draw' ? 'Draw' : win ? 'Victory' : 'Defeat';
  $('#result-title').textContent = mode === 'tutorial' ? 'Tutorial complete' : title;
  $('#result-text').textContent =
    mode === 'tutorial'
      ? 'You have learned the basics. Try a bot duel!'
      : `${sim.endReason === 'timer' ? 'Time!' : 'Knockout!'} You ${win ? 'won' : sim.winner === 'draw' ? 'drew' : 'lost'} — ` +
        `HP ${Math.round(sim.wizards[0].health)} vs ${Math.round(sim.wizards[1].health)}.`;
  showPanel('panel-result');
  showOverlay(true);
}

// ------------------------------------------------------------------ tutorial
function showLesson() {
  const lesson = LESSONS[tutorialIndex];
  gesture.setGuide(guideFor(lesson.key));
  lastGuideKey = lesson.key;
  toast(lesson.text);
}
function checkLesson(spellId) {
  const lesson = LESSONS[tutorialIndex];
  if (!lesson) return;
  if (spellId === lesson.spellId) {
    haptic('accept');
    tutorialIndex += 1;
    if (tutorialIndex >= LESSONS.length) {
      gesture.setGuide(null);
      if (match) match.sim.endMatch(0, 'health'); // triggers onEnd -> completion screen
    } else {
      showLesson();
    }
  } else {
    toast('Not quite — follow the dotted guide.');
  }
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
    if (a === 'tutorial') { showPanel('panel-tutorial'); $('#tut-title').textContent = 'Tutorial'; $('#tut-text').textContent = 'A short introduction to drawing, casting, and defending. Follow the dotted guides.'; }
    else if (a === 'practice') startMatch('practice');
    else if (a === 'duel') showPanel('panel-duel');
    else if (a === 'settings') showPanel('panel-settings');
    else if (a === 'start-duel') startMatch('duel', { difficulty: $('#duel-diff').value });
    else if (a === 'tut-begin') startMatch('tutorial');
    else if (a === 'back' || a === 'menu') { running = false; match = null; $('#hud').classList.add('hidden'); showPanel('panel-main'); showOverlay(true); }
    else if (a === 'rematch') startMatch(mode === 'tutorial' ? 'duel' : mode, { difficulty: $('#duel-diff').value });
  });
});

$('#btn-menu').addEventListener('click', () => { running = false; showPanel('panel-main'); showOverlay(true); });

// ------------------------------------------------------------------ settings
function applySettings() {
  document.body.classList.toggle('lefthand', settings.lefthand);
  document.body.classList.toggle('reduced', settings.reduced);
  movement.setLefthand(settings.lefthand);
  gesture.setReduced(settings.reduced);
  arena.setReduced(settings.reduced);
  audio.setEnabled(settings.audio);
  $('#devcast').classList.toggle('hidden', !settings.devcast || !match);
}
$('#set-lefthand').addEventListener('change', (e) => { settings.lefthand = e.target.checked; applySettings(); });
$('#set-reduced').addEventListener('change', (e) => { settings.reduced = e.target.checked; applySettings(); });
$('#set-audio').addEventListener('change', (e) => { settings.audio = e.target.checked; applySettings(); });
$('#set-haptics').addEventListener('change', (e) => { settings.haptics = e.target.checked; });
$('#set-devcast').addEventListener('change', (e) => { settings.devcast = e.target.checked; applySettings(); });

// ------------------------------------------------------------------ misc
let toastTimer = null;
function toast(msg) {
  if (!msg) return;
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// Unlock audio on first interaction anywhere.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
// Pause the sim loop when backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pausedForVisibility = running;
    running = false;
  } else if (pausedForVisibility && match && !match.sim.ended) {
    pausedForVisibility = false;
    running = true;
  }
});

console.log('Aetherglyph client', versionTag());
showOverlay(true);
showPanel('panel-main');
