// Where the farm keeps its model files, and moving them (owner, 2026-10-12: "I need to be able to move or place the
// model at a specific place on disk"; ONE folder for the whole farm).
//
// `storage.dir` (config.js StorageSchema) is the panel's "Keep everything here": what the farm downloads goes into it,
// one subfolder per store (SUB):
//   gguf/            llama.cpp's .gguf files, document search's model, drafts (instead of farm/.models)
//   speech-to-text/  faster-whisper's models (instead of farm/.stt/models)
//   classify/        Classify's Laya weights (a Hugging Face cache; instead of the machine's shared ~/.cache/huggingface)
//   kokoro/          the voice's model (v1_0/kokoro-v1_0.pth and its config.json; instead of farm/.kokoro/src/api/src/models)
//   ollama/          OLLAMA_MODELS for an Ollama the farm starts (instead of Ollama's own ~/.ollama/models)
//   vllm/            on Linux: vLLM's root for a new install, and hf/ for the weights of an existing one
//   wsl/             on Windows: what the vLLM card offers for WSL's Linux disk (vLLM and its weights live in it)
// null = the farm's own folders, so nothing changes for a farm that never sets it. The folder is the source of truth
// (owner, 2026-10-12): what is in it is what the farm has. `<dir>/.lol-storage` (MARKER) is written at the switch: a
// farm that finds storage.dir set and no marker says the folder is missing (a USB drive unplugged, a letter changed)
// and downloads nothing into it, instead of filling whatever disk now answers to that name.
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
const DEFAULT = {
    gguf: path.join(FARM_DIR, '.models'), stt: path.join(FARM_DIR, '.stt', 'models'),
    kokoro: path.join(FARM_DIR, '.kokoro', 'src', 'api', 'src', 'models'),   // Kokoro-FastAPI's MODEL_DIR in its own source
};
// Classify's weights: Laya's one Hugging Face repo (laya 0.3.20 loads convaiinnovations/laya by snapshot_download; its
// encoder and tokenizer are inside it). In the machine's shared cache only THAT repo's folder is the farm's.
const LAYA_REPO = 'models--convaiinnovations--laya';
// Ollama's model folder: only these are Ollama's (Ollama 0.34 writes blobs/ and manifests/; manifests-v2/ is read
// when there). Anything else a person keeps in that folder (another app's checkpoints) is never copied nor deleted.
const OLLAMA_PARTS = ['blobs', 'manifests', 'manifests-v2'];
const MARKER = '.lol-storage';
const SUB = { gguf: 'gguf', stt: 'speech-to-text', classify: 'classify', kokoro: 'kokoro', ollama: 'ollama', vllm: 'vllm', wsl: 'wsl' };
// What a person reads for each store (the panel, the move's messages).
const LABEL = {
    gguf: 'Model files for llama.cpp, document search and drafts',
    stt: 'Speech to text\'s models',
    classify: 'Classify\'s model',
    kokoro: 'The voice\'s model',
    ollama: 'Ollama\'s models',
    vllm: 'vLLM\'s models',
};
const PART = '.lolmove-part';             // a copy in progress: never trusted, copied again
const CHUNK = 8 * 1024 * 1024;
const KEEP_FREE = 10e9;                   // bytes left free on the new drive beside the copies (as vLLM's downloads keep)
const CANARY = 'lol-where-check';         // the model name of the check "which folder does this Ollama read"

// ---- where things are -----------------------------------------------------------------------------------------------

