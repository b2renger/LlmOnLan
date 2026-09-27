// The client's own data — LOL Chat's history and the Computer's graphs and media — lives in the
// user's DATA_DIR (owner rule 2026-09-27: "all data in data dir including lol chat projects and
// computer projects").
//
// That data is the main window's Chromium storage (IndexedDB `lol-chat`, localStorage), so the
// window runs on a session rooted INSIDE the data folder: `session.fromPath(<DATA_DIR>/lol-client)`.
// Up to v0.1.45 it was the DEFAULT session, i.e. the same folders directly under userData. The
// layout is the same in both places (verified on Electron 42): `IndexedDB/file__0.indexeddb.leveldb`
// (+ `.blob`), `Local Storage/leveldb`, `WebStorage/QuotaManager` — so a copy of those three folders
// carries a profile across, blobs included.
//
// Pure fs + path, no Electron: index.ts runs prepareClientData() BEFORE app 'ready' (nothing holds
// the files yet) and hands the returned folder to session.fromPath(); the unit tests run the same
// functions on temp folders (test/chat/unit/shell-main.test.mjs).
//
// Nothing here deletes a source before its copy is complete, and the legacy copy under userData is
// never deleted at all: it stays as a backup.

import * as fs from 'fs';
import * as path from 'path';

/** The folder, inside DATA_DIR, that holds the main window's Chromium session. */
export const CLIENT_DIR_NAME = 'lol-client';
/** What the default session kept under userData that belongs to the main window. */
export const LEGACY_ITEMS = ['IndexedDB', 'Local Storage', 'WebStorage'] as const;

export function clientDataDir(dataDir: string): string {
    return path.join(dataDir, CLIENT_DIR_NAME);
}

const isDir = (p: string): boolean => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const dirHasEntries = (p: string): boolean => {
    try { return fs.readdirSync(p).length > 0; } catch { return false; }
};

