// sim.js — Aetherglyph pure deterministic fixed-tick duel simulation.
//
// DOM-free, Three.js-free, Socket.IO-free. Imports only balance data + rng so
// it runs identically in Node (tests, bots, future authoritative server) and in
// the browser. Advance with step(intents); read state via snapshot(); verify
// determinism via hash(). NEVER call Math.random here — use this.rng.
//
// This follows the Fish-Friends pattern: all game logic is headless and emits
// events that rendering/audio/ui consume.

import {
  DT, TICK_HZ, MATCH, AETHER, SIGIL, FOCUS, SIDESTEP, BRACE, MOVE, CONTROL,
  CAST, STATUSES, HARD_CONTROL,
} from './constants.js';
import { SPELLS_BY_ID } from '../balance/spellData.generated.js';
import { effectFor, PROJECTILE, SHIELD, BARRIER, REFLECT } from './spellEffects.js';
import { makeRng } from '../rng/rng.js';

const sToTicks = (s) => Math.max(0, Math.round(s * TICK_HZ));

let _projId = 1;

function makeWizard(id, loadout, spawnArc) {
  return {
    id,
    loadout,                    // array of spell objects (with gestureKey)
    loadoutIds: loadout.map((s) => s.id),
    health: MATCH.startHealth,
    aether: AETHER.start,
    charges: SIGIL.start,
    arcPos: spawnArc,           // -1..1 along the movement arc
    facing: -spawnArc,          // toward opponent (render hint)
    sidestepCharges: SIDESTEP.charges,
    sidestepTimers: [],         // recharge timers (ticks)
    statuses: {},               // name -> { stacks, ticks }
    tenacityTicks: 0,
    cooldowns: {},              // spellId -> ticks
    casting: null,              // { spellId, ticks, totalTicks, quality }
    focusTicks: 0,              // accumulated focus channel ticks
    focusing: false,
    braceTicks: 0,
    shield: null,               // { absorb, ticks, frontal }
    barrier: null,              // { absorb, ticks }
    reflectTicks: 0,
    recoveryTicks: 0,           // post-cast / reject recovery lockout
    resonance: [],              // [{ school, ticks }]
    knockbackTimes: [],         // tick timestamps of recent knockbacks
    lastActivityTick: 0,        // for sigil decay
    // rolling counters
    damageDealt: 0,
    countersLanded: 0,
    castsResolved: 0,
    castsRejected: 0,
  };
}

export class Sim {
  constructor(opts = {}) {
    const seed = (opts.seed ?? 0x1234) >>> 0;
    this.rng = makeRng(seed);
    this.seed = seed;
    this.tick = 0;
    this.timeS = 0;
    this.ended = false;
    this.winner = null;         // 0 | 1 | 'draw' | null
    this.endReason = null;      // 'health' | 'timer'
    this.projectiles = [];
    this.zones = [];            // reserved for Phase 3 environment reactions
    this.pressureLevel = 0;
    this.healingDisabled = false;
    this.events = [];

    const l0 = opts.loadouts?.[0] || [];
    const l1 = opts.loadouts?.[1] || [];
    this.wizards = [
      makeWizard(0, l0, -0.35),
      makeWizard(1, l1, 0.35),
    ];
  }

  // ------------------------------------------------------------------ helpers
  opponentOf(id) { return this.wizards[id === 0 ? 1 : 0]; }

  emit(type, data) { this.events.push({ tick: this.tick, type, ...data }); }

  spellData(id) { return SPELLS_BY_ID[id]; }

  hasStatus(w, name) { return !!w.statuses[name] && w.statuses[name].ticks > 0; }

  statusStacks(w, name) { return this.hasStatus(w, name) ? w.statuses[name].stacks : 0; }

  isHardControlled(w) {
    return this.hasStatus(w, 'Frozen') || this.hasStatus(w, 'Stunned');
  }

  canAct(w) {
    return !this.isHardControlled(w);
  }

  slowFactor(w) {
    // Chilled slows movement and recovery.
    let slow = 0;
    if (this.hasStatus(w, 'Chilled')) slow += STATUSES.Chilled.slow;
    return Math.min(0.6, slow);
  }

