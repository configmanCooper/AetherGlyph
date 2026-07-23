import {
  existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { createHarness } from './tiny.js';
import { DEMO_WWW, stageDemoWeb } from '../scripts/stage-demo-web.js';
import { ROOT } from '../scripts/stage-web.js';

const { ok, eq, report } = createHarness();
const message =
  'Thanks for playing the demo! For online functionality, please purchase the full version of Aetherglyph: Arcane Duels';

stageDemoWeb();

const read = (rel) => readFileSync(join(DEMO_WWW, rel), 'utf8');
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
}
walk(DEMO_WWW);

const executableText = files
  .filter((path) => /\.(?:js|html|json)$/i.test(path))
  .map((path) => `${relative(DEMO_WWW, path)}\n${readFileSync(path, 'utf8')}`)
  .join('\n');

ok(read('client/src/app/edition.js').includes('DEMO_BUILD = true'),
  'demo bundle enables the demo edition flag');
ok(read('client/src/app/edition.js').includes(message),
  'demo bundle contains the exact online purchase message');
ok(read('client/src/net/onlineMatch.js').includes('unavailable in the Aetherglyph demo'),
  'demo OnlineMatch is an inert local stub');
eq(read('client/src/net/serverConfig.js').includes('http'), false,
  'demo server configuration contains no network URL');
ok(!existsSync(join(DEMO_WWW, 'client/vendor/socket.io.esm.min.js')),
  'demo bundle omits the Socket.IO client');
ok(!existsSync(join(DEMO_WWW, 'client/sw.js')),
  'demo bundle omits the production service worker');
ok(!existsSync(join(DEMO_WWW, 'MASTERPLAN.md')),
  'demo bundle omits non-game project documentation');
ok(!/aetherglyph\.onrender\.com/i.test(executableText),
  'demo executable bundle contains no production server hostname');
ok(!/socket\.io-client|socket\.io\.esm|openSocket\s*\(/i.test(executableText),
  'demo executable bundle contains no socket connection implementation');

const manifest = readFileSync(
  join(ROOT, 'android/app/src/demo/AndroidManifest.xml'), 'utf8',
);
ok(/android\.permission\.INTERNET[\s\S]*tools:node="remove"/.test(manifest),
  'demo Android manifest removes Internet permission');
ok(/android\.permission\.ACCESS_NETWORK_STATE[\s\S]*tools:node="remove"/.test(manifest),
  'demo Android manifest removes network-state permission');

const gradle = readFileSync(join(ROOT, 'android/app/build.gradle'), 'utf8');
ok(/demo\s*\{[\s\S]*applicationIdSuffix\s+"\.demo"/.test(gradle),
  'demo build type uses a separate application ID');
ok(/demoRelease/.test(gradle), 'demo build type has dedicated upload signing');

report('demoPackaging');
