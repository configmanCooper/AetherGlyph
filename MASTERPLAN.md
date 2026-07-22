# Aetherglyph: Arcane Duels - Master Plan

Version: Planning baseline 1.0  
Platform: Android first, web development build second  
Mode: Real-time 1v1, first-person wizard duel  
Engine: Three.js client, DOM UI, pure deterministic shared simulation  
Service: Node.js and Socket.IO on Render  
Package: Capacitor Android App Bundle

## 1. Executive vision

`Aetherglyph: Arcane Duels` is a touch-native duel in which two wizards face one another across a reactive arena. The player does not press spell buttons. They draw glyphs. The shape, direction, timing, current resource state, active weather, and previous spells determine what is cast and how it behaves.

The spell system is the game:

- Drawing is fast enough for combat but forgiving enough for phones.
- Strong spells require visible setup rather than merely longer cooldowns.
- Weather and terrain are shared resources that either player can exploit.
- Every threatening effect has at least two credible answers.
- Raw drawing speed cannot bypass minimum cast times or server rules.
- The opponent's school, windup, and release remain readable under visual clutter.
- The tutorial teaches the same rules used online, not simplified substitutes.

The intended emotional arc is: recognize, prepare, bait, counter, transform the arena, and finally release a spell whose success was earned several exchanges earlier.

## 2. Audience, business, and session goals

### Audience

- Players who enjoy dueling, buildcraft, prediction, and short competitive matches.
- Touch players who want a system designed for phones rather than desktop controls compressed onto a phone.
- Players who value a complete paid game without advertising or consumable purchases.

### Commercial model

- Google Play price: $0.99, one-time purchase.
- No ads.
- No in-app purchases.
- No paid spell unlocks.
- No randomized progression.
- Cosmetic additions may ship as free updates, but competitive readability takes priority over cosmetic variety.

### Session targets

- Tutorial lesson: 2-5 minutes.
- Practice duel: 3-6 minutes.
- Best-of-three online match: 5-9 minutes.
- Queue target: under 45 seconds in the primary region.
- Reconnect grace: 25 seconds.

## 3. Match structure

### Format

- Best of three rounds.
- 100 health each round.
- Round limit: 105 seconds.
- Aether starts at 60 of 100.
- Sigil Charges start at 0 of 3.
- Arena-created zones reset between rounds.
- Loadouts remain fixed for the match.
- First player to reduce the opponent to 0 health wins the round.

### Anti-stall timeline

- 0-60 seconds: normal duel.
- At 60 seconds, Arcane Pressure begins narrowing the safe combat arc and increases by one step every 10 seconds.
- At 90 seconds, shields lose 20 percent maximum capacity and healing is disabled.
- At 105 seconds, the player with higher health percentage wins.
- Exact tie breakers: damage dealt, successful counters, then a draw round. A match can contain only one draw round; a second tied round becomes sudden death at 1 health each.

Arcane Pressure is symmetric, visually obvious, and never randomly targets one player.

## 4. Touch-first combat controls

### Camera and presentation

- Landscape orientation.
- First-person viewpoint.
- The opposing wizard remains inside a soft camera lock, eliminating the need for simultaneous free-look and glyph drawing.
- The left thumb controls a short lateral strafe arc and forward/back spacing.
- The right side is a large hold-to-draw glyph pad.
- Releasing the pad submits the glyph.
- A quick two-finger tap cancels the current trace before submission.
- Ground placement uses the glyph's final direction and a short confirmation tap; it does not open a second aiming mode.

### Universal actions

These are available to every loadout so no player can be drafted into helplessness:

1. `Focus`: hold the center sigil for 0.95 seconds to gain one Sigil Charge. It costs 3 Stamina/sec, prevents movement, and is visibly interruptible.
2. `Sidestep`: left-thumb flick, costs 5 Stamina and one of two movement charges, 2.5-second recharge each.
3. `Break Trace`: two-finger tap to cancel a glyph with no Aether cost.
4. `Brace`: hold to spend 3 Stamina/sec, reduce incoming damage by 75 percent, and convert 25 percent of the incoming damage into Aether. It cannot reflect or stop crowd control.

Full defenses such as Ward, Reflect, Barrier, Dispel, and Blink remain loadout spells and are materially stronger.

### Layout requirements

