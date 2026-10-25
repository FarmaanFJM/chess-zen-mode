# Chess Zen Mode

A small Chromium extension that makes [Chess.com](https://www.chess.com) more focused: it **centers the board in your browser window and hides the distractions around it**, then puts everything back with one toggle.

It is a visual focus tool only. It does not replace Chess.com's board, pieces, move handling, clocks or game logic, and it never analyzes positions, suggests moves, automates play or sends data anywhere.

> **Status: v0.1.0 prototype.** Verified against Chess.com's real page structure as a logged-out guest; live games and logged-in Puzzle Rush still need a human check. See [Known limitations](#known-limitations) and [Testing](#testing).

## What it does

| Mode | Pages | Zen Mode ON | Zen Mode OFF |
| --- | --- | --- | --- |
| **Online Zen Mode** | `/play/online…`, `/game/live/<id>` | Board centered on the viewport; left navigation, right panel, ads hidden; background colour applied | Normal Chess.com |
| **Puzzle Zen Mode** | `/puzzles`, `/puzzles/rated`, `/puzzles/rush`, `/puzzles/battle`, `/puzzles/problem/…`, `/puzzles/daily`, `/puzzles/learning`, `/puzzles/custom` | Same as above, plus an optional compact stats panel | Normal Chess.com |

Every other Chess.com page (home, news, articles, lessons, game review, analysis, openings, settings, …) is left completely untouched. Page detection is an explicit URL allow-list, and a board element must be present before anything is applied.

## Features

- **Centered board** – centered on the *viewport* (not on the space beside a sidebar), square, and sized by Chess.com's own layout rules so it fits the window height. Re-centers live on resize and zoom.
- **Original board untouched** – themes, pieces, coordinates, drag/click moves, premoves, arrows, highlights, promotion and clocks are all Chess.com's own. The extension only changes the page's layout variables, so overlays stay aligned with the board.
- **Independent panel toggles** – show/hide the left sidebar and the right panel separately while staying in Zen Mode. A visible right panel is mirrored by empty space on the left so the board stays centered. If the window is too narrow, the board wins and the panel falls back to the drawer (below).
- **Always-reachable controls** – a hidden right panel is not removed. A small tab on the right edge of the window slides it back over the page (resign, draw offers, hint, next puzzle…). `Esc` or clicking elsewhere closes it. In online games the tab turns amber when a draw/offer element appears in the hidden panel.
- **Puzzle stats (optional)** – a compact panel next to the board that *copies* values from Chess.com's own sidebar (never its own timer). Rows only appear when the source element exists and has the expected format; otherwise it says *No stats available here*.
- **Background colour** – pure black by default, any `#rrggbb` via the colour picker; saved between sessions. Only the page background changes.
- **Fully reversible** – turning a mode off removes every class, CSS variable, inline style and injected element. No reload, no reconnect, no game or puzzle/timer reset.

## Supported browsers

Chrome and other Chromium browsers that support Manifest V3 (Chrome/Edge/Brave/Opera… 105+). Firefox and Safari are not supported.

## Installation

1. Download `chess-zen-mode-v0.1.0.zip` from the GitHub release and **extract it** to a folder you will keep (the extension runs from that folder).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**.
5. Choose the extracted folder (the one that directly contains `manifest.json`).
6. Optional: pin the extension from the puzzle-piece menu in the toolbar.

To install from source instead, clone this repository and choose the repository root in step 5.

Reload any open Chess.com tabs once after installing.

## Using it

1. Open a supported Chess.com page.
2. Click the extension icon.
3. Switch on **Online Zen Mode** (online games) or **Puzzle Zen Mode** (puzzles). The change applies immediately to open tabs.
4. Switch it off again to return to the normal Chess.com layout.

Both modes can be enabled at once; only the one that matches the current page activates, and each tab follows its own page.

### Settings

| Section | Setting | Default | Effect |
| --- | --- | --- | --- |
| Online Chess | Online Zen Mode | Off | Master switch for online games |
| | Show Left Sidebar | Off | Keep Chess.com's navigation visible inside Zen Mode |
| | Show Right Panel | Off | Keep the move list/chat/game panel docked inside Zen Mode |
| Puzzles | Puzzle Zen Mode | Off | Master switch for puzzles |
| | Show Left Sidebar | Off | As above |
| | Show Right Panel | Off | As above |
| | Show Puzzle Stats | Off | Compact stats panel; turning it off does not end Zen Mode |
| Appearance | Background Color | `#000000` | Zen Mode page background; **Default** resets to black |

Settings are stored with `chrome.storage.local` (this browser only, never synced or sent anywhere).

### Permissions and privacy

- `storage` – to remember the settings above.
- Host access `https://www.chess.com/*` – to run the content script. Nothing else.
- No network requests, analytics, remote code, or access to credentials or game data. The stats panel reads only text already shown on the page.

## Known limitations

- **Not yet verified on a live game or a logged-in Puzzle Rush.** Guest pages exposed the real layout (used for testing), but no guest can play a live human game or Rush. The stats selectors are derived from class names in Chess.com's shipped puzzle stylesheet and are **unverified** for Rush/Survival/Battle; if they don't match, the panel shows *No stats available here* rather than guessing. Please report what you see.
- Stats show a single **Time** value as displayed by Chess.com; the extension does not distinguish elapsed (Survival) from remaining (timed) time.
- Desktop layout only: below 960 CSS px of window width Chess.com switches to its mobile layout and Zen Mode does nothing (the popup says so).
- When a right panel is shown but the window is too small for panel + board, the panel moves to the edge drawer.
- Daily (correspondence) games, `/play/computer`, bots, and the post-game review/analysis pages are out of scope by design. A finished game left open at `/game/live/<id>` still uses the play layout, so Zen Mode applies there.
- The draw-offer indicator is a best-effort heuristic on class names; always check the drawer if you expect an offer.
- Chess.com changes its markup from time to time. Layout relies on the site's own CSS variables and a handful of stable IDs (`#board-layout-main`, `#board-layout-sidebar`, `#sidebar-main-menu`, `wc-chess-board`); if one disappears the extension does nothing instead of breaking the page.
- Theatre mode, double-board puzzle battles and the events/tournament layout are untested.

## Development

No build step and no runtime dependencies – the repository root *is* the extension.

```
manifest.json            MV3 manifest
src/lib/settings.js      settings schema, validation, storage helpers (shared)
src/lib/pages.js         URL allow-list / page-type detection
src/lib/layout.js        pure layout math (panel reserves, centering correction)
src/lib/stats.js         read-only puzzle stats extraction
src/content/content.js   content script: applies/removes Zen Mode
src/content/zen.css      layout overrides, all scoped under html.czm-active
src/popup/               popup UI
test/unit/               node:test unit tests
test/e2e/run.js          Playwright browser tests (live Chess.com guest pages)
scripts/                 validate.js, package.js
```

How it works: Chess.com lays out play and puzzle pages as a CSS grid on `<body>` driven by variables (`--verticalNavWidth`, `--sidebarMinWidth`, …). Zen Mode overrides those variables (so the site's own sizing still runs), then corrects any residual offset by measuring the real board. Nothing is rebuilt or reparented.

```sh
npm test            # unit tests (Node 18+, no dependencies)
npm run validate    # manifest + file-reference checks
npm run package     # dist/chess-zen-mode-v<version>.zip, .sha256, then validates the zip
npm run test:e2e    # browser tests; needs Playwright + Chromium + network access
```

Load the repo root with **Load unpacked** to develop; reload the extension and the Chess.com tab after changes.

### Testing

`npm run test:e2e` launches Chromium with the extension, opens real Chess.com guest pages (`/play/online`, `/puzzles/rated`, `/puzzles/rush`), and checks centering at several window sizes, live resize, zoom-equivalent viewports, panel combinations, drawer access, piece/overlay alignment, exact restoration on disable, client-side navigation, scope, tab isolation, popup behavior and persistence across a browser restart. Set `CZM_EXT_DIR` to run it against an unpacked release ZIP. Anything needing a login is listed as manual in the release notes.

### Releasing

1. `npm test && npm run test:e2e`
2. Bump the version in `manifest.json` **and** `package.json` (`validate` fails if they differ).
3. `npm run package`; upload `dist/chess-zen-mode-v<version>.zip` (and its `.sha256`) to a GitHub Release by hand.

## License

MIT – see [LICENSE](LICENSE).
