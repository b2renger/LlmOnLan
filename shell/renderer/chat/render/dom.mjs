// @ts-check
/**
 * render/dom.mjs - the ONLY path from model text to DOM nodes (plan section 1.2). PURE module:
 * the document is injected (`domFactory(doc)`), so it imports and runs under Node with the unit
 * runner's DOM shim.
 *
 * Nodes are built with createElement / createTextNode / setAttribute only. There is no HTML
 * parsing anywhere: raw HTML in model output is text, because the parser already made it text.
 *
 * - ALLOWED_TAGS is the complete set an H factory will create; `figure` and `button` exist for the
 *   code chrome our own code adds (P1-U3), never for markdown.
 * - ALLOWED_ATTRS is the complete set of settable attributes, plus data-*.
 * - safeHref accepts http: and https: ONLY, after trimming, decoding entities and dropping control
 *   characters; everything else (every other scheme included) renders as plain text. KNOWN FALSE
 *   NEGATIVE: an href that is over-encoded by one level ('...?q=1&amp;amp;b=2') keeps decoding, so
 *   it is refused and the link renders as plain text - see the note on safeHref itself.
 * - markdown images never load: they become a link chip.
 * - svgImg is the single place an <img> is created, and only from a data: URL we encode ourselves.
 */

import { parseInline } from './md-inline.mjs';

export const ALLOWED_TAGS = Object.freeze([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'em', 'del', 'a', 'hr', 'br', 'input',
  'sup', 'sub', 'kbd', 'details', 'summary', 'img', 'span', 'figure', 'figcaption', 'button',
]);

export const ALLOWED_ATTRS = Object.freeze([
  'href', 'target', 'rel', 'type', 'checked', 'disabled', 'align', 'start', 'class', 'src',
]);

const TAGS = new Set(ALLOWED_TAGS);
const ATTRS = new Set(ALLOWED_ATTRS);
const SVG_MAX = 200 * 1024;

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', sol: '/', tab: '\t',
  newline: '\n', nbsp: ' ', period: '.', num: '#', lpar: '(', rpar: ')',
};

/** One pass of HTML-entity decoding (numeric + the handful of named ones that matter here). */
function decodeEntities(/** @type {string} */ s) {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);?/g, (whole, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    const v = /** @type {any} */ (NAMED)[body.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

/** Strip control characters and all whitespace - both are used to hide a scheme. */
function strip(/** @type {string} */ s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) || 0;
    if (c <= 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x200b || c === 0xfeff) continue;
    out += ch;
  }
  return out;
}

/**
 * The href to put in the DOM, or null when the link must render as plain text.
 * @param {string} href
 * @returns {string|null}
 */
export function safeHref(href) {
  if (typeof href !== 'string' || !href) return null;
  const once = strip(decodeEntities(href.trim()));
  let probe = once;
  for (let i = 0; i < 3; i++) {
    const next = strip(decodeEntities(probe));
    if (next === probe) break;
    probe = next;
  }
  // Validate exactly what we emit. `once` is what goes into the DOM (setAttribute does NOT decode
  // entities again), so a value that keeps decoding into something else is a parser differential:
  // '&amp;#104;ttps://evil/x' probes as an http URL but would be written as a RELATIVE one,
  // resolving against the renderer's own file:// origin. No model legitimately means that, so a
  // still-encoded href is refused outright and the link renders as plain text.
  // KNOWN FALSE NEGATIVE, accepted deliberately: a URL copied out of already-escaped HTML
  // ('...?q=1&amp;amp;b=2') decodes to '...?q=1&amp;b=2', which still decodes, so it is refused and
  // renders as plain text. Percent-encoding the surviving '&' instead would make once === probe by
  // construction, but it also silently REWRITES a value we cannot prove the author meant; refusing
  // is the honest half of "validate exactly what we emit". P3 feeds SearXNG result URLs and
  // citation targets through here - if one of those sources is found to double-encode, fix it at
  // the source, not by loosening this test.
  if (once !== probe) return null;
  const low = probe.toLowerCase();
  if (!(low.startsWith('http://') || low.startsWith('https://'))) return null;
  return once;
}

