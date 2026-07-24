# Aetherglyph — Deployment & Environment

Two separate Render services are maintained:

- `AetherGlyph` is the complete game repository and hosts the full web game at
  `https://aetherglyph.onrender.com`.
- `AetherGlyph-Server` is the asset-free authoritative service at
  `https://aetherglyph-server.onrender.com`.

Packaged and public web clients connect to the dedicated server for matchmaking
and duels; localhost/LAN development stays same-origin.

## Run locally

```bash
npm install            # express + socket.io + three; vendors client libs; generates spell data
npm start              # http://localhost:8130  (client + authoritative server)
```

- Client: `http://localhost:8130/client/index.html`
- Health: `http://localhost:8130/healthz`

Two devices on the same Wi‑Fi can duel during development: open the LAN address
(`http://<your-lan-ip>:8130/client/index.html`) on both. The Origin gate allows
`localhost`/`127.0.0.1` and private‑LAN origins when `ALLOWED_ORIGINS` is unset.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `8130` | HTTP/WebSocket port (Render sets this automatically). |
| `SESSION_SECRET` | prod | random per process | HMAC key for single‑use resume tokens. Set a stable secret in production. **Never commit it.** |
| `ALLOWED_ORIGINS` | prod | *(empty)* | Comma‑separated exact client Origin allowlist, e.g. `https://configmancooper.github.io`. When empty, only localhost + private‑LAN + no‑origin (native app) are allowed. |
| `DATABASE_URL` | no | *(unset)* | Postgres connection string for anonymous‑account rating/results. When unset, an **explicit in‑memory development rating adapter** is used (never a silent no‑op). |

No secrets are stored in source. `DATABASE_URL`/`SESSION_SECRET` come only from
the environment. Postgres schema is created idempotently on boot and all queries
are parameterized.

## Render

The game repository's `render.yaml` deploys the complete hosted game as
`aetherglyph`. The separate server repository's `render.yaml` deploys
`aetherglyph-server`. The server-only service:

- serves no game graphics, music, Three.js, or client application,
- runs matchmaking, private rooms, reconnects, ratings, and authoritative duels,
- health-checks `/healthz`,
- generates `SESSION_SECRET`,
- limits global/per-IP connections and rate-limits client events,
- sends compressed volatile snapshots at 10 Hz,
- optionally uses Render Postgres via `DATABASE_URL`.

The service drains gracefully on `SIGTERM` (Render deploys): active matches are
told to reconnect/aborted and the process exits after a short flush window.

## Scaling & limitations (read this)

- **Single instance only.** One process owns each live match in memory. Do **not**
  raise `numInstances`. Horizontal scaling requires external match‑ownership
  leases + fencing tokens and a shared queue/room store, which are **not**
  implemented. This build does not claim horizontal multi‑instance support.
- Use the server Blueprint's paid always-on plan for a production ranked queue.
- Reconnects are **not** assumed to return to the same instance; with a single
  instance this is moot, but the resume protocol (signed rotating token + epoch)
  is the mechanism that would be needed once ownership fencing exists.
