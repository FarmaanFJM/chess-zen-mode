/* Settings schema, validation and storage helpers. Shared by popup and content script. */
(function (root) {
  'use strict';

  const KEY = 'chessZenSettings';
  const DEFAULT_BG = '#000000';

  const DEFAULTS = Object.freeze({
    online: Object.freeze({ enabled: false, showLeft: false, showRight: false }),
    puzzle: Object.freeze({ enabled: false, showLeft: false, showRight: false, showStats: false }),
    bgColor: DEFAULT_BG,
  });

  function isHexColor(v) {
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  }

  function bool(v, fallback) {
    return typeof v === 'boolean' ? v : fallback;
  }

  /** Coerce arbitrary stored data into a complete, valid settings object. */
  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const o = r.online && typeof r.online === 'object' ? r.online : {};
    const p = r.puzzle && typeof r.puzzle === 'object' ? r.puzzle : {};
    return {
      online: {
        enabled: bool(o.enabled, DEFAULTS.online.enabled),
        showLeft: bool(o.showLeft, DEFAULTS.online.showLeft),
        showRight: bool(o.showRight, DEFAULTS.online.showRight),
      },
      puzzle: {
        enabled: bool(p.enabled, DEFAULTS.puzzle.enabled),
        showLeft: bool(p.showLeft, DEFAULTS.puzzle.showLeft),
        showRight: bool(p.showRight, DEFAULTS.puzzle.showRight),
        showStats: bool(p.showStats, DEFAULTS.puzzle.showStats),
      },
      bgColor: isHexColor(r.bgColor) ? r.bgColor.toLowerCase() : DEFAULT_BG,
    };
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

  const api = { KEY, DEFAULT_BG, DEFAULTS, isHexColor, normalize, load, save, update };
  root.ChessZen = Object.assign(root.ChessZen || {}, { settings: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
