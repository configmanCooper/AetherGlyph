import { createHarness } from './tiny.js';
import { wizardInsideZone } from '../client/src/render/zoneGeometry.js';

export function run() {
  const { ok, eq, report } = createHarness();
  const fog = { center: 0, radius: 0.8 };
  ok(wizardInsideZone({ arcPos: 0.3 }, fog),
    'plain online wizard snapshot is detected inside Fog');
  eq(wizardInsideZone({ arcPos: 0.9 }, fog), false,
    'plain online wizard snapshot is detected outside Fog');
  eq(wizardInsideZone(null, fog), false, 'missing wizard snapshot is safe');
  eq(wizardInsideZone({ arcPos: 0 }, null), false, 'missing zone snapshot is safe');
  return report('zoneGeometry');
}
