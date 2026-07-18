// calibration.js — interactive first-run comfort calibration (SOLO-MODES-PLAN §7
// CALIBRATE, §12 calibration block).
//
// The player draws a line, a circle, and a V at a natural, comfortable size. From
// those three strokes we derive:
//   - guideScale: how large to draw the on-pad guides (relative to a reference
//     drawing size), and
//   - comfortableDurationMs: the player's comfortable stroke pace.
//
// It NEVER changes recognition thresholds — recognition is untouched. Calibration
// only sizes the guides and informs comfort UI. Trivial taps are ignored so a
// stray touch cannot skew the result.

const STEPS = [
  { key: 'line', label: 'Draw a horizontal line, left to right.', refExtent: 0.60 },
  { key: 'circle', label: 'Draw a circle.', refExtent: 0.50 },
  { key: 'v', label: 'Draw a V shape.', refExtent: 0.55 },
];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export class Calibration {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onStep = opts.onStep || (() => {});
    this.onComplete = opts.onComplete || (() => {});
    this.reduced = opts.reduced || false;
    this.samples = [];
    this.step = 0;
    this.points = [];
    this.drawing = false;
    this.startT = 0;
    this._done = false;
    this._bind();
    this.resize();
  }

  start() {
    this.samples = [];
    this.step = 0;
    this.points = [];
    this._done = false;
    this.resize();
    this._emitStep();
    this._redraw();
  }

  _emitStep() {
    const s = STEPS[this.step];
    this.onStep(s ? s.label : '', this.step, STEPS.length);
  }

  resize() {
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._redraw();
  }

  _bind() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', () => { this.drawing = false; this.points = []; this._redraw(); });
    c.addEventListener('pointerleave', (e) => { if (this.drawing) this._up(e); });
    if (typeof window !== 'undefined') window.addEventListener('resize', () => this.resize());
  }

  _pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  _down(e) {
    if (this._done) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.drawing = true;
    this.startT = now();
    this.points = [this._pos(e)];
    this._redraw();
  }

  _move(e) {
    if (!this.drawing) return;
    e.preventDefault();
    const p = this._pos(e);
    const last = this.points[this.points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1.5) { this.points.push(p); this._redraw(); }
  }

  _up(e) {
    if (!this.drawing) return;
    if (e) e.preventDefault?.();
    this.drawing = false;
    const durationMs = Math.max(0, now() - this.startT);
    const bbox = this._bbox();
    const extent = Math.max(bbox.w, bbox.h);
    const r = this.canvas.getBoundingClientRect();
    const dim = Math.min(r.width, r.height) || 1;
    // Ignore a trivial tap/dot — re-prompt the same step.
    if (this.points.length < 4 || extent < dim * 0.12) { this.points = []; this._redraw(); return; }
    const ref = STEPS[this.step].refExtent || 0.55;
    this.samples.push({ scale: (extent / dim) / ref, durationMs });
    this.points = [];
    this.step += 1;
    if (this.step >= STEPS.length) this._finish();
    else { this._emitStep(); this._redraw(); }
  }

  _finish() {
    this._done = true;
    const scales = this.samples.map((s) => s.scale).filter((x) => Number.isFinite(x) && x > 0);
    const durs = this.samples.map((s) => s.durationMs).filter((x) => Number.isFinite(x) && x > 0);
    const guideScale = clamp(round2(median(scales) || 1), 0.4, 1.5);
    const comfortableDurationMs = clamp(Math.round(mean(durs) || 720), 120, 6000);
    this.onComplete({ guideScale, comfortableDurationMs, done: true });
  }

  _bbox() {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of this.points) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
    if (!Number.isFinite(minx)) return { w: 0, h: 0 };
    return { w: maxx - minx, h: maxy - miny };
  }

  _redraw() {
    const ctx = this.ctx;
    const r = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    if (this.points.length >= 2) {
      ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(79,214,201,0.9)';
      ctx.shadowColor = 'rgba(79,214,201,0.8)';
      ctx.shadowBlur = this.reduced ? 0 : 10;
      ctx.beginPath();
      ctx.moveTo(this.points[0].x, this.points[0].y);
      for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
