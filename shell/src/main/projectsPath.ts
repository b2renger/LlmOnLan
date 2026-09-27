// The scratch-projects path validator (studio plan §3.8.2). PURE: it imports `node:path` and
// nothing else, so it can be table-tested in plain Node and mirrored by the renderer's memory
// backend (renderer/chat/projects/memory.mjs).
//
// Everything the renderer can name goes through here. The renderer never sends an absolute path;
// it sends an id it was given by create()/list() and a POSIX-ish relative path, and both are
// re-validated here before any fs call. `resolveIn` is the mechanical backstop: whatever survived
// the textual rules must still resolve inside <root>/<id>.
import * as path from 'node:path';

/** Text files the API will read/write as UTF-8. */
export const TEXT_EXT: readonly string[] = Object.freeze([
    '.html', '.htm', '.js', '.mjs', '.css', '.json', '.md', '.txt', '.svg', '.ino', '.h', '.hpp',
    '.c', '.cpp', '.ini', '.yml', '.yaml', '.csv', '.glsl', '.frag', '.vert',
]);

/** Binary files the API will read/write as base64. */
export const BIN_EXT: readonly string[] = Object.freeze([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.wav', '.mp3', '.ogg', '.ttf', '.otf', '.woff2',
]);

/** The only extensionless name that is allowed anywhere in a project. */
export const ALLOWED_DOTFILE = '.gitignore';

/** `id = <slug(name, 48)>-<8 random base36>` — minted by create(), never by the renderer. */
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}-[a-z0-9]{8}$/;

export const MAX_DEPTH = 4;
export const MAX_REL_LEN = 200;
export const MAX_SEGMENT_LEN = 64;
/** A resolved absolute path longer than this is refused BEFORE the call (Windows MAX_PATH slack). */
export const MAX_ABS_LEN = 240;

