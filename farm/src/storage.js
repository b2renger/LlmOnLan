// Where the farm keeps its model files, and moving them (owner, 2026-10-12: "I need to be able to move or place the
// model at a specific place on disk"; ONE folder for the whole farm).
//
// `storage.dir` (config.js StorageSchema) is the panel's "Keep everything here": what the farm downloads goes into it,
// one subfolder per store (SUB):
//   gguf/            llama.cpp's .gguf files, document search's model, drafts (instead of farm/.models)
//   speech-to-text/  faster-whisper's models (instead of farm/.stt/models)
//   ollama/          OLLAMA_MODELS for an Ollama the farm starts (instead of Ollama's own ~/.ollama/models)
//   vllm/            on Linux: vLLM's root for a new install, and hf/ for the weights of an existing one
// null = the farm's own folders, so nothing changes for a farm that never sets it.
//
// The move (the panel's Move here) never deletes before a verified copy: every file is copied to `<name>.lolmove-part`,
// flushed to the disk, then renamed; the copies are checked (sizes, and the checksum of a file whose sha256 is known:
// Ollama's blobs are named by theirs, document search's model is pinned); only once the farm runs from the new folder are
// the old files deleted, each one only while its copy is there with the same size and is not the same file. A move cut
// short (a crash, a power cut, Stop) is finished by pressing Move here again: a half-copied file is copied again, never
// trusted. up.js runs it (the stops and restarts around the switch); this file is the part that touches files.
//
// It also answers: which kind of disk a folder is on (a hard disk or a USB drive loads models several times slower),
// whether a folder may be used at all, and what models a folder already holds ("Use the models in this folder").

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const FARM_DIR = path.join(__dirname, '..');
const DEFAULT = { gguf: path.join(FARM_DIR, '.models'), stt: path.join(FARM_DIR, '.stt', 'models') };
const SUB = { gguf: 'gguf', stt: 'speech-to-text', ollama: 'ollama', vllm: 'vllm' };
// What a person reads for each store (the panel, the move's messages).
const LABEL = {
    gguf: 'Model files for llama.cpp, document search and drafts',
    stt: 'Speech to text\'s models',
    ollama: 'Ollama\'s models',
    vllm: 'vLLM\'s models',
};
const PART = '.lolmove-part';             // a copy in progress: never trusted, copied again
const CHUNK = 8 * 1024 * 1024;
const KEEP_FREE = 10e9;                   // bytes left free on the new drive beside the copies (as vLLM's downloads keep)
const CANARY = 'lol-where-check';         // the model name of the check "which folder does this Ollama read"

// ---- where things are -----------------------------------------------------------------------------------------------

let cur = { dir: null, ollama: null };
// config.loadConfig calls it, so every command uses the same folders; up.js again after a move.
function useStorage(config) {
    const s = (config && config.storage) || {};
    cur = { dir: s.dir || null, ollama: s.ollama || null };
    return cur;
}
function dirsFor(s = cur) {
    return {
        gguf: s.dir ? path.join(s.dir, SUB.gguf) : DEFAULT.gguf,
        stt: s.dir ? path.join(s.dir, SUB.stt) : DEFAULT.stt,
    };
}
const ggufDir = () => dirsFor().gguf;
const sttDir = () => dirsFor().stt;
// OLLAMA_MODELS for an Ollama the farm starts; null = Ollama's own place (its OLLAMA_MODELS, else ~/.ollama/models).
function ollamaModelsFor(s = cur) { return s.ollama || (s.dir ? path.join(s.dir, SUB.ollama) : null); }
function ollamaEnv(s = cur) { const d = ollamaModelsFor(s); return d ? { OLLAMA_MODELS: d } : {}; }
function ollamaDefaultStore(env = process.env, home = os.homedir()) { return env.OLLAMA_MODELS || path.join(home, '.ollama', 'models'); }
// Linux: where vLLM's weights go (<dir>/vllm/hf), and its root for a new install (<dir>/vllm). null without a folder,
// or with one vLLM's scripts cannot take (vllm.js ROOT_RX: letters, digits, . _ - in every name).
const VLLM_ROOT_RX = /^(\/[\w.-]+)+$/;
function vllmRootFor(s = cur) {
    const r = s.dir ? path.posix.join(s.dir, SUB.vllm) : null;
    return r && VLLM_ROOT_RX.test(r) ? r : null;
}

