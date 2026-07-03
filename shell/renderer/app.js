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
  blender: $('pref-blender'), blenderStatus: $('pref-blender-status'), blenderPort: $('pref-blender-port'),
  verShell: $('ver-shell'), verOwui: $('ver-owui'), owuiLink: $('owui-link'),
  checkApp: $('check-app-update'), appStatus: $('app-update-status'),
  appRestartRow: $('app-restart-row'), appRestart: $('app-update-restart'),
  checkOwui: $('check-owui-update'), owuiStatus: $('owui-update-status'),
  owuiRestartRow: $('owui-restart-row'), owuiRestart: $('owui-update-restart'),
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
  prefs.blender.checked = !!p.blenderMcp;
  prefs.blenderPort.value = p.blenderPort || 9876;
  setBlenderStatus(p.blenderState, p.blenderMcp);
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

// Short human line for the Blender assistant-tools toggle (install/run state).
function setBlenderStatus(state, enabled) {
  const el = prefs.blenderStatus;
  if (!el) return;
  const s = state || {};
  let msg = '';
  if (enabled) {
    if (s.status === 'installing') msg = s.message || 'Installing… (first time only)';
    else if (s.status === 'starting') msg = 'Starting…';
    else if (s.status === 'ready') msg = 'Ready — now start the MCP server in Blender.';
    else if (s.status === 'error') msg = s.message || 'Could not start the Blender tools.';
    else msg = 'Starting…';
  }
  el.textContent = msg;
  el.classList.toggle('err', s.status === 'error');
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
prefs.blender.addEventListener('change', async () => {
  const on = prefs.blender.checked;
  setBlenderStatus({ status: on ? 'starting' : 'stopped' }, on);
  const st = await window.lol.setBlenderEnabled(on);
  setBlenderStatus(st, on);
});
prefs.blenderPort.addEventListener('change', () => {
  const p = parseInt(prefs.blenderPort.value, 10);
  if (p >= 1 && p <= 65535) window.lol.setBlenderPort(p); // restarts mcpo on the new port
});
// Live install/start progress while the panel is open, and — the important part —
// register/unregister the Blender tool server with OWUI as mcpo comes up/down.
window.lol.onBlenderState(async (s) => {
  setBlenderStatus(s, s && s.enabled);
  if (!s) return;
  if (s.status === 'ready') {
    await maybeSeedBlender();                 // mcpo up → add the tool server (once)
  } else {
    // installing / starting / stopped / error: a (re)start is coming (e.g. a port
    // change) or it stopped — allow a fresh seed when ready again (the proxy port
    // may differ on restart), and remove the tool server if it's actually off.
    blenderSeeded = false;
    if (s.status === 'stopped' && webviewAuthed) { try { await unseedBlenderToolServer(); } catch { /* ignore */ } }
  }
});
prefs.owuiLink.addEventListener('click', (e) => { e.preventDefault(); window.lol.openExternal('https://openwebui.com'); });

// --- app self-update (electron-updater) ---
prefs.checkApp.addEventListener('click', async () => {
  prefs.checkApp.disabled = true;
  prefs.appStatus.textContent = 'Checking…';
  prefs.appRestartRow.classList.add('hidden');
  try {
    const r = await window.lol.checkAppUpdate();
    if (r.error) prefs.appStatus.textContent = r.error;
    else if (r.available) prefs.appStatus.textContent = `Update v${r.version} found — downloading in the background…`;
    else prefs.appStatus.textContent = `You're on the latest version (v${r.current}).`;
  } finally { prefs.checkApp.disabled = false; }
});
window.lol.onAppUpdateDownloaded((i) => {
  prefs.appStatus.textContent = `Update v${i.version} is ready.`;
  prefs.appRestartRow.classList.remove('hidden');
});
prefs.appRestart.addEventListener('click', () => window.lol.installAppUpdate());

// --- OWUI (chat engine) update — independent of the app binary ---
prefs.checkOwui.addEventListener('click', async () => {
  prefs.checkOwui.disabled = true;
  prefs.owuiStatus.textContent = 'Checking…';
  prefs.owuiRestartRow.classList.add('hidden');
  try {
    const r = await window.lol.checkOwuiUpdate();
    if (!r.latest) { prefs.owuiStatus.textContent = 'Could not check (only available in an installed build).'; return; }
    if (!r.updateAvailable) { prefs.owuiStatus.textContent = `Chat engine is up to date (v${r.current}).`; return; }
    prefs.owuiStatus.textContent = `v${r.latest} available — downloading…`;
    const res = await window.lol.downloadOwuiUpdate();
    if (!res.ok) { prefs.owuiStatus.textContent = 'Download failed: ' + (res.error || 'unknown'); return; }
    prefs.owuiStatus.textContent = `v${res.version || r.latest} downloaded.`;
    prefs.owuiRestartRow.classList.remove('hidden');
  } finally { prefs.checkOwui.disabled = false; }
});
window.lol.onOwuiUpdateProgress((p) => {
  if (p.phase === 'download' && p.receivedMB != null && p.totalMB) {
    prefs.owuiStatus.textContent = `Downloading… ${p.receivedMB}/${p.totalMB} MB${p.percent != null ? ` (${p.percent}%)` : ''}`;
  } else if (p.phase === 'extract') prefs.owuiStatus.textContent = 'Unpacking…';
});
prefs.owuiRestart.addEventListener('click', () => window.lol.relaunch());

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
    if (a) {
      cls = 'ready';
      // Live load next to the name — at-a-glance "how busy is my box".
      const util = a.usage && a.usage.gpuUtil != null ? ` · ${a.usage.gpuUtil}% GPU` : '';
      text = a.name + util;
    } else { cls = 'busy'; text = 'No server'; }
  }
  els.statusDot.className = 'dot ' + cls;
  els.statusText.textContent = text;
}

