'use strict';

// Generates app icons and static Google Play artwork from the user-supplied
// Aetherglyph source art in assets/source/.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'assets', 'source');
const assetsDir = path.join(root, 'assets');
const playDir = path.join(root, 'play-assets');
const webIconsDir = path.join(root, 'client', 'icons');
const demoWebIconsDir = path.join(playDir, 'demo', 'web-icons');
const demoAndroidRes = path.join(root, 'android', 'app', 'src', 'demo', 'res');

const sources = {
  fullIcon: path.join(sourceDir, 'full-icon.png'),
  fullBanner: path.join(sourceDir, 'full-banner.png'),
  demoIcon: path.join(sourceDir, 'demo-icon.png'),
  demoFeature: path.join(sourceDir, 'demo-feature.png'),
};

const BG = { r: 6, g: 4, b: 18, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const DENSITIES = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

function ensureSources() {
  const missing = Object.values(sources).filter((file) => !fs.existsSync(file));
  if (missing.length) {
    throw new Error(`Missing supplied source art:\n${missing.map((file) => `  - ${file}`).join('\n')}`);
  }
}

function mkdir(...directories) {
  for (const directory of directories) fs.mkdirSync(directory, { recursive: true });
}

async function squareIcon(input, size, { background = BG, inset = 0 } = {}) {
  const inner = Math.max(1, Math.round(size * (1 - inset * 2)));
  const image = await sharp(input)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: image, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function transparentForeground(input, size, fraction = 0.76) {
  const inner = Math.round(size * fraction);
  const image = await sharp(input)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
    .composite([{ input: image, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function write(buffer, file) {
  mkdir(path.dirname(file));
  await sharp(buffer).png().toFile(file);
}

function logoSvg({ demo = false } = {}) {
  const badge = demo
    ? `<rect x="210" y="280" width="180" height="54" rx="10" fill="#c5162e"/>
       <text x="300" y="319" text-anchor="middle" font-family="Arial, sans-serif"
         font-size="34" font-weight="900" fill="#fff">DEMO</text>`
    : '';
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
      <defs>
        <linearGradient id="word" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#ffffff"/><stop offset="0.55" stop-color="#e4d5ff"/>
          <stop offset="1" stop-color="#9b75ff"/>
        </linearGradient>
      </defs>
      <g>
        <text x="300" y="190" text-anchor="middle" font-family="Arial, sans-serif"
          font-size="52" font-weight="900" letter-spacing="1" fill="url(#word)"
          stroke="#4d2d94" stroke-width="2">AETHERGLYPH</text>
        <text x="300" y="244" text-anchor="middle" font-family="Arial, sans-serif"
          font-size="29" font-weight="700" letter-spacing="8" fill="#efe8ff">ARCANE DUELS</text>
      </g>
      ${badge}
    </svg>`);
}

async function createPcFeature(input, output, crop) {
  await sharp(input)
    .extract(crop)
    .resize(1920, 1080, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .modulate({ saturation: 1.08, brightness: 0.92 })
    .sharpen({ sigma: 0.7 })
    .flatten({ background: BG })
    .png({ compressionLevel: 9 })
    .toFile(output);
}

async function createStoreEditionArt(edition, iconInput, featureInput) {
  const editionDir = path.join(playDir, edition);
  const pcDir = path.join(editionDir, 'google-play-games-pc');
  mkdir(editionDir, pcDir, path.join(editionDir, 'phone'),
    path.join(editionDir, 'tablet-7'), path.join(editionDir, 'tablet-10'),
    path.join(pcDir, 'screenshots'));

  await sharp(iconInput)
    .resize(512, 512, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(editionDir, 'app-icon-512.png'));

  await sharp(featureInput)
    .resize(1024, 500, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .flatten({ background: BG })
    .png({ compressionLevel: 9 })
    .toFile(path.join(editionDir, 'feature-graphic-1024x500.png'));

  await sharp(logoSvg({ demo: edition === 'demo' }))
    .png({ compressionLevel: 9 })
    .toFile(path.join(pcDir, 'logo-600x400.png'));
}

async function createDemoAndroidIcons() {
  for (const [density, size] of Object.entries(DENSITIES)) {
    const directory = path.join(demoAndroidRes, `mipmap-${density}`);
    mkdir(directory);
    const legacy = await squareIcon(sources.demoIcon, size, { background: BG });
    const foreground = await transparentForeground(sources.demoIcon, size, 0.62);
    const background = await sharp({
      create: { width: size, height: size, channels: 4, background: BG },
    }).png().toBuffer();
    await write(legacy, path.join(directory, 'ic_launcher.png'));
    await write(legacy, path.join(directory, 'ic_launcher_round.png'));
    await write(foreground, path.join(directory, 'ic_launcher_foreground.png'));
    await write(background, path.join(directory, 'ic_launcher_background.png'));
  }

  const adaptiveDirectory = path.join(demoAndroidRes, 'mipmap-anydpi-v26');
  mkdir(adaptiveDirectory);
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@mipmap/ic_launcher_background" />
  <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
  fs.writeFileSync(path.join(adaptiveDirectory, 'ic_launcher.xml'), adaptive);
  fs.writeFileSync(path.join(adaptiveDirectory, 'ic_launcher_round.xml'), adaptive);
}

async function main() {
  ensureSources();
  mkdir(assetsDir, playDir, webIconsDir, demoWebIconsDir);

  // Full-edition Android adaptive icon and splash sources.
  await sharp(sources.fullIcon).resize(1024, 1024, { fit: 'cover' })
    .png().toFile(path.join(assetsDir, 'icon-only.png'));
  await write(await transparentForeground(sources.fullIcon, 1024, 0.62),
    path.join(assetsDir, 'icon-foreground.png'));
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } })
    .png().toFile(path.join(assetsDir, 'icon-background.png'));

  const splashLogo = await squareIcon(sources.fullIcon, 900, { background: TRANSPARENT, inset: 0.04 });
  for (const name of ['splash.png', 'splash-dark.png']) {
    await sharp({ create: { width: 2732, height: 2732, channels: 4, background: BG } })
      .composite([{ input: splashLogo, gravity: 'centre' }])
      .png().toFile(path.join(assetsDir, name));
  }

  // Full PWA and Windows/Steam source icons.
  for (const size of [192, 512]) {
    await write(await squareIcon(sources.fullIcon, size, { background: BG }),
      path.join(webIconsDir, `icon-${size}.png`));
  }
  await write(await squareIcon(sources.fullIcon, 512, { background: BG, inset: 0.12 }),
    path.join(webIconsDir, 'maskable-512.png'));

  // Demo web icons are copied into the staged demo by stage-demo-web.js.
  for (const size of [192, 512]) {
    await write(await squareIcon(sources.demoIcon, size, { background: BG }),
      path.join(demoWebIconsDir, `icon-${size}.png`));
  }
  await write(await squareIcon(sources.demoIcon, 512, { background: BG, inset: 0.12 }),
    path.join(demoWebIconsDir, 'maskable-512.png'));

  await createStoreEditionArt('full', sources.fullIcon, sources.fullBanner);
  await createStoreEditionArt('demo', sources.demoIcon, sources.demoFeature);

  // Text-free 16:9 art for Google Play Games on PC cards.
  await createPcFeature(
    sources.fullBanner,
    path.join(playDir, 'full', 'google-play-games-pc', 'feature-graphic-1920x1080.png'),
    { left: 950, top: 175, width: 844, height: 475 },
  );
  await createPcFeature(
    sources.fullBanner,
    path.join(playDir, 'demo', 'google-play-games-pc', 'feature-graphic-1920x1080.png'),
    { left: 950, top: 175, width: 844, height: 475 },
  );

  await createDemoAndroidIcons();

  console.log('Generated supplied-art icons and static Google Play graphics for full + demo editions.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
