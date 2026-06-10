const $ = (id) => document.getElementById(id);

let result = null;
let baseName = 'skreeen';

init();

async function init() {
  const id = location.hash.slice(1);
  const key = 'result:' + id;
  result =
    (chrome.storage.session ? (await chrome.storage.session.get(key))[key] : null) ||
    (await chrome.storage.local.get(key))[key];

  if (!result) {
    $('empty').hidden = false;
    $('side-view').hidden = true;
    document.querySelector('.actions').style.display = 'none';
    return;
  }

  let host = 'page';
  try { host = new URL(result.url).hostname.replace(/^www\./, ''); } catch {}
  const when = new Date(result.ts);
  baseName = `skreeen-${host}-${timestamp(when)}`;

  $('meta').textContent =
    `${host} · ${result.mode === 'area' ? 'selected zone' : 'full window'} · ` +
    `${result.strategy} strategy · ${when.toLocaleString()}`;
  document.title = `Skreeen — ${host}`;

  $('img-light').src = result.light;
  $('img-dark').src = result.dark;
  $('cmp-light').src = result.light;
  $('cmp-dark').src = result.dark;

  setupViews();
  setupSlider();
  setupButtons();
}

function timestamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---------- views ----------

function setupViews() {
  const side = $('view-side');
  const slider = $('view-slider');
  side.addEventListener('click', () => switchView(true));
  slider.addEventListener('click', () => switchView(false));
  function switchView(isSide) {
    side.classList.toggle('active', isSide);
    slider.classList.toggle('active', !isSide);
    $('side-view').hidden = !isSide;
    $('slider-view').hidden = isSide;
    if (!isSide) syncSliderWidth();
  }
}

// ---------- slider compare ----------

function setupSlider() {
  const compare = $('compare');
  let pos = 0.5;

  const apply = () => {
    $('cmp-top').style.width = pos * 100 + '%';
    $('cmp-handle').style.left = pos * 100 + '%';
  };

  const move = (clientX) => {
    const r = compare.getBoundingClientRect();
    pos = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    apply();
  };

  compare.addEventListener('pointerdown', (e) => {
    compare.setPointerCapture(e.pointerId);
    move(e.clientX);
  });
  compare.addEventListener('pointermove', (e) => {
    if (e.buttons & 1) move(e.clientX);
  });

  window.addEventListener('resize', syncSliderWidth);
  $('cmp-dark').addEventListener('load', syncSliderWidth);
  apply();
}

function syncSliderWidth() {
  // The clipped top image must match the container width, not its own 50% box.
  $('cmp-light').style.width = $('compare').clientWidth + 'px';
}

// ---------- download / copy ----------

function setupButtons() {
  $('download-both').addEventListener('click', () => {
    download('light');
    setTimeout(() => download('dark'), 300);
  });
  for (const btn of document.querySelectorAll('[data-download]')) {
    btn.addEventListener('click', () => download(btn.dataset.download));
  }
  for (const btn of document.querySelectorAll('[data-copy]')) {
    btn.addEventListener('click', async () => {
      const blob = await (await fetch(result[btn.dataset.copy])).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      const old = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = old), 1200);
    });
  }
}

function download(scheme) {
  const a = document.createElement('a');
  a.href = result[scheme];
  a.download = `${baseName}-${scheme}.png`;
  a.click();
}
