# Chess Zen Mode v0.1.0 – Test Report

Run locally (GitHub CI unavailable). Browser tests: Playwright + Chromium (new headless, extension loaded), real https://www.chess.com pages **as a logged-out guest**. The same suite was re-run against the extracted release ZIP.

| Suite | Result |
| --- | --- |
| Unit tests (`npm test`) | PASS 39/39 |
| Browser tests (`npm run test:e2e`) | PASS 173/173 executed, 1 SKIPPED (see below) |
| Manifest/ZIP validation (`npm run validate`, `package`) | PASS |

## Requirement → result

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Daily page detection (`/game/daily/<id>`; `/daily` Daily Puzzle excluded) and activation | PASS (unit + browser, guest page shell) |
| 2 | Daily layout: centering at 4 sizes, panel visibility combos, edge quick toggles, restore, native resize | PASS on the guest shell |
| 2b | Daily with a real game: pieces/overlay alignment, move confirmation, conditional moves, clocks, resign/draw | **NOT TESTED** (needs login; alignment test SKIPPED) |
| 3 | Analysis page detection and activation (`/analysis`, `/analysis/game/...`) | PASS |
| 4 | Original analysis panel preserved (engine toggle, Stockfish depth line, lines, eval bar, move list, nav buttons) visible and in viewport during Zen | PASS (real guest analysis board) |
| 5 | Engine toggle usable in Zen and via the edge quick toggle; lines visible; disabled engine never re-enabled by Zen on/off/panel changes | PASS |
| 5b | Position/variation preserved across Zen on/off and panel changes; click-to-move still aligned | PASS |
| 5c | Narrow window → panel closed until opened as an overlay from the edge toggle, board usable/centered, engine reachable | PASS |
| 6 | Original layout restored (Daily, Analysis, Online, Puzzles) | PASS |
| 7 | Four toggles persist independently (unit + live propagation across tabs) | PASS |
| 8 | Visibility prefs, stats toggle, colour after browser restart; auto-activation; refresh | PASS (4 page types) |
| 9 | Correct mode on navigation between Online/Daily/Puzzles/Analysis (16 combos real navigation + SPA pushState) | PASS |
| 10 | Native board resizing (real drags of Chess.com's handle) before/during/after Zen in Online, Daily, Puzzles (rated + rush), Analysis; stays centered, square, aligned; saved size untouched | PASS |
| – | Fair play: Analysis Zen never on game pages; game/puzzle modes never on analysis; no engine/network/eval code in shipped source (static scan) | PASS |
| – | No flash: Zen classes/variables present before the board first renders (settings known from a previous visit) | PASS (online, daily, puzzle, analysis) |
| – | Out-of-scope pages (home, news, Daily Puzzle) untouched | PASS |

## Not tested / unverified
- Logged-in live game, logged-in Daily game, logged-in Puzzle Rush (Survival/3 min/5 min) and Battle; Rush stat selectors are derived from Chess.com's stylesheet and unverified.
- Analysis with a loaded game/review (accuracy charts under the board), multi-line engine settings, saved analyses.
- Real browser zoom (equivalent smaller viewports tested), Edge/Brave, high-DPI/multi-monitor, touch.
- First-ever page load before any settings copy exists can briefly show the original layout (the flash fix relies on a copy of the last settings; the cold path is not asserted).
- Draw/offer/confirm indicator on the right quick toggle is a class-name heuristic.

## Defect found while capturing README screenshots (fixed)
In Analysis Zen Mode the evaluation bar was invisible: Zen painted the background on `<body>` as well as `<html>`, and body's background covers Chess.com's negative-`z-index` bar fill. Zen now paints only the root and keeps body transparent. A browser test samples real rendered pixels to prove the bar is painted. (The earlier geometry-only check could not catch this.)

## Fixes after real-game feedback
- Live games are served at `/game/<id>` (no `live`); Online Zen Mode did not activate there. Detection fixed and tested.
- The right-edge tab only opened a temporary drawer and could not be closed from the page or reflected in the popup. Replaced by two quick toggles (left sidebar, right panel) fixed to the window edges that flip the saved settings (browser tests: open/close, saved value, popup mirrors toggle, toggle position unchanged).
- Full screen left the board top-aligned. The board block is now also centered vertically when the window is taller than it (browser test with a taller window + `fullscreenchange`; real F11 full screen was NOT tested headlessly).

## Known flaky check
`[online] pieces/overlays align to the board grid and are clickable` failed in 3 of about 9 full runs with "no pieces found" (the guest lobby board briefly had no piece elements), and passed in isolation and on every re-run, including the final one. The cause was not identified (the site on its own kept all 32 pieces for 140 s). Diagnostics (screenshot, board state) are now captured if it recurs. Treat it as unexplained.

## Skipped test (not counted as a pass)
`[daily] pieces/overlays align to the board grid and are clickable` is SKIPPED: guests only receive the play-page shell for Daily games, which has no pieces. The suite reports it as `SKIP` and the totals above count only executed checks (173 executed + 1 skipped = 174).

## Outstanding manual tests (required before release)
1. **Authenticated Online game:** enable Online Zen; board centered; both clocks tick; premove, drag/click moves, arrows/highlights aligned; resign and draw offer/response reachable via the edge quick toggle; resize board with the native handle; disable Zen mid-game with no interruption.
2. **Daily Chess game:** same as above plus move confirmation, conditional moves, remaining-time display and game actions reachable with the right panel hidden.
3. **Puzzle Rush Survival:** Puzzle Zen with stats on; solved/mistakes/time values match Chess.com's sidebar and update live (selectors are unverified); toggling Zen mid-run does not reset the run.
4. **Timed Puzzle Rush (3 min and 5 min):** the timer is uninterrupted while toggling Zen; stats time matches the site timer.
5. Logged-in Analysis extras (multi-line engine settings, review tab), real browser zoom, Edge/Brave.

## Branding check (logo integration)
- Icons `icons/icon-{16,32,48,128}.png` exist in the ZIP with exactly the declared dimensions (unit test). 32/48/128 are plain Lanczos downscales; 16 px is a tighter crop of the same artwork so the pawn stays recognizable.
- `chrome://extensions` card renders the logo (verified in Chromium). The **toolbar button itself could not be screenshotted** in headless Chromium; it uses the same manifest icons.
- Popup header (logo, name, "Focus on the board") verified in a real popup screenshot; README images exist on the branch and all relative links resolve.
