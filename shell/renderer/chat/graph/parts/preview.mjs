// @ts-check
// Preview — the box that SHOWS: markdown, SVG, a web page, three.js, p5.js. COMPUTER_PLAN §6.5,
// §6.8; K4 addendum KD-6; K5 addendum KE-3 (K5-U1 replaced this file wholesale).
//
// K5: THE BOX HAS ITS OWN CODE. The owner could not find the p5/three/SVG boxes because there were
// none: one generic Preview hid its mode in a dropdown and could only draw what arrived on a wire.
// Now every Preview carries a monospace code editor (`settings.source`), and the ＋ menu places it
// as "p5.js sketch", "three.js scene", "SVG", "HTML page" or "Markdown view" — PRESETS of this one
// part (graph/parts/creative.mjs), each with starter code that draws on its first ▶ with no farm.
//
// THE RULES, the same discipline as the Text part:
//   1. Nothing wired in (or the box LOCKED) → it draws its own `source`. Something arrived → it
//      adopts that, unfenced (graph/unfence.mjs `codeFor`). A run NEVER writes `settings.source`:
//      the person's code is changed by the person typing and by nothing else (KD-4, carried over).
//   2. An arrival never overwrites an edit in progress: once the person has typed, a run keeps
//      their code and says so (`parts.previewKeptEditing`), exactly as the Text box does.
//   3. Editing the code the box is SHOWING makes it yours: the first keystroke on an arrival writes
//      the arrival-plus-keystroke to `settings.source`, and the box draws that from then on.
//   4. Re-draw on edit is debounced and goes through `ctx.sandbox()` — the Computer's ONE guest —
//      NEVER the runner: no generation, no seat, no prologue pulling an unrun Instruction upstream.
//      It never races a run: it waits while `app.host.runner.running()`, and a run's own draw and
//      every box's edit-draw take the guest in turn (`withGuest`), so no snapshot ever photographs
//      another box's sketch.
//   5. An error names the LINE in the code the person sees (graph/unfence.mjs keeps line N at line
//      N; a syntax error the engine reports without a line gets one from `syntaxLine`, an SVG that
//      does not parse from `markupLine`), and clicking it selects that line in the editor.
//
// THE TWO HALVES, and why they are different (K4, unchanged).
//   markdown and svg are LIVE AND FREE. Markdown goes through `parseBlocks` + `renderBlocks` with
//   `domFactory(document)` — the SAME safe builder the chat uses, so model text becomes NODES and
//   never HTML. An SVG goes through `design/svg-sanitize.mjs` and is shown as an
//   `<img src="data:image/svg+xml,…">`: an img cannot run script, and the bytes on screen are
//   byte-for-byte the bytes "Save .svg" writes. NEITHER path creates an iframe (lint rule 12).
//   html, three and p5 are a PNG SNAPSHOT from the panel's ONE guest (§2.6 BJ-7).
//
// WHAT A DRAW LEAVES BEHIND is this module's own `SHOWN` map, keyed by part id: RUNTIME state,
// deliberately not persisted, which is exactly right for a picture. Preview's `output` is null.
//
// "OPEN LIVE" IS STILL NOT HERE (the K4 contract request on computer/host.mjs stands): the box
// shows the first frame of an animation, and its note says it is a picture.

import { partFail, textOf, pickerRow } from './common.mjs';
import { numberField } from './fields.mjs';
import { isValue } from '../values.mjs';
import { parseBlocks } from '../../render/md-block.mjs';
import { renderBlocks, domFactory } from '../../render/dom.mjs';
import { sanitizeSvg } from '../../design/svg-sanitize.mjs';
import { LIMITS } from '../../sandbox/protocol.mjs';
import { download, slugify } from '../../ui/transfer.mjs';
import {
  codeFor, shapeForGuest, syntaxLine, isSyntaxError, markupLine, lineRange,
} from '../unfence.mjs';
// Package A's `explainGuestError` (critic R1 A8), read off the namespace rather than imported by
// name: a named import of an export that is not there fails the WHOLE module, and this box is
// where every sketch is drawn. Without it, the engine's own message is shown, as before.
import * as unfence from '../unfence.mjs';
import { presetTitle, saveFormats } from './creative.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-preview.en.mjs';
import '../../strings/sandbox.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

/** What the text is read as. `auto` reads the value's `format`/`lang` facet (§6.8); it NEVER
 * sniffs the bytes. Frozen: a seventh mode is a contract request, not a new string. */
export const PREVIEW_MODES = Object.freeze(['auto', 'markdown', 'svg', 'html', 'three', 'p5']);

/** The modes this box draws itself, with no guest and no iframe. */
export const FREE_MODES = Object.freeze(['markdown', 'svg']);

/** The modes that cost one turn of the single sandbox guest and come back as a picture. */
export const SANDBOX_MODES = Object.freeze(['html', 'three', 'p5']);

/** The picture a box may hold. A four-megabyte tile in a document that is persisted whole would
 * be re-written on every edit of any part. */
export const MAX_TILE_BYTES = 1024 * 1024;

