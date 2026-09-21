// The scratch-projects API (studio plan §3.8). One root under the user's data folder, one
// directory per project, files only — no arbitrary paths, no directory creation as such, no
// deletion of directories, and NO execution primitive of any kind (no child_process, no
// openExternal, no vscode://). The renderer can name exactly two things: an id it was handed by
// create()/list(), and a relative path that survives `projectsPath`.
//
// Nothing here throws across IPC: every call resolves to {ok:true, ...} or {ok:false, code, message}.
import * as path from 'node:path';
import * as fspPromises from 'node:fs/promises';
import { constants as FS_CONSTANTS } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { BIN_EXT, ID_RE, TEXT_EXT, projectDir, resolveIn, validateId } from './projectsPath';

type FsApi = typeof fspPromises;

export type ErrCode =
    | 'E_ROOT' | 'E_ID' | 'E_PATH' | 'E_EXT' | 'E_SIZE' | 'E_QUOTA' | 'E_RATE'
    | 'E_MISSING' | 'E_LOCKED' | 'E_CONFLICT' | 'E_IO';

export type Err = { ok: false; code: ErrCode; message: string };
export type Ok<T> = { ok: true } & T;
/** The shape of a call that reports only success. */
export type OkVoid = { ok: true };

export type ProjectKind = 'canvas' | 'dom' | 'three' | 'p5' | 'svg' | 'board';
export type EditPolicy = 'auto' | 'whole' | 'anchored';
export interface ProjectSettings { autoApply: boolean; autoFix: boolean; editPolicy: EditPolicy }
export interface ProjectMeta {
    id: string; name: string; kind: ProjectKind; createdAt: number; updatedAt: number;
    settings: ProjectSettings; hidden: boolean;
}

export interface ProjectsApi {
    root(): Promise<Ok<{ path: string; exists: boolean; writable: boolean }> | Err>;
    list(): Promise<Ok<{ projects: ProjectMeta[]; skipped: number }> | Err>;
    create(input: { name: string; kind: ProjectKind; settings?: Partial<ProjectSettings> }): Promise<Ok<{ project: ProjectMeta }> | Err>;
    meta(id: string): Promise<Ok<{ project: ProjectMeta }> | Err>;
    update(id: string, patch: { name?: string; settings?: Partial<ProjectSettings> }): Promise<Ok<{ project: ProjectMeta }> | Err>;
    forget(id: string): Promise<OkVoid | Err>;
    listFiles(id: string): Promise<Ok<{ files: { path: string; size: number; mtime: number }[] }> | Err>;
    read(id: string, rel: string): Promise<Ok<{ text: string; size: number; mtime: number }> | Err>;
    readBinary(id: string, rel: string): Promise<Ok<{ base64: string; size: number; mime: string }> | Err>;
    write(id: string, rel: string, text: string, o?: { ifMtime?: number }): Promise<Ok<{ size: number; mtime: number }> | Err>;
    writeBinary(id: string, rel: string, base64: string): Promise<Ok<{ size: number }> | Err>;
    remove(id: string, rel: string): Promise<OkVoid | Err>;
    reveal(id: string): Promise<OkVoid | Err>;
    open(id: string): Promise<OkVoid | Err>;
    path(id: string): Promise<Ok<{ path: string }> | Err>;
    /** Diagnostics for the landing DEVLOG entry (rename retries under antivirus/OneDrive). */
    stats(): { renameRetries: number; lockedGiveUps: number; refusedPaths: number };
}

// --- limits (§3.8.3) --------------------------------------------------------------------------
export const TEXT_MAX = 2 * 1024 * 1024;
export const BIN_MAX = 8 * 1024 * 1024;
export const MAX_FILES_PER_PROJECT = 512;
export const MAX_BYTES_PER_PROJECT = 200 * 1024 * 1024;
export const MAX_PROJECTS = 200;
export const WRITES_PER_SEC = 20;
export const WRITE_BURST = 40;
export const META_MAX = 64 * 1024;
export const MAX_ROOT_LEN = 150;
export const TEMP_TTL_MS = 60 * 60 * 1000;
const RENAME_RETRIES = 3;
const RENAME_BACKOFF_MS = 50;

