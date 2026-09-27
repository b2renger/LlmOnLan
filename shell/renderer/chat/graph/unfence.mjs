// @ts-check
// K5-U1 (addendum KE-3): what an answer that IS code looks like once it lands in a box, and what
// the sandbox guest is handed so that code DRAWS. PURE — no DOM, no storage — so every rule below
// is proven in Node (test/chat/unit/computer-creative.test.mjs).
//
// A local 12B model asked for "only the SVG" still answers "Here is your SVG:\n```svg\n…\n```"
// often enough that a picture box which trusted the raw text would show an error most of the time.
// So the answer is unwrapped HERE, once, before it becomes a value — and a creative box unwraps
// what arrives on its wire too (`codeFor`), so an ordinary Instruction wired into an SVG box works.
//
// THE LINE-NUMBER RULE. The guest reports an error's line in the code it RAN. A person reads the
// line in the code they SEE. `shapeForGuest` therefore never adds or removes a line before the
// person's last line: what it needs to run first is written on the person's line 1, and what it
// needs to run after is appended below the end. Line N in the box is line N in the guest.
//
// NOTHING HERE MAY CONTAIN a lint-forbidden token even inside a string (rules 1, 2, 11, 13).

import { t } from '../core/i18n.mjs';
import '../strings/computer-gen.en.mjs';

/** The four code kinds an Instruction can be asked to answer in. Frozen: the `code` setting of
 * `ask` is '' or one of these. */
export const CODE_KINDS = Object.freeze(['p5', 'three', 'svg', 'html']);

/** The advisory facets (COMPUTER_PLAN §6.8) each code kind stamps on its value. A Preview in
 * `auto` mode reads exactly these to pick how to draw. Frozen. */
export const CODE_FACETS = Object.freeze({
  p5: Object.freeze({ format: 'js', lang: 'p5' }),
  three: Object.freeze({ format: 'js', lang: 'three' }),
  svg: Object.freeze({ format: 'svg' }),
  html: Object.freeze({ format: 'html' }),
});

