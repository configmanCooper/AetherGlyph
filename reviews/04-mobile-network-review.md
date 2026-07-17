# Independent Mobile, Network, and Release Review

## Verdict

Capacitor plus a Three.js client and authoritative Node service is appropriate. Gesture claims, damage, statuses, and match outcomes cannot be client authoritative.

## Mobile decisions accepted

- Landscape phone-first layout.
- Soft camera lock instead of free-look during glyph drawing.
- Separate left movement and right drawing zones.
- Left-handed mirroring.
- Cutout/system-gesture safe areas.
- HTML menus and accessibility controls.
- Adjustable rune pad, motion, haptics, contrast, and text.
- Optional practice assistance does not alter ranked shape requirements.

## Recognition decisions accepted

- Shared client/server recognizer.
- Quantized bounded trace packet.
- Server repeats classification.
- Ambiguity rejects instead of selecting a near spell.
- Recognition compares only equipped spells online.
- Screen and hand calibration remains local.
- Raw gesture paths are not retained by default.

## Network decisions accepted

- 30 Hz authoritative fixed simulation.
- 10-15 Hz snapshots/deltas.
- Sequenced intents and acknowledgements.
- Prediction only for local motion and windup.
- Bounded 150 ms collision rewind.
- Resume epochs and one-use tickets.
- Full snapshot after reconnect.
- No assumption of Render sticky sessions.
- Graceful deployment drain and durable recent snapshots.

## Render risk

A single regional service is acceptable for closed alpha only after measured latency and capacity tests. Horizontal scaling is prohibited until:

- each match has one fenced owner,
- reconnect can locate or recover the match,
- snapshots survive process loss,
- split-brain tests pass,
- load testing proves the extra topology is needed.

## Play release decisions accepted

- Capacitor is the primary Play package.
- Android App Bundle.
- Target API 36.
- Minimum permissions.
- Play App Signing.
- In-app and web account deletion if accounts exist.
- Accurate Data Safety and privacy disclosures.
- Internal and closed tracks before production.

## Highest-risk assumptions

1. Forty glyphs can be made distinct enough across real phones.
2. A single launch region provides fair latency to the intended audience.
3. Visual readability survives two players, four zones, weather, and heavy casts.
4. The Render service can meet cost and capacity targets.

The milestone order in the master plan proves these assumptions before broad content production.

