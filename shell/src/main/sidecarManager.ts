// sidecarManager — the OWUI sidecar is no longer bundled in the installer; it is
// DOWNLOADED to userData/sidecar on first run (a relocatable standalone CPython +
// open-webui, ~700 MB) so the installer stays small. This module:
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
import { execFile } from 'child_process';
import { promisify } from 'util';
import { sidecarRoot, sidecarInstalled, bundledOwuiVersion } from './paths';

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

async function ghJson(apiPath: string): Promise<any> {
    const { status, body } = await httpGet(`https://api.github.com${apiPath}`);
    if (status !== 200) throw new Error(`GitHub API ${status} for ${apiPath}`);
    return JSON.parse(body);
}

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

interface FoundAsset { url: string; owuiVersion: string | null }

async function findSidecarAsset(tagOrLatest: string): Promise<FoundAsset | null> {
    const rel = tagOrLatest === 'latest'
        ? await ghJson(`/repos/${REPO}/releases/latest`)
        : await ghJson(`/repos/${REPO}/releases/tags/${tagOrLatest}`);
    if (!rel || !Array.isArray(rel.assets)) return null;
    const asset = rel.assets.find((a: any) => a.name === assetName());
    if (!asset) return null;
    let owuiVersion: string | null = null;
    const man = rel.assets.find((a: any) => a.name === MANIFEST);
    if (man) {
        try { owuiVersion = JSON.parse((await httpGet(man.browser_download_url)).body).owuiVersion || null; } catch { /* optional */ }
    }
    return { url: asset.browser_download_url, owuiVersion };
}

// Download <tarball-url> and extract it into destDir (replacing it atomically).
// Extraction uses the system `tar` with RELATIVE paths from the tarball's dir, so
// a Windows absolute path (C:\…) never reaches GNU tar (which reads it as a remote
// host:path); both GNU tar and Windows' bundled bsdtar handle relative paths.
async function installFrom(url: string, destDir: string, onProgress?: ProgressCb): Promise<void> {
    const tmp = path.join(app.getPath('temp'), `lol-sidecar-${process.pid}-${Date.now()}.tar.gz`);
    onProgress?.({ phase: 'download', message: 'Downloading the chat engine…', percent: 0 });
    await downloadTo(url, tmp, (recv, total) => {
        onProgress?.({
            phase: 'download', receivedMB: Math.round(recv / 1e6), totalMB: Math.round(total / 1e6),
            percent: total ? Math.round((recv / total) * 100) : undefined,
        });
    });
    onProgress?.({ phase: 'extract', message: 'Unpacking the chat engine…' });
    const stage = destDir + '.stage';
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    // tar with RELATIVE paths from the tarball's dir (Windows GNU tar reads C:\ as
    // a remote host:path otherwise).
    const workDir = path.dirname(tmp);
    const relTar = path.basename(tmp);
    const relDest = path.relative(workDir, stage).replace(/\\/g, '/') || '.';
    await execFileP('tar', ['-xzf', relTar, '-C', relDest], { cwd: workDir });
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.renameSync(stage, destDir);
    fs.rmSync(tmp, { force: true });
}

// --- public API -------------------------------------------------------------

export function isSidecarInstalled(): boolean {
    return sidecarInstalled();
}

// At boot, before starting OWUI: if an update was staged, swap it in (the running
// OWUI is stopped at this point, so the files aren't locked — esp. on Windows).
export function applyPendingSidecar(): boolean {
    try {
        if (fs.existsSync(pendingDir())) {
            fs.rmSync(sidecarRoot(), { recursive: true, force: true });
            fs.renameSync(pendingDir(), sidecarRoot());
            return true;
        }
    } catch { /* leave the current sidecar in place */ }
    return false;
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

// Is a newer OWUI available on the latest release?
export async function checkOwuiUpdate(): Promise<{ current: string; latest: string | null; updateAvailable: boolean }> {
    const current = bundledOwuiVersion();
    const found = await findSidecarAsset('latest').catch(() => null);
    const latest = found?.owuiVersion || null;
    return { current, latest, updateAvailable: !!(latest && latest !== current && current !== 'unknown') };
}

// Download the latest OWUI sidecar, STAGED to userData/sidecar.pending — applied
// on the next launch by applyPendingSidecar() (so a running OWUI isn't disturbed).
export async function downloadOwuiUpdate(onProgress?: ProgressCb): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
        onProgress?.({ phase: 'check', message: 'Checking for a newer chat engine…' });
        const found = await findSidecarAsset('latest').catch(() => null);
        if (!found) return { ok: false, error: 'no sidecar on the latest release' };
        await installFrom(found.url, pendingDir(), onProgress);
        onProgress?.({ phase: 'done', message: 'Update downloaded — restart to apply.' });
        return { ok: true, version: found.owuiVersion || undefined };
    } catch (e: any) {
        onProgress?.({ phase: 'error', message: e.message });
        return { ok: false, error: e.message };
    }
}
