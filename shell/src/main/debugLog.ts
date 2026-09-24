// The Computer's debug log (COMPUTER_PLAN addendum KG). The ONE place a recording the renderer
// makes becomes a file on this computer, for a person to hand over with a bug report.
//
// The renderer never names a path. Main picks the folder (<userData>/logs/computer, passed in as
// `dir`) and the file name (computer-YYYY-MM-DD_HH-MM-SS.jsonl, local time). The renderer can
// start a file, append text to the file it started, stop it, ask for a screenshot next to it, and
// ask to be shown it. It cannot read anything back, name another file or delete one.
//
// Limits, so a switch left on (or a compromised renderer) cannot fill the disk:
//   - one append is at most APPEND_MAX of text. A file stops at FILE_MAX: ONE last line says so,
//     and every later append is refused with E_FULL;
//   - the folder keeps at most KEEP recordings. The oldest recordings and their screenshots are
//     removed when a new recording starts;
//   - one recording takes at most MARK_MAX screenshots.
//
// Nothing here throws across IPC: every call resolves to {ok:true, ...} or {ok:false, code, message}.
import * as fs from 'node:fs';
import * as path from 'node:path';

export const APPEND_MAX = 2 * 1024 * 1024;
export const FILE_MAX = 25 * 1024 * 1024;
export const KEEP = 15;
export const MARK_MAX = 40;
/** Recordings holding a marked bug are kept longer: up to this many, beside the KEEP others. */
export const MARKED_KEEP = 30;
/** A header is one small JSON line; the footer counts against FILE_MAX like any append. */
export const HEADER_MAX = 64 * 1024;

const PREFIX = 'computer-';
const EXT = '.jsonl';
const NAME_RE = /^computer-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/;

export type LogErrCode = 'E_ARGS' | 'E_NONE' | 'E_FULL' | 'E_IO';
export type LogErr = { ok: false; code: LogErrCode; message: string };

export interface DebugLogDeps {
    /** The folder the recordings live in. Created on the first start(). */
    dir: string;
    /** Facts only main knows (versions, OS), written as the file's second line. */
    facts?: () => Record<string, unknown>;
    /** A PNG of the window, or null when there is nothing to capture (a hidden window). */
    capture?: () => Promise<Buffer | null>;
    shellApi: { showItemInFolder(p: string): void; openPath(p: string): Promise<string> };
    now?: () => Date;
}

const two = (n: number) => String(n).padStart(2, '0');

/** `2026-09-24_21-15-03`, local time — sorts by name in the order the recordings were made. */
export function stampOf(d: Date): string {
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
}

const err = (code: LogErrCode, message: string): LogErr => ({ ok: false, code, message });

/** [stamp, suffix] of a recording's name: `computer-<stamp>.jsonl` is suffix 1, `-2`… follow. */
function orderOf(name: string): [string, number] {
    // The stamp's shape is exact: a looser pattern reads an unsuffixed name's seconds ("-00") as a suffix.
    const m = /^computer-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(?:-(\d+))?\.jsonl$/.exec(name);
    return m ? [m[1], m[2] ? Number(m[2]) : 1] : [name, 0];
}
const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : String(e));

