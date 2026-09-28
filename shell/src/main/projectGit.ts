// A project's history for the IDE (docs/IDE_PLAN.md; owner, 2026-09-28: isomorphic-git — most client PCs have no Git).
// One repository per project folder, a commit per agent reply that changed files and per person's Save, the log, a
// commit's changes, and "go back to here" as a NEW commit that makes the files what they were then — history is
// never rewritten, so every step stays recoverable. Only files under the project folder are ever written.
import * as fs from 'node:fs';
import * as path from 'node:path';
import git from 'isomorphic-git';

export const AGENT = { name: 'LOL Vibe agent', email: 'agent@llmonlan.local' };
export const PERSON = { name: 'You', email: 'you@llmonlan.local' };
/** A file larger than this, or with a NUL byte, is shown as "binary" rather than as text. */
export const TEXT_CAP = 200 * 1024;
export const OID_RE = /^[0-9a-f]{40}$/;

export interface Commit { oid: string; message: string; author: string; time: number }
export interface FileChange { path: string; before: string | null; after: string | null; binary: boolean }

const inside = (dir: string, rel: string) => {
    const abs = path.resolve(dir, rel);
    return abs.startsWith(path.resolve(dir) + path.sep) ? abs : null;
};

async function ensureRepo(dir: string): Promise<void> {
    if (!fs.existsSync(path.join(dir, '.git'))) await git.init({ fs, dir, defaultBranch: 'main' });
}

/** path → blob oid of the last commit's files (empty before the first commit). */
async function headOids(dir: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    try {
        await git.walk({
            fs, dir, trees: [git.TREE({ ref: 'HEAD' })],
            map: async (filepath, [entry]) => {
                if (filepath === '.' || !entry) return undefined;
                if ((await entry.type()) === 'blob') out.set(filepath, await entry.oid());
                return true;
            },
        });
    } catch { /* no commit yet */ }
    return out;
}

/**
 * Stage everything (new, changed, deleted) and commit. Returns the new commit's oid, or null when nothing changed.
 * A change is decided by CONTENT (each file hashed as a git blob, compared with the last commit): the status
 * matrix trusts size + mtime, and an edit of the same size in the same second (a "1" → "2" right after a commit —
 * the agent does that) read as unchanged. The status matrix only lists the files (it honours .gitignore).
 */
export async function commitAll(dir: string, message: string, author = PERSON): Promise<string | null> {
    await ensureRepo(dir);
    const head = await headOids(dir);
    const add: string[] = [];
    const remove: string[] = [];
    for (const [filepath, , work] of await git.statusMatrix({ fs, dir })) {
        if (work === 0) { if (head.has(filepath)) remove.push(filepath); continue; }
        const { oid } = await git.hashBlob({ object: fs.readFileSync(path.join(dir, filepath)) });
        if (head.get(filepath) !== oid) add.push(filepath);
    }
    if (!add.length && !remove.length) return null;
    for (const filepath of add) await git.add({ fs, dir, filepath });
    for (const filepath of remove) await git.remove({ fs, dir, filepath });
    const msg = String(message || 'Save').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Save';
    return git.commit({ fs, dir, message: msg, author: { ...author, timestamp: Math.floor(Date.now() / 1000) } });
}

/** The newest commits first ([] before the first one). */
export async function history(dir: string, depth = 100): Promise<Commit[]> {
    if (!fs.existsSync(path.join(dir, '.git'))) return [];
    let entries: Awaited<ReturnType<typeof git.log>> = [];
    try { entries = await git.log({ fs, dir, depth }); } catch { return []; }   // no commit yet
    return entries.map((e) => ({
        oid: e.oid, message: e.commit.message.trim(), author: e.commit.author.name, time: e.commit.author.timestamp * 1000,
    }));
}

function asText(bytes: Uint8Array | undefined | null): { text: string | null; binary: boolean } {
    if (!bytes) return { text: null, binary: false };
    const head = bytes.subarray(0, Math.min(bytes.length, 8000));
    if (bytes.length > TEXT_CAP || head.includes(0)) return { text: null, binary: true };
    return { text: Buffer.from(bytes).toString('utf8'), binary: false };
}

/** Every file of `oid`'s tree: path → its bytes. */
async function treeFiles(dir: string, oid: string): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    await git.walk({
        fs, dir, trees: [git.TREE({ ref: oid })],
        map: async (filepath, [entry]) => {
            if (filepath === '.' || !entry) return undefined;
            if ((await entry.type()) !== 'blob') return true;
            const bytes = await entry.content();
            if (bytes) out.set(filepath, bytes);
            return true;
        },
    });
    return out;
}

/** What one commit changed, file by file (texts for the diff view; binary files named only). */
export async function changes(dir: string, oid: string): Promise<FileChange[]> {
    const { commit } = await git.readCommit({ fs, dir, oid });
    const after = await treeFiles(dir, oid);
    const before = commit.parent[0] ? await treeFiles(dir, commit.parent[0]) : new Map<string, Uint8Array>();
    const out: FileChange[] = [];
    for (const p of [...new Set([...before.keys(), ...after.keys()])].sort()) {
        const a = before.get(p);
        const b = after.get(p);
        if (a && b && Buffer.from(a).equals(Buffer.from(b))) continue;
        const x = asText(a);
        const y = asText(b);
        out.push({ path: p, before: x.text, after: y.text, binary: x.binary || y.binary });
    }
    return out;
}

/**
 * Make the project's files what they were at `oid` — tracked files only, so a file never committed is left alone —
 * and record that as a new commit. Returns the new oid, or null when the files already match.
 */
export async function restore(dir: string, oid: string): Promise<string | null> {
    const { commit } = await git.readCommit({ fs, dir, oid });
    const label = commit.message.split('\n')[0].trim();
    const target = await treeFiles(dir, oid);
    for (const [rel, bytes] of target) {
        const abs = inside(dir, rel);
        if (!abs) continue;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, bytes);
    }
    const rows = await git.statusMatrix({ fs, dir });
    for (const [rel, head] of rows) {
        if (head !== 1 || target.has(rel)) continue;
        const abs = inside(dir, rel);
        if (abs) fs.rmSync(abs, { force: true });
    }
    return commitAll(dir, `Back to: ${label}`, PERSON);
}
