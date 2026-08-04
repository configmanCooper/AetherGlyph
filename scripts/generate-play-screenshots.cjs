'use strict';

// Captures real Aetherglyph UI/gameplay and packages it into store-ready,
// captioned screenshot sets for the full and demo Play Console listings.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const express = require('express');
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const playDir = path.join(root, 'play-assets');
const portBase = Number(process.env.PLAY_ASSET_PORT_BASE || 8150);
const fullPort = portBase;
const demoPort = portBase + 1;
const fullUrl = `http://127.0.0.1:${fullPort}/client/index.html`;
const demoUrl = `http://127.0.0.1:${demoPort}/client/index.html`;
const browserCandidates = [
  process.env.AETHER_CHROMIUM_PATH,
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

const layouts = [
  {
    key: 'phone', width: 1080, height: 1920, header: 220,
    captureWidth: 720,
    output: (edition) => path.join(playDir, edition, 'phone'),
  },
  {
    key: 'tablet-7', width: 1440, height: 2560, header: 270,
    captureWidth: 900,
    output: (edition) => path.join(playDir, edition, 'tablet-7'),
  },
  {
    key: 'tablet-10', width: 1620, height: 2880, header: 300,
    captureWidth: 900,
    output: (edition) => path.join(playDir, edition, 'tablet-10'),
  },
  {
    key: 'pc', width: 1920, height: 1080, header: 120,
    captureWidth: 1280,
    output: (edition) => path.join(playDir, edition, 'google-play-games-pc', 'screenshots'),
  },
];

const editionFilter = process.argv.find((argument) => argument.startsWith('--edition='))
  ?.split('=')[1];
const layoutFilter = process.argv.find((argument) => argument.startsWith('--layout='))
  ?.split('=')[1];
const sceneFilters = new Set((process.argv.find((argument) => argument.startsWith('--scenes='))
  ?.split('=')[1] || process.argv.find((argument) => argument.startsWith('--scene='))
  ?.split('=')[1] || '').split(',').filter(Boolean));

const scenes = {
  demo: [
    {
      file: '01-enter-the-academy.png',
      title: 'ENTER THE ACADEMY',
      subtitle: 'Draw living glyphs in a moonlit school of magic',
      prepare: async (page) => {
        await page.evaluate(() => {
          document.querySelector('#panel-main [data-action="online"]')?.classList.add('hidden');
        });
        await wait(900);
      },
    },
    {
      file: '02-guided-campaign.png',
      title: 'LEARN EVERY SCHOOL',
      subtitle: 'A guided campaign built on the real duel rules',
      prepare: async (page) => click(page, '[data-action="tutorial"]', '#panel-tutorial:not(.hidden)'),
    },
    {
      file: '03-spell-roster.png',
      title: 'MASTER A DEEP SPELL ROSTER',
      subtitle: 'Study glyphs, counters, timing and tactical uses',
      prepare: async (page) => click(page, '[data-action="spell-roster"]', '#panel-spell-roster:not(.hidden)'),
    },
    {
      file: '04-guide-shortcuts.png',
      title: 'BUILD YOUR GUIDE SHORTCUTS',
      subtitle: 'Guides help your hand — they never limit casting',
      prepare: async (page) => {
        await click(page, '[data-action="loadout"]', '#panel-loadout:not(.hidden)');
        await page.waitForSelector('.preset-btn', { timeout: 8000 });
        const presets = await page.$$('.preset-btn');
        if (presets[2]) await presets[2].click();
        await wait(350);
      },
    },
    {
      file: '05-practice-options.png',
      title: 'TRAIN YOUR WAY',
      subtitle: 'Fair AI difficulty, coaching and timing options',
      prepare: async (page) => click(page, '[data-action="practice-ai"]', '#panel-practice:not(.hidden)'),
    },
    {
      file: '06-offline-duel.png',
      title: 'DUEL FAIR AI OFFLINE',
      subtitle: 'Real-time spell combat with no internet required',
      prepare: async (page) => {
        await click(page, '[data-action="practice-ai"]', '#panel-practice:not(.hidden)');
        await page.select('#prac-diff', 'medium').catch(() => {});
        await click(page, '[data-action="start-practice"]', '#hud:not(.hidden)');
        await page.waitForSelector('#spellbar .spell-btn', { timeout: 8000 });
        await drawEmberFlick(page);
        await wait(900);
        await page.evaluate(() => {
          window.__aegVfx?.productionRelease?.(30);
          window.__aegVfx?.productionReaction?.('ConductiveArc');
        });
        await wait(180);
      },
    },
    {
      file: '07-glyph-laboratory.png',
      title: 'EXPERIMENT WITHOUT LIMITS',
      subtitle: 'Test glyphs, reactions and counters in the laboratory',
      prepare: async (page) => {
        await click(page, '[data-action="lab"]', '#hud:not(.hidden)');
        await page.waitForSelector('#spellbar .spell-btn', { timeout: 8000 });
        await page.evaluate(() => {
          window.__aegVfx?.productionRelease?.(40);
          window.__aegVfx?.productionReaction?.('SteamVeil');
        });
        await wait(220);
      },
    },
  ],
  full: [
    {
      file: '01-enter-the-academy.png',
      title: 'ENTER THE ACADEMY',
      subtitle: 'Draw spells, master counters and become a duelist',
      prepare: async (page) => wait(900),
    },
    {
      file: '02-online-duels.png',
      title: 'ONLINE DUELS, YOUR WAY',
      subtitle: 'Ranked, unranked and private-room matchmaking',
      prepare: async (page, context) => authenticate(page, context),
    },
    {
      file: '03-world-rankings.png',
      title: 'CLIMB THE GLYPH RANKINGS',
      subtitle: 'Track your record and place among the world’s wizards',
      prepare: async (page, context) => {
        await authenticate(page, context);
        await click(page, '[data-action="online-rankings"]', '#panel-rankings:not(.hidden)');
        await page.waitForFunction(() => /Glyphs/.test(
          document.querySelector('#rankings-self')?.textContent || ''), { timeout: 10000 });
        await page.evaluate(() => {
          const body = document.querySelector('#rankings-body');
          if (body) {
            body.innerHTML = `
              <tr><td>1</td><td>MoonSage</td><td>420</td><td>18</td><td>4</td></tr>
              <tr><td>2</td><td>Runesmith</td><td>340</td><td>15</td><td>5</td></tr>
              <tr><td>3</td><td>StormScholar</td><td>275</td><td>13</td><td>6</td></tr>
              <tr><td>4</td><td>AstralMaven</td><td>250</td><td>12</td><td>6</td></tr>
              <tr><td>5</td><td>EmberArchivist</td><td>195</td><td>10</td><td>8</td></tr>`;
          }
          const self = document.querySelector('#rankings-self');
          if (self) self.textContent = 'You: 250 Glyphs · World rank #4 · 12W–6L';
        });
      },
    },
    {
      file: '04-fair-ai-fallback.png',
      title: 'FIND A HUMAN — OR FACE FAIR AI',
      subtitle: 'Keep waiting or accept the closest practice wizard',
      prepare: async (page, context) => {
        await authenticate(page, context);
        await click(page, '[data-action="online-quick-unranked"]', '#panel-online-wait:not(.hidden)');
        await page.waitForSelector('#bot-offer:not(.hidden)', { timeout: 10000 });
      },
    },
    {
      file: '05-authoritative-online-duel.png',
      title: 'SERVER-AUTHORITATIVE WIZARD DUELS',
      subtitle: 'Fast real-time combat, social reactions and fair rules',
      prepare: async (page, context) => {
        await authenticate(page, context);
        await click(page, '[data-action="online-quick-unranked"]', '#panel-online-wait:not(.hidden)');
        await page.waitForSelector('#bot-offer:not(.hidden)', { timeout: 10000 });
        await click(page, '[data-action="bot-offer-accept"]', '#hud:not(.hidden)');
        await page.waitForSelector('#emoji-bar:not(.hidden)', { timeout: 10000 });
        await page.evaluate(() => {
          window.__aegTest?.simulateOnlineEmoji?.({ sender: 1, kind: 'laugh', durationMs: 4000 });
          window.__aegVfx?.productionRelease?.(40);
        });
        await wait(250);
      },
    },
    {
      file: '06-ranked-spectating.png',
      title: 'WATCH LIVE RANKED MATCHES',
      subtitle: 'Browse live duels, then enter a third-person showcase view',
      prepare: async (page, context, layout) => {
        await authenticate(page, context);
        if (layout.key !== 'pc') {
          await page.evaluate(() => {
            document.querySelectorAll('#overlay .panel')
              .forEach((panel) => panel.classList.add('hidden'));
            document.querySelector('#panel-spectate-list')?.classList.remove('hidden');
            document.querySelector('#overlay')?.classList.remove('hidden');
            const status = document.querySelector('#spectate-status');
            const toast = document.querySelector('#toast');
            toast?.classList.remove('show');
            if (toast) toast.textContent = '';
            if (status) status.textContent = 'Choose a live ranked duel to watch.';
            const list = document.querySelector('#spectate-match-list');
            if (list) {
              list.innerHTML = `
                <button class="spectate-match-btn">
                  <strong>AstralMaven vs StormScholar</strong>
                  <span>Live · Round 2 of 3</span>
                  <small>275 Glyphs · 250 Glyphs</small>
                </button>
                <button class="spectate-match-btn">
                  <strong>Runesmith vs MoonSage</strong>
                  <span>Live · Round 1 of 3</span>
                  <small>210 Glyphs · 225 Glyphs</small>
                </button>
                <button class="spectate-match-btn">
                  <strong>EmberArchivist vs TideWarden</strong>
                  <span>Live · Round 3 of 3</span>
                  <small>180 Glyphs · 195 Glyphs</small>
                </button>`;
            }
          });
          await wait(180);
          return;
        }
        await page.evaluate(() => window.__aegTest.simulateSpectateStart({
          matchId: 'store-spectator',
          names: ['AstralMaven', 'StormScholar'],
          glyphs: [275, 250],
          state: {
            tick: 180, timeS: 3, ended: false, pressureLevel: 0,
            projectiles: [], zones: [],
            wizards: [
              {
                id: 0, health: 124, aether: 48, stamina: 72, charges: 1,
                arcPos: 0.68, facing: -0.48, statuses: {}, cooldowns: {}, resonance: [],
                invisibleTicks: 0,
              },
              {
                id: 1, health: 101, aether: 38, stamina: 84, charges: 2,
                arcPos: -0.55, facing: 0.62, statuses: {}, cooldowns: {}, resonance: [],
                invisibleTicks: 0,
              },
            ],
          },
        }));
        await page.evaluate(() => {
          window.__aegVfx?.productionRelease?.(30);
          window.__aegVfx?.wizardEmoji?.('angry');
        });
        await wait(250);
      },
    },
    {
      file: '07-private-room.png',
      title: 'CREATE A PRIVATE ROOM IN SECONDS',
      subtitle: 'Share a code, edit guides and ready up with a friend',
      prepare: async (page, context) => {
        await authenticate(page, context);
        await click(page, '[data-action="online-create"]', '#panel-online-wait:not(.hidden)');
        await page.waitForFunction(() => /^[A-Z0-9]{5}$/.test(
          document.querySelector('#wait-code-value')?.textContent || ''), { timeout: 10000 });
      },
    },
  ],
};

function browserPath() {
  const found = browserCandidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('No Edge or Chrome executable was found.');
  return found;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await wait(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function click(page, selector, waitSelector) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.evaluate((target) => document.querySelector(target)?.click(), selector);
  if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 12000 });
}

