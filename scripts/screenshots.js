/*
 * Captures the README screenshots from the real extension running in Chromium on real
 * Chess.com guest pages. Output: docs/screenshots/*.png (identical 1600x900 viewport for
 * every before/after pair). Needs Playwright + network. Not part of the release ZIP.
 */
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '..');
const OUT = path.join(EXT, 'docs', 'screenshots');
const EXT_ID = [...crypto.createHash('sha256').update(EXT).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const VP = { width: 1600, height: 900 };
const OFF = { online: { enabled: false }, daily: { enabled: false }, puzzle: { enabled: false }, analysis: { enabled: false } };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'czm-shot-')), {
    channel: 'chromium', headless: true, viewport: VP,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const helper = await ctx.newPage();
  await helper.goto(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
  const set = (s) => helper.evaluate((v) => chrome.storage.local.set({ chessZenSettings: v }), s);

  async function shoot(name, url, prepare, mode) {
    await set(OFF);
    const p = await ctx.newPage();
    await p.setViewportSize(VP);
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(6000);
    await p.click('button:has-text("Ok")', { timeout: 2000 }).catch(() => {});
    if (prepare) await prepare(p);
    await p.mouse.move(2, 2);
    await p.waitForTimeout(1200);
    await p.screenshot({ path: path.join(OUT, `${name}-before.png`) });
    await set({ ...OFF, [mode]: { enabled: true } });
    await p.bringToFront();
    await p.mouse.move(2, 2);
    await p.waitForTimeout(2500);
    await p.screenshot({ path: path.join(OUT, `${name}-zen.png`) });
    await p.close();
  }

  await shoot('online', 'https://www.chess.com/play/online', null, 'online');
  await shoot('puzzles', 'https://www.chess.com/puzzles/rated', null, 'puzzle');
  await shoot('analysis', 'https://www.chess.com/analysis', async (p) => {
    await p.click('text=New Analysis', { timeout: 4000 });
    await p.waitForSelector('.engine-line-component', { timeout: 20000 });
    await p.waitForTimeout(3000); // let the engine settle on its lines
  }, 'analysis');

  // The real popup, with a few modes switched on to show the independent controls.
  await set({
    online: { enabled: true, showLeft: false, showRight: false },
    daily: { enabled: false, showLeft: false, showRight: false },
    puzzle: { enabled: true, showLeft: false, showRight: false, showStats: false },
    analysis: { enabled: true, showLeft: false, showRight: true },
    bgColor: '#000000',
  });
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 310, height: 760 });
  await pop.goto(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
  await pop.waitForTimeout(600);
  const h = await pop.evaluate(() => document.documentElement.scrollHeight);
  await pop.setViewportSize({ width: 310, height: h });
  await pop.screenshot({ path: path.join(OUT, 'extension-popup.png') });
  await ctx.close();
})();
