// practiceBot.test.js — fairness + statistical tests for the Practice AI.
//
// Proves the Easy/Medium/Hard bots are FAIR (identical rules, resources, legal
// loadouts, non-zero gesture misses, non-zero perception delay, deterministic)
// and that difficulty ORDERING holds across mirrored seeded matches with several
// equal loadouts. Ordering is achieved through decision profiles — NOT stat
// tuning — so these are behavioural targets, verified on fixed seeds (stable).

import { createHarness } from './tiny.js';
import { Sim } from '../shared/src/sim/sim.js';
import { createMatch, runMatch } from '../shared/src/sim/match.js';
import {
  PracticeBot, PRACTICE_PROFILES, PRACTICE_DIFFICULTIES,
  chooseOpponentLoadout, counterBuild, beginnerLoadout, bestPresetAgainst,
} from '../shared/src/bot/practiceBot.js';
import {
  PRESETS, presetLoadout, validateLoadout, spellWithGesture,
} from '../shared/src/balance/loadouts.js';
import { makeRng } from '../shared/src/rng/rng.js';
import { AETHER, SIGIL, MATCH, TICK_HZ, CAST } from '../shared/src/sim/constants.js';
import { effectFor } from '../shared/src/sim/spellEffects.js';

const equalLoadouts = (key) => {
  const l = presetLoadout(key);
  return [l, l.map((s) => ({ ...s }))];
};

// A vs B across mirrored seeded matches (each seed played on BOTH seats) using a
// rotating set of equal legal loadouts. Returns per-side + aggregate winrates for
// the FIRST-named difficulty.
function mirror(dA, dB, seeds, base) {
  let a0 = 0, g0 = 0, a1 = 0, g1 = 0;
  for (let s = 0; s < seeds; s++) {
    const L = presetLoadout(PRESETS[s % PRESETS.length].key);
    const loadouts = () => [L, L.map((x) => ({ ...x }))];
    {
      const sim = createMatch({ seed: base + s, loadouts: loadouts() });
      const a = new PracticeBot(0, { difficulty: dA, seed: base + s });
      const b = new PracticeBot(1, { difficulty: dB, seed: base + 2000 + s });
      const r = runMatch(sim, [(x) => a.act(x), (x) => b.act(x)]);
      g0 += 1; if (r.winner === 0) a0 += 1;
    }
    {
      const sim = createMatch({ seed: base + s, loadouts: loadouts() });
      const b = new PracticeBot(0, { difficulty: dB, seed: base + 3000 + s });
      const a = new PracticeBot(1, { difficulty: dA, seed: base + s });
      const r = runMatch(sim, [(x) => b.act(x), (x) => a.act(x)]);
      g1 += 1; if (r.winner === 1) a1 += 1;
    }
  }
  return { side0: a0 / g0, side1: a1 / g1, rate: (a0 + a1) / (g0 + g1) };
}