export function createDebugLog(deps: DebugLogDeps) {
    const now = deps.now || (() => new Date());
    let cur: { file: string; name: string; bytes: number; full: boolean; marks: number } | null = null;
    let last: string | null = null;
    // Calls are serialised: an append that arrives while start() is still creating the file must
    // land in that file, after the header, and never before it.
    let chain: Promise<unknown> = Promise.resolve();
    function serial<T>(fn: () => Promise<T>): Promise<T> {
        const p = chain.then(fn, fn);
        chain = p.catch(() => undefined);
        return p;
    }

    // The same clock as the renderer's lines (local HH:MM:SS.mmm); the full date is in log.main.
    const clock = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    const line = (o: Record<string, unknown>) => JSON.stringify({ ts: clock(now()), ...o }) + '\n';

    /** Recordings in the folder, oldest first: by stamp, then by the numeric -n suffix (a plain
     * text sort puts -10 before -2 and both before the unsuffixed first file of that second). */
    function recordings(): string[] {
        try {
            return fs.readdirSync(deps.dir).filter((n) => NAME_RE.test(n)).sort((a, b) => {
                const [sa, na] = orderOf(a);
                const [sb, nb] = orderOf(b);
                return sa < sb ? -1 : sa > sb ? 1 : na - nb;
            });
        } catch {
            return [];
        }
    }

    /** Remove recordings so the one being started makes KEEP unmarked ones. A recording with a
     * marked bug is spared until MARKED_KEEP of those exist: fifteen relaunches with the switch on
     * must not silently delete the file that holds the bug. */
    function prune(): void {
        let files: string[] = [];
        try { files = fs.readdirSync(deps.dir); } catch { return; }
        const stemOf = (name: string) => name.slice(0, -EXT.length);
        const marked = (name: string) => files.some((f) => f.startsWith(`${stemOf(name)}-mark-`) && f.endsWith('.png'));
        const all = recordings();
        const plain = all.filter((n) => !marked(n));
        const withMarks = all.filter((n) => marked(n));
        const doomed = plain.slice(0, Math.max(0, plain.length - (KEEP - 1)))
            .concat(withMarks.slice(0, Math.max(0, withMarks.length - MARKED_KEEP)));
        for (const name of doomed) {
            const stem = stemOf(name);
            try { fs.rmSync(path.join(deps.dir, name), { force: true }); } catch { /* next start tries again */ }
            for (const f of files) {
                if (!f.startsWith(`${stem}-mark-`) || !f.endsWith('.png')) continue;
                try { fs.rmSync(path.join(deps.dir, f), { force: true }); } catch { /* next start tries again */ }
            }
        }
    }

    function closeSync(why: string): void {
        if (!cur) return;
        try { fs.appendFileSync(cur.file, line({ k: 'log.end', why })); } catch { /* the file is gone */ }
        cur = null;
    }

    return {
        dir: () => deps.dir,

        start(header: unknown) {
            return serial(async () => {
                if (typeof header !== 'string' || !header.trim() || Buffer.byteLength(header) > HEADER_MAX) return err('E_ARGS', 'header must be a non-empty string of at most 64 KB');
                try {
                    closeSync('restarted');
                    fs.mkdirSync(deps.dir, { recursive: true });
                    prune();
                    const stamp = stampOf(now());
                    // Above the HIGHEST suffix this second already has, never into a gap a prune
                    // left: a reused lower name would sort as the oldest and be pruned next.
                    const taken = recordings().map(orderOf).filter(([st]) => st === stamp).map(([, n]) => n);
                    const next = taken.length ? Math.max(...taken) + 1 : 1;
                    let name = next === 1 ? `${PREFIX}${stamp}${EXT}` : `${PREFIX}${stamp}-${next}${EXT}`;
                    for (let i = next + 1; fs.existsSync(path.join(deps.dir, name)); i++) name = `${PREFIX}${stamp}-${i}${EXT}`;
                    const file = path.join(deps.dir, name);
                    const head = header.endsWith('\n') ? header : `${header}\n`;
                    const facts = line({ k: 'log.main', date: now().toISOString(), ...(deps.facts ? deps.facts() : {}) });
                    fs.writeFileSync(file, head + facts, { flag: 'wx' });
                    cur = { file, name, bytes: Buffer.byteLength(head + facts), full: false, marks: 0 };
                    last = file;
                    return { ok: true as const, name, path: file };
                } catch (e) {
                    cur = null;
                    return err('E_IO', errText(e));
                }
            });
        },

        append(text: unknown) {
            return serial(async () => {
                if (typeof text !== 'string' || text.length > APPEND_MAX) return err('E_ARGS', 'text must be a string of at most 2 MB');
                if (!cur) return err('E_NONE', 'no recording is open');
                if (cur.full) return err('E_FULL', 'the log reached its size limit');
                if (!text) return { ok: true as const, bytes: cur.bytes };
                const body = text.endsWith('\n') ? text : `${text}\n`;
                const n = Buffer.byteLength(body);
                try {
                    if (cur.bytes + n > FILE_MAX) {
                        fs.appendFileSync(cur.file, line({ k: 'log.full', limit: FILE_MAX }));
                        cur.full = true;
                        return err('E_FULL', 'the log reached its size limit');
                    }
                    // SYNCHRONOUS (≤ 2 MB): a note() from a crash can then never land mid-line.
                    fs.appendFileSync(cur.file, body);
                    cur.bytes += n;
                    return { ok: true as const, bytes: cur.bytes };
                } catch (e) {
                    return err('E_IO', errText(e));
                }
            });
        },

        stop(footer?: unknown) {
            return serial(async () => {
                if (!cur) return { ok: true as const, name: null, path: null, bytes: 0 };
                const done = cur;
                try {
                    const text = typeof footer === 'string' && footer ? (footer.endsWith('\n') ? footer : `${footer}\n`) : '';
                    if (text && !done.full && done.bytes + Buffer.byteLength(text) <= FILE_MAX) {
                        fs.appendFileSync(done.file, text);
                    }
                } catch { /* the footer is a courtesy */ }
                closeSync('stopped');
                const bytes = (() => { try { return fs.statSync(done.file).size; } catch { return done.bytes; } })();
                return { ok: true as const, name: done.name, path: done.file, bytes };
            });
        },

        /** A screenshot of the window, saved next to the recording as <stem>-mark-<n>.png. */
        mark() {
            return serial(async () => {
                if (!cur) return err('E_NONE', 'no recording is open');
                if (cur.marks >= MARK_MAX) return { ok: true as const, png: null, capped: true };
                const target = cur;
                try {
                    const png = deps.capture ? await deps.capture() : null;
                    if (!png || !png.length) return { ok: true as const, png: null };
                    target.marks += 1;
                    const name = `${target.name.slice(0, -EXT.length)}-mark-${target.marks}.png`;
                    fs.writeFileSync(path.join(deps.dir, name), png);
                    return { ok: true as const, png: name };
                } catch (e) {
                    return err('E_IO', errText(e));
                }
            });
        },

        /** Show the open recording (or the newest one) in the file manager; the folder when there is none. */
        reveal() {
            return serial(async () => {
                try {
                    const all = recordings();
                    const newest = all.length ? path.join(deps.dir, all[all.length - 1]) : null;
                    const target = [cur && cur.file, last, newest].find((p) => !!p && fs.existsSync(p));
                    if (target) {
                        deps.shellApi.showItemInFolder(target);
                        return { ok: true as const, path: target };
                    }
                    fs.mkdirSync(deps.dir, { recursive: true });
                    const why = await deps.shellApi.openPath(deps.dir);
                    return why ? err('E_IO', why) : { ok: true as const, path: deps.dir };
                } catch (e) {
                    return err('E_IO', errText(e));
                }
            });
        },

        status() {
            return Promise.resolve({
                ok: true as const,
                active: !!cur,
                name: cur ? cur.name : null,
                path: cur ? cur.file : last,
                bytes: cur ? cur.bytes : 0,
                full: cur ? cur.full : false,
                dir: deps.dir,
            });
        },

        /**
         * A line only main can write: the renderer crashed or hung. SYNCHRONOUS on purpose, because
         * the process may be about to end. Writes nothing when no recording is open.
         */
        note(o: Record<string, unknown>): void {
            if (!cur || cur.full) return;
            try {
                const text = line(o);
                fs.appendFileSync(cur.file, text);
                cur.bytes += Buffer.byteLength(text);
            } catch { /* nothing to report it to */ }
        },

        /** The app is quitting: close the file with a last line. */
        close(why: string): void { closeSync(why); },
    };
}

export type DebugLog = ReturnType<typeof createDebugLog>;
