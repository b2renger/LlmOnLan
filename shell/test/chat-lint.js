'use strict';
// Static gate for shell/renderer/chat/** (plan §2.4, precised by §2.6 C).
//
//   node shell/test/chat-lint.js              # lint the real tree; exits non-zero with file:line
//   node shell/test/chat-lint.js --self-test  # plant one violation per rule in a temp copy and
//                                             # check that each rule fires (the lint's own test)
//   node shell/test/chat-lint.js --list-pure  # show which PURE_MODULES exist yet
//
// The rules encode LOL Chat's non-negotiables (VISION §D): model text never becomes HTML, nothing
// reaches the network except the farm's chat endpoint, the palette is ComfyQ tokens only, pure
// modules stay testable in Node, every user-visible string goes through t(), and the document drop
// guard never swallows the event the chat's own intake needs.
//
// §2.6 C: rules 1, 2 and 7 read the source with comments STRIPPED (documentation may name a
// forbidden token); rules 3, 5, 6 and 8 read the raw text (rule 8 is about the BYTES, so a control
// character hiding in a comment counts just as much).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SHELL_DIR = path.join(__dirname, '..');
const CHAT_DIR = path.join(SHELL_DIR, 'renderer', 'chat');

// The frozen whole-module pure list (plan §2.6 C). Paths that do not exist yet are SKIPPED with a
// note, so the list ships complete from P0 and each phase's files light up as they land.
const PURE_MODULES = [
    // P0
    'core/ids.mjs', 'core/events.mjs', 'core/registry.mjs', 'core/i18n.mjs', 'core/types.mjs',
    'render/md-block.mjs', 'render/md-inline.mjs', 'render/dom.mjs',
    'state/tree.mjs', 'state/migrate-v0.mjs',
    // P1
    'net/sse.mjs', 'net/delta.mjs', 'net/errors.mjs', 'net/request.mjs',
    // P2
    'ctx/tokens.mjs', 'ctx/budget.mjs', 'app/transfer-format.mjs',
    // P3
    'blender/taint.mjs',
    // P4
    'recipes/recipe.mjs',
    // S0 (Studio rails; studio plan §2.1). S1's map/* entries are NOT here — S1 was replaced by
    // docs/LOLCHAT_COMPUTER_SPEC.md, whose own pure modules are listed at its kickoff.
    'app/json.mjs', 'app/studio-state.mjs', 'projects/memory.mjs',
    // C1 (the Computer panel; docs/LOLCHAT_COMPUTER_SPEC.md). The graph ENGINE is pure: the doc
    // and its mutations, topological order, the stale/run sets, value kinds and the undo stack.
    // graph/{panel,canvas,wires,store,runner}.mjs and graph/parts/* are NOT pure — they render,
    // persist and call the farm.
    'graph/model.mjs', 'graph/topo.mjs', 'graph/values.mjs', 'graph/undo.mjs', 'graph/serialize.mjs',
    // C2
    'graph/fanout.mjs',
    // K2 (COMPUTER_PLAN §5.6): arrow labels bound as named parameters, and the prompt they
    // assemble. It touches no DOM and no farm, and its unit test is the most important in the
    // Computer build — which is only possible because it runs in Node.
    'graph/bind.mjs',
    // C3 (the sandbox parts, files and sharing)
    'graph/tidy.mjs', 'sandbox/protocol.mjs',
    // S2
    'preview/edit.mjs', 'preview/knobs.mjs', 'preview/brief.mjs',
    // S3
    'design/color.mjs', 'design/tokens.mjs', 'design/quantize.mjs', 'design/svg-sanitize.mjs',
    'design/areas.mjs', 'board/select.mjs', 'board/lint.mjs', 'board/scaffold.mjs',
];

// ---------------------------------------------------------------------------------------------
// source scanning
// ---------------------------------------------------------------------------------------------

const KEYWORDS_BEFORE_REGEX = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do',
    'else', 'yield', 'await',
]);

function lastWord(s) {
    let i = s.length - 1;
    while (i >= 0 && /\s/.test(s[i])) i--;
    let end = i + 1;
    while (i >= 0 && /[A-Za-z0-9_$]/.test(s[i])) i--;
    return s.slice(i + 1, end);
}

