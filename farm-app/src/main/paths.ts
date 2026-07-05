// Resolve every filesystem path the Farm app needs.
//
// Two writable trees live under Electron's per-user userData:
//   • farm-runtime/   — the downloaded portable CPython + Ollama (runtimeManager)
//   • farm/           — a WRITABLE copy of the bundled farm code (installer copies it
//                       here so `lol up` can write its .venv/.searxng/.lol-runtime.json
//                       INSIDE its own dir, which a read-only asar/resources forbids)
//
// The farm code itself is shipped as an extraResource (resources/farm in a packaged
// build; ../farm in dev), copied into userData/farm on first run.

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

const isWin = process.platform === 'win32';

// --- writable per-user trees ------------------------------------------------

export function runtimeRoot(): string {
    return path.join(app.getPath('userData'), 'farm-runtime');
}

// The writable copy of the farm the app actually RUNS (`lol up` writes state here).
export function farmRoot(): string {
    return path.join(app.getPath('userData'), 'farm');
}

export function farmConfigFile(): string {
    return path.join(farmRoot(), 'lol.config.json');
}

// The `lol` CLI entry inside the writable farm copy — spawned as an Electron-as-Node
// child (node bin/lol.js up).
export function lolEntry(): string {
    return path.join(farmRoot(), 'bin', 'lol.js');
}

// --- bundled (read-only) farm source ----------------------------------------

// Where the farm code ships: resources/farm in a packaged build, ../farm in dev.
export function bundledFarmSource(): string {
    if (app.isPackaged) return path.join(process.resourcesPath, 'farm');
    return path.join(app.getAppPath(), '..', 'farm');
}

// --- bundled runtime binaries (downloaded to farm-runtime/) ------------------

// After extraction, runtimeManager records the ACTUAL resolved interpreter/binary
// paths in farm-runtime/runtime.json — the per-platform archive layouts differ
// (esp. Ollama), so we prefer the recorded truth over a computed guess and only
// fall back to the default layout before the first install has run.
interface RuntimeManifest { python?: string; ollama?: string }
export function readRuntimeManifest(): RuntimeManifest {
    try { return JSON.parse(fs.readFileSync(path.join(runtimeRoot(), 'runtime.json'), 'utf8')); }
    catch { return {}; }
}

function defaultPython(): string {
    const root = path.join(runtimeRoot(), 'python');
    return isWin ? path.join(root, 'python.exe') : path.join(root, 'bin', 'python3');
}

function defaultOllamaBin(): string {
    const root = path.join(runtimeRoot(), 'ollama');
    if (isWin) return path.join(root, 'ollama.exe');
    if (process.platform === 'linux') return path.join(root, 'bin', 'ollama');
    return path.join(root, 'ollama'); // darwin: ollama-darwin.tgz — layout confirmed at extract time
}

// The portable CPython interpreter. Set as $LOL_PYTHON so the farm's resolvePython()
// picks it deterministically (a stray system `py -3.12` can't win).
export function bundledPython(): string {
    return readRuntimeManifest().python || defaultPython();
}

// The dir to prepend to PATH so a bare `python` resolves to the bundled one.
export function pythonDir(): string {
    return path.dirname(bundledPython());
}

// The bundled Ollama binary.
export function bundledOllamaBin(): string {
    return readRuntimeManifest().ollama || defaultOllamaBin();
}

// The dir to prepend to PATH so `ollama` + `ollama serve` resolve to the bundled one
// (the farm's install.js onPath('ollama') then skips winget/brew/curl).
export function ollamaDir(): string {
    return path.dirname(bundledOllamaBin());
}

// --- install-state probes ---------------------------------------------------

export function runtimeInstalled(): boolean {
    try { return fs.existsSync(bundledPython()) && fs.existsSync(bundledOllamaBin()); }
    catch { return false; }
}

export function farmInstalled(): boolean {
    try { return fs.existsSync(lolEntry()); }
    catch { return false; }
}

// --- settings ---------------------------------------------------------------

export function settingsFile(): string {
    return path.join(app.getPath('userData'), 'farm-settings.json');
}
