// PLUGIN_PROGRESS_PLAN (the owner, 2026-11-27: "give the farm operator proper information (including the download
// progress)"): what a plugin's first install tells the panel's job bar. Its steps come from each ensure; its bytes from
// two places:
//   - pip's machine-readable progress (`--progress-bar raw`, pip ≥ 24.1; read on pip 26.2.1, 2026-11-28): each file it
//     downloads, bytes against its size. Exact, so no size table that drifts with each pin (the plan's first idea).
//   - a folder growing on disk, for the weights a service downloads at its first start (Laya's, Whisper's), against their
//     size on Hugging Face, recorded with the date it was read.
// Nothing here runs on the boot path: without a `progress`, pip stays `-q` and its lines go to the farm log as before.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

/**
 * One line of pip's stdout with `--progress-bar raw` → what it says, or null. PURE.
 *   "Downloading torch-2.9.1+cpu-cp312-cp312-win_amd64.whl (110.9 MB)"  → { file }
 *   "Downloading https://download.pytorch.org/whl/cpu/torch-2.9.1%2Bcpu-….whl (110.9 MB)" → { file } (its name)
 *   "Progress 262144 of 12566858"                                        → { bytes, total }
 *   "Using cached torch-2.9.1+cpu-cp312-cp312-win_amd64.whl (110.9 MB)"  → { cached } (no bytes to wait for)
 *   "Installing collected packages: …"                                   → { installing: true }
 * A wheel's metadata ("… .whl.metadata (60 kB)") is not a download worth naming.
 * @param {string} line @returns {{file?: string, cached?: string, bytes?: number, total?: number, installing?: boolean}|null}
 */
function pipLine(line) {
    const s = String(line || '').trim();
    let m = /^Progress (\d+) of (\d+)$/.exec(s);
    if (m) return { bytes: Number(m[1]), total: Number(m[2]) };
    m = /^(Downloading|Using cached) (\S+\.(?:whl|tar\.gz|zip)) \(/.exec(s);
    if (m) {
        let name = m[2].split('/').pop();
        try { name = decodeURIComponent(name); } catch { /* a name that is not URL-encoded stays as it is */ }
        return m[1] === 'Downloading' ? { file: name } : { cached: name };
    }
    if (/^Installing collected packages\b/.test(s)) return { installing: true };
    return null;
}

/**
 * `pip install <args>` with the venv's Python. With `progress(message, percent, {bytes, total})`, pip's raw progress
 * reaches the job bar under `what`; without it, `-q` and the farm log, exactly as the plugins' installs were.
 * @param {string} vpy @param {string[]} args @param {{progress?: Function|null, what?: string, cwd?: string, spawnFn?: Function}} [o]
 * @returns {Promise<void>}
 */
function pipInstall(vpy, args, { progress = null, what = '', cwd = undefined, spawnFn = spawn } = {}) {
    const argv = ['-m', 'pip', 'install', '--disable-pip-version-check', ...(progress ? ['--progress-bar', 'raw'] : ['-q']), ...args];
    return new Promise((resolve, reject) => {
        const child = spawnFn(vpy, argv, { cwd, windowsHide: true, stdio: ['ignore', progress ? 'pipe' : 'inherit', 'inherit'] });
        child.on('error', reject);
        if (progress && child.stdout) {
            let file = '';
            readline.createInterface({ input: child.stdout }).on('line', (line) => {
                const p = pipLine(line);
                if (!p) return;
                if (p.file) { file = p.file; progress(`${what}: downloading ${file}`, null); }
                else if (p.cached) progress(`${what}: ${p.cached}, already downloaded once on this computer`, null);
                else if (p.installing) progress(`${what}: installing`, null);
                else if (p.total > 0) progress(`${what}: downloading ${file}`, Math.min(99, (p.bytes / p.total) * 100), { bytes: p.bytes, total: p.total });
            });
        }
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pip exited with ${code}`))));
    });
}

/** The bytes of the files under `dir`, recursively; 0 when it is not there. Links are not followed (Hugging Face's
 * snapshots link to its blobs, which are counted once). Async: a big cache never blocks the event loop the seat gate
 * runs on. @param {string} dir @returns {Promise<number>} */
async function dirBytes(dir) {
    let total = 0;
    let names = [];
    try { names = await fs.promises.readdir(dir); } catch { return 0; }
    for (const name of names) {
        const p = path.join(dir, name);
        let st = null;
        try { st = await fs.promises.lstat(p); } catch { continue; }
        if (st.isDirectory()) total += await dirBytes(p);
        else if (st.isFile()) total += st.size;
    }
    return total;
}

/**
 * Weights a service downloads at its first start: `dir`'s growth since now, every `everyMs`, reported against `total`
 * and capped below it (the last files land late: Hugging Face's Xet writes in large pieces). stop() ends it.
 * @param {string} dir @param {number|null} total null: the bytes alone @param {(bytes: number, total: number|null) => void} report
 * @param {number} [everyMs]
 * @returns {Promise<{stop(): void}>}
 */
async function watchDownload(dir, total, report, everyMs = 2000) {
    const base = await dirBytes(dir);
    let stopped = false;
    let reading = false;
    const tick = async () => {
        if (stopped || reading) return;
        reading = true;
        try {
            const grown = Math.max(0, (await dirBytes(dir)) - base);
            if (!stopped) report(total ? Math.min(grown, Math.floor(total * 0.99)) : grown, total || null);
        } finally { reading = false; }
    };
    const timer = setInterval(tick, everyMs);
    if (timer.unref) timer.unref();
    report(0, total || null);
    return { stop() { stopped = true; clearInterval(timer); } };
}

module.exports = { pipLine, pipInstall, dirBytes, watchDownload };
