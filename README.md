# Aetherglyph: Arcane Duels

An Android-first, real-time 1v1 wizard dueling game built around drawing spell glyphs on a touch screen.

## Project status

**Version 1.6.1 — feature complete.** The final solo phase (Practice vs AI +
coaching) is implemented on top of the offline campaign, the authoritative online
service, and the deterministic shared simulation. Version 1.6.0 adds authoritative
100-point Stamina bars and costs for movement, Dodge, Brace, and Focus; Haste
modifies stamina economy; Brace converts damage to Aether; spare Sigil Charges
empower normal spells; Aether Leech can drain to zero; shared Rain progresses
both duelists from Wet to Soaked; Blink breaks homing and AI aim; and Stone Wall,
Ward, and Barrier now physically intercept projectiles. Version 1.5.2 adds broader
Arcane Missile dome templates and a high-confidence forgiving margin, making
strong Arc Up results cast reliably. Version 1.5.1 keeps the Glyph
Lab Enemy control visible by resetting the horizontal guide strip and explains
where to configure scheduled casts and patrol movement. Version 1.5.0 adds programmable
Glyph Lab enemy casts, a real four-second Eclipse Glare whiteout that also removes
Practice AI awareness, opponent-lane two-second Rune Snares, stronger Fog Cloud
obscuration, larger Stone Walls, clearer Frost Bind/Gust directions, and broader
gesture tuning for Fireball, Stone Wall, Veil Hex, and Concussive Blast. Version 1.4.2 separates smooth
circle gestures from angular diamonds using corner-concentration checks and adds
more hand-drawn variants, making Barrier Dome reliable without confusing it with
Grounding Mantle. Version 1.4.1 replaces the raw
spell CSV link with an in-game **Public Spell Roster** containing all 36
non-secret spells, their directional glyph diagrams, costs, cooldowns, detailed
effects, uses, synergies, and counters. Version 1.4.0 rebuilds mobile
control placement: touch labels omit keyboard hints, portrait and landscape action
buttons sit directly above a smaller joystick, landscape draw diagnostics move to
the upper-right, and the installable Render web build supports both orientations.
Android visitors to `*.onrender.com` receive an **Install web app** action in
Settings when Chrome exposes its install prompt. Version 1.3.2 adds a **Redo
baseline calibration** action in Settings, reusing the original line/circle/V
comfort capture and replacing the saved guide scale and pace. Version 1.3.1 reduces tutorial
cooldowns to 35% of their normal values, and lessons requiring the same spell
multiple times reduce them to 8%, removing long waits between teaching casts.
It also redraws Blink as a wide horizontal-first Z and gives Blink/Quake explicit
opening-direction checks, preventing rough Blink traces from becoming Quake.
Practice and online retain full canonical cooldowns. In 1.3.0, Practice and online
duels recognize the **full 40-spell roster**: the selected eight spells are dotted
guide shortcuts only, and every unselected spell remains castable when its normal
Aether, Sigil Charge, cooldown, and setup requirements are met. 1.2.2 makes **Blink conceal its
caster for 3 seconds** while retaining its shorter 1.05s evade window, and raises
Blink's cooldown to 9 seconds. 1.2.1 adds a **persistent
Reflect visual** — a standing, angled mirror-plane guard that shows for the whole
3.6s Reflect window (both duelists) and vanishes the instant a projectile is
deflected — and **rebalances every cooldown** so no persistent protective, buff,
debuff, control or environment spell can be re-applied before its own effect
expires. 1.2.0 was a rendering-only pass that **rebuilds the opposing wizard** as
a clearly readable, front-facing humanoid — it now looks the duelist in the eye
instead of showing its back. 1.1.0 adds a dedicated,
data-driven spell visual-effects system: every one of the 40 spells now has a
unique silhouette and motion (Flame Wave is a travelling wall of flame, Arcane
Missile a ringed rocket, Chain Lightning a branching bolt, etc.) rendered with
pooled Three.js geometry, per-effect budgets, reduced-motion fallbacks, and no
external assets.

