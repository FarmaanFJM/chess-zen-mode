/* Settings schema, validation and storage helpers. Shared by popup and content script. */
(function (root) {
  'use strict';

  const KEY = 'chessZenSettings';
  const DEFAULT_BG = '#000000';

  // Analysis keeps Chess.com's own engine/analysis panel visible by default.
  const DEFAULTS = Object.freeze({
    online: Object.freeze({ enabled: false, showLeft: false, showRight: false }),
    daily: Object.freeze({ enabled: false, showLeft: false, showRight: false }),
    puzzle: Object.freeze({ enabled: false, showLeft: false, showRight: false, showStats: false }),
    analysis: Object.freeze({ enabled: false, showLeft: false, showRight: true }),
    bgColor: DEFAULT_BG,
  });

  const MODES = Object.freeze(['online', 'daily', 'puzzle', 'analysis']);

  function isHexColor(v) {
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  }

  function bool(v, fallback) {
    return typeof v === 'boolean' ? v : fallback;
  }

  /** Coerce arbitrary stored data into a complete, valid settings object. */
  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const out = { bgColor: isHexColor(r.bgColor) ? r.bgColor.toLowerCase() : DEFAULT_BG };
    // Each mode is validated key by key against its own defaults, so older stored
    // settings (missing newer modes) upgrade cleanly and modes never leak into each other.
    for (const mode of MODES) {
      const src = r[mode] && typeof r[mode] === 'object' ? r[mode] : {};
      const mine = {};
      for (const key of Object.keys(DEFAULTS[mode])) mine[key] = bool(src[key], DEFAULTS[mode][key]);
      out[mode] = mine;
    }
    return out;
  }

  async function load(area) {
    const res = await area.get(KEY);
    return normalize(res && res[KEY]);
  }

  async function save(area, settings) {
    await area.set({ [KEY]: normalize(settings) });
  }

  /** Read-modify-write; `mutate` receives a normalized copy and edits it in place. */
  async function update(area, mutate) {
    const current = await load(area);
    mutate(current);
    await save(area, current);
    return normalize(current);
  }

  const api = { KEY, DEFAULT_BG, DEFAULTS, MODES, isHexColor, normalize, load, save, update };
  root.ChessZen = Object.assign(root.ChessZen || {}, { settings: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