export function run() {
  const { ok, eq, near, report } = createHarness();

  // --- exactly three public difficulties --------------------------------
  eq(PRACTICE_DIFFICULTIES.length, 3, 'exactly three practice difficulties');
  ok(PRACTICE_DIFFICULTIES.join(',') === 'easy,medium,hard', 'difficulties are Easy, Medium, Hard');

  // --- non-zero perception delay at every tier, ordered ------------------
  const per = (d) => new PracticeBot(1, { difficulty: d, seed: 1 }).perceptionTicks;
  ok(per('hard') >= Math.round(0.150 * TICK_HZ), 'Hard perception >= 150 ms');
  ok(per('medium') >= Math.round(0.280 * TICK_HZ), 'Medium perception >= 280 ms');
  ok(per('easy') >= Math.round(0.450 * TICK_HZ), 'Easy perception >= 450 ms');
  ok(per('hard') > 0 && per('medium') > per('hard') && per('easy') > per('medium'),
    'perception delay is non-zero and strictly Easy>Medium>Hard');

  {
    const sim = createMatch({ seed: 19 });
    const bot = new PracticeBot(1, { difficulty: 'hard', seed: 19 });
    sim.applyStatus(sim.wizards[1], 'Blinded', 1);
    sim.projectiles.push({ id: 919, owner: 0, ticks: 2, eff: effectFor(1), spellId: 1, targetPos: 0.35 });
    sim.wizards[0].casting = { spellId: 8, ticks: 30, totalTicks: 60 };
    const intent = bot.act(sim);
    eq(bot.seenProjectiles.size, 0, 'a blinded AI does not perceive incoming projectiles');
    ok(bot.castTell === null, 'a blinded AI does not perceive opponent cast tells');
    ok(intent.cast == null && !intent.focus && !intent.brace && !intent.sidestep,
      'a blinded AI makes no opponent-aware combat decision');
    ok(intent.move === -1 || intent.move === 1, 'a blinded AI may still move without opponent awareness');
  }

  // --- perception isolation: cannot react before the notice tick ---------
  {
    const sim = createMatch({ seed: 1 });
    const bot = new PracticeBot(1, { difficulty: 'easy', seed: 1 });
    sim.projectiles.push({ id: 999, owner: 0, ticks: 200, eff: effectFor(1), spellId: 1, targetPos: 0.35 });
    sim.tick = 100;
    bot.observe(sim);
    ok(bot.noticedThreat(sim) === null, 'a just-seen projectile is not yet actionable (perception delay)');
    sim.tick = 100 + bot.perceptionTicks - 1;
    ok(bot.noticedThreat(sim) === null, 'projectile still not noticed one tick before the delay elapses');
    sim.tick = 100 + bot.perceptionTicks;
    ok(bot.noticedThreat(sim) !== null, 'projectile becomes actionable exactly after the perception delay');
  }

  // Cast tells obey the same delay before becoming actionable.
  {
    const sim = createMatch({ seed: 2, loadouts: equalLoadouts('storm-tempo') });
    const bot = new PracticeBot(1, { difficulty: 'hard', seed: 2 });
    sim.wizards[0].casting = { spellId: 3, ticks: 30, totalTicks: 30, quality: 1 };
    sim.tick = 50;
    bot.observe(sim);
    eq(bot.perceivedCast(sim), null, 'a new cast tell is hidden until perception delay elapses');
    sim.tick += bot.perceptionTicks;
    eq(bot.perceivedCast(sim).school, 'Storm', 'cast tell becomes actionable after the delay');
  }

  // --- gesture misses: non-zero and strictly Easy>Medium>Hard ------------
  const missRate = (d, n) => {
    const bot = new PracticeBot(1, { difficulty: d, seed: 5 });
    let rej = 0;
    for (let i = 0; i < n; i++) if (bot._sampleGesture().rejected) rej += 1;
    return rej / n;
  };
  const N = 30000;
  const me = missRate('easy', N), mm = missRate('medium', N), mh = missRate('hard', N);
  ok(mh > 0, `Hard gesture-miss rate is greater than zero (${mh.toFixed(3)})`);
  ok(mm > mh, `Medium miss rate materially above Hard (${mm.toFixed(3)} > ${mh.toFixed(3)})`);
  ok(me > mm, `Easy miss rate materially above Medium (${me.toFixed(3)} > ${mm.toFixed(3)})`);
  ok(me - mm > 0.05, 'Easy is materially (>5pp) missier than Medium');
  ok(mm - mh > 0.005, 'Medium is materially missier than Hard');

  // --- accepted casts use the SHARED potency mapping (0.90..1.05) ---------
  {
    let inBand = true;
    for (const d of PRACTICE_DIFFICULTIES) {
      const bot = new PracticeBot(1, { difficulty: d, seed: 3 });
      for (let i = 0; i < 3000; i++) {
        const g = bot._sampleGesture();
        if (!g.rejected && (g.quality < CAST.minPotency - 1e-9 || g.quality > CAST.maxPotency + 1e-9)) inBand = false;
      }
    }
    ok(inBand, 'every accepted AI cast maps into the shared [0.90, 1.05] potency band');
  }

  // --- a modelled failed gesture gets the SAME reject recovery + counter --
  {
    const sim = createMatch({ seed: 1 });
    const w = sim.wizards[1];
    const before = w.castsRejected;
    sim.applyIntent(w, { castReject: 1 });
    ok(w.recoveryTicks > 0, 'a modelled AI gesture miss incurs reject recovery (like the player)');
    eq(w.castsRejected, before + 1, 'a modelled AI gesture miss increments the rejection counter');
    eq(Math.round(w.aether), Math.round(AETHER.start), 'a modelled AI gesture miss costs no Aether');
  }

  // --- no tier grants stat modifiers: identical start state --------------
  {
    const l = presetLoadout('ember-rush');
    const a = new Sim({ seed: 9, loadouts: [l, l] });
    const b = new Sim({ seed: 9, loadouts: [l, l] });
    // Difficulty lives entirely in the bot; the Sim's wizard stats are untouched.
    eq(a.wizards[1].health, b.wizards[1].health, 'start health is difficulty-independent');
    eq(a.wizards[1].aether, b.wizards[1].aether, 'start Aether is difficulty-independent');
    eq(a.wizards[1].charges, b.wizards[1].charges, 'start charges are difficulty-independent');
    for (const d of PRACTICE_DIFFICULTIES) {
      const p = PRACTICE_PROFILES[d];
      ok(!('damageMul' in p) && !('healthMul' in p) && !('cooldownMul' in p),
        `${d} profile carries no combat stat multiplier`);
    }

    // --- observed-event adaptation changes decisions -----------------------
    {
      const sim = new Sim({
        seed: 10,
        loadouts: [presetLoadout('storm-tempo'), [spellWithGesture(20)]],
      });
      const medium = new PracticeBot(1, {
        difficulty: 'medium',
        seed: 10,
        overrides: { replanMs: 1, scoreMean: 1, scoreSpread: 0, flubRate: 0, mistakeRate: 0 },
      });
      medium.memory.casts = 2;
      medium.memory.schoolCounts.Storm = 2;
      sim.tick = 100;
      const adapted = medium.act(sim);
      eq(adapted.cast, 20, 'Medium adapts to repeated observed Storm casts with Grounding Mantle');

      const easy = new PracticeBot(1, {
        difficulty: 'easy',
        seed: 10,
        overrides: { replanMs: 1, aggression: 0, focusBias: 0, scoreMean: 1, scoreSpread: 0, flubRate: 0, mistakeRate: 0 },
      });
      easy.memory.casts = 2;
      easy.memory.schoolCounts.Storm = 2;
      const unadapted = easy.act(sim);
      ok(unadapted.cast !== 20, 'Easy does not gain the Medium/Hard adaptation behavior');
    }

    // Focus is a held legal action, not a one-tick start/cancel loop.
    {
      const sim = createMatch({ seed: 12 });
      const bot = new PracticeBot(1, { difficulty: 'medium', seed: 12 });
      sim.wizards[1].focusing = true;
      const intent = bot.act(sim);
      eq(intent.focus, true, 'Practice AI continues holding an active Focus channel when safe');
    }
  }

  // --- equal rules: resources never leave legal bounds, matches end ------
  {
    let bounds = true, ended = true;
    for (const d of PRACTICE_DIFFICULTIES) {
      for (let s = 0; s < 12; s++) {
        const sim = createMatch({ seed: 2000 + s, loadouts: equalLoadouts(PRESETS[s % PRESETS.length].key) });
        const p = new PracticeBot(0, { difficulty: d, seed: 2000 + s });
        const q = new PracticeBot(1, { difficulty: d, seed: 3000 + s });
        const r = runMatch(sim, [(x) => p.act(x), (x) => q.act(x)]);
        if (!r.ended || r.hitCap) ended = false;
        for (const w of sim.wizards) {
          if (w.aether < -0.001 || w.aether > AETHER.max + 0.001) bounds = false;
          if (w.charges < 0 || w.charges > SIGIL.max) bounds = false;
          if (w.health < 0 || w.health > MATCH.startHealth) bounds = false;
        }
      }
    }
    ok(bounds, 'every tier obeys Aether/charge/health bounds (same resource rules as the player)');
    ok(ended, 'every Practice match terminates within the timer (no hang)');
  }

  // --- deterministic outcomes: same seed replays identically -------------
  {
    const play = (seed) => {
      const sim = createMatch({ seed, loadouts: equalLoadouts('storm-tempo') });
      const b0 = new PracticeBot(0, { difficulty: 'hard', seed });
      const b1 = new PracticeBot(1, { difficulty: 'medium', seed });
      runMatch(sim, [(x) => b0.act(x), (x) => b1.act(x)]);
      return `${sim.hash()}:${sim.winner}`;
    };
    eq(play(555), play(555), 'same seed yields an identical Practice outcome');
    eq(play(556), play(556), 'a second seed also replays identically');
  }

  // --- legal generated loadouts at every tier ----------------------------
  {
    let legal = true, hardConstructed = 0;
    for (const d of PRACTICE_DIFFICULTIES) {
      for (let s = 0; s < 24; s++) {
        const player = presetLoadout(PRESETS[s % PRESETS.length].key).map((x) => x.id);
        const ids = chooseOpponentLoadout(d, player, makeRng(1000 + s));
        const v = validateLoadout(ids);
        if (!v.valid || ids.length !== 8) { legal = false; }
        if (d === 'hard' && counterBuild(player, makeRng(1000 + s))) hardConstructed += 1;
      }
    }
    ok(legal, 'every generated opponent loadout is a legal 8-spell / 14-point build');
    ok(hardConstructed >= 20, 'Hard constructs a legal counter-build (not merely a preset) in almost every case');
    // Easy picks a beginner preset without inspecting the player.
    ok(validateLoadout(beginnerLoadout(makeRng(1))).valid, 'Easy beginner loadout is legal');
    ok(validateLoadout(bestPresetAgainst([1, 2, 3, 7, 30], makeRng(1))).valid, 'Medium soft-counter preset is legal');
  }

  // --- difficulty ordering across mirrored equal-loadout matches ---------
  // 60 mirrored seeds per pairing: a robust fixed-seed sample so the closest
  // gap (Hard vs Medium) separates on BOTH seats without razor-edge noise.
  const HvE = mirror('hard', 'easy', 60, 9000);
  const HvM = mirror('hard', 'medium', 60, 9000);
  const MvE = mirror('medium', 'easy', 60, 9000);
  ok(HvE.rate > 0.70, `Hard beats Easy > 70% (${(HvE.rate * 100).toFixed(0)}%)`);
  ok(HvM.rate > 0.55, `Hard beats Medium > 55% (${(HvM.rate * 100).toFixed(0)}%)`);
  ok(MvE.rate > 0.60, `Medium beats Easy > 60% (${(MvE.rate * 100).toFixed(0)}%)`);
  // Side swapping does not reverse the ordering: the stronger tier wins > 50%
  // on BOTH seat assignments.
  ok(HvE.side0 > 0.5 && HvE.side1 > 0.5, 'Hard > Easy on both seats (no side reversal)');
  ok(HvM.side0 > 0.5 && HvM.side1 > 0.5, 'Hard > Medium on both seats (no side reversal)');
  ok(MvE.side0 > 0.5 && MvE.side1 > 0.5, 'Medium > Easy on both seats (no side reversal)');

  return report('practiceBot');
}
