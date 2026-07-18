// progress.js — versioned, local, single-player solo profile store.
//
// Persists tutorial/campaign progress under the key `aeg.solo.v1` (SOLO-MODES-
// PLAN §12). DOM-free: a storage adapter is injected so this runs identically in
// the browser (localStorage) and in Node tests (an in-memory map). The store is
// defensive by contract:
//   - validate on load,
//   - migrate older schema versions forward,
//   - reset safely on corruption (never throw on startup),
//   - persist a checkpoint after every lesson / exam stage,
//   - preserve calibration across a corruption reset when possible,
//   - expose a single deleteProfile() for Delete My Data.
//
// It NEVER stores live combat state or raw gesture traces — only the small set
// of durable fields below. validateProfile() strips anything unrecognised so a
// tampered or bloated blob cannot smuggle combat snapshots back in.

export const SOLO_KEY = 'aeg.solo.v1';
export const SCHEMA_VERSION = 1;

// The four secret spell ids (roster 37-40), tracked as discovered / not.
export const SECRET_IDS = [37, 38, 39, 40];

// The lesson that grants ranked readiness. Nothing else may set it (§9, §24).
export const RANKED_UNLOCK_LESSON = 'L12';

const GUIDE_STAGE_MIN = 0;
const GUIDE_STAGE_MAX = 3;
const HANDS = new Set(['right', 'left']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const COACHING = new Set(['summary', 'detailed']);

// --- storage adapter -------------------------------------------------------
// A tiny synchronous key/value adapter. In the browser we wrap localStorage; in
// tests callers pass their own object with getItem/setItem/removeItem.
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function defaultStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  } catch { /* access can throw in sandboxed frames */ }
  return memoryStorage();
}

// --- defaults --------------------------------------------------------------
export function defaultCalibration() {
  return { hand: 'right', guideScale: 0.84, comfortableDurationMs: 720 };
}

export function defaultProfile() {
  const secretsFound = {};
  for (const id of SECRET_IDS) secretsFound[String(id)] = false;
  return {
    schemaVersion: SCHEMA_VERSION,
    currentLessonId: 'PROLOGUE',
    completedLessons: [],
    spellGuideStage: {},          // spellId(str) -> stage 0..3
    medals: {},                   // medalId -> true
    clues: {},                    // clueId -> true
    secretsFound,                 // "37".."40" -> bool
    rankedReady: false,
    calibration: defaultCalibration(),
    practice: { difficulty: 'medium', opponentPreset: 'auto', coaching: 'detailed' },
    stats: { lessonAttempts: {}, rejectionReasons: {} },
  };
}

// --- validation ------------------------------------------------------------
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function clampStage(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(GUIDE_STAGE_MIN, Math.min(GUIDE_STAGE_MAX, n));
}
function boolMap(src) {
  const out = {};
  if (isPlainObject(src)) for (const [k, v] of Object.entries(src)) if (v === true) out[String(k)] = true;
  return out;
}
function countMap(src) {
  const out = {};
  if (isPlainObject(src)) {
    for (const [k, v] of Object.entries(src)) {
      const n = Math.round(Number(v));
      if (Number.isFinite(n) && n > 0) out[String(k)] = n;
    }
  }
  return out;
}

// Coerce an arbitrary parsed blob into a strictly-shaped, safe profile. Unknown
// keys are dropped; malformed fields fall back to defaults. Returns a brand-new
// object (never aliases the input) so callers cannot leak untrusted references.
export function validateProfile(input) {
  const d = defaultProfile();
  if (!isPlainObject(input)) return d;

  const out = defaultProfile();

  if (typeof input.currentLessonId === 'string' && input.currentLessonId) {
    out.currentLessonId = input.currentLessonId;
  }
  if (Array.isArray(input.completedLessons)) {
    const seen = new Set();
    out.completedLessons = input.completedLessons
      .filter((x) => typeof x === 'string' && x.length && !seen.has(x) && seen.add(x));
  }
  if (isPlainObject(input.spellGuideStage)) {
    for (const [id, stage] of Object.entries(input.spellGuideStage)) {
      const s = clampStage(stage);
      if (s != null && /^\d+$/.test(String(id))) out.spellGuideStage[String(id)] = s;
    }
  }
  out.medals = boolMap(input.medals);
  out.clues = boolMap(input.clues);

  // secretsFound: always exactly the four known secret ids.
  for (const id of SECRET_IDS) {
    const k = String(id);
    out.secretsFound[k] = !!(isPlainObject(input.secretsFound) && input.secretsFound[k] === true);
  }

  out.rankedReady = input.rankedReady === true;

  if (isPlainObject(input.calibration)) {
    const c = input.calibration;
    out.calibration.hand = HANDS.has(c.hand) ? c.hand : d.calibration.hand;
    const scale = Number(c.guideScale);
    out.calibration.guideScale = Number.isFinite(scale)
      ? Math.max(0.4, Math.min(1.5, scale)) : d.calibration.guideScale;
    const dur = Math.round(Number(c.comfortableDurationMs));
    out.calibration.comfortableDurationMs = Number.isFinite(dur)
      ? Math.max(120, Math.min(6000, dur)) : d.calibration.comfortableDurationMs;
  }

  if (isPlainObject(input.practice)) {
    const p = input.practice;
    out.practice.difficulty = DIFFICULTIES.has(p.difficulty) ? p.difficulty : d.practice.difficulty;
    out.practice.opponentPreset = typeof p.opponentPreset === 'string' && p.opponentPreset
      ? p.opponentPreset : d.practice.opponentPreset;
    out.practice.coaching = COACHING.has(p.coaching) ? p.coaching : d.practice.coaching;
  }

  if (isPlainObject(input.stats)) {
    out.stats.lessonAttempts = countMap(input.stats.lessonAttempts);
    out.stats.rejectionReasons = countMap(input.stats.rejectionReasons);
  }

  out.schemaVersion = SCHEMA_VERSION;
  return out;
}

