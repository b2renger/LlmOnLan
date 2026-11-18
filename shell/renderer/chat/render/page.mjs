// @ts-check
/**
 * render/page.mjs - one web page from the code blocks of one LOL Vibe answer (owner, 2026-11-14: "it should be
 * rewarding right away"). PURE: render/code.mjs hands it the answer's fences, the sandbox's live guest runs what it
 * returns (no network, nothing from disk: sandbox/protocol.mjs RUNNER_CSP).
 *
 * A model often answers a "small website" as three blocks, index.html, style.css and script.js. The page is the
 * HTML block with every CSS block of the answer as its style and every JavaScript block appended as an inline script,
 * in the answer's order. A <script src> that names p5, three (the classic build) or d3 on a CDN gets the copy the
 * sandbox ships instead; any other web address cannot load there, and `remote` names it so the pane can say so.
 */

/** The languages of a block that is a whole page, its style or its script. */
export const PAGE_LANGS = Object.freeze(['html', 'htm']);
const CSS_LANGS = ['css'];
const JS_LANGS = ['js', 'javascript'];

/** Is this finished fence a web page? An untagged block counts when it starts like one.
 * @param {{lang?: string, code?: string}} info @returns {boolean} */
export function isPage(info) {
  const lang = String(info.lang || '').toLowerCase();
  if (PAGE_LANGS.indexOf(lang) >= 0) return true;
  return !lang && /^\s*<(!doctype\s+html|html[\s>])/i.test(String(info.code || ''));
}

