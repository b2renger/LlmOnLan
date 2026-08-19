// LlmOnLan Farm — renderer. Drives three screens (welcome → setup wizard → running)
// over the `farm` bridge (see preload). No Node here; everything is IPC.

const $ = (sel) => document.querySelector(sel);

const PHASE_ICON = { pending: '', active: '<span class="spin">◜</span>', done: '✓', error: '✕' };

let theme = 'system';
let webviewLoaded = false;
let installed = false;
let shareWithNetwork = false;

// --- theme ------------------------------------------------------------------

function applyThemeClass(t) {
    const dark = t === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : t === 'dark';
    document.documentElement.classList.toggle('light', !dark);
    document.documentElement.classList.toggle('dark', dark);
}
function setTheme(t) {
    theme = t;
    applyThemeClass(t);
    window.farm.setTheme(t);
    const sel = $('#sel-theme'); if (sel) sel.value = t;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'system') applyThemeClass('system'); });

// --- screens ----------------------------------------------------------------

function showScreen(name) {
    for (const s of ['welcome', 'setup', 'running']) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
    $('#running-chrome').classList.toggle('hidden', name !== 'running');
}

// --- toast ------------------------------------------------------------------

let toastTimer = null;
function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

// --- welcome ----------------------------------------------------------------

function renderWelcome(prefs) {
    // gemma4:12b wants ~8 GB of (V)RAM to run comfortably. Warn on a low-memory Mac
    // but never block — the admin panel can add a smaller model.
    if (prefs.platform === 'darwin' && prefs.ramGb && prefs.ramGb < 16) {
        const w = $('#ram-warning');
        w.textContent = `This Mac reports ${prefs.ramGb} GB of memory. gemma4:12b runs best with 16 GB or more — setup will still proceed, and you can add a smaller model from the admin panel afterwards.`;
        w.classList.remove('hidden');
    }
    showScreen('welcome');
}

// --- setup wizard -----------------------------------------------------------

function renderPhases(phases) {
    const list = $('#phase-list');
    list.innerHTML = phases.map((p) => {
        const detail = p.detail ? `<div class="phase-detail" title="${escapeAttr(p.detail)}">${escapeHtml(p.detail)}</div>` : '';
        const bar = (typeof p.percent === 'number')
            ? `<div class="progress"><span style="width:${Math.max(0, Math.min(100, p.percent))}%"></span></div>` : '';
        return `<li class="phase ${p.status}">
            <span class="phase-icon">${PHASE_ICON[p.status] || ''}</span>
            <span class="phase-body">
                <span class="phase-label">${escapeHtml(p.label)}</span>
                ${detail}${bar}
            </span>
        </li>`;
    }).join('');
}

function onSetupProgress(p) {
    if (Array.isArray(p.phases)) renderPhases(p.phases);
    if (p.log) {
        const pre = $('#setup-log');
        pre.textContent += p.log + '\n';
        pre.scrollTop = pre.scrollHeight;
    }
    const err = $('#setup-error');
    if (p.error) {
        $('#setup-error-msg').textContent = p.error;
        err.classList.remove('hidden');
    } else {
        err.classList.add('hidden');
    }
    if (p.installed) {
        installed = true;
        goRunning();
    }
}

async function beginSetup() {
    $('#setup-error').classList.add('hidden');
    $('#setup-log').textContent = '';
    showScreen('setup');
    await window.farm.startSetup(); // progress arrives over onSetupProgress; installed:true flips the screen
}

// --- running ----------------------------------------------------------------

function statusClass(status) {
    if (status === 'ready') return 'ready';
    if (status === 'starting' || status === 'restarting') return 'busy';
    if (status === 'error') return 'error';
    return '';
}
function statusLabel(status) {
    return { ready: 'Running', starting: 'Starting…', restarting: 'Restarting…', stopped: 'Stopped', error: 'Error', idle: 'Idle' }[status] || status;
}

async function ensureWebview() {
    if (webviewLoaded) return;
    const w = await window.farm.getAdminWebview();
    if (!w) return;
    const wv = $('#admin');
    wv.setAttribute('preload', w.preloadUrl);
    wv.setAttribute('src', w.url);
    webviewLoaded = true;
}

function renderFarmState(s) {
    // Chrome status dot + Start/Stop label.
    $('#status-dot').className = 'dot ' + statusClass(s.status);
    $('#status-text').textContent = statusLabel(s.status);
    const running = s.status === 'ready' || s.status === 'starting' || s.status === 'restarting';
    const toggle = $('#btn-toggle');
    toggle.textContent = running ? 'Stop' : 'Start';
    toggle.disabled = s.status === 'starting' || s.status === 'restarting';

    // LAN address / privacy posture (only meaningful once the farm is up).
    const lanBar = $('#lan-bar');
    const lanUrlEl = $('#lan-url');
    const copyBtn = $('#btn-copy-lan');
    if (s.status === 'ready') {
        lanBar.classList.remove('hidden');
        if (shareWithNetwork && s.lanUrls && s.lanUrls.length) {
            $('.lan-label').textContent = 'Sharing compute — clients on this network connect automatically. OpenAI endpoint:';
            lanUrlEl.textContent = s.lanUrls[0];
            lanUrlEl.classList.remove('hidden');
            copyBtn.classList.remove('hidden');
        } else {
            // Private (or shared but no LAN address yet): don't invite connections.
            $('.lan-label').textContent = '🔒 Private — only this machine can use this farm. Turn on “Share compute” in Settings to serve the network.';
            lanUrlEl.classList.add('hidden');
            copyBtn.classList.add('hidden');
        }
    } else {
        lanBar.classList.add('hidden');
    }

    // Webview vs overlay.
    const overlay = $('#farm-overlay');
    const wv = $('#admin');
    if (s.status === 'ready') {
        ensureWebview();
        overlay.classList.add('hidden');
        wv.classList.remove('hidden');
    } else {
        wv.classList.add('hidden');
        overlay.classList.remove('hidden');
        $('.spinner').style.display = (s.status === 'starting' || s.status === 'restarting') ? '' : 'none';
        const msg = s.status === 'stopped' ? 'The farm is stopped.'
            : s.status === 'error' ? (s.message || 'The farm hit an error.')
            : 'Starting the farm…';
        $('#overlay-msg').textContent = msg;
        const action = $('#btn-overlay-action');
        if (s.status === 'stopped' || s.status === 'error') {
            action.textContent = 'Start the farm';
            action.classList.remove('hidden');
        } else {
            action.classList.add('hidden');
        }
    }
}

