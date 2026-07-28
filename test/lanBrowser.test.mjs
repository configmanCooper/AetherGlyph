import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = 8140;
const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  process.env.CHROME_PATH,
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!edge) {
  console.error('No Edge/Chrome found; skipping LAN browser test.');
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

async function effectiveUrl(page) {
  return page.evaluate(async () => {
    const config = await import('./src/net/serverConfig.js');
    return config.effectiveServerUrl();
  });
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
    window.AetherglyphDesktop = {
      packaged: true,
      getLanServerInfo: async () => ({
        available: true,
        port: 8131,
        addresses: ['192.168.1.50'],
        urls: ['http://192.168.1.50:8131'],
        loopbackUrl: 'http://127.0.0.1:8131',
      }),
    };
  });
  await page.goto(`http://127.0.0.1:${PORT}/client/index.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForFunction(() => !!window.__aegTest);
  await page.evaluate(async (port) => {
    const config = await import('./src/net/serverConfig.js');
    config.setStoredServerUrl(`http://127.0.0.1:${port}`);
  }, PORT);
  assert(await effectiveUrl(page) === `http://127.0.0.1:${PORT}`,
    'LAN test could not select its local account server.');

  await page.click('[data-action="online"]');
  await page.waitForSelector('#panel-online-account:not(.hidden)');
  await page.type('#account-username', 'LanWizard');
  await page.type('#account-pin', '123456');
  await page.type('#account-pin-confirm', '123456');
  await page.click('[data-action="account-submit"]');
  await page.waitForFunction(() =>
    !document.querySelector('#panel-online')?.classList.contains('hidden')
    || (!!document.querySelector('#account-error')?.textContent
      && !/Checking wizard name/i.test(document.querySelector('#account-error').textContent)));
  const accountState = await page.evaluate(() => ({
    online: !document.querySelector('#panel-online')?.classList.contains('hidden'),
    error: document.querySelector('#account-error')?.textContent || '',
  }));
  assert(accountState.online, `LAN test account setup failed: ${accountState.error}`);
  await page.click('[data-action="lan-duel"]');
  await page.waitForSelector('#panel-lan-duel:not(.hidden)');
  await page.waitForSelector('#lan-host-info:not(.hidden)');
  const hostText = await page.$eval('#lan-host-status', (element) => element.textContent);
  assert(hostText.includes('192.168.1.50:8131'), `Missing host address: ${hostText}`);

  await page.click('[data-action="lan-use-host"]');
  await page.waitForSelector('#panel-online:not(.hidden)');
  assert(await effectiveUrl(page) === 'http://127.0.0.1:8131',
    'Using this device did not select the loopback LAN server.');

  await page.click('[data-action="lan-duel"]');
  await page.waitForSelector('#panel-lan-duel:not(.hidden)');
  await page.type('#lan-server-address', '192.168.1.60');
  await page.click('[data-action="lan-connect"]');
  await page.waitForSelector('#panel-online:not(.hidden)');
  assert(await effectiveUrl(page) === 'http://192.168.1.60:8131',
    'Manual LAN host did not normalize to port 8131.');

  await page.click('[data-action="lan-duel"]');
  await page.waitForSelector('#panel-lan-duel:not(.hidden)');
  await page.click('[data-action="lan-internet"]');
  await page.waitForSelector('#panel-online:not(.hidden)');
  assert(await effectiveUrl(page) === 'https://aetherglyph-server.onrender.com',
    'Internet server reset did not restore the dedicated Render service.');

  console.log('lanBrowser: PASS');
} finally {
  if (browser) await browser.close();
  server.kill();
}
