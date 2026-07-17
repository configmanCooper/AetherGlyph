// tutorial.js — Phase 1 tutorial introduction.
//
// A short guided sequence that teaches the core loop with on-pad glyph guides,
// using the SAME recognizer and sim the rest of the game uses (MASTERPLAN §13).
// Each step completes when the player successfully casts the taught spell.

import { GESTURE_TEMPLATES } from '@shared/gesture/templates.js';
import { STARTER_GESTURE_KEYS } from '@shared/balance/loadouts.js';

const idForKey = {};
for (const [id, key] of Object.entries(STARTER_GESTURE_KEYS)) idForKey[key] = Number(id);

export const LESSONS = [
  {
    key: 'flickRight', spellId: idForKey.flickRight,
    title: 'Lesson 1 — Ember Bolt',
    text: 'Draw a quick horizontal flick to the right on the draw pad to cast Ember Bolt. Follow the dotted guide, starting at the green dot.',
  },
  {
    key: 'lineUp', spellId: idForKey.lineUp,
    title: 'Lesson 2 — Frost Lance',
    text: 'Draw a straight line upward to cast Frost Lance. It deals damage and Chills the target, slowing them.',
  },
  {
    key: 'bracket', spellId: idForKey.bracket,
    title: 'Lesson 3 — Ward',
    text: 'Draw an open bracket to raise a Ward, a frontal shield that absorbs an incoming spell. Defense wins duels.',
  },
];

export function guideFor(key) {
  const variants = GESTURE_TEMPLATES[key];
  return variants ? variants[0] : null;
}
