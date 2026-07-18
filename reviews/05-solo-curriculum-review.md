# Independent Solo Curriculum Review

## Evidence reviewed

- The current tutorial contains only three flat cast checks and no objective state machine: `client/src/tutorial/tutorial.js:13-29`.
- Tutorial progress is held only in the runtime `tutorialIndex` variable: `client/src/app/main.js:45,247-260`.
- Practice currently disables the bot because only `newMode === 'duel'` activates it: `client/src/app/main.js:163`.
- The production recognizer already supports loadout-scoped classification and diagnostic rejection reasons: `shared/src/gesture/recognizer.js:92-144`.
- Forty authored gesture templates are verified by the test suite: `test/templates.test.js:51-52`.
- The simulation exposes statuses, zones, reactions, Focus, control, and deterministic events suitable for objective predicates: `shared/src/sim/sim.js`.

## Independent findings

1. The current tutorial is not a tutorial campaign; it is a three-cast input demonstration. It cannot teach resource timing, counters, environment reactions, loadouts, or legal duels.
2. Extending the existing `checkLesson(spellId)` chain would create fragile content code. A declarative lesson schema and event-driven runner are necessary.
3. The highest onboarding risk is cognitive overload on a landscape phone. Narration must disappear during drawing, early lessons must disable the timer, and each lesson must teach one primary concept.
4. Scripted instructors are justified for repeatable teaching moments, but final exams must use the real fair AI so tutorial completion predicts actual play.
5. Claiming complete spell education requires a machine-checked union of lesson, drill, and secret-trial IDs equal to 1-40.

## Required corrections incorporated

- Data-driven campaign and objective registry.
- Production recognizer and simulation only.
- Per-spell Full -> Dotted -> Start -> None guides.
- Reliable scripted instructors plus real duel exams.
- Checkpoints and remediation that never auto-cast.
- All-40 spell coverage assertion.

## Dissent and risk

Sixteen lessons plus drills are too large for one uninterrupted campaign. Academy content must remain optional after Lesson 12, and the UI must clearly show short chapter boundaries. Otherwise completion fatigue will undermine the otherwise sound curriculum.
