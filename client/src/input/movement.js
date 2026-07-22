// movement.js — left-thumb movement, Focus/Brace, and Dodge control.
//
// Writes into the shared `input` object consumed by LocalMatch each fixed tick:
//   input.move     : -1 | 0 | 1 continuous strafe direction
//   input.sidestep : -1 | 0 | 1 one-shot dodge (set on a quick flick)

export function classifyJoystick(nx, ny) {
  const central = Math.abs(nx) <= 0.45;
  if (central && ny <= -0.8) return { move: 0, focus: true, brace: false, dodge: 0 };
  if (central && ny >= 0.8) return { move: 0, focus: false, brace: true, dodge: 0 };
  if (Math.abs(nx) > 0.95) return {
    move: Math.sign(nx), focus: false, brace: false, dodge: Math.sign(nx),
  };
  return {
    move: Math.abs(nx) >= 0.18 ? Math.sign(nx) : 0,
    focus: false,
    brace: false,
    dodge: 0,
  };
}

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
    this.touchActive = false;
    this.edgeDodgeLatched = false;
    this.lastTap = null;
    this.lastDir = 1;
    this._bind();
  }

  setLefthand(v) { this.lefthand = v; }

  debugState() {
    return {
      move: this.input.move,
      focus: !!this.input.focus,
      brace: !!this.input.brace,
      sidestep: this.input.sidestep,
      edgeDodgeLatched: this.edgeDodgeLatched,
    };
  }

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
    try { this.pad.setPointerCapture(e.pointerId); } catch { /* synthetic/test or unsupported capture */ }
    this.active = true;
    this.touchActive = e.pointerType !== 'mouse';
    this.pointerId = e.pointerId;
    const c = this._center(e);
    const now = performance.now();
    if (this.touchActive && this.lastTap
        && now - this.lastTap.time <= 320
        && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) <= c.r.width * 0.28) {
      let dir;
      if (Math.abs(c.x) > 8) {
        dir = Math.sign(c.x);
        if (this.lefthand) dir = -dir;
      } else {
        dir = this.lastDir;
      }
      this.input.sidestep = dir || 1;
      this.lastTap = null;
    }
    this.origin = { x: e.clientX, y: e.clientY };
    this.last = { x: e.clientX, y: e.clientY, t: now };
    this.startTime = now;
    this.edgeDodgeLatched = false;
    this._apply(c);
  }

  _move(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const now = performance.now();
    // Quick horizontal flick remains a secondary Dodge gesture.
    if (this.touchActive && this.last) {
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
    // move the visual stick
    const max = Math.min(c.r.width, c.r.height) * 0.28;
    const sx = Math.max(-max, Math.min(max, c.x));
    const sy = Math.max(-max, Math.min(max, c.y));
    this.stick.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;

    let result;
    if (this.touchActive) {
      result = classifyJoystick(sx / Math.max(1, max), sy / Math.max(1, max));
    } else {
      result = { move: Math.abs(c.x) > 12 ? Math.sign(c.x) : 0, focus: false, brace: false, dodge: 0 };
    }
    let dir = result.move;
    if (this.lefthand) dir = -dir;
    this.input.move = dir;
    this.input.focus = !!result.focus;
    this.input.brace = !!result.brace;
    if (dir) this.lastDir = dir;

    if (result.dodge && !this.edgeDodgeLatched) {
      let dodgeDir = result.dodge;
      if (this.lefthand) dodgeDir = -dodgeDir;
      this.input.sidestep = dodgeDir;
      this.edgeDodgeLatched = true;
    } else if (!result.dodge && Math.abs(sx / Math.max(1, max)) < 0.8) {
      this.edgeDodgeLatched = false;
    }
  }

  _up(e) {
    if (e && e.pointerId !== undefined && e.pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = null;
    this.input.move = 0;
    this.input.focus = false;
    this.input.brace = false;
    if (this.touchActive && this.origin && performance.now() - this.startTime <= 250
        && this.last && Math.hypot(this.last.x - this.origin.x, this.last.y - this.origin.y) <= 20) {
      this.lastTap = { x: this.origin.x, y: this.origin.y, time: performance.now() };
    }
    this.touchActive = false;
    this.stick.style.transform = 'translate(-50%, -50%)';
  }
}
