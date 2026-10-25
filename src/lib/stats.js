/*
 * Read-only puzzle statistics. Values are copied from Chess.com's own sidebar DOM;
 * nothing is computed, timed or guessed here. A row is only produced when the
 * source element exists and its text passes a strict format check.
 *
 * NOTE: the class names below come from Chess.com's shipped puzzle stylesheet.
 * They have not been verified against a logged-in Puzzle Rush session (see README).
 */
(function (root) {
  'use strict';

  const TIME_RE = /^\d{1,2}:\d{2}(\.\d)?$/;
  const INT_RE = /^\d{1,5}$/;

  function leafTexts(doc, selector) {
    const out = [];
    doc.querySelectorAll(selector).forEach((el) => {
      if (el.children.length === 0) {
        const t = (el.textContent || '').trim();
        if (t) out.push(t);
      }
    });
    return out;
  }

  /** Gather raw text/counts from the puzzle sidebar. DOM-dependent; kept thin. */
  function collectSnapshot(doc) {
    const sidebar = doc.querySelector('#board-layout-sidebar');
    if (!sidebar) return null;
    const crosses = Array.from(sidebar.querySelectorAll('[class*="streak-icon-square-x"], [class*="rush-peripheral-view-icon-strike"]'));
    return {
      timers: leafTexts(sidebar, '[class*="timer"]'),
      scores: leafTexts(sidebar, '[class*="puzzle-score-display"]'),
      ratings: leafTexts(sidebar, '[class*="user-rating-animated-rating"]'),
      streaks: leafTexts(sidebar, '[class*="rated-streak-info-current"]'),
      strikesUsed: crosses.filter((el) => !/gray|faded/.test(String(el.className))).length,
      strikesTotal: crosses.length,
    };
  }

  function first(list, re) {
    return (list || []).find((t) => re.test(t));
  }

  /**
   * @param {object|null} snap result of collectSnapshot
   * @param {'rush'|'battle'|'rated'|'other'} mode
   * @returns {{rows: {key:string,label:string,value:string}[]}}
   */
  function buildStats(snap, mode) {
    const rows = [];
    if (!snap) return { rows };
    const time = first(snap.timers, TIME_RE);
    const add = (key, label, value) => value != null && rows.push({ key, label, value: String(value) });

    if (mode === 'rush' || mode === 'battle') {
      add('solved', 'Solved', first(snap.scores, INT_RE));
      if (snap.strikesTotal > 0) {
        add('mistakes', 'Mistakes', `${snap.strikesUsed} / ${snap.strikesTotal}`);
      }
      add('time', 'Time', time);
    } else if (mode === 'rated') {
      add('rating', 'Rating', first(snap.ratings, INT_RE));
      add('streak', 'Streak', first(snap.streaks, INT_RE));
      add('time', 'Time', time);
    }
    return { rows };
  }

  const api = { TIME_RE, INT_RE, collectSnapshot, buildStats };
  root.ChessZen = Object.assign(root.ChessZen || {}, { stats: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
