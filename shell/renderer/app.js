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

// ---- preferences modal (M4) ----
const prefs = {
  backdrop: $('prefs-backdrop'), close: $('prefs-close'),
  dataPath: $('data-path'), changeFolder: $('change-folder'),
  movePanel: $('move-panel'), moveQ: $('move-q'), moveYes: $('move-yes'), moveFresh: $('move-fresh'), moveCancel: $('move-cancel'), moveStatus: $('move-status'),
  autoScan: $('pref-auto-scan'), rescan: $('pref-rescan'),
  base: $('range-base'), t0: $('range-t0'), t1: $('range-t1'), f0: $('range-f0'), f1: $('range-f1'), rangeApply: $('range-apply'),
  addForm: $('pref-add-form'), addHost: $('pref-add-host'), chips: $('pref-chips'),
  launch: $('pref-launch'), autoUpdate: $('pref-autoupdate'),
  verShell: $('ver-shell'), verOwui: $('ver-owui'), owuiLink: $('owui-link'),
};
let pendingFolder = null;

async function openPrefs() {
  prefs.backdrop.classList.remove('hidden');
  prefs.movePanel.classList.add('hidden');
  await refreshPrefs();
}
function closePrefs() { prefs.backdrop.classList.add('hidden'); }

async function refreshPrefs() {
  const p = await window.lol.getPrefs();
  prefs.dataPath.textContent = p.dataDir + (p.dataDirIsDefault ? '  (default)' : '');
  prefs.autoScan.checked = !!p.autoScan;
  prefs.launch.checked = !!p.launchAtLogin;
  prefs.autoUpdate.checked = !!p.autoUpdate;
  prefs.verShell.textContent = 'v' + p.shellVersion;
  prefs.verOwui.textContent = 'v' + p.owuiVersion;
  const r = p.scanRange || {};
  prefs.base.value = r.base || '';
  if (r.third) { prefs.t0.value = r.third[0]; prefs.t1.value = r.third[1]; }
  if (r.fourth) { prefs.f0.value = r.fourth[0]; prefs.f1.value = r.fourth[1]; }
  renderChips(p.manualPeers || []);
}

function renderChips(peers) {
  prefs.chips.innerHTML = '';
  for (const host of peers) {
    const chip = document.createElement('span');
    chip.className = 'chip-peer';
    chip.innerHTML = `${esc(host)} <button class="chip-x" title="Remove">×</button>`;
    chip.querySelector('.chip-x').onclick = async () => { renderChips(await window.lol.removeManualPeer(host)); };
    prefs.chips.appendChild(chip);
  }
}

$('settings-btn').addEventListener('click', openPrefs);
prefs.close.addEventListener('click', closePrefs);
prefs.backdrop.addEventListener('click', (e) => { if (e.target === prefs.backdrop) closePrefs(); });

prefs.changeFolder.addEventListener('click', async () => {
  const res = await window.lol.chooseDataDir();
  if (res.canceled) return;
  pendingFolder = res.path;
  if (res.oldHasData) {
    prefs.moveQ.textContent = `Move your existing data to “${res.path}”, or start fresh there?`;
    prefs.moveStatus.textContent = '';
    prefs.movePanel.classList.remove('hidden');
  } else {
    await applyFolder('fresh');
  }
});
prefs.moveYes.addEventListener('click', () => applyFolder('move'));
prefs.moveFresh.addEventListener('click', () => applyFolder('fresh'));
prefs.moveCancel.addEventListener('click', () => { pendingFolder = null; prefs.movePanel.classList.add('hidden'); });

async function applyFolder(mode) {
  if (!pendingFolder) return;
  prefs.moveStatus.textContent = mode === 'move' ? 'Moving data… (the chat will restart)' : 'Switching folder… (the chat will restart)';
  const r = await window.lol.setDataDir({ path: pendingFolder, mode });
  pendingFolder = null;
  if (r.ok) { prefs.movePanel.classList.add('hidden'); toast(r.error || 'Data folder updated'); await refreshPrefs(); }
  else { prefs.moveStatus.textContent = 'Could not change folder: ' + (r.error || 'unknown'); }
}

prefs.autoScan.addEventListener('change', () => window.lol.setAutoScan(prefs.autoScan.checked));
prefs.rescan.addEventListener('click', () => { window.lol.rescan(); toast('Rescanning…'); });
prefs.rangeApply.addEventListener('click', async () => {
  await window.lol.setScanRange({ base: prefs.base.value, third: [prefs.t0.value, prefs.t1.value], fourth: [prefs.f0.value, prefs.f1.value] });
  toast('Search range updated');
});
prefs.addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const host = prefs.addHost.value.trim();
  if (!host) return;
  renderChips(await window.lol.addManualPeer(host));
  prefs.addHost.value = '';
});
prefs.launch.addEventListener('change', () => window.lol.setLaunchAtLogin(prefs.launch.checked));
prefs.autoUpdate.addEventListener('change', () => window.lol.setAutoUpdate(prefs.autoUpdate.checked));
prefs.owuiLink.addEventListener('click', (e) => { e.preventDefault(); window.lol.openExternal('https://openwebui.com'); });

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
let pendingReload = false; // a (re)start happened → reload the webview once it's ready
function renderSidecar() {
  const s = sidecarState;
  if (!s) return;
  renderPill();
  if (s.status === 'starting' || s.status === 'restarting') pendingReload = true;

  if (s.status === 'ready' && s.url) {
    if (s.url !== lastUrl) {
      lastUrl = s.url; els.webview.src = s.url; pendingReload = false;
    } else if (pendingReload) {
      // Same port reused after a repoint → src is unchanged, so force a reload to
      // pick up the freshly-(re)started OWUI instead of leaving a stale page.
      pendingReload = false;
      try { els.webview.reload(); } catch { /* webview not ready */ }
    }
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
    // Live busy indicator (M6) on the always-visible meta line; GPU name on its
    // own line below (both shown only if the farm advertises them).
    const util = (f.usage && f.usage.gpuUtil != null) ? ` · ${f.usage.gpuUtil}% GPU` : '';
    const hwLine = (f.host && f.host.gpu)
      ? `<div class="farm-hw">${esc(f.host.gpu)} · ${f.host.vramGb}GB</div>` : '';
    row.innerHTML =
      `<span class="dot ${dotCls}"></span>` +
      `<div class="farm-main">` +
        `<div class="farm-name">${esc(f.name)} <span class="farm-src">${f._source}</span></div>` +
        `<div class="farm-meta">${esc(f._host)}:${f.proxyPort} · ${esc(models)}${util}</div>` +
        hwLine +
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
