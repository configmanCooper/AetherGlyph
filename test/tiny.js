// tiny.js — minimal dependency-free test harness (assert helpers + runner).

export function createHarness() {
  let pass = 0, fail = 0;
  const fails = [];
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; fails.push(msg); } };
  const eq = (a, b, msg) =>
    ok(Object.is(a, b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  const near = (a, b, eps, msg) =>
    ok(Math.abs(a - b) <= eps, `${msg} (got ${a}, want ~${b} ±${eps})`);
  const report = (label) => {
    const total = pass + fail;
    console.log(`  ${label}: ${pass}/${total} passed`);
    for (const f of fails) console.log(`    ✗ ${f}`);
    return { pass, fail };
  };
  return { ok, eq, near, report };
}
