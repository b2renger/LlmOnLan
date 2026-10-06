// Renderer — thin chrome over the embedded Open WebUI webview.
// Talks to main only through the preloaded `lol` bridge (no Node access).

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

// Must match OWUI_ENABLED in src/main/clientMode.ts (this is its inverse):
// main gates the sidecar lifecycle, this gates which surface drives the overlay.
const NO_OWUI = false;

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
  dataPath: $('data-path'), changeFolder: $('change-folder'), clientNote: $('data-client-note'),
  movePanel: $('move-panel'), moveQ: $('move-q'), moveYes: $('move-yes'), moveFresh: $('move-fresh'), moveCancel: $('move-cancel'), moveStatus: $('move-status'),
  autoScan: $('pref-auto-scan'), rescan: $('pref-rescan'),
  base: $('range-base'), t0: $('range-t0'), t1: $('range-t1'), f0: $('range-f0'), f1: $('range-f1'), rangeApply: $('range-apply'),
  addForm: $('pref-add-form'), addHost: $('pref-add-host'), chips: $('pref-chips'),
  launch: $('pref-launch'), autoUpdate: $('pref-autoupdate'),
  blender: $('pref-blender'), blenderStatus: $('pref-blender-status'), blenderPort: $('pref-blender-port'), blenderTest: $('pref-blender-test'),
  homeUrl: $('pref-home-url'), homeToken: $('pref-home-token'), homeLink: $('pref-home-link'), homeCheck: $('pref-home-check'),
  homeForget: $('pref-home-forget'), homeStatus: $('pref-home-status'), homeArm: $('pref-home-arm'), homeArmed: $('pref-home-armed'),
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
  // LOL Vibe + the Computer run from <dataDir>/lol-client; only a data folder that could not be
  // used at boot puts them elsewhere for the session, and then the panel says where.
  const away = !p.clientDataInDataDir;
  prefs.clientNote.classList.toggle('hidden', !away);
  prefs.clientNote.classList.toggle('err', away);
  prefs.clientNote.textContent = !away ? ''
    : p.clientDataDir
      ? `This session, LOL Vibe and the Computer keep their work in ${p.clientDataDir}, because the data folder could not be used.`
      : 'This session, LOL Vibe and the Computer keep their work in the app’s own folder, because the data folder could not be used.';
  prefs.autoScan.checked = !!p.autoScan;
  prefs.launch.checked = !!p.launchAtLogin;
  prefs.autoUpdate.checked = !!p.autoUpdate;
  prefs.blender.checked = !!p.blenderMcp;
  prefs.blenderPort.value = p.blenderPort || 9876;
  setBlenderStatus(p.blenderState, p.blenderMcp);
  prefs.verShell.textContent = 'v' + p.shellVersion;
  // 'unknown' = the chat engine has not been downloaded yet (first run) — never print "vunknown".
  prefs.verOwui.textContent = p.owuiVersion === 'unknown' ? 'not installed yet' : 'v' + p.owuiVersion;
  const r = p.scanRange || {};
  prefs.base.value = r.base || '';
  if (r.third) { prefs.t0.value = r.third[0]; prefs.t1.value = r.third[1]; }
  if (r.fourth) { prefs.f0.value = r.fourth[0]; prefs.f1.value = r.fourth[1]; }
  renderChips(p.manualPeers || []);
  await refreshHome();
}

