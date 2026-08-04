'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const playDir = path.join(root, 'play-assets');
const editions = ['demo', 'full'];
const errors = [];
const inventory = { generatedAt: new Date().toISOString(), editions: {} };

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((file) => /\.(?:png|jpe?g)$/i.test(file))
    .sort();
}

async function inspect(relativePath) {
  const fullPath = path.join(playDir, relativePath);
  assert(fs.existsSync(fullPath), `Missing ${relativePath}`);
  if (!fs.existsSync(fullPath)) return null;
  const metadata = await sharp(fullPath).metadata();
  return {
    file: relativePath.replace(/\\/g, '/'),
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    hasAlpha: !!metadata.hasAlpha,
    bytes: fs.statSync(fullPath).size,
  };
}

function exactRatio(item, numerator, denominator) {
  return item.width * denominator === item.height * numerator;
}

async function validateScreenshotSet(edition, key, expectedWidth, expectedHeight, maxMb) {
  const directory = key === 'pc'
    ? path.join(edition, 'google-play-games-pc', 'screenshots')
    : path.join(edition, key);
  const names = files(path.join(playDir, directory));
  assert(names.length >= 4 && names.length <= 8,
    `${edition}/${key} must contain 4-8 screenshots; found ${names.length}`);
  const items = [];
  for (const name of names) {
    const item = await inspect(path.join(directory, name));
    if (!item) continue;
    assert(item.width === expectedWidth && item.height === expectedHeight,
      `${item.file} must be ${expectedWidth}x${expectedHeight}; got ${item.width}x${item.height}`);
    assert(exactRatio(item, 9, 16) || exactRatio(item, 16, 9),
      `${item.file} must be exactly 9:16 or 16:9`);
    assert(item.bytes <= maxMb * 1024 * 1024,
      `${item.file} exceeds ${maxMb} MB`);
    assert(item.format === 'jpeg' || item.format === 'png',
      `${item.file} must be PNG or JPEG`);
    items.push(item);
  }
  return items;
}

async function main() {
  for (const edition of editions) {
    const editionInventory = {};
    const icon = await inspect(path.join(edition, 'app-icon-512.png'));
    const feature = await inspect(path.join(edition, 'feature-graphic-1024x500.png'));
    const pcLogo = await inspect(path.join(edition, 'google-play-games-pc', 'logo-600x400.png'));
    const pcFeature = await inspect(path.join(
      edition, 'google-play-games-pc', 'feature-graphic-1920x1080.png'));

    if (icon) {
      assert(icon.width === 512 && icon.height === 512, `${edition} icon must be 512x512`);
      assert(icon.format === 'png', `${edition} icon must be PNG`);
      assert(icon.bytes <= 1024 * 1024, `${edition} icon exceeds 1 MB`);
    }
    if (feature) {
      assert(feature.width === 1024 && feature.height === 500,
        `${edition} feature graphic must be 1024x500`);
      assert(feature.bytes <= 15 * 1024 * 1024, `${edition} feature graphic exceeds 15 MB`);
      assert(!feature.hasAlpha, `${edition} feature graphic should be opaque`);
    }
    if (pcLogo) {
      assert(pcLogo.width === 600 && pcLogo.height === 400,
        `${edition} PC logo must be 600x400`);
      assert(pcLogo.format === 'png', `${edition} PC logo must be PNG`);
      assert(pcLogo.hasAlpha, `${edition} PC logo must have transparency`);
      assert(pcLogo.bytes <= 8 * 1024 * 1024, `${edition} PC logo exceeds 8 MB`);
    }
    if (pcFeature) {
      assert(pcFeature.width === 1920 && pcFeature.height === 1080,
        `${edition} PC feature graphic must be 1920x1080`);
      assert(exactRatio(pcFeature, 16, 9), `${edition} PC feature graphic must be 16:9`);
      assert(!pcFeature.hasAlpha, `${edition} PC feature graphic should be opaque`);
      assert(pcFeature.bytes <= 15 * 1024 * 1024,
        `${edition} PC feature graphic exceeds 15 MB`);
    }

    editionInventory.static = [icon, feature, pcLogo, pcFeature].filter(Boolean);
    editionInventory.phone = await validateScreenshotSet(edition, 'phone', 1080, 1920, 8);
    editionInventory.tablet7 = await validateScreenshotSet(
      edition, 'tablet-7', 1440, 2560, 8);
    editionInventory.tablet10 = await validateScreenshotSet(
      edition, 'tablet-10', 1620, 2880, 8);
    editionInventory.pc = await validateScreenshotSet(edition, 'pc', 1920, 1080, 15);
    inventory.editions[edition] = editionInventory;
  }

  fs.writeFileSync(path.join(playDir, 'asset-inventory.json'),
    `${JSON.stringify(inventory, null, 2)}\n`);

  if (errors.length) {
    console.error(`Play asset validation failed (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const total = editions.reduce((sum, edition) => {
    const sets = inventory.editions[edition];
    return sum + sets.static.length + sets.phone.length + sets.tablet7.length
      + sets.tablet10.length + sets.pc.length;
  }, 0);
  console.log(`Play asset validation: PASS (${total} files)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
