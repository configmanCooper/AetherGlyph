import express from 'express';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { stageWeb, ROOT, WWW } from '../scripts/stage-web.js';

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  process.env.CHROME_PATH,
].filter(Boolean);
const executablePath = EDGE_CANDIDATES.find((path) => existsSync(path));
if (!executablePath) {
  console.log('GitHub Pages browser test skipped: no Edge/Chrome found.');
  process.exit(0);
}

stageWeb();
const app = express();
app.use('/AetherGlyph', express.static(ROOT));
app.use('/AetherGlyphActions', express.static(WWW));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const port = server.address().port;
const pagesHost = 'aetherglyph-pages.invalid';
const origin = `http://${pagesHost}:${port}`;

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    `--host-resolver-rules=MAP ${pagesHost} 127.0.0.1`,
  ],
});

try {
  const page = await browser.newPage();
  const errors = [];
  const missing = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.status() === 404 && !/favicon/i.test(response.url())) missing.push(response.url());
  });

  await page.goto(`${origin}/AetherGlyph/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => !!window.__aegTest, { timeout: 15000 });
  await page.click('[data-action="settings"]');

  const initial = await page.evaluate(() => ({
    path: window.location.pathname,
    choice: document.querySelector('#set-server-choice')?.value,
    status: document.querySelector('#server-url-status')?.textContent,
  }));
  if (initial.path !== '/AetherGlyph/client/index.html') throw new Error(`unexpected Pages path: ${initial.path}`);
  if (initial.choice !== 'dedicated') throw new Error(`unexpected default server choice: ${initial.choice}`);
  if (!initial.status.includes('https://aetherglyph-server.onrender.com')) {
    throw new Error(`dedicated default not shown: ${initial.status}`);
  }

  await page.select('#set-server-choice', 'full-game');
  await page.click('[data-action="server-save"]');
  const fullGame = await page.evaluate(() => ({
    stored: localStorage.getItem('aeth-server-url'),
    status: document.querySelector('#server-url-status')?.textContent,
  }));
  if (fullGame.stored !== 'https://aetherglyph.onrender.com') {
    throw new Error(`full-game server was not saved: ${fullGame.stored}`);
  }
  if (!fullGame.status.includes('https://aetherglyph.onrender.com')) {
    throw new Error(`full-game server not shown: ${fullGame.status}`);
  }

  await page.select('#set-server-choice', 'dedicated');
  await page.click('[data-action="server-save"]');
  const reset = await page.evaluate(() => localStorage.getItem('aeth-server-url'));
  if (reset !== null) throw new Error(`dedicated default should clear override: ${reset}`);
  if (errors.length || missing.length) {
    throw new Error(`browser errors=${JSON.stringify(errors)} missing=${JSON.stringify(missing)}`);
  }

  const stagedPage = await browser.newPage();
  const stagedErrors = [];
  stagedPage.on('pageerror', (error) => stagedErrors.push(String(error)));
  stagedPage.on('response', (response) => {
    if (response.status() === 404 && !/favicon/i.test(response.url())) stagedErrors.push(response.url());
  });
  await stagedPage.goto(`${origin}/AetherGlyphActions/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await stagedPage.waitForFunction(() => !!window.__aegTest, { timeout: 15000 });
  const stagedPath = await stagedPage.evaluate(() => window.location.pathname);
  await stagedPage.close();
  if (stagedPath !== '/AetherGlyphActions/client/index.html' || stagedErrors.length) {
    throw new Error(`Actions artifact failed: path=${stagedPath} errors=${JSON.stringify(stagedErrors)}`);
  }

  console.log('GitHub Pages browser test: PASS');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
