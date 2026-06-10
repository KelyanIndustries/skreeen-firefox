/* Skreeen — service worker.
 * Orchestrates: theme strategy detection → (debugger attach) → zone selection
 * → light capture → dark capture → restore page → crop → results tab.
 */

const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const CAPTURE_GAP_MS = 600; // captureVisibleTab is rate-limited (~2/s)

const DEFAULT_SETTINGS = {
  strategy: 'auto', // auto | media | class | both
  settleMs: 700, // wait after switching theme (transitions, repaints)
};

const RESTRICTED_URL = /^(chrome|chrome-extension|moz-extension|firefox|edge|about|devtools|view-source):|^https:\/\/chrome\.google\.com\/webstore|^https:\/\/chromewebstore\.google\.com|^https:\/\/addons\.mozilla\.org/;

// chrome.debugger is Chrome-only; Firefox lacks CDP access from extensions.
const HAS_DEBUGGER = typeof chrome?.debugger?.attach === 'function';

let busy = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'skreeen:capture') {
    startCapture(msg.mode, msg.tab).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String(err?.message || err) })
    );
    return true; // async response
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab) return;
  if (command === 'capture-area') startCapture('area', tab).catch(reportError);
  if (command === 'capture-full') startCapture('full', tab).catch(reportError);
});

async function startCapture(mode, tab) {
  if (busy) throw new Error('A capture is already in progress.');
  if (!tab?.id || RESTRICTED_URL.test(tab.url || '')) {
    throw new Error('This page cannot be captured (browser-internal page).');
  }
  busy = true;
  setBadge('…');
  try {
    await runCapture(mode, tab);
  } catch (err) {
    reportError(err);
    throw err;
  } finally {
    busy = false;
    setBadge('');
    cleanOldResults().catch(() => {});
  }
}

async function runCapture(mode, tab) {
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get('settings')).settings };
  const tabId = tab.id;

  let strategy = settings.strategy;
  if (strategy === 'auto') {
    const markers = (await exec(tabId, detectThemeMarkers)) || [];
    strategy = markers.length ? 'class' : 'media';
  }
  const useMedia = (strategy === 'media' || strategy === 'both') && HAS_DEBUGGER;
  const useClass = strategy === 'class' || strategy === 'both' || (strategy === 'media' && !HAS_DEBUGGER);

  let attached = false;
  let savedState = null;
  let hudMounted = false;
  try {
    // Attach before zone selection: the debugger infobar shifts the viewport,
    // so the layout must be stable before the user picks a rectangle.
    if (useMedia) {
      await chrome.debugger.attach({ tabId }, '1.3');
      attached = true;
      await sleep(350);
    }

    let rect = null;
    if (mode === 'area') {
      setBadge('SEL');
      rect = await selectArea(tabId);
      setBadge('…');
    }

    await exec(tabId, hudMount, ['Preparing…', null]);
    hudMounted = true;

    if (useClass) savedState = await exec(tabId, saveThemeState);

    const shots = {};
    let step = 0;
    for (const scheme of ['light', 'dark']) {
      step++;
      await exec(tabId, hudMount, [`Capturing ${scheme} mode (${step}/2)…`, scheme]);
      if (useMedia) {
        await chrome.debugger.sendCommand({ tabId }, 'Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: scheme }],
        });
      }
      if (useClass) await exec(tabId, applyScheme, [scheme]);
      await sleep(settings.settleMs);
      // The HUD must never end up in the shot: hide it, wait for the page to
      // repaint (double rAF inside the tab), then capture and bring it back.
      await exec(tabId, hudSetVisible, [false]);
      await sleep(60);
      shots[scheme] = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      await exec(tabId, hudSetVisible, [true]);
      await sleep(CAPTURE_GAP_MS);
    }

    // Put the page back exactly as we found it.
    if (useClass && savedState) await exec(tabId, restoreThemeState, [savedState]);
    if (useMedia) {
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: '' }],
      });
    }

    if (rect) {
      shots.light = await cropDataUrl(shots.light, rect);
      shots.dark = await cropDataUrl(shots.dark, rect);
    }

    await exec(tabId, hudDone, ['Done — opening results']);
    hudMounted = false; // hudDone removes itself after a short delay

    const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const result = {
      light: shots.light,
      dark: shots.dark,
      url: tab.url,
      title: tab.title,
      mode,
      strategy,
      ts: Date.now(),
    };
    await storeResult(id, result);
    await chrome.tabs.create({
      url: chrome.runtime.getURL('results.html') + '#' + id,
      index: tab.index + 1,
    });
  } finally {
    if (hudMounted) {
      try { await exec(tabId, hudRemove); } catch {}
    }
    if (attached) {
      try { await chrome.debugger.detach({ tabId }); } catch {}
    }
  }
}