  // ----------------------------------------------------------------- statuses
  applyStatus(target, name, stacks = 1, opts = {}) {
    const def = STATUSES[name];
    if (!def) return false;
    if (def.hard) {
      // Hard control obeys Tenacity.
      if (target.tenacityTicks > 0) {
        this.emit('controlResisted', { target: target.id, status: name });
        return false;
      }
    }
    const durS = Math.min(
      opts.durationS ?? def.durationS,
      def.hard ? CONTROL.maxHardControlS : (opts.durationS ?? def.durationS),
    );
    const cur = target.statuses[name];
    const maxStacks = def.maxStacks || 1;
    if (cur && cur.ticks > 0) {
      cur.stacks = Math.min(maxStacks, cur.stacks + stacks);
      cur.ticks = Math.max(cur.ticks, sToTicks(durS));
    } else {
      target.statuses[name] = { stacks: Math.min(maxStacks, stacks), ticks: sToTicks(durS) };
    }
    this.emit('status', { target: target.id, status: name, stacks: target.statuses[name].stacks });
    return true;
  }

  tickStatuses(w) {
    for (const name of Object.keys(w.statuses)) {
      const st = w.statuses[name];
      if (st.ticks <= 0) { delete w.statuses[name]; continue; }
      const def = STATUSES[name];
      if (def.kind === 'dot') {
        // Burning: dps damage per second, spread across ticks. Bypasses shields
        // and amp modifiers; not attributed to a live attacker.
        this.dealDamage(null, w,
          def.dps * st.stacks * DT, { source: 'Burning', ignoreDefense: true, ignoreAmp: true, ignoreCap: true, silent: true });
      }
      st.ticks -= 1;
      if (st.ticks <= 0) {
        delete w.statuses[name];
        if (def.hard) {
          // Tenacity engages after hard control ends.
          w.tenacityTicks = sToTicks(CONTROL.tenacityS);
          this.emit('tenacity', { target: w.id });
        }
        this.emit('statusEnd', { target: w.id, status: name });
      }
    }
  }

  // ------------------------------------------------------------------ damage
  dealDamage(attacker, target, rawAmount, opts = {}) {
    if (rawAmount <= 0 || target.health <= 0) return 0;
    let dmg = rawAmount;

    // Attacker Weakened reduces outgoing damage.
    if (attacker && this.hasStatus(attacker, 'Weakened')) {
      dmg *= (1 - STATUSES.Weakened.damageDealt);
    }
    // Target Sundered increases incoming direct damage.
    if (!opts.ignoreAmp && this.hasStatus(target, 'Sundered')) {
      dmg *= (1 + STATUSES.Sundered.damageTaken);
    }
    // Marked: next direct hit amplified, then consumed.
    if (!opts.ignoreAmp && this.hasStatus(target, 'Marked')) {
      dmg *= (1 + STATUSES.Marked.markBonus);
      delete target.statuses.Marked;
      this.emit('statusEnd', { target: target.id, status: 'Marked' });
    }
    // Soaked amplifies lightning (Storm) damage.
    if (opts.school === 'Storm' && this.hasStatus(target, 'Soaked')) {
      dmg *= (1 + STATUSES.Soaked.lightningBonus);
    }

    if (!opts.ignoreDefense) {
      // Brace: flat frontal reduction.
      if (target.braceTicks > 0) dmg *= (1 - BRACE.damageReduction);

      // Barrier (360) absorbs first.
      if (target.barrier && target.barrier.ticks > 0) {
        const absorbed = Math.min(target.barrier.absorb, dmg);
        target.barrier.absorb -= absorbed;
        dmg -= absorbed;
        if (target.barrier.absorb <= 0) { target.barrier = null; }
      }
      // Frontal Ward shield. Piercing bypasses half the shield.
      if (dmg > 0 && target.shield && target.shield.ticks > 0) {
        const effective = opts.piercing ? dmg * 0.5 : dmg;
        const absorbed = Math.min(target.shield.absorb, effective);
        target.shield.absorb -= absorbed;
        dmg -= absorbed;
        if (target.shield.absorb <= 0) { target.shield = null; }
      }
    }

    dmg = Math.max(0, dmg);
    if (dmg <= 0) return 0;
    // No single resolved cast exceeds 30 direct damage (MASTERPLAN §9).
    if (!opts.ignoreCap) dmg = Math.min(dmg, 30);

    target.health = Math.max(0, target.health - dmg);
    target.lastActivityTick = this.tick;
    if (attacker) {
      attacker.damageDealt += dmg;
      attacker.lastActivityTick = this.tick;
    }
    if (!opts.silent) this.emit('damage', { target: target.id, amount: dmg, source: opts.source });
    if (target.health <= 0) this.endMatch(attacker ? attacker.id : null, 'health');
    return dmg;
  }