/**
 * A node factory bound to one document.
 * @param {any} doc
 */
export function domFactory(doc) {
  const H = {
    doc,
    /**
     * @param {string} tag
     * @param {Record<string, string|number|boolean|null|undefined>} [attrs]
     * @param {any[]|string} [children]
     */
    el(tag, attrs, children) {
      if (!TAGS.has(tag)) throw new Error(`dom: tag not allowed: ${tag}`);
      const node = doc.createElement(tag);
      if (attrs) {
        for (const k of Object.keys(attrs)) {
          const v = attrs[k];
          if (v === null || v === undefined || v === false) continue;
          if (!ATTRS.has(k) && !k.startsWith('data-')) throw new Error(`dom: attribute not allowed: ${k}`);
          if (k === 'src' && !H._srcOk) throw new Error('dom: src is only set by svgImg');
          node.setAttribute(k, v === true ? '' : String(v));
        }
      }
      if (typeof children === 'string') node.appendChild(doc.createTextNode(children));
      else if (children) for (const c of children) if (c) node.appendChild(c);
      return node;
    },
    /** @param {string} s */
    text(s) { return doc.createTextNode(s === undefined || s === null ? '' : String(s)); },
    frag() { return doc.createDocumentFragment(); },
    /** @param {string} href @param {string|any[]} children */
    link(href, children) {
      // null means "render this as plain text": a disallowed scheme, or the over-encoded href the
      // safeHref note calls out. renderInline falls back to the link's own children.
      const safe = safeHref(href);
      if (!safe) return null;
      return H.el('a', { href: safe, target: '_blank', rel: 'noopener noreferrer' }, children);
    },
    /**
     * The one place an <img> is created: an inline SVG we re-encode ourselves as a data: URL.
     * @param {string} source
     */
    svgImg(source) {
      if (typeof source !== 'string') return null;
      const src = source.trim();
      if (!src.toLowerCase().startsWith('<svg')) return null;
      if (src.length > SVG_MAX) return null;
      if (src.toLowerCase().indexOf('<foreignobject') >= 0) return null;
      H._srcOk = true;
      try {
        return H.el('img', {
          class: 'chat-svg',
          src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src),
        });
      } finally {
        H._srcOk = false;
      }
    },
    _srcOk: false,
  };
  return H;
}

/** @typedef {ReturnType<typeof domFactory>} H */

const plainText = (/** @type {any[]} */ inlines) => inlines.map((n) => {
  if (n.type === 'text' || n.type === 'code') return n.text;
  if (n.type === 'cite') return `[${n.n}]`;
  if (n.type === 'image') return n.alt || n.src;
  if (n.type === 'break') return '\n';
  return n.children ? plainText(n.children) : '';
}).join('');

/**
 * @param {any[]} inlines
 * @param {any} H
 * @param {{citations?: (n: number) => ({url: string, title?: string}|null)}} [opts]
 * @returns {any} a DocumentFragment
 */
export function renderInline(inlines, H, opts) {
  const o = opts || {};
  const frag = H.frag();
  for (const node of inlines || []) {
    switch (node.type) {
      case 'text':
        frag.appendChild(H.text(node.text));
        break;
      case 'code':
        frag.appendChild(H.el('code', { class: 'chat-code-inline' }, node.text));
        break;
      case 'strong':
      case 'em':
      case 'del': {
        const tag = node.type === 'strong' ? 'strong' : node.type === 'em' ? 'em' : 'del';
        frag.appendChild(H.el(tag, null, [renderInline(node.children, H, o)]));
        break;
      }
      case 'link': {
        const a = H.link(node.href, [renderInline(node.children, H, o)]);
        frag.appendChild(a || H.text(plainText([node])));
        break;
      }
      case 'image': {
        const chip = H.link(node.src, node.alt || node.src);
        if (chip) { chip.setAttribute('class', 'chat-imgchip'); frag.appendChild(chip); }
        else frag.appendChild(H.text(node.alt || node.src));
        break;
      }
      case 'cite': {
        const hit = o.citations ? o.citations(node.n) : null;
        if (hit && hit.url) {
          const a = H.link(hit.url, String(node.n));
          if (a) {
            if (hit.title) a.setAttribute('data-title', hit.title);
            frag.appendChild(H.el('sup', { class: 'chat-cite' }, [a]));
            break;
          }
        }
        frag.appendChild(H.text(`[${node.n}]`));
        break;
      }
      case 'break':
        frag.appendChild(H.el('br'));
        break;
      default:
        break;
    }
  }
  return frag;
}