// ---- sidecar → webview + overlay ----
let lastUrl = null;
let pendingReload = false; // a (re)start happened → reload the webview once it's ready
// OWUI auth-bootstrap: OWUI's SPA fetches /api/config and first-paints BEFORE the
// WEBUI_AUTH=false auto-login writes its token, so a fresh boot renders the
// unauthenticated, minimal UI (sparse features) and chat 401s. localStorage is
// per-origin and the sidecar uses a fresh port most launches, so this race bites
// nearly every launch. We keep the "starting" overlay up until OWUI is *validly*
// authenticated, then reveal. We VALIDATE the token (not just check it exists): a
// stale token — signed by a previous WEBUI_SECRET_KEY, or for an OWUI DB that was
// reset — leaves the SPA "logged in" while every call 401s (the exact broken-chat /
// missing-features symptom). webviewAuthed gates the reveal; authReloads bounds the
// retries so a never-authing OWUI can't loop forever. Both reset on origin change.
let webviewAuthed = false;
let authReloads = 0;
const MAX_AUTH_RELOADS = 4;
let webSearchSeeded = false; // seed the web-search-on default at most once per session
let blenderSeeded = false;   // register the Blender tool server with OWUI at most once per session

// Turn web search ON BY DEFAULT (the workshop wants it, and there's no OWUI env
// for it — it's the per-user `webSearch:'always'` interface setting, PR #9370). We
// set it via OWUI's own settings API from inside the authed webview, but ONLY when
// the farm actually hosts web search (config.features.enable_web_search, which the
// client sets from the beacon's searxngUrl) — else forcing it on would make every
// message try to search with no engine. A `lolWebSearchSeeded` marker in the user
// settings (ui is an extra='allow' dict) makes this a ONE-TIME default: after the
// first seed we never touch it again, so a user who turns it off stays off.
// Returns 'set' (just enabled it) | 'already' | 'na' (no web search / not authed).
async function seedWebSearchDefault() {
  try {
    return await els.webview.executeJavaScript(`(async () => {
      try {
        const t = window.localStorage && window.localStorage.token; if (!t) return 'na';
        const H = { authorization: 'Bearer ' + t };
        const cfg = await (await fetch('/api/config')).json().catch(() => ({}));
        if (!(cfg && cfg.features && cfg.features.enable_web_search)) return 'na';
        const cur = await (await fetch('/api/v1/users/user/settings', { headers: H })).json().catch(() => null);
        const ui = (cur && cur.ui) || {};
        if (ui.lolWebSearchSeeded) return 'already';
        ui.webSearch = 'always';
        ui.lolWebSearchSeeded = true;
        const r = await fetch('/api/v1/users/user/settings/update', {
          method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ ui })
        });
        return r.ok ? 'set' : 'na';
      } catch (e) { return 'na'; }
    })()`);
  } catch { return 'na'; }
}