// ---------- zone selection ----------

function selectArea(tabId) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(new Error('Selection timed out.')), 120000);
    const listener = (msg, sender) => {
      if (sender.tab?.id !== tabId || msg?.type !== 'skreeen:selection') return;
      finish(null, msg.rect);
    };
    function finish(err, rect) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(listener);
      if (err) reject(err);
      else if (!rect) reject(new Error('Selection cancelled.'));
      else resolve(rect);
    }
    chrome.runtime.onMessage.addListener(listener);
    chrome.scripting
      .executeScript({ target: { tabId }, files: ['selector.js'] })
      .catch((e) => finish(e));
  });
}

// ---------- injected progress HUD (serialized, run in the tab) ----------

function hudMount(text, scheme) {
  let hud = window.__skreeenHud;
  if (!hud) {
    const el = document.createElement('div');
    el.id = '__skreeen_hud';
    el.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'z-index:2147483647;display:flex;align-items:center;gap:10px;' +
      'padding:10px 18px;border-radius:99px;background:rgba(17,24,39,0.94);' +
      'border:1px solid rgba(255,255,255,0.16);color:#f9fafb;' +
      'font:600 13px/1.4 -apple-system,system-ui,sans-serif;white-space:nowrap;' +
      'box-shadow:0 6px 24px rgba(0,0,0,0.4);pointer-events:none;';
    const style = document.createElement('style');
    style.textContent = '@keyframes __skreeen_spin{to{transform:rotate(360deg)}}';
    const icon = document.createElement('span');
    icon.style.cssText = 'display:inline-flex;width:15px;height:15px;font-size:13px;line-height:15px;';
    const spinner = document.createElement('span');
    spinner.style.cssText =
      'width:13px;height:13px;border:2px solid #818cf8;border-top-color:transparent;' +
      'border-radius:50%;animation:__skreeen_spin .8s linear infinite;';
    icon.appendChild(spinner);
    const label = document.createElement('span');
    el.append(style, icon, label);
    document.documentElement.appendChild(el);
    hud = window.__skreeenHud = { el, icon, spinner, label };
  }
  hud.label.textContent = text;
  // Show which theme is being shot; fall back to the spinner in between.
  if (scheme === 'light') hud.icon.textContent = '☀️';
  else if (scheme === 'dark') hud.icon.textContent = '🌙';
  else { hud.icon.textContent = ''; hud.icon.appendChild(hud.spinner); }
  hud.el.style.display = 'flex';
}

function hudSetVisible(visible) {
  const hud = window.__skreeenHud;
  if (!hud) return;
  hud.el.style.display = visible ? 'flex' : 'none';
  // Resolve only once the change has actually been painted, so the worker
  // can safely capture right after hiding.
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
  );
}

function hudDone(text) {
  const hud = window.__skreeenHud;
  if (!hud) return;
  hud.icon.textContent = '✅';
  hud.label.textContent = text;
  hud.el.style.display = 'flex';
  setTimeout(() => {
    hud.el.remove();
    window.__skreeenHud = null;
  }, 2000);
}

function hudRemove() {
  window.__skreeenHud?.el.remove();
  window.__skreeenHud = null;
}

// ---------- injected page functions (serialized, run in the tab) ----------

function detectThemeMarkers() {
  const ATTRS = [
    'data-theme', 'data-color-mode', 'data-bs-theme', 'data-mode',
    'data-color-scheme', 'data-scheme', 'data-appearance', 'data-dark-mode', 'theme',
  ];
  const CLASSES = ['dark', 'light', 'dark-mode', 'light-mode', 'theme-dark', 'theme-light', 'dark-theme', 'light-theme'];
  const found = [];
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    for (const c of CLASSES) if (el.classList.contains(c)) found.push('class:' + c);
    for (const a of ATTRS) if (el.hasAttribute(a)) found.push('attr:' + a);
  }
  return found;
}

