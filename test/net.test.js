// net.test.js — shared networking helpers used by the client adapter and the
// server: bounded/quantized cast traces, per-slot snapshot/event remapping
// (self always renders as player 0), trace-envelope validation, and the
// protocol compatibility gate.

import { createHarness } from './tiny.js';
import {
  NET, boundTrace, traceByteSize, validateTraceEnvelope,
  remapSnapshotForSlot, remapEventsForSlot, remapEventForSlot,
} from '../shared/src/protocol/net.js';
import { isCompatible, PROTOCOL_VERSION, BALANCE_VERSION, ROSTER_CHECKSUM } from '../shared/src/protocol/version.js';

export function run() {
  const { ok, eq, report } = createHarness();

  // --- boundTrace: caps point count + quantizes to integers -------------
  const many = Array.from({ length: 200 }, (_, i) => ({ x: Math.sin(i) * 40 + 50, y: Math.cos(i) * 40 + 50 }));
  const bounded = boundTrace(many);
  ok(bounded.length <= NET.MAX_TRACE_POINTS, `boundTrace caps at ${NET.MAX_TRACE_POINTS} points (got ${bounded.length})`);
  ok(bounded.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)), 'boundTrace quantizes coordinates to integers');
  ok(traceByteSize(bounded) <= NET.MAX_CAST_BYTES, 'a capped trace fits under the payload cap');

  // Non-finite points are dropped before quantization.
  const dirty = boundTrace([{ x: 1, y: 2 }, { x: NaN, y: 3 }, { x: 4, y: 5 }, { x: 6, y: Infinity }]);
  ok(dirty.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 'boundTrace drops non-finite points');

  // Short traces pass through (rounded) without resampling.
  const short = boundTrace([{ x: 5.4, y: 50.6 }, { x: 95.2, y: 50.1 }]);
  eq(short.length, 2, 'short trace preserved');
  eq(short[0].x, 5, 'coordinate rounded');

  // --- validateTraceEnvelope --------------------------------------------
  const okPts = Array.from({ length: 8 }, (_, i) => ({ x: i * 10, y: 50 }));
  eq(validateTraceEnvelope({ points: okPts, durationMs: 300 }).ok, true, 'well-formed envelope accepted');
  eq(validateTraceEnvelope({ points: okPts, durationMs: 10 }).code, 'too-fast', 'too-fast duration rejected');
  eq(validateTraceEnvelope({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], durationMs: 300 }).code, 'malformed', 'too-few points rejected');
  const over = Array.from({ length: NET.MAX_TRACE_POINTS + 5 }, (_, i) => ({ x: i, y: i }));
  eq(validateTraceEnvelope({ points: over, durationMs: 300 }).code, 'oversize', 'too many points rejected');
  eq(validateTraceEnvelope({ points: [{ x: 0, y: 0 }, { x: 1, y: NaN }, { x: 2, y: 2 }, { x: 3, y: 3 }], durationMs: 300 }).code, 'malformed', 'non-finite point rejected');
  eq(validateTraceEnvelope(null).code, 'payload', 'null envelope rejected');

  // --- remap: recipient always sees itself as wizard 0 -------------------
  const canon = {
    tick: 10, winner: 1,
    wizards: [
      { id: 0, health: 80, aether: 40 },
      { id: 1, health: 55, aether: 30 },
    ],
    projectiles: [{ id: 7, owner: 0, spellId: 1 }],
    zones: [{ id: 3, owner: 1, kind: 'Oil' }],
  };
  const slot0 = remapSnapshotForSlot(canon, 0);
  eq(slot0.wizards[0].health, 80, 'slot 0 sees itself unchanged (identity)');
  eq(slot0.winner, 1, 'slot 0 winner unchanged');

  const slot1 = remapSnapshotForSlot(canon, 1);
  eq(slot1.wizards[0].health, 55, 'slot 1 sees ITSELF as wizard 0');
  eq(slot1.wizards[1].health, 80, 'slot 1 sees opponent as wizard 1');
  eq(slot1.wizards[0].id, 0, 'remapped self id is 0');
  eq(slot1.projectiles[0].owner, 1, "slot 1 sees the opponent's projectile owner as 1");
  eq(slot1.zones[0].owner, 0, 'slot 1 sees its own zone owner as 0');
  eq(slot1.winner, 0, 'slot 1 sees itself as the winner (server slot 1 won)');
  // Original snapshot is not mutated.
  eq(canon.wizards[0].health, 80, 'remap does not mutate the canonical snapshot');

  // --- remap events ------------------------------------------------------
  const evs = [{ type: 'damage', target: 1, amount: 8 }, { type: 'cast', caster: 0, spellId: 1 }];
  const evs1 = remapEventsForSlot(evs, 1);
  eq(evs1[0].target, 0, 'slot 1: a hit on server-slot-1 is a hit on local self (0)');
  eq(evs1[1].caster, 1, 'slot 1: the server-slot-0 caster is the local opponent (1)');
  const evs0 = remapEventsForSlot(evs, 0);
  eq(evs0[0].target, 1, 'slot 0 events pass through');
  eq(remapEventForSlot({ type: 'roundEnd', winner: 'draw' }, 1).winner, 'draw', 'draw winner is not remapped');

  // Reaction events carry a slot-bearing targetId (flipped per recipient) AND a
  // purely spatial `center` arc position that must NEVER be flipped, even when it
  // happens to equal 0 or 1 (arc positions are shared, not per-slot).
  const react = { type: 'reaction', name: 'ConductiveArc', category: 'conduct', casterId: 0, targetId: 1, center: 1 };
  const react1 = remapEventForSlot({ ...react }, 1);
  eq(react1.casterId, 1, 'slot 1: reaction casterId is flipped to the local opponent');
  eq(react1.targetId, 0, 'slot 1: reaction targetId is flipped to local self');
  eq(react1.center, 1, 'slot 1: reaction center (arc position) is preserved, not flipped');
  const react0 = remapEventForSlot({ ...react }, 0);
  eq(react0.casterId, 0, 'slot 0: reaction event passes through (caster)');
  eq(react0.targetId, 1, 'slot 0: reaction event passes through (target)');

  // --- compatibility gate ------------------------------------------------
  ok(isCompatible({ protocol: PROTOCOL_VERSION, balance: BALANCE_VERSION, roster: ROSTER_CHECKSUM }), 'matching version is compatible');
  ok(!isCompatible({ protocol: PROTOCOL_VERSION + 1, balance: BALANCE_VERSION, roster: ROSTER_CHECKSUM }), 'protocol mismatch is incompatible');
  ok(!isCompatible({ protocol: PROTOCOL_VERSION, balance: BALANCE_VERSION, roster: 'deadbeef' }), 'roster mismatch is incompatible');

  return report('net');
}
