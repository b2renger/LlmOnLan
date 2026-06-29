// Renderer — thin chrome over the embedded Open WebUI webview.
// Talks to main only through the preloaded `lol` bridge (no Node access).

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const els = {
  status: $('status'),
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  overlay: $('overlay'),
  panelIcon: $('panel-icon'),
  panelTitle: $('panel-title'),
  panelMsg: $('panel-msg'),
  panelDetail: $('panel-detail'),
  panelActions: $('panel-actions'),
  webview: $('owui'),
  toast: $('toast'),
  popover: $('conn-popover'),
  popScan: $('pop-scan'),
  farmList: $('farm-list'),
  farmEmpty: $('farm-empty'),
  addForm: $('add-form'),
  addHost: $('add-host'),
  autoScan: $('auto-scan'),
  rescanBtn: $('rescan-btn'),
};

let sidecarState = null;
let farmState = { farms: [], manualPeers: [], autoScan: true, scanRange: null, scanning: false };

// ---- icons ----
const ICON_PLUG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/></svg>';
const ICON_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

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
  const next = root.classList.contains('light') ? 'dark' : 'light';
  applyThemeClass((await window.lol.setTheme(next)).theme);
});

$('settings-btn').addEventListener('click', () => toast('Preferences — coming in M4'));

// ---- toast ----
let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

// ---- farm helpers ----
const farmEndpoint = (f) => `http://${f._host}:${f.proxyPort}/v1`;
const activeFarm = () => farmState.farms.find((f) => sidecarState && farmEndpoint(f) === sidecarState.endpoint) || null;

// ---- topbar connection pill (combines sidecar + farm state) ----
function renderPill() {
  let cls = 'idle', text = 'Idle';
  const st = sidecarState && sidecarState.status;
  if (st === 'error') { cls = 'error'; text = 'Error'; }
  else if (st === 'starting') { cls = 'busy'; text = farmState.farms.length ? 'Connecting…' : 'Searching…'; }
  else if (st === 'restarting') { cls = 'busy'; text = 'Reconnecting…'; }
  else if (st === 'ready') {
    const a = activeFarm();
    if (a) { cls = 'ready'; text = a.name; }
    else { cls = 'busy'; text = 'No server'; }
  }
  els.statusDot.className = 'dot ' + cls;
  els.statusText.textContent = text;
}

// ---- sidecar → webview + overlay ----
let lastUrl = null;
function renderSidecar() {
  const s = sidecarState;
  if (!s) return;
  renderPill();

  if (s.status === 'ready' && s.url) {
    if (s.url !== lastUrl) { lastUrl = s.url; els.webview.src = s.url; }
    els.webview.classList.remove('hidden');
    els.overlay.classList.add('hidden');
    return;
  }

  els.overlay.classList.remove('hidden');
  els.webview.classList.add('hidden');
  els.panelActions.innerHTML = '';

  if (s.status === 'error') {
    els.panelIcon.innerHTML = ICON_ALERT;
    els.panelTitle.textContent = 'Could not start the chat';
    els.panelMsg.textContent = 'Open WebUI did not start on your machine.';
    els.panelDetail.textContent = s.message || '';
    const retry = document.createElement('button');
    retry.className = 'btn'; retry.textContent = 'Retry';
    retry.onclick = () => { els.panelDetail.textContent = 'Restarting…'; window.lol.restartSidecar(); };
    els.panelActions.appendChild(retry);
  } else if (s.status === 'restarting') {
    els.panelIcon.innerHTML = '<div class="spinner"></div>';
    els.panelTitle.textContent = 'Reconnecting…';
    els.panelMsg.textContent = s.endpoint ? `Pointing Open WebUI at the server.` : 'Restarting Open WebUI.';
    els.panelDetail.textContent = s.message || '';
  } else {
    els.panelIcon.innerHTML = '<div class="spinner"></div>';
    els.panelTitle.textContent = 'Starting your local chat…';
    els.panelMsg.textContent = farmState.farms.length
      ? 'Open WebUI is starting on your machine.'
      : 'Looking for your server on the network, and starting Open WebUI.';
    els.panelDetail.textContent = s.message || '';
  }
}

// ---- connection popover ----
function renderPopover() {
  // scanning / count line
  const n = farmState.farms.length;
  els.popScan.textContent = farmState.scanning ? 'scanning…' : (n ? `${n} found` : '');
  els.autoScan.checked = !!farmState.autoScan;

  els.farmList.innerHTML = '';
  els.farmEmpty.classList.toggle('hidden', n > 0);

  const active = activeFarm();
  for (const f of farmState.farms) {
    const isActive = active && f.id === active.id;
    const row = document.createElement('div');
    row.className = 'farm' + (isActive ? ' active' : '');
    const dotCls = f.healthy && !f._stale ? 'ready' : (f._stale ? 'busy' : 'error');
    const models = (f.models || []).map((m) => m.id).join(', ') || 'no models';
    row.innerHTML =
      `<span class="dot ${dotCls}"></span>` +
      `<div class="farm-main">` +
        `<div class="farm-name">${esc(f.name)} <span class="farm-src">${f._source}</span></div>` +
        `<div class="farm-meta">${esc(f._host)}:${f.proxyPort} · ${esc(models)}</div>` +
      `</div>` +
      `<span class="farm-check">${isActive ? ICON_CHECK : ''}</span>`;
    row.onclick = () => { window.lol.selectFarm(f.id); toast(`Connecting to ${f.name}…`); };
    els.farmList.appendChild(row);
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// popover open/close
els.status.addEventListener('click', (e) => {
  e.stopPropagation();
  els.popover.classList.toggle('hidden');
  if (!els.popover.classList.contains('hidden')) renderPopover();
});
document.addEventListener('click', (e) => {
  if (!els.popover.contains(e.target) && e.target !== els.status && !els.status.contains(e.target)) {
    els.popover.classList.add('hidden');
  }
});

els.addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const host = els.addHost.value.trim();
  if (!host) return;
  await window.lol.addManualPeer(host);
  els.addHost.value = '';
  toast(`Added ${host}`);
});
els.autoScan.addEventListener('change', () => window.lol.setAutoScan(els.autoScan.checked));
els.rescanBtn.addEventListener('click', () => { window.lol.rescan(); toast('Rescanning…'); });

// ---- wire IPC ----
window.lol.onSidecarState((s) => { sidecarState = s; renderSidecar(); if (!els.popover.classList.contains('hidden')) renderPopover(); });
window.lol.onFarms((data) => { farmState = data; renderPill(); if (!els.popover.classList.contains('hidden')) renderPopover(); });
window.lol.getSidecarState().then((s) => { sidecarState = s; renderSidecar(); });
window.lol.getFarms().then((data) => { farmState = data; renderPill(); });
initTheme();
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  window.lol.getSettings().then((s) => { if (s.theme === 'system') applyThemeClass('system'); });
});
