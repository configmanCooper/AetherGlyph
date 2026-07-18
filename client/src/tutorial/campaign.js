// campaign.js — declarative solo tutorial campaign (SOLO-MODES-PLAN §6, §9-11).
//
// This replaces the three-item tutorial stub with fully data-driven content: a
// Prologue, twelve core Lessons, four Academy lessons, a final-exam scaffold,
// public-spell drills, and four secret trials. Every lesson names:
//   - the real teaching loadouts (player + instructor),
//   - the taught / drilled spell ids (machine-checked to cover roster 1-40),
//   - objective predicates from ../tutorial/objectives.js (all registered),
//   - the scripted instructor (ScriptBot) or the fair DuelBot for formal duels,
//   - an optional mastery medal predicate and secret clues,
//   - a deterministic headless "solution" (the intended student) so a test can
//     prove every lesson is completable by real actions and never self-completes.
//
// The tutorial is ALWAYS offline and single-player. The runner drives the real
// Sim with the production recognizer; nothing here connects to a network.

import { canWizardCast } from './scriptBot.js';
import { DuelBot } from '../../../shared/src/bot/bot.js';
import { PRESETS_BY_KEY } from '../../../shared/src/balance/loadouts.js';

// --- solution helpers ------------------------------------------------------
const pc = (sim, id) => canWizardCast(sim, 0, id);                 // player can legally cast
const playerZone = (sim, kind) => sim.zones.some((z) => z.kind === kind && z.owner === 0 && z.ticks > 0);
const enemyZone = (sim, kind) => sim.zones.some((z) => z.kind === kind && z.owner === 1 && z.ticks > 0);
const enemyProj = (sim, pred) => sim.projectiles.find((p) => p.owner === 1 && pred(p));
const IDLE = { move: 0 };

// Reliable last-instant dodge: a single Sidestep toward centre when an incoming
// shot is about to land clears every projectile's dodge radius (even a homing
// bolt or one slowed by an Hourglass Field) and keeps the player off the arc
// boundary across repeated shots. A freshness gate prevents a second sidestep on
// the same shot (which would oscillate back and re-collide).
function dodgeIntent(sim, K = 1) {
  const P = sim.wizards[0];
  if (P.sidestepTimers.some((t) => t > 147)) return IDLE; // just sidestepped
  const threat = enemyProj(sim, (p) => p.ticks <= K);
  if (threat && P.sidestepCharges > 0) return { sidestep: P.arcPos >= 0 ? -1 : 1 }; // toward centre
  return IDLE;
}

// --- the campaign ----------------------------------------------------------
// order is the linear teaching order. `optional:true` lessons (academies, exam,
// trials) never gate ranked readiness (§9, §24). `formal:true` lessons use the
// full legal rules + timer + Arcane Pressure and the current fair DuelBot.

