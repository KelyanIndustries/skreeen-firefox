/* Skreeen — zone selection overlay. Injected on demand; sends the chosen
 * rectangle (viewport CSS px) back to the service worker, or null on cancel. */
(() => {
  if (window.__skreeenSelecting) return;
  window.__skreeenSelecting = true;

  const Z = 2147483647;

  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;z-index:${Z};cursor:crosshair;` +
    'background:rgba(0,0,0,0.08);user-select:none;-webkit-user-select:none;';

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;display:none;border:1.5px solid #6366f1;' +
    'background:rgba(99,102,241,0.07);box-shadow:0 0 0 100000px rgba(0,0,0,0.38);' +
    'border-radius:2px;pointer-events:none;';

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;display:none;padding:3px 8px;border-radius:6px;' +
    'background:#111827;color:#f9fafb;font:600 12px/1.4 -apple-system,system-ui,sans-serif;' +
    'pointer-events:none;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.35);';

  const hint = document.createElement('div');
  hint.textContent = 'Drag to select a zone · Esc to cancel';
  hint.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);' +
    'padding:8px 16px;border-radius:99px;background:#111827;color:#f9fafb;' +
    'font:600 13px/1.4 -apple-system,system-ui,sans-serif;pointer-events:none;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.35);';

  overlay.append(box, label, hint);
  document.documentElement.appendChild(overlay);

  let startX = 0, startY = 0, dragging = false;

  function rectFrom(e) {
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    return { x, y, w, h };
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    hint.style.display = 'none';
    overlay.style.background = 'transparent';
  }

  function onMouseMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const r = rectFrom(e);
    box.style.display = 'block';
    box.style.left = r.x + 'px';
    box.style.top = r.y + 'px';
    box.style.width = r.w + 'px';
    box.style.height = r.h + 'px';
    label.style.display = 'block';
    label.textContent = `${r.w} × ${r.h}`;
    label.style.left = Math.min(r.x, window.innerWidth - 110) + 'px';
    label.style.top = (r.y > 30 ? r.y - 28 : r.y + r.h + 8) + 'px';
  }

  function onMouseUp(e) {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const r = rectFrom(e);
    if (r.w < 5 || r.h < 5) {
      // Treat a click without a real drag as a restart, not a confirm.
      dragging = false;
      box.style.display = 'none';
      label.style.display = 'none';
      hint.style.display = 'block';
      return;
    }
    finish({
      x: r.x, y: r.y, w: r.w, h: r.h,
      vw: window.innerWidth, vh: window.innerHeight,
      dpr: window.devicePixelRatio,
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    }
  }

  function finish(rect) {
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    window.__skreeenSelecting = false;
    // Let the page repaint without the overlay before the capture happens.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => chrome.runtime.sendMessage({ type: 'skreeen:selection', rect }))
    );
  }

  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('keydown', onKeyDown, true);
})();
