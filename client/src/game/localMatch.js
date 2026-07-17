// localMatch.js — offline match driver for a single round.
//
// Wraps the pure shared Sim with a fixed-tick accumulator (decoupled from
// requestAnimationFrame, per the Fish-Friends pattern) plus a DuelBot for the
// opponent. The UI mutates `input`; each fixed tick we translate it into a sim
// intent. One-shot inputs (sidestep, a recognized cast) fire once then clear.
//
// Best-of-three series state lives in the app layer (main.js): it constructs a
// fresh LocalMatch per round with the SAME player/opponent loadouts and a
// per-round derived seed, so loadouts are preserved while arena/statuses reset.

import { Sim } from '@shared/sim/sim.js';
import { DT, TICK_HZ } from '@shared/sim/constants.js';
import { starterLoadout } from '@shared/balance/loadouts.js';
import { DuelBot } from '@shared/bot/bot.js';
import { makeRng } from '@shared/rng/rng.js';

const TICK_MS = 1000 / TICK_HZ;
const MAX_CATCHUP = 6; // avoid spiral-of-death after a tab stall

export class LocalMatch {
  constructor(opts = {}) {
    const seed = (opts.seed ?? ((Date.now() & 0x7fffffff))) >>> 0;
    this.seed = seed;
    this.mode = opts.mode || 'duel';
    this.playerLoadout = opts.playerLoadout || starterLoadout();
    this.botLoadout = opts.botLoadout || starterLoadout();
    this.loadout = this.playerLoadout;
    this.sim = new Sim({ seed, loadouts: [this.playerLoadout, this.botLoadout] });
    // Player is wizard 0; the bot controls wizard 1.
    this.bot = new DuelBot(1, { difficulty: opts.difficulty || 'apprentice', rng: makeRng((seed ^ 0x5a5a) >>> 0) });
    this.botActive = opts.botActive !== false;
    this.acc = 0;
    this.events = [];
    this.input = { move: 0, sidestep: 0, focus: false, brace: false, pendingCast: null, pendingQuality: 1 };
    this.onEnd = opts.onEnd || null;
    this._ended = false;
  }

  get player() { return this.sim.wizards[0]; }
  get enemy() { return this.sim.wizards[1]; }

  buildPlayerIntent() {
    const i = this.input;
    const intent = { move: i.move, sidestep: i.sidestep, focus: i.focus, brace: i.brace };
    if (i.pendingCast != null) {
      intent.cast = i.pendingCast;
      intent.castQuality = i.pendingQuality;
      intent.castWasGesture = true;
      i.pendingCast = null;
    }
    i.sidestep = 0; // one-shot
    return intent;
  }

  // Advance the simulation by real elapsed milliseconds using fixed ticks.
  update(dtMs) {
    if (this.sim.ended) {
      if (!this._ended) { this._ended = true; if (this.onEnd) this.onEnd(this.sim); }
      return;
    }
    this.acc += Math.min(dtMs, TICK_MS * MAX_CATCHUP * 3);
    let steps = 0;
    while (this.acc >= TICK_MS && steps < MAX_CATCHUP && !this.sim.ended) {
      const playerIntent = this.buildPlayerIntent();
      const botIntent = this.botActive ? this.bot.act(this.sim) : {};
      const evs = this.sim.step({ 0: playerIntent, 1: botIntent });
      for (const e of evs) this.events.push(e);
      this.acc -= TICK_MS;
      steps += 1;
    }
    if (this.sim.ended && !this._ended) { this._ended = true; if (this.onEnd) this.onEnd(this.sim); }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // Fractional interpolation between ticks (for smooth rendering).
  get alpha() { return Math.min(1, this.acc / TICK_MS); }
}

export { DT };
