// onlineMatch.js — client-side authoritative match session + network adapter.
//
// Presents server snapshots to the SAME renderer/HUD as the offline sim (the
// snapshot is already personalized so this device is always wizard 0), sends
// movement/focus/brace at a bounded cadence and cast traces from the gesture
// pad, and drives the create/join/quick-match/reconnect flow. It never runs a
// local authoritative sim — health, resources, spell ids, and results come only
// from the server. When disconnected it stops issuing inputs and shows status
// rather than silently simulating locally.

import { EVENTS } from '../../../shared/src/protocol/events.js';
import { NET } from '../../../shared/src/protocol/net.js';
import { openSocket, clientIdentity, saveResume, loadResume, clearResume, qualityFromRtt } from './net.js';

const INPUT_INTERVAL_MS = 1000 / NET.INPUT_HZ;
const PING_INTERVAL_MS = 2000;

function neutralWizard(id) {
  return {
    id, health: 100, aether: 60, stamina: 100, charges: 0, arcPos: id === 0 ? -0.35 : 0.35,
    casting: null, channel: null, focusing: false, focusTicks: 0, braceTicks: 0,
    shield: null, barrier: null, reflectTicks: 0, tenacityTicks: 0, evadeTicks: 0, invisibleTicks: 0,
    mirrorTicks: 0, sidestepCharges: 2, recoveryTicks: 0,
    statuses: {}, cooldowns: {}, resonance: [], damageDealt: 0, castsResolved: 0,
  };
}

function neutralView() {
  return {
    tick: 0, timeS: 0, ended: false, winner: null, endReason: null, pressureLevel: 0,
    projectiles: [], zones: [], wizards: [neutralWizard(0), neutralWizard(1)],
  };
}

export class OnlineMatch {
  constructor(opts = {}) {
    this.url = opts.url || '';
    this.identity = opts.identity || clientIdentity();
    this.socketFactory = opts.socketFactory || openSocket;
    this.resumeLoader = opts.resumeLoader || loadResume;
    this.loadoutIds = (opts.loadoutIds || []).slice();

    // Frame-loop compatibility surface (mirrors LocalMatch).
    this.input = { move: 0, sidestep: 0, focus: false, brace: false, pendingCast: null, pendingQuality: 1 };
    this.view = neutralView();
    this.alpha = 1;

    // Callbacks (assignable by the app layer).
    this.onMatchStart = opts.onMatchStart || (() => {});
    this.onRoundEnd = opts.onRoundEnd || (() => {});
    this.onMatchEnd = opts.onMatchEnd || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.onRoom = opts.onRoom || (() => {});
    this.onConnection = opts.onConnection || (() => {});
    this.onError = opts.onError || (() => {});
    this.onCastAck = opts.onCastAck || (() => {});

    this.socket = null;
    this.connected = false;
    this.active = true;         // input gating (paused when backgrounded)
    this.inMatch = false;
    this.matchId = null;
    this.slot = 0;
    this.epoch = 0;
    this.resumeToken = null;
    this.inputSeq = 0;
    this.castSeq = 0;
    this.inputAcc = 0;
    this.rtt = null;
    this.pingTimer = null;
    this.pendingEvents = [];
  }

  // --- frame-loop surface -------------------------------------------------
  get sim() { return this.view; }

  update(dtMs) {
    if (!this.inMatch || !this.active) { this.input.sidestep = 0; return; }
    this.inputAcc += dtMs;
    if (this.inputAcc >= INPUT_INTERVAL_MS) { this.inputAcc = 0; this.sendInput(); }
  }

  drainEvents() {
    if (!this.pendingEvents.length) return [];
    const e = this.pendingEvents;
    this.pendingEvents = [];
    return e;
  }

  // --- connection ---------------------------------------------------------
  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = this.socketFactory(this.url, this.identity);
      this.socket = socket;

      socket.on('connect', () => {
        this.connected = true;
        this.emitConnection('connected');
        this.startPing();
        // A reconnect while a match is live -> resume with the rotating token.
        if (this.inMatch || this.resumeToken || this.resumeLoader()) this.tryResume();
        if (!settled) { settled = true; resolve(); }
      });
      socket.on('connect_error', (err) => {
        this.emitConnection('error');
        if (!settled) { settled = true; reject(err); }
        else this.onError(err);
      });
      socket.on('disconnect', () => {
        this.connected = false;
        this.stopPing();
        this.emitConnection('disconnected');
        if (this.inMatch) this.onStatus({ state: 'reconnecting' });
      });

