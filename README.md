# Aetherglyph: Arcane Duels

An Android-first, real-time 1v1 wizard dueling game built around drawing spell glyphs on a touch screen.

## Project status

**Phase 1 (offline vertical slice) is implemented and playable.** Planning
artifacts remain authoritative for later phases.

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
  diagnostics), **Bot Duel** (Apprentice→Archmage).
- Dev accessibility fallback: keyboard `1`–`8` quick-cast, `A`/`D` move, `F` focus,
  space to dodge, and optional on-screen quick-cast buttons (Settings). Normal play
  uses drawing.

### Test

```bash
npm test             # headless Node suite (spell gen, determinism, resources,
                     # casting/counters, status/Tenacity, bot termination, gesture)
npm run test:browser # OPTIONAL headless browser smoke via local Edge/Chrome (WebGL)
```

`npm test` requires no browser. `npm run test:browser` uses `puppeteer-core` with a
locally installed Edge/Chrome (no Chromium download); it boots the client, starts a
duel, draws real glyphs through the pointer pipeline, and asserts a clean running state.

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
hashes for replay/divergence checks — ready for Phase 2 authoritative online
multiplayer.

### Known Phase 1 limitations

- Curated **8-spell** starter loadout is wired for combat; the full 40-spell
  catalog is present as data but only the starter set has authored combat effects.
- No online/networking yet (Milestone 4), no Capacitor Android packaging yet
  (Milestone 6), no environmental reaction matrix yet (Milestone 3).
- Arena visuals are a functional, low-poly placeholder; readability first.
- Sim uses floating-point with quantized hashing; fixed-point is a Phase 2 item.

## Product decision


- Paid game: $0.99 one-time purchase
- No ads, loot boxes, consumable purchases, or pay-to-win progression
- Offline tutorial and practice bot
- Online unranked and ranked 1v1
- Google Play package via Capacitor, targeting Android API 36
- Authoritative multiplayer service hosted on Render

