// @ts-check
// Preview (K4-U3) — the box that SHOWS what arrived: markdown, SVG, a web page, three.js, p5.js.
// COMPUTER_PLAN §6.5, §6.8; K4 addendum KD-6.
//
// THE TWO HALVES, and why they are different.
//
//   markdown and svg are LIVE AND FREE. Markdown goes through `parseBlocks` + `renderBlocks` with
//   `domFactory(document)` — the SAME safe builder the chat uses, so model text becomes NODES and
//   never HTML, and the Computer gains no second route from a generation to the DOM. An SVG goes
//   through `design/svg-sanitize.mjs` and is then shown as an `<img src="data:image/svg+xml,…">`:
//   an img cannot run script, and the bytes on screen are byte-for-byte the bytes "Save…" writes.
//   NEITHER path creates an iframe — lint rule 12 allows exactly one file to make one and it is
//   `sandbox/host.mjs`; these two never ask it.
//
//   html, three and p5 are a PNG SNAPSHOT from the panel's ONE guest (§2.6 BJ-7: at most one
//   sandbox in the process, because one live iframe per part is one process per part against a
//   canvas that must pan 500 parts at 60 fps). This is the path `graph/parts/render.mjs` already
//   walks; Preview is the door a reader is offered now, and `render` stays LOADABLE for graphs
//   made in C3.
//
// WHAT A RUN LEAVES BEHIND, and why it is not `part.value`. Preview's `output` is `null` — it is a
// window, not a source — and the runner writes `value: null` for a part that declares no output
// (`wantsValue`, graph/runner.mjs). So what was drawn lives in this module's own `SHOWN` map,
// keyed by part id: RUNTIME state, deliberately not persisted, which is exactly right for a
// picture. `settings` (the mode and the drawing size) is the program and persists as usual.
//
// "OPEN LIVE" IS NOT HERE. §6.5 asks for a toggle that MOVES the single guest into this box.
// Moving it needs the frame reparented or rebuilt at a new mount, and neither is reachable from a
// part: `SandboxHost.mount()` only chooses where the NEXT frame boots, `hide()` costs a ten-second
// grace, and `destroy()` is permanent for the whole panel. The K4 kickoff pre-declared "a live
// Preview frame" as a contract request against the integrator-owned `computer/host.mjs`; this unit
// files it rather than inventing a second sandbox or reaching into another module's DOM. Until it
// lands, the snapshot says what it is (`parts.previewSnapshot`) and nothing on the box lies.

import { partFail, textOf, pickerRow } from './common.mjs';
import { numberField } from './fields.mjs';
import { isValue } from '../values.mjs';
import { parseBlocks } from '../../render/md-block.mjs';
import { renderBlocks, domFactory } from '../../render/dom.mjs';
import { sanitizeSvg } from '../../design/svg-sanitize.mjs';
import { LIMITS } from '../../sandbox/protocol.mjs';
import { download, slugify } from '../../ui/transfer.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-preview.en.mjs';
import '../../strings/sandbox.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

/** What the text is read as. `auto` reads the value's `format`/`lang` facet (§6.8); it NEVER
 * sniffs a Code part's output, because that part's picker is the answer. Frozen: a seventh mode
 * is a contract request, not a new string. */
export const PREVIEW_MODES = Object.freeze(['auto', 'markdown', 'svg', 'html', 'three', 'p5']);

/** The modes this box draws itself, with no guest and no iframe. */
export const FREE_MODES = Object.freeze(['markdown', 'svg']);

/** The modes that cost one turn of the single sandbox guest and come back as a picture. */
export const SANDBOX_MODES = Object.freeze(['html', 'three', 'p5']);

/** The picture a box may hold. Same ceiling as Render's: a four-megabyte tile in a document that
 * is persisted whole would be re-written on every edit of any part. */
export const MAX_TILE_BYTES = 1024 * 1024;

/** Bounds on the drawing surface, in device-independent pixels. */
export const MIN_SIZE = 64;
export const MAX_SIZE = 2048;

/** How many drawings this module remembers at once. A Preview's picture is runtime state, and a
 * reader who deletes a box must not leave a megabyte behind in a module-level Map. */
export const MAX_SHOWN = 32;

/** The guest's page styling for `html` mode. Deliberately colourless — the guest document's own
 * defaults are a white page with black text, which is what a picture of a page should be. It is a
 * copy of Render's and not an import: KD-6 lets this unit delete `render.mjs`, and a preview that
 * imported from it would be the one thing stopping that. */
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
// what a run leaves behind (runtime only — see the header)
// ---------------------------------------------------------------------------------------------

