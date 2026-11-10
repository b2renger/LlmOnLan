// sidecarManager — the OWUI sidecar is no longer bundled in the installer; it is
// DOWNLOADED to userData/sidecar on first run (a relocatable standalone CPython +
// open-webui, ~0.8–1.3 GB) so the installer stays small. This module:
//   • ensureSidecar()        — first-run download + extract, with progress
//   • applyPendingSidecar()  — swap a staged update in at boot (apply-after-restart)
//   • checkOwuiUpdate()      — is a newer OWUI available on the latest release?
//   • downloadOwuiUpdate()   — fetch a newer OWUI, staged to apply on next launch
//
// The sidecar bundle is published by CI as `owui-sidecar-<platform>-<arch>.tar.gz`
// release assets (+ an `owui-sidecar-manifest.json` carrying the OWUI version).

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { execFile, spawn } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import { sidecarRoot, sidecarInstalled, bundledOwuiVersion, bundledRev } from './paths';

const execFileP = promisify(execFile);

const REPO = process.env.LOL_RELEASE_REPO || 'b2renger/LlmOnLan';
const UA = 'LlmOnLan-shell';
const MANIFEST = 'owui-sidecar-manifest.json';

function assetName(): string {
    return `owui-sidecar-${process.platform}-${process.arch}.tar.gz`;
}
function pendingDir(): string { return sidecarRoot() + '.pending'; }

export interface SidecarProgress {
    phase: 'check' | 'download' | 'extract' | 'done' | 'error';
    receivedMB?: number;
    totalMB?: number;
    percent?: number;
    message?: string;
}
type ProgressCb = (p: SidecarProgress) => void;

// --- HTTP (redirect-following) ----------------------------------------------

function httpGet(url: string, redirects = 0): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        if (redirects > 6) return reject(new Error('too many redirects'));
        https.get(url, { headers: { 'user-agent': UA, accept: 'application/vnd.github+json' } }, (res) => {
            const loc = res.headers.location;
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
                res.resume();
                return httpGet(loc, redirects + 1).then(resolve, reject);
            }
            let buf = '';
            res.on('data', (c) => { buf += c; });
            res.on('end', () => resolve({ status: res.statusCode || 0, body: buf }));
        }).on('error', reject);
    });
}

/** One request, no redirect followed: its status and where it points. */
export type Head = (url: string) => Promise<{ status: number; location?: string }>;

const httpHead: Head = (url) => new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', headers: { 'user-agent': UA } }, (res) => {
        res.resume();
        resolve({ status: res.statusCode || 0, location: res.headers.location });
    });
    req.setTimeout(15_000, () => req.destroy(new Error('GitHub did not answer')));
    req.on('error', reject).end();
});

