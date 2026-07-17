// server.js — Phase 1 local dev server.
//
// Serves the static client + shared ES modules and exposes a Render-style
// health endpoint. This is intentionally simple: Phase 1 is an OFFLINE vertical
// slice, so there is no authoritative match logic here yet (that arrives in the
// Phase 4 milestone). The whole game runs client-side against the shared sim.

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = process.env.PORT || 8130;

const app = express();

// Health endpoint (mirrors the Four Pillars / Render blueprint pattern).
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, phase: 1, service: 'aetherglyph-client', time: Date.now() });
});

// Warn early if assets have not been prepared.
if (!existsSync(join(ROOT, 'client', 'vendor', 'three.module.js'))) {
  console.warn('[server] client/vendor/three.module.js missing — run `npm run vendor:three`.');
}
if (!existsSync(join(ROOT, 'shared', 'src', 'balance', 'spellData.generated.js'))) {
  console.warn('[server] generated spell data missing — run `npm run gen:spells`.');
}

// Serve shared modules and the client. Correct MIME types come from express.static.
app.use('/shared', express.static(join(ROOT, 'shared')));
app.use('/client', express.static(join(ROOT, 'client')));
app.use('/design', express.static(join(ROOT, 'design')));

// Root -> game.
app.get('/', (_req, res) => res.redirect('/client/index.html'));

app.listen(PORT, () => {
  console.log(`Aetherglyph (Phase 1 offline) on http://localhost:${PORT}`);
  console.log(`  play:   http://localhost:${PORT}/client/index.html`);
  console.log(`  health: http://localhost:${PORT}/healthz`);
});
