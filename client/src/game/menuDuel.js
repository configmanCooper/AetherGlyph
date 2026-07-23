import { Sim } from '../../../shared/src/sim/sim.js';
import { TICK_HZ } from '../../../shared/src/sim/constants.js';
import { SPELL_CATALOG } from '../../../shared/src/balance/spellData.generated.js';
import { makeLoadout } from '../../../shared/src/balance/loadouts.js';
import { PracticeBot } from '../../../shared/src/bot/practiceBot.js';
import { makeRng } from '../../../shared/src/rng/rng.js';
import {
  effectFor, categoryOf, PROJECTILE, CHANNEL, DISPEL, BARRIER,
} from '../../../shared/src/sim/spellEffects.js';

const TICK_MS = 1000 / TICK_HZ;
const MAX_CATCHUP = 6;
const SHOWCASE_COMBOS = [
  [31, 1],  // Oil -> Ember / Flash Fire
  [32, 3],  // Rain -> Spark / Conductive Arc
  [18, 5],  // Mark -> Arcane Missile
  [2, 27],  // Chill -> Frost Bind
  [35, 33], // Fog -> Gust / Cleared Air
  [15, 34], // Stone Wall -> Quake / Rubble
];

export const MENU_PUBLIC_SPELL_IDS = SPELL_CATALOG
  .filter((spell) => !spell.secret)
  .map((spell) => spell.id);
export const MENU_MOVE_DUTY = 0.4;

function activeZone(sim, kind) {
  return sim.zones.some((zone) => zone.kind === kind && zone.ticks > 0);
}

function harmfulStatusCount(wizard) {
  return Object.values(wizard.statuses || {}).filter((status) => status.ticks > 0).length;
}

export class MenuDuel {
  constructor(opts = {}) {
    this.seed = (opts.seed ?? 0xA37E12) >>> 0;
    this.rng = makeRng(this.seed ^ 0xD0E1);
    const loadout = makeLoadout(MENU_PUBLIC_SPELL_IDS);
    this.sim = new Sim({
      seed: this.seed,
      loadouts: [loadout, loadout.map((spell) => ({ ...spell }))],
      rules: {
        timer: false,
        pressure: false,
        sandbox: true,
        sandboxCooldowns: true,
      },
    });
    this.sim.wizards[0].arcPos = 0.72;
    this.sim.wizards[1].arcPos = -0.72;
    this.bots = [
      new PracticeBot(0, {
        difficulty: 'hard', seed: this.seed ^ 0x1111,
        overrides: { flubRate: 0.015, scoreMean: 0.96, scoreSpread: 0.035 },
      }),
      new PracticeBot(1, {
        difficulty: 'hard', seed: this.seed ^ 0x2222,
        overrides: { flubRate: 0.015, scoreMean: 0.96, scoreSpread: 0.035 },
      }),
    ];
    this.acc = 0;
    this.events = [];
    this.active = false;
    this.castCounts = [new Map(), new Map()];
    this.lastCastTick = [new Map(), new Map()];
    this.nextShowcaseCast = [0, 45];
    this.nextGlobalCastTick = 0;
    this.castIntentReserved = false;
    this.castStartTicks = [];
    this.comboQueues = [[], []];
    this.comboIndex = [0, 1];
    this.nextComboTick = [180, 600];
    this.activeComboOwner = null;
    this.reactionCounts = new Map();
    this.arcRanges = [
      { min: this.sim.wizards[0].arcPos, max: this.sim.wizards[0].arcPos },
      { min: this.sim.wizards[1].arcPos, max: this.sim.wizards[1].arcPos },
    ];
  }

  setActive(active) {
    this.active = !!active;
    this.acc = 0;
  }

  get alpha() {
    return Math.max(0, Math.min(1, this.acc / TICK_MS));
  }

  update(dtMs) {
    if (!this.active) return;
    this.acc += Math.max(0, dtMs);
    let steps = 0;
    while (this.acc >= TICK_MS && steps < MAX_CATCHUP) {
      this.acc -= TICK_MS;
      this._step();
      steps++;
    }
  }