// ---- paths ------------------------------------------------------------------------------------------------------------

const P = (win) => (win ? path.win32 : path.posix);
function norm(p, win = process.platform === 'win32') { const r = P(win).resolve(String(p)); return win ? r.toLowerCase() : r; }
// Is `child` the folder `parent` or inside it (Windows: letters in either case are the same name)?
function inside(child, parent, win = process.platform === 'win32') {
    const rel = P(win).relative(norm(parent, win), norm(child, win));
    return rel === '' || (!rel.startsWith('..') && !P(win).isAbsolute(rel));
}
// The real path, through links and junctions, of the deepest part of `p` that exists, the rest appended.
function realOf(p) {
    let at = path.resolve(p); const rest = [];
    for (;;) {
        try { return path.join(fs.realpathSync.native(at), ...rest); } catch { /* not there yet: one level up */ }
        const up = path.dirname(at);
        if (up === at) return path.resolve(p);
        rest.unshift(path.basename(at)); at = up;
    }
}
// The same file under two names (a link, a junction, the same folder typed twice): deleting one deletes the other.
function sameFile(a, b) {
    try {
        const x = fs.statSync(a, { bigint: true }); const y = fs.statSync(b, { bigint: true });
        return x.dev === y.dev && x.ino === y.ino && x.ino !== 0n;
    } catch { return false; }
}

// May `dir` be the farm's folder? `stores` = [{id, from, to}] of what would move there; `farmDir` = the farm's own files
// (an update of the Farm app replaces them). → {ok, error} in plain words.
function checkDir(dir, { stores = [], farmDir = FARM_DIR, platform = process.platform } = {}) {
    const d = String(dir == null ? '' : dir).trim();
    const win = platform === 'win32';
    if (!d) return { ok: false, error: 'Type a folder, or press Browse.' };
    if (/[\0\r\n]/.test(d)) return { ok: false, error: 'That is not a folder.' };
    if (win && /^\\\\/.test(d)) return { ok: false, error: 'That folder is on another computer of the network: models load from it far too slowly. Choose a folder on a drive of this computer.' };
    if (win ? !/^[A-Za-z]:[\\/]/.test(d) : !d.startsWith('/')) return { ok: false, error: win ? 'Give the whole folder, starting with its drive, like F:\\LlmOnLan models.' : 'Give the whole folder, starting with /, like /data/llmonlan.' };
    const real = realOf(d);
    if (inside(real, realOf(farmDir), win) || inside(d, farmDir, win)) return { ok: false, error: 'That folder is inside the farm\'s own files, which an update replaces. Choose another one.' };
    for (const s of stores) {
        if (!s.from || norm(s.from, win) === norm(s.to, win)) continue;
        const from = realOf(s.from); const to = realOf(s.to);
        if (inside(to, from, win) || inside(from, to, win)) {
            return { ok: false, error: `${LABEL[s.id] || 'Some models'} are in ${s.from}: the new folder cannot be inside that folder, nor hold it. Choose another one.` };
        }
    }
    return { ok: true, error: null };
}

// Free bytes on the drive of `dir` (its deepest existing folder), or null.
function freeBytes(dir) {
    let at = path.resolve(dir);
    for (;;) {
        try { const s = fs.statfsSync(at); return s.bavail * s.bsize; } catch { /* not there yet */ }
        const up = path.dirname(at);
        if (up === at) return null;
        at = up;
    }
}

// ---- which kind of disk ---------------------------------------------------------------------------------------------

