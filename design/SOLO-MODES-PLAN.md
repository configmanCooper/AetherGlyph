# Aetherglyph Solo Modes Plan

Version: 1.0  
Scope: Final implementation phase  
Modes: Single-player Tutorial, Practice vs AI, Glyph Laboratory  
AI difficulties: Easy, Medium, Hard

## 1. Outcome

The final solo phase replaces the current three-step tutorial and passive practice screen with:

1. A fully offline, checkpointed tutorial campaign that teaches the real production rules and requires real drawn gestures.
2. A fully offline Practice vs AI mode with selectable Easy, Medium, or Hard opponents.
3. A separate Glyph Laboratory for template drills and recognizer diagnostics without an opponent.

Tutorial and Practice vs AI are always single-player. They never connect to Render, require an account, or depend on network availability.

## 2. Non-negotiable rules

- The player casts by drawing through the production recognizer.
- Tutorial templates teach the same gestures accepted online.
- Tutorial bots and practice AI use the same simulation, health, Aether, charges, cooldowns, damage, statuses, loadout rules, and environmental reactions as the player.
- Difficulty never grants hidden stats, resources, cooldown reductions, extra information, perfect recognition, or impossible reaction speed.
- Easy, Medium, and Hard differ only through perception delay, planning depth, knowledge, legal loadout construction, adaptation, intentional mistakes, and gesture execution modeling.
- All solo behavior is deterministic from a seed.
- All tutorial progress is local and versioned.
- A failed lesson must always offer a path forward.
- No reading is required while the player is actively drawing.
- All 40 gestures are taught, drilled, or discovered in solo content.
- Ranked access is never sold or tied to mastery medals.

## 3. Final menu structure

### Tutorial

Continue or replay the campaign. Show:

- current chapter,
- next lesson,
- completion percentage,
- medals,
- secret clues,
- ranked-readiness state.

### Practice vs AI

Single-round practice against an AI opponent.

Options:

- Difficulty: Easy, Medium, Hard.
- Player loadout: current saved loadout or a preset.
- Opponent loadout: Auto or a chosen preset.
- Opponent loadout visibility: shown by default.
- Round: standard 105 seconds or untimed.
- Coaching: summary or detailed.
- Seed: automatic or fixed.
- Templates: off by default; optional per-spell assistance marks the coaching report as assisted and excludes the round from difficulty-comparison statistics.

### Glyph Laboratory

No opponent and no combat pressure.

- Select any unlocked spell.
- Full, dotted, start-only, or no template.
- Show recognition score, second match, ambiguity margin, duration, and error reason.
- Replay a canonical ghost trace.
- Compare against current loadout or the full catalog.
- Spawn statuses and environments to inspect spell effects.

### Online Duel

Unchanged. Solo settings never alter online recognition or combat rules.

## 4. Mobile learning constraints

The tutorial must work on a six-inch landscape phone:

- Introduce one primary new concept per lesson.
- Reuse at most one prior concept in the same objective.
- Present narration before input becomes active.
- Hide narration while the player draws.
- Keep the drawing pad free of persistent text and buttons.
- Put objectives in the opposite-side coach panel and mirror it in left-handed mode.
- Disable round timers until the formal duel lesson.
- Keep lessons within a 2-5 minute target.
- Provide a checkpoint after every lesson.
- Use semantic HTML for narration, objectives, buttons, and reports.
- Use icon, shape, text, sound, and optional haptics rather than color alone.
- Preserve threat outlines through Fog, Blind, Veil, and visual clutter.

## 5. Progressive guide system

Each spell has a locally persisted guide stage:

| Stage | Name | Display |
| --- | --- | --- |
| 0 | Full | solid path, start dot, arrow, one ghost demonstration |
| 1 | Dotted | dotted path and start dot |
| 2 | Start | start dot and short direction mark |
| 3 | None | blank pad |

Rules:

