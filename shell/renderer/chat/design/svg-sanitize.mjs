// @ts-check
// SVG sanitiser (BK-10c, folded in at the C3 fix pass) — PURE: an XML tokenizer, an element and
// attribute ALLOW-LIST, and a re-serialiser. No DOM, no regex patching of the caller's bytes.
//
// WHY a parser and not a regex scrub. The first version of this code (render.mjs `sanitizeSvg`)
// deleted dangerous shapes from the source string and handed the REST back verbatim. Five shapes
// walked straight through it, each with `removed === []`:
//   1. `<svg …><script>alert(1)`      — an unterminated tag: every delete-the-tag regex needs a
//                                        closing tag, but an HTML/SVG parser runs an unclosed
//                                        <script> to end-of-file.
//   2. `<a href=…>` unquoted           — the reference rule only matched quoted values.
//   3. `<set attributeName="href" to="…">` — SMIL, which the scrub never modelled.
//   4. `<style>@import "http://…"</style>` — a NETWORK fetch the `url(…)` rule could not see.
//   5. `<foreignObject><iframe …>`     — unterminated again.
// This matters because the output does not stay inside the sandbox: Render(svg) → File('x.svg')
// writes these bytes into the thread's scratch project, and the reader double-clicks them into a
// browser that has none of the guest's CSP. So the rule here is the opposite one: NOTHING survives
// that was not understood, and a document we cannot parse is REFUSED rather than patched.
//
// Strictness is not a cost: an `image/svg+xml` document must be well-formed XML to render at all,
// so a file that fails this parser was never going to be a picture. `sanitizeSvg().ok === false`
// is the same verdict a browser's <parsererror> gives.

/** Elements that may appear. Keyed by lower-case name → the canonical spelling we emit. */
const ELEMENT_LIST = [
  'svg', 'g', 'defs', 'symbol', 'use', 'marker', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'filter',
  'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feComposite', 'feFlood',
  'feMerge', 'feMergeNode', 'feDropShadow', 'feMorphology', 'feTile', 'feTurbulence',
  'feDisplacementMap', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
  'title', 'desc', 'a', 'image', 'style',
];
/** @type {Map<string, string>} */
export const ELEMENTS = new Map(ELEMENT_LIST.map((n) => [n.toLowerCase(), n]));

/** Dropped WITH their subtree, and named in `removed` because the reader should know. `set`,
 * `animate` & co. are SMIL: `<set attributeName="href" to="…">` is a reference vector with no tag
 * of its own. Anything else unknown is dropped too — it is just reported as 'element'. */
export const DROP_WHOLE = new Map([
  ['script', 'script'],
  ['foreignobject', 'foreignObject'],
  ['handler', 'handler'],
  ['set', 'animation'],
  ['animate', 'animation'],
  ['animatemotion', 'animation'],
  ['animatetransform', 'animation'],
  ['discard', 'animation'],
]);

/** Attributes that may appear, by LOCAL name, lower-cased. Geometry, paint, text and filter
 * parameters — everything that draws. `href`/`xlink:href`/`src` are handled separately (they are
 * references), as are `style`, `on*` and the namespace declarations. */