- Respect display cutouts and Android gesture insets.
- Left-handed mode mirrors movement and drawing zones.
- Drawing pad size: 42-55 percent of usable screen width, configurable.
- No essential control within 24 dp of a system edge.
- Menus use semantic HTML controls rather than Three.js meshes.
- Statuses use icon, shape, motion, and text; never color alone.
- Haptics, screen shake, motion blur, flashes, and particle density are independently adjustable.

## 5. Casting and recognition model

### Gesture grammar

The roster is built from a small visual language:

| Primitive | Meaning tendency | Typical draw time |
| --- | --- | --- |
| Straight line or flick | direct force, projectile, movement | 0.20-0.40 s |
| Arc or hook | redirection, homing, weakening | 0.35-0.60 s |
| V or X | piercing, breaking, sundering | 0.40-0.70 s |
| Zigzag | electricity and interruption | 0.45-0.75 s |
| Circle | containment, defense, cleansing, zones | 0.55-0.90 s |
| Triangle or square | constructed heavy magic | 0.75-1.10 s |
| Spiral or figure eight | channeling, time, secrets | 0.90-1.40 s |
| Hold | concentration and charge generation | 0.95 s fixed |

Direction matters where it carries meaning. Rotation normalization is disabled for directional glyphs and enabled only for explicitly orientation-free glyphs.

### Recognition pipeline

The client and server use the same pure recognizer:

1. Capture pointer samples only inside the cast pad.
2. Reject samples outside duration, count, velocity, or pad bounds.
3. Remove near-duplicate points and lightly smooth jitter.
4. Resample a single-stroke glyph to 24 points. For multi-stroke glyphs, resample each stroke to 16 points, with a maximum of three strokes and 48 total points.
5. Normalize translation and scale.
6. Preserve direction and aspect ratio features.
7. Compare against equipped spell templates using point-cloud distance, turning-angle sequence, stroke-direction histogram, closure, intersections, duration, and path-length ratio.
8. Accept only when the best score meets the spell threshold and beats the second-best score by the required ambiguity margin.
9. Re-run the same classification on the server.

### Forgiveness rules

- Practice and online duels recognize the full 40-spell roster. The player's eight selected spells are visual guide shortcuts only; tutorials may still scope recognition to the current lesson.
- Each spell has multiple hand-authored and recorded templates.
- Potency from drawing quality ranges only from 0.90 to 1.05. Recognition matters more than artistic precision.
- Fast drawing never shortens a spell below its minimum windup.
- A valid but low-confidence glyph produces a weak cast only in tutorial and casual practice.
- Online matches reject ambiguous traces rather than selecting the wrong spell.
- A rejected trace consumes no Aether but triggers a 0.25-second recovery, preventing rejection spam.
- Accessibility calibration records the player's comfortable trace scale and speed locally; it does not weaken shape requirements.

### Authoritative cast packet

The client sends:

```text
matchId
resumeEpoch
inputSequence
baseServerTick
quantizedPoints[maximum 48]
strokeBreaks
durationMs
localClassificationForDiagnostics
```

The server never trusts the claimed spell. It classifies the points, checks current state, deducts resources, and creates the authoritative spell event.

Limits:

- Maximum 48 points after client resampling.
- Maximum 2 KB payload.
- Maximum 3 submitted attempts per second.
- No physically impossible timestamp, speed, or sequence jumps.
- Repeated machine-perfect traces are an anomaly signal, not an automatic ban.

## 6. Core resources

### Aether: immediate tempo

- Range: 0-100.
- Starts at 60.
- Regenerates at 4 per second.
- Most spells cost 10-45.
- Aether does not regenerate during Focus.
- Aether Leech can drain the target to zero.

Decision: spend rapidly for initiative or reserve enough to answer the opponent.

### Stamina

- Range: 0-100, starts at 100.
- Moving costs 1/sec; Dodge costs 5; Brace and Focus cost 3/sec.
- Regenerates 1/sec whenever not moving.
- Haste raises idle regeneration to 1.5/sec and reduces all Stamina costs by 25 percent.
- Actions fail when their Stamina cost cannot be paid.

### Sigil Charges: visible setup

- Range: 0-3.
- Focus grants one after a vulnerable 0.95-second channel.
- A perfect timed Reflect or interrupt grants half a charge.
- Charges are spent by heavy, amplified, and secret spells.
- One charge decays after 8 seconds without dealing damage, taking damage, countering, or beginning a real cast.
- Charge count is visible to both players.

