// campaign.js — declarative solo tutorial campaign (SOLO-MODES-PLAN §6, §9-11).
//
// This replaces the three-item tutorial stub with fully data-driven content: a
// Prologue, twelve core Lessons, four Academy lessons, a fully interactive final
// exam (a no-template gesture gauntlet, five tactical scenarios, a best-of-three
// Final Duel, and an optional Grandmaster trial), public-spell drills, and four
// secret trials. Every lesson names:
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
import { isHeavyProjectile } from '../../../shared/src/sim/spellEffects.js';
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

// --- final-exam content (SOLO-MODES-PLAN §9) -------------------------------
// The exam is fully interactive and checkpointed. It is built from separate,
// data-driven lesson entries rather than a bespoke state machine: a no-template
// Gesture Gauntlet (draw any 10 of 12 glyphs from memory), five Tactical
// Scenarios (pass any 4 of 5 with real Sim mechanics), a best-of-three Final
// Duel vs the fair Medium AI, and an optional Grandmaster best-of-three vs the
// fair Hard AI. Declarative `group` + `requires` metadata drives hub locking so
// no bespoke exam controller is needed.

// Group thresholds: complete `need` of `total` to satisfy the group.
export const EXAM_GROUPS = Object.freeze({
  'exam-gauntlet': { total: 12, need: 10, title: 'Gesture Gauntlet' },
  'exam-scenarios': { total: 5, need: 4, title: 'Tactical Scenarios' },
});

// The twelve gauntlet glyphs — all castable with zero Sigil Charges and visually
// distinct. Every gauntlet stage scopes the production recognizer to this same
// pool, so each is a genuine twelve-way discrimination drawn WITHOUT any guide.
const GAUNTLET_TARGETS = [1, 2, 3, 4, 5, 6, 10, 11, 12, 14, 20, 28];
const GAUNTLET_GLYPH_LABEL = {
  1: 'Ember Bolt', 2: 'Frost Lance', 3: 'Spark Dart', 4: 'Stone Shard',
  5: 'Arcane Missile', 6: 'Flame Wave', 10: 'Ward', 11: 'Barrier Dome',
  12: 'Reflect', 14: 'Blink', 20: 'Grounding Mantle', 28: 'Concussive Blast',
};