/** @typedef {{mode: string, source: string, text?: string, svg?: string, removed?: string[],
 *   dataUrl?: string, w?: number, h?: number, at: number}} Shown */

/** @type {Map<string, Shown>} */
const SHOWN = new Map();

/** What this box last drew, or null. @param {string} id @returns {Shown|null} */
export function shownOf(id) {
  return SHOWN.get(String(id)) || null;
}

/** Remember a drawing, oldest evicted first. @param {string} id @param {Shown} shot */
export function setShown(id, shot) {
  const key = String(id);
  SHOWN.delete(key);
  SHOWN.set(key, shot);
  while (SHOWN.size > MAX_SHOWN) {
    const oldest = SHOWN.keys().next();
    if (oldest.done) break;
    SHOWN.delete(oldest.value);
  }
}

/** Forget a box's drawing — called when its DOM goes away. @param {string} id */
export function clearShown(id) {
  SHOWN.delete(String(id));
}

// ---------------------------------------------------------------------------------------------
// settings, modes and what arrived
// ---------------------------------------------------------------------------------------------

/** @param {any} settings @returns {{mode: string, w: number, h: number, live: boolean}} */
export function readSettings(settings) {
  const s = settings || {};
  const mode = PREVIEW_MODES.indexOf(String(s.mode)) >= 0 ? String(s.mode) : 'auto';
  const clamp = (/** @type {any} */ n, /** @type {number} */ d) => {
    const v = Math.round(Number(n));
    return Number.isFinite(v) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, v)) : d;
  };
  return { mode, w: clamp(s.w, 320), h: clamp(s.h, 240), live: s.live === true };
}

/**
 * Which of the five real modes this box will use.
 *
 * `auto` reads the value's DECLARED `format` facet and nothing else (§6.8, §6.5). It does not look
 * at the bytes: sniffing `<svg` is the kind of magic that fails once — on a markdown report that
 * quotes an SVG — and is never trusted again. A Code part says what it made through its picker,
 * and that declaration is what arrives here as `format`. Anything undeclared falls to `markdown`,
 * which is the mode that renders plain prose, a table and a fenced block equally honestly and
 * costs no generation and no guest.
 * @param {string} setting @param {GraphValue|null} value @returns {string}
 */
export function modeFor(setting, value) {
  const want = PREVIEW_MODES.indexOf(String(setting)) >= 0 ? String(setting) : 'auto';
  if (want !== 'auto') return want;
  const format = isValue(value) ? String(/** @type {any} */ (value).format || 'plain') : 'plain';
  if (format === 'svg') return 'svg';
  if (format === 'html') return 'html';
  return 'markdown';
}

/** How each kind is spelled in the refusal sentence — "an image", not "image". */
const KIND_KEYS = Object.freeze({
  text: 'parts.previewKindText',
  json: 'parts.previewKindJson',
  list: 'parts.previewKindList',
  image: 'parts.previewKindImage',
  file: 'parts.previewKindFile',
});

/** How a kind is spelled in the refusal sentence. An unknown kind is spelled as it came, never
 * dropped: a sentence with a blank in it is worse than one with a token in it.
 * @param {string} kind @returns {string} */
export function kindLabel(kind) {
  const k = String(kind);
  if (!Object.prototype.hasOwnProperty.call(KIND_KEYS, k)) return k;
  return t(/** @type {any} */ (KIND_KEYS)[k]);
}

/**
 * The arrivals on `content` as ONE piece of text plus the facet to read it by.
 *
 * Several wires into one port is a join, not a fan (the fan is the runner's, and it happens to a
 * `list` before this is ever called): the pieces are separated by a blank line, which is a
 * paragraph break in markdown and whitespace everywhere else. The facet comes from the FIRST
 * arrival — a port fed one SVG and one paragraph is a graph asking to be read as the thing it
 * declared first, and `auto` is advisory anyway.
 * @param {GraphValue[]} values @returns {{text: string, value: GraphValue|null}}
 */
export function contentOf(values) {
  const list = (Array.isArray(values) ? values : []).filter(isValue);
  return {
    text: list.map(textOf).join('\n\n'),
    value: list.length ? list[0] : null,
  };
}