Decision: invest now while exposed, earn charge through counterplay, or interrupt the opponent's investment.

### Resonance: commitment and interaction

Each completed elemental spell adds one resonance mark of its school to a visible two-mark chain.

- Repeating a school grants a 10 percent Aether discount to the third matching cast, then clears the chain.
- Mixing compatible schools primes an environmental reaction.
- The opponent sees resonance symbols around the caster's hands.
- Defensive, Arcane, and Umbra spells do not build elemental resonance.
- Resonance expires after 7 seconds.

Decision: become efficient but predictable, or switch schools to create a reaction.

## 7. Status and crowd-control rules

| Status | Baseline effect | Primary answers |
| --- | --- | --- |
| Burning | 2 damage/sec for 3 sec; maximum 2 stacks | Rain, Dispel |
| Chilled | 18 percent movement and cast recovery slow for 3 sec | Haste, Dispel |
| Soaked | Lightning deals 25 percent more; removes Burning | leave water, Dispel |
| Static | next channel is interrupted; 3 stacks prime stun | Dispel, wait 3 sec |
| Sundered | 20 percent more direct damage for 4 sec | Dispel, defensive play |
| Weakened | 22 percent less outgoing damage for 4 sec | Dispel |
| Marked | next direct hit gains 35 percent damage, then consumes mark | Dispel, Brace |
| Rooted | cannot move but may cast | Blink, Dispel |
| Frozen | cannot move or cast | preemptive Dispel, Tenacity |
| Stunned | cannot act | Tenacity |

Hard-control safety:

- Maximum single stun or freeze: 1.0 second.
- After hard control ends, Tenacity blocks new hard control for 3.5 seconds.
- Knockback cannot chain more than twice within 4 seconds.
- Blind never produces a black screen; it narrows clarity around the opponent while preserving UI, incoming threat silhouettes, and accessibility outlines.
- No effect changes the physical mapping of the player's drawing input in ranked play. Gesture Hex distorts the visible ink and hides confidence, but the recognizer still reads the real trace.

## 8. Loadouts and strategic identity

### Loadout construction

- Eight spell slots.
- Point budget: 14.
- Common spell: 1 point.
- Advanced spell: 2 points.
- Heavy or secret spell: 3 points.
- Maximum two 3-point spells.
- Maximum three spells from the same school.
- At least one equipped spell must answer projectiles, zones, or statuses; the builder warns but does not force a single exact defense.
- All competitive spells become available before ranked unlock.

### Intended archetypes

| Archetype | Plan | Strength | Weakness |
| --- | --- | --- | --- |
| Ember Rush | cheap pressure, interrupt Focus, finish with Flame Wave | early initiative | efficient wards and Tide |
| Tide Control | Chill, Soak, Freeze, punish movement | tempo denial | Dispel and focused burst |
| Storm Tempo | Static stacks, movement, reaction punishes | interrupts setup | grounding and Stone |
| Stone Warden | cover, Sunder, counter-punch | defense and spacing | Quake, zones, slow starts |
| Gale Trickster | deflect, relocate zones, obscure intent | battlefield control | direct damage race |
| Arcane Combo | Mark, Amplify, precise heavy payoff | high earned burst | telegraphed setup |
| Umbra Attrition | Weaken, Leech, traps, resource denial | long exchanges | rushdown and cleansing |
| Prismatic Hybrid | changes school to exploit shared weather | adaptability | lower raw efficiency |

No archetype may have a verified matchup above 60 percent or below 40 percent over a statistically meaningful sample. The tuning target is 45-55 percent.

## 9. Launch spell roster

The canonical numeric roster is `design/spells.csv`. It contains 40 spells:

- 9 offensive
- 6 defensive
- 5 buffs
- 5 debuffs
- 5 control/incapacitating
- 6 environmental
- 4 secret

Roster rules:

- Every spell has at least two named counter paths.
- Every heavy spell costs at least one Sigil Charge.
- No single resolved cast deals more than 30 direct damage.
- No uninterrupted combo from full health may exceed 45 damage before the defender receives a legal action window.
- Every hard-control payoff requires setup or a charge.
- Zones are limited to two active zones per player.
- Secret spells are unusual, not strictly stronger.

The baseline launch roster is all 40 cataloged spells. If gesture-corpus or balance evidence requires a smaller first release, a formal scope gate may rebaseline launch to no fewer than 24 public spells plus all four secrets. A reduced roster must remove the same spells from the client, server balance data, tutorials, codex, simulation matrix, and launch checklist; it may not leave placeholder or partially tested spells.

