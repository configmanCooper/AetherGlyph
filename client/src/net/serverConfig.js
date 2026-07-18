// serverConfig.js — where the online (authoritative) duel service lives.
//
// Same-origin web deployments keep talking to the origin that served the client
// (url === ''). The packaged Capacitor/native build has no local server, so it
// defaults to the authoritative Render service. A player may override the
// service URL (persisted locally) — useful for browser LAN development or a
// self-hosted HTTPS instance. The secure native WebView accepts HTTPS overrides
// only; plain HTTP is limited to localhost/private-LAN browser development.
//
// The pure helpers (validateServerUrl / resolveServerUrl) take an explicit
// context so they can be unit-tested headlessly (see test/serverConfig.test.js);
// the DOM-bound helpers at the bottom read window/localStorage in the browser.

// Default authoritative service for the packaged build. Single Render instance
// (see README "Scaling & limitations"). Same-origin web builds ignore this.
export const PACKAGED_SERVER_URL = 'https://aetherglyph.onrender.com';

export const SERVER_URL_KEY = 'aeth-server-url';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '10.0.2.2']);

// True for hosts where plain-HTTP development is acceptable: loopback + the RFC
// 1918 private-LAN ranges (10/8, 192.168/16, 172.16-31/12). 10.0.2.2 is the
// Android emulator's alias for the host machine.
function isLocalOrLanHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (LOCAL_HOSTS.has(h)) return true;
  if (/^10(?:\.\d{1,3}){3}$/.test(h)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(h)) return true;
  if (/^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(h)) return true;
  return false;
}

// Validate + normalize a user-entered service URL.
// Returns { ok:true, url } (url === '' means "use the default") or
// { ok:false, error } with a human-readable reason.
export function validateServerUrl(raw, opts = {}) {
  const trimmed = String(raw == null ? '' : raw).trim();
  if (!trimmed) return { ok: true, url: '' }; // empty => reset to default

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter a full URL, e.g. https://aetherglyph.onrender.com' };
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'https:' && scheme !== 'http:') {
    return { ok: false, error: 'Only http(s) URLs are allowed.' };
  }
  if (scheme === 'http:' && (!isLocalOrLanHost(parsed.hostname) || opts.allowLocalHttp === false)) {
    return {
      ok: false,
      error: opts.allowLocalHttp === false
        ? 'The Android app requires an HTTPS online service. Use browser mode for HTTP LAN testing.'
        : 'Insecure http:// is only allowed for localhost/LAN browser development. Use https://.',
    };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Credentials are not allowed in the service URL.' };
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    return { ok: false, error: 'Enter the origin only (scheme://host[:port]) with no path.' };
  }
  // Normalize to a bare origin (Socket.IO connects to the origin).
  return { ok: true, url: parsed.origin };
}

// Resolve the effective service URL from an explicit context. Returns '' for
// "same origin". Precedence: a valid persisted override > native default > ''.
//   ctx.native   — running inside the Capacitor native shell
//   ctx.origin   — location.origin (the origin that served the client)
//   ctx.override — the persisted user override (may be null/'')
export function resolveServerUrl(ctx = {}) {
  const override = validateServerUrl(ctx.override, { allowLocalHttp: !ctx.native });
  if (override.ok && override.url) return override.url;
  if (ctx.native) return PACKAGED_SERVER_URL;
  return '';
}

// --- DOM-bound helpers (browser only) --------------------------------------

function hasWindow() {
  return typeof window !== 'undefined';
}

// True when running inside the Capacitor native shell (Android app). In a plain
// browser window.Capacitor is undefined, so this is false and the app stays
// same-origin.
export function isNativeApp() {
  if (!hasWindow()) return false;
  const cap = window.Capacitor;
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

export function currentOrigin() {
  if (!hasWindow() || !window.location) return '';
  return window.location.origin;
}

export function getStoredServerUrl() {
  if (!hasWindow()) return '';
  try {
    return window.localStorage.getItem(SERVER_URL_KEY) || '';
  } catch {
    return '';
  }
}

// Persist a validated override. Returns the same shape as validateServerUrl.
// An empty/blank value clears the override (reset to default).
export function setStoredServerUrl(raw) {
  const result = validateServerUrl(raw, { allowLocalHttp: !isNativeApp() });
  if (!result.ok) return result;
  try {
    if (result.url) window.localStorage.setItem(SERVER_URL_KEY, result.url);
    else window.localStorage.removeItem(SERVER_URL_KEY);
  } catch {
    return { ok: false, error: 'Could not save the setting on this device.' };
  }
  return result;
}

export function clearStoredServerUrl() {
  try {
    if (hasWindow()) window.localStorage.removeItem(SERVER_URL_KEY);
  } catch { /* ignore */ }
}

// The URL the OnlineMatch adapter should connect to ('' === same origin).
export function effectiveServerUrl() {
  return resolveServerUrl({
    native: isNativeApp(),
    origin: currentOrigin(),
    override: getStoredServerUrl(),
  });
}

// A friendly label for the Settings screen showing where online play connects.
export function describeServerTarget() {
  const override = getStoredServerUrl();
  const effective = effectiveServerUrl();
  if (override) return `Custom: ${effective}`;
  if (effective) return `Default: ${effective}`;
  return 'Same origin (this web deployment)';
}
