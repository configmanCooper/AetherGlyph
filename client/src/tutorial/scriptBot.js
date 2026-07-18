// scriptBot.js — deterministic scripted instructor for tutorial lessons.
//
// The teaching bot is wizard 1 and drives the SAME sim intent path a human uses
// (SOLO-MODES-PLAN §7, §2): it only ever emits legal intents and the Sim itself
// validates cost/cooldown/charges/loadout, so the bot can never cheat. It takes
// NO Math.random and no free RNG — every decision is a pure function of the sim
// tick and public sim state, so a lesson replays identically. It creates real
// teaching moments (a telegraphed bolt to Brace, a Focus to interrupt, a wall to
// Quake) rather than tapping objectives complete for the player.
//
// Behaviour is data-driven via `config` so a handful of primitives cover every
// lesson: idle, periodic, focus-loop, on-mark-defend, wall-focus, and a fully
// scripted timed sequence.

import { effectFor, PROJECTILE } from '../../../shared/src/sim/spellEffects.js';

export const SCRIPT_BEHAVIORS = ['idle', 'periodic', 'focus-loop', 'on-mark-defend', 'wall-focus', 'sequence'];

export class ScriptBot {
  constructor(playerId, config = {}) {
    this.id = playerId;
    this.behavior = config.behavior || 'idle';
    this.config = config;
    this.mem = { nextAttempt: config.startTick ?? 0, seqDone: new Set() };
  }

  // A legal cast gate mirroring the sim's own acceptance checks so the bot only
  // commits to casts it can actually make (avoids wasted no-op intents).
  canCast(sim, id) {
    const w = sim.wizards[this.id];
    if (!w || !sim.canAct(w) || w.casting || w.focusing || w.channel || w.recoveryTicks > 0) return false;
    if (!w.loadoutIds.includes(id)) return false;
    const spell = sim.spellData(id);
    const eff = effectFor(id);
    if (!spell || !eff) return false;
    if ((w.cooldowns[id] || 0) > 0) return false;
    if (w.aether < spell.aether) return false;
    if ((spell.charges || 0) > w.charges) return false;
    return true;
  }

  firstProjectile(sim) {
    const w = sim.wizards[this.id];
    for (const s of w.loadout) {
      const eff = effectFor(s.id);
      if (eff && eff.type === PROJECTILE && this.canCast(sim, s.id)) return s.id;
    }
    return null;
  }

  ownsCover(sim) {
    return sim.zones.some((z) => z.kind === 'Cover' && z.owner === this.id && z.ticks > 0);
  }

  // Return the wizard-1 intent for this tick.
  act(sim) {
    const w = sim.wizards[this.id];
    // Skip only when truly committed (mid-cast / channel) or hard-controlled.
    // NOTE: do NOT bail on `w.focusing` — focus behaviours must keep holding the
    // channel each tick or it would start-and-cancel every frame.
    if (!w || !sim.canAct(w) || w.casting || w.channel) return {};
    switch (this.behavior) {
      case 'idle': return { move: 0 };
      case 'periodic': return this._periodic(sim);
      case 'focus-loop': return this._focusLoop(sim);
      case 'on-mark-defend': return this._onMarkDefend(sim);
      case 'wall-focus': return this._wallFocus(sim);
      case 'sequence': return this._sequence(sim);
      default: return { move: 0 };
    }
  }

  // Fire a fixed spell (or the first available projectile) on a period. Stands
  // still so its own casts land and so the student can reliably hit it back.
  _periodic(sim) {
    const startTick = this.config.startTick ?? 0;
    const period = this.config.periodTicks ?? 120;
    if (sim.tick < startTick) return { move: 0 };
    if (sim.tick >= this.mem.nextAttempt) {
      const id = this.config.spellId ?? this.firstProjectile(sim);
      if (id != null && this.canCast(sim, id)) {
        this.mem.nextAttempt = sim.tick + period;
        return { move: 0, cast: id, castQuality: 1 };
      }
    }
    return { move: 0 };
  }

  // Continuously Focus so the student can practise interrupting a channel.
  _focusLoop(sim) {
    const startTick = this.config.startTick ?? 0;
    if (sim.tick < startTick) return { move: 0 };
    return { move: 0, focus: true };
  }

  // Raise a defensive shell (Barrier by default) once the instructor is Marked,
  // teaching the student to wait out a defence before spending a payoff.
  _onMarkDefend(sim) {
    const w = sim.wizards[this.id];
    const defendId = this.config.defendId ?? 11; // Barrier Dome
    const trigger = this.config.triggerStatus ?? 'Marked';
    if (sim.hasStatus(w, trigger) && !w.barrier && this.canCast(sim, defendId)) {
      return { move: 0, cast: defendId, castQuality: 1 };
    }
    return { move: 0 };
  }

  // Build a Stone Wall then Focus behind it — a target for Quake / cover play.
  _wallFocus(sim) {
    const startTick = this.config.startTick ?? 0;
    const wallId = this.config.wallId ?? 15;
    if (sim.tick < startTick) return { move: 0 };
    if (!this.ownsCover(sim) && this.canCast(sim, wallId)) return { move: 0, cast: wallId, castQuality: 1 };
    if (this.ownsCover(sim)) return { move: 0, focus: true };
    return { move: 0 };
  }

  // A fully authored list of timed steps: [{ tick, cast }] or [{ tick, focus }].
  // Each step fires once, on or after its tick, when castable.
  _sequence(sim) {
    const steps = this.config.steps || [];
    for (let i = 0; i < steps.length; i++) {
      if (this.mem.seqDone.has(i)) continue;
      const step = steps[i];
      if (sim.tick < step.tick) continue;
      if (step.focus) { this.mem.seqDone.add(i); return { move: 0, focus: true }; }
      if (step.cast != null) {
        if (this.canCast(sim, step.cast)) { this.mem.seqDone.add(i); return { move: 0, cast: step.cast, castQuality: 1 }; }
        // not castable yet (cooldown/charges) — retry next tick without consuming the step
        return { move: 0 };
      }
      this.mem.seqDone.add(i);
    }
    return { move: 0 };
  }
}

// Factory used by the runner from a lesson's opponent config.
export function makeScriptBot(playerId, config) {
  return new ScriptBot(playerId, config || { behavior: 'idle' });
}

// Shared legality gate (mirrors Sim.beginCast preconditions) reused by the
// headless "intended student" solutions so a lesson's solution only ever emits
// legal casts — the same guarantee the ScriptBot and the real player have.
export function canWizardCast(sim, wizardId, id) {
  const w = sim.wizards[wizardId];
  if (!w || !sim.canAct(w) || w.casting || w.focusing || w.channel || w.recoveryTicks > 0) return false;
  if (!w.loadoutIds.includes(id)) return false;
  const spell = sim.spellData(id);
  const eff = effectFor(id);
  if (!spell || !eff) return false;
  if ((w.cooldowns[id] || 0) > 0) return false;
  if (w.aether < spell.aether) return false;
  if ((spell.charges || 0) > w.charges) return false;
  return true;
}
