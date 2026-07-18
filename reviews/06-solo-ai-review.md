# Independent Practice AI Review

## Evidence reviewed

- The current bot exposes four internal lore tiers rather than the requested three practice tiers: `shared/src/bot/bot.js:17-21`.
- It assigns `castQuality: 1` on most decisions and does not pass through gesture recognition: `shared/src/bot/bot.js:100-216`.
- Its proactive cadence is a single `reactionTicks` gate rather than a perception ledger: `shared/src/bot/bot.js:125-126`.
- Planning is an integer feature gate, not a time horizon: `shared/src/bot/bot.js:91`.
- Current bot tests prove termination and resource bounds but do not prove difficulty ordering: `test/bot.test.js:12-52`.
- Loadout legality is centralized and reusable: `shared/src/balance/loadouts.js:75-119`.

## Independent findings

1. The existing AI is fair on combat resources but not on gesture execution because it is effectively perfect.
2. Lowering aggression alone would make Easy passive, not beginner-like. Easy needs plausible mistakes and delayed perception.
3. Hard may counter-build only through the same validator and public spell information. Counter-building is a legitimate difficulty axis and must be explicit in the fairness contract.
4. Difficulty ordering cannot be assumed from profile numbers. Mirrored seeded win-rate tests are required.
5. A constrained Hard loadout search needs a deterministic fallback to a legal preset.
6. The public UI must migrate from Apprentice/Adept/Magus/Archmage to exactly Easy/Medium/Hard for Practice vs AI; internal legacy names may remain only for old tests or scripted exam mapping.

## Required corrections incorporated

- Three dedicated practice profiles.
- Exact non-zero perception delays.
- Shared player/AI quality mapping and gesture misses.
- Bounded planning horizons and observed-action memory.
- Legal loadout policies with deterministic fallback.
- Equal-rule, determinism, and ordering tests.

## Dissent and risk

The proposed Hard-versus-Medium win-rate threshold can become brittle if tested with one matchup. Ordering tests must use mirrored seeds and multiple equal legal loadouts; otherwise a single archetype counter could be mistaken for general intelligence.

## Fairness conclusion

Hard AI may be smarter, faster, and more adaptive, but it may not receive better numbers, hidden information, instant reactions, illegal loadouts, or perfect execution.