  // ---------------------------------------------------------------- intents
  beginCast(w, spellId, quality) {
    if (!this.canAct(w)) return false;
    if (w.casting || w.focusing || w.recoveryTicks > 0) return false;
    if (!w.loadoutIds.includes(spellId)) return false;
    const spell = this.spellData(spellId);
    const eff = effectFor(spellId);
    if (!spell || !eff) return false;
    // Cooldown check.
    if ((w.cooldowns[spellId] || 0) > 0) return false;
    // Barrier prevents offensive casting while active.
    const offensive = eff.type === PROJECTILE;
    if (offensive && w.barrier && w.barrier.ticks > 0) return false;
    // Aether cost (with resonance discount).
    const cost = this.effectiveCost(w, spell);
    if (w.aether < cost) return false;
    // Sigil charge cost.
    if ((spell.charges || 0) > w.charges) return false;

    let windupS = spell.min_cast_s * (1 + this.slowFactor(w));
    w.casting = {
      spellId, ticks: sToTicks(windupS), totalTicks: sToTicks(windupS),
      quality: Math.max(CAST.minPotency, Math.min(CAST.maxPotency, quality ?? 1)),
    };
    w.lastActivityTick = this.tick;
    this.emit('castStart', { caster: w.id, spellId, windupTicks: w.casting.ticks });
    return true;
  }

  effectiveCost(w, spell) {
    let cost = spell.aether;
    // Resonance: third matching elemental cast gets 10% discount.
    const school = spell.school;
    const matches = w.resonance.filter((r) => r.school === school && r.ticks > 0).length;
    if (matches >= 2) cost *= 0.9;
    return cost;
  }

  resolveCast(w) {
    const c = w.casting;
    w.casting = null;
    const spell = this.spellData(c.spellId);
    const eff = effectFor(c.spellId);
    const cost = Math.round(this.effectiveCost(w, spell));
    w.aether = Math.max(0, w.aether - cost);
    if (spell.charges) w.charges = Math.max(0, w.charges - spell.charges);
    w.cooldowns[c.spellId] = sToTicks(spell.cooldown_s);
    w.recoveryTicks = sToTicks(0.15 * (1 + this.slowFactor(w)));
    w.castsResolved += 1;
    w.lastActivityTick = this.tick;

    // Build elemental resonance (offensive elemental schools only).
    if (eff.type === PROJECTILE && ['Ember', 'Tide', 'Storm', 'Stone', 'Gale'].includes(spell.school)) {
      w.resonance.push({ school: spell.school, ticks: sToTicks(7) });
      if (w.resonance.length > 2) w.resonance.shift();
    }

    this.emit('cast', { caster: w.id, spellId: c.spellId, quality: c.quality });

    switch (eff.type) {
      case PROJECTILE: {
        const target = this.opponentOf(w.id);
        this.projectiles.push({
          id: _projId++, owner: w.id, spellId: c.spellId, eff,
          ticks: sToTicks(eff.travelS), totalTicks: sToTicks(eff.travelS), quality: c.quality,
          originPos: w.arcPos,
          targetPos: target.arcPos, // aimed at defender's position at release
        });
        break;
      }
      case SHIELD: {
        let absorb = eff.absorb;
        if (this.timeS >= MATCH.lateRoundS) absorb *= 0.8; // §3 shields lose 20%
        w.shield = { absorb, ticks: sToTicks(eff.durationS), frontal: eff.frontal };
        this.emit('shield', { caster: w.id, absorb });
        break;
      }
      case BARRIER: {
        let absorb = eff.absorb;
        if (this.timeS >= MATCH.lateRoundS) absorb *= 0.8;
        w.barrier = { absorb, ticks: sToTicks(eff.durationS) };
        this.emit('barrier', { caster: w.id, absorb });
        break;
      }
      case REFLECT: {
        w.reflectTicks = sToTicks(eff.windowS);
        this.emit('reflectWindow', { caster: w.id });
        break;
      }
      default: break;
    }
  }

  // -------------------------------------------------------------- projectiles
  advanceProjectiles() {
    const remaining = [];
    for (const p of this.projectiles) {
      p.ticks -= 1;
      const defender = this.opponentOf(p.owner);
      // Homing re-aims toward the live defender position.
      if (p.eff.homing > 0) {
        p.targetPos += (defender.arcPos - p.targetPos) * p.eff.homing;
      }
      if (p.ticks > 0) { remaining.push(p); continue; }
      this.resolveProjectile(p, defender);
    }
    this.projectiles = remaining;
  }

