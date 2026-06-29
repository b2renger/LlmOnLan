// Renderer — thin chrome over the embedded Open WebUI webview.
// Talks to main only through the preloaded `lol` bridge (no Node access).

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const els = {
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  overlay: $('overlay'),
  panelIcon: $('panel-icon'),
  spinner: $('spinner'),
  panelTitle: $('panel-title'),
  panelMsg: $('panel-msg'),
  panelDetail: $('panel-detail'),
  panelActions: $('panel-actions'),
  webview: $('owui'),
  toast: $('toast'),
};

// ---- theme ----
async function initTheme() {
  const s = await window.lol.getSettings();
  applyThemeClass(s.theme);
}
function applyThemeClass(theme) {
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const effective = theme === 'system' ? (prefersLight ? 'light' : 'dark') : theme;
  root.classList.toggle('light', effective === 'light');
  root.classList.toggle('dark', effective !== 'light');
}
$('theme-toggle').addEventListener('click', async () => {
  const isLight = root.classList.contains('light');
  const next = isLight ? 'dark' : 'light';
  const s = await window.lol.setTheme(next);
  applyThemeClass(s.theme);
});

// ---- settings gear (full Preferences panel arrives in M4) ----
$('settings-btn').addEventListener('click', () => {
  toast('Preferences — coming in M4');
});

// ---- toast ----
let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

// ---- icons for overlay states ----
const ICON_PLUG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/></svg>';
const ICON_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

// ---- sidecar state → UI ----
let lastUrl = null;

function render(state) {
  if (!state) return;
  const { status, url, endpoint, message } = state;

  // status pill
  const pill = {
    idle:       ['idle',  'Idle'],
    starting:   ['busy',  'Starting…'],
    restarting: ['busy',  'Reconnecting…'],
    ready:      ['ready', 'Ready'],
    stopped:    ['idle',  'Stopped'],
    error:      ['error', 'Error'],
  }[status] || ['idle', status];
  els.statusDot.className = 'dot ' + pill[0];
  els.statusText.textContent = pill[1];

  if (status === 'ready' && url) {
    // Load OWUI once; don't thrash the webview on repeated 'ready' pushes.
    if (url !== lastUrl) {
      lastUrl = url;
      els.webview.src = url;
    }
    els.webview.classList.remove('hidden');
    els.overlay.classList.add('hidden');
    return;
  }

  // Not ready → show the overlay.
  els.overlay.classList.remove('hidden');
  els.webview.classList.add('hidden');
  els.panelActions.innerHTML = '';

  if (status === 'error') {
    els.panelIcon.innerHTML = ICON_ALERT;
    els.panelTitle.textContent = 'Could not start the chat';
    els.panelMsg.textContent = 'Open WebUI did not start on your machine.';
    els.panelDetail.textContent = message || '';
    const retry = document.createElement('button');
    retry.className = 'btn';
    retry.textContent = 'Retry';
    retry.onclick = () => { els.panelDetail.textContent = 'Restarting…'; window.lol.restartSidecar(); };
    els.panelActions.appendChild(retry);
  } else if (status === 'restarting') {
    els.panelIcon.innerHTML = '<div class="spinner"></div>';
    els.panelTitle.textContent = 'Reconnecting…';
    els.panelMsg.textContent = endpoint ? `Pointing Open WebUI at ${endpoint}` : 'Restarting Open WebUI.';
    els.panelDetail.textContent = message || '';
  } else { // starting / idle / stopped
    els.panelIcon.innerHTML = '<div class="spinner"></div>';
    els.panelTitle.textContent = 'Starting your local chat…';
    els.panelMsg.textContent = 'Open WebUI is starting on your machine. First run downloads a small embedding model.';
    els.panelDetail.textContent = message || '';
  }
}

window.lol.onSidecarState(render);
window.lol.getSidecarState().then(render);
initTheme();
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  window.lol.getSettings().then((s) => { if (s.theme === 'system') applyThemeClass('system'); });
});