// `Get-PhysicalDisk`'s MediaType|BusType of the drive (pure, for the tests): 'usb', 'hdd', 'ssd', or null.
function parseWinDisk(out) {
    const [media, bus] = String(out || '').trim().split('|').map((x) => x.trim().toLowerCase());
    if (bus === 'usb') return 'usb';
    if (media === 'hdd') return 'hdd';
    if (media === 'ssd') return 'ssd';
    return null;
}
// Linux, from the block device's /sys path and its queue/rotational (pure, for the tests).
function linuxDiskKind({ sysPath = '', rotational = null } = {}) {
    if (/\/usb\d*\//.test(sysPath)) return 'usb';
    const r = String(rotational == null ? '' : rotational).trim();
    return r === '1' ? 'hdd' : r === '0' ? 'ssd' : null;
}
// The device ("maj:min") a path lives on, from /proc/self/mountinfo: the longest mount point that holds it (pure).
function mountDevice(mountinfo, p) {
    let best = null;
    for (const line of String(mountinfo || '').split('\n')) {
        const f = line.split(' ');
        if (f.length < 5) continue;
        const mnt = f[4].replace(/\\040/g, ' ');
        if ((p === mnt || p.startsWith(mnt.endsWith('/') ? mnt : mnt + '/')) && (!best || mnt.length > best.mnt.length)) best = { mnt, dev: f[2] };
    }
    return best ? best.dev : null;
}
const kindCache = new Map();
// → 'hdd' | 'usb' | 'ssd' | null (could not tell). Cached per drive (Windows) or device (Linux).
async function diskKind(dir, { platform = process.platform, run = execText } = {}) {
    if (platform === 'win32') {
        const m = /^([A-Za-z]):/.exec(String(dir || ''));
        if (!m) return null;
        const letter = m[1].toUpperCase();
        if (kindCache.has(letter)) return kindCache.get(letter);
        const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            `$p = Get-Partition -DriveLetter ${letter} -ErrorAction Stop; $d = Get-PhysicalDisk | Where-Object DeviceId -eq $p.DiskNumber | Select-Object -First 1; '' + $d.MediaType + '|' + $d.BusType`], 30000);
        const kind = r.ok ? parseWinDisk(r.out) : null;
        if (r.ok) kindCache.set(letter, kind);
        return kind;
    }
    if (platform !== 'linux') return null;
    try {
        const dev = mountDevice(fs.readFileSync('/proc/self/mountinfo', 'utf8'), realOf(dir));
        if (!dev) return null;
        if (kindCache.has(dev)) return kindCache.get(dev);
        const sysPath = fs.realpathSync(`/sys/dev/block/${dev}`);
        const q = fs.existsSync(path.join(sysPath, 'partition')) ? path.join(path.dirname(sysPath), 'queue', 'rotational') : path.join(sysPath, 'queue', 'rotational');
        let rotational = null;
        try { rotational = fs.readFileSync(q, 'utf8'); } catch { /* a device-mapper or md device: not said */ }
        const kind = linuxDiskKind({ sysPath, rotational });
        kindCache.set(dev, kind);
        return kind;
    } catch { return null; }
}
// What the panel says about a slow drive (null for a fast or unknown one).
function slowDiskText(kind) {
    if (kind === 'hdd') return 'This folder is on a hard disk: models load from it several times slower than from an SSD (minutes instead of seconds for a big one), each time an engine starts or a model is switched.';
    if (kind === 'usb') return 'This folder is on a USB drive: models load from it several times slower, and unplugging it takes them away from the farm.';
    return null;
}
function execText(cmd, args, timeoutMs) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }));
    });
}

// ---- the files of a store -------------------------------------------------------------------------------------------