/** Bounds on the drawing surface, in device-independent pixels. */
export const MIN_SIZE = 64;
export const MAX_SIZE = 2048;

/** How many drawings this module remembers at once — a reader who deletes a box must not leave a
 * megabyte behind in a module-level Map. */
export const MAX_SHOWN = 32;

/** How long typing must pause before the box re-draws. Long enough that a sketch is not re-run on
 * every keystroke of a word, short enough to feel live. */
export const EDIT_DEBOUNCE_MS = 400;

/** How often an edit-draw that is waiting for a run re-checks, if the runner's event is missed. */
const IDLE_POLL_MS = 500;

/** The guest's page styling for `html` mode: a picture of a page should look like a page. The
 * snapshot rasterises the guest's root element on its own (an SVG foreignObject), where neither
 * the frame's body nor its default white exists — so the ROOT is given the paper: without it a
 * page with no background of its own came back as black text on transparent, invisible on the
 * dark theme (K5-U1 found it with a model-written page). A copy of Render's rules otherwise, and
 * not an import, so render.mjs stays deletable. */
export const PAGE_CSS = [
  // The FONT is on the root, not on body (critic R1 A8): the snapshot clones the root alone into
  // an SVG foreignObject, where body's font never reached and the picture came back in the
  // default serif. The root is exactly the box's Width x Height (K-4), so the paper fills it.
  '#root{background:#ffffff;color:#111111;padding:16px;box-sizing:border-box;min-height:100%;font:14px/1.5 Inter,system-ui,sans-serif;word-wrap:break-word;}',
  'html,body{margin:0;padding:0;}',
  'pre,code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;}',
  'pre{padding:8px;overflow:hidden;}',
  'table{border-collapse:collapse;}th,td{border:1px solid;padding:4px 8px;text-align:left;}',
  'img,svg{max-width:100%;}',
  'h1,h2,h3{margin:0.6em 0 0.3em;}p,ul,ol,table,pre{margin:0.5em 0;}',
].join('\n');

/** What each Save button writes. */
const SAVE_MIME = Object.freeze({
  js: 'text/javascript', html: 'text/html', svg: 'image/svg+xml', md: 'text/markdown', png: 'image/png',
});

/** Every Save button a box owns, in DOM creation order; `paint` shows the ones its mode makes. */
const SAVE_EXTS = Object.freeze(['js', 'html', 'svg', 'md', 'png']);

// ---------------------------------------------------------------------------------------------
// runtime registries (keyed by part id, never persisted — a draw is not an edit of the program)
// ---------------------------------------------------------------------------------------------

/** @typedef {{mode: string, source: string, from?: 'own'|'input', text?: string, svg?: string,
 *   removed?: string[], dataUrl?: string, w?: number, h?: number, at: number}} Shown */

/** @type {Map<string, Shown>} */
const SHOWN = new Map();

/** Boxes the person has TYPED into since they last left the editor (rule 2). */
const EDITING = new Set();

/** Boxes whose editor holds the person's code even though the last run drew an arrival (rule 3):
 * the first keystroke on an arrival claims it. Cleared when a run draws a new arrival. */
const OWNED = new Set();

/** Why the last run kept the person's code: `'locked'` or `'unsaved'`. */
const REFUSED = new Map();

/** The last draw's error, with the line it names: `via:'edit'` is drawn in the box (the canvas
 * does not know about edit-draws), `via:'run'` only lends its line to "Go to line N" (the canvas
 * already prints a run's error). @type {Map<string, {message: string, line: number, via: 'edit'|'run'}>} */
const ERRORS = new Map();

/** @param {any} id @returns {string} */
const key = (id) => String(id == null ? '' : id);

/** What this box last drew, or null. @param {string} id @returns {Shown|null} */
export function shownOf(id) {
  return SHOWN.get(key(id)) || null;
}

/** Remember a drawing, oldest evicted first. @param {string} id @param {Shown} shot */
export function setShown(id, shot) {
  const k = key(id);
  SHOWN.delete(k);
  SHOWN.set(k, shot);
  while (SHOWN.size > MAX_SHOWN) {
    const oldest = SHOWN.keys().next();
    if (oldest.done) break;
    SHOWN.delete(oldest.value);
  }
}

/** Forget everything about a box — called when its DOM goes away. @param {string} id */
export function clearShown(id) {
  const k = key(id);
  SHOWN.delete(k);
  EDITING.delete(k);
  OWNED.delete(k);
  REFUSED.delete(k);
  ERRORS.delete(k);
}

/** Has the person typed into this box's code since they last left it? Read by `run()`.
 * @param {any} id @returns {boolean} */
export function isEditing(id) { return EDITING.has(key(id)); }

/** Why the last run kept the person's code: `'locked'`, `'unsaved'` or `''`.
 * @param {any} id @returns {string} */
export function refusalOf(id) { return REFUSED.get(key(id)) || ''; }

