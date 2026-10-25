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
  daily: 'https://www.chess.com/game/daily/1044546360', // in-progress public Daily game (guest sees the play shell only)
  analysis: 'https://www.chess.com/analysis',
  dailyPuzzle: 'https://www.chess.com/daily',
};
const MODE_OF = { online: 'online', daily: 'daily', rated: 'puzzle', rush: 'puzzle', analysis: 'analysis' };
// Matches wc-chess-board (puzzles/play/analysis) and the plain div board some shells use.
const BOARD = '#board-layout-main .board-layout-chessboard .board';

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
function skip(name, reason) {
  results.push({ name, ok: true, skipped: true, detail: reason });
  console.log(`SKIP  ${name}  -- ${reason}`);
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
// Explicit baseline: everything off and every panel hidden (including analysis, whose
// *product* default is visible; that default is tested separately with empty storage).
const S = (o = {}) => ({
  online: { enabled: false, showLeft: false, showRight: false, ...(o.online || {}) },
  daily: { enabled: false, showLeft: false, showRight: false, ...(o.daily || {}) },
  puzzle: { enabled: false, showLeft: false, showRight: false, showStats: false, ...(o.puzzle || {}) },
  analysis: { enabled: false, showLeft: false, showRight: false, ...(o.analysis || {}) },
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
  // Guests get an intro modal on puzzle/analysis pages that blocks hover/clicks on the board area.
  await p.click('button:has-text("Ok")', { timeout: 1500 }).catch(() => {});
  await p.waitForTimeout(500);
  if (url.includes('/analysis')) { // load the real analysis UI (engine toggle + lines)
    await p.click('text=New Analysis', { timeout: 4000 }).catch(() => {});
    await p.waitForSelector('.engine-line-component', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(500);
  }
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
    edges: !!document.querySelector('#czm-edge-left') && !!document.querySelector('#czm-edge-right'),
    overlay: document.documentElement.classList.contains('czm-overlay-right'),
    edgeL: (() => { const r = document.querySelector('#czm-edge-left')?.getBoundingClientRect(); return r && { l: r.left, r: r.right, t: r.top, text: document.querySelector('#czm-edge-left').textContent }; })(),
    edgeR: (() => { const r = document.querySelector('#czm-edge-right')?.getBoundingClientRect(); return r && { l: r.left, r: r.right, t: r.top, text: document.querySelector('#czm-edge-right').textContent }; })(),
    ...(() => { // visible extent of the board block (the main box itself stretches to the grid row)
      const kids = [...(document.querySelector('#board-layout-main')?.children || [])].map((c) => c.getBoundingClientRect()).filter((k) => k.height > 0);
      const top = Math.min(...kids.map((k) => k.top)), bottom = Math.max(...kids.map((k) => k.bottom));
      return { mainTop: top, mainH: bottom - top };
    })(),
    stats: !!document.querySelector('#czm-stats'),
    bodyBg: getComputedStyle(document.documentElement).backgroundColor, // Zen paints the canvas via <html>
    bodyTransparent: getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)',
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
  if (!(await p.$(`${BOARD} .piece`))) return; // placeholder board (guest Daily shell): squareness only
  const t = await p.evaluate((sel) => { const el = [...document.querySelectorAll(`${sel} .piece`)].find((e) => /\bw[pqrnbk]\b/.test(e.className)); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, BOARD);
  await p.mouse.click(t.x, t.y);
  await p.waitForTimeout(400);
  const out = await p.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [...document.querySelectorAll(`${sel} .highlight, ${sel} .hint, ${sel} .capture-hint`)].filter((e) => { const r = e.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1; }).length; }, BOARD);
  ok(out === 0, `${out} overlay elements outside the board`);
  await p.mouse.click(5, 5).catch(() => {});
}
const savedSize = (p) => p.evaluate(() => { try { return localStorage.getItem('json_settings'); } catch (e) { return null; } });

const { execFileSync } = require('child_process');
// Real rendered pixel (not computed style): screenshot the page and read one pixel with PIL.
async function pixelAt(p, x, y) {
  const f = path.join(os.tmpdir(), `czm-px-${process.pid}.png`);
  await p.screenshot({ path: f });
  const out = execFileSync('python3', ['-I', '-c', 'import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert("RGB");print(*i.getpixel((int(sys.argv[2]),int(sys.argv[3]))))', f, String(Math.round(x)), String(Math.round(y))], { encoding: 'utf8' });
  return out.trim().split(' ').map(Number);
}

async function waitSettled(p) { await p.waitForTimeout(500); }

(async () => {
  const ctx = await launch();
  const helper = await ctx.newPage();
  await helper.goto(`chrome-extension://${EXT_ID}/src/popup/popup.html`);

  const pageSets = [['online', URLS.online], ['daily', URLS.daily], ['rated', URLS.rated], ['rush', URLS.rush], ['analysis', URLS.analysis]];
if (process.env.E2E_PAGES) pageSets.splice(0, pageSets.length, ...pageSets.filter(([k]) => process.env.E2E_PAGES.split(',').includes(k))); // debugging aid
  const sizes = [[1920, 1080], [2560, 1440], [1366, 768], [1280, 720]];

  for (const [key, url] of pageSets) {
    const kind = MODE_OF[key];
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
        ok(g.edges, 'both edge toggles should exist');
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
      ok(g.edges && g.edgeR.text === '\u203A', 'right toggle offers to hide the docked panel');
    });
    await check(`[${key}] right panel + 1366x768: still fits and board centered`, async () => {
      await p.setViewportSize({ width: 1366, height: 768 });
      await p.waitForTimeout(500);
      const g = await geom(p);
      ok(g.sideVisible, 'panel visible'); ok(g.side.l >= g.board.r - 0.5, 'no overlap'); ok(g.side.r <= g.vw + 0.5, 'in viewport');
      near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center');
    });
    await check(`[${key}] right panel + very narrow window: board wins, panel offered as an overlay via the edge toggle`, async () => {
      await p.setViewportSize({ width: 1000, height: 800 });
      await p.waitForTimeout(500);
      let g = await geom(p);
      ok(!g.sideVisible && g.edges, 'panel should not cover the board by default');
      near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center');
      await p.click('#czm-edge-right'); await p.waitForTimeout(400);
      g = await geom(p);
      ok(g.sideVisible && g.overlay, 'edge toggle should open the panel as an overlay');
      const saved = await helper.evaluate((k) => chrome.storage.local.get('chessZenSettings').then((r) => r.chessZenSettings[k].showRight), kind);
      ok(saved === true, 'saved setting stays on');
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      ok(!(await geom(p)).sideVisible, 'Esc closes the overlay');
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

    // Quick toggles at the window edges: real open/close controls tied to the saved settings.
    await setSettings(helper, S({ [kind]: { enabled: true } }));
    await waitSettled(p);
    const saved = (k) => helper.evaluate((m) => chrome.storage.local.get('chessZenSettings').then((r) => r.chessZenSettings[m.mode][m.k]), { mode: kind, k });
    await check(`[${key}] right edge toggle opens AND closes the panel and updates the saved setting`, async () => {
      let g = await geom(p);
      const posBefore = { l: g.edgeR.l, t: g.edgeR.t };
      ok(!g.sideVisible && g.edgeR.text === '\u2039', 'starts closed, offers to open');
      await p.click('#czm-edge-right'); await p.waitForTimeout(600);
      g = await geom(p);
      ok(g.sideVisible, 'panel opened'); ok(!g.overlay, 'docked, not overlay');
      ok(g.edgeR.text === '\u203A', 'arrow now offers to close');
      ok(await saved('showRight') === true, 'setting not saved');
      ok(Math.abs(g.edgeR.l - posBefore.l) < 0.5 && Math.abs(g.edgeR.t - posBefore.t) < 0.5, 'toggle must stay where it was');
      near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'board stays centered with panel open');
      await p.click('#czm-edge-right'); await p.waitForTimeout(600);
      g = await geom(p);
      ok(!g.sideVisible && g.edgeR.text === '\u2039', 'panel closed again');
      ok(await saved('showRight') === false, 'setting not saved on close');
      near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center after close');
    });
    await check(`[${key}] left edge toggle shows and hides the sidebar, saves the setting, stays put`, async () => {
      let g = await geom(p);
      const posBefore = { l: g.edgeL.l, t: g.edgeL.t };
      ok(!g.navVisible && g.edgeL.text === '\u203A', 'starts hidden, offers to show');
      await p.click('#czm-edge-left'); await p.waitForTimeout(600);
      g = await geom(p);
      ok(g.navVisible && g.edgeL.text === '\u2039', 'sidebar shown, arrow offers to hide');
      ok(await saved('showLeft') === true, 'setting not saved');
      ok(Math.abs(g.edgeL.l - posBefore.l) < 0.5 && Math.abs(g.edgeL.t - posBefore.t) < 0.5, 'toggle must stay where it was');
      ok(g.board.l >= g.nav.r, 'board clear of sidebar');
      await p.click('#czm-edge-left'); await p.waitForTimeout(600);
      g = await geom(p);
      ok(!g.navVisible && await saved('showLeft') === false, 'sidebar hidden and saved');
    });
    await check(`[${key}] popup switches mirror the edge toggles (and vice versa)`, async () => {
      const pop = await ctx.newPage();
      await pop.goto(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
      const sel = `input[data-path="${kind}.showRight"]`;
      ok(!(await pop.isChecked(sel)), 'popup starts off');
      await p.click('#czm-edge-right'); await p.waitForTimeout(600);
      ok(await pop.isChecked(sel), 'popup did not follow the edge toggle');
      await pop.uncheck(sel, { force: true }); await p.waitForTimeout(600);
      ok(!(await geom(p)).sideVisible, 'edge/page did not follow the popup');
      await pop.close();
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
    if (key === 'daily') skip(`[daily] pieces/overlays align to the board grid and are clickable`, 'guest sees only the play shell (no pieces); needs a logged-in Daily game');
    else await check(`[${key}] pieces/overlays align to the board grid and are clickable`, async () => {
      await p.waitForSelector(`${BOARD} .piece`, { timeout: 15000 }).catch(() => {}); // pieces render asynchronously
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
      if (info.n === 0) {
        const dbg = await p.evaluate((sel) => { const b = document.querySelector(sel); return b ? `${b.tagName} children=${b.children.length} rect=${JSON.stringify(b.getBoundingClientRect())} url=${location.href} cls=${document.documentElement.className}` : 'no board'; }, BOARD);
        await p.screenshot({ path: path.join(os.tmpdir(), `czm-nopieces-${key}.png`) });
        throw new Error(`no pieces found (${dbg})`);
      }
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
      ok(!g.edges && !g.stats, 'injected UI removed');
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

  if (process.env.E2E_STOP_AFTER_PAGES) { console.log('stopped after per-page checks (debug)'); await ctx.close(); process.exit(results.some((r) => !r.ok) ? 1 : 0); }

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
    const kind = MODE_OF[key];
    await setSettings(helper, S());
    const p = await open(ctx, url, { width: 1500, height: 900 });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector(BOARD); await p.waitForTimeout(1500);
    await p.click('button:has-text("Ok")', { timeout: 8000 }).catch(() => {}); // guest intro modal returns after clearing storage (can be slow)
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

  // ---- Full screen / tall windows: the board block re-centers (vertically and horizontally) ----
  for (const [key, url] of [['online', URLS.online], ['rated', URLS.rated], ['analysis', URLS.analysis]]) {
    await check(`[${key}] entering/leaving full screen (taller window) keeps the board centered both ways`, async () => {
      const kind = MODE_OF[key];
      await setSettings(helper, S());
      const p = await open(ctx, url, { width: 1500, height: 900 });
      await p.evaluate(() => localStorage.clear());
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForSelector(BOARD); await p.waitForTimeout(1500);
      await p.click('button:has-text("Ok")', { timeout: 8000 }).catch(() => {});
      if (key === 'analysis') { await p.click('text=New Analysis', { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(1500); }
      await dragResize(p, -220); // a saved native size smaller than the window allows (like a user who resized)
      await setSettings(helper, S({ [kind]: { enabled: true, showRight: false } })); await waitSettled(p);
      const centered = async (label) => {
        const g = await geom(p);
        near((g.board.l + g.board.r) / 2, g.vw / 2, 2, `${label}: horizontal`);
        const topGap = g.mainTop, bottomGap = g.ih - (g.mainTop + g.mainH);
        if (g.ih - g.mainH > 40) near(topGap, bottomGap, 2, `${label}: vertical gap top vs bottom`);
        return g;
      };
      await centered('windowed');
      await p.setViewportSize({ width: 2000, height: 1128 }); // what full screen does
      await p.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')));
      await p.waitForTimeout(900);
      const g = await centered('full screen');
      ok(g.mainTop > 20, `block should have moved down to the middle, top=${g.mainTop}`);
      await p.setViewportSize({ width: 1500, height: 900 }); await p.waitForTimeout(900);
      await centered('back to windowed');
      await p.setViewportSize({ width: 1500, height: 900 });
      await setSettings(helper, S()); await waitSettled(p);
      ok((await p.evaluate(() => document.querySelector('#board-layout-main').style.top)) === '', 'vertical offset removed on disable');
      await p.evaluate(() => localStorage.clear());
      await p.close();
    });
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
    ok(states.length === 13, `expected 13 toggles, got ${states.length}`);
    ok(states.every(([k, c]) => c === (k === 'analysis.showRight')), `defaults are all off except the analysis panel: ${JSON.stringify(states)}`);
    ok((await pop.inputValue('#bg')) === '#000000', 'default color black');
    await pop.close();
  });

  // ---- Analysis Board: Chess.com's own engine panel must be preserved ----
  const ENGINE = {
    toggle: '#board-layout-sidebar input#analysis',
    toggleLabel: '#board-layout-sidebar label.switch-group-label[for="analysis"]',
    lines: '#board-layout-sidebar .engine-line-component',
    evalBar: 'wc-evaluation-bar',
    nav: '#board-layout-sidebar .game-controls-primary-component button',
  };
  const inView = (p, sel, label) => p.evaluate(({ sel, label }) => {
    const els = [...document.querySelectorAll(sel)];
    const el = els.find((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; });
    if (!el) throw new Error(`${label}: not visible`);
    const r = el.getBoundingClientRect();
    if (r.right > document.documentElement.clientWidth + 0.5 || r.left < -0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) throw new Error(`${label}: outside viewport (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`);
    return els.length;
  }, { sel, label });

  await setSettings(helper, S());
  const pa = await open(ctx, URLS.analysis, { width: 1920, height: 1080 });
  const engineChecked = () => pa.evaluate((sel) => document.querySelector(sel)?.checked, ENGINE.toggle);

  await check('[analysis] engine panel is Chess.com\'s own (toggle, lines, eval bar, navigation) before Zen', async () => {
    ok(await engineChecked() === true, 'engine toggle should exist and be on by default for the guest');
    ok((await inView(pa, ENGINE.lines, 'engine lines')) >= 1, 'no engine lines');
    await inView(pa, ENGINE.evalBar, 'eval bar');
    await inView(pa, ENGINE.nav, 'nav buttons');
  });

  await check('[analysis] product defaults: Zen on => analysis panel stays visible, left sidebar hidden, board centered', async () => {
    await helper.evaluate(() => chrome.storage.local.set({ chessZenSettings: { analysis: { enabled: true } } }));
    await pa.waitForTimeout(800);
    const g = await geom(pa);
    ok(g.cls.includes('czm-active') && g.cls.includes('czm-analysis'), `class: ${g.cls}`);
    ok(!g.navVisible, 'left nav hidden by default');
    ok(g.sideVisible && !g.cls.includes('czm-hide-right'), 'analysis panel visible by default');
    ok(g.side.l >= g.board.r - 0.5, 'panel beside board, no overlap');
    near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'board center');
    ok(g.edges, 'edge toggles present');
  });

  await check('[analysis] with Zen on: engine toggle, lines, eval bar and move navigation are visible and in the viewport', async () => {
    ok(await engineChecked() === true, 'engine state unchanged');
    ok((await inView(pa, ENGINE.lines, 'engine lines')) >= 1, 'no engine lines');
    await inView(pa, ENGINE.toggleLabel, 'engine toggle');
    await inView(pa, ENGINE.evalBar, 'eval bar');
    await inView(pa, ENGINE.nav, 'nav buttons');
    const depth = await pa.evaluate(() => document.querySelector('.analysis-options-depth')?.textContent || '');
    ok(/depth=\d+/.test(depth), `engine info line missing: "${depth}"`);
  });

  await check('[analysis] evaluation bar is actually painted in Zen (not hidden behind the Zen background)', async () => {
    await pa.bringToFront(); await pa.waitForTimeout(1500);
    const bar = await pa.evaluate(() => { const r = document.querySelector('.evaluation-bar-fill').getBoundingClientRect(); return { x: r.left + r.width / 2, top: r.top, h: r.height }; });
    const dark = await pixelAt(pa, bar.x, bar.top + 20);          // dark (black-side) part of the bar, near the top
    const light = await pixelAt(pa, bar.x, bar.top + bar.h - 60); // white-side part, near the bottom
    ok(dark[0] > 40 && dark[0] < 100, `dark part of bar not painted: rgb(${dark})`);
    ok(light[0] > 200, `white part of bar not painted: rgb(${light})`);
    const g = await geom(pa);
    ok(g.bodyTransparent, 'body must not paint its own background in Zen');
  });

  await check('[analysis] native engine toggle works in Zen; Zen never flips it', async () => {
    await pa.click(ENGINE.toggleLabel);
    await pa.waitForTimeout(600);
    ok(await engineChecked() === false, 'user could not disable the engine');
    // enabling/disabling Zen and panel changes must not re-enable a disabled engine
    await setSettings(helper, S({ analysis: { enabled: true, showRight: true } })); await waitSettled(pa);
    ok(await engineChecked() === false, 'Zen re-enabled the engine');
    await setSettings(helper, S()); await waitSettled(pa);
    ok(await engineChecked() === false, 'restoring layout re-enabled the engine');
    await setSettings(helper, S({ analysis: { enabled: true, showRight: true } })); await waitSettled(pa);
    ok(await engineChecked() === false, 'enabling Zen re-enabled the engine');
    await pa.click(ENGINE.toggleLabel); await pa.waitForTimeout(800);
    ok(await engineChecked() === true, 'user could not re-enable the engine');
    ok((await inView(pa, ENGINE.lines, 'engine lines')) >= 1, 'lines should come back');
  });

  await check('[analysis] position and variations survive Zen on/off and panel changes', async () => {
    const play = async (from, to) => {
      const b = await pa.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: r.left, t: r.top, sq: r.width / 8 }; }, BOARD);
      const at = ([f, r]) => ({ x: b.l + (f + 0.5) * b.sq, y: b.t + (8 - r + 0.5) * b.sq });
      const a = at(from), c = at(to);
      await pa.mouse.click(a.x, a.y); await pa.waitForTimeout(250);
      await pa.mouse.click(c.x, c.y); await pa.waitForTimeout(700);
    };
    const moves = () => pa.evaluate(() => (document.querySelector('wc-move-list')?.textContent || '').replace(/\s+/g, ' ').trim());
    await setSettings(helper, S()); await waitSettled(pa);
    await play([4, 2], [4, 4]); // e4
    const m1 = await moves();
    ok(/e4/.test(m1), `move not recorded: "${m1}"`);
    await setSettings(helper, S({ analysis: { enabled: true, showRight: true } })); await waitSettled(pa);
    ok(/e4/.test(await moves()), 'move list lost on enabling Zen');
    await play([4, 7], [4, 5]); // ...e5 (alignment of clicks after Zen layout shift)
    ok(/e4.*e5/.test(await moves()), `click-to-move misaligned in Zen: "${await moves()}"`);
    await setSettings(helper, S({ analysis: { enabled: true, showRight: false } })); await waitSettled(pa);
    ok(/e4.*e5/.test(await moves()), 'move list lost when hiding the panel');
    await setSettings(helper, S()); await waitSettled(pa);
    ok(/e4.*e5/.test(await moves()), 'move list lost on disabling Zen');
  });

  await check('[analysis] hidden panel: engine toggle and lines reachable via the edge tab', async () => {
    await setSettings(helper, S({ analysis: { enabled: true, showRight: false } })); await waitSettled(pa);
    let g = await geom(pa);
    ok(!g.sideVisible && g.edges, 'panel should be closed with the edge toggle available');
    await pa.click('#czm-edge-right'); await pa.waitForTimeout(600);
    await inView(pa, ENGINE.toggleLabel, 'engine toggle (opened via edge toggle)');
    await inView(pa, ENGINE.lines, 'engine lines (opened via edge toggle)');
    const before = await engineChecked();
    await pa.click(ENGINE.toggleLabel); await pa.waitForTimeout(500);
    ok((await engineChecked()) === !before, 'toggle inside drawer did nothing');
    await pa.click(ENGINE.toggleLabel); await pa.waitForTimeout(500);
    ok((await engineChecked()) === before, 'could not restore toggle');
    await pa.click('#czm-edge-right'); await pa.waitForTimeout(500);
    ok(!(await geom(pa)).sideVisible, 'edge toggle closes the panel again');
  });

  await check('[analysis] narrow window: panel collapses to the drawer, board stays usable and centered', async () => {
    await setSettings(helper, S({ analysis: { enabled: true, showRight: true } })); await waitSettled(pa);
    await pa.setViewportSize({ width: 1100, height: 800 }); await pa.waitForTimeout(600);
    const g = await geom(pa);
    ok(g.edges && !g.sideVisible, 'should collapse (open on demand via the edge toggle)');
    ok(g.board.w >= 400, `board too small: ${g.board.w}`);
    near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center');
    await pa.click('#czm-edge-right'); await pa.waitForTimeout(400);
    await inView(pa, ENGINE.toggleLabel, 'engine toggle (narrow overlay)');
    await pa.keyboard.press('Escape');
    await pa.setViewportSize({ width: 1920, height: 1080 }); await pa.waitForTimeout(500);
    ok((await geom(pa)).sideVisible, 'panel docks again when the window widens');
  });

  await check('[analysis] original layout restored exactly; engine panel intact', async () => {
    await setSettings(helper, S()); await waitSettled(pa);
    const g = await geom(pa);
    ok(!g.cls.includes('czm-') && g.navVisible && g.sideVisible && !g.edges, `not restored: ${g.cls}`);
    ok((await inView(pa, ENGINE.lines, 'engine lines')) >= 1, 'engine lines missing after restore');
    await inView(pa, ENGINE.toggleLabel, 'engine toggle');
  });
  await pa.close();

  // ---- Fair play: strict page/mode separation ----
  await check('fair play: Analysis Zen never applies to Online/Daily game pages, and game modes never apply to analysis', async () => {
    await setSettings(helper, S({ analysis: { enabled: true, showRight: true } }));
    const p = await ctx.newPage(); await p.setViewportSize({ width: 1600, height: 900 });
    for (const u of [URLS.online, URLS.daily]) {
      await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(3000);
      const cls = await p.evaluate(() => document.documentElement.className);
      ok(!cls.includes('czm-'), `Analysis Zen leaked onto ${u}: ${cls}`);
    }
    await setSettings(helper, S({ online: { enabled: true }, daily: { enabled: true }, puzzle: { enabled: true } }));
    await p.goto(URLS.analysis, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(3000);
    const cls = await p.evaluate(() => document.documentElement.className);
    ok(!cls.includes('czm-'), `game/puzzle Zen leaked onto analysis: ${cls}`);
    await p.close();
  });

  // ---- Mode isolation across every page type (real navigations) ----
  await check('each mode activates only on its own page type (4 modes x 4 pages + Daily Puzzle out of scope)', async () => {
    const p = await ctx.newPage(); await p.setViewportSize({ width: 1600, height: 900 });
    const pages = { online: URLS.online, daily: URLS.daily, puzzle: URLS.rated, analysis: URLS.analysis };
    for (const mode of Object.keys(pages)) {
      await setSettings(helper, S({ [mode]: { enabled: true } }));
      for (const [pageMode, url] of Object.entries(pages)) {
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(2500);
        const cls = await p.evaluate(() => document.documentElement.className);
        const on = cls.includes('czm-active') && cls.includes(`czm-${pageMode}`);
        ok(on === (mode === pageMode), `mode=${mode} page=${pageMode}: ${cls}`);
      }
    }
    await setSettings(helper, S({ online: { enabled: true }, daily: { enabled: true }, puzzle: { enabled: true }, analysis: { enabled: true } }));
    await p.goto(URLS.dailyPuzzle, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(2500);
    ok(!(await p.evaluate(() => document.documentElement.className)).includes('czm-'), '/daily (Daily Puzzle) must stay out of scope');
    await p.close();
  });

  await check('client-side navigation between all four page types switches the active mode without reload', async () => {
    await setSettings(helper, S({ online: { enabled: true }, daily: { enabled: true }, puzzle: { enabled: true }, analysis: { enabled: true } }));
    const p = await open(ctx, URLS.rated, { width: 1600, height: 900 });
    const marker = await p.evaluate(() => (window.__nav = Date.now()));
    for (const [path, mode] of [['/play/online', 'online'], ['/game/185921490914', 'online'], ['/game/daily/1', 'daily'], ['/analysis', 'analysis'], ['/news', null], ['/puzzles/rush', 'puzzle']]) {
      await p.evaluate((x) => history.pushState({}, '', x), path); await p.waitForTimeout(500);
      const cls = await p.evaluate(() => document.documentElement.className);
      const modes = ['online', 'daily', 'puzzle', 'analysis'].filter((m) => cls.includes(`czm-${m}`));
      ok(mode === null ? modes.length === 0 && !cls.includes('czm-active') : modes.length === 1 && modes[0] === mode, `${path}: ${cls}`);
    }
    ok((await p.evaluate(() => window.__nav)) === marker, 'page reloaded');
    await p.close();
  });

  // ---- Flash avoidance: layout is applied before the board is first inserted ----
  await check('no flash: Zen layout is already applied when the board first appears (settings known from a previous visit)', async () => {
    await setSettings(helper, S({ online: { enabled: true }, daily: { enabled: true }, puzzle: { enabled: true }, analysis: { enabled: true, showRight: true } }));
    for (const [name, url] of [['online', URLS.online], ['puzzle', URLS.rated], ['analysis', URLS.analysis], ['daily', URLS.daily]]) {
      const prime = await ctx.newPage(); await prime.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await prime.waitForTimeout(1500); await prime.close();
      const p = await ctx.newPage();
      await p.addInitScript(() => {
        window.__czmProbe = { early: null };
        const mo = new MutationObserver(() => {
          if (window.__czmProbe.early === null && document.querySelector('#board-layout-main')) {
            window.__czmProbe.early = document.documentElement.classList.contains('czm-active') && !!document.documentElement.style.getPropertyValue('--czm-bg');
            mo.disconnect();
          }
        });
        mo.observe(document, { childList: true, subtree: true });
      });
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(2500);
      const early = await p.evaluate(() => window.__czmProbe.early);
      await p.close();
      ok(early === true, `${name}: layout not applied before first board render (early=${early})`);
    }
  });

  // ---- Persistence across a full browser restart: all four modes, visibility prefs, color ----
  const FULL = S({
    online: { enabled: true, showLeft: true, showRight: false },
    daily: { enabled: true, showLeft: false, showRight: true },
    puzzle: { enabled: true, showLeft: false, showRight: false, showStats: true },
    analysis: { enabled: true, showLeft: true, showRight: false },
    bgColor: '#101820',
  });
  await setSettings(helper, FULL);
  await ctx.close();
  const ctx2 = await launch();
  const helper2 = await ctx2.newPage();
  await helper2.goto(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
  await check('stored settings are intact after browser restart (all modes, visibility, stats, color)', async () => {
    const stored = await helper2.evaluate(() => chrome.storage.local.get('chessZenSettings'));
    const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v));
    ok(canon(stored.chessZenSettings) === canon(FULL), `storage differs: ${JSON.stringify(stored)}`);
  });
  for (const [key, url] of [['online', URLS.online], ['daily', URLS.daily], ['rated', URLS.rated], ['analysis', URLS.analysis]]) {
    await check(`[${key}] after restart: Zen auto-activates with the saved visibility, background and centering`, async () => {
      const mode = MODE_OF[key]; const cfg = FULL[mode];
      const p = await open(ctx2, url, { width: 1600, height: 900 });
      await p.waitForTimeout(800);
      const g = await geom(p);
      ok(g.cls.includes('czm-active') && g.cls.includes(`czm-${mode}`), `not applied after restart: ${g.cls}`);
      ok(g.bodyBg === 'rgb(16, 24, 32)', `bg after restart ${g.bodyBg}`);
      ok(g.navVisible === cfg.showLeft, `left sidebar visible=${g.navVisible}, saved=${cfg.showLeft}`);
      ok(g.sideVisible === cfg.showRight, `right panel visible=${g.sideVisible}, saved=${cfg.showRight}`);
      ok(g.stats === !!cfg.showStats, `stats panel=${g.stats}, saved=${!!cfg.showStats}`);
      if (!cfg.showLeft && !cfg.showRight) near((g.board.l + g.board.r) / 2, g.vw / 2, 2, 'center after restart');
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForSelector(BOARD); await p.waitForTimeout(1500);
      ok((await geom(p)).cls.includes(`czm-${mode}`), 'applied after page refresh');
      await p.close();
    });
  }
  await check('settings stay consistent across multiple tabs (live propagation of each mode toggle)', async () => {
    const a = await open(ctx2, URLS.online, { width: 1600, height: 900 });
    const b = await open(ctx2, URLS.online, { width: 1600, height: 900 });
    const d = await open(ctx2, URLS.daily, { width: 1600, height: 900 });
    await setSettings(helper2, S({ online: { enabled: false }, daily: { enabled: true } }));
    await a.waitForTimeout(800);
    for (const t of [a, b]) ok(!(await geom(t)).cls.includes('czm-active'), 'online tabs should turn off together');
    ok((await geom(d)).cls.includes('czm-daily'), 'daily tab stays on');
    await setSettings(helper2, S({ online: { enabled: true }, daily: { enabled: false }, bgColor: '#202020' }));
    await a.waitForTimeout(800); await a.bringToFront(); await a.waitForTimeout(500);
    for (const t of [a, b]) ok((await geom(t)).cls.includes('czm-online'), 'online tabs should turn on together');
    ok(!(await geom(d)).cls.includes('czm-active'), 'daily tab should turn off');
    await a.close(); await b.close(); await d.close();
  });
  await ctx2.close();

  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);
  console.log(`\n${results.length - failed.length - skipped.length}/${results.length - skipped.length} passed, ${skipped.length} skipped (not testable as a guest)`);
  fs.writeFileSync(path.join(os.tmpdir(), 'czm-e2e-results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