  resolveProjectile(p, defender) {
    const attacker = this.wizards[p.owner];
    const eff = p.eff;

    // Reflect window: bounce reflectable projectiles back at the caster.
    if (defender.reflectTicks > 0 && eff.reflectable) {
      defender.reflectTicks = 0;
      defender.charges = Math.min(SIGIL.max, defender.charges + 0.5); // half charge (§6)
      defender.countersLanded += 1;
      this.emit('reflect', { by: defender.id, spellId: p.spellId });
      this.projectiles.push({
        id: _projId++, owner: defender.id, spellId: p.spellId, eff,
        ticks: sToTicks(eff.travelS), totalTicks: sToTicks(eff.travelS), quality: p.quality,
        originPos: defender.arcPos,
        targetPos: attacker.arcPos,
      });
      return;
    }

    // Dodge: if the defender has strafed beyond the projectile's dodge radius.
    const miss = Math.abs(defender.arcPos - p.targetPos) > eff.dodgeRadius;
    if (miss) { this.emit('miss', { spellId: p.spellId, target: defender.id }); return; }

    // Hit — apply damage.
    const dmg0 = (eff.damage || 0) * p.quality;
    const dealt = this.dealDamage(attacker, defender, dmg0, {
      source: this.spellData(p.spellId).name,
      piercing: !!eff.piercing,
      school: eff.school,
    });

    // Status application — only if the projectile actually landed damage
    // (a fully-absorbed shot does not deliver its status rider).
    if (eff.status && dealt > 0) this.applyStatus(defender, eff.status.name, eff.status.stacks);

    // Interrupt channels/focus (Concussive Blast).
    if (eff.interrupt) {
      if (defender.casting) {
        this.emit('interrupt', { target: defender.id, spellId: defender.casting.spellId });
        defender.cooldowns[defender.casting.spellId] = sToTicks(this.spellData(defender.casting.spellId).cooldown_s);
        defender.casting = null;
        defender.recoveryTicks = sToTicks(CAST.rejectRecoveryS);
      }
      if (defender.focusing) {
        defender.focusing = false; defender.focusTicks = 0;
        this.emit('focusInterrupt', { target: defender.id });
      }
      attacker.countersLanded += 1;
    }

    // Knockback with diminishing returns (max 2 per 4s).
    if (eff.knockback) {
      defender.knockbackTimes = defender.knockbackTimes.filter(
        (t) => this.tick - t < sToTicks(CONTROL.knockbackWindowS));
      if (defender.knockbackTimes.length < CONTROL.knockbackMaxChain) {
        defender.knockbackTimes.push(this.tick);
        const dir = defender.arcPos >= attacker.arcPos ? 1 : -1;
        defender.arcPos = Math.max(-1, Math.min(1, defender.arcPos + dir * 0.25));
        this.emit('knockback', { target: defender.id });
      }
    }
  }

  // ------------------------------------------------------------------ per-tick
  updateWizardTimers(w) {
    // Aether regen (not during Focus).
    if (!w.focusing && w.aether < AETHER.max) {
      w.aether = Math.min(AETHER.max, w.aether + AETHER.regenPerS * DT);
    }
    // Cooldowns.
    for (const id of Object.keys(w.cooldowns)) {
      if (w.cooldowns[id] > 0) w.cooldowns[id] -= 1;
    }
    // Sidestep recharge: decrement each pending timer; restore a charge at 0.
    const nextTimers = [];
    for (const t of w.sidestepTimers) {
      const nt = t - 1;
      if (nt <= 0) w.sidestepCharges = Math.min(SIDESTEP.charges, w.sidestepCharges + 1);
      else nextTimers.push(nt);
    }
    w.sidestepTimers = nextTimers;
    // Tenacity.
    if (w.tenacityTicks > 0) w.tenacityTicks -= 1;
    // Recovery.
    if (w.recoveryTicks > 0) w.recoveryTicks -= 1;
    // Brace.
    if (w.braceTicks > 0) w.braceTicks -= 1;
    // Shield / barrier / reflect windows.
    if (w.shield) { w.shield.ticks -= 1; if (w.shield.ticks <= 0) w.shield = null; }
    if (w.barrier) { w.barrier.ticks -= 1; if (w.barrier.ticks <= 0) w.barrier = null; }
    if (w.reflectTicks > 0) w.reflectTicks -= 1;
    // Resonance expiry.
    w.resonance = w.resonance.filter((r) => (r.ticks -= 1) > 0);

    // Sigil decay: one charge decays after inactivity.
    if (w.charges > 0 && (this.tick - w.lastActivityTick) >= sToTicks(SIGIL.decayS)) {
      w.charges = Math.max(0, w.charges - 1);
      w.lastActivityTick = this.tick;
      this.emit('chargeDecay', { caster: w.id });
    }
  }

