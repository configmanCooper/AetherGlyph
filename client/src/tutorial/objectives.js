// objectives.js — pure objective predicate registry + a deterministic tracker.
//
// The tutorial runner NEVER duplicates combat logic (SOLO-MODES-PLAN §7). It
// feeds the real Sim's per-tick events (plus read-only state deltas) into an
// ObjectiveTracker, which reduces them into a small `facts` record. Every lesson
// objective names a predicate registered here; a predicate is a pure function of
// (facts, sim, args). Unknown predicate names are rejected by the campaign test
// so an objective can never silently do nothing (§6).
//
// All evaluation is from the PLAYER'S perspective (wizard 0) versus the
// instructor/opponent (wizard 1). Reaction/zone/status credit is attributed to
// the actor, so an idle player cannot passively satisfy an action objective.

import { SPELLS_BY_ID } from '../../../shared/src/balance/spellData.generated.js';
import { TICK_HZ } from '../../../shared/src/sim/constants.js';

const NAME_TO_ID = {};
for (const s of Object.values(SPELLS_BY_ID)) NAME_TO_ID[s.name] = s.id;

// Reasons a Cover zone ended because it was actively destroyed (vs. expiring).
const COVER_DESTROY_REASONS = new Set(['destroyed', 'rubble', 'fractured', 'shattered']);

// ---------------------------------------------------------------------------
// Tracker — reduces sim events + read-only snapshot deltas into durable facts.
// ---------------------------------------------------------------------------
export class ObjectiveTracker {
  constructor(opts = {}) {
    this.playerId = opts.playerId ?? 0;
    this.botId = opts.botId ?? 1;
    this.reset();
  }

  reset() {
    const P = this.playerId, B = this.botId;
    this.facts = {
      tick: 0,
      castsBy: { [P]: new Map(), [B]: new Map() },     // spellId -> count
      rejectedBy: { [P]: 0, [B]: 0 },
      damageDealtToOpp: 0,
      damageTakenBySelf: 0,
      hitsOnOppBySpell: new Map(),                     // spellId -> hit count
      markedHitsOnOppBySpell: new Map(),                     // spellId -> hit count
      statusAppliedToOpp: new Map(),                   // name -> count
      statusAppliedToSelf: new Map(),
      lastStatusTickOnSelf: new Map(),
      reactionsByPlayer: [],                           // ordered names (player-caused)
      reactionsSetPlayer: new Set(),
      reactionsAny: new Set(),
      zonesCreatedByPlayer: [],                        // kinds
      zoneOwnerById: new Map(),                        // zoneId -> owner
      coverDestroyedByPlayer: 0,                       // opp cover destroyed by player
      evadesBySelf: 0,                                 // incoming shots that missed player
      evadesBySpell: new Map(),                        // spellId -> miss count on player
      deflectsBySelf: 0,                               // Gust Wall deflections by player
      deflectsBySpell: new Map(),                      // spellId -> deflect count by player
      sidestepsBySelf: 0,
      blinkBySelf: 0,
      focusCompletesBySelf: 0,
      focusInterruptsOnOpp: 0,
      controlResistedOnOpp: 0,                         // Tenacity blocked player control
      controlResistedOnSelf: 0,
      tenacityEngagedOnOpp: 0,                         // opponent gained Tenacity (after player's freeze)
      dispelRemovedBySelf: [],                         // status names cleansed off self
      wastedDispelBySelf: 0,                           // dispel with nothing to remove
      leechedAether: 0,
      reflectsBySelf: 0,
      decoyAbsorbedForSelf: 0,
      phoenixSavedSelf: 0,
      channelCompletesBySelf: new Map(),               // spellId -> count
      schoolsCastByPlayer: new Set(),
      bracedHit: false,
      blockedDamage: 0,
      minAether: Infinity,
      maxCharges: 0,
      minSidestepCharges: Infinity,
      focusBehindCover: false,
      roundWinner: null,
      roundEnded: false,
      seriesWon: false,     // best-of-three decided in the player's favour
      seriesDecided: false,
    };
    this._prev = null; // previous snapshot slice for delta computation
  }

