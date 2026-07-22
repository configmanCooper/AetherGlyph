// localMatch.js — offline match driver for a single round.
//
// Wraps the pure shared Sim with a fixed-tick accumulator (decoupled from
// requestAnimationFrame, per the Fish-Friends pattern) plus an opponent bot. The
// UI mutates `input`; each fixed tick we translate it into a sim intent. One-shot
// inputs (sidestep, a recognized cast) fire once then clear.
//
// Modes:
//   'practice' — single-round Practice vs AI. The opponent is the fair PracticeBot
//                (Very Easy/Easy/Medium/Hard). A NON-DRAINING event history is kept so the
//                pure coaching reducer can build a post-round report (§20). It
//                stores no raw gesture traces — only discrete Sim events.
//   'lab'      — Glyph Laboratory: no opponent, no combat pressure.
//   'duel'     — legacy best-of-three vs the internal DuelBot (kept for tests).

import { Sim } from '@shared/sim/sim.js';
import { DT, TICK_HZ } from '@shared/sim/constants.js';
import { starterLoadout } from '@shared/balance/loadouts.js';
import { DuelBot } from '@shared/bot/bot.js';
import { PracticeBot, PRACTICE_DIFFICULTIES } from '@shared/bot/practiceBot.js';
import { makeRng } from '@shared/rng/rng.js';

const TICK_MS = 1000 / TICK_HZ;
const MAX_CATCHUP = 6; // avoid spiral-of-death after a tab stall

export class LocalMatch {
  constructor(opts = {}) {
    const seed = (opts.seed ?? ((Date.now() & 0x7fffffff))) >>> 0;
    this.seed = seed;
    this.mode = opts.mode || 'practice';
    this.difficulty = opts.difficulty || 'medium';
    this.assisted = !!opts.assisted;
    this.playerLoadout = opts.playerLoadout || starterLoadout();
    this.botLoadout = opts.botLoadout || starterLoadout();
    this.loadout = this.playerLoadout;
    this.timed = opts.timed !== false; // practice can be run untimed
    this.sim = new Sim({
      seed,
      loadouts: [this.playerLoadout, this.botLoadout],
      rules: {
        timer: this.timed,
        pressure: this.timed,
        sandbox: this.mode === 'lab',
        sandboxCooldowns: !!opts.sandboxCooldowns,
      },
    });
    // Player is wizard 0; the bot controls wizard 1. Practice difficulties route
    // to the fair PracticeBot; the legacy internal names use the old DuelBot.
    this.botActive = opts.botActive !== false && this.mode !== 'lab';
    if (this.botActive) {
      const botRng = makeRng((seed ^ 0x5a5a) >>> 0);
      this.bot = PRACTICE_DIFFICULTIES.includes(this.difficulty)
        ? new PracticeBot(1, { difficulty: this.difficulty, rng: botRng })
        : new DuelBot(1, { difficulty: this.difficulty, rng: botRng });
    } else {
      this.bot = null;
    }
    this.acc = 0;
    this.events = [];
    this.history = [];      // non-draining full event log (coaching); no traces
    this._blockedDamage = 0;
    this._prevGuard = null; // { shield, barrier } absorb slice for blocked-damage deltas
    this.input = { move: 0, sidestep: 0, focus: false, brace: false, pendingCast: null, pendingQuality: 1 };
    this.enemyPendingCast = null;
    this.enemyMove = 0;
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

  queueEnemyCast(spellId) {
    if (this.mode !== 'lab' || this.enemyPendingCast != null) return false;
    const enemy = this.sim.wizards[1];
    if (!enemy || !this.sim.canAct(enemy) || enemy.casting || enemy.channel || enemy.recoveryTicks > 0) return false;
    this.enemyPendingCast = Number(spellId);
    return Number.isInteger(this.enemyPendingCast);
  }

  setEnemyMove(direction) {
    this.enemyMove = Math.sign(Number(direction) || 0);
  }

  // Accumulate shield/barrier damage soaked by the player this tick (for coaching).
  _trackBlocked() {
    const p = this.sim.wizards[0];
    const cur = {
      shield: p.shield ? { absorb: p.shield.absorb, ticks: p.shield.ticks } : null,
      barrier: p.barrier ? { absorb: p.barrier.absorb, ticks: p.barrier.ticks } : null,
    };
    if (this._prevGuard) {
      this._blockedDamage += absorbDelta(this._prevGuard.shield, cur.shield);
      this._blockedDamage += absorbDelta(this._prevGuard.barrier, cur.barrier);
    }
    this._prevGuard = cur;
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
      let botIntent = (this.botActive && this.bot) ? this.bot.act(this.sim) : { move: this.enemyMove };
      if (this.enemyPendingCast != null) {
        botIntent = { cast: this.enemyPendingCast, castQuality: 1 };
        this.enemyPendingCast = null;
      }
      const evs = this.sim.step({ 0: playerIntent, 1: botIntent });
      for (const e of evs) { this.events.push(e); this.history.push(e); }
      this._trackBlocked();
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

  // A non-draining coaching log for the pure reducer (shared/src/analytics/coach.js).
  // Contains only discrete Sim events + small end facts — never raw gesture traces.
  coachLog() {
    return {
      playerId: 0,
      botId: 1,
      difficulty: this.difficulty,
      assisted: this.assisted,
      events: this.history,
      winner: this.sim.winner,
      finalHealth: [this.sim.wizards[0].health, this.sim.wizards[1].health],
      finalCharges: Math.floor(this.sim.wizards[0].charges),
      blockedDamage: this._blockedDamage,
      playerLoadout: this.playerLoadout.map((s) => s.id),
      botLoadout: this.botLoadout.map((s) => s.id),
    };
  }

  // Fractional interpolation between ticks (for smooth rendering).
  get alpha() { return Math.min(1, this.acc / TICK_MS); }
}

function absorbDelta(prev, cur) {
  if (!prev) return 0;
  if (cur) return Math.max(0, prev.absorb - cur.absorb);
  return prev.ticks > 1 ? prev.absorb : 0;
}

export { DT };