// Every file under `root`: [{rel, size}], or [{rel, link}] for a symbolic link (recreated as it is, Hugging Face's
// caches use relative ones). An unfinished download (.part) or copy (.lolmove-part) is left out. Never follows a link.
async function listFiles(root) {
    const out = [];
    const walk = async (rel) => {
        let entries;
        try { entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); }
        catch (e) { if (e.code === 'ENOENT' && !rel) return; throw e; }
        for (const e of entries) {
            const r = rel ? path.join(rel, e.name) : e.name;
            if (e.isSymbolicLink()) { out.push({ rel: r, link: await fsp.readlink(path.join(root, r)) }); continue; }
            if (e.isDirectory()) { await walk(r); continue; }
            if (!e.isFile() || /\.part$/i.test(e.name) || e.name.endsWith(PART)) continue;
            out.push({ rel: r, size: (await fsp.stat(path.join(root, r))).size });
        }
    };
    await walk('');
    return out;
}
// A link that points outside its store (or anywhere, when absolute) cannot be recreated as it is.
function linkEscapes(rel, link) {
    if (path.isAbsolute(link) || path.win32.isAbsolute(link)) return true;
    const to = path.normalize(path.join(path.dirname(rel), link));
    return to === '..' || to.startsWith(`..${path.sep}`) || path.isAbsolute(to);
}
// The sha256 a file of a store must have, when the farm knows it: Ollama's blobs are named by theirs, document search's
// model is pinned (embed.js). `pinned` = {basename: sha256} for the gguf store.
function digestOf(storeId, rel, pinned = {}) {
    const base = path.basename(rel);
    if (storeId === 'ollama') {
        const m = /^sha256-([0-9a-f]{64})$/.exec(base);
        return m && path.basename(path.dirname(rel)) === 'blobs' ? m[1] : null;
    }
    if (storeId === 'gguf') return pinned[base] || null;
    return null;
}

const cancelled = () => Object.assign(new Error('Stopped.'), { code: 'STOPPED' });

// Copy one file through `<dst>.lolmove-part`: flushed to the disk, its size checked, its checksum when one is expected,
// then renamed into place. → the sha256 it read (hex), when asked.
async function copyFile(src, dst, { onBytes = () => {}, isCancelled = () => false, digest = null, size = null } = {}) {
    const tmp = dst + PART;
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    const h = digest ? crypto.createHash('sha256') : null;
    const r = await fsp.open(src, 'r');
    let w = null;
    try {
        w = await fsp.open(tmp, 'w');
        const buf = Buffer.allocUnsafe(CHUNK);
        let pos = 0;
        for (;;) {
            if (isCancelled()) throw cancelled();
            const { bytesRead } = await r.read(buf, 0, CHUNK, pos);
            if (!bytesRead) break;
            if (h) h.update(buf.subarray(0, bytesRead));
            let off = 0;
            while (off < bytesRead) {
                const { bytesWritten } = await w.write(buf, off, bytesRead - off, pos + off);
                off += bytesWritten;
            }
            pos += bytesRead;
            onBytes(bytesRead);
        }
        await w.sync();
        await w.close(); w = null;
        if (size != null && pos !== size) throw new Error(`${src} changed while it was copied (${pos} bytes read, ${size} expected).`);
        if (h) {
            const got = h.digest('hex');
            if (got !== digest) throw Object.assign(new Error(`${src} does not match its checksum: the file may be damaged. Nothing was moved.`), { code: 'DIGEST' });
        }
        await fsp.rename(tmp, dst);
        await syncDir(path.dirname(dst));
        return h ? digest : null;
    } catch (e) {
        if (w) await w.close().catch(() => {});
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw e;
    } finally {
        await r.close().catch(() => {});
    }
}
// The rename itself on the disk too (Linux; Windows cannot open a folder for this and does it with the file).
async function syncDir(dir) {
    if (process.platform === 'win32') return;
    try { const d = await fsp.open(dir, 'r'); try { await d.sync(); } finally { await d.close(); } } catch { /* best effort */ }
}
async function sha256File(file, { isCancelled = () => false, onBytes = () => {} } = {}) {
    const h = crypto.createHash('sha256');
    const fh = await fsp.open(file, 'r');
    try {
        const buf = Buffer.allocUnsafe(CHUNK);
        let pos = 0;
        for (;;) {
            if (isCancelled()) throw cancelled();
            const { bytesRead } = await fh.read(buf, 0, CHUNK, pos);
            if (!bytesRead) break;
            h.update(buf.subarray(0, bytesRead));
            pos += bytesRead;
            onBytes(bytesRead);
        }
    } finally { await fh.close(); }
    return h.digest('hex');
}
async function statOrNull(p) { try { return await fsp.lstat(p); } catch { return null; } }