  _step() {
    const intents = {};
    this.castIntentReserved = false;
    const first = this.sim.tick % 2;
    for (const id of [first, 1 - first]) {
      const suggested = this.bots[id].act(this.sim);
      intents[id] = this._variedIntent(id, suggested);
      // Title movement is intentionally medium/slow: 2 of every 5 ticks.
      if (intents[id].move && (this.sim.tick + id * 2) % 5 >= 2) intents[id].move = 0;
    }

    const events = this.sim.step(intents);
    for (const event of events) {
      if (event.type === 'cast') {
        const counts = this.castCounts[event.caster];
        counts.set(event.spellId, (counts.get(event.spellId) || 0) + 1);
        this.lastCastTick[event.caster].set(event.spellId, this.sim.tick);
        this.nextShowcaseCast[event.caster] = this.sim.tick + 75;
      }
      if (event.type === 'castStart') this.castStartTicks.push(this.sim.tick);
      if (event.type === 'reaction') {
        this.reactionCounts.set(event.name, (this.reactionCounts.get(event.name) || 0) + 1);
      }
      this.events.push(event);
    }

    // Keep the back wizard left and the player-side wizard right.
    this.sim.wizards[0].arcPos = Math.max(0.28, Math.min(0.92, this.sim.wizards[0].arcPos));
    this.sim.wizards[1].arcPos = Math.max(-0.92, Math.min(-0.28, this.sim.wizards[1].arcPos));
    for (let id = 0; id < 2; id++) {
      this.arcRanges[id].min = Math.min(this.arcRanges[id].min, this.sim.wizards[id].arcPos);
      this.arcRanges[id].max = Math.max(this.arcRanges[id].max, this.sim.wizards[id].arcPos);
    }
  }

  _variedIntent(id, suggested) {
    const wizard = this.sim.wizards[id];
    if (!this.sim.canAct(wizard) || wizard.casting || wizard.channel || wizard.recoveryTicks > 0) {
      return suggested;
    }
    if (this.activeComboOwner != null && this.activeComboOwner !== id) {
      const movementOnly = { ...suggested };
      delete movementOnly.cast;
      delete movementOnly.castQuality;
      delete movementOnly.castReject;
      return movementOnly;
    }
    if (this.castIntentReserved || this.sim.tick < this.nextGlobalCastTick) {
      const movementOnly = { ...suggested };
      delete movementOnly.cast;
      delete movementOnly.castQuality;
      delete movementOnly.castReject;
      return movementOnly;
    }
    this._prepareCombo(id);
    const shouldShowcase = suggested.cast != null || this.sim.tick >= this.nextShowcaseCast[id];
    if (!shouldShowcase) return suggested;

    const selected = this._chooseSpell(id, suggested.cast);
    if (selected == null) {
      if (!this.comboQueues[id].length) return suggested;
      const movementOnly = { ...suggested };
      delete movementOnly.cast;
      delete movementOnly.castQuality;
      delete movementOnly.castReject;
      return movementOnly;
    }
    const base = { ...suggested };
    delete base.cast;
    delete base.castQuality;
    delete base.castReject;
    const committed = this.bots[id]._commitCast(selected, base);
    if (committed.cast != null || committed.castReject != null) {
      this.castIntentReserved = true;
      this.nextGlobalCastTick = this.sim.tick + this.rng.int(2 * TICK_HZ, 3 * TICK_HZ);
      if (committed.cast != null && this.comboQueues[id][0] === selected) {
        this.comboQueues[id].shift();
        if (!this.comboQueues[id].length) this.activeComboOwner = null;
      }
    }
    return committed;
  }