/** The last draw error this box holds, or null. @param {any} id */
export function errorOf(id) { return ERRORS.get(key(id)) || null; }

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
 * quotes an SVG — and is never trusted again. A Write-… Instruction stamps `js` + the `lang` it
 * DECLARED (KE-3), which is the same kind of declaration a Code part's picker makes. Anything
 * undeclared falls to `markdown`.
 * @param {string} setting @param {GraphValue|null} value @returns {string}
 */
export function modeFor(setting, value) {
  const want = PREVIEW_MODES.indexOf(String(setting)) >= 0 ? String(setting) : 'auto';
  if (want !== 'auto') return want;
  const format = isValue(value) ? String(/** @type {any} */ (value).format || 'plain') : 'plain';
  if (format === 'svg') return 'svg';
  if (format === 'html') return 'html';
  const lang = isValue(value) ? String(/** @type {any} */ (value).lang || '') : '';
  if (format === 'js' && (lang === 'p5' || lang === 'three')) return lang;
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

/** How a kind is spelled in the refusal sentence. An unknown kind is spelled as it came.
 * @param {string} kind @returns {string} */
export function kindLabel(kind) {
  const k = String(kind);
  if (!Object.prototype.hasOwnProperty.call(KIND_KEYS, k)) return k;
  return t(/** @type {any} */ (KIND_KEYS)[k]);
}

/**
 * The arrivals on `content` as ONE piece of text plus the facet to read it by. Several wires into
 * one port is a join: the pieces are separated by a blank line. The facet comes from the FIRST.
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

/**
 * The line a guest error names, in the person's code — or 0.
 * The guest measures its wrapper away, so a runtime error's line is already the person's. A line
 * past the end of their code came from a library frame and would only mislead, so it is dropped.
 * A syntax error arrives with no line at all; `syntaxLine` finds the likely one.
 * @param {any} error @param {string} [code] @returns {number}
 */
export function lineOf(error, code) {
  const lines = code == null ? Infinity : String(code).split('\n').length;
  const n = Number(error && error.line);
  if (Number.isFinite(n) && n > 0 && n <= lines) return n;
  if (code != null && isSyntaxError(error)) {
    const at = syntaxLine(String(code));
    if (at) return at.line;
  }
  return 0;
}

/** The sentence a failed guest run shows. A line number is the single most useful thing a sketch
 * can tell its author, so it is in the sentence whenever one is known — and, on a second line,
 * what to do about it when the error is one a sketch commonly makes (critic R1 A8).
 * @param {any} error @param {string} [code] @param {string} [mode] @returns {string} */
export function sandboxMessage(error, code, mode) {
  const message = String((error && error.message) || '') || t('sandbox.errNotBuilt');
  const line = lineOf(error, code);
  const said = line > 0 ? t('parts.previewError', { message, line }) : message;
  const why = explained(message, mode);
  return why ? `${said}
${why}` : said;
}

/** What to DO about a guest error, in the words of the fix (Package A's `explainGuestError`), or
 * '' — when there is nothing better to say than the engine's message, or no explainer.
 * @param {string} message @param {string} [mode] @returns {string} */
export function explained(message, mode) {
  const fn = /** @type {any} */ (unfence).explainGuestError;
  if (typeof fn !== 'function' || !mode) return '';
  try { return String(fn(message, mode) || ''); } catch { return ''; }
}

/** A part failure that also carries the line it names. @param {string} message @param {string}
 * reason @param {number} [line] */
function drawFail(message, reason, line) {
  const err = partFail(message, reason);
  /** @type {any} */ (err).line = Number(line) > 0 ? Number(line) : 0;
  return err;
}

/** Why an SVG was refused, naming the line when the tags say where. @param {string} code
 * @param {string} [reason] */
function svgFailure(code, reason) {
  if (!/<svg[\s>]/i.test(code)) return drawFail(t('parts.previewNotSvg'), 'invalid');
  const at = markupLine(code);
  const message = t('parts.previewSvgBroken', { reason: String(reason || '').trim() || '?' });
  return drawFail(at ? t('parts.previewError', { message, line: at.line }) : message, 'invalid', at ? at.line : 0);
}

// ---------------------------------------------------------------------------------------------
// drawing (shared by a run and an edit)
// ---------------------------------------------------------------------------------------------

/** The guest, taken in turn: a run's draw and every box's edit-draw queue here, so a snapshot
 * always photographs the sketch that was just run. */
let GUEST = Promise.resolve();

/** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
function withGuest(fn) {
  const next = GUEST.then(() => fn());
  GUEST = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Draw `code` in a FREE mode. No guest, no await. Throws a part failure.
 * @param {string} mode @param {string} code @returns {{mode: string, text?: string, svg?: string, removed?: string[]}}
 */
function drawFree(mode, code) {
  if (mode === 'markdown') return { mode, text: code };
  const clean = sanitizeSvg(code);
  if (!clean.ok) throw svgFailure(code, clean.error);
  if (svgDataUrl(clean.svg).length > MAX_TILE_BYTES) throw drawFail(t('parts.previewTooBig'), 'part');
  return { mode, svg: clean.svg, removed: clean.removed || [] };
}

/**
 * Draw `code` in the guest and photograph it. The caller holds the guest (`withGuest`).
 * @param {any} sandbox @param {string} mode @param {string} code
 * @param {{w: number, h: number}} s @param {AbortSignal} [signal]
 * @returns {Promise<{mode: string, dataUrl: string, w: number, h: number}>}
 */
async function drawInGuest(sandbox, mode, code, s, signal) {
  if (!sandbox) throw drawFail(t('sandbox.errDisabled'), 'part');
  const params = { width: s.w, height: s.h, mode };
  // K-4: the guest frame IS the box's Width x Height, so `innerWidth`, p5's `windowWidth`, three's
  // W and H, `lol.size` and the default canvas all say what the fields say.
  const size = { w: s.w, h: s.h };
  const req = mode === 'html'
    ? { kind: 'dom', code: '', html: code, css: PAGE_CSS, params, size }
    : { kind: mode, code: shapeForGuest(mode, code), params, size };
  const out = await sandbox.run(/** @type {any} */ ({ ...req, signal }));
  if (!out || !out.ok) {
    const e = out && out.error;
    throw drawFail(sandboxMessage(e, code, mode), 'part', lineOf(e, code));
  }
  const maxPx = Math.min(LIMITS.maxPx, Math.max(s.w, s.h));
  const shot = await sandbox.snapshot({ maxPx, signal });
  // An error thrown AFTER the run returned (a draw() on a later frame) is still this code's error.
  const late = typeof sandbox.errors === 'function' ? sandbox.errors() : [];
  if (Array.isArray(late) && late.length) throw drawFail(sandboxMessage(late[0], code, mode), 'part', lineOf(late[0], code));
  if (!shot || !shot.dataUrl) throw drawFail(t('parts.previewNoPicture'), 'part');
  if (String(shot.dataUrl).length > MAX_TILE_BYTES) throw drawFail(t('parts.previewTooBig'), 'part');
  return { mode, dataUrl: String(shot.dataUrl), w: Number(shot.w) || s.w, h: Number(shot.h) || s.h };
}

/** Is a run going right now? @param {any} app */
function isRunning(app) {
  const runner = app && app.host && app.host.runner;
  try { return !!(runner && typeof runner.running === 'function' && runner.running()); } catch { return false; }
}

/** Resolves once no run is going (KE-3: an edit-draw never races a run). @param {any} app
 * @returns {Promise<void>} */
function whenIdle(app) {
  if (!isRunning(app)) return Promise.resolve();
  const runner = app.host.runner;
  return new Promise((resolve) => {
    let settled = false;
    /** @type {any} */ let off = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof off === 'function') { try { off(); } catch { /* already gone */ } }
      resolve(whenIdle(app));
    };
    const timer = setTimeout(finish, IDLE_POLL_MS);
    if (typeof runner.on === 'function') off = runner.on(() => { if (!isRunning(app)) finish(); });
  });
}