      socket.on(EVENTS.ROOM_UPDATE, (p) => this.onRoom(p || {}));
      socket.on(EVENTS.MATCH_START, (p) => this.handleMatchStart(p || {}));
      socket.on(EVENTS.SNAPSHOT, (p) => this.handleSnapshot(p || {}));
      socket.on(EVENTS.ROUND_END, (p) => this.onRoundEnd(p || {}));
      socket.on(EVENTS.MATCH_END, (p) => this.handleMatchEnd(p || {}));
      socket.on(EVENTS.OPPONENT_STATUS, (p) => this.onStatus(p || {}));
      socket.on(EVENTS.RESUME_TOKEN, (p) => { if (p && p.token) { this.resumeToken = p.token; saveResume(this.matchId, p.token); } });
      socket.on(EVENTS.ABORTED, (p) => this.handleAborted(p || {}));
      socket.on(EVENTS.PONG, (p) => { if (p && Number.isFinite(p.t)) { this.rtt = Math.max(0, Date.now() - p.t); this.emitConnection(this.connected ? 'connected' : 'disconnected'); } });
    });
  }

  emitConnection(state) {
    this.onConnection({ state, rttMs: this.rtt, quality: qualityFromRtt(this.rtt) });
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.connected) this.socket.emit(EVENTS.PING, { t: Date.now() });
    }, PING_INTERVAL_MS);
  }
  stopPing() { if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; } }

  // --- lobby actions (each returns the server ack) ------------------------
  createRoom() { return this.request(EVENTS.CREATE_ROOM, { loadout: this.loadoutIds, name: this.identity.name }); }
  joinRoom(code) { return this.request(EVENTS.JOIN_ROOM, { code, loadout: this.loadoutIds, name: this.identity.name }); }
  quickMatch() { return this.request(EVENTS.QUICK_MATCH, { loadout: this.loadoutIds, name: this.identity.name }); }
  cancelQueue() { return this.request(EVENTS.CANCEL_QUEUE, {}); }
  leave() { clearResume(); this.inMatch = false; return this.request(EVENTS.LEAVE, {}); }

  request(ev, payload) {
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) { resolve({ ok: false, code: 'offline' }); return; }
      const t = setTimeout(() => resolve({ ok: false, code: 'timeout' }), 6000);
      this.socket.emit(ev, payload, (ack) => { clearTimeout(t); resolve(ack || { ok: false, code: 'no-ack' }); });
    });
  }

  // --- inputs / casting ---------------------------------------------------
  sendInput() {
    if (!this.socket || !this.socket.connected || !this.inMatch) return;
    const i = this.input;
    this.socket.emit(EVENTS.INPUT, {
      seq: ++this.inputSeq,
      move: i.move === -1 || i.move === 1 ? i.move : 0,
      focus: !!i.focus,
      brace: !!i.brace,
      sidestep: i.sidestep === -1 || i.sidestep === 1 ? i.sidestep : 0,
    });
    i.sidestep = 0; // one-shot consumed
  }

  // Submit a bounded gesture trace (from GestureInput). The server reclassifies
  // and is authoritative; the ack is only for local feedback.
  sendCastTrace(trace) {
    if (!this.socket || !this.socket.connected || !this.inMatch || !this.active) return;
    this.socket.emit(EVENTS.CAST, {
      seq: ++this.castSeq,
      points: trace.points,
      durationMs: trace.durationMs,
    }, (ack) => this.onCastAck(ack || { ok: false }));
  }

  // --- inbound ------------------------------------------------------------
  handleMatchStart(p) {
    this.inMatch = true;
    this.matchId = p.matchId;
    this.slot = p.slot;
    this.epoch = p.epoch || 1;
    this.resumeToken = p.token || null;
    if (p.token) saveResume(this.matchId, p.token);
    this.inputSeq = 0;
    this.castSeq = 0;
    this.view = neutralView();
    this.pendingEvents = [];
    this.onMatchStart(p);
  }

  handleSnapshot(p) {
    if (this.matchId && p.matchId && p.matchId !== this.matchId) return;
    if (Number.isFinite(p.epoch) && p.epoch < this.epoch) return; // stale session
    if (Number.isFinite(p.epoch)) this.epoch = p.epoch;
    if (p.state) this.view = p.state;
    if (Array.isArray(p.events) && p.events.length) {
      for (const e of p.events) this.pendingEvents.push(e);
    }
  }

  handleMatchEnd(p) {
    this.inMatch = false;
    clearResume();
    this.stopPing();
    this.onMatchEnd(p);
  }

  handleAborted(p) {
    this.onError({ message: p.reason || 'Server restarting', code: 'aborted' });
    if (this.inMatch) { this.inMatch = false; this.onStatus({ state: 'aborted', reason: p.reason }); }
  }

  tryResume() {
    const restoringAfterReload = !this.inMatch;
    const stored = this.resumeLoader();
    const token = this.resumeToken || (stored && stored.token);
    if (!token) return;
    this.onStatus({ state: 'resuming' });
    this.socket.emit(EVENTS.RESUME, { token }, (ack) => {
      if (ack && ack.ok) {
        this.inMatch = true;
        this.matchId = ack.matchId || this.matchId;
        this.slot = ack.slot != null ? ack.slot : this.slot;
        this.epoch = ack.epoch || this.epoch;
        this.resumeToken = ack.token || this.resumeToken;
        if (ack.token) saveResume(this.matchId, ack.token);
        if (restoringAfterReload) {
          this.onMatchStart({
            matchId: this.matchId,
            slot: this.slot,
            epoch: this.epoch,
            token: this.resumeToken,
            resumed: true,
          });
        }
        this.onStatus({ state: 'resumed' });
      } else {
        this.inMatch = false;
        clearResume();
        this.onStatus({ state: 'resume-failed', code: ack && ack.code });
        if (!restoringAfterReload) this.onMatchEnd({ winner: 'loss', reason: 'connection-lost' });
      }
    });
  }

  // --- lifecycle ----------------------------------------------------------
  setActive(active) {
    this.active = !!active;
    if (!active) { this.input.move = 0; this.input.focus = false; this.input.brace = false; this.input.sidestep = 0; }
  }

  setLoadout(ids) { this.loadoutIds = (ids || []).slice(); }

  dispose() {
    this.stopPing();
    try { if (this.socket) { this.socket.removeAllListeners(); this.socket.disconnect(); } } catch { /* ignore */ }
    this.socket = null;
    this.inMatch = false;
    this.connected = false;
  }
}