- First exposure starts at Full.
- One successful deliberate trace advances one stage when allowed by the lesson.
- A lesson may require the final cast with no guide.
- Remediation may temporarily regress one stage.
- Reduced-motion mode replaces ghost animation with a static solid path.
- Left-handed layout moves the pad but does not reverse the canonical spell direction.
- The guide geometry comes from the same template data used by recognition.
- Practice Laboratory may pin a guide stage.
- Guide locking allows campaign completion but disables mastery medals for affected objectives.

## 6. Tutorial data model

Tutorial content is declarative:

```js
{
  id: 'L07',
  chapter: 'core',
  title: 'Rain Conducts',
  order: 8,
  narration: [
    'Rain creates a shared Wet zone.',
    'Lightning becomes stronger there for either wizard.'
  ],
  playerLoadout: [32, 3, 13, 10],
  opponentLoadout: [32, 3, 10, 13],
  taughtSpells: [
    { id: 32, enterStage: 0, exitStage: 2 },
    { id: 3, enterStage: 1, exitStage: 3 }
  ],
  timerEnabled: false,
  botScript: 'rain-conducts',
  objectives: [
    { id: 'make-wet', text: 'Create a Wet zone', predicate: 'zone:self:Wet' },
    { id: 'conduct', text: 'Trigger Conductive Arc', predicate: 'reaction:ConductiveArc' },
    { id: 'escape', text: 'Avoid the return lightning', predicate: 'evade:return-lightning' }
  ],
  medal: { id: 'L07-gold', predicate: 'conduct-without-being-soaked' },
  remediation: ['regress-guide', 'slow-script', 'show-ghost']
}
```

Every objective predicate is registered in a pure objective library. Unknown predicates fail tests and cannot silently do nothing.

## 7. Tutorial state machine

`TutorialRunner` controls:

1. `INTRO`: narration, objective preview, inert controls.
2. `CALIBRATE`: first-run line, circle, and V calibration.
3. `ARMING`: configure loadouts, recognizer, guide, script, and checkpoint.
4. `ACTIVE`: run the fixed-tick local simulation and evaluate events.
5. `ATTEMPT_FAILED`: explain the exact failure after input release.
6. `REMEDIATE`: increase assistance without auto-completing the action.
7. `SUCCESS`: award completion/medal, save, and advance.
8. `PAUSED`: freeze safely after backgrounding or native back.

The runner consumes simulation events rather than duplicating combat logic.

## 8. Failure and remediation

Friendly recognition messages:

| Reason | Player message |
| --- | --- |
| too-few-points | Hold and draw a longer stroke across the pad. |
| below-threshold | Follow the shape from the start dot in the shown direction. |
| ambiguous | Make the defining corner, loop, or direction more distinct. |
| wrong-spell | That was a valid glyph, but this objective needs the highlighted spell. |
| no-templates | Internal content error; log and block release. |

Remediation ladder:

1. Repeat with the same guide.
2. Regress the guide one stage.
3. Slow the scripted instructor.
4. Offer a canonical ghost replay.
5. Enable trace-over-ghost with the player still drawing.

No lesson auto-casts for the player. No lesson can become permanently unwinnable.

## 9. Tutorial campaign

### Prologue - The Ink Awakens

Teach:

- hold to draw,
- release to submit,
- two-finger Break Trace,
- trace feedback,
- first-person opponent view.

Spell: Ember Bolt.

Pass:

- land three Ember Bolts,
- advance Full -> Dotted -> Start -> None,
- final cast has no template.

### Lesson 1 - Aether Breath

Teach:

- Aether regeneration,
- overspending,
- recovery,
- Brace.

Pass:

- damage the target,
- preserve at least 20 Aether,
- Brace one telegraphed bolt.

### Lesson 2 - The Moving Line

Teach:

- movement arc,
- Sidestep charges,
- projectile travel,
- moving while drawing.

Spell: Stone Shard.

Pass:

- evade two projectiles,
- land Stone Shard during the opening.

Medal clue:

- finish without emptying both Sidestep charges.

### Lesson 3 - Wards and Angles

Teach:

- directional Ward,
- defensive timing,
- attacking around a Ward.

Spells: Ward, Flame Wave.

Pass:

- block 20 damage,
- move outside the instructor's Ward angle,
- land Flame Wave.

