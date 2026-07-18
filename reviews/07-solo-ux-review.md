# Independent Solo UX and Accessibility Review

## Evidence reviewed

- The current client already separates Three.js rendering from semantic HTML menus/HUD: `client/index.html`.
- Left-handed and reduced-motion settings are applied in the app shell: `client/src/app/main.js:649-663`.
- Gesture input currently draws one dotted guide and exposes recognizer diagnostics: `client/src/input/gestureInput.js`.
- Android is locked to landscape and uses safe native packaging: `android/app/src/main/AndroidManifest.xml:12-19`.
- Delete My Data currently removes only identity, name, resume token, and server URL: `client/src/app/main.js:702-706`.
- The public deletion disclosure lists the same limited local categories: `client/account-deletion.html:33-42`.

## Independent findings

1. Tutorial and Practice vs AI must be explicitly labeled offline and single-player so players do not confuse AI training with matchmaking.
2. The no-opponent drawing screen should be renamed Glyph Laboratory; calling both experiences "Practice" would be ambiguous.
3. Left-handed layout must move controls but preserve canonical glyph direction, because online recognition is direction-sensitive.
4. Narration cannot overlap active tracing. The draw pad should contain only guide and ink during motor input.
5. Guide locking is an accessibility tool, but assisted Practice rounds should be marked in coaching rather than inventing an undefined medal system.
6. The new `aeg.solo.v1` data must be named in the in-app deletion prompt and public account-deletion page, not only removed in code.
7. Ranked readiness should occur at Lesson 12; optional Academy, medals, and secrets must not gate online access.

## Required corrections incorporated

- Distinct Tutorial, Practice vs AI, and Glyph Laboratory labels.
- Exactly Easy, Medium, and Hard in Practice.
- Semantic coach panel, progressive guides, reduced-motion behavior, and non-color cues.
- Versioned local progress with corruption recovery.
- Explicit deletion documentation for solo progress.

## Dissent and risk

TalkBack while a real-time duel is active may be overwhelming. The accessible path should prioritize pre-action narration, objective summaries, and pauseable drills rather than attempting continuous screen-reader narration during live combat.

## Launch gates

- Complete lessons on representative Android screens.
- Test large font and TalkBack.
- Verify no portrait/cutout overlap.
- Verify background and low-memory restart recovery.
- Meet gesture acceptance and wrong-spell thresholds with real-device traces.