  _spellSchool(id) { return SPELLS_BY_ID[id]?.school; }

  // Advance the tracker by one simulation step. `events` is the array returned by
  // sim.step(); `sim` is read ONLY (never mutated).
  update(events, sim) {
    const f = this.facts;
    const P = this.playerId, B = this.botId;
    f.tick = sim.tick;

    for (const e of events) {
      switch (e.type) {
        case 'cast': {
          const m = f.castsBy[e.caster];
          if (m) m.set(e.spellId, (m.get(e.spellId) || 0) + 1);
          if (e.caster === P) {
            const sc = this._spellSchool(e.spellId);
            if (sc) f.schoolsCastByPlayer.add(sc);
          }
          break;
        }
        case 'castRejected':
          if (e.caster === P) f.rejectedBy[P] += 1;
          else if (e.caster === B) f.rejectedBy[B] += 1;
          break;
        case 'damage': {
          if (e.target === B) {
            f.damageDealtToOpp += e.amount;
            const id = NAME_TO_ID[e.source];
            if (id != null) {
              f.hitsOnOppBySpell.set(id, (f.hitsOnOppBySpell.get(id) || 0) + 1);
              if (e.markedPayoff) {
                f.markedHitsOnOppBySpell.set(id, (f.markedHitsOnOppBySpell.get(id) || 0) + 1);
              }
            }
          } else if (e.target === P) {
            f.damageTakenBySelf += e.amount;
          }
          break;
        }
        case 'status':
          if (e.target === B) f.statusAppliedToOpp.set(e.status, (f.statusAppliedToOpp.get(e.status) || 0) + 1);
          else if (e.target === P) {
            f.statusAppliedToSelf.set(e.status, (f.statusAppliedToSelf.get(e.status) || 0) + 1);
            f.lastStatusTickOnSelf.set(e.status, sim.tick);
          }
          break;
        case 'reaction':
          f.reactionsAny.add(e.name);
          if (e.casterId === P) { f.reactionsByPlayer.push(e.name); f.reactionsSetPlayer.add(e.name); }
          break;
        case 'zone':
          f.zoneOwnerById.set(e.id, e.owner);
          if (e.owner === P) f.zonesCreatedByPlayer.push(e.kind);
          break;
        case 'zoneEnd': {
          const owner = f.zoneOwnerById.get(e.id);
          if (e.kind === 'Cover' && owner === B && COVER_DESTROY_REASONS.has(e.reason)) {
            f.coverDestroyedByPlayer += 1;
          }
          break;
        }
        case 'miss':
          if (e.target === P) {
            f.evadesBySelf += 1;
            if (e.spellId != null) f.evadesBySpell.set(e.spellId, (f.evadesBySpell.get(e.spellId) || 0) + 1);
          }
          break;
        case 'deflect':
          if (e.by === P) {
            f.deflectsBySelf += 1;
            if (e.spellId != null) f.deflectsBySpell.set(e.spellId, (f.deflectsBySpell.get(e.spellId) || 0) + 1);
          }
          break;
        case 'sidestep':
          if (e.caster === P) f.sidestepsBySelf += 1;
          break;
        case 'blink':
          if (e.caster === P) f.blinkBySelf += 1;
          break;
        case 'focusComplete':
          if (e.caster === P) {
            f.focusCompletesBySelf += 1;
            // Credit "focus behind cover" if the player owns live Cover now.
            if (sim.zones.some((z) => z.kind === 'Cover' && z.owner === P && z.ticks > 0)) {
              f.focusBehindCover = true;
            }
          }
          break;
        case 'focusInterrupt':
          if (e.target === B) f.focusInterruptsOnOpp += 1;
          break;
        case 'controlResisted':
          if (e.target === B) f.controlResistedOnOpp += 1;
          else if (e.target === P) f.controlResistedOnSelf += 1;
          break;
        case 'tenacity':
          if (e.target === B) f.tenacityEngagedOnOpp += 1;
          break;
        case 'dispel':
          if (e.caster === P) {
            if (typeof e.removed === 'string') f.dispelRemovedBySelf.push(e.removed);
            else if (e.removedZone) { /* removed an enemy zone edge: a use, not wasted */ }
            else if (e.removed === null && !e.removedZone) f.wastedDispelBySelf += 1;
          }
          break;
        case 'leech':
          if (e.caster === P) f.leechedAether += e.amount;
          break;
        case 'reflect':
          if (e.by === P) f.reflectsBySelf += 1;
          break;
        case 'decoyHit':
          if (e.target === P) f.decoyAbsorbedForSelf += 1;
          break;
        case 'phoenixSave':
          if (e.target === P) f.phoenixSavedSelf += 1;
          break;
        case 'channelEnd': {
          // The channel that just completed is the one active in the prior tick.
          if (e.caster === P) {
            const id = this._prev ? this._prev.channelId : null;
            if (id != null) f.channelCompletesBySelf.set(id, (f.channelCompletesBySelf.get(id) || 0) + 1);
          }
          break;
        }
        case 'roundEnd':
          f.roundEnded = true;
          f.roundWinner = e.winner;
          break;
        default: break;
      }
    }

    this._readSnapshotDeltas(sim);
  }

