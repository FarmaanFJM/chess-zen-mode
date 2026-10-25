/* Builds dist/chess-zen-mode-v<version>.zip (+ .sha256) from runtime files only. No build step needed. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `chess-zen-mode-v${version}.zip`;
const dist = path.join(root, 'dist');
const out = path.join(dist, name);

// Runtime files only: everything the extension needs, nothing else.
const INCLUDE = ['manifest.json', 'LICENSE', 'src', 'icons'];

fs.mkdirSync(dist, { recursive: true });
fs.rmSync(out, { force: true });
// -X: no extra file attributes, -D: no directory entries; sorted input => stable ordering.
const files = [];
(function walk(rel) {
  const abs = path.join(root, rel);
  if (fs.statSync(abs).isDirectory()) fs.readdirSync(abs).sort().forEach((e) => walk(path.join(rel, e)));
  else files.push(rel);
})('.' + path.sep);
const selected = files
  .map((f) => path.normalize(f))
  .filter((f) => INCLUDE.some((i) => f === i || f.startsWith(i + path.sep)))
  .sort();
execFileSync('zip', ['-X', '-D', '-q', out, ...selected], { cwd: root, stdio: 'inherit' });

const sum = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
fs.writeFileSync(`${out}.sha256`, `${sum}  ${name}\n`);
console.log(`${name}\nsha256 ${sum}`);
execFileSync('node', [path.join(__dirname, 'validate.js'), '--zip', out], { stdio: 'inherit' });