/** An SVG as a picture, encoded by us and never fetched. @param {string} svg @returns {string} */
export function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svg || ''))}`;
}

/** The sentence a failed guest run shows. A line number is the single most useful thing a sketch
 * can tell its author, so it is in the sentence whenever the guest reported one.
 * @param {any} error @returns {string} */
export function sandboxMessage(error) {
  const message = String((error && error.message) || '') || t('sandbox.errNotBuilt');
  const line = Number(error && error.line);
  return Number.isFinite(line) && line > 0 ? t('parts.previewError', { message, line }) : message;
}

/** Hand a picture to the reader as a file. `download()` carries TEXT; a PNG is bytes we already
 * hold as a data URL, and an anchor is the one way a renderer offers those. A shared bytes door in
 * ui/transfer.mjs is a contract request, not something this part invents.
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

// ---------------------------------------------------------------------------------------------
// the part
// ---------------------------------------------------------------------------------------------

/** @type {PartSpec} */
export const preview = /** @type {any} */ ({
  type: 'preview',
  order: 805,
  label: t('parts.previewLabel'),
  thinks: false,
  size: { w: 320, h: 260 },
  inputs: [{ name: 'content', label: t('parts.previewIn'), accepts: ['text', 'json'] }],
  output: null,
  quiet: true,
  defaults: () => ({ mode: 'auto', w: 320, h: 240, live: false }),

  render(host, part, ctx) {
    /** The part as the canvas last painted it: Save must act on what is on screen NOW. */
    let live = part;
    /** What `paint` last drew, so a pan or a selection does not re-parse a report. `null` until
     * the first paint — a value no stamp can equal, so the empty box still gets its sentence. */
    /** @type {string|null} */ let drawn = null;

    const wrap = document.createElement('div');
    wrap.className = 'graph-preview';

    const modeRow = pickerRow(
      t('parts.previewMode'),
      [
        { value: 'auto', label: t('parts.previewAuto') },
        { value: 'markdown', label: t('parts.previewMarkdown') },
        { value: 'svg', label: t('parts.previewSvg') },
        { value: 'html', label: t('parts.previewHtml') },
        { value: 'three', label: t('parts.previewThree') },
        { value: 'p5', label: t('parts.previewP5') },
      ],
      readSettings(part.settings).mode,
      (v) => { ctx.update({ mode: v }); ctx.commit(t('parts.previewLabel')); },
    );

    // The drawing surface, which only the guest-drawn modes have: markdown reflows to the box and
    // an SVG brings its own size.
    const sizeRow = document.createElement('div');
    sizeRow.className = 'graph-preview-size';
    const w = numberField(t('parts.previewWidth'), readSettings(part.settings).w, MIN_SIZE, (n) => {
      ctx.update({ w: n });
      ctx.commit(t('parts.previewWidth'));
    }, MAX_SIZE);
    const h = numberField(t('parts.previewHeight'), readSettings(part.settings).h, MIN_SIZE, (n) => {
      ctx.update({ h: n });
      ctx.commit(t('parts.previewHeight'));
    }, MAX_SIZE);
    sizeRow.append(w.node, h.node);

    const body = document.createElement('div');
    body.className = 'graph-preview-body';

    const note = document.createElement('p');
    note.className = 'graph-preview-note';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'graph-preview-save';
    save.textContent = t('parts.previewExport');
    save.hidden = true;
    save.addEventListener('click', (e) => {
      e.preventDefault();
      const shot = shownOf(live.id);
      if (!shot) return;
      const name = `${slugify(t('parts.previewLabel'))}-${String(live.id)}`;
      if (shot.mode === 'svg' && shot.svg) void download(`${name}.svg`, shot.svg, 'image/svg+xml', { app: ctx.app });
      else if (shot.mode === 'markdown') void download(`${name}.md`, shot.source, 'text/markdown', { app: ctx.app });
      else if (shot.dataUrl) savePicture(`${name}.png`, shot.dataUrl);
    });

    wrap.append(modeRow, sizeRow, body, note, save);
    host.replaceChildren(wrap);

    /** @param {any} p */
    const paint = (p) => {
      live = p;
      const s = readSettings(p.settings);
      // The size fields belong to the guest-drawn modes. On `auto` nothing is known until a value
      // arrives, so they follow what was actually drawn rather than guessing.
      const shownMode = (shownOf(p.id) || {}).mode || '';
      const effective = s.mode === 'auto' ? shownMode : s.mode;
      sizeRow.hidden = SANDBOX_MODES.indexOf(effective) < 0;
      w.update(s.w);
      h.update(s.h);
      const select = /** @type {any} */ (modeRow.querySelector('select'));
      if (select && document.activeElement !== select) select.value = s.mode;

      const shot = shownOf(p.id);
      const stamp = shot
        ? `${shot.mode}|${shot.at}|${(shot.dataUrl || shot.svg || shot.text || '').length}`
        : 'nothing';
      if (stamp === drawn) return;
      drawn = stamp;

      if (!shot) {
        body.replaceChildren();
        note.textContent = t('parts.previewEmpty');
        note.hidden = false;
        save.hidden = true;
        return;
      }
      if (shot.mode === 'markdown') {
        body.replaceChildren(renderBlocks(parseBlocks(String(shot.text || '')), domFactory(document)));
        note.hidden = true;
      } else {
        const img = document.createElement('img');
        img.className = 'graph-preview-tile';
        img.alt = t('parts.previewAlt');
        // setAttribute, not the property: the src is the one thing a test reads back off the DOM,
        // and an attribute is what both a browser and the unit runner's shim agree about.
        img.setAttribute('src', shot.mode === 'svg' ? svgDataUrl(String(shot.svg || '')) : String(shot.dataUrl || ''));
        body.replaceChildren(img);
        note.textContent = t('parts.previewSnapshot');
        note.hidden = shot.mode === 'svg';
      }
      save.hidden = false;
    };
    paint(part);

    return {
      update(next) { paint(next); },
      destroy() { clearShown(part.id); wrap.remove(); },
    };
  },

  async run(input) {
    const arrivals = input.inputs.content || [];
    for (const v of arrivals) {
      const kind = isValue(v) ? String(/** @type {any} */ (v).kind) : '';
      if (kind && kind !== 'text' && kind !== 'json') {
        throw partFail(t('parts.previewRefused', { got: kindLabel(kind) }), 'invalid');
      }
    }
    const { text, value } = contentOf(arrivals);
    if (!text.trim()) throw partFail(t('parts.previewEmpty'), 'empty');

    const s = readSettings(input.part.settings);
    const mode = modeFor(s.mode, value);
    const id = String(input.part.id);
    const at = input.app && typeof input.app.now === 'function' ? input.app.now() : Date.now();

    // ---- markdown: our own parser, our own safe builder, no guest, no iframe.
    if (mode === 'markdown') {
      setShown(id, { mode, source: text, text, at });
      return null;
    }

    // ---- svg: already a picture. Rasterising it would cost a round trip and LOSE fidelity, and
    // the export would no longer be the bytes the reader saw. It is sanitised because those bytes
    // leave the app: "Save…" writes a file that gets opened in a browser with no CSP of ours.
    if (mode === 'svg') {
      const clean = sanitizeSvg(text);
      if (!clean.ok) throw partFail(t('parts.previewNotSvg'), 'invalid');
      const url = svgDataUrl(clean.svg);
      if (url.length > MAX_TILE_BYTES) throw partFail(t('parts.previewTooBig'), 'part');
      setShown(id, { mode, source: text, svg: clean.svg, removed: clean.removed || [], at });
      return null;
    }

    // ---- html / three / p5: the panel's ONE guest draws, then hands back a picture.
    const sandbox = typeof input.sandbox === 'function' ? await input.sandbox() : null;
    if (!sandbox) throw partFail(t('sandbox.errDisabled'), 'part');
    const req = mode === 'html'
      ? { kind: 'dom', code: '', html: text, css: PAGE_CSS, params: { width: s.w, height: s.h, mode } }
      : { kind: mode, code: text, params: { width: s.w, height: s.h, mode } };
    const out = await sandbox.run(/** @type {any} */ ({ ...req, signal: input.signal }));
    if (!out || !out.ok) throw partFail(sandboxMessage(out && out.error), 'part');

    const maxPx = Math.min(LIMITS.maxPx, Math.max(s.w, s.h));
    const shot = await sandbox.snapshot({ maxPx, signal: input.signal });
    if (!shot || !shot.dataUrl) throw partFail(t('parts.previewNoPicture'), 'part');
    if (String(shot.dataUrl).length > MAX_TILE_BYTES) throw partFail(t('parts.previewTooBig'), 'part');
    setShown(id, {
      mode,
      source: text,
      dataUrl: String(shot.dataUrl),
      w: Number(shot.w) || s.w,
      h: Number(shot.h) || s.h,
      at,
    });
    return null;
  },
});
