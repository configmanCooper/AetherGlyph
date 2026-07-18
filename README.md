# Aetherglyph: Arcane Duels

An Android-first, real-time 1v1 wizard dueling game built around drawing spell glyphs on a touch screen.

## Project status

**Solo Phase A (offline tutorial/campaign foundation) is implemented** on top of
the Phase 1–4 slices. The old three-item tutorial stub is replaced by a fully
offline, single-player campaign that teaches the real production rules with real
drawn gestures: a Prologue, twelve core Lessons, four Academy lessons, a final-
exam scaffold, public-spell drills, and four secret trials that together cover
every spell id 1–40. It runs on the real shared `Sim`, the production recognizer,
and real spell effects/statuses/reactions — no tap-to-complete shortcuts. A
deterministic `TutorialRunner` state machine (INTRO → CALIBRATE → ARMING → ACTIVE
→ ATTEMPT_FAILED → REMEDIATE → SUCCESS → PAUSED) consumes simulation events, a
scripted instructor (`ScriptBot`) creates legal teaching moments, and a versioned
local profile (`aeg.solo.v1`) checkpoints progress, calibration, per-spell guide
stages, medals, clues, secret discoveries, ranked-readiness, and coaching stats
with validation, migration, corruption recovery, and Delete My Data support. The
progressive guide fades Full → Dotted → Start → None. Lesson 12 unlocks ranked
readiness; optional academies, medals, and secrets never gate it. *Practice vs AI
(Easy/Medium/Hard) and post-match coaching are the next phase and are present only
as menu naming hooks.*

**Phase 4 (Capacitor Android / Google Play packaging) is implemented on top of
the Phase 1–3 offline + authoritative-online slices.** The no-build web app is
staged into a Capacitor `webDir` and built into a signable Android App Bundle
(app id `com.configmancooper.aetherglyph`, API 24 → 36, landscape). Online play
connects to a configurable authoritative service (default
`https://aetherglyph.onrender.com`); same-origin web deployments stay same-origin.

**Phase 3 (authoritative online multiplayer)** remains: two devices play a real
best-of-three duel through an authoritative Express + Socket.IO server that owns
every match simulation. Casting online is by drawing — the server reclassifies
the gesture and is the sole authority over health, resources, spell ids, and
results. All 40 spell gestures are drawable. Planning artifacts remain
authoritative for later phases.

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
- Modes: **Tutorial** (guided glyph lessons), **Practice** (free draw + recognizer
  diagnostics), **Bot Duel** (best-of-three vs Apprentice→Archmage), **Online Duel**
  (best-of-three vs another device: Quick Match, Create Private Duel, or Join Code).
- **Loadout builder**: pick from all 40 spells or an archetype preset (Ember Rush,
  Tide Control, Storm Tempo, Stone Warden, Gale Trickster, Arcane Combo, Umbra
  Attrition, Prismatic Hybrid); live 14-point / school / heavy validation.
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
private room end-to-end, applies an archetype preset, starts a best-of-three bot
series, draws real glyphs, and asserts a clean running state.

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
- **Loadout builder.** `validateLoadout` enforces 8 spells / 14-point budget /
  max two 3-point spells / max three per school, with a soft "no defensive
  answer" warning. Eight curated archetype presets are provided, and the
  responsive builder UI exposes all 40 spells (secrets selectable in Phase 2).
- **Best-of-three series.** Rounds reset the arena/statuses/resources while
  preserving both loadouts; a running series score, per-round transitions, and
  correct rematch/menu behaviour are wired (`Series` / `runSeries` in
  `shared/src/sim/match.js`).
- **Bot pilots any loadout.** The `DuelBot` categorises whatever it is dealt and
  reasons about setup (chill→Frost Bind, static/soak→Thunderclap), resources
  (charges/Focus), zones (place then ignite), defense (Ward/Reflect/Blink/Dispel),
  and counters (Grounding vs lightning). Four internal levels are kept.
- **Visuals/HUD.** The Three.js arena draws generic zone disks and effects per
  category; the HUD shows statuses (buffs vs debuffs), active zones + durations,
  the series score, and an on-screen cast bar for the equipped loadout.

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
  shared `Recognizer` restricted to the player's equipped loadout and rejects
  malformed / ambiguous / too-fast / oversized / rate-limited casts, passing only
  the classified id + quality into the sim. Development quick-cast (cast bar,
  keyboard, dev buttons) is unavailable online — online casting uses the gesture
  pad. **All 40 spell gestures have distinct single-stroke templates**, so any
  legal online loadout is fully drawable; `test/templates.test.js` proves each
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
  `versionCode 400` / `versionName 0.4.0`, no cleartext production traffic,
  `INTERNET` + `ACCESS_NETWORK_STATE` only, Render navigation allowed, native
  back-button + background/resume + haptics via `@capacitor/app` and
  `@capacitor/haptics`.
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
- The comprehensive solo tutorial/practice expansion is still deferred to the
  final solo phase; Phase 4 does not expand it.

## Product decision


- Paid game: $0.99 one-time purchase
- No ads, loot boxes, consumable purchases, or pay-to-win progression
- Offline tutorial and practice bot
- Online unranked and ranked 1v1
- Google Play package via Capacitor, targeting Android API 36
- Authoritative multiplayer service hosted on Render