/** Is anything wired into this box? Read off the open document; false when there is no host
 * (a unit test), which is the "nothing wired in" rule's own default. @param {any} ctx @param {string} id */
function wiredIn(ctx, id) {
  return wiring(ctx, id) === true;
}

/** true / false when the open document says whether anything is wired into this box; null when
 * there is no document to ask (a unit test) — "unknown" must never read as "unwired" to the rule
 * that forgets an arrival. @param {any} ctx @param {string} id @returns {boolean|null} */
function wiring(ctx, id) {
  try {
    const session = ctx && ctx.app && ctx.app.host && ctx.app.host.session;
    const doc = session && typeof session.doc === 'function' ? session.doc() : null;
    if (!doc || !Array.isArray(doc.wires)) return null;
    return doc.wires.some((/** @type {any} */ w) => w && w.to === id);
  } catch { return null; }
}

/** Hand a picture to the reader as a file. `download()` carries TEXT; a PNG is bytes we already
 * hold as a data URL, and an anchor is the one way a renderer offers those.
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

/** @param {string} label @param {string} cls */
function button(label, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  return b;
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
  // 360×400 since critic R1: exact heights left the default Preview a two-line code field.
  size: { w: 360, h: 400 },
  inputs: [{ name: 'content', label: t('parts.previewIn'), accepts: ['text', 'json'] }],
  output: null,
  quiet: true,
  // `source` is the box's own code (typed by the person, never written by a run) and `locked`
  // keeps it when something arrives. Both MUST be here: serialize.mjs exports only the keys
  // `defaults()` declares.
  defaults: () => ({ mode: 'auto', w: 320, h: 240, live: false, source: '', locked: false }),
  titleOf: (/** @type {any} */ part) => presetTitle(part),

  render(host, part, ctx) {
    const id = key(part.id);
    /** The part as the canvas last painted it: Save and every draw act on what is on screen NOW. */
    let live = part;
    /** What `paintBody` last drew, so a pan or a selection does not re-parse a report. */
    /** @type {string|null} */ let drawn = null;
    /** Has the person typed since they entered the editor? (rule 2) */
    let typed = false;
    /** An edit-draw is waiting for, or using, the guest. */
    let pending = false;
    /** The "Show code" toggle, for a markdown report that arrived on a wire. */
    let codeOpen = false;
    let seq = 0;
    /** @type {any} */ let timer = 0;
    let destroyed = false;
    /** The order the Save buttons were last laid out in. */
    let saveOrder = '';

    const wrap = document.createElement('div');
    wrap.className = 'graph-preview';

    // ---- the head: how to read it, where it came from, and the lock -------------------------
    const head = document.createElement('div');
    head.className = 'graph-preview-head';
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
      (v) => {
        ctx.update({ mode: v });
        ctx.commit(t('parts.previewLabel'));
        live = { ...live, settings: { ...(live.settings || {}), mode: v } };
        redrawNow();
      },
    );
    const from = document.createElement('span');
    from.className = 'graph-preview-from';
    from.hidden = true;
    const lock = button(t('parts.previewLock'), 'graph-preview-lock');
    lock.setAttribute('data-part', id);
    lock.addEventListener('click', (/** @type {any} */ ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      const next = !isLocked();
      ctx.update({ locked: next });
      ctx.commit(t('parts.previewLock'));
      if (!next) REFUSED.delete(id);
      live = { ...live, settings: { ...(live.settings || {}), locked: next } };
      paint();
    });
    head.append(modeRow, from, lock);

    // ---- the drawing surface (the guest-drawn modes only) -----------------------------------
    const sizeRow = document.createElement('div');
    sizeRow.className = 'graph-preview-size';
    const w = numberField(t('parts.previewWidth'), readSettings(part.settings).w, MIN_SIZE, (n) => {
      ctx.update({ w: n });
      ctx.commit(t('parts.previewWidth'));
      live = { ...live, settings: { ...(live.settings || {}), w: n } };
      redrawNow();
    }, MAX_SIZE);
    const h = numberField(t('parts.previewHeight'), readSettings(part.settings).h, MIN_SIZE, (n) => {
      ctx.update({ h: n });
      ctx.commit(t('parts.previewHeight'));
      live = { ...live, settings: { ...(live.settings || {}), h: n } };
      redrawNow();
    }, MAX_SIZE);
    sizeRow.append(w.node, h.node);

    // ---- the picture, what it is, and what went wrong ---------------------------------------
    const body = document.createElement('div');
    body.className = 'graph-preview-body';
    // A double-click ON THE WORDS of a markdown page selects a word — the browser's own meaning,
    // and the first half of copying one. It is remembered for the one event turn in which the
    // canvas may also ask this box to `edit()` (K-2), so that call does not pull the caret away.
    let wordPick = false;
    body.addEventListener('dblclick', () => {
      if (!body.hasAttribute('data-selectable')) return;
      wordPick = true;
      setTimeout(() => { wordPick = false; }, 0);
    });
    const note = document.createElement('p');
    note.className = 'graph-preview-note';
    const kept = document.createElement('p');
    kept.className = 'graph-preview-kept';
    kept.hidden = true;
    const error = button('', 'graph-preview-error');
    error.hidden = true;
    error.title = t('parts.previewGotoHint');
    error.addEventListener('click', (/** @type {any} */ ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      const line = Number(error.getAttribute('data-line'));
      if (line > 0) selectLine(line);
    });

    // ---- the code ----------------------------------------------------------------------------
    const codeToggle = button(t('parts.previewShowCode'), 'graph-preview-code-toggle');
    codeToggle.hidden = true;
    codeToggle.addEventListener('click', (/** @type {any} */ ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      codeOpen = !codeOpen;
      paint();
    });
    const area = /** @type {any} */ (document.createElement('textarea'));
    area.className = 'graph-preview-source';
    area.setAttribute('aria-label', t('parts.previewSource'));
    area.setAttribute('spellcheck', 'false');
    area.setAttribute('wrap', 'off');
    area.setAttribute('data-part', id);
    area.placeholder = t('parts.previewSourceHint');
    area.value = editorText();
    area.addEventListener('input', () => {
      // TAKE THE LOCKS FIRST: `ctx.update()` reaches the document and the canvas hands the edited
      // part straight back to `update()` on this same turn — which must not re-seed the field.
      typed = true;
      EDITING.add(id);
      OWNED.add(id);
      REFUSED.delete(id);
      ctx.update({ source: String(area.value) });
      scheduleDraw(EDIT_DEBOUNCE_MS);
    });
    const leave = () => {
      if (!typed) return;
      typed = false;
      EDITING.delete(id);
      ctx.commit(t('parts.previewSource'));
      paint();
    };
    area.addEventListener('change', leave);
    area.addEventListener('blur', leave);

    // ---- save as -----------------------------------------------------------------------------
    const saves = document.createElement('div');
    saves.className = 'graph-preview-saves';
    /** @type {Map<string, any>} */ const saveButtons = new Map();
    for (const ext of SAVE_EXTS) {
      const b = button(t('parts.previewSaveAs', { ext }), 'graph-preview-save');
      b.setAttribute('data-as', ext);
      b.title = t('parts.previewSaveHint', { ext });
      b.hidden = true;
      b.addEventListener('click', (/** @type {any} */ ev) => {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        saveAs(ext);
      });
      saveButtons.set(ext, b);
      saves.appendChild(b);
    }

    wrap.append(head, sizeRow, body, note, kept, error, codeToggle, area, saves);
    host.replaceChildren(wrap);

    // ---- what the box knows ------------------------------------------------------------------

    function isLocked() { return !!(live.settings && live.settings.locked === true); }

    /** The code the editor shows: an arrival the run drew (until the person claims it by typing),
     * else the person's own source. */
    function editorText() {
      const shot = shownOf(id);
      if (shot && shot.from === 'input' && !OWNED.has(id)) return String(shot.source || '');
      return String((live.settings && live.settings.source) || '');
    }

    /** The mode this box draws in right now: the setting, or — on `auto` — what it last drew. */
    function effectiveMode() {
      const s = readSettings(live.settings);
      if (s.mode !== 'auto') return s.mode;
      const shot = shownOf(id);
      return shot ? shot.mode : '';
    }

    /** Select one line of the code, so the line an error names is where the caret lands.
     * @param {number} line */
    function selectLine(line) {
      codeOpen = true;
      paint();
      const [a, b] = lineRange(String(area.value), line);
      try { area.focus(); } catch { /* detached */ }
      try { if (typeof area.setSelectionRange === 'function') area.setSelectionRange(a, b); } catch { /* detached */ }
    }

    function saveAs(/** @type {string} */ ext) {
      const shot = shownOf(id);
      const code = String(area.value || '') || String((shot && shot.source) || '');
      const name = `${slugify(presetTitle(live) || t('parts.previewLabel'))}.${ext}`;
      if (ext === 'png') {
        if (shot && shot.dataUrl) savePicture(name, shot.dataUrl);
        return;
      }
      if (ext === 'svg') {
        // The bytes on screen, which are the sanitised ones: a saved file is opened by a browser
        // with no CSP of ours.
        let bytes = shot && shot.svg ? shot.svg : '';
        if (!bytes) { const clean = sanitizeSvg(code); bytes = clean.ok ? clean.svg : ''; }
        if (bytes) void download(name, bytes, SAVE_MIME.svg, { app: ctx.app });
        return;
      }
      if (code.trim()) void download(name, code, /** @type {any} */ (SAVE_MIME)[ext], { app: ctx.app });
    }

    // ---- drawing on edit (rule 4) ------------------------------------------------------------

    /** @param {number} delay */
    function scheduleDraw(delay) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = 0; void editDraw(); }, delay);
    }

    /** A setting that changes how the code is drawn: redraw what the editor holds, at once. */
    function redrawNow() {
      paint();
      if (String(area.value || '').trim()) scheduleDraw(0);
    }

    async function editDraw() {
      if (destroyed) return;
      const my = ++seq;
      const code = String(area.value || '');
      const s = readSettings(live.settings);
      const before = shownOf(id);
      const mode = s.mode !== 'auto' ? s.mode : (before ? before.mode : modeFor('auto', null));
      const origin = before && before.from === 'input' && !OWNED.has(id) ? 'input' : 'own';
      const now = () => (ctx.app && typeof ctx.app.now === 'function' ? ctx.app.now() : Date.now());
      if (!code.trim()) {
        SHOWN.delete(id);
        ERRORS.delete(id);
        paint();
        return;
      }
      if (FREE_MODES.indexOf(mode) >= 0) {
        try {
          const drew = drawFree(mode, code);
          setShown(id, { ...drew, source: code, from: origin, at: now() });
          ERRORS.delete(id);
        } catch (err) {
          ERRORS.set(id, { message: String(/** @type {any} */ (err).message), line: Number(/** @type {any} */ (err).line) || 0, via: 'edit' });
        }
        paint();
        return;
      }
      pending = true;
      paint();
      try {
        for (;;) {
          await whenIdle(ctx.app);
          if (my !== seq || destroyed) return;
          const outcome = await withGuest(async () => {
            if (my !== seq || destroyed) return { stale: true };
            if (isRunning(ctx.app)) return { busy: true };   // a run took the floor: let it draw first
            const sandbox = typeof ctx.sandbox === 'function' ? await ctx.sandbox() : null;
            try {
              return { drew: await drawInGuest(sandbox, mode, code, s) };
            } catch (err) {
              return { error: err };
            }
          });
          if (outcome.busy) continue;
          if (outcome.stale || my !== seq || destroyed) return;
          // A run that started while the guest was drawing may have run its own sketch in between:
          // this picture is not to be trusted, and the run draws whatever it draws.
          if (isRunning(ctx.app)) return;
          if (outcome.error) {
            const err = /** @type {any} */ (outcome.error);
            ERRORS.set(id, { message: String(err.message), line: Number(err.line) || 0, via: 'edit' });
          } else if (outcome.drew) {
            setShown(id, { ...outcome.drew, source: code, from: origin, at: now() });
            ERRORS.delete(id);
          }
          return;
        }
      } finally {
        if (my === seq) pending = false;
        if (!destroyed) paint();
      }
    }

    // ---- painting ------------------------------------------------------------------------------

    function paintBody() {
      const shot = shownOf(id);
      const stamp = shot
        ? `${shot.mode}|${shot.at}|${(shot.dataUrl || shot.svg || shot.text || '').length}`
        : 'nothing';
      if (stamp === drawn) return;
      drawn = stamp;
      // A markdown page is WORDS: a selectable zone (contract K-1, critic R1 A7), so a drag selects
      // them and Ctrl+C copies them. A picture is not, so a press on it still moves the box.
      if (shot && shot.mode === 'markdown') body.setAttribute('data-selectable', 'text');
      else body.removeAttribute('data-selectable');
      if (!shot) { body.replaceChildren(); return; }
      if (shot.mode === 'markdown') {
        body.replaceChildren(renderBlocks(parseBlocks(String(shot.text || '')), domFactory(document)));
        return;
      }
      const img = document.createElement('img');
      img.className = 'graph-preview-tile';
      img.alt = t('parts.previewAlt');
      // setAttribute, not the property: the src is what a test reads back off the DOM.
      img.setAttribute('src', shot.mode === 'svg' ? svgDataUrl(String(shot.svg || '')) : String(shot.dataUrl || ''));
      body.replaceChildren(img);
    }

    function paint() {
      if (destroyed) return;
      const s = readSettings(live.settings);
      const shot = shownOf(id);
      const mode = effectiveMode();
      sizeRow.hidden = SANDBOX_MODES.indexOf(mode) < 0;
      w.update(s.w);
      h.update(s.h);
      const select = /** @type {any} */ (modeRow.querySelector('select'));
      if (select && document.activeElement !== select) select.value = s.mode;

      // where the drawing came from, and the lock
      const locked = isLocked();
      lock.setAttribute('aria-pressed', locked ? 'true' : 'false');
      lock.title = locked ? t('parts.previewLockOn') : t('parts.previewLockOff');
      const fromInput = !!(shot && shot.from === 'input' && !OWNED.has(id));
      const mark = locked ? t('parts.previewLocked') : fromInput ? t('parts.previewFromInput') : '';
      from.textContent = mark;
      from.hidden = !mark;
      from.setAttribute('data-from', locked ? 'locked' : fromInput ? 'input' : 'own');
      const why = REFUSED.get(id) || '';
      const said = why === 'locked' ? t('parts.previewKept') : why === 'unsaved' ? t('parts.previewKeptEditing') : '';
      kept.textContent = said;
      kept.hidden = !said;
      kept.setAttribute('data-why', why);

      // the code: always there for code, folded away for a markdown report that arrived
      const folded = fromInput && mode === 'markdown';
      codeToggle.hidden = !folded;
      codeToggle.textContent = codeOpen ? t('parts.previewHideCode') : t('parts.previewShowCode');
      area.hidden = folded && !codeOpen;
      // Code keeps its lines (a sketch's line numbers are what its errors name); prose wraps.
      const wrapAs = mode === 'markdown' || (!mode && s.mode === 'auto') ? 'soft' : 'off';
      if (area.getAttribute('wrap') !== wrapAs) area.setAttribute('wrap', wrapAs);
      if (!typed) {
        const want = editorText();
        if (area.value !== want) area.value = want;
      }

      paintBody();

      // the one-line note: what the box is doing, or what it is showing
      const hasCode = !!String(area.value || '').trim();
      let said2 = '';
      if (pending) said2 = t('parts.previewDrawing');
      else if (!shot) said2 = hasCode ? t('parts.previewPress') : t('parts.previewEmpty');
      else if (shot.mode !== 'markdown' && shot.mode !== 'svg') said2 = t('parts.previewSnapshot');
      note.textContent = said2;
      note.hidden = !said2;
      note.setAttribute('data-state', pending ? 'drawing' : shot ? 'shown' : hasCode ? 'ready' : 'empty');

      // the error that names a line
      const err = ERRORS.get(id);
      let text = '';
      let line = 0;
      if (err && err.via === 'edit') { text = err.message; line = err.line; }
      else if (err && err.via === 'run' && err.line > 0 && live.state === 'error') {
        text = t('parts.previewGoto', { line: err.line });
        line = err.line;
      }
      error.textContent = text;
      error.hidden = !text;
      error.setAttribute('data-line', String(line || 0));
      error.setAttribute('data-via', err ? err.via : '');

      // save as: the code, then the picture — the visible buttons first, so the first
      // `.graph-preview-save` is always one that can be pressed when any can
      const offered = saveFormats(mode || (hasCode ? modeFor(s.mode, null) : ''));
      /** @type {string[]} */ const on = [];
      for (const ext of offered) {
        if (ext === 'png' ? !!(shot && shot.dataUrl) : (hasCode || !!(shot && shot.source))) on.push(ext);
      }
      for (const [ext, b] of saveButtons) b.hidden = on.indexOf(ext) < 0;
      const order = on.join(',');
      if (order !== saveOrder) {
        saveOrder = order;
        const rest = SAVE_EXTS.filter((e) => on.indexOf(e) < 0);
        saves.replaceChildren(...on.concat(rest).map((e) => saveButtons.get(e)));
      }
      saves.hidden = !on.length;
    }

    paint();

    // A box that has never drawn, holds code and has nothing wired in shows its code at once: an
    // SVG or a markdown page for free, a sketch only while the box is fresh (`idle`) — reopening a
    // graph full of sketches must not queue them all on the guest.
    if (!shownOf(id) && String(area.value || '').trim() && !wiredIn(ctx, id)) {
      const mode = readSettings(part.settings).mode;
      const free = mode === 'auto' || FREE_MODES.indexOf(mode) >= 0;
      if (free || (part.state || 'idle') === 'idle') scheduleDraw(0);
    }

    /** An arrival the box shows is FORGOTTEN when its reason is gone (fix pass): the wire that
     * brought it was removed (unwired, Undo), or the box's own code was replaced from outside the
     * editor (Reset lesson, Undo of an edit). The box then shows — and draws — its own code again,
     * exactly as a box that never received anything. A box the person claimed by typing is theirs
     * already and is left alone. @param {any} prev @param {any} next */
    function forgetArrival(prev, next) {
      const shot = shownOf(id);
      if (!shot || shot.from !== 'input' || OWNED.has(id) || typed) return false;
      const src = (/** @type {any} */ p) => String((p && p.settings && p.settings.source) || '');
      const unwired = wiring(ctx, id) === false;
      const replaced = src(prev) !== src(next);
      if (!unwired && !replaced) return false;
      SHOWN.delete(id);
      REFUSED.delete(id);
      ERRORS.delete(id);
      codeOpen = false;
      return true;
    }

    return {
      update(next) {
        const prev = live;
        live = next;
        const forgot = forgetArrival(prev, next);
        paint();
        if (forgot && String(area.value || '').trim() && !wiredIn(ctx, id)) {
          const mode = readSettings(next.settings).mode;
          const free = mode === 'auto' || FREE_MODES.indexOf(mode) >= 0;
          if (free || (next.state || 'idle') === 'idle') scheduleDraw(0);
        }
      },
      /** K-2: a double-click inside the box, or Enter/F2 with it selected, puts the caret in the
       * code — unfolding it first when a markdown report that arrived has it folded away.
       * @returns {boolean} */
      edit() {
        if (destroyed || wordPick) return false;
        if (area.hidden) { codeOpen = true; paint(); }
        try { area.focus(); } catch { return false; }
        return true;
      },
      destroy() {
        destroyed = true;
        if (timer) { clearTimeout(timer); timer = 0; }
        clearShown(id);
        wrap.remove();
      },
    };
  },

  async run(input) {
    const arrivals = (input.inputs && input.inputs.content) || [];
    for (const v of arrivals) {
      const kind = isValue(v) ? String(/** @type {any} */ (v).kind) : '';
      if (kind && kind !== 'text' && kind !== 'json') {
        throw partFail(t('parts.previewRefused', { got: kindLabel(kind) }), 'invalid');
      }
    }
    const part = input.part || /** @type {any} */ ({});
    const id = key(part.id);
    const settings = part.settings || {};
    const arrived = contentOf(arrivals);
    const own = String(settings.source || '');
    const hasArrival = !!arrived.text.trim();
    // Rule 1 and rule 2: the box keeps its own code when locked, or while the person is typing.
    const keep = hasArrival && !!own.trim() && (settings.locked === true || EDITING.has(id));
    const useOwn = !!own.trim() && (keep || !hasArrival);
    if (keep) REFUSED.set(id, settings.locked === true ? 'locked' : 'unsaved');
    else REFUSED.delete(id);
    ERRORS.delete(id);

    const s = readSettings(settings);
    const mode = modeFor(s.mode, useOwn ? null : arrived.value);
    const raw = useOwn ? own : arrived.text;
    if (!raw.trim()) throw partFail(t('parts.previewEmpty'), 'empty');
    // The person's own code is drawn exactly as typed (so its lines are the editor's lines); an
    // arrival is unwrapped from the fence and the prose a model puts around markup.
    const code = useOwn || mode === 'markdown' ? raw : codeFor(mode, raw);
    const at = input.app && typeof input.app.now === 'function' ? input.app.now() : Date.now();
    const origin = useOwn ? 'own' : 'input';

    try {
      if (FREE_MODES.indexOf(mode) >= 0) {
        setShown(id, { ...drawFree(mode, code), source: code, from: origin, at });
      } else {
        const getSandbox = typeof input.sandbox === 'function' ? input.sandbox : null;
        const drew = await withGuest(async () => {
          const sandbox = getSandbox ? await getSandbox() : null;
          return drawInGuest(sandbox, mode, code, s, input.signal);
        });
        setShown(id, { ...drew, source: code, from: origin, at });
      }
    } catch (err) {
      const line = Number(/** @type {any} */ (err).line) || 0;
      if (line > 0) ERRORS.set(id, { message: String(/** @type {any} */ (err).message), line, via: 'run' });
      throw err;
    }
    // A new arrival is shown in the editor again; the person's claim was on the old one.
    if (!useOwn) OWNED.delete(id);
    return null;
  },
});
