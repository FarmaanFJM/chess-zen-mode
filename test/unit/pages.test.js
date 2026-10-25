const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPage, puzzleMode } = require('../../src/lib/pages.js');

const C = (p) => `https://www.chess.com${p}`;

test('online pages', () => {
  for (const p of ['/play/online', '/play/online/', '/play/online/new', '/game/live/123456789', '/game/live/123456789?username=x', '/game/live/123456789#x']) {
    assert.equal(detectPage(C(p)), 'online', p);
  }
});

test('puzzle pages', () => {
  for (const p of ['/puzzles', '/puzzles/', '/puzzles/rated', '/puzzles/rush', '/puzzles/rush?mode=survival', '/puzzles/battle', '/puzzles/problem/abc123', '/puzzles/daily', '/puzzles/learning', '/puzzles/12345']) {
    assert.equal(detectPage(C(p)), 'puzzle', p);
  }
});

test('out-of-scope pages are never matched', () => {
  for (const p of [
    '/', '/home', '/news', '/article/view/x', '/lessons', '/learn', '/game-report/live/123', '/openings', '/settings', '/member/someone',
    '/play', '/play/computer', '/games/archive/x', '/game/daily', '/game/daily/abc', '/game/live', '/game/live/abc',
    '/daily', '/analysisx', '/game/analysis', '/game/computer/5',
    '/puzzles/leaderboard', '/puzzlesx', '/play/onlinex', '/live',
  ]) {
    assert.equal(detectPage(C(p)), null, p);
  }
});

test('other hosts / schemes / garbage are not matched', () => {
  assert.equal(detectPage('https://evil.example/play/online'), null);
  assert.equal(detectPage('https://www.chess.com.evil.example/puzzles'), null);
  assert.equal(detectPage('http://www.chess.com/puzzles'), null);
  assert.equal(detectPage('https://chess.com/puzzles'), null);
  assert.equal(detectPage('not a url'), null);
});

test('puzzle modes', () => {
  assert.equal(puzzleMode(C('/puzzles/rush')), 'rush');
  assert.equal(puzzleMode(C('/puzzles/battle')), 'battle');
  assert.equal(puzzleMode(C('/puzzles/rated')), 'rated');
  assert.equal(puzzleMode(C('/puzzles')), 'rated');
  assert.equal(puzzleMode(C('/puzzles/problem/1')), 'rated');
  assert.equal(puzzleMode(C('/puzzles/daily')), 'other');
});

test('daily chess routes', () => {
  for (const p of ['/game/daily/1044546360', '/game/daily/1044546360/', '/game/daily/1044546360?foo=1']) {
    assert.equal(detectPage(C(p)), 'daily', p);
  }
  // /daily is the Daily *Puzzle*, never Daily Chess.
  assert.equal(detectPage(C('/daily')), null);
});

test('analysis board routes', () => {
  for (const p of ['/analysis', '/analysis/', '/analysis?fen=x', '/analysis/game/live/123', '/analysis/game/live/123?tab=review',
    '/analysis/game/daily/1044546360/analysis', '/analysis/library']) {
    assert.equal(detectPage(C(p)), 'analysis', p);
  }
});

test('fair play: game pages and analysis pages are disjoint', () => {
  for (const p of ['/play/online', '/play/online/new', '/game/live/123', '/game/daily/123']) {
    assert.notEqual(detectPage(C(p)), 'analysis', p);
  }
  for (const p of ['/analysis', '/analysis/game/live/123', '/analysis/game/daily/123']) {
    assert.ok(!['online', 'daily'].includes(detectPage(C(p))), p);
  }
  assert.equal(detectPage(C('/game/live/1')), 'online');
  assert.equal(detectPage(C('/game/daily/1')), 'daily');
});
