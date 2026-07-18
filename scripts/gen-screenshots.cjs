'use strict';

// gen-screenshots.cjs — deterministic-ish Play Store phone screenshots rendered
// from the real client (title, loadout builder, and a live Practice vs AI round)
// via the locally installed Edge/Chrome using puppeteer-core (already a dev
// dependency; no Chromium download). Best-effort: if no browser is found it exits
// cleanly.
//
// Output: play-assets/screenshots/*.png at 1600x900 (landscape phone).
// Run: `npm run android:screenshots`.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const PORT = process.env.PORT || 8134;
const URL = `http://localhost:${PORT}/client/index.html`;
const W = 1600;
const H = 900;

const BROWSER_CANDIDATES = [
  process.env.AETHER_CHROMIUM_PATH,
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

function findBrowser() {
  return BROWSER_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const browserPath = findBrowser();
  const out = path.join(root, 'play-assets', 'screenshots');
  fs.mkdirSync(out, { recursive: true });

  if (!browserPath) {
    console.warn('No Edge/Chrome found; skipping screenshots. Set AETHER_CHROMIUM_PATH to enable.');
    return;
  }

  const server = spawn(process.execPath, ['server.js'], {
    cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  const stopServer = () => { try { server.kill(); } catch { /* ignore */ } };
  process.on('exit', stopServer);
  await wait(1500);

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', `--window-size=${W},${H}`],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, isMobile: true, hasTouch: true });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#panel-main:not(.hidden)', { timeout: 15000 });
    await wait(700);
    await page.screenshot({ path: path.join(out, '01-title.png') });

    // Loadout builder with a curated preset applied.
    await page.click('[data-action="loadout"]');
    await page.waitForSelector('#panel-loadout:not(.hidden)', { timeout: 5000 });
    await page.waitForSelector('.preset-btn', { timeout: 5000 });
    await page.click('.preset-btn');
    await wait(400);
    await page.screenshot({ path: path.join(out, '02-loadout.png') });
    await page.click('[data-action="save-loadout"]');
    await page.waitForSelector('#panel-practice:not(.hidden)', { timeout: 5000 });

    // A live Practice vs AI round: pick Medium, start, draw a couple of glyphs.
    await page.select('#prac-diff', 'medium').catch(() => {});
    await page.click('[data-action="start-practice"]');
    await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
    await page.waitForSelector('#spellbar .spell-btn', { timeout: 5000 });
    const pad = await page.$('#draw-canvas');
    const box = await pad.boundingBox();
    const y = box.y + box.height / 2;
    for (let n = 0; n < 2; n += 1) {
      await page.mouse.move(box.x + box.width * 0.2, y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i += 1) await page.mouse.move(box.x + box.width * (0.2 + 0.6 * (i / 8)), y);
      await page.mouse.up();
      await wait(160);
    }
    const btns = await page.$$('#spellbar .spell-btn');
    for (let k = 0; k < Math.min(3, btns.length); k += 1) { await btns[k].click(); await wait(140); }
    await wait(1600);
    await page.screenshot({ path: path.join(out, '03-duel.png') });

    console.log(`Generated Play screenshots in ${path.relative(root, out)} (1600x900).`);
    await browser.close();
  } catch (err) {
    try { await browser.close(); } catch { /* ignore */ }
    console.error('Screenshot generation failed:', err.message || String(err));
    process.exitCode = 1;
  } finally {
    stopServer();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