The 1.1.0 visual pass also stages the duel inside an **original grand arcane
academy** — a moonlit gothic-magical hall of symmetric stone arcades, tall
arched windows carrying abstract original sigils, hanging banners, distant
towers, floating lanterns, and animated braziers. In 1.2.0 the opponent is a
**readable robed duelist facing the camera**: separated legs and boots under a
layered, trimmed robe with a front placket, belt, chest crest and shoulder
mantle; two articulated arms whose off hand grips a crystal-tipped staff and
whose casting hand extends toward you; and a neck-and-head with an expressive
face (eyes, brows, nose, silver beard) framed — not hidden — by a back-cowl hood
and an asymmetric brimmed hat. A restrained idle animation adds breathing, robe
sway and a head that looks at the player, with static poses under reduced motion.
The three standing guard visuals stay visually distinct: Ward is a frontal
Arcane rune disc, Barrier Dome a layered sphere, and Reflect an angled,
silver/Gale mirror plane with a sharp rotated-diamond silhouette, a rotating
rune-edge of mirrored facets and a central reflection chevron — readable without
masking the opponent or the draw pad. Active statuses now appear directly on both
wizard representations: the opponent gains a pulsing, orbiting aura and the
first-person gloves/wand glow in status-specific colors (fiery orange for Burning,
icy blue for Chilled/Frozen, electric yellow for Static, and distinct colors for
every other buff or debuff). Weather zones now
read as real weather: falling rain with splash ripples, a drifting fog bank, a
sweeping curved wind wall, visibly burning fire, frosty ice, and glossy oil. The
academy stays within a small mobile light/transparent budget and honours the
reduced-motion setting.

Alongside the visuals, the live balance data remains driven only by
`design/spells.csv`. **Ward lasts 12.6s, Barrier Dome lasts 9s, and Reflect
lasts 3.6s**; Blink is invisible for 3s with a 1.05s evade window, Grounding Mantle 15s, Mirror Twin 12s,
Phoenix Covenant 15s, and Stone Wall remains a 24s environmental zone. In 1.2.1
every persistent protective / buff / debuff / control / environment / secret
spell carries a **cooldown of at least twice its active effect duration** while
staying within a deliberate **5–60 second** band scaled to its power — e.g. Ward
26s, Barrier Dome 18s, Reflect 8s, Blink 9s, Stone Wall 48s, Haste 36s, Oil/Rain 42s, Fog
36s, Rune Snare 48s, and Phoenix Covenant the 60s ceiling. These data changes
bump `BALANCE_VERSION`; the rendering itself does not touch the deterministic
simulation or wire protocol.

**Practice vs AI (Solo Phase B) is implemented.** A fully offline single-player
mode offers exactly **Easy, Medium, Hard** against a *fair* AI: every tier drives
the same `Sim` intent path, spends the same resources, obeys the same cooldowns,
charges, Tenacity, zone limits, and loadout rules, draws glyphs through the same
gesture-execution model (a sampled score → the shared `qualityFromScore` potency
mapping, or a below-threshold miss that gets the same reject recovery as the
player), and uses only legal loadouts. Difficulty differs solely through
perception delay (Hard ≥150 ms, Medium ≥280 ms, Easy ≥450 ms), planning horizon,
tier-gated combo/counter knowledge, legal loadout construction (Easy beginner
preset, Medium soft-counter preset, Hard bounded deterministic counter-build with
a legal-preset fallback), observed-event adaptation, plausible mistakes, and
gesture misses — never stats, hidden state, instant reactions, or perfect casts.
A single round with player/opponent loadout selection (opponent shown by default),
standard/untimed, optional fixed seed, and templates-off-by-default (assisted
rounds are marked assisted and excluded from difficulty stats). A pure coaching
reducer (`shared/src/analytics/coach.js`) turns a non-draining round event log
into a local report — casting accuracy, damage/Aether, defensive plays, Focus /
charges, setups, zones/reactions, one improvement and one positive reinforcement —
storing no raw gesture traces. **Glyph Laboratory** remains the no-opponent
recognizer sandbox; **Online Duel** is unchanged and separate.