// --- migrations ------------------------------------------------------------
// Each migration takes a blob at version N and returns a blob at version N+1.
// Migrations run in order until the current SCHEMA_VERSION is reached. There is
// only one schema version today; the ladder exists so future roster/UX changes
// (e.g. a v2 that renames a field) can upgrade a v1 blob without data loss.
const MIGRATIONS = {
  // 0 -> 1: pre-versioned experimental blobs. Fold any legacy fields forward.
  0: (blob) => ({ ...blob, schemaVersion: 1 }),
};

export function migrateProfile(input) {
  if (!isPlainObject(input)) return null;
  let blob = input;
  let version = Number(blob.schemaVersion);
  if (!Number.isFinite(version)) version = 0;
  let guard = 0;
  while (version < SCHEMA_VERSION && guard < 16) {
    const step = MIGRATIONS[version];
    if (!step) break; // no known path; caller falls back to validation/reset
    blob = step(blob) || blob;
    version = Number(blob.schemaVersion) || version + 1;
    guard += 1;
  }
  return blob;
}

// --- load / save / delete --------------------------------------------------
export function loadProfile(storage = defaultStorage()) {
  let raw = null;
  try { raw = storage.getItem(SOLO_KEY); } catch { raw = null; }
  if (raw == null) return defaultProfile();

  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (!isPlainObject(parsed)) {
    // Corrupt JSON — reset to a fresh profile (never throw on startup).
    return defaultProfile();
  }

  const migrated = migrateProfile(parsed) || parsed;
  return validateProfile(migrated);
}

export function saveProfile(profile, storage = defaultStorage()) {
  const safe = validateProfile(profile);
  try { storage.setItem(SOLO_KEY, JSON.stringify(safe)); } catch { /* quota / private mode */ }
  return safe;
}

export function deleteProfile(storage = defaultStorage()) {
  try { storage.removeItem(SOLO_KEY); } catch { /* ignore */ }
}

// Reset progress but keep the player's calibration (used by an explicit "reset
// campaign" affordance; Delete My Data uses deleteProfile instead).
export function resetProfileKeepingCalibration(profile) {
  const fresh = defaultProfile();
  if (profile && isPlainObject(profile.calibration)) {
    fresh.calibration = validateProfile({ calibration: profile.calibration }).calibration;
  }
  return fresh;
}

// --- pure mutators ---------------------------------------------------------
// These return the SAME profile object mutated in place for convenience in the
// runner/UI, but always re-normalise the touched field. Callers persist with
// saveProfile() afterwards (a checkpoint).
export function getGuideStage(profile, spellId, fallback = 0) {
  const v = profile.spellGuideStage[String(spellId)];
  return v == null ? fallback : v;
}

export function setGuideStage(profile, spellId, stage) {
  const s = clampStage(stage);
  if (s != null) profile.spellGuideStage[String(spellId)] = s;
  return profile;
}

// Advance a spell's guide one step toward None (higher stage = less help),
// never past None. Returns the new stage.
export function advanceGuideStage(profile, spellId, max = GUIDE_STAGE_MAX) {
  const cur = getGuideStage(profile, spellId, 0);
  const next = Math.min(GUIDE_STAGE_MAX, Math.min(max, cur + 1));
  setGuideStage(profile, spellId, next);
  return next;
}

export function isLessonComplete(profile, lessonId) {
  return profile.completedLessons.includes(lessonId);
}

// Mark a lesson/exam stage complete and set the next lesson pointer. Ranked
// readiness is ONLY ever set here for the designated unlock lesson.
export function completeLesson(profile, lessonId, nextLessonId = null) {
  if (!profile.completedLessons.includes(lessonId)) profile.completedLessons.push(lessonId);
  if (lessonId === RANKED_UNLOCK_LESSON) profile.rankedReady = true;
  if (nextLessonId) profile.currentLessonId = nextLessonId;
  return profile;
}

export function awardMedal(profile, medalId) {
  if (medalId) profile.medals[String(medalId)] = true;
  return profile;
}
export function hasMedal(profile, medalId) {
  return profile.medals[String(medalId)] === true;
}

export function setClue(profile, clueId) {
  if (clueId) profile.clues[String(clueId)] = true;
  return profile;
}
export function hasClue(profile, clueId) {
  return profile.clues[String(clueId)] === true;
}

export function discoverSecret(profile, spellId) {
  const k = String(spellId);
  if (k in profile.secretsFound) profile.secretsFound[k] = true;
  return profile;
}
export function isSecretFound(profile, spellId) {
  return profile.secretsFound[String(spellId)] === true;
}

export function setCalibration(profile, calibration) {
  const norm = validateProfile({ calibration }).calibration;
  profile.calibration = norm;
  return profile;
}

export function recordAttempt(profile, lessonId) {
  const k = String(lessonId);
  profile.stats.lessonAttempts[k] = (profile.stats.lessonAttempts[k] || 0) + 1;
  return profile;
}
export function recordRejection(profile, reason) {
  const k = String(reason || 'unknown');
  profile.stats.rejectionReasons[k] = (profile.stats.rejectionReasons[k] || 0) + 1;
  return profile;
}

// Percentage of the required campaign complete (0..100), given the ordered list
// of required (non-optional) lesson ids.
export function completionPercent(profile, requiredLessonIds) {
  if (!requiredLessonIds || requiredLessonIds.length === 0) return 0;
  const done = requiredLessonIds.filter((id) => profile.completedLessons.includes(id)).length;
  return Math.round((done / requiredLessonIds.length) * 100);
}