let cur = { dir: null, ollama: null, missing: null };
// config.loadConfig calls it, so every command uses the same folders; up.js again after a move. A folder set but
// without its marker is said missing (read once here; the panel's measure reads it again in the background).
function useStorage(config) {
    const s = (config && config.storage) || {};
    cur = { dir: s.dir || null, ollama: s.ollama || null, missing: null };
    if (cur.dir && !hasMarker(cur.dir)) cur.missing = missingSentence(cur.dir);
    return cur;
}
function dirsFor(s = cur) {
    return {
        gguf: s.dir ? path.join(s.dir, SUB.gguf) : DEFAULT.gguf,
        stt: s.dir ? path.join(s.dir, SUB.stt) : DEFAULT.stt,
        classify: s.dir ? path.join(s.dir, SUB.classify) : null,   // null: the machine's shared Hugging Face cache
        kokoro: s.dir ? path.join(s.dir, SUB.kokoro) : DEFAULT.kokoro,
    };
}
const ggufDir = () => dirsFor().gguf;
const sttDir = () => dirsFor().stt;
const classifyCache = () => dirsFor().classify;   // the classify service's HF_HUB_CACHE, or null
const kokoroModels = () => dirsFor().kokoro;      // the voice's MODEL_DIR
// The machine's shared Hugging Face cache (huggingface_hub's own rule).
function hfHubDir(env = process.env, home = os.homedir()) {
    if (env.HF_HUB_CACHE) return env.HF_HUB_CACHE;
    if (env.HF_HOME) return path.join(env.HF_HOME, 'hub');
    return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'huggingface', 'hub');
}
// OLLAMA_MODELS for an Ollama the farm starts; null = Ollama's own place (its OLLAMA_MODELS, else ~/.ollama/models).
function ollamaModelsFor(s = cur) { return s.ollama || (s.dir ? path.join(s.dir, SUB.ollama) : null); }
// A folder kept by `storage.ollama` (one a person lent with "Use this folder", or the one the farm's Ollama read when a
// move left Ollama's models where they were) is not the farm's: Ollama's startup prune never deletes in it.
function ollamaEnv(s = cur) {
    if (s.ollama) return { OLLAMA_MODELS: s.ollama, OLLAMA_NOPRUNE: '1' };
    return s.dir ? { OLLAMA_MODELS: path.join(s.dir, SUB.ollama) } : {};
}