**Solo Phase A (offline tutorial/campaign)** teaches the real production rules with
real drawn gestures: a Prologue, twelve core Lessons, four Academy lessons, a
fully interactive final exam, public-spell drills, and four secret trials covering
every spell id 1–40. It runs on the real shared `Sim`, the production recognizer,
and real spell effects/statuses/reactions — no tap-to-complete shortcuts. A
deterministic `TutorialRunner` (INTRO → CALIBRATE → ARMING → ACTIVE → ATTEMPT_FAILED
→ REMEDIATE → SUCCESS → PAUSED) consumes simulation events; first run captures an
interactive line/circle/V calibration that tunes guide sizing/comfort only
(recognition thresholds are unchanged); a scripted instructor (`ScriptBot`) creates
legal teaching moments; Academy 16, the Final Duel, and the optional Grandmaster
trial run a real **best-of-three** vs the fair Medium/Hard AI with between-round
checkpoints. The **final exam** is a no-template **Gesture Gauntlet** (draw any 10
of 12 glyphs from memory with the production recognizer and no guide), **five
Tactical Scenarios** using real Sim mechanics (reflect vs heavy, break a freeze
setup, Ward-and-answer, Grounding vs Storm, ignite/douse) of which any four must
pass, the best-of-three **Final Duel**, and an optional **Grandmaster** best-of-three
that grants a persistent Grandmaster title; declarative prerequisite metadata locks
each exam stage in the hub until its threshold is met. A versioned local profile
(`aeg.solo.v1`) checkpoints progress, calibration, guide stages, medals, clues,
secret discoveries, ranked-readiness, Practice settings/results, and coaching
stats with validation, migration, corruption recovery, and Delete My Data support.
Gust Wall now actually deflects light projectiles in the Sim (heavy shots punch
through), so Lesson 10 tests it honestly. Lesson 12 unlocks ranked readiness;
optional academies, the final exam, medals, and secrets never gate it.

**Capacitor Android / Google Play packaging** stages the no-build web app into a
Capacitor `webDir` and builds a signable Android App Bundle (app id
`com.configmancooper.aetherglyph`, API 24 → 36, versionCode 10601 /
versionName 1.6.1). Both the native package and installable web app offer
Auto rotate, Portrait, and Landscape choices in Settings. Online play connects to a configurable authoritative service
(default `https://aetherglyph.onrender.com`); same-origin web deployments stay
same-origin.

**Authoritative online multiplayer** remains: two devices play a real
best-of-three duel through an authoritative Express + Socket.IO server that owns
every match simulation. Casting online is by drawing — the server reclassifies the
gesture (using the same shared `qualityFromScore` mapping) and is the sole
authority over health, resources, spell ids, and results. All 40 spell gestures
are drawable.

- `MASTERPLAN.md` - authoritative product, game, technical, test, deployment, and release plan
- `design/SOLO-MODES-PLAN.md` - solo tutorial / Practice-vs-AI / Glyph Laboratory plan
- `docs/DEPLOYMENT.md` - environment variables, Render blueprint, scaling limits
- `docs/ANDROID.md` - Capacitor packaging, web staging, configurable service URL, scripts
- `PUBLISHING-ANDROID.md` - build/sign/publish flow, Data Safety, release checklist
- `store-listing-android.md` - Google Play listing copy
- `render.yaml` - one-click Render deploy (single instance)
- `design/spells.csv` - implementation-ready launch spell roster
- `design/environment-matrix.md` - shared battlefield reactions and counter rules
- `design/tutorial.md` - complete solo tutorial campaign
- `reviews/` - independent reference, balance, strategy, and mobile/network reviews


## Phase 1 — offline vertical slice

A genuinely playable, Android-phone-first **offline** duel built with vanilla ES
modules + Three.js, **no framework and no build step**. A new player can start,
draw spells, see them cast, deal and take damage, and finish a round against a bot.

### Run it

```bash
npm install          # express + socket.io + three; vendors three.js & socket.io client; generates spell data
npm start            # serves the client AND the authoritative server on http://localhost:8130
# open http://localhost:8130  (use a phone or device emulation, landscape)
```