function goRunning() {
    showScreen('running');
    window.farm.getFarmState().then(renderFarmState);
}

// --- settings drawer --------------------------------------------------------

function openSettings() { $('#settings-panel').classList.remove('hidden'); }
function closeSettings() { $('#settings-panel').classList.add('hidden'); }

function updateShareHint() {
    $('#share-hint').textContent = shareWithNetwork
        ? 'On — other people on this network can discover and use this machine for AI compute.'
        : 'Off — the farm is private to this machine. No one else on the network can reach or use it.';
}

function wireSettings(prefs) {
    $('#sel-theme').value = prefs.theme;
    $('#chk-launch').checked = !!prefs.launchAtLogin;
    $('#chk-autoupdate').checked = !!prefs.autoUpdate;
    $('#chk-share').checked = shareWithNetwork;
    $('#sel-context').value = String(prefs.contextLength || 65536);
    updateShareHint();
    $('#app-version').textContent = 'v' + prefs.appVersion;

    $('#sel-theme').addEventListener('change', (e) => setTheme(e.target.value));
    $('#sel-context').addEventListener('change', async (e) => {
        const tokens = Number(e.target.value);
        e.target.disabled = true;
        toast('Applying the new context window — restarting the farm…');
        const r = await window.farm.setContextLength(tokens);
        e.target.disabled = false;
        if (r && r.farmState) renderFarmState(r.farmState);
    });
    $('#chk-share').addEventListener('change', async (e) => {
        shareWithNetwork = e.target.checked;
        updateShareHint();
        toast(shareWithNetwork ? 'Sharing with the network — restarting the farm…' : 'Going private — restarting the farm…');
        const r = await window.farm.setShareNetwork(shareWithNetwork);
        if (r && r.farmState) renderFarmState(r.farmState);
    });
    $('#chk-launch').addEventListener('change', (e) => window.farm.setLaunchAtLogin(e.target.checked));
    $('#chk-autoupdate').addEventListener('change', (e) => window.farm.setAutoUpdate(e.target.checked));
    $('#btn-open-logs').addEventListener('click', () => window.farm.openLogs());
    $('#btn-check-update').addEventListener('click', async () => {
        const b = $('#btn-check-update');
        b.textContent = 'Checking…'; b.disabled = true;
        const r = await window.farm.checkAppUpdate();
        b.disabled = false; b.textContent = 'Check for updates';
        if (r.error) $('#update-status').textContent = `Couldn't check: ${r.error}`;
        else if (r.updateAvailable && r.url) showUpdateAvailable(r.latest, r.url);
        else $('#update-status').textContent = `Up to date (v${r.current}).`;
    });
}

// Manual updates: flip the button into a "Download vX" that opens the release page.
function showUpdateAvailable(version, url) {
    $('#update-status').textContent = `Version ${version} is available.`;
    const b = $('#btn-check-update');
    b.textContent = `Download v${version}`;
    b.disabled = false;
    b.onclick = () => window.farm.openExternal(url);
}

// --- helpers ----------------------------------------------------------------

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

// --- boot -------------------------------------------------------------------

async function boot() {
    const init = await window.farm.getInitState();
    const prefs = init.prefs;
    installed = prefs.installed;
    theme = prefs.theme;
    shareWithNetwork = !!prefs.shareWithNetwork;
    applyThemeClass(theme);
    wireSettings(prefs);

    if (installed) {
        goRunning();
        if (init.farmState) renderFarmState(init.farmState);
    } else {
        renderWelcome(prefs);
    }

    // Live pushes.
    window.farm.onSetupProgress(onSetupProgress);
    window.farm.onFarmState(renderFarmState);
    window.farm.onUpdateAvailable((i) => {
        toast(`A new version (v${i.version}) is available — open Settings to download.`);
        showUpdateAvailable(i.version, i.url);
    });

    // Wiring.
    $('#btn-setup').addEventListener('click', beginSetup);
    $('#btn-retry').addEventListener('click', beginSetup);
    $('#btn-theme').addEventListener('click', () => {
        const dark = document.documentElement.classList.contains('dark');
        setTheme(dark ? 'light' : 'dark');
    });
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-settings-close').addEventListener('click', closeSettings);
    $('#btn-toggle').addEventListener('click', async () => {
        const s = await window.farm.getFarmState();
        const running = s.status === 'ready' || s.status === 'starting' || s.status === 'restarting';
        renderFarmState(await (running ? window.farm.farmStop() : window.farm.farmStart()));
    });
    $('#btn-overlay-action').addEventListener('click', async () => renderFarmState(await window.farm.farmStart()));
    $('#btn-copy-lan').addEventListener('click', () => {
        window.farm.copyText($('#lan-url').textContent);
        toast('Endpoint copied.');
    });
}

boot();
