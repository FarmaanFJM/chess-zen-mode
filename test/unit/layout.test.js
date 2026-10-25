const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/lib/layout.js');

test('no panels: no reserves', () => {
  assert.deepEqual(L.computeReserves({ vw: 1920, vh: 1080 }), { left: 0, right: 0, rightFits: true });
});

test('right panel is mirrored on the left to keep the board centered', () => {
  const r = L.computeReserves({ vw: 1920, vh: 1080, showRight: true });
  assert.equal(r.right, L.PANEL_PREFERRED);
  assert.equal(r.left, r.right);
  assert.ok(r.rightFits);
});

test('left sidebar alone reserves its width; wide right panel still mirrors', () => {
  const a = L.computeReserves({ vw: 1920, vh: 1080, showLeft: true });
  assert.deepEqual(a, { left: L.NAV_WIDTH, right: 0, rightFits: true });
  const b = L.computeReserves({ vw: 1920, vh: 1080, showLeft: true, showRight: true });
  assert.equal(b.left, Math.max(L.NAV_WIDTH, b.right));
});

test('panel shrinks to fit mid-size windows but never below its minimum', () => {
  const r = L.computeReserves({ vw: 1366, vh: 768, showRight: true });
  assert.ok(r.right >= L.PANEL_MIN && r.right < L.PANEL_PREFERRED, String(r.right));
  assert.ok(r.rightFits);
});

test('narrow window: board is prioritized and panel is dropped', () => {
  const r = L.computeReserves({ vw: 1000, vh: 900, showRight: true });
  assert.equal(r.right, 0);
  assert.equal(r.rightFits, false);
  const both = L.computeReserves({ vw: 1000, vh: 900, showLeft: true, showRight: true });
  assert.equal(both.right, 0);
  assert.equal(both.left, L.NAV_WIDTH);
});

test('reserves never exceed what the viewport can hold', () => {
  for (let vw = 960; vw <= 3840; vw += 37) {
    for (const vh of [600, 768, 900, 1080, 1440]) {
      for (const showLeft of [false, true]) {
        const r = L.computeReserves({ vw, vh, showLeft, showRight: true });
        const target = Math.min(800, Math.max(320, vh - 170));
        if (r.rightFits) assert.ok(vw - r.left - r.right - L.BOARD_SLACK >= target, `${vw}x${vh}`);
        assert.ok(r.left >= 0 && r.right >= 0);
      }
    }
  }
});

test('computeShift centers the board on the viewport', () => {
  // 800px board whose left edge is at 100 in a 1920 viewport -> should be at 560.
  assert.equal(L.computeShift({ boardLeft: 100, boardWidth: 800, vw: 1920 }), 460);
  // already centered
  assert.equal(L.computeShift({ boardLeft: 560, boardWidth: 800, vw: 1920 }), 0);
});

test('computeShift never pushes the board under the left sidebar', () => {
  const d = L.computeShift({ boardLeft: 400, boardWidth: 1000, vw: 1200, minLeft: 178 });
  assert.equal(400 + d, 178); // desired left edge 100 is clamped up to the sidebar edge
});

test('computeShift never overlaps a right panel', () => {
  const d = L.computeShift({ boardLeft: 0, boardWidth: 700, vw: 1200, maxRight: 800 });
  assert.ok(0 + d + 700 <= 800);
});

test('analysis gets a wider panel so engine lines stay readable', () => {
  assert.deepEqual(L.panelSize('analysis'), { pref: 460, min: 320 });
  assert.deepEqual(L.panelSize('online'), { pref: L.PANEL_PREFERRED, min: L.PANEL_MIN });
  const a = L.computeReserves({ vw: 1920, vh: 1080, showRight: true, panelPref: 460, panelMin: 320 });
  assert.equal(a.right, 460);
  const narrow = L.computeReserves({ vw: 1100, vh: 800, showRight: true, panelPref: 460, panelMin: 320 });
  assert.equal(narrow.rightFits, false); // falls back to the drawer; board stays usable
});
