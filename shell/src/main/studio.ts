// The IDE's coding agent (docs/IDE_PLAN.md): DeepSeek Harness (dsh) driven over its SDK — JSON-RPC 2.0, one message
// per line on stdio — from the main process, on dsh's OWN Node (its native addon refuses Electron 42; probe
// 2026-09-28), with a profile patch written from the current farm before every start.
//
//   - One runtime per window. A different project, model, farm or output cap restarts it.
//   - A dsh session lives as long as its process (the SDK has no resume): a thread's FIRST prompt in a runtime
//     carries the renderer's recap, and the files on disk are the real state.
//   - Stop = kill the process tree (the SDK has no cancel either).
//   - Nothing leaves but the farm's /v1: the patch turns off every DeepSeek cloud row, web fetch/search, the
//     shell, jobs, goals, subagents and workflows; the env turns telemetry off and hands dsh no other secret.
//   - Preview: one static server per project on 127.0.0.1 (a Host check against DNS rebinding), GET only, the
//     project folder only.
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { killTree } from './util';
import { projectDir, resolveIn, validateId } from './projectsPath';
import {
    AGENT, PERSON, OID_RE, Commit, FileChange, commitAll, history, changes, restore, getRemote, setRemote, push, pull,
} from './projectGit';

/** The pinned upstream (the runtime download fetches exactly this; see docs/IDE_PLAN.md §3.5). */
export const DSH_VERSION = '0.1.7-rc.2';

export type StudioErrCode = 'E_ARGS' | 'E_FARM' | 'E_RUNTIME' | 'E_PROJECT' | 'E_BUSY' | 'E_START';
export type StudioErr = { ok: false; code: StudioErrCode; message: string };
const err = (code: StudioErrCode, message: string): StudioErr => ({ ok: false, code, message });

export interface StudioDiff { path: string; oldText: string; newText: string }
/** What the renderer is told about a turn: small, path-relative, never the raw event (those carry whole files). */
export type StudioRecord =
    | { kind: 'step'; text: string; reasoning: string; stopReason: string | null; outTokens: number | null }
    | { kind: 'call'; callId: string; name: string; target: string }
    | { kind: 'result'; callId: string; ok: boolean; created: boolean; diffs: StudioDiff[]; error: string | null }
    | { kind: 'end'; reason: string };

export interface StudioFarm { endpoint: string; key: string | null; ctxPerSlot: number | null }
export interface StudioRuntime { node: string; bin: string }
export interface StudioEmit { turnId: string; rec?: StudioRecord; done?: { reason: string; error?: string } }

const TEXT_CAP = 20000;   // per diff side: the Changes view shows an edit, not a whole file
const clip = (s: unknown, n: number): string => (typeof s === 'string' ? (s.length > n ? s.slice(0, n) + '…' : s) : '');

/** The profile patch (YAML; every string written as a JSON string, which YAML reads as-is). */
export function buildPatch(o: { baseUrl: string; model: string; contextWindow: number; skillsDir: string }): string {
    const q = (s: string) => JSON.stringify(s);
    const off = [
        'tool-pwsh', 'tool-bash', 'tool-jobs', 'tool-goal', 'tool-ralph', 'command-goal', 'goal-round-driver',
        'tool-subagent', 'tool-subagent-fork', 'tool-subagent-control', 'tool-subagent-list-agents',
        'tool-workflow', 'workflow-ptc', 'tool-web', 'web-search-deepseek', 'web-fetch-http', 'web',
        'session-telemetry-otel', 'session-log-deepseek', 'plugin-package-inventory-deepseek',
        'llm-deepseek', 'llm-deepseek-account', 'deepseek-account',
    ];
    return [
        '# Written by LlmOnLan before every start of its coding agent (src/main/studio.ts). Edits are overwritten.',
        '- id: llm-pi-ai',
        '  config:',
        '    providers:',
        '      lolfarm:',
        '        displayName: LlmOnLan farm',
        '        api: openai-completions',
        `        baseURL: ${q(o.baseUrl)}`,
        '        apiKeyEnv: LOL_FARM_KEY',
        '        models:',
        `          - id: ${q(o.model)}`,
        `            contextWindow: ${Math.max(4096, Math.floor(o.contextWindow))}`,
        '- id: agent-default-model',
        '  config:',
        '    provider: lolfarm',
        `    model: ${q(o.model)}`,
        '- id: skill-filesystem',
        '  config:',
        '    includeDefaultRoots: false',
        `    customSkillDirs: [${q(o.skillsDir)}]`,
        ...off.map((id) => `- { id: ${id}, disabled: true }`),
        '',
    ].join('\n');
}