// ---- the folder's marker: is the folder there? ----------------------------------------------------------------------
function hasMarker(dir) { try { return fs.statSync(path.join(dir, MARKER)).isFile(); } catch { return false; } }
async function hasMarkerAsync(dir) { try { return (await fsp.stat(path.join(dir, MARKER))).isFile(); } catch { return false; } }
function missingSentence(dir) {
    return `The model folder ${dir} is missing (is its drive plugged in?). The farm downloads nothing into it and starts nothing from it until it is back; then start the farm again.`;
}
// What to say when the folder is missing, or null. Every download into it and every start from it asks first.
function missingText(s = cur) { return s.dir && s.missing ? s.missing : null; }
// Is `p` in the farm's folder while that folder is missing? (a download there would fill whatever disk answers now)
function missingFor(p, s = cur) { return missingText(s) && inside(p, s.dir) ? s.missing : null; }
// Read again in the background (the panel's measure): a drive plugged back in is seen without a restart of the panel.
async function recheckMissing() {
    if (cur.dir) cur.missing = (await hasMarkerAsync(cur.dir)) ? null : missingSentence(cur.dir);
    return cur.missing;
}
// Written at the switch, flushed to the disk: from then on the folder is the farm's.
function writeMarker(dir) {
    fs.mkdirSync(dir, { recursive: true });   // the folder was checked and written to just before (the switch)
    writeDurable(path.join(dir, MARKER), JSON.stringify({ what: 'LlmOnLan farm model folder', since: new Date().toISOString() }) + '\n');
}
// A file written so that a power cut leaves the old one or the new one, never a half: a temp file flushed to the disk,
// renamed over, and (Linux) the folder flushed too.
function writeDurable(p, text) {
    const tmp = `${p}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, p);
    if (process.platform !== 'win32') { try { const d = fs.openSync(path.dirname(p), 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch { /* best effort */ } }
}
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
    // Windows drops a dot or a space at the end of a name: "F:\models." would be another folder than the one typed.
    if (win && d.split(/[\\/]/).slice(1).some((c) => c && c !== '.' && c !== '..' && /[. ]$/.test(c))) return { ok: false, error: 'A folder name cannot end with a dot or a space on Windows. Choose another name.' };
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

// Free bytes on the drive of `dir` (its deepest existing folder), or null. Async: a sleeping USB disk must not hold
// the event loop the seat gate runs on.
async function freeBytes(dir) {
    let at = path.resolve(dir);
    for (;;) {
        try { const s = await fsp.statfs(at); return s.bavail * s.bsize; } catch { /* not there yet */ }
        const up = path.dirname(at);
        if (up === at) return null;
        at = up;
    }
}

// A folder on another computer (a network share, a mapped network drive): models load from it far too slowly, and
// the move's checks cannot trust it. → the sentence, or null. Windows: a UNC path, or a drive whose type is 4
// (Win32_LogicalDisk.DriveType, "network"); Linux: the mount's file system (nfs, cifs/smb, sshfs).
const NET_FS = /^(nfs4?|cifs|smb3?|smbfs|fuse\.sshfs|afs|ceph|glusterfs|fuse\.glusterfs)$/;
// The file system type of the mount that holds `p`, from /proc/self/mountinfo (pure): the field after " - ".
function mountFsType(mountinfo, p) {
    let best = null;
    for (const line of String(mountinfo || '').split('\n')) {
        const f = line.split(' ');
        if (f.length < 5) continue;
        const mnt = f[4].replace(/\\040/g, ' ');
        const dash = f.indexOf('-', 6);
        if ((p === mnt || p.startsWith(mnt.endsWith('/') ? mnt : mnt + '/')) && (!best || mnt.length > best.mnt.length)) best = { mnt, fs: dash > 0 ? f[dash + 1] : null };
    }
    return best ? best.fs : null;
}
const netCache = new Map();
async function networkFolder(dir, { platform = process.platform, run = execText, mountinfo = null } = {}) {
    const d = String(dir || '');
    const say = 'That folder is on another computer of the network: models load from it far too slowly. Choose a folder on a drive of this computer.';
    if (platform === 'win32') {
        if (/^[\\/]{2}/.test(d)) return /^[\\/]{2}wsl(\.localhost|\$)[\\/]/i.test(d) ? null : say;   // WSL's own share is this computer
        const m = /^([A-Za-z]):/.exec(d);
        if (!m) return null;
        const letter = m[1].toUpperCase();
        if (!netCache.has(letter)) {
            const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${letter}:'").DriveType`], 30000);
            if (!r.ok) return null;
            netCache.set(letter, String(r.out).trim() === '4');
        }
        return netCache.get(letter) ? say : null;
    }
    if (platform !== 'linux') return null;
    let mi = mountinfo;
    if (mi == null) { try { mi = await fsp.readFile('/proc/self/mountinfo', 'utf8'); } catch { return null; } }
    return NET_FS.test(mountFsType(mi, process.platform === 'linux' ? realOf(d) : d) || '') ? say : null;
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
// caches use relative ones). An unfinished download (.part, Ollama's -partial blobs of a pull in progress) or copy
// (.lolmove-part) is left out. Never follows a link. `only`: the names at the top of `root` that are the store's (an
// Ollama folder's blobs/ and manifests/, vLLM's model folders): nothing else there is listed, so nothing else moves.
const UNFINISHED = /(\.part|-partial(-\d+)?)$/i;
async function listFiles(root, { only = null } = {}) {
    const out = [];
    const walk = async (rel) => {
        let entries;
        try { entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); }
        catch (e) { if (e.code === 'ENOENT' && !rel) return; throw e; }
        for (const e of entries) {
            if (!rel && only && !only.includes(e.name)) continue;
            const r = rel ? path.join(rel, e.name) : e.name;
            if (e.isSymbolicLink()) {
                const link = await fsp.readlink(path.join(root, r));
                const shared = linkEscapes(r, link) ? await sharedBlobOf(path.join(root, r)) : null;
                // A link into Hugging Face's shared blobs: moved as the file it points to (see sharedBlobOf).
                if (shared) out.push({ rel: r, size: shared.size, shared: shared.path });
                else out.push({ rel: r, link });
                continue;
            }
            if (e.isDirectory()) { await walk(r); continue; }
            if (!e.isFile() || UNFINISHED.test(e.name) || e.name.endsWith(PART)) continue;
            out.push({ rel: r, size: (await fsp.stat(path.join(root, r))).size });
        }
    };
    await walk('');
    return out;
}
// What else is at the top of `root` beside the store's own names (`only`): left where it is, and said so.
async function othersIn(root, only) {
    try { return (await fsp.readdir(root)).filter((n) => !only.includes(n)).sort(); } catch { return []; }
}
// A link that points outside its store (or anywhere, when absolute) cannot be recreated as it is.
function linkEscapes(rel, link) {
    if (path.isAbsolute(link) || path.win32.isAbsolute(link)) return true;
    const to = path.normalize(path.join(path.dirname(rel), link));
    return to === '..' || to.startsWith(`..${path.sep}`) || path.isAbsolute(to);
}
// huggingface_hub's shared blobs: a model's file is kept ONCE in <hub>/blobs/<2 chars>/<sha256> (that folder marked
// by a `.huggingface-shared-blobs` file) and each model's own blobs/ only links to it (the PRO 6000's Laya,
// 2026-10-13: the move stopped on that link). Such a link is moved as the file it points to — its content is copied
// into the farm's folder, checked against its name (its sha256) — and only the model's link is deleted afterwards,
// never the shared file, which another model may use. → {path, size} or null for any other link.
async function sharedBlobOf(linkPath) {
    let real;
    try { real = await fsp.realpath(linkPath); } catch { return null; }
    const marker = path.join(path.dirname(path.dirname(real)), '.huggingface-shared-blobs');
    const [st, mk] = await Promise.all([statOrNull(real), statOrNull(marker)]);
    return st && st.isFile() && mk && mk.isFile() ? { path: real, size: st.size } : null;
}
// A shared blob is named by its sha256: the checksum its copy must have.
const sharedDigest = (f) => (f.shared && /^[0-9a-f]{64}$/.test(path.basename(f.shared)) ? path.basename(f.shared) : null);
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
// then renamed into place. → the sha256 of the bytes copied (hex), kept in the journal: the switch then checks a copy
// by its size and that sum instead of reading 127 GB again while Ollama is stopped.
async function copyFile(src, dst, { onBytes = () => {}, isCancelled = () => false, digest = null, size = null } = {}) {
    const tmp = dst + PART;
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    const h = crypto.createHash('sha256');
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
            h.update(buf.subarray(0, bytesRead));
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
        const got = h.digest('hex');
        if (digest && got !== digest) throw Object.assign(new Error(`${src} does not match its checksum: the file is damaged.`), { code: 'DIGEST' });
        await fsp.rename(tmp, dst);
        await syncDir(path.dirname(dst));
        return got;
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

// Small files (an Ollama manifest, a config.json) are compared byte for byte: Ollama's manifests have a fixed length,
// so an updated one is often the same size as the old.
const SMALL = 1024 * 1024;
async function sameBytes(a, b) {
    try {
        const [x, y] = await Promise.all([fsp.readFile(a), fsp.readFile(b)]);
        return x.equals(y);
    } catch { return false; }
}
// The same link object under two names (a folder reached twice through a link): deleting one deletes the other.
function sameEntry(a, b) {
    try {
        const x = fs.lstatSync(a, { bigint: true }); const y = fs.lstatSync(b, { bigint: true });
        return x.dev === y.dev && x.ino === y.ino && x.ino !== 0n;
    } catch { return false; }
}

// Copy a store. `written` = {rel: sha256} of the files THIS move wrote into `to` (kept in its journal); `onCopied(rel,
// sha)` records one more. A file already in `to`:
//  - one this move wrote: kept when it has the original's size and the original did not change after it was copied (a
//    small file is compared byte for byte); otherwise copied again (a manifest re-written by a pull);
//  - one this move did not write (another program's, or left by a move that was forgotten): it counts as the copy only
//    when its bytes are the original's (the sum its name says, or the sha256 of both); otherwise the move stops and says
//    so, never writing over it.
// `onlyMissing` (Finish): only what is missing is copied; what is there is judged by verifyStore, never replaced.
// A file whose checksum is known and differs is damaged already: not copied, left where it is, listed.
// → {copied, hashed: Set(rel) whose copy's checksum is known good, damaged: [rel]}.
async function copyStore(from, to, files, { onBytes = () => {}, isCancelled = () => false, digestFor = () => null, written = {}, onCopied = () => {}, onlyMissing = false } = {}) {
    const hashed = new Set(); const damaged = [];
    let copied = 0;
    for (const f of files) {
        if (isCancelled()) throw cancelled();
        const src = f.shared || path.join(from, f.rel); const dst = path.join(to, f.rel);
        const d = await statOrNull(dst);
        if (f.link != null) {
            if (linkEscapes(f.rel, f.link)) throw new Error(`${src} is a link to something outside ${from}: the farm cannot move it. Nothing was moved.`);
            if (d && d.isSymbolicLink() && (await fsp.readlink(dst)) === f.link) continue;
            if (d) throw new Error(`${dst} is already there and is not the same: move it away or delete it, then press Move here again.`);
            await fsp.mkdir(path.dirname(dst), { recursive: true });
            await fsp.symlink(f.link, dst);
            continue;
        }
        const digest = digestFor(f.rel) || sharedDigest(f);
        if (d) {
            const differs = new Error(`${dst} is already there and differs from ${src}: move it away or delete it, then press Move here again.`);
            if (!d.isFile()) throw differs;
            if (onlyMissing) continue;
            if (written[f.rel] !== undefined) {
                const srcNow = await statOrNull(src);
                const fresh = d.size === f.size && srcNow && srcNow.mtimeMs <= d.mtimeMs && (f.size >= SMALL || (await sameBytes(src, dst)));
                if (fresh) { if (digest && written[f.rel] === digest) hashed.add(f.rel); continue; }
            } else {
                if (d.size !== f.size) throw differs;
                const want = digest || (await sha256File(src, { isCancelled }));
                if ((await sha256File(dst, { isCancelled })) !== want) throw differs;
                onCopied(f.rel, want);
                if (digest) hashed.add(f.rel);
                continue;
            }
        }
        let sha;
        try { sha = await copyFile(src, dst, { onBytes, isCancelled, digest, size: f.size }); }
        catch (e) { if (e.code !== 'DIGEST') throw e; damaged.push(f.rel); continue; }
        onCopied(f.rel, sha);
        if (digest) hashed.add(f.rel);
        copied++;
    }
    return { copied, hashed, damaged };
}

// Every file of `from` (as listed) is in `to`: its size, a small file byte for byte, a file with a known checksum read
// again unless its copy was checked already (`hashed`), and never the same file under two names. → {ok, problems}.
async function verifyStore(from, to, files, { digestFor = () => null, hashed = new Set(), isCancelled = () => false, onBytes = () => {} } = {}) {
    const problems = [];
    for (const f of files) {
        const src = f.shared || path.join(from, f.rel); const dst = path.join(to, f.rel);
        const d = await statOrNull(dst);
        if (f.link != null) {
            if (!(d && d.isSymbolicLink() && (await fsp.readlink(dst)) === f.link) || sameEntry(src, dst)) problems.push(`${dst} is missing.`);
            continue;
        }
        if (!(d && d.isFile())) { problems.push(`${dst} is missing.`); continue; }
        if (d.size !== f.size) { problems.push(`${dst} is ${d.size} bytes, not ${f.size}.`); continue; }
        if (sameFile(src, dst)) { problems.push(`${dst} is the same file as ${src}: the two folders are one.`); continue; }
        if (f.size < SMALL && !(await sameBytes(src, dst))) { problems.push(`${dst} differs from ${src}.`); continue; }
        const digest = digestFor(f.rel) || sharedDigest(f);
        if (digest && !hashed.has(f.rel)) {
            const got = await sha256File(dst, { isCancelled, onBytes });
            if (got !== digest) problems.push(`${dst} does not match its checksum.`);
            else hashed.add(f.rel);
        }
    }
    return { ok: !problems.length, problems };
}

// Finish, for Ollama's folder: an old manifest is deleted only when its copy has the same bytes and every blob it names
// is in `to` and checked (`verified`, by its sha256); a manifest kept keeps every blob it names in `from` too, so the old
// folder stays whole for it (a model with a damaged blob, one updated in the new folder meanwhile). A manifest the farm
// cannot read keeps every blob. → Set(rel) never deleted.
async function ollamaKeep(from, to, files, verified) {
    const keep = new Set();
    const blobRel = (dig) => path.join('blobs', dig.replace(':', '-'));
    let allBlobs = false;
    for (const f of files) {
        const top = f.rel.split(/[\\/]/)[0];
        if (!/^manifests(-v2)?$/.test(top) || f.link != null || path.basename(f.rel).startsWith('.')) continue;
        let digests = null;
        try {
            const j = JSON.parse(await fsp.readFile(path.join(from, f.rel), 'utf8'));
            digests = [j.config, ...(Array.isArray(j.layers) ? j.layers : [])].filter(Boolean).map((l) => String(l.digest || ''));
            if (!digests.length || digests.some((x) => !/^sha256:[0-9a-f]{64}$/.test(x))) digests = null;
        } catch { /* not a manifest the farm can read */ }
        const whole = digests && digests.every((x) => verified.has(blobRel(x)) && fs.existsSync(path.join(to, blobRel(x))));
        if (whole && (await sameBytes(path.join(from, f.rel), path.join(to, f.rel)))) continue;
        keep.add(f.rel);
        if (!digests) allBlobs = true;
        else for (const x of digests) keep.add(blobRel(x));
    }
    if (allBlobs) for (const f of files) if (f.rel.split(/[\\/]/)[0] === 'blobs') keep.add(f.rel);
    return keep;
}

// Delete the old copy: each file only while its copy is in `to` with the same size (and the same link) and is not the
// same file, and never one of `keep`; `only` = the store's names at the top of `from` (nothing else there is touched).
// Nothing at all when the two folders are one, or one holds the other, through any link. Then the folders emptied, and
// `from` itself once empty. → {deleted, kept (a copy that differs, or kept on purpose), notCopied (no copy at all),
// busy (could not be deleted: in use), keptBytes, sharedLeftBytes (shared Hugging Face blobs left in their cache: only
// the model's links were deleted), refused (why nothing was deleted)}.
async function deleteMoved(from, to, { only = null, keep = new Set() } = {}) {
    const res = { deleted: 0, kept: 0, notCopied: 0, busy: 0, keptBytes: 0, sharedLeftBytes: 0, refused: null };
    const rf = realOf(from); const rt = realOf(to);
    if (inside(rf, rt) || inside(rt, rf)) {
        res.refused = `${from} and ${to} are one folder (or one holds the other), so nothing was deleted.`;
        return res;
    }
    for (const f of await listFiles(from, { only })) {
        const src = path.join(from, f.rel); const dst = path.join(to, f.rel);
        const d = await statOrNull(dst);
        const bytes = f.size || 0;
        if (keep.has(f.rel)) { res.kept++; res.keptBytes += bytes; continue; }
        if (!d) { res.notCopied++; res.keptBytes += bytes; continue; }
        const good = f.link != null
            ? d.isSymbolicLink() && (await fsp.readlink(dst)) === f.link && !sameEntry(src, dst)
            : d.isFile() && d.size === f.size && !sameFile(f.shared || src, dst);
        if (!good) { res.kept++; res.keptBytes += bytes; continue; }
        // A shared Hugging Face blob: only the model's link goes (unlink never follows it); the shared file stays.
        if (f.shared) res.sharedLeftBytes += bytes;
        try { await fsp.unlink(src); res.deleted++; }
        catch (e) { if (e.code === 'ENOENT') res.deleted++; else { res.busy++; res.keptBytes += bytes; } }   // in use (Windows): kept, Finish tries again
    }
    if (only) { for (const top of only) await pruneEmpty(path.join(from, top)); await fsp.rmdir(from).catch(() => {}); }
    else await pruneEmpty(from);
    return res;
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

// Linux, vLLM's weights: <root>/hf becomes a link to `to` (the farm's folder), so every path vLLM, its scripts and the
// farm use stays the same. A real folder there is renamed <root>/hf.lolmove-old first (its files are deleted later, each
// only once its copy is checked), and everything is put back as it was when the link cannot be made. Idempotent: a move
// cut short (even between the rename and the link) is finished by calling it again. Never a link to a folder that is not
// there: then a <root>/hf a cut left missing comes back from hf.lolmove-old. → {ok, error, oldDir: hf.lolmove-old when it
// is there (the caller tells this move's from a leftover of an earlier one), or null}. On Windows (the tests) a junction.
function linkHf(root, to) {
    const hf = path.join(root, 'hf'); const old = `${hf}.lolmove-old`;
    const oldDir = () => (fs.existsSync(old) ? old : null);
    let st = null;
    try { st = fs.lstatSync(hf); } catch { /* none: never made, or renamed by a run that stopped before the link */ }
    let toIsDir = false;
    try { toIsDir = fs.statSync(to).isDirectory(); } catch { /* not there */ }
    if (!toIsDir) {
        let back = false;
        if (!st && fs.existsSync(old)) { try { fs.renameSync(old, hf); back = true; } catch { /* said below */ } }
        return { ok: false, error: `${to} is not there, so ${hf} was not changed${back ? ` (it is back from ${old})` : ''}.`, oldDir: null };
    }
    if (hfLinked(root, to)) return { ok: true, error: null, oldDir: oldDir() };
    if (st && !st.isSymbolicLink() && !st.isDirectory()) return { ok: false, error: `${hf} is not a folder.`, oldDir: null };
    if (st && st.isDirectory() && fs.existsSync(old)) return { ok: false, error: `${old} is already there: move it away first.`, oldDir: null };
    const prevLink = st && st.isSymbolicLink() ? fs.readlinkSync(hf) : null;
    try {
        if (prevLink != null) fs.unlinkSync(hf);
        else if (st) fs.renameSync(hf, old);
    } catch (e) { return { ok: false, error: `${hf} could not be moved aside (${e.code || e.message}).`, oldDir: null }; }
    try {
        fs.symlinkSync(to, hf, 'junction');
    } catch (e) {
        try { if (prevLink != null) fs.symlinkSync(prevLink, hf, 'junction'); else if (st) fs.renameSync(old, hf); } catch { /* said below */ }
        return { ok: false, error: `${hf} could not be made to lead to ${to} (${e.code || e.message}); it is back as it was.`, oldDir: null };
    }
    return { ok: true, error: null, oldDir: oldDir() };
}
// Does <root>/hf already lead to `to` (a link)?
function hfLinked(root, to) {
    const hf = path.join(root, 'hf');
    try { return fs.lstatSync(hf).isSymbolicLink() && fs.realpathSync(hf) === fs.realpathSync(to); } catch { return false; }
}

// ---- the move's journal: what a cut-short move had done, so Move here finishes it ------------------------------------
// {to, startedAt, switched (the farm's config names `to`, written right after it is saved), stores: [{id, from, to, by?,
// root?, only?, written: {rel: sha256} of what this move wrote, done?}]}. Flushed to the disk at each write.

const journalPath = (configPath) => path.join(path.dirname(configPath), '.lol-storage-move.json');
function readJournal(configPath) { try { return JSON.parse(fs.readFileSync(journalPath(configPath), 'utf8')); } catch { return null; } }
function writeJournal(configPath, j) { writeDurable(journalPath(configPath), JSON.stringify(j, null, 2) + '\n'); }
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
// The same two, off the event loop (the panel's measure: a USB disk waking up must not hold the seat gate).
const there = (p) => fsp.access(p).then(() => true, () => false);
async function storeHasModelAsync(store, name) { for (const r of manifestRels(name)) if (await there(path.join(store, r))) return true; return false; }
async function isOllamaStoreAsync(dir) { return (await there(path.join(dir, 'blobs'))) && ((await there(path.join(dir, 'manifests'))) || (await there(path.join(dir, 'manifests-v2')))); }

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
    FARM_DIR, DEFAULT, SUB, LABEL, PART, KEEP_FREE, CANARY, LAYA_REPO, OLLAMA_PARTS, MARKER, SMALL,
    useStorage, dirsFor, ggufDir, sttDir, classifyCache, kokoroModels, hfHubDir, ollamaModelsFor, ollamaEnv, ollamaDefaultStore, vllmRootFor,
    hasMarker, missingText, missingFor, recheckMissing, writeMarker, writeDurable,
    norm, inside, realOf, sameFile, sameEntry, sameBytes, checkDir, freeBytes, networkFolder, mountFsType,
    parseWinDisk, linuxDiskKind, mountDevice, diskKind, slowDiskText,
    listFiles, othersIn, linkEscapes, digestOf, copyFile, sha256File, bytesToCopy, copyStore, verifyStore, ollamaKeep, deleteMoved, pruneEmpty, linkHf, hfLinked,
    journalPath, readJournal, writeJournal, clearJournal,
    manifestRels, storeHasModel, isOllamaStore, storeHasModelAsync, isOllamaStoreAsync, ollamaLogFile, ollamaStoreInLog, ollamaStoreFromLog, ollamaReads, modelsInStore,
    scanFolder, wslPathOf,
};
