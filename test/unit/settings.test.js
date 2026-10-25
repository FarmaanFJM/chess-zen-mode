const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/lib/settings.js');

function fakeArea(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
    set: async (o) => Object.assign(store, structuredClone(o)),
  };
}

test('defaults: all four modes off, panels hidden (analysis panel visible), black background', () => {
  const d = S.normalize(undefined);
  assert.deepEqual(d, {
    online: { enabled: false, showLeft: false, showRight: false },
    daily: { enabled: false, showLeft: false, showRight: false },
    puzzle: { enabled: false, showLeft: false, showRight: false, showStats: false },
    analysis: { enabled: false, showLeft: false, showRight: true },
    bgColor: '#000000',
  });
});

test('settings saved by an earlier build (no daily/analysis) upgrade cleanly', () => {
  const old = { online: { enabled: true, showLeft: true, showRight: false }, puzzle: { enabled: true, showLeft: false, showRight: true, showStats: true }, bgColor: '#123456' };
  const s = S.normalize(old);
  assert.deepEqual(s.online, old.online);
  assert.deepEqual(s.puzzle, old.puzzle);
  assert.equal(s.bgColor, '#123456');
  assert.deepEqual(s.daily, S.DEFAULTS.daily);
  assert.deepEqual(s.analysis, S.DEFAULTS.analysis);
});

test('all four modes persist independently, including visibility prefs and color', async () => {
  const area = fakeArea();
  for (const mode of S.MODES) {
    await S.update(area, (s) => { s[mode].enabled = true; s[mode].showLeft = true; s[mode].showRight = mode !== 'analysis'; });
    const s = await S.load(area);
    for (const other of S.MODES) {
      const expectOn = S.MODES.indexOf(other) <= S.MODES.indexOf(mode);
      assert.equal(s[other].enabled, expectOn, `${other} after enabling ${mode}`);
    }
  }
  await S.update(area, (s) => { s.puzzle.showStats = true; s.bgColor = '#abcdef'; });
  // simulated restart: a fresh load from the same storage area
  const s = await S.load(area);
  assert.deepEqual(s.online, { enabled: true, showLeft: true, showRight: true });
  assert.deepEqual(s.daily, { enabled: true, showLeft: true, showRight: true });
  assert.deepEqual(s.puzzle, { enabled: true, showLeft: true, showRight: true, showStats: true });
  assert.deepEqual(s.analysis, { enabled: true, showLeft: true, showRight: false });
  assert.equal(s.bgColor, '#abcdef');
  // turning one mode off leaves the others alone
  await S.update(area, (x) => { x.daily.enabled = false; });
  const t = await S.load(area);
  assert.equal(t.daily.enabled, false);
  assert.equal(t.online.enabled && t.puzzle.enabled && t.analysis.enabled, true);
});

test('normalize rejects junk and keeps valid values', () => {
  const s = S.normalize({
    online: { enabled: 'yes', showLeft: true },
    puzzle: null,
    bgColor: 'red',
    extra: 1,
  });
  assert.equal(s.online.enabled, false);
  assert.equal(s.online.showLeft, true);
  assert.equal(s.puzzle.enabled, false);
  assert.equal(s.bgColor, '#000000');
  assert.equal('extra' in s, false);
});

test('bgColor accepts #rrggbb only and lowercases it', () => {
  assert.equal(S.normalize({ bgColor: '#1A2B3C' }).bgColor, '#1a2b3c');
  for (const bad of ['#fff', 'rgb(0,0,0)', '#12345g', 42, '']) {
    assert.equal(S.normalize({ bgColor: bad }).bgColor, '#000000');
  }
});

test('modes are independent', async () => {
  const area = fakeArea();
  await S.update(area, (s) => { s.online.enabled = true; });
  const s = await S.load(area);
  assert.equal(s.online.enabled, true);
  assert.equal(s.puzzle.enabled, false);
});

test('settings persist across load (simulated restart) and survive corrupt storage', async () => {
  const area = fakeArea();
  await S.update(area, (s) => { s.puzzle.showStats = true; s.bgColor = '#222222'; });
  const again = await S.load(area);
  assert.equal(again.puzzle.showStats, true);
  assert.equal(again.bgColor, '#222222');
  const corrupt = fakeArea({ [S.KEY]: 'garbage' });
  assert.deepEqual(await S.load(corrupt), S.normalize(null));
});