export const ATTRS = new Set([
  'id', 'class', 'lang', 'space', 'version', 'role', 'aria-label', 'aria-hidden',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'width', 'height', 'viewbox', 'preserveaspectratio', 'transform', 'transform-origin',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'offset', 'fx', 'fy', 'fr',
  'patternunits', 'patterncontentunits', 'patterntransform',
  'clippathunits', 'clip-path', 'clip-rule', 'mask', 'maskunits', 'maskcontentunits',
  'filter', 'filterunits', 'primitiveunits', 'in', 'in2', 'result', 'stddeviation',
  'dx', 'dy', 'values', 'type', 'mode', 'operator', 'k1', 'k2', 'k3', 'k4',
  'flood-color', 'flood-opacity', 'scale', 'basefrequency', 'numoctaves', 'seed',
  'xchannelselector', 'ychannelselector', 'radius', 'tablevalues', 'slope', 'intercept',
  'amplitude', 'exponent', 'markerwidth', 'markerheight', 'markerunits', 'refx', 'refy',
  'orient', 'marker-start', 'marker-mid', 'marker-end',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-miterlimit', 'opacity', 'color', 'display', 'visibility', 'overflow',
  'shape-rendering', 'text-rendering', 'image-rendering', 'vector-effect', 'paint-order',
  'mix-blend-mode', 'isolation', 'color-interpolation-filters',
  'font-family', 'font-size', 'font-size-adjust', 'font-weight', 'font-style', 'font-variant',
  'font-stretch', 'letter-spacing', 'word-spacing', 'text-anchor', 'dominant-baseline',
  'alignment-baseline', 'baseline-shift', 'text-decoration', 'writing-mode', 'direction',
  'unicode-bidi', 'white-space', 'startoffset', 'method', 'spacing', 'lengthadjust',
  'textlength', 'rotate', 'stop-color', 'stop-opacity',
]);

/** Reference-bearing attributes: kept only when they point INSIDE the document or carry the
 * picture inline. */
export const REF_ATTRS = new Set(['href', 'src']);

/** The only namespaces a sanitised picture declares. */
export const NAMESPACES = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
]);

/** Inline pictures we accept as a reference. `image/svg+xml` is NOT here: a nested SVG is another
 * document to sanitise, and we do not recurse into a data URL. */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|avif)[;,]/;

/** Caps on the shape of the tree, so a pathological document cannot cost the renderer a frame. */
export const MAX_NODES = 20000;
export const MAX_DEPTH = 64;

// ---------------------------------------------------------------------------------------------
// the tokenizer
// ---------------------------------------------------------------------------------------------

/** @typedef {{type: 'element', name: string, attrs: {name: string, value: string}[], children: XNode[]}} XElement */
/** @typedef {{type: 'text', text: string}} XText */
/** @typedef {XElement | XText} XNode */

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;
const WS = /\s/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** A handful of HTML named characters (text only; the output re-escapes everything). */
const HTML_ENTITIES = {
  nbsp: ' ', copy: '©', reg: '®', deg: '°', middot: '·', times: '×',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', bull: '•', trade: '™', euro: '€', laquo: '«', raquo: '»',
};

/** XML's five entities plus numeric references. An unknown name stays literal text — it is
 * re-escaped on the way out, so it can never become markup. @param {string} s @returns {string} */
export function decodeEntities(s) {
  return String(s).replace(/&(#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    if (Object.prototype.hasOwnProperty.call(ENTITIES, body)) return /** @type {any} */ (ENTITIES)[body];
    // Critic R1 A8: the few HTML names a model writes in an SVG's <text> (`&nbsp;`, `&deg;`,
    // `&mdash;`…) decode to their character instead of showing up on the picture as "&nbsp;".
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, body)
      ? /** @type {any} */ (HTML_ENTITIES)[body]
      : whole;
  });
}

/**
 * Parse an XML document into a tree, or say why it is not one. Well-formedness is the point:
 * unterminated tags, unquoted attribute values and mismatched end tags are ERRORS, exactly as
 * they are for a browser reading `image/svg+xml`.
 * @param {string} source
 * @returns {{ok: true, root: XElement, removed: string[]} | {ok: false, error: string, removed: string[]}}
 */
