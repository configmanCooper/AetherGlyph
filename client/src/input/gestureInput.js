// gestureInput.js — hold-to-draw glyph pad with live trace + recognition.
//
// Captures pointer samples inside the draw pad only, renders the live trace,
// and on release classifies against the equipped loadout via the shared
// Recognizer. Touch + mouse via Pointer Events. A two-finger tap breaks the
// trace with no cost (MASTERPLAN §4).
//
// For online play the pad also hands the onCast callback a BOUNDED, quantized
// copy of the trace plus its duration (never the live mutable `points` array),
// so the network adapter can submit the authoritative cast packet. The same
// bounded trace is classified locally so client prediction matches the server.

import { boundTrace } from '@shared/protocol/net.js';

export class GestureInput {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.recognizer = opts.recognizer;
    this.onCast = opts.onCast || (() => {});
    this.onReject = opts.onReject || (() => {});
    this.onProgress = opts.onProgress || (() => {});
    this.haptics = opts.haptics || (() => {});
    this.reduced = opts.reduced || false;

    this.points = [];
    this.drawing = false;
    this.activePointer = null;
    this.pointerCount = 0;
    this.rect = null;
    this.startTime = 0;
    this.guide = null; // optional template guide (array of {x,y} in 0..100 space)

    this._bind();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setRecognizer(r) { this.recognizer = r; }
  setReduced(v) { this.reduced = v; }
  setGuide(points) { this.guide = points || null; this._redraw(); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.rect = r;
    this._redraw();
  }

  _bind() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => this._cancel(e));
    c.addEventListener('pointerleave', (e) => { if (this.drawing) this._up(e); });
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _down(e) {
    e.preventDefault();
    this.pointerCount += 1;
    if (this.pointerCount >= 2) { // two-finger tap => break trace
      this._breakTrace();
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointer = e.pointerId;
    this.drawing = true;
    this.startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.points = [this._pos(e)];
    this._redraw();
  }

  _move(e) {
    if (!this.drawing || e.pointerId !== this.activePointer) return;
    e.preventDefault();
    const p = this._pos(e);
    const last = this.points[this.points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1.5) {
      this.points.push(p);
      this.onProgress(this.points.length);
      this._redraw();
    }
  }

  _up(e) {
    if (e && e.pointerId !== undefined) this.pointerCount = Math.max(0, this.pointerCount - 1);
    if (!this.drawing) return;
    this.drawing = false;
    this.activePointer = null;
    this._classify();
    // Fade the trace shortly after.
    setTimeout(() => { this.points = []; this._redraw(); }, this.reduced ? 0 : 140);
  }

  _cancel(e) {
    this.pointerCount = Math.max(0, this.pointerCount - 1);
    this.drawing = false; this.activePointer = null;
    this.points = []; this._redraw();
  }

  _breakTrace() {
    this.drawing = false; this.activePointer = null;
    this.points = []; this._redraw();
    this.onReject({ reason: 'break-trace' });
  }

  _classify() {
    if (!this.recognizer) return;
    // A bounded, quantized copy of the trace (new objects — never the live
    // mutable `points` array). Classify the SAME bounded trace the network
    // adapter will submit, so local prediction agrees with server authority.
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const durationMs = Math.max(0, Math.round(now - this.startTime));
    const points = boundTrace(this.points);
    const trace = { points, durationMs, pointCount: points.length };
    const diag = this.recognizer.recognize(points);
    if (diag.accepted) {
      const q = 0.9 + Math.min(1, Math.max(0, (diag.best.score - 0.6) / 0.4)) * 0.15; // 0.90..1.05
      this.haptics('accept');
      this.onCast(diag.spellId, Math.min(1.05, q), diag, trace);
    } else {
      this.haptics('reject');
      this.onReject(diag, trace);
    }
  }

  _redraw() {
    const ctx = this.ctx;
    const r = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);

    // Faint template guide (practice / tutorial): map 0..100 space into a
    // centered box within the pad.
    if (this.guide && this.guide.length > 1) {
      const pad = 0.16;
      const sx = (v) => (pad + (v / 100) * (1 - 2 * pad)) * r.width;
      const sy = (v) => (pad + (v / 100) * (1 - 2 * pad)) * r.height;
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(139,107,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(sx(this.guide[0].x), sy(this.guide[0].y));
      for (let i = 1; i < this.guide.length; i++) ctx.lineTo(sx(this.guide[i].x), sy(this.guide[i].y));
      ctx.stroke();
      // start dot
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(79,214,201,0.9)';
      ctx.beginPath(); ctx.arc(sx(this.guide[0].x), sy(this.guide[0].y), 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    if (this.points.length < 2) return;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(79,214,201,0.9)';
    ctx.shadowColor = 'rgba(79,214,201,0.8)';
    ctx.shadowBlur = this.reduced ? 0 : 12;
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
