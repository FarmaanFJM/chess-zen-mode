/* Explicit page detection. Only pages matched here are ever modified. */
(function (root) {
  'use strict';

  // Live human games. /game/live/<id> also serves a game after it ends; the
  // separate review UI lives under /analysis/... and is intentionally not matched.
  const ONLINE = [/^\/play\/online(\/.*)?$/, /^\/game\/live\/\d+\/?$/];

  // Board-based puzzle pages. Non-board puzzle pages (leaderboards, stats...) are
  // not listed; the content script additionally requires a board element.
  const PUZZLE = [
    /^\/puzzles\/?$/,
    /^\/puzzles\/(rated|rush|battle|daily|learning|custom|themed|vs)(\/.*)?$/,
    /^\/puzzles\/problem\/[^/]+\/?$/,
    /^\/puzzles\/\d+\/?$/,
  ];

  function pathOf(input) {
    try {
      const u = new URL(input, 'https://www.chess.com');
      if (u.protocol !== 'https:' || u.hostname !== 'www.chess.com') return null;
      return u.pathname.replace(/\/{2,}/g, '/');
    } catch (_) {
      return null;
    }
  }

  /** @returns {'online'|'puzzle'|null} */
  function detectPage(url) {
    const path = pathOf(url);
    if (path === null) return null;
    if (ONLINE.some((re) => re.test(path))) return 'online';
    if (PUZZLE.some((re) => re.test(path))) return 'puzzle';
    return null;
  }

  /** @returns {'rush'|'battle'|'rated'|'other'} */
  function puzzleMode(url) {
    const path = pathOf(url) || '';
    if (/^\/puzzles\/rush(\/|$)/.test(path)) return 'rush';
    if (/^\/puzzles\/battle(\/|$)/.test(path)) return 'battle';
    if (/^\/puzzles(\/rated|\/problem\/|\/?$)/.test(path)) return 'rated';
    return 'other';
  }

  const api = { detectPage, puzzleMode };
  root.ChessZen = Object.assign(root.ChessZen || {}, { pages: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