// Bytes still to copy from `from` to `to` (what is not there yet with its size).
async function bytesToCopy(from, to, files) {
    let n = 0;
    for (const f of files) {
        if (f.link != null) continue;
        const d = await statOrNull(path.join(to, f.rel));
        if (!(d && d.isFile() && d.size === f.size)) n += f.size;
    }
    return n;
}

// Copy a store: what is already in `to` with its size is kept (checked in verifyStore); a file there with another size is
// replaced only when this move wrote it (modified since `since`, the move's start: the original changed meanwhile, an
// Ollama manifest re-written by a pull); a file of someone else's under the same name stops the move, never overwritten.
// → {copied: n, hashed: Set(rel) of files whose checksum was checked while copying}.
async function copyStore(from, to, files, { onBytes = () => {}, isCancelled = () => false, digestFor = () => null, since = 0 } = {}) {
    const hashed = new Set();
    let copied = 0;
    for (const f of files) {
        if (isCancelled()) throw cancelled();
        const src = path.join(from, f.rel); const dst = path.join(to, f.rel);
        const d = await statOrNull(dst);
        if (f.link != null) {
            if (linkEscapes(f.rel, f.link)) throw new Error(`${src} is a link to something outside ${from}: the farm cannot move it. Nothing was moved.`);
            if (d && d.isSymbolicLink() && (await fsp.readlink(dst)) === f.link) continue;
            if (d) throw new Error(`${dst} is already there and is not the same: move it away or delete it, then press Move here again.`);
            await fsp.mkdir(path.dirname(dst), { recursive: true });
            await fsp.symlink(f.link, dst);
            continue;
        }
        if (d && d.isFile() && d.size === f.size) continue;
        if (d && !(d.isFile() && d.mtimeMs >= since)) {
            throw new Error(`${dst} is already there and differs from ${src}: move it away or delete it, then press Move here again.`);
        }
        const digest = digestFor(f.rel);
        await copyFile(src, dst, { onBytes, isCancelled, digest, size: f.size });
        if (digest) hashed.add(f.rel);
        copied++;
    }
    return { copied, hashed };
}

// Every file of `from` (as listed) is in `to` with its size; a file with a known checksum whose copy was not checked while
// copying (an earlier run of the move did it) is read again and checked. → {ok, problems: [plain words]}.
async function verifyStore(from, to, files, { digestFor = () => null, hashed = new Set(), isCancelled = () => false, onBytes = () => {} } = {}) {
    const problems = [];
    for (const f of files) {
        const dst = path.join(to, f.rel);
        const d = await statOrNull(dst);
        if (f.link != null) {
            if (!(d && d.isSymbolicLink() && (await fsp.readlink(dst)) === f.link)) problems.push(`${dst} is missing.`);
            continue;
        }
        if (!(d && d.isFile())) { problems.push(`${dst} is missing.`); continue; }
        if (d.size !== f.size) { problems.push(`${dst} is ${d.size} bytes, not ${f.size}.`); continue; }
        if (sameFile(path.join(from, f.rel), dst)) { problems.push(`${dst} is the same file as ${path.join(from, f.rel)}: the two folders are one.`); continue; }
        const digest = digestFor(f.rel);
        if (digest && !hashed.has(f.rel)) {
            const got = await sha256File(dst, { isCancelled, onBytes });
            if (got !== digest) problems.push(`${dst} does not match its checksum.`);
            else hashed.add(f.rel);
        }
    }
    return { ok: !problems.length, problems };
}

