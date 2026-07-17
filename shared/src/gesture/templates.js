// templates.js — hand-authored single-stroke gesture templates for the FULL
// 40-spell roster, so any legal online loadout is drawable (Phase 3).
//
// Coordinates are in an arbitrary 0..100 pad space (y grows downward, matching
// pointer coordinates). Point ORDER encodes drawing direction, which the shared
// recognizer preserves (rotation is NOT normalized; translation + uniform scale
// with aspect preserved ARE). Each key maps to exactly one spell via
// balance/loadouts.js GESTURE_KEYS. Every gesture is a single continuous stroke
// so the single-stroke recognizer classifies it deterministically on both the
// client (prediction) and the authoritative server.

import { GESTURE_KEYS } from '../balance/loadouts.js';

// --- authoring helpers ----------------------------------------------------
function arc(cx, cy, r, startDeg, endDeg, steps = 16) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (startDeg + (endDeg - startDeg) * (i / steps)) * Math.PI / 180;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// A planar spiral: radius sweeps r0 -> r1 while the angle sweeps startDeg by
// sweepDeg (positive = clockwise in y-down space).
function spiral(cx, cy, r0, r1, startDeg, sweepDeg, steps = 26) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (startDeg + sweepDeg * t) * Math.PI / 180;
    const r = r0 + (r1 - r0) * t;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// A coil that loops while translating vertically (a spring), yTop < yBot.