export function parseXml(source) {
  const src = String(source == null ? '' : source);
  const n = src.length;
  /** @type {string[]} */ const removed = [];
  /** @type {XElement} */ const doc = { type: 'element', name: '#document', attrs: [], children: [] };
  /** @type {XElement[]} */ const stack = [doc];
  let nodes = 0;
  let i = 0;
  const fail = (/** @type {string} */ m) => ({ ok: /** @type {false} */ (false), error: m, removed });
  const top = () => stack[stack.length - 1];

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { addText(src.slice(i)); break; }
    if (lt > i) addText(src.slice(i, lt));
    i = lt;

    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      if (e < 0) return fail('unterminated comment');
      i = e + 3; continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      if (e < 0) return fail('unterminated CDATA section');
      removed.push('cdata');
      i = e + 3; continue;
    }
    if (src.startsWith('<!', i)) {
      const e = skipDeclaration(src, i);
      if (e < 0) return fail('unterminated declaration');
      removed.push('doctype');
      i = e; continue;
    }
    if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i + 2);
      if (e < 0) return fail('unterminated processing instruction');
      if (/xml-stylesheet/i.test(src.slice(i, e))) removed.push('reference');
      i = e + 2; continue;
    }
    if (src[i + 1] === '/') {
      let j = i + 2;
      const s = j;
      while (j < n && NAME_CHAR.test(src[j])) j++;
      const name = src.slice(s, j);
      while (j < n && WS.test(src[j])) j++;
      if (src[j] !== '>') return fail('malformed end tag');
      const open = top();
      if (open === doc) return fail('end tag </' + name + '> with nothing open');
      if (open.name !== name) return fail('end tag </' + name + '> does not close <' + open.name + '>');
      stack.pop();
      i = j + 1; continue;
    }

    // an open tag
    let j = i + 1;
    if (j >= n || !NAME_START.test(src[j])) return fail('malformed tag');
    const s = j;
    while (j < n && NAME_CHAR.test(src[j])) j++;
    const name = src.slice(s, j);
    /** @type {{name: string, value: string}[]} */ const attrs = [];
    const seen = new Set();
    let selfClose = false;
    for (;;) {
      let sawSpace = false;
      while (j < n && WS.test(src[j])) { j++; sawSpace = true; }
      if (j >= n) return fail('unterminated tag <' + name + '>');
      if (src[j] === '>') { j++; break; }
      if (src[j] === '/') {
        if (src[j + 1] !== '>') return fail('malformed tag <' + name + '>');
        selfClose = true; j += 2; break;
      }
      if (!sawSpace || !NAME_START.test(src[j])) return fail('malformed attribute in <' + name + '>');
      const as = j;
      while (j < n && NAME_CHAR.test(src[j])) j++;
      const an = src.slice(as, j);
      while (j < n && WS.test(src[j])) j++;
      if (src[j] !== '=') return fail('attribute ' + an + ' in <' + name + '> has no value');
      j++;
      while (j < n && WS.test(src[j])) j++;
      const q = src[j];
      if (q !== '"' && q !== "'") return fail('attribute ' + an + ' in <' + name + '> is not quoted');
      const ve = src.indexOf(q, j + 1);
      if (ve < 0) return fail('unterminated value for ' + an + ' in <' + name + '>');
      if (!seen.has(an)) { seen.add(an); attrs.push({ name: an, value: decodeEntities(src.slice(j + 1, ve)) }); }
      j = ve + 1;
    }

    if (++nodes > MAX_NODES) return fail('document has too many nodes');
    if (stack.length > MAX_DEPTH) return fail('document is nested too deeply');
    /** @type {XElement} */ const el = { type: 'element', name, attrs, children: [] };
    top().children.push(el);
    if (!selfClose) stack.push(el);
    i = j;
  }

  if (stack.length !== 1) return fail('unterminated element <' + top().name + '>');
  const roots = doc.children.filter((c) => c.type === 'element');
  if (roots.length !== 1) return fail(roots.length ? 'more than one root element' : 'no root element');
  return { ok: /** @type {true} */ (true), root: /** @type {XElement} */ (roots[0]), removed };

  /** @param {string} text */
  function addText(text) {
    if (!text) return;
    const host = top();
    if (host === doc) return;               // stray text outside the root is not part of a picture
    if (++nodes > MAX_NODES) return;
    host.children.push({ type: 'text', text: decodeEntities(text) });
  }
}

/** `<!DOCTYPE …>` may carry an internal subset in brackets; skip to the real end.
 * @param {string} src @param {number} at @returns {number} end index, or -1 */