### Lesson 4 - Clean Hands

Teach:

- Burning,
- Chilled,
- Dispel priority,
- direct damage versus removable status.

Spells: Frost Lance, Dispel.

Pass:

- Chill the instructor,
- cleanse Burning,
- avoid wasting Dispel on plain damage.

### Lesson 5 - Focus Under Fire

Teach:

- Sigil Charges,
- Focus vulnerability,
- charge decay,
- interruption.

Spell: Concussive Blast.

Pass:

- gain one charge safely,
- interrupt the instructor's Focus.

### Lesson 6 - Mark and Release

Teach:

- setup and payoff,
- Marked,
- defensive waiting,
- burst action windows.

Spells: Amplify, Arcane Missile.

Pass:

- apply Mark,
- wait through a defense,
- consume Mark with Arcane Missile.

Drill: Sunder.

### Lesson 7 - Rain Conducts

Teach:

- shared Wet zones,
- Soaked,
- Conductive Arc,
- weather benefiting both players.

Spells: Rain Glyph, Spark Dart.

Pass:

- create Wet,
- trigger Conductive Arc,
- escape return lightning.

Drills: Chain Lightning, Thunderclap.

### Lesson 8 - Fire Changes the Ground

Teach:

- Oil,
- Flash Fire,
- Rain counter,
- two-zone ownership limit.

Spells: Oil Script, Ember Bolt, Rain Glyph.

Pass:

- ignite one Oil zone,
- wash away another before ignition.

Medal clue: Phoenix Covenant.

### Lesson 9 - The Cold Lock

Teach:

- Chilled prerequisite,
- Frost Bind,
- Tenacity,
- Root versus Freeze,
- Blink.

Spells: Frost Lance, Frost Bind, Blink.

Pass:

- perform one legal Freeze,
- Blink away from the follow-up,
- observe Tenacity block a chain.

Drills: Ice Comet, Entangle.

### Lesson 10 - Wind Answers

Teach:

- Gust deflection,
- Fog clearing,
- Oil movement,
- heavy attacks that Gust cannot stop,
- visual effects that do not alter input mapping.

Spells: Gust Wall, Fog Cloud.

Pass:

- deflect a light projectile,
- clear Fog,
- move away from a heavy Stone Shard.

Drills: Veil Hex, Eclipse Glare.

### Lesson 11 - Cover and Ruin

Teach:

- Stone Wall,
- line of sight,
- safe Focus,
- Quake,
- cover destruction,
- traps.

Spells: Stone Wall, Quake.

Pass:

- Focus safely behind cover,
- destroy the instructor's cover during Focus.

Drills: Fireball, Rune Snare.

### Lesson 12 - First Formal Duel

Teach:

- loadout construction,
- 14-point budget,
- school/heavy limits,
- timer,
- Arcane Pressure,
- post-match coaching.

Pass:

- build or select a legal loadout,
- win one legal round against the fair Easy AI.

Reward:

- ranked readiness,
- all public spells available in loadout construction.

### Academy 13 - Resource War

Spells:

- Aether Surge,
- Aether Leech,
- Weaken,
- Haste,
- Grounding Mantle,
- Sloth Hex.

Goal:

- decide when economy is safe,
- counter Storm with Grounding,
- preserve enough Aether to defend.

Mirror clue:

- inspect the figure-eight carving,
- make the bot defend against two canceled heavy tells.

### Academy 14 - Reading Resonance

Spells:

- Ember Attunement,
- mixed elemental loadout.

Goal:

- build repeated resonance,
- deliberately change schools,
- trigger multiple environment reactions.

Prismatic clue:

- discover five distinct reactions.

### Academy 15 - Reflection Trial

Spells:

- Reflect,
- Arcane Missile,
- Fireball,
- Barrier Dome.

Goal:

- reflect a legal projectile,
- refuse the Fireball reflect trap,
- use Barrier or movement instead.

### Academy 16 - The Eight Schools Examination

Goal:

- play a best-of-three against Medium AI,
- use two different legal loadouts,
- demonstrate adaptation.