## 10. Environmental battlefield

The arena tracks shared states rather than player-owned weather:

- Dry
- Wet
- Burning
- Frozen
- Windy
- Fogged
- Grounded
- Fractured cover

The full reaction table is in `design/environment-matrix.md`.

Core rules:

- Both players can exploit every active environment.
- The arena HUD shows active states and remaining duration.
- Environmental chains stop after two reaction links.
- The same reaction cannot trigger more than once per second.
- Reactions use deterministic priority ordering.
- Crowd control created by an environmental reaction obeys Tenacity.
- Zones have visible borders and high-contrast accessibility outlines.
- Random weather is excluded from ranked. Tutorial or special casual modes may use seeded scripted weather.

## 11. Combat readability and audiovisual language

Every cast has three tells:

1. School tell at windup: hand aura shape and sound family.
2. Intent tell after roughly 40 percent of the trace: opponent hand motion and partial rune silhouette.
3. Release tell: projectile, wave, field boundary, or channel beam.

Minimum reaction design:

- Fast poke: 250 ms windup plus travel.
- Medium spell: 400-650 ms windup.
- Heavy spell: 800-1300 ms windup plus charge tell.
- Reflect window: 400 ms, with meaningful whiff recovery.
- Server validates that a counter submitted before its deadline is resolved fairly under bounded latency compensation.

Clarity budget:

- Enemy cast silhouettes render above particles.
- No more than two persistent zones per player.
- Background particles fade during an enemy heavy windup.
- Screen-space effects cannot hide health, resources, status icons, or trace feedback.
- Each school has distinct geometry and rhythm, not only a color:
  - Ember: expanding wedges and crackle.
  - Tide: flowing ribbons and chimes.
  - Gale: curved streaks and breath.
  - Stone: angular blocks and low impacts.
  - Storm: branching lines and snaps.
  - Arcane: rings and harmonic pulses.
  - Umbra: broken outlines and muted beats.
  - Prismatic: six-segment spectral geometry and a rising multi-tone chord that remains distinct without relying on hue.

## 12. Arena and movement design

### Launch arena: The Confluence

- Circular dueling platform with the opponent across the center.
- Each player moves on a shallow 100-degree arc rather than freely circling behind the other.
- Three destructible waist-high focus stones create temporary line-of-sight decisions.
- Two shallow channels can hold Water or Oil.
- Edge wind vents visibly amplify Gale effects.
- Symmetric layout and spawn positions.
- No random hazards.

Movement is deliberately constrained so drawing, reading, and elemental setup remain central. The game must not become a conventional shooter controlled awkwardly on a phone.

### Later arena policy

New ranked arenas may change cover and environmental opportunities, but:

- remain symmetric,
- retain the same movement arc length,
- cannot contain random damage,
- receive separate side-bias simulation and human testing,
- must not invalidate an entire school.

## 13. Solo tutorial campaign

The full lesson plan is `design/tutorial.md`.

Principles:

- Templates appear only in tutorial and optional practice.
- The player must successfully draw each taught spell, not tap a substitute.
- Each lesson introduces one concept, tests it, then combines it with an earlier concept.
- Templates fade from full line, to dotted guide, to starting point, to no guide.
- The narrator explains why a spell worked or failed.
- The final examinations use legal match rules.
- Ranked unlock requires completion of core lessons, not all optional mastery challenges.
- Secret spells are discovered through optional riddles and combat experiments, then documented in the codex.

## 14. Modes

### Offline

- Guided tutorial campaign.
- Free practice with templates and recognition diagnostics.
- Bot duel with four difficulty levels.
- Spell laboratory for environmental reactions.
- Replay tutorial examples.

### Online

- Private duel code.
- Unranked matchmaking.
- Ranked matchmaking after core tutorial completion.
- Rematch with both-player consent.
- Spectating is post-launch and must use delayed snapshots.

Not planned for launch:

- teams,
- free-for-all,
- voice chat,
- text chat during a duel,
- user-created glyphs,
- paywalled spells,
- random spell drafts in ranked.

## 15. Bot design

The bot uses the same simulation actions and resource rules as a human.

Difficulty changes decision quality, not hidden statistics:

- Apprentice: slow reactions, obvious single-spell plans, template coaching.
- Adept: understands basic counters and one-step reactions.
- Magus: builds charges, reads resonance, uses two-step setups.
- Archmage: evaluates expected value, feints setup, preserves counters, and adapts to the player's loadout.

The bot does not need to draw raw touch paths during normal simulation. Gesture success is modeled from a configurable error profile. A separate recognizer bot emits recorded human traces to test end-to-end casting.

## 16. Technical architecture

### Repository shape

```text
Aetherglyph/
  android/
  client/
    index.html
    src/
      app/
      input/
      render/
      ui/
      audio/
      net/
      tutorial/
  server/
    src/
      gateway/
      matchmaking/
      matches/
      persistence/
  shared/
    src/
      balance/
      gesture/
      protocol/
      sim/
      rng/
  test/
    unit/
    sim/
    server/
    browser/
    android/
    load/
  scripts/
  play-assets/
  render.yaml
  capacitor.config.ts
  package.json
```

### Shared deterministic core

`shared/src/sim` must:

- import no DOM, Three.js, Socket.IO, or Capacitor APIs,
- advance through fixed ticks,
- use deterministic seeded RNG,
- use integer or fixed-point authoritative values,
- accept validated intents,
- emit domain events,
- serialize complete snapshots,
- replay from seed plus ordered inputs,
- produce state hashes for divergence checks.

This follows the strongest pattern in Fish Friends: game logic remains headless and rendering consumes emitted events.

### Client

- Three.js renders arena, opponent, hands, projectiles, zones, and weather.
- HTML/CSS renders menus, health, resources, statuses, settings, codex, and trace overlay.
- Client predicts local movement and cast windup only.
- Damage, status, resource deduction, projectile outcomes, and wins wait for server authority.
- Renderer interpolates server snapshots and corrects prediction smoothly.
- Offline tutorial hosts the same shared simulation locally.

### Server

- Node.js LTS.
- Express health/static endpoints.
- Socket.IO for WebSocket transport and fallback handling.
- Authoritative 30 Hz match simulation.
- Snapshot/delta delivery at 10-15 Hz.
- Version and protocol checks during connection.
- Strict Origin allowlist.
- Payload caps and per-event acknowledgements.
- Graceful SIGTERM drain for Render deploys.
- One process owns each live match.

### Persistence

Launch may use:

- Render Postgres for account, MMR, result, sanctions, and deletion records.
- Render Key Value for queue entries, short-lived resume tickets, owner leases, and recent recoverable snapshots.
- Versioned IndexedDB/local storage for settings, tutorial progress, calibration, and offline replays.

Live combat state is never accepted from client storage.

## 17. Networking and match recovery

### Connection flow

1. Client requests a short-lived one-use WebSocket ticket over HTTPS.
2. Server validates app build, protocol, account/session, and region.
3. Matchmaker pairs compatible MMR and ping.
4. Match owner creates a seeded state and sends a signed start snapshot.
5. Clients send sequenced intents.
6. Server sends acknowledged tick, state delta, and correction reason.

### Latency policy

- Target ranked ping: under 120 ms.
- Warning: 120-180 ms.
- Ranked queue rejects sustained ping above 180 ms; private/unranked may continue with warning.
- Bounded rewind for aimed collision checks: maximum 150 ms.
- Never rewind through invulnerability, death, or a state the caster could not have observed.
- Gesture recognition itself is not predicted as authoritative.

### Reconnect

- Persist stable client ID and one-use resume ticket.
- On background or disconnect, stop accepting new local casts.
- Reconnect with exponential backoff.
- Present match ID, resume epoch, and last acknowledged tick.
- Receive a full authoritative snapshot.
- Grace period: 25 seconds.
- One disconnect per player per round may receive the full grace; repeated disconnects shorten to 10 seconds to prevent abuse.
- Server deploy drain snapshots active matches and tells clients to reconnect.

Render reconnects are not assumed to return to the same instance. Horizontal scaling therefore requires match ownership leases and fencing tokens before it is enabled.

## 18. Security and fair play

- Server validates every state transition.
- Schema validation on every packet.
- Maximum payload sizes and backpressure.
- Rate limits by account, connection, and IP.
- Short-lived auth and resume tokens.
- No secrets in app assets.
- Parameterized database queries.
- Strict security headers and minimum permissions.
- Deterministic replay logs store actions and classifications, not raw high-resolution touch biometrics.
- Raw gesture paths are discarded after validation unless a player explicitly opts into a short-lived bug report.
- Play Integrity is a risk signal, never sole proof of cheating.
- Macro detection considers impossible regularity, reaction distribution, and repeated exact paths; bans require multiple signals or review.
- No gameplay chat at launch, reducing moderation and privacy surface.