/** Same as or inside? (A move into itself, or out of its own child, is refused.) */
export function isInside(parent: string, child: string): boolean {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Has a session already lived in `dir`? Chromium creates `Local Storage` the first time a session
 *  opens, so this is also true for a session that never saved a thread — which is the point: a
 *  folder a session has used is never overwritten by an import. */
export function hasClientData(dir: string): boolean {
    return isDir(path.join(dir, 'IndexedDB')) || isDir(path.join(dir, 'Local Storage'));
}

/** LevelDB's LOCK file is an empty lock marker that LevelDB recreates; a copy never needs it, and on
 *  Windows reading one that is held fails. Everything else is copied as is. */
const skipLock = (src: string): boolean => path.basename(src) !== 'LOCK';

function copyTree(src: string, dest: string): void {
    fs.cpSync(src, dest, { recursive: true, force: true, errorOnExist: false, filter: skipLock });
}

export interface LegacyResult {
    ok: boolean;
    copied: string[];                                        // LEGACY_ITEMS that were copied
    skipped?: 'target-has-data' | 'no-legacy-data';
    error?: string;
}

/**
 * The one-time import of a v0.1.x profile: copy IndexedDB, Local Storage and WebStorage from
 * userData into `clientDir` — ONLY when `clientDir` has neither IndexedDB nor Local Storage, so a
 * folder that already holds a history is never overwritten. The source is never deleted. A copy
 * that fails half-way is removed again, so the next launch retries from a clean slate.
 */
export function migrateLegacy(userDataDir: string, clientDir: string): LegacyResult {
    if (hasClientData(clientDir)) return { ok: true, copied: [], skipped: 'target-has-data' };
    const present: string[] = LEGACY_ITEMS.filter((n) => isDir(path.join(userDataDir, n)));
    if (!present.length) return { ok: true, copied: [], skipped: 'no-legacy-data' };
    for (const n of present) {
        if (isInside(path.join(userDataDir, n), clientDir)) {
            return { ok: false, copied: [], error: `The data folder is inside ${path.join(userDataDir, n)}.` };
        }
    }
    const preexisting = new Set(present.filter((n) => fs.existsSync(path.join(clientDir, n))));
    const touched: string[] = [];
    try {
        fs.mkdirSync(clientDir, { recursive: true });
        for (const n of present) {
            touched.push(n);
            copyTree(path.join(userDataDir, n), path.join(clientDir, n));
        }
        return { ok: true, copied: present.slice() };
    } catch (e) {
        for (const n of touched) {
            if (preexisting.has(n)) continue;
            try { fs.rmSync(path.join(clientDir, n), { recursive: true, force: true }); } catch { /* best effort */ }
        }
        return { ok: false, copied: [], error: (e as Error).message };
    }
}

export interface ClientMoveResult {
    ok: boolean;
    moved: boolean;          // false when there was nothing to move
    error?: string;
    warning?: string;        // the copy landed but the old folder could not be removed
    replacedTo?: string;     // where a history that was already at `to` was set aside
}

function stamp(now: Date): string {
    return now.toISOString().replace(/[:.]/g, '-');
}

/**
 * Move the client session folder `from` → `to` (a Preferences ▸ Data location move, applied at the
 * next launch because Chromium holds these files open while the app runs). The copy goes to a
 * staging folder next to `to` and is renamed into place only once it is complete; `from` is removed
 * only after that. A history already at `to` is set aside as `<to>.replaced-<time>`, never deleted.
 * Any failure before the rename leaves `from` untouched and `to` as it was.
 */
export function movePendingClientData(from: string, to: string, now: Date = new Date()): ClientMoveResult {
    const src = path.resolve(from);
    const dest = path.resolve(to);
    if (src === dest) return { ok: true, moved: false };
    if (isInside(src, dest)) return { ok: false, moved: false, error: 'The new folder is inside the current one.' };
    if (isInside(dest, src)) return { ok: false, moved: false, error: 'The current folder is inside the new one.' };
    if (!isDir(src) || !dirHasEntries(src)) return { ok: true, moved: false };

    const staging = `${dest}.moving`;
    try {
        fs.rmSync(staging, { recursive: true, force: true });     // a leftover of an attempt that died
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        copyTree(src, staging);
    } catch (e) {
        try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
        return { ok: false, moved: false, error: (e as Error).message };
    }

    let replacedTo: string | undefined;
    try {
        if (fs.existsSync(dest)) {
            if (dirHasEntries(dest)) {
                replacedTo = `${dest}.replaced-${stamp(now)}`;
                fs.renameSync(dest, replacedTo);
            } else {
                fs.rmdirSync(dest);
            }
        }
        fs.renameSync(staging, dest);
    } catch (e) {
        if (replacedTo && !fs.existsSync(dest)) {
            try { fs.renameSync(replacedTo, dest); } catch { /* it stays at replacedTo, intact */ }
        }
        try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
        return { ok: false, moved: false, error: (e as Error).message };
    }

    try {
        fs.rmSync(src, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        return { ok: true, moved: true, replacedTo };
    } catch (e) {
        return { ok: true, moved: true, replacedTo, warning: `Copied, but could not remove ${src}: ${(e as Error).message}` };
    }
}

/** Can the app create and write `dir`? (A data folder on a drive that is not plugged in cannot.) */
export function ensureWritable(dir: string): { ok: boolean; error?: string } {
    const probe = path.join(dir, `.lol-write-probe-${process.pid}`);
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        return { ok: true };
    } catch (e) {
        try { fs.unlinkSync(probe); } catch { /* never written */ }
        return { ok: false, error: (e as Error).message };
    }
}

/** rmdir that only succeeds on an empty folder — the old data folder, once everything left it. */
function removeIfEmpty(dir: string): boolean {
    try { if (fs.readdirSync(dir).length) return false; fs.rmdirSync(dir); return true; } catch { return false; }
}

/**
 * A cheap fingerprint of the legacy IndexedDB under userData (file count, bytes, newest mtime), or
 * null when there is none. Recorded at the import and compared at every boot: a change means an
 * older build that keeps LOL Chat in the default session (a pre-2026-09-27 dev build sharing this
 * userData) wrote history there AFTER it was copied — history the data folder does not have, which
 * must not go unnoticed. Measured on Electron 42: a run of this app never opens the default
 * session's IndexedDB, so the fingerprint has no false alarms. Local Storage is left out on purpose:
 * the window's `<webview>` makes Chromium open the default session's Local Storage at every start
 * (and LevelDB may compact a large log on open), so its files change without anyone writing. The
 * cost: an installed v0.1.x, whose history is ONLY the v1 localStorage key, is not detected.
 */
export function legacyStamp(userDataDir: string): string | null {
    const root = path.join(userDataDir, 'IndexedDB');
    if (!isDir(root)) return null;
    let count = 0, bytes = 0, newest = 0;
    const walk = (d: string): void => {
        let ents: fs.Dirent[] = [];
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            try {
                const st = fs.statSync(p);
                count++; bytes += st.size; newest = Math.max(newest, Math.floor(st.mtimeMs));
            } catch { /* vanished */ }
        }
    };
    walk(root);
    return `${count}:${bytes}:${newest}`;
}

