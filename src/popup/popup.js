(function () {
  'use strict';

  const S = globalThis.ChessZen.settings;
  const area = chrome.storage.local;
  const statusEl = document.getElementById('status');
  const colorEl = document.getElementById('bg');
  const inputs = Array.from(document.querySelectorAll('input[data-path]'));

  function get(obj, path) {
    return path.split('.').reduce((o, k) => o[k], obj);
  }
  function set(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
  }

  function render(settings) {
    for (const el of inputs) el.checked = get(settings, el.dataset.path);
    if (document.activeElement !== colorEl) colorEl.value = settings.bgColor;
  }

  inputs.forEach((el) => el.addEventListener('change', () => {
    S.update(area, (s) => set(s, el.dataset.path, el.checked)).then(render).then(refreshStatus);
  }));

  let colorTimer = 0;
  colorEl.addEventListener('input', () => {
    clearTimeout(colorTimer);
    colorTimer = setTimeout(() => S.update(area, (s) => { s.bgColor = colorEl.value; }), 60);
  });
  document.getElementById('reset').addEventListener('click', () => {
    colorEl.value = S.DEFAULT_BG;
    S.update(area, (s) => { s.bgColor = S.DEFAULT_BG; });
  });

  const MESSAGES = {
    disabled: 'This page: Zen Mode is off for it.',
    unsupported: 'This page is outside Zen Mode scope.',
    narrow: 'Window too narrow for Zen layout (min 960px).',
    'no-board': 'Waiting for the board to load…',
    active: 'Zen Mode is active on this page.',
  };

  async function refreshStatus() {
    statusEl.textContent = '';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !/^https:\/\/www\.chess\.com\//.test(tab.url || '')) {
        statusEl.textContent = 'Open Chess.com to use Zen Mode.';
        return;
      }
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'czm:status' });
      let text = MESSAGES[res.reason] || '';
      if (res.panelDropped) text += ' Right panel hidden: window too narrow.';
      statusEl.textContent = text;
    } catch (_) {
      statusEl.textContent = 'Reload the Chess.com tab to enable Zen Mode.';
    }
  }

  S.load(area).then(render);
  chrome.storage.onChanged.addListener((changes, a) => {
    if (a === 'local' && changes[S.KEY]) render(S.normalize(changes[S.KEY].newValue));
  });
  refreshStatus();
})();