  _prepareCombo(id) {
    const queue = this.comboQueues[id];
    if (!queue.length && this.activeComboOwner == null && this.sim.tick >= this.nextComboTick[id]) {
      const combo = SHOWCASE_COMBOS[this.comboIndex[id] % SHOWCASE_COMBOS.length];
      queue.push(...combo);
      this.activeComboOwner = id;
      this.comboIndex[id] += 1;
      this.nextComboTick[id] = this.sim.tick + 30 * TICK_HZ;
    }
    if (!queue.length) return;
    const payoff = queue[0];
    const setup = ({
      1: [31, 'Oil'],
      3: [32, 'Wet'],
      5: [18, 'Marked'],
      27: [2, 'Chilled'],
      33: [35, 'Fog'],
      34: [15, 'Cover'],
    })[payoff];
    if (!setup) return;
    const opponent = this.sim.opponentOf(id);
    const ready = setup[1] === 'Marked' || setup[1] === 'Chilled'
      ? this.sim.hasStatus(opponent, setup[1])
      : this.sim.zones.some((zone) =>
        zone.kind === setup[1] && zone.owner === id && zone.ticks > 0);
    if (!ready && queue[0] !== setup[0]) queue.unshift(setup[0]);
  }

  _chooseSpell(id, suggestedId) {
    const wizard = this.sim.wizards[id];
    const opponent = this.sim.opponentOf(id);
    const incoming = this.sim.projectiles.some((projectile) => projectile.owner !== id);
    const candidates = wizard.loadout.filter((spell) => {
      const effect = effectFor(spell.id);
      if (!effect || !this.bots[id].canCast(this.sim, wizard, spell)) return false;
      if (wizard.barrier && (effect.type === PROJECTILE || effect.type === CHANNEL)) return false;
      if (spell.id === 27 && !this.sim.hasStatus(opponent, 'Chilled')) return false;
      if (spell.id === 13 && harmfulStatusCount(wizard) === 0
          && !this.sim.zones.some((zone) => zone.owner === opponent.id && zone.ticks > 0)) return false;
      return true;
    });
    if (!candidates.length) return null;
    if (this.comboQueues[id].length) {
      const desired = this.comboQueues[id][0];
      const comboSpell = candidates.find((spell) => spell.id === desired);
      return comboSpell ? comboSpell.id : null;
    }

    let best = candidates[0];
    let bestScore = -Infinity;
    for (const spell of candidates) {
      const effect = effectFor(spell.id);
      const category = categoryOf(effect);
      const uses = this.castCounts[id].get(spell.id) || 0;
      const last = this.lastCastTick[id].get(spell.id) ?? -10000;
      let score = 100 - uses * 60 + Math.min(45, (this.sim.tick - last) * 0.04);
      if (spell.id === suggestedId) score += 20;
      if (category === 'defense') score += incoming ? 55 : -12;
      if (effect.type === DISPEL) score += harmfulStatusCount(wizard) ? 70 : -50;
      if (effect.type === BARRIER && incoming) score += 25;
      if (spell.id === 5 && this.sim.hasStatus(opponent, 'Marked')) score += 80;
      if (spell.id === 18 && !this.sim.hasStatus(opponent, 'Marked')) score += 28;
      if ((spell.id === 7 || spell.id === 30)
          && (this.sim.hasStatus(opponent, 'Soaked') || this.sim.statusStacks(opponent, 'Static') >= 2)) score += 75;
      if (spell.id === 3 && activeZone(this.sim, 'Wet')) score += 42;
      if (spell.id === 1 && activeZone(this.sim, 'Oil')) score += 58;
      if (spell.id === 32 && !activeZone(this.sim, 'Wet')) score += 24;
      if (spell.id === 31 && !activeZone(this.sim, 'Oil')) score += 22;
      if (spell.id === 33 && (activeZone(this.sim, 'Fog') || activeZone(this.sim, 'Oil') || activeZone(this.sim, 'Fire'))) score += 60;
      if (spell.id === 34 && activeZone(this.sim, 'Cover')) score += 65;
      score += this.rng.next() * 0.01;
      if (score > bestScore) {
        best = spell;
        bestScore = score;
      }
    }
    return best.id;
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  castVariety() {
    return new Set([...this.castCounts[0].keys(), ...this.castCounts[1].keys()]);
  }

  stepTicks(ticks) {
    for (let i = 0; i < ticks; i++) this._step();
  }
}