// ---- the boot sequence ---------------------------------------------------------------------------

export interface PendingClientMove { from: string; to: string }
export interface ClientDataSettings {
    pendingClientMove: PendingClientMove | null;
    legacyClientDataImported: boolean;
    /** legacyStamp() when the import ran; null = there was no legacy history. */
    legacyClientDataStamp?: string | null;
}
export interface ClientDataNotice { level: 'info' | 'warn'; text: string }
export interface ClientDataPlan {
    /** The folder for session.fromPath(), or null: run on the default session (the legacy location). */
    dir: string | null;
    notices: ClientDataNotice[];
    log: string[];
}

/**
 * Decide where the main window's session lives this run, doing whatever file work that needs first.
 * The order:
 *   1. a Preferences move saved by the last run (`pendingClientMove`) — retried at every launch
 *      until it lands; while it has not, the window runs on the untouched source;
 *   2. the DATA_DIR must be creatable and writable, else `<userData>/lol-client` for this run;
 *   3. a history kept in `<userData>/lol-client` by an earlier run whose DATA_DIR was unavailable is
 *      brought into the DATA_DIR (or set aside, never merged, when the DATA_DIR has one too);
 *   4. the one-time import of a v0.1.x profile from userData (`legacyClientDataImported`); if that
 *      copy fails the window runs on the default session — the old location, with the old data —
 *      and the next launch tries again. The import is marked done after it ran once, so a later
 *      "Start fresh" folder is not filled with the old copy that stays under userData as a backup.
 *      After it, every boot compares the old IndexedDB with the stamp taken at the import: an older
 *      build that wrote there since (a pre-2026-09-27 dev build) gets a warning, once per change —
 *      its history is not merged, but does not go unnoticed. (An installed v0.1.x writes only its
 *      v1 localStorage key, which cannot be watched reliably: see legacyStamp.)
 */
