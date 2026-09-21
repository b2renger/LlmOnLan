'use strict';
// Scope gate (plan §2.5, precised by §2.6 B): the LOL Chat vNext change set must stay inside the
// §1.1 allowlist, and the three shared files it is allowed to touch must be touched in the one way
// that was agreed.
//
//   node shell/test/chat-scope.js                # check this working tree against merge-base(HEAD, main)
//   node shell/test/chat-scope.js --base <ref>   # compare against another base
//   node shell/test/chat-scope.js --self-test    # the checker's own tests (no git, no files touched)
//   node shell/test/chat-scope.js --verbose      # list every changed path with its verdict
//
// §2.6 B: nothing is committed during a phase, so `git diff <base>...HEAD` is EMPTY and the whole
// change set is working-tree + untracked. Untracked files are enumerated with
// `git ls-files --others --exclude-standard` (plain `git status --porcelain` collapses new
// directories into a single line), minus the owner's arm-list.txt / owui-arm.tar.gz.
//
// This file never writes, checks out, resets or stashes anything: other builders share the tree.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const IGNORED_PATHS = new Set(['arm-list.txt', 'owui-arm.tar.gz']);

/** Paths (repo-relative, forward slashes) the phase may change. §1.1 */
const ALLOWED = [
    { re: /^shell\/renderer\/chat\/.+/, why: 'the new chat tree' },
    { re: /^shell\/renderer\/chat\.js$/, why: 'the old chat surface (deletion only, P1 landing)', deleteOnly: true },
    { re: /^shell\/renderer\/index\.html$/, why: 'the #lolchat section and the chat script/link tags', checkCsp: true },
    { re: /^shell\/renderer\/styles\.css$/, why: 'removing the LOL Chat block' },
    { re: /^shell\/renderer\/app\.js$/, why: 'additive __lolFarm fields inside publishFarm()', checkPublishFarm: true },
    { re: /^shell\/test\/.+/, why: 'tests and the harness', checkE2e: true },
    // S0 kickoff (studio plan 2.5): the scratch-projects carve-out, and EXACTLY this carve-out.
    // Everything else under shell/src/** is still out of scope. The two new .ts files the phase
    // owns outright; the two existing files may only grow inside their marked shape.
    { re: /^shell\/src\/main\/projects\.ts$/, why: 'the scratch-projects API (S0)' },
    { re: /^shell\/src\/main\/projectsPath\.ts$/, why: 'the pure path validator (S0)' },
    { re: /^shell\/src\/main\/index\.ts$/, why: 'the marked LOL Studio regions only', checkMarkedRegion: 'LOL Studio (S0)' },
    { re: /^shell\/src\/preload\/index\.ts$/, why: 'the additive projects property only', checkPreloadProjects: true },
    { re: /^docs\/.+/, why: 'documentation' },
];

const CSP_RE = /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?>/i;

// ---------------------------------------------------------------------------------------------
// the checker (pure: everything it reads comes from `io`)
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{path: string, message: string}} ScopeViolation
 * @param {{
 *   changed: string[],
 *   readBase: (p: string) => string | null,   // content at the base commit, null if absent
 *   readWork: (p: string) => string | null,   // content in the working tree, null if deleted
 *   diff: (p: string) => string,              // unified diff base → working tree
 * }} io
 * @returns {{violations: ScopeViolation[], verdicts: {path:string, why:string}[]}}
 */