// Register the LOCAL Blender tool server (our mcpo) with OWUI through its SUPPORTED
// API — the same call the admin UI's "verify & save" makes. We do NOT use the
// TOOL_SERVER_CONNECTIONS env var: it's a PersistentConfig and OWUI doesn't reliably
// surface env-configured tool servers (upstream issue #18140). Runs inside the authed
// webview (localStorage.token) exactly like seedWebSearchDefault. Idempotent: keyed by
// info.id === 'lol-blender', it replaces our entry and leaves any others untouched.
// Returns 'set' | 'already' | 'na' | 'err:<code>'.
async function seedBlenderToolServer(url, key) {
  try {
    return await els.webview.executeJavaScript(`(async () => {
      try {
        const t = window.localStorage && window.localStorage.token; if (!t) return 'na';
        const H = { authorization: 'Bearer ' + t };
        const url = ${JSON.stringify(url)}, key = ${JSON.stringify(key)};
        const conn = { url, path: 'openapi.json', type: 'openapi', auth_type: 'bearer', key,
          config: { enable: true },
          info: { id: 'lol-blender', name: 'Blender', description: 'Control Blender running on this machine.' } };
        const cur = await (await fetch('/api/v1/configs/tool_servers', { headers: H })).json().catch(() => null);
        const list = (cur && Array.isArray(cur.TOOL_SERVER_CONNECTIONS)) ? cur.TOOL_SERVER_CONNECTIONS
                   : (Array.isArray(cur) ? cur : []);
        const mine = list.find(c => c && c.info && c.info.id === 'lol-blender');
        if (mine && mine.url === url && mine.key === key) return 'already';
        const others = list.filter(c => !(c && c.info && c.info.id === 'lol-blender'));
        const r = await fetch('/api/v1/configs/tool_servers', {
          method: 'POST', headers: { ...H, 'content-type': 'application/json' },
          body: JSON.stringify({ TOOL_SERVER_CONNECTIONS: [...others, conn] })
        });
        return r.ok ? 'set' : ('err:' + r.status);
      } catch (e) { return 'err:' + ((e && e.message) || 'x'); }
    })()`);
  } catch { return 'na'; }
}

// Remove our Blender tool server from OWUI (when the user turns the feature off).
async function unseedBlenderToolServer() {
  try {
    return await els.webview.executeJavaScript(`(async () => {
      try {
        const t = window.localStorage && window.localStorage.token; if (!t) return 'na';
        const H = { authorization: 'Bearer ' + t };
        const cur = await (await fetch('/api/v1/configs/tool_servers', { headers: H })).json().catch(() => null);
        const list = (cur && Array.isArray(cur.TOOL_SERVER_CONNECTIONS)) ? cur.TOOL_SERVER_CONNECTIONS
                   : (Array.isArray(cur) ? cur : []);
        const others = list.filter(c => !(c && c.info && c.info.id === 'lol-blender'));
        if (others.length === list.length) return 'already';
        const r = await fetch('/api/v1/configs/tool_servers', {
          method: 'POST', headers: { ...H, 'content-type': 'application/json' },
          body: JSON.stringify({ TOOL_SERVER_CONNECTIONS: others })
        });
        return r.ok ? 'removed' : ('err:' + r.status);
      } catch (e) { return 'err:' + ((e && e.message) || 'x'); }
    })()`);
  } catch { return 'na'; }
}