export function prepareClientData(input: {
    userDataDir: string;
    dataDir: string;
    settings: ClientDataSettings;
    save: (patch: Partial<ClientDataSettings>) => void;
    attempts?: number;
    sleep?: (ms: number) => void;
    now?: () => Date;
}): ClientDataPlan {
    const notices: ClientDataNotice[] = [];
    const log: string[] = [];
    const attempts = Math.max(1, input.attempts ?? 1);
    const sleep = input.sleep ?? (() => {});
    const now = input.now ?? (() => new Date());
    const wanted = clientDataDir(input.dataDir);
    const fallback = clientDataDir(input.userDataDir);
    let dir: string | null = wanted;

    // 1. a move from Preferences ▸ Data location, saved by the last run
    const pending = input.settings.pendingClientMove;
    if (pending && typeof pending.from === 'string' && typeof pending.to === 'string') {
        let r: ClientMoveResult = { ok: false, moved: false, error: 'not tried' };
        for (let i = 0; i < attempts; i++) {
            r = movePendingClientData(pending.from, pending.to, now());
            if (r.ok) break;
            log.push(`move ${pending.from} -> ${pending.to}: attempt ${i + 1} failed: ${r.error}`);
            if (i + 1 < attempts) sleep(500);
        }
        if (r.ok) {
            input.save({ pendingClientMove: null });
            log.push(r.moved ? `moved ${pending.from} -> ${pending.to}` : `nothing to move at ${pending.from}`);
            if (r.warning) log.push(r.warning);
            if (r.moved && removeIfEmpty(path.dirname(path.resolve(pending.from)))) {
                log.push(`removed the empty old data folder ${path.dirname(path.resolve(pending.from))}`);
            }
            if (r.moved) {
                notices.push({
                    level: 'info',
                    text: `Your data now lives in ${input.dataDir}.`
                        + (r.replacedTo ? ` The LOL Chat history that was already in that folder was kept aside in ${r.replacedTo}.` : ''),
                });
            }
            if (r.replacedTo) log.push(`set aside ${pending.to} -> ${r.replacedTo}`);
        } else {
            dir = pending.from;
            notices.push({
                level: 'warn',
                text: `LOL Chat and the Computer could not be moved to ${pending.to} (${r.error}). `
                    + `They are still in ${pending.from} and in use; LlmOnLan tries the move again at the next launch.`,
            });
        }
    }

    // 2. the DATA_DIR must be usable
    if (dir === wanted) {
        const w = ensureWritable(wanted);
        if (!w.ok) {
            dir = fallback;
            log.push(`data folder not writable (${w.error}); using ${fallback}`);
            notices.push({
                level: 'warn',
                text: `Your data folder ${input.dataDir} cannot be written (${w.error}). `
                    + `LOL Chat and the Computer keep this session's work in ${fallback} instead. `
                    + 'Reconnect the folder, or pick another in Preferences › Data location.',
            });
            const f = ensureWritable(fallback);
            if (!f.ok) {
                dir = null;
                log.push(`fallback not writable either (${f.error}); using the default session`);
            }
        }
    }

    // 3. a history an earlier run kept in the fallback while the DATA_DIR was away
    if (dir === wanted && path.resolve(fallback) !== path.resolve(wanted) && hasClientData(fallback)) {
        if (!hasClientData(wanted)) {
            const r = movePendingClientData(fallback, wanted, now());
            log.push(r.ok ? `brought ${fallback} into ${wanted}` : `could not bring ${fallback} into ${wanted}: ${r.error}`);
            if (r.ok && r.moved) {
                notices.push({ level: 'info', text: `The LOL Chat history kept in ${fallback} while your data folder was unavailable is now in ${input.dataDir}.` });
            } else if (!r.ok) {
                dir = fallback;
                notices.push({ level: 'warn', text: `LOL Chat keeps using ${fallback} this session: it could not be moved into your data folder (${r.error}).` });
            }
        } else {
            const aside = `${fallback}.unmerged-${stamp(now())}`;
            try {
                fs.renameSync(fallback, aside);
                log.push(`set aside ${fallback} -> ${aside}`);
                notices.push({
                    level: 'warn',
                    text: `While your data folder was unavailable, LOL Chat ran from ${fallback}. Anything written there was not merged into your data folder: it is kept in ${aside}.`,
                });
            } catch (e) {
                log.push(`could not set aside ${fallback}: ${(e as Error).message}`);
            }
        }
    }

    // 4. the one-time import of a v0.1.x profile — and, after it, a watch on that old copy
    const legacyNow = dir !== null ? legacyStamp(input.userDataDir) : null;
    const notMerged = (why: string) => notices.push({
        level: 'warn',
        text: `${why} It was not merged: it is still in ${path.join(input.userDataDir, 'IndexedDB')}. `
            + 'To bring those chats over, export them from the version that wrote them (LOL Chat › Settings) and use Import chats… here.',
    });
    if (dir !== null && input.settings.legacyClientDataImported) {
        // An older build that keeps LOL Chat in the default session wrote there after the import.
        if (legacyNow !== (input.settings.legacyClientDataStamp ?? null)) {
            input.save({ legacyClientDataStamp: legacyNow });
            log.push(`legacy IndexedDB changed since the import (${input.settings.legacyClientDataStamp ?? 'none'} -> ${legacyNow ?? 'none'})`);
            if (legacyNow) notMerged('An older build of LlmOnLan saved LOL Chat history in its old place after your history moved into the data folder.');
        }
    } else if (dir !== null) {
        const r = migrateLegacy(input.userDataDir, dir);
        if (r.ok) {
            input.save({ legacyClientDataImported: true, legacyClientDataStamp: legacyNow });
            log.push(r.copied.length ? `imported ${r.copied.join(', ')} from ${input.userDataDir} into ${dir}` : `legacy import: ${r.skipped}`);
            if (r.copied.length) {
                notices.push({
                    level: 'info',
                    text: `LOL Chat's history and the Computer's graphs now live in your data folder (${dir}). `
                        + `The old copy stays in ${input.userDataDir} as a backup.`,
                });
            } else if (r.skipped === 'target-has-data' && legacyNow) {
                notMerged('Your data folder already had a LOL Chat history, and an older one was found where earlier versions kept it.');
            }
        } else {
            log.push(`legacy import into ${dir} failed: ${r.error}; using the default session`);
            dir = null;
            notices.push({
                level: 'warn',
                text: `LOL Chat's history could not be copied into your data folder (${r.error}). `
                    + 'This session uses it where it was; LlmOnLan tries again at the next launch.',
            });
        }
    }

    return { dir, notices, log };
}