// Delete the old copy: each file only while its copy is in `to` with the same size (and the same link) and is not the
// same file; the rest is kept and counted. Then the folders emptied, `from` itself too. → {deleted, kept, keptBytes}.
async function deleteMoved(from, to) {
    let deleted = 0; let kept = 0; let keptBytes = 0;
    const files = await listFiles(from);
    for (const f of files) {
        const src = path.join(from, f.rel); const dst = path.join(to, f.rel);
        const d = await statOrNull(dst);
        const good = f.link != null
            ? !!(d && d.isSymbolicLink() && (await fsp.readlink(dst)) === f.link)
            : !!(d && d.isFile() && d.size === f.size && !sameFile(src, dst));
        if (!good) { kept++; keptBytes += f.size || 0; continue; }
        try { await fsp.unlink(src); deleted++; } catch { kept++; keptBytes += f.size || 0; }   // still open (Windows): kept
    }
    await pruneEmpty(from);
    return { deleted, kept, keptBytes };
}
// Remove the empty folders under `root`, then `root` if empty. Never a folder with a file left in it.
async function pruneEmpty(root) {
    const walk = async (dir) => {
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return false; }
        let empty = true;
        for (const e of entries) {
            if (e.isDirectory() && !e.isSymbolicLink()) { if (!(await walk(path.join(dir, e.name)))) empty = false; }
            else empty = false;
        }
        if (empty) { try { await fsp.rmdir(dir); } catch { return false; } }
        return empty;
    };
    return walk(root);
}

// ---- the move's journal: what a cut-short move had done, so Move here finishes it ------------------------------------

const journalPath = (configPath) => path.join(path.dirname(configPath), '.lol-storage-move.json');
function readJournal(configPath) { try { return JSON.parse(fs.readFileSync(journalPath(configPath), 'utf8')); } catch { return null; } }
function writeJournal(configPath, j) {
    const p = journalPath(configPath); const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, p);
}
function clearJournal(configPath) { try { fs.unlinkSync(journalPath(configPath)); } catch { /* none */ } }

// ---- Ollama's model folder ------------------------------------------------------------------------------------------

// Where a model's manifest is in an Ollama model folder: the older layout (manifests/registry.ollama.ai/…) and the one of
// Ollama 0.40 (manifests-v2/ollama.com/…, both are read). "gemma4:12b" → library/gemma4/12b; "hf.co/u/r:Q4" → hf.co/u/r/Q4.
function manifestRels(name) {
    let n = String(name || '').trim();
    let tag = 'latest';
    const c = n.lastIndexOf(':');
    if (c > n.lastIndexOf('/')) { tag = n.slice(c + 1); n = n.slice(0, c); }
    const parts = n.split('/').filter(Boolean);
    if (!parts.length || parts.some((x) => x === '.' || x === '..') || /[\\/]|^\.\.?$/.test(tag)) return [];
    let host = 'registry.ollama.ai'; let rest = parts;
    if (parts.length >= 3 || (parts.length === 2 && /\./.test(parts[0]))) { host = parts[0]; rest = parts.slice(1); }
    if (rest.length === 1) rest = ['library', rest[0]];
    const v2host = host === 'registry.ollama.ai' ? 'ollama.com' : host;
    return [path.join('manifests', host, ...rest, tag), path.join('manifests-v2', v2host, ...rest, tag)];
}
function storeHasModel(store, name) { return manifestRels(name).some((r) => fs.existsSync(path.join(store, r))); }
const isOllamaStore = (dir) => fs.existsSync(path.join(dir, 'blobs')) && (fs.existsSync(path.join(dir, 'manifests')) || fs.existsSync(path.join(dir, 'manifests-v2')));

