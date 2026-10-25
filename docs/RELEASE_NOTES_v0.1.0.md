## Chess Zen Mode v0.1.0 (prototype)

Center the Chess.com board and hide the clutter with one toggle; switch it off to get the normal site back, mid-game, without a reload. Four independent modes: **Online Chess, Daily Chess, Puzzles, Analysis Board**.

**Features**
- Board centered on the browser viewport, re-centered live on resize/zoom and after every native board resize
- Chess.com's own resize handle keeps working before, during and after Zen Mode; the extension never sets board dimensions and never touches your saved board size
- Left sidebar and right panel hidden by default (Analysis keeps its panel visible), each independently re-showable; a hidden/too-wide right panel stays reachable from an edge tab (resign, draw, confirm/submit, hint, next, engine toggle)
- **Analysis Zen Mode keeps Chess.com's own engine panel**: engine toggle, evaluation bar, engine line + continuation lines, move list and navigation. The extension never starts/stops an engine, includes no engine and calculates nothing; a disabled engine stays disabled
- **Fair play:** modes are separated by URL. Analysis Zen is never applied to Online/Daily game pages and no engine information is ever added to a game
- Optional compact puzzle stats copied from Chess.com's own sidebar (never fabricated; shows "No stats available here" if unreadable)
- Background colour picker (default `#000000`)
- **Persistent settings:** all four toggles, every sidebar/panel preference, the stats toggle and the colour survive browser restarts, apply automatically on load, and stay consistent across tabs; layout is applied at `document_start` to avoid a flash of the original layout
- Original board, pieces, themes, clocks and interactions are Chess.com's own; fully reversible; no network requests; permissions: `storage` + `https://www.chess.com/*`

**Install:** extract the ZIP, open `chrome://extensions`, enable Developer mode, **Load unpacked**, pick the extracted folder.

**Tested (automated, headless Chromium, real Chess.com guest pages incl. the live Analysis Board with Stockfish):** 159 browser checks + 35 unit tests pass, 1 browser check skipped (the browser suite was re-run against the extracted release ZIP). Covered: centering at 1280–2560 px wide, live resize, native resize-handle drags in all modes (before/during/after Zen), zoom-equivalent viewports, panel combinations, drawer access, engine toggle/lines/eval bar visibility and state preservation, position kept across Zen on/off, exact restore on disable, every mode activating only on its own page type (real and client-side navigation), tab consistency, restart persistence, no-flash activation, popup.

**NOT tested – needs a human:** a real logged-in Daily game (guests only get the page shell: move confirmation, conditional moves, clocks, resign/draw), a real logged-in live game (clocks ticking, premoves, arrows, offers), logged-in Puzzle Rush Survival/3-min/5-min (stat selectors are unverified), logged-in analysis extras (multi-line settings, saved/review tabs), real browser zoom, Edge/Brave, multi-monitor.

**Known limitations:** desktop layout only (≥960 px window); `/play/computer` and the Daily Puzzle (`/daily`) are out of scope; theatre mode and double-board Battle untested. See README.
