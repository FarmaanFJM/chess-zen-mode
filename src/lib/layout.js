/* Pure layout math. No DOM access, so it is unit-testable. All values in CSS px. */
(function (root) {
  'use strict';

  /** Chess.com's desktop board layout starts at 60em (960px). */
  const MIN_VIEWPORT_WIDTH = 960;
  const NAV_WIDTH = 170;
  const PANEL_PREFERRED = 380;
  const PANEL_MIN = 260;
  // Analysis needs a wider panel for engine lines.
  const PANEL_SIZES = { analysis: { pref: 460, min: 320 } };
  function panelSize(page) {
    return PANEL_SIZES[page] || { pref: PANEL_PREFERRED, min: PANEL_MIN };
  }
  // Space the site keeps around the board column (gutters, eval bar, controls).
  const BOARD_SLACK = 120;

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  /**
   * Decide how much horizontal space to reserve on each side of the board.
   *
   * A visible right panel is mirrored by an equal reserve on the left so the board
   * stays centered in the viewport. The reserve shrinks to fit; if it would drop
   * below PANEL_MIN the panel is not shown and the board wins (rightFits = false).
   * A visible left sidebar only ever pushes the board right when it would overlap.
   */
  function computeReserves(opts) {
    const vw = opts.vw;
    const vh = opts.vh;
    const showLeft = !!opts.showLeft;
    const showRight = !!opts.showRight;
    const navW = opts.navW == null ? NAV_WIDTH : opts.navW;
    const pref = opts.panelPref == null ? PANEL_PREFERRED : opts.panelPref;
    const min = opts.panelMin == null ? PANEL_MIN : opts.panelMin;
    const boardTarget = opts.boardTarget == null ? clamp(vh - 170, 320, 800) : opts.boardTarget;

    let right = 0;
    let rightFits = true;
    if (showRight) {
      const fits = (r) => vw - (showLeft ? Math.max(navW, r) : r) - r - BOARD_SLACK >= boardTarget;
      let r = pref;
      while (r >= min && !fits(r)) r -= 10;
      if (r >= min) right = r;
      else rightFits = false;
    }
    const left = showLeft ? Math.max(navW, right) : right;
    return { left, right, rightFits };
  }

  /**
   * Horizontal correction (px) that puts the board's center at the viewport center,
   * limited so it never overlaps the left sidebar (minLeft) or right panel (maxRight).
   */
  function computeShift(opts) {
    const { boardLeft, boardWidth, vw } = opts;
    const minLeft = opts.minLeft || 0;
    const maxRight = opts.maxRight == null ? vw : opts.maxRight;
    const desired = (vw - boardWidth) / 2;
    const upper = Math.max(minLeft, maxRight - boardWidth);
    return clamp(desired, minLeft, upper) - boardLeft;
  }

  /**
   * Downward correction (px, never negative) that centers the board block vertically when the
   * window is taller than it (full screen, tall windows). `top` is the block's natural top.
   * When there is no spare room it returns 0 and the site's own top-aligned layout is kept.
   */
  function computeVerticalShift(opts) {
    const margin = opts.margin == null ? 16 : opts.margin;
    const free = opts.vh - opts.height;
    if (free <= margin * 2) return 0;
    return Math.max(0, free / 2 - opts.top);
  }

  const api = {
    MIN_VIEWPORT_WIDTH, NAV_WIDTH, PANEL_PREFERRED, PANEL_MIN, BOARD_SLACK, panelSize,
    computeReserves, computeShift, computeVerticalShift,
  };
  root.ChessZen = Object.assign(root.ChessZen || {}, { layout: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
