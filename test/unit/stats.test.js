const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStats } = require('../../src/lib/stats.js');

const snap = (o = {}) => ({ timers: [], scores: [], ratings: [], streaks: [], strikesUsed: 0, strikesTotal: 0, ...o });

test('rush: solved, mistakes and time are copied from the page', () => {
  const { rows } = buildStats(snap({ scores: ['12'], timers: ['2:41'], strikesUsed: 1, strikesTotal: 3 }), 'rush');
  assert.deepEqual(rows.map((r) => [r.key, r.value]), [['solved', '12'], ['mistakes', '1 / 3'], ['time', '2:41']]);
});

test('rush: zero is a valid value, missing data produces no row', () => {
  const { rows } = buildStats(snap({ scores: ['0'] }), 'rush');
  assert.deepEqual(rows.map((r) => [r.key, r.value]), [['solved', '0']]);
});

test('malformed text is rejected rather than displayed', () => {
  const { rows } = buildStats(snap({ scores: ['abc', '12px'], timers: ['soon', '5'], ratings: ['n/a'] }), 'rush');
  assert.deepEqual(rows, []);
});

test('rated: rating, streak and time', () => {
  const { rows } = buildStats(snap({ ratings: ['1520'], streaks: ['4'], timers: ['0:23'] }), 'rated');
  assert.deepEqual(rows.map((r) => r.key), ['rating', 'streak', 'time']);
});

test('no snapshot / unknown mode degrades to nothing', () => {
  assert.deepEqual(buildStats(null, 'rush').rows, []);
  assert.deepEqual(buildStats(snap({ scores: ['3'] }), 'other').rows, []);
});
