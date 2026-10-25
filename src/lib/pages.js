/* Explicit page detection. Only pages matched here are ever modified. */
(function (root) {
  'use strict';

  // Live human games. /game/live/<id> also serves a game after it ends.
  const ONLINE = [/^\/play\/online(\/.*)?$/, /^\/game\/live\/\d+\/?$/];

  // Daily (correspondence) games. Note: /daily is the Daily *Puzzle*, not Daily Chess.
  const DAILY = [/^\/game\/daily\/\d+\/?$/];

  // Analysis-only interfaces: the standalone board and post-game analysis/review.
  // Strictly disjoint from the game routes above, so engine-bearing analysis UI is
  // never combined with an active Online/Daily game page.
  const ANALYSIS = [/^\/analysis(\/.*)?$/];

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

  /** @returns {'online'|'daily'|'puzzle'|'analysis'|null} */
  function detectPage(url) {
    const path = pathOf(url);
    if (path === null) return null;
    if (ONLINE.some((re) => re.test(path))) return 'online';
    if (DAILY.some((re) => re.test(path))) return 'daily';
    if (ANALYSIS.some((re) => re.test(path))) return 'analysis';
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
