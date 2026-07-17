// movement.js — left-thumb movement control (strafe arc + sidestep flick).
//
// Writes into the shared `input` object consumed by LocalMatch each fixed tick:
//   input.move     : -1 | 0 | 1 continuous strafe direction
//   input.sidestep : -1 | 0 | 1 one-shot dodge (set on a quick flick)

export class MovementControl {
  constructor(pad, stick, input, opts = {}) {
    this.pad = pad;
    this.stick = stick;
    this.input = input;
    this.lefthand = opts.lefthand || false;
    this.active = false;
    this.pointerId = null;
    this.origin = null;
    this.last = null;
    this.startTime = 0;
    this._bind();
  }

  setLefthand(v) { this.lefthand = v; }

  _bind() {
    const p = this.pad;
    p.style.touchAction = 'none';
    p.addEventListener('pointerdown', (e) => this._down(e));
    p.addEventListener('pointermove', (e) => this._move(e));
    p.addEventListener('pointerup', (e) => this._up(e));
    p.addEventListener('pointercancel', (e) => this._up(e));
    p.addEventListener('pointerleave', (e) => this._up(e));
  }

  _center(e) {
    const r = this.pad.getBoundingClientRect();
    return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2), r };
  }

  _down(e) {
    e.preventDefault();
    this.pad.setPointerCapture(e.pointerId);
    this.active = true;
    this.pointerId = e.pointerId;
    const c = this._center(e);
    this.origin = { x: e.clientX, y: e.clientY };
    this.last = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.startTime = performance.now();
    this._apply(c);
  }

  _move(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const now = performance.now();
    // Quick horizontal flick => sidestep.
    if (this.last) {
      const dx = e.clientX - this.last.x;
      const dt = now - this.last.t;
      const vx = dx / Math.max(1, dt);
      if (Math.abs(vx) > 0.9 && Math.abs(dx) > 26) {
        let dir = Math.sign(dx);
        if (this.lefthand) dir = -dir;
        this.input.sidestep = dir;
      }
    }
    this.last = { x: e.clientX, y: e.clientY, t: now };
    this._apply(this._center(e));
  }

  _apply(c) {
    const dead = 12;
    let dir = 0;
    if (c.x > dead) dir = 1;
    else if (c.x < -dead) dir = -1;
    if (this.lefthand) dir = -dir;
    this.input.move = dir;
    // move the visual stick
    const max = c.r.width * 0.28;
    const sx = Math.max(-max, Math.min(max, c.x));
    const sy = Math.max(-max, Math.min(max, c.y));
    this.stick.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;
  }

  _up(e) {
    if (e && e.pointerId !== undefined && e.pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = null;
    this.input.move = 0;
    this.stick.style.transform = 'translate(-50%, -50%)';
  }
}