function risingCoil(cx, yBot, yTop, r, turns, steps = 26) {
  const pts = [];
  const total = turns * 360;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (-90 + total * t) * Math.PI / 180;
    const cy = yBot + (yTop - yBot) * t;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// Raw canonical single-stroke paths, keyed by gestureKey (see GESTURE_KEYS).
export const GESTURE_TEMPLATES = {
  // === Starter set (kept identical to Phase 1/2 so tutorials + smoke hold) ==
  flickRight: [ // 1 Ember Bolt — horizontal right flick
    [{ x: 5, y: 50 }, { x: 35, y: 49 }, { x: 65, y: 50 }, { x: 95, y: 51 }],
    [{ x: 8, y: 40 }, { x: 50, y: 45 }, { x: 92, y: 48 }],
  ],
  lineUp: [ // 2 Frost Lance — straight up line (bottom -> top)
    [{ x: 50, y: 95 }, { x: 50, y: 63 }, { x: 51, y: 32 }, { x: 50, y: 5 }],
    [{ x: 45, y: 92 }, { x: 48, y: 50 }, { x: 50, y: 8 }],
  ],
  vShape: [ // 4 Stone Shard — sharp narrow V
    [{ x: 8, y: 8 }, { x: 30, y: 55 }, { x: 50, y: 95 }, { x: 70, y: 55 }, { x: 92, y: 8 }],
    [{ x: 12, y: 12 }, { x: 50, y: 92 }, { x: 88, y: 12 }],
  ],
  zigzag: [ // 3 Spark Dart — short zigzag (sharp vertical peaks)
    [{ x: 6, y: 20 }, { x: 34, y: 85 }, { x: 62, y: 20 }, { x: 92, y: 85 }],
    [{ x: 8, y: 25 }, { x: 30, y: 80 }, { x: 55, y: 25 }, { x: 80, y: 82 }, { x: 95, y: 40 }],
  ],
  arc: [ // 28 Concussive Blast — pushing arc (bulges left, top -> bottom)
    arc(78, 50, 42, -70, 70, 18),
    arc(80, 50, 38, -60, 60, 14),
  ],
  bracket: [ // 10 Ward — open right bracket "["
    [{ x: 90, y: 8 }, { x: 20, y: 8 }, { x: 20, y: 50 }, { x: 20, y: 92 }, { x: 90, y: 92 }],
    [{ x: 85, y: 12 }, { x: 25, y: 10 }, { x: 24, y: 90 }, { x: 85, y: 90 }],
  ],
  circle: [ // 11 Barrier Dome — clockwise circle (start top)
    arc(50, 50, 40, -90, 270, 24),
    arc(50, 50, 36, -90, 268, 20),
  ],
  checkmark: [ // 12 Reflect — check mark
    [{ x: 8, y: 52 }, { x: 30, y: 78 }, { x: 45, y: 95 }, { x: 95, y: 12 }],
    [{ x: 10, y: 48 }, { x: 38, y: 92 }, { x: 92, y: 8 }],
  ],

  // === Offensive (remaining) ==============================================
  arcUp: [ // 5 Arcane Missile — upward-bulging dome (rainbow, L -> R)
    arc(50, 80, 60, -158, -22, 18),
  ],
  wideArc: [ // 6 Flame Wave — wide rising sweep (low-left up to high-right)
    [{ x: 10, y: 88 }, { x: 28, y: 74 }, { x: 48, y: 56 }, { x: 70, y: 36 }, { x: 92, y: 14 }],
  ],
  longZigzag: [ // 7 Chain Lightning — tall multi-peak zigzag
    [{ x: 5, y: 18 }, { x: 23, y: 84 }, { x: 41, y: 18 }, { x: 59, y: 84 }, { x: 77, y: 18 }, { x: 95, y: 72 }],
  ],
  triangleCW: [ // 8 Fireball — closed triangle, apex up, clockwise
    [{ x: 50, y: 12 }, { x: 86, y: 82 }, { x: 14, y: 82 }, { x: 50, y: 12 }],
  ],
  spiralIn: [ // 9 Ice Comet — inward clockwise spiral (outer -> center)
    spiral(50, 50, 45, 7, -90, 720, 28),
  ],

  // === Defensive (remaining) ==============================================
  circleCCW: [ // 13 Dispel — counterclockwise circle (start top, go left)
    arc(50, 50, 40, -90, -450, 24),
  ],
  doubleStroke: [ // 14 Blink — lightning "Z" (two offset horizontals)
    [{ x: 22, y: 26 }, { x: 64, y: 26 }, { x: 28, y: 72 }, { x: 70, y: 72 }],
  ],
  lowSquare: [ // 15 Stone Wall — squared U (down, across, up)
    [{ x: 16, y: 20 }, { x: 16, y: 80 }, { x: 84, y: 80 }, { x: 84, y: 20 }],
  ],

  // === Buffs ==============================================================
  spiralUp: [ // 16 Haste — ascending coil (spring)
    risingCoil(50, 78, 24, 15, 2, 28),
  ],
  figureEight: [ // 17 Aether Surge — vertical figure eight (crosses at center)
    [{ x: 50, y: 14 }, { x: 76, y: 34 }, { x: 50, y: 54 }, { x: 24, y: 74 },
     { x: 50, y: 90 }, { x: 76, y: 72 }, { x: 50, y: 52 }, { x: 24, y: 32 }, { x: 50, y: 14 }],
  ],
  loopCW: [ // 18 Amplify — balloon: rising stem then a small clockwise loop
    [{ x: 42, y: 92 }, { x: 47, y: 66 }, ...arc(50, 42, 20, 110, 470, 15)],
  ],
  flameOutline: [ // 19 Ember Attunement — flame teardrop with a notched top
    [{ x: 50, y: 92 }, { x: 30, y: 62 }, { x: 40, y: 40 }, { x: 47, y: 22 },
     { x: 52, y: 34 }, { x: 58, y: 18 }, { x: 66, y: 42 }, { x: 72, y: 64 }, { x: 50, y: 92 }],
  ],
  diamond: [ // 20 Grounding Mantle — closed diamond (top -> right -> bottom -> left)
    [{ x: 50, y: 10 }, { x: 86, y: 50 }, { x: 50, y: 90 }, { x: 14, y: 50 }, { x: 50, y: 10 }],
  ],

  // === Debuffs ============================================================
  downArc: [ // 21 Weaken — wide shallow valley (concave up, L -> R)
    arc(50, 22, 58, 160, 20, 18),
  ],
  jaggedX: [ // 22 Sunder — X (two crossing diagonals via the right edge)
    [{ x: 12, y: 12 }, { x: 88, y: 88 }, { x: 88, y: 12 }, { x: 12, y: 88 }],
  ],
  slowSpiral: [ // 23 Sloth Hex — outward counterclockwise spiral (center -> out)
    spiral(50, 50, 8, 45, -90, -810, 28),
  ],
  downHook: [ // 24 Aether Leech — downward hook / "J"
    [{ x: 46, y: 12 }, { x: 50, y: 44 }, { x: 52, y: 70 }, { x: 44, y: 83 },
     { x: 30, y: 80 }, { x: 26, y: 66 }],
  ],
  knot: [ // 25 Veil Hex — crossing knot (multiple self-intersections)
    [{ x: 26, y: 66 }, { x: 54, y: 30 }, { x: 74, y: 60 }, { x: 42, y: 62 },
     { x: 60, y: 30 }, { x: 30, y: 52 }, { x: 58, y: 74 }],
  ],

  // === Control ============================================================
  uRoot: [ // 26 Entangle — rounded half-circle bowl with upturned root ticks
    [{ x: 30, y: 18 }, { x: 23, y: 35 }, ...arc(50, 52, 27, 182, 358, 12), { x: 77, y: 35 }, { x: 70, y: 18 }],
  ],
  twinLoops: [ // 27 Frost Bind — two linked clockwise loops (a chain)
    [...arc(32, 50, 16, 90, 450, 12), ...arc(68, 50, 16, 90, 450, 12)],
  ],
  burst5: [ // 29 Eclipse Glare — five-point star (pentagram, one stroke)
    (() => {
      const c = 50, r = 42, out = [];
      const order = [-90, 54, 198, 342, 126, -90];
      for (const d of order) out.push({ x: c + r * Math.cos(d * Math.PI / 180), y: c + r * Math.sin(d * Math.PI / 180) });
      return out;
    })(),
  ],
  twinLines: [ // 30 Thunderclap — two inward-leaning vertical lines
    [{ x: 28, y: 16 }, { x: 40, y: 84 }, { x: 72, y: 16 }, { x: 60, y: 84 }],
  ],

  // === Environmental ======================================================
  wavyLine: [ // 31 Oil Script — rounded wave, tall enough to differ from a flick
    [{ x: 8, y: 50 }, { x: 19, y: 33 }, { x: 31, y: 66 }, { x: 44, y: 34 },
     { x: 57, y: 66 }, { x: 69, y: 34 }, { x: 81, y: 66 }, { x: 92, y: 50 }],
  ],
  cloudArc: [ // 32 Rain Glyph — bumpy cloud top then a downward rain stroke
    [{ x: 18, y: 46 }, { x: 26, y: 32 }, { x: 40, y: 34 }, { x: 50, y: 26 },
     { x: 64, y: 32 }, { x: 80, y: 44 }, { x: 66, y: 60 }, { x: 56, y: 84 }],
  ],
  fanStrokes: [ // 33 Gust Wall — three fan blades radiating from a low pivot
    [{ x: 50, y: 86 }, { x: 24, y: 26 }, { x: 50, y: 86 }, { x: 50, y: 20 },
     { x: 50, y: 86 }, { x: 76, y: 26 }],
  ],
  quakeSlash: [ // 34 Quake — vertical line then a ground slash
    [{ x: 50, y: 12 }, { x: 50, y: 58 }, { x: 20, y: 80 }, { x: 84, y: 78 }],
  ],
  looseCircle: [ // 35 Fog Cloud — open "C" arc (a loose, unclosed circle)
    arc(50, 50, 38, -90, 180, 18),
  ],

  // === Secret =============================================================
  triTap: [ // 36 Rune Snare — inverted triangle then a placement tap nub
    [{ x: 28, y: 30 }, { x: 72, y: 30 }, { x: 50, y: 68 }, { x: 28, y: 30 },
     { x: 50, y: 82 }, { x: 53, y: 86 }],
  ],
  eightTap: [ // 37 Mirror Twin — horizontal infinity then a tap nub
    [{ x: 50, y: 46 }, { x: 70, y: 32 }, { x: 84, y: 46 }, { x: 70, y: 60 },
     { x: 50, y: 46 }, { x: 30, y: 32 }, { x: 16, y: 46 }, { x: 30, y: 60 }, { x: 50, y: 46 },
     { x: 50, y: 78 }, { x: 52, y: 82 }],
  ],
  hourglass: [ // 38 Hourglass Field — bowtie / hourglass outline
    [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 20, y: 80 }, { x: 80, y: 80 }, { x: 20, y: 20 }],
  ],
  phoenixWing: [ // 39 Phoenix Covenant — spread wings with a tall central peak
    [{ x: 10, y: 72 }, { x: 28, y: 36 }, { x: 40, y: 56 }, { x: 50, y: 18 },
     { x: 60, y: 56 }, { x: 72, y: 36 }, { x: 90, y: 72 }],
  ],
  starLine: [ // 40 Prismatic Beam — six-spoke radial star (asterisk)
    [{ x: 50, y: 50 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 85, y: 30 },
     { x: 50, y: 50 }, { x: 85, y: 70 }, { x: 50, y: 50 }, { x: 50, y: 90 },
     { x: 50, y: 50 }, { x: 15, y: 70 }, { x: 50, y: 50 }, { x: 15, y: 30 }, { x: 50, y: 50 }],
  ],
};

// Flatten into recognizer template records, tagging each with its spell id via
// the FULL loadout gesture-key mapping so classification is spell-aware for any
// legal online loadout (not just the starter eight).
export function buildTemplates() {
  const keyToSpellId = {};
  for (const [spellId, key] of Object.entries(GESTURE_KEYS)) keyToSpellId[key] = Number(spellId);
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