/** A path as the project sees it: relative, forward slashes; outside the project it stays as given. */
export function relPath(p: unknown, dir: string): string {
    if (typeof p !== 'string' || !p) return '';
    if (!path.isAbsolute(p)) return p.split(path.sep).join('/').replace(/^\.\//, '');
    const rel = path.relative(dir, p);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : p;
}

/** One dsh session event → the record the renderer gets, or null for the ones it has no use for. */
export function projectEvent(ev: any, dir: string): StudioRecord | null {
    const d = ev && ev.data;
    if (!d) return null;
    switch (ev.type) {
        case 'assistant/message': {
            const blocks: any[] = (d.message && Array.isArray(d.message.content)) ? d.message.content : [];
            const join = (type: string) => blocks.filter((b) => b && b.type === type && typeof b.text === 'string').map((b) => b.text).join('\n\n');
            const resp = d.message && d.message.source && d.message.source.replayState && d.message.source.replayState.response;
            return {
                kind: 'step', text: join('text'), reasoning: join('reasoning'),
                stopReason: resp && typeof resp.stopReason === 'string' ? resp.stopReason : null,
                outTokens: d.usage && Number.isFinite(d.usage.outputTokens) ? d.usage.outputTokens : null,
            };
        }
        case 'tool/call': {
            let args: any = {};
            try { args = JSON.parse(d.arguments || '{}') || {}; } catch { /* a garbled call still shows its name */ }
            const target = args.file_path != null ? relPath(args.file_path, dir)
                : args.pattern != null ? clip(String(args.pattern), 120)
                    : args.name != null ? clip(String(args.name), 120) : '';
            return { kind: 'call', callId: String(d.callId || ''), name: String(d.name || ''), target };
        }
        case 'tool/result': {
            const m = d.message || {};
            const text = Array.isArray(m.content) ? m.content.map((c: any) => (c && typeof c.text === 'string' ? c.text : '')).join('') : '';
            const meta = d.meta || {};
            const diffs: StudioDiff[] = Array.isArray(meta.diffs) ? meta.diffs.slice(0, 20).map((x: any) => ({
                path: relPath(x && x.path, dir), oldText: clip(x && x.oldText, TEXT_CAP), newText: clip(x && x.newText, TEXT_CAP),
            })) : [];
            return {
                kind: 'result', callId: String(m.toolCallId || (m.source && m.source.callId) || ''), ok: m.isError !== true,
                created: meta.operation === 'create', diffs,
                error: m.isError === true ? clip(text.split(dir).join('.'), 300) : null,
            };
        }
        case 'turn/end':
            return { kind: 'end', reason: String((d.reason && d.reason.kind) || 'completed') };
        default:
            return null;
    }
}

/** Where the runtime is: LOL_DSH_DIR (dev) or <userData>/dsh-runtime, with its own Node (or LOL_DSH_NODE). */
export function resolveRuntime(env: NodeJS.ProcessEnv, userData: string): StudioRuntime | null {
    const dir = env.LOL_DSH_DIR || path.join(userData, 'dsh-runtime');
    const bin = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (!fs.existsSync(bin)) return null;
    const own = path.join(dir, 'node', process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'));
    const node = env.LOL_DSH_NODE || (fs.existsSync(own) ? own : '');
    return node ? { node, bin } : null;
}

/** The env dsh starts with: what an OS process needs, and ours — never the shell's other secrets. */
export function runtimeEnv(env: NodeJS.ProcessEnv, o: { home: string; key: string }): NodeJS.ProcessEnv {
    const keep = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
        'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'LANG', 'LC_ALL', 'TZ'];
    const out: NodeJS.ProcessEnv = {};
    for (const k of keep) if (env[k] != null) out[k] = env[k];
    return {
        ...out,
        DSH_HOME: o.home,
        DSH_AGENTS_HOME: path.join(o.home, 'agents'),
        LOL_FARM_KEY: o.key,
        DSH_TELEMETRY_DISABLED: '1',
        DSH_MAX_TOKENS_AS_SUCCESS: 'false',
    };
}

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.glsl': 'text/plain; charset=utf-8',
    '.frag': 'text/plain; charset=utf-8', '.vert': 'text/plain; charset=utf-8',
};

interface Rt {
    child: ChildProcess; key: string; buf: string; stderr: string; dead: boolean;
    next: number; pending: Map<number, (m: any) => void>; sessions: Map<string, string>;
}
interface Turn { id: string; sessionId: string; running: boolean; end: string | null; dir: string; prompt: string }

export interface StudioDeps {
    dataDir: () => string;
    projectsRoot: () => string;
    farm: () => StudioFarm | null;
    runtime: () => StudioRuntime | null;
    emit: (m: StudioEmit) => void;
    /** Sharing on the LAN: where the share listens (tests keep it on 127.0.0.1: no firewall prompt) and which
     *  addresses it answers to (default: this machine's non-internal IPv4 addresses). */
    lan?: { host?: string; addresses?: () => string[] };
    /** Tokens for git remotes, per host, kept by main (safeStorage) — never handed to the page. */
    tokens?: { get(host: string): string | null; set(host: string, token: string | null): boolean; safe(): boolean };
    /** A skills folder to copy into <DATA_DIR>/skills the first time (ponytail, with its licence). */
    seedSkills?: string;
    env?: NodeJS.ProcessEnv;
}

export function createStudio(deps: StudioDeps) {
    let rt: Rt | null = null;
    let turn: Turn | null = null;
    const servers = new Map<string, { server: http.Server; url: string }>();
    const shared = new Map<string, { server: http.Server; urls: () => string[] }>();

    const homeOf = () => path.join(deps.dataDir(), 'lol-studio', 'dsh');
    const skillsOf = () => path.join(deps.dataDir(), 'skills');

    /** The turn is over: what it changed becomes one commit (projectGit.ts), THEN the page hears it is done — so the
     *  History tab it refreshes always finds the commit. A commit that fails never holds the turn open. */
    function finish(reason: string, error?: string): void {
        if (!turn) return;
        const t = turn;
        turn = null;
        const how = reason === 'completed' ? '' : ` (${reason})`;
        const first = t.prompt.split('\n').map((l) => l.trim()).find(Boolean) || 'a reply';
        void commitAll(t.dir, `Agent${how}: ${first}`, AGENT)
            .catch((e) => { console.warn('[studio] could not record the reply in the project history:', (e as Error).message); })
            .finally(() => deps.emit({ turnId: t.id, done: error ? { reason, error } : { reason } }));
    }

    /** Push or pull, with the sentence a person can act on when it fails. */
    async function sync(projectId: string, how: 'push' | 'pull'): Promise<{ ok: true } | StudioErr> {
        const d = dirOf(projectId);
        if ('ok' in d) return d;
        if (turn && turn.dir === d.dir) return err('E_BUSY', 'The coding agent is working in this project. Stop it first.');
        const now = await getRemote(d.dir);
        if (!now) return err('E_ARGS', 'Save the repository address first.');
        const host = new URL(now).host;
        const token = deps.tokens ? deps.tokens.get(host) : null;
        try {
            await (how === 'push' ? push(d.dir, token) : pull(d.dir, token));
            return { ok: true };
        } catch (e) {
            const x = e as { code?: string; data?: { statusCode?: number }; message?: string };
            const status = x.data && x.data.statusCode;
            if (x.code === 'UserCanceledError' || status === 401 || status === 403) {
                return err('E_RUNTIME', token ? `${host} refused the token (or it may not write to this repository).` : `${host} needs a token: save one first.`);
            }
            if (x.code === 'FastForwardError' || x.code === 'MergeNotSupportedError' || x.code === 'PushRejectedError') {
                return err('E_RUNTIME', how === 'pull'
                    ? `${host} and this copy both have changes the other lacks, so the pull was refused (it only fast-forwards). Your work is kept and committed here.`
                    : `${host} has changes this copy does not have: pull first.`);
            }
            if (x.code === 'HttpError' && status === 404) return err('E_RUNTIME', `${host} has no repository at that address.`);
            return err('E_RUNTIME', `Could not ${how} (${host}): ${String(x.message || e).slice(0, 200)}`);
        }
    }

    /** The project folder of a valid id, or an error. */
    function dirOf(projectId: string): { dir: string } | StudioErr {
        const idv = validateId(projectId);
        if (!idv.ok) return err('E_ARGS', 'bad arguments');
        const dir = projectDir(deps.projectsRoot(), idv.id);
        return fs.existsSync(dir) ? { dir } : err('E_PROJECT', 'That project folder is gone.');
    }

    function onLine(line: string): void {
        let m: any;
        try { m = JSON.parse(line); } catch { return; }
        if (!rt) return;
        if (m.id != null && !m.method) {
            const res = rt.pending.get(m.id);
            if (res) { rt.pending.delete(m.id); res(m); }
            return;
        }
        const p = m.params || {};
        if (!turn || p.sessionId !== turn.sessionId) return;
        if (m.method === 'session.event') {
            const rec = projectEvent(p.event, turn.dir);
            if (!rec) return;
            if (rec.kind === 'end') turn.end = rec.reason;
            deps.emit({ turnId: turn.id, rec });
        } else if (m.method === 'session.status') {
            if (p.status === 'running') turn.running = true;
            else if (p.status === 'idle' && turn.running) finish(turn.end || 'completed');
        }
    }

    function call(r: Rt, method: string, params: unknown, ms: number): Promise<any> {
        return new Promise((resolve) => {
            const id = r.next++;
            const timer = setTimeout(() => { r.pending.delete(id); resolve({ error: { message: `no answer to ${method} in ${Math.round(ms / 1000)} s` } }); }, ms);
            r.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
            try { r.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); } catch { /* exit handles it */ }
        });
    }

    async function stopRuntime(): Promise<void> {
        const r = rt;
        rt = null;
        if (!r) return;
        r.dead = true;
        for (const res of r.pending.values()) res({ error: { message: 'stopped' } });
        r.pending.clear();
        await killTree(r.child.pid);
    }

    /** Each bundled skill a person does not have yet (a new one reaches an old install too); theirs are never touched. */
    function seed(): void {
        const dir = skillsOf();
        fs.mkdirSync(dir, { recursive: true });
        if (!deps.seedSkills || !fs.existsSync(deps.seedSkills)) return;
        for (const name of fs.readdirSync(deps.seedSkills)) {
            const to = path.join(dir, name);
            if (!fs.existsSync(to)) fs.cpSync(path.join(deps.seedSkills, name), to, { recursive: true });
        }
    }

    async function startRuntime(o: { key: string; dir: string; model: string; maxTokens: number; farm: StudioFarm; runtime: StudioRuntime }): Promise<Rt | StudioErr> {
        const home = homeOf();
        try {
            seed();
            const prof = path.join(home, 'profiles', 'sdk');
            fs.mkdirSync(prof, { recursive: true });
            const patch = buildPatch({ baseUrl: o.farm.endpoint, model: o.model, contextWindow: o.farm.ctxPerSlot || 32768, skillsDir: skillsOf() });
            fs.writeFileSync(path.join(prof, 'cordis.patch.yml.tmp'), patch);
            fs.renameSync(path.join(prof, 'cordis.patch.yml.tmp'), path.join(prof, 'cordis.patch.yml'));
        } catch (e) {
            return err('E_START', `Could not prepare the coding agent's folder: ${(e as Error).message}`);
        }
        const child = spawn(o.runtime.node, [o.runtime.bin, '--profile', 'sdk'], {
            cwd: o.dir,
            env: runtimeEnv(deps.env || process.env, { home, key: o.farm.key || 'sk-lol-lan' }),
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            detached: process.platform !== 'win32',   // its own group, so killTree takes its children too
        });
        const r: Rt = { child, key: o.key, buf: '', stderr: '', dead: false, next: 1, pending: new Map(), sessions: new Map() };
        child.stdout!.setEncoding('utf8');
        child.stdout!.on('data', (d: string) => {
            r.buf += d;
            let at;
            while ((at = r.buf.indexOf('\n')) >= 0) {
                const line = r.buf.slice(0, at).trim();
                r.buf = r.buf.slice(at + 1);
                if (line && rt === r) onLine(line);
            }
        });
        child.stderr!.setEncoding('utf8');
        child.stderr!.on('data', (d: string) => { r.stderr = (r.stderr + d).slice(-4000); });
        const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
        child.on('error', () => { /* 'exit' or the initialize timeout reports it */ });
        void exited.then(() => {
            if (r.dead) return;
            r.dead = true;
            for (const res of r.pending.values()) res({ error: { message: 'the coding agent stopped' } });
            r.pending.clear();
            if (rt === r) { rt = null; finish('error', lastLine(r.stderr) || 'The coding agent stopped.'); }
        });
        rt = r;
        const init = await call(r, 'initialize', { cwd: o.dir, provider: 'lolfarm', model: o.model, maxTokens: o.maxTokens }, 60000);
        if (init.error) {
            const why = lastLine(r.stderr) || init.error.message || 'no answer';
            await stopRuntime();
            return err('E_START', `The coding agent did not start: ${why}`);
        }
        return r;
    }

    return {
        /** Send one prompt; the turn's records and its end arrive through deps.emit. */
        async prompt(o: { projectId: string; threadId: string; model: string; text: string; recap?: string; maxTokens?: number; turnId?: string }):
            Promise<{ ok: true; turnId: string; fresh: boolean } | StudioErr> {
            const idv = validateId(o.projectId);
            if (!idv.ok || !o.threadId || !o.model || !o.text) return err('E_ARGS', 'bad arguments');
            const dir = projectDir(deps.projectsRoot(), idv.id);
            if (!fs.existsSync(dir)) return err('E_PROJECT', 'That project folder is gone.');
            const farm = deps.farm();
            if (!farm) return err('E_FARM', 'No farm is connected, so there is no model to write the code.');
            const runtime = deps.runtime();
            if (!runtime) return err('E_RUNTIME', 'The coding agent is not installed on this computer yet.');
            if (turn) return err('E_BUSY', 'The coding agent is already working. Stop it first.');
            const maxTokens = Math.min(65536, Math.max(512, Math.floor(Number(o.maxTokens) || 8192)));
            const key = JSON.stringify([idv.id, o.model, maxTokens, farm.endpoint, farm.key, farm.ctxPerSlot, runtime.bin]);
            if (!rt || rt.dead || rt.key !== key) {
                await stopRuntime();
                const started = await startRuntime({ key, dir, model: o.model, maxTokens, farm, runtime });
                if ('ok' in started) return started;
            }
            const r = rt!;
            let sessionId = r.sessions.get(o.threadId);
            const fresh = !sessionId;
            if (!sessionId) {
                sessionId = `lol-${o.threadId.slice(0, 40)}-${Date.now().toString(36)}`;
                r.sessions.set(o.threadId, sessionId);
            }
            const text = fresh && o.recap ? `${o.recap}\n\n${o.text}` : o.text;
            // The page names the turn when it can, so it listens BEFORE the first record (they can beat this answer).
            const named = typeof o.turnId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(o.turnId) ? o.turnId : '';
            turn = { id: named || randomBytes(8).toString('hex'), sessionId, running: false, end: null, dir, prompt: o.text };
            const id = turn.id;
            const res = await call(r, 'session/prompt', { sessionId, contentBlocks: [{ type: 'text', text }] }, 30000);
            if (res.error) {
                if (turn && turn.id === id) turn = null;
                return err('E_START', `The coding agent refused the prompt: ${res.error.message || 'no reason given'}`);
            }
            return { ok: true, turnId: id, fresh };
        },

        /** Stop the turn: the process goes (the SDK cannot cancel), the next prompt starts a fresh one. */
        async stop(): Promise<{ ok: true }> {
            finish('stopped');
            await stopRuntime();
            return { ok: true };
        },

        status(): { ok: true; installed: boolean; running: boolean; version: string } {
            return { ok: true, installed: !!deps.runtime(), running: !!turn, version: DSH_VERSION };
        },

        /** The project on http://127.0.0.1:<port>/ — the Preview, and "open it in a browser". */
        /** `lan`: the addresses the project is shared on right now ([] when it is not — the default). */
        async serve(projectId: string): Promise<{ ok: true; url: string; lan: string[] } | StudioErr> {
            const idv = validateId(projectId);
            if (!idv.ok) return err('E_ARGS', 'bad arguments');
            const root = deps.projectsRoot();
            if (!fs.existsSync(projectDir(root, idv.id))) return err('E_PROJECT', 'That project folder is gone.');
            const lan = shared.has(idv.id) ? shared.get(idv.id)!.urls() : [];
            const had = servers.get(idv.id);
            if (had) return { ok: true, url: had.url, lan };
            const { server, port } = await fileServer(root, idv.id, '127.0.0.1', () => []);
            const url = `http://127.0.0.1:${port}/`;
            servers.set(idv.id, { server, url });
            return { ok: true, url, lan };
        },

        /**
         * Share a project on the LAN (owner, 2026-09-28: a per-project toggle, off by default, never remembered): a
         * second listener on every interface, read-only like the Preview's, that answers to this machine's own LAN
         * addresses. Off closes it; a restart forgets it. The first share may raise the OS firewall prompt.
         */
        async share(projectId: string, on: boolean): Promise<{ ok: true; urls: string[] } | StudioErr> {
            const idv = validateId(projectId);
            if (!idv.ok) return err('E_ARGS', 'bad arguments');
            const had = shared.get(idv.id);
            if (!on) {
                if (had) { shared.delete(idv.id); had.server.close(); }
                return { ok: true, urls: [] };
            }
            const root = deps.projectsRoot();
            if (!fs.existsSync(projectDir(root, idv.id))) return err('E_PROJECT', 'That project folder is gone.');
            if (had) return { ok: true, urls: had.urls() };
            const addresses = deps.lan?.addresses || lanAddresses;
            const { server, port } = await fileServer(root, idv.id, deps.lan?.host || '0.0.0.0', addresses);
            const urls = () => addresses().map((a) => `http://${a}:${port}/`);
            shared.set(idv.id, { server, urls });
            return { ok: true, urls: urls() };
        },


        // ---- the project's history (projectGit.ts) ----
        async history(projectId: string): Promise<{ ok: true; commits: Commit[] } | StudioErr> {
            const d = dirOf(projectId);
            if ('ok' in d) return d;
            return { ok: true, commits: await history(d.dir) };
        },
        async changes(projectId: string, oid: string): Promise<{ ok: true; files: FileChange[] } | StudioErr> {
            const d = dirOf(projectId);
            if ('ok' in d) return d;
            if (!OID_RE.test(String(oid))) return err('E_ARGS', 'bad arguments');
            try { return { ok: true, files: await changes(d.dir, oid) }; } catch (e) { return err('E_PROJECT', `That change is not in this project: ${(e as Error).message}`); }
        },
        /** A person's own change (a Save in the Code tab) as one commit. */
        async commit(projectId: string, message: string): Promise<{ ok: true; oid: string | null } | StudioErr> {
            const d = dirOf(projectId);
            if ('ok' in d) return d;
            return { ok: true, oid: await commitAll(d.dir, `You: ${String(message || 'a change').slice(0, 160)}`, PERSON) };
        },
        /** Put the files back as they were at `oid`, as a new commit. Never while the agent is working. */
        async restore(projectId: string, oid: string): Promise<{ ok: true; oid: string | null } | StudioErr> {
            const d = dirOf(projectId);
            if ('ok' in d) return d;
            if (!OID_RE.test(String(oid))) return err('E_ARGS', 'bad arguments');
            if (turn && turn.dir === d.dir) return err('E_BUSY', 'The coding agent is working in this project. Stop it first.');
            try { return { ok: true, oid: await restore(d.dir, oid) }; } catch (e) { return err('E_PROJECT', `Could not go back: ${(e as Error).message}`); }
        },

        // ---- the project's remote: push and pull (owner: GitHub, not a priority; any HTTPS git server) ----
        /** The remote and whether a token is kept for its host; with `url`, set the remote first (HTTPS only). */
        async remote(projectId: string, url?: string): Promise<{ ok: true; url: string | null; token: { saved: boolean; safe: boolean } } | StudioErr> {
            const d = dirOf(projectId);
            if ('ok' in d) return d;
            if (url !== undefined) {
                const u = remoteUrl(url);
                if (!u) return err('E_ARGS', 'Type the https:// address of the repository (like https://github.com/you/project.git), without a password in it.');
                await setRemote(d.dir, u);
            }
            const now = await getRemote(d.dir);
            const host = now ? new URL(now).host : '';
            return { ok: true, url: now, token: { saved: !!(host && deps.tokens && deps.tokens.get(host)), safe: !!(deps.tokens && deps.tokens.safe()) } };
        },
        /** Keep (or forget, with null) the token for this project's remote host. It never comes back to the page. */
        async token(projectId: string, token: string | null): Promise<{ ok: true } | StudioErr> {
            const d = dirOf(projectId);
            if ('ok' in d) return d;
            const now = await getRemote(d.dir);
            if (!now) return err('E_ARGS', 'Save the repository address first.');
            if (!deps.tokens || (token && !deps.tokens.safe())) return err('E_RUNTIME', 'This computer cannot keep a token encrypted, so it keeps none.');
            if (token !== null && (token.length < 8 || token.length > 400 || /\s/.test(token))) return err('E_ARGS', 'That does not look like a token.');
            deps.tokens.set(new URL(now).host, token);
            return { ok: true };
        },
        async push(projectId: string): Promise<{ ok: true } | StudioErr> { return sync(projectId, 'push'); },
        async pull(projectId: string): Promise<{ ok: true } | StudioErr> { return sync(projectId, 'pull'); },

        /** Is `url` on one of the projects this app serves? (main's frame veto lets the Preview through.) */
        serves(url: string): boolean {
            let origin = '';
            try { origin = new URL(url).origin; } catch { return false; }
            for (const s of servers.values()) if (new URL(s.url).origin === origin) return true;
            return false;
        },

        /** The window is going (reload or quit): no agent outlives it, no server either. */
        async dispose(): Promise<void> {
            finish('stopped');
            await stopRuntime();
            for (const s of servers.values()) s.server.close();
            servers.clear();
            for (const s of shared.values()) s.server.close();
            shared.clear();
        },
    };
}

