# Independent Reference Architecture Review

Scope reviewed:

- `C:\Users\rocma\CLI\Fish-Friends`
- `C:\Users\rocma\CLI\Garden-and-Griddle`
- `C:\Users\rocma\CLI\FourPillars`

## Adopt

### Fish Friends

- Keep simulation free of Three.js and DOM dependencies, following `game\js\sim.js`.
- Drive rendering, UI, and audio from simulation events.
- Use deterministic seeds and extensive headless bot tests, following `game\test\run.js`.
- Preserve phone-first touch handling, audio unlock, background pause, PWA fallback, and versioned local saves.

### Garden and Griddle

- Reuse the Capacitor-oriented Android build discipline in `package.json` and `PUBLISHING-ANDROID.md`.
- Reuse explicit Android back/app handling and local server URL/session persistence.
- Follow `server.js` for Origin checks, payload caps, build/protocol gates, health endpoint, acknowledgements, and graceful shutdown.
- Generate Play assets and signed AAB artifacts through scripts rather than manual IDE-only steps.

### Four Pillars

- Follow the server-authoritative room/match manager model in `server.js`.
- Keep all combat resolution on the server.
- Support snapshots and reconnect recovery.
- Use a Render blueprint and health check like `render.yaml`.

## Do not copy blindly

- A wizard duel needs stricter latency, sequencing, payload, and reconnect rules than either reference's slower actions.
- `origin: '*'` is not acceptable for production.
- Render free-service sleep is not suitable for a competitive production queue.
- Local persistence is appropriate for tutorial/settings, not authoritative online progress or match state.
- A browser-only PWA is a useful fallback but not the intended Play Store binary.

## Architecture conclusion

The best combined pattern is:

1. Fish Friends' pure headless simulation and bots.
2. Garden and Griddle's Android packaging and hardened connection gate.
3. Four Pillars' authoritative match ownership, snapshots, and Render deployment.

