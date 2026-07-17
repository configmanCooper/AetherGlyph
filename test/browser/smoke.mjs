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

  // Non-starter loadout path: open the builder, apply an archetype preset,
  // save it, then start a best-of-three series against a chosen opponent.
  await page.click('[data-action="loadout"]');
  await page.waitForSelector('#panel-loadout:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('.preset-btn', { timeout: 5000 });
  await page.click('.preset-btn'); // apply the first curated preset (Ember Rush)
  await page.waitForSelector('.ls-ok', { timeout: 5000 }); // legal loadout confirmed
  await page.click('[data-action="save-loadout"]');
  await page.waitForSelector('#panel-duel:not(.hidden)', { timeout: 5000 });
  await page.click('[data-action="start-duel"]');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('#series-score:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('#spellbar .spell-btn', { timeout: 5000 });

  // Draw a horizontal flick (Ember Bolt) on the draw pad via pointer.
  const pad = await page.$('#draw-canvas');
  const box = await pad.boundingBox();
  const y = box.y + box.height / 2;
  async function drawLine(x0, x1) {
    await page.mouse.move(box.x + x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + x0 + (x1 - x0) * (i / 8), y);
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 150));
  }
  await drawLine(box.width * 0.2, box.width * 0.8);
  await drawLine(box.width * 0.2, box.width * 0.8);

  // Exercise the on-screen cast bar (a spell that has no drawn gesture yet).
  const spellBtns = await page.$$('#spellbar .spell-btn');
  for (let k = 0; k < Math.min(3, spellBtns.length); k++) {
    await spellBtns[k].click();
    await new Promise((r) => setTimeout(r, 120));
  }

  // Let the match run a bit.
  await new Promise((r) => setTimeout(r, 2500));

  const state = await page.evaluate(() => ({
    timer: document.querySelector('#round-timer')?.textContent,
    enemyHp: document.querySelector('#enemy-health')?.style.width,
    playerHp: document.querySelector('#player-health')?.style.width,
    hudVisible: !document.querySelector('#hud')?.classList.contains('hidden'),
    seriesVisible: !document.querySelector('#series-score')?.classList.contains('hidden'),
    spellButtons: document.querySelectorAll('#spellbar .spell-btn').length,
  }));

  if (errors.length) fail('console/page errors: ' + errors.slice(0, 4).join(' | '));
  if (http404.length) fail('unexpected 404s: ' + http404.slice(0, 4).join(' | '));
  if (!state.hudVisible) fail('HUD not visible after starting duel');
  if (!state.seriesVisible) fail('series score not shown in best-of-three');
  if (state.spellButtons !== 8) fail('cast bar should have 8 equipped spells, has ' + state.spellButtons);
  if (!state.timer || state.timer === '1:45') fail('round timer did not advance: ' + state.timer);

  console.log('SMOKE PASS', JSON.stringify(state));
  await browser.close();
  cleanup(0);
} catch (err) {
  try { await browser.close(); } catch {}
  fail(err.message || String(err));
}
