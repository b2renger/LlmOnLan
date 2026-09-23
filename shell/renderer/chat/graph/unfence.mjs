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

const FENCE = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([\w.+#-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;

/**
 * The code inside a markdown fence, or the text itself when there is none.
 * The LONGEST fenced block wins: a model that shows a one-line usage example before the real
 * program must not have the example drawn. Frozen (KE-3).
 * @param {string} text
 * @returns {{code: string, lang: string, fenced: boolean}}
 */
export function unfence(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  let best = null;
  FENCE.lastIndex = 0;
  let m;
  while ((m = FENCE.exec(src))) {
    if (!best || m[4].length > best.code.length) best = { code: m[4], lang: String(m[3] || '').toLowerCase() };
  }
  if (best) return { code: best.code.trim(), lang: best.lang, fenced: true };
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
  return { kind: 'text', data: unfence(text).code, .../** @type {any} */ (CODE_FACETS)[kind] };
}

/**
 * The code a creative box draws from text that ARRIVED on its wire, for the mode it draws in.
 * Unfenced first; then, for the two markup modes, the prose a model wraps around unfenced markup
 * is cut away — "Here is your SVG: <svg…></svg> Enjoy!" draws the `<svg…></svg>`. JavaScript is
 * never cut: there is no honest way to tell a model's sentence from a line of a sketch.
 * @param {string} mode a Preview mode @param {string} text @returns {string}
 */
export function codeFor(mode, text) {
  const code = unfence(text).code;
  if (mode === 'svg') return svgOf(code);
  if (mode === 'html') return htmlOf(code);
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
 * keeps it between runs. `OrbitControls` (an addon the guest does not ship) is a harmless stand-in:
 * a picture has no mouse to orbit with.
 */
const THREE_PRELUDE = 'const THREE = (function (T, c) { if (!T || typeof T.WebGLRenderer !== \'function\') return T; '
  + 'const R = class extends T.WebGLRenderer { constructor(o) { super(Object.assign(c ? { canvas: c } : {}, o || {}, { preserveDrawingBuffer: true })); } }; '
  + 'const O = T.OrbitControls || class { constructor() { this.enabled = true; this.target = new T.Vector3(); } update() { return false; } dispose() {} addEventListener() {} removeEventListener() {} }; '
  + 'return Object.assign({}, T, { WebGLRenderer: R, OrbitControls: O }); })(window.THREE, lol.canvas); ';

/** When the sketch uses `OrbitControls` by its bare name without declaring it. */
const ORBIT_PRELUDE = 'const OrbitControls = THREE.OrbitControls; ';

/** Put the guest's canvas back where the snapshot looks, after `document.body.appendChild(…)`. */
const THREE_TRAILER = '\n;if (lol.canvas && lol.root && lol.canvas.parentNode !== lol.root) lol.root.insertBefore(lol.canvas, lol.root.firstChild);\n';

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
  if (mode === 'p5' || mode === 'three') src = src.replace(IMPORT_LINE, '');
  if (mode === 'three') {
    let prelude = '';
    if (!declares(src, 'THREE')) prelude += THREE_PRELUDE;
    if (/\bOrbitControls\b/.test(src) && !declares(src, 'OrbitControls')) prelude += ORBIT_PRELUDE;
    return `${prelude}${src}${THREE_TRAILER}`;
  }
  if (mode !== 'p5') return src;
  if (/^return\b/m.test(src)) return src;             // instance mode: a column-0 `return function (p)`
  return `${src}\n${p5Trailer()}`;
}

// ---------------------------------------------------------------------------------------------
// naming the line
// ---------------------------------------------------------------------------------------------

/** Words after which a `/` starts a regular expression rather than a division. */
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/**
 * Where a piece of JavaScript is most likely broken, when the engine would not say.
 *
 * The guest compiles a sketch with the engine's own function constructor, and a SyntaxError from
 * that carries NO line — only "Unexpected token '}'". A person with forty lines in front of them
 * needs the line. This is a small scanner, not a parser: it skips comments, strings, template
 * literals and (heuristically) regular expressions, and finds the first bracket that closes the
 * wrong thing, the first string left open at the end of its line, or — at the end — the bracket
 * that was never closed. It answers null rather than guess when none of those is the problem.
 * @param {string} code
 * @returns {{line: number, what: 'bracket'|'open'|'string'|'comment'}|null}
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
    if (c === '(' || c === '[' || c === '{') stack.push({ c, line });
    else if (c === ')' || c === ']' || c === '}') {
      const top = stack.pop();
      if (!top || top.c !== /** @type {any} */ (OPEN)[c]) return { line, what: 'bracket' };
    }
    if (/[\w$]/.test(c)) {
      let k = i;
      while (k < n && /[\w$]/.test(src[k])) k++;
      word = src.slice(i, k);
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