  // Read-only per-tick deltas that the sim does not emit as discrete events:
  // shield/barrier absorption (blocked damage), braced hits, resource extremes.
  _readSnapshotDeltas(sim) {
    const f = this.facts;
    const p = sim.wizards[this.playerId];
    if (!p) return;

    // Resource extremes.
    f.minAether = Math.min(f.minAether, p.aether);
    f.maxCharges = Math.max(f.maxCharges, p.charges);
    f.minSidestepCharges = Math.min(f.minSidestepCharges, p.sidestepCharges);

    // Channel completion by spell id (snapshot: channel present last tick, gone now).
    const curChannelId = p.channel ? p.channel.spellId : null;
    // Braced hit: player took damage this tick while Brace was active.
    const tookDamage = f.damageTakenBySelf > (this._prev ? this._prev.damageTaken : 0);
    if (tookDamage && p.braceTicks > 0) f.bracedHit = true;

    // Blocked damage via shield/barrier absorb deltas.
    const curShield = p.shield ? { absorb: p.shield.absorb, ticks: p.shield.ticks } : null;
    const curBarrier = p.barrier ? { absorb: p.barrier.absorb, ticks: p.barrier.ticks } : null;
    if (this._prev) {
      f.blockedDamage += this._absorbDelta(this._prev.shield, curShield);
      f.blockedDamage += this._absorbDelta(this._prev.barrier, curBarrier);
    }

    this._prev = {
      damageTaken: f.damageTakenBySelf,
      shield: curShield,
      barrier: curBarrier,
      channelId: curChannelId,
    };
  }

  // Damage a shield/barrier soaked between two ticks. A drop in `absorb` while the
  // guard is still alive is absorption; a guard vanishing while ticks remained was
  // fully consumed (count the remainder); a guard expiring on its own is not a block.
  _absorbDelta(prev, cur) {
    if (!prev) return 0;
    if (cur) return Math.max(0, prev.absorb - cur.absorb);
    // guard gone this tick
    return prev.ticks > 1 ? prev.absorb : 0;
  }

  // Convenience getters used by predicates.
  castCount(id) { return this.facts.castsBy[this.playerId].get(id) || 0; }
  hitCount(id) { return this.facts.hitsOnOppBySpell.get(id) || 0; }
  statusOnOpp(name) { return this.facts.statusAppliedToOpp.get(name) || 0; }
  statusOnSelf(name) { return this.facts.statusAppliedToSelf.get(name) || 0; }
}

