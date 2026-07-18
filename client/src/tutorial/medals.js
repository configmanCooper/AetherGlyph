// medals.js — optional mastery medals (SOLO-MODES-PLAN §6, §24).
//
// Medals are never a paywall and never gate ranked play. Each medal is a lesson-
// authored { id, text, predicate } evaluated at SUCCESS against the same pure
// objective predicate registry. A medal is disabled when the player pinned a
// guide stage for one of the lesson's taught spells (guide locking allows
// completion but forfeits mastery, §5).

import { CAMPAIGN } from './campaign.js';
import { evaluatePredicate } from './objectives.js';

// All medals declared across the campaign, tagged with their lesson.
export const MEDALS = CAMPAIGN
  .filter((l) => l.medal)
  .map((l) => ({ lessonId: l.id, ...l.medal }));

export const MEDALS_BY_ID = Object.freeze(
  MEDALS.reduce((m, x) => { m[x.id] = x; return m; }, {}),
);

export function medalForLesson(lessonId) {
  const lesson = CAMPAIGN.find((l) => l.id === lessonId);
  return lesson && lesson.medal ? { lessonId, ...lesson.medal } : null;
}

// Evaluate whether the lesson's medal was earned this run. `guideLocked` marks a
// forfeited medal (the player pinned a guide stage for the lesson).
export function evaluateMedal(lesson, tracker, sim, { guideLocked = false } = {}) {
  if (!lesson || !lesson.medal) return { earned: false, medal: null };
  if (guideLocked) return { earned: false, medal: lesson.medal, forfeited: true };
  const earned = evaluatePredicate(lesson.medal.predicate, tracker, sim);
  return { earned, medal: lesson.medal };
}
