// smoke.mjs — headless browser smoke test using the locally installed Edge
// (via puppeteer-core, no Chromium download). Boots the client, starts a bot
// duel, drives a couple of real drawn glyphs through the pointer pipeline, and
// asserts the game reaches a running state with no uncaught errors.
//
// Not part of `npm test` (needs a browser + WebGL). Run with: npm run test:browser
// Auto-starts its own dev server unless one is already running.

import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = process.env.PORT || 8132;
const URL = `http://localhost:${PORT}/client/index.html`;

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  process.env.CHROME_PATH,
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) { console.error('No Edge/Chrome found; skipping browser smoke.'); process.exit(0); }

let server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1400));
process.on('exit', () => { if (server) try { server.kill(); } catch {} });
process.on('SIGINT', () => cleanup(1));

function cleanup(code) { if (server) try { server.kill(); } catch {} process.exit(code); }
function fail(msg) { console.error('SMOKE FAIL:', msg); cleanup(1); }

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=900,520'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 520, isMobile: true, hasTouch: true });
  const errors = [];
  const http404 = [];
  page.on('pageerror', (e) => { errors.push('PAGEERR ' + String(e)); console.error('PAGEERR', String(e)); });
  page.on('console', (m) => {
    // Ignore generic resource-load messages (favicon 404s etc.); real module
    // failures surface as pageerrors and as tracked HTTP 404s below.
    if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) {
      errors.push(m.text()); console.error('CONSOLE', m.text());
    }
  });
  page.on('requestfailed', (r) => console.error('REQFAIL', r.url(), r.failure()?.errorText));
  page.on('response', (r) => { if (r.status() === 404 && !/favicon/i.test(r.url())) http404.push(r.url()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const hasPanel = await page.$('#panel-main');
  if (!hasPanel) {
    const body = await page.evaluate(() => document.body ? document.body.innerHTML.slice(0, 300) : 'no body');
    fail('#panel-main missing. errors=' + JSON.stringify(errors.slice(0, 6)) + ' body=' + body);
  }

  // Online menu smoke: open it, create a private room end-to-end (real socket
  // to the authoritative server), confirm a share code appears, then cancel.
  await page.click('[data-action="online"]');
  await page.waitForSelector('#panel-online:not(.hidden)', { timeout: 5000 });
  await page.click('[data-action="online-create"]');
  await page.waitForSelector('#panel-online-wait:not(.hidden)', { timeout: 15000 });
  await page.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.querySelector('#wait-code-value')?.textContent || ''), { timeout: 15000 });
  const roomCode = await page.evaluate(() => document.querySelector('#wait-code-value')?.textContent);
  if (!/^[A-Z0-9]{5}$/.test(roomCode || '')) fail('online create did not yield a room code: ' + roomCode);
  await page.click('[data-action="online-cancel"]');
  await page.waitForSelector('#panel-online:not(.hidden)', { timeout: 5000 });
  await page.click('#panel-online [data-action="back"]');
  await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 5000 });

  // Tutorial smoke: open the hub, begin the Prologue, complete the first-run
  // interactive calibration by real drawing, then complete the first guided
  // objective through REAL pointer drawing. Assert calibration + solo progress
  // persist to local storage (aeg.solo.v1) and the guide fades.
  await page.click('[data-action="tutorial"]');
  await page.waitForSelector('#panel-tutorial:not(.hidden)', { timeout: 5000 });
  await page.click('[data-action="tut-continue"]');
  await page.waitForSelector('#panel-lesson-intro:not(.hidden)', { timeout: 5000 });
  await page.click('[data-action="tut-begin"]');

  // First-run calibration: draw the three requested shapes on the calib pad.
  await page.waitForSelector('#panel-calibrate:not(.hidden)', { timeout: 5000 });
  const cpad = await page.$('#calib-canvas');
  const cbox = await cpad.boundingBox();
  async function calibStroke() {
    const cy = cbox.y + cbox.height / 2;
    await page.mouse.move(cbox.x + cbox.width * 0.2, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(cbox.x + cbox.width * 0.2 + (cbox.width * 0.6) * (i / 8), cy);
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 180));
  }
  await calibStroke(); await calibStroke(); await calibStroke();

  await page.waitForSelector('#coach:not(.hidden)', { timeout: 5000 });
  const calibDone = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('aeg.solo.v1') || '{}').calibration; } catch { return null; }
  });
  if (!calibDone || calibDone.done !== true) fail('calibration was not captured/persisted (done flag): ' + JSON.stringify(calibDone));

  const guideBefore = await page.evaluate(() => document.querySelector('#coach-guide')?.textContent || '');
  const tpad = await page.$('#draw-canvas');
  const tbox = await tpad.boundingBox();
  const ty = tbox.y + tbox.height / 2;
  async function flick() {
    await page.mouse.move(tbox.x + tbox.width * 0.2, ty);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(tbox.x + tbox.width * 0.2 + (tbox.width * 0.6) * (i / 8), ty);
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 1300)); // let the bolt travel + land
  }
  await flick();
  await flick();
  const tut = await page.evaluate(() => ({
    obj1: document.querySelector('#coach-objectives .coach-obj')?.classList.contains('done'),
    guide: document.querySelector('#coach-guide')?.textContent || '',
    saved: localStorage.getItem('aeg.solo.v1'),
  }));
  if (!tut.obj1) fail('tutorial: first objective not completed by real drawing');
  if (!tut.guide || tut.guide === guideBefore) fail('tutorial: guide did not fade after an objective (' + guideBefore + ' -> ' + tut.guide + ')');
  if (!tut.saved || !/PROLOGUE|L01/.test(tut.saved)) fail('tutorial: solo progress not persisted to aeg.solo.v1');
  await page.click('#btn-menu');
  await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 5000 });

  // Final exam hub: locking/unlocking via seeded profile manipulation, then one
  // real no-guide Gesture Gauntlet draw. The solo profile is DOM-free and reloads
  // from localStorage on every hub render, so seeding + re-opening re-renders it.
  const seedCompleted = (completed) => page.evaluate((c) => {
    const k = 'aeg.solo.v1';
    let p = {};
    try { p = JSON.parse(localStorage.getItem(k) || '{}'); } catch {}
    p.completedLessons = c;                    // preserve calibration/practice
    localStorage.setItem(k, JSON.stringify(p));
  }, completed);
  const lockState = (ids) => page.evaluate((list) => {
    const out = {};
    for (const id of list) {
      const b = document.querySelector(`[data-lesson="${id}"]`);
      out[id] = b ? { locked: b.classList.contains('locked'), disabled: !!b.disabled } : null;
    }
    return out;
  }, ids);
  const reopenHub = async () => {
    await page.click('[data-action="tutorial"]');
    await page.waitForSelector('#panel-tutorial:not(.hidden)', { timeout: 5000 });
    await page.waitForSelector('[data-lesson="EXAM"]', { timeout: 5000 });
  };

  // Phase A: few gauntlet glyphs done -> scenarios/duel/grandmaster all LOCKED.
  await seedCompleted(['G03', 'G04']);
  await reopenHub();
  let lk = await lockState(['G01', 'S01', 'EXAM', 'EXAM_GM']);
  if (!lk.G01 || lk.G01.locked) fail('gauntlet stage G01 must be unlocked from the start: ' + JSON.stringify(lk.G01));
  if (!lk.S01 || !lk.S01.locked || !lk.S01.disabled) fail('tactical scenario S01 must be locked+disabled at 2/12 gauntlet: ' + JSON.stringify(lk.S01));
  if (!lk.EXAM || !lk.EXAM.locked || !lk.EXAM.disabled) fail('Final Duel must be locked+disabled: ' + JSON.stringify(lk.EXAM));
  if (!lk.EXAM_GM || !lk.EXAM_GM.locked) fail('Grandmaster must be locked: ' + JSON.stringify(lk.EXAM_GM));

  // A locked stage cannot be started: clicking it is a no-op and stays on the hub.
  await page.click('[data-lesson="S01"]').catch(() => {});
  if (!(await page.$('#panel-tutorial:not(.hidden)'))) fail('clicking a locked exam stage must not leave the hub');

  // Phase B: 10/12 gauntlet + 4/5 scenarios -> Final Duel UNLOCKS, Grandmaster stays locked.
  await page.click('#panel-tutorial [data-action="back"]');
  await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 5000 });
  await seedCompleted(['G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G10', 'G11', 'G12', 'S01', 'S02', 'S03', 'S04']);
  await reopenHub();
  lk = await lockState(['EXAM', 'EXAM_GM']);
  if (!lk.EXAM || lk.EXAM.locked || lk.EXAM.disabled) fail('Final Duel must unlock at 10/12 gauntlet + 4/5 scenarios: ' + JSON.stringify(lk.EXAM));
  if (!lk.EXAM_GM || !lk.EXAM_GM.locked) fail('Grandmaster must stay locked until the Final Duel is won: ' + JSON.stringify(lk.EXAM_GM));

  // Phase C: one real, no-guide Gesture Gauntlet draw (G01 is still incomplete).
  await page.click('[data-lesson="G01"]');
  await page.waitForSelector('#panel-lesson-intro:not(.hidden)', { timeout: 5000 });
  await page.click('[data-action="tut-begin"]');
  await page.waitForSelector('#coach:not(.hidden)', { timeout: 5000 });
  const gGuide = await page.evaluate(() => document.querySelector('#coach-guide')?.textContent || '');
  if (!/None/.test(gGuide)) fail('a gauntlet stage must show no guide (expected "Guide: None"): ' + gGuide);
  const gpad = await page.$('#draw-canvas');
  const gbox = await gpad.boundingBox();
  const gy = gbox.y + gbox.height / 2;
  async function gflick() {
    await page.mouse.move(gbox.x + gbox.width * 0.2, gy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(gbox.x + gbox.width * 0.2 + (gbox.width * 0.6) * (i / 8), gy);
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 500));
  }
  await gflick();
  await page.waitForSelector('#panel-result:not(.hidden)', { timeout: 6000 });
  const gDone = await page.evaluate(() => {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('aeg.solo.v1') || '{}'); } catch {}
    return (saved.completedLessons || []).includes('G01');
  });
  if (!gDone) fail('a real no-guide gauntlet draw did not complete gauntlet stage G01');
  await page.click('#panel-result [data-action="menu"]');
  await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 5000 });

  // Glyph Laboratory: no opponent (a recognizer/drill sandbox).
  await page.click('[data-action="lab"]');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('#spellbar .spell-btn', { timeout: 5000 });
  const labInfo = await page.evaluate(() => (window.__aegTest ? window.__aegTest.info() : null));
  if (!labInfo || labInfo.mode !== 'lab' || labInfo.botActive) fail('Glyph Laboratory should have no active opponent: ' + JSON.stringify(labInfo));
  await page.click('#btn-menu');
  await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 5000 });

  // Non-starter loadout path: open the builder, apply an archetype preset, save.
  await page.click('[data-action="loadout"]');
  await page.waitForSelector('#panel-loadout:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('.preset-btn', { timeout: 5000 });
  await page.click('.preset-btn'); // apply the first curated preset (Ember Rush)
  await page.waitForSelector('.ls-ok', { timeout: 5000 }); // legal loadout confirmed
  await page.click('[data-action="save-loadout"]');
  await page.waitForSelector('#panel-practice:not(.hidden)', { timeout: 5000 });

  // Practice vs AI: exactly Easy/Medium/Hard. Start a round on EACH difficulty,
  // confirm the AI opponent is active, force the round to end, and see coaching.
  const diffOptions = await page.evaluate(() => Array.from(document.querySelectorAll('#prac-diff option')).map((o) => o.value));
  if (diffOptions.join(',') !== 'easy,medium,hard') fail('Practice must offer exactly easy,medium,hard: ' + diffOptions.join(','));

  for (const diff of ['easy', 'medium', 'hard']) {
    await page.select('#prac-diff', diff);
    await page.click('[data-action="start-practice"]');
    await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
    await page.waitForSelector('#spellbar .spell-btn', { timeout: 5000 });
    const info = await page.evaluate(() => (window.__aegTest ? window.__aegTest.info() : null));
    if (!info || info.mode !== 'practice' || !info.botActive || !info.hasBot || info.difficulty !== diff) {
      fail(`Practice AI not active for ${diff}: ` + JSON.stringify(info));
    }
    // Draw a real glyph, then force the round to a finish and read the coaching.
    const pad = await page.$('#draw-canvas');
    const box = await pad.boundingBox();
    const py = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, py);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * 0.2 + (box.width * 0.6) * (i / 8), py);
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => window.__aegTest.forceEnd(0));
    await page.waitForSelector('#panel-result:not(.hidden)', { timeout: 5000 });
    await page.waitForSelector('#coach-report:not(.hidden)', { timeout: 5000 });
    const coachText = await page.evaluate(() => document.querySelector('#coach-report')?.textContent || '');
    if (!/Improve/.test(coachText) || !/Keep it up/.test(coachText)) fail(`coaching report missing for ${diff}: ` + coachText.slice(0, 120));
    await page.click('#panel-result [data-action="menu"]');
    await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 5000 });
    if (diff !== 'hard') {
      await page.click('[data-action="practice-ai"]');
      await page.waitForSelector('#panel-practice:not(.hidden)', { timeout: 5000 });
    }
  }

  const state = await page.evaluate(() => ({
    hudHidden: document.querySelector('#hud')?.classList.contains('hidden'),
    onMain: !document.querySelector('#panel-main')?.classList.contains('hidden'),
    spellButtons: document.querySelectorAll('#spellbar .spell-btn').length,
    practiceSaved: (() => { try { return JSON.parse(localStorage.getItem('aeg.solo.v1') || '{}').practice; } catch { return null; } })(),
  }));

  if (errors.length) fail('console/page errors: ' + errors.slice(0, 4).join(' | '));
  if (http404.length) fail('unexpected 404s: ' + http404.slice(0, 4).join(' | '));
  if (!state.onMain) fail('did not return to the main menu after practice');
  if (state.spellButtons !== 8) fail('cast bar should have 8 equipped spells, has ' + state.spellButtons);
  if (!state.practiceSaved || state.practiceSaved.difficulty !== 'hard') fail('practice settings not persisted to aeg.solo.v1: ' + JSON.stringify(state.practiceSaved));

  console.log('SMOKE PASS', JSON.stringify(state));
  await browser.close();
  cleanup(0);
} catch (err) {
  try { await browser.close(); } catch {}
  fail(err.message || String(err));
}