export type Studio = ReturnType<typeof createStudio>;

/** A remote a person typed: https only, a host, no user or password inside (a token is kept apart). */
export function remoteUrl(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.length > 300) return null;
    let u: URL;
    try { u = new URL(raw.trim()); } catch { return null; }
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password || u.search || u.hash) return null;
    return u.toString();
}

/** This machine's non-internal IPv4 addresses (what a person on the LAN types). */
export function lanAddresses(): string[] {
    const out: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
    return out;
}

/**
 * One project's files over HTTP: GET/HEAD only, the project folder only (resolveIn), no listing, no-store. A request
 * must name the server by 127.0.0.1/localhost or one of `addresses()` (a DNS-rebinding guard).
 */
function fileServer(root: string, id: string, host: string, addresses: () => string[]): Promise<{ server: http.Server; port: number }> {
    let port = 0;
    const server = http.createServer((req, res) => {
        const named = String(req.headers.host || '');
        const ok = named === `127.0.0.1:${port}` || named === `localhost:${port}` || addresses().some((a) => named === `${a}:${port}`);
        if (!ok) { res.writeHead(403).end(); return; }
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
        let rel = '';
        try { rel = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname).replace(/^\/+/, ''); } catch { res.writeHead(400).end(); return; }
        if (rel === '' || rel.endsWith('/')) rel += 'index.html';
        const r = resolveIn(root, id, rel);
        if (!r.ok) { res.writeHead(404).end(); return; }
        fs.stat(r.abs, (e, st) => {
            if (e || !st.isFile()) { res.writeHead(404).end(); return; }
            res.writeHead(200, {
                'content-type': MIME[r.ext] || 'application/octet-stream', 'content-length': st.size,
                'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
            });
            if (req.method === 'HEAD') { res.end(); return; }
            fs.createReadStream(r.abs).on('error', () => res.destroy()).pipe(res);
        });
    });
    return new Promise((resolve) => server.listen(0, host, () => {
        port = (server.address() as { port: number }).port;
        resolve({ server, port });
    }));
}

function lastLine(s: string): string {
    const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
    const fatal = lines.find((l) => /fatal|error/i.test(l));
    return clip(fatal || lines[lines.length - 1] || '', 300);
}
