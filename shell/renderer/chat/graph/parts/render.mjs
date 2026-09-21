// @ts-check
// Render (C3-U2) — markdown, SVG or an HTML page drawn as a tile on the canvas (spec §3). Its
// OUTPUT is an `image` value: a data URL plus the SOURCE it was drawn from and the MODE it was
// read as, so "save as .svg" is byte-exact and a downstream Look (when vision lands) has a real
// picture to look at.
//
// WHY a snapshot and not a live iframe per part (frozen at the C3 kickoff, plan §2.6 BJ-7):
// there is AT MOST ONE sandbox in the process. One live preview per Render part would be one
// iframe — one process — per part, against a canvas that must pan 500 parts at 60 fps. The
// panel's single sandbox draws each Render part in turn during a run and captures a picture.
//
// WHY `svg` never touches the sandbox: an SVG already IS a picture. Rasterising it would cost a
// guest round-trip and LOSE fidelity, and the export is then no longer the bytes the reader saw.
// We sanitise it instead (`sanitizeSvg`) — not because the sandbox needs it, but because the
// exported file gets opened in a browser that has none of the sandbox's restrictions.
//
// `html` mode hands the page to the guest VERBATIM: that is what the mode means, and the sandbox
// is its containment. Nothing offers that page back as a file — the only exports here are the
// sanitised .svg and the raster .png of what was drawn.

import { valueOf } from '../values.mjs';
import { partFail, textOf, pickerRow } from './common.mjs';
import { numberField } from './fields.mjs';
import { parseBlocks } from '../../render/md-block.mjs';
import { parseInline } from '../../render/md-inline.mjs';
import { LIMITS } from '../../sandbox/protocol.mjs';
import { sanitizeSvg as sanitizeSvgTree } from '../../design/svg-sanitize.mjs';
import { download, slugify } from '../../ui/transfer.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/sandbox.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** What the text is read as. Frozen: a fourth mode is a contract request, not a new string. */
export const RENDER_MODES = Object.freeze(['markdown', 'svg', 'html']);

/** The picture a part may CARRY. A graph doc is persisted whole on every run, so a four-megabyte
 * tile would be re-written to IndexedDB on every edit of any part. */
export const MAX_TILE_BYTES = 1024 * 1024;

/** Bounds on the drawing surface, in device-independent pixels. */
export const MIN_SIZE = 64;
export const MAX_SIZE = 2048;

// ---------------------------------------------------------------------------------------------
// markdown -> an HTML page the guest can lay out (pure: our own parser, never a new one)
// ---------------------------------------------------------------------------------------------

/** @param {any} s @returns {string} */
export function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Only what the guest can actually reach: it has `img-src data: blob:` and `connect-src 'none'`,
 * so an http link is text and an http image is nothing at all. @param {string} href */
function safeLink(href) {
  const h = String(href || '').trim();
  return /^https?:\/\//i.test(h) ? h : '';
}

/** @param {any[]} inlines @returns {string} */
function inlineHtml(inlines) {
  let out = '';
  for (const node of inlines || []) {
    if (!node) continue;
    if (node.type === 'text') out += escapeHtml(node.text);
    else if (node.type === 'code') out += `<code>${escapeHtml(node.text)}</code>`;
    else if (node.type === 'strong') out += `<strong>${inlineHtml(node.children)}</strong>`;
    else if (node.type === 'em') out += `<em>${inlineHtml(node.children)}</em>`;
    else if (node.type === 'del') out += `<del>${inlineHtml(node.children)}</del>`;
    else if (node.type === 'break') out += '<br>';
    else if (node.type === 'cite') out += `<sup>${escapeHtml(String(node.n))}</sup>`;
    else if (node.type === 'image') {
      const src = /^data:image\//i.test(String(node.src || '')) ? String(node.src) : '';
      out += src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.alt || '')}">` : escapeHtml(node.alt || '');
    } else if (node.type === 'link') {
      const href = safeLink(node.href);
      const body = inlineHtml(node.children);
      out += href ? `<a href="${escapeHtml(href)}">${body}</a>` : body;
    } else if (node.children) out += inlineHtml(node.children);
  }
  return out;
}