// The folder the Ollama app's server says it uses, from its own log (its "server config" line at each start): Windows
// %LOCALAPPDATA%\Ollama\server.log, macOS ~/.ollama/logs/server.log. null when there is none.
function ollamaLogFile({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
    if (platform === 'win32') return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Ollama', 'server.log') : null;
    if (platform === 'darwin') return path.join(home, '.ollama', 'logs', 'server.log');
    return null;
}
// The last OLLAMA_MODELS of a server log (pure). The value runs to the next " KEY:" of the env map.
function ollamaStoreInLog(text) {
    let last = null;
    const rx = /OLLAMA_MODELS:(.*?)(?= [A-Z][A-Z0-9_]*:|\]|"|$)/gm;
    let m;
    while ((m = rx.exec(String(text || '')))) last = m[1];
    return last ? last.replace(/\\\\/g, '\\').trim() || null : null;
}
async function ollamaStoreFromLog(opts) {
    const f = ollamaLogFile(opts);
    if (!f) return null;
    try { return ollamaStoreInLog(await fsp.readFile(f, 'utf8')); } catch { return null; }
}

// Does the Ollama answering at `host` read its models from `store`? A copy of one of the store's manifests goes in under a
// name nobody uses (lol-where-check:<random>) for a moment: Ollama lists it when it reads that folder (it reads its
// manifests at each /api/tags, measured on 0.40.3). → true, false, or null (no manifest to copy, or Ollama did not
// answer). `listModels(host)` = the names of /api/tags, or null when Ollama does not answer (up.js tagsOf).
async function ollamaReads(host, store, listModels) {
    const base = path.join(store, 'manifests', 'registry.ollama.ai', 'library', CANARY);
    await fsp.rm(base, { recursive: true, force: true }).catch(() => {});   // one left by a farm stopped mid-check
    const one = await firstManifest(store);
    if (!one) return null;
    const tag = crypto.randomBytes(5).toString('hex');
    await fsp.mkdir(base, { recursive: true });
    try {
        await fsp.copyFile(one, path.join(base, tag));
        const names = await listModels(host);   // null when Ollama did not answer
        return Array.isArray(names) ? names.includes(`${CANARY}:${tag}`) : null;
    } finally {
        await fsp.rm(base, { recursive: true, force: true }).catch(() => {});
    }
}
async function firstManifest(store) {
    for (const top of ['manifests', 'manifests-v2']) {
        const stack = [path.join(store, top)];
        while (stack.length) {
            const d = stack.pop();
            let entries;
            try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
            for (const e of entries) {
                if (e.name === CANARY) continue;
                const p = path.join(d, e.name);
                if (e.isDirectory()) stack.push(p);
                else if (e.isFile()) return p;
            }
        }
    }
    return null;
}
// The model names an Ollama model folder holds, from its manifests (both layouts).
async function modelsInStore(store) {
    const names = new Set();
    const walk = async (dir, parts) => {
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.isDirectory()) await walk(path.join(dir, e.name), [...parts, e.name]);
            else if (e.isFile() && parts.length >= 3) {
                const [host, ...rest] = parts;
                const lib = rest[0] === 'library' && rest.length === 2;
                const nm = (/^(registry\.ollama\.ai|ollama\.com)$/.test(host) ? (lib ? rest[1] : rest.join('/')) : [host, ...rest].join('/'));
                if (!nm.split('/').includes(CANARY)) names.add(`${nm}:${e.name}`);
            }
        }
    };
    await walk(path.join(store, 'manifests'), []);
    await walk(path.join(store, 'manifests-v2'), []);
    return [...names].sort();
}

// ---- "Use the models in this folder": what a folder already holds -----------------------------------------------------

const SHARD_RX = /-(\d{5})-of-(\d{5})\.gguf$/i;
// .gguf files that are not models to chat with: a vision projector (offered with the model next to it), a draft
// (speculative decoding), document search's own model.
const NOT_A_MODEL = /^(mmproj|mtp-|embeddinggemma)/i;

