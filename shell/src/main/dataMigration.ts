// Data-folder change (M4). The user can move OWUI's DATA_DIR to a folder of their
// choice. We make it as safe as possible: the sidecar is stopped first (releases
// the SQLite/Chroma locks), then we COPY src→dest and only remove src once the
// copy succeeded — so a failure leaves the original intact (reversible).
//
// `exclude` names top-level entries of src that are left where they are, copied and
// removed by someone else: the client's own session folder (`lol-client`, see
// clientData.ts) is held open by Chromium while the app runs, so index.ts moves it
// at the next launch instead.

import * as fs from 'fs';
import * as path from 'path';

export interface MoveResult { ok: boolean; error?: string }
export interface MoveOptions { exclude?: string[] }

// Is `child` the same as or inside `parent`? (Refuse to move a folder into itself.)
function isInside(parent: string, child: string): boolean {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function dirHasData(dir: string): boolean {
    try { return fs.existsSync(dir) && fs.readdirSync(dir).length > 0; } catch { return false; }
}

// The top-level entries of src that take part in the move.
function movedEntries(src: string, exclude: string[]): string[] {
    const skip = new Set(exclude);
    try { return fs.readdirSync(src).filter((n) => !skip.has(n)); } catch { return []; }
}

// Copy all of src into dest (recursive). Node's fs.cpSync handles cross-volume.
export function copyDataDir(src: string, dest: string, opts: MoveOptions = {}): MoveResult {
    const exclude = opts.exclude || [];
    try {
        if (!fs.existsSync(src) || movedEntries(src, exclude).length === 0) {
            // Nothing to copy — just ensure dest exists.
            fs.mkdirSync(dest, { recursive: true });
            return { ok: true };
        }
        if (isInside(src, dest)) return { ok: false, error: 'The new folder is inside the current data folder.' };
        if (isInside(dest, src)) return { ok: false, error: 'The current data folder is inside the new folder.' };
        fs.mkdirSync(dest, { recursive: true });
        const skipped = new Set(exclude.map((n) => path.resolve(src, n)));
        fs.cpSync(src, dest, {
            recursive: true, errorOnExist: false, force: true,
            filter: (p) => !skipped.has(path.resolve(p)),
        });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
}

// Move = copy then remove the source (only after a clean copy). With `exclude`, the
// excluded entries stay in src, and so does src itself.
export function moveDataDir(src: string, dest: string, opts: MoveOptions = {}): MoveResult {
    const exclude = opts.exclude || [];
    const copied = copyDataDir(src, dest, opts);
    if (!copied.ok) return copied;
    try {
        if (fs.existsSync(src) && path.resolve(src) !== path.resolve(dest)) {
            if (!exclude.length) fs.rmSync(src, { recursive: true, force: true });
            else for (const n of movedEntries(src, exclude)) fs.rmSync(path.join(src, n), { recursive: true, force: true });
        }
        return { ok: true };
    } catch (e) {
        // Copy succeeded but cleanup failed — data is safe at dest; report softly.
        return { ok: true, error: `Copied, but could not remove the old folder: ${(e as Error).message}` };
    }
}
