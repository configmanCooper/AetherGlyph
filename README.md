# Aetherglyph: Arcane Duels

An Android-first, real-time 1v1 wizard dueling game built around drawing spell glyphs on a touch screen.

## Project status

**Phase 2 (full combat content) is implemented on top of the Phase 1 slice.**
All 40 catalog spells now have executable effects, the environmental reaction
matrix is live, loadouts are player-buildable, and duels run as a best-of-three
series. Planning artifacts remain authoritative for later phases.

- `MASTERPLAN.md` - authoritative product, game, technical, test, deployment, and release plan
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
npm install          # installs express + three, vendors three.js locally, generates spell data
npm start            # serves the client on http://localhost:8130
# open http://localhost:8130  (use a phone or device emulation, landscape)
```

`npm install` runs `postinstall` which copies `three.module.js` into
`client/vendor/` so the game works with **no CDN access**. If you pull new
changes without reinstalling, run `npm run vendor:three` and `npm run gen:spells`.

Health endpoint: `GET /healthz`.

### Play

- **Left pad** = move / strafe the arc; a quick horizontal flick = Dodge (sidestep).
- **Right pad** = draw a glyph; release to cast. Two-finger tap breaks the trace.
- **Focus** (hold) builds a Sigil Charge; **Brace** (hold) is an emergency guard.
- Starter loadout (8 spells): Ember Bolt (→ flick), Frost Lance (↑ line),
  Stone Shard (V), Spark Dart (zigzag), Concussive Blast (arc), Ward (bracket),
  Barrier Dome (circle), Reflect (check mark).
- Modes: **Tutorial** (guided glyph lessons), **Practice** (free draw + recognizer
  diagnostics), **Bot Duel** (best-of-three vs Apprentice→Archmage).
- **Loadout builder**: pick from all 40 spells or an archetype preset (Ember Rush,
  Tide Control, Storm Tempo, Stone Warden, Gale Trickster, Arcane Combo, Umbra
  Attrition, Prismatic Hybrid); live 14-point / school / heavy validation.
- In a duel, cast by drawing (starter gestures) or by tapping the on-screen cast
  bar; the arena shows environmental zones and both wizards' statuses.
- Dev accessibility fallback: keyboard `1`–`8` quick-cast, `A`/`D` move, `F` focus,
  space to dodge, and optional on-screen quick-cast buttons (Settings). Normal play
  uses drawing.

### Test

```bash
npm test             # headless Node suite (spell gen, determinism incl. zones,
                     # resources, casting/counters, status/Tenacity, all-40 effects,
                     # environment reactions, loadout validation, best-of-three
                     # series, secret spells, bot termination w/ archetypes, gesture)
npm run test:browser # OPTIONAL headless browser smoke via local Edge/Chrome (WebGL)
```

`npm test` requires no browser. `npm run test:browser` uses `puppeteer-core` with a
locally installed Edge/Chrome (no Chromium download); it boots the client, applies an
archetype preset in the loadout builder, starts a best-of-three series, draws real
glyphs, exercises the on-screen cast bar, and asserts a clean running state.

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

- Only the eight starter gestures have hand-authored recognizer templates, so in
  a duel those spells are castable by drawing; every equipped spell is always
  castable from the on-screen cast bar (and keyboard `1`–`8`). Full per-spell
  gesture templates arrive with the gesture-corpus milestone.
- No online/networking yet (Milestone 4) and no Capacitor Android packaging yet
  (Milestone 6).
- The comprehensive tutorial campaign, codex, secret-unlock progression, and the
  full AI-practice expansion are intentionally deferred to the final solo phase;
  secrets are freely selectable for Phase 2 development.
- Arena visuals remain functional, readability-first placeholders.
- Sim uses floating-point with quantized hashing; fixed-point is a later item.

## Product decision


- Paid game: $0.99 one-time purchase
- No ads, loot boxes, consumable purchases, or pay-to-win progression
- Offline tutorial and practice bot
- Online unranked and ranked 1v1
- Google Play package via Capacitor, targeting Android API 36
- Authoritative multiplayer service hosted on Render

