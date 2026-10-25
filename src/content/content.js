/* Chess Zen Mode content script: applies/removes the Zen layout on supported pages. */
(function () {
  'use strict';

  if (window.__chessZenLoaded) return; // never initialize twice
  window.__chessZenLoaded = true;

  const { settings: S, pages: P, layout: L, stats: ST } = globalThis.ChessZen;
  const root = document.documentElement;
  const VARS = ['--czm-bg', '--czm-left', '--czm-right', '--czm-drawer-w'];
  const BOARD_SELECTOR = '#board-layout-main wc-chess-board, #board-layout-main .board-layout-chessboard .board';
  const ATTENTION_RE = /(?:^|[\s_-])(?:draw|offer)s?(?:[\s_-]|$)/i;

  let current = S.normalize(null);
  let active = null; // { page, mode } while Zen Mode is applied
  let reason = 'disabled';
  let shift = 0;
  let raf = 0;
  let resizeObs = null;
  let sidebarObs = null;
  let observedSidebar = null;
  let peekBtn = null;
  let statsEl = null;
  let waitObs = null;

  const q = (sel) => document.querySelector(sel);

  /* ---------- injected UI ---------- */

  function ensurePeek() {
    if (peekBtn) return;
    peekBtn = document.createElement('button');
    peekBtn.id = 'czm-peek';
    peekBtn.type = 'button';
    peekBtn.textContent = '‹';
    peekBtn.title = 'Show game panel (Chess Zen Mode)';
    peekBtn.setAttribute('aria-label', 'Show game panel');
    peekBtn.addEventListener('click', onPeekClick);
    document.body.appendChild(peekBtn);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onOutsideDown, true);
  }

  function removePeek() {
    if (!peekBtn) return;
    peekBtn.remove();
    peekBtn = null;
    root.classList.remove('czm-peek');
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('mousedown', onOutsideDown, true);
  }

  function setPeek(open) {
    root.classList.toggle('czm-peek', open);
    if (peekBtn) {
      peekBtn.textContent = open ? '›' : '‹';
      peekBtn.classList.remove('czm-attention');
    }
  }

  function onPeekClick() {
    setPeek(!root.classList.contains('czm-peek'));
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && root.classList.contains('czm-peek')) setPeek(false);
  }

  function onOutsideDown(e) {
    if (!root.classList.contains('czm-peek')) return;
    const panel = q('#board-layout-sidebar');
    if (panel && !panel.contains(e.target) && e.target !== peekBtn) setPeek(false);
  }

  function ensureStats() {
    if (statsEl) return;
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
    const panelShown = sidebar && !root.classList.contains('czm-hide-right');
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
    const vw = root.clientWidth;
    if (vw < L.MIN_VIEWPORT_WIDTH) return apply();

    const nav = q('#sidebar-main-menu');
    const navW = cfg.showLeft && nav && nav.getBoundingClientRect().width > 0
      ? nav.getBoundingClientRect().width
      : L.NAV_WIDTH;
    const res = L.computeReserves({ vw, vh: window.innerHeight, showLeft: cfg.showLeft, showRight: cfg.showRight, navW });
    const showRight = cfg.showRight && res.rightFits;

    root.classList.toggle('czm-hide-left', !cfg.showLeft);
    root.classList.toggle('czm-hide-right', !showRight);
    root.style.setProperty('--czm-left', `${res.left}px`);
    root.style.setProperty('--czm-right', `${res.right}px`);
    root.style.setProperty('--czm-drawer-w', `${Math.min(L.PANEL_PREFERRED, Math.round(vw * 0.92))}px`);
    if (showRight) removePeek();
    else ensurePeek();

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
    if (peekBtn && !root.classList.contains('czm-peek') && active.page === 'online') {
      for (const rec of records) {
        for (const n of rec.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (ATTENTION_RE.test(String(n.className)) || n.querySelector('[class*="draw"], [class*="offer"]')) {
            peekBtn.classList.add('czm-attention');
            return;
          }
        }
      }
    }
  }

  function observeLayout() {
    if (!resizeObs) {
      resizeObs = new ResizeObserver(scheduleLayout);
      const main = q('#board-layout-main');
      if (main) resizeObs.observe(main);
      const board = q(BOARD_SELECTOR);
      if (board) resizeObs.observe(board);
      resizeObs.observe(root);
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
    removePeek();
    removeStats();
    const main = q('#board-layout-main');
    if (main) main.style.left = '';
    shift = 0;
    root.classList.remove('czm-active', 'czm-online', 'czm-puzzle', 'czm-hide-left', 'czm-hide-right', 'czm-peek');
    VARS.forEach((v) => root.style.removeProperty(v));
  }

  function activate(page) {
    const cfg = current[page];
    const mode = page === 'puzzle' ? P.puzzleMode(location.href) : 'online';
    const changed = !active || active.page !== page || active.mode !== mode;
    active = { page, mode };
    root.classList.add('czm-active');
    root.classList.toggle('czm-online', page === 'online');
    root.classList.toggle('czm-puzzle', page === 'puzzle');
    root.style.setProperty('--czm-bg', current.bgColor);
    if (changed) shift = 0;

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
    if (root.clientWidth < L.MIN_VIEWPORT_WIDTH) {
      reason = 'narrow';
      return deactivate();
    }
    if (!q('#board-layout-main') || !q(BOARD_SELECTOR)) {
      reason = 'no-board';
      deactivate();
      waitForBoard();
      return;
    }
    reason = 'active';
    activate(page);
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
    waitObs.observe(document.body || root, { childList: true, subtree: true });
  }

  /* ---------- wiring ---------- */

  let lastHref = location.href;
  function onPossibleNavigation() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    apply();
  }

  function init() {
    window.addEventListener('resize', scheduleLayout, { passive: true });
    window.addEventListener('resize', () => {
      if (!active && current[P.detectPage(location.href)]?.enabled) apply();
    }, { passive: true });
    window.addEventListener('popstate', onPossibleNavigation);
    window.addEventListener('hashchange', onPossibleNavigation);
    if (window.navigation && window.navigation.addEventListener) {
      window.navigation.addEventListener('navigatesuccess', onPossibleNavigation);
    }
    const title = document.querySelector('title');
    if (title) new MutationObserver(onPossibleNavigation).observe(title, { childList: true });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[S.KEY]) return;
      current = S.normalize(changes[S.KEY].newValue);
      apply();
    });
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'czm:status') {
        const page = P.detectPage(location.href);
        const sideHidden = root.classList.contains('czm-hide-right');
        sendResponse({
          page,
          active: !!active,
          reason,
          panelDropped: !!(active && current[active.page].showRight && sideHidden),
        });
      }
    });

    S.load(chrome.storage.local).then((s) => {
      current = s;
      apply();
    }).catch(() => { /* storage unavailable: stay inert */ });
  }

  init();
})();