### Final Exam

1. Gesture gauntlet: 10 of 12 accepted without templates.
2. Five tactical scenarios: pass four.
3. Best-of-three against Medium AI.
4. Optional Grandmaster retry against Hard AI.

The final exam does not revoke ranked readiness.

## 10. Spell coverage

Core lessons and drills cover all 36 public spells. Secret trials cover:

- Mirror Twin,
- Hourglass Field,
- Phoenix Covenant,
- Prismatic Beam.

A release test asserts that tutorial/drill/trial coverage equals spell IDs 1 through 40.

## 11. Secret spell discovery

Secrets are optional mysteries, never competitive paywalls.

### Mirror Twin

Clues:

- figure-eight carving in Academy 13,
- bait two defensive reactions with canceled heavy tells.

Trial:

- draw Mirror Twin,
- use the decoy to absorb the intended projectile.

### Hourglass Field

Clues:

- Lesson 2 medal,
- inspect the stopped academy clock.

Trial:

- alter projectile timing with Hourglass and survive the sequence.

### Phoenix Covenant

Clues:

- Lesson 8 medal,
- finish a round at one health.

Trial:

- activate the visible covenant,
- bait a small hit,
- survive a committed lethal attack.

### Prismatic Beam

Clues:

- trigger five reactions,
- cast from at least four schools in one round.

Trial:

- build mixed resonance,
- draw the six-segment glyph,
- complete the channel without exceeding the damage cap.

After discovery, the codex reveals full statistics and counters.

## 12. Progress storage

Local key: `aeg.solo.v1`.

```json
{
  "schemaVersion": 1,
  "currentLessonId": "L07",
  "completedLessons": ["PROLOGUE", "L01", "L02"],
  "spellGuideStage": { "1": 3, "4": 2, "10": 1 },
  "medals": { "L02-gold": true },
  "clues": { "hourglassMovement": true },
  "secretsFound": { "37": false, "38": false, "39": false, "40": false },
  "rankedReady": false,
  "calibration": {
    "hand": "right",
    "guideScale": 0.84,
    "comfortableDurationMs": 720
  },
  "practice": {
    "difficulty": "medium",
    "opponentPreset": "auto",
    "coaching": "detailed"
  },
  "stats": {
    "lessonAttempts": {},
    "rejectionReasons": {}
  }
}
```

Requirements:

- versioned migrations,
- validation on load,
- safe reset on corruption,
- save after every lesson and exam stage,
- preserve calibration when possible,
- clear through Delete My Data,
- update the in-app deletion confirmation and `client/account-deletion.html` to name tutorial progress, calibration, medals, clues, secret discoveries, and local coaching statistics,
- no live combat state stored.

## 13. Practice AI fairness contract

All tiers:

- use legal loadouts,
- use the same Sim intent path,
- spend the same resources,
- obey cooldowns and charges,
- obey Tenacity and zone limits,
- receive no stat modifiers,
- receive no hidden player cooldown information,
- have non-zero perception delay,
- model gesture misses,
- use seeded RNG only.

## 14. Practice AI profiles

| Property | Easy | Medium | Hard |
| --- | --- | --- | --- |
| Perception delay | 450 ms | 280 ms | 150 ms |
| Offensive replan | 500 ms | 267 ms | 133 ms |
| Planning horizon | current action | about 1 second | about 2.5 seconds |
| Gesture score mean | 0.68 | 0.82 | 0.93 |
| Gesture score spread | 0.12 | 0.08 | 0.05 |
| Intentional mistake rate | 22% | 10% | 3% |
| Counter knowledge | basic | common | complete |
| Combo knowledge | one-step | selected two-step | all legal two-step |
| Adaptation | none | cast-frequency memory | timing and school memory |
| Loadout policy | beginner preset | soft-counter preset | legal counter-build |

Hard remains human-reactable and imperfect.

## 15. AI perception

The AI records when a visible threat first appears:

```js
seenProjectiles.set(projectileId, sim.tick + perceptionDelayTicks);
seenCastStarts.set(casterId, sim.tick + perceptionDelayTicks);
```

