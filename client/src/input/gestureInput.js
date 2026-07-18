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
import { qualityFromScore } from '@shared/gesture/quality.js';

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

    // Progressive guide system (SOLO-MODES-PLAN §5). `guide` is the canonical
    // template path in 0..100 pad space; `guideStage` selects how much help to
    // show: 0 Full (solid path + start dot + arrow + one ghost), 1 Dotted, 2
    // Start (start dot + short direction mark), 3 None (blank pad). Online play
    // uses no guide (stage None), so the default keeps online behaviour intact.
    this.guide = null;
    this.guideStage = 3;
    this.guideScale = 1;       // set from calibration; scales guide size only
    this.onDiag = opts.onDiag || (() => {});
    this.lastDiag = null;      // fresh trace diagnostics (last recognition result)
    this._ghost = null;        // { start, durationMs } while a ghost demo animates
    this._ghostRaf = null;

    this._bind();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setRecognizer(r) { this.recognizer = r; }
  setReduced(v) { this.reduced = v; if (v) this._stopGhost(); this._redraw(); }

  // Calibration-derived guide size (0.4..1.5). Sizes the on-pad guides only; it
  // never affects recognition (thresholds are unchanged).
  setGuideScale(s) {
    const n = Number(s);
    this.guideScale = Number.isFinite(n) ? Math.max(0.4, Math.min(1.5, n)) : 1;
    this._redraw();
  }

  // Set (or clear) the guide template. opts.stage 0..3 (default: Full when a path
  // is given, None when cleared). A Full guide plays one ghost demonstration
  // unless reduced motion is on. Passing null clears the guide (online default).
  setGuide(points, opts = {}) {
    this.guide = points && points.length > 1 ? points.map((p) => ({ x: p.x, y: p.y })) : null;
    this.guideStage = opts.stage != null ? opts.stage : (this.guide ? 0 : 3);
    this._stopGhost();
    if (this.guide && this.guideStage === 0 && opts.showGhost !== false && !this.reduced) this.playGhost();
    else this._redraw();
  }

  // Change only the guide stage (used as the guide fades across a lesson).
  setGuideStage(stage) {
    this.guideStage = Math.max(0, Math.min(3, stage | 0));
    this._stopGhost();
    if (this.guide && this.guideStage === 0 && !this.reduced) this.playGhost();
    else this._redraw();
  }

  // One optional ghost demonstration: a marker traces the canonical path once.
  // Reduced motion shows a static solid path instead (no animation).
  playGhost(durationMs = 1200) {
    if (!this.guide || this.reduced || typeof requestAnimationFrame === 'undefined') { this._redraw(); return; }
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this._ghost = { start: now, durationMs };
    const step = () => {
      if (!this._ghost) return;
      const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const done = (t - this._ghost.start) >= this._ghost.durationMs;
      this._redraw();
      if (done) { this._ghost = null; this._ghostRaf = null; this._redraw(); }
      else this._ghostRaf = requestAnimationFrame(step);
    };
    this._ghostRaf = requestAnimationFrame(step);
  }

  _stopGhost() {
    this._ghost = null;
    if (this._ghostRaf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this._ghostRaf);
    this._ghostRaf = null;
  }

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
    this.lastDiag = diag;
    this.onDiag(diag, trace);
    if (diag.accepted) {
      const q = qualityFromScore(diag.best.score); // shared potency mapping (0.90..1.05)
      this.haptics('accept');
      this.onCast(diag.spellId, q, diag, trace);
    } else {
      this.haptics('reject');
      this.onReject(diag, trace);
    }
  }

  _redraw() {
    const ctx = this.ctx;
    const r = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    this._drawGuide(ctx, r);

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

  // Map 0..100 pad space into a centred box within the pad. The canonical guide
  // geometry is NEVER mirrored (left-handed mode moves the pad, not the glyph
  // direction — SOLO-MODES-PLAN §5).
  _guideXY(r) {
    const pad = 0.16;
    const span = (1 - 2 * pad) * (this.guideScale || 1);
    return {
      sx: (v) => (0.5 + (v / 100 - 0.5) * span) * r.width,
      sy: (v) => (0.5 + (v / 100 - 0.5) * span) * r.height,
    };
  }

  _drawGuide(ctx, r) {
    const g = this.guide;
    if (!g || g.length < 2 || this.guideStage >= 3) {
      this.canvas.dataset.guideArrows = '0';
      return; // None => blank pad
    }
    const { sx, sy } = this._guideXY(r);
    const stage = this.guideStage;
    ctx.save();

    // Path: solid for Full, dotted for Dotted. Start-only draws no path.
    if (stage === 0 || stage === 1) {
      ctx.setLineDash(stage === 1 ? [6, 6] : []);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.strokeStyle = stage === 0 ? 'rgba(139,107,255,0.75)' : 'rgba(139,107,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(sx(g[0].x), sy(g[0].y));
      for (let i = 1; i < g.length; i++) ctx.lineTo(sx(g[i].x), sy(g[i].y));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Direction cues: Full/Start use a prominent first arrow. Dotted templates
    // add occasional arrowheads along the path so loops and figure-eights clearly
    // communicate which way to travel.
    if (stage === 0 || stage === 2) {
      this._drawStartArrow(ctx, sx, sy, g);
      this.canvas.dataset.guideArrows = '1';
    } else if (stage === 1) {
      this.canvas.dataset.guideArrows = String(this._drawPathArrows(ctx, sx, sy, g));
    }

    // Start dot (all visible stages).
    ctx.fillStyle = 'rgba(79,214,201,0.95)';
    ctx.beginPath();
    ctx.arc(sx(g[0].x), sy(g[0].y), 6, 0, Math.PI * 2);
    ctx.fill();

    // One ghost demonstration (Full stage only): a marker traces the path once.
    if (stage === 0 && this._ghost) this._drawGhostMarker(ctx, sx, sy, g);
    ctx.restore();
  }

  _drawStartArrow(ctx, sx, sy, g) {
    const x0 = sx(g[0].x), y0 = sy(g[0].y);
    const x1 = sx(g[1].x), y1 = sy(g[1].y);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const len = 18;
    const tipX = x0 + Math.cos(ang) * len, tipY = y0 + Math.sin(ang) * len;
    ctx.strokeStyle = 'rgba(79,214,201,0.95)';
    ctx.fillStyle = 'rgba(79,214,201,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(tipX, tipY); ctx.stroke();
    const a = 0.5;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(ang - a) * 8, tipY - Math.sin(ang - a) * 8);
    ctx.lineTo(tipX - Math.cos(ang + a) * 8, tipY - Math.sin(ang + a) * 8);
    ctx.closePath(); ctx.fill();
  }

  _drawPathArrows(ctx, sx, sy, g) {
    const points = g.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
    const lengths = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      lengths.push(len);
      total += len;
    }
    if (total <= 0) return 0;
    const fractions = total >= 180 ? [0.08, 0.4, 0.72] : total >= 100 ? [0.12, 0.6] : [0.18];
    ctx.fillStyle = 'rgba(79,214,201,0.95)';
    let count = 0;
    for (const fraction of fractions) {
      const target = total * fraction;
      let walked = 0;
      for (let i = 0; i < lengths.length; i++) {
        const len = lengths[i];
        if (walked + len < target || len <= 0) { walked += len; continue; }
        const t = Math.max(0, Math.min(1, (target - walked) / len));
        const a = points[i], b = points[i + 1];
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const size = 9;
        const spread = 0.55;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
        ctx.lineTo(x - Math.cos(angle - spread) * size, y - Math.sin(angle - spread) * size);
        ctx.lineTo(x - Math.cos(angle + spread) * size, y - Math.sin(angle + spread) * size);
        ctx.closePath();
        ctx.fill();
        count += 1;
        break;
      }
    }
    return count;
  }

  _drawGhostMarker(ctx, sx, sy, g) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const p = Math.max(0, Math.min(1, (now - this._ghost.start) / this._ghost.durationMs));
    const fpos = p * (g.length - 1);
    const i = Math.min(g.length - 2, Math.floor(fpos));
    const f = fpos - i;
    const x = sx(g[i].x + (g[i + 1].x - g[i].x) * f);
    const y = sy(g[i].y + (g[i + 1].y - g[i].y) * f);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.shadowColor = 'rgba(139,107,255,0.9)';
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
}