  applyIntent(w, intent) {
    if (!intent) return;
    const canAct = this.canAct(w);
    const rooted = this.hasStatus(w, 'Rooted') || this.hasStatus(w, 'Frozen');
    // Any deliberate non-focus action interrupts the vulnerable Focus channel.
    const wantsOther = !!(intent.move || intent.sidestep || intent.brace || intent.cast != null);

    // --- Focus (hold to gain a Sigil Charge) ---
    if (intent.focus && !wantsOther && canAct && !w.casting && w.recoveryTicks <= 0 && !rooted) {
      if (!w.focusing) { w.focusing = true; w.focusTicks = 0; this.emit('focusStart', { caster: w.id }); }
      w.focusTicks += 1;
      w.lastActivityTick = this.tick;
      if (w.focusTicks >= sToTicks(FOCUS.channelS)) {
        w.charges = Math.min(SIGIL.max, w.charges + 1);
        w.focusing = false; w.focusTicks = 0;
        this.emit('focusComplete', { caster: w.id, charges: w.charges });
      }
    } else if (w.focusing) {
      // Any other action interrupts the focus channel.
      w.focusing = false; w.focusTicks = 0;
      this.emit('focusCancel', { caster: w.id });
    }

    // --- Brace ---
    if (intent.brace && canAct && !w.focusing) {
      if (w.braceTicks <= 0 && w.aether >= BRACE.aetherCost) {
        w.aether -= BRACE.aetherCost;
        w.braceTicks = sToTicks(BRACE.durationS);
        this.emit('brace', { caster: w.id });
      }
    }

    // --- Movement ---
    if (!rooted && canAct && !w.focusing) {
      const speed = MOVE.speedPerS * (1 - this.slowFactor(w)) * DT;
      if (intent.move) w.arcPos += Math.sign(intent.move) * speed;
      // Sidestep: quick burst that consumes a charge.
      if (intent.sidestep && w.sidestepCharges > 0) {
        w.sidestepCharges -= 1;
        w.sidestepTimers.push(sToTicks(SIDESTEP.rechargeS));
        w.arcPos += Math.sign(intent.sidestep) * SIDESTEP.arcDelta;
        this.emit('sidestep', { caster: w.id });
      }
      // Arcane Pressure narrows the safe arc; clamp within the shrinking window.
      const limit = Math.max(0.1, 1 - this.pressureLevel * 0.12);
      w.arcPos = Math.max(-limit, Math.min(limit, w.arcPos));
    }

    // --- Cast (edge-triggered) ---
    if (intent.cast != null && canAct) {
      const ok = this.beginCast(w, intent.cast, intent.castQuality);
      if (!ok && intent.castWasGesture) {
        // A rejected deliberate trace incurs recovery but no Aether cost.
        w.recoveryTicks = Math.max(w.recoveryTicks, sToTicks(CAST.rejectRecoveryS));
        w.castsRejected += 1;
        this.emit('castRejected', { caster: w.id, spellId: intent.cast });
      }
    }
  }

  advanceCasting(w) {
    if (!w.casting) return;
    if (!this.canAct(w)) { // hard control cancels an in-progress cast
      this.emit('castCanceled', { caster: w.id, spellId: w.casting.spellId });
      w.casting = null;
      return;
    }
    w.casting.ticks -= 1;
    if (w.casting.ticks <= 0) this.resolveCast(w);
  }

  updatePressure() {
    if (this.timeS >= MATCH.arcanePressureStartS) {
      const steps = 1 + Math.floor((this.timeS - MATCH.arcanePressureStartS) / MATCH.arcanePressureStepS);
      if (steps !== this.pressureLevel) {
        this.pressureLevel = steps;
        this.emit('arcanePressure', { level: steps });
      }
    }
    if (this.timeS >= MATCH.lateRoundS && !this.healingDisabled) {
      this.healingDisabled = true;
      this.emit('lateRound', {});
    }
  }

