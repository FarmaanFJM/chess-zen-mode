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
    '/', '/home', '/news', '/article/view/x', '/lessons', '/learn', '/analysis', '/analysis/game/live/123',
    '/analysis/game/live/123?tab=review', '/game-report/live/123', '/openings', '/settings', '/member/someone',
    '/play', '/play/computer', '/games/archive/x', '/game/daily/123', '/game/live', '/game/live/abc',
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
