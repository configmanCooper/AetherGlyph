# Aetherglyph — Deployment & Environment

The Phase 3 build is a single Node service (Express + Socket.IO) that serves the
static client **and** runs the authoritative 1v1 duel simulation.

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
| `ALLOWED_ORIGINS` | prod | *(empty)* | Comma‑separated exact Origin allowlist, e.g. `https://aetherglyph.onrender.com`. When empty, only localhost + private‑LAN + no‑origin (native app) are allowed. |
| `DATABASE_URL` | no | *(unset)* | Postgres connection string for anonymous‑account rating/results. When unset, an **explicit in‑memory development rating adapter** is used (never a silent no‑op). |

No secrets are stored in source. `DATABASE_URL`/`SESSION_SECRET` come only from
the environment. Postgres schema is created idempotently on boot and all queries
are parameterized.

## Render

`render.yaml` is a one‑click blueprint (Dashboard → New → Blueprint). It:

- serves the client and runs the authoritative server from one Web Service,
- health‑checks `/healthz`,
- generates `SESSION_SECRET`,
- sets `ALLOWED_ORIGINS` to the service URL,
- optionally wires a Render Postgres via `DATABASE_URL` (commented out).

The service drains gracefully on `SIGTERM` (Render deploys): active matches are
told to reconnect/aborted and the process exits after a short flush window.

## Scaling & limitations (read this)

- **Single instance only.** One process owns each live match in memory. Do **not**
  raise `numInstances`. Horizontal scaling requires external match‑ownership
  leases + fencing tokens and a shared queue/room store, which are **not**
  implemented. This build does not claim horizontal multi‑instance support.
- Render’s free plan sleeps after idle and is not suitable for a production
  ranked queue; use a paid instance for real play.
- Reconnects are **not** assumed to return to the same instance; with a single
  instance this is moot, but the resume protocol (signed rotating token + epoch)
  is the mechanism that would be needed once ownership fencing exists.