async function authenticate(page, context) {
  if (context.authenticated) return;
  await click(page, '[data-action="online"]', '#panel-online:not(.hidden)');
  await page.waitForFunction(() => /Glyphs/.test(
    document.querySelector('#online-glyphs-top')?.textContent || ''), { timeout: 30000 })
    .catch(() => {});
  await wait(350);
  await page.evaluate(() => {
    const toast = document.querySelector('#toast');
    toast?.classList.remove('show');
    if (toast) toast.textContent = '';
  });
  context.authenticated = true;
}

async function drawEmberFlick(page) {
  const pad = await page.$('#draw-canvas');
  const box = await pad.boundingBox();
  if (!box) return;
  const y = box.y + box.height * 0.48;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(box.x + box.width * (0.2 + 0.6 * (step / 10)), y);
  }
  await page.mouse.up();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function decorate(raw, edition, layout, scene, destination) {
  const iconPath = path.join(root, 'assets', 'source',
    edition === 'demo' ? 'demo-icon.png' : 'full-icon.png');
  const compactHeader = layout.key !== 'pc' && scene.title.length > 24;
  const iconSize = Math.round(layout.header * (layout.key === 'pc' ? 0.72 : (compactHeader ? 0.55 : 0.7)));
  const left = Math.round(layout.header * (layout.key === 'pc' ? 0.35 : (compactHeader ? 0.15 : 0.35)));
  const textX = left + iconSize
    + Math.round(layout.header * (layout.key === 'pc' ? 0.32 : (compactHeader ? 0.2 : 0.32)));
  const rightPad = Math.round(layout.header * (layout.key === 'pc' ? 0.35 : (compactHeader ? 0.15 : 0.35)));
  const availableWidth = layout.width - textX - rightPad;
  const baseTitleSize = Math.round(layout.header
    * (layout.key === 'pc' ? 0.29 : (compactHeader ? 0.135 : 0.19)));
  const baseSubtitleSize = Math.round(layout.header * (layout.key === 'pc' ? 0.16 : 0.105));
  const fitText = (text, baseSize, averageWidth, minimumScale) => {
    const estimatedWidth = text.length * baseSize * averageWidth;
    const scale = Math.min(1, availableWidth / Math.max(1, estimatedWidth));
    return Math.round(baseSize * Math.max(minimumScale, scale));
  };
  const titleSize = compactHeader
    ? baseTitleSize
    : fitText(scene.title, baseTitleSize, 0.64, 0.58);
  const subtitleSize = fitText(scene.subtitle, baseSubtitleSize, 0.53, 0.72);
  const headerSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.header}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#09051a"/><stop offset="0.6" stop-color="#170a35"/>
          <stop offset="1" stop-color="#09263c"/>
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="4"/></filter>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <rect y="${layout.header - 5}" width="100%" height="5" fill="#6cddff"/>
      <text x="${textX}" y="${Math.round(layout.header * 0.48)}"
        font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="900"
        letter-spacing="${Math.max(1, Math.round(titleSize * 0.05))}" fill="#ffffff">${escapeXml(scene.title)}</text>
      <text x="${textX}" y="${Math.round(layout.header * 0.72)}"
        font-family="Arial, sans-serif" font-size="${subtitleSize}" font-weight="500"
        fill="#cdbfff">${escapeXml(scene.subtitle)}</text>
    </svg>`);
  const icon = await sharp(iconPath)
    .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const content = await sharp(raw)
    .resize(layout.width, layout.height - layout.header, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();

  await sharp({
    create: { width: layout.width, height: layout.height, channels: 3, background: '#070410' },
  })
    .composite([
      { input: headerSvg, top: 0, left: 0 },
      { input: icon, top: Math.round((layout.header - iconSize) / 2), left },
      { input: content, top: layout.header, left: 0 },
    ])
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
    .toFile(destination);
}

async function captureScene(browser, edition, layout, scene, url) {
  const outputDir = layout.output(edition);
  fs.mkdirSync(outputDir, { recursive: true });
  const destination = path.join(outputDir, scene.file.replace(/\.png$/i, '.jpg'));
  if (process.argv.includes('--resume') && fs.existsSync(destination)) {
    console.log(`  ${edition}/${layout.key}/${scene.file} (kept)`);
    return;
  }
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  if (edition === 'full') {
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('aeth-account-session', JSON.stringify({
        accountId: 'store-capture-wizard',
        name: 'AstralMaven',
        token: '',
      }));
    });
  }
  const scale = layout.captureWidth / layout.width;
  const contentHeight = Math.round((layout.height - layout.header) * scale);
  await page.setViewport({
    width: layout.captureWidth,
    height: contentHeight,
    isMobile: layout.key !== 'pc',
    hasTouch: layout.key !== 'pc',
    deviceScaleFactor: 1,
  });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('pageerror', (error) => console.warn(`[${edition}/${layout.key}/${scene.file}]`, error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!window.__aegTest && !!window.__aegVfx, { timeout: 40000 });
  await scene.prepare(page, context, layout);
  await wait(180);
  const raw = await page.screenshot({ type: 'png' });
  await decorate(raw, edition, layout, scene, destination);
  await context.close();
  console.log(`  ${edition}/${layout.key}/${scene.file}`);
}

async function main() {
  if (process.env.PLAY_ASSET_SKIP_STAGE !== '1') {
    const staged = spawnSync(process.execPath, ['scripts/stage-demo-web.js'], {
      cwd: root, stdio: 'inherit',
    });
    if (staged.status !== 0) throw new Error('Demo staging failed.');
  }

  const { createGameServer } = await import(pathToFileURL(path.join(root, 'server.js')).href);
  const fullServer = createGameServer({
    allowedOrigins: [],
    botOfferWaitMs: 650,
    rankedRangeWaitMs: 250,
    requireAccounts: false,
  });
  await fullServer.listen(fullPort);

  const demoApp = express();
  demoApp.use(express.static(path.join(root, 'www-demo')));
  const demoServer = await new Promise((resolve, reject) => {
    const server = demoApp.listen(demoPort, () => resolve(server));
    server.once('error', reject);
  });

  await Promise.all([
    waitForHttp(`http://127.0.0.1:${fullPort}/healthz`),
    waitForHttp(demoUrl),
  ]);

  const browser = await puppeteer.launch({
    executablePath: browserPath(),
    headless: 'new',
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-sandbox', '--disable-dev-shm-usage',
    ],
  });

  try {
    const editions = ['demo', 'full'].filter((edition) => !editionFilter || edition === editionFilter);
    const selectedLayouts = layouts.filter((layout) => !layoutFilter || layout.key === layoutFilter);
    if (!editions.length) throw new Error(`Unknown edition filter: ${editionFilter}`);
    if (!selectedLayouts.length) throw new Error(`Unknown layout filter: ${layoutFilter}`);
    for (const edition of editions) {
      console.log(`Capturing ${edition} screenshots...`);
      const url = edition === 'demo' ? demoUrl : fullUrl;
      for (const layout of selectedLayouts) {
        const selectedScenes = scenes[edition].filter((scene) =>
          !sceneFilters.size || sceneFilters.has(scene.file.replace(/\.[^.]+$/, '')));
        if (!selectedScenes.length) {
          throw new Error(`Unknown scene filter: ${[...sceneFilters].join(',')}`);
        }
        for (const scene of selectedScenes) {
          await captureScene(browser, edition, layout, scene, url);
        }
      }
    }
  } finally {
    await browser.close();
    await fullServer.close('Play asset capture complete');
    await new Promise((resolve) => demoServer.close(resolve));
  }

  const inventory = {
    generatedAt: new Date().toISOString(),
    editions: {},
  };
  for (const edition of ['demo', 'full']) {
    inventory.editions[edition] = {};
    for (const layout of layouts) {
      const directory = layout.output(edition);
      inventory.editions[edition][layout.key] = fs.existsSync(directory) ? fs.readdirSync(directory)
        .filter((file) => /\.(?:png|jpe?g)$/i.test(file))
        .sort() : [];
    }
  }
  fs.writeFileSync(path.join(playDir, 'screenshot-inventory.json'),
    `${JSON.stringify(inventory, null, 2)}\n`);
  console.log('Generated all full + demo Google Play screenshot sets.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
