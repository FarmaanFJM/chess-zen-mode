/* Chess Zen Mode content script: applies/removes the Zen layout on supported pages. */
(function () {
  'use strict';

  if (window.__chessZenLoaded) return; // never initialize twice
  window.__chessZenLoaded = true;

  const { settings: S, pages: P, layout: L, stats: ST } = globalThis.ChessZen;
  const root = document.documentElement;
  const PAGES = S.MODES;
  const VARS = ['--czm-bg', '--czm-left', '--czm-right', '--czm-drawer-w'];
  const BOARD_SELECTOR = '#board-layout-main wc-chess-board, #board-layout-main .board-layout-chessboard .board';
  const ATTENTION_RE = /(?:^|[\s_-])(?:draw|offer|confirm|submit)s?(?:[\s_-]|$)/i;
  const MIRROR_KEY = 'czm:last'; // synchronous copy of the settings, only used to avoid a layout flash

  let current = S.normalize(null);
  let active = null; // { page, mode } while Zen Mode is applied
  let reason = 'disabled';
  let shift = 0;
  let raf = 0;
  let resizeObs = null;
  let sidebarObs = null;
  let observedSidebar = null;
  let edgeL = null; // fixed quick toggles at the window edges
  let edgeR = null;
  let sideState = 'off'; // right panel: 'docked' | 'dropped' (wanted but no room) | 'off'
  let overlayOpen = false; // transient: dropped panel shown over the page
  let openOnLayout = false;
  let shiftY = 0;
  let statsEl = null;
  let waitObs = null;
  let observedEls = new WeakSet();

  const q = (sel) => document.querySelector(sel);
  // clientWidth is 0 until first layout when running at document_start.
  const viewportWidth = () => root.clientWidth || window.innerWidth;

  function readMirror() {
    try {
      const raw = localStorage.getItem(MIRROR_KEY);
      return raw ? S.normalize(JSON.parse(raw)) : null;
    } catch (_) {
      return null;
    }
  }
  function writeMirror(settings) {
    try { localStorage.setItem(MIRROR_KEY, JSON.stringify(settings)); } catch (_) { /* optional */ }
  }

  /* ---------- injected UI ---------- */

  function mkEdge(id, side, onClick) {
    const b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.className = `czm-edge czm-edge-${side}`;
    b.addEventListener('click', onClick);
    document.body.appendChild(b);
    return b;
  }

  function ensureEdges() {
    if (edgeL || !document.body) return;
    edgeL = mkEdge('czm-edge-left', 'left', () => toggleSide('showLeft'));
    edgeR = mkEdge('czm-edge-right', 'right', onRightClick);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onOutsideDown, true);
    updateEdges();
  }

  function removeEdges() {
    if (edgeL) edgeL.remove();
    if (edgeR) edgeR.remove();
    edgeL = edgeR = null;
    overlayOpen = false;
    openOnLayout = false;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('mousedown', onOutsideDown, true);
  }

  /** Arrow + label always describe what the click will do. */
  function updateEdges() {
    if (!edgeL || !active) return;
    const cfg = current[active.page];
    const set = (b, open, what, closeArrow, openArrow) => {
      b.textContent = open ? closeArrow : openArrow;
      const label = `${open ? 'Hide' : 'Show'} ${what} (Chess Zen Mode)`;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-pressed', String(open));
    };
    set(edgeL, cfg.showLeft, 'left sidebar', '\u2039', '\u203A');
    set(edgeR, sideState === 'docked' || overlayOpen, active.page === 'analysis' ? 'analysis panel' : 'right panel', '\u203A', '\u2039');
    if (sideState === 'docked' || overlayOpen) edgeR.classList.remove('czm-attention');
  }

  /** Flip a saved preference; the popup and other tabs follow through storage. */
  function toggleSide(key) {
    if (!active) return;
    const page = active.page;
    const next = !current[page][key];
    if (key === 'showRight' && next) openOnLayout = true;
    current[page][key] = next; // optimistic, storage.onChanged confirms
    layoutNow();
    S.update(chrome.storage.local, (st) => { st[page][key] = next; }).catch(() => {});
  }

  function onRightClick() {
    if (!active) return;
    if (sideState === 'dropped') { // setting is already on, there is just no room to dock
      overlayOpen = !overlayOpen;
      layoutNow();
    } else {
      toggleSide('showRight');
    }
  }

  function closeOverlay() {
    overlayOpen = false;
    layoutNow();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && overlayOpen) closeOverlay();
  }

  function onOutsideDown(e) {
    if (!overlayOpen) return;
    const panel = q('#board-layout-sidebar');
    if (panel && !panel.contains(e.target) && e.target !== edgeR) closeOverlay();
  }

  function ensureStats() {
    if (statsEl || !document.body) return;
    statsEl = document.createElement('div');
    statsEl.id = 'czm-stats';
    statsEl.setAttribute('role', 'status');
    document.body.appendChild(statsEl);
  }

  function removeStats() {
    if (statsEl) statsEl.remove();
    statsEl = null;
  }

  function renderStats() {
    if (!statsEl || !active) return;
    const snap = ST.collectSnapshot(document);
    const { rows } = ST.buildStats(snap, active.mode);
    statsEl.textContent = '';
    if (rows.length === 0) {
      const note = document.createElement('div');
      note.className = 'czm-note';
      note.textContent = 'No stats available here';
      statsEl.appendChild(note);
    }
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'czm-row';
      const label = document.createElement('span');
      label.className = 'czm-label';
      label.textContent = r.label;
      const value = document.createElement('span');
      value.className = 'czm-value';
      value.textContent = r.value;
      row.append(label, value);
      statsEl.appendChild(row);
    }
    positionStats();
  }

  function positionStats() {
    const board = q(BOARD_SELECTOR);
    if (!statsEl || !board) return;
    const b = board.getBoundingClientRect();
    const w = statsEl.offsetWidth;
    const vw = root.clientWidth;
    const leftEdge = root.classList.contains('czm-hide-left') ? 8 : L.NAV_WIDTH + 8;
    const sidebar = q('#board-layout-sidebar');
    const panelShown = sidebar && !root.classList.contains('czm-hide-right'); // docked or open overlay
    const rightEdge = panelShown ? sidebar.getBoundingClientRect().left - 8 : vw - 8;
    let left;
    if (b.left - w - 16 >= leftEdge) left = b.left - w - 16;
    else if (b.right + 16 + w <= rightEdge) left = b.right + 16;
    else left = leftEdge;
    statsEl.style.left = `${Math.round(left)}px`;
    statsEl.style.top = `${Math.round(Math.max(8, b.top))}px`;
  }

  /* ---------- layout ---------- */

  function layoutNow() {
    raf = 0;
    if (!active) return;
    const cfg = current[active.page];
    const vw = viewportWidth();
    if (vw < L.MIN_VIEWPORT_WIDTH) return apply();

    const nav = q('#sidebar-main-menu');
    const navW = cfg.showLeft && nav && nav.getBoundingClientRect().width > 0
      ? nav.getBoundingClientRect().width
      : L.NAV_WIDTH;
    const size = L.panelSize(active.page);
    const res = L.computeReserves({
      vw, vh: window.innerHeight, showLeft: cfg.showLeft, showRight: cfg.showRight, navW,
      panelPref: size.pref, panelMin: size.min,
    });
    const showRight = cfg.showRight && res.rightFits;
    sideState = showRight ? 'docked' : cfg.showRight ? 'dropped' : 'off';
    if (sideState === 'dropped' && openOnLayout) overlayOpen = true;
    if (sideState !== 'dropped') overlayOpen = false;
    openOnLayout = false;

    root.classList.toggle('czm-hide-left', !cfg.showLeft);
    root.classList.toggle('czm-hide-right', !showRight && !overlayOpen);
    root.classList.toggle('czm-overlay-right', overlayOpen);
    root.style.setProperty('--czm-left', `${res.left}px`);
    root.style.setProperty('--czm-right', `${res.right}px`);
    root.style.setProperty('--czm-drawer-w', `${Math.min(size.pref, Math.round(vw * 0.92))}px`);
    ensureEdges();
    updateEdges();

    // Fine alignment: put the board itself (not the wider layout column) on the center line.
    const main = q('#board-layout-main');
    const board = q(BOARD_SELECTOR);
    if (main && board) {
      const r = board.getBoundingClientRect();
      const navRect = cfg.showLeft && nav ? nav.getBoundingClientRect() : null;
      const side = q('#board-layout-sidebar');
      const delta = L.computeShift({
        boardLeft: r.left - shift,
        boardWidth: r.width,
        vw,
        minLeft: navRect ? navRect.right + 8 : 0,
        maxRight: showRight && side ? side.getBoundingClientRect().left - 8 : vw,
      });
      shift = Math.round(delta * 2) / 2;
      main.style.left = shift === 0 ? '' : `${shift}px`;

      // Vertical: when the window is taller than the board block (e.g. full screen), center it.
      // (#board-layout-main itself stretches to the grid row, so measure its visible children.)
      const kids = Array.from(main.children).map((c) => c.getBoundingClientRect()).filter((k) => k.height > 0);
      let dy = 0;
      if (kids.length) {
        const top = Math.min(...kids.map((k) => k.top));
        const bottom = Math.max(...kids.map((k) => k.bottom));
        dy = L.computeVerticalShift({ top: top - shiftY, height: bottom - top, vh: window.innerHeight });
      }
      shiftY = Math.round(dy * 2) / 2;
      main.style.top = shiftY === 0 ? '' : `${shiftY}px`;
    }
    if (statsEl) positionStats();
  }

  function scheduleLayout() {
    if (!raf) raf = requestAnimationFrame(layoutNow);
  }

  /* ---------- observers ---------- */

  function onSidebarMutation(records) {
    if (!active) return;
    if (statsEl) renderStats();
    if (edgeR && sideState !== 'docked' && !overlayOpen && (active.page === 'online' || active.page === 'daily')) {
      for (const rec of records) {
        for (const n of rec.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (ATTENTION_RE.test(String(n.className)) || n.querySelector('[class*="draw"], [class*="offer"], [class*="confirm"], [class*="submit"]')) {
            edgeR.classList.add('czm-attention');
            return;
          }
        }
      }
    }
  }

  function observeLayout() {
    if (!resizeObs) {
      resizeObs = new ResizeObserver(scheduleLayout);
      resizeObs.observe(root);
    }
    // The board can mount after we activate at document_start; observe it once it exists.
    for (const el of [q('#board-layout-main'), q(BOARD_SELECTOR)]) {
      if (el && !observedEls.has(el)) {
        observedEls.add(el);
        resizeObs.observe(el);
      }
    }
    const sidebar = q('#board-layout-sidebar');
    if (sidebar !== observedSidebar) {
      if (sidebarObs) sidebarObs.disconnect();
      observedSidebar = sidebar;
      if (sidebar) {
        sidebarObs = sidebarObs || new MutationObserver(onSidebarMutation);
        sidebarObs.observe(sidebar, { childList: true, subtree: true, characterData: true });
      }
    }
  }

  function stopObservers() {
    if (resizeObs) resizeObs.disconnect();
    resizeObs = null;
    observedEls = new WeakSet();
    if (sidebarObs) sidebarObs.disconnect();
    sidebarObs = null;
    observedSidebar = null;
    if (waitObs) waitObs.disconnect();
    waitObs = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ---------- activate / deactivate ---------- */

  function deactivate() {
    active = null;
    stopObservers();
    removeEdges();
    removeStats();
    const main = q('#board-layout-main');
    if (main) { main.style.left = ''; main.style.top = ''; }
    shift = 0;
    shiftY = 0;
    sideState = 'off';
    root.classList.remove('czm-active', ...PAGES.map((m) => `czm-${m}`), 'czm-hide-left', 'czm-hide-right', 'czm-overlay-right');
    VARS.forEach((v) => root.style.removeProperty(v));
  }

  function activate(page) {
    const cfg = current[page];
    const mode = page === 'puzzle' ? P.puzzleMode(location.href) : 'online';
    const changed = !active || active.page !== page || active.mode !== mode;
    active = { page, mode };
    root.classList.add('czm-active');
    PAGES.forEach((m) => root.classList.toggle(`czm-${m}`, m === page));
    root.style.setProperty('--czm-bg', current.bgColor);
    if (changed) { shift = 0; shiftY = 0; }

    if (page === 'puzzle' && cfg.showStats) ensureStats();
    else removeStats();

    observeLayout();
    layoutNow();
    if (statsEl) renderStats();
  }

  /** Reconcile page + settings + viewport into the right state. Idempotent. */
  function apply() {
    const page = P.detectPage(location.href);
    const cfg = page && current[page];
    if (!cfg || !cfg.enabled) {
      reason = page ? 'disabled' : 'unsupported';
      return deactivate();
    }
    if (viewportWidth() < L.MIN_VIEWPORT_WIDTH) {
      reason = 'narrow';
      return deactivate();
    }
    const boardReady = !!(q('#board-layout-main') && q(BOARD_SELECTOR));
    if (!boardReady && document.readyState !== 'loading') {
      reason = 'no-board';
      deactivate();
      waitForBoard();
      return;
    }
    // While the document is still loading we activate straight away (classes + CSS
    // variables only) so the page never paints the original layout first; the board
    // is attached to the observers as soon as it exists.
    reason = boardReady ? 'active' : 'loading';
    activate(page);
    if (!boardReady) waitForBoard();
  }

  /** The board can mount after load; wait for it without polling. */
  function waitForBoard() {
    if (waitObs) return;
    waitObs = new MutationObserver(() => {
      if (q('#board-layout-main') && q(BOARD_SELECTOR)) {
        waitObs.disconnect();
        waitObs = null;
        apply();
      }
    });
    waitObs.observe(root, { childList: true, subtree: true });
  }

  /* ---------- wiring ---------- */

  let lastHref = location.href;
  function onPossibleNavigation() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    apply();
  }

  function init() {
    // Window resizes, zoom and full-screen changes: lay out now and again once the site's own
    // size variables have settled (they update a moment after the viewport changes).
    let settleTimers = [];
    const scheduleSettle = () => {
      scheduleLayout();
      settleTimers.forEach(clearTimeout);
      settleTimers = [150, 500].map((ms) => setTimeout(scheduleLayout, ms));
    };
    window.addEventListener('resize', scheduleSettle, { passive: true });
    document.addEventListener('fullscreenchange', scheduleSettle);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleSettle, { passive: true });
    window.addEventListener('resize', () => {
      if (!active && current[P.detectPage(location.href)]?.enabled) apply();
    }, { passive: true });
    window.addEventListener('popstate', onPossibleNavigation);
    window.addEventListener('hashchange', onPossibleNavigation);
    if (window.navigation && window.navigation.addEventListener) {
      window.navigation.addEventListener('navigatesuccess', onPossibleNavigation);
    }
    const watchTitle = () => {
      const title = document.querySelector('title');
      if (title) new MutationObserver(onPossibleNavigation).observe(title, { childList: true });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { watchTitle(); apply(); }, { once: true });
    } else {
      watchTitle();
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[S.KEY]) return;
      current = S.normalize(changes[S.KEY].newValue);
      writeMirror(current);
      apply();
    });
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'czm:status') {
        const page = P.detectPage(location.href);
        sendResponse({
          page,
          active: !!active,
          reason,
          panelDropped: !!active && sideState === 'dropped',
        });
      }
    });

    // Fast path: last known settings, available synchronously at document_start.
    const early = readMirror();
    if (early) {
      current = early;
      apply();
    }
    // Source of truth: extension storage.
    S.load(chrome.storage.local).then((s) => {
      current = s;
      writeMirror(s);
      apply();
    }).catch(() => { /* storage unavailable: stay inert */ });
  }

  init();
})();
