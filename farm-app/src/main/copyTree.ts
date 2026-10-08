// copyTree — the farm code refresh's copy (installer.ts copyFarm). Only fs and path, so its test runs it under
// Electron's own Node without the app around it.

import * as fs from 'fs';
import * as path from 'path';

// Where a refresh moves the files it replaces. Cleared at the next refresh (a file still held stays until then).
const REPLACED_DIR = '.replaced';

// The farm code is copied FILE BY FILE, never with fs.cpSync: Electron 42's cpSync deletes a file before writing
// it, and a file something holds open — the bash running vllm/serve.sh from this folder through WSL — is then
// left "delete pending": the new copy cannot take its name, cpSync throws, and every file after it is skipped
// (farm-v0.0.43 on the PRO 6000, 2026-10-08: serve.sh gone, status.sh never copied; the system's own Node does not
// do this, so a test outside Electron passes). A file that differs is MOVED aside first, which Windows allows while
// it is held (the holder keeps reading its old copy, as Linux would), then the new one is written. One that still
// fails does not stop the others: they are all named in the error, and the refresh is retried at the next launch.
// farm-app/test/copytree.test.js runs it under Electron's own Node, where the bug lives.
export function copyTree(src: string, dst: string, keep: (rel: string) => boolean = () => true): string[] {
    const aside = path.join(dst, REPLACED_DIR);
    let old: string[] = [];
    try { old = fs.readdirSync(aside); } catch { /* none yet */ }
    for (const f of old) { try { fs.rmSync(path.join(aside, f), { recursive: true, force: true }); } catch { /* still held: next time */ } }
    const failed: string[] = [];
    let n = 0;
    const walk = (rel: string): void => {
        for (const e of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
            const r = rel ? path.join(rel, e.name) : e.name;
            if (!keep(r)) continue;
            const from = path.join(src, r), to = path.join(dst, r);
            try {
                if (e.isDirectory()) { fs.mkdirSync(to, { recursive: true }); walk(r); continue; }
                let here: fs.Stats | null = null;
                try { here = fs.lstatSync(to); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
                if (here && e.isFile() && here.isFile() && here.size === fs.statSync(from).size
                    && fs.readFileSync(from).equals(fs.readFileSync(to))) continue;   // unchanged
                if (here) { fs.mkdirSync(aside, { recursive: true }); fs.renameSync(to, path.join(aside, `${++n}-${e.name}`)); }
                if (e.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);   // as a link, never followed
                else fs.copyFileSync(from, to);
            } catch (err) { failed.push(`${r.replace(/\\/g, '/')} (${(err as NodeJS.ErrnoException).code || (err as Error).message})`); }
        }
    };
    fs.mkdirSync(dst, { recursive: true });
    walk('');
    return failed;
}