  endMatch(winner, reason) {
    if (this.ended) return;
    this.ended = true;
    this.winner = winner;
    this.endReason = reason;
    this.emit('roundEnd', { winner, reason });
  }

  resolveTimer() {
    const [a, b] = this.wizards;
    let winner;
    if (a.health > b.health) winner = 0;
    else if (b.health > a.health) winner = 1;
    else if (a.damageDealt > b.damageDealt) winner = 0;
    else if (b.damageDealt > a.damageDealt) winner = 1;
    else winner = 'draw';
    this.endMatch(winner, 'timer');
  }

  // -------------------------------------------------------------------- step
  step(intents = {}) {
    if (this.ended) return this.events.splice(0);
    this.events = [];
    this.tick += 1;
    this.timeS = this.tick * DT;

    // 1. Timers / regen / status ticks.
    for (const w of this.wizards) {
      this.updateWizardTimers(w);
      this.tickStatuses(w);
    }
    if (this.ended) return this.events.splice(0);

    // 2. Pressure state.
    this.updatePressure();

    // 3. Intents (deterministic wizard order).
    this.applyIntent(this.wizards[0], intents[0]);
    this.applyIntent(this.wizards[1], intents[1]);

    // 4. Advance casts.
    this.advanceCasting(this.wizards[0]);
    this.advanceCasting(this.wizards[1]);
    if (this.ended) return this.events.splice(0);

    // 5. Advance projectiles / resolve hits.
    this.advanceProjectiles();
    if (this.ended) return this.events.splice(0);

    // 6. Round timer.
    if (this.timeS >= MATCH.roundLimitS) this.resolveTimer();

    return this.events.splice(0);
  }

  // --------------------------------------------------------------- snapshot
  snapshot() {
    return {
      tick: this.tick,
      timeS: this.timeS,
      ended: this.ended,
      winner: this.winner,
      endReason: this.endReason,
      pressureLevel: this.pressureLevel,
      projectiles: this.projectiles.map((p) => ({
        id: p.id, owner: p.owner, spellId: p.spellId, ticks: p.ticks, targetPos: p.targetPos,
      })),
      wizards: this.wizards.map((w) => ({
        id: w.id, health: w.health, aether: w.aether, charges: w.charges,
        arcPos: w.arcPos, casting: w.casting ? { spellId: w.casting.spellId, ticks: w.casting.ticks } : null,
        focusing: w.focusing, focusTicks: w.focusTicks, braceTicks: w.braceTicks,
        shield: w.shield ? { absorb: w.shield.absorb, ticks: w.shield.ticks } : null,
        barrier: w.barrier ? { absorb: w.barrier.absorb, ticks: w.barrier.ticks } : null,
        reflectTicks: w.reflectTicks, tenacityTicks: w.tenacityTicks,
        sidestepCharges: w.sidestepCharges, recoveryTicks: w.recoveryTicks,
        statuses: Object.fromEntries(Object.entries(w.statuses).map(([k, v]) => [k, { stacks: v.stacks, ticks: v.ticks }])),
        cooldowns: { ...w.cooldowns }, resonance: w.resonance.map((r) => r.school),
        damageDealt: w.damageDealt, castsResolved: w.castsResolved,
      })),
    };
  }

  // Stable FNV-1a hash of quantized state for divergence checks / replay tests.
  hash() {
    const q = (x, s) => Math.round(x * s);
    const parts = [this.tick, this.ended ? 1 : 0, this.winner ?? 'n', this.pressureLevel];
    for (const w of this.wizards) {
      parts.push(
        q(w.health, 100), q(w.aether, 100), q(w.charges, 2), q(w.arcPos, 1000),
        w.casting ? w.casting.spellId : 0, w.casting ? w.casting.ticks : 0,
        w.focusing ? 1 : 0, w.braceTicks, w.reflectTicks, w.tenacityTicks,
        w.shield ? q(w.shield.absorb, 100) : 0, w.barrier ? q(w.barrier.absorb, 100) : 0,
        w.sidestepCharges, w.recoveryTicks,
      );
      for (const [k, v] of Object.entries(w.statuses).sort()) parts.push(k, v.stacks, v.ticks);
      for (const [k, v] of Object.entries(w.cooldowns).sort()) if (v > 0) parts.push('cd', k, v);
    }
    for (const p of this.projectiles) parts.push('p', p.owner, p.spellId, p.ticks, q(p.targetPos, 1000));
    const str = parts.join('|');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
}

export { sToTicks };