// A fenced block. The closing fence may sit on its own line (the norm) or be GLUED to the last
// line of code (`<p>hi</p>```` — a model that forgets the newline); it must end its line either way.
const FENCE = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([\w.+#-]*)[^\n]*\n([\s\S]*?)(?:\n[ \t]*)?\2[ \t]*(?=\n|$)/g;

/** An opening fence line, for an answer whose closing fence never came (a truncated answer, or a
 * model that omits it). */
const OPENER = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([\w.+#-]*)[^\n]*\n/;

/** A lone closing fence on the last line, for an answer that has one but no opener. */
const TRAILING_CLOSER = /\n[ \t]*(`{3,}|~{3,})[ \t]*$/;

/** Which fence languages are the right SHAPE for each kind a box draws (a Write-… `code`, or a
 * Preview mode). */
const LANGS_FOR = Object.freeze({
  p5: ['js', 'javascript', 'p5', 'p5js', 'p5.js', 'mjs', 'jsx'],
  three: ['js', 'javascript', 'three', 'threejs', 'three.js', 'mjs', 'jsx'],
  svg: ['svg', 'xml'],
  html: ['html', 'htm', 'xhtml'],
});

/**
 * The code inside a markdown fence, or the text itself when there is none.
 * Among several fenced blocks, the one whose language is the right shape for `want` (a code kind
 * or a Preview mode — `html` for an HTML page, `svg`, `js`/`javascript` for a sketch) wins; among
 * those — or among all when none match or `want` is not given — the LONGEST: a model that shows a
 * one-line usage example before the real program must not have the example drawn, and an HTML
 * page followed by a longer stylesheet must not have the stylesheet drawn. An opening fence with
 * no closing one (a truncated answer) is unwrapped too: the code is everything after it. Frozen
 * signature (KE-3); `want` is optional.
 * @param {string} text @param {string} [want]
 * @returns {{code: string, lang: string, fenced: boolean}}
 */
export function unfence(text, want) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const langs = /** @type {any} */ (LANGS_FOR)[String(want || '')] || null;
  /** @type {{code: string, lang: string}|null} */ let best = null;
  /** @type {{code: string, lang: string}|null} */ let bestMatch = null;
  FENCE.lastIndex = 0;
  let m;
  while ((m = FENCE.exec(src))) {
    const block = { code: m[4], lang: String(m[3] || '').toLowerCase() };
    if (!best || block.code.length > best.code.length) best = block;
    if (langs && langs.indexOf(block.lang) >= 0 && (!bestMatch || block.code.length > bestMatch.code.length)) bestMatch = block;
  }
  const pick = bestMatch || best;
  if (pick) return { code: pick.code.trim(), lang: pick.lang, fenced: true };
  const open = OPENER.exec(src);
  if (open) return { code: src.slice(open.index + open[0].length).trim(), lang: String(open[3] || '').toLowerCase(), fenced: true };
  if (TRAILING_CLOSER.test(src)) return { code: src.replace(TRAILING_CLOSER, '').trim(), lang: '', fenced: true };
  return { code: src.trim(), lang: '', fenced: false };
}

/**
 * An Instruction's text answer as a value of the right SHAPE for a creative box: unfenced, and
 * stamped with the facets its kind declares. An unknown/empty `code` is a plain text value,
 * exactly what the Instruction returned before K5. Frozen (KE-3).
 * @param {string} text @param {string} code
 * @returns {{kind: 'text', data: string, format?: string, lang?: string}}
 */
export function codeValue(text, code) {
  const kind = String(code || '');
  if (CODE_KINDS.indexOf(kind) < 0) return { kind: 'text', data: String(text == null ? '' : text) };
  let data = unfence(text, kind).code;
  if (kind === 'p5' || kind === 'three') data = scriptOf(data);
  return { kind: 'text', data, .../** @type {any} */ (CODE_FACETS)[kind] };
}

/**
 * Critic R1 A8: a sketch that came back as a WEB PAGE. Asked for p5 or three.js, a 12B model often
 * answers with a whole HTML document — a CDN `<script src>`, maybe an import map, and the program
 * in an inline `<script>` (fenced ```html, or not fenced at all). Run as JavaScript that is
 * "Unexpected token '<'". When the code starts with `<`, the program is the LARGEST inline
 * `<script>` that has no `src` and is not an import map; a script that never closed (a truncated
 * answer) runs to the end. Anything else is returned untouched.
 * @param {string} code @returns {string}
 */
export function scriptOf(code) {
  const src = String(code == null ? '' : code);
  if (!/^\s*</.test(src)) return src;
  const OPEN = /<script\b([^>]*)>/gi;
  /** @type {string} */ let best = '';
  let found = false;
  let m;
  while ((m = OPEN.exec(src))) {
    const attrs = String(m[1] || '');
    const from = m.index + m[0].length;
    const close = src.slice(from).search(/<\/script\s*>/i);
    const body = close >= 0 ? src.slice(from, from + close) : src.slice(from);
    if (close >= 0) OPEN.lastIndex = from + close;
    if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*["']?importmap\b/i.test(attrs)) continue;
    if (/\btype\s*=\s*["']?(?!module\b|text\/javascript\b|application\/javascript\b)[\w/+-]+/i.test(attrs)) continue;
    if (!found || body.trim().length > best.trim().length) { best = body; found = true; }
  }
  return found && best.trim() ? dedent(best) : src;
}

/** Strip the indentation an inline script carries inside its page, so line 1 starts at column 0
 * (the p5 trailer's instance-mode check reads a column-0 `return`). @param {string} text */
function dedent(text) {
  const lines = String(text).replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  /** @param {string} l */
  const lead = (l) => l.length - l.replace(/^[ \t]+/, '').length;
  let pad = Infinity;
  for (const l of lines) if (l.trim()) pad = Math.min(pad, lead(l));
  if (!Number.isFinite(pad) || pad === 0) return lines.join('\n');
  return lines.map((l) => l.slice(Math.min(pad, lead(l)))).join('\n');
}

/**
 * The code a creative box draws from text that ARRIVED on its wire, for the mode it draws in.
 * Unfenced first; then, for the two markup modes, the prose a model wraps around unfenced markup
 * is cut away — "Here is your SVG: <svg…></svg> Enjoy!" draws the `<svg…></svg>`. JavaScript is
 * never cut: there is no honest way to tell a model's sentence from a line of a sketch.
 * @param {string} mode a Preview mode @param {string} text @returns {string}
 */
export function codeFor(mode, text) {
  const code = unfence(text, mode).code;
  if (mode === 'svg') return svgOf(code);
  if (mode === 'html') return htmlOf(code);
  if (mode === 'p5' || mode === 'three') return scriptOf(code);
  return code;
}

/** @param {string} code */
function svgOf(code) {
  if (/^\s*(?:<\?xml|<svg[\s>]|<!--|<!doctype)/i.test(code)) return code;
  const from = code.search(/<svg[\s>]/i);
  const to = code.toLowerCase().lastIndexOf('</svg>');
  return from >= 0 && to > from ? code.slice(from, to + 6).trim() : code;
}

/** @param {string} code */
function htmlOf(code) {
  if (/^\s*</.test(code)) return code;
  const m = /(^|\n)[ \t]*<(?:!doctype|[a-z][\w-]*)[\s>/]/i.exec(code);
  if (!m) return code;
  const cut = code.slice(m.index + m[1].length);
  const end = cut.lastIndexOf('>');
  return end > 0 ? cut.slice(0, end + 1).trim() : cut.trim();
}

// ---------------------------------------------------------------------------------------------
// shaping code for the guest
// ---------------------------------------------------------------------------------------------

/** The p5 handlers global mode looks for on `window`. */
export const P5_HANDLERS = Object.freeze([
  'preload', 'setup', 'draw', 'mousePressed', 'mouseReleased', 'mouseMoved', 'mouseDragged',
  'mouseClicked', 'doubleClicked', 'mouseWheel', 'keyPressed', 'keyReleased', 'keyTyped',
  'windowResized',
]);

/** An ESM import of the libraries the guest already has as globals. Inside the guest's function
 * body an `import` line is a syntax error, and the library is loaded anyway, so the line is
 * blanked — BLANKED, not removed, so every line below it keeps its number. */
const IMPORT_LINE = /^[ \t]*import\s[^\n;]*?from\s*['"][^'"]*\b(?:three|p5)\b[^'"]*['"][ \t]*;?[ \t]*$/gm;

/**
 * The p5 hand-off, appended BELOW the sketch. Three facts it exists for:
 *  1. The guest runs a sketch inside a function (`sandbox/runner.html` doRun), so p5 GLOBAL mode —
 *     `function setup() {…}`, what every tutorial and every model writes — declares `setup` where
 *     p5 never looks. Each declared handler is handed to `window`.
 *  2. A handler this sketch does NOT declare must not be a previous sketch's: `typeof draw` inside
 *     the body falls through to `window.draw` when the sketch has none. Every function handed over
 *     is tagged `__lolHanded`, so a leftover is recognised and cleared, never re-run.
 *  3. The guest is an off-screen frame, where the browser throttles animation frames, and the box
 *     shows a PICTURE taken right after the run. A sketch that paints only in `draw()` would be
 *     photographed blank. So `setup` is wrapped to paint the first frame once, synchronously — the
 *     frame p5 would have painted next anyway — unless the sketch called `noLoop()`, in which case
 *     p5 paints it itself and a second call would draw it twice.
 */
function p5Trailer() {
  const rest = P5_HANDLERS.filter((n) => n !== 'setup').map((n) =>
    `window.${n} = typeof ${n} === 'function' && !${n}.__lolHanded ? ${n} : undefined;\n`
    + `if (window.${n}) window.${n}.__lolHanded = true;`);
  return [
    ';',
    ...rest,
    "var __lolSetup = typeof setup === 'function' && !setup.__lolHanded ? setup : undefined;",
    'window.setup = __lolSetup || window.draw ? function () {',
    '  if (__lolSetup) __lolSetup.apply(this, arguments);',
    "  if (typeof window.draw === 'function' && (typeof window.isLooping !== 'function' || window.isLooping())) window.draw();",
    '} : undefined;',
    'if (window.setup) window.setup.__lolHanded = true;',
    '',
  ].join('\n');
}

/**
 * The three.js prelude, written on the person's LINE 1 (see the line-number rule). A model — and
 * the three.js manual — writes `new THREE.WebGLRenderer()` and `document.body.appendChild(…)`,
 * which would draw on a canvas the snapshot never looks at, into a buffer WebGL clears after it is
 * shown. So inside this sketch `THREE` is the real library with ONE difference: a renderer draws
 * into the guest's own canvas (`lol.canvas`, unless the sketch names another) and keeps its
 * drawing buffer, so the picture can be taken. The library itself is never modified — the guest
 * keeps it between runs. `OrbitControls` (an addon the guest does not ship) is a stand-in that
 * hands the camera to the guest's own `lol.orbit` (COMPUTER_LIVE_PLAN K-7): a no-op in a picture,
 * a camera you can drag when the box is Live — so a model that reached for OrbitControls anyway
 * still gets one. Without `lol.orbit` (an older guest) it is the old harmless do-nothing.
 */
// Critic R1 A8: `renderer.setAnimationLoop(fn)` paints NOTHING before the snapshot — three's loop
// waits for an animation frame, and the guest is an off-screen frame the browser throttles. The
// renderer therefore calls the loop's callback once more, in a microtask: after every top-level
// line has run (so nothing the callback reads is still uninitialised) and before the host asks for
// the picture. r160 assigns `setAnimationLoop` IN its constructor, so the wrap is done there too —
// a method on the subclass would be shadowed by the instance property and never called.
const THREE_PRELUDE = 'const THREE = (function (T, c) { if (!T || typeof T.WebGLRenderer !== \'function\') return T; '
  + 'const R = class extends T.WebGLRenderer { constructor(o) { super(Object.assign(c ? { canvas: c } : {}, o || {}, { preserveDrawingBuffer: true })); '
  + 'const loop = this.setAnimationLoop; if (typeof loop === \'function\') { this.setAnimationLoop = function (f) { loop.call(this, f); '
  + 'if (typeof f === \'function\') Promise.resolve().then(function () { f(typeof performance !== \'undefined\' ? performance.now() : Date.now()); }); }; } } }; '
  + 'const O = T.OrbitControls || class { constructor(cam) { const o = cam && typeof lol.orbit === \'function\' ? lol.orbit(cam) : null; '
  + 'this.enabled = true; this.target = o && o.target && typeof o.target.set === \'function\' ? o.target : new T.Vector3(); this.__lol = o; } '
  + 'update() { if (this.__lol && typeof this.__lol.update === \'function\') this.__lol.update(); return false; } '
  + 'dispose() { if (this.__lol && typeof this.__lol.dispose === \'function\') this.__lol.dispose(); } addEventListener() {} removeEventListener() {} }; '
  + 'return Object.assign({}, T, { WebGLRenderer: R, OrbitControls: O }); })(window.THREE, lol.canvas); ';

/** When the sketch uses `OrbitControls` by its bare name without declaring it. */
const ORBIT_PRELUDE = 'const OrbitControls = THREE.OrbitControls; ';

/** Put the guest's canvas back where the snapshot looks, after `document.body.appendChild(…)`. */
const THREE_TRAILER = '\n;if (lol.canvas && lol.root && lol.canvas.parentNode !== lol.root) lol.root.insertBefore(lol.canvas, lol.root.firstChild);\n';

/** `window.addEventListener('load', init)` / `document.addEventListener('DOMContentLoaded', …)`. */
const READY_LISTENER = /\b(?:window|document)\s*\.\s*addEventListener\s*\(\s*(['"])(?:DOMContentLoaded|load)\1\s*,/g;
/** …becomes a call, same line, same closing parenthesis: `(function (f) { f(); })( init);`. */
const READY_NOW = '(function (f) { f(); })(';

/** A sketch that assigned `window.onload`: the page loaded long ago, so it is called once here,
 * and marked, so a later sketch that sets no handler never re-runs this one's. */
const ONLOAD_TRAILER = ";if (typeof window.onload === 'function' && !window.onload.__lolRan) { window.onload.__lolRan = true; window.onload(); }\n";

/** Does the sketch declare this name itself? A prelude that declared it too would be a
 * redeclaration — a syntax error the person never wrote. @param {string} src @param {string} name */
function declares(src, name) {
  return new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b|\\bimport\\b[^\\n]*\\b${name}\\b`).test(src);
}

/**
 * Code as written by a person or a model → code the guest runs. Frozen signature (KE-3); the
 * behaviour is K5-U1's. Line N of the result is line N of `code` for every line of `code`.
 * @param {string} mode  a Preview mode
 * @param {string} code
 * @returns {string}
 */
export function shapeForGuest(mode, code) {
  let src = String(code == null ? '' : code).replace(/\r\n?/g, '\n');
  if (mode === 'p5' || mode === 'three') {
    src = src.replace(IMPORT_LINE, '');
    // Critic R1 A8: the guest runs code long after the page loaded, so a listener for `load` or
    // `DOMContentLoaded` would wait for ever and the picture stays blank. The registration is
    // rewritten, on its own line, into a call made right there.
    src = src.replace(READY_LISTENER, READY_NOW);
  }
  if (mode === 'three') {
    let prelude = '';
    if (!declares(src, 'THREE')) prelude += THREE_PRELUDE;
    if (/\bOrbitControls\b/.test(src) && !declares(src, 'OrbitControls')) prelude += ORBIT_PRELUDE;
    const onload = /\bwindow\s*\.\s*onload\s*=/.test(src) ? ONLOAD_TRAILER : '';
    return `${prelude}${src}${THREE_TRAILER}${onload}`;
  }
  if (mode !== 'p5') return src;
  src = handOverInstance(src);
  if (/^return\b/m.test(src)) return src;             // instance mode: a column-0 `return function (p)`
  return `${src}\n${p5Trailer()}`;
}

/**
 * Critic R1 A8: an INSTANCE-mode sketch that ends `new p5(sketch);` (with no node, or `document.body`)
 * would put its canvas on the page's body — outside `#root`, where the snapshot looks — and keep
 * running into the next run, because the guest never learnt about it. When that is the sketch's
 * LAST statement it becomes `return sketch;` on the same line: the guest's own instance-mode door,
 * which starts it inside `#root` and stops it on the next run. Anything else is left alone.
 * @param {string} src @returns {string}
 */
function handOverInstance(src) {
  const lines = src.split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last -= 1;
  if (last < 0) return src;
  const m = /^(\s*)(?:(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*)?new\s+p5\s*\(\s*([A-Za-z_$][\w$]*)\s*(?:,[^)]*)?\)\s*;?\s*$/.exec(lines[last]);
  if (!m) return src;
  lines[last] = `return ${m[2]};`;
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// naming the line
// ---------------------------------------------------------------------------------------------

/** Words after which a `/` starts a regular expression rather than a division. */
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/** Words another word may follow on the same line (`let x`, `new THREE`, `async function`,
 * `else if`, `get x()`…). Two words side by side where the first is NOT one of these — and the
 * second is not an infix word — is always a syntax error: `funtion draw() {`. */
const WORD_THEN_WORD = new Set([
  'var', 'let', 'const', 'function', 'class', 'new', 'typeof', 'instanceof', 'in', 'of', 'return',
  'case', 'do', 'else', 'void', 'delete', 'throw', 'yield', 'await', 'async', 'get', 'set',
  'static', 'extends', 'import', 'export', 'from', 'as', 'default', 'break', 'continue', 'debugger',
]);

/** Words that may follow any word: `x in y`, `a instanceof B`, `class A extends B`. */
const INFIX_WORD = new Set(['in', 'of', 'instanceof', 'extends', 'as', 'from']);

/** An operator that needs a right-hand side, and the characters that prove there is none:
 * `let x = ;`, `f(a *)`. (`+`/`-` are left out: `i++;` is complete; `:` too: `case 1: }` is.) */
const NEEDS_RIGHT = '=*%&|^<>?';
const NOTHING_RIGHT = ';),]}';

/**
 * Where a piece of JavaScript is most likely broken, when the engine would not say.
 *
 * The guest compiles a sketch with the engine's own function constructor, and a SyntaxError from
 * that carries NO line — only "Unexpected token '}'". A person with forty lines in front of them
 * needs the line. This is a small scanner, not a parser: it skips comments, strings, template
 * literals and (heuristically) regular expressions, and finds the first bracket that closes the
 * wrong thing, the first string left open at the end of its line, two words side by side that
 * cannot be (`funtion draw`), an operator with nothing on its right (`let x = ;`), or — at the
 * end — the bracket that was never closed.
 *
 * A WRONG LINE IS WORSE THAN NONE: the box offers to jump there. So a closer that meets the
 * wrong opener names the line that is actually broken — `createCanvas(4, 4;` then `}` names the
 * `(`'s line, `background(0));` inside a block names the `)`'s — and when the two lines differ
 * and neither reading is clearly right, it names no line. It answers null rather than guess;
 * the engine's own message is then all the box says (the sandbox compiler has the last word).
 * @param {string} code
 * @returns {{line: number, what: 'bracket'|'open'|'string'|'comment'|'token'}|null}
 */
export function syntaxLine(code) {
  const src = String(code == null ? '' : code).replace(/\r\n?/g, '\n');
  const n = src.length;
  /** @type {{c: string, line: number}[]} */ const stack = [];
  const OPEN = { ')': '(', ']': '[', '}': '{' };
  let line = 1;
  let i = 0;
  let prev = '';       // the last significant character
  let word = '';       // the last identifier, when `prev` ended one
  let wordLine = 0;    // the line `word` was on
  const regexAllowed = () => prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || REGEX_AFTER_WORD.has(word);
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return { line, what: 'comment' };
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = line;
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { if (src[i + 1] === '\n') line++; i += 2; continue; }
        if (src[i] === '\n') return { line: start, what: 'string' };
        i++;
      }
      if (i >= n) return { line: start, what: 'string' };
      i++;
      prev = 'x'; word = '';
      continue;
    }
    if (c === '`') {
      // A template literal may span lines and hold `${…}`; its inside is scanned for its closing
      // backtick only — an expression inside it that breaks is reported by the engine anyway.
      const start = line;
      i++;
      let depth = 0;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { if (src[i + 1] === '\n') line++; i += 2; continue; }
        if (d === '\n') line++;
        if (depth === 0 && d === '`') break;
        if (d === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
        if (depth > 0 && d === '}') depth--;
        i++;
      }
      if (i >= n) return { line: start, what: 'string' };
      i++;
      prev = 'x'; word = '';
      continue;
    }
    if (c === '/' && regexAllowed()) {
      // A regular expression literal, if it ends on this line; otherwise it was a division.
      let k = i + 1;
      let inClass = false;
      let ok = false;
      while (k < n && src[k] !== '\n') {
        const d = src[k];
        if (d === '\\') { k += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { ok = true; break; }
        k++;
      }
      if (ok) {
        i = k + 1;
        while (i < n && /[a-z]/i.test(src[i])) i++;
        prev = 'x'; word = '';
        continue;
      }
    }
    if (NOTHING_RIGHT.includes(c) && prev && NEEDS_RIGHT.includes(prev) && !word) return { line, what: 'token' };
    if (c === '(' || c === '[' || c === '{') stack.push({ c, line });
    else if (c === ')' || c === ']' || c === '}') {
      const top = stack.pop();
      if (!top) return { line, what: 'bracket' };                 // a closer too many: here
      if (top.c !== /** @type {any} */ (OPEN)[c]) {
        if (top.line === line) return { line, what: 'bracket' };
        // A block ends while a ( or [ is still open: the call/array was never closed — ITS line.
        if (c === '}' && top.c !== '{') return { line: top.line, what: 'open' };
        // A ) or ] inside a block that never opened one: a stray closer — THIS line.
        if (top.c === '{') return { line, what: 'bracket' };
        return null;                                               // ( … ] across lines: unsure
      }
    }
    if (/[\w$]/.test(c)) {
      let k = i;
      while (k < n && /[\w$]/.test(src[k])) k++;
      const next = src.slice(i, k);
      if (word && wordLine === line && !WORD_THEN_WORD.has(word) && !INFIX_WORD.has(next)) return { line, what: 'token' };
      word = next;
      wordLine = line;
      prev = 'x';
      i = k;
      continue;
    }
    prev = c; word = '';
    i++;
  }
  if (stack.length) return { line: stack[stack.length - 1].line, what: 'open' };
  return null;
}

/** Does a guest error read like the engine refusing to compile the code at all?
 * @param {any} error @returns {boolean} */
export function isSyntaxError(error) {
  if (!error) return false;
  const stack = String(error.stack || '');
  const message = String(error.message || '');
  return /^SyntaxError\b/.test(stack)
    || /^(?:Unexpected (?:token|identifier|end of input|string|number|strict mode)|missing \)|Invalid or unexpected token|Unterminated|Invalid (?:regular expression|left-hand side|destructuring))/i.test(message);
}

/**
 * Where a piece of markup (an SVG) is broken: the first end tag that closes the wrong element, or
 * the element left open at the end. Null when the tags balance — the parser's own reason is then
 * all there is to say, and a guessed line would be worse than none.
 * @param {string} text
 * @returns {{line: number, tag: string}|null}
 */
export function markupLine(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  /** @type {{name: string, line: number}[]} */ const stack = [];
  let line = 1;
  let at = 0;
  let m;
  while ((m = TAG.exec(src))) {
    for (let k = at; k < m.index; k++) if (src[k] === '\n') line++;
    at = m.index;
    if (m[2]) {
      const name = m[2];
      if (m[1] === '/') {
        const top = stack.pop();
        if (!top || top.name !== name) return { line, tag: name };
      } else if (!/\/\s*$/.test(m[3] || '')) {
        stack.push({ name, line });
      }
    }
  }
  if (stack.length) return { line: stack[stack.length - 1].line, tag: stack[stack.length - 1].name };
  return null;
}

/** The character range of one line (1-based), so an editor can select it.
 * @param {string} text @param {number} lineNo @returns {[number, number]} */
export function lineRange(text, lineNo) {
  const src = String(text == null ? '' : text);
  const want = Math.max(1, Math.floor(Number(lineNo) || 1));
  let start = 0;
  for (let l = 1; l < want; l++) {
    const nl = src.indexOf('\n', start);
    if (nl < 0) return [src.length, src.length];
    start = nl + 1;
  }
  const end = src.indexOf('\n', start);
  return [start, end < 0 ? src.length : end];
}

// ---------------------------------------------------------------------------------------------
// saying what to do about a guest error (critic R1 A8)
// ---------------------------------------------------------------------------------------------

/** p5 FUNCTIONS a sketch calls. At the top of a sketch none of them exist yet: the guest runs the
 * body BEFORE p5 binds its globals, which is when `setup()` starts. */
export const P5_FUNCTIONS = Object.freeze(new Set([
  'createCanvas', 'resizeCanvas', 'createGraphics', 'background', 'clear', 'fill', 'noFill', 'stroke',
  'noStroke', 'strokeWeight', 'color', 'lerpColor', 'red', 'green', 'blue', 'alpha', 'hue',
  'saturation', 'brightness', 'colorMode', 'random', 'randomSeed', 'randomGaussian', 'noise',
  'noiseSeed', 'noiseDetail', 'map', 'constrain', 'lerp', 'dist', 'mag', 'norm', 'sq', 'sqrt', 'pow',
  'abs', 'floor', 'ceil', 'round', 'min', 'max', 'exp', 'log', 'sin', 'cos', 'tan', 'asin', 'acos',
  'atan', 'atan2', 'radians', 'degrees', 'angleMode', 'ellipse', 'circle', 'rect', 'square', 'line',
  'point', 'triangle', 'quad', 'arc', 'beginShape', 'endShape', 'vertex', 'curveVertex',
  'bezierVertex', 'quadraticVertex', 'bezier', 'curve', 'push', 'pop', 'translate', 'rotate', 'scale',
  'shearX', 'shearY', 'rectMode', 'ellipseMode', 'text', 'textSize', 'textAlign', 'textFont',
  'textStyle', 'textWidth', 'frameRate', 'createVector', 'millis', 'second', 'minute', 'hour',
  'noLoop', 'loop', 'isLooping', 'redraw', 'blendMode', 'tint', 'noTint', 'image', 'loadImage',
  'loadFont', 'loadJSON', 'loadStrings', 'shuffle', 'int', 'float', 'str', 'pixelDensity', 'smooth',
  'noSmooth', 'erase', 'noErase', 'keyIsDown', 'drawingContext', 'box', 'sphere', 'torus', 'cone',
  'cylinder', 'plane', 'orbitControl', 'normalMaterial', 'ambientLight', 'directionalLight',
  'pointLight', 'rotateX', 'rotateY', 'rotateZ',
]));

/** p5 VALUES a sketch reads: sizes, the mouse, the frame count and the constants. */
export const P5_VALUES = Object.freeze(new Set([
  'width', 'height', 'windowWidth', 'windowHeight', 'displayWidth', 'displayHeight', 'mouseX',
  'mouseY', 'pmouseX', 'pmouseY', 'mouseIsPressed', 'mouseButton', 'key', 'keyCode', 'keyIsPressed',
  'frameCount', 'deltaTime', 'focused', 'pixels', 'PI', 'TWO_PI', 'HALF_PI', 'QUARTER_PI', 'TAU',
  'HSB', 'HSL', 'RGB', 'CENTER', 'CORNER', 'CORNERS', 'RADIUS', 'DEGREES', 'RADIANS', 'CLOSE',
  'LEFT', 'RIGHT', 'TOP', 'BOTTOM', 'BASELINE', 'BLEND', 'ADD', 'MULTIPLY', 'SCREEN', 'OVERLAY',
  'DIFFERENCE', 'LIGHTEST', 'DARKEST', 'ROUND', 'SQUARE', 'PROJECT', 'MITER', 'BEVEL', 'WEBGL',
  'P2D', 'BOLD', 'ITALIC', 'NORMAL', 'POINTS', 'LINES', 'TRIANGLES', 'TRIANGLE_FAN',
  'TRIANGLE_STRIP', 'QUADS', 'QUAD_STRIP',
]));

/** three.js ADD-ONS a model reaches for that the guest does not ship (OrbitControls has a
 * stand-in in the prelude). A name ending like an add-on counts too. */
const THREE_ADDONS = new Set(['GLTFLoader', 'OBJLoader', 'FontLoader', 'TextGeometry', 'EffectComposer',
  'RenderPass', 'UnrealBloomPass', 'OutputPass', 'RoomEnvironment', 'RGBELoader', 'TrackballControls',
  'FlyControls', 'MapControls', 'PointerLockControls', 'TransformControls', 'DragControls',
  'SimplexNoise', 'ImprovedNoise', 'CSS2DRenderer', 'CSS3DRenderer', 'Sky', 'Water', 'Stats', 'GUI',
  'dat', 'TWEEN', 'gsap', 'RoundedBoxGeometry', 'ConvexGeometry', 'ParametricGeometry']);
const THREE_ADDON_SHAPE = /(?:Controls|Loader|Pass|Composer|Environment|Renderer)$/;

/**
 * One sentence that says what to DO about an error the guest reported, in the words of the fix,
 * or '' when there is nothing better to say than the engine's own message. PURE: the Preview box
 * (sandbox side) shows it under the error; this module knows what the sandbox provides.
 *
 *   "color is not defined" (p5)          → call it inside setup() or draw()
 *   "angle is not defined"                → declare it with let at the top
 *   "Cannot access 'x' before initialization" → it is used before the line that creates it
 *   "GLTFLoader is not defined" (three)   → an add-on the sandbox does not have
 *   "THREE.Geometry is not a constructor" → gone from r160
 *   "Unexpected token '<'" (p5/three)     → this is HTML, not JavaScript
 *   "Cannot use import statement…"        → the libraries are already loaded
 *
 * @param {any} message the guest's error message (an `Uncaught ReferenceError: ` prefix is fine)
 * @param {string} mode the box's mode: 'p5' | 'three' | 'svg' | 'html' | …
 * @returns {string}
 */
export function explainGuestError(message, mode) {
  const m = String(message == null ? '' : message).trim()
    .replace(/^Uncaught\s+/, '')
    .replace(/^[A-Z][A-Za-z]*Error:\s*/, '');
  const kind = String(mode || '');
  if (kind !== 'p5' && kind !== 'three') return '';

  const undef = /^([A-Za-z_$][\w$]*) is not defined$/.exec(m);
  if (undef) {
    const name = undef[1];
    if (kind === 'p5' && P5_FUNCTIONS.has(name)) return t('parts.genErrP5Function', { name });
    if (kind === 'p5' && P5_VALUES.has(name)) return t('parts.genErrP5Value', { name });
    // COMPUTER_LIVE_PLAN K-7: a camera control has a first-party answer, so the fix names it.
    if (kind === 'three' && /Controls$/.test(name)) return t('parts.genErrThreeControls', { name });
    if (kind === 'three' && (THREE_ADDONS.has(name) || THREE_ADDON_SHAPE.test(name))) return t('parts.genErrThreeAddon', { name });
    return t('parts.genErrDeclare', { name });
  }
  const early = /^Cannot access '([A-Za-z_$][\w$]*)' before initialization$/.exec(m);
  if (early) return t('parts.genErrTooEarly', { name: early[1] });
  const gone = /^THREE\.([A-Za-z_$][\w$]*) is not a constructor$/.exec(m);
  if (gone && kind === 'three') return t('parts.genErrThreeGone', { name: gone[1] });
  if (/^Unexpected token '<'/.test(m)) return t('parts.genErrHtmlNotJs');
  if (/^Cannot use import statement outside a module/.test(m) || /^Unexpected token 'import'/.test(m)) return t('parts.genErrImport');
  return '';
}