// Seed the Blender tool server once per session, if the local mcpo is ready and the
// webview is authed. Called on auth success AND when mcpo reports 'ready' (whichever
// is later — on first launch mcpo installs for ~1 min, so it's usually the latter).
// Returns true if it registered + kicked a reload (so callers can bail).
async function maybeSeedBlender() {
  if (blenderSeeded || !webviewAuthed) return false;
  let conn = null;
  try { conn = await window.lol.getBlenderConnection(); } catch { conn = null; }
  if (!conn || !conn.url) return false; // mcpo not ready yet — retry on its 'ready' push
  blenderSeeded = true;
  const res = await seedBlenderToolServer(conn.url, conn.apiKey);
  if (res === 'set') { try { els.webview.reload(); } catch { /* not ready */ } return true; }
  return false;
}

async function ensureAuthenticated() {
  try {
    // 'valid' → reveal. 'invalid' → drop the stale token so the reload re-runs
    // auto-login. 'none'/'pending' → wait for the auto-login token, then reload once.
    const status = await els.webview.executeJavaScript(`(async () => {
      const t = window.localStorage && window.localStorage.token;
      if (!t) return 'none';
      try { const r = await fetch('/api/v1/auths/', { headers: { authorization: 'Bearer ' + t } });
            return r.ok ? 'valid' : 'invalid'; }
      catch { return 'pending'; }
    })()`);
    if (status === 'valid') {
      webviewAuthed = true; authReloads = 0;
      // First authed load per session: enable web search by default if the farm has
      // it. If we just set it, reload once so the SPA picks up the fresh setting
      // (its $settings was loaded before we wrote it); the marker then no-ops.
      if (!webSearchSeeded) {
        webSearchSeeded = true;
        if ((await seedWebSearchDefault()) === 'set') { try { els.webview.reload(); } catch { /* not ready */ } return; }
      }
      // Register the local Blender tool server if mcpo is already up (else its
      // 'ready' push seeds it later). A 'set' reloads to surface the new tools.
      if (await maybeSeedBlender()) return;
      renderSidecar();
      return;
    }
    if (authReloads >= MAX_AUTH_RELOADS) { webviewAuthed = true; renderSidecar(); return; } // give up gating; show it
    authReloads++;
    if (status === 'invalid') {
      await els.webview.executeJavaScript('try{window.localStorage.removeItem("token")}catch(e){}');
      try { els.webview.reload(); } catch { /* webview not ready */ }
      return;
    }
    // Wait (≤20s) for auto-login to persist a token, then reload so OWUI boots authed.
    await els.webview.executeJavaScript(
      '(async()=>{for(let i=0;i<80;i++){if(window.localStorage&&window.localStorage.token)return true;await new Promise(r=>setTimeout(r,250));}return false;})()'
    );
    try { els.webview.reload(); } catch { /* webview not ready */ }
  } catch { /* webview navigating / not attached yet */ }
}
els.webview.addEventListener('did-finish-load', ensureAuthenticated);

// ---- first-run / update download of the OWUI sidecar (not bundled in the
// installer; fetched to userData on first launch) ----
let installState = null; // {phase, percent, receivedMB, totalMB, message} while downloading
function renderInstall() {
  if (!installState) { renderSidecar(); return; }
  els.webview.classList.add('hidden');
  els.overlay.classList.remove('hidden');
  els.panelActions.innerHTML = '';
  if (installState.phase === 'error') {
    els.panelIcon.innerHTML = ICON_ALERT;
    els.panelTitle.textContent = 'Could not download the chat engine';
    els.panelMsg.textContent = 'LlmOnLan needs to download Open WebUI once. Check your connection and retry.';
    els.panelDetail.textContent = installState.message || '';
    const retry = document.createElement('button');
    retry.className = 'btn'; retry.textContent = 'Retry';
    retry.onclick = () => { installState = { phase: 'check', message: 'Retrying…' }; renderInstall(); window.lol.installSidecar(); };
    els.panelActions.appendChild(retry);
    return;
  }
  els.panelIcon.innerHTML = '<div class="spinner"></div>';
  els.panelTitle.textContent = 'Setting up the chat engine';
  if (installState.phase === 'download') {
    const pct = installState.percent;
    els.panelMsg.textContent = 'Downloading Open WebUI — a one-time setup (~700 MB).';
    els.panelDetail.textContent = (installState.receivedMB != null && installState.totalMB)
      ? `${installState.receivedMB} / ${installState.totalMB} MB${pct != null ? `   ${pct}%` : ''}`
      : (pct != null ? `${pct}%` : '');
  } else if (installState.phase === 'extract') {
    els.panelMsg.textContent = 'Unpacking the chat engine…'; els.panelDetail.textContent = '';
  } else {
    els.panelMsg.textContent = installState.message || 'Preparing…'; els.panelDetail.textContent = '';
  }
}
window.lol.onSidecarInstall((p) => {
  installState = (p && p.phase === 'done') ? null : p;
  renderInstall();
});

