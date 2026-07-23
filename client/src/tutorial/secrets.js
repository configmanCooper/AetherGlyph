// secrets.js — optional secret spell discoveries (SOLO-MODES-PLAN §10, §11).
//
// Secrets are mysteries, never competitive paywalls: they are always optional and
// never required for ranked readiness. Each secret has campaign CLUES (set by
// certain lessons) and a TRIAL lesson (T37-T40) that, when completed, marks the
// spell discovered in the local solo profile. After discovery the codex may show
// full statistics and counters.

import { SPELLS_BY_ID } from '../../../shared/src/balance/spellData.generated.js';
import { CAMPAIGN } from './campaign.js';
import { isSecretFound, discoverSecret, setClue, hasClue } from './progress.js';

// The four secret spells, their clue chain, and the trial that unlocks them.
export const SECRETS = [
  { spellId: 37, name: 'Mirror Twin', trialId: 'T37',
    tagline: 'Two hands write one intention.',
    clues: ['mirrorEight'] },
  { spellId: 38, name: 'Hourglass Field', trialId: 'T38',
    tagline: 'The sand catches hostile magic, never its keeper.',
    clues: ['hourglassMovement'] },
  { spellId: 39, name: 'Phoenix Covenant', trialId: 'T39',
    tagline: 'A flame survives only when the enemy knows it burns.',
    clues: ['phoenixOil'] },
  { spellId: 40, name: 'Prismatic Beam', trialId: 'T40',
    tagline: 'No single color opens the spectrum.',
    clues: ['prismaticReactions'] },
];

export const SECRETS_BY_ID = Object.freeze(
  SECRETS.reduce((m, s) => { m[s.spellId] = s; return m; }, {}),
);
export const SECRETS_BY_TRIAL = Object.freeze(
  SECRETS.reduce((m, s) => { m[s.trialId] = s; return m; }, {}),
);

// Every clue id referenced by a lesson (`clues: [...]`) or a secret chain.
export function allClueIds() {
  const ids = new Set();
  for (const l of CAMPAIGN) for (const c of l.clues || []) ids.add(c);
  for (const s of SECRETS) for (const c of s.clues) ids.add(c);
  return [...ids];
}

export function secretForTrial(trialId) { return SECRETS_BY_TRIAL[trialId] || null; }

// A secret is "hinted" once the player has found all of its clues. Its optional
// trial then becomes visible and playable in the tutorial hub.
export function isSecretHinted(profile, spellId) {
  const s = SECRETS_BY_ID[spellId];
  return !!s && s.clues.every((c) => hasClue(profile, c));
}

// Apply any clues a lesson grants on completion (mutates + returns the profile).
export function grantLessonClues(profile, lesson) {
  for (const c of (lesson && lesson.clues) || []) setClue(profile, c);
  return profile;
}

// Mark a secret discovered when its trial lesson is completed (mutates profile).
export function discoverFromTrial(profile, trialId) {
  const s = secretForTrial(trialId);
  if (s) discoverSecret(profile, s.spellId);
  return profile;
}

// Codex view of a secret: revealed stats/counters only after discovery (§11).
export function codexEntry(profile, spellId) {
  const s = SECRETS_BY_ID[spellId];
  if (!s) return null;
  const found = isSecretFound(profile, spellId);
  const spell = SPELLS_BY_ID[spellId];
  return {
    spellId, name: s.name, tagline: s.tagline, found,
    hinted: isSecretHinted(profile, spellId),
    effect: found ? spell.effect : '???',
    counters: found ? spell.counterList : [],
  };
}
