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
async function activate(page, selector) {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.evaluate((s) => document.querySelector(s)?.click(), selector);
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
  await activate(page, '#panel-online [data-action="back"]');
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
      painted,
    };
  });
  if (!/any public spell/i.test(blankLab.hint) || blankLab.stage !== 'blank'
      || blankLab.guide != null || !blankLab.selected || blankLab.painted !== 0) {
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
  await cooldownToggle.click();
  const cooldownOn = await page.evaluate(() => ({
    text: document.querySelector('#spellbar .spell-cooldown-toggle .sb-cost')?.textContent,
    state: window.__aegTest.info().labCooldowns,
  }));
  if (cooldownOn.text !== 'On' || cooldownOn.state !== true) {
    fail('Glyph Laboratory cooldown toggle did not turn On: ' + JSON.stringify(cooldownOn));
  }
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

  // ---- Arcane academy + wizard component metadata (renderer debug hook) ------
  const academy = await page.evaluate(() => (window.__aegVfx && window.__aegVfx.academy) ? window.__aegVfx.academy() : { error: 'no academy hook' });
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
  for (const part of ['robe', 'hat', 'hood', 'belt', 'staff', 'boots', 'hand']) {
    if (!(wiz.parts || []).includes(part)) fail('wizard is missing part: ' + part);
  }
  if (!wiz.hasStaff) fail('wizard has no visible staff');
  if (!(wiz.robeLayers >= 2)) fail('wizard robe should be layered');
  if (!(academy.firstPerson && academy.firstPerson.gloveParts >= 4 && academy.firstPerson.hasWand)) {
    fail('first-person gloves/wand metadata missing: ' + JSON.stringify(academy.firstPerson));
  }
  if (!(academy.budget && academy.budget.lightBudgetOk && academy.budget.transparentBudgetOk)) {
    fail('academy exceeds mobile light/transparent budget: ' + JSON.stringify(academy.budget));
  }
  console.log('ACADEMY', JSON.stringify(academy.budget), 'columns', comp.arcadeColumns, 'towers', comp.distantTowers);

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