// Walk `dir` (no further than `maxDepth`, `maxEntries` names): → {gguf: [{path, label, parts, complete, bytes, mmproj}],
// hf: [{path, label, bytes, vision}], ollama: [{path, models, bytes}], truncated}. A folder that is an Hugging Face model or
// an Ollama model folder is not looked into further. Never follows a link to a folder.
async function scanFolder(dir, { maxDepth = 6, maxEntries = 50000 } = {}) {
    const out = { gguf: [], hf: [], ollama: [], truncated: false };
    let seen = 0;
    const sizeOf = async (p) => { try { return (await fsp.stat(p)).size; } catch { return 0; } };
    const dirBytes = async (d) => (await listFiles(d).catch(() => [])).reduce((a, f) => a + (f.size || 0), 0);
    const visit = async (d, depth) => {
        let entries;
        try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
        seen += entries.length;
        if (seen > maxEntries) { out.truncated = true; return; }
        const names = new Set(entries.map((e) => e.name));
        // An Ollama model folder.
        if (names.has('blobs') && (names.has('manifests') || names.has('manifests-v2'))) {
            out.ollama.push({ path: d, models: await modelsInStore(d), bytes: await dirBytes(path.join(d, 'blobs')) });
            return;
        }
        // A Hugging Face model folder: its config.json and weights in safetensors (a file, or a link to one in its cache).
        const isFile = async (e) => e.isFile() || (e.isSymbolicLink() && (await fsp.stat(path.join(d, e.name)).then((s) => s.isFile(), () => false)));
        if (names.has('config.json') && entries.some((e) => /\.safetensors$/i.test(e.name))) {
            let bytes = 0;
            for (const e of entries) if (await isFile(e)) bytes += await sizeOf(path.join(d, e.name));
            let vision = false;
            try { vision = /"vision_config"/.test(await fsp.readFile(path.join(d, 'config.json'), 'utf8')); } catch { /* unreadable: said as text only */ }
            out.hf.push({ path: d, label: path.basename(d), bytes, vision });
            return;
        }
        const ggufs = [];
        for (const e of entries) if (/\.gguf$/i.test(e.name) && (await isFile(e))) ggufs.push(e.name);
        const mmproj = ggufs.filter((n) => /^mmproj/i.test(n));
        const groups = new Map();
        for (const n of ggufs) {
            if (NOT_A_MODEL.test(n)) continue;
            const m = SHARD_RX.exec(n);
            const key = m ? n.replace(SHARD_RX, '') : n;
            if (!groups.has(key)) groups.set(key, { names: [], of: m ? Number(m[2]) : 1 });
            groups.get(key).names.push(n);
        }
        for (const [key, g] of groups) {
            g.names.sort();
            let bytes = 0;
            for (const n of g.names) bytes += await sizeOf(path.join(d, n));
            const first = g.of > 1 ? key + `-00001-of-${String(g.of).padStart(5, '0')}.gguf` : g.names[0];
            out.gguf.push({
                path: path.join(d, first), label: key.replace(/\.gguf$/i, ''), parts: g.of, found: g.names.length,
                complete: g.names.length === g.of && g.names.includes(first), bytes,
                mmproj: mmproj.length === 1 ? path.join(d, mmproj[0]) : null,
            });
        }
        if (depth >= maxDepth) return;
        for (const e of entries) {
            if (e.isDirectory() && !e.isSymbolicLink() && !/^(\$RECYCLE\.BIN|System Volume Information|node_modules|\.git)$/i.test(e.name)) await visit(path.join(d, e.name), depth + 1);
        }
    };
    await visit(path.resolve(dir), 0);
    return out;
}

// A Windows folder as vLLM inside WSL sees it: F:\models\x → /mnt/f/models/x (pure). null for anything else.
function wslPathOf(winPath) {
    const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(String(winPath || ''));
    if (!m) return null;
    const rest = m[2].split(/[\\/]+/).filter(Boolean);
    return `/mnt/${m[1].toLowerCase()}${rest.length ? '/' + rest.join('/') : ''}`;
}

module.exports = {
    FARM_DIR, DEFAULT, SUB, LABEL, PART, KEEP_FREE, CANARY,
    useStorage, dirsFor, ggufDir, sttDir, ollamaModelsFor, ollamaEnv, ollamaDefaultStore, vllmRootFor,
    norm, inside, realOf, sameFile, checkDir, freeBytes,
    parseWinDisk, linuxDiskKind, mountDevice, diskKind, slowDiskText,
    listFiles, linkEscapes, digestOf, copyFile, sha256File, bytesToCopy, copyStore, verifyStore, deleteMoved, pruneEmpty,
    journalPath, readJournal, writeJournal, clearJournal,
    manifestRels, storeHasModel, isOllamaStore, ollamaLogFile, ollamaStoreInLog, ollamaStoreFromLog, ollamaReads, modelsInStore,
    scanFolder, wslPathOf,
};