function checkScope(io) {
    /** @type {ScopeViolation[]} */
    const violations = [];
    /** @type {{path:string, why:string}[]} */
    const verdicts = [];
    const add = (p, message) => violations.push({ path: p, message });

    for (const file of io.changed) {
        if (IGNORED_PATHS.has(file)) continue;
        const rule = ALLOWED.find((r) => r.re.test(file));
        if (!rule) {
            add(file, 'outside the LOL Chat scope (§1.1) — route the change through the integrator');
            verdicts.push({ path: file, why: 'OUT OF SCOPE' });
            continue;
        }
        verdicts.push({ path: file, why: rule.why });

        if (rule.deleteOnly && io.readWork(file) !== null && io.readBase(file) !== null
            && io.readWork(file) !== io.readBase(file)) {
            add(file, 'may only be DELETED (P1 landing), not edited');
        }

        if (rule.checkCsp) {
            const before = io.readBase(file);
            const after = io.readWork(file);
            if (after === null) add(file, 'index.html must not be deleted');
            else if (before !== null) {
                const a = (before.match(CSP_RE) || [''])[0];
                const b = (after.match(CSP_RE) || [''])[0];
                if (!b) add(file, 'the Content-Security-Policy meta is gone');
                else if (a && a !== b) add(file, 'the Content-Security-Policy meta changed (forbidden: §1.1)');
            }
        }

        if (rule.checkE2e && /^shell\/test\/e2e\.js$/.test(file)) {
            const before = io.readBase(file);
            const after = io.readWork(file);
            if (before !== after) add(file, 'shell/test/e2e.js must stay byte-identical (§2.5)');
        }

        if (rule.checkPublishFarm) {
            for (const v of checkAppJs(io, file)) add(file, v);
        }

        if (rule.checkMarkedRegion) {
            for (const v of checkMarked(io, file, rule.checkMarkedRegion)) add(file, v);
        }

        if (rule.checkPreloadProjects) {
            for (const v of checkPreload(io, file)) add(file, v);
        }
    }
    return { violations, verdicts };
}

/** Line span [start, end] (1-based, inclusive) of `function publishFarm() { … }` in `src`. */
function publishFarmSpan(src) {
    const lines = src.split('\n');
    const start = lines.findIndex((l) => /^\s*function publishFarm\s*\(/.test(l));
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        if (depth === 0 && i > start) return [start + 1, i + 1];
    }
    return [start + 1, lines.length];
}

/** The `window.__lolFarm = f … ;` statement span (the one literal that may be rewritten). */
function lolFarmLiteralSpan(src) {
    const lines = src.split('\n');
    const start = lines.findIndex((l) => /window\.__lolFarm\s*=/.test(l));
    if (start < 0) return null;
    let i = start;
    while (i < lines.length && !/;\s*$/.test(lines[i])) i++;
    return [start + 1, Math.min(i + 1, lines.length)];
}

/** @returns {string[]} messages */
function checkAppJs(io, file) {
    const out = [];
    const base = io.readBase(file);
    const work = io.readWork(file);
    if (work === null) return ['app.js must not be deleted'];
    if (base === null) return [];
    const span = publishFarmSpan(base);
    if (!span) return ['cannot find `function publishFarm(` in the base version of app.js'];
    const literal = lolFarmLiteralSpan(base) || [0, -1];

    const diff = io.diff(file) || '';
    const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;
    const lines = diff.split('\n');
    let oldLine = 0;
    let inHunk = false;
    for (const line of lines) {
        const m = line.match(hunkRe);
        if (m) {
            inHunk = true;
            oldLine = Number(m[1]);
            const len = m[2] === undefined ? 1 : Number(m[2]);
            const from = oldLine;
            const to = oldLine + Math.max(len - 1, 0);
            if (to < span[0] || from > span[1]) {
                out.push(`hunk at old lines ${from}-${to} is OUTSIDE function publishFarm (lines ${span[0]}-${span[1]})`);
            }
            continue;
        }
        if (!inHunk) continue;
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('-')) {
            const inLiteral = oldLine >= literal[0] && oldLine <= literal[1];
            if (!inLiteral) {
                out.push(`hunk removes a line outside the \`window.__lolFarm = f\` literal (old line ${oldLine}): ${line.slice(1).trim().slice(0, 60)}`);
            }
            oldLine++;
        } else if (line.startsWith('+')) {
            // an added line consumes no old line
        } else if (line.startsWith(' ')) {
            oldLine++;
        }
    }
    return out;
}

/**
 * Line spans (1-based, inclusive) of every `// ---- <label> ----` ... `// ---- /LOL Studio ----`
 * region in `src`. The anchors are literal, so a region cannot be widened by renaming it.
 * @returns {[number, number][]}
 */
function markedSpans(src, label) {
    const open = `// ---- ${label} ----`;
    const close = '// ---- /LOL Studio ----';
    /** @type {[number, number][]} */
    const spans = [];
    let start = 0;
    src.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith(open)) start = i + 1;
        else if (trimmed === close && start) { spans.push([start, i + 1]); start = 0; }
    });
    return spans;
}

