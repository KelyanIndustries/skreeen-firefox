const RESTRICTED_URL = /^(chrome|chrome-extension|edge|about|devtools|view-source):|^https:\/\/chrome\.google\.com\/webstore|^https:\/\/chromewebstore\.google\.com/;

const $ = (id) => document.getElementById(id);
const status = $('status');

let activeTab = null;

init();

async function init() {
  const { settings } = await chrome.storage.sync.get('settings');
  if (settings) {
    $('strategy').value = settings.strategy ?? 'auto';
    $('settle').value = settings.settleMs ?? 700;
  }
  $('settle-value').textContent = `${$('settle').value} ms`;

  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || RESTRICTED_URL.test(activeTab.url || '')) {
    $('btn-area').disabled = true;
    $('btn-full').disabled = true;
    setStatus('This page cannot be captured.', true);
  }
}

$('strategy').addEventListener('change', saveSettings);
$('settle').addEventListener('input', () => {
  $('settle-value').textContent = `${$('settle').value} ms`;
  saveSettings();
});

$('btn-area').addEventListener('click', () => capture('area'));
$('btn-full').addEventListener('click', () => capture('full'));

function saveSettings() {
  return chrome.storage.sync.set({
    settings: {
      strategy: $('strategy').value,
      settleMs: Number($('settle').value),
    },
  });
}

async function capture(mode) {
  await saveSettings();
  setStatus(mode === 'area' ? 'Select a zone on the page…' : 'Capturing light + dark…');
  chrome.runtime.sendMessage({ type: 'skreeen:capture', mode, tab: activeTab }, (res) => {
    // The popup usually closes before this fires; errors also surface as
    // system notifications from the worker.
    if (res && !res.ok) setStatus(res.error, true);
  });
  // Close so the popup is neither in the way of selection nor the screenshot.
  setTimeout(() => window.close(), 120);
}

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
}
