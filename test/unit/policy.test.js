const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const sources = walk(path.join(root, 'src')).filter((f) => /\.(js|html|css)$/.test(f));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('no network, engine, remote-code or dynamic-eval primitives anywhere in shipped source', () => {
  const banned = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|eval\s*\(|new\s+Function|new\s+Worker|SharedWorker|stockfish|wasm|WebAssembly)\b/i;
  for (const f of sources) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!banned.test(text), `${path.relative(root, f)} contains a banned primitive: ${(text.match(banned) || [])[0]}`);
  }
});

test('no external URLs are referenced by shipped source (other than the chess.com match scope)', () => {
  for (const f of sources) {
    const text = fs.readFileSync(f, 'utf8');
    const urls = text.match(/https?:\/\/[^\s'"`)]+/g) || [];
    for (const u of urls) assert.ok(/^https:\/\/www\.chess\.com\b/.test(u), `${path.relative(root, f)}: ${u}`);
  }
});

test('manifest: MV3, storage only, chess.com only, no background/remote code', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://www.chess.com/*']);
  for (const cs of manifest.content_scripts) assert.deepEqual(cs.matches, ['https://www.chess.com/*']);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.content_security_policy, undefined);
});

test('content script runs at document_start so Zen settings apply before first paint', () => {
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
});

test('popup exposes a toggle for every persisted setting', () => {
  const S = require('../../src/lib/settings.js');
  const html = fs.readFileSync(path.join(root, 'src/popup/popup.html'), 'utf8');
  const paths = [...html.matchAll(/data-path="([^"]+)"/g)].map((m) => m[1]).sort();
  const expected = S.MODES.flatMap((m) => Object.keys(S.DEFAULTS[m]).map((k) => `${m}.${k}`)).sort();
  assert.deepEqual(paths, expected);
});

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('branding: every manifest icon exists, is a PNG of exactly the declared size', () => {
  const declared = { ...manifest.icons, ...manifest.action.default_icon };
  assert.deepEqual(Object.keys(manifest.icons).sort(), ['128', '16', '32', '48']);
  for (const [size, rel] of Object.entries(declared)) {
    assert.match(rel, /^icons\/icon-\d+\.png$/);
    assert.deepEqual(pngSize(path.join(root, rel)), [Number(size), Number(size)], rel);
  }
});

test('branding: the original logo is kept in docs/assets and is square', () => {
  const [w, h] = pngSize(path.join(root, 'docs/assets/chess-zen-mode-logo.png'));
  assert.equal(w, h);
  assert.ok(w >= 512);
});

test('branding: popup header shows the logo, name and tagline', () => {
  const html = fs.readFileSync(path.join(root, 'src/popup/popup.html'), 'utf8');
  assert.match(html, /src="\.\.\/\.\.\/icons\/icon-48\.png"/);
  assert.match(html, /<h1>Chess Zen Mode<\/h1>/);
  assert.match(html, /Focus on the board/);
});
