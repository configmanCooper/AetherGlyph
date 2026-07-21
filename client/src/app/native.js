// native.js — thin, dependency-free bridge to the Capacitor native shell.
//
// The client is a no-build ES-module app, so instead of importing the Capacitor
// plugin packages we talk to the runtime bridge Capacitor injects on native
// (window.Capacitor.Plugins.*). Every function here is a safe no-op in a plain
// browser (window.Capacitor is undefined), so nothing changes for the web build.
//
// Plugins used (declared in package.json / synced into android/): @capacitor/app,
// @capacitor/haptics, and @capacitor/screen-orientation.

function bridge() {
  return (typeof window !== 'undefined' && window.Capacitor) || null;
}

// Resolve a native plugin proxy. Capacitor only populates Capacitor.Plugins[name]
// once registerPlugin(name) has been called (normally by the plugin's JS
// wrapper, which a no-build app does not import). The native bridge exposes
// Capacitor.registerPlugin, so we register the proxy ourselves — it routes calls
// to the native @capacitor/app / @capacitor/haptics plugins. On the web
// window.Capacitor is undefined, so this returns null and every call no-ops.
const pluginCache = {};
function plugin(name) {
  const cap = bridge();
  if (!cap) return null;
  if (pluginCache[name]) return pluginCache[name];
  if (cap.Plugins && cap.Plugins[name]) { pluginCache[name] = cap.Plugins[name]; return pluginCache[name]; }
  if (typeof cap.registerPlugin === 'function') {
    try { pluginCache[name] = cap.registerPlugin(name); return pluginCache[name]; } catch { return null; }
  }
  return null;
}

// True only inside the Capacitor native shell (Android app).
export const isNativeApp = (() => {
  const cap = bridge();
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
})();

// Register a hardware/gesture back-button handler. Returns a disposer. On the
// web this is a no-op (returns a no-op disposer) so browser history is untouched.
export function onBackButton(handler) {
  const App = plugin('App');
  if (!App || typeof App.addListener !== 'function') return () => {};
  let handle = null;
  try {
    handle = App.addListener('backButton', handler);
  } catch { /* ignore */ }
  return () => {
    try {
      if (handle && typeof handle.remove === 'function') handle.remove();
      else if (handle && typeof handle.then === 'function') handle.then((h) => h && h.remove && h.remove());
    } catch { /* ignore */ }
  };
}

// Register an active/background lifecycle handler: cb(isActive:boolean).
export function onAppStateChange(handler) {
  const App = plugin('App');
  if (!App || typeof App.addListener !== 'function') return () => {};
  let handle = null;
  try {
    handle = App.addListener('appStateChange', (state) => handler(!!(state && state.isActive)));
  } catch { /* ignore */ }
  return () => {
    try {
      if (handle && typeof handle.remove === 'function') handle.remove();
      else if (handle && typeof handle.then === 'function') handle.then((h) => h && h.remove && h.remove());
    } catch { /* ignore */ }
  };
}

// Exit the app (native only). No-op on the web.
export function exitApp() {
  const App = plugin('App');
  if (App && typeof App.exitApp === 'function') {
    try { App.exitApp(); } catch { /* ignore */ }
  }
}

// Fire a native haptic impact ('LIGHT' | 'MEDIUM' | 'HEAVY'). Falls back to the
// Web Vibration API when the native Haptics plugin is unavailable.
export function nativeImpact(style = 'LIGHT') {
  const Haptics = plugin('Haptics');
  if (Haptics && typeof Haptics.impact === 'function') {
    try { Haptics.impact({ style }); return true; } catch { /* fall through */ }
  }
  return false;
}

export async function setNativeOrientation(mode = 'auto') {
  const ScreenOrientation = plugin('ScreenOrientation');
  if (!ScreenOrientation) return false;
  try {
    if (mode === 'auto') {
      if (typeof ScreenOrientation.unlock !== 'function') return false;
      await ScreenOrientation.unlock();
    } else {
      if (typeof ScreenOrientation.lock !== 'function') return false;
      await ScreenOrientation.lock({ orientation: mode });
    }
    return true;
  } catch {
    return false;
  }
}