function renderSidecar() {
  if (installState) return; // the install overlay owns the screen until the download finishes
  const s = sidecarState;
  if (!s) return;
  renderPill();
  if (s.status === 'starting' || s.status === 'restarting') pendingReload = true;

  if (s.status === 'ready' && s.url) {
    if (s.url !== lastUrl) {
      // New OWUI origin → reset the auth-bootstrap gate (fresh per-origin storage).
      lastUrl = s.url; webviewAuthed = false; authReloads = 0; webSearchSeeded = false; blenderSeeded = false;
      els.webview.src = s.url; pendingReload = false;
    } else if (pendingReload) {
      // Same port reused after a repoint → src is unchanged, so force a reload to
      // pick up the freshly-(re)started OWUI instead of leaving a stale page.
      pendingReload = false;
      try { els.webview.reload(); } catch { /* webview not ready */ }
    }
    if (webviewAuthed) {
      els.webview.classList.remove('hidden');
      els.overlay.classList.add('hidden');
    } else {
      // OWUI is serving but its SPA hasn't signed in yet — keep the overlay up
      // (ensureAuthenticated reveals it once the token lands) so the degraded,
      // unauthenticated OWUI never flashes on screen.
      els.webview.classList.add('hidden');
      els.overlay.classList.remove('hidden');
      els.panelActions.innerHTML = '';
      els.panelIcon.innerHTML = '<div class="spinner"></div>';
      els.panelTitle.textContent = 'Starting your local chat…';
      els.panelMsg.textContent = 'Finishing sign-in to Open WebUI.';
      els.panelDetail.textContent = '';
    }
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
    const models = (f.models || []).map((m) => m.id + (m.default ? ' ★' : '')).join(', ') || 'no models';
    // Fleet view: everything the beacon tells us about the box, per row.
    // Badges: how we found it + special roles.
    const badges =
      `<span class="farm-src">${f._source}</span>` +
      (f.coordinator ? `<span class="farm-src farm-coord">coordinator</span>` : '') +
      (f.searxngUrl ? `<span class="farm-src">web search</span>` : '');
    // Live line: GPU util, VRAM used/total, loaded models, backends, hosts.
    const u = f.usage || {};
    const live = [];
    if (u.gpuUtil != null) live.push(`${u.gpuUtil}% GPU`);
    if (u.vramUsedGb != null && u.vramTotalGb != null) live.push(`${u.vramUsedGb}/${u.vramTotalGb}GB VRAM`);
    if (u.loaded && u.loaded.length) live.push(`loaded: ${u.loaded.join(', ')}`);
    if (f.deployments != null && f.deployments > 1) live.push(`${f.deployments} backends`);
    if (f.health && f.health.hostsTotal > 1) live.push(`${f.health.hostsUp}/${f.health.hostsTotal} hosts`);
    const liveLine = live.length ? `<div class="farm-hw">${esc(live.join(' · '))}</div>` : '';
    const hwLine = (f.host && f.host.gpu)
      ? `<div class="farm-hw">${esc(f.host.gpu)} · ${f.host.vramGb}GB</div>` : '';
    row.innerHTML =
      `<span class="dot ${dotCls}"></span>` +
      `<div class="farm-main">` +
        `<div class="farm-name">${esc(f.name)} ${badges}</div>` +
        `<div class="farm-meta">${esc(f._host)}:${f.proxyPort} · ${esc(models)}</div>` +
        liveLine +
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
