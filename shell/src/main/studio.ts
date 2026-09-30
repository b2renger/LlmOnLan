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
    | { kind: 'end'; reason: string }
    // "Keep going until done" (dsh's goal loop): the goal as the model set it, and each round dsh starts on its own.
    | { kind: 'goal'; phase: string; rounds: number; max: number | null; objective: string; blocked: string }
    | { kind: 'round'; n: number };

/** "Keep going until done": at most this many rounds, whatever the model asks for (a round is a whole agent turn).
 *  ponytail: a constant; a per-project setting if people need longer loops. */
export const GOAL_ROUNDS = 10;
/** What a person's "keep going" switch adds to their message: only the model can start a dsh goal (create_goal). */
export const GOAL_PROMPT = 'Take this on as a goal and keep working on it round after round until it is really finished; '
    + 'check your own work in the files before you mark the goal complete.\n\n';

export interface StudioFarm { endpoint: string; key: string | null; ctxPerSlot: number | null }
export interface StudioRuntime { node: string; bin: string }
export interface StudioEmit { turnId: string; rec?: StudioRecord; done?: { reason: string; error?: string } }

const TEXT_CAP = 20000;   // per diff side: the Changes view shows an edit, not a whole file
const clip = (s: unknown, n: number): string => (typeof s === 'string' ? (s.length > n ? s.slice(0, n) + '…' : s) : '');