## 19. Android package and Play release

### Package

- Capacitor Android application.
- Proposed application ID: `com.cooperunlimitedgames.aetherglyph`.
- Minimum Android: API 24 unless device testing proves a higher floor is required.
- Target Android: API 36.
- Release artifact: signed Android App Bundle.
- Play App Signing enabled.
- Upload key stored outside source control and backed up securely.

### Permissions

Required:

- Internet.
- Network state if needed for connection UX.
- Vibration only if Capacitor haptics requires it.

Not requested:

- camera,
- microphone,
- location,
- contacts,
- photos,
- broad storage access.

### Store obligations

- Paid app set to $0.99 before production release.
- Accurate Data Safety form.
- Privacy policy and account deletion page if online accounts are used.
- In-app account deletion.
- Content rating.
- Internal, closed, and open test tracks before production.
- Pre-launch report on low-memory and current Android devices.
- Phone screenshots generated from deterministic showcase scenarios.

## 20. Performance budgets

### Launch targets

| Area | Budget |
| --- | --- |
| Low tier frame rate | stable 30 fps |
| Medium/high frame rate | 60 fps where sustainable |
| Visible triangles | under 150,000 |
| Draw calls | under 100 |
| Persistent lights | one directional plus baked/emissive accents |
| Real-time shadows | off on low, one cheap shadow on higher tiers |
| Device pixel ratio | adaptive, capped 1.0-1.75 by tier |
| Texture format | KTX2/ETC2, mostly 1024 px or lower |
| Initial download target | under 150 MB |
| Warm match load | under 5 seconds on target mid-tier device |

Implementation:

- object pools for projectiles and particles,
- instancing and atlases,
- adaptive render scale,
- particle density tiers,
- no gameplay-essential post-processing,
- pause rendering and audio on background,
- recover cleanly from WebGL context loss,
- test thermal throttling over 20-minute sessions.

## 21. Audio and haptics

- Unlock WebAudio on first intentional touch.
- Each school has a readable audio family.
- Enemy heavy casts have unique low-frequency warning rhythm plus visual equivalent.
- Haptics distinguish accepted glyph, rejected glyph, counter, damage, and round end.
- Haptics never reveal hidden information.
- Audio pauses on background and resumes only when appropriate.
- Master, music, effects, voice, and haptics controls persist locally.

## 22. Testing strategy

### Unit

- Gesture resampling and normalization.
- Template scoring and ambiguity boundaries.
- Spell costs, cooldowns, status durations, and counters.
- Environmental reaction priority.
- Fixed-point math and seeded RNG.
- Serialization and migrations.
- Protocol validation and payload limits.

### Determinism and replay

- Same seed plus inputs yields same hash on client and server.
- Replay completes with no divergence.
- Snapshot restore yields the same future outcome.
- Process restart recovery resumes from the last durable snapshot.

### Balance simulation

- Rule-based bot for each strategic archetype.
- Every loadout pair runs across mirrored sides and multiple seeds.
- Minimum 10,000 automated matches before closed alpha.
- Flag archetype matchups outside 40-60 percent.
- Target 45-55 percent before ranked launch.
- Detect repeated dominant action loops, infinite shields, resource locks, hard-control chains, and no-progress states.
- Confirm every match ends by damage, timer, surrender, or disconnect policy.

### Gesture corpus

- Record consenting traces from multiple hand sizes, screen sizes, left/right hands, stylus excluded and included as separate profile.
- Split training and validation users; never test on the same person's templates used for tuning.
- Per-spell target: at least 95 percent acceptance for deliberate valid traces.
- Online wrong-spell rate target: below 0.5 percent.
- Ambiguous traces reject rather than miscast.
- Test motor-accessibility calibration without creating competitive automation.

### Server and network

- Duplicate, reordered, stale, future, malformed, and oversized input.
- Disconnect during Focus, heavy cast, round end, and match end.
- 1-20 percent packet loss, 20-300 ms latency, jitter, and process death.
- Render deploy drain.
- Split-brain ownership prevention.
- Origin and protocol mismatch rejection.
- Queue abandonment and reconnect abuse.