// ---- Home Assistant (src/main/homeAssistant.ts): the token goes in and never comes back; allowing commands is
// main's native dialog, and while they are allowed the topbar says so, one click from stopping them.
const homeLive = $('home-live');
function showHome(s) {
  const st = s || {};
  for (const b of [prefs.homeCheck, prefs.homeForget, prefs.homeArm]) b.disabled = !st.linked;
  prefs.homeArm.textContent = st.armed ? 'Stop commands' : 'Allow commands…';
  prefs.homeArmed.textContent = !st.linked ? ''
    : st.armed ? `Commands allowed for ${st.armed} devices, until LlmOnLan closes.` : 'Commands: a dry run.';
  homeLive.classList.toggle('hidden', !st.armed);
  $('home-live-text').textContent = `Home commands on · ${st.armed || 0}`;
}
function homeLine(r) {
  prefs.homeStatus.classList.toggle('err', !r.ok);
  prefs.homeStatus.textContent = !r.ok ? (r.message || 'Not linked.')
    : `Linked: ${r.name || r.url}${r.version ? ` · Home Assistant ${r.version}` : ''}${r.entities != null ? ` · ${r.entities} entities, ${r.devices} devices` : ''}`;
}
async function refreshHome() {
  if (!window.lol.home) return;
  const s = await window.lol.home.status();
  prefs.homeUrl.value = s.url || prefs.homeUrl.value;
  prefs.homeToken.value = '';
  prefs.homeToken.placeholder = s.linked ? 'A token is kept, encrypted. Paste a new one to replace it.'
    : 'A long-lived access token (Home Assistant ▸ your profile ▸ Security)';
  if (s.linked) homeLine({ ok: true, ...s });
  else { prefs.homeStatus.classList.remove('err'); prefs.homeStatus.textContent = ''; }
  showHome(s);
}
if (window.lol.home) {
  prefs.homeLink.addEventListener('click', async () => {
    prefs.homeStatus.classList.remove('err');
    prefs.homeStatus.textContent = 'Linking…';
    let r;
    try { r = await window.lol.home.link(prefs.homeUrl.value, prefs.homeToken.value); } catch (e) { r = { ok: false, message: String((e && e.message) || e) }; }
    if (!r.ok) {
      // A failed Link changes nothing: say which home is still linked, so the typed address is not mistaken for it.
      const s = await window.lol.home.status();
      return homeLine({ ok: false, message: s.linked ? `Still linked to ${s.url}. ${r.message}` : r.message });
    }
    await refreshHome();
    homeLine(await window.lol.home.check());
  });
  prefs.homeCheck.addEventListener('click', async () => {
    prefs.homeStatus.classList.remove('err');
    prefs.homeStatus.textContent = 'Testing…';
    homeLine(await window.lol.home.check());
  });
  prefs.homeForget.addEventListener('click', async () => {
    const r = await window.lol.home.link('', '');
    prefs.homeUrl.value = '';
    await refreshHome();
    if (!r.ok) homeLine(r);
  });
  prefs.homeArm.addEventListener('click', async () => {
    const s = await window.lol.home.status();
    if (s.armed) return showHome(await window.lol.home.disarm());
    const r = await window.lol.home.arm();
    if (!r.ok && !r.cancelled) homeLine(r);
  });
  homeLive.addEventListener('click', async () => showHome(await window.lol.home.disarm()));
  window.lol.home.onState(showHome);
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

// Changing the folder RESTARTS the app (LOL Vibe's and the Computer's data is the window's own
// storage, which cannot be moved while the window has it open), so the panel always asks first
// and says so — even when there is nothing to move.
prefs.changeFolder.addEventListener('click', async () => {
  const res = await window.lol.chooseDataDir();
  if (res.canceled) return;
  pendingFolder = res.path;
  setMoveButtons(false);
  prefs.moveStatus.textContent = '';
  prefs.moveStatus.classList.remove('err');
  if (res.oldHasData) {
    prefs.moveQ.textContent = `Move everything to “${res.path}” — LOL Vibe, the Computer and Open WebUI — or start fresh there? `
      + 'LlmOnLan restarts to finish; “Start fresh” leaves your current data where it is.';
    prefs.moveYes.classList.remove('hidden');
    prefs.moveFresh.textContent = 'Start fresh';
  } else {
    prefs.moveQ.textContent = `Use “${res.path}” as your data folder? LlmOnLan restarts to switch.`;
    prefs.moveYes.classList.add('hidden');
    prefs.moveFresh.textContent = 'Use this folder';
  }
  prefs.movePanel.classList.remove('hidden');
});
prefs.moveYes.addEventListener('click', () => applyFolder('move'));
prefs.moveFresh.addEventListener('click', () => applyFolder('fresh'));
prefs.moveCancel.addEventListener('click', () => { pendingFolder = null; prefs.movePanel.classList.add('hidden'); });

function setMoveButtons(disabled) {
  for (const b of [prefs.moveYes, prefs.moveFresh, prefs.moveCancel, prefs.changeFolder]) b.disabled = disabled;
}

async function applyFolder(mode) {
  if (!pendingFolder) return;
  const target = pendingFolder;
  setMoveButtons(true);
  prefs.moveStatus.classList.remove('err');
  prefs.moveStatus.textContent = mode === 'move' ? 'Moving your data…' : 'Switching folder…';
  const r = await window.lol.setDataDir({ path: target, mode });
  pendingFolder = null;
  if (r.ok) {
    // Main saved the new folder and restarts the app in a moment; the next launch finishes the
    // move before the window opens and says so.
    prefs.dataPath.textContent = r.dataDir || target;
    prefs.moveStatus.textContent = mode === 'move'
      ? 'Restarting LlmOnLan to finish moving LOL Vibe and the Computer…'
      : 'Restarting LlmOnLan on the new folder…';
    if (r.error) prefs.moveStatus.textContent += ' ' + r.error;
  } else {
    setMoveButtons(false);
    prefs.moveStatus.classList.add('err');
    prefs.moveStatus.textContent = 'Could not change folder: ' + (r.error || 'unknown') + ' Nothing was moved.';
  }
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
prefs.blenderTest.addEventListener('click', async () => {
  const el = prefs.blenderStatus;
  el.classList.remove('err');
  el.textContent = 'Testing…';
  const r = await window.lol.testBlenderConnection();
  if (!r.enabled) { el.textContent = 'Blender tools are off — enable them first.'; el.classList.add('err'); return; }
  const proxy = r.mcpoUp ? `helper ✓${r.toolCount ? ` (${r.toolCount} tools)` : ''}` : 'helper ✗ (still starting?)';
  const blender = r.blenderReachable
    ? `Blender ✓ on port ${r.port}`
    : `Blender ✗ — nothing listening on port ${r.port} (start the MCP server in Blender, or fix the port)`;
  el.textContent = `${proxy} · ${blender}`;
  el.classList.toggle('err', !r.mcpoUp || !r.blenderReachable);
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
    // `error` = a dev build (main answers without asking GitHub). A null `latest` otherwise
    // means GitHub could not be read — the normal case on a closed LAN.
    if (r.error) { prefs.owuiStatus.textContent = r.error; return; }
    if (!r.latest) { prefs.owuiStatus.textContent = 'Could not reach GitHub to check for a chat-engine update. Check the internet connection and try again.'; return; }
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
function toast(msg, ms = 2200) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
}

// What boot did with the client's data (a finished move, a data folder it could not use, the
// one-time import of an older install's history) — shown once, long enough to read. Notices
// queue so a second one never hides the first.
(async () => {
  let notices = [];
  try { notices = (await window.lol.getDataNotices()) || []; } catch { return; }
  let at = 800;
  for (const n of notices) {
    const ms = n.level === 'warn' ? 16000 : 9000;
    setTimeout(() => toast(n.text, ms), at);
    at += ms + 400;
  }
})();

// ---- farm helpers ----
const farmEndpoint = (f) => `http://${f._host}:${f.proxyPort}/v1`;
const activeFarm = () => farmState.farms.find((f) => sidecarState && farmEndpoint(f) === sidecarState.endpoint) || null;

// ---- topbar connection pill (combines sidecar + farm state) ----
function renderPill() {
  let cls = 'idle', text = 'Idle', tip = '';
  const st = sidecarState && sidecarState.status;
  if (st === 'error') { cls = 'error'; text = 'Error'; }
  else if (st === 'starting') { cls = 'busy'; text = farmState.farms.length ? 'Connecting…' : 'Searching…'; }
  else if (st === 'restarting') { cls = 'busy'; text = 'Reconnecting…'; }
  else if (st === 'ready') {
    const a = activeFarm();
    // A LAN whose only farm is password-protected used to read "No server" — a
    // dead end for a student who has the password in hand. Name the situation
    // and point at the fix.
    const locked = !a && farmState.farms.some((f) => f.requiresKey && !f._hasKey && !f._stale);
    if (locked) { cls = 'busy'; text = 'Server needs a password — click here'; }
    else if (a) ({ cls, text, tip } = pillState(readCapacity(a), a));
    else { cls = 'busy'; text = 'No server'; }
  }
  els.statusDot.className = 'dot ' + cls;
  els.statusText.textContent = text;
  els.status.title = tip || 'Connection';
}

// ---- farm capacity, read once ------------------------------------------------
// The topbar pill and the farm card both answer "can I send a message right now",
// so they read capacity through here rather than each doing their own arithmetic
// (they disagreed the moment seats arrived).
//
// Two different numbers, and conflating them was actively misleading: a SEAT is
// the right to generate — farm-v0.0.36+ ENFORCES it, refusing past `slots` with a
// 429 instead of quietly queueing — while `clients` is merely who has the app
// open. Someone connected and reading old chats holds no seat. Seats decide
// whether the next message is answered, so seats lead. Farms older than the seat
// gate send seatsUsed: null; those really do queue, so they keep the old wording.
function readCapacity(f) {
  const cap = (f && f.capacity) || {};
  const u = (f && f.usage) || {};
  const seatsKnown = cap.seatsUsed != null && cap.slots != null;
  const free = seatsKnown ? Math.max(0, cap.slots - cap.seatsUsed) : null;
  return {
    seatsKnown,
    free,
    slots: cap.slots != null ? cap.slots : null,
    clients: cap.clients != null ? cap.clients : (u.clients != null ? u.clients : null),
    seatsUsed: cap.seatsUsed != null ? cap.seatsUsed : null,
    // This computer holds one of the seats (unicast /lol/self only; absent = no): a full farm still lets it in.
    mine: cap.mine === true,
    queued: cap.queued || null,
    idleMin: cap.seatIdleSec ? Math.round(cap.seatIdleSec / 60) : null,
    full: seatsKnown ? free === 0 : (cap.slots != null && (cap.clients || 0) >= cap.slots),
    gpuUtil: u.gpuUtil != null ? u.gpuUtil : null,
  };
}

// The short suffix beside the farm name in the topbar. Free seats, because that
// is the only figure that changes what the user can do next. GPU% is the fallback
// for farms too old to report capacity — it looks alarming at 100% while being
// exactly what a healthy box does mid-answer, which is why it lost the top spot.
// Plus the engine's own queue when it reports one (llama.cpp, vLLM): with seats
// near what the card serves, the engine queues the rest (plan §13, decision 2),
// so the usual wait is a slow first word — and an Open WebUI chat, whose
// requests the shell cannot see, has nothing else to say why.
function capacityPill(c) {
  const q = c.queued ? ` · ${c.queued} waiting` : '';
  if (c.seatsKnown) return ` · ${c.free}/${c.slots} free${q}`;
  if (c.slots != null) return ` · ${c.clients || 0}/${c.slots}${q}`;
  return c.gpuUtil != null ? ` · ${c.gpuUtil}% GPU${q}` : q;
}

// The pill's tooltip: what a full farm, or that queue, means for the next message
// ('' = nothing to add). A computer holding no seat on a full farm never reaches the
// queue: the seat gate refuses its message until a seat frees. Farms before the
// unicast `mine` (farm-v0.0.41 and older) never say whether THIS computer holds one,
// so the sentence must stay true for a computer that does.
function capacityTip(c) {
  const q = c.queued ? `${c.queued} message${c.queued > 1 ? 's are' : ' is'} queued at the model.` : '';
  if (c.seatsKnown && c.full && !c.mine) {
    const when = c.idleMin ? ` (about ${c.idleMin} min after its holder's last reply)` : '';
    return [`Every seat is taken: a computer without one has its new message refused until one frees${when}.`, q].filter(Boolean).join(' ');
  }
  return q && `${q} A new one waits its turn, so the first word of its reply may be slow.`;
}

// The pill for the farm in use: its colour, its words and its tooltip.
function pillState(c, a) {
  // Live load next to the name — at-a-glance "can I send a message right now".
  // Free SEATS, not connected clients: since the seat gate a full farm refuses
  // the next generation, so "0 free" is the one number that changes what the
  // user can do. GPU% is the fallback for farms too old to report either
  // (it looks alarming at 100% while being exactly what a healthy box does
  // mid-answer, which is why it lost the top spot).
  // A farm with no free seat is not broken, but it will refuse the next
  // message — amber says "wait" without saying "error". A queue at the
  // engine is the other wait: the next message is let in, then waits there.
  const s = { cls: (c.seatsKnown && c.full) || c.queued ? 'busy' : 'ready', text: a.name + capacityPill(c), tip: capacityTip(c) };
  // The farm advertises its in-flight admin job (model download, backend
  // switch) as `busy`. While one runs the proxy can bounce — without this the
  // pill (and the user's mental model) flips to "broken" for something the
  // operator did on purpose. Say what is happening instead.
  if (a.busy && a.busy.label) Object.assign(s, { cls: 'busy', text: `${a.name} · ${a.busy.label}…`, tip: '' });
  // The engine-down signal (snapshot.healthy=false) and beacon silence must
  // reach the ONE trust indicator users look at — a dead farm stayed a green
  // pill for up to 120 s otherwise.
  if (a._stale) Object.assign(s, { cls: 'busy', text: `${a.name} · not responding…`, tip: '' });
  else if (a.healthy === false) Object.assign(s, { cls: 'error', text: `${a.name} · problem on the server`, tip: '' });
  return s;
}

// The card's capacity line, as plain language.
function capacityText(c) {
  const bits = [];
  if (c.seatsKnown) {
    // A full farm must say when it frees, or it reads as permanently shut.
    bits.push(c.free === 0
      ? `all ${c.slots} seat${c.slots > 1 ? 's' : ''} busy${c.idleMin ? ` — one frees after ${c.idleMin} min idle` : ''}`
      : `${c.free} of ${c.slots} seat${c.slots > 1 ? 's' : ''} free`);
    // Presence is secondary, and only worth saying when it differs from the seat
    // count — otherwise it just repeats the line above.
    if (c.clients && c.clients !== c.seatsUsed) bits.push(`${c.clients} connected`);
  } else if (c.slots != null) {
    bits.push(`${c.clients || 0} of ${c.slots} slot${c.slots > 1 ? 's' : ''} in use`);
  } else if (c.clients) {
    bits.push(`${c.clients} connected`);
  }
  if (c.queued) bits.push(`${c.queued} waiting`);
  return bits;
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
let settingsChecked = false; // the one-time user-settings fixes below (web search, date line), once per session
let settingsFixing = false;  // ...and they are writing right now: the Blender write waits (maybeSeedBlender)
let blenderSeeded = false;   // register the Blender tool server with OWUI at most once per session

// Web search is OFF by default in Open WebUI (owner, 2026-10-05: on, a chat cost ~2.5x the GPU
// work and got 1 of 4 fresh facts right); a chat's globe switch (Integrations ▸ Web Search) turns
// it on for that chat. Clients up to v0.2.7 turned it on for every chat, once per profile:
// `ui.webSearch = 'always'` + a `ui.lolWebSearchSeeded` marker. This undoes that ONCE, only on a
// profile LOL seeded, and only while it is still 'always' (what we wrote): a person who chose
// otherwise keeps their choice. `lolWebSearchUnseeded` is written either way, so a person who
// later picks 'always' themselves is never switched back. null, not a dropped key: OWUI 0.11
// patches `ui` field by field (a missing key keeps its value, null removes it) and 0.10 replaces
// `ui` whole (null reads as off) — null is what OWUI's own Interface toggle writes for off. A read
// that fails finds no marker, so it never writes (0.10 would have replaced `ui` with ours).
// Returns 'set' (wrote: reload, so the SPA's stale settings can't write 'always' back) |
// 'already' (nothing to do) | 'na' (not authed / the write failed).
async function unseedWebSearch() {
  try {
    return await els.webview.executeJavaScript(`(async () => {
      try {
        const t = window.localStorage && window.localStorage.token; if (!t) return 'na';
        const H = { authorization: 'Bearer ' + t };
        const cur = await (await fetch('/api/v1/users/user/settings', { headers: H })).json().catch(() => null);
        const ui = (cur && cur.ui) || {};
        if (!ui.lolWebSearchSeeded || ui.lolWebSearchUnseeded) return 'already';
        if (ui.webSearch === 'always') ui.webSearch = null;
        ui.lolWebSearchUnseeded = true;
        const r = await fetch('/api/v1/users/user/settings/update', {
          method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ ui })
        });
        return r.ok ? 'set' : 'na';
      } catch (e) { return 'na'; }
    })()`);
  } catch { return 'na'; }
}

// Tell the model the date (owner, 2026-10-05): without it the model believes it is 2025, searches for
// "2025" and rejects a 2026 fact as "the future", the largest cause of wrong web answers measured. No
// env does it on both versions: DEFAULT_MODEL_PARAMS.system never reaches a farm model's messages (OWUI
// drops `system` from the request params and adds it only for a Workspace model saved in its database),
// and 0.11's DEFAULT_INTERFACE_SETTINGS is missing from 0.10 and comes back when a person empties it.
// So this writes the person's own system prompt (Settings ▸ General ▸ System Prompt, `ui.system`),
// once per profile and only when it is empty. Open WebUI sends it with every chat message and fills
// both variables at each send (the page's clock, else the sidecar's), so the date is always the day of
// the message; title generation never sees it. `lolDateLineSeeded` is written either way: a prompt the
// person wrote is never touched, and one they empty later stays empty. Unlike unseedWebSearch, an
// empty read here WOULD write, so a read that fails or is not JSON returns 'na' before anything is
// written (0.10 would replace `ui` with ours); a profile that never saved a setting reads as `null`.
// Returns 'set' (wrote: reload) | 'already' | 'na' (not authed / the read or the write failed).
async function seedDateLine() {
  try {
    return await els.webview.executeJavaScript(`(async () => {
      try {
        const t = window.localStorage && window.localStorage.token; if (!t) return 'na';
        const H = { authorization: 'Bearer ' + t };
        const got = await fetch('/api/v1/users/user/settings', { headers: H });
        if (!got.ok) return 'na';
        const cur = await got.json();
        const ui = (cur && cur.ui) || {};
        if (ui.lolDateLineSeeded) return 'already';
        if (!ui.system) ui.system = 'Today is {{CURRENT_WEEKDAY}} {{CURRENT_DATE}}.';
        ui.lolDateLineSeeded = true;
        const r = await fetch('/api/v1/users/user/settings/update', {
          method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ ui })
        });
        return r.ok ? 'set' : 'na';
      } catch (e) { return 'na'; }
    })()`);
  } catch { return 'na'; }
}

// Register the LOCAL Blender tool server (our mcpo) with OWUI as a USER tool server
// AND select it, so a tool-capable model actually receives it. Two distinct steps
// (verified against OWUI v0.10.2 source — an adversarial audit caught that step 2 is
// required and was missing):
//   1) AVAILABILITY — append our connection to settings.toolServers (ui.toolServers).
//   2) SELECTION — add 'direct_server:<idx>' to settings.tools (ui.tools). OWUI seeds
//      each new chat's selectedToolIds from $settings.tools; ONLY selected direct
//      servers are put in the completion's tool_servers (Chat.svelte). Availability
//      alone (ui.toolServers) is NEVER auto-selected, so the model would get nothing.
// idx = position among ENABLED tool servers (getToolServersData filters config.enable).
// We do NOT touch function_calling: OWUI already defaults to native (the mode gate is
// `!= 'legacy'`), so setting it was a no-op. Runs in the authed webview like
// unseedWebSearch. Idempotent, keyed by info.id. Returns 'set'|'already'|'na'|'err:<code>'.
async function seedBlenderToolServer(url, key) {
  try {
    return await els.webview.executeJavaScript(`(async () => {
      try {
        const t = window.localStorage && window.localStorage.token; if (!t) return 'na';
        const H = { authorization: 'Bearer ' + t };
        const url = ${JSON.stringify(url)}, key = ${JSON.stringify(key)};
        const ID = 'lol-blender';
        const conn = { url, path: '/openapi.json', auth_type: 'bearer', key, config: { enable: true },
          info: { id: ID, name: 'Blender', description: 'Control Blender running on this machine.' } };
        const cur = await (await fetch('/api/v1/users/user/settings', { headers: H })).json().catch(() => null);
        const ui = (cur && cur.ui) || {};
        const list = Array.isArray(ui.toolServers) ? ui.toolServers : [];
        let changed = false;
        // 1) availability
        const mine = list.find(c => c && c.info && c.info.id === ID);
        if (!(mine && mine.url === url && mine.key === key)) {
          ui.toolServers = [...list.filter(c => !(c && c.info && c.info.id === ID)), conn];
          changed = true;
        } else { ui.toolServers = list; }
        // 2) selection (the fix): put 'direct_server:<idx>' into ui.tools
        const enabled = (ui.toolServers || []).filter(c => c && c.config && c.config.enable);
        const idx = enabled.findIndex(c => c && c.info && c.info.id === ID);
        if (idx >= 0) {
          const sel = 'direct_server:' + idx;
          const tools = Array.isArray(ui.tools) ? ui.tools : [];
          if (!tools.includes(sel)) { ui.tools = [...tools, sel]; changed = true; }
        }
        if (!changed) return 'already';
        const r = await fetch('/api/v1/users/user/settings/update', {
          method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ ui })
        });
        return r.ok ? 'set' : ('err:' + r.status);
      } catch (e) { return 'err:' + ((e && e.message) || 'x'); }
    })()`);
  } catch { return 'na'; }
}

// Remove our Blender tool server + its selection from OWUI's user settings (off).
// Also shifts any higher direct_server indices down by one (removing our entry
// changes the enabled-server ordering the indices refer to).
async function unseedBlenderToolServer() {
  try {
    return await els.webview.executeJavaScript(`(async () => {
      try {
        const t = window.localStorage && window.localStorage.token; if (!t) return 'na';
        const H = { authorization: 'Bearer ' + t };
        const ID = 'lol-blender';
        const cur = await (await fetch('/api/v1/users/user/settings', { headers: H })).json().catch(() => null);
        const ui = (cur && cur.ui) || {};
        const list = Array.isArray(ui.toolServers) ? ui.toolServers : [];
        const oldIdx = list.filter(c => c && c.config && c.config.enable).findIndex(c => c && c.info && c.info.id === ID);
        const others = list.filter(c => !(c && c.info && c.info.id === ID));
        if (others.length === list.length) return 'already';
        ui.toolServers = others;
        if (Array.isArray(ui.tools) && oldIdx >= 0) {
          ui.tools = ui.tools.filter(x => x !== 'direct_server:' + oldIdx).map(x => {
            if (typeof x === 'string' && x.indexOf('direct_server:') === 0) {
              const n = parseInt(x.slice(14), 10);
              if (n > oldIdx) return 'direct_server:' + (n - 1);
            }
            return x;
          });
        }
        const r = await fetch('/api/v1/users/user/settings/update', {
          method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ ui })
        });
        return r.ok ? 'removed' : ('err:' + r.status);
      } catch (e) { return 'err:' + ((e && e.message) || 'x'); }
    })()`);
  } catch { return 'na'; }
}

// Seed the Blender tool server once per session, if the local mcpo is ready and the
// webview is authed. Called on auth success AND when mcpo reports 'ready' (whichever
// is later — on first launch mcpo installs for ~1 min, so it's usually the latter).
// Returns true if it registered + kicked a reload (so callers can bail). Not while the one-time
// fixes write: each write sends back the whole `ui` it read, so of two at once one is lost (0.10
// replaces `ui` whole; on 0.11 the Blender write's stale webSearch 'always' turns web search back
// on). ensureAuthenticated calls this again once they are done, or on the load after the reload
// they kick.
async function maybeSeedBlender() {
  if (blenderSeeded || !webviewAuthed || settingsFixing) return false;
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
      // First authed load per session: switch off the web-search default an older client
      // set, and write the date line into an empty system prompt. One after the other: on
      // 0.10 each write replaces `ui` whole, so the second reads what the first wrote. If
      // either wrote, reload once so the SPA picks up the fresh settings (its $settings was
      // loaded before we wrote them); the markers then no-op.
      if (!settingsChecked) {
        settingsChecked = true; settingsFixing = true;
        const webSearch = await unseedWebSearch();
        const dateLine = await seedDateLine();
        settingsFixing = false; // neither throws: each returns 'na' on any failure
        if (webSearch === 'set' || dateLine === 'set') { try { els.webview.reload(); } catch { /* not ready */ } return; }
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
  // No-OWUI build: there is no sidecar to wait for, so the overlay reflects whether
  // a FARM has been found. Everything below this point is OWUI lifecycle.
  if (NO_OWUI) {
    renderPill();
    const haveFarm = !!(window.__lolFarm && window.__lolFarm.openaiBaseUrl);
    els.overlay.classList.toggle('hidden', haveFarm);
    if (!haveFarm) {
      els.panelIcon.innerHTML = ICON_PLUG;
      els.panelTitle.textContent = 'Looking for your server…';
      els.panelMsg.textContent = 'Searching the local network for a LlmOnLan farm.';
      els.panelDetail.textContent = '';
      els.panelActions.innerHTML = '';
    }
    return;
  }
  const s = sidecarState;
  if (!s) return;
  renderPill();
  if (s.status === 'starting' || s.status === 'restarting') pendingReload = true;

  if (s.status === 'ready' && s.url) {
    if (s.url !== lastUrl) {
      // New OWUI origin → reset the auth-bootstrap gate (fresh per-origin storage).
      lastUrl = s.url; webviewAuthed = false; authReloads = 0; settingsChecked = false; blenderSeeded = false;
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
  // Never rebuild the list under someone TYPING A PASSWORD: farms events land
  // per received beacon (a 13-box fleet ≈ several per second), and innerHTML
  // rebuilds wipe focus and the typed characters — password entry was
  // impossible exactly where it matters. The next event after blur repaints.
  const ae = document.activeElement;
  if (ae && ae.classList && ae.classList.contains('farm-key-in')) return;
  // scanning / count line
  const n = farmState.farms.length;
  els.popScan.textContent = farmState.scanning ? 'scanning…' : (n ? `${n} found` : '');
  els.autoScan.checked = !!farmState.autoScan;

  els.farmList.innerHTML = '';
  els.farmEmpty.classList.toggle('hidden', n > 0);

  const active = activeFarm();
  // Clicking a card PINS that farm (main always prefers it while it is healthy). This row is
  // the way back: it clears the pin, so the least-busy choice applies again (docs review SA-5).
  // Shown when there is a choice to make, or a pin to undo.
  const pinnedId = farmState.selectedFarmId || null;
  const pinned = pinnedId ? farmState.farms.find((f) => f.id === pinnedId) : null;
  if (n > 1 || pinnedId) {
    const auto = document.createElement('div');
    auto.className = 'farm farm-auto' + (pinnedId ? '' : ' farm-auto-on');
    auto.title = 'Let the app choose: the least busy farm when it connects, and the same farm for as long as it keeps working.';
    auto.innerHTML =
      `<div class="farm-main">` +
        `<div class="farm-name">Automatic — least busy farm</div>` +
        `<div class="farm-meta">${pinnedId
          ? `Off — pinned to ${esc(pinned ? pinned.name : 'a farm that is not on the network')}. Click to let the app choose.`
          : 'On — click a farm below to pin it instead.'}</div>` +
      `</div>`;
    auto.onclick = () => {
      if (!pinnedId) return;
      window.lol.selectFarm(null);
      // Unpinning does not move you: main keeps a healthy current farm (no needless OWUI restart).
      toast(active ? `Automatic — staying on ${active.name} while it works` : 'Automatic — connecting to the least busy farm');
    };
    els.farmList.appendChild(auto);
  }

  for (const f of farmState.farms) {
    const isActive = active && f.id === active.id;
    const row = document.createElement('div');
    row.className = 'farm' + (isActive ? ' active' : '');
    const dotCls = f.healthy && !f._stale ? 'ready' : (f._stale ? 'busy' : 'error');
    // Show the served name AND the real model behind it (alias mode), so each box
    // reveals what model it actually runs — e.g. "assistant (qwen3.6:30b) ★". The
    // whole string is esc()'d where it's rendered below, so keep raw here.
    const models = (f.models || []).map((m) => {
      const real = m.underlying && m.underlying !== m.id ? ` (${m.underlying})` : '';
      return m.id + real + (m.default ? ' ★' : '');
    }).join(', ') || 'no models';
    // Fleet view: everything the beacon tells us about the box, per row.
    // Badges: how we found it + special roles.
    const badges =
      `<span class="farm-src">${f._source}</span>` +
      (f.coordinator ? `<span class="farm-src farm-coord">coordinator</span>` : '') +
      (f.id === pinnedId ? `<span class="farm-src farm-pin" title="You picked this farm. Choose “Automatic” above to undo.">pinned</span>` : '') +
      (f.searxngUrl ? `<span class="farm-src">web search</span>` : '') +
      (f.requiresKey ? `<span class="farm-src">🔒${f._hasKey ? '' : ' password needed'}</span>` : '');
    // Live line: GPU util, VRAM used/total, loaded models, backends, hosts.
    const u = f.usage || {};
    const live = [];
    if (u.gpuUtil != null) live.push(`${u.gpuUtil}% GPU`);
    if (u.vramUsedGb != null && u.vramTotalGb != null) live.push(`${u.vramUsedGb}/${u.vramTotalGb}GB VRAM`);
    if (u.loaded && u.loaded.length) live.push(`loaded: ${u.loaded.join(', ')}`);
    if (f.deployments != null && f.deployments > 1) live.push(`${f.deployments} backends`);
    if (f.health && f.health.hostsTotal > 1) live.push(`${f.health.hostsUp}/${f.health.hostsTotal} hosts`);
    const liveLine = live.length ? `<div class="farm-hw">${esc(live.join(' · '))}</div>` : '';
    const capInfo = readCapacity(f);
    // What actually answers here: the engine + the real weights behind the alias.
    const be = f.backend || null;
    const beLine = be && be.engine
      ? `${be.engine}${be.model ? ' · ' + be.model : ''}`
      : '';
    // Amber only when it actually affects the user: no seat to take.
    const loadCls = capInfo.full ? ' farm-busy' : '';
    const capBits = capacityText(capInfo).concat(beLine ? [beLine] : []);
    const capLine = capBits.length
      ? `<div class="farm-hw${loadCls}">${esc(capBits.join(' · '))}</div>` : '';
    // The in-flight admin job, with its progress — so "the farm went quiet" has a
    // visible reason on the card the user is already looking at.
    const busyLine = f.busy && f.busy.label
      ? `<div class="farm-hw farm-busy">⏳ ${esc(f.busy.label)}${f.busy.percent != null ? ` · ${f.busy.percent}%` : ''}${f.busy.message ? ` — ${esc(f.busy.message)}` : ''}</div>`
      : '';
    const hwLine = (f.host && f.host.gpu)
      ? `<div class="farm-hw">${esc(f.host.gpu)} · ${f.host.vramGb}GB</div>` : '';
    // Farm plugins that are ON (search / voice / OCR) + client-plugin recommendations.
    const plugs = f.plugins || {};
    const onPlugs = Object.keys(plugs).filter((k) => plugs[k] && plugs[k].enabled)
      .map((k) => (plugs[k].label || k) + (plugs[k].healthy ? '' : ' (starting)'));
    const plugLine = onPlugs.length ? `<div class="farm-hw">plugins: ${esc(onPlugs.join(' · '))}</div>` : '';
    const REC_LABEL = { blender: 'Blender tools' };
    const recs = (f.recommendedClientPlugins || []).map((r) => REC_LABEL[r] || r);
    const recLine = recs.length ? `<div class="farm-hw">recommends: ${esc(recs.join(', '))}</div>` : '';
    // "Manage this farm" opens the farm-served admin page (needs the farm's admin port).
    const manageBtn = f.httpPort ? `<button class="farm-manage" data-manage="${esc(f._host)}:${f.httpPort}">Manage this farm ↗</button>` : '';
    // A keyed farm without its password cannot be used — the card itself asks.
    // Verified in the MAIN process against the real endpoint before storing, so a
    // wrong password is a toast, never a stored 401-loop.
    const needsKey = !!(f.requiresKey && !f._hasKey);
    const keyRow = needsKey
      ? `<div class="farm-keyrow"><input type="password" class="farm-key-in" placeholder="farm password" spellcheck="false" /><button class="farm-key-go" data-keyfarm="${esc(f.id)}">Connect</button></div>`
      : '';
    row.innerHTML =
      `<span class="dot ${dotCls}"></span>` +
      `<div class="farm-main">` +
        `<div class="farm-name">${esc(f.name)} ${badges}</div>` +
        `<div class="farm-meta">${esc(f._host)}:${f.proxyPort} · ${esc(models)}</div>` +
        keyRow +   // the ONE actionable element on a locked card goes first, not under telemetry
        busyLine +
        capLine +
        liveLine +
        hwLine +
        plugLine +
        recLine +
        manageBtn +
      `</div>` +
      `<span class="farm-check">${isActive ? ICON_CHECK : ''}</span>`;
    row.title = f.id === pinnedId ? `${f.name} is pinned` : `Use ${f.name} (pins it until you choose Automatic)`;
    row.onclick = () => {
      if (needsKey) { const inp = row.querySelector('.farm-key-in'); if (inp) inp.focus(); return; }
      window.lol.selectFarm(f.id); toast(`Connecting to ${f.name}…`);
    };
    const keyGo = row.querySelector('button.farm-key-go');
    if (keyGo) {
      const submitKey = async (e) => {
        e.stopPropagation();
        const inp = row.querySelector('.farm-key-in');
        const v = (inp && inp.value || '').trim();
        if (!v) { if (inp) inp.focus(); return; }
        keyGo.disabled = true; keyGo.textContent = '…';
        const r = await window.lol.setFarmKey(f.id, v);
        // Entering a password makes the farm USABLE; it does not pin it (docs review SA-5 — on a
        // keyed fleet every client used to pin itself to the first farm it typed a password for).
        // Main re-runs the choice at once, so with no farm in use this one connects now.
        const using = activeFarm();
        if (r && r.ok) toast(using && using.id !== f.id ? `Password saved for ${f.name}. Click its card to switch to it.` : `Password accepted — connecting to ${f.name}…`);
        else { toast((r && r.error) || 'Wrong password'); keyGo.disabled = false; keyGo.textContent = 'Connect'; if (inp) { inp.select(); inp.focus(); } }
      };
      keyGo.onclick = submitKey;
      const inp = row.querySelector('.farm-key-in');
      if (inp) {
        inp.onclick = (e) => e.stopPropagation();
        inp.onkeydown = (e) => { if (e.key === 'Enter') submitKey(e); };
      }
    }
    const mBtn = row.querySelector('button.farm-manage');
    if (mBtn) mBtn.onclick = (e) => { e.stopPropagation(); window.lol.openExternal(`http://${mBtn.dataset.manage}/lol/admin`); };
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
window.lol.onFarms((data) => { farmState = data; if (NO_OWUI) publishFarm(); renderPill(); if (!els.popover.classList.contains('hidden')) renderPopover(); });
window.lol.getSidecarState().then((s) => { sidecarState = s; renderSidecar(); });
window.lol.getFarms().then((data) => { farmState = data; renderPill(); });
initTheme();
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  window.lol.getSettings().then((s) => { if (s.theme === 'system') applyThemeClass('system'); });
});

// ---- LOL Vibe: alternative view to the OWUI webview -------------------------
// The chat surface talks straight to the farm's OpenAI endpoint, so it needs the
// endpoint the sidecar is currently pointed at. Published on `window` rather than
// re-derived in chat/ (net/farm.mjs reads it) so there is exactly one source of truth
// for "which farm".
function publishFarm() {
  const f = activeFarm();
  // The farm's advertised default (snapshot.models[].default) rides along so the
  // chat's model picker auto-selects what the farm wants clients on — with the
  // llama.cpp backend that is the alias it serves, not an Ollama model that would
  // fight it for VRAM.
  const defaultModel = f && Array.isArray(f.models) && f.models.length
    ? ((f.models.find((m) => m.default) || f.models[0]).id || null)
    : null;
  window.__lolFarm = f
    // LOL Vibe vNext needs more of the snapshot than the endpoint: the served catalog for its
    // picker, the backend's context-per-slot for its budget meter, the seat counts for the seat
    // gate, and the plugin URLs. Every field below is ADDITIVE and read off the same main-shaped
    // farm object; the OWUI path never looks at window.__lolFarm.
    ? {
      name: f.name, openaiBaseUrl: farmEndpoint(f), defaultModel, busy: f.busy || null, apiKey: f._key || null,
      id: f.id || null, requiresKey: !!f.requiresKey, healthy: f.healthy !== false,
      stale: !!f._stale, lastSeen: f._lastSeen || null, host: f._host || null, httpPort: f.httpPort || null,
      models: Array.isArray(f.models) ? f.models.map((m) => ({ id: m.id, underlying: m.underlying || null, default: !!m.default })) : [],
      backend: f.backend ? {
        engine: f.backend.engine || null, alias: f.backend.alias || null,
        contextLength: f.backend.contextLength ?? null, contextPerSlot: f.backend.contextPerSlot ?? null,
        slots: f.backend.slots ?? null,
      } : null,
      capacity: f.capacity || null, perf: f.perf || null,
      usage: f.usage ? { gpuUtil: f.usage.gpuUtil ?? null } : null,
      searxngUrl: f.searxngUrl || null,
      ttsUrl: f.ttsUrl || null, ttsVoice: f.ttsVoice || 'af_heart', ttsModel: f.ttsModel || 'kokoro',
      extract: f.extract && f.extract.url && f.extract.key ? { url: f.extract.url, key: f.extract.key } : null,
      classify: f.classify && f.classify.url && f.classify.key ? { url: f.classify.url, key: f.classify.key } : null,
      stt: f.stt && f.stt.url && f.stt.key ? { url: f.stt.url, key: f.stt.key } : null,
      bus: f.bus && f.bus.ws ? { ws: f.bus.ws, mqtt: f.bus.mqtt || null, osc: f.bus.osc || null, auth: !!f.bus.auth } : null,
    }
    : (sidecarState && sidecarState.endpoint ? { name: 'farm', openaiBaseUrl: sidecarState.endpoint, defaultModel: null } : null);
  if (window.__lolChatRefresh) window.__lolChatRefresh();
  // The overlay is FARM-driven in this build, but renderSidecar used to run only
  // on sidecar events — which can all have fired before discovery found anything,
  // leaving the "Looking for your server…" overlay stuck over a working chat.
  if (NO_OWUI) renderSidecar();
}

// OWUI is the primary surface; the topbar toggle switches the main area to LOL
// Chat or the Computer and back. The webview keeps running while hidden, so
// switching back is instant and never re-authenticates.
//
// The FIRST LINE of this comment is an anchor: shell/test/chat-harness/extract-app-bridge.js
// slices publishFarm out of this file and ends the slice on the literal
// "// OWUI is the primary surface". Reword it and every harness run throws.
(() => {
  const VIEWS = ['owui', 'chat', 'computer'];
  const chat = $('lolchat');
  const computer = $('lolcomputer');
  // KEEP this guard: everything below, setInterval(publishFarm) included, dies with this IIFE if
  // it throws — a missing section would silently stop all farm republishing.
  if (!chat || !computer) return;
  let view = 'owui';
  function show(next) {
    if (!VIEWS.includes(next)) next = 'owui';
    if (NO_OWUI && next === 'owui') next = 'chat';
    view = next;
    chat.classList.toggle('hidden', view !== 'chat');
    computer.classList.toggle('hidden', view !== 'computer');
    if (els.webview) els.webview.classList.toggle('hidden', view !== 'owui');
    // styles.css keeps #overlay/#owui out of the way on the other two surfaces, so renderSidecar()
    // never has to know a view exists (COMPUTER_PLAN §2.2a).
    document.body.dataset.view = view;
    for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    try { localStorage.setItem('lol:view', view); } catch (e) { /* private mode */ }
    publishFarm();
  }
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => show(b.dataset.view));
  if (NO_OWUI) { const o = $('view-owui'); if (o) o.classList.add('hidden'); }
  let saved = null;
  try { saved = localStorage.getItem('lol:view'); } catch (e) { /* private mode */ }
  show(saved || (NO_OWUI ? 'chat' : 'owui'));
  // Keep the endpoint fresh while the farm is being (re)selected.
  setInterval(publishFarm, 4000);
})();
