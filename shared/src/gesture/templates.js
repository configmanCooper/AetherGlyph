// templates.js — hand-authored gesture templates for the Phase 1 starter set.
//
// Coordinates are in an arbitrary 0..100 pad space (y grows downward, matching
// pointer coordinates). Point ORDER encodes drawing direction, which the
// recognizer preserves. Each key maps to one starter spell (see
// balance/loadouts.js). Multiple templates per key improve tolerance.

import { STARTER_GESTURE_KEYS } from '../balance/loadouts.js';

function arc(cx, cy, r, startDeg, endDeg, steps = 16) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (startDeg + (endDeg - startDeg) * (i / steps)) * Math.PI / 180;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// Raw canonical paths, keyed by gestureKey.
export const GESTURE_TEMPLATES = {
  // Ember Bolt — horizontal right flick
  flickRight: [
    [{ x: 5, y: 50 }, { x: 35, y: 49 }, { x: 65, y: 50 }, { x: 95, y: 51 }],
    [{ x: 8, y: 40 }, { x: 50, y: 45 }, { x: 92, y: 48 }],
  ],
  // Frost Lance — straight up line (drawn bottom -> top)
  lineUp: [
    [{ x: 50, y: 95 }, { x: 50, y: 63 }, { x: 51, y: 32 }, { x: 50, y: 5 }],
    [{ x: 45, y: 92 }, { x: 48, y: 50 }, { x: 50, y: 8 }],
  ],
  // Stone Shard — V shape
  vShape: [
    [{ x: 8, y: 8 }, { x: 30, y: 55 }, { x: 50, y: 95 }, { x: 70, y: 55 }, { x: 92, y: 8 }],
    [{ x: 12, y: 12 }, { x: 50, y: 92 }, { x: 88, y: 12 }],
  ],
  // Spark Dart — short zigzag
  zigzag: [
    [{ x: 6, y: 20 }, { x: 34, y: 85 }, { x: 62, y: 20 }, { x: 92, y: 85 }],
    [{ x: 8, y: 25 }, { x: 30, y: 80 }, { x: 55, y: 25 }, { x: 80, y: 82 }, { x: 95, y: 40 }],
  ],
  // Concussive Blast — pushing arc (bulges left, drawn top -> bottom)
  arc: [
    arc(78, 50, 42, -70, 70, 18),
    arc(80, 50, 38, -60, 60, 14),
  ],
  // Ward — open right bracket "["
  bracket: [
    [{ x: 90, y: 8 }, { x: 20, y: 8 }, { x: 20, y: 50 }, { x: 20, y: 92 }, { x: 90, y: 92 }],
    [{ x: 85, y: 12 }, { x: 25, y: 10 }, { x: 24, y: 90 }, { x: 85, y: 90 }],
  ],
  // Barrier Dome — clockwise circle (start top, go clockwise)
  circle: [
    arc(50, 50, 40, -90, 270, 24),
    arc(50, 50, 36, -90, 268, 20),
  ],
  // Reflect — check mark
  checkmark: [
    [{ x: 8, y: 52 }, { x: 30, y: 78 }, { x: 45, y: 95 }, { x: 95, y: 12 }],
    [{ x: 10, y: 48 }, { x: 38, y: 92 }, { x: 92, y: 8 }],
  ],
};

// Flatten into recognizer template records, tagging each with its spell id via
// the starter loadout mapping so classification is spell-aware.
export function buildTemplates() {
  const keyToSpellId = {};
  for (const [spellId, key] of Object.entries(STARTER_GESTURE_KEYS)) {
    keyToSpellId[key] = Number(spellId);
  }
  const records = [];
  for (const [key, variants] of Object.entries(GESTURE_TEMPLATES)) {
    const spellId = keyToSpellId[key];
    if (spellId == null) continue;
    variants.forEach((points, i) => {
      records.push({ name: `${key}#${i}`, gestureKey: key, spellId, points });
    });
  }
  return records;
}