### Browser and Android

- Playwright smoke and interaction flows.
- Real Android pointer capture, system back, rotation lock, cutout, font scale, TalkBack, audio unlock, background/resume, low-memory kill, offline tutorial, update-required flow, and WebGL context loss.
- Test a low-end API 24 device/emulator, representative mid-tier device, current flagship, tablet, and foldable layout.

## 23. Telemetry and balance governance

Collect only what is needed:

- pseudonymous account,
- app/protocol version,
- device performance tier,
- region and latency bucket,
- match result and duration,
- loadouts and spell event IDs,
- counter success,
- rejection reason bucket,
- crash and frame-time summaries,
- disconnect/reconnect outcome.

Do not collect raw touch paths by default.

Balance dashboard:

- pick rate,
- win rate when equipped,
- win rate when cast,
- damage/Aether,
- status uptime,
- counter success rate,
- rejection rate,
- matchup matrix by skill bracket,
- average round duration,
- stall and surrender rates.

Patch gates:

- No balance conclusion below a useful sample size and confidence interval.
- Numeric hotfixes may adjust cost, cooldown, damage, and duration.
- Gesture shape changes require migration, tutorial update, recognizer corpus rerun, and explicit patch notes.
- Structural changes receive a new protocol/balance version and cannot silently mismatch clients.

## 24. Independent review findings incorporated

### Balance review changes

- Added Sigil Charge decay to stop charge banking behind defenses.
- Added 45-damage uninterrupted-combo cap.
- Added Tenacity and knockback diminishing returns.
- Protected enough Aether for a universal emergency defense.
- Limited active zones to two per player.
- Made Barrier prevent offensive casting while active.
- Required two counters for every spell.

### Strategy review changes

- Capped loadouts at eight spells to protect readability.
- Added soft matchup targets instead of hard counters.
- Added three-stage cast telegraphs.
- Made all ranked environmental states symmetric and deterministic.
- Added anti-stall Arcane Pressure.
- Kept secret spells out of paywalls and documented them after discovery.
- Added archetype-by-archetype bot simulation.

### Mobile/network review changes

- Removed simultaneous manual camera aiming; soft lock preserves the first-person view while drawing.
- Shared the recognizer between client and server.
- Made server classification authoritative.
- Added screen-size calibration, left-handed layout, and accessibility requirements.
- Added protocol limits, reconnect epochs, durable snapshots, and Render ownership rules.
- Chose Capacitor rather than a PWA wrapper for the Play binary.

### Reference-project lessons

- From Fish Friends: keep simulation DOM-free and test it headlessly with bots.
- From Garden and Griddle: reuse phone-first Capacitor, Android back handling, build scripts, origin restrictions, build/protocol checks, and Play publishing discipline.
- From Four Pillars: use an authoritative Socket.IO room/match manager, deterministic server simulation, snapshots, health endpoint, and Render blueprint.

The detailed source notes and reviewer reservations remain in `reviews/`.

## 25. Implementation milestones

### Milestone 0 - Repository and quality foundation

Deliver:

- npm workspace or equivalent package layout,
- TypeScript configuration,
- shared lint/test/build commands,
- pure deterministic simulation skeleton,
- seeded RNG,
- protocol versioning,
- CI,
- Render health endpoint,
- Capacitor shell.

Exit:

- client, server, shared tests run from one command,
- Android debug build opens offline,
- deterministic smoke replay passes.

### Milestone 1 - Gesture laboratory

Deliver:

- touch capture,
- trace renderer,
- normalization/scoring,
- template editor available only in development,
- eight initial spells,
- ambiguity UI,
- calibration flow,
- corpus test runner.

Exit:

- target acceptance and wrong-spell rates met on representative phones,
- no dependence on frame rate or screen resolution,
- server reproduces client classifications.

### Milestone 2 - Offline vertical slice

Deliver:

- The Confluence arena,
- first-person opponent,
- movement arc,
- health/Aether/Focus,
- eight spells spanning all core categories,
- one environment reaction,
- Apprentice bot,
- first three tutorial lessons,
- audio/haptics,
- performance tiers.

Exit:

- complete offline round on Android,
- stable 30 fps low tier,
- headless matches always terminate.

### Milestone 3 - Full spell simulation

Deliver:

- the launch-approved public roster, baseline 36; any reduction requires the formal scope gate in Section 9,
- statuses and Tenacity,
- environmental matrix,
- loadout builder,
- four bot levels,
- replay and state hashes,
- balance batch runner.