export const CAMPAIGN = [
  {
    id: 'PROLOGUE', chapter: 'prologue', title: 'The Ink Awakens', order: 0,
    narration: [
      'Hold on the draw pad and follow the glowing path to shape a glyph.',
      'Release to submit. A two-finger tap breaks a trace with no cost.',
      'Land three Ember Bolts. The guide fades each time — the last cast has none.',
    ],
    calibrate: true,
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [1], opponentLoadout: [1],
    taughtSpells: [{ id: 1, enterStage: 0, exitStage: 3 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'idle' } },
    objectives: [
      { id: 'bolt1', text: 'Land your first Ember Bolt', predicate: 'land-spell:1:1', expectSpell: 1 },
      { id: 'bolt2', text: 'Land a second Ember Bolt (dotted guide)', predicate: 'land-spell:1:2', expectSpell: 1 },
      { id: 'bolt3', text: 'Land a third Ember Bolt with no guide', predicate: 'land-spell:1:3', expectSpell: 1 },
    ],
    remediation: ['regress-guide', 'show-ghost'],
    maxTicks: 1200,
    solution: (sim, t) => {
      if (t.facts.hitsOnOppBySpell.get(1) >= 3) return IDLE;
      return pc(sim, 1) ? { move: 0, cast: 1, castQuality: 1 } : IDLE;
    },
  },

  {
    id: 'L01', chapter: 'core', title: 'Aether Breath', order: 1,
    narration: [
      'Aether powers every cast and regenerates over time.',
      'Overspending leaves you defenceless. Keep a reserve.',
      'Damage the target, keep at least 20 Aether, and Brace the telegraphed bolt.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [1], opponentLoadout: [1],
    taughtSpells: [{ id: 1, enterStage: 1, exitStage: 3 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 1, startTick: 150, periodTicks: 150 } },
    objectives: [
      { id: 'hit', text: 'Damage the instructor', predicate: 'damage-opponent:1' },
      { id: 'reserve', text: 'Never drop below 20 Aether', predicate: 'aether-min:20' },
      { id: 'brace', text: 'Brace a telegraphed bolt', predicate: 'brace-bolt' },
    ],
    remediation: ['slow-script', 'show-ghost'],
    maxTicks: 1600,
    solution: (sim, t) => {
      if (t.facts.damageDealtToOpp <= 0) return pc(sim, 1) ? { cast: 1, castQuality: 1 } : IDLE;
      if (!t.facts.bracedHit) {
        const threat = enemyProj(sim, (p) => p.ticks <= 12);
        if (threat) return { brace: true };
      }
      return IDLE;
    },
  },

  {
    id: 'L02', chapter: 'core', title: 'The Moving Line', order: 2,
    narration: [
      'Your left thumb strafes along a shallow arc; Sidestep is a quick burst.',
      'Projectiles travel — move and you can slip an aimed shot.',
      'Evade two bolts, then land Stone Shard through the opening.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [4], opponentLoadout: [1],
    taughtSpells: [{ id: 4, enterStage: 0, exitStage: 2 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 1, startTick: 60, periodTicks: 90 } },
    objectives: [
      { id: 'evade', text: 'Evade two bolts by moving', predicate: 'evade:2' },
      { id: 'land', text: 'Land Stone Shard', predicate: 'land-spell:4' },
    ],
    medal: { id: 'L02-nimble', text: 'Keep a Sidestep charge in reserve', predicate: 'sidestep-charges-kept' },
    clues: ['hourglassMovement'],
    remediation: ['slow-script'],
    maxTicks: 1600,
    solution: (sim, t) => {
      if (t.facts.evadesBySelf < 2) return dodgeIntent(sim);
      if (t.facts.hitsOnOppBySpell.get(4) >= 1) return IDLE;
      return pc(sim, 4) ? { move: 0, cast: 4, castQuality: 1 } : IDLE;
    },
  },

  {
    id: 'L03', chapter: 'core', title: 'Wards and Angles', order: 3,
    narration: [
      'A Ward is a frontal shield — precious, but only when it faces the threat.',
      'Raise it against direct fire, then answer with Flame Wave.',
      'Block 20 damage, then land Flame Wave.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [10, 6], opponentLoadout: [1],
    taughtSpells: [{ id: 10, enterStage: 0, exitStage: 2 }, { id: 6, enterStage: 0, exitStage: 2 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 1, startTick: 30, periodTicks: 60 } },
    objectives: [
      { id: 'block', text: 'Block 20 damage with a Ward', predicate: 'block-damage:20', expectSpell: 10 },
      { id: 'wave', text: 'Land Flame Wave', predicate: 'land-spell:6', expectSpell: 6 },
    ],
    remediation: ['slow-script'],
    maxTicks: 2400,
    solution: (sim, t) => {
      const p = sim.wizards[0];
      if (t.facts.blockedDamage < 20) {
        if (!p.shield && pc(sim, 10)) return { cast: 10, castQuality: 1 };
        return IDLE;
      }
      if (t.facts.hitsOnOppBySpell.get(6) >= 1) return IDLE;
      return pc(sim, 6) ? { cast: 6, castQuality: 1 } : IDLE;
    },
  },

  {
    id: 'L04', chapter: 'core', title: 'Clean Hands', order: 4,
    narration: [
      'Statuses matter: Burning ticks damage, Chilled slows.',
      'Dispel removes harmful statuses — but wasting it on plain damage is a loss.',
      'Chill the instructor, cleanse your Burning, and never waste Dispel.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [2, 13], opponentLoadout: [1],
    taughtSpells: [{ id: 2, enterStage: 0, exitStage: 2 }, { id: 13, enterStage: 0, exitStage: 2 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 1, startTick: 90, periodTicks: 150 } },
    objectives: [
      { id: 'chill', text: 'Chill the instructor', predicate: 'apply-status:Chilled', expectSpell: 2 },
      { id: 'cleanse', text: 'Cleanse your Burning', predicate: 'cleanse:Burning', expectSpell: 13 },
      { id: 'clean', text: 'Never waste Dispel on plain damage', predicate: 'no-wasted-dispel' },
    ],
    remediation: ['slow-script'],
    maxTicks: 2000,
    solution: (sim, t) => {
      const p = sim.wizards[0];
      if (t.statusOnOpp('Chilled') < 1) return pc(sim, 2) ? { cast: 2, castQuality: 1 } : IDLE;
      if (sim.hasStatus(p, 'Burning') && pc(sim, 13)) return { cast: 13, castQuality: 1 };
      return IDLE;
    },
  },

  {
    id: 'L05', chapter: 'core', title: 'Focus Under Fire', order: 5,
    narration: [
      'Focus channels a Sigil Charge, but leaves you open — and it can be interrupted.',
      'Gain a charge in a safe window, then punish the instructor\'s Focus.',
      'Complete one Focus, then interrupt theirs with Concussive Blast.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [28], opponentLoadout: [1],
    taughtSpells: [{ id: 28, enterStage: 0, exitStage: 2 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'focus-loop', startTick: 120 } },
    objectives: [
      { id: 'charge', text: 'Gain a Sigil Charge with Focus', predicate: 'focus-charge' },
      { id: 'interrupt', text: 'Interrupt the instructor\'s Focus', predicate: 'interrupt-focus', expectSpell: 28 },
    ],
    remediation: ['slow-script'],
    maxTicks: 2000,
    solution: (sim, t) => {
      if (t.facts.focusCompletesBySelf < 1) return { focus: true };
      const bot = sim.wizards[1];
      if (bot.focusing && pc(sim, 28)) return { cast: 28, castQuality: 1 };
      return IDLE;
    },
  },

  {
    id: 'L06', chapter: 'core', title: 'Mark and Release', order: 6,
    narration: [
      'Setups pay off later: Amplify Marks the target for a bigger hit.',
      'Do not spend the payoff into a raised defence — wait for the window.',
      'Mark the instructor, wait out their Barrier, then land Arcane Missile.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [18, 5], opponentLoadout: [11],
    taughtSpells: [{ id: 18, enterStage: 0, exitStage: 2 }, { id: 5, enterStage: 0, exitStage: 2 }],
    drills: [22],
    arena: { playerCharges: 1 },
    opponent: { type: 'script', config: { behavior: 'on-mark-defend', defendId: 11, triggerStatus: 'Marked' } },
    objectives: [
      { id: 'mark', text: 'Mark the instructor with Amplify', predicate: 'apply-status:Marked', expectSpell: 18 },
      { id: 'payoff', text: 'Land Arcane Missile after the defence drops', predicate: 'land-spell:5', expectSpell: 5 },
    ],
    remediation: ['slow-script'],
    maxTicks: 2400,
    solution: (sim, t) => {
      const bot = sim.wizards[1];
      if (t.statusOnOpp('Marked') < 1) return pc(sim, 18) ? { cast: 18, castQuality: 1 } : IDLE;
      if (bot.barrier && bot.barrier.ticks > 0) return IDLE; // wait out the defence
      if (t.facts.hitsOnOppBySpell.get(5) >= 1) return IDLE;
      return pc(sim, 5) ? { cast: 5, castQuality: 1 } : IDLE;
    },
  },

  {
    id: 'L07', chapter: 'core', title: 'Rain Conducts', order: 7,
    narration: [
      'Weather is shared. Rain creates a Wet zone either wizard can exploit.',
      'Lightning conducts through Wet ground — and the instructor can answer.',
      'Make it rain, shock them in the Wet, then escape the return lightning.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [32, 3], opponentLoadout: [3],
    taughtSpells: [{ id: 32, enterStage: 0, exitStage: 2 }, { id: 3, enterStage: 0, exitStage: 2 }],
    drills: [7, 30],
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 3, startTick: 240, periodTicks: 90 } },
    objectives: [
      { id: 'wet', text: 'Create a Wet zone', predicate: 'create-zone:Wet', expectSpell: 32 },
      { id: 'conduct', text: 'Trigger Conductive Arc', predicate: 'reaction:ConductiveArc', expectSpell: 3 },
      { id: 'escape', text: 'Evade the return lightning', predicate: 'evade:1' },
    ],
    medal: { id: 'L07-dry', text: 'Conduct without being Soaked', predicate: 'no-self-status:Soaked' },
    remediation: ['slow-script'],
    maxTicks: 2400,
    solution: (sim, t) => {
      if (!t.facts.zonesCreatedByPlayer.includes('Wet')) return pc(sim, 32) ? { cast: 32, castQuality: 1 } : IDLE;
      if (!t.facts.reactionsSetPlayer.has('ConductiveArc')) return pc(sim, 3) ? { cast: 3, castQuality: 1 } : IDLE;
      return dodgeIntent(sim); // evade the return lightning
    },
  },

  {
    id: 'L08', chapter: 'core', title: 'Fire Changes the Ground', order: 8,
    narration: [
      'Oil is slick and flammable. Ember ignites it for a capped burst.',
      'Rain washes Oil away before it can catch. You may own only two zones.',
      'Wash one Oil slick with Rain, then ignite another with Ember.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [31, 32, 1], opponentLoadout: [1],
    taughtSpells: [{ id: 31, enterStage: 0, exitStage: 2 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'idle' } },
    objectives: [
      { id: 'wash', text: 'Wash an Oil slick with Rain', predicate: 'reaction:WashedGround' },
      { id: 'ignite', text: 'Ignite an Oil slick with Ember', predicate: 'reaction:FlashFire' },
    ],
    clues: ['phoenixOil'],
    remediation: ['slow-script'],
    maxTicks: 3000,
    solution: (sim, t) => {
      const washed = t.facts.reactionsSetPlayer.has('WashedGround');
      const flashed = t.facts.reactionsSetPlayer.has('FlashFire');
      if (!washed) {
        if (!playerZone(sim, 'Oil') && pc(sim, 31)) return { cast: 31, castQuality: 1 };
        if (playerZone(sim, 'Oil') && pc(sim, 32)) return { cast: 32, castQuality: 1 };
        return IDLE;
      }
      if (!flashed) {
        if (!playerZone(sim, 'Oil') && pc(sim, 31)) return { cast: 31, castQuality: 1 };
        if (playerZone(sim, 'Oil') && pc(sim, 1)) return { cast: 1, castQuality: 1 };
        return IDLE;
      }
      return IDLE;
    },
  },

  {
    id: 'L09', chapter: 'core', title: 'The Cold Lock', order: 9,
    narration: [
      'Frost Bind only freezes a Chilled target — set it up with Frost Lance.',
      'Hard control cannot chain: it grants Tenacity when it ends. Blink clear.',
      'Land one legal Freeze, Blink away, and watch Tenacity engage.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [2, 27, 14], opponentLoadout: [1],
    taughtSpells: [{ id: 27, enterStage: 0, exitStage: 2 }, { id: 14, enterStage: 0, exitStage: 2 }],
    drills: [9, 26],
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 1, startTick: 30, periodTicks: 200 } },
    objectives: [
      { id: 'freeze', text: 'Freeze a Chilled instructor', predicate: 'apply-status:Frozen' },
      { id: 'blink', text: 'Blink away from the follow-up', predicate: 'blink', expectSpell: 14 },
      { id: 'tenacity', text: 'Watch Tenacity engage', predicate: 'tenacity-engaged' },
    ],
    remediation: ['slow-script'],
    maxTicks: 2400,
    solution: (sim, t) => {
      const bot = sim.wizards[1];
      if (t.statusOnOpp('Frozen') < 1) {
        if (!sim.hasStatus(bot, 'Chilled') && pc(sim, 2)) return { cast: 2, castQuality: 1 };
        if (sim.hasStatus(bot, 'Chilled') && pc(sim, 27)) return { cast: 27, castQuality: 1 };
        return IDLE;
      }
      if (t.facts.blinkBySelf < 1) return pc(sim, 14) ? { cast: 14, castQuality: 1 } : IDLE;
      return IDLE; // Tenacity engages automatically when the Freeze wears off
    },
  },

  {
    id: 'L10', chapter: 'core', title: 'Wind Answers', order: 10,
    narration: [
      'Gust clears Fog and shifts Oil, but heavy attacks blow right through it.',
      'Visual effects never change how your glyph is read.',
      'Clear the Fog with Gust, then dodge a heavy Stone Shard.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [35, 33], opponentLoadout: [4],
    taughtSpells: [{ id: 33, enterStage: 0, exitStage: 2 }, { id: 35, enterStage: 0, exitStage: 2 }],
    drills: [25, 29],
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 4, startTick: 200, periodTicks: 150 } },
    objectives: [
      { id: 'clear', text: 'Clear the Fog with Gust', predicate: 'reaction:ClearedAir' },
      { id: 'dodge', text: 'Dodge a heavy Stone Shard', predicate: 'evade-spell:4' },
    ],
    remediation: ['slow-script'],
    maxTicks: 2400,
    solution: (sim, t) => {
      if (!t.facts.reactionsSetPlayer.has('ClearedAir')) {
        if (!playerZone(sim, 'Fog') && pc(sim, 35)) return { cast: 35, castQuality: 1 };
        if (playerZone(sim, 'Fog') && pc(sim, 33)) return { cast: 33, castQuality: 1 };
        return IDLE;
      }
      if ((t.facts.evadesBySpell.get(4) || 0) < 1) return dodgeIntent(sim);
      return IDLE;
    },
  },

  {
    id: 'L11', chapter: 'core', title: 'Cover and Ruin', order: 11,
    narration: [
      'Stone Wall breaks line of sight — Focus safely behind it.',
      'But cover is destructible: Quake and Fireball tear it down mid-channel.',
      'Focus behind your wall, then shatter the instructor\'s cover with Quake.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [15, 34], opponentLoadout: [15],
    taughtSpells: [{ id: 15, enterStage: 0, exitStage: 2 }, { id: 34, enterStage: 0, exitStage: 2 }],
    drills: [8, 36],
    opponent: { type: 'script', config: { behavior: 'wall-focus', wallId: 15, startTick: 240 } },
    objectives: [
      { id: 'cover', text: 'Focus safely behind cover', predicate: 'focus-behind-cover' },
      { id: 'ruin', text: 'Destroy the instructor\'s cover', predicate: 'destroy-cover', expectSpell: 34 },
    ],
    remediation: ['slow-script'],
    maxTicks: 2600,
    solution: (sim, t) => {
      if (!t.facts.focusBehindCover) {
        if (!playerZone(sim, 'Cover') && pc(sim, 15)) return { cast: 15, castQuality: 1 };
        if (playerZone(sim, 'Cover')) return { focus: true };
        return IDLE;
      }
      if (t.facts.coverDestroyedByPlayer < 1) {
        if (enemyZone(sim, 'Cover') && pc(sim, 34)) return { cast: 34, castQuality: 1 };
        return IDLE;
      }
      return IDLE;
    },
  },

  {
    id: 'L12', chapter: 'core', title: 'First Formal Duel', order: 12,
    narration: [
      'Build a legal loadout: eight spells, fourteen points, school and heavy limits.',
      'A full round adds the timer and Arcane Pressure. Win it fairly.',
      'Defeat the fair Apprentice instructor in one legal round.',
    ],
    formal: true,
    timerEnabled: true, pressureEnabled: true,
    loadoutRule: 'legal',
    playerLoadout: PRESETS_BY_KEY['ember-rush'].ids.slice(),
    opponentLoadout: PRESETS_BY_KEY['tide-control'].ids.slice(),
    taughtSpells: [],
    drills: [],
    opponent: { type: 'duel', difficulty: 'apprentice' },
    objectives: [
      { id: 'win', text: 'Win a legal round against the Apprentice', predicate: 'win-round' },
    ],
    reward: { rankedReady: true },
    remediation: ['retry'],
    solutionBot: 'archmage',
    maxTicks: 6600,
  },

  {
    id: 'A13', chapter: 'academy', title: 'Resource War', order: 13,
    optional: true,
    narration: [
      'Economy wins attrition — but only when it is safe to invest.',
      'Grounding trades movement for protection against Storm.',
      'Surge your Aether, take Grounding, and Weaken the instructor.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [17, 24, 21, 16, 20, 23], opponentLoadout: [3],
    taughtSpells: [{ id: 17, enterStage: 0, exitStage: 2 }, { id: 24, enterStage: 0, exitStage: 2 },
      { id: 21, enterStage: 0, exitStage: 2 }, { id: 16, enterStage: 0, exitStage: 2 },
      { id: 20, enterStage: 0, exitStage: 2 }, { id: 23, enterStage: 0, exitStage: 2 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'idle' } },
    objectives: [
      { id: 'surge', text: 'Channel Aether Surge', predicate: 'self-status:AetherSurge' },
      { id: 'ground', text: 'Take Grounding Mantle', predicate: 'self-status:Grounded' },
      { id: 'weaken', text: 'Weaken the instructor', predicate: 'apply-status:Weakened' },
    ],
    clues: ['mirrorEight'],
    remediation: ['slow-script'],
    maxTicks: 2600,
    solution: (sim, t) => {
      if ((t.facts.statusAppliedToSelf.get('AetherSurge') || 0) < 1) return pc(sim, 17) ? { cast: 17, castQuality: 1 } : IDLE;
      if ((t.facts.statusAppliedToSelf.get('Grounded') || 0) < 1) return pc(sim, 20) ? { cast: 20, castQuality: 1 } : IDLE;
      if (t.statusOnOpp('Weakened') < 1) return pc(sim, 21) ? { cast: 21, castQuality: 1 } : IDLE;
      return IDLE;
    },
  },

  {
    id: 'A14', chapter: 'academy', title: 'Reading Resonance', order: 14,
    optional: true,
    narration: [
      'Repeated same-school casts build resonance and discounts.',
      'Switching schools deliberately triggers shared reactions.',
      'Attune to Ember, cast across three schools, and trigger two reactions.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [19, 32, 3, 31, 1], opponentLoadout: [1],
    taughtSpells: [{ id: 19, enterStage: 0, exitStage: 2 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'idle' } },
    objectives: [
      { id: 'attune', text: 'Attune to Ember', predicate: 'self-status:Attunement' },
      { id: 'schools', text: 'Cast from three schools', predicate: 'schools-cast:3' },
      { id: 'reactions', text: 'Trigger two reactions', predicate: 'reactions-distinct:2' },
    ],
    clues: ['prismaticReactions'],
    remediation: ['slow-script'],
    maxTicks: 3000,
    solution: (sim, t) => {
      if ((t.facts.statusAppliedToSelf.get('Attunement') || 0) < 1) return pc(sim, 19) ? { cast: 19, castQuality: 1 } : IDLE;
      if (!t.facts.reactionsSetPlayer.has('ConductiveArc')) {
        if (!playerZone(sim, 'Wet') && pc(sim, 32)) return { cast: 32, castQuality: 1 };
        if (playerZone(sim, 'Wet') && pc(sim, 3)) return { cast: 3, castQuality: 1 };
        return IDLE;
      }
      if (!t.facts.reactionsSetPlayer.has('FlashFire')) {
        if (!playerZone(sim, 'Oil') && pc(sim, 31)) return { cast: 31, castQuality: 1 };
        if (playerZone(sim, 'Oil') && pc(sim, 1)) return { cast: 1, castQuality: 1 };
        return IDLE;
      }
      return IDLE;
    },
  },

  {
    id: 'A15', chapter: 'academy', title: 'Reflection Trial', order: 15,
    optional: true,
    narration: [
      'Reflect bounces a light projectile — but not a Fireball. That is the trap.',
      'When you cannot reflect, block with a Barrier or move instead.',
      'Reflect the missile, then survive the Fireball behind a Barrier.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [12, 11, 5], opponentLoadout: [5, 8],
    taughtSpells: [{ id: 12, enterStage: 0, exitStage: 2 }, { id: 11, enterStage: 0, exitStage: 2 }],
    drills: [],
    arena: { botCharges: 1 },
    opponent: { type: 'script', config: { behavior: 'sequence', steps: [{ tick: 120, cast: 5 }, { tick: 330, cast: 8 }] } },
    objectives: [
      { id: 'reflect', text: 'Reflect the Arcane Missile', predicate: 'reflect' },
      { id: 'survive', text: 'Survive the Fireball behind a Barrier', predicate: 'block-damage:20' },
    ],
    remediation: ['slow-script'],
    maxTicks: 3000,
    solution: (sim, t) => {
      const p = sim.wizards[0];
      const bot = sim.wizards[1];
      if (t.facts.reflectsBySelf < 1) {
        const missile = enemyProj(sim, (pr) => pr.eff.reflectable);
        if (missile && p.reflectTicks <= 0 && pc(sim, 12)) return { cast: 12, castQuality: 1 };
        return IDLE;
      }
      if (t.facts.blockedDamage < 20) {
        const fireballWindup = bot.casting && bot.casting.spellId === 8;
        const heavyIncoming = enemyProj(sim, (pr) => !pr.eff.reflectable && pr.eff.damage >= 20);
        if ((fireballWindup || heavyIncoming) && !p.barrier && pc(sim, 11)) return { cast: 11, castQuality: 1 };
        return IDLE;
      }
      return IDLE;
    },
  },

  {
    id: 'A16', chapter: 'academy', title: 'The Eight Schools Examination', order: 16,
    optional: true, formal: true,
    narration: [
      'Adapt across schools against a sharper opponent.',
      'Win a legal round against the Adept instructor.',
    ],
    timerEnabled: true, pressureEnabled: true,
    loadoutRule: 'legal',
    playerLoadout: PRESETS_BY_KEY['storm-tempo'].ids.slice(),
    opponentLoadout: PRESETS_BY_KEY['stone-warden'].ids.slice(),
    taughtSpells: [],
    drills: [],
    opponent: { type: 'duel', difficulty: 'adept' },
    objectives: [
      { id: 'win', text: 'Win a legal round against the Adept', predicate: 'win-round' },
    ],
    remediation: ['retry'],
    solutionBot: 'archmage',
    maxTicks: 6600,
  },

  {
    id: 'EXAM', chapter: 'exam', title: 'Final Examination', order: 17,
    optional: true, formal: true,
    narration: [
      'The final examination: prove your mastery in a full legal duel.',
      'A best-of-three and gesture gauntlet expand this scaffold in a later phase.',
      'Defeat the Magus examiner in one legal round.',
    ],
    timerEnabled: true, pressureEnabled: true,
    loadoutRule: 'legal',
    playerLoadout: PRESETS_BY_KEY['arcane-combo'].ids.slice(),
    opponentLoadout: PRESETS_BY_KEY['gale-trickster'].ids.slice(),
    taughtSpells: [],
    drills: [],
    // Scaffolded structure for later expansion (SOLO-MODES-PLAN §9 Final Exam).
    stages: [
      { id: 'gauntlet', kind: 'gesture-gauntlet', note: 'draw 10 of 12 with no templates' },
      { id: 'scenarios', kind: 'tactical', note: 'pass 4 of 5 tactical scenarios' },
      { id: 'duel', kind: 'best-of-three', note: 'best-of-three vs Medium' },
      { id: 'grandmaster', kind: 'optional', note: 'optional retry vs Hard' },
    ],
    opponent: { type: 'duel', difficulty: 'magus' },
    objectives: [
      { id: 'win', text: 'Win a legal round against the Magus examiner', predicate: 'win-round' },
    ],
    remediation: ['retry'],
    solutionBot: 'archmage',
    maxTicks: 6600,
  },

  // --- secret trials (optional; cover roster 37-40) -------------------------
  {
    id: 'T37', chapter: 'secret', title: 'Mirror Twin', order: 100,
    optional: true, secret: 37,
    narration: [
      'Two hands write one intention. A decoy matches your next windup.',
      'Draw Mirror Twin, then let the decoy absorb the intended shot.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [37], opponentLoadout: [1],
    taughtSpells: [],
    drills: [],
    trialSpell: 37,
    arena: { playerCharges: 2 },
    opponent: { type: 'script', config: { behavior: 'sequence', steps: [{ tick: 150, cast: 1 }] } },
    objectives: [
      { id: 'cast', text: 'Draw Mirror Twin', predicate: 'cast-spell:37' },
      { id: 'decoy', text: 'Let the decoy absorb the shot', predicate: 'decoy-absorb' },
    ],
    maxTicks: 1200,
    solution: (sim, t) => {
      const p = sim.wizards[0];
      if (t.castCount(37) < 1 && p.mirrorTicks <= 0 && pc(sim, 37)) return { cast: 37, castQuality: 1 };
      return IDLE;
    },
  },

  {
    id: 'T38', chapter: 'secret', title: 'Hourglass Field', order: 101,
    optional: true, secret: 38,
    narration: [
      'The sand slows all, including its keeper.',
      'Lay the Hourglass Field, then slip a fast shot it has slowed.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [38], opponentLoadout: [3],
    taughtSpells: [],
    drills: [],
    trialSpell: 38,
    arena: { playerCharges: 2 },
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 3, startTick: 150, periodTicks: 90 } },
    objectives: [
      { id: 'cast', text: 'Lay the Hourglass Field', predicate: 'cast-spell:38' },
      { id: 'evade', text: 'Evade a slowed projectile', predicate: 'evade:1' },
    ],
    maxTicks: 1600,
    solution: (sim, t) => {
      if (t.castCount(38) < 1) return pc(sim, 38) ? { cast: 38, castQuality: 1 } : IDLE;
      if (t.facts.evadesBySelf < 1) return dodgeIntent(sim);
      return IDLE;
    },
  },

  {
    id: 'T39', chapter: 'secret', title: 'Phoenix Covenant', order: 102,
    optional: true, secret: 39,
    narration: [
      'A flame survives only when the enemy knows it burns.',
      'Light the covenant, then survive a committed lethal strike.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [39], opponentLoadout: [1, 8],
    taughtSpells: [],
    drills: [],
    trialSpell: 39,
    arena: { playerCharges: 3, playerHealth: 24, botCharges: 1 },
    opponent: { type: 'script', config: { behavior: 'sequence', steps: [{ tick: 120, cast: 1 }, { tick: 240, cast: 8 }] } },
    objectives: [
      { id: 'covenant', text: 'Activate Phoenix Covenant', predicate: 'self-status:Phoenix' },
      { id: 'survive', text: 'Survive a lethal strike', predicate: 'phoenix-survive' },
    ],
    maxTicks: 1600,
    solution: (sim, t) => {
      if ((t.facts.statusAppliedToSelf.get('Phoenix') || 0) < 1 && pc(sim, 39)) return { cast: 39, castQuality: 1 };
      return IDLE;
    },
  },

  {
    id: 'T40', chapter: 'secret', title: 'Prismatic Beam', order: 103,
    optional: true, secret: 40,
    narration: [
      'No single color opens the spectrum.',
      'Build mixed resonance, then complete the six-segment channel within the cap.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [40, 1, 2], opponentLoadout: [1],
    taughtSpells: [],
    drills: [],
    trialSpell: 40,
    arena: { playerCharges: 2, playerAether: 100 },
    opponent: { type: 'script', config: { behavior: 'idle' } },
    objectives: [
      { id: 'mixed', text: 'Build mixed resonance (two schools)', predicate: 'schools-cast:2' },
      { id: 'channel', text: 'Complete the Prismatic channel', predicate: 'channel-complete:40' },
    ],
    maxTicks: 1600,
    solution: (sim, t) => {
      if (t.facts.channelCompletesBySelf.get(40) >= 1) return IDLE;
      if (!t.facts.schoolsCastByPlayer.has('Ember') && pc(sim, 1)) return { cast: 1, castQuality: 1 };
      if (!t.facts.schoolsCastByPlayer.has('Tide') && pc(sim, 2)) return { cast: 2, castQuality: 1 };
      if (pc(sim, 40)) return { cast: 40, castQuality: 1 };
      return IDLE;
    },
  },
];

export const CAMPAIGN_BY_ID = Object.freeze(
  CAMPAIGN.reduce((m, l) => { m[l.id] = l; return m; }, {}),
);

// Ordered ids of the REQUIRED path (used for completion %; optional lessons and
// trials are excluded so ranked readiness never depends on them, §24).
export const REQUIRED_LESSON_IDS = CAMPAIGN.filter((l) => !l.optional).map((l) => l.id);

export const CHAPTER_ORDER = ['prologue', 'core', 'academy', 'exam', 'secret'];
export const CHAPTER_TITLES = {
  prologue: 'Prologue', core: 'Core Lessons', academy: 'Academy',
  exam: 'Final Exam', secret: 'Secret Trials',
};

// The spell ids a lesson taught, drilled, or unlocked as a trial.
export function lessonCoverageIds(lesson) {
  const ids = new Set();
  for (const t of lesson.taughtSpells || []) ids.add(typeof t === 'object' ? t.id : t);
  for (const d of lesson.drills || []) ids.add(d);
  if (lesson.trialSpell) ids.add(lesson.trialSpell);
  return ids;
}

// Union of every taught / drilled / trial spell across the whole campaign.
export function campaignCoverageIds() {
  const all = new Set();
  for (const lesson of CAMPAIGN) for (const id of lessonCoverageIds(lesson)) all.add(id);
  return all;
}

export function nextLessonId(lessonId) {
  const idx = CAMPAIGN.findIndex((l) => l.id === lessonId);
  if (idx < 0 || idx + 1 >= CAMPAIGN.length) return null;
  return CAMPAIGN[idx + 1].id;
}

export function chapters() {
  const groups = {};
  for (const l of CAMPAIGN) (groups[l.chapter] ||= []).push(l);
  return CHAPTER_ORDER.filter((c) => groups[c]).map((c) => ({ chapter: c, title: CHAPTER_TITLES[c], lessons: groups[c] }));
}

// Build the deterministic "intended student" intent source for a lesson. Scripted
// lessons return their authored solution; formal duels use a competent DuelBot so
// the completeness proof means "a skilled player can win" (never a tap-to-win).
export function makeStudent(lesson, seed = 12345) {
  if (lesson.solution) {
    return (sim, tracker) => lesson.solution(sim, tracker) || {};
  }
  if (lesson.solutionBot) {
    const bot = new DuelBot(0, { difficulty: lesson.solutionBot, seed: (seed ^ 0x1379) >>> 0 });
    return (sim) => bot.act(sim);
  }
  return () => ({});
}
