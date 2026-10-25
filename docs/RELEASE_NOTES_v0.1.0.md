## Chess Zen Mode v0.1.0 (prototype)

Center the Chess.com board and hide the clutter with one toggle; switch it off to get the normal site back, mid-game, without a reload.

**Features**
- Online Zen Mode (live games) and Puzzle Zen Mode (regular puzzles, Puzzle Rush, Battle), each with its own switch
- Board centered on the browser viewport, re-centered live on resize/zoom
- Left sidebar and right panel hidden by default, each independently re-showable; hidden right panel stays reachable from an edge tab (resign / draw / hint / next)
- Optional compact puzzle stats copied from Chess.com's own sidebar (never fabricated; shows "No stats available here" if unreadable)
- Background colour picker (default `#000000`), saved between sessions
- Chess.com's native board resize handle keeps working before, during and after Zen Mode; the extension never sets board dimensions, preserves the saved size, and re-centers after every resize
- Original board, pieces, themes, clocks and interactions are Chess.com's own; fully reversible; no network requests; permissions: `storage` + `https://www.chess.com/*`

**Install:** extract the ZIP, open `chrome://extensions`, enable Developer mode, **Load unpacked**, pick the extracted folder.

**Tested (automated, headless Chromium, real Chess.com guest pages):** 89 browser checks + 24 unit tests pass (browser suite also re-run against the extracted release ZIP) – centering at 1280–2560 px wide, live resize, native resize-handle drags (before/during/after Zen), zoom-equivalent viewports, panel combinations, overlay alignment, restore-on-disable, SPA navigation, out-of-scope pages, tab isolation, popup, persistence across restart.

**Not tested – needs a human:** a real logged-in live game (clocks ticking, premoves, arrows, resign/draw offers), logged-in Puzzle Rush Survival/3-min/5-min (stat selectors are unverified), real browser zoom, Edge/Brave, multi-monitor setups.

**Known limitations:** desktop layout only (≥960 px window); daily games, computer games and game review are out of scope; theatre mode and double-board Battle untested. See README.