function saveThemeState() {
  const ATTRS = [
    'data-theme', 'data-color-mode', 'data-bs-theme', 'data-mode',
    'data-color-scheme', 'data-scheme', 'data-appearance', 'data-dark-mode', 'theme',
  ];
  const snap = (el) => {
    if (!el) return null;
    const attrs = {};
    for (const a of ATTRS) attrs[a] = el.getAttribute(a); // null when absent
    return { className: el.getAttribute('class'), attrs, colorScheme: el.style.colorScheme || '' };
  };
  const meta = document.querySelector('meta[name="color-scheme"]');
  return {
    html: snap(document.documentElement),
    body: snap(document.body),
    metaColorScheme: meta ? meta.getAttribute('content') : null,
  };
}

function applyScheme(scheme) {
  const PAIRS = [
    ['dark', 'light'],
    ['dark-mode', 'light-mode'],
    ['theme-dark', 'theme-light'],
    ['dark-theme', 'light-theme'],
  ];
  const ATTRS = [
    'data-theme', 'data-color-mode', 'data-bs-theme', 'data-mode',
    'data-color-scheme', 'data-scheme', 'data-appearance', 'theme',
  ];
  const apply = (el, isRoot) => {
    if (!el) return;
    for (const [d, l] of PAIRS) {
      const target = scheme === 'dark' ? d : l;
      const off = scheme === 'dark' ? l : d;
      // Swap a class pair if the element uses it; always set the plain
      // dark/light pair on <html> (covers Tailwind's class strategy even
      // when no class is present yet).
      if (el.classList.contains(d) || el.classList.contains(l) || (isRoot && d === 'dark')) {
        el.classList.remove(off);
        el.classList.add(target);
      }
    }
    for (const a of ATTRS) {
      if (el.hasAttribute(a)) el.setAttribute(a, scheme);
    }
    if (el.hasAttribute('data-dark-mode')) {
      el.setAttribute('data-dark-mode', scheme === 'dark' ? 'true' : 'false');
    }
  };
  apply(document.documentElement, true);
  apply(document.body, false);
  document.documentElement.style.colorScheme = scheme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', scheme);
}

function restoreThemeState(saved) {
  const put = (el, snap) => {
    if (!el || !snap) return;
    if (snap.className === null) el.removeAttribute('class');
    else el.setAttribute('class', snap.className);
    for (const [a, v] of Object.entries(snap.attrs)) {
      if (v === null) el.removeAttribute(a);
      else el.setAttribute(a, v);
    }
    el.style.colorScheme = snap.colorScheme;
    if (!el.getAttribute('style')) el.removeAttribute('style');
  };
  put(document.documentElement, saved.html);
  put(document.body, saved.body);
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta && saved.metaColorScheme !== null) meta.setAttribute('content', saved.metaColorScheme);
}

// ---------- image cropping (runs in the worker) ----------

async function cropDataUrl(dataUrl, rect) {
  const bytes = dataUrlToBytes(dataUrl);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  // The capture is in physical pixels; the rect is in CSS pixels.
  const scale = bitmap.width / rect.vw;
  const sx = clamp(Math.round(rect.x * scale), 0, bitmap.width - 1);
  const sy = clamp(Math.round(rect.y * scale), 0, bitmap.height - 1);
  const sw = clamp(Math.round(rect.w * scale), 1, bitmap.width - sx);
  const sh = clamp(Math.round(rect.h * scale), 1, bitmap.height - sy);
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()));
}

function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToDataUrl(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return 'data:image/png;base64,' + btoa(bin);
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// ---------- result storage ----------

async function storeResult(id, result) {
  const entry = { ['result:' + id]: result };
  if (chrome.storage.session) {
    try {
      await chrome.storage.session.set(entry);
      return;
    } catch {}
  }
  await chrome.storage.local.set(entry);
}

async function cleanOldResults() {
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter(
    (k) => k.startsWith('result:') && (all[k]?.ts || 0) < Date.now() - RESULT_TTL_MS
  );
  if (stale.length) await chrome.storage.local.remove(stale);
}

// ---------- helpers ----------

async function exec(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setBadge(text) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
}

function reportError(err) {
  const message = String(err?.message || err);
  console.error('[skreeen]', message);
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Skreeen — capture failed',
    message,
  });
}