/** @param {any[]} blocks @returns {string} */
function blocksHtml(blocks) {
  let out = '';
  for (const b of blocks || []) {
    if (!b) continue;
    if (b.type === 'heading') {
      const level = Math.min(6, Math.max(1, Number(b.level) || 1));
      out += `<h${level}>${inlineHtml(parseInline(b.text))}</h${level}>`;
    } else if (b.type === 'paragraph') out += `<p>${inlineHtml(parseInline(b.text))}</p>`;
    else if (b.type === 'code') out += `<pre><code>${escapeHtml(b.code)}</code></pre>`;
    else if (b.type === 'hr') out += '<hr>';
    else if (b.type === 'quote') out += `<blockquote>${blocksHtml(b.blocks)}</blockquote>`;
    else if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      const start = b.ordered && Number(b.start) > 1 ? ` start="${escapeHtml(String(b.start))}"` : '';
      let items = '';
      for (const item of b.items || []) {
        const mark = item && item.task === true ? '[x] ' : item && item.task === false ? '[ ] ' : '';
        const own = (item && item.blocks) || [];
        // A one-paragraph item is a LINE, not a paragraph inside a bullet: `<li><p>one</p></li>`
        // reads as a paragraph of space in a picture of a list.
        const body = own.length === 1 && own[0] && own[0].type === 'paragraph'
          ? inlineHtml(parseInline(own[0].text))
          : blocksHtml(own);
        items += `<li>${escapeHtml(mark)}${body}</li>`;
      }
      out += `<${tag}${start}>${items}</${tag}>`;
    } else if (b.type === 'table') {
      const head = (b.header || []).map((c) => `<th>${inlineHtml(parseInline(c))}</th>`).join('');
      const rows = (b.rows || [])
        .map((r) => `<tr>${(r || []).map((c) => `<td>${inlineHtml(parseInline(c))}</td>`).join('')}</tr>`)
        .join('');
      out += `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
  }
  return out;
}

/** Markdown as the body of a page. Our own block/inline parsers, so the tile says what the chat
 * says. @param {string} source @returns {string} */
export function markdownToHtml(source) {
  return blocksHtml(parseBlocks(String(source || '')));
}

/** The guest's page styling. Deliberately colourless: the guest document's own defaults are a
 * white page with black text, which is what a picture of a document should be. */
export const PAGE_CSS = [
  'html,body{margin:0;padding:16px;}',
  'body{font:14px/1.5 Inter,system-ui,sans-serif;word-wrap:break-word;}',
  'pre,code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;}',
  'pre{padding:8px;overflow:hidden;}',
  'table{border-collapse:collapse;}th,td{border:1px solid;padding:4px 8px;text-align:left;}',
  'img,svg{max-width:100%;}',
  'h1,h2,h3{margin:0.6em 0 0.3em;}p,ul,ol,table,pre{margin:0.5em 0;}',
].join('\n');

// ---------------------------------------------------------------------------------------------
// SVG: what leaves this part as a FILE, so it is sanitised even though the sandbox contains it
// ---------------------------------------------------------------------------------------------

/**
 * Remove everything in an SVG that can execute or phone home, and say what was removed.
 *
 * The implementation lives in `design/svg-sanitize.mjs` (BK-10c, folded in at the C3 fix pass):
 * it PARSES the document, walks it against an element/attribute allow-list and re-serialises the
 * tree it understood. The regex scrub that used to live here shipped the caller's own bytes back
 * with holes cut in them, and five shapes walked through with nothing reported — an unterminated
 * `<script>`, an unquoted `href=`, SMIL's `<set attributeName="href">`, `@import` inside a
 * `<style>`, and an unterminated `<foreignObject>`. That mattered because these bytes leave the
 * app: Render(svg) → File('x.svg') writes them into the thread's project and the reader opens
 * them in a browser with none of the guest's CSP.
 *
 * @param {string} source @returns {{ok: boolean, svg: string, removed: string[], error?: string}}
 */
export function sanitizeSvg(source) {
  return sanitizeSvgTree(source);
}

/** An SVG as a picture, encoded by us and never fetched. @param {string} svg @returns {string} */
export function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svg || ''))}`;
}

/** The declared size of an `<svg>` element, for the value's w/h. @param {string} svg
 * @param {{w: number, h: number}} fallback @returns {{w: number, h: number}} */
export function svgSize(svg, fallback) {
  const head = String(svg || '').slice(0, 600);
  const num = (/** @type {RegExpMatchArray|null} */ m) => (m ? Number.parseFloat(m[1]) : NaN);
  let w = num(head.match(/\swidth\s*=\s*["']([0-9.]+)/i));
  let h = num(head.match(/\sheight\s*=\s*["']([0-9.]+)/i));
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    const box = head.match(/\sviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i);
    if (box) { w = Number.parseFloat(box[1]); h = Number.parseFloat(box[2]); }
  }
  return {
    w: Number.isFinite(w) && w > 0 ? Math.round(w) : fallback.w,
    h: Number.isFinite(h) && h > 0 ? Math.round(h) : fallback.h,
  };
}

/** @param {any} settings @returns {{mode: string, width: number, height: number}} */
export function readSettings(settings) {
  const s = settings || {};
  const mode = RENDER_MODES.indexOf(String(s.mode)) >= 0 ? String(s.mode) : 'markdown';
  const clamp = (/** @type {any} */ n, /** @type {number} */ d) => {
    const v = Math.round(Number(n));
    return Number.isFinite(v) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, v)) : d;
  };
  return { mode, width: clamp(s.width, 640), height: clamp(s.height, 480) };
}

/** Hand a picture to the reader as a file. `download()` carries TEXT (an SVG is text); a PNG is
 * bytes we already hold as a data URL, and the anchor is the one way a renderer offers those.
 * A shared bytes door in ui/transfer.mjs is a contract request, not something this part invents.
 * @param {string} filename @param {string} dataUrl */
function savePicture(filename, dataUrl) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.appendChild(a);
  try { a.click(); } finally { a.remove(); }
}

/** @param {any} value @returns {{dataUrl: string, source: string, mode: string}|null} */
function pictureOf(value) {
  if (!value || value.kind !== 'image') return null;
  const data = value.data || {};
  const dataUrl = String(data.dataUrl || '');
  if (!dataUrl) return null;
  return { dataUrl, source: String(data.source || ''), mode: String(data.mode || '') };
}

/** @type {PartSpec} */
export const render = /** @type {any} */ ({
  type: 'render',
  order: 810,
  label: t('parts.renderLabel'),
  thinks: false,
  size: { w: 280, h: 260 },
  // Like Code: takes the whole value, never fans (BJ-9). A list of forty SVGs is forty pictures
  // the reader cannot see at once; join it with Collect, or fan the part that made it.
  inputs: [{ name: 'in', label: t('parts.renderIn'), accepts: ['text', 'json', 'list'], many: true }],
  output: 'image',
  defaults: () => ({ mode: 'markdown', width: 640, height: 480 }),

  render(host, part, ctx) {
    /** The part as the canvas last painted it: `ctx.part` is the one handed in at render time, and
     * the save buttons must act on the picture that is on screen NOW. */
    let live = part;

    const wrap = document.createElement('div');
    wrap.className = 'graph-render';

    const modeRow = pickerRow(
      t('parts.renderMode'),
      [
        { value: 'markdown', label: t('parts.renderModeMarkdown') },
        { value: 'svg', label: t('parts.renderModeSvg') },
        { value: 'html', label: t('parts.renderModeHtml') },
      ],
      readSettings(part.settings).mode,
      (v) => { ctx.update({ mode: v }); ctx.commit(t('parts.renderLabel')); },
    );

    // The drawing surface, which only the laid-out modes have: an SVG brings its own size.
    const sizeRow = document.createElement('div');
    sizeRow.className = 'graph-render-size';
    const w = numberField(t('parts.renderWidth'), readSettings(part.settings).width, MIN_SIZE, (n) => {
      ctx.update({ width: n });
      ctx.commit(t('parts.renderWidth'));
    }, MAX_SIZE);
    const h = numberField(t('parts.renderHeight'), readSettings(part.settings).height, MIN_SIZE, (n) => {
      ctx.update({ height: n });
      ctx.commit(t('parts.renderHeight'));
    }, MAX_SIZE);
    sizeRow.append(w.node, h.node);

    const tile = document.createElement('img');
    tile.className = 'graph-render-tile';
    tile.alt = t('parts.renderAlt');
    tile.hidden = true;

    const empty = document.createElement('p');
    empty.className = 'graph-part-note';
    empty.textContent = t('parts.renderNothingYet');

    const tools = document.createElement('div');
    tools.className = 'graph-render-tools';
    /** @param {string} label @param {() => void} onClick */
    const button = (label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'graph-render-save';
      b.textContent = label;
      b.hidden = true;
      b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
      return b;
    };
    const name = () => `${slugify(t('parts.renderLabel'))}-${String(part.id)}`;
    const saveSvg = button(t('parts.renderSaveSvg'), () => {
      const shot = pictureOf(live.value);
      if (shot) void download(`${name()}.svg`, shot.source, 'image/svg+xml', { app: ctx.app });
    });
    const savePng = button(t('parts.renderSavePng'), () => {
      const shot = pictureOf(live.value);
      if (shot) savePicture(`${name()}.png`, shot.dataUrl);
    });
    tools.append(saveSvg, savePng);

    wrap.append(modeRow, sizeRow, tile, empty, tools);
    host.replaceChildren(wrap);

    /** @param {any} p */
    const paint = (p) => {
      live = p;
      const s = readSettings(p.settings);
      const shot = pictureOf(p.value);
      tile.hidden = !shot;
      empty.hidden = !!shot;
      if (shot) tile.src = shot.dataUrl;
      else tile.removeAttribute('src');
      saveSvg.hidden = !(shot && shot.mode === 'svg' && shot.source);
      savePng.hidden = !(shot && /^data:image\/png/i.test(shot.dataUrl));
      sizeRow.hidden = s.mode === 'svg';
      w.update(s.width);
      h.update(s.height);
      const select = /** @type {any} */ (modeRow.querySelector('select'));
      if (select && document.activeElement !== select) select.value = s.mode;
    };
    paint(part);

    return {
      update(next) { paint(next); },
      destroy() { wrap.remove(); },
    };
  },

  async run(input) {
    const source = (input.inputs.in || []).map(textOf).join('\n\n');
    if (!source.trim()) throw partFail(t('parts.errRenderEmpty'), 'empty');
    const { mode, width, height } = readSettings(input.part.settings);

    // ---- the vector path: no sandbox, no rasterising, and the export is the bytes shown.
    if (mode === 'svg') {
      const clean = sanitizeSvg(source);
      if (!clean.ok) throw partFail(t('parts.errRenderNotSvg'), 'invalid');
      const dataUrl = svgDataUrl(clean.svg);
      if (dataUrl.length > MAX_TILE_BYTES) throw partFail(t('parts.errRenderTooBig'), 'part');
      const size = svgSize(clean.svg, { w: width, h: height });
      return valueOf('image', { dataUrl, w: size.w, h: size.h, source: clean.svg, mode });
    }

    // ---- the laid-out path: the panel's ONE sandbox draws, then hands back a picture.
    const sandbox = typeof input.sandbox === 'function' ? await input.sandbox() : null;
    if (!sandbox) throw partFail(t('sandbox.errDisabled'), 'part');
    const html = mode === 'html' ? source : markdownToHtml(source);
    const out = await sandbox.run({
      kind: 'dom',
      code: '',
      html,
      css: PAGE_CSS,
      params: { width, height, mode },
    });
    if (!out || !out.ok) {
      const message = String((out && out.error && out.error.message) || '') || t('sandbox.errNotBuilt');
      throw partFail(message, 'part');
    }
    const maxPx = Math.min(LIMITS.maxPx, Math.max(width, height));
    const shot = await sandbox.snapshot({ maxPx });
    if (!shot || !shot.dataUrl) throw partFail(t('parts.errRenderNoPicture'), 'part');
    if (String(shot.dataUrl).length > MAX_TILE_BYTES) throw partFail(t('parts.errRenderTooBig'), 'part');
    return valueOf('image', {
      dataUrl: shot.dataUrl,
      w: Number(shot.w) || width,
      h: Number(shot.h) || height,
      source,
      mode,
    });
  }
});