/** Inline markdown -> nodes, in one call. */
function inlineOf(/** @type {string} */ text, /** @type {any} */ H, /** @type {any} */ o) {
  return renderInline(parseInline(text, { citations: !!o.citations }), H, o);
}

/**
 * @param {any[]} blocks
 * @param {any} H
 * @param {{citations?: (n: number) => ({url: string, title?: string}|null)}} [opts]
 * @returns {any} a DocumentFragment
 */
export function renderBlocks(blocks, H, opts) {
  const o = opts || {};
  const frag = H.frag();
  for (const b of blocks || []) {
    frag.appendChild(renderBlock(b, H, o));
  }
  return frag;
}

/** One block -> one element. Exported so a streaming renderer can re-render just the open block. */
export function renderBlock(/** @type {any} */ b, /** @type {any} */ H, /** @type {any} */ opts) {
  const o = opts || {};
  switch (b.type) {
    case 'heading':
      return H.el(`h${Math.min(6, Math.max(1, b.level))}`, null, [inlineOf(b.text, H, o)]);
    case 'paragraph':
      return H.el('p', null, [inlineOf(b.text, H, o)]);
    case 'hr':
      return H.el('hr');
    case 'code': {
      const code = H.el('code', { class: b.lang ? `language-${b.lang.replace(/[^a-z0-9+#.-]/gi, '')}` : null }, b.code);
      const pre = H.el('pre', { class: 'chat-code' }, [code]);
      return H.el('figure', { class: 'chat-codeblock', 'data-lang': b.lang || '', 'data-closed': b.closed ? '1' : '0' }, [pre]);
    }
    case 'quote':
      return H.el('blockquote', null, [renderBlocks(b.blocks, H, o)]);
    case 'list': {
      const items = (b.items || []).map((item) => {
        const kids = [];
        if (item.task !== null && item.task !== undefined) {
          kids.push(H.el('input', { type: 'checkbox', disabled: true, checked: item.task ? true : null, class: 'chat-task' }));
        }
        const blocks = item.blocks || [];
        if (blocks.length === 1 && blocks[0].type === 'paragraph') kids.push(inlineOf(blocks[0].text, H, o));
        else kids.push(renderBlocks(blocks, H, o));
        return H.el('li', item.task === null || item.task === undefined ? null : { class: 'chat-taskitem' }, kids);
      });
      const attrs = b.ordered && b.start && b.start !== 1 ? { start: b.start } : null;
      return H.el(b.ordered ? 'ol' : 'ul', attrs, items);
    }
    case 'table': {
      const align = b.align || [];
      const headRow = H.el('tr', null, (b.header || []).map((cell, i) =>
        H.el('th', align[i] ? { align: align[i] } : null, [inlineOf(cell, H, o)])));
      const body = (b.rows || []).map((row) => H.el('tr', null, row.map((cell, i) =>
        H.el('td', align[i] ? { align: align[i] } : null, [inlineOf(cell, H, o)]))));
      return H.el('table', { class: 'chat-table' }, [
        H.el('thead', null, [headRow]),
        H.el('tbody', null, body),
      ]);
    }
    default:
      return H.el('p', null, [H.text('')]);
  }
}