Exit:

- no detected infinite loop or hard lock,
- all launch-roster spells have tested counters,
- matchup matrix within broad 40-60 percent guardrail.

### Milestone 4 - Online closed alpha

Deliver:

- ticketed connection,
- matchmaking/private rooms,
- authoritative 30 Hz matches,
- prediction/interpolation,
- reconnect,
- results,
- Render deployment,
- load and failure tests.

Exit:

- two real Android devices complete repeated matches,
- reconnect and deploy drain recover correctly,
- no client can create illegal damage/resource state.

### Milestone 5 - Tutorial, secrets, and ranked

Deliver:

- full tutorial campaign,
- codex,
- mastery trials,
- four secret spells,
- MMR,
- ranked eligibility,
- reports and sanctions,
- post-match coaching.

Exit:

- new player can finish core tutorial without external explanation,
- all competitive spells available before ranked,
- secrets are discoverable and not stronger by default.

### Milestone 6 - Play hardening

Deliver:

- privacy policy and deletion flow,
- signed AAB,
- store assets,
- closed testing,
- accessibility pass,
- device matrix,
- thermal/battery profiling,
- production monitoring and support tooling.

Exit:

- Play pre-launch issues resolved,
- target API and signing confirmed,
- crash-free and performance gates met,
- production rollback procedure rehearsed.

### Milestone 7 - Soft launch and balance gate

Deliver:

- staged regional release,
- live dashboards,
- queue/capacity monitoring,
- balance patch process,
- public release checklist.

Exit:

- stable service and acceptable queue times,
- no archetype or spell exceeds launch balance thresholds,
- support and deletion requests can be handled,
- production rollout approved.

## 26. Definition of launch-ready

Aetherglyph is launch-ready only when:

- every spell in the formally approved launch roster is implemented and documented,
- the baseline roster contains all 40 cataloged spells, or a recorded scope-gate decision has approved at least 24 public spells plus all four secrets and updated every dependent artifact,
- all public spells are taught or practiced in solo content,
- all secret spells have fair discovery clues and codex entries,
- server authority rejects forged spell names and illegal traces,
- replay determinism passes,
- no hard-control chain exceeds the control budget,
- no combo exceeds the legal burst budget without a defender action window,
- every spell has two demonstrated counter paths,
- all ranked arenas are side-neutral,
- core tutorial works completely offline,
- reconnect works after Android backgrounding,
- low-tier Android holds 30 fps in worst-case legal visual clutter,
- AAB targets API 36 and passes the Play pre-launch report,
- privacy and deletion obligations are complete,
- load testing exceeds expected launch concurrency with headroom,
- balance simulations and closed-test telemetry meet the published gates.

## 27. Primary risks and kill criteria

### Gesture recognition risk

If deliberate valid traces cannot reach 95 percent acceptance while wrong-spell casts stay below 0.5 percent on target devices, reduce the launch roster and redesign conflicting glyphs. Do not hide poor recognition behind wider thresholds.

### Latency risk

If the primary Render region cannot support acceptable ranked reaction windows for the intended market, add regions or delay ranked play. Do not compensate so aggressively that high latency creates an advantage.

### Control overload risk

If players cannot move, read the opponent, and draw comfortably, further constrain movement before adding control complexity. Drawing remains the priority.

### Balance complexity risk

If 40 spells delay a reliable launch, ship 24 fully tested public spells plus four secrets and add the remainder only after their counters and tutorial lessons are ready. Never ship breadth ahead of clarity.

### Hosting cost and scale risk

Measure concurrent match CPU, memory, snapshot bandwidth, and database writes in alpha. Horizontal scaling is not approved until ownership leases, fencing, recovery, and load tests are complete.

## 28. First implementation order

1. Create the shared fixed-tick simulation and event contract.
2. Build the Android touch trace laboratory before polished art.
3. Implement Ember Bolt, Ward, Blink, Dispel, Focus, Rain, Spark Dart, and Stone Wall.
4. Add Wet + Lightning and Burning + Rain reactions.
5. Build one complete offline duel and deterministic replay.
6. Validate recognition and frame budgets on real phones.
7. Only then add authoritative online transport.

This order proves the three highest risks - touch recognition, readable spell interaction, and Android performance - before the full roster or service receives expensive implementation work.