// Stream a (large) file to disk, following redirects, reporting bytes.
function downloadTo(url: string, dest: string, onBytes?: (recv: number, total: number) => void, redirects = 0): Promise<void> {
    return new Promise((resolve, reject) => {
        if (redirects > 6) return reject(new Error('too many redirects'));
        https.get(url, { headers: { 'user-agent': UA } }, (res) => {
            const loc = res.headers.location;
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
                res.resume();
                return downloadTo(loc, dest, onBytes, redirects + 1).then(resolve, reject);
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} downloading the sidecar`)); }
            const total = Number(res.headers['content-length'] || 0);
            let recv = 0;
            const out = fs.createWriteStream(dest);
            res.on('data', (c) => { recv += c.length; if (onBytes) onBytes(recv, total); });
            res.on('error', reject);
            out.on('error', reject);
            out.on('finish', () => out.close(() => resolve()));
            res.pipe(out);
        }).on('error', reject);
    });
}

// --- release asset lookup ---------------------------------------------------

interface FoundAsset { url: string; owuiVersion: string | null; bundleRev: string | null }

async function findSidecarAsset(tagOrLatest: string): Promise<FoundAsset | null> {
    const url = await releaseAssetUrl(tagOrLatest, assetName());
    if (!url) return null;
    let owuiVersion: string | null = null;
    let bundleRev: string | null = null;
    try {
        // The manifest of the same release: `url` names its tag even when 'latest' was asked.
        const m = JSON.parse((await httpGet(url.replace(/[^/]+$/, MANIFEST))).body);
        owuiVersion = m.owuiVersion || null;
        bundleRev = m.bundleRev || null;
    } catch { /* optional */ }
    return { url, owuiVersion, bundleRev };
}

/** The download link of one file on a release of this repo ('latest' or a tag), or null when that release has none. Also
 *  the IDE's coding-agent runtime (dsh-runtime-<platform>-<arch>.tar.gz, docs/plans/IDE_PLAN.md slice 5). Plain download
 *  links, never the GitHub API: the API allows 60 requests an hour to everything behind one public address, a school's whole
 *  network, and every client asks a minute after it starts (2026-11-10: the Farm app's check got a 403 there). 'latest'
 *  redirects to the tag's own link, which is what comes back, so a release landing meanwhile cannot mix two. */
export async function releaseAssetUrl(tagOrLatest: string, name: string, head: Head = httpHead): Promise<string | null> {
    let url = `https://github.com/${REPO}/releases/${tagOrLatest === 'latest' ? 'latest/download' : `download/${tagOrLatest}`}/${name}`;
    for (let hop = 0; hop < 3; hop++) {
        const { status, location } = await head(url);
        if (status === 404) return null;
        if (status < 300 || status >= 400 || !location) throw new Error(`GitHub ${status} for ${name}`);
        const next = new URL(location, url).toString();
        if (!next.startsWith(`https://github.com/${REPO}/releases/download/`)) return url;   // the file's storage: it is there
        url = next;
    }
    throw new Error(`too many redirects for ${name}`);
}

// Download <tarball-url> and extract it into destDir (replacing it atomically).
// Extraction is platform-split (see the tar call below): RELATIVE paths on Windows,
// ABSOLUTE paths everywhere else. `precompile` is for a tree that is about to RUN (the
// first-run install). A staged update is NOT precompiled where it lands: compileall runs
// python.exe from inside sidecar.pending, and on Windows a running exe under that folder
// makes the pending→live rename fail — "Restart to apply" then lost the update (docs review
// SA-6). applyPendingSidecar() precompiles the live tree after the swap instead.
export async function installFrom(url: string, destDir: string, onProgress?: ProgressCb, opts: { precompile?: boolean; label?: string } = {}): Promise<void> {
    const label = opts.label || 'the chat engine';
    const tmp = path.join(app.getPath('temp'), `lol-sidecar-${process.pid}-${Date.now()}.tar.gz`);
    onProgress?.({ phase: 'download', message: `Downloading ${label}…`, percent: 0 });
    await downloadTo(url, tmp, (recv, total) => {
        onProgress?.({
            phase: 'download', receivedMB: Math.round(recv / 1e6), totalMB: Math.round(total / 1e6),
            percent: total ? Math.round((recv / total) * 100) : undefined,
        });
    });
    onProgress?.({ phase: 'extract', message: `Unpacking ${label}…` });
    const stage = destDir + '.stage';
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    // Windows: RELATIVE paths from the tarball's dir, because GNU tar (often first on
    // PATH via Git) reads an absolute `C:\…` as a remote `host:path` ("Cannot connect to C:").
    // POSIX: ABSOLUTE paths. The relative form BROKE macOS — the temp dir is under /var,
    // a symlink to /private/var, so tar resolves its cwd to the real /private/var/… while
    // path.relative() computed the traversal lexically from /var/…; the `../../../../..`
    // then landed one level short (/private/Users/… → "tar: could not chdir").
    if (process.platform === 'win32') {
        const workDir = path.dirname(tmp);
        const relTar = path.basename(tmp);
        const relDest = path.relative(workDir, stage).replace(/\\/g, '/') || '.';
        await execFileP('tar', ['-xzf', relTar, '-C', relDest], { cwd: workDir });
    } else {
        await execFileP('tar', ['-xzf', tmp, '-C', stage]);
    }
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.renameSync(stage, destDir);
    fs.rmSync(tmp, { force: true });
    if (opts.precompile !== false) precompileSidecar(destDir);
}

// Precompile the freshly-unpacked tree to bytecode in the background. Python only
// writes a module's .pyc the first time it imports it, so without this the tree's
// first boot pays parse+compile for thousands of files on top of cold-disk reads —
// a large share of the "way too long" first launch. One low-priority pass now
// means the next boot of this tree starts from bytecode. It runs on a tree that is
// about to be used: the first-run install, and the live tree right after a staged
// update was swapped in (never inside sidecar.pending — see installFrom). Best-effort:
// a failure just leaves the old behavior.
function precompileSidecar(destDir: string): void {
    try {
        const py = process.platform === 'win32'
            ? path.join(destDir, 'python', 'python.exe')
            : path.join(destDir, 'python', 'bin', 'python3');
        if (!fs.existsSync(py)) return;
        const child = spawn(py, ['-m', 'compileall', '-q', '-j', '0', path.join(destDir, 'python')],
            { stdio: 'ignore', windowsHide: true });
        child.on('error', () => { /* best-effort */ });
        try { if (child.pid) os.setPriority(child.pid, 19); } catch { /* not critical */ }
    } catch { /* best-effort */ }
}

// --- public API -------------------------------------------------------------

export function isSidecarInstalled(): boolean {
    return sidecarInstalled();
}

// At boot, before starting OWUI: if an update was staged, swap it in (the running
// OWUI is stopped at this point, so ITS files aren't locked — esp. on Windows).
//
// The swap never leaves the app without an engine. It used to delete the live tree and
// only then rename pending; when that rename failed (anything still holding a file under
// sidecar.pending on Windows), the catch left NO sidecar, the boot re-downloaded the app
// version's — older — engine, and the update landed one launch later (docs review SA-6).
// Now: live → live.old, pending → live, and on any failure the old tree goes back. The
// pending tree stays for the next launch to retry.
export function applyPendingSidecar(): boolean {
    const live = sidecarRoot();
    const pending = pendingDir();
    const old = live + '.old';
    // A previous swap that died between its two renames left the engine in live.old.
    if (!fs.existsSync(live) && fs.existsSync(old)) { try { fs.renameSync(old, live); } catch { /* try below */ } }
    if (!fs.existsSync(pending)) return false;
    try { fs.rmSync(old, { recursive: true, force: true }); } catch { /* a leftover we can live with */ }
    let movedLive = false;
    try {
        if (fs.existsSync(live)) { fs.renameSync(live, old); movedLive = true; }
        fs.renameSync(pending, live);
    } catch (e) {
        if (movedLive && !fs.existsSync(live)) {
            try { fs.renameSync(old, live); } catch (e2) { console.warn('[sidecar] could not restore the previous engine:', (e2 as Error).message); }
        }
        console.warn('[sidecar] staged engine update not applied (will retry next launch):', (e as Error).message);
        return false;
    }
    try { fs.rmSync(old, { recursive: true, force: true }); } catch { /* removed next time */ }
    precompileSidecar(live);
    return true;
}

// Ensure the sidecar is present; download it from this app version's release (or
// the latest as a fallback) if not. No-op when already installed (or in dev).
export async function ensureSidecar(onProgress?: ProgressCb): Promise<{ ok: boolean; version?: string; error?: string }> {
    if (!app.isPackaged) return { ok: true, version: bundledOwuiVersion() }; // dev uses sidecar/.venv
    if (sidecarInstalled()) return { ok: true, version: bundledOwuiVersion() };
    try {
        onProgress?.({ phase: 'check', message: 'Locating the chat engine…' });
        let found = await findSidecarAsset(`v${app.getVersion()}`).catch(() => null);
        if (!found) found = await findSidecarAsset('latest').catch(() => null);
        if (!found) { onProgress?.({ phase: 'error', message: `No ${assetName()} on the release.` }); return { ok: false, error: 'sidecar asset not found' }; }
        await installFrom(found.url, sidecarRoot(), onProgress);
        onProgress?.({ phase: 'done', message: 'Chat engine ready.' });
        return { ok: true, version: bundledOwuiVersion() };
    } catch (e: any) {
        onProgress?.({ phase: 'error', message: e.message });
        return { ok: false, error: e.message };
    }
}

/** PURE: is the latest release's bundle one to offer? Another Open WebUI, or the same one rebuilt on purpose: a fix to the
 * bundle changes no Open WebUI version, so a laptop would otherwise keep the broken one for good (review PIN-2). */
export function offerBundle(current: string, rev: string, latest: string | null, latestRev: string | null): boolean {
    return !!(latest && current !== 'unknown' && (latest !== current || (latestRev && latestRev !== rev)));
}

// Is a newer OWUI available on the latest release? `latest: null` means GitHub could not
// be read (offline, a closed LAN, rate-limited). A dev build never checks: it runs the
// repo's sidecar/.venv, and a download would stage ~0.8–1.3 GB into a folder nothing uses.
export async function checkOwuiUpdate(): Promise<{ current: string; latest: string | null; updateAvailable: boolean; error?: string }> {
    const current = bundledOwuiVersion();
    if (!app.isPackaged) return { current, latest: null, updateAvailable: false, error: 'Chat-engine updates only apply to an installed build.' };
    const found = await findSidecarAsset('latest').catch(() => null);
    const latest = found?.owuiVersion || null;
    return { current, latest, updateAvailable: offerBundle(current, bundledRev(), latest, found?.bundleRev || null) };
}

/** PURE: download by itself? Only a REPAIRED bundle of the Open WebUI already installed (sidecar/BUNDLE_REV), and only once:
 * another Open WebUI stays a person's click in About (owner 2026-11-09). */
export function repairWanted(check: { current: string; latest: string | null; updateAvailable: boolean }, staged: boolean): boolean {
    return !staged && check.updateAvailable && check.latest === check.current;
}

/** A downloaded engine waits in sidecar.pending for the next start. */
export const updateStaged = (): boolean => fs.existsSync(pendingDir());

let staging: Promise<{ ok: boolean; version?: string; error?: string }> | null = null;

// Download the latest OWUI sidecar, STAGED to userData/sidecar.pending — applied
// on the next launch by applyPendingSidecar() (so a running OWUI isn't disturbed).
// One download at a time: About's click and the automatic repair share it.
export function downloadOwuiUpdate(onProgress?: ProgressCb): Promise<{ ok: boolean; version?: string; error?: string }> {
    if (!staging) staging = stageLatest(onProgress).finally(() => { staging = null; });
    return staging;
}

async function stageLatest(onProgress?: ProgressCb): Promise<{ ok: boolean; version?: string; error?: string }> {
    if (!app.isPackaged) return { ok: false, error: 'Chat-engine updates only apply to an installed build.' };
    try {
        onProgress?.({ phase: 'check', message: 'Checking for a newer chat engine…' });
        const found = await findSidecarAsset('latest').catch(() => null);
        if (!found) return { ok: false, error: 'no sidecar on the latest release' };
        await installFrom(found.url, pendingDir(), onProgress, { precompile: false });
        onProgress?.({ phase: 'done', message: 'Update downloaded — restart to apply.' });
        return { ok: true, version: found.owuiVersion || undefined };
    } catch (e: any) {
        onProgress?.({ phase: 'error', message: e.message });
        return { ok: false, error: e.message };
    }
}
