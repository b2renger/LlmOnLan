// runtimeManager — download the on-box runtime the farm needs but the small
// installer deliberately doesn't bundle: a relocatable standalone CPython (for
// LiteLLM/SearXNG/OCR venvs) and the Ollama binary. Both land under
// userData/farm-runtime/ on first run, with byte-level progress to the wizard.
//
//   • ensureRuntime()  — download + extract Python and Ollama if missing (idempotent)
//   • runtimeReady()   — are both present?
//
// Sources are upstream release archives (no self-hosted asset): astral-sh/
// python-build-standalone for CPython (same triples as sidecar/build-sidecar.mjs)
// and ollama/ollama for Ollama. Asset names are matched by regex against the LATEST
// release so a renamed/rotated tag doesn't break us. After extraction the ACTUAL
// binary path is located and recorded in farm-runtime/runtime.json (paths.ts reads
// it) — the per-platform archive layouts differ, so we trust what we find.

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runtimeRoot, bundledPython, bundledOllamaBin, runtimeInstalled } from './paths';
import { DownloadProgress } from './types';

const execFileP = promisify(execFile);

const UA = 'LlmOnLan-Farm-app';
const PY_PREFIX = process.env.LOL_PY_VERSION || '3.12'; // farm venvs want 3.11/3.12

// node platform-arch → python-build-standalone "install_only" asset triple.
const PY_TRIPLES: Record<string, string> = {
    'win32-x64': 'x86_64-pc-windows-msvc-install_only',
    'darwin-arm64': 'aarch64-apple-darwin-install_only',
    'darwin-x64': 'x86_64-apple-darwin-install_only',
    'linux-x64': 'x86_64-unknown-linux-gnu-install_only',
    'linux-arm64': 'aarch64-unknown-linux-gnu-install_only',
};

// node platform-arch → the Ollama release asset that carries a runnable binary.
// Verified against ollama/ollama v0.31.1 (2026-07). The Linux archives are zstd
// (.tar.zst). For the DGX Spark we use the plain arm64 archive (it bundles the CUDA
// runners for GB10-class GPUs); the *-jetpack5/6 variants are for older Jetson CUDA.
const OLLAMA_ASSETS: Record<string, RegExp> = {
    'win32-x64': /^ollama-windows-amd64\.zip$/,
    'darwin-arm64': /^ollama-darwin\.tgz$/,
    'darwin-x64': /^ollama-darwin\.tgz$/,
    'linux-x64': /^ollama-linux-amd64\.tar\.zst$/,
    'linux-arm64': /^ollama-linux-arm64\.tar\.zst$/,
};

function key(): string { return `${process.platform}-${process.arch}`; }

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

// Runtime pins — fleet installs must be REPRODUCIBLE. 'Latest' meant an upstream
// release day could break every new farm install at once (and did make installs
// unpredictable across the fleet). Bumping = edit here, test one box, roll out.
// If a pinned release disappears (repos do prune), we fall back to latest with a
// loud log rather than dead-ending the installer.
const RUNTIME_PINS: Record<string, string> = {
    'ollama/ollama': 'v0.33.0',
    'astral-sh/python-build-standalone': '20260825',
};

async function ghLatestAssets(repo: string): Promise<{ tag: string; assets: { name: string; url: string }[] }> {
    const pin = RUNTIME_PINS[repo];
    if (pin) {
        const r = await httpGet(`https://api.github.com/repos/${repo}/releases/tags/${pin}`);
        if (r.status === 200) {
            const rel = JSON.parse(r.body);
            return { tag: rel.tag_name || pin, assets: (rel.assets || []).map((a: any) => ({ name: a.name, url: a.browser_download_url })) };
        }
        console.warn(`[runtime] pinned ${repo}@${pin} not found (HTTP ${r.status}) — falling back to latest`);
    }
    const { status, body } = await httpGet(`https://api.github.com/repos/${repo}/releases/latest`);
    if (status !== 200) throw new Error(`GitHub API ${status} for ${repo} latest release`);
    const rel = JSON.parse(body);
    return {
        tag: rel.tag_name || 'latest',
        assets: (rel.assets || []).map((a: any) => ({ name: a.name, url: a.browser_download_url })),
    };
}