/**
 * Replace // and block comments with spaces, keeping every newline (so line numbers survive) and
 * leaving string/template/regex literals untouched.
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let prevSig = '';
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (c === '/' && d === '/') {
            while (i < n && src[i] !== '\n') { out += ' '; i++; }
            continue;
        }
        if (c === '/' && d === '*') {
            out += '  '; i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
            if (i < n) { out += '  '; i += 2; }
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            const q = c;
            out += c; i++;
            while (i < n) {
                const ch = src[i];
                if (ch === '\\') { out += ch + (src[i + 1] || ''); i += 2; continue; }
                out += ch; i++;
                if (ch === q) break;
                if (ch === '\n' && q !== '`') break;
            }
            prevSig = q;
            continue;
        }
        if (c === '/') {
            const w = lastWord(out);
            const regexHere = !prevSig || KEYWORDS_BEFORE_REGEX.has(w) || !/[A-Za-z0-9_$)\]]/.test(prevSig);
            if (regexHere) {
                out += c; i++;
                let inClass = false;
                while (i < n) {
                    const ch = src[i];
                    if (ch === '\\') { out += ch + (src[i + 1] || ''); i += 2; continue; }
                    if (ch === '[') inClass = true;
                    else if (ch === ']') inClass = false;
                    out += ch; i++;
                    if (ch === '/' && !inClass) break;
                    if (ch === '\n') break;
                }
                prevSig = '/';
                continue;
            }
        }
        out += c;
        if (!/\s/.test(c)) prevSig = c;
        i++;
    }
    return out;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

function walk(dir, out = []) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------------------------

/** @typedef {{rule:number, file:string, line:number, message:string}} Violation */

