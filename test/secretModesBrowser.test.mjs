import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { GESTURE_TEMPLATES } from '../shared/src/gesture/templates.js';

const PORT = 8136;
const URL = `http://127.0.0.1:${PORT}/client/index.html`;
const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  process.env.CHROME_PATH,
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!edge) {
  console.error('No Edge/Chrome found; skipping secret mode browser test.');
  process.exit(0);
}

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function openTutorialHub(page) {
  await page.click('[data-action="tutorial"]');
  await page.waitForSelector('#panel-tutorial:not(.hidden)', { timeout: 5000 });
}

async function drawGesture(page, points) {
  const canvas = await page.$('#draw-canvas');
  const box = await canvas.boundingBox();
  const map = (point) => ({
    x: box.x + box.width * (0.15 + (point.x / 100) * 0.7),
    y: box.y + box.height * (0.15 + (point.y / 100) * 0.7),
  });
  const first = map(points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const mapped = map(point);
    await page.mouse.move(mapped.x, mapped.y, { steps: 3 });
  }
  await page.mouse.up();
}

try {
  await sleep(1400);
  browser = await puppeteer.launch({
    headless: true,
    executablePath: edge,
    args: ['--use-angle=swiftshader', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('aeg.solo.v1', JSON.stringify({
      schemaVersion: 1,
      currentLessonId: 'EXAM',
      completedLessons: [
        'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G10', 'G11', 'G12',
        'S01', 'S02', 'S03', 'S04', 'EXAM',
      ],
      spellGuideStage: {},
      medals: {},
      clues: {},
      secretsFound: { 37: true, 38: false, 39: false, 40: false },
      rankedReady: true,
      calibration: {
        hand: 'right', guideScale: 0.84, comfortableDurationMs: 720, done: true,
      },
      practice: {
        difficulty: 'medium', playerPreset: 'current', opponentPreset: 'auto',
        coaching: 'detailed', timed: true, templates: false,
      },
      stats: {
        rejectionReasons: {}, lessonAttempts: {}, practice: {},
      },
    }));
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!window.__aegTest);

  await page.click('[data-action="lab"]');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  const labSecret = await page.evaluate((points) => ({
    recognition: window.__aegTest.recognize(points),
    secretGuide: !!document.querySelector('#spellbar [data-spell="37"]'),
  }), GESTURE_TEMPLATES.eightTap[0]);
  assert(labSecret.recognition.accepted && labSecret.recognition.spellId === 37,
    `Glyph Laboratory did not recognize discovered Mirror Twin: ${JSON.stringify(labSecret)}`);
  assert(!labSecret.secretGuide, 'Glyph Laboratory exposed a secret-spell guide button.');
  await drawGesture(page, GESTURE_TEMPLATES.eightTap[0]);
  await page.waitForFunction(() => window.__aegTest.info().playerMirrorTicks > 0, { timeout: 5000 });
  const liveMirror = await page.evaluate(() => ({
    info: window.__aegTest.info(),
    visual: window.__aegVfx.decoyState(),
  }));
  assert(liveMirror.visual.player.visible && liveMirror.visual.player.kind === 'mirrorDecoy',
    `Mirror Twin did not render its persistent moving decoy: ${JSON.stringify(liveMirror)}`);
  assert(Math.abs(liveMirror.info.enemyFacing - liveMirror.info.playerMirrorPos) < 0.02,
    `Lab enemy did not face the Mirror Twin decoy: ${JSON.stringify(liveMirror.info)}`);

  await page.evaluate(() => window.__aegTest.returnMenu());
  await page.click('[data-action="practice-ai"]');
  await page.waitForSelector('#panel-practice:not(.hidden)', { timeout: 5000 });
  await page.click('[data-action="start-practice"]');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  const practiceSecret = await page.evaluate((points) => ({
    recognition: window.__aegTest.recognize(points),
    secretGuide: !!document.querySelector('#spellbar [data-spell="37"]'),
  }), GESTURE_TEMPLATES.eightTap[0]);
  assert(practiceSecret.recognition.accepted && practiceSecret.recognition.spellId === 37,
    `Practice did not recognize discovered Mirror Twin: ${JSON.stringify(practiceSecret)}`);
  assert(!practiceSecret.secretGuide, 'Practice exposed a secret-spell guide button.');

  await page.evaluate(() => window.__aegTest.returnMenu());
  await openTutorialHub(page);
  await page.click('[data-lesson="EXAM"]');
  await page.waitForSelector('#panel-loadout:not(.hidden)', { timeout: 5000 });
  const chooser = await page.evaluate(() => ({
    title: document.querySelector('#panel-loadout h2')?.textContent || '',
    secretChips: document.querySelectorAll('#loadout-catalog .spell-chip.secret').length,
    picked: document.querySelectorAll('#loadout-picked .picked-chip').length,
  }));
  assert(chooser.title === 'Final Duel Guide Shortcuts' && chooser.secretChips === 0 && chooser.picked === 8,
    `Final Duel did not present eight public guide choices: ${JSON.stringify(chooser)}`);
  await page.click('#panel-loadout [data-action="save-loadout"]');
  await page.waitForSelector('#panel-lesson-intro:not(.hidden)', { timeout: 5000 });
  await page.click('[data-action="tut-begin"]');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  const finalDuel = await page.evaluate((secretPoints, publicPoints) => ({
    secret: window.__aegTest.recognize(secretPoints),
    publicSpell: window.__aegTest.recognize(publicPoints),
    guideCount: document.querySelectorAll('#spellbar .spell-btn[data-spell]').length,
    spellbarHidden: document.querySelector('#spellbar')?.classList.contains('hidden'),
  }), GESTURE_TEMPLATES.eightTap[0], GESTURE_TEMPLATES.wideArc[0]);
  assert(finalDuel.secret.accepted && finalDuel.secret.spellId === 37,
    `Final Duel rejected a discovered secret spell: ${JSON.stringify(finalDuel)}`);
  assert(finalDuel.publicSpell.accepted && finalDuel.publicSpell.spellId === 6,
    `Final Duel rejected a public spell outside its selected guides: ${JSON.stringify(finalDuel)}`);
  assert(!finalDuel.spellbarHidden && finalDuel.guideCount === 8,
    `Final Duel did not show eight selected guides: ${JSON.stringify(finalDuel)}`);

  await page.evaluate(() => window.__aegTest.returnMenu());
  await openTutorialHub(page);
  await page.click('[data-lesson="EXAM_GM"]');
  await page.waitForSelector('#panel-lesson-intro:not(.hidden)', { timeout: 5000 });
  assert(!(await page.$('#panel-loadout:not(.hidden)')),
    'Grandmaster Trial incorrectly opened the guide selector.');
  await page.click('[data-action="tut-begin"]');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  const grandmaster = await page.evaluate((points) => ({
    recognition: window.__aegTest.recognize(points),
    spellbarHidden: document.querySelector('#spellbar')?.classList.contains('hidden'),
  }), GESTURE_TEMPLATES.eightTap[0]);
  assert(grandmaster.recognition.accepted && grandmaster.recognition.spellId === 37,
    `Grandmaster Trial rejected a discovered secret spell: ${JSON.stringify(grandmaster)}`);
  assert(grandmaster.spellbarHidden, 'Grandmaster Trial exposed spell guides.');

  console.log('secretModesBrowser: PASS');
} finally {
  if (browser) await browser.close();
  server.kill();
}
