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

test('defaults: both modes off, panels hidden, black background', () => {
  const d = S.normalize(undefined);
  assert.deepEqual(d, {
    online: { enabled: false, showLeft: false, showRight: false },
    puzzle: { enabled: false, showLeft: false, showRight: false, showStats: false },
    bgColor: '#000000',
  });
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