// ---------------------------------------------------------------------------
// Predicate registry — pure (facts, sim, args) => boolean.
// ---------------------------------------------------------------------------
const num = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };

export const OBJECTIVE_PREDICATES = {
  // Player cast a spell (by id) at least N times.
  'cast-spell': (ctx, [id, n]) => (ctx.facts.castsBy[ctx.playerId].get(Number(id)) || 0) >= num(n, 1),
  // Player landed (dealt damage with) a specific spell N times.
  'land-spell': (ctx, [id, n]) => (ctx.facts.hitsOnOppBySpell.get(Number(id)) || 0) >= num(n, 1),
  // Player landed a specific spell while consuming Mark's damage payoff.
  'land-marked-spell': (ctx, [id, n]) =>
    (ctx.facts.markedHitsOnOppBySpell.get(Number(id)) || 0) >= num(n, 1),
  // Total direct damage dealt to the opponent.
  'damage-opponent': (ctx, [n]) => ctx.facts.damageDealtToOpp >= num(n, 1),
  // A harmful/other status was applied to the opponent N times.
  'apply-status': (ctx, [name, n]) => (ctx.facts.statusAppliedToOpp.get(name) || 0) >= num(n, 1),
  // The player gained a self status (e.g. Grounded, Haste, Phoenix).
  'self-status': (ctx, [name, n]) => (ctx.facts.statusAppliedToSelf.get(name) || 0) >= num(n, 1),
  // A named environmental reaction the player caused.
  'reaction': (ctx, [name, scope]) =>
    scope === 'any' ? ctx.facts.reactionsAny.has(name) : ctx.facts.reactionsSetPlayer.has(name),
  // N distinct player-caused reactions.
  'reactions-distinct': (ctx, [n]) => ctx.facts.reactionsSetPlayer.size >= num(n, 1),
  // Player created a zone of a given kind.
  'create-zone': (ctx, [kind, n]) =>
    ctx.facts.zonesCreatedByPlayer.filter((k) => k === kind).length >= num(n, 1),
  // Player evaded N incoming projectiles.
  'evade': (ctx, [n]) => ctx.facts.evadesBySelf >= num(n, 1),
  // Player evaded a specific spell N times.
  'evade-spell': (ctx, [id, n]) => (ctx.facts.evadesBySpell.get(Number(id)) || 0) >= num(n, 1),
  // Player deflected a light projectile with Gust Wall N times.
  'deflect': (ctx, [n]) => ctx.facts.deflectsBySelf >= num(n, 1),
  // Player deflected a specific light spell N times.
  'deflect-spell': (ctx, [id, n]) => (ctx.facts.deflectsBySpell.get(Number(id)) || 0) >= num(n, 1),
  // Player used Sidestep N times.
  'sidestep': (ctx, [n]) => ctx.facts.sidestepsBySelf >= num(n, 1),
  // Player used Blink.
  'blink': (ctx) => ctx.facts.blinkBySelf >= 1,
  // Player completed a Focus (gained a Sigil Charge) at least N times.
  'focus-charge': (ctx, [n]) => ctx.facts.focusCompletesBySelf >= num(n, 1),
  // Player interrupted the instructor's Focus.
  'interrupt-focus': (ctx) => ctx.facts.focusInterruptsOnOpp >= 1,
  // The player's hard control was resisted by Tenacity (observing the chain limit).
  'tenacity-block': (ctx) => ctx.facts.controlResistedOnOpp >= 1,
  // The opponent gained Tenacity after the player's freeze wore off (the chain limit).
  'tenacity-engaged': (ctx) => ctx.facts.tenacityEngagedOnOpp >= 1,
  // Player cleansed a specific status off themselves with Dispel.
  'cleanse': (ctx, [name]) => ctx.facts.dispelRemovedBySelf.includes(name),
  // Constraint: player never wasted a Dispel with nothing to remove.
  'no-wasted-dispel': (ctx) => ctx.facts.wastedDispelBySelf === 0,
  // Player braced an incoming bolt (took a reduced hit while Bracing).
  'brace-bolt': (ctx) => ctx.facts.bracedHit === true,
  // Player blocked at least N damage with a shield/barrier.
  'block-damage': (ctx, [n]) => ctx.facts.blockedDamage >= num(n, 1),
  // Constraint: the player's Aether never dropped below N (do not overspend).
  'aether-min': (ctx, [n]) => ctx.facts.minAether >= num(n, 0),
  // Player completed a Focus while owning cover.
  'focus-behind-cover': (ctx) => ctx.facts.focusBehindCover === true,
  // Player destroyed the instructor's cover.
  'destroy-cover': (ctx) => ctx.facts.coverDestroyedByPlayer >= 1,
  // Player cast from at least N distinct schools this round.
  'schools-cast': (ctx, [n]) => ctx.facts.schoolsCastByPlayer.size >= num(n, 1),
  // Player leeched at least N Aether.
  'leech-aether': (ctx, [n]) => ctx.facts.leechedAether >= num(n, 1),
  // A decoy (Mirror Twin) absorbed a shot meant for the player.
  'decoy-absorb': (ctx) => ctx.facts.decoyAbsorbedForSelf >= 1,
  // Player survived a lethal hit via Phoenix Covenant.
  'phoenix-survive': (ctx) => ctx.facts.phoenixSavedSelf >= 1,
  // Player completed a channel (e.g. Prismatic Beam) of a given spell id.
  'channel-complete': (ctx, [id]) => (ctx.facts.channelCompletesBySelf.get(Number(id)) || 0) >= 1,
  // Player reflected a projectile.
  'reflect': (ctx) => ctx.facts.reflectsBySelf >= 1,
  // Player won the round (formal duel / exam).
  'win-round': (ctx) => ctx.facts.roundEnded && ctx.facts.roundWinner === ctx.playerId,
  // Player won a best-of-three series (set by the runner when the series decides).
  'win-series': (ctx) => ctx.facts.seriesWon === true,

  // --- medal / mastery constraints (optional; never gate ranked) ---
  // The player never suffered a given status (e.g. conduct without being Soaked).
  'no-self-status': (ctx, [name]) => (ctx.facts.statusAppliedToSelf.get(name) || 0) === 0,
  // Maintain a continuous streak without receiving a named status.
  'status-free-streak': (ctx, [name, seconds]) => {
    const last = ctx.facts.lastStatusTickOnSelf.get(name) ?? 0;
    return ctx.facts.tick - last >= num(seconds, 1) * TICK_HZ;
  },
  // The player finished without emptying both Sidestep charges.
  'sidestep-charges-kept': (ctx) => ctx.facts.minSidestepCharges >= 1,
  // The player took no damage all round (flawless).
  'took-no-damage': (ctx) => ctx.facts.damageTakenBySelf <= 0.001,
};

export function parsePredicate(predicate) {
  const str = String(predicate || '');
  const parts = str.split(':');
  return { name: parts[0], args: parts.slice(1) };
}

export function isPredicateRegistered(predicate) {
  const { name } = parsePredicate(predicate);
  return Object.prototype.hasOwnProperty.call(OBJECTIVE_PREDICATES, name);
}

export function registeredPredicateNames() {
  return Object.keys(OBJECTIVE_PREDICATES);
}

// Evaluate a predicate string against a tracker + sim. Throws if unregistered so
// content bugs surface loudly (the campaign test guards this at authoring time).
export function evaluatePredicate(predicate, tracker, sim) {
  const { name, args } = parsePredicate(predicate);
  const fn = OBJECTIVE_PREDICATES[name];
  if (!fn) throw new Error(`Unregistered objective predicate: ${predicate}`);
  const ctx = { facts: tracker.facts, sim, playerId: tracker.playerId, botId: tracker.botId };
  return !!fn(ctx, args);
}
