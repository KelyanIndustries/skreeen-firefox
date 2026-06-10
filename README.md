# Skreeen — Light & Dark Screenshots

A Chrome extension that captures a **selected zone** or the **full window** twice in one go: once in **light mode**, once in **dark mode** — by switching the page's theme automatically, then restoring it exactly as it was.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder

## Use

1. Click the Skreeen icon (or press `Alt+Shift+S` for zone / `Alt+Shift+F` for full window)
2. **Select a zone**: drag a rectangle on the page (`Esc` cancels) — or **Full window** for the whole viewport
3. Skreeen forces light mode → shoots, forces dark mode → shoots, restores the page. A progress pill shows each step ("Capturing light mode (1/2)…") and is hidden during the actual shots, so it never appears in your screenshots
4. A results tab opens with both shots: side-by-side or slider comparison, plus download/copy buttons

## How theme switching works

Websites implement dark mode in two main ways, and Skreeen handles both:

| Strategy | How it works | Typical sites |
|---|---|---|
| **prefers-color-scheme** | Emulates the CSS media query via the DevTools protocol (`chrome.debugger`) | Sites that follow the OS theme |
| **Class / attribute** | Toggles `dark`/`light` classes and theme attributes (`data-theme`, `data-color-mode`, `data-bs-theme`, …) on `<html>`/`<body>` | Tailwind, Bootstrap 5.3, daisyUI, GitHub-style toggles |

**Auto-detect** (the default) inspects `<html>`/`<body>`: if it finds theme classes or attributes, it uses the class strategy; otherwise it emulates `prefers-color-scheme`. You can force either one — or **Both** for stubborn sites — in the popup settings.

The original classes, attributes, and inline `color-scheme` are snapshotted before switching and restored afterward. `localStorage` is never touched, so nothing persists.

## Settings

- **Theme switching**: Auto / media query / class toggle / both
- **Settle delay** (0–3000 ms): time to let CSS transitions finish before each shot

## Notes & limitations

- The media-query strategy briefly shows Chrome's *"started debugging this browser"* banner — that's the DevTools protocol attachment; it disappears when the capture finishes.
- Captures the **visible viewport** (no full-page scroll stitching).
- Theme switching applies to the top frame; cross-origin iframes keep their own theme.
- Browser-internal pages (`chrome://…`, Web Store) can't be captured.
- Results are kept for 24 h, then cleaned up.

## Project layout

```
manifest.json     MV3 manifest
background.js     orchestration: detect → switch → capture ×2 → restore → crop
selector.js       zone-selection overlay (injected on demand)
popup.*           toolbar popup (capture buttons + settings)
results.*         results viewer (side-by-side, slider, download/copy)
scripts/          icon generator (python3 scripts/gen_icons.py)
```
