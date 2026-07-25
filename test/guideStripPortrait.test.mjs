import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = process.env.PORT || 8137;
const URL = `http://127.0.0.1:${PORT}/client/index.html`;
const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  process.env.CHROME_PATH,
].filter(Boolean).find((path) => existsSync(path));

if (!edge) {
  console.log('guideStripPortrait: browser unavailable, skipped');
  process.exit(0);
}

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT },
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 1400));

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

async function assertGuideStrip(page, label, { requireScrollable = true } = {}) {
  await page.waitForSelector('#hud:not(.hidden) #spellbar .spell-btn[data-spell]', { timeout: 10000 });
  const result = await page.evaluate(() => {
    const bar = document.querySelector('#spellbar');
    const buttons = Array.from(bar.querySelectorAll('.spell-btn[data-spell]'));
    const overflow = getComputedStyle(bar).overflowX;
    bar.scrollLeft = bar.scrollWidth;
    const before = bar.scrollLeft;
    const rect = bar.getBoundingClientRect();
    const target = buttons.findLast((button) => {
      const r = button.getBoundingClientRect();
      return r.left >= rect.left && r.right <= rect.right;
    });
    const targetId = target?.dataset.spell;
    target?.click();
    const nextBar = document.querySelector('#spellbar');
    const selectedAfterTap = nextBar.querySelector('.spell-btn.selected')?.dataset.spell;
    const after = nextBar.scrollLeft;

    const scrollable = bar.scrollWidth > bar.clientWidth;
    const cancelCandidate = scrollable
      ? Array.from(nextBar.querySelectorAll('.spell-btn[data-spell]'))
        .find((button) => button.dataset.spell !== selectedAfterTap)
      : null;
    const selectedBeforeScroll = selectedAfterTap;
    cancelCandidate?.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 501, pointerType: 'touch',
      clientX: 100, clientY: 20,
    }));
    nextBar.scrollLeft = Math.max(0, after - 80);
    cancelCandidate?.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 501, pointerType: 'touch',
      clientX: 101, clientY: 20,
    }));
    const selectedAfterScroll = document.querySelector('#spellbar .spell-btn.selected')?.dataset.spell;
    return {
      overflow,
      scrollable,
      targetId,
      selectedAfterTap,
      before,
      after,
      selectedBeforeScroll,
      selectedAfterScroll,
    };
  });

  if (result.overflow !== 'auto' || (requireScrollable && !result.scrollable)
      || !result.targetId || result.selectedAfterTap !== result.targetId
      || Math.abs(result.after - result.before) > 2
      || (result.scrollable && result.selectedAfterScroll !== result.selectedBeforeScroll)) {
    throw new Error(`${label} portrait guide strip failed: ${JSON.stringify(result)}`);
  }
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 850, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => {
    if (response.status() === 404 && !/favicon/i.test(response.url())) errors.push(`404 ${response.url()}`);
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => !!window.__aegTest, { timeout: 15000 });

  await page.click('[data-action="lab"]');
  await assertGuideStrip(page, 'Glyph Laboratory');

  await page.evaluate(() => window.__aegTest.returnMenu());
  await page.click('[data-action="practice-ai"]');
  await page.click('[data-action="start-practice"]');
  await assertGuideStrip(page, 'Practice vs AI');

  await page.evaluate(() => window.__aegTest.returnMenu());
  await page.evaluate(() => window.__aegTest.simulateOnlineStart());
  await assertGuideStrip(page, 'Online Duel');

  await page.evaluate(() => {
    window.__aegTest.returnMenu();
    const raw = localStorage.getItem('aeg.solo.v1');
    const profile = raw ? JSON.parse(raw) : {};
    profile.completedLessons = [
      'PROLOGUE', 'L01', 'L02', 'L03', 'L04', 'L05',
      'L06', 'L07', 'L08', 'L09', 'L10', 'L11',
    ];
    profile.currentLessonId = 'L12';
    profile.calibration = { done: true, guideScale: 1, comfortableDurationMs: 720 };
    localStorage.setItem('aeg.solo.v1', JSON.stringify(profile));
    window.__aegTest.startTutorialLesson('L12', { guidesChosen: true });
  });
  await page.click('[data-action="tut-begin"]');
  await assertGuideStrip(page, 'First Formal Duel tutorial');

  await page.evaluate(() => {
    window.__aegTest.returnMenu();
    window.__aegTest.startTutorialLesson('L03');
  });
  await page.click('[data-action="tut-begin"]');
  await assertGuideStrip(page, 'multi-spell tutorial lesson', { requireScrollable: false });
  const tutorialGuideBefore = await page.$eval('#spellbar .spell-btn.selected', (button) => button.dataset.spell);
  const canvas = await page.$('#draw-canvas');
  const box = await canvas.boundingBox();
  const tapX = box.x + box.width * 0.75;
  const tapY = box.y + box.height * 0.5;
  await page.mouse.click(tapX, tapY);
  await new Promise((resolve) => setTimeout(resolve, 70));
  await page.mouse.click(tapX, tapY);
  const tutorialGuideAfter = await page.$eval('#spellbar .spell-btn.selected', (button) => button.dataset.spell);
  if (tutorialGuideAfter === tutorialGuideBefore) {
    throw new Error('multi-spell tutorial double-tap did not switch guides');
  }

  if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
  console.log('guideStripPortrait: PASS');
} finally {
  await browser.close();
  try { server.kill(); } catch {}
}