// Stream a (large) file to disk, following redirects, reporting bytes.
// A STALLED socket (Wi-Fi drop that never RSTs) used to freeze the wizard forever
// with no cancel; 60 s without a byte now fails the download so the phase can retry.
function downloadTo(url: string, dest: string, onBytes?: (recv: number, total: number) => void, redirects = 0): Promise<void> {
    return new Promise((resolve, reject) => {
        if (redirects > 6) return reject(new Error('too many redirects'));
        const req = https.get(url, { headers: { 'user-agent': UA } }, (res) => {
            const loc = res.headers.location;
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
                res.resume();
                return downloadTo(loc, dest, onBytes, redirects + 1).then(resolve, reject);
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} downloading ${path.basename(dest)}`)); }
            const total = Number(res.headers['content-length'] || 0);
            let recv = 0;
            const out = fs.createWriteStream(dest);
            // 60 s without a single byte = a stalled socket, not a slow one.
            let stall: NodeJS.Timeout | null = null;
            const rearm = () => {
                if (stall) clearTimeout(stall);
                stall = setTimeout(() => {
                    req.destroy(new Error(`download stalled (no data for 60 s) for ${path.basename(dest)} — check the connection and retry`));
                }, 60000);
            };
            rearm();
            res.on('data', (c) => { recv += c.length; rearm(); if (onBytes) onBytes(recv, total); });
            res.on('error', (e) => { if (stall) clearTimeout(stall); reject(e); });
            out.on('error', (e) => { if (stall) clearTimeout(stall); reject(e); });
            out.on('finish', () => { if (stall) clearTimeout(stall); out.close(() => resolve()); });
            res.pipe(out);
        });
        req.on('error', reject);
    });
}

// --- extraction -------------------------------------------------------------

// Extract an archive into `destDir` with the system `tar` (bsdtar on Win10+/macOS,
// GNU tar on Linux). Uses RELATIVE paths from the archive's own dir so a Windows
// drive-colon (C:\…) never reaches tar (which would read it as a remote host:path).
// Compression flags follow the filename: .zip → bsdtar auto-detect; .tgz/.tar.gz →
// gzip; .tar.zst → zstd (GNU tar --zstd; the DGX/Ubuntu tar supports it).
//
// FLATTENS a single wrapping dir: the pbs Python tarball unpacks a top-level python/
// dir, so we promote its contents to destDir (→ destDir/bin, destDir/lib …) instead of
// destDir/python/. Ollama archives have several top-level entries (ollama[.exe] + lib/,
// or bin/ + lib/) so they're moved as-is. Extracts to a staging dir first, then renames.
async function extractArchive(archive: string, destDir: string): Promise<void> {
    const workDir = path.dirname(archive);
    const relArc = path.basename(archive);
    const lower = relArc.toLowerCase();
    let flags: string[];
    if (lower.endsWith('.zip')) flags = ['-xf'];
    else if (lower.endsWith('.tar.zst') || lower.endsWith('.tzst')) flags = ['--zstd', '-xf'];
    else if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz')) flags = ['-xzf'];
    else flags = ['-xf'];

    const stage = destDir + '.stage';
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    // Windows needs RELATIVE paths (GNU tar reads `C:\…` as a remote host:path); POSIX
    // uses ABSOLUTE. A relative traversal is unsafe on macOS when the two paths straddle a
    // symlinked prefix (/var → /private/var): tar resolves its cwd to the real path while
    // path.relative() is lexical, so the `..` count comes out short. (Bit the client shell's
    // sidecar download — see shell/src/main/sidecarManager.ts.)
    if (process.platform === 'win32') {
        const relStage = path.relative(workDir, stage).replace(/\\/g, '/') || '.';
        await execFileP('tar', [...flags, relArc, '-C', relStage], { cwd: workDir });
    } else {
        await execFileP('tar', [...flags, archive, '-C', stage]);
    }

    // If the archive was a single wrapping dir, promote it; else use the staging dir.
    const entries = fs.readdirSync(stage, { withFileTypes: true });
    const root = (entries.length === 1 && entries[0].isDirectory()) ? path.join(stage, entries[0].name) : stage;
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.renameSync(root, destDir);
    fs.rmSync(stage, { recursive: true, force: true }); // no-op if root WAS the stage (already renamed)
}

// Bounded recursive search for a binary by basename (depth ~3), returning its abs
// path or null. Used to record the real interpreter/Ollama path post-extract.
function findBinary(dir: string, names: string[], depth = 3): string | null {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isFile() && names.includes(e.name)) return full;
    }
    if (depth <= 0) return null;
    for (const e of entries) {
        if (e.isDirectory()) {
            const found = findBinary(path.join(dir, e.name), names, depth - 1);
            if (found) return found;
        }
    }
    return null;
}

// Record the resolved runtime binary paths so paths.ts prefers them over the
// computed default layout.
function writeManifest(patch: { python?: string; ollama?: string }): void {
    const file = path.join(runtimeRoot(), 'runtime.json');
    let cur: any = {};
    try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
    fs.writeFileSync(file, JSON.stringify({ ...cur, ...patch }, null, 2), 'utf8');
}

// --- download one piece -----------------------------------------------------

async function fetchAndExtract(repo: string, assetRx: RegExp, what: string, destDir: string, onProgress?: (p: DownloadProgress) => void): Promise<string> {
    onProgress?.({ phase: 'check', what, message: `Locating ${what}…` });
    const { tag, assets } = await ghLatestAssets(repo);
    const asset = assets.find((a) => assetRx.test(a.name));
    if (!asset) throw new Error(`No ${what} asset matching ${assetRx} in ${repo} ${tag}`);

    const tmp = path.join(runtimeRoot(), `.dl-${what}-${asset.name}`);
    fs.mkdirSync(runtimeRoot(), { recursive: true });
    onProgress?.({ phase: 'download', what, percent: 0, message: `Downloading ${what}…` });
    await downloadTo(asset.url, tmp, (recv, total) => {
        onProgress?.({
            phase: 'download', what,
            receivedMB: Math.round(recv / 1e6), totalMB: Math.round(total / 1e6),
            percent: total ? Math.round((recv / total) * 100) : undefined,
        });
    });

    onProgress?.({ phase: 'extract', what, message: `Unpacking ${what}…` });
    // extractArchive replaces destDir atomically (fresh staging → rename), so a
    // re-run can't merge two layouts.
    await extractArchive(tmp, destDir);
    fs.rmSync(tmp, { force: true });
    return destDir;
}

// --- public API -------------------------------------------------------------

export function runtimeReady(): boolean { return runtimeInstalled(); }

// Ensure Python + Ollama are present under farm-runtime/. Idempotent + resumable:
// each piece is skipped if already there, so a retry after a mid-download failure
// only fetches what's missing.
export async function ensureRuntime(onProgress?: (p: DownloadProgress) => void): Promise<{ ok: boolean; error?: string }> {
    const k = key();
    const pyTriple = PY_TRIPLES[k];
    const ollamaRx = OLLAMA_ASSETS[k];
    if (!pyTriple || !ollamaRx) return { ok: false, error: `Unsupported platform ${k}` };

    try {
        // 1. Portable CPython (pbs). The install_only tarball unpacks a top-level
        //    python/ dir with the standard layout, so the default path is reliable;
        //    we still record it for symmetry.
        if (!fs.existsSync(bundledPython())) {
            const pyRx = new RegExp(`^cpython-${PY_PREFIX.replace('.', '\\.')}\\.\\d+\\+.*-${pyTriple}\\.tar\\.gz$`);
            await fetchAndExtract('astral-sh/python-build-standalone', pyRx, 'python', path.join(runtimeRoot(), 'python'), onProgress);
            const pyBin = findBinary(path.join(runtimeRoot(), 'python'), process.platform === 'win32' ? ['python.exe'] : ['python3', 'python'], 2);
            if (!pyBin) throw new Error('extracted Python interpreter not found');
            if (process.platform !== 'win32') { try { fs.chmodSync(pyBin, 0o755); } catch { /* best-effort */ } }
            writeManifest({ python: pyBin });
        }

        // 2. Ollama.
        if (!fs.existsSync(bundledOllamaBin())) {
            await fetchAndExtract('ollama/ollama', ollamaRx, 'ollama', path.join(runtimeRoot(), 'ollama'), onProgress);
            const olBin = findBinary(path.join(runtimeRoot(), 'ollama'), process.platform === 'win32' ? ['ollama.exe'] : ['ollama'], 3);
            if (!olBin) throw new Error('extracted Ollama binary not found');
            if (process.platform !== 'win32') { try { fs.chmodSync(olBin, 0o755); } catch { /* best-effort */ } }
            writeManifest({ ollama: olBin });
        }

        onProgress?.({ phase: 'done', message: 'Runtime ready.' });
        return { ok: true };
    } catch (e: any) {
        onProgress?.({ phase: 'error', message: e.message });
        return { ok: false, error: e.message };
    }
}