`npm install` runs `postinstall` which copies `three.module.js` and the Socket.IO
browser client into `client/vendor/` so the game works with **no CDN access**. If
you pull new changes without reinstalling, run `npm run vendor:three`,
`npm run vendor:socketio`, and `npm run gen:spells`.

Health endpoint: `GET /healthz`. Online setup + deployment: see `docs/DEPLOYMENT.md`.

### Play

- **Left pad** = move / strafe the arc; a quick horizontal flick = Dodge (sidestep).
- **Right pad** = draw a glyph; release to cast. Two-finger tap breaks the trace.
- **Focus** (hold) builds a Sigil Charge; **Brace** (hold) is an emergency guard.
- Starter loadout (8 spells): Ember Bolt (→ flick), Frost Lance (↑ line),
  Stone Shard (V), Spark Dart (zigzag), Concussive Blast (arc), Ward (bracket),
  Barrier Dome (circle), Reflect (check mark).
- Modes: **Tutorial** (guided glyph lessons + first-run calibration), **Practice
  vs AI** (single offline round vs a fair Easy/Medium/Hard AI with post-round
  coaching), **Glyph Laboratory** (free draw + recognizer diagnostics, no
  opponent), **Online Duel** (best-of-three vs another device: Quick Match, Create
  Private Duel, or Join Code).
- **Guide shortcuts**: pick any eight dotted guides from all 40 spells or use an archetype preset (Ember Rush,
  Tide Control, Storm Tempo, Stone Warden, Gale Trickster, Arcane Combo, Umbra
  Attrition, Prismatic Hybrid). These shortcuts never limit casting.
- In an offline duel, cast by drawing or by tapping the on-screen cast bar; the
  arena shows environmental zones and both wizards' statuses. **Online duels are
  draw-only** — the server reclassifies every gesture and is authoritative.
- Dev accessibility fallback (offline only): keyboard `1`–`8` quick-cast, `A`/`D`
  move, `F` focus, space to dodge, and optional on-screen quick-cast buttons
  (Settings). The cast bar, keyboard cast, and dev buttons are hidden online.

### Test

```bash
npm test             # headless Node suite (spell gen, determinism incl. zones,
                     # resources, casting/counters, status/Tenacity, all-40 effects,
                     # environment reactions, loadout validation, best-of-three
                     # series, secret spells, bot termination, gesture, all-40
                     # template separation, shared net protocol/remap)
npm run test:server  # authoritative server integration over socket.io-client
npm run test:browser # OPTIONAL headless browser smoke via local Edge/Chrome (WebGL)
npm run test:packaging # staged assets, no CDN, app id/version/API, ignored signing, service worker
npm run gesture:audit # dev tool: gesture separation report (not part of npm test)
```

`npm test` and `npm run test:server` require no browser. `npm run test:server`
spins the authoritative service on an ephemeral port and drives the wire protocol
end-to-end (compatibility rejection, private room create/join, quick match,
invalid loadout, forged spell id ignored, valid trace classified, oversized/
malformed/too-fast rejection, duplicate/stale sequences, authoritative damage/
resource state, reconnect token rotation + resume, disconnect forfeit, match
termination). `npm run test:browser` uses `puppeteer-core` with a locally
installed Edge/Chrome; it boots the client, opens the Online menu and creates a
private room end-to-end, drives the Prologue tutorial through real drawn glyphs,
exercises the final-exam hub locking/unlocking (via seeded profile manipulation)
plus one real no-guide Gesture Gauntlet draw, applies an archetype preset, starts
a best-of-three bot series, draws real glyphs, and asserts a clean running state.

### Architecture (Phase 1)

```
shared/src/          pure, DOM-free, deterministic core (Node + browser)
  rng/               seeded mulberry32 RNG (no Math.random in the sim)
  balance/           spellData.generated.js (from design/spells.csv), loadouts
  sim/               fixed-tick Sim, constants, spell effects, match harness
  gesture/           $1-style recognizer + starter templates
  bot/               deterministic rule-based DuelBot (4 difficulties)
  protocol/          protocol/balance/roster version tags
client/              phone-first, no-framework client
  index.html         import-map + HUD/menu/draw-canvas overlay
  src/render/        first-person Three.js arena + effects
  src/input/         gesture draw pad + movement control
  src/ui/, audio/    HTML HUD, synthesized WebAudio (no external assets)
  src/game/          LocalMatch: fixed-tick driver decoupled from rAF
  vendor/            local three.module.js (git-ignored, vendored on install)
scripts/             generate-spells.js, copy-three.js
test/                Node suite + optional browser smoke
server.js            Express static + /healthz (offline; no online authority yet)
```