/** A CDN address the sandbox can stand in for, by the library it names. Module builds are not: they import. */
const LIB_URLS = [
  { name: 'p5', re: /\/p5(@[\w.-]+)?(\/lib)?\/p5(\.min)?\.js(\?|#|$)|\/p5\.js\/[\w.-]+\/p5(\.min)?\.js/i },
  { name: 'three', re: /\/three(@[\w.-]+)?\/build\/three(\.min)?\.js(\?|#|$)|\/three\.js\/[\w.-]+\/three(\.min)?\.js/i },
  { name: 'd3', re: /\/d3(@[\w.-]+)?(\/dist)?\/d3(\.v\d+)?(\.min)?\.js(\?|#|$)|\/d3\/[\w.-]+\/d3(\.min)?\.js|d3js\.org\/d3(\.v\d+)?(\.min)?\.js/i },
];

/** `</script` inside a script would end it early. @param {string} js */
const defuse = (js) => String(js).replace(/<\/script/gi, '<\\/script');
/** A script of ours (p5's start), unnamed. @param {string} js */
const scriptTag = (js) => `<script>\n${defuse(js)}\n</script>`;

/**
 * Every script the page runs is NAMED (`//# sourceURL=lol-….js`, on its own last line, so no line moves): the
 * sandbox's guest then reports an error with that name and the line in that script (sandbox/runner.html
 * `namedAt`), and `blockOf` turns it into the answer's block and the line a person sees in it.
 * `sources[name]` is that block's index in `fences` and what to add to the script's line.
 * @typedef {Record<string, {fence: number, delta: number}>} PageSources
 */

/**
 * @param {string} html the page's own block
 * @param {{lang?: string, code?: string}[]} fences every block of the same answer, in order (the page's included)
 * @param {{pageIndex?: number}} [o] which of `fences` is the page (found by its code when not given)
 * @returns {{html: string, css: string, libs: string[], remote: string[], sources: PageSources}}
 */
export function pageOf(html, fences, o = {}) {
  const lang = (/** @type {any} */ f) => String(f.lang || '').toLowerCase();
  const css = fences.filter((f) => CSS_LANGS.indexOf(lang(f)) >= 0).map((f) => String(f.code || '')).join('\n');
  /** @type {string[]} */ const libs = [];
  /** @type {string[]} */ const remote = [];
  const src = /<script\b([^>]*)\bsrc\s*=\s*["']?(https?:)?\/\/([^"'\s>]+)["']?[^>]*>/gi;
  for (let m = src.exec(html); m; m = src.exec(html)) {
    const url = `//${m[3]}`;
    const lib = /type\s*=\s*["']?module/i.test(m[1]) ? null : LIB_URLS.find((l) => l.re.test(url));
    if (lib) { if (libs.indexOf(lib.name) < 0) libs.push(lib.name); } else remote.push(m[3].split('/')[0]);
  }
  // An `import ... from 'https://…'` in the page's own module scripts cannot load either.
  const imports = /\bimport\b[^'"]*["']https?:\/\/([^/"']+)/gi;
  for (let m = imports.exec(html); m; m = imports.exec(html)) remote.push(m[1]);

  /** @type {PageSources} */ const sources = {};
  const pageIndex = typeof o.pageIndex === 'number' ? o.pageIndex
    : fences.findIndex((f) => isPage(f) && String(f.code || '') === String(html));
  // The page's own inline scripts (the runner wakes only classic ones), named where they stand.
  let k = 0;
  const page = String(html).replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script\s*>)/gi,
    (all, open, attrs, body, close, at) => {
      if (/\bsrc\s*=/i.test(attrs)) return all;
      const type = /\btype\s*=\s*["']?([\w/+.-]+)/i.exec(attrs);
      if (type && !/^(text|application)\/javascript$/i.test(type[1])) return all;
      const name = `lol-h${++k}.js`;
      // The script's line 1 is the page's line where its opening tag ends.
      sources[name] = { fence: pageIndex, delta: String(html).slice(0, at + open.length).split('\n').length - 1 };
      return `${open}${body}\n//# sourceURL=${name}\n${close}`;
    });
  // Each JavaScript block of the answer, after the page, in order. Its line 1 is the script's line 2.
  /** @type {string[]} */ const tags = [];
  fences.forEach((f, i) => {
    if (JS_LANGS.indexOf(lang(f)) < 0) return;
    const name = `lol-b${i}.js`;
    sources[name] = { fence: i, delta: -1 };
    tags.push(`<script>\n${defuse(String(f.code || ''))}\n//# sourceURL=${name}\n</script>`);
  });
  let out = page + tags.join('\n');
  // p5's global mode starts on the page's load; in the sandbox p5 is in place before the page, so start it once the
  // page's setup() and draw() exist.
  if (libs.indexOf('p5') >= 0 && !/new\s+p5\s*\(/.test(out)) {
    out += scriptTag("if (window.p5 && !p5.instance && (typeof window.setup === 'function' || typeof window.draw === 'function')) new p5();");
  }
  return { html: out, css, libs, remote: Array.from(new Set(remote)), sources };
}

/**
 * Where an error of the page is in the answer: the block (its index in `fences`; -1 for a page not among them) and
 * the line and column in it, or null when the guest could not say (an error in a library, or before any script ran).
 * @param {{source?: string, line?: number, col?: number}|null|undefined} err the guest's error
 * @param {PageSources} sources what `pageOf` returned
 * @returns {{fence: number, line: number, col: number}|null}
 */
export function blockOf(err, sources) {
  const at = err && err.source && Object.prototype.hasOwnProperty.call(sources, err.source) ? sources[err.source] : null;
  const line = Number(err && err.line) || 0;
  if (!at || line < 1) return null;
  return { fence: at.fence, line: Math.max(1, line + at.delta), col: Number(err && err.col) || 0 };
}

/**
 * The blocks of an answer that make its page, in the answer's order: the page itself, its CSS, its JavaScript. PURE.
 * `kind` is 'html' | 'css' | 'js'; `n` counts the blocks of that kind (1, 2…) so two JavaScript blocks have names.
 * @param {{lang?: string, code?: string}[]} fences @returns {{fence: number, kind: 'html'|'css'|'js', n: number, of: number}[]}
 */
export function pageBlocks(fences) {
  /** @type {{fence: number, kind: 'html'|'css'|'js', n: number, of: number}[]} */ const out = [];
  const seen = { html: 0, css: 0, js: 0 };
  fences.forEach((f, i) => {
    const lang = String(f.lang || '').toLowerCase();
    /** @type {'html'|'css'|'js'|null} */
    const kind = isPage(f) ? 'html' : CSS_LANGS.indexOf(lang) >= 0 ? 'css' : JS_LANGS.indexOf(lang) >= 0 ? 'js' : null;
    if (!kind) return;
    seen[kind] += 1;
    out.push({ fence: i, kind, n: seen[kind], of: 0 });
  });
  for (const b of out) b.of = seen[b.kind];
  return out;
}

/**
 * The answer's blocks with a person's edits in place of the model's code (`edits[fence index] = code`). PURE.
 * @param {{lang?: string, code?: string}[]} fences @param {Record<string, string>|null|undefined} edits
 * @returns {{lang: string, code: string}[]}
 */
export function withEdits(fences, edits) {
  return fences.map((f, i) => ({
    lang: String(f.lang || ''),
    code: edits && typeof edits[String(i)] === 'string' ? edits[String(i)] : String(f.code || ''),
  }));
}