Until the notice tick:

- it cannot react to that projectile,
- it cannot counter the windup,
- it may continue a now-bad plan.

The AI may read:

- visible projectiles,
- visible cast school/tell after its delay,
- visible statuses,
- visible zones,
- public loadouts when configured,
- its own resources and cooldowns,
- observed prior casts.

It may not read:

- future intents,
- raw player input before release,
- hidden cooldown timers,
- random outcomes not yet resolved.

## 16. AI gesture execution

Before every cast, sample a deterministic gesture score.

- Score below recognizer threshold becomes a rejected cast.
- Rejected casts receive the same recovery and rejection counter as the player.
- Accepted scores map to the same 0.90-1.05 potency function.
- Hard has a low miss rate but never a guaranteed perfect cast.

The quality mapping is extracted into a shared module used by player and AI.

## 17. AI planning and knowledge

### Easy

- Uses a beginner preset chosen without inspecting the player.
- Reacts late.
- Knows simple projectile defense, one cleanse, and Chill -> Freeze.
- Makes plausible mistakes such as dodging the wrong direction, using a weaker spell, or focusing at a bad time.
- Does not adapt during the round.

### Medium

- Selects a legal preset that broadly answers the player's visible schools.
- Plans one exchange ahead.
- Understands Chill -> Freeze, Static/Soaked -> Thunderclap, Mark -> payoff.
- Avoids obvious hazards.
- Tracks which schools the player has used most often.
- Preserves a defensive Aether reserve some of the time.

### Hard

- Builds a legal 8-spell, 14-point loadout through the same validator.
- Plans setup, payoff, and retained defense.
- Uses all documented counters and reactions.
- Adapts to observed spell timing and school frequency.
- Varies payoff timing and may feint.
- Avoids self-destructive zone interactions.
- Never reacts instantly or accesses hidden state.

## 18. AI loadout construction

### Easy

Random seeded choice among beginner-safe legal presets.

### Medium

Score existing presets against the player's visible school distribution and select the highest legal score with seeded tie breaking.

### Hard

Construct a legal loadout that:

- has eight unique spells,
- stays at or below 14 points,
- has no more than two 3-point spells,
- has no more than three spells from one school,
- contains at least one defensive answer,
- contains at least one coherent setup/payoff pair,
- contains a cleanse or mobility answer when the player uses control,
- contains Grounding when Storm is strongly represented.

Every generated loadout must pass `validateLoadout`.

If Hard's preferred constraint set produces no legal build within its bounded deterministic search, it falls back to the highest-scoring legal curated preset. It never loops indefinitely or emits an invalid loadout.

## 19. Plausible AI mistakes

Difficulty misses produce visible bad choices rather than inactivity:

- dodge the wrong way,
- cast a cheap poke instead of the best payoff,
- Focus before fully noticing a threat,
- consume a setup too early,
- waste a defensive spell on a feint,
- remain in a shared zone too long,
- fail a gesture and receive reject recovery.

The AI never intentionally performs an illegal action.

## 20. Practice coaching

The round records a non-draining event log for a pure coaching reducer.

Report:

- casting acceptance and rejection reasons by spell,
- damage per Aether,
- defensive opportunities used/missed,
- Focus completions and interruptions,
- charges left unused,
- setup statuses consumed or allowed to expire,
- zones created and exploited,
- counter success,
- one primary recommendation,
- one successful behavior to reinforce.

Examples:

- "Frost Bind was attempted twice without Chilled. Land Frost Lance first."
- "You held three charges for 18 seconds. Spend them before decay."
- "Rain helped the opponent's lightning. Leave Wet ground before they answer."
- "Your Ward blocked 32 damage; keep using it against direct projectiles."

The report is local and stores no raw gesture traces.

## 21. Module plan

New:

```text
client/src/tutorial/campaign.js
client/src/tutorial/runner.js
client/src/tutorial/objectives.js
client/src/tutorial/scriptBot.js
client/src/tutorial/progress.js
client/src/tutorial/secrets.js
client/src/tutorial/medals.js
client/src/ui/coach.js
shared/src/bot/practiceBot.js
shared/src/bot/combos.js
shared/src/gesture/quality.js
shared/src/analytics/coach.js
test/tutorialCampaign.test.js
test/tutorialRunner.test.js
test/tutorialProgress.test.js
test/practiceBot.test.js
test/coaching.test.js
```

Modified:

```text
client/index.html
client/styles/style.css
client/src/app/main.js
client/src/input/gestureInput.js
client/src/game/localMatch.js
shared/src/bot/bot.js
test/browser/smoke.mjs
test/run.js
```

## 22. Implementation sequence

### Solo Phase A - Progress and guide foundation

- versioned progress store,
- calibration,
- guide stages,
- campaign schema validation,
- menu progress UI.

### Solo Phase B - Tutorial runner

- runner state machine,
- objective registry,
- script bot,
- Prologue through Lesson 6.

### Solo Phase C - Full curriculum

- Lessons 7-16,
- public spell drills,
- final exam,
- medals and checkpoints.

### Solo Phase D - Practice AI

- Easy/Medium/Hard profiles,
- perception ledger,
- gesture execution,
- legal loadout selection,
- adaptation and plausible mistakes.

### Solo Phase E - Coaching and secrets

- coaching reducer/UI,
- secret clues/trials/codex,
- Delete My Data integration.

### Solo Phase F - Hardening

- Android layout/accessibility,
- deterministic simulations,
- browser smoke,
- independent code review,
- fixes and final commit.

## 23. Test plan

### Campaign content

- every lesson ID unique,
- every predicate registered,
- every loadout legal for its purpose,
- every guide has a template,
- spell coverage equals IDs 1-40,
- ranked readiness set only by Lesson 12,
- no secret required for ranked readiness.

### Runner

- state transitions deterministic,
- success requires real events,
- wrong spells fail correctly,
- no-input student never auto-completes,
- intended scripted student can complete every lesson,
- remediation prevents soft locks,
- pause/resume restores a checkpoint.

### Progress

- default, save, load, migration, corruption recovery,
- guide-stage persistence,
- medal/clue persistence,
- Delete My Data removes solo profile,
- no combat snapshot stored.

### AI fairness

- every cast passes the same resource/cooldown/charge gate,
- every generated loadout is legal,
- no tier changes player or AI stats,
- no tier has zero perception delay,
- no tier has guaranteed gesture success,
- deterministic same-seed outcomes.

### Difficulty ordering

Across mirrored seeded matches with equal loadouts:

- Hard beats Easy more than 70%.
- Hard beats Medium more than 55%.
- Medium beats Easy more than 60%.
- Side swapping does not reverse ordering.

These are test targets, not hidden stat tuning.

### Gesture execution

- Easy empirical miss rate is materially above Medium.
- Medium empirical miss rate is materially above Hard.
- Hard miss rate remains greater than zero over a large sample.
- Human and AI score-to-potency mapping is identical.

### Coaching

- known mistakes produce the correct recommendation,
- positive behavior is recognized,
- event log is deterministic,
- no raw gesture point storage.

### Browser/Android

- tutorial fully offline,
- practice difficulty selection works,
- AI opponent active at all three tiers,
- left-handed layout,
- reduced motion,
- font scaling,
- portrait warning,
- background pause/resume,
- native back confirmation,
- low-memory restart returns to lesson checkpoint.

## 24. Acceptance gates

The final solo phase is complete only when:

- Tutorial and Practice vs AI work without a network.
- Practice offers exactly Easy, Medium, and Hard.
- Each difficulty uses identical combat rules.
- The tutorial requires real drawn gestures.
- Templates fade and can be remediated.
- All 40 spells have guided coverage.
- Lesson 12 unlocks ranked readiness.
- Secret spells remain optional.
- Progress survives app restart.
- Corrupt progress cannot crash startup.
- Delete My Data removes solo progress.
- Every lesson is completable by an intended-action bot and cannot self-complete.
- Difficulty ordering and determinism tests pass.
- Android browser smoke completes a tutorial lesson and a practice round.
