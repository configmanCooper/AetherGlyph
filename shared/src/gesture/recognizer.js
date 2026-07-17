// recognizer.js — pure $1-style single-stroke gesture recognizer.
//
// DOM-free so the SAME recognizer runs on the client and (Phase 2) the
// authoritative server. Pipeline (MASTERPLAN §5): resample -> translate ->
// uniform scale (aspect + direction preserved, rotation NOT normalized) ->
// compare only against the equipped loadout templates -> accept only when the
// best score clears the spell threshold AND beats the runner-up by a margin.

const DEFAULT_N = 24;

export function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return d;
}

// Remove near-duplicate points and light jitter before resampling.
export function dedupe(pts, minDist = 0.5) {
  if (pts.length === 0) return [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const q = out[out.length - 1];
    if (Math.hypot(p.x - q.x, p.y - q.y) >= minDist) out.push(p);
  }
  return out;
}

export function resample(pts, n = DEFAULT_N) {
  const clean = dedupe(pts.map((p) => ({ x: p.x, y: p.y })));
  if (clean.length < 2) return clean.length ? new Array(n).fill(0).map(() => ({ ...clean[0] })) : [];
  const I = pathLength(clean) / (n - 1);
  const out = [{ ...clean[0] }];
  let D = 0;
  const src = clean.slice();
  for (let i = 1; i < src.length; i++) {
    let d = Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
    if (D + d >= I) {
      const t = I === 0 ? 0 : (I - D) / d;
      const q = {
        x: src[i - 1].x + t * (src[i].x - src[i - 1].x),
        y: src[i - 1].y + t * (src[i].y - src[i - 1].y),
      };
      out.push(q);
      src.splice(i, 0, q);
      D = 0;
    } else {
      D += d;
    }
  }
  while (out.length < n) out.push({ ...clean[clean.length - 1] });
  return out.slice(0, n);
}

export function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

// Translate to centroid, then uniform-scale by the largest extent so the
// aspect ratio and direction survive (a horizontal line stays horizontal).
export function normalize(pts) {
  if (pts.length === 0) return [];
  const c = centroid(pts);
  let maxExt = 1e-6;
  for (const p of pts) {
    maxExt = Math.max(maxExt, Math.abs(p.x - c.x), Math.abs(p.y - c.y));
  }
  return pts.map((p) => ({ x: (p.x - c.x) / (2 * maxExt), y: (p.y - c.y) / (2 * maxExt) }));
}

export function preprocess(pts, n = DEFAULT_N) {
  return normalize(resample(pts, n));
}

export function meanDistance(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return sum / n;
}

// Map a mean normalized distance (0 = identical) into a 0..1 score.
export function distanceToScore(d) {
  return Math.max(0, 1 - d * 2.2);
}

export class Recognizer {
  constructor(templates = [], opts = {}) {
    this.n = opts.n || DEFAULT_N;
    this.acceptThreshold = opts.acceptThreshold ?? 0.62;
    this.marginThreshold = opts.marginThreshold ?? 0.06;
    this.minPoints = opts.minPoints ?? 3;
    this.templates = templates.map((t) => ({
      name: t.name, spellId: t.spellId, gestureKey: t.gestureKey,
      pts: preprocess(t.points, this.n),
    }));
  }

  // Restrict classification to the equipped spells for a given loadout.
  forLoadout(loadout) {
    const keys = new Set(loadout.map((s) => s.gestureKey || s.id));
    const ids = new Set(loadout.map((s) => s.id));
    const subset = this.templates.filter((t) => ids.has(t.spellId) || keys.has(t.gestureKey));
    const r = Object.create(Recognizer.prototype);
    r.n = this.n; r.acceptThreshold = this.acceptThreshold;
    r.marginThreshold = this.marginThreshold; r.minPoints = this.minPoints;
    r.templates = subset;
    return r;
  }

  recognize(points) {
    const diag = { accepted: false, reason: null, scores: [], best: null, second: null, margin: 0 };
    const raw = (points || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (raw.length < this.minPoints) { diag.reason = 'too-few-points'; return diag; }
    if (this.templates.length === 0) { diag.reason = 'no-templates'; return diag; }

    const q = preprocess(raw, this.n);
    const scores = this.templates.map((t) => ({
      spellId: t.spellId, name: t.name, gestureKey: t.gestureKey,
      score: distanceToScore(meanDistance(q, t.pts)),
    })).sort((a, b) => b.score - a.score);

    diag.scores = scores;
    diag.best = scores[0];
    // The runner-up for ambiguity must be a DIFFERENT spell, not another
    // template of the same spell.
    const rival = scores.find((s) => s.spellId !== scores[0].spellId) || null;
    diag.second = rival;
    diag.margin = scores[0].score - (rival ? rival.score : 0);

    if (scores[0].score < this.acceptThreshold) { diag.reason = 'below-threshold'; return diag; }
    if (rival && diag.margin < this.marginThreshold) { diag.reason = 'ambiguous'; return diag; }

    diag.accepted = true;
    diag.spellId = scores[0].spellId;
    diag.name = scores[0].name;
    diag.reason = 'accepted';
    return diag;
  }
}
