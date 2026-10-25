/* Validates manifest.json and that every file it references exists. Dir or ZIP via --zip. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const zipArg = process.argv.indexOf('--zip');
const zipPath = zipArg > -1 ? path.resolve(process.argv[zipArg + 1]) : null;

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

let listing; let readManifest;
if (zipPath) {
  listing = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).split('\n').filter(Boolean);
  readManifest = () => execFileSync('unzip', ['-p', zipPath, 'manifest.json'], { encoding: 'utf8' });
} else {
  listing = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      e.isDirectory() ? walk(p) : listing.push(path.relative(root, p));
    }
  })(root);
  // Only the runtime set ships; repo-level dev files are irrelevant here.
  listing = listing.filter((f) => ['manifest.json', 'LICENSE'].includes(f) || /^(src|icons)\//.test(f));
  readManifest = () => fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
}
const has = (f) => listing.includes(f);

if (!has('manifest.json')) fail('manifest.json must be at the archive root');
let m;
try { m = JSON.parse(readManifest()); } catch (e) { fail('manifest.json is not valid JSON: ' + e.message); }

if (m.manifest_version !== 3) fail('manifest_version must be 3');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (m.version !== pkg.version) fail(`manifest version ${m.version} != package.json ${pkg.version}`);
if (!/^\d+(\.\d+){0,3}$/.test(m.version)) fail('invalid version string');

const perms = m.permissions || [];
if (perms.some((p) => p !== 'storage')) fail('unexpected permissions: ' + perms.join(','));
const hosts = [...(m.host_permissions || []), ...m.content_scripts.flatMap((c) => c.matches)];
if (hosts.some((h) => h !== 'https://www.chess.com/*')) fail('host access must be limited to https://www.chess.com/*');

const refs = [
  ...m.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  m.action && m.action.default_popup,
  ...Object.values((m.action && m.action.default_icon) || {}),
  ...Object.values(m.icons || {}),
].filter(Boolean);
for (const r of refs) if (!has(r)) fail('referenced file missing: ' + r);

// popup.html -> its local script/style references
const popupHtml = zipPath
  ? execFileSync('unzip', ['-p', zipPath, m.action.default_popup], { encoding: 'utf8' })
  : fs.readFileSync(path.join(root, m.action.default_popup), 'utf8');
for (const [, ref] of popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(m.action.default_popup), ref));
  if (!has(resolved)) fail(`popup references missing file: ${resolved}`);
}

const banned = listing.filter((f) => /(^|\/)(node_modules|test|scripts|dist|\.git)(\/|$)|\.(map|log)$|\.DS_Store$|package(-lock)?\.json$/.test(f));
if (banned.length) fail('development files in package: ' + banned.join(', '));

console.log(`OK: ${zipPath ? 'zip' : 'directory'} valid (v${m.version}, ${listing.length} files, ${refs.length} references checked)`);