const KINDS: ProjectKind[] = ['canvas', 'dom', 'three', 'p5', 'svg', 'board'];
const POLICIES: EditPolicy[] = ['auto', 'whole', 'anchored'];
const META_FILE = 'project.json';
const TEMP_RE = /\.[a-z0-9]{6,}\.tmp$/i;

const MIME: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
};

const fail = (code: ErrCode, message: string): Err => ({ ok: false, code, message });
const errno = (e: unknown): string => String((e as { code?: string } | null)?.code || '');
const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

/** `<slug>-<8 base36>`; the slug is what a human recognises in Explorer, the suffix is uniqueness. */
export function slug(name: string, max = 48): string {
    const s = String(name).toLowerCase().normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
    return s || 'project';
}

function rand36(n: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = randomBytes(n);
    let out = '';
    for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

function defaultSettings(): ProjectSettings {
    // Owner decision: auto-apply and auto-fix are OFF by default, opt-in per project.
    return { autoApply: false, autoFix: false, editPolicy: 'auto' };
}

function cleanSettings(patch: unknown, base: ProjectSettings): ProjectSettings {
    const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<ProjectSettings>;
    return {
        autoApply: typeof p.autoApply === 'boolean' ? p.autoApply : base.autoApply,
        autoFix: typeof p.autoFix === 'boolean' ? p.autoFix : base.autoFix,
        editPolicy: typeof p.editPolicy === 'string' && POLICIES.includes(p.editPolicy as EditPolicy)
            ? p.editPolicy as EditPolicy : base.editPolicy,
    };
}

export function createProjectsApi(opts: {
    rootDir: string;
    shellApi: { showItemInFolder(p: string): void; openPath(p: string): Promise<string> };
    fsApi?: FsApi;
    now?: () => number;
    /** Test-only narrowing of the §3.8.3 limits, so a quota can be proven without writing 200 MB. */
    limits?: { files?: number; bytes?: number; textMax?: number; binMax?: number; projects?: number };
}): ProjectsApi {
    const rootDir = path.resolve(opts.rootDir);
    const fs: FsApi = opts.fsApi || fspPromises;
    const clock = opts.now || (() => Date.now());
    const shellApi = opts.shellApi;

    const LIM = {
        files: opts.limits?.files ?? MAX_FILES_PER_PROJECT,
        bytes: opts.limits?.bytes ?? MAX_BYTES_PER_PROJECT,
        textMax: opts.limits?.textMax ?? TEXT_MAX,
        binMax: opts.limits?.binMax ?? BIN_MAX,
        projects: opts.limits?.projects ?? MAX_PROJECTS,
    };
    const buckets = new Map<string, { tokens: number; ts: number }>();
    const stats = { renameRetries: 0, lockedGiveUps: 0, refusedPaths: 0 };
    let lastRefusalLog = 0;

    // ---- plumbing ----------------------------------------------------------------------------

    /** A refused path is a BUG SIGNAL, not a user message: logged at most once a minute. */
    function logRefusal(rel: unknown, code: string): void {
        const t = clock();
        stats.refusedPaths += 1;
        if (t - lastRefusalLog < 60000) return;
        lastRefusalLog = t;
        const shown = String(rel).slice(0, 80);
        console.warn(`[projects] refused a renderer path (${code}): ${JSON.stringify(shown)}`);
    }

    async function statOr(p: string) {
        try { return await fs.stat(p); } catch { return null; }
    }

    async function rootExists(): Promise<boolean> {
        const st = await statOr(rootDir);
        return !!st && st.isDirectory();
    }

    async function ensureRootDir(): Promise<Err | null> {
        if (await rootExists()) return null;
        try {
            await fs.mkdir(rootDir, { recursive: true });
            return null;
        } catch (e) {
            return fail('E_ROOT', `the projects folder cannot be created: ${rootDir} (${errno(e)})`);
        }
    }

    async function dirOf(id: unknown): Promise<{ ok: true; id: string; dir: string } | Err> {
        const v = validateId(id);
        if (!v.ok) return fail('E_ID', 'not a project id');
        const dir = projectDir(rootDir, v.id);
        const st = await statOr(dir);
        if (!st || !st.isDirectory()) return fail('E_MISSING', 'that project folder is not there any more');
        return { ok: true, id: v.id, dir };
    }

    /**
     * §3.8.2's disk half: a symlink / junction / reparse point ANYWHERE between the project folder
     * and the target stops the operation. This is what makes the root a boundary on a box where the
     * user can `mklink /J`.
     */
    async function noLinks(id: string, segments: string[]): Promise<Err | null> {
        let cur = projectDir(rootDir, id);
        const chain = [cur];
        for (const s of segments) { cur = path.join(cur, s); chain.push(cur); }
        for (const p of chain) {
            try {
                const st = await fs.lstat(p);
                if (st.isSymbolicLink()) return fail('E_PATH', 'that path goes through a link');
            } catch (e) {
                if (errno(e) === 'ENOENT') continue;   // not created yet: a write may make it
                return fail('E_IO', 'the path could not be checked');
            }
        }
        return null;
    }

    function takeToken(id: string): boolean {
        const now = clock();
        const b = buckets.get(id) || { tokens: WRITE_BURST, ts: now };
        const refill = ((now - b.ts) / 1000) * WRITES_PER_SEC;
        b.tokens = Math.min(WRITE_BURST, b.tokens + refill);
        b.ts = now;
        if (b.tokens < 1) { buckets.set(id, b); return false; }
        b.tokens -= 1;
        buckets.set(id, b);
        return true;
    }

    type Entry = { rel: string; abs: string; size: number; mtime: number };

    /** Walk one project, never following links, bounded by the validator's own depth. */
    async function walk(dir: string, budget = 4000): Promise<Entry[]> {
        const out: Entry[] = [];
        const stack: { abs: string; rel: string; depth: number }[] = [{ abs: dir, rel: '', depth: 0 }];
        while (stack.length && out.length < budget) {
            const cur = stack.pop() as { abs: string; rel: string; depth: number };
            let entries: Awaited<ReturnType<FsApi['readdir']>> = [];
            try {
                entries = await fs.readdir(cur.abs, { withFileTypes: true }) as never;
            } catch { continue; }
            for (const e of entries as unknown as { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }[]) {
                const rel = cur.rel ? `${cur.rel}/${e.name}` : e.name;
                const abs = path.join(cur.abs, e.name);
                if (e.isSymbolicLink()) continue;                       // never followed, never listed
                if (e.isDirectory()) {
                    if (cur.depth < 8) stack.push({ abs, rel, depth: cur.depth + 1 });
                    continue;
                }
                const st = await statOr(abs);
                if (!st) continue;
                out.push({ rel, abs, size: st.size, mtime: Math.round(st.mtimeMs) });
            }
        }
        return out;
    }

    const isTemp = (rel: string) => TEMP_RE.test(rel);
    const isMeta = (rel: string) => rel === META_FILE;

    async function sweepTemp(dir: string): Promise<void> {
        const now = clock();
        for (const f of await walk(dir, 1000)) {
            if (!isTemp(f.rel)) continue;
            if (now - f.mtime < TEMP_TTL_MS) continue;
            try { await fs.unlink(f.abs); } catch { /* a sweep never fails a call */ }
        }
    }

    async function usage(dir: string): Promise<{ files: number; bytes: number; byRel: Map<string, number> }> {
        const byRel = new Map<string, number>();
        let files = 0; let bytes = 0;
        for (const f of await walk(dir)) {
            if (isTemp(f.rel) || isMeta(f.rel)) continue;
            files += 1; bytes += f.size;
            byRel.set(f.rel, f.size);
        }
        return { files, bytes, byRel };
    }

    async function readMeta(id: string): Promise<ProjectMeta | null> {
        const file = path.join(projectDir(rootDir, id), META_FILE);
        try {
            const st = await fs.stat(file);
            if (st.size > META_MAX) return null;
            const raw = await fs.readFile(file, 'utf8');
            const j = JSON.parse(raw) as Partial<ProjectMeta> & { v?: number };
            if (!j || typeof j !== 'object') return null;
            if (typeof j.name !== 'string' || !KINDS.includes(j.kind as ProjectKind)) return null;
            return {
                id,
                name: j.name,
                kind: j.kind as ProjectKind,
                createdAt: Number(j.createdAt) || 0,
                updatedAt: Number(j.updatedAt) || 0,
                settings: cleanSettings(j.settings, defaultSettings()),
                hidden: j.hidden === true,
            };
        } catch { return null; }
    }

    async function writeMeta(meta: ProjectMeta): Promise<Err | null> {
        const dir = projectDir(rootDir, meta.id);
        const body = JSON.stringify({ v: 1, ...meta }, null, 2);
        const r = await atomicWrite(path.join(dir, META_FILE), Buffer.from(body, 'utf8'));
        return r.ok ? null : r;
    }

    /**
     * tmp in the same directory, fsync, rename over the target. A crash never truncates a sketch;
     * a file held open by another program comes back as E_LOCKED after the retry ladder.
     */
    async function atomicWrite(abs: string, buf: Buffer): Promise<Ok<{ size: number; mtime: number }> | Err> {
        const dir = path.dirname(abs);
        const tmp = path.join(dir, `${path.basename(abs)}.${rand36(8)}.tmp`);
        try {
            const fh = await fs.open(tmp, 'w');
            try {
                await fh.writeFile(buf);
                await fh.sync();
            } finally { await fh.close(); }
        } catch (e) {
            try { await fs.unlink(tmp); } catch { /* nothing was written */ }
            if (errno(e) === 'ENOSPC') return fail('E_IO', 'the disk is full');
            return fail('E_IO', `the file could not be written (${errno(e) || 'unknown'})`);
        }
        for (let attempt = 0; ; attempt++) {
            try {
                await fs.rename(tmp, abs);
                const st = await statOr(abs);
                return { ok: true, size: buf.length, mtime: st ? Math.round(st.mtimeMs) : clock() };
            } catch (e) {
                const code = errno(e);
                const retriable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
                if (retriable && attempt < RENAME_RETRIES) {
                    stats.renameRetries += 1;
                    await sleep(RENAME_BACKOFF_MS);
                    continue;
                }
                try { await fs.unlink(tmp); } catch { /* best effort */ }
                if (retriable) {
                    stats.lockedGiveUps += 1;
                    return fail('E_LOCKED', 'the file is open in another program');
                }
                if (code === 'ENOSPC') return fail('E_IO', 'the disk is full');
                return fail('E_IO', `the file could not be saved (${code || 'unknown'})`);
            }
        }
    }

    /**
     * Shared front half of every file call: id, path, links, and the resolved absolute path.
     *
     * `mutate` reserves the METADATA FILE (S0 review, finding 2). `project.json` is a normal .json
     * path as far as validateRel is concerned, so before this guard the file-writing path — the one
     * a model-named target flows through — could `write(id, 'project.json', …)` and flip
     * autoApply/autoFix on, or `remove(id, 'project.json')` and make the project vanish from list().
     * Reads stay allowed (a panel may look at its own settings); nothing but update()/forget() ever
     * CHANGES it, and forget() hides, it does not delete.
     */
    async function target(id: unknown, rel: unknown, exts: readonly string[], mutate = false):
        Promise<{ ok: true; id: string; dir: string; abs: string; segments: string[]; ext: string } | Err> {
        const d = await dirOf(id);
        if (!d.ok) return d;
        const r = resolveIn(rootDir, d.id, rel as string, { exts });
        if (!r.ok) { logRefusal(rel, r.code); return fail(r.code, r.message); }
        if (mutate && r.segments.length === 1 && r.segments[0] === META_FILE) {
            logRefusal(rel, 'E_PATH');
            return fail('E_PATH', `${META_FILE} belongs to the app — use update() or forget()`);
        }
        const links = await noLinks(d.id, r.segments);
        if (links) return links;
        return { ok: true, id: d.id, dir: d.dir, abs: r.abs, segments: r.segments, ext: r.ext };
    }

    /** No call ever throws across IPC: an unexpected exception is an E_IO with a generic message. */
    async function guard<T>(what: string, fn: () => Promise<T | Err>): Promise<T | Err> {
        try { return await fn(); } catch (e) {
            console.error(`[projects] ${what} threw`, e);
            return fail('E_IO', 'the projects folder could not be used');
        }
    }

    // ---- the API -----------------------------------------------------------------------------

    const api: ProjectsApi = {
        stats: () => ({ ...stats }),

        root: () => guard('root', async () => {
            const st = await statOr(rootDir);
            const exists = !!st && st.isDirectory();
            let writable = false;
            if (exists) {
                try { await fs.access(rootDir, FS_CONSTANTS.W_OK); writable = true; } catch { writable = false; }
            }
            return { ok: true as const, path: rootDir, exists, writable };
        }),

        list: () => guard('list', async () => {
            if (!(await rootExists())) return { ok: true as const, projects: [], skipped: 0 };
            let entries: { name: string; isDirectory(): boolean }[] = [];
            try {
                entries = await fs.readdir(rootDir, { withFileTypes: true }) as never;
            } catch (e) {
                return fail('E_ROOT', `the projects folder cannot be read: ${rootDir} (${errno(e)})`);
            }
            const dirs = entries.filter((e) => e.isDirectory() && ID_RE.test(e.name)).slice(0, LIM.projects);
            const projects: ProjectMeta[] = [];
            let skipped = 0;
            for (const d of dirs) {
                const meta = await readMeta(d.name);
                if (!meta) { skipped += 1; continue; }
                await sweepTemp(path.join(rootDir, d.name));
                if (meta.hidden) continue;
                projects.push(meta);
            }
            projects.sort((a, b) => b.updatedAt - a.updatedAt);
            return { ok: true as const, projects, skipped };
        }),

        create: (input) => guard('create', async () => {
            const name = typeof input?.name === 'string' ? input.name.trim() : '';
            if (!name || name.length > 80) return fail('E_PATH', 'a project needs a name');
            const kind = input?.kind;
            if (!KINDS.includes(kind)) return fail('E_PATH', 'unknown project kind');
            if (rootDir.length > MAX_ROOT_LEN) {
                return fail('E_PATH', `the data folder path is too long for project files: ${rootDir}`);
            }
            const rootErr = await ensureRootDir();
            if (rootErr) return rootErr;

            let existing: { name: string; isDirectory(): boolean }[] = [];
            try { existing = await fs.readdir(rootDir, { withFileTypes: true }) as never; } catch { existing = []; }
            const count = existing.filter((e) => e.isDirectory() && ID_RE.test(e.name)).length;
            if (count >= LIM.projects) return fail('E_QUOTA', `there are already ${LIM.projects} projects`);

            const base = slug(name);
            for (let attempt = 0; attempt < 5; attempt++) {
                const id = `${base}-${rand36(8)}`;
                if (!ID_RE.test(id)) return fail('E_ID', 'that name cannot become a folder name');
                const dir = projectDir(rootDir, id);
                try {
                    await fs.mkdir(dir);
                } catch (e) {
                    if (errno(e) === 'EEXIST') continue;
                    return fail('E_ROOT', `the project folder cannot be created (${errno(e)})`);
                }
                const t = clock();
                const meta: ProjectMeta = {
                    id, name, kind, createdAt: t, updatedAt: t,
                    settings: cleanSettings(input?.settings, defaultSettings()), hidden: false,
                };
                const err = await writeMeta(meta);
                if (err) return err;
                return { ok: true as const, project: meta };
            }
            return fail('E_IO', 'a free project folder name could not be found');
        }),

        meta: (id) => guard('meta', async () => {
            const d = await dirOf(id);
            if (!d.ok) return d;
            const meta = await readMeta(d.id);
            if (!meta) return fail('E_MISSING', 'that project has no readable project.json');
            return { ok: true as const, project: meta };
        }),

        update: (id, patch) => guard('update', async () => {
            const d = await dirOf(id);
            if (!d.ok) return d;
            const meta = await readMeta(d.id);
            if (!meta) return fail('E_MISSING', 'that project has no readable project.json');
            const name = typeof patch?.name === 'string' ? patch.name.trim() : '';
            if (patch && 'name' in patch && (!name || name.length > 80)) {
                return fail('E_PATH', 'a project needs a name');
            }
            const next: ProjectMeta = {
                ...meta,
                name: name || meta.name,
                settings: cleanSettings(patch?.settings, meta.settings),
                updatedAt: clock(),
            };
            const err = await writeMeta(next);
            if (err) return err;
            return { ok: true as const, project: next };
        }),

        // Hides the row. DELETES NOTHING: the folder is the user's, and a click in our UI must
        // never be how their sketch disappears.
        forget: (id) => guard('forget', async () => {
            const d = await dirOf(id);
            if (!d.ok) return d;
            const meta = await readMeta(d.id);
            if (!meta) return fail('E_MISSING', 'that project has no readable project.json');
            const err = await writeMeta({ ...meta, hidden: true, updatedAt: clock() });
            if (err) return err;
            return { ok: true as const };
        }),

        listFiles: (id) => guard('listFiles', async () => {
            const d = await dirOf(id);
            if (!d.ok) return d;
            const files = (await walk(d.dir))
                .filter((f) => !isTemp(f.rel) && !isMeta(f.rel))
                .map((f) => ({ path: f.rel, size: f.size, mtime: f.mtime }))
                .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
            return { ok: true as const, files };
        }),

        read: (id, rel) => guard('read', async () => {
            const t = await target(id, rel, TEXT_EXT);
            if (!t.ok) return t;
            const st = await statOr(t.abs);
            if (!st || !st.isFile()) return fail('E_MISSING', 'that file is not there');
            if (st.size > LIM.textMax) return fail('E_SIZE', 'that file is too big to open here');
            const buf = await fs.readFile(t.abs);
            const text = buf.toString('utf8');
            if (Buffer.compare(Buffer.from(text, 'utf8'), buf as Buffer) !== 0) {
                return fail('E_IO', 'that file is not text');
            }
            return { ok: true as const, text, size: st.size, mtime: Math.round(st.mtimeMs) };
        }),

        readBinary: (id, rel) => guard('readBinary', async () => {
            const t = await target(id, rel, BIN_EXT);
            if (!t.ok) return t;
            const st = await statOr(t.abs);
            if (!st || !st.isFile()) return fail('E_MISSING', 'that file is not there');
            if (st.size > LIM.binMax) return fail('E_SIZE', 'that file is too big to open here');
            const buf = await fs.readFile(t.abs);
            return {
                ok: true as const,
                base64: (buf as Buffer).toString('base64'),
                size: st.size,
                mime: MIME[t.ext] || 'application/octet-stream',
            };
        }),

        write: (id, rel, text, o) => guard('write', async () => {
            if (typeof text !== 'string') return fail('E_PATH', 'the text to write must be a string');
            const t = await target(id, rel, TEXT_EXT, true);
            if (!t.ok) return t;
            const buf = Buffer.from(text, 'utf8');
            if (buf.length > LIM.textMax) return fail('E_SIZE', 'that file is too big to save here');
            return writeBuffer(t, buf, o && typeof o.ifMtime === 'number' ? o.ifMtime : undefined);
        }),

        writeBinary: (id, rel, base64) => guard('writeBinary', async () => {
            if (typeof base64 !== 'string') return fail('E_PATH', 'the data to write must be a string');
            const t = await target(id, rel, BIN_EXT, true);
            if (!t.ok) return t;
            const buf = Buffer.from(base64, 'base64');
            if (buf.toString('base64').replace(/=+$/, '') !== base64.replace(/[\r\n]/g, '').replace(/=+$/, '')) {
                return fail('E_PATH', 'that is not valid base64');
            }
            if (buf.length > LIM.binMax) return fail('E_SIZE', 'that file is too big to save here');
            const r = await writeBuffer(t, buf, undefined);
            return r.ok ? { ok: true as const, size: r.size } : r;
        }),

        // FILES ONLY. A directory is never removed — directories appear implicitly from a path's
        // segments and that is the only way they ever change.
        remove: (id, rel) => guard('remove', async () => {
            const t = await target(id, rel, [...TEXT_EXT, ...BIN_EXT], true);
            if (!t.ok) return t;
            if (!takeToken(t.id)) return fail('E_RATE', 'too many writes at once');
            let st;
            try { st = await fs.lstat(t.abs); } catch (e) {
                if (errno(e) === 'ENOENT') return fail('E_MISSING', 'that file is not there');
                return fail('E_IO', 'that file could not be removed');
            }
            if (st.isDirectory()) return fail('E_PATH', 'folders are never removed');
            for (let attempt = 0; ; attempt++) {
                try { await fs.unlink(t.abs); return { ok: true as const }; } catch (e) {
                    const code = errno(e);
                    const retriable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
                    if (retriable && attempt < RENAME_RETRIES) {
                        stats.renameRetries += 1;
                        await sleep(RENAME_BACKOFF_MS);
                        continue;
                    }
                    if (retriable) {
                        stats.lockedGiveUps += 1;
                        return fail('E_LOCKED', 'the file is open in another program');
                    }
                    if (code === 'ENOENT') return fail('E_MISSING', 'that file is not there');
                    return fail('E_IO', 'that file could not be removed');
                }
            }
        }),

        reveal: (id) => guard('reveal', async () => {
            const d = await dirOf(id);
            if (!d.ok) return d;
            shellApi.showItemInFolder(d.dir);
            return { ok: true as const };
        }),

        open: (id) => guard('open', async () => {
            const d = await dirOf(id);
            if (!d.ok) return d;
            const problem = await shellApi.openPath(d.dir);
            if (problem) return fail('E_IO', 'that folder could not be opened');
            return { ok: true as const };
        }),

        path: (id) => guard('path', async () => {
            const d = await dirOf(id);
            if (!d.ok) return d;
            return { ok: true as const, path: d.dir };
        }),
    };

    /** The shared back half of write/writeBinary: rate, quota, optimistic concurrency, atomicity. */
    async function writeBuffer(
        t: { id: string; dir: string; abs: string; segments: string[] },
        buf: Buffer,
        ifMtime: number | undefined,
    ): Promise<Ok<{ size: number; mtime: number }> | Err> {
        if (!takeToken(t.id)) return fail('E_RATE', 'too many writes at once');

        const rel = t.segments.join('/');
        const before = await statOr(t.abs);
        if (typeof ifMtime === 'number') {
            if (!before) return fail('E_CONFLICT', 'that file is gone; reload it before saving');
            if (Math.round(before.mtimeMs) !== ifMtime) {
                return fail('E_CONFLICT', 'that file changed on disk; reload it before saving');
            }
        }

        const u = await usage(t.dir);
        const oldSize = u.byRel.get(rel) || 0;
        if (!u.byRel.has(rel) && u.files + 1 > LIM.files) {
            return fail('E_QUOTA', `a project holds at most ${LIM.files} files`);
        }
        if (u.bytes - oldSize + buf.length > LIM.bytes) {
            return fail('E_QUOTA', 'this project has reached its size limit');
        }

        if (t.segments.length > 1) {
            const parent = path.dirname(t.abs);
            try { await fs.mkdir(parent, { recursive: true }); } catch (e) {
                return fail('E_IO', `that folder could not be created (${errno(e) || 'unknown'})`);
            }
            // The mkdir may have walked through something created behind our back.
            const links = await noLinks(t.id, t.segments.slice(0, -1));
            if (links) return links;
        }
        return atomicWrite(t.abs, buf);
    }

    return api;
}