const RESERVED = new Set([
    'con', 'prn', 'aux', 'nul',
    // CONIN$/CONOUT$ are console devices too, and `$` is a legal filename character, so they get
    // past every other rule here: `write(id, 'conout$.md')` used to succeed.
    'conin$', 'conout$',
    'com0', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt0', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export type PathErr = { ok: false; code: 'E_PATH' | 'E_EXT'; message: string };
export type IdErr = { ok: false; code: 'E_ID'; message: string };
export type RelOk = { ok: true; segments: string[]; ext: string };

export interface RelOptions {
    maxDepth?: number;
    maxLen?: number;
    /** The extension whitelist for THIS call: TEXT_EXT for text ops, BIN_EXT for binary ops. */
    exts?: readonly string[];
}

const bad = (code: 'E_PATH' | 'E_EXT', message: string): PathErr => ({ ok: false, code, message });

const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f]');

/** The extension of a file name, '' for `.gitignore` and for a name with no dot. */
export function extOf(name: string): string {
    const i = name.lastIndexOf('.');
    if (i <= 0) return '';
    return name.slice(i).toLowerCase();
}

/** A project id, as minted by create(). Anything else simply does not resolve. */
export function validateId(id: unknown): { ok: true; id: string } | IdErr {
    if (typeof id !== 'string' || !ID_RE.test(id)) {
        return { ok: false, code: 'E_ID', message: 'not a project id' };
    }
    return { ok: true, id };
}

/**
 * The textual rules, in the order §3.8.2 states them. Nothing here touches the disk, so the same
 * table can be asserted against the renderer's memory backend.
 */
export function validateRel(rel: unknown, o: RelOptions = {}): RelOk | PathErr {
    const maxDepth = o.maxDepth ?? MAX_DEPTH;
    const maxLen = o.maxLen ?? MAX_REL_LEN;
    const exts = o.exts ?? [...TEXT_EXT, ...BIN_EXT];

    // 1. empty, too long, or carrying a NUL / C0 control character
    if (typeof rel !== 'string' || rel.length === 0) return bad('E_PATH', 'empty path');
    if (rel.length > maxLen) return bad('E_PATH', 'path longer than ' + maxLen + ' characters');
    if (CONTROL_RE.test(rel)) return bad('E_PATH', 'control character in the path');

    // 2. a backslash anywhere — the renderer speaks '/' only
    if (rel.includes('\\')) return bad('E_PATH', 'backslash in the path');

    // 3. absolute, drive-lettered or UNC
    if (rel.startsWith('//')) return bad('E_PATH', 'UNC path');
    if (rel.startsWith('/')) return bad('E_PATH', 'absolute path');
    if (/^[a-zA-Z]:/.test(rel)) return bad('E_PATH', 'drive letter');

    const segments = rel.split('/');

    // 4. '.' / '..' / an empty segment
    for (const s of segments) {
        if (s === '') return bad('E_PATH', 'empty path segment');
        if (s === '.' || s === '..') return bad('E_PATH', 'relative segment');
    }

    // 5. depth and segment length
    if (segments.length > maxDepth) return bad('E_PATH', 'deeper than ' + maxDepth + ' segments');
    for (const s of segments) {
        if (s.length > MAX_SEGMENT_LEN) {
            return bad('E_PATH', 'segment longer than ' + MAX_SEGMENT_LEN + ' characters');
        }
    }

    for (const s of segments) {
        // 6. NTFS alternate data streams, the Windows-illegal set, a trailing dot or space
        if (s.includes(':')) return bad('E_PATH', 'alternate data stream');
        if (/[*?"<>|]/.test(s)) return bad('E_PATH', 'illegal character in a segment');
        if (/[. ]$/.test(s)) return bad('E_PATH', 'segment ends with a dot or a space');
        // 7. a Windows reserved device name, with any extension stripped (CON.txt is still CON)
        const stem = s.includes('.') ? s.slice(0, s.indexOf('.')) : s;
        if (RESERVED.has(stem.toLowerCase())) return bad('E_PATH', 'reserved device name');
        // 8. no dotfile trees and no .git writes. `.gitignore` is the one allowed dot name
        //    (stricter than §3.8.2, which bans a leading dot only on the first segment: banning it
        //    on every segment costs nothing and closes `assets/.git/config`).
        if (s.startsWith('.') && s !== ALLOWED_DOTFILE) return bad('E_PATH', 'dotfile');
    }

    // 9. the extension must be one this call accepts
    const name = segments[segments.length - 1];
    const ext = extOf(name);
    if (ext === '') {
        if (name !== ALLOWED_DOTFILE) return bad('E_EXT', 'no file extension');
    } else if (!exts.includes(ext)) {
        return bad('E_EXT', ext + ' is not an allowed extension here');
    }

    return { ok: true, segments, ext };
}

/** The project directory itself — the one path the renderer never spells. */
export function projectDir(root: string, id: string): string {
    return path.resolve(root, id);
}

/**
 * The mechanical containment check. Whatever survived `validateRel` must still land inside
 * <root>/<id> once the OS has had its say about the separators.
 */
export function resolveIn(
    root: string, id: string, rel: string, o: RelOptions = {},
): { ok: true; abs: string; segments: string[]; ext: string } | PathErr | IdErr {
    const idv = validateId(id);
    if (!idv.ok) return idv;
    const relv = validateRel(rel, o);
    if (!relv.ok) return relv;

    const base = projectDir(root, idv.id);
    const abs = path.resolve(base, ...relv.segments);
    const fold = (p: string) => (process.platform === 'win32'
        ? path.normalize(p).toLowerCase()
        : path.normalize(p));
    const a = fold(abs);
    const b = fold(base);
    if (a === b) return bad('E_PATH', 'that is the project folder, not a file');
    if (!a.startsWith(b + path.sep)) return bad('E_PATH', 'path escapes the project folder');
    if (abs.length > MAX_ABS_LEN) return bad('E_PATH', 'the resolved path is too long');

    return { ok: true, abs, segments: relv.segments, ext: relv.ext };
}
