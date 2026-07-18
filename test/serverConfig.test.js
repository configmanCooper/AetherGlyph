// serverConfig.test.js — the packaged/same-origin service URL resolution and the
// override validation (HTTPS always; HTTP LAN only in browser development).
// Pure functions, no DOM (see client/src/net/serverConfig.js).

import { createHarness } from './tiny.js';
import {
  PACKAGED_SERVER_URL, validateServerUrl, resolveServerUrl,
} from '../client/src/net/serverConfig.js';

export function run() {
  const { ok, eq, report } = createHarness();

  // --- validateServerUrl -------------------------------------------------
  eq(validateServerUrl('').ok, true, 'empty is valid (means: use default)');
  eq(validateServerUrl('').url, '', 'empty normalizes to same-origin/default');
  eq(validateServerUrl('   ').url, '', 'blank normalizes to empty');

  const https = validateServerUrl('https://aetherglyph.onrender.com');
  eq(https.ok, true, 'https accepted');
  eq(https.url, 'https://aetherglyph.onrender.com', 'https normalized to origin');

  eq(validateServerUrl('https://example.com/').url, 'https://example.com', 'trailing slash trimmed to origin');
  eq(validateServerUrl('https://example.com:8443').url, 'https://example.com:8443', 'explicit https port kept');

  // Plain HTTP only for localhost / private-LAN development.
  eq(validateServerUrl('http://localhost:8130').ok, true, 'http localhost allowed');
  eq(validateServerUrl('http://127.0.0.1:8130').ok, true, 'http loopback allowed');
  eq(validateServerUrl('http://10.0.2.2:8130').ok, true, 'http emulator-host allowed');
  eq(validateServerUrl('http://192.168.1.20:8130').ok, true, 'http private LAN 192.168 allowed');
  eq(validateServerUrl('http://10.1.2.3:8130').ok, true, 'http private LAN 10/8 allowed');
  eq(validateServerUrl('http://172.16.5.5:8130').ok, true, 'http private LAN 172.16/12 allowed');
  eq(
    validateServerUrl('http://192.168.1.20:8130', { allowLocalHttp: false }).ok,
    false,
    'native policy rejects an otherwise-local HTTP service',
  );

  eq(validateServerUrl('http://aetherglyph.onrender.com').ok, false, 'http to a public host rejected');
  eq(validateServerUrl('http://8.8.8.8').ok, false, 'http to a public IP rejected');
  eq(validateServerUrl('http://172.32.0.1').ok, false, 'http to 172.32 (outside private range) rejected');

  // Scheme / shape rules.
  eq(validateServerUrl('ftp://host').ok, false, 'non-http scheme rejected');
  eq(validateServerUrl('ws://localhost').ok, false, 'ws scheme rejected');
  eq(validateServerUrl('not a url').ok, false, 'garbage rejected');
  eq(validateServerUrl('https://user:pass@host.com').ok, false, 'credentials rejected');
  eq(validateServerUrl('https://host.com/path').ok, false, 'non-root path rejected');
  eq(validateServerUrl('https://host.com/?q=1').ok, false, 'query string rejected');

  // --- resolveServerUrl (packaged vs same-origin web) --------------------
  eq(
    resolveServerUrl({ native: true, origin: 'https://localhost', override: '' }),
    PACKAGED_SERVER_URL,
    'native default connects to the packaged Render service',
  );
  eq(
    resolveServerUrl({ native: false, origin: 'https://aetherglyph.onrender.com', override: '' }),
    '',
    'same-origin web build stays same-origin',
  );
  eq(
    resolveServerUrl({ native: true, origin: 'https://localhost', override: 'https://my.example.com' }),
    'https://my.example.com',
    'a valid override wins over the native default',
  );
  eq(
    resolveServerUrl({ native: false, origin: 'https://web.example', override: 'http://192.168.0.5:8130' }),
    'http://192.168.0.5:8130',
    'a valid LAN override wins on web too',
  );
  eq(
    resolveServerUrl({ native: true, origin: 'https://localhost', override: 'http://evil.example.com' }),
    PACKAGED_SERVER_URL,
    'an invalid (insecure) override is ignored -> native default',
  );
  eq(
    resolveServerUrl({ native: true, origin: 'https://localhost', override: 'http://192.168.0.5:8130' }),
    PACKAGED_SERVER_URL,
    'native build ignores HTTP LAN override because the WebView requires HTTPS',
  );
  ok(PACKAGED_SERVER_URL === 'https://aetherglyph.onrender.com', 'packaged default is the Render https origin');

  return report('serverConfig');
}