/** Parse a unified diff into hunks: {from, to} in OLD lines, plus the removed and added lines. */
function hunksOf(diff) {
    const out = [];
    const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
    let cur = null;
    let newLine = 0;
    for (const line of (diff || '').split('\n')) {
        const m = line.match(hunkRe);
        if (m) {
            const from = Number(m[1]);
            const len = m[2] === undefined ? 1 : Number(m[2]);
            newLine = Number(m[3]);
            cur = { from, to: from + Math.max(len - 1, 0), removes: [], adds: [] };
            out.push(cur);
            continue;
        }
        if (!cur || line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('-')) cur.removes.push(line.slice(1));
        else if (line.startsWith('+')) { cur.adds.push({ line: newLine, text: line.slice(1) }); newLine++; }
        else if (line.startsWith(' ')) newLine++;
    }
    return out;
}

/** shell/src/main/index.ts: additive changes inside the marked regions, and nowhere else. */
function checkMarked(io, file, label) {
    const out = [];
    const base = io.readBase(file);
    const work = io.readWork(file);
    if (work === null) return [`${file} must not be deleted`];
    const workSpans = markedSpans(work, label);
    if (!workSpans.length) {
        return [`no "// ---- ${label} ----" ... "// ---- /LOL Studio ----" region in ${file}: `
            + 'the carve-out is the marked region, not the file'];
    }
    const baseSpans = base === null ? [] : markedSpans(base, label);
    for (const hunk of hunksOf(io.diff(file))) {
        if (hunk.removes.length) {
            out.push(`hunk at old lines ${hunk.from}-${hunk.to} REMOVES a line - the carve-out is additive only: `
                + hunk.removes[0].trim().slice(0, 60));
        }
        if (!baseSpans.length) continue;                      // the regions are being introduced
        const inside = baseSpans.some(([a, b]) => hunk.from >= a && hunk.to <= b);
        if (!inside) {
            out.push(`hunk at old lines ${hunk.from}-${hunk.to} is OUTSIDE every ${label} region `
                + `(${baseSpans.map(([a, b]) => `${a}-${b}`).join(', ')})`);
        }
    }
    return out;
}

/** The span of the `projects: {` ... `},` property in a preload file, in 1-based lines. */
function projectsPropSpan(src) {
    const lines = src.split('\n');
    const start = lines.findIndex((l) => /^\s*projects\s*:\s*\{/.test(l));
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        if (depth === 0 && i > start) return [start + 1, i + 1];
    }
    return [start + 1, lines.length];
}