function skipDeclaration(src, at) {
  let i = at + 2;
  let bracket = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (c === '>' && bracket <= 0) return i + 1;
    i++;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// the allow-list
// ---------------------------------------------------------------------------------------------

/** A reference we will keep: same-document, or the picture itself inline. Whitespace and control
 * characters are stripped first, so a scheme split by a tab is read the way a browser reads it.
 * @param {string} url @returns {boolean} */
export function localRef(url) {
  const v = String(url || '').replace(/[\u0000- \u007f]+/g, '').toLowerCase();
  if (!v) return false;
  if (v.startsWith('#')) return true;
  return DATA_IMAGE.test(v);
}

/**
 * CSS, in a `style` attribute or a `<style>` element, with every way out closed: `@import` (a
 * NETWORK fetch the old `url(…)` rule never saw), `url(…)` that is not local, IE's `expression(`,
 * and any scheme that reads as a script once whitespace is gone.
 * @param {string} css @returns {{css: string, removed: string[]}}
 */
export function filterCss(css) {
  /** @type {string[]} */ const removed = [];
  let out = String(css || '');

  out = out.replace(/@import[^;]*(;|$)/gi, () => { removed.push('reference'); return ''; });
  out = out.replace(/expression\s*\(/gi, () => { removed.push('handler'); return 'none('; });

  // A url() we UNDERSTOOD and kept is parked under a sentinel, so that the sweep below can tell
  // "a local reference we approved" from "a url( this rule could not parse" — `fill="url(#g)"` is
  // the commonest attribute in a generated SVG and must survive.
  /** @type {string[]} */ const kept = [];
  out = out.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (whole, _q, url) => {
    if (localRef(url)) { kept.push(whole); return '\u0001' + (kept.length - 1) + '\u0001'; }
    removed.push('reference');
    return 'none';
  });

  const bare = out.replace(/[\u0000- \u007f]+/g, '').toLowerCase();
  if (bare.includes('script:') || bare.includes('url(')) {
    // Anything still naming a scheme, or a url() the rule above could not parse, takes the whole
    // block with it: we do not ship CSS we did not understand.
    return { css: '', removed: ['reference'] };
  }
  out = out.replace(/\u0001(\d+)\u0001/g, (whole, i) => {
    const back = kept[Number(i)];
    return back === undefined ? '' : back;
  });
  return { css: out, removed };
}

/** The text of an element, for `<style>`. @param {XElement} el @returns {string} */
function textOf(el) {
  let s = '';
  for (const c of el.children) s += c.type === 'text' ? c.text : textOf(/** @type {XElement} */ (c));
  return s;
}

/** @param {XElement} el @param {string[]} removed @returns {XElement|null} */
function scrub(el, removed) {
  const lower = el.name.toLowerCase();
  const whole = DROP_WHOLE.get(lower);
  if (whole) { removed.push(whole); return null; }
  const canonical = ELEMENTS.get(lower);
  if (!canonical) { removed.push('element'); return null; }

  /** @type {{name: string, value: string}[]} */ const attrs = [];
  for (const a of el.attrs) {
    const full = a.name.toLowerCase();
    const local = full.includes(':') ? full.slice(full.lastIndexOf(':') + 1) : full;
    if (full.startsWith('on')) { removed.push('handler'); continue; }
    if (full === 'xmlns' || full.startsWith('xmlns:')) {
      if (NAMESPACES.has(a.value.trim())) attrs.push(a);
      else removed.push('reference');
      continue;
    }
    if (REF_ATTRS.has(local)) {
      if (localRef(a.value)) attrs.push(a);
      else removed.push('reference');
      continue;
    }
    if (local === 'style') {
      const f = filterCss(a.value);
      for (const r of f.removed) removed.push(r);
      if (f.css.trim()) attrs.push({ name: a.name, value: f.css });
      continue;
    }
    if (!ATTRS.has(local)) { removed.push('attribute'); continue; }
    const f = filterCss(a.value);
    for (const r of f.removed) removed.push(r);
    attrs.push({ name: a.name, value: f.css });
  }

  /** @type {XNode[]} */ const children = [];
  if (canonical === 'style') {
    const f = filterCss(textOf(el));
    for (const r of f.removed) removed.push(r);
    if (f.css.trim()) children.push({ type: 'text', text: f.css });
  } else {
    for (const c of el.children) {
      if (c.type === 'text') { if (c.text) children.push(c); continue; }
      const kid = scrub(/** @type {XElement} */ (c), removed);
      if (kid) children.push(kid);
    }
  }
  return { type: 'element', name: canonical, attrs, children };
}

// ---------------------------------------------------------------------------------------------
// serialising
// ---------------------------------------------------------------------------------------------

/** @param {string} s @returns {string} */
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {string} s @returns {string} */
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

/** @param {XNode} node @returns {string} */
export function serialize(node) {
  if (node.type === 'text') return escapeText(node.text);
  let s = '<' + node.name;
  for (const a of node.attrs) s += ' ' + a.name + '="' + escapeAttr(a.value) + '"';
  if (!node.children.length) return s + '/>';
  return s + '>' + node.children.map(serialize).join('') + '</' + node.name + '>';
}

/**
 * Parse, allow-list and re-serialise an SVG. The result is bytes WE wrote from a tree we
 * understood — not the caller's bytes with holes cut in them.
 * @param {string} source
 * @returns {{ok: boolean, svg: string, removed: string[], error?: string}}
 */
export function sanitizeSvg(source) {
  const parsed = parseXml(String(source == null ? '' : source).trim());
  if (!parsed.ok) return { ok: false, svg: '', removed: [], error: parsed.error };
  if (parsed.root.name.toLowerCase() !== 'svg') {
    return { ok: false, svg: '', removed: [], error: 'root element is <' + parsed.root.name + '>, not <svg>' };
  }
  const removed = parsed.removed.slice();
  const clean = scrub(parsed.root, removed);
  if (!clean) return { ok: false, svg: '', removed: Array.from(new Set(removed)), error: 'the root <svg> was refused' };
  repairNamespaces(clean);
  return { ok: true, svg: serialize(clean), removed: Array.from(new Set(removed)) };
}

/** The SVG namespace, which the root MUST declare for `image/svg+xml` to draw at all. */
export const SVG_NS = 'http://www.w3.org/2000/svg';
/** The xlink namespace, which an `xlink:href` needs declared or the whole document fails. */
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Critic R1 A8: an SVG is shown as `<img src="data:image/svg+xml,…">`, and there a root with no
 * `xmlns` — or an `xlink:` attribute whose prefix nobody declared — is a BLANK picture with no
 * error at all. Inline in HTML both are forgiven, which is why a model writes them constantly.
 * The tree is ours by now (every attribute allow-listed), so the two declarations are simply
 * added: the SVG namespace on the root when it is missing (or was refused as foreign), and the
 * xlink one when any `xlink:` attribute survived. Mutates the root. @param {XElement} root
 */
function repairNamespaces(root) {
  const has = (/** @type {string} */ name) => root.attrs.some((a) => a.name === name);
  if (!has('xmlns')) root.attrs.unshift({ name: 'xmlns', value: SVG_NS });
  if (!has('xmlns:xlink') && usesPrefix(root, 'xlink')) {
    const at = root.attrs.findIndex((a) => a.name === 'xmlns') + 1;
    root.attrs.splice(at, 0, { name: 'xmlns:xlink', value: XLINK_NS });
  }
}

/** Does any element in the tree carry an attribute with this prefix? @param {XElement} el
 * @param {string} prefix @returns {boolean} */
function usesPrefix(el, prefix) {
  if (el.attrs.some((a) => a.name.startsWith(`${prefix}:`))) return true;
  for (const c of el.children) if (c.type === 'element' && usesPrefix(c, prefix)) return true;
  return false;
}
