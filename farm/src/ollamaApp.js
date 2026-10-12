// The Ollama desktop app's "Model location" (owner, 2026-10-12: "yes set ollama model location itself"). When the
// Ollama on this computer is the app's (Windows, macOS), a move of its models ends with the app reading the new folder:
// the farm sets that one setting itself, after the copy is checked, instead of asking a person to.
//
// What the app does (its source, github.com/ollama/ollama, read at main c1c536297f and v0.40.3, 2026-10-12):
// - The setting is the `models` column of the one row of the `settings` table of an SQLite file (app/store/database.go;
//   in the first released schema too): %LOCALAPPDATA%\Ollama\db.sqlite, ~/Library/Application Support/Ollama/db.sqlite.
//   Empty = the app's own OLLAMA_MODELS, else ~/.ollama/models. It wins over the user's OLLAMA_MODELS.
// - The app reads it each time it starts its `ollama serve` (app/server/server.go cmd()): at its own start.
// - Its settings page has an HTTP API, but behind a per-launch token held in memory only: not for another program.
// - The file is opened in WAL mode with a busy timeout; schema migrations only add columns (version 12 to 19 so far).
// So: the app is quit the way its tray's Quit does it (Windows: a close to its window, `taskkill` without /F; macOS:
// SIGTERM, which its main loop handles), the one column is written through SQLite (Node's own node:sqlite: never a
// copy of the file), and the app is opened again, hidden. The old value is read first and written back on any failure.
// Any other case (Linux, where Ollama is a service; an app the farm cannot find; a file without that column) is
// `detect().ok === false`: the panel then tells the person what to set, as before.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { isAlive } = require('./proc');

function dbPath({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
    if (platform === 'win32') return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Ollama', 'db.sqlite') : null;
    if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Ollama', 'db.sqlite');
    return null;
}
function sqlite() {
    // Node 22.5+ and Electron 42 (the Farm app) have it; it prints an "experimental" warning once.
    try { return require('node:sqlite'); } catch { return null; }
}
// {models, schema} of the app's settings, or {error}. Read-only, never creating the file.
function readSettings(file) {
    const sql = sqlite();
    if (!sql) return { error: 'this Node has no SQLite' };
    if (!file || !fs.existsSync(file)) return { error: 'no settings file' };
    let db;
    try {
        db = new sql.DatabaseSync(file, { readOnly: true });
        const cols = db.prepare('PRAGMA table_info(settings)').all().map((c) => c.name);
        if (!cols.includes('models')) return { error: 'its settings have no model location' };
        const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
        if (!row) return { error: 'its settings are empty' };
        return { models: String(row.models || ''), schema: Number(row.schema_version || 0) };
    } catch (e) { return { error: e.message }; } finally { try { if (db) db.close(); } catch { /* closed */ } }
}
// Write the one column (the app quit), then read it back. → {ok, error}.
function writeModels(file, value) {
    const sql = sqlite();
    if (!sql) return { ok: false, error: 'this Node has no SQLite' };
    let db;
    try {
        db = new sql.DatabaseSync(file);
        db.exec('PRAGMA busy_timeout = 5000');
        const r = db.prepare('UPDATE settings SET models = ? WHERE id = 1').run(String(value));
        if (!r.changes) return { ok: false, error: 'its settings row is missing' };
    } catch (e) { return { ok: false, error: e.message }; } finally { try { if (db) db.close(); } catch { /* closed */ } }
    const back = readSettings(file);
    return back.models === String(value) ? { ok: true, error: null } : { ok: false, error: 'the value did not stay' };
}

const runText = (cmd, args, timeout = 15000) => new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout }, (err, out) => resolve({ ok: !err, out: String(out || '') }));
});
// The app's process: {pid, exe}, or null when it does not run. Windows: "ollama app.exe"; macOS: Ollama.app's binary.
async function appProcess({ platform = process.platform, run = runText } = {}) {
    if (platform === 'win32') {
        const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            "Get-Process -Name 'ollama app' -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { '' + $_.Id + '|' + $_.Path }"]);
        const m = /^(\d+)\|(.+)$/m.exec(r.out.trim());
        return m ? { pid: Number(m[1]), exe: m[2].trim() } : null;
    }
    if (platform === 'darwin') {
        const r = await run('pgrep', ['-x', 'Ollama']);
        const pid = Number(r.out.trim().split(/\s+/)[0]);
        if (!pid) return null;
        const p = await run('ps', ['-p', String(pid), '-o', 'comm=']);
        return { pid, exe: p.out.trim() || '/Applications/Ollama.app/Contents/MacOS/Ollama' };
    }
    return null;
}