/** Each entry: [regex, message]. Applied to COMMENT-STRIPPED source. */
const SINK_PATTERNS = [
    [/\.(?:inner|outer)HTML\s*(?:\+=|=(?!\s*(?:''|""|``)\s*[;,)\n]))/g, 'assignment to innerHTML/outerHTML (only `= \'\'` is allowed)'],
    [/insertAdjacentHTML/g, 'insertAdjacentHTML'],
    [/document\s*\.\s*write\b/g, 'document.write'],
    [/\.setHTML\s*\(/g, 'setHTML()'],
    [/(^|[^.\w$])eval\s*\(/g, 'eval()'],
    [/new\s+Function\s*\(/g, 'new Function()'],
    [/setTimeout\s*\(\s*['"]/g, 'setTimeout() with a string body'],
    [/srcdoc/g, 'srcdoc'],
];

const NET_PATTERNS = [
    [/blob:/g, 'blob: URL', (rel) => rel === 'ui/transfer.mjs' || rel === 'sandbox/protocol.mjs'],
    [/createObjectURL/g, 'createObjectURL', (rel) => rel === 'ui/transfer.mjs'],
    [/num_ctx/g, 'num_ctx (the farm sizes its own context; a client must never send it)'],
    [/\/embeddings/g, '/embeddings (documents are embedded LOCALLY, never on the farm)'],
    [/mailto:/g, 'mailto: (only http/https become links; everything else stays plain text)'],
    [/localStorage\s*\.\s*removeItem\s*\(/g, 'localStorage.removeItem()', (rel) => rel === 'state/migrate-v0.mjs'],
    [/new\s+Audio\s*\(/g, 'new Audio()'],
    [/<audio/gi, '<audio>'],
    [/createElement\s*\(\s*['"]audio['"]/g, "createElement('audio')"],
];

// Rules 10-13 (S0 kickoff, studio plan §2.4): ONE DOOR each. A door rule is a token that may
// appear in exactly the listed files (comment-stripped source) and nowhere else, so a new module
// cannot quietly grow a second way out of the renderer. Rules 9, 12 and 14 (the runner CSP, the
// iframe door, the vendored-library manifest) arrive at the S2 kickoff with the sandbox files
// they police — a door rule whose allowed file does not exist yet is simply a ban on the token.
const DOORS = [
    {
        rule: 10,
        what: 'the main process',
        allow: ['projects/bridge.mjs'],
        patterns: [/window\s*\.\s*lol\b/g, /\blol\s*\.\s*projects\b/g, /\bipcRenderer\b/g],
    },
    {
        rule: 11,
        what: 'the network',
        // app/caps.mjs was added at the S0-U2 build: studio plan §3.4.3 puts the ONE capability
        // GET (`/model_group/info`) in that file by name, and the S0 kickoff list omitted it, so
        // the rule as frozen made the specified module unwritable. Reported as a contract request;
        // the door itself is unchanged in spirit — one file, one GET, no POST.
        allow: ['net/farm.mjs', 'net/run.mjs', 'core/fakes.mjs', 'app/caps.mjs', 'sandbox/libs.mjs'],
        patterns: [/\bfetch\s*\(/g, /new\s+XMLHttpRequest\b/g, /new\s+EventSource\b/g, /navigator\s*\.\s*sendBeacon\b/g],
    },
    {
        rule: 13,
        what: 'a wall clock',
        allow: ['sandbox/host.mjs'],
        patterns: [/\bsetInterval\s*\(/g],
        note: 'everything wall-clock runs on EV.FARM_TICK (§3.9); rAF is not a clock',
    },
    // Rule 12 (C3 kickoff, studio plan §3.7.1): ONE module may make an iframe. A second one is a
    // second guest process and a second containment boundary to get right; the Computer's Render
    // part shows a SNAPSHOT for exactly this reason.
    {
        rule: 12,
        what: 'an iframe',
        allow: ['sandbox/host.mjs'],
        patterns: [/createElement\s*\(\s*['\"]iframe['\"]/g, /\bHTMLIFrameElement\b/g, /\bcontentWindow\b/g],
        note: 'the sandbox is the only guest surface (studio plan §3.7)',
    },
];

// Rule 14 (C3 kickoff, studio plan §3.7.5): the vendored libraries, byte-identical to upstream.
// A row per file: what it is, what it must hash to, where it came from, and its licence file.
// `sha256: null` means "not vendored yet" — the file must then be ABSENT. C3-U1 fills the hashes
// in the same edit that drops the files in, which is what makes "unmodified" checkable rather
// than merely claimed. Everything under sandbox/lib/ is SKIPPED by rules 1-8: it is upstream
// source, it will contain innerHTML, eval and colour literals, and we do not get to edit it.
const LIB_MANIFEST = [
    {
        name: 'three', file: 'sandbox/lib/three.min.js', licence: 'sandbox/lib/three.LICENSE.txt',
        version: 'r160 (three@0.160.1)', sha256: '170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa',
        upstream: 'https://registry.npmjs.org/three/-/three-0.160.1.tgz (package/build/three.min.js)',
        spdx: 'MIT',
    },
    {
        name: 'p5', file: 'sandbox/lib/p5.min.js', licence: 'sandbox/lib/p5.LICENSE.txt',
        version: '1.11.13', sha256: 'e9df7d05fd7c3ff028fc09a312a43101241f23c43143b387bf89d96b2e4e0849',
        upstream: 'https://registry.npmjs.org/p5/-/p5-1.11.13.tgz (package/lib/p5.min.js)',
        spdx: 'LGPL-2.1', note: 'LGPL: shipped verbatim, licence file included, replaceable via a project lib/ override',
    },
    {
        name: 'matter', file: 'sandbox/lib/matter.min.js', licence: 'sandbox/lib/matter.LICENSE.txt',
        version: '0.20.0', sha256: '72d30be0f579eb02ce1e0b6f9d359a4f392e6837e5a26ba8be5dbee7f88e24ae',
        upstream: 'https://registry.npmjs.org/matter-js/-/matter-js-0.20.0.tgz (package/build/matter.min.js)',
        spdx: 'MIT',
    },
];

const LIB_DIR = 'sandbox/lib/';
const LIB_BUDGET_BYTES = 2.0 * 1024 * 1024;
const LICENCE_BUDGET_BYTES = 40 * 1024;

// Rule 3: named colours worth catching. CSS keywords that are not colours are deliberately absent.
const NAMED_COLOURS = [
    'aqua', 'azure', 'beige', 'black', 'blue', 'brown', 'coral', 'crimson', 'cyan', 'fuchsia',
    'gold', 'gray', 'green', 'grey', 'indigo', 'ivory', 'khaki', 'lavender', 'lime', 'magenta',
    'maroon', 'navy', 'olive', 'orange', 'orchid', 'pink', 'plum', 'purple', 'red', 'salmon',
    'sienna', 'silver', 'tan', 'teal', 'tomato', 'turquoise', 'violet', 'wheat', 'white', 'yellow',
];

function stripCssComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** @returns {Violation[]} */
function lintCss(file, rel, raw) {
    const out = [];
    const src = stripCssComments(raw);
    // Only declaration VALUES can hold a colour; `#chat-messages {` is a selector, not a literal.
    const decl = /(^|[;{])\s*[-a-zA-Z_][-\w]*\s*:([^;{}]*)/g;
    let m;
    while ((m = decl.exec(src))) {
        const value = m[2];
        const at = m.index + m[0].length - value.length;
        const flag = (re, what) => {
            let x;
            const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
            while ((x = r.exec(value))) {
                out.push({ rule: 3, file: rel, line: lineOf(src, at + x.index), message: `colour literal (${what}: ${x[0].trim()}) — use var(--token) or color-mix()` });
            }
        };
        flag(/#[0-9a-fA-F]{3,8}\b/, 'hex');
        flag(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/, 'function');
        flag(new RegExp(`(?<![-\\w])(?:${NAMED_COLOURS.join('|')})(?![-\\w])`, 'i'), 'named');
    }
    return out;
}

/** @returns {Violation[]} */
function lintMjs(file, rel, raw, stringKeys, allFiles) {
    /** @type {Violation[]} */
    const out = [];
    const src = stripComments(raw);
    const push = (rule, index, message) => out.push({ rule, file: rel, line: lineOf(src, index), message });

    // 1. HTML sinks
    for (const [re, what] of SINK_PATTERNS) {
        const r = new RegExp(re.source, re.flags);
        let m;
        while ((m = r.exec(src))) push(1, m.index, `HTML sink: ${what}`);
    }

    // 2. network and storage
    for (const [re, what, allow] of NET_PATTERNS) {
        if (allow && allow(rel)) continue;
        const r = new RegExp(re.source, re.flags);
        let m;
        while ((m = r.exec(src))) push(2, m.index, `forbidden: ${what}`);
    }

    // 10-13. one door each (S0 kickoff). Inside an allowed file the token is fine; everywhere else
    // it is a violation naming the file that owns the door.
    for (const door of DOORS) {
        if (door.allow.includes(rel)) {
            if (door.rule === 11) {                       // the network door may not reach the disk
                const fileToken = /\bfetch\s*\([^;\n]{0,200}/g;
                let f;
                while ((f = fileToken.exec(src))) {
                    if (/file:/.test(f[0])) push(11, f.index, 'fetch() with a file: URL — the network door never reads the disk');
                }
            }
            continue;
        }
        for (const re of door.patterns) {
            const r = new RegExp(re.source, re.flags);
            let d;
            while ((d = r.exec(src))) {
                push(door.rule, d.index, `one door to ${door.what}: \`${d[0].trim()}\` may appear only in ${door.allow.join(', ')}`
                    + (door.note ? ` — ${door.note}` : ''));
            }
        }
    }

    // 5. strings.
    // 5a. the first argument of t() — scanned on the COMMENT-STRIPPED source, because a JSDoc type
    //     cast sits between `t(` and the argument (`t(/** @type {any} */ (LABEL)[kind])`) and prose
    //     in a header comment is documentation, not a call.
    const isDefinition = (before) => /(?:function|const|let|var)\s+$/.test(before) || /\.\s*$/.test(before) === false && /\bfunction\s+$/.test(before);
    let m;
    if (rel !== 'core/i18n.mjs') {                    // the module that DEFINES t
        const tCall = /\bt\s*\(/g;
        while ((m = tCall.exec(src))) {
            const before = src.slice(Math.max(0, m.index - 20), m.index);
            if (/(?:function|const|let|var)\s+$/.test(before)) continue;   // `function t(`
            const arg = src.slice(m.index + m[0].length, m.index + m[0].length + 160).replace(/^\s+/, '');
            if (/^['"]/.test(arg)) continue;                                // t('ns.key')
            const head = arg.replace(/^[(\s]+/, '');
            const map = head.match(/^([A-Za-z_$][\w$]*)\s*\)?\s*\[/);
            if (map) {
                const name = map[1];
                const declared = new RegExp(`(?:const|let|var)\\s+${name}\\s*=[^;{]{0,60}\\{`).test(src);
                if (declared) continue;                                     // t(LABEL[kind])
                push(5, m.index, `t(${name}[…]) but no literal map \`const ${name} = {…}\` in this file`);
                continue;
            }
            push(5, m.index, `t() needs a string literal or a same-file literal map, got: t(${arg.split('\n')[0].slice(0, 40)}`);
        }
    }
    // every 'ns.key'-shaped literal must exist. Reads the COMMENT-STRIPPED source (plan 2.6 R): a
    // doc comment may name a key as an EXAMPLE (core/i18n.mjs header) without that key existing.
    // core/registry.mjs is exempt entirely: its SLOTS values ('composer.actions', 'sidebar.threadMenu',
    // ...) are extension-slot NAMES that share the namespace vocabulary and are never passed to t().
    const keyLiteral = /(['"])([a-z][a-zA-Z0-9]*)\.([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\1/g;
    const FILE_EXT = new Set(['mjs', 'js', 'cjs', 'css', 'html', 'json', 'png', 'svg', 'md', 'txt', 'map']);
    while (rel !== 'core/registry.mjs' && (m = keyLiteral.exec(src))) {
        const ns = m[2];
        const key = m[3];
        if (!stringKeys.namespaces.has(ns)) continue;          // not a strings namespace at all
        if (FILE_EXT.has(key)) continue;                        // 'core.mjs' and friends
        if (rel.startsWith('strings/')) continue;               // the tables themselves
        if (!stringKeys.keys.has(`${ns}.${key}`)) push(5, m.index, `unknown string key '${ns}.${key}' (not registered in strings/)`);
    }
    if (rel.startsWith('ui/')) {
        const hard = /\.textContent\s*=\s*(['"])([^'"]*[A-Za-z][^'"]*)\1/g;
        while ((m = hard.exec(raw))) push(5, m.index, `hard-coded UI text: .textContent = ${m[1]}${m[2]}${m[1]} — use t()`);
    }

    // 6. // @ts-check on line 1 (raw)
    if (raw.split('\n')[0].trim() !== '// @ts-check') push(6, 0, 'line 1 must be exactly `// @ts-check`');

    // 7. the drop guard never stops propagation
    if (rel === 'ui/layout.mjs') {
        const r = /stopPropagation/g;
        while ((m = r.exec(src))) push(7, m.index, 'stopPropagation in ui/layout.mjs: the drop guard must preventDefault ONLY');
    }

    void allFiles;
    return out;
}

/** Collect every registered string key by importing the strings modules (they are pure). */
async function readStringKeys(root) {
    const dir = path.join(root, 'strings');
    const result = { keys: new Set(), namespaces: new Set(), files: [] };
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')); } catch { return result; }
    const { pathToFileURL } = require('url');
    // Imported WITHOUT a cache-busting query, so the strings files (which import
    // '../core/i18n.mjs' relatively) register into this very instance. Each lint root is a
    // different path, so a temp copy gets its own i18n instance and cannot see this one's keys.
    const i18n = await import(pathToFileURL(path.join(root, 'core', 'i18n.mjs')).href);
    for (const f of files) {
        result.files.push(f);
        await import(pathToFileURL(path.join(dir, f)).href);
    }
    for (const key of i18n.allKeys()) {
        result.keys.add(key);
        result.namespaces.add(key.split('.')[0]);
    }
    return result;
}

/** Rule 4: every existing PURE_MODULES entry imports with the DOM/storage globals trapped. */
async function lintPure(root, notes) {
    /** @type {Violation[]} */
    const out = [];
    const { pathToFileURL } = require('url');
    const names = ['window', 'document', 'localStorage', 'indexedDB'];
    const saved = names.map((n) => Object.getOwnPropertyDescriptor(globalThis, n));
    for (const n of names) {
        Object.defineProperty(globalThis, n, { configurable: true, get() { throw new Error(`pure module touched ${n}`); } });
    }
    try {
        for (const rel of PURE_MODULES) {
            const file = path.join(root, rel);
            if (!fs.existsSync(file)) { notes.push(`pure module not written yet, skipped: ${rel}`); continue; }
            try {
                const mod = await import(pathToFileURL(file).href + `?pure=${Date.now()}${Math.random()}`);
                if (!mod || Object.keys(mod).length === 0) {
                    out.push({ rule: 4, file: rel, line: 1, message: 'pure module exports nothing' });
                }
            } catch (e) {
                out.push({ rule: 4, file: rel, line: 1, message: `not pure: ${e && e.message ? e.message.split('\n')[0] : e}` });
            }
        }
    } finally {
        names.forEach((n, i) => {
            if (saved[i]) Object.defineProperty(globalThis, n, saved[i]);
            else delete globalThis[n];
        });
    }
    return out;
}

/**
 * 8. RAW CONTROL CHARACTERS. A literal NUL (or any other C0 byte) in the source makes the file
 * BINARY to grep/ripgrep and to `git diff`'s heuristics: `grep -n localStorage <file>` answers
 * "Binary file ... matches" and prints nothing, so the file silently drops out of every content
 * search — which is how three `` separators sat unnoticed inside template literals in
 * state/migrate-v0.mjs, the one module that touches the user's v1 history. Write the escape
 * (``), never the byte. Tabs, newlines and carriage returns are of course fine.
 * @returns {Violation[]}
 */
function lintControlChars(rel, raw) {
    /** @type {Violation[]} */
    const out = [];
    const re = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
    let m;
    while ((m = re.exec(raw))) {
        const code = 'U+' + m[0].charCodeAt(0).toString(16).padStart(4, '0').toUpperCase();
        out.push({ rule: 8, file: rel, line: lineOf(raw, m.index), message: `raw control character in the source (${code}) — write the escape, not the byte` });
    }
    return out;
}

/**
 * 9. THE RUNNER CSP IS BYTE-FROZEN. sandbox/runner.html's Content-Security-Policy must equal
 * RUNNER_CSP in sandbox/protocol.mjs, character for character. It is the whole containment
 * argument: no 'self' anywhere means the guest can load NOTHING from disk, and connect-src 'none'
 * means it can reach no network — including the farm on the LAN. A "small" edit here (a 'self'
 * added to make a stylesheet load) silently reopens both.
 * @returns {Violation[]}
 */
function lintRunnerCsp(root, notes) {
    /** @type {Violation[]} */
    const out = [];
    const html = path.join(root, 'sandbox', 'runner.html');
    const proto = path.join(root, 'sandbox', 'protocol.mjs');
    if (!fs.existsSync(html) || !fs.existsSync(proto)) {
        notes.push('rule 9: sandbox/runner.html not present yet — skipped');
        return out;
    }
    const raw = fs.readFileSync(html, 'utf8');
    const protoSrc = fs.readFileSync(proto, 'utf8');
    const frozen = (protoSrc.match(/export const RUNNER_CSP\s*=\s*"([^"]+)"/) || [])[1];
    if (!frozen) {
        out.push({ rule: 9, file: 'sandbox/protocol.mjs', line: 1, message: 'RUNNER_CSP is not a plain double-quoted string literal — rule 9 cannot compare it' });
        return out;
    }
    const meta = raw.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*>/i);
    if (!meta) {
        out.push({ rule: 9, file: 'sandbox/runner.html', line: 1, message: 'no Content-Security-Policy meta in the sandbox runner' });
        return out;
    }
    if (meta[1] !== frozen) {
        out.push({ rule: 9, file: 'sandbox/runner.html', line: lineOf(raw, meta.index), message: 'the runner CSP is not byte-identical to RUNNER_CSP in sandbox/protocol.mjs' });
    }
    // HTML comments are documentation: this file SAYS 'no allow-same-origin, ever'.
    const bare = raw.replace(/<!--[\s\S]*?-->/g, (m) => m.split('\n').map((l) => ' '.repeat(l.length)).join('\n'));
    if (/allow-same-origin/.test(bare)) {
        out.push({ rule: 12, file: 'sandbox/runner.html', line: lineOf(bare, bare.indexOf('allow-same-origin')), message: 'allow-same-origin in the sandbox runner — the opaque origin IS the containment' });
    }
    return out;
}

/**
 * 14. VENDORED LIBRARIES ARE UNMODIFIED. Every file under sandbox/lib/ must be a LIB_MANIFEST row,
 * must hash to the sha256 the row names, and must ship its licence file next to it. A library with
 * sha256:null is not vendored yet and must be absent. The budget of studio plan §3.7.5 is checked
 * here too, so "it got big" is a gate failure rather than a discovery at packaging time.
 * @returns {Violation[]}
 */
function lintLibs(root, notes) {
    /** @type {Violation[]} */
    const out = [];
    const dir = path.join(root, 'sandbox', 'lib');
    const known = new Map(LIB_MANIFEST.map((r) => [r.file, r]));
    let libBytes = 0;
    let licBytes = 0;
    for (const row of LIB_MANIFEST) {
        const abs = path.join(root, row.file);
        const here = fs.existsSync(abs);
        if (!row.sha256) {
            if (here) out.push({ rule: 14, file: row.file, line: 1, message: row.name + ' is present but its LIB_MANIFEST row has no sha256 — record the hash, version and licence in the same edit' });
            continue;
        }
        if (!here) {
            out.push({ rule: 14, file: row.file, line: 1, message: row.name + ' is in LIB_MANIFEST but the file is missing' });
            continue;
        }
        const bytes = fs.readFileSync(abs);
        libBytes += bytes.length;
        const sha = crypto.createHash('sha256').update(bytes).digest('hex');
        if (sha !== row.sha256) {
            out.push({ rule: 14, file: row.file, line: 1, message: row.name + ' does not match its pinned sha256 — a vendored library ships UNMODIFIED (got ' + sha.slice(0, 16) + ')' });
        }
        const lic = path.join(root, row.licence);
        if (!fs.existsSync(lic)) out.push({ rule: 14, file: row.licence, line: 1, message: row.name + ' (' + row.spdx + ') ships without its licence file' });
        else licBytes += fs.statSync(lic).size;
    }
    if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir)) {
            const rel = LIB_DIR + name;
            if (known.has(rel)) continue;
            if (LIB_MANIFEST.some((r) => r.licence === rel)) continue;
            if (name === 'README.md') continue;
            out.push({ rule: 14, file: rel, line: 1, message: 'a file in sandbox/lib/ with no LIB_MANIFEST row — every vendored byte is declared' });
        }
    }
    if (libBytes > LIB_BUDGET_BYTES) out.push({ rule: 14, file: LIB_DIR, line: 1, message: 'vendored libraries are ' + (libBytes / 1048576).toFixed(2) + ' MB, over the 2.0 MB budget (studio plan §3.7.5: drop matter.js first)' });
    if (licBytes > LICENCE_BUDGET_BYTES) out.push({ rule: 14, file: LIB_DIR, line: 1, message: 'licence files are ' + (licBytes / 1024).toFixed(0) + ' KB, over the 40 KB budget' });
    notes.push('rule 14: ' + LIB_MANIFEST.filter((r) => r.sha256).length + '/' + LIB_MANIFEST.length + ' libraries vendored, ' + (libBytes / 1024).toFixed(0) + ' KB');
    return out;
}

/**
 * @param {string} root the chat/ directory to lint
 * @returns {Promise<{violations: Violation[], notes: string[], files: number}>}
 */
async function lint(root) {
    /** @type {Violation[]} */
    let violations = [];
    /** @type {string[]} */
    const notes = [];
    if (!fs.existsSync(root)) return { violations: [{ rule: 0, file: root, line: 1, message: 'chat tree not found' }], notes, files: 0 };

    const files = walk(root).map((abs) => ({ abs, rel: path.relative(root, abs).split(path.sep).join('/') }));
    const stringKeys = await readStringKeys(root);
    notes.push(`${stringKeys.keys.size} string keys in ${stringKeys.files.length} strings file(s)`);

    for (const { abs, rel } of files) {
        // Vendored upstream builds are checked by rule 14 (hash + licence), never by rules 1-8:
        // they are not ours to edit, so a finding in one has no fix that keeps invariant #1.
        if (rel.startsWith(LIB_DIR)) continue;
        const raw = fs.readFileSync(abs, 'utf8');
        violations = violations.concat(lintControlChars(rel, raw));
        if (rel.endsWith('.mjs')) violations = violations.concat(lintMjs(abs, rel, raw, stringKeys, files));
        else if (rel.endsWith('.css')) violations = violations.concat(lintCss(abs, rel, raw));
    }
    violations = violations.concat(lintRunnerCsp(root, notes));
    violations = violations.concat(lintLibs(root, notes));
    violations = violations.concat(await lintPure(root, notes));
    violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule - b.rule);
    return { violations, notes, files: files.length };
}

// ---------------------------------------------------------------------------------------------
// self-test: plant one violation per rule in a temp copy
// ---------------------------------------------------------------------------------------------

function copyTree(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, e.name);
        const d = path.join(dst, e.name);
        if (e.isDirectory()) copyTree(s, d);
        else fs.copyFileSync(s, d);
    }
}

/** Insert `code` into a file, after its last import line (so it lands in CODE, never a comment). */
function plantInModule(file, code) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    let at = 0;
    lines.forEach((l, i) => { if (/^import\s|^const .* = require/.test(l)) at = i + 1; });
    lines.splice(at, 0, code);
    fs.writeFileSync(file, lines.join('\n'));
}

const CASES = [
    // C3 kickoff: the three sandbox rules. Each plants the exact mistake it exists to catch.
    {
        name: 'the runner CSP was edited',
        rule: 9,
        plant: (root) => {
            const f = path.join(root, 'sandbox', 'runner.html');
            const src = fs.readFileSync(f, 'utf8');
            fs.writeFileSync(f, src.replace("default-src 'none';", "default-src 'self';"));
        },
    },
    {
        name: 'allow-same-origin on the sandbox iframe',
        rule: 12,
        plant: (root) => {
            const f = path.join(root, 'sandbox', 'runner.html');
            fs.appendFileSync(f, '<div data-sandbox="allow-scripts allow-same-origin"></div>');
        },
    },
    {
        // Restored at the C3-U1 build after I clobbered it with a bad scripted edit (reported):
        // the second half of rule 12 — a SECOND iframe anywhere in the chat tree is a second guest
        // process and a second containment boundary to get right.
        name: 'a second iframe outside sandbox/host.mjs',
        rule: 12,
        plant: (root) => plantInModule(path.join(root, 'ui', 'layout.mjs'), "export const plantedFrame = () => document.createElement('iframe');"),
    },
    {
        name: 'an undeclared file in sandbox/lib/',
        rule: 14,
        plant: (root) => {
            fs.mkdirSync(path.join(root, 'sandbox', 'lib'), { recursive: true });
            fs.writeFileSync(path.join(root, 'sandbox', 'lib', 'sneaky.js'), '// planted\n');
        },
    },
    {
        // Added at the C3-U1 build, when real bytes first landed under sandbox/lib/: until then the
        // hash branch of rule 14 had never run against a file. "Unmodified" is only a checkable
        // fact if a modification is actually caught.
        name: 'a patched vendored library',
        rule: 14,
        plant: (root) => {
            const f = path.join(root, 'sandbox', 'lib', 'matter.min.js');
            if (!fs.existsSync(f)) throw new Error('no vendored matter.min.js to patch');
            fs.appendFileSync(f, '/* planted */');
        },
    },
    {
        name: 'innerHTML = x',
        rule: 1,
        plant: (root) => plantInModule(path.join(root, 'ui', 'layout.mjs'), 'export function planted(el, x) { el.innerHTML = x; }'),
    },
    {
        name: 'colour literal',
        rule: 3,
        plant: (root) => fs.appendFileSync(path.join(root, 'css', 'base.css'), '\n.chat-planted { color: #ff00aa; background: rgb(1,2,3); border-color: red; }\n'),
    },
    {
        name: 't(variable)',
        rule: 5,
        plant: (root) => plantInModule(path.join(root, 'ui', 'layout.mjs'), 'export function planted2(key) { return t(key); }'),
    },
    {
        name: 'missing string key',
        rule: 5,
        plant: (root) => plantInModule(path.join(root, 'ui', 'layout.mjs'), "export function planted3() { return t('core.thisKeyDoesNotExist'); }"),
    },
    {
        name: 'stopPropagation in layout',
        rule: 7,
        plant: (root) => plantInModule(path.join(root, 'ui', 'layout.mjs'), 'export function planted4(e) { e.stopPropagation(); }'),
    },
    {
        name: 'window.lol outside the bridge',
        rule: 10,
        plant: (root) => plantInModule(path.join(root, 'core', 'app.mjs'), 'export const plantedDoor = () => window.lol;'),
    },
    {
        name: 'fetch outside net/',
        rule: 11,
        plant: (root) => plantInModule(path.join(root, 'core', 'app.mjs'), 'export const plantedNet = (u) => fetch(u);'),
    },
    {
        name: 'fetch of a file: URL inside the network door',
        rule: 11,
        plant: (root) => plantInModule(path.join(root, 'net', 'run.mjs'), "export const plantedDisk = () => fetch('file:///etc/passwd');"),
    },
    {
        name: 'setInterval',
        rule: 13,
        plant: (root) => plantInModule(path.join(root, 'core', 'app.mjs'), 'export const plantedClock = (fn) => setInterval(fn, 1000);'),
    },
    {
        name: 'mailto:',
        rule: 2,
        plant: (root) => plantInModule(path.join(root, 'core', 'app.mjs'), "export const PLANTED_SCHEMES = ['http:', 'https:', 'mailto:'];"),
    },
    {
        name: 'num_ctx',
        rule: 2,
        plant: (root) => plantInModule(path.join(root, 'core', 'app.mjs'), 'export const plantedBody = { num_ctx: 8192 };'),
    },
    {
        name: 'new Audio(',
        rule: 2,
        plant: (root) => plantInModule(path.join(root, 'core', 'app.mjs'), "export function plantedPlay(url) { return new Audio(url); }"),
    },
    {
        name: 'hard-coded UI text',
        rule: 5,
        plant: (root) => plantInModule(path.join(root, 'ui', 'layout.mjs'), "export function planted5(el) { el.textContent = 'Send it now'; }"),
    },
    {
        name: 'missing // @ts-check',
        rule: 6,
        plant: (root) => {
            const f = path.join(root, 'core', 'ids.mjs');
            fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^\/\/ @ts-check\n/, ''));
        },
    },
    {
        name: 'impure "pure" module',
        rule: 4,
        plant: (root) => plantInModule(path.join(root, 'core', 'ids.mjs'), 'export const PLANTED_WIDTH = window.innerWidth;'),
    },
    {
        name: 'a raw NUL byte in the source',
        rule: 8,
        plant: (root) => plantInModule(path.join(root, 'core', 'app.mjs'),
            `export const PLANTED_SEP = 'a${String.fromCharCode(0)}b';`),
    },
    {
        name: 'a comment naming a missing string key is NOT a violation (§2.6 R)',
        rule: null,
        plant: (root) => fs.appendFileSync(path.join(root, 'core', 'app.mjs'),
            "\n// documentation only: t('core.noSuchKeyAnywhere'), like the 'sidebar.group.today' example in i18n.mjs\n"),
    },
    {
        name: 'a registry SLOT name is not a string key (§2.6 R)',
        rule: null,
        plant: (root) => fs.appendFileSync(path.join(root, 'core', 'registry.mjs'),
            "\nexport const PLANTED_SLOT = 'composer.plantedSlotName';\n"),
    },
    {
        name: 'a comment naming a forbidden token is NOT a violation (§2.6 C)',
        rule: null,
        plant: (root) => plantInModule(path.join(root, 'core', 'app.mjs'), '// we never set num_ctx, never use innerHTML = x, and never call stopPropagation\n/* nor mailto: nor new Audio( */'),
    },
];

async function selfTest() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-lint-selftest-'));
    let failures = 0;
    // Planting shifts line numbers, so the baseline is keyed on rule+file+message: a case passes
    // when it produces a violation the UNPLANTED tree does not already have. (Other builders may
    // have the tree mid-edit; that shows as a warning, not as a broken self-test.)
    const baseline = await lint(CHAT_DIR);
    const baseKeys = new Set(baseline.violations.map((v) => `${v.rule}|${v.file}|${v.message}`));
    if (baseline.violations.length) {
        console.log(`warning: the real tree already has ${baseline.violations.length} violation(s); the self-test judges only NEW ones`);
    }
    for (const c of CASES) {
        const root = path.join(tmp, c.name.replace(/[^\w]+/g, '_'), 'chat');
        copyTree(CHAT_DIR, root);
        c.plant(root);
        const all = (await lint(root)).violations;
        const violations = all.filter((v) => !baseKeys.has(`${v.rule}|${v.file}|${v.message}`));
        const hit = c.rule === null ? violations.length === 0 : violations.some((v) => v.rule === c.rule);
        if (hit) {
            console.log(`ok   self-test: ${c.name}${c.rule ? ` → rule ${c.rule}` : ' → no violation, as expected'}`);
        } else {
            failures++;
            console.log(`FAIL self-test: ${c.name}: expected ${c.rule === null ? 'no violation' : `rule ${c.rule}`}, got ${JSON.stringify(violations.map((v) => `${v.rule}:${v.file}:${v.line}`))}`);
        }
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows locks */ }
    console.log(failures ? `${failures} self-test case(s) failed` : `all ${CASES.length} self-test cases passed`);
    return failures ? 1 : 0;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--list-pure')) {
        for (const rel of PURE_MODULES) {
            console.log(`${fs.existsSync(path.join(CHAT_DIR, rel)) ? 'present' : 'pending'}  ${rel}`);
        }
        return 0;
    }
    if (args.includes('--self-test')) return selfTest();

    const { violations, notes, files } = await lint(CHAT_DIR);
    for (const n of notes) console.log(`note: ${n}`);
    for (const v of violations) console.log(`rule ${v.rule}  ${v.file}:${v.line}  ${v.message}`);
    console.log(`${files} file(s) scanned, ${violations.length} violation(s)`);
    return violations.length ? 1 : 0;
}

module.exports = { lint, PURE_MODULES, stripComments };

if (require.main === module) {
    main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
}