The simulation is headless and emits events that rendering/audio/UI consume
(Fish-Friends pattern). It uses a seeded RNG, a fixed tick, and produces state
hashes for replay/divergence checks — ready for Phase 3 authoritative online
multiplayer.

## Phase 2 — full spell simulation (Milestone 3)

Phase 2 turns the vertical slice into the full combat game while keeping the
Phase 1 basic modes (Tutorial, Practice, starter smoke path) intact.

- **All 40 spells are executable.** Every catalog spell has a machine-usable
  effect in `shared/src/sim/spellEffects.js` — offense, defenses, buffs,
  debuffs, control, environmental zones, and all four secrets. Costs, cooldowns,
  charges, and cast times are still sourced from `design/spells.csv` via the
  generated data (no numbers are re-typed). There are no silent no-op spells.
- **Environmental reaction matrix.** `shared/src/sim/reactions.js` +
  `Sim.triggerReactions` implement the deterministic priority order
  (`douse < ground < freeze < conduct < ignite < spread < cover`) for Oil+Ember,
  Oil+Rain, Wet+Storm, Wet+Frost, Frozen+Ember steam/fog, Burning+Rain,
  Burning+Gust, Fog+Gust/Flame, Grounding Mantle, Stone Wall cover, Chilled+Frost
  Bind, Soaked/Static+Thunderclap, and the mixed-resonance Prismatic utility.
  Two zones per player, once-per-second reaction cooldowns, visible durations,
  Tenacity on hard-control reactions, and no recursive chains are enforced.
- **Statuses & buffs for real play.** Soaked, Static, Sundered, Weakened, Marked,
  Rooted, Frozen, Stunned, Sloth, Haste, Aether Surge, Attunement, Grounding,
  Veil, Blinded, Phoenix protection, Hourglass shared slow, and the Mirror decoy
  are all simulated.
- **Guide shortcut builder.** `validateLoadout` requires eight distinct known
  spells only. Point, heavy, school, and defensive-coverage restrictions no
  longer apply because the selection controls visible dotted guides rather than
  cast eligibility. Eight curated themed presets remain available.
- **Best-of-three series.** Rounds reset the arena/statuses/resources while
  preserving both guide layouts; a running series score, per-round transitions, and
  correct rematch/menu behaviour are wired (`Series` / `runSeries` in
  `shared/src/sim/match.js`).
- **Bot pilots any strategy set.** The `DuelBot` categorises its preferred spell pool and
  reasons about setup (chill→Frost Bind, static/soak→Thunderclap), resources
  (charges/Focus), zones (place then ignite), defense (Ward/Reflect/Blink/Dispel),
  and counters (Grounding vs lightning). Four internal levels are kept.
- **Visuals/HUD.** The Three.js arena draws generic zone disks and effects per
  category; the HUD shows statuses (buffs vs debuffs), active zones + durations,
  the series score, and an on-screen bar for the eight selected guide shortcuts.

### Known Phase 2 limitations

- The comprehensive tutorial campaign, codex, secret-unlock progression, and the
  full AI-practice expansion are intentionally deferred to the final solo phase;
  secrets are freely selectable for development.
- Arena visuals remain functional, readability-first placeholders.
- Sim uses floating-point with quantized hashing; fixed-point is a later item.

## Phase 3 — authoritative online multiplayer (Milestone 4)

Phase 3 turns the offline slice into a genuinely playable two-device online
duel while preserving the deterministic shared simulation and all offline modes.