// Can the farm set the Model location here? → {ok, why, db, proc, before}.
async function detect({ platform = process.platform, env = process.env, home = os.homedir(), run = runText } = {}) {
    const db = dbPath({ platform, env, home });
    if (!db) return { ok: false, why: 'Ollama runs as a service here' };
    const s = readSettings(db);
    if (s.error) return { ok: false, why: s.error, db };
    if (s.schema && s.schema < 12) return { ok: false, why: 'an Ollama app older than the farm knows', db };
    const proc = await appProcess({ platform, run });
    if (!proc) return { ok: false, why: 'the Ollama app does not run (Ollama is started another way)', db };
    return { ok: true, why: null, db, proc, before: s.models };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitGone(pid, ms, alive, wait) {
    for (let t = 0; t < ms; t += 250) { if (!alive(pid)) return true; await wait(250); }
    return !alive(pid);
}
// Quit the app as its tray does, then by force when it stays (its chat window open). → true once it is gone.
async function quitApp(proc, { platform = process.platform, run = runText, alive = isAlive, wait = sleep } = {}) {
    if (platform === 'win32') {
        await run('taskkill', ['/PID', String(proc.pid)]);
        if (await waitGone(proc.pid, 20000, alive, wait)) return true;
        await run('taskkill', ['/PID', String(proc.pid), '/T', '/F']);
    } else {
        try { process.kill(proc.pid, 'SIGTERM'); } catch { /* gone */ }
        if (await waitGone(proc.pid, 20000, alive, wait)) return true;
        try { process.kill(proc.pid, 'SIGKILL'); } catch { /* gone */ }
    }
    return waitGone(proc.pid, 10000, alive, wait);
}
// Open it again, hidden (its tray only), as at login.
function startApp(proc, { platform = process.platform, spawnFn = spawn } = {}) {
    const opts = { detached: true, stdio: 'ignore', windowsHide: true };
    const child = platform === 'darwin'
        ? spawnFn('open', ['-j', '-a', proc.exe.replace(/\/Contents\/MacOS\/[^/]+$/, '')], opts)
        : spawnFn(proc.exe, ['hidden'], opts);
    if (child && child.unref) child.unref();
}

// Point the app at `value` (a folder, or '' for its default): quit it, write the setting, open it again. Its server
// stops with it and comes back reading the new folder. On a failure after it quit, the old value goes back and the app
// is opened again. `upAgain()` → true once Ollama answers again (the caller's). → {ok, error}.
async function setModels(value, det, { platform = process.platform, run = runText, alive = isAlive, wait = sleep, spawnFn = spawn, upAgain = async () => true } = {}) {
    if (!det || !det.ok) return { ok: false, error: 'The farm cannot change the Ollama app\'s settings here.' };
    if (!(await quitApp(det.proc, { platform, run, alive, wait }))) return { ok: false, error: 'The Ollama app did not quit, so its Model location was not changed.' };
    const w = writeModels(det.db, value);
    if (!w.ok) {
        startApp(det.proc, { platform, spawnFn });
        return { ok: false, error: `The Ollama app's Model location could not be written (${w.error}); it is as it was, and the app is open again.` };
    }
    startApp(det.proc, { platform, spawnFn });
    if (await upAgain()) return { ok: true, error: null };
    // It did not come back: the old value goes back, and it is opened once more.
    const again = await appProcess({ platform, run });
    if (again) await quitApp(again, { platform, run, alive, wait });
    writeModels(det.db, det.before);
    startApp(det.proc, { platform, spawnFn });
    return { ok: false, error: 'Ollama did not answer after the Ollama app was opened again: its Model location is back as it was.' };
}

module.exports = { dbPath, readSettings, writeModels, appProcess, detect, quitApp, startApp, setModels };
