# Environmental Reaction Matrix

Environmental magic changes a shared arena. Ownership controls zone limits and scoring attribution, but never grants immunity.

## Deterministic reaction priority

When several reactions become legal in the same simulation tick:

1. Douse
2. Ground
3. Freeze or melt
4. Conduct
5. Ignite
6. Spread or disperse
7. Cover destruction

This order is data-versioned and covered by replay tests.

## Reactions

| Existing state | Incoming school/effect | Result | Gameplay value | Answers |
| --- | --- | --- | --- | --- |
| Oil | Ember | Flash Fire | Oil is consumed; 10 area damage and Burning 1; once/sec cap | Rain before ignition; Barrier; leave |
| Oil | Rain | Washed Ground | Oil is removed; Wet remains for half duration | Reapply Oil later |
| Oil | Gust | Drifting Oil | Zone edge shifts in gust direction; cannot move through a wizard | Step away; Rain |
| Wet | Storm | Conductive Arc | Lightning area increases; Soaked target takes 25 percent more | Grounding; Dispel; leave Wet |
| Wet | Tide/Frost | Frozen Ground | Wet zone becomes a visible slow surface for 3 sec | Ember melts; avoid |
| Frozen Ground | Ember | Steam Veil | Frozen state ends; creates short shared Fog | Gust; Flame Wave; leave |
| Burning | Rain/Tide | Doused | Burning stacks and fire zone end | Rebuild Ember setup |
| Burning | Gust | Spreading Flame | Fire zone widens but loses duration; affects both players | Rain; move upwind |
| Fog | Gust | Cleared Air | Fog rapidly disperses | Recast later |
| Fog | Flame Wave | Backlit Fog | Fog clears and briefly silhouettes both wizards | Barrier; reposition |
| Storm projectile | Grounding Mantle | Grounded | Lightning bonus and new Static application are canceled | Sunder; Aether Leech; zones |
| Stone Wall | Quake | Rubble | Wall is destroyed; brief rubble slow, no hard control | Blink; avoid wall dependence |
| Stone Wall | Fireball | Fractured Cover | Wall loses most health and may break | Move before impact |
| Chilled target | Frost Bind | Freeze | 1 sec hard control; consumes Chilled and grants Tenacity afterward | Dispel before bind; Blink |
| Soaked or Static 3 target | Thunderclap | Stun | 0.8 sec hard control; consumes setup and grants Tenacity | Dispel; Grounding; spacing |
| Mixed resonance | Prismatic Beam | Spectrum | Beam gains small utility based on the two prior schools; direct damage remains capped | Interrupt; Barrier; cover |

## Interaction constraints

- A reaction can consume at most one environment and one status.
- Reactions never recursively trigger a third reaction in the same event.
- Hard-control reactions use the global Tenacity state.
- Oil and fire cannot be hidden completely under Fog; their boundaries remain outlined.
- Moving zones cannot cross outside legal arena bounds.
- No zone is larger than 28 percent of traversable area.
- A player may own at most two active zones.
- Recasting the same zone replaces the oldest owned zone.
- Ranked arenas contain no random weather.

## Prismatic Beam mixed resonance utility

The two visible resonance marks determine one small, non-stacking modifier:

| Pair | Modifier |
| --- | --- |
| Ember + Gale | beam width +10 percent |
| Tide + Storm | apply Static 1 if at least half the channel lands |
| Tide + Stone | create a 1-second Grounded strip |
| Stone + Ember | +20 percent cover damage |
| Gale + Tide | clear Fog along beam |
| Any repeated school | no utility modifier; Aether discount already rewarded repetition |

No modifier raises total player damage above 28.
