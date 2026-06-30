#!/usr/bin/env node
// build-sidecar — produce the self-contained, UNMODIFIED Open WebUI sidecar that
// the shell bundles. The pin is sidecar/OPENWEBUI_VERSION (single source of truth);
// upgrading OWUI is "bump that file + re-run this" with NO LOL code changes.
//
// Approach (the reliable one for OWUI, which ships a built SvelteKit frontend +
// many data files + heavy native deps like torch): a fully relocatable
// **standalone CPython** (astral-sh/python-build-standalone) into which we
// `pip install open-webui==<pin>`, plus launcher.py. The result under
// sidecar/build/<platform>-<arch>/ is self-contained (no system Python) and is
// copied verbatim into the app by electron-builder's `extraResources`; the shell
// runs `<bundle>/python(.exe) launcher.py serve --host --port`.
//
// Runs on the build machine / CI. Heavy (a few GB with torch) — that's inherent
// to OWUI's local-embeddings requirement (invariant #3). Needs `tar` (built into
// Windows 10+, macOS, Linux) and network access.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PY_PREFIX = process.env.LOL_PY_VERSION || '3.12'; // OWUI 0.10.1 supports 3.11/3.12
const OWUI_VERSION = fs.readFileSync(path.join(__dirname, 'OPENWEBUI_VERSION'), 'utf8').trim();

// node platform/arch → python-build-standalone "install_only" asset triple.
const TRIPLES = {
    'win32-x64': 'x86_64-pc-windows-msvc-install_only',
    'darwin-arm64': 'aarch64-apple-darwin-install_only',
    'darwin-x64': 'x86_64-apple-darwin-install_only',
    'linux-x64': 'x86_64-unknown-linux-gnu-install_only',
    'linux-arm64': 'aarch64-unknown-linux-gnu-install_only',
};

function log(m) { console.log(`[build-sidecar] ${m}`); }
function die(m) { console.error(`[build-sidecar] ERROR: ${m}`); process.exit(1); }

async function findPbsAsset(triple) {
    // Use the LATEST pbs release rather than a hardcoded tag (tags rotate often).
    log('querying python-build-standalone latest release …');
    const headers = { 'user-agent': 'llmonlan-build-sidecar' };
    if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`;
    const res = await fetch('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest', { headers });
    if (!res.ok) die(`GitHub API ${res.status} — set GH_TOKEN if rate-limited.`);
    const rel = await res.json();
    const re = new RegExp(`^cpython-${PY_PREFIX.replace('.', '\\.')}\\.\\d+\\+.*-${triple}\\.tar\\.gz$`);
    const asset = (rel.assets || []).find((a) => re.test(a.name));
    if (!asset) die(`no python-build-standalone asset for ${PY_PREFIX} / ${triple} in ${rel.tag_name}`);
    return asset.browser_download_url;
}

async function download(url, dest) {
    log(`downloading ${path.basename(url)} …`);
    const res = await fetch(url, { headers: { 'user-agent': 'llmonlan-build-sidecar' } });
    if (!res.ok) die(`download ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    log(`  ${(buf.length / 1e6).toFixed(0)} MB`);
}

async function main() {
    const key = `${process.platform}-${process.arch}`;
    const triple = TRIPLES[key];
    if (!triple) die(`unsupported platform ${key}`);

    // Fixed output name so electron-builder's extraResources `from` is the same on
    // every OS (each CI matrix job builds its own for the OS it runs on).
    const outDir = path.join(__dirname, 'build', 'sidecar');
    const workDir = path.join(__dirname, '.work');
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });

    // 1. fetch + extract a relocatable standalone CPython into <outDir>/python.
    const url = await findPbsAsset(triple);
    const tarball = path.join(workDir, 'python.tar.gz');
    await download(url, tarball);
    log('extracting standalone Python …');
    // Run tar with RELATIVE paths from workDir so no Windows drive-colon (C:\…)
    // reaches it: GNU/MSYS tar otherwise reads `C:\path` as a remote `host:path`
    // ("Cannot connect to C:"). Relative paths work for GNU tar and Windows'
    // bundled bsdtar alike, so this is robust locally and on CI (windows-latest
    // may have Git's GNU tar first on PATH).
    const relTar = path.basename(tarball);                              // python.tar.gz (in workDir)
    const relOut = path.relative(workDir, outDir).replace(/\\/g, '/');  // ../build/sidecar
    execFileSync('tar', ['-xzf', relTar, '-C', relOut], { cwd: workDir, stdio: 'inherit' }); // → <outDir>/python/

    const py = process.platform === 'win32'
        ? path.join(outDir, 'python', 'python.exe')
        : path.join(outDir, 'python', 'bin', 'python3');
    if (!fs.existsSync(py)) die(`extracted python not found at ${py}`);

    // 2. install the pinned, UNMODIFIED Open WebUI into that Python.
    log(`pip install open-webui==${OWUI_VERSION} (heavy — torch/chromadb/transformers) …`);
    execFileSync(py, ['-m', 'pip', 'install', '--no-warn-script-location', `open-webui==${OWUI_VERSION}`], {
        stdio: 'inherit',
        env: { ...process.env, PYTHONUTF8: '1' },
    });

    // 2b. On Linux, pip's default `torch` is the ~2 GB CUDA build, which pushes the
    // AppImage past GitHub's 2 GB release-asset limit. The client only needs torch
    // for CPU embeddings (the GPU box runs the farm), so swap it for the CPU wheel
    // from the PyTorch CPU index. --no-deps: torch's deps were just installed by
    // open-webui, so this replaces only the torch binary and avoids resolving deps
    // against the (torch-only) CPU index. Windows/macOS already get CPU torch.
    if (process.platform === 'linux') {
        log('replacing CUDA torch with the CPU wheel (Linux only — shrinks the AppImage) …');
        execFileSync(py, ['-m', 'pip', 'install', '--no-warn-script-location', '--force-reinstall', '--no-deps', 'torch', '--index-url', 'https://download.pytorch.org/whl/cpu'], {
            stdio: 'inherit',
            env: { ...process.env, PYTHONUTF8: '1' },
        });
    }

    // 3. drop in launcher.py (drives OWUI's Typer app; path-independent) + the
    // pin file, so the packaged About panel can read it (paths.bundledOwuiVersion
    // reads resources/sidecar/OPENWEBUI_VERSION).
    fs.copyFileSync(path.join(__dirname, 'launcher.py'), path.join(outDir, 'launcher.py'));
    fs.copyFileSync(path.join(__dirname, 'OPENWEBUI_VERSION'), path.join(outDir, 'OPENWEBUI_VERSION'));

    // 4. trim obvious build cruft to shrink the bundle.
    for (const junk of ['__pycache__', 'pip', 'setuptools']) {
        // (light touch — leave the runtime intact; just remove pip caches)
    }
    fs.rmSync(workDir, { recursive: true, force: true });

    log(`done → ${outDir}  (built for ${key})`);
    log(`  test:  ${py} ${path.join(outDir, 'launcher.py')} serve --host 127.0.0.1 --port 8080`);
    log(`  electron-builder extraResources copies sidecar/build/sidecar/ → resources/sidecar/`);
}

main().catch((e) => die(e.message));