// Build one gauntlet stage: no taught spell (so the guide is always None), a
// single "draw this glyph" objective checked by the production recognizer, and a
// deterministic student that draws exactly the requested glyph once (real input,
// never a tap substitute — a no-input student can never satisfy it).
function gauntletLesson(index, spellId) {
  const n = index + 1;
  const name = GAUNTLET_GLYPH_LABEL[spellId];
  return {
    id: `G${String(n).padStart(2, '0')}`, chapter: 'exam',
    title: `Gauntlet ${n}: ${name}`, order: 20 + index,
    optional: true, gauntlet: true, group: 'exam-gauntlet',
    narration: [
      'The gauntlet: no guide, no template — draw each glyph from memory.',
      `Draw ${name} cleanly. Pass any ten of the twelve glyphs to advance.`,
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: GAUNTLET_TARGETS.slice(), opponentLoadout: [1],
    taughtSpells: [], drills: [],
    opponent: { type: 'script', config: { behavior: 'idle' } },
    objectives: [
      { id: 'draw', text: `Draw ${name} with no guide`, predicate: `cast-spell:${spellId}`, expectSpell: spellId },
    ],
    remediation: ['retry'],
    maxTicks: 900,
    solution: (sim, t) => (t.castCount(spellId) < 1 && pc(sim, spellId)) ? { cast: spellId, castQuality: 1 } : IDLE,
  };
}
const GAUNTLET_LESSONS = GAUNTLET_TARGETS.map((id, i) => gauntletLesson(i, id));

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
      'Land three Ember Bolts. The dotted guide stays visible while you learn.',
    ],
    calibrate: true,
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [1], opponentLoadout: [1],
    taughtSpells: [{ id: 1, enterStage: 0, exitStage: 3 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'idle' } },
    objectives: [
      { id: 'bolt1', text: 'Land your first Ember Bolt', predicate: 'land-spell:1:1', expectSpell: 1 },
      { id: 'bolt2', text: 'Land a second Ember Bolt using the dotted guide', predicate: 'land-spell:1:2', expectSpell: 1 },
      { id: 'bolt3', text: 'Land a third Ember Bolt using the dotted guide', predicate: 'land-spell:1:3', expectSpell: 1 },
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
      'Raise it and the instructor will fire one bolt into the shield.',
      'Block that bolt, then answer with Flame Wave.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [10, 6], opponentLoadout: [1],
    taughtSpells: [{ id: 10, enterStage: 0, exitStage: 2 }, { id: 6, enterStage: 0, exitStage: 2 }],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'ward-drill', spellId: 1 } },
    objectives: [
      { id: 'block', text: 'Block the instructor\'s bolt with Ward', predicate: 'block-damage:8', expectSpell: 10 },
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
      {
        id: 'clean',
        text: 'Never waste Dispel on plain damage',
        predicate: 'no-wasted-dispel',
        restartOnViolation: 'wasted-dispel',
      },
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
      'After the return lightning is released, let it get close, then tap Dodge. Spark homes slightly, so dodging too early lets it follow you.',
    ],
    timerEnabled: false, pressureEnabled: false,
    projectileTravelScale: 2.5,
    playerLoadout: [32, 3], opponentLoadout: [3],
    taughtSpells: [{ id: 32, enterStage: 0, exitStage: 2 }, { id: 3, enterStage: 0, exitStage: 2 }],
    drills: [7, 30],
    opponent: {
      type: 'script',
      config: { behavior: 'return-lightning', spellId: 3, delayTicks: 90, periodTicks: 180 },
    },
    objectives: [
      { id: 'wet', text: 'Create a Wet zone', predicate: 'create-zone:Wet', expectSpell: 32 },
      { id: 'conduct', text: 'Trigger Conductive Arc', predicate: 'reaction:ConductiveArc', expectSpell: 3 },
      { id: 'escape', text: 'Let the return lightning get close, then tap Dodge', predicate: 'evade:1' },
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
    taughtSpells: [
      { id: 31, enterStage: 1, exitStage: 1 },
      { id: 32, enterStage: 1, exitStage: 1 },
      { id: 1, enterStage: 1, exitStage: 1 },
    ],
    drills: [],
    opponent: { type: 'script', config: { behavior: 'idle' } },
    objectives: [
      { id: 'oil-wash', text: 'Place an Oil slick to wash away', predicate: 'create-zone:Oil', expectSpell: 31 },
      { id: 'wash', text: 'Wash the Oil slick with Rain', predicate: 'reaction:WashedGround', expectSpell: 32 },
      { id: 'oil-fire', text: 'Place another Oil slick to ignite', predicate: 'create-zone:Oil:2', expectSpell: 31 },
      { id: 'ignite', text: 'Ignite the Oil slick with Ember', predicate: 'reaction:FlashFire', expectSpell: 1 },
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
    taughtSpells: [
      { id: 2, enterStage: 1, exitStage: 1 },
      { id: 27, enterStage: 1, exitStage: 1 },
      { id: 14, enterStage: 1, exitStage: 1 },
    ],
    drills: [9, 26],
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 1, startTick: 30, periodTicks: 200 } },
    objectives: [
      { id: 'chill', text: 'Chill the instructor with Frost Lance', predicate: 'apply-status:Chilled', expectSpell: 2 },
      { id: 'freeze', text: 'Freeze the Chilled instructor', predicate: 'apply-status:Frozen', expectSpell: 27 },
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
      'Gust deflects a light bolt and clears Fog, but heavy attacks blow right through it.',
      'Visual effects never change how your glyph is read.',
      'Clear the Fog, deflect a light bolt, then dodge a heavy Stone Shard.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [35, 33], opponentLoadout: [1, 4],
    taughtSpells: [{ id: 35, enterStage: 0, exitStage: 2 }, { id: 33, enterStage: 0, exitStage: 2 }],
    drills: [25, 29],
    opponent: { type: 'script', config: { behavior: 'wind-drill', lightId: 1, heavyId: 4, heavyStartTick: 300, heavyPeriodTicks: 170 } },
    objectives: [
      { id: 'fog', text: 'Create a Fog Cloud', predicate: 'create-zone:Fog', expectSpell: 35 },
      { id: 'clear', text: 'Clear the Fog with Gust', predicate: 'reaction:ClearedAir', expectSpell: 33 },
      { id: 'deflect', text: 'Deflect a light projectile with Gust', predicate: 'deflect', expectSpell: 33 },
      { id: 'dodge', text: 'Dodge a heavy Stone Shard', predicate: 'evade-spell:4' },
    ],
    remediation: ['slow-script'],
    maxTicks: 2600,
    solution: (sim, t) => {
      const P = sim.wizards[0];
      // Always survive an incoming heavy Stone Shard (Gust cannot stop it).
      const heavy = enemyProj(sim, (p) => isHeavyProjectile(p.eff) && p.ticks <= 1);
      if (heavy && P.sidestepCharges > 0 && !P.sidestepTimers.some((x) => x > 147)) {
        return { sidestep: P.arcPos >= 0 ? -1 : 1 };
      }
      // 1. Clear the Fog with Gust (this also raises the deflect window).
      if (!t.facts.reactionsSetPlayer.has('ClearedAir')) {
        if (!playerZone(sim, 'Fog') && pc(sim, 35)) return { cast: 35, castQuality: 1 };
        if (playerZone(sim, 'Fog') && P.deflectTicks <= 0 && pc(sim, 33)) return { cast: 33, castQuality: 1 };
        return IDLE;
      }
      // 2. Deflect a light bolt: raise a fresh Gust wall to blow away a poke.
      if ((t.facts.deflectsBySelf || 0) < 1) {
        if (P.deflectTicks <= 0 && pc(sim, 33)) return { cast: 33, castQuality: 1 };
        return IDLE;
      }
      // 3. Dodge a heavy Stone Shard.
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
      { id: 'wall', text: 'Build a Stone Wall', predicate: 'create-zone:Cover', expectSpell: 15 },
      { id: 'cover', text: 'Focus safely behind cover', predicate: 'focus-behind-cover', guideSpell: 15 },
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
      'Defeat the fair Easy AI in one legal round.',
    ],
    formal: true,
    timerEnabled: true, pressureEnabled: true,
    loadoutRule: 'legal',
    playerLoadout: PRESETS_BY_KEY['ember-rush'].ids.slice(),
    opponentLoadout: PRESETS_BY_KEY['tide-control'].ids.slice(),
    taughtSpells: [],
    drills: [],
    opponent: { type: 'practice', difficulty: 'easy' },
    objectives: [
      { id: 'win', text: 'Win a legal round against the Easy AI', predicate: 'win-round' },
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
      { id: 'surge', text: 'Channel Aether Surge', predicate: 'self-status:AetherSurge', expectSpell: 17 },
      { id: 'ground', text: 'Take Grounding Mantle', predicate: 'self-status:Grounded', expectSpell: 20 },
      { id: 'weaken', text: 'Weaken the instructor', predicate: 'apply-status:Weakened', expectSpell: 21 },
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
      { id: 'reflect', text: 'Reflect the Arcane Missile', predicate: 'reflect', expectSpell: 12 },
      { id: 'survive', text: 'Survive the Fireball behind a Barrier', predicate: 'block-damage:20', expectSpell: 11 },
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
    optional: true, formal: true, bestOfThree: true,
    narration: [
      'Adapt across schools against a sharper opponent.',
      'Win a best-of-three against the fair Medium AI — take two rounds.',
    ],
    timerEnabled: true, pressureEnabled: true,
    loadoutRule: 'legal',
    playerLoadout: PRESETS_BY_KEY['storm-tempo'].ids.slice(),
    opponentLoadout: PRESETS_BY_KEY['stone-warden'].ids.slice(),
    taughtSpells: [],
    drills: [],
    opponent: { type: 'practice', difficulty: 'medium' },
    objectives: [
      { id: 'win', text: 'Win a best-of-three against the Medium AI', predicate: 'win-series' },
    ],
    remediation: ['retry'],
    solutionBot: 'archmage',
    maxTicks: 21000,
  },

  // --- final exam: gesture gauntlet (draw any 10 of 12, no templates) -------
  ...GAUNTLET_LESSONS,

  // --- final exam: five tactical scenarios (pass any 4 of 5) ----------------
  {
    id: 'S01', chapter: 'exam', title: 'Scenario: Reflect vs Heavy', order: 40,
    optional: true, group: 'exam-scenarios', requires: [{ group: 'exam-gauntlet', count: 10 }],
    narration: [
      'Tactical trial: reflect what you can, refuse what you cannot.',
      'Bounce the Arcane Missile, then weather the un-reflectable Fireball behind a Barrier.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [12, 11, 5], opponentLoadout: [5, 8],
    taughtSpells: [], drills: [],
    arena: { botCharges: 1 },
    opponent: { type: 'script', config: { behavior: 'sequence', steps: [{ tick: 120, cast: 5 }, { tick: 330, cast: 8 }] } },
    objectives: [
      { id: 'reflect', text: 'Reflect the Arcane Missile', predicate: 'reflect' },
      { id: 'survive', text: 'Survive the Fireball behind a Barrier', predicate: 'block-damage:20' },
    ],
    remediation: ['retry'],
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
    id: 'S02', chapter: 'exam', title: 'Scenario: Break the Freeze', order: 41,
    optional: true, group: 'exam-scenarios', requires: [{ group: 'exam-gauntlet', count: 10 }],
    narration: [
      'A freeze needs a Chilled target first. Deny the setup.',
      'Cleanse the Chill with Dispel before Frost Bind can land — never be Frozen.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [13, 1], opponentLoadout: [2, 27],
    taughtSpells: [], drills: [],
    opponent: { type: 'script', config: { behavior: 'sequence', steps: [{ tick: 60, cast: 2 }, { tick: 300, cast: 27 }] } },
    objectives: [
      { id: 'cleanse', text: 'Cleanse the Chill with Dispel', predicate: 'cleanse:Chilled' },
      { id: 'safe', text: 'Never be Frozen', predicate: 'no-self-status:Frozen' },
    ],
    remediation: ['slow-script'],
    maxTicks: 2400,
    solution: (sim, t) => {
      const p = sim.wizards[0];
      if (t.facts.dispelRemovedBySelf.includes('Chilled')) return IDLE;
      if (sim.hasStatus(p, 'Chilled') && pc(sim, 13)) return { cast: 13, castQuality: 1 };
      return IDLE;
    },
  },

  {
    id: 'S03', chapter: 'exam', title: 'Scenario: Ward and Answer', order: 42,
    optional: true, group: 'exam-scenarios', requires: [{ group: 'exam-gauntlet', count: 10 }],
    narration: [
      'Defense earns its cost only when it faces the threat — then you answer.',
      'Block direct fire with a Ward, then land Flame Wave through the opening.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [10, 6], opponentLoadout: [1],
    taughtSpells: [], drills: [],
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 1, startTick: 30, periodTicks: 60 } },
    objectives: [
      { id: 'block', text: 'Block 20 damage with a Ward', predicate: 'block-damage:20' },
      { id: 'answer', text: 'Land Flame Wave in the counterattack', predicate: 'land-spell:6' },
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
    id: 'S04', chapter: 'exam', title: 'Scenario: Grounding vs Storm', order: 43,
    optional: true, group: 'exam-scenarios', requires: [{ group: 'exam-gauntlet', count: 10 }],
    narration: [
      'Storm punishes the ungrounded. Trade some mobility for protection.',
      'Take Grounding Mantle against the Storm, then counterattack with Stone Shard.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [20, 4], opponentLoadout: [3, 7],
    taughtSpells: [], drills: [],
    opponent: { type: 'script', config: { behavior: 'periodic', spellId: 3, startTick: 90, periodTicks: 120 } },
    objectives: [
      { id: 'ground', text: 'Become Grounded against the Storm', predicate: 'self-status:Grounded' },
      { id: 'punish', text: 'Counterattack with Stone Shard', predicate: 'damage-opponent:10' },
    ],
    remediation: ['slow-script'],
    maxTicks: 2400,
    solution: (sim, t) => {
      if ((t.facts.statusAppliedToSelf.get('Grounded') || 0) < 1) return pc(sim, 20) ? { cast: 20, castQuality: 1 } : IDLE;
      if (t.facts.damageDealtToOpp < 10) return pc(sim, 4) ? { cast: 4, castQuality: 1 } : IDLE;
      return IDLE;
    },
  },

  {
    id: 'S05', chapter: 'exam', title: 'Scenario: Fire and Water', order: 44,
    optional: true, group: 'exam-scenarios', requires: [{ group: 'exam-gauntlet', count: 10 }],
    narration: [
      'Command the ground: some fights are won by the field, not the bolt.',
      'Douse one Oil slick with Rain, then ignite another with an Ember.',
    ],
    timerEnabled: false, pressureEnabled: false,
    playerLoadout: [31, 32, 1], opponentLoadout: [1],
    taughtSpells: [], drills: [],
    opponent: { type: 'script', config: { behavior: 'idle' } },
    objectives: [
      { id: 'douse', text: 'Wash an Oil slick with Rain', predicate: 'reaction:WashedGround' },
      { id: 'ignite', text: 'Ignite an Oil slick with Ember', predicate: 'reaction:FlashFire' },
    ],
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

  // --- final exam: the Final Duel (best-of-three vs the fair Medium AI) ------
  // Unlocked only after the gauntlet (10/12) and scenario (4/5) thresholds.
  {
    id: 'EXAM', chapter: 'exam', title: 'Final Duel', order: 50,
    optional: true, formal: true, bestOfThree: true, group: 'exam-duel',
    requires: [{ group: 'exam-gauntlet', count: 10 }, { group: 'exam-scenarios', count: 4 }],
    narration: [
      'The Final Duel: a best-of-three against the fair Magus examiner.',
      'Bring a legal loadout. Timer and Arcane Pressure are live.',
      'Take two rounds to pass the examination.',
    ],
    timerEnabled: true, pressureEnabled: true,
    loadoutRule: 'legal',
    playerLoadout: PRESETS_BY_KEY['arcane-combo'].ids.slice(),
    opponentLoadout: PRESETS_BY_KEY['gale-trickster'].ids.slice(),
    taughtSpells: [],
    drills: [],
    opponent: { type: 'practice', difficulty: 'medium' },
    objectives: [
      { id: 'win', text: 'Win a best-of-three against the Magus examiner', predicate: 'win-series' },
    ],
    remediation: ['retry'],
    solutionBot: 'archmage',
    maxTicks: 21000,
  },

  // --- final exam: the optional Grandmaster trial (best-of-three vs Hard) ----
  // Unlocked only after the Final Duel; a win grants the persistent Grandmaster
  // medal/title. Never gates ranked readiness.
  {
    id: 'EXAM_GM', chapter: 'exam', title: 'Grandmaster Trial', order: 51,
    optional: true, formal: true, bestOfThree: true, group: 'exam-grandmaster',
    requires: [{ lesson: 'EXAM' }],
    narration: [
      'Optional mastery: a best-of-three against the fair Hard AI.',
      'Win two rounds to earn the persistent Grandmaster title.',
    ],
    timerEnabled: true, pressureEnabled: true,
    loadoutRule: 'legal',
    playerLoadout: PRESETS_BY_KEY['ember-rush'].ids.slice(),
    opponentLoadout: PRESETS_BY_KEY['tide-control'].ids.slice(),
    taughtSpells: [],
    drills: [],
    opponent: { type: 'practice', difficulty: 'hard' },
    objectives: [
      { id: 'win', text: 'Win a best-of-three against the Hard AI', predicate: 'win-series' },
    ],
    medal: { id: 'grandmaster', text: 'Grandmaster', predicate: 'win-series' },
    remediation: ['retry'],
    solutionBot: 'archmage',
    maxTicks: 21000,
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

// --- final-exam gating (SOLO-MODES-PLAN §9) --------------------------------
// The exam stages carry declarative `group` + `requires` metadata. These pure
// helpers evaluate a profile against that metadata so the hub can lock stages,
// the start guard can refuse a locked stage, and tests can assert the exact
// unlock thresholds — all without a bespoke exam state machine.
export const GAUNTLET_LESSON_IDS = CAMPAIGN.filter((l) => l.group === 'exam-gauntlet').map((l) => l.id);
export const SCENARIO_LESSON_IDS = CAMPAIGN.filter((l) => l.group === 'exam-scenarios').map((l) => l.id);

// Completion progress for a declarative group: { done, total, need, met }.
export function groupProgress(profile, group) {
  const completed = (profile && profile.completedLessons) || [];
  const ids = CAMPAIGN.filter((l) => l.group === group).map((l) => l.id);
  const done = ids.filter((id) => completed.includes(id)).length;
  const need = EXAM_GROUPS[group] ? EXAM_GROUPS[group].need : ids.length;
  return { done, total: ids.length, need, met: done >= need };
}

// True when a lesson has no unmet prerequisites. Lessons without `requires` are
// always unlocked (the entire non-exam campaign, and the gauntlet stages).
export function lessonUnlocked(lesson, profile) {
  if (!lesson || !lesson.requires || !lesson.requires.length) return true;
  const completed = (profile && profile.completedLessons) || [];
  for (const req of lesson.requires) {
    if (req.group != null) {
      const need = req.count ?? (EXAM_GROUPS[req.group] ? EXAM_GROUPS[req.group].need : 1);
      if (groupProgress(profile, req.group).done < need) return false;
    }
    if (req.lesson != null && !completed.includes(req.lesson)) return false;
  }
  return true;
}

// Accessible, human-readable explanation of what remains before a locked lesson
// can be started (null when the lesson is already unlocked).
export function lockReason(lesson, profile) {
  if (lessonUnlocked(lesson, profile)) return null;
  const completed = (profile && profile.completedLessons) || [];
  const parts = [];
  for (const req of lesson.requires || []) {
    if (req.group != null) {
      const gp = groupProgress(profile, req.group);
      const need = req.count ?? gp.need;
      if (gp.done < need) {
        const title = EXAM_GROUPS[req.group] ? EXAM_GROUPS[req.group].title : req.group;
        parts.push(`${title} ${gp.done}/${need}`);
      }
    }
    if (req.lesson != null && !completed.includes(req.lesson)) {
      const dep = CAMPAIGN_BY_ID[req.lesson];
      parts.push(`win ${dep ? dep.title : req.lesson}`);
    }
  }
  return parts.length ? `Locked — need ${parts.join('; ')}` : 'Locked';
}

// The first not-yet-completed lesson (in campaign order) the player can actually
// start right now — keeps the Continue button on a playable, unlocked lesson.
export function firstAvailableLessonId(profile) {
  const completed = (profile && profile.completedLessons) || [];
  for (const l of CAMPAIGN) {
    if (completed.includes(l.id)) continue;
    if (lessonUnlocked(l, profile)) return l.id;
  }
  return null;
}
