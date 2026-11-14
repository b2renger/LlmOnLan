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
const scriptTag = (js) => `<script>\n${String(js).replace(/<\/script/gi, '<\\/script')}\n</script>`;

/**
 * @param {string} html the page's own block
 * @param {{lang?: string, code?: string}[]} fences every block of the same answer, in order (the page's included)
 * @returns {{html: string, css: string, libs: string[], remote: string[]}}
 */
export function pageOf(html, fences) {
  const lang = (/** @type {any} */ f) => String(f.lang || '').toLowerCase();
  const css = fences.filter((f) => CSS_LANGS.indexOf(lang(f)) >= 0).map((f) => String(f.code || '')).join('\n');
  const js = fences.filter((f) => JS_LANGS.indexOf(lang(f)) >= 0).map((f) => String(f.code || ''));
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
  let out = String(html) + js.map(scriptTag).join('\n');
  // p5's global mode starts on the page's load; in the sandbox p5 is in place before the page, so start it once the
  // page's setup() and draw() exist.
  if (libs.indexOf('p5') >= 0 && !/new\s+p5\s*\(/.test(out)) {
    out += scriptTag("if (window.p5 && !p5.instance && (typeof window.setup === 'function' || typeof window.draw === 'function')) new p5();");
  }
  return { html: out, css, libs, remote: Array.from(new Set(remote)) };
}
