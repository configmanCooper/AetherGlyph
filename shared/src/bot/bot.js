// bot.js — deterministic rule-based duel bot.
//
// The bot uses the SAME intents and resource rules a human uses (MASTERPLAN
// §15). It never touches Math.random; it takes a seeded rng so a match replays
// identically. Difficulty changes decision quality and reaction time, not
// hidden stats. Phase 1 ships the Apprentice profile plus stronger tiers for
// termination/balance tests.

import { makeRng } from '../rng/rng.js';
import { effectFor, PROJECTILE, REFLECT, SHIELD } from '../sim/spellEffects.js';
import { TICK_HZ } from '../sim/constants.js';

export const DIFFICULTY = {
  apprentice: { reactionTicks: 30, aggression: 0.6, defends: 0.25, focusBias: 0.2, dodge: 0.4 },
  adept:      { reactionTicks: 18, aggression: 0.75, defends: 0.55, focusBias: 0.35, dodge: 0.65 },
  magus:      { reactionTicks: 10, aggression: 0.85, defends: 0.8, focusBias: 0.5, dodge: 0.8 },
  archmage:   { reactionTicks: 6, aggression: 0.9, defends: 0.95, focusBias: 0.6, dodge: 0.95 },
};

export class DuelBot {
  constructor(playerId, opts = {}) {
    this.id = playerId;
    const diff = typeof opts.difficulty === 'string' ? opts.difficulty : 'apprentice';
    this.profile = { ...(DIFFICULTY[diff] || DIFFICULTY.apprentice), ...(opts.overrides || {}) };
    this.difficulty = diff;
    this.rng = opts.rng || makeRng(((opts.seed ?? 1) ^ (playerId * 0x9e3779b9)) >>> 0);
    this.lastDecisionTick = -999;
    this.moveDir = playerId === 0 ? 1 : -1;
    this.nextStrafeFlip = 0;
  }

  categorize(sim) {
    const w = sim.wizards[this.id];
    const offense = [];
    const defense = [];
    for (const s of w.loadout) {
      const eff = effectFor(s.id);
      if (!eff) continue;
      if (eff.type === PROJECTILE) offense.push(s);
      else defense.push(s);
    }
    // cheapest offense first for reliable pressure
    offense.sort((a, b) => a.aether - b.aether);
    return { offense, defense };
  }

  incomingThreat(sim) {
    return sim.projectiles.find((p) => p.owner !== this.id);
  }

  canCast(sim, w, spell) {
    if ((w.cooldowns[spell.id] || 0) > 0) return false;
    if (w.aether < spell.aether) return false;
    if ((spell.charges || 0) > w.charges) return false;
    return true;
  }

  act(sim) {
    const w = sim.wizards[this.id];
    const o = sim.opponentOf(this.id);
    const intent = {};
    if (!sim.canAct(w) || w.casting || w.focusing) {
      return intent; // committed / controlled — no new action
    }

    // Strafing / dodging so the bot is a moving target and can dodge.
    if (sim.tick >= this.nextStrafeFlip) {
      this.moveDir *= -1;
      this.nextStrafeFlip = sim.tick + this.rng.int(18, 42);
    }
    intent.move = this.moveDir;

    const threat = this.incomingThreat(sim);
    const { offense, defense } = this.categorize(sim);

    // Reactive defense to an incoming projectile.
    if (threat && this.rng.next() < this.profile.defends) {
      const reflect = defense.find((s) => effectFor(s.id).type === REFLECT && this.canCast(sim, w, s));
      const ward = defense.find((s) => effectFor(s.id).type === SHIELD && this.canCast(sim, w, s));
      // Only pop reflect when the projectile is about to land (small window).
      if (reflect && threat.ticks <= Math.round(0.25 * TICK_HZ)) {
        return { ...intent, cast: reflect.id, castQuality: 1 };
      }
      if (ward && threat.ticks <= Math.round(0.5 * TICK_HZ)) {
        return { ...intent, cast: ward.id, castQuality: 1 };
      }
      // Otherwise try to sidestep the shot.
      if (w.sidestepCharges > 0 && this.rng.next() < this.profile.dodge) {
        intent.sidestep = this.moveDir;
      }
    }

    // Reaction gate: only pick a new offensive action every reactionTicks.
    if (sim.tick - this.lastDecisionTick < this.profile.reactionTicks) {
      return intent;
    }
    this.lastDecisionTick = sim.tick;

    // Build a Sigil Charge occasionally when safe (no incoming threat).
    if (!threat && w.charges < 2 && this.rng.next() < this.profile.focusBias && o.casting == null) {
      return { ...intent, move: 0, focus: true };
    }

    // Offensive pressure.
    if (this.rng.next() < this.profile.aggression) {
      const pick = offense.find((s) => this.canCast(sim, w, s));
      if (pick) {
        const quality = 0.95 + this.rng.next() * 0.1; // 0.95..1.05
        return { ...intent, cast: pick.id, castQuality: Math.min(1.05, quality) };
      }
    }

    return intent;
  }
}

export function makeBots(seed, diff0 = 'apprentice', diff1 = 'apprentice') {
  return [
    new DuelBot(0, { difficulty: diff0, rng: makeRng((seed ^ 0xA5A5) >>> 0) }),
    new DuelBot(1, { difficulty: diff1, rng: makeRng((seed ^ 0x5A5A) >>> 0) }),
  ];
}
