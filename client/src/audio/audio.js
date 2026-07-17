// audio.js — WebAudio synthesis, no external assets. Unlocked on first gesture.
//
// Each school has a readable audio family (MASTERPLAN §11/§21). Everything is
// synthesized so the game ships zero audio files and works offline.

const SCHOOL_TONE = {
  Ember:  { type: 'sawtooth', base: 180, rise: 1.6 },
  Tide:   { type: 'sine', base: 340, rise: 0.8 },
  Storm:  { type: 'square', base: 520, rise: 2.2 },
  Stone:  { type: 'triangle', base: 90, rise: 0.6 },
  Gale:   { type: 'sine', base: 620, rise: 1.2 },
  Arcane: { type: 'triangle', base: 440, rise: 1.0 },
  Umbra:  { type: 'sawtooth', base: 130, rise: 0.7 },
  Prismatic: { type: 'square', base: 700, rise: 1.5 },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on) { this.enabled = on; if (!on && this.ctx) this.master.gain.value = 0; else if (this.master) this.master.gain.value = 0.32; }

  _blip({ type = 'sine', freq = 440, dur = 0.18, gain = 0.6, rise = 1, glideTo = null }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01 * rise);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  _noise({ dur = 0.2, gain = 0.5, hp = 300 }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = gain;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  castStart(school) {
    const tone = SCHOOL_TONE[school] || SCHOOL_TONE.Arcane;
    this._blip({ type: tone.type, freq: tone.base, dur: 0.22, gain: 0.35, rise: tone.rise, glideTo: tone.base * 1.4 });
  }
  cast(school) {
    const tone = SCHOOL_TONE[school] || SCHOOL_TONE.Arcane;
    this._blip({ type: tone.type, freq: tone.base * 1.5, dur: 0.28, gain: 0.5, rise: tone.rise, glideTo: tone.base });
  }
  damage() { this._noise({ dur: 0.22, gain: 0.4, hp: 200 }); this._blip({ type: 'triangle', freq: 140, dur: 0.16, gain: 0.4, glideTo: 70 }); }
  reject() { this._blip({ type: 'square', freq: 160, dur: 0.12, gain: 0.3, glideTo: 90 }); }
  accept() { this._blip({ type: 'sine', freq: 660, dur: 0.1, gain: 0.3, glideTo: 990 }); }
  shield() { this._blip({ type: 'sine', freq: 300, dur: 0.4, gain: 0.35, glideTo: 420 }); }
  reflect() { this._blip({ type: 'square', freq: 800, dur: 0.18, gain: 0.35, glideTo: 1300 }); }
  focus() { this._blip({ type: 'triangle', freq: 260, dur: 0.5, gain: 0.3, glideTo: 520 }); }
  heavyWarn() { this._blip({ type: 'sawtooth', freq: 70, dur: 0.5, gain: 0.4, glideTo: 55 }); }
  roundEnd(win) { this._blip({ type: 'triangle', freq: win ? 440 : 220, dur: 0.6, gain: 0.4, glideTo: win ? 880 : 130 }); }
}
