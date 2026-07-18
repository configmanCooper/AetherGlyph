'use strict';

// gen-assets.cjs — deterministic source art for the Android app icon (adaptive),
// splash, Play Store icon (512), feature graphic (1024x500), and the PWA icons
// used by the web manifest. Uses sharp (a dev dependency). After this runs,
// `capacitor-assets generate --android` turns the assets/ sources into the
// Android mipmaps/adaptive/splash resources (see the `android:assets` script).
//
// Palette matches the client (client/styles/style.css): bg #0a0713, violet
// accent #8b6bff, teal accent #4fd6c9, ink #ece7f6.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');
const play = path.join(root, 'play-assets');
const webIcons = path.join(root, 'client', 'icons');
for (const dir of [assets, play, webIcons]) fs.mkdirSync(dir, { recursive: true });

const BG = '#0a0713';
const VIOLET = '#8b6bff';
const TEAL = '#4fd6c9';
const INK = '#ece7f6';

// A stylized arcane sigil: concentric rings + an angular drawn-glyph rune,
// echoing the game's "draw a glyph to cast" identity. `scale` shrinks the glyph
// for adaptive-icon safe zones. `withBackground` bakes the dark background.
function sigilSvg(size, { withBackground = true, scale = 1 } = {}) {
  const c = size / 2;
  const r = size * 0.34 * scale;
  const sw = size * 0.03 * scale;
  // Glyph geometry (fractions of size), centered.
  const f = (n) => (size * n).toFixed(2);
  const bg = withBackground
    ? `<defs><radialGradient id="g" cx="50%" cy="38%" r="75%">
         <stop offset="0" stop-color="#211036"/><stop offset="1" stop-color="${BG}"/>
       </radialGradient></defs>
       <rect width="${size}" height="${size}" rx="${size * 0.16}" fill="url(#g)"/>`
    : '';
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${bg}
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="${c}" cy="${c}" r="${r}" stroke="${VIOLET}" stroke-width="${sw}" opacity="0.95"/>
        <circle cx="${c}" cy="${c}" r="${r * 0.78}" stroke="${TEAL}" stroke-width="${sw * 0.28}" opacity="0.55"/>
        <path d="M ${f(0.5)} ${f(0.26)} L ${f(0.5)} ${f(0.74)}" stroke="${INK}" stroke-width="${size * 0.032 * scale}"/>
        <path d="M ${f(0.35)} ${f(0.44)} L ${f(0.5)} ${f(0.29)} L ${f(0.65)} ${f(0.44)}" stroke="${VIOLET}" stroke-width="${size * 0.05 * scale}"/>
        <path d="M ${f(0.37)} ${f(0.61)} L ${f(0.5)} ${f(0.71)} L ${f(0.63)} ${f(0.61)}" stroke="${TEAL}" stroke-width="${size * 0.042 * scale}"/>
        <circle cx="${f(0.5)}" cy="${f(0.5)}" r="${size * 0.03 * scale}" fill="${TEAL}" stroke="none"/>
        <circle cx="${f(0.5)}" cy="${f(0.29)}" r="${size * 0.022 * scale}" fill="${VIOLET}" stroke="none"/>
        <circle cx="${f(0.5)}" cy="${f(0.71)}" r="${size * 0.022 * scale}" fill="${TEAL}" stroke="none"/>
      </g>
    </svg>`);
}

async function png(svg, file) {
  await sharp(svg).png().toFile(file);
}

(async () => {
  // --- Android adaptive-icon sources (consumed by capacitor-assets) ---------
  await png(sigilSvg(1024, { withBackground: true }), path.join(assets, 'icon-only.png'));
  // Foreground: transparent, glyph inside the adaptive safe zone.
  await png(sigilSvg(1024, { withBackground: false, scale: 0.82 }), path.join(assets, 'icon-foreground.png'));
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } })
    .png().toFile(path.join(assets, 'icon-background.png'));

  // --- Splash (light + dark are identical on our dark theme) ----------------
  const splashLogo = await sharp(sigilSvg(1024, { withBackground: false })).resize(880, 880).png().toBuffer();
  for (const name of ['splash.png', 'splash-dark.png']) {
    await sharp({ create: { width: 2732, height: 2732, channels: 4, background: BG } })
      .composite([{ input: splashLogo, gravity: 'centre' }])
      .png().toFile(path.join(assets, name));
  }

  // --- Play Store icon (512) + feature graphic (1024x500) -------------------
  await png(sigilSvg(512, { withBackground: true }), path.join(play, 'icon-512.png'));
  const featureSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#1a0f2e"/><stop offset="1" stop-color="${BG}"/>
      </linearGradient></defs>
      <rect width="1024" height="500" fill="url(#bg)"/>
      <text x="384" y="228" font-family="Arial, sans-serif" font-size="76" font-weight="900" fill="${INK}">Aetherglyph</text>
      <text x="386" y="292" font-family="Arial, sans-serif" font-size="34" fill="${VIOLET}">Arcane Duels — draw glyphs, cast spells</text>
    </svg>`);
  const featureLogo = await sharp(sigilSvg(512, { withBackground: false })).resize(300, 300).png().toBuffer();
  await sharp(featureSvg).composite([{ input: featureLogo, left: 56, top: 100 }]).png().toFile(path.join(play, 'feature-graphic.png'));

  // --- PWA / web-manifest icons --------------------------------------------
  await png(sigilSvg(192, { withBackground: true }), path.join(webIcons, 'icon-192.png'));
  await png(sigilSvg(512, { withBackground: true }), path.join(webIcons, 'icon-512.png'));
  // Maskable: content well inside the safe circle, full-bleed background.
  const maskFg = await sharp(sigilSvg(512, { withBackground: false, scale: 0.72 })).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
    .composite([{ input: maskFg, gravity: 'centre' }])
    .png().toFile(path.join(webIcons, 'maskable-512.png'));

  console.log('Generated Android, Play Store, and PWA art (assets/, play-assets/, client/icons/).');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