- **Authoritative server.** `server.js` is now Express + Socket.IO. It still
  serves the static client/shared/design modules and `/healthz`, and adds a
  hardened connection gate: a strict configurable **Origin allowlist** (env
  `ALLOWED_ORIGINS`) with localhost/dev + private-LAN support, a
  **protocol/balance/roster compatibility gate**, bounded payloads
  (`maxHttpBufferSize`), security headers, per-event **acknowledgements**, and a
  graceful **SIGTERM drain** for Render deploys.
- **Server owns each match.** `server/matchRoom.js` runs the exact same
  deterministic shared `Sim` at its fixed tick, validates sequenced intents,
  advances the best-of-three series, and broadcasts personalized snapshots +
  domain events at a bounded 15 Hz. Clients never set health, resources, spell
  ids, or results. `server/roomManager.js` owns private rooms (create/join by
  short code), a **quick-match queue with a widening rating band**, anonymous
  stable identity, per-socket rate limiting, disconnect routing, and drain.
- **Draw-to-cast is authoritative.** A cast intent sends a **bounded, quantized
  gesture trace + timing**, never a trusted spell id. The server re-runs the
  shared full-roster `Recognizer` and rejects
  malformed / ambiguous / too-fast / oversized / rate-limited casts, passing only
  the classified id + quality into the sim. Development quick-cast (cast bar,
  keyboard, dev buttons) is unavailable online — online casting uses the gesture
  pad. **All 40 spell gestures have distinct single-stroke templates**, and every
  roster spell is drawable regardless of the selected guides; `test/templates.test.js` proves each
  classifies its own trace under legal loadouts with an acceptable margin.
- **Sequencing & anti-abuse.** Per-player sequence numbers with duplicate/stale
  rejection, an input state machine (movement/focus/brace + one-shot
  sidestep/casts), and per-player cast-attempt rate limits (3/s).
- **Reconnect / resume.** A single-use **rotating HMAC resume token**, a resume
  **epoch**, last-acknowledged sequence, a full authoritative snapshot on
  resume, and a **25-second grace** (shortened on repeat disconnects). A
  disconnected player stops issuing actions (the match pauses); after grace the
  round/series is forfeited. Render sticky sessions are not assumed.
- **Rating persistence adapter.** `server/ratings.js` uses **Postgres** when
  `DATABASE_URL` is set (idempotent schema init, parameterized queries) and an
  **explicit in-memory development adapter** otherwise. Quick match is ranked
  (widening band); private matches do not affect rating. No secrets in source.
- **Client.** `client/src/net/onlineMatch.js` + `net.js` add the Online menu
  (Create Private Duel, Join Code, Quick Match), waiting/cancel states, room-code
  display/copy, connection-quality + reconnect status, and the authoritative
  result flow. Server snapshots are rendered by the **same** renderer/HUD as the
  offline sim; slot mapping means each device always sees itself as local player
  0. Backgrounding stops inputs and reconnects rather than simulating locally.

Run it and deploy: see `docs/DEPLOYMENT.md` and `render.yaml`.

### Scaling & limitations (Phase 3)

- **Single instance only.** One process owns each live match in memory. This
  build does **not** support horizontal multi-instance operation; that would
  require external match-ownership leases + fencing tokens and a shared
  queue/room store (not implemented). Do not raise `numInstances`.
- Snapshots are full (not delta-compressed) and rendered without client-side
  interpolation smoothing yet; both are natural follow-ups.
- The comprehensive solo tutorial/practice expansion remains deferred to the
  final solo phase.

## Phase 4 — Android / Play packaging (Milestone 6)

Phase 4 packages the game for Google Play via Capacitor **without changing the
no-build ES-module architecture** — the same `client/`, `shared/`, and `design/`
run in the browser and in the app.

- **Deterministic web staging.** `npm run stage:web` (`scripts/stage-web.js`)
  assembles the Capacitor `webDir` (`www/`) from `client/` + `shared/` + `design/`
  with a real root `index.html`, preserving the absolute `/client`, `/shared`,
  `/design` layout so import maps and static paths resolve unchanged under the
  native origin. `node_modules` is never copied; three.js and the Socket.IO client
  are vendored locally (no CDN), so offline tutorial and bot modes need no network.
