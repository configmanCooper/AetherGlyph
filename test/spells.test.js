// spells.test.js — spell generation + catalog integrity.

import { createHarness } from './tiny.js';
import { generate, parseCsv, rowsToSpells } from '../scripts/generate-spells.js';
import { SPELL_CATALOG, SPELLS_BY_ID, getSpell, SPELLS_SOURCE_CHECKSUM }
  from '../shared/src/balance/spellData.generated.js';
import { starterLoadout, loadoutPoints, STARTER_SPELL_IDS } from '../shared/src/balance/loadouts.js';

export function run() {
  const { ok, eq, report } = createHarness();

  // CSV parser handles quoted fields with embedded commas/semicolons.
  const rows = parseCsv('a,b,c\n1,"x, y","p; q"\n');
  eq(rows.length, 2, 'parseCsv row count');
  eq(rows[1][1], 'x, y', 'parseCsv keeps quoted comma');

  // Generated data matches a fresh regeneration (no stale checked-in file).
  const fresh = generate();
  eq(fresh.checksum, SPELLS_SOURCE_CHECKSUM, 'generated checksum is current');
  eq(fresh.spells.length, SPELL_CATALOG.length, 'generated length matches checked-in');
  eq(SPELL_CATALOG.length, 40, 'catalog has all 40 spells');

  // Numeric coercion + boolean parsing.
  const fireball = getSpell('Fireball');
  ok(fireball && typeof fireball.aether === 'number', 'Fireball aether numeric');
  eq(getSpell(39).secret, true, 'Phoenix Covenant is secret (boolean)');
  ok(Array.isArray(getSpell(1).counterList) && getSpell(1).counterList.length >= 2,
    'every spell has >=2 counters (Ember Bolt)');

  // MASTERPLAN §9 roster invariant: every spell has >=2 named counters.
  let allHaveCounters = true;
  for (const s of SPELL_CATALOG) if (s.counterList.length < 2) allHaveCounters = false;
  ok(allHaveCounters, 'all spells have >=2 counters');

  // Starter loadout: exactly 8 spells, curated, category coverage.
  const load = starterLoadout();
  eq(load.length, 8, 'starter loadout has 8 spells');
  eq(load.length, STARTER_SPELL_IDS.length, 'starter ids length matches');
  ok(load.every((s) => s.gestureKey), 'every starter spell has a gestureKey');
  const cats = new Set(load.map((s) => s.category));
  ok(cats.has('Offensive') && cats.has('Defensive') && cats.has('Control'),
    'starter spans Offensive/Defensive/Control');
  ok(loadoutPoints(load) <= 14, 'starter within 14-point budget');

  // rowsToSpells is stable/independent.
  const spells2 = rowsToSpells(parseCsv('id,name,secret\n1,Test,true\n'));
  eq(spells2[0].id, 1, 'rowsToSpells numeric id');
  eq(spells2[0].secret, true, 'rowsToSpells boolean');

  return report('spells');
}
