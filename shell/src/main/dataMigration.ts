// Data-folder change (M4). The user can move OWUI's DATA_DIR to a folder of their
// choice. We make it as safe as possible: the sidecar is stopped first (releases
// the SQLite/Chroma locks), then we COPY src→dest and only remove src once the
// copy succeeded — so a failure leaves the original intact (reversible).

import * as fs from 'fs';
import * as path from 'path';

export interface MoveResult { ok: boolean; error?: string }

// Is `child` the same as or inside `parent`? (Refuse to move a folder into itself.)
function isInside(parent: string, child: string): boolean {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function dirHasData(dir: string): boolean {
    try { return fs.existsSync(dir) && fs.readdirSync(dir).length > 0; } catch { return false; }
}

// Copy all of src into dest (recursive). Node's fs.cpSync handles cross-volume.
export function copyDataDir(src: string, dest: string): MoveResult {
    try {
        if (!fs.existsSync(src) || fs.readdirSync(src).length === 0) {
            // Nothing to copy — just ensure dest exists.
            fs.mkdirSync(dest, { recursive: true });
            return { ok: true };
        }
        if (isInside(src, dest)) return { ok: false, error: 'The new folder is inside the current data folder.' };
        if (isInside(dest, src)) return { ok: false, error: 'The current data folder is inside the new folder.' };
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(src, dest, { recursive: true, errorOnExist: false, force: true });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
}

// Move = copy then remove the source (only after a clean copy).
export function moveDataDir(src: string, dest: string): MoveResult {
    const copied = copyDataDir(src, dest);
    if (!copied.ok) return copied;
    try {
        if (fs.existsSync(src) && path.resolve(src) !== path.resolve(dest)) {
            fs.rmSync(src, { recursive: true, force: true });
        }
        return { ok: true };
    } catch (e) {
        // Copy succeeded but cleanup failed — data is safe at dest; report softly.
        return { ok: true, error: `Copied, but could not remove the old folder: ${(e as Error).message}` };
    }
}
