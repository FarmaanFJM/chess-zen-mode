/*
 * Browser integration tests against the live Chess.com site as a LOGGED-OUT guest.
 * Requires: Playwright (global or local), its Chromium build, and network access.
 * Not run in CI. See README "Testing". Guest limits: no live game, no logged-in
 * Puzzle Rush, so those paths are only exercised structurally (see report).
 */
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('SKIPPED: Playwright is not installed (npm i -g playwright).');
  process.exit(2);
}

// CZM_EXT_DIR lets the suite run against an unpacked release ZIP instead of the source tree.
const EXT = path.resolve(process.env.CZM_EXT_DIR || path.join(__dirname, '../..'));
const EXT_ID = [...crypto.createHash('sha256').update(EXT).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'czm-e2e-'));
const URLS = {
  online: 'https://www.chess.com/play/online',
  rated: 'https://www.chess.com/puzzles/rated',
  rush: 'https://www.chess.com/puzzles/rush',
  news: 'https://www.chess.com/news',
};
const BOARD = 'wc-chess-board';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}
async function check(name, fn) {
  try {
    const d = await fn();
    record(name, true, typeof d === 'string' ? d : '');
  } catch (e) {
    record(name, false, String(e.message || e).split('\n')[0]);
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(1)} vs ${b.toFixed(1)} (tol ${tol})`);

async function launch() {
  return chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1920, height: 1080 },
  });
}

async function setSettings(helper, s) {
  await helper.evaluate((val) => chrome.storage.local.set({ chessZenSettings: val }), s);
}
const S = (o = {}) => ({
  online: { enabled: false, showLeft: false, showRight: false, ...(o.online || {}) },
  puzzle: { enabled: false, showLeft: false, showRight: false, showStats: false, ...(o.puzzle || {}) },
  bgColor: o.bgColor || '#000000',
});

async function open(ctx, url, vp) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => { if (!/cross-origin frame|adsystem|googlesyndication|doubleclick/i.test(e.message)) p.errors.push(e.message); });
  await p.setViewportSize(vp);
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector(BOARD, { timeout: 30000 });
  await p.waitForTimeout(1500);
  // Guests get an intro modal on puzzle pages that blocks hover/clicks on the board area.
  await p.click('button:has-text("Ok")', { timeout: 1500 }).catch(() => {});
  await p.waitForTimeout(500);
  return p;
}

const geom = (p) => p.evaluate((sel) => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const vis = (el) => !!el && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const nav = document.querySelector('#sidebar-main-menu');
  const side = document.querySelector('#board-layout-sidebar');
  return {
    cls: document.documentElement.className,
    vw: document.documentElement.clientWidth, iw: innerWidth, ih: innerHeight,
    board: r(document.querySelector(sel)),
    navVisible: vis(nav), nav: r(nav),
    sideVisible: vis(side), side: r(side),
    peek: !!document.querySelector('#czm-peek'),
    stats: !!document.querySelector('#czm-stats'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    mainLeftInline: document.querySelector('#board-layout-main')?.style.left || '',
    scrollbar: innerWidth - document.documentElement.clientWidth,
    clocks: [...document.querySelectorAll('.clock-component')].map((c) => r(c)),
    docH: document.documentElement.scrollHeight,
  };
}, BOARD);


// ---- Native board-resize helpers (Chess.com's own drag handle in #board-layout-controls) ----
const boardW = (p) => p.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().width, BOARD);

async function dragResize(p, dx) {
  const c = await p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.right + 16, y: r.bottom - 12 }; }, BOARD);
  await p.mouse.move(c.x, c.y); // hover the controls column so the site reveals the handle
  await p.waitForTimeout(200);
  const h = await p.evaluate(() => { const e = document.querySelector('#board-layout-controls .resize'); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; });
  if (!h) throw new Error('native resize handle not available');
  await p.mouse.move(h.x, h.y);
  await p.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) { await p.mouse.move(h.x + (dx * i) / steps, h.y); await p.waitForTimeout(16); }
  await p.mouse.up();
  await p.waitForTimeout(500);
}

// Pieces sit on the board grid, overlays stay inside the board, board is square.
async function alignment(p) {
  const info = await p.evaluate((sel) => {
    const b = document.querySelector(sel).getBoundingClientRect();
    const sq = b.width / 8;
    const worst = Math.max(0, ...[...document.querySelectorAll(`${sel} .piece`)].map((el) => {
      const m = /square-(\d)(\d)/.exec(el.className); const r = el.getBoundingClientRect();
      const f = +m[1] - 1, rk = +m[2] - 1;
      return Math.min(Math.hypot(r.left - (b.left + f * sq), r.top - (b.top + (7 - rk) * sq)), Math.hypot(r.left - (b.left + (7 - f) * sq), r.top - (b.top + rk * sq)));
    }));
    const sizes = [...document.querySelectorAll(`${sel} .piece`)].map((el) => Math.abs(el.getBoundingClientRect().width - sq));
    return { w: b.width, h: b.height, worst, sizeOff: Math.max(0, ...sizes) };
  }, BOARD);
  ok(Math.abs(info.w - info.h) <= 1.5, `not square: ${info.w}x${info.h}`);
  ok(info.worst < 1.5, `pieces off-grid by ${info.worst.toFixed(2)}px`);
  ok(info.sizeOff < 1.5, `piece size mismatch ${info.sizeOff.toFixed(2)}px`);
  const t = await p.evaluate((sel) => { const el = [...document.querySelectorAll(`${sel} .piece`)].find((e) => /\bw[pqrnbk]\b/.test(e.className)); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, BOARD);
  await p.mouse.click(t.x, t.y);
  await p.waitForTimeout(400);
  const out = await p.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [...document.querySelectorAll(`${sel} .highlight, ${sel} .hint, ${sel} .capture-hint`)].filter((e) => { const r = e.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1; }).length; }, BOARD);
  ok(out === 0, `${out} overlay elements outside the board`);
  await p.mouse.click(5, 5).catch(() => {});
}
const savedSize = (p) => p.evaluate(() => { try { return localStorage.getItem('json_settings'); } catch (e) { return null; } });

async function waitSettled(p) { await p.waitForTimeout(500); }

(async () => {
  const ctx = await launch();
  const helper = await ctx.newPage();
  await helper.goto(`chrome-extension://${EXT_ID}/src/popup/popup.html`);

  const pageSets = [['online', URLS.online], ['rated', URLS.rated], ['rush', URLS.rush]];
  const sizes = [[1920, 1080], [2560, 1440], [1366, 768], [1280, 720]];

  for (const [key, url] of pageSets) {
    const kind = key === 'online' ? 'online' : 'puzzle';
    await setSettings(helper, S());
    const p = await open(ctx, url, { width: 1920, height: 1080 });
    const base = await geom(p);

    await check(`[${key}] untouched while mode is off`, async () => {
      ok(!base.cls.includes('czm-'), `unexpected classes: ${base.cls}`);
      ok(base.navVisible && base.sideVisible, 'nav/sidebar should be visible');
    });

    await setSettings(helper, S({ [kind]: { enabled: true } }));
    await waitSettled(p);

    for (const [w, h] of sizes) {
      await p.setViewportSize({ width: w, height: h });
      await waitSettled(p);
      const g = await geom(p);
      await check(`[${key}] ${w}x${h} board centered, square, in view; panels hidden`, async () => {
        near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'board center vs viewport center');
        near(g.board.w, g.board.h, 1.5, 'aspect');
        ok(g.board.t >= -0.5 && g.board.b <= g.ih + 0.5, `board vertical fit ${g.board.t}..${g.board.b} of ${g.ih}`);
        ok(g.board.l >= 0 && g.board.r <= g.vw, 'board horizontal fit');
        ok(!g.navVisible, 'left nav should be hidden');
        ok(!g.sideVisible, 'right panel should be hidden');
        ok(g.peek, 'panel edge button should exist');
        return `scrollbar=${g.scrollbar}px board=${Math.round(g.board.w)}px`;
      });
    }

    await p.setViewportSize({ width: 1920, height: 1080 });
    await waitSettled(p);

    // Resize while active (continuous-ish).
    await check(`[${key}] stays centered across live resizes`, async () => {
      for (const w of [1700, 1500, 1300, 1100, 1600, 1920]) {
        await p.setViewportSize({ width: w, height: 1000 });
        await p.waitForTimeout(250);
        const g = await geom(p);
        near((g.board.l + g.board.r) / 2, g.vw / 2, 2, `at ${w}px`);
      }
    });
    await p.setViewportSize({ width: 1920, height: 1080 });

    // Zoom-equivalent: 150% / 200% zoom shrinks the CSS viewport.
    await check(`[${key}] zoom-equivalent viewports (150%, 200%) stay centered`, async () => {
      for (const [w, h] of [[1280, 720], [960, 540]]) {
        await p.setViewportSize({ width: w, height: h });
        await p.waitForTimeout(400);
        const g = await geom(p);
        near((g.board.l + g.board.r) / 2, g.vw / 2, 2, `${w}x${h}`);
        ok(g.board.w > 200, 'board still usable');
      }
    });
    await p.setViewportSize({ width: 1920, height: 1080 });
    await waitSettled(p);

    // Left sidebar.
    await setSettings(helper, S({ [kind]: { enabled: true, showLeft: true } }));
    await waitSettled(p);
    await check(`[${key}] left sidebar shown in Zen, board still centered`, async () => {
      const g = await geom(p);
      ok(g.navVisible, 'nav visible'); ok(!g.sideVisible, 'right panel still hidden');
      ok(g.board.l >= g.nav.r, 'board must not overlap nav');
      near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center');
    });
    await check(`[${key}] left sidebar + narrow window: board pushed clear of nav`, async () => {
      await p.setViewportSize({ width: 1100, height: 900 });
      await p.waitForTimeout(500);
      const g = await geom(p);
      ok(g.board.l >= g.nav.r - 0.5, `board.left ${g.board.l} vs nav.right ${g.nav.r}`);
      await p.setViewportSize({ width: 1920, height: 1080 });
    });

    // Right panel.
    await setSettings(helper, S({ [kind]: { enabled: true, showRight: true } }));
    await waitSettled(p);
    await check(`[${key}] right panel shown in Zen, board centered, no overlap`, async () => {
      const g = await geom(p);
      ok(g.sideVisible, 'panel visible'); ok(!g.navVisible, 'nav hidden');
      ok(g.side.l >= g.board.r - 0.5, `panel left ${g.side.l} < board right ${g.board.r}`);
      ok(g.side.r <= g.vw + 0.5, 'panel inside viewport');
      near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center');
      ok(!g.peek, 'edge button removed while panel docked');
    });
    await check(`[${key}] right panel + 1366x768: still fits and board centered`, async () => {
      await p.setViewportSize({ width: 1366, height: 768 });
      await p.waitForTimeout(500);
      const g = await geom(p);
      ok(g.sideVisible, 'panel visible'); ok(g.side.l >= g.board.r - 0.5, 'no overlap'); ok(g.side.r <= g.vw + 0.5, 'in viewport');
      near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center');
    });
    await check(`[${key}] right panel + very narrow window: board wins, panel dropped to drawer`, async () => {
      await p.setViewportSize({ width: 1000, height: 800 });
      await p.waitForTimeout(500);
      const g = await geom(p);
      ok(!g.sideVisible && g.peek, 'panel should fall back to the drawer');
      near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center');
      await p.setViewportSize({ width: 1920, height: 1080 });
    });

    await setSettings(helper, S({ [kind]: { enabled: true, showLeft: true, showRight: true } }));
    await waitSettled(p);
    await check(`[${key}] both panels shown, board centered`, async () => {
      const g = await geom(p);
      ok(g.navVisible && g.sideVisible, 'both visible');
      ok(g.board.l >= g.nav.r && g.side.l >= g.board.r - 0.5, 'no overlap');
      near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center');
    });

    // Drawer (panel hidden) keeps controls reachable.
    await setSettings(helper, S({ [kind]: { enabled: true } }));
    await waitSettled(p);
    await check(`[${key}] hidden panel is reachable via edge drawer; Esc closes`, async () => {
      await p.click('#czm-peek');
      await p.waitForTimeout(400);
      let g = await geom(p);
      ok(g.sideVisible, 'drawer open shows panel');
      const centered = (g.board.l + g.board.r) / 2;
      near(centered, g.vw / 2, 2, 'board does not move while drawer is open');
      await p.keyboard.press('Escape');
      await p.waitForTimeout(400);
      g = await geom(p);
      ok(!g.sideVisible, 'Esc closes drawer');
    });

    await check(`[${key}] background color default + custom, board untouched`, async () => {
      let g = await geom(p);
      ok(g.bodyBg === 'rgb(0, 0, 0)', `default bg ${g.bodyBg}`);
      await setSettings(helper, S({ [kind]: { enabled: true }, bgColor: '#223344' }));
      await waitSettled(p);
      g = await geom(p);
      ok(g.bodyBg === 'rgb(34, 51, 68)', `custom bg ${g.bodyBg}`);
      const boardBg = await p.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundColor, BOARD);
      ok(boardBg !== 'rgb(34, 51, 68)', 'board must not take the zen color');
    });

    // Board overlay alignment: select a piece, verify hints sit on the board grid.
    await setSettings(helper, S({ [kind]: { enabled: true, showRight: true } }));
    await waitSettled(p);
    await check(`[${key}] pieces/overlays align to the board grid and are clickable`, async () => {
      const info = await p.evaluate((sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        const sq = b.width / 8;
        const pieces = [...document.querySelectorAll(`${sel} .piece`)].map((el) => {
          const m = /square-(\d)(\d)/.exec(el.className); const r = el.getBoundingClientRect();
          // flipped boards are fine: compare against either orientation
          const f = +m[1] - 1, rk = +m[2] - 1;
          const exp = [b.left + f * sq, b.top + (7 - rk) * sq];
          const expF = [b.left + (7 - f) * sq, b.top + rk * sq];
          const d = Math.min(Math.hypot(r.left - exp[0], r.top - exp[1]), Math.hypot(r.left - expF[0], r.top - expF[1]));
          return d;
        });
        return { n: pieces.length, worst: Math.max(...pieces) };
      }, BOARD);
      ok(info.n > 0, 'no pieces found');
      ok(info.worst < 1.5, `piece misaligned by ${info.worst.toFixed(2)}px`);
      // Click a piece: the site should draw its selection/hint overlays inside the board.
      const target = await p.evaluate((sel) => {
        const el = [...document.querySelectorAll(`${sel} .piece`)].find((e) => /\bw[pqrnbk]\b/.test(e.className));
        const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, BOARD);
      await p.mouse.click(target.x, target.y);
      await p.waitForTimeout(500);
      const ov = await p.evaluate((sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        const els = [...document.querySelectorAll(`${sel} .highlight, ${sel} .hint, ${sel} .capture-hint`)];
        return { n: els.length, outside: els.filter((e) => { const r = e.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1; }).length };
      }, BOARD);
      ok(ov.outside === 0, `${ov.outside} overlay elements outside board`);
      return `pieces=${info.n} overlays=${ov.n}`;
    });

    if (key === 'online') {
      await check('[online] player bars and clocks visible', async () => {
        const g = await geom(p);
        ok(g.clocks.length >= 2, `clocks found: ${g.clocks.length}`);
        for (const c of g.clocks) ok(c && c.w > 0 && c.l >= 0 && c.r <= g.vw && c.t >= 0 && c.b <= g.ih + 1, 'clock in view');
      });
    }

    // Restore.
    await setSettings(helper, S());
    await waitSettled(p);
    await p.setViewportSize({ width: 1920, height: 1080 });
    await waitSettled(p);
    await check(`[${key}] disabling restores the original layout exactly`, async () => {
      const g = await geom(p);
      ok(!g.cls.includes('czm-'), `classes left behind: ${g.cls}`);
      ok(g.navVisible && g.sideVisible, 'nav and sidebar back');
      ok(!g.peek && !g.stats, 'injected UI removed');
      ok(g.mainLeftInline === '', 'inline offset removed');
      for (const k of ['l', 't', 'w', 'h']) near(g.board[k], base.board[k], 1, `board.${k} vs baseline`);
      const leftover = await p.evaluate(() => document.documentElement.getAttribute('style') || '');
      ok(!/czm/.test(leftover), `inline vars left: ${leftover}`);
    });

    await check(`[${key}] no page errors; page not reloaded by toggling`, async () => {
      ok(p.errors.length === 0, p.errors.join(' | '));
      const marker = await p.evaluate(() => { window.__czmMarker = window.__czmMarker || Date.now(); return window.__czmMarker; });
      await setSettings(helper, S({ [kind]: { enabled: true } })); await waitSettled(p);
      await setSettings(helper, S()); await waitSettled(p);
      const after = await p.evaluate(() => window.__czmMarker);
      ok(after === marker, 'page was reloaded');
    });
    await p.close();
  }

  // ---- Stats panel wiring (synthetic sidebar content) ----
  await check('[puzzle] stats panel: shown/hidden independently, live updates, degrades gracefully', async () => {
    await setSettings(helper, S({ puzzle: { enabled: true, showStats: false } }));
    const p = await open(ctx, URLS.rush, { width: 1920, height: 1080 });
    await waitSettled(p);
    ok(!(await geom(p)).stats, 'no stats panel when setting is off');
    await setSettings(helper, S({ puzzle: { enabled: true, showStats: true } }));
    await waitSettled(p);
    let g = await geom(p);
    ok(g.stats && g.cls.includes('czm-active'), 'panel present, Zen still on');
    const txt = () => p.evaluate(() => document.querySelector('#czm-stats').innerText);
    ok(/No stats available/.test(await txt()), `expected graceful note, got: ${await txt()}`);
    await p.evaluate(() => {
      const side = document.querySelector('#board-layout-sidebar');
      const box = document.createElement('div'); box.id = 'czm-fixture';
      box.innerHTML = '<div class="puzzle-score-display-component"><span class="puzzle-score-display-details">7</span></div>' +
        '<span class="timer-label-component">2:41</span>' +
        '<i class="streak-icon-square-x"></i><i class="streak-icon-square-x-gray"></i><i class="streak-icon-square-x-gray"></i>';
      side.appendChild(box);
    });
    await p.waitForTimeout(400);
    let t = await txt();
    ok(/Solved\s*7/.test(t) && /Mistakes\s*1 \/ 3/.test(t) && /Time\s*2:41/.test(t), `rows: ${t.replace(/\n/g, ' ')}`);
    await p.evaluate(() => { document.querySelector('.puzzle-score-display-details').textContent = '8'; document.querySelector('.timer-label-component').textContent = '2:40'; });
    await p.waitForTimeout(400);
    t = await txt();
    ok(/Solved\s*8/.test(t) && /Time\s*2:40/.test(t), `live update: ${t.replace(/\n/g, ' ')}`);
    const b = await geom(p);
    const sr = await p.evaluate(() => { const r = document.querySelector('#czm-stats').getBoundingClientRect(); return { l: r.left, r: r.right }; });
    ok(sr.r <= b.board.l || sr.l >= b.board.r, 'stats panel must not cover the board');
    await setSettings(helper, S({ puzzle: { enabled: true, showStats: false } }));
    await waitSettled(p);
    g = await geom(p);
    ok(!g.stats && g.cls.includes('czm-active'), 'hiding stats keeps Zen Mode on');
    await setSettings(helper, S());
    await p.close();
  });


  // ---- Native board resizing must keep working: before, during and after Zen Mode ----
  for (const [key, url] of pageSets) {
    const kind = key === 'online' ? 'online' : 'puzzle';
    await setSettings(helper, S());
    const p = await open(ctx, url, { width: 1500, height: 900 });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector(BOARD); await p.waitForTimeout(1500);
    await p.click('button:has-text("Ok")', { timeout: 1500 }).catch(() => {}); // guest intro modal returns after clearing storage
    await p.waitForTimeout(500);
    const cx = async () => { const g = await geom(p); return (g.board.l + g.board.r) / 2 - g.vw / 2; };
    let w0, w1, w2, w3, w4;

    await check(`[${key}] resize works natively BEFORE Zen Mode (control: no extension effect)`, async () => {
      w0 = await boardW(p);
      await dragResize(p, -120);
      w1 = await boardW(p);
      ok(Math.abs(w0 - w1 - 120) <= 10, `expected ~-120, got ${(w1 - w0).toFixed(1)}`);
      await alignment(p);
    });

    await setSettings(helper, S({ [kind]: { enabled: true } }));
    await waitSettled(p);
    await check(`[${key}] enabling Zen keeps the user's chosen size and centers it`, async () => {
      w2 = await boardW(p);
      ok(Math.abs(w2 - w1) <= 8, `size changed by Zen: ${w1} -> ${w2}`);
      near(await cx(), 0, 2, 'center offset');
      await alignment(p);
    });

    await check(`[${key}] resize works WHILE Zen is on: shrink, stays centered, aligned`, async () => {
      await dragResize(p, -100);
      w3 = await boardW(p);
      ok(Math.abs(w2 - w3 - 100) <= 10, `expected ~-100, got ${(w3 - w2).toFixed(1)}`);
      near(await cx(), 0, 2, 'center offset after shrink');
      await alignment(p);
    });
    await check(`[${key}] resize works WHILE Zen is on: grow, stays centered, aligned`, async () => {
      await dragResize(p, 60);
      w4 = await boardW(p);
      ok(Math.abs(w4 - w3 - 60) <= 10, `expected ~+60, got ${(w4 - w3).toFixed(1)}`);
      near(await cx(), 0, 2, 'center offset after grow');
      await alignment(p);
    });
    await check(`[${key}] size persists through panel toggles and resize still works`, async () => {
      await setSettings(helper, S({ [kind]: { enabled: true, showLeft: true, showRight: true } }));
      await waitSettled(p);
      ok((await boardW(p)) <= w4 + 1, 'board must not grow beyond the user size');
      const before = await boardW(p);
      await dragResize(p, -40);
      ok((await boardW(p)) < before - 20, 'resize did nothing with panels shown');
      near(await cx(), 0, 3, 'center offset');
      await alignment(p);
      await setSettings(helper, S({ [kind]: { enabled: true } }));
      await waitSettled(p);
      near(await cx(), 0, 2, 'center offset after hiding panels');
    });
    await check(`[${key}] window resize + zoom-equivalent keep the user size (when it fits) and the center`, async () => {
      const before = await boardW(p);
      await p.setViewportSize({ width: 1700, height: 900 }); await p.waitForTimeout(400);
      ok(Math.abs((await boardW(p)) - before) <= 8, 'size changed by widening the window');
      near(await cx(), 0, 2, 'center after widen');
      await p.setViewportSize({ width: 1100, height: 700 }); await p.waitForTimeout(400);
      near(await cx(), 0, 2, 'center after shrink');
      await alignment(p);
      await p.setViewportSize({ width: 1500, height: 900 }); await p.waitForTimeout(400);
    });
    await check(`[${key}] Zen never writes board size itself (no inline width/--modifiedBoardWidth from the extension)`, async () => {
      const before = await p.evaluate(() => document.body.style.getPropertyValue('--modifiedBoardWidth'));
      await setSettings(helper, S()); await waitSettled(p);
      await setSettings(helper, S({ [kind]: { enabled: true } })); await waitSettled(p);
      const after = await p.evaluate(() => document.body.style.getPropertyValue('--modifiedBoardWidth'));
      ok(before === after, `--modifiedBoardWidth changed by toggling: ${before} -> ${after}`);
      const boardStyle = await p.evaluate((sel) => document.querySelector(sel).getAttribute('style') || '', BOARD);
      ok(!/czm/.test(boardStyle), 'extension touched the board element style');
    });

    await setSettings(helper, S());
    await waitSettled(p);
    await check(`[${key}] after disabling Zen, native resize still works and layout is the original`, async () => {
      const g = await geom(p);
      ok(!g.cls.includes('czm-') && g.navVisible && g.sideVisible, 'original layout not restored');
      const before = await boardW(p);
      await dragResize(p, -50);
      const after = await boardW(p);
      ok(Math.abs(before - after - 50) <= 10, `expected ~-50, got ${(after - before).toFixed(1)}`);
      await alignment(p);
    });
    await check(`[${key}] size chosen in Zen is remembered when Zen is switched back on`, async () => {
      await setSettings(helper, S({ [kind]: { enabled: true } })); await waitSettled(p);
      const w = await boardW(p);
      near(await cx(), 0, 2, 'center');
      ok(w > 100 && Math.abs(w - (await boardW(p))) < 1, 'unstable');
      await setSettings(helper, S()); await waitSettled(p);
    });
    await p.evaluate(() => localStorage.clear());
    ok(p.errors.length === 0, p.errors.join('|'));
    await p.close();
  }

  // ---- Scope, navigation, tabs, popup, persistence ----
  await check('out-of-scope pages are untouched even with both modes on', async () => {
    await setSettings(helper, S({ online: { enabled: true }, puzzle: { enabled: true } }));
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 1600, height: 900 });
    for (const u of [URLS.news, 'https://www.chess.com/']) {
      await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(2500);
      const cls = await p.evaluate(() => document.documentElement.className);
      ok(!cls.includes('czm-'), `${u} got ${cls}`);
    }
    await p.close();
  });

  await check('only the relevant mode activates (mode isolation across tabs)', async () => {
    await setSettings(helper, S({ online: { enabled: false }, puzzle: { enabled: true } }));
    const a = await open(ctx, URLS.online, { width: 1600, height: 900 });
    const b = await open(ctx, URLS.rated, { width: 1600, height: 900 });
    await a.waitForTimeout(800);
    ok(!(await geom(a)).cls.includes('czm-active'), 'online tab must stay normal');
    ok((await geom(b)).cls.includes('czm-active'), 'puzzle tab must be zen');
    await setSettings(helper, S({ online: { enabled: true }, puzzle: { enabled: false } }));
    await a.waitForTimeout(800);
    ok((await geom(a)).cls.includes('czm-active'), 'online tab now zen');
    ok(!(await geom(b)).cls.includes('czm-active'), 'puzzle tab now normal');
    await a.close(); await b.close();
  });

  await check('client-side navigation: leaving and returning toggles Zen without reload', async () => {
    await setSettings(helper, S({ puzzle: { enabled: true } }));
    const p = await open(ctx, URLS.rated, { width: 1600, height: 900 });
    ok((await geom(p)).cls.includes('czm-active'), 'active on /puzzles/rated');
    await p.evaluate(() => history.pushState({}, '', '/news'));
    await p.waitForTimeout(600);
    ok(!(await geom(p)).cls.includes('czm-active'), 'inactive after SPA nav to unsupported path');
    await p.evaluate(() => history.pushState({}, '', '/puzzles/rated'));
    await p.waitForTimeout(600);
    ok((await geom(p)).cls.includes('czm-active'), 'active again after SPA nav back');
    await p.close();
  });

  await check('popup UI toggles take effect immediately on the open tab', async () => {
    await setSettings(helper, S());
    const p = await open(ctx, URLS.rated, { width: 1600, height: 900 });
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
    await pop.check('input[data-path="puzzle.enabled"]', { force: true });
    await p.waitForTimeout(600);
    let g = await geom(p);
    ok(g.cls.includes('czm-active') && !g.navVisible, 'zen applied after popup toggle');
    await pop.check('input[data-path="puzzle.showLeft"]', { force: true });
    await p.waitForTimeout(600);
    ok((await geom(p)).navVisible, 'left sidebar shown via popup');
    await pop.fill('#bg', '#112233');
    await p.waitForTimeout(500);
    await p.bringToFront();
    await p.waitForTimeout(500);
    { const bg = (await geom(p)).bodyBg; ok(bg === 'rgb(17, 34, 51)', 'color picker applied, got ' + bg); }
    await pop.bringToFront();
    await pop.click('#reset');
    await p.bringToFront();
    await p.waitForTimeout(800);
    { const bg = (await geom(p)).bodyBg; ok(bg === 'rgb(0, 0, 0)', 'reset to black, got ' + bg); }
    await pop.close(); await p.close();
  });

  await check('popup renders defaults for a fresh profile and reports page status', async () => {
    await helper.evaluate(() => chrome.storage.local.clear());
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
    await pop.waitForTimeout(300);
    const states = await pop.$$eval('input[data-path]', (els) => els.map((e) => [e.dataset.path, e.checked]));
    ok(states.every(([, c]) => c === false), `all off by default: ${JSON.stringify(states)}`);
    ok((await pop.inputValue('#bg')) === '#000000', 'default color black');
    await pop.close();
  });

  // Persistence across a full browser restart.
  await setSettings(helper, S({ puzzle: { enabled: true, showStats: true }, bgColor: '#101820' }));
  await ctx.close();
  const ctx2 = await launch();
  await check('settings persist across browser restart and apply on load', async () => {
    const p = await open(ctx2, URLS.rated, { width: 1600, height: 900 });
    await p.waitForTimeout(800);
    const g = await geom(p);
    ok(g.cls.includes('czm-active') && g.stats, `not applied after restart: ${g.cls}`);
    ok(g.bodyBg === 'rgb(16, 24, 32)', `bg after restart ${g.bodyBg}`);
    near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center after restart');
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector(BOARD); await p.waitForTimeout(1500);
    ok((await geom(p)).cls.includes('czm-active'), 'applied after page refresh');
  });
  await ctx2.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.writeFileSync(path.join(os.tmpdir(), 'czm-e2e-results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
