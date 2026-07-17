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
import { LESSONS, guideFor } from '../tutorial/tutorial.js';

import { Recognizer } from '@shared/gesture/recognizer.js';
import { buildTemplates } from '@shared/gesture/templates.js';
import {
  starterLoadout, makeLoadout, presetLoadout, validateLoadout,
  PRESETS, PRESETS_BY_KEY, STARTER_SPELL_IDS,
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
let tutorialIndex = 0;
let lastGuideKey = null;

// Best-of-three series.
let series = null; // { score:[0,0], round:0, difficulty, botKey, baseSeed }

// Online duel session (OnlineMatch adapter). `match` points at it while online.
let online = null;
let onlineRoundIndex = 0;

function haptic(kind) {
  if (!settings.haptics || !navigator.vibrate) return;
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
    castSpell(spellId, quality);
    if (mode === 'tutorial') checkLesson(spellId);
  },
  onReject: (diag) => { audio.unlock(); audio.reject(); hud.setDiag(diag); },
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
  hud.showDiag = (newMode === 'practice' || newMode === 'tutorial');
  hud.setDiag(null);
  hud.setSeries(newMode === 'duel' && series ? series.score : null, series ? series.round : 0);
  arena.reset();
  showOverlay(false);
  $('#hud').classList.remove('hidden');
  $('#spellbar').classList.toggle('hidden', newMode === 'tutorial');
  $('#devcast').classList.toggle('hidden', !settings.devcast);
  if (newMode === 'tutorial') { tutorialIndex = 0; showLesson(); }
  else gesture.setGuide(newMode === 'practice' ? guideFor(playerLoadout[0].gestureKey) : null);
  toast(newMode === 'duel' ? 'Duel! Draw or tap a spell.' : newMode === 'practice' ? 'Practice — draw freely.' : '');
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

  if (mode === 'tutorial') {
    $('#result-title').textContent = 'Tutorial complete';
    $('#result-text').textContent = 'You have learned the basics. Try a bot duel!';
    $('#btn-next-round').classList.add('hidden');
    showPanel('panel-result'); showOverlay(true);
    return;
  }

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
      if (match) match.sim.endMatch(0, 'health');
    } else showLesson();
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
  if (!online) { online = new OnlineMatch({ url: '', loadoutIds: playerIds }); wireOnlineCallbacks(online); }
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
    if (a === 'tutorial') { showPanel('panel-tutorial'); $('#tut-title').textContent = 'Tutorial'; $('#tut-text').textContent = 'A short introduction to drawing, casting, and defending. Follow the dotted guides.'; }
    else if (a === 'practice') { series = null; startMatch('practice'); }
    else if (a === 'duel') { updateDuelSummary(); showPanel('panel-duel'); }
    else if (a === 'online') openOnline();
    else if (a === 'online-quick') startOnlineAction('quick');
    else if (a === 'online-create') startOnlineAction('create');
    else if (a === 'online-join') startOnlineAction('join', $('#online-code').value);
    else if (a === 'online-cancel') cancelOnline();
    else if (a === 'online-copy') copyRoomCode();
    else if (a === 'loadout') openLoadoutBuilder();
    else if (a === 'settings') showPanel('panel-settings');
    else if (a === 'start-duel') startSeries($('#duel-diff').value);
    else if (a === 'tut-begin') { series = null; startMatch('tutorial'); }
    else if (a === 'save-loadout') saveLoadout();
    else if (a === 'clear-loadout') { draftIds = []; renderCatalog(); renderLoadoutState(); }
    else if (a === 'next-round') startSeriesRound();
    else if (a === 'back' || a === 'menu') {
      running = false; match = null; series = null;
      if (online) { if (mode === 'online' || mode === 'online-wait') online.leave(); disposeOnline(); }
      mode = null; setNetStatus(null); hud.setSeries(null);
      $('#hud').classList.add('hidden'); showPanel('panel-main'); showOverlay(true);
    }
    else if (a === 'rematch') {
      if (mode === 'online') {
        running = false; match = null; mode = null; setNetStatus(null);
        hud.setSeries(null); $('#hud').classList.add('hidden');
        openOnline(); showOverlay(true);
      } else if (mode === 'duel') startSeries($('#duel-diff').value);
      else startMatch(mode === 'tutorial' ? 'duel' : mode);
    }
  });
});

$('#btn-menu').addEventListener('click', () => { running = false; if (mode === 'online' && online) online.setActive(false); showPanel('panel-main'); showOverlay(true); });

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
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pausedForVisibility = running;
    running = false;
    if (mode === 'online' && online) online.setActive(false); // stop issuing inputs while backgrounded
  } else if (mode === 'online' && online) {
    online.setActive(true);
    if (online.inMatch) { running = true; setNetStatus(online.connected ? 'connected' : 'reconnecting'); }
  } else if (pausedForVisibility && match && !match.sim.ended) {
    pausedForVisibility = false;
    running = true;
  }
});

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