/** shell/src/preload/index.ts: one additive `projects: {...}` property, nothing else. */
function checkPreload(io, file) {
    const out = [];
    const work = io.readWork(file);
    if (work === null) return [`${file} must not be deleted`];
    if (!/exposeInMainWorld\s*\(\s*['"]lol['"]/.test(work)) {
        out.push('the preload no longer exposes the lol object');
    }
    const span = projectsPropSpan(work);
    if (!span) return out.concat(['no `projects: {` ... `},` property in the preload: that property IS the carve-out']);
    for (const hunk of hunksOf(io.diff(file))) {
        if (hunk.removes.length) {
            out.push(`the preload carve-out is additive only, but a line is removed: ${hunk.removes[0].trim().slice(0, 60)}`);
        }
        for (const a of hunk.adds) {
            if (a.line < span[0] || a.line > span[1]) {
                out.push(`added line ${a.line} is outside the \`projects\` property (lines ${span[0]}-${span[1]}): `
                    + a.text.trim().slice(0, 60));
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// git adapters
// ---------------------------------------------------------------------------------------------

const git = (args, opts = {}) => execFileSync('git', args, {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
}).replace(/\r\n/g, '\n');

function gitQuiet(args) {
    try { return git(args); } catch { return ''; }
}

function collectChanged(base) {
    const set = new Set();
    const addAll = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean).forEach((p) => set.add(p));
    addAll(gitQuiet(['diff', '--name-only', `${base}...HEAD`]));   // committed on the branch (empty during a phase)
    addAll(gitQuiet(['diff', '--name-only', base]));               // base → working tree (tracked)
    addAll(gitQuiet(['ls-files', '--others', '--exclude-standard']));
    for (const p of IGNORED_PATHS) set.delete(p);
    return [...set].sort();
}

function makeIo(base, changed) {
    return {
        changed,
        readBase: (p) => {
            try { return git(['show', `${base}:${p}`]); } catch { return null; }
        },
        readWork: (p) => {
            try { return fs.readFileSync(path.join(REPO_ROOT, p), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
        },
        diff: (p) => gitQuiet(['diff', '-U0', base, '--', p]),
    };
}

// ---------------------------------------------------------------------------------------------
// self-test (synthetic io — touches no file and runs no git)
// ---------------------------------------------------------------------------------------------

const FAKE_APP_JS = [
    'const $ = (id) => document.getElementById(id);',                       // 1
    'function renderPill() {',                                              // 2
    "  els.pill.textContent = 'x';",                                        // 3
    '}',                                                                    // 4
    'function publishFarm() {',                                             // 5
    '  const f = activeFarm();',                                            // 6
    '  window.__lolFarm = f',                                               // 7
    '    ? { name: f.name, openaiBaseUrl: farmEndpoint(f) }',               // 8
    '    : null;',                                                          // 9
    '  if (window.__lolChatRefresh) window.__lolChatRefresh();',            // 10
    '}',                                                                    // 11
    '',                                                                     // 12
].join('\n');

function selfTest() {
    const cases = [];
    const io = (over) => Object.assign({
        changed: [],
        readBase: () => null,
        readWork: () => null,
        diff: () => '',
    }, over);

    const expectFlag = (name, result, match) => {
        const hit = result.violations.some((v) => match.test(`${v.path} ${v.message}`));
        cases.push({ name, ok: hit, detail: JSON.stringify(result.violations) });
    };
    const expectClean = (name, result) => {
        cases.push({ name, ok: result.violations.length === 0, detail: JSON.stringify(result.violations) });
    };

    // 1. a change under shell/src/
    expectFlag('a change under shell/src/ is out of scope',
        checkScope(io({ changed: ['shell/src/main/sidecar.ts'] })), /out of scope|outside the LOL Chat scope/i);

    // 2. a CSP edit in index.html
    const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\';" />';
    expectFlag('a CSP edit in index.html is flagged', checkScope(io({
        changed: ['shell/renderer/index.html'],
        readBase: () => `<head>\n  ${csp}\n</head>`,
        readWork: () => '<head>\n  <meta http-equiv="Content-Security-Policy" content="default-src *;" />\n</head>',
    })), /Content-Security-Policy meta changed/);

    // …and a non-CSP edit in the same file is fine (the #lolchat section is allowed to move)
    expectClean('adding the chat section to index.html is allowed', checkScope(io({
        changed: ['shell/renderer/index.html'],
        readBase: () => `<head>\n  ${csp}\n</head><body></body>`,
        readWork: () => `<head>\n  ${csp}\n</head><body><section id="lolchat"></section></body>`,
    })));

    // 3. an app.js hunk outside publishFarm
    expectFlag('an app.js hunk outside publishFarm is flagged', checkScope(io({
        changed: ['shell/renderer/app.js'],
        readBase: () => FAKE_APP_JS,
        readWork: () => FAKE_APP_JS,
        diff: () => ['--- a/shell/renderer/app.js', '+++ b/shell/renderer/app.js',
            '@@ -3,0 +4 @@', "+  els.pill.title = 'tampered';"].join('\n'),
    })), /OUTSIDE function publishFarm/);

    // …an additive hunk INSIDE publishFarm is the sanctioned change
    expectClean('an additive hunk inside publishFarm is allowed', checkScope(io({
        changed: ['shell/renderer/app.js'],
        readBase: () => FAKE_APP_JS,
        readWork: () => FAKE_APP_JS,
        diff: () => ['--- a/shell/renderer/app.js', '+++ b/shell/renderer/app.js',
            '@@ -9,0 +10 @@', '+  window.__lolFarm.capacity = f && f.capacity;'].join('\n'),
    })));

    // …and the one allowed rewrite: the __lolFarm object literal being extended
    expectClean('extending the window.__lolFarm literal is allowed', checkScope(io({
        changed: ['shell/renderer/app.js'],
        readBase: () => FAKE_APP_JS,
        readWork: () => FAKE_APP_JS,
        diff: () => ['--- a/shell/renderer/app.js', '+++ b/shell/renderer/app.js',
            '@@ -8 +8 @@', '-    ? { name: f.name, openaiBaseUrl: farmEndpoint(f) }',
            '+    ? { name: f.name, openaiBaseUrl: farmEndpoint(f), capacity: f.capacity }'].join('\n'),
    })));

    // …but removing a line elsewhere in publishFarm is not
    expectFlag('removing an unrelated line inside publishFarm is flagged', checkScope(io({
        changed: ['shell/renderer/app.js'],
        readBase: () => FAKE_APP_JS,
        readWork: () => FAKE_APP_JS,
        diff: () => ['--- a/shell/renderer/app.js', '+++ b/shell/renderer/app.js',
            '@@ -10 +10 @@', '-  if (window.__lolChatRefresh) window.__lolChatRefresh();',
            '+  if (window.__lolChatRefresh) setTimeout(window.__lolChatRefresh, 0);'].join('\n'),
    })), /removes a line outside/);

    // 4. an e2e.js edit
    expectFlag('an e2e.js edit is flagged', checkScope(io({
        changed: ['shell/test/e2e.js'],
        readBase: () => 'const http = require("http");\n',
        readWork: () => 'const http = require("http"); // tweaked\n',
    })), /byte-identical/);

    expectClean('a new harness file under shell/test/ is allowed', checkScope(io({
        changed: ['shell/test/chat-harness/run.js', 'shell/test/chat/unit/md.test.mjs'],
    })));

    // chat.js: deletion is allowed, editing is not
    expectClean('deleting chat.js is allowed', checkScope(io({
        changed: ['shell/renderer/chat.js'],
        readBase: () => 'old surface',
        readWork: () => null,
    })));
    expectFlag('editing chat.js is flagged', checkScope(io({
        changed: ['shell/renderer/chat.js'],
        readBase: () => 'old surface',
        readWork: () => 'old surface + a patch',
    })), /may only be DELETED/);

    expectClean('the owner\'s stray files are ignored', checkScope(io({
        changed: ['arm-list.txt', 'owui-arm.tar.gz'],
    })));

    // 5. the S0 carve-out (studio plan 2.5)
    const MAIN_TS = [
        "import { app } from 'electron';",                          // 1
        'function wire(win) {',                                     // 2
        '  // ---- LOL Studio (S0) ----',                           // 3
        "  ipcMain.handle('lol:projects:root', () => api.root());", // 4
        '  // ---- /LOL Studio ----',                               // 5
        '  win.show();',                                            // 6
        '}',                                                        // 7
    ].join('\n');
    expectClean('an added line inside the marked region is allowed', checkScope(io({
        changed: ['shell/src/main/index.ts'],
        readBase: () => MAIN_TS,
        readWork: () => MAIN_TS,
        diff: () => ['--- a/shell/src/main/index.ts', '+++ b/shell/src/main/index.ts',
            '@@ -4,0 +5 @@', "+  ipcMain.handle('lol:projects:list', () => api.list());"].join('\n'),
    })));
    expectFlag('an index.ts hunk outside the marked region is flagged', checkScope(io({
        changed: ['shell/src/main/index.ts'],
        readBase: () => MAIN_TS,
        readWork: () => MAIN_TS,
        diff: () => ['--- a/shell/src/main/index.ts', '+++ b/shell/src/main/index.ts',
            '@@ -6,0 +7 @@', '+  win.setAlwaysOnTop(true);'].join('\n'),
    })), /OUTSIDE every LOL Studio/);
    expectFlag('a removal inside the marked region is flagged', checkScope(io({
        changed: ['shell/src/main/index.ts'],
        readBase: () => MAIN_TS,
        readWork: () => MAIN_TS,
        diff: () => ['--- a/shell/src/main/index.ts', '+++ b/shell/src/main/index.ts',
            '@@ -4 +4 @@', "-  ipcMain.handle('lol:projects:root', () => api.root());",
            "+  ipcMain.handle('lol:projects:root', () => rootDir);"].join('\n'),
    })), /REMOVES a line/);
    expectFlag('index.ts without the marked anchors is flagged', checkScope(io({
        changed: ['shell/src/main/index.ts'],
        readBase: () => 'const x = 1;\n',
        readWork: () => 'const x = 1;\nconst y = 2;\n',
        diff: () => ['--- a/shell/src/main/index.ts', '+++ b/shell/src/main/index.ts',
            '@@ -1,0 +2 @@', '+const y = 2;'].join('\n'),
    })), /the carve-out is the marked region/);

    const PRELOAD_TS = [
        "contextBridge.exposeInMainWorld('lol', {",                    // 1
        "  getBlenderConnection: () => invoke('x'),",                  // 2
        '  projects: {',                                               // 3
        "    root: () => ipcRenderer.invoke('lol:projects:root'),",    // 4
        '  },',                                                        // 5
        '});',                                                         // 6
    ].join('\n');
    expectClean('an added line inside the preload projects property is allowed', checkScope(io({
        changed: ['shell/src/preload/index.ts'],
        readBase: () => PRELOAD_TS,
        readWork: () => PRELOAD_TS,
        diff: () => ['--- a/shell/src/preload/index.ts', '+++ b/shell/src/preload/index.ts',
            '@@ -4,0 +5 @@', "+    list: () => ipcRenderer.invoke('lol:projects:list'),"].join('\n'),
    })));
    expectFlag('a preload line outside the projects property is flagged', checkScope(io({
        changed: ['shell/src/preload/index.ts'],
        readBase: () => PRELOAD_TS,
        readWork: () => PRELOAD_TS,
        diff: () => ['--- a/shell/src/preload/index.ts', '+++ b/shell/src/preload/index.ts',
            '@@ -2,0 +2 @@', '+  openExternal: (u) => shell.openExternal(u),'].join('\n'),
    })), /outside the `projects` property/);
    expectClean('the two new projects .ts files are allowed outright', checkScope(io({
        changed: ['shell/src/main/projects.ts', 'shell/src/main/projectsPath.ts'],
    })));

    let failed = 0;
    for (const c of cases) {
        if (c.ok) console.log(`ok   self-test: ${c.name}`);
        else { failed++; console.log(`FAIL self-test: ${c.name}: ${c.detail}`); }
    }
    console.log(failed ? `${failed} self-test case(s) failed` : `all ${cases.length} self-test cases passed`);
    return failed ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------

function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--self-test')) return selfTest();
    const verbose = argv.includes('--verbose');
    const baseArg = argv.indexOf('--base') >= 0 ? argv[argv.indexOf('--base') + 1] : null;

    let base = baseArg;
    if (!base) {
        try {
            base = git(['merge-base', 'HEAD', 'main']).trim();
        } catch {
            console.error('chat-scope: cannot compute `git merge-base HEAD main` — pass --base <ref>');
            return 1;
        }
    }
    const branch = gitQuiet(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const head = gitQuiet(['rev-parse', 'HEAD']).trim();
    if (head && base && head === base && branch === 'main') {
        console.log('warning: HEAD is main — checking the working tree only');
    }

    const changed = collectChanged(base);
    const { violations, verdicts } = checkScope(makeIo(base, changed));

    console.log(`base ${base.slice(0, 12)} (${branch}), ${changed.length} changed path(s)`);
    if (verbose) for (const v of verdicts) console.log(`  ${v.why === 'OUT OF SCOPE' ? 'XX' : 'ok'}  ${v.path}  — ${v.why}`);
    for (const v of violations) console.log(`SCOPE  ${v.path}: ${v.message}`);
    console.log(violations.length ? `${violations.length} scope violation(s)` : 'scope clean');
    return violations.length ? 1 : 0;
}

module.exports = { checkScope, publishFarmSpan, lolFarmLiteralSpan, markedSpans, projectsPropSpan, ALLOWED };

if (require.main === module) {
    process.exit(main());
}
