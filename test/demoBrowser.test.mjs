import express from 'express';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { DEMO_WWW, stageDemoWeb } from '../scripts/stage-demo-web.js';

const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

if (!edge) {
  console.log('demoBrowser: browser unavailable, skipped');
  process.exit(0);
}

stageDemoWeb();
const app = express();
app.use(express.static(DEMO_WWW));
const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

try {
  const page = await browser.newPage();
  const forbiddenRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' || /socket\.io/i.test(url.pathname)) {
      forbiddenRequests.push(request.url());
    }
  });

  await page.goto(`http://127.0.0.1:${port}/client/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__aegTest);
  const info = await page.evaluate(() => window.__aegTest.info());
  if (!info.demoBuild) throw new Error('Demo edition flag is not active.');

  await page.click('[data-action="online"]');
  await page.waitForSelector('#panel-demo-online:not(.hidden)');
  const noticeRect = await page.$eval('#panel-demo-online', (element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  if (noticeRect.width <= 0 || noticeRect.height <= 0) {
    throw new Error(`Demo online notice is not visibly rendered: ${JSON.stringify(noticeRect)}`);
  }
  const message = await page.$eval('#demo-online-message', (element) => element.textContent);
  const expected =
    'Thanks for playing the demo! For online functionality, please purchase the full version of Aetherglyph: Arcane Duels';
  if (message !== expected) throw new Error(`Wrong demo online message: ${message}`);
  if (await page.$('#panel-online:not(.hidden)')) throw new Error('Full online panel opened in demo.');

  await page.evaluate(() => document.querySelector('#panel-demo-online [data-action="back"]')?.click());
  await page.evaluate(() => document.querySelector('#panel-main [data-action="settings"]')?.click());
  await page.waitForSelector('#panel-settings:not(.hidden)');
  const settingsVisibility = await page.evaluate(() => {
    const serverInput = document.querySelector('#set-server-url');
    const serverSection = serverInput?.closest('.settings-section');
    const calibration = document.querySelector('[data-action="recalibrate"]');
    const calibrationSection = calibration?.closest('.settings-section');
    return {
      serverSectionId: serverSection?.id || '',
      serverHidden: !!serverSection?.classList.contains('hidden'),
      calibrationHidden: !!calibrationSection?.classList.contains('hidden'),
    };
  });
  if (settingsVisibility.serverSectionId !== 'online-service-settings'
      || !settingsVisibility.serverHidden) {
    throw new Error(`Demo exposes online server settings: ${JSON.stringify(settingsVisibility)}`);
  }
  if (settingsVisibility.calibrationHidden) {
    throw new Error('Demo hides offline baseline calibration.');
  }

  for (const action of ['tutorial', 'practice-ai', 'lab']) {
    await page.evaluate(() => window.__aegTest.returnMenu());
    await page.waitForSelector('#panel-main:not(.hidden)');
    await page.click(`[data-action="${action}"]`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (forbiddenRequests.length) {
    throw new Error(`Demo attempted forbidden network requests: ${forbiddenRequests.join(', ')}`);
  }
  console.log('demoBrowser: PASS');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
