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
import { GESTURE_TEMPLATES } from '../../shared/src/gesture/templates.js';
import { GESTURE_KEYS } from '../../shared/src/balance/loadouts.js';

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
async function activate(page, selector) {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.evaluate((s) => document.querySelector(s)?.click(), selector);
}

// Draw a horizontal Ember Bolt flick through the centre of the live draw pad.
// Lab layout keeps its control strip below the pad, so hit-testing reaches the
// canvas directly rather than relying on a test-only clear-band workaround.
async function drawEmberFlick(page) {
  const pad = await page.$('#draw-canvas');
  const box = await pad.boundingBox();
  const y = box.y + box.height * 0.45;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * 0.2 + (box.width * 0.6) * (i / 8), y);
  await page.mouse.up();
  return box;
}

async function drawCalibrationBaseline(page, span = 0.6) {
  const pad = await page.$('#calib-canvas');
  const box = await pad.boundingBox();
  for (let stroke = 0; stroke < 3; stroke++) {
    const cy = box.y + box.height / 2;
    const start = box.x + box.width * ((1 - span) / 2);
    await page.mouse.move(start, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(start + box.width * span * (i / 8), cy);
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 180));
  }
}

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
  await page.waitForFunction(() => !!window.__aegTest && !!window.__aegVfx, { timeout: 10000 });
  const titleState = await page.evaluate(() => ({
    titleClass: document.body.classList.contains('title-showcase'),
    version: document.querySelector('#menu-version')?.textContent || '',
    masterPlanLink: !!document.querySelector('#panel-main a[href*="MASTERPLAN"]'),
    duel: window.__aegTest.info(),
    showcase: window.__aegVfx.showcase(),
  }));
  if (!titleState.titleClass || !/Version 1\.7\.10/.test(titleState.version)
      || titleState.masterPlanLink || !titleState.duel.menuDuelActive
      || !titleState.showcase.playerVisible || !titleState.showcase.enemyVisible
      || !titleState.showcase.firstPersonHidden
      || titleState.showcase.platformScaleX < 1.95
      || titleState.showcase.cameraRadius < 18
      || !(titleState.showcase.enemyX < titleState.showcase.playerX)
      || !(titleState.showcase.enemyZ < titleState.showcase.playerZ)) {
    fail('title showcase is incomplete: ' + JSON.stringify(titleState));
  }
  const titlePanelBounds = await page.evaluate(() => {
    const rect = document.querySelector('#panel-main').getBoundingClientRect();
    const wordmark = document.querySelector('.title-wordmark').getBoundingClientRect();
    return {
      left: rect.left, right: rect.right,
      panelCenter: rect.left + rect.width / 2,
      wordmarkCenter: wordmark.left + wordmark.width / 2,
      miniGlyphs: document.querySelectorAll('.title-mini-glyph').length,
    };
  });
  if (Math.abs(titlePanelBounds.panelCenter - titlePanelBounds.wordmarkCenter) > 1
      || titlePanelBounds.miniGlyphs !== 0) {
    fail('title wordmark/glyph decoration is incomplete: ' + JSON.stringify(titlePanelBounds));
  }
  if (!(titleState.showcase.enemyScreenX < titlePanelBounds.left
      && titleState.showcase.playerScreenX > titlePanelBounds.right)) {
    fail('landscape title wizards are covered by the menu: ' + JSON.stringify({
      panel: titlePanelBounds, showcase: titleState.showcase,
    }));
  }

  // Public spell roster is an in-game reference, not a raw CSV. It contains all
  // 36 public spells with directional glyph diagrams and detailed usage fields.
  await activate(page, '[data-action="spell-roster"]');
  await page.waitForSelector('#panel-spell-roster:not(.hidden) .spell-ref-card', { timeout: 5000 });
  const spellReference = await page.evaluate(() => {
    const panel = document.querySelector('#panel-spell-roster');
    const text = panel?.textContent || '';
    const first = panel?.querySelector('.spell-ref-card');
    return {
      cards: panel?.querySelectorAll('.spell-ref-card').length || 0,
      glyphs: panel?.querySelectorAll('.spell-ref-glyph .spell-ref-line').length || 0,
      starts: panel?.querySelectorAll('.spell-ref-glyph .spell-ref-start').length || 0,
      hasSecrets: /Mirror Twin|Hourglass Field|Phoenix Covenant|Prismatic Beam/.test(text),
      firstText: first?.textContent || '',
      firstPoints: first?.querySelector('.spell-ref-line')?.getAttribute('points') || '',
      stoneShardCounters: panel?.querySelector('[data-spell-id="4"] [data-field="counters"]')?.textContent || '',
      stoneShardDetails: panel?.querySelector('[data-spell-id="4"] [data-field="what-it-does"]')?.textContent || '',
      hasteCounters: panel?.querySelector('[data-spell-id="16"] [data-field="counters"]')?.textContent || '',
      hasteDetails: panel?.querySelector('[data-spell-id="16"] [data-field="what-it-does"]')?.textContent || '',
      leechCounters: panel?.querySelector('[data-spell-id="24"] [data-field="counters"]')?.textContent || '',
      chainDetails: panel?.querySelector('[data-spell-id="7"] [data-field="what-it-does"]')?.textContent || '',
      thunderDetails: panel?.querySelector('[data-spell-id="30"] [data-field="what-it-does"]')?.textContent || '',
      rainDetails: panel?.querySelector('[data-spell-id="32"] [data-field="what-it-does"]')?.textContent || '',
      rainCounters: panel?.querySelector('[data-spell-id="32"] [data-field="counters"]')?.textContent || '',
      clippedGlyphs: Array.from(panel?.querySelectorAll('.spell-ref-glyph') || []).filter((svg) => {
        const box = svg.viewBox.baseVal;
        const raw = svg.querySelector('.spell-ref-line')?.getAttribute('points') || '';
        const points = raw.trim().split(/\s+/).filter(Boolean).map((pair) => pair.split(',').map(Number));
        return points.some(([x, y]) => x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height);
      }).length,
    };
  });
  if (spellReference.cards !== 36 || spellReference.glyphs !== 36 || spellReference.starts !== 36
      || spellReference.hasSecrets || !/Damage \/ protection:/.test(spellReference.firstText)
      || !/What it does:/.test(spellReference.firstText) || !/Best used for:/.test(spellReference.firstText)
      || !/Counters:/.test(spellReference.firstText) || !spellReference.firstPoints.includes(',')
      || /Stone Wall/.test(spellReference.stoneShardCounters) || /Dispel/.test(spellReference.hasteCounters)
      || /recovery speed/i.test(spellReference.hasteDetails)
      || /Ward/.test(spellReference.leechCounters) || !/Soaked/.test(spellReference.chainDetails)
      || !/protected wizard, not the cover/i.test(spellReference.stoneShardDetails)
      || !/Both duelists become Wet/i.test(spellReference.rainDetails)
      || !/globally enables weather reactions/i.test(spellReference.rainDetails)
      || /prevents lightning payoff/i.test(spellReference.rainCounters)
      || !/leaves Soaked active/i.test(spellReference.thunderDetails) || spellReference.clippedGlyphs !== 0) {
    fail('public spell roster is incomplete or reveals secrets: ' + JSON.stringify(spellReference));
  }
  await activate(page, '#panel-spell-roster [data-action="back"]');
  await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 5000 });

  // Online menu smoke: open it, create a private room end-to-end (real socket
  // to the authoritative server), confirm a share code appears, then cancel.
  await activate(page, '[data-action="online"]');
  await page.waitForSelector('#panel-online:not(.hidden)', { timeout: 5000 });
  await activate(page, '[data-action="online-create"]');
  await page.waitForSelector('#panel-online-wait:not(.hidden)', { timeout: 15000 });
  await page.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.querySelector('#wait-code-value')?.textContent || ''), { timeout: 15000 });
  const roomCode = await page.evaluate(() => document.querySelector('#wait-code-value')?.textContent);
  if (!/^[A-Z0-9]{5}$/.test(roomCode || '')) fail('online create did not yield a room code: ' + roomCode);
  await activate(page, '[data-action="online-cancel"]');
  await page.waitForSelector('#panel-online:not(.hidden)', { timeout: 5000 });
  const simulatedOnline = await page.evaluate(() => window.__aegTest?.simulateOnlineStart());
  if (!simulatedOnline) fail('could not exercise online match-start UI');
  await page.waitForSelector('#hud:not(.hidden) #spellbar .spell-btn[data-spell]', { timeout: 5000 });
  const onlineGuideCount = await page.evaluate(() => document.querySelectorAll('#spellbar .spell-btn[data-spell]').length);
  if (onlineGuideCount !== 8) fail('online duel did not show all eight guide shortcuts: ' + onlineGuideCount);
  await page.click('#spellbar .spell-btn[data-spell]');
  const onlineGuide = await page.evaluate(() => ({
    selected: document.querySelector('#spellbar .spell-btn.selected')?.dataset.spell,
    canvasGuide: document.querySelector('#draw-canvas')?.dataset.guideSpell,
  }));
  if (!onlineGuide.selected || onlineGuide.canvasGuide !== onlineGuide.selected) {
    fail('online guide button did not show its dotted template: ' + JSON.stringify(onlineGuide));
  }
  await page.click('#btn-menu');
  await page.waitForSelector('#panel-main:not(.hidden) #btn-resume-game:not(.hidden)', { timeout: 5000 });
  const pausedForeground = await page.evaluate(() => {
    window.__aegTest.backgroundChange(true);
    window.__aegTest.backgroundChange(false);
    return window.__aegTest.info();
  });
  if (!pausedForeground.gameMenuPaused || pausedForeground.running) {
    fail('foregrounding resumed the online game behind its pause menu: ' + JSON.stringify(pausedForeground));
  }
  await activate(page, '#btn-resume-game');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  const resumedOnlineGuide = await page.evaluate(() => ({
    selected: document.querySelector('#spellbar .spell-btn.selected')?.dataset.spell,
    canvasGuide: document.querySelector('#draw-canvas')?.dataset.guideSpell,
  }));
  if (resumedOnlineGuide.selected !== onlineGuide.selected || resumedOnlineGuide.canvasGuide !== onlineGuide.canvasGuide) {
    fail('Go back to current game did not preserve online guide state: ' + JSON.stringify(resumedOnlineGuide));
  }
  await page.evaluate(() => window.__aegTest.returnMenu());
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
  await drawCalibrationBaseline(page);

  await page.waitForSelector('#coach:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('#coach [data-action="tut-replay"]', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 500));
  const tutorialBeforeReplay = await page.evaluate(() => window.__aegTest.info());
  await page.click('#coach [data-action="tut-replay"]');
  await new Promise((r) => setTimeout(r, 120));
  const replayState = await page.evaluate(() => window.__aegTest.info());
  if (replayState.mode !== 'tutorial' || !replayState.running
      || replayState.tutorialTick == null || replayState.tutorialSeed === tutorialBeforeReplay.tutorialSeed
      || replayState.playerCastsResolved !== 0) {
    fail('Replay lesson did not restart the active tutorial: ' + JSON.stringify({
      before: tutorialBeforeReplay, after: replayState,
    }));
  }
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
  if (!/Dotted/.test(guideBefore) || !/Dotted/.test(tut.guide)) {
    fail('tutorial: instructional guide must remain dotted (' + guideBefore + ' -> ' + tut.guide + ')');
  }
  if (!tut.saved || !/PROLOGUE|L01/.test(tut.saved)) fail('tutorial: solo progress not persisted to aeg.solo.v1');
  await page.click('#btn-menu');
  await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 5000 });

  // Moving Line regression: Stone Shard must be visibly identified and drawn as
  // a dotted template in the pad when the lesson starts.
  await page.click('[data-action="tutorial"]');
  await page.waitForSelector('#panel-tutorial:not(.hidden)', { timeout: 5000 });
  await page.click('[data-lesson="L02"]');
  await page.waitForSelector('#panel-lesson-intro:not(.hidden)', { timeout: 5000 });
  await page.click('[data-action="tut-begin"]');
  await page.waitForSelector('#coach:not(.hidden)', { timeout: 5000 });
  const stoneGuide = await page.evaluate(() => {
    const canvas = document.querySelector('#draw-canvas');
    const ctx = canvas?.getContext('2d');
    let painted = 0;
    if (canvas && ctx) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    }
    return {
      spell: canvas?.dataset.guideSpell,
      stage: canvas?.dataset.guideStage,
      coach: document.querySelector('#coach-guide')?.textContent || '',
      hint: document.querySelector('#draw-pad .pad-hint')?.textContent || '',
      painted,
    };
  });
  if (stoneGuide.spell !== '4' || stoneGuide.stage !== 'dotted' || !/Dotted/.test(stoneGuide.coach)
      || !/Stone Shard/i.test(stoneGuide.hint) || stoneGuide.painted < 20) {
    fail('Moving Line did not show the Stone Shard dotted guide: ' + JSON.stringify(stoneGuide));
  }
  await page.click('#btn-menu');
  await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 5000 });

  // Secret hints stay behind a single hub button. Once a clue is earned, its
  // trial reveals only the starting point and first quarter of the glyph.
  await page.evaluate(() => {
    const key = 'aeg.solo.v1';
    let profile = {};
    try { profile = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
    profile.clues = {
      ...(profile.clues || {}),
      mirrorEight: true,
      hourglassMovement: true,
      phoenixOil: true,
      prismaticReactions: true,
    };
    localStorage.setItem(key, JSON.stringify(profile));
  });
  await page.click('[data-action="tutorial"]');
  await page.waitForSelector('#panel-tutorial:not(.hidden)', { timeout: 5000 });
  const hintHub = await page.evaluate(() => ({
    button: document.querySelector('#btn-secret-hints')?.textContent || '',
    hidden: document.querySelector('#btn-secret-hints')?.classList.contains('hidden'),
    inlineCards: document.querySelectorAll('#panel-tutorial .secret-hint-card').length,
  }));
  if (hintHub.button !== 'Hints (4)' || hintHub.hidden || hintHub.inlineCards !== 0) {
    fail('secret hints should be collapsed behind the Hints button: ' + JSON.stringify(hintHub));
  }
  await page.click('#btn-secret-hints');
  await page.waitForSelector('#panel-secret-hints:not(.hidden)', { timeout: 5000 });
  const hintPanel = await page.evaluate(() => ({
    names: Array.from(document.querySelectorAll('#secret-hints-list h3')).map((el) => el.textContent),
    notes: Array.from(document.querySelectorAll('.secret-hint-guide-note')).map((el) => el.textContent),
  }));
  if (hintPanel.names.join(',') !== 'Mirror Twin,Hourglass Field,Phoenix Covenant,Prismatic Beam'
      || hintPanel.notes.length !== 4
      || hintPanel.notes.some((note) => !/first quarter/i.test(note))) {
    fail('secret hints panel did not list all earned hints: ' + JSON.stringify(hintPanel));
  }
  await page.click('#panel-secret-hints [data-action="tutorial"]');
  await page.waitForSelector('#panel-tutorial:not(.hidden)', { timeout: 5000 });
  await page.click('[data-lesson="T37"]');
  await page.waitForSelector('#panel-lesson-intro:not(.hidden)', { timeout: 5000 });
  await page.click('[data-action="tut-begin"]');
  await page.waitForSelector('#coach:not(.hidden)', { timeout: 5000 });
  const secretGuide = await page.evaluate(() => {
    const canvas = document.querySelector('#draw-canvas');
    return {
      spell: canvas?.dataset.guideSpell,
      stage: canvas?.dataset.guideStage,
      fraction: Number(canvas?.dataset.guideFraction || 0),
      hint: document.querySelector('#draw-pad .pad-hint')?.textContent || '',
    };
  });
  if (secretGuide.spell !== '37' || secretGuide.stage !== 'dotted'
      || secretGuide.fraction !== 0.25 || !/dotted first quarter/i.test(secretGuide.hint)) {
    fail('secret trial did not show its quarter-glyph starting guide: ' + JSON.stringify(secretGuide));
  }
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
  const labLayout = await page.evaluate(() => {
    const pad = document.querySelector('#draw-pad')?.getBoundingClientRect();
    const bar = document.querySelector('#spellbar')?.getBoundingClientRect();
    return pad && bar ? { padBottom: pad.bottom, barTop: bar.top } : null;
  });
  if (!labLayout || labLayout.padBottom > labLayout.barTop) {
    fail('Glyph Laboratory spellbar overlaps the draw pad: ' + JSON.stringify(labLayout));
  }
  const labFirst = await page.evaluate(() => ({
    spells: Array.from(document.querySelectorAll('#spellbar .spell-btn[data-spell]')).map((b) => Number(b.dataset.spell)),
    lastName: document.querySelector('#spellbar .spell-btn[data-spell]:last-of-type .sb-name')?.textContent,
    hasNext: !!document.querySelector('#spellbar .spell-next'),
  }));
  if (labFirst.spells.join(',') !== '1,2,4,3,28,10,11,12' || !labFirst.hasNext) {
    fail('Glyph Laboratory first page must end with Reflect and a Next button: ' + JSON.stringify(labFirst));
  }

  // Selecting a spell updates the active dotted drawing template.
  await page.click('#spellbar .spell-btn[data-spell="4"]');
  const labStone = await page.evaluate(() => ({
    hint: document.querySelector('#draw-pad .pad-hint')?.textContent || '',
    guide: document.querySelector('#draw-canvas')?.dataset.guideSpell,
    selected: document.querySelector('#spellbar .spell-btn.selected')?.dataset.spell,
    painted: (() => {
      const canvas = document.querySelector('#draw-canvas');
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return 0;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
      return count;
    })(),
    hit: (() => {
      const b = document.querySelector('#spellbar .spell-btn[data-spell="4"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { box: [r.x, r.y, r.width, r.height], hit: hit?.id || hit?.className || hit?.tagName };
    })(),
  }));
  if (!/Stone Shard/i.test(labStone.hint) || labStone.guide !== '4'
      || labStone.selected !== '4' || labStone.painted < 20) {
    fail('Glyph Laboratory selection did not update the Stone Shard guide: ' + JSON.stringify(labStone));
  }
  // The Stone Shard guide must not bias/restrict recognition: drawing an Ember
  // flick still resolves as Ember Bolt against the full 36-spell catalog.
  const beforeUnbiased = await page.evaluate(() => window.__aegTest.info().playerCastsResolved);
  await drawEmberFlick(page);
  await page.waitForFunction((n) => window.__aegTest.info().playerCastsResolved > n, { timeout: 5000 }, beforeUnbiased);
  const unbiasedCast = await page.evaluate(() => document.querySelector('#last-cast')?.textContent || '');
  if (!/Last cast: Ember Bolt/.test(unbiasedCast)) {
    fail('selected Stone Shard guide biased recognition instead of accepting Ember Bolt: ' + unbiasedCast);
  }

  // Page through the full public catalog. Weather/environment spells must appear;
  // secret spells 37-40 must never appear.
  const labSeen = new Set(labFirst.spells);
  const labPages = [labFirst.spells];
  for (let i = 0; i < 4; i++) {
    await page.click('#spellbar .spell-next');
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#spellbar .spell-btn[data-spell]')).map((b) => Number(b.dataset.spell)));
    labPages.push(ids);
    ids.forEach((id) => labSeen.add(id));
    if (ids.includes(27)) {
      await page.click('#spellbar .spell-btn[data-spell="27"]');
      const frostCues = await page.evaluate(() => ({
        arrows: Number(document.querySelector('#draw-canvas')?.dataset.guideArrows || 0),
        labels: document.querySelector('#draw-canvas')?.dataset.guideCueLabels || '',
      }));
      if (frostCues.arrows !== 4 || frostCues.labels !== '') {
        fail('Frost Bind should show a leftward start cue plus three path arrows: ' + JSON.stringify(frostCues));
      }
    }
    if (ids.includes(33)) {
      await page.click('#spellbar .spell-btn[data-spell="33"]');
      const gustCues = await page.evaluate(() => ({
        arrows: Number(document.querySelector('#draw-canvas')?.dataset.guideArrows || 0),
        labels: document.querySelector('#draw-canvas')?.dataset.guideCueLabels || '',
      }));
      if (gustCues.arrows !== 5 || gustCues.labels !== '1,2,3') {
        fail('Gust Wall should omit the downward arrow on blade 3: ' + JSON.stringify(gustCues));
      }
    }
    if (i === 1) {
      const surge = await page.$('#spellbar .spell-btn[data-spell="17"]');
      if (!surge) fail('Aether Surge missing from expected lab page: ' + JSON.stringify(labPages));
      await surge.click();
      const surgeGuide = await page.evaluate(() => ({
        hint: document.querySelector('#draw-pad .pad-hint')?.textContent || '',
        arrows: Number(document.querySelector('#draw-canvas')?.dataset.guideArrows || 0),
        painted: (() => {
          const canvas = document.querySelector('#draw-canvas');
          const ctx = canvas?.getContext('2d');
          if (!canvas || !ctx) return 0;
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let count = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
          return count;
        })(),
      }));
      if (!/Aether Surge/i.test(surgeGuide.hint) || surgeGuide.arrows < 2 || surgeGuide.painted < 20) {
        fail('Aether Surge dotted guide must include directional arrows: ' + JSON.stringify(surgeGuide));
      }
    }
    if (i === 2) {
      const rain = await page.$('#spellbar .spell-btn[data-spell="32"]');
      if (!rain) fail('Rain Glyph missing from weather lab page: ' + JSON.stringify(labPages));
      await rain.click();
      const labRain = await page.evaluate(() => ({
        hint: document.querySelector('#draw-pad .pad-hint')?.textContent || '',
        guide: document.querySelector('#draw-canvas')?.dataset.guideSpell,
        painted: (() => {
          const canvas = document.querySelector('#draw-canvas');
          const ctx = canvas?.getContext('2d');
          if (!canvas || !ctx) return 0;
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let count = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
          return count;
        })(),
      }));
      if (!/Rain Glyph/i.test(labRain.hint) || labRain.guide !== '32' || labRain.painted < 20) {
        fail('Glyph Laboratory weather selection did not update the Rain Glyph guide: ' + JSON.stringify(labRain));
      }
    }
  }
  const labCatalog = [...labSeen].sort((a, b) => a - b);
  if (labCatalog.length !== 36 || ![31, 32, 33, 34, 35, 36].every((id) => labSeen.has(id))
      || [37, 38, 39, 40].some((id) => labSeen.has(id))) {
    fail('Glyph Laboratory catalog must contain all 36 public spells including weather, excluding secrets: ' + labCatalog.join(','));
  }

  // Blank guide mode clears the template but keeps all public spells recognizable.
  await page.evaluate(() => { const bar = document.querySelector('#spellbar'); bar.scrollLeft = bar.scrollWidth; });
  await page.click('#spellbar .spell-blank');
  await new Promise((r) => setTimeout(r, 120));
  const blankLab = await page.evaluate(() => {
    const canvas = document.querySelector('#draw-canvas');
    const ctx = canvas?.getContext('2d');
    let painted = 0;
    if (canvas && ctx) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    }
    return {
      hint: document.querySelector('#draw-pad .pad-hint')?.textContent || '',
      stage: canvas?.dataset.guideStage,
      guide: canvas?.dataset.guideSpell,
      selected: document.querySelector('#spellbar .spell-blank')?.classList.contains('selected'),
      scrollLeft: document.querySelector('#spellbar')?.scrollLeft,
      painted,
    };
  });
  if (!/any public spell/i.test(blankLab.hint) || blankLab.stage !== 'blank'
      || blankLab.guide != null || !blankLab.selected || blankLab.painted !== 0 || blankLab.scrollLeft !== 0) {
    fail('Glyph Laboratory Blank mode did not clear the guide: ' + JSON.stringify(blankLab));
  }
  const cooldownToggle = await page.$('#spellbar .spell-cooldown-toggle');
  if (!cooldownToggle) fail('Glyph Laboratory is missing the Cooldowns toggle');
  const cooldownOff = await page.evaluate(() => ({
    text: document.querySelector('#spellbar .spell-cooldown-toggle .sb-cost')?.textContent,
    state: window.__aegTest.info().labCooldowns,
  }));
  if (cooldownOff.text !== 'Off' || cooldownOff.state !== false) {
    fail('Glyph Laboratory cooldown toggle should default Off: ' + JSON.stringify(cooldownOff));
  }
  await page.evaluate(() => {
    const original = document.querySelector('#spellbar .spell-cooldown-toggle');
    original.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch',
    }));
    original.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch',
    }));
    document.querySelector('#spellbar .spell-cooldown-toggle')?.click();
  });
  const cooldownOn = await page.evaluate(() => ({
    text: document.querySelector('#spellbar .spell-cooldown-toggle .sb-cost')?.textContent,
    state: window.__aegTest.info().labCooldowns,
  }));
  if (cooldownOn.text !== 'On' || cooldownOn.state !== true) {
    fail('Glyph Laboratory cooldown toggle did not turn On: ' + JSON.stringify(cooldownOn));
  }
  const enemyControl = await page.$('#spellbar .spell-enemy-toggle');
  if (!enemyControl) fail('Glyph Laboratory is missing the Enemy control');
  await activate(page, '#spellbar .spell-enemy-toggle');
  await page.waitForSelector('#panel-lab-enemy:not(.hidden)', { timeout: 5000 });
  const enemyOptions = await page.evaluate(() => ({
    spells: document.querySelectorAll('#lab-enemy-spell option').length,
    cadences: Array.from(document.querySelectorAll('#lab-enemy-cadence option')).map((option) => option.value),
  }));
  if (enemyOptions.spells < 20 || enemyOptions.cadences.join(',') !== 'once,5,15,30') {
    fail('Glyph Lab enemy controls are incomplete: ' + JSON.stringify(enemyOptions));
  }
  await page.select('#lab-enemy-spell', '1');
  await page.select('#lab-enemy-cadence', 'once');
  await page.click('[data-action="lab-enemy-apply"]');
  await page.waitForFunction(() => window.__aegTest.info().enemyCastsResolved > 0, { timeout: 5000 });
  await activate(page, '#spellbar .spell-enemy-toggle');
  await page.waitForSelector('#panel-lab-enemy:not(.hidden)', { timeout: 5000 });
  await page.select('#lab-enemy-spell', '3');
  await page.select('#lab-enemy-cadence', '5');
  await page.click('#lab-enemy-move');
  await page.click('[data-action="lab-enemy-apply"]');
  const repeatingEnemy = await page.evaluate(() => ({ config: window.__aegTest.info().labEnemy }));
  const enemyStartPos = await page.evaluate(() => window.__aegTest.info().enemyArcPos);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const enemyMovedPos = await page.evaluate(() => window.__aegTest.info().enemyArcPos);
  if (!repeatingEnemy.config.enabled || repeatingEnemy.config.spellId !== 3
      || repeatingEnemy.config.cadence !== '5' || !repeatingEnemy.config.movement
      || Math.abs(enemyMovedPos - enemyStartPos) < 0.05) {
    fail('Glyph Lab enemy repeating schedule was not applied: ' + JSON.stringify(repeatingEnemy));
  }
  await activate(page, '#spellbar .spell-enemy-toggle');
  await page.waitForSelector('#panel-lab-enemy:not(.hidden)', { timeout: 5000 });
  await page.click('[data-action="lab-enemy-disable"]');
  const disabledEnemy = await page.evaluate(() => window.__aegTest.info().labEnemy);
  if (disabledEnemy.enabled) fail('Glyph Lab enemy schedule did not disable');
  const blankBefore = await page.evaluate(() => window.__aegTest.info().playerCastsResolved);
  await gflick();
  await new Promise((r) => setTimeout(r, 800));
  const blankAfter = await page.evaluate(() => {
    const info = window.__aegTest.info();
    const label = document.querySelector('#last-cast');
    const draw = document.querySelector('#draw-pad');
    const lr = label?.getBoundingClientRect();
    const dr = draw?.getBoundingClientRect();
    return {
      casts: info.playerCastsResolved,
      text: label?.textContent || '',
      hidden: label?.classList.contains('hidden'),
      labelBottom: lr?.bottom,
      drawTop: dr?.top,
    };
  });
  if (blankAfter.casts <= blankBefore) fail('Blank guide mode did not recognize and cast a public spell drawn from memory');
  if (blankAfter.hidden || !/Last cast: Ember Bolt/.test(blankAfter.text)
      || blankAfter.labelBottom > blankAfter.drawTop + 1) {
    fail('Last-cast label is missing or not directly above the draw area: ' + JSON.stringify(blankAfter));
  }

  const actionLayout = await page.evaluate(() => {
    const ids = ['btn-focus', 'btn-brace', 'btn-sidestep'];
    return ids.map((id) => {
      const el = document.getElementById(id); const r = el.getBoundingClientRect();
      return { id, text: el.textContent, x: r.x, y: r.y };
    });
  });
  if (!(actionLayout[0].x < actionLayout[1].x && actionLayout[1].x < actionLayout[2].x)
      || Math.max(...actionLayout.map((x) => x.y)) - Math.min(...actionLayout.map((x) => x.y)) > 3
      || !/\(F\)/.test(actionLayout[0].text) || !/\(B\)/.test(actionLayout[1].text)
      || !/\(Space\)/.test(actionLayout[2].text)) {
    fail('Focus/Brace/Dodge controls are not horizontal with keyboard labels: ' + JSON.stringify(actionLayout));
  }
  await page.keyboard.down('b');
  await new Promise((r) => setTimeout(r, 120));
  const labBraceInfo = await page.evaluate(() => window.__aegTest.info());
  await page.keyboard.up('b');
  if (labBraceInfo.playerBraceTicks <= 0) fail('Brace (B) keyboard binding did not activate in Glyph Laboratory');
  await activate(page, '#btn-menu');
  await page.waitForSelector('#panel-main:not(.hidden) #btn-resume-game:not(.hidden)', { timeout: 5000 });
  await activate(page, '#btn-resume-game');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => window.__aegTest.nativeBack());
  await page.waitForSelector('#panel-main:not(.hidden) #btn-resume-game:not(.hidden)', { timeout: 5000 });
  await activate(page, '#panel-main [data-action="spell-roster"]');
  await page.waitForSelector('#panel-spell-roster:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => window.__aegTest.nativeBack());
  await page.waitForSelector('#panel-main:not(.hidden) #btn-resume-game:not(.hidden)', { timeout: 5000 });

  // Non-starter loadout path: open the builder, apply an archetype preset, save.
  await activate(page, '#panel-main [data-action="loadout"]');
  await page.waitForSelector('#panel-loadout:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('.preset-btn', { timeout: 5000 });
  await page.click('.preset-btn'); // apply the first curated preset (Ember Rush)
  await page.waitForSelector('.ls-ok', { timeout: 5000 }); // legal loadout confirmed
  await page.click('[data-action="save-loadout"]');
  await page.waitForSelector('#panel-practice:not(.hidden)', { timeout: 5000 });

  // Practice vs AI: exactly Very Easy/Easy/Medium/Hard. Start a round on EACH difficulty,
  // confirm the AI opponent is active, force the round to end, and see coaching.
  const diffOptions = await page.evaluate(() => Array.from(document.querySelectorAll('#prac-diff option')).map((o) => o.value));
  if (diffOptions.join(',') !== 'very-easy,easy,medium,hard') {
    fail('Practice must offer exactly very-easy,easy,medium,hard: ' + diffOptions.join(','));
  }

  for (const diff of ['very-easy', 'easy', 'medium', 'hard']) {
    await page.select('#prac-diff', diff);
    await page.click('[data-action="start-practice"]');
    await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
    await page.waitForSelector('#spellbar .spell-btn', { timeout: 5000 });
    const info = await page.evaluate(() => (window.__aegTest ? window.__aegTest.info() : null));
    if (!info || info.mode !== 'practice' || !info.botActive || !info.hasBot
        || info.difficulty !== diff || info.music?.scene !== 'duel') {
      fail(`Practice AI not active for ${diff}: ` + JSON.stringify(info));
    }
    const liveView = await page.evaluate(() => window.__aegVfx.view());
    if (liveView.showcaseMode || Math.abs(liveView.cameraZ - 5.5) > 1e-6
        || Math.abs(liveView.enemyZ + 5.5) > 1e-6) {
      fail('title staging leaked into live gameplay: ' + JSON.stringify(liveView));
    }
    if (diff === 'easy') {
      const replacementLifecycle = await page.evaluate(() => {
        window.__aegTest.backgroundChange(true);
        window.__aegTest.backgroundChange(false);
        return window.__aegTest.info();
      });
      if (replacementLifecycle.gameMenuPaused || !replacementLifecycle.running) {
        fail('new Practice game inherited stale paused state: ' + JSON.stringify(replacementLifecycle));
      }
      const landscapeControls = await page.evaluate(() => {
        const rect = (sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null;
        };
        const touch = document.querySelector('#btn-focus .touch-label');
        const desktop = document.querySelector('#btn-focus .desktop-label');
        const staminaFills = Array.from(document.querySelectorAll('.bar.stamina .fill'));
        return {
          move: rect('#move-pad'), actions: rect('.action-buttons'),
          draw: rect('#draw-pad'), spellbar: rect('#spellbar'),
          staminaBars: staminaFills.length,
          staminaColor: getComputedStyle(staminaFills[0]).backgroundImage,
          staminaRatios: staminaFills.map((fill) => {
            const parentWidth = fill.parentElement.getBoundingClientRect().width;
            return parentWidth > 0 ? fill.getBoundingClientRect().width / parentWidth : 0;
          }),
          healthRatios: ['#player-health', '#enemy-health'].map((selector) => {
            const fill = document.querySelector(selector);
            const parentWidth = fill.parentElement.getBoundingClientRect().width;
            return parentWidth > 0 ? fill.getBoundingClientRect().width / parentWidth : 0;
          }),
          touchVisible: getComputedStyle(touch).display !== 'none',
          desktopHidden: getComputedStyle(desktop).display === 'none',
        };
      });
      const landscapeOverlap = (a, b) => a && b
        && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      if (!(landscapeControls.move?.width <= 125)
          || !(landscapeControls.actions?.bottom < landscapeControls.move?.top)
          || landscapeOverlap(landscapeControls.spellbar, landscapeControls.move)
          || landscapeOverlap(landscapeControls.spellbar, landscapeControls.actions)
          || landscapeOverlap(landscapeControls.spellbar, landscapeControls.draw)
          || landscapeControls.staminaBars !== 2 || !/rgb\(66, 184, 90\)/.test(landscapeControls.staminaColor)
          || !landscapeControls.touchVisible || !landscapeControls.desktopHidden) {
        fail('landscape mobile controls are not compact/above joystick: ' + JSON.stringify(landscapeControls));
      }
      const failureMessages = await page.evaluate(() => [
        window.__aegTest.dispatchEvents([{
          type: 'castRejected', caster: 0, spellId: 4, reason: 'aether', required: 18, available: 5,
        }]),
        window.__aegTest.dispatchEvents([{
          type: 'castRejected', caster: 0, spellId: 7, reason: 'charges', required: 1, available: 0,
        }]),
        window.__aegTest.dispatchEvents([{
          type: 'castRejected', caster: 0, spellId: 1, reason: 'barrier',
        }]),
        window.__aegTest.dispatchEvents([{
          type: 'actionRejected', caster: 0, action: 'move', reason: 'stamina',
        }]),
      ]);
      if (!/needs 18 Aether; you have 5/.test(failureMessages[0])
          || !/needs 1 Sigil Charge; you have 0/.test(failureMessages[1])
          || !/Barrier Dome/.test(failureMessages[2])
          || !/Not enough Stamina to move/.test(failureMessages[3])) {
        fail('failure reasons are not shown to the player: ' + JSON.stringify(failureMessages));
      }
      const visibleGuideIds = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#spellbar .spell-btn[data-spell]')).map((b) => Number(b.dataset.spell)));
      const outsideId = Number(Object.keys(GESTURE_KEYS).find((id) => !visibleGuideIds.includes(Number(id))));
      const outsidePoints = GESTURE_TEMPLATES[GESTURE_KEYS[outsideId]][0];
      const outsideDiag = await page.evaluate((points) => window.__aegTest.recognize(points), outsidePoints);
      if (!outsideDiag.accepted || outsideDiag.spellId !== outsideId) {
        fail('practice recognizer cannot cast outside selected guides: ' + JSON.stringify({ visibleGuideIds, outsideId, outsideDiag }));
      }
    }
    const guideButton = await page.$('#spellbar .spell-btn[data-spell]');
    const guideSpell = await page.evaluate((b) => Number(b.dataset.spell), guideButton);
    const beforeGuide = await page.evaluate(() => window.__aegTest.info());
    await guideButton.click();
    await new Promise((r) => setTimeout(r, 120));
    const afterGuide = await page.evaluate(() => window.__aegTest.info());
    if (afterGuide.selectedGuideId !== guideSpell || afterGuide.playerCasting !== null
        || afterGuide.playerCastsResolved !== beforeGuide.playerCastsResolved || !afterGuide.assisted) {
      fail(`spellbar button must select a guide without casting (${diff}): ` + JSON.stringify({ beforeGuide, afterGuide, guideSpell }));
    }
    if (diff === 'easy') {
      const multitouchGuide = await page.evaluate(() => {
        const pad = document.querySelector('#move-pad');
        const r = pad.getBoundingClientRect();
        pad.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 101, pointerType: 'touch',
          clientX: r.right - 8, clientY: r.top + r.height / 2,
        }));
        const buttons = Array.from(document.querySelectorAll('#spellbar .spell-btn[data-spell]'));
        const target = buttons.find((button) => !button.classList.contains('selected'));
        const targetId = target?.dataset.spell;
        target?.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 102, pointerType: 'touch',
        }));
        target?.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, pointerId: 102, pointerType: 'touch',
        }));
        const info = window.__aegTest.info();
        const selected = document.querySelector('#spellbar .spell-btn.selected')?.dataset.spell;
        const scrollTarget = Array.from(document.querySelectorAll('#spellbar .spell-btn[data-spell]'))
          .find((button) => button.dataset.spell !== selected);
        scrollTarget?.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 103, pointerType: 'touch', clientX: 20, clientY: 20,
        }));
        scrollTarget?.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, cancelable: true, pointerId: 103, pointerType: 'touch', clientX: 55, clientY: 20,
        }));
        scrollTarget?.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, pointerId: 103, pointerType: 'touch', clientX: 55, clientY: 20,
        }));
        const afterScroll = document.querySelector('#spellbar .spell-btn.selected')?.dataset.spell;
        pad.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, pointerId: 101, pointerType: 'touch',
          clientX: r.right - 8, clientY: r.top + r.height / 2,
        }));
        return { targetId, selected, afterScroll, movementActive: info.movementActive, moveInput: info.moveInput };
      });
      if (!multitouchGuide.targetId || multitouchGuide.selected !== multitouchGuide.targetId
          || multitouchGuide.afterScroll !== multitouchGuide.selected
          || !multitouchGuide.movementActive || multitouchGuide.moveInput === 0) {
        fail('guide selection failed while the movement pointer was held: ' + JSON.stringify(multitouchGuide));
      }
    }
    // Draw a real glyph, then force the round to a finish and read the coaching.
    await drawEmberFlick(page);
    await new Promise((r) => setTimeout(r, 300));
    if (diff === 'easy') {
      const diagPosition = await page.evaluate(() => {
        const el = document.querySelector('#diag');
        const r = el?.getBoundingClientRect();
        return r ? { left: r.left, right: r.right, width: innerWidth, hidden: el.classList.contains('hidden') } : null;
      });
      if (!diagPosition || diagPosition.hidden || diagPosition.left < diagPosition.width / 2) {
        fail('landscape draw diagnostics are not in the upper-right: ' + JSON.stringify(diagPosition));
      }
      await page.waitForFunction(() => window.__aegTest.info().playerCastsResolved > 0, { timeout: 5000 });
      const guideCooldown = await page.evaluate((id) => {
        const b = document.querySelector(`#spellbar .spell-btn[data-spell="${id}"]`);
        return {
          disabled: b?.classList.contains('disabled'),
          cooldown: b?.classList.contains('cooldown'),
          remaining: b?.querySelector('.sb-cost')?.textContent || '',
        };
      }, guideSpell);
      if (!guideCooldown.disabled || !guideCooldown.cooldown || !/^\d+(?:\.\d)?s$/.test(guideCooldown.remaining)) {
        fail('guide button did not show a grayed cooldown countdown: ' + JSON.stringify(guideCooldown));
      }
      // Draw the same valid glyph again while its live cooldown is active.
      await drawEmberFlick(page);
      await page.waitForFunction(() => /cooldown/i.test(document.querySelector('#toast')?.textContent || ''), { timeout: 5000 });
      const cooldownToast = await page.evaluate(() => document.querySelector('#toast')?.textContent || '');
      if (!/Ember Bolt is on cooldown/i.test(cooldownToast) || !/seconds remaining/i.test(cooldownToast)) {
        fail('cooldown attempt did not explain the remaining time: ' + cooldownToast);
      }
      await page.setViewport({ width: 520, height: 900, isMobile: true, hasTouch: true });
      await new Promise((r) => setTimeout(r, 180));
      const portraitControls = await page.evaluate(() => {
        const rect = (sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width } : null;
        };
        return {
          move: rect('#move-pad'), actions: rect('.action-buttons'),
          draw: rect('#draw-pad'), spellbar: rect('#spellbar'),
        };
      });
      const overlaps = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      if (!(portraitControls.move?.width <= 215)
          || !(portraitControls.actions?.bottom < portraitControls.move?.top)
          || overlaps(portraitControls.spellbar, portraitControls.move)
          || overlaps(portraitControls.spellbar, portraitControls.actions)
          || overlaps(portraitControls.spellbar, portraitControls.draw)) {
        fail('portrait controls/spellbar overlap or are misplaced: ' + JSON.stringify(portraitControls));
      }
      await page.setViewport({ width: 900, height: 520, isMobile: true, hasTouch: true });
      await new Promise((r) => setTimeout(r, 180));
    }
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

  // Settings can rerun the same baseline and persist replacement comfort values.
  await page.click('[data-action="settings"]');
  await page.waitForSelector('#panel-settings:not(.hidden)', { timeout: 5000 });
  const localInstallHidden = await page.evaluate(() => document.querySelector('#install-app-section')?.classList.contains('hidden'));
  if (!localInstallHidden) fail('Android Render install action should stay hidden on localhost');
  await page.select('#set-orientation', 'portrait');
  await new Promise((r) => setTimeout(r, 100));
  const orientationSaved = await page.evaluate(() => ({
    value: localStorage.getItem('aeth-orientation'),
    status: document.querySelector('#set-orientation-status')?.textContent || '',
  }));
  if (orientationSaved.value !== 'portrait' || !orientationSaved.status) {
    fail('orientation preference was not saved from Settings: ' + JSON.stringify(orientationSaved));
  }
  await page.select('#set-orientation', 'auto');
  const baselineStatus = await page.evaluate(() => document.querySelector('#set-calibration-status')?.textContent || '');
  if (!/Baseline: guide size/i.test(baselineStatus)) fail('settings does not report saved calibration: ' + baselineStatus);
  await page.click('[data-action="recalibrate"]');
  await page.waitForSelector('#panel-calibrate:not(.hidden)', { timeout: 5000 });
  const recalTitle = await page.evaluate(() => document.querySelector('#calib-title')?.textContent || '');
  if (!/Redo baseline/i.test(recalTitle)) fail('settings calibration did not reuse the baseline flow: ' + recalTitle);
  await drawCalibrationBaseline(page, 0.3);
  await page.waitForSelector('#panel-settings:not(.hidden)', { timeout: 5000 });
  const recalibrated = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('aeg.solo.v1') || '{}').calibration; } catch { return null; }
  });
  if (!recalibrated?.done || !(recalibrated.guideScale < calibDone.guideScale - 0.1)) {
    fail('settings calibration did not replace persisted baseline values: ' + JSON.stringify(recalibrated));
  }
  await page.click('#panel-settings [data-action="back"]');
  await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 5000 });

  const state = await page.evaluate(() => ({
    hudHidden: document.querySelector('#hud')?.classList.contains('hidden'),
    onMain: !document.querySelector('#panel-main')?.classList.contains('hidden'),
    spellButtons: document.querySelectorAll('#spellbar .spell-btn').length,
    practiceSaved: (() => { try { return JSON.parse(localStorage.getItem('aeg.solo.v1') || '{}').practice; } catch { return null; } })(),
  }));

  // ---- Spell VFX gallery smoke (dev-only hook; never in production UI) ------
  // Force a representative spell from every major visual family and confirm the
  // renderer draws distinct VFX objects, animates several frames (so WebGL runs
  // on each), and disposes cleanly — all with no JS/WebGL errors. Runs on the
  // idle main-menu arena, so no live match is required.
  const vfxReps = [6, 5, 7, 8, 9, 10, 11, 17, 26, 27, 32, 33, 34, 35, 37, 39, 40];
  const vfxResult = await page.evaluate(async (ids) => {
    if (!window.__aegVfx) return { error: 'no __aegVfx hook' };
    const coverage = window.__aegVfx.coverage();
    const profiles = window.__aegVfx.profiles();
    window.__aegVfx.clear();
    const spawned = [];
    for (const id of ids) { spawned.push({ id, kind: window.__aegVfx.spawn(id) }); await new Promise((r) => setTimeout(r, 25)); }
    await new Promise((r) => setTimeout(r, 450)); // let update()/WebGL run on every object
    const live = window.__aegVfx.kinds();
    // reduced-motion pass must also render without error
    window.__aegVfx.clear(); window.__aegVfx.setReduced(true);
    for (const id of [6, 7, 8, 34, 40]) window.__aegVfx.spawn(id);
    await new Promise((r) => setTimeout(r, 200));
    window.__aegVfx.setReduced(false); window.__aegVfx.clear();
    const afterClear = window.__aegVfx.kinds().length;
    return { coverage, profileCount: profiles.length, spawned, live, afterClear };
  }, vfxReps);
  if (!vfxResult || vfxResult.error) fail('VFX gallery hook missing: ' + JSON.stringify(vfxResult));
  if (vfxResult.profileCount !== 40) fail('VFX profiles must cover all 40 spells, got ' + vfxResult.profileCount);
  if (!Array.isArray(vfxResult.coverage) || vfxResult.coverage.length !== 0) {
    fail('renderer is missing a VFX family builder: ' + JSON.stringify(vfxResult.coverage));
  }
  const badSpawn = vfxResult.spawned.filter((s) => !s.kind || typeof s.kind !== 'string');
  if (badSpawn.length) fail('some spells produced no VFX kind (family builder error): ' + JSON.stringify(badSpawn));
  const uniqueKinds = new Set(vfxResult.spawned.map((s) => s.kind));
  if (uniqueKinds.size !== vfxReps.length) fail('VFX object kinds are not all distinct across families: ' + JSON.stringify(vfxResult.spawned));
  if (vfxResult.afterClear !== 0) fail('VFX gallery did not dispose spawned objects on clear: ' + vfxResult.afterClear);

  // ---- Weather zone family smoke -------------------------------------------
  // Every weather zone (including the reaction-only Fire/Frozen strips that no
  // single spell casts) must draw a DISTINCT object and animate WebGL frames
  // with no errors, then dispose cleanly — including a reduced-motion pass.
  const weatherKinds = ['Wet', 'Fog', 'Gust', 'Fire', 'Frozen', 'Oil'];
  const weatherResult = await page.evaluate(async (kinds) => {
    if (!window.__aegVfx || !window.__aegVfx.spawnZone) return { error: 'no spawnZone hook' };
    window.__aegVfx.clear();
    const spawned = [];
    for (const k of kinds) { spawned.push({ k, kind: window.__aegVfx.spawnZone(k) }); await new Promise((r) => setTimeout(r, 25)); }
    await new Promise((r) => setTimeout(r, 420)); // run update()/WebGL on each zone
    window.__aegVfx.clear(); window.__aegVfx.setReduced(true);
    for (const k of kinds) window.__aegVfx.spawnZone(k);
    await new Promise((r) => setTimeout(r, 200));
    window.__aegVfx.setReduced(false); window.__aegVfx.clear();
    return { spawned, afterClear: window.__aegVfx.kinds().length };
  }, weatherKinds);
  if (!weatherResult || weatherResult.error) fail('weather zone hook missing: ' + JSON.stringify(weatherResult));
  const badZone = weatherResult.spawned.filter((s) => !s.kind || typeof s.kind !== 'string');
  if (badZone.length) fail('some weather zones produced no VFX kind: ' + JSON.stringify(weatherResult.spawned));
  const uniqueZoneKinds = new Set(weatherResult.spawned.map((s) => s.kind));
  if (uniqueZoneKinds.size !== weatherKinds.length) fail('weather zone families are not all visually distinct: ' + JSON.stringify(weatherResult.spawned));
  if (weatherResult.afterClear !== 0) fail('weather gallery did not dispose zones on clear: ' + weatherResult.afterClear);

  // ---- Persistent guard family smoke ---------------------------------------
  // Ward, Barrier Dome and Reflect are the three standing guard visuals. Each
  // must draw a DISTINCT object, animate WebGL frames, survive a reduced-motion
  // pass, and dispose cleanly. Reflect is the new persistent Reflect-window
  // visual and must not collapse into Ward's or the Dome's silhouette.
  const guardKinds = ['ward', 'dome', 'reflect'];
  const guardResult = await page.evaluate(async (kinds) => {
    if (!window.__aegVfx || !window.__aegVfx.spawnGuard) return { error: 'no spawnGuard hook' };
    window.__aegVfx.clear();
    const spawned = [];
    for (const k of kinds) { spawned.push({ k, kind: window.__aegVfx.spawnGuard(k) }); await new Promise((r) => setTimeout(r, 25)); }
    await new Promise((r) => setTimeout(r, 420)); // run update()/WebGL on each guard
    window.__aegVfx.clear(); window.__aegVfx.setReduced(true);
    for (const k of kinds) window.__aegVfx.spawnGuard(k);
    await new Promise((r) => setTimeout(r, 200));
    window.__aegVfx.setReduced(false); window.__aegVfx.clear();
    return { spawned, afterClear: window.__aegVfx.kinds().length };
  }, guardKinds);
  if (!guardResult || guardResult.error) fail('guard gallery hook missing: ' + JSON.stringify(guardResult));
  const badGuard = (guardResult.spawned || []).filter((s) => !s.kind || typeof s.kind !== 'string');
  if (badGuard.length) fail('some guard visuals produced no VFX kind: ' + JSON.stringify(guardResult.spawned));
  const uniqueGuardKinds = new Set((guardResult.spawned || []).map((s) => s.kind));
  if (uniqueGuardKinds.size !== guardKinds.length) fail('guard visuals are not all visually distinct: ' + JSON.stringify(guardResult.spawned));
  if (!uniqueGuardKinds.has('reflectGuard')) fail('persistent Reflect guard visual missing from gallery: ' + JSON.stringify(guardResult.spawned));
  if (guardResult.afterClear !== 0) fail('guard gallery did not dispose visuals on clear: ' + guardResult.afterClear);

  // Production transient path (not the gallery) must receive the animation clock.
  const releaseMotion = await page.evaluate(async () => {
    const kind = window.__aegVfx.productionRelease(17); // Aether Surge ribbons
    const before = window.__aegVfx.productionMotion();
    await new Promise((r) => setTimeout(r, 260));
    const after = window.__aegVfx.productionMotion();
    const count = window.__aegVfx.productionCount();
    return { kind, before, after, count };
  });
  if (releaseMotion.kind !== 'aetherSurge' || releaseMotion.count < 1
      || releaseMotion.before === releaseMotion.after) {
    fail('production release VFX did not animate with the arena clock: ' + JSON.stringify(releaseMotion));
  }
  const playerHitDistances = await page.evaluate(() => window.__aegVfx.playerHitSafety(8));
  if (!Array.isArray(playerHitDistances) || playerHitDistances.length < 2
      || playerHitDistances.some((d) => d < 1.5)) {
    fail('player-hit VFX spawned too close to the first-person camera: ' + JSON.stringify(playerHitDistances));
  }

  // ---- Environmental reaction VFX gallery + production path -----------------
  // Every reaction the sim can emit must draw a DISTINCT, animated, disposable
  // signifier. ConductiveArc must be its own electric branching arc (a linked
  // lightning kind), spawned through the SAME production handler the live sim
  // drives — not a generic burst. A reduced-motion pass must also render.
  const reactionResult = await page.evaluate(async () => {
    if (!window.__aegVfx || !window.__aegVfx.spawnReaction) return { error: 'no reaction hook' };
    const coverage = window.__aegVfx.reactionCoverage();
    const profiles = window.__aegVfx.reactionProfiles();
    window.__aegVfx.clear();
    const spawned = [];
    for (const p of profiles) { spawned.push({ name: p.name, kind: window.__aegVfx.spawnReaction(p.name) }); await new Promise((r) => setTimeout(r, 18)); }
    await new Promise((r) => setTimeout(r, 450)); // run update()/WebGL on every reaction
    const live = window.__aegVfx.kinds().length;
    window.__aegVfx.clear(); window.__aegVfx.setReduced(true);
    for (const p of profiles) window.__aegVfx.spawnReaction(p.name);
    await new Promise((r) => setTimeout(r, 200));
    window.__aegVfx.setReduced(false); window.__aegVfx.clear();
    const afterClear = window.__aegVfx.kinds().length;
    // Production path: spawn ConductiveArc through the same _spawnReaction the sim uses.
    const prodArc = window.__aegVfx.productionReaction('ConductiveArc');
    const prodCount = window.__aegVfx.productionCount();
    return { coverage, profiles, spawned, live, afterClear, prodArc, prodCount };
  });
  if (!reactionResult || reactionResult.error) fail('reaction VFX hook missing: ' + JSON.stringify(reactionResult));
  if (!Array.isArray(reactionResult.coverage) || reactionResult.coverage.length !== 0) {
    fail('renderer is missing a reaction VFX builder: ' + JSON.stringify(reactionResult.coverage));
  }
  if (reactionResult.profiles.length !== 14) fail('reaction VFX must cover all 14 sim reactions, got ' + reactionResult.profiles.length);
  const badReaction = reactionResult.spawned.filter((s) => !s.kind || typeof s.kind !== 'string');
  if (badReaction.length) fail('some reactions produced no VFX kind (builder error): ' + JSON.stringify(badReaction));
  const uniqueReactionKinds = new Set(reactionResult.spawned.map((s) => s.kind));
  if (uniqueReactionKinds.size !== reactionResult.profiles.length) {
    fail('reaction VFX object kinds are not all distinct: ' + JSON.stringify(reactionResult.spawned));
  }
  if (reactionResult.afterClear !== 0) fail('reaction gallery did not dispose spawned objects on clear: ' + reactionResult.afterClear);
  const arcProfile = reactionResult.profiles.find((p) => p.name === 'ConductiveArc');
  if (!arcProfile || arcProfile.vfx !== 'arc' || arcProfile.anchor !== 'link' || arcProfile.kind !== 'reaction:conductiveArc') {
    fail('ConductiveArc must be a distinct linked electric arc: ' + JSON.stringify(arcProfile));
  }
  const arcSpawn = reactionResult.spawned.find((s) => s.name === 'ConductiveArc');
  if (!arcSpawn || arcSpawn.kind !== 'reaction:conductiveArc') fail('ConductiveArc lightning kind missing from gallery: ' + JSON.stringify(arcSpawn));
  if (reactionResult.prodArc !== 'reaction:conductiveArc') fail('ConductiveArc production VFX kind wrong: ' + reactionResult.prodArc);
  if (!(reactionResult.prodCount >= 1)) fail('ConductiveArc production VFX did not spawn a live transient effect');
  console.log('REACTIONS', reactionResult.spawned.length, 'distinct', uniqueReactionKinds.size);

  // ---- Arcane academy + wizard component metadata (renderer debug hook) ------
  const academyResult = await page.evaluate(() => ({
    academy: (window.__aegVfx && window.__aegVfx.academy) ? window.__aegVfx.academy() : { error: 'no academy hook' },
    titleShowcase: !!window.__aegTest?.info().menuDuelActive,
  }));
  const academy = academyResult.academy;
  if (!academy || academy.error) fail('academy stats hook missing: ' + JSON.stringify(academy));
  const comp = academy.components || {};
  const missingComp = ['sky', 'moon', 'stars', 'academy', 'backWall', 'platform'].filter((k) => !comp[k]);
  if (missingComp.length) fail('academy is missing components: ' + missingComp.join(','));
  if (!(comp.arcadeColumns >= 4)) fail('academy has too few arcade columns: ' + comp.arcadeColumns);
  if (!(comp.archedWindows >= 3)) fail('academy has too few arched windows: ' + comp.archedWindows);
  if (!(comp.braziers >= 2)) fail('academy has too few braziers: ' + comp.braziers);
  if (!(comp.floatingLights >= 4)) fail('academy has too few floating lanterns: ' + comp.floatingLights);
  if (!(comp.distantTowers >= 3)) fail('academy has too few distant towers: ' + comp.distantTowers);
  const wiz = academy.wizard || {};
  for (const part of ['robe', 'hat', 'hood', 'belt', 'staff', 'boots', 'hand',
    'eyes', 'nose', 'beard', 'brows', 'neck', 'leftArm', 'rightArm', 'crest', 'mantle']) {
    if (!(wiz.parts || []).includes(part)) fail('wizard is missing part: ' + part);
  }
  if (!wiz.hasStaff) fail('wizard has no visible staff');
  if (!(wiz.robeLayers >= 2)) fail('wizard robe should be layered');
  // Opponent must visibly FACE the first-person camera (front is local +Z).
  if (!academyResult.titleShowcase
      && !(wiz.facing && wiz.facing.towardCamera && wiz.facing.dot > 0.5)) {
    fail('opponent wizard is not facing the camera: ' + JSON.stringify(wiz.facing));
  }
  // A readable face at duel distance: two eyes, a nose and a beard.
  if (!(wiz.face && wiz.face.eyes >= 2 && wiz.face.nose && wiz.face.beard && wiz.face.brows)) {
    fail('wizard face missing eyes/nose/beard/brows: ' + JSON.stringify(wiz.face));
  }
  // Articulated arms (upper + fore + hand), one per side.
  if (!(wiz.arms && wiz.arms.count >= 2 && wiz.arms.articulated)) {
    fail('wizard arms are not articulated: ' + JSON.stringify(wiz.arms));
  }
  // Staff must be gripped by a hand, not floating.
  if (!wiz.staffHeld) fail('wizard staff is not held by a hand (grip gap ' + wiz.gripGap + ')');
  // Layered robe panels + academy crest/sigil.
  if (!(wiz.robePanels >= 2)) fail('wizard robe has too few panels: ' + wiz.robePanels);
  if (!wiz.hasCrest) fail('wizard robe missing an academy crest');
  if (!wiz.hasMantle) fail('wizard missing a shoulder mantle');
  // Idle/casting animation state hook is present and reports live motion.
  if (!wiz.animation || typeof wiz.animation.enabled !== 'boolean' || typeof wiz.animation.reducedMotion !== 'boolean') {
    fail('wizard animation state metadata missing: ' + JSON.stringify(wiz.animation));
  }
  if (!(academy.firstPerson && academy.firstPerson.gloveParts >= 4 && academy.firstPerson.hasWand)) {
    fail('first-person gloves/wand metadata missing: ' + JSON.stringify(academy.firstPerson));
  }
  const perceptionVfx = await page.evaluate(() => ({
    fog: window.__aegVfx.fogVeil(1),
    fogInside: window.__aegVfx.fogForPosition(0.1, 0, 0.55),
    fogOutside: window.__aegVfx.fogForPosition(0.9, 0, 0.55),
    fogBounds: window.__aegVfx.zoneBounds('Fog'),
    blind: window.__aegVfx.blindVeil(true),
    cover: window.__aegVfx.zoneBounds('Cover'),
    guardsVisible: window.__aegVfx.guardVisibility(0),
    guardsHidden: window.__aegVfx.guardVisibility(180),
  }));
  if (!perceptionVfx.fog.visible || perceptionVfx.fog.strength < 0.99) {
    fail('Fog Cloud screen-space haze is not intense: ' + JSON.stringify(perceptionVfx.fog));
  }
  if (!perceptionVfx.fogInside.visible || perceptionVfx.fogOutside.visible) {
    fail('Fog screen haze does not clear after leaving the zone: ' + JSON.stringify(perceptionVfx));
  }
  if (perceptionVfx.fogBounds.height < 4.6) {
    fail('Fog Cloud world bank is not 50% taller: ' + JSON.stringify(perceptionVfx.fogBounds));
  }
  if (!perceptionVfx.blind.visible
      || perceptionVfx.blind.background !== 'rgb(255, 255, 255)'
      || perceptionVfx.blind.position !== 'fixed'
      || perceptionVfx.blind.pointerEvents !== 'none'
      || perceptionVfx.blind.width !== perceptionVfx.blind.viewportWidth
      || perceptionVfx.blind.height !== perceptionVfx.blind.viewportHeight
      || !(perceptionVfx.blind.sceneZIndex < perceptionVfx.blind.zIndex
        && perceptionVfx.blind.zIndex < perceptionVfx.blind.hudZIndex)
      || !perceptionVfx.blind.drawPadVisible || !perceptionVfx.blind.spellbarVisible) {
    fail('Eclipse Glare is not a full-screen whiteout below the HUD: ' + JSON.stringify(perceptionVfx.blind));
  }
  if (perceptionVfx.cover.height < 2.2 || perceptionVfx.cover.width < 2.4) {
    fail('Stone Wall visual is not substantially taller and wider: ' + JSON.stringify(perceptionVfx.cover));
  }
  const statusNames = ['Burning', 'Chilled', 'Sloth', 'Wet', 'Soaked', 'Static', 'Sundered', 'Weakened',
    'Marked', 'Blinded', 'Veiled', 'Rooted', 'Frozen', 'Stunned', 'Haste', 'Grounded',
    'AetherSurge', 'Attunement', 'Phoenix'];
  const statusPreview = await page.evaluate((names) => names.map((name) => ({
    name,
    state: window.__aegVfx.wizardState([name], [name], 0, 0),
  })), statusNames);
  for (const preview of statusPreview) {
    if (preview.state.error || !preview.state.playerStatusVisible || !preview.state.enemyStatusVisible) {
      fail('status model indicator missing for ' + preview.name + ': ' + JSON.stringify(preview.state));
    }
  }
  const statusColors = new Set(statusPreview.map((preview) => preview.state.enemyColor));
  if (statusColors.size < 16) fail('status model colors are not sufficiently distinct: ' + statusColors.size);
  const blinkVisibility = await page.evaluate(() =>
    window.__aegVfx.wizardState(['Burning'], ['Static'], 180, 180));
  if (blinkVisibility.playerModelVisible || blinkVisibility.enemyModelVisible
      || blinkVisibility.playerStatusVisible || blinkVisibility.enemyStatusVisible) {
    fail('Blink invisibility leaves wizard/status graphics visible: ' + JSON.stringify(blinkVisibility));
  }
  if (!perceptionVfx.guardsVisible.ward || !perceptionVfx.guardsVisible.barrier
      || !perceptionVfx.guardsVisible.reflect || perceptionVfx.guardsHidden.ward
      || perceptionVfx.guardsHidden.barrier || perceptionVfx.guardsHidden.reflect) {
    fail('Blink invisibility leaves defensive spell graphics visible: ' + JSON.stringify(perceptionVfx));
  }
  // Three persistent guard visuals (Ward, Barrier Dome, Reflect) exist and are
  // visually DISTINCT — Reflect must not reuse Ward's or the Dome's kind.
  const guards = academy.guards || {};
  if (!(guards.reflect === 'reflectGuard' && guards.ward === 'ward' && guards.barrier === 'barrierDome' && guards.distinct)) {
    fail('persistent guard visuals (ward/barrier/reflect) missing or not distinct: ' + JSON.stringify(guards));
  }
  if (!(academy.budget && academy.budget.lightBudgetOk && academy.budget.transparentBudgetOk)) {
    fail('academy exceeds mobile light/transparent budget: ' + JSON.stringify(academy.budget));
  }
  console.log('ACADEMY', JSON.stringify(academy.budget), 'columns', comp.arcadeColumns, 'towers', comp.distantTowers);
  console.log('WIZARD', JSON.stringify(wiz.facing), 'staffHeld', wiz.staffHeld, wiz.gripGap,
    'face', JSON.stringify(wiz.face), 'arms', JSON.stringify(wiz.arms),
    'panels', wiz.robePanels, 'anim', JSON.stringify(wiz.animation));

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
  fail(err.stack || err.message || String(err));
}