/** The profile patch (YAML; every string written as a JSON string, which YAML reads as-is). */
export function buildPatch(o: { baseUrl: string; model: string; contextWindow: number; skillsDir: string; hooksConfig?: string; goals?: boolean; computer?: { url: string } }): string {
    const q = (s: string) => JSON.stringify(s);
    const inserts: string[] = [];
    // The project fence (FENCE_JS): Claude Code-style command hooks, before every file tool.
    if (o.hooksConfig) {
        inserts.push(
            '    - id: hooks-claude-code',
            "      name: '@deepseek-ai/dsh-hooks-claude-code'",
            '      config:',
            `        configPath: ${q(o.hooksConfig)}`,
            '        defaultTimeoutMs: 10000',
        );
    }
    // "Use the Computer" (a person's switch): the Computer's MCP server as the agent's hands — build and run graphs.
    // Its bearer is read from the runtime's env (LOL_MCP_TOKEN, runtimeEnv), never written into this file (it lives in
    // the data folder). Devices stay a dry run: no MCP tool arms the outputs (mcp.ts).
    if (o.computer) {
        inserts.push(
            '    - id: mcp-computer',
            "      name: '@deepseek-ai/dsh-mcp-client'",
            '      config:',
            '        serverName: computer',
            '        transport: streamable-http',
            `        url: ${q(o.computer.url)}`,
            '        headers:',
            '          Authorization: !!js "`Bearer ${process.env.LOL_MCP_TOKEN}`"',
            '        toolCallTimeoutMs: 180000',
            '        failOnStartupError: false',
        );
    }
    // dsh's goal loop only when a person switched on "Keep going until done" — never on the model's own initiative
    // (create_goal's words invite it for any long request). command-goal stays off: nothing in the SDK reaches it.
    const goalOff = o.goals ? [] : ['tool-goal', 'goal-round-driver'];
    const off = [
        'tool-pwsh', 'tool-bash', 'tool-jobs', ...goalOff, 'tool-ralph', 'command-goal',
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
        // Compaction's defaults keep 65536 tokens of headroom: on a 32k window (also our fallback) its budget is
        // negative and it NEVER compacts, so a long conversation dies on max-tokens (the P5-L spike: stalled at
        // round 5; with this, 17 compactions and done — docs/research/p5-loop-spike/RESULTS.md).
        '- id: compaction-basic',
        '  config:',
        '    headroomTokens: 4096',
        '    maxTokens: 4096',
        ...(o.goals ? ['- id: goal', '  config:', `    defaultMaxGoalRounds: ${GOAL_ROUNDS}`] : []),
        ...off.map((id) => `- { id: ${id}, disabled: true }`),
        ...(inserts.length ? ['- insert:', ...inserts] : []),
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
                    : args.name != null ? clip(String(args.name), 120)
                        // "Use the Computer": a graph's title, or the kind of box
                        : args.title != null ? clip(String(args.title), 120) : args.type != null ? clip(String(args.type), 60) : '';
            const name = String(d.name || '').replace(/^mcp__computer__/, 'Computer: ');
            return { kind: 'call', callId: String(d.callId || ''), name, target };
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
        case 'goal/change': {
            const g = d.goal || null;
            return {
                kind: 'goal', phase: g ? String(g.phase || '') : 'none',
                rounds: Number.isFinite(d.roundsStarted) ? d.roundsStarted : 0,
                max: g && Number.isFinite(g.maxGoalRounds) ? g.maxGoalRounds : null,
                objective: g ? clip(g.objective, 300) : '', blocked: g ? clip(g.blockedReason, 300) : '',
            };
        }
        case 'user/message': {
            // Only the rounds dsh starts itself (source.kind "goal"); a person's own message is already on the page.
            const s = d.source || (d.message && d.message.source) || null;
            return s && s.kind === 'goal' && Number.isFinite(s.round) ? { kind: 'round', n: s.round } : null;
        }
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
export function runtimeEnv(env: NodeJS.ProcessEnv, o: { home: string; key: string; mcpToken?: string }): NodeJS.ProcessEnv {
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
        // Only with "Use the Computer": the Computer's MCP bearer, read by the patch's !!js header (never on disk there).
        ...(o.mcpToken ? { LOL_MCP_TOKEN: o.mcpToken } : {}),
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
interface Turn {
    id: string; sessionId: string; running: boolean; end: string | null; dir: string; prompt: string;
    /** "Keep going until done": the goal's phase as dsh reports it, the rounds it started, the wait for the next one. */
    goal: string | null; rounds: number; waiting: NodeJS.Timeout | null;
}
/** After an idle with the goal still active, dsh starts the next round at once; this long without one means it
 *  disarmed the goal (a max-tokens end, an error) and the reply is over. */
const ROUND_WAIT_MS = 30000;

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
    /** How long to wait for dsh's next goal round before the reply is over (tests shorten it). */
    roundWaitMs?: number;
    /** The Computer's MCP server, when this session holds its port (mcp.ts) — for "Use the Computer". */
    computer?: () => { url: string; token: string } | null;
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
        if (t.waiting) clearTimeout(t.waiting);
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
            if (rec.kind === 'goal') turn.goal = rec.phase;
            if (rec.kind === 'round') turn.rounds = rec.n;
            deps.emit({ turnId: turn.id, rec });
            // Our cap, whatever max_goal_rounds the model chose: a round past it is not run.
            if (rec.kind === 'round' && rec.n > GOAL_ROUNDS) { finish('round-limit'); void stopRuntime(); }
        } else if (m.method === 'session.status') {
            if (p.status === 'running') {
                turn.running = true;
                if (turn.waiting) { clearTimeout(turn.waiting); turn.waiting = null; }
            } else if (p.status === 'idle' && turn.running) {
                // A goal still active after a normal end: dsh queues the next round now — the reply goes on.
                if (turn.goal === 'active' && (turn.end || 'completed') === 'completed') {
                    turn.running = false;
                    const t = turn;
                    t.waiting = setTimeout(() => { if (turn === t) finish('stalled'); }, deps.roundWaitMs ?? ROUND_WAIT_MS);
                    return;
                }
                finish(turn.goal === 'blocked' ? 'blocked' : (turn.end || 'completed'));
            }
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
            if (!fs.existsSync(to)) copyTree(path.join(deps.seedSkills, name), to);
        }
    }

    async function startRuntime(o: { key: string; dir: string; model: string; maxTokens: number; farm: StudioFarm; runtime: StudioRuntime; goals: boolean; computer: { url: string; token: string } | null }): Promise<Rt | StudioErr> {
        const home = homeOf();
        try {
            seed();
            const prof = path.join(home, 'profiles', 'sdk');
            fs.mkdirSync(prof, { recursive: true });
            // The fence and its hooks config, rewritten every start (the runtime's own Node runs the fence).
            const fence = path.join(home, 'lol-fence.mjs');
            const hooks = path.join(home, 'lol-hooks.json');
            fs.writeFileSync(fence, FENCE_JS);
            fs.writeFileSync(hooks, fenceHooks(o.runtime.node, fence));
            const patch = buildPatch({ baseUrl: o.farm.endpoint, model: o.model, contextWindow: o.farm.ctxPerSlot || 32768, skillsDir: skillsOf(), hooksConfig: hooks, goals: o.goals, computer: o.computer ? { url: o.computer.url } : undefined });
            fs.writeFileSync(path.join(prof, 'cordis.patch.yml.tmp'), patch);
            fs.renameSync(path.join(prof, 'cordis.patch.yml.tmp'), path.join(prof, 'cordis.patch.yml'));
        } catch (e) {
            return err('E_START', `Could not prepare the coding agent's folder: ${(e as Error).message}`);
        }
        const child = spawn(o.runtime.node, [o.runtime.bin, '--profile', 'sdk'], {
            cwd: o.dir,
            env: runtimeEnv(deps.env || process.env, { home, key: o.farm.key || 'sk-lol-lan', mcpToken: o.computer ? o.computer.token : undefined }),
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
        async prompt(o: { projectId: string; threadId: string; model: string; text: string; recap?: string; maxTokens?: number; turnId?: string; goal?: boolean; computer?: boolean }):
            Promise<{ ok: true; turnId: string; fresh: boolean } | StudioErr> {
            const idv = validateId(o.projectId);
            if (!idv.ok || !o.threadId || !o.text) return err('E_ARGS', 'bad arguments');
            // The one a person can cause (a farm with no default model, and none picked): say what to do.
            if (!o.model) return err('E_ARGS', 'No model is chosen for this chat: pick one in the model menu, then send again.');
            const dir = projectDir(deps.projectsRoot(), idv.id);
            if (!fs.existsSync(dir)) return err('E_PROJECT', 'That project folder is gone.');
            const farm = deps.farm();
            if (!farm) return err('E_FARM', 'No farm is connected, so there is no model to write the code.');
            const runtime = deps.runtime();
            if (!runtime) return err('E_RUNTIME', 'The coding agent is not installed on this computer yet.');
            if (turn) return err('E_BUSY', 'The coding agent is already working. Stop it first.');
            // "Keep going until done": a turn cut on max-tokens disarms the goal, and 8192 cut real goal work (P5-L spike).
            const goals = o.goal === true;
            const maxTokens = Math.min(65536, Math.max(goals ? 16384 : 512, Math.floor(Number(o.maxTokens) || 8192)));
            // "Use the Computer": only when a person switched it on AND this session holds the MCP server's port.
            const computer = o.computer === true && deps.computer ? deps.computer() : null;
            const key = JSON.stringify([idv.id, o.model, maxTokens, farm.endpoint, farm.key, farm.ctxPerSlot, runtime.bin, goals, !!computer]);
            if (!rt || rt.dead || rt.key !== key) {
                await stopRuntime();
                const started = await startRuntime({ key, dir, model: o.model, maxTokens, farm, runtime, goals, computer });
                if ('ok' in started) return started;
            }
            const r = rt!;
            let sessionId = r.sessions.get(o.threadId);
            const fresh = !sessionId;
            if (!sessionId) {
                sessionId = `lol-${o.threadId.slice(0, 40)}-${Date.now().toString(36)}`;
                r.sessions.set(o.threadId, sessionId);
            }
            const text = (fresh && o.recap ? `${o.recap}\n\n` : '') + (goals ? GOAL_PROMPT : '') + o.text;
            // The page names the turn when it can, so it listens BEFORE the first record (they can beat this answer).
            const named = typeof o.turnId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(o.turnId) ? o.turnId : '';
            turn = { id: named || randomBytes(8).toString('hex'), sessionId, running: false, end: null, dir, prompt: o.text, goal: null, rounds: 0, waiting: null };
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

        status(): { ok: true; installed: boolean; running: boolean; version: string; computer: boolean } {
            return { ok: true, installed: !!deps.runtime(), running: !!turn, version: DSH_VERSION, computer: !!(deps.computer && deps.computer()) };
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

/**
 * The project fence (2026-09-28): dsh confines WRITES to the workspace but not reads ("preserving the local
 * filesystem's read behavior" — its dsh-fs-sandbox README), so the agent could read any file of this account and
 * hand it to the model. This PreToolUse hook (dsh-hooks-claude-code, Claude Code's hook protocol: the call as JSON
 * on stdin, exit 2 = refused, stderr = what the model reads) refuses every file tool whose path — after links — is
 * outside the project, a glob that climbs out, and any request for wider sandbox rights. The bridge FAILS OPEN on a
 * crash, so this script denies whenever it is unsure. (The one backslash in it, in the glob check, is doubled for
 * this template string.)
 */
export const FENCE_JS = `// LlmOnLan: the IDE's coding agent reads and changes files ONLY inside its project (a dsh PreToolUse hook).
import fs from 'node:fs';
import path from 'node:path';
const WIN = process.platform === 'win32';
const fold = (p) => (WIN ? p.toLowerCase() : p);
const deny = (why) => { process.stderr.write('LOL Vibe: ' + why); process.exit(2); };
/** The real path of p, or of its nearest existing parent joined with the rest (a file about to be made). */
function real(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest); } catch { /* not there yet */ }
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(p);
    rest.unshift(path.basename(cur));
    cur = parent;
  }
}
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { deny('this tool call could not be checked, so it was refused.'); }
  const args = (input && input.tool_input) || {};
  if (args.sandbox_permissions) deny('the agent works only inside this project; it gets no wider access.');
  const root = real(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const inside = (p) => { const a = fold(real(path.resolve(root, p))); const r = fold(root); return a === r || a.startsWith(r + path.sep); };
  for (const p of [args.file_path, args.path]) {
    if (typeof p === 'string' && p && !inside(p)) deny('only files inside this project can be read or changed (' + p + ' is outside).');
  }
  const pat = typeof args.pattern === 'string' ? args.pattern : '';
  if (input.tool_name === 'glob' && (path.isAbsolute(pat) || pat.split(/[\\\\/]/).includes('..'))) {
    deny('a search must stay inside this project (' + pat + ').');
  }
  process.exit(0);
});
`;

/**
 * The hooks config dsh reads (Claude Code's format): the fence before every file tool. dsh runs a hook command
 * through its shell layer — `bash -c` on POSIX, PowerShell on Windows — and PowerShell reads two quoted paths as two
 * strings, not a command (a parse error = exit 1 = "pass": the fence silently off; seen on the real runtime,
 * 2026-09-28). So on Windows the call operator `&` leads, and `exit $LASTEXITCODE` hands on the fence's own code:
 * PowerShell otherwise turns a program's exit 2 (block) into its own 1 (pass).
 */
export function fenceHooks(node: string, fence: string, platform: string = process.platform): string {
    const q = (s: string) => `"${s}"`;
    const command = platform === 'win32' ? `& ${q(node)} ${q(fence)}; exit $LASTEXITCODE` : `${q(node)} ${q(fence)}`;
    return JSON.stringify({
        hooks: {
            PreToolUse: [{
                matcher: 'read|glob|grep|read_image|write|edit',
                hooks: [{ type: 'command', command, timeout: 10 }],
            }],
        },
    }, null, 2);
}

/** A remote a person typed: https only, a host, no user or password inside (a token is kept apart). */
export function remoteUrl(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.length > 300) return null;
    let u: URL;
    try { u = new URL(raw.trim()); } catch { return null; }
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password || u.search || u.hash) return null;
    return u.toString();
}

/**
 * Copy a folder with the calls Electron's asar support covers (readdir, stat, read, write). The bundled skills live
 * INSIDE app.asar in an installed app, and `fs.cpSync` fails there with ENOENT (probed on a real asar, 2026-09-28) —
 * which would have stopped the coding agent from starting at all in every installed client.
 */
export function copyTree(from: string, to: string): void {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
        const src = path.join(from, name);
        const dest = path.join(to, name);
        if (fs.statSync(src).isDirectory()) copyTree(src, dest);
        else fs.writeFileSync(dest, fs.readFileSync(src));
    }
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
        // resolveIn judges the path as written; a link in the project (a pulled repository can carry one) would still
        // be followed out of it — to any file of this account, served to the LAN. So the REAL path must be inside too.
        let real = '';
        try {
            const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
            real = fs.realpathSync.native(r.abs);
            if (!fold(real).startsWith(fold(fs.realpathSync.native(projectDir(root, id))) + path.sep)) real = '';
        } catch { real = ''; }
        if (!real) { res.writeHead(404).end(); return; }
        fs.stat(real, (e, st) => {
            if (e || !st.isFile()) { res.writeHead(404).end(); return; }
            res.writeHead(200, {
                'content-type': MIME[r.ext] || 'application/octet-stream', 'content-length': st.size,
                'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
            });
            if (req.method === 'HEAD') { res.end(); return; }
            fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
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