- **Configurable authoritative service.** The packaged app defaults to
  `https://aetherglyph.onrender.com`; same-origin web builds stay same-origin. A
  persisted **Settings → Online service URL** override is validated (HTTPS always;
  plain HTTP only for localhost/LAN) with a reset, plus **Delete my data**.
- **PWA + optional service worker.** `manifest.webmanifest`, icons, and a
  same-origin **production-only** service worker (`client/sw.js`) whose cache
  version tracks the app version. It is never registered in the native shell or on
  localhost, so Capacitor and dev cache iteration are unaffected.
- **Capacitor Android project (checked in).** `com.configmancooper.aetherglyph`,
  "Aetherglyph: Arcane Duels", landscape, `minSdk 24` / `compile+target 36`,
  `versionCode 10601` / `versionName 1.6.1`, no cleartext production traffic,
  `INTERNET` + `ACCESS_NETWORK_STATE` only, Render navigation allowed, native
  back-button + background/resume, haptics, and user-selected orientation via
  `@capacitor/app`, `@capacitor/haptics`, and `@capacitor/screen-orientation`.
- **Scripts + signing.** `setup-android.ps1`, `sync-android.ps1`,
  `build-android.ps1` reuse the shared JDK 17 / Android SDK. Release signing reads
  an ignored `android/keystore.properties`; no secret is committed. Builds emit a
  named debug APK plus a release APK/AAB (signed when a key exists, clearly
  labelled unsigned otherwise) into `dist/`.
- **Assets + store.** `npm run android:assets` generates the app icon, adaptive
  fore/background, splash, Play 512 icon, and 1024×500 feature graphic;
  `npm run android:screenshots` renders deterministic phone screenshots. Listing,
  privacy, account-deletion, and Data Safety material are documented.

Build/sign/publish: see `docs/ANDROID.md` and `PUBLISHING-ANDROID.md`.

### Known Phase 4 limitations

- **Single instance only** (unchanged): one process owns each live match in
  memory. Do **not** raise `numInstances` in `render.yaml`; horizontal scaling
  requires match-ownership leases + fencing tokens and a shared queue/room store,
  which are not implemented.
- Release artifacts are **unsigned until an upload key is created** with
  `setup-android.ps1`; the exact signing step is documented and produces a signed
  AAB on the next build.

## Solo Phase B — Practice vs AI + coaching (1.0)

The final feature phase adds the fair Practice AI, post-round coaching, interactive
calibration, best-of-three exams, and the real Gust Wall deflection. New shared
modules: `shared/src/bot/practiceBot.js` (Easy/Medium/Hard), `shared/src/bot/combos.js`
(tier-gated combo/counter knowledge), `shared/src/gesture/quality.js` (the single
`qualityFromScore` mapping reused by player, server, and AI), and
`shared/src/analytics/coach.js` (pure coaching reducer). New client modules:
`client/src/ui/coach.js` and `client/src/tutorial/calibration.js`. Tests:
`test/practiceBot.test.js` (fairness, determinism, legal loadouts, non-zero miss
rates, perception isolation, mirrored difficulty ordering Hard>Medium>Easy),
`test/coaching.test.js`, and `test/gust.test.js`.

### Fairness results (deterministic, `test/practiceBot.test.js`)

Across mirrored seeded matches with several equal loadouts: **Hard beats Easy ~92%**,
**Hard beats Medium ~70%**, **Medium beats Easy ~87%**; the ordering does not
reverse when sides swap. Empirical gesture-miss rates are **Easy ~0.34 ≫ Medium
~0.07 ≫ Hard ~0.03 > 0**. Ordering comes from decision profiles, not stat tuning.

### Known 1.0 limitations

- **Single instance only** (unchanged): one process owns each live match in
  memory. Do **not** raise `numInstances` in `render.yaml`.

## Product decision


- Paid game: $0.99 one-time purchase
- No ads, loot boxes, consumable purchases, or pay-to-win progression
- Offline tutorial and practice bot
- Online unranked and ranked 1v1
- Google Play package via Capacitor, targeting Android API 36
- Authoritative multiplayer service hosted on Render
