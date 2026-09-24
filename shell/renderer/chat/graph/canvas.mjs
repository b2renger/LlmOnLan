// @ts-check
// The canvas surface: the viewport, the part boxes, the interaction and the keyboard (C1-U2).
//
// THE ONE RULE THAT SHAPES EVERYTHING HERE (plan §2.6 BG-8): pan and zoom are a transform on
// `.graph-layer` and on the wire layer's single <g>. Nothing else is ever transformed, nothing is
// re-laid-out and no part does per-frame work — which is why 500 parts pan at 60 fps and why the
// perf scenario measures exactly those two style writes.
//
// What this module owns: the viewport, selection, dragging, wiring, the marquee, copy/paste, the
// keyboard and the live region. What it does NOT own: the inside of a part (C1-U3's `spec.render`)
// and what Run means (C1-U3's runner — the toolbar button only calls back).
//
// The pure half (view maths, marquee hits, the clipboard payload) is exported on its own and
// tested in Node: it is the part that is easy to get subtly wrong and impossible to see.
//
// K3-U3 added what a RUN looks like (COMPUTER_PLAN §8.2-§8.4): a per-box ▶ in every title bar,
// which is the push entry point and goes out through `o.onPlay` so a part never reaches for the
// runner; the two wire flags — `data-back` for a declared loop edge and `data-barred` for a
// branch a gate stopped — written here and never inside graph/wires.mjs; the travelling dot on a
// delivering wire; and the RUN-NOTICE STRIP, which is C2's cap banner generalised to §8.4's
// rows. The canvas draws all of it and decides none of it: `setBarred`, `setLimited` and
// `setCapped` are told, by the module that read the report (computer/runbar.mjs).

import { t } from '../core/i18n.mjs';
import { KV_KEYS } from '../core/types.mjs';
import { EV } from '../core/events.mjs';
import { paletteCatalogue, groupLabel } from './parts/index.mjs';
// K5 kickoff (addendum KE-2): the ＋ menu is K5-U2's module; this file only decides WHERE a pick
// lands and which gestures open it (the ＋, a double-click or a right-click on empty canvas).
import { buildPalette } from './palette.mjs';
import { createPaletteMenu } from './palette-menu.mjs';
import { addPart, addWire, movePart, removeParts, removeWire, resizePart, setSettings, setWireLabel } from './model.mjs';
import { preview } from './values.mjs';
import { createWireLayer, portOffsetY, portPoint, wireAt, SNAP_PX, WIRE_HIT } from './wires.mjs';
// Critic R1 (Package B): what a wheel, a resize handle, a dropped wire end and Ctrl+C MEAN is
// decided in a pure module and pinned in Node; this file reads the DOM into it and writes back.
import { wheelIntent, scrollRoom, zoomStep, resizeRect, rewireOutcome, shouldCopyParts, WHEEL_LATCH_MS } from './gestures.mjs';
import { DEFAULT_MAX_ITEMS } from './runner.mjs';
import { tidy } from './tidy.mjs';
import { toText, fromText, FILE_SUFFIX, MAX_IMPORT_BYTES } from './serialize.mjs';
import { download, pickImportFile, slugify } from '../ui/transfer.mjs';
import '../strings/graph.en.mjs';
// K3-U3 (COMPUTER_PLAN §8.3, §8.4): the per-box ▶ and the run-notice strip speak in the
// COMPUTER's voice — `computer.runPlayTitle`, the four ceilings, the loop-ungated sentence.
import '../strings/computer.en.mjs';
import '../strings/parts.en.mjs';
import '../strings/computer-canvas.en.mjs';

/** How many per-item failures a part lists before the rest live in the run report (§2.6 BH-3).
 *  A fan of 40 that fails 40 times must not turn one part into a wall of red. */
export const ITEM_ERRORS_SHOWN = 5;

/** Parts land on a 10 px grid, so a hand-dragged graph still lines up. */
export const GRID = 10;
/** Critic R1, A4: 0.25 meant Fit could not fit a graph more than four viewports wide, and parts
 * stayed off-screen after "Fit". 10 % fits 10 000 px of graph in a laptop window. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** Padding kept around the graph by fit-to-content, in screen px. */
export const FIT_PADDING = 40;
/** A pointer that moved less than this was a click, not a drag. */
export const DRAG_SLOP = 3;
/** The clipboard payload's format tag — the same name graph/serialize.mjs (C1-U1) uses for files. */
export const CLIP_FORMAT = 'lolgraph';

/** K3-U3 (§9's title-bar row): the per-box run mark. A glyph, not an icon font and not an SVG —
 *  it sits in a 12 px title bar next to the type name and has to stay legible at 25 % zoom. */
export const PLAY_GLYPH = '\u25B6';

/** How long the travelling dot runs on a delivering wire (§8.3). One animation at a time. */
export const FLOW_MS = 700;

/** C3-U3. Why a whole FILE was refused → the sentence the reader gets. graph/serialize.mjs returns
 * these codes and never throws, so every one of them has to have a line here. */
const IMPORT_ERROR = {
  'not-json': 'graph.errImportUnreadable',
  'not-an-object': 'graph.errImportNotGraph',
  'not-a-graph': 'graph.errImportNotGraph',
  'unsupported-version': 'graph.errImportVersion',
  'too-big': 'graph.errImportTooBig',
};

/** C3-U3. Why ONE part or wire inside an otherwise good file was dropped → plain words. An import
 * that silently loses a wire is worse than one that refuses the file, so this list is exhaustive
 * over graph/model.mjs's `dropped` codes and everything unlisted still lands as `dropOther`. */
const DROPPED_WHY = {
  'part:unknown-type': 'graph.dropPartUnknown',
  'part:value-too-big': 'graph.dropValueTooBig',
  'part:duplicate': 'graph.dropPartDuplicate',
  'part:no-id': 'graph.dropOther',
  'wire:malformed': 'graph.dropOther',
  'wire:unknown-part': 'graph.dropWireEnd',
  'wire:unknown-port': 'graph.dropWireEnd',
  'wire:cycle': 'graph.dropWireCycle',
  'wire:self': 'graph.dropWireCycle',
  'wire:type': 'graph.dropWireType',
  'wire:duplicate': 'graph.dropOther',
  'wire:no-output': 'graph.dropOther',
  'wire:refused': 'graph.dropOther',
};

/** `2026-09-16` in LOCAL time, so an evening export is not filed under tomorrow. @param {any} app */
function stampOf(app) {
  const d = new Date(app && typeof app.now === 'function' ? app.now() : Date.now());
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Does this drag carry FILES? A part being dragged inside the canvas is a pointer gesture and has
 * no DataTransfer at all, so this is what keeps the two from ever meeting. @param {any} ev */
export function dragHasFile(ev) {
  const dt = ev && ev.dataTransfer;
  if (!dt) return false;
  const types = dt.types ? Array.from(dt.types) : [];
  return types.indexOf('Files') >= 0;
}

/** state → the label shown NEXT to the colour (never colour alone, BG-8). */
const STATE_LABEL = {
  idle: 'graph.stateIdle',
  stale: 'graph.stateStale',
  queued: 'graph.stateQueued',
  running: 'graph.stateRunning',
  waiting: 'graph.stateWaiting',      // K3 kickoff (§4.1): parked on a human or a clock
  done: 'graph.stateDone',
  error: 'graph.stateError',
};

/** addWire() reason code → the ONE string that explains it (BG-4 / BG-11). */
const WIRE_REASON = {
  self: 'graph.wireSelf',
  cycle: 'graph.wireCycle',
  duplicate: 'graph.wireDuplicate',
  'no-output': 'graph.wireNoOutput',
  'unknown-port': 'graph.wireUnknownPort',
  type: 'graph.wireType',
  'unknown-part': 'graph.wireUnknownPart',
  'loop-ungated': 'graph.wireLoopUngated',   // K3 kickoff (§4.6)
};

// ---- pure helpers (unit-tested in Node) ---------------------------------------------------------

/** @param {number} v @param {number} [grid] */
/**
 * May the stored cap overwrite what the field shows? (fix pass, finding 5.)
 *
 * The seed is an async read started at mount, and it can land AFTER the reader has typed a new cap
 * — which the change handler has already written to the store. Repainting the old number then left
 * the field and the store disagreeing, with the next run using the store's. A field the reader has
 * touched, or is typing in, is ahead of the store, never behind it.
 * @param {number} stored @param {{destroyed?: boolean, edited?: boolean, focused?: boolean}} o
 * @returns {boolean}
 */
export function acceptSeed(stored, o) {
  if (!(Number(stored) > 0)) return false;
  return !(o && (o.destroyed || o.edited || o.focused));
}

export function snap(v, grid = GRID) { return Math.round(v / grid) * grid; }

/** @param {number} z */
export function clampZoom(z) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(z) ? z : 1)); }

/** @param {{x: number, y: number, zoom: number}} view */
export function screenToWorld(view, sx, sy) {
  const z = view.zoom || 1;
  return { x: (sx - view.x) / z, y: (sy - view.y) / z };
}

/** @param {{x: number, y: number, zoom: number}} view */
export function worldToScreen(view, wx, wy) {
  const z = view.zoom || 1;
  return { x: wx * z + view.x, y: wy * z + view.y };
}

/** Zoom about a screen point: that point stays under the cursor.
 * @param {{x: number, y: number, zoom: number}} view @returns {{x: number, y: number, zoom: number}} */
export function zoomAbout(view, sx, sy, factor) {
  const z = clampZoom((view.zoom || 1) * factor);
  const k = z / (view.zoom || 1);
  return { x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k, zoom: z };
}

/** The bounding box of some parts, in world units. @returns {{x: number, y: number, w: number, h: number}|null} */
export function bounds(parts) {
  if (!parts || !parts.length) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of parts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + (p.w || 0)); y1 = Math.max(y1, p.y + (p.h || 0));
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Fit-to-content. Never zooms IN past `maxZoom` (1): a two-part graph should not fill the screen
 * with one box. Zoom-to-selection is the same maths over the selected parts.
 * @param {any[]} parts @param {{w: number, h: number}} viewport @param {number} [pad] @param {number} [maxZoom]
 * @returns {{x: number, y: number, zoom: number}} */
export function fitView(parts, viewport, pad = FIT_PADDING, maxZoom = 1) {
  const b = bounds(parts);
  const vw = Math.max(1, viewport.w);
  const vh = Math.max(1, viewport.h);
  if (!b) return { x: 0, y: 0, zoom: 1 };
  const zoom = clampZoom(Math.min(maxZoom, (vw - pad * 2) / Math.max(1, b.w), (vh - pad * 2) / Math.max(1, b.h)));
  return {
    x: (vw - b.w * zoom) / 2 - b.x * zoom,
    y: (vh - b.h * zoom) / 2 - b.y * zoom,
    zoom,
  };
}

/** Two points → a positive rectangle. */
export function normaliseRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Every part whose box overlaps `rect` (world units). @returns {string[]} */
export function marqueeHits(parts, rect) {
  return parts.filter((p) => (
    p.x < rect.x + rect.w && p.x + (p.w || 0) > rect.x
    && p.y < rect.y + rect.h && p.y + (p.h || 0) > rect.y
  )).map((p) => p.id);
}

/** A selection as the clipboard carries it: part TYPES and settings, never runtime values.
 * Wires are kept only when BOTH ends are in the selection. @returns {object} */
export function toClipboard(doc, ids) {
  const keep = new Set(ids || []);
  const parts = doc.parts.filter((/** @type {any} */ p) => keep.has(p.id));
  /** @type {Map<string, number>} */ const index = new Map();
  parts.forEach((/** @type {any} */ p, /** @type {number} */ i) => index.set(p.id, i));
  return {
    [CLIP_FORMAT]: 1,
    kind: 'selection',
    // Critic R1, A3: the SIZE travels too, so a pasted "p5.js sketch" comes back 380×520 and
    // not as a default 320×260 box.
    parts: parts.map((/** @type {any} */ p) => ({
      i: index.get(p.id), type: p.type, x: p.x, y: p.y, w: p.w, h: p.h, settings: { ...p.settings },
    })),
    wires: doc.wires
      .filter((/** @type {any} */ w) => keep.has(w.from) && keep.has(w.to))
      .map((/** @type {any} */ w) => {
        /** @type {any} */ const out = { from: index.get(w.from), to: index.get(w.to), port: w.port };
        // K2-U1: an arrow's NAME travels with it. Written only when there is one, so an unlabelled
        // selection still copies as exactly the three v1 keys.
        if (typeof w.label === 'string' && w.label) out.label = w.label;
        return out;
      }),
  };
}

/** Parse a clipboard payload. Anything that is not our format is `null`, never a throw. */
export function fromClipboard(text) {
  let raw = null;
  try { raw = JSON.parse(String(text || '')); } catch { return null; }
  if (!raw || typeof raw !== 'object' || raw[CLIP_FORMAT] !== 1 || !Array.isArray(raw.parts)) return null;
  const parts = raw.parts
    .filter((/** @type {any} */ p) => p && typeof p.type === 'string' && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((/** @type {any} */ p, /** @type {number} */ i) => {
      /** @type {any} */ const out = {
        i: Number.isFinite(p.i) ? p.i : i,
        type: p.type,
        x: p.x,
        y: p.y,
        settings: p.settings && typeof p.settings === 'object' ? p.settings : {},
      };
      // A size is only carried when it is a real one; an older payload without it still pastes.
      if (Number(p.w) > 0 && Number(p.h) > 0) { out.w = Number(p.w); out.h = Number(p.h); }
      return out;
    });
  if (!parts.length) return null;
  const known = new Set(parts.map((/** @type {any} */ p) => p.i));
  const wires = (Array.isArray(raw.wires) ? raw.wires : [])
    .filter((/** @type {any} */ w) => w && known.has(w.from) && known.has(w.to) && typeof w.port === 'string');
  return { parts, wires };
}

/**
 * Where a pasted group lands (critic R1, tldraw tool #4): with the pointer on the canvas, its
 * top-left goes UNDER THE POINTER, so repeated pastes land where you point instead of stacking
 * on one spot; without one, 20 px down-right of where it was copied from.
 * @param {{x: number, y: number}[]} parts @param {{x: number, y: number}|null} at
 * @returns {{dx: number, dy: number}}
 */
export function pasteOffset(parts, at) {
  if (!parts || !parts.length) return { dx: 0, dy: 0 };
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return { dx: GRID * 2, dy: GRID * 2 };
  let x0 = Infinity;
  let y0 = Infinity;
  for (const p of parts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); }
  return { dx: snap(at.x - x0), dy: snap(at.y - y0) };
}

// ---- the live canvas ----------------------------------------------------------------------------

/** @param {string} tag @param {string} cls @param {string} [text] */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A Lucide-style line icon, built node by node (no markup strings). @param {string[]} paths */
function icon(paths) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'graph-icon');
  for (const d of paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

const ICON_POINTER = ['M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z'];
const ICON_HAND = [
  'M18 11V6a2 2 0 0 0-4 0',
  'M14 10V4a2 2 0 0 0-4 0v2',
  'M10 10.5V6a2 2 0 0 0-4 0v8',
  'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
];

/**
 * @param {{
 *   session: any, host: HTMLElement,
 *   onRun?: () => void, onStop?: () => void,
 *   onCancel?: () => boolean,
 *   onPlay?: (partId: string) => void, onRaiseCap?: (cap: number) => void,
 * }} o
 */
export function createCanvas(o) {
  const session = o.session;
  const app = session.app;
  const specs = session.specs;

  /**
   * "Is there somewhere to put this?" (COMPUTER_PLAN §3.2, K1-U1 + the K1 landing).
   *
   * A graph used to belong to a THREAD; on the standalone surface it belongs to a LIBRARY
   * DOCUMENT, so the question the canvas asks before it places, pastes or enables its toolbar is
   * `session.docId()`. The `session.thread()` half of this line existed only while the chat's
   * panel still mounted the same canvas with a session that had no `docId()`; `graph/panel.mjs`
   * is deleted, so it is gone too.
   */
  const hasDoc = () => !!session.docId();

  // ---- DOM -------------------------------------------------------------------------------------
  const root = el('div', 'graph');
  const toolbar = el('div', 'graph-toolbar');
  const canvas = el('div', 'graph-canvas');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'graph-wires');
  svg.setAttribute('aria-hidden', 'true');
  const layer = el('div', 'graph-layer');
  const marquee = el('div', 'graph-marquee');
  marquee.hidden = true;
  const empty = el('p', 'graph-empty');
  const live = el('p', 'graph-live visually-hidden');
  live.setAttribute('aria-live', 'polite');

  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', t('graph.canvasLabel'));
  canvas.tabIndex = 0;
  // The drop target (C3-U3). It is a CHILD of the canvas and only ever un-hides while a drag that
  // carries files is over it, so the composer's document-level guard (ui/layout.mjs: preventDefault
  // and nothing else) and this never fight: a drag with no files is not ours and we never touch it.
  const dropZone = el('div', 'graph-drop');
  dropZone.hidden = true;
  dropZone.append(el('p', 'graph-drop-text', t('graph.dropHint')));
  canvas.append(svg, layer, marquee, empty, dropZone);
  const capBanner = el('div', 'graph-cap');
  capBanner.hidden = true;
  capBanner.setAttribute('role', 'status');
  const capText = el('div', 'graph-cap-text');
  const capTitleEl = el('strong', 'graph-cap-title');
  const capBodyEl = el('span', 'graph-cap-body');
  capText.append(capTitleEl, capBodyEl);
  root.append(toolbar, capBanner, canvas, live);
  o.host.replaceChildren(root);

  const wires = createWireLayer(/** @type {any} */ (svg), {
    specs,
    // The pill types; the DOCUMENT edit happens here, once, so naming an arrow is one undo entry
    // and one re-run of what depends on it (K2-U1, COMPUTER_PLAN §5.1).
    onLabel: (/** @type {string} */ wireId, /** @type {string} */ text) => { commitLabel(wireId, text); },
    // Critic R1, A5: the ✕ on a hovered or selected wire's pill.
    onDelete: (/** @type {string} */ wireId) => { unplugWire(wireId); },
  });

  // ---- toolbar ---------------------------------------------------------------------------------
  /** @param {string} cls @param {string} label */
  const button = (cls, label) => {
    const b = /** @type {HTMLButtonElement} */ (el('button', cls));
    b.type = 'button';
    b.textContent = label;
    return b;
  };
  const runBtn = button('graph-btn graph-run', t('graph.run'));
  const stopBtn = button('graph-btn graph-stop', t('graph.stop'));
  stopBtn.hidden = true;
  const addBtn = button('graph-btn graph-add', t('graph.add'));
  addBtn.setAttribute('aria-haspopup', 'true');
  addBtn.setAttribute('aria-expanded', 'false');
  const undoBtn = button('graph-btn graph-undo', t('graph.undo'));
  const redoBtn = button('graph-btn graph-redo', t('graph.redo'));
  const fitBtn = button('graph-btn graph-fit', t('graph.fit'));
  fitBtn.title = `${t('graph.zoomFit')} (F, ${t('graph.zoomKeyFit')})`;
  const addWrap = el('div', 'graph-add-wrap');
  addWrap.append(addBtn);

  // ---- critic R1, A4: the zoom cluster ---------------------------------------------------------
  // `−  100%  +`, the tldraw shape: the percentage IS the menu button (fit, selection, 100 %), and
  // every row names its shortcut, so the keys are discoverable from the one place people look.
  const zoomOutBtn = button('graph-btn graph-zoom-out', '−');
  zoomOutBtn.title = t('graph.zoomOut');
  zoomOutBtn.setAttribute('aria-label', t('graph.zoomOut'));
  const zoomLabel = button('graph-btn graph-zoom', t('graph.zoom', { percent: 100 }));
  zoomLabel.title = t('graph.zoomMenu');
  zoomLabel.setAttribute('aria-haspopup', 'menu');
  zoomLabel.setAttribute('aria-expanded', 'false');
  const zoomInBtn = button('graph-btn graph-zoom-in', '+');
  zoomInBtn.title = t('graph.zoomIn');
  zoomInBtn.setAttribute('aria-label', t('graph.zoomIn'));
  const zoomMenu = el('div', 'graph-zoom-menu');
  zoomMenu.hidden = true;
  zoomMenu.setAttribute('role', 'menu');
  zoomMenu.setAttribute('aria-label', t('graph.zoomMenu'));
  /** @param {string} act @param {string} label @param {string} key @param {() => void} fn */
  const zoomRow = (act, label, key, fn) => {
    const b = button('graph-zoom-item', '');
    b.dataset.act = act;
    b.setAttribute('role', 'menuitem');
    b.append(el('span', 'graph-zoom-item-label', label), el('kbd', 'graph-zoom-key', key));
    b.addEventListener('click', () => { closeZoomMenu(); fn(); });
    return b;
  };
  zoomMenu.append(
    zoomRow('fit', t('graph.zoomFit'), t('graph.zoomKeyFit'), () => { fit(); }),
    zoomRow('selection', t('graph.zoomSelection'), t('graph.zoomKeySelection'), () => { zoomToSelection(); }),
    zoomRow('100', t('graph.zoom100'), t('graph.zoomKey100'), () => { zoomTo(1); }),
  );
  const zoomWrap = el('div', 'graph-zoom-wrap');
  zoomWrap.append(zoomOutBtn, zoomLabel, zoomInBtn, zoomMenu);

  // ---- critic R1, A4: the two canvas tools (tldraw's V and H) ---------------------------------
  // For a trackpad with no middle button, Space-drag is the only pan a person has to be TOLD
  // about. The Hand makes panning a thing you can see and click: left-drag on empty canvas pans,
  // Shift-drag still draws a selection box, and boxes stay clickable and draggable.
  const toolsWrap = el('div', 'graph-tools');
  toolsWrap.setAttribute('role', 'group');
  toolsWrap.setAttribute('aria-label', t('graph.toolsLabel'));
  /** @param {string} name @param {string[]} glyph @param {string} label @param {string} hint */
  const toolBtn = (name, glyph, label, hint) => {
    const b = button(`graph-btn graph-tool graph-tool-${name}`, '');
    b.dataset.tool = name;
    b.title = hint;
    b.setAttribute('aria-pressed', name === 'select' ? 'true' : 'false');
    b.append(icon(glyph), el('span', 'graph-tool-label', label));
    b.addEventListener('click', () => { setTool(name); });
    return b;
  };
  const selectToolBtn = toolBtn('select', ICON_POINTER, t('graph.toolSelect'), t('graph.toolSelectHint'));
  const handToolBtn = toolBtn('hand', ICON_HAND, t('graph.toolHand'), t('graph.toolHandHint'));
  toolsWrap.append(selectToolBtn, handToolBtn);

  // ---- C3-U3: tidy and the sharing story -------------------------------------------------------
  // Three controls, and one popover. Export asks BEFORE it writes whether the values go in the
  // file, because a cached value is chat text and a picture is a megabyte: including them is a
  // choice a person makes about a file they are about to hand to somebody, not a default.
  const tidyBtn = button('graph-btn graph-tidy', t('graph.tidy'));
  tidyBtn.title = t('graph.tidyHint');
  const exportBtn = button('graph-btn graph-export', t('graph.exportGraph'));
  exportBtn.setAttribute('aria-haspopup', 'true');
  exportBtn.setAttribute('aria-expanded', 'false');
  const exportMenu = el('div', 'graph-export-menu');
  exportMenu.hidden = true;
  exportMenu.setAttribute('aria-label', t('graph.exportMenu'));
  const valuesLabel = /** @type {HTMLLabelElement} */ (el('label', 'graph-export-values'));
  const valuesInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  valuesInput.type = 'checkbox';
  valuesInput.className = 'graph-export-values-input';
  valuesLabel.append(valuesInput, el('span', '', t('graph.exportWithValues')));
  const saveBtn = button('graph-btn graph-export-save', t('graph.exportSave'));
  exportMenu.append(valuesLabel, el('p', 'graph-export-note', t('graph.exportImages')), saveBtn);
  const exportWrap = el('div', 'graph-add-wrap graph-export-wrap');
  exportWrap.append(exportBtn, exportMenu);
  const importBtn = button('graph-btn graph-import', t('graph.importGraph'));
  const capRaiseBtn = button('graph-btn graph-cap-raise', t('graph.capRaise'));
  // K3-U3 (COMPUTER_PLAN §8.4): the strip carries up to TWO buttons, because "capped" reads
  // `[Raise it for this run]` `[Show me what spent it]` and a ceiling reads the same shape. A slot
  // with no action is empty AND blank — `textContent` is what the shots scenarios read off the
  // banner, so a hidden button holding a label would put a sentence in the picture nobody sees.
  const capMoreBtn = button('graph-btn graph-cap-more', '');
  capMoreBtn.hidden = true;
  const capActions = el('div', 'graph-cap-actions');
  capActions.append(capRaiseBtn, capMoreBtn);
  capBanner.append(capText, capActions);

  // The stored preference (`pref:computeMaxItems`) as a toolbar field — §2.6 BH-4 puts the ONLY
  // place the default changes here, never in a settings section. The banner's button raises the
  // cap for ONE run and never touches this.
  const capField = /** @type {HTMLLabelElement} */ (el('label', 'graph-cap-field'));
  capField.append(el('span', 'graph-cap-label', t('graph.capLabel')));
  const capInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  capInput.type = 'number';
  capInput.min = '1';
  capInput.step = '1';
  capInput.className = 'graph-cap-input';
  capInput.title = t('graph.capHint');
  capInput.value = String(DEFAULT_MAX_ITEMS);
  capField.appendChild(capInput);
  toolbar.append(
    runBtn, stopBtn, addWrap, toolsWrap, undoBtn, redoBtn, fitBtn, tidyBtn, exportWrap, importBtn,
    capField, zoomWrap,
  );

  /** What the raise button should ask for: twice the cap the LAST run stopped at, or — when an
   * item ceiling stopped it — exactly enough for that fan. Never "unlimited". */
  let raiseTo = 0;
  /** The live notice's two handlers. Replaced wholesale by `setNotice`, so a button can never
   * still be wired to the run before last. */
  const noticeAct = { primary: /** @type {Function|null} */ (null), secondary: /** @type {Function|null} */ (null) };
  capRaiseBtn.addEventListener('click', () => { const f = noticeAct.primary; if (f) f(); });
  capMoreBtn.addEventListener('click', () => { const f = noticeAct.secondary; if (f) f(); });
  /** Has the reader touched the field? Then the stored value is BEHIND it, not ahead of it. */
  let capEdited = false;
  capInput.addEventListener('input', () => { capEdited = true; });
  capInput.addEventListener('change', () => {
    capEdited = true;
    const n = Math.floor(Number(capInput.value));
    const next = n > 0 ? n : DEFAULT_MAX_ITEMS;
    capInput.value = String(next);
    const repo = app && app.repo;
    if (repo && typeof repo.kvSet === 'function') {
      Promise.resolve(repo.kvSet(KV_KEYS.prefComputeMaxItems, next)).catch(() => { /* the store speaks through its own banner */ });
    }
    announce(t('graph.capSaid', { cap: next }));
  });
  (async () => {
    const repo = app && app.repo;
    if (!repo || typeof repo.kvGet !== 'function') return;
    try {
      const stored = Number(await repo.kvGet(KV_KEYS.prefComputeMaxItems, DEFAULT_MAX_ITEMS));
      if (acceptSeed(stored, {
        destroyed, edited: capEdited, focused: document.activeElement === capInput,
      })) capInput.value = String(Math.floor(stored));
    } catch { /* the default stands */ }
  })();

  // ---- the run-notice strip (K3-U3, COMPUTER_PLAN §8.4) ----------------------------------------
  //
  // ONE strip, over the canvas, for everything a RUN has to say to the person who started it:
  // "one sentence for what happened, one for what to do, never a code, never a stack". The cap
  // banner C2 shipped is now the first of its rows, unchanged in its words and its button, and
  // the four ceilings of §4.6 are the rest. A per-PART failure is not a notice: it keeps living
  // in that part's own error strip, behind its last good value, which is the other half of §8.4.

  /** @param {any} btn @param {any} spec @returns {Function|null} */
  function applyAction(btn, spec) {
    if (!spec || !spec.label) {
      btn.hidden = true;
      btn.textContent = '';
      btn.disabled = false;
      delete btn.dataset.action;
      return null;
    }
    btn.hidden = false;
    btn.textContent = String(spec.label);
    // A button with nowhere to go is DISABLED, not absent: §8.4 promises the action is there, and
    // the lesson it opens ships in K5. The run bar's `?` already established the shape.
    btn.disabled = !!spec.disabled || typeof spec.onClick !== 'function';
    btn.dataset.action = String(spec.name || '');
    return typeof spec.onClick === 'function' ? spec.onClick : null;
  }

  /** @type {any} */ let notice = null;

  /**
   * Show (or clear, with `null`) the one notice over the canvas.
   * @param {any} n {kind, title, body?, say?, actions?: [{name, label, onClick?, disabled?}]}
   */
  function setNotice(n) {
    notice = n || null;
    if (!notice) {
      raiseTo = 0;
      capBanner.hidden = true;
      capBanner.removeAttribute('data-notice');
      capTitleEl.textContent = '';
      capBodyEl.textContent = '';
      noticeAct.primary = applyAction(capRaiseBtn, null);
      noticeAct.secondary = applyAction(capMoreBtn, null);
      return null;
    }
    const acts = Array.isArray(notice.actions) ? notice.actions : [];
    capBanner.dataset.notice = String(notice.kind || 'notice');
    capTitleEl.textContent = String(notice.title || '');
    capBodyEl.textContent = String(notice.body || '');
    noticeAct.primary = applyAction(capRaiseBtn, acts[0] || null);
    noticeAct.secondary = applyAction(capMoreBtn, acts[1] || null);
    capBanner.hidden = false;
    if (notice.say !== false) announce(`${notice.title || ''} ${notice.body || ''}`.trim());
    return notice;
  }

  /**
   * The cap banner: what a run that stopped at the cap says, and the one button that finishes it.
   * `null` clears it — a new run always starts with no banner (§2.6 BH-4). Since K3 it is the
   * `capped` ROW of the notice strip, with §8.4's second button beside the first.
   * @param {{cap: number, spent?: number, stopped?: number, items?: number, raiseTo?: number}|null} info
   */
  function setCapped(info) {
    const cap = info && Number(info.cap) > 0 ? Math.floor(Number(info.cap)) : 0;
    if (!cap) { setNotice(null); return; }
    const items = Math.floor(Number((info && info.items) || 0));
    raiseTo = Math.floor(Number((info && info.raiseTo) || 0)) || cap * 2;
    // Two lines, not one run-on sentence: the title says what happened, the body says why it is
    // a promise rather than a limitation (seen in the C2 landing screenshots). A run stopped by the
    // ITEM ceiling says so in its own words: "50 generations" would be a lie about a part that was
    // going to spend none of them.
    setNotice({
      kind: 'capped',
      say: false,                  // the host announces the capped sentence in its own words
      title: items > 0 ? t('graph.capItemsTitle', { items }) : t('graph.capTitle', { cap }),
      body: items > 0
        ? t('graph.capItemsBody', { cap, raise: raiseTo })
        : t('graph.capBody', { n: Number((info && info.stopped) || 0) }),
      actions: [
        {
          name: 'raise',
          label: t('graph.capRaise'),
          onClick: () => {
            // Read the number BEFORE clearing: `setNotice(null)` zeroes `raiseTo`, and the
            // pre-K3 handler read it afterwards — so every raise asked for `0` and only worked
            // because the runner reads a falsy cap as "the stored default".
            const want = raiseTo;
            if (!want || !o.onRaiseCap) return;
            setNotice(null);
            o.onRaiseCap(want);
          },
        },
        { name: 'show-spend', label: t('computer.limitShowSpend'), onClick: showSpend },
      ],
    });
  }

  /**
   * §8.4's second button on a capped run: "Show me what spent it". The transcript drawer's COST
   * tab, on the part that spent the most, is exactly that answer — and the drawer is K2's, so
   * this only asks for it and stays quiet when it is not installed.
   */
  function showSpend() {
    const tx = app && /** @type {any} */ (app).transcript;
    /** @type {{id: string, calls: number}|null} */ let worst = null;
    for (const part of session.doc().parts) {
      const calls = part.stats && Number(part.stats.calls) > 0 ? Number(part.stats.calls) : 0;
      if (!calls) continue;
      if (!worst || calls > worst.calls) worst = { id: part.id, calls };
    }
    if (worst && tx && typeof tx.open === 'function') tx.open(worst.id, 'cost');
  }

  /**
   * A run stopped by one of §4.6's four ceilings (K3-U1's `report.limited`). Every one is a STOP,
   * not an error: the sentence names the ceiling and the part, and the one button raises it FOR
   * THAT RUN through the frozen `run({limits})` door the caller hands in.
   * @param {any} limit a RunLimit, or null to clear
   * @param {{onRaise?: (limits: any) => void}} [opt]
   */
  function setLimited(limit, opt = {}) {
    if (!limit || !limit.ceiling) { setNotice(null); return null; }
    const part = labelOf(partById(limit.partId));
    const lim = Math.floor(Number(limit.limit) || 0);
    const minutes = Math.max(1, Math.round((Number(limit.limit) || 0) / 60000));
    const want = Math.floor(Number(limit.raiseTo) || 0) || lim * 2;
    // chat-lint rule 5: literal keys, one per branch — never a key assembled from `ceiling`.
    /** @type {Record<string, string>} */
    const title = {
      maxIterations: t('computer.limitIterations', { limit: lim, part }),
      maxGenerations: t('computer.limitGenerations', { limit: lim }),
      maxWallMs: limit.partId
        ? t('computer.limitWallPark', { part, minutes })
        : t('computer.limitWall', { minutes }),
      maxActivations: t('computer.limitActivations', { limit: lim }),
    };
    const actions = [{
      name: 'raise',
      label: t('computer.limitRaise'),
      onClick: typeof opt.onRaise === 'function'
        ? () => { setNotice(null); /** @type {any} */ (opt.onRaise)({ [limit.ceiling]: want }); }
        : undefined,
    }];
    if (limit.ceiling === 'maxGenerations') {
      actions.push({ name: 'show-spend', label: t('computer.limitShowSpend'), onClick: showSpend });
    }
    return setNotice({
      kind: `limit:${limit.ceiling}`,
      title: title[limit.ceiling] || t('computer.limitGenerations', { limit: lim }),
      body: '',
      actions,
    });
  }

  /**
   * §8.4's `loop-ungated` row, shown where the refusal happened: a wire that would close a loop
   * with nothing in it that can stop it. The lesson the button opens is K5's; until it exists the
   * button is there and disabled, because promising an action and hiding it is worse than either.
   */
  function sayLoopUngated() {
    const tut = app && /** @type {any} */ (app).tutorial;
    setNotice({
      kind: 'loop-ungated',
      title: t('computer.loopUngated'),
      body: '',
      actions: [{
        name: 'lesson',
        label: t('computer.loopLesson'),
        // K5 kickoff (KE-6): lesson ids are `lNN-slug`, and a button that opens a lesson this
        // build does not ship would be a dead end — `has()` keeps it disabled until one exists.
        onClick: tut && typeof tut.has === 'function' && tut.has('l10-loops') ? () => tut.open('l10-loops') : undefined,
      }],
    });
  }

  /** K5 kickoff (addendum KE-2): the ONE ＋ menu. Opened by the toolbar's ＋ (placing at the centre
   * of the view), and by a double-click or a right-click on EMPTY canvas (placing where the pointer
   * was). Every row is `buildPalette(paletteCatalogue(), specs)`: the palette's plain parts plus
   * the presets, and never a legacy part — `from-thread`/`to-thread`/`render` are not in
   * `partSpecs()`, so they are not in the catalogue (COMPUTER_PLAN §3.2). */
  const palette = createPaletteMenu({
    host: root,
    entries: () => buildPalette(paletteCatalogue(), specs),
    groupLabel,
    onPick: (entry, at) => { placeEntry(entry, at); },
    onClose: () => addBtn.setAttribute('aria-expanded', 'false'),
  });
  function closeAddMenu() { palette.close(); }

  /** Open the menu. `at` is the WORLD point a pick lands on (null = centre of the view);
   * `screen` is where the menu shows, in px relative to the canvas root (null = under the ＋).
   * @param {{at?: {x: number, y: number}|null, screen?: {x: number, y: number}|null, query?: string, highlight?: string}} [opts] */
  function openPalette(opts = {}) {
    if (!hasDoc()) return false;
    closeExportMenu();
    let screen = opts.screen || null;
    if (!screen) {
      const r = root.getBoundingClientRect();
      const b = addBtn.getBoundingClientRect();
      screen = { x: b.left - r.left, y: b.bottom - r.top + 4 };
    }
    palette.open({ ...opts, screen });
    addBtn.setAttribute('aria-expanded', 'true');
    return true;
  }
  function closeExportMenu() { exportMenu.hidden = true; exportBtn.setAttribute('aria-expanded', 'false'); }

  addBtn.addEventListener('click', () => {
    if (palette.isOpen()) closeAddMenu();
    else openPalette({});
  });
  tidyBtn.addEventListener('click', () => { closeAddMenu(); closeExportMenu(); doTidy(); });
  exportBtn.addEventListener('click', () => {
    closeAddMenu();
    const opening = exportMenu.hidden;
    exportMenu.hidden = !opening;
    exportBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });
  saveBtn.addEventListener('click', () => {
    closeExportMenu();
    doExport({ values: valuesInput.checked });
  });
  importBtn.addEventListener('click', () => { closeAddMenu(); closeExportMenu(); pickAndImport(); });
  runBtn.addEventListener('click', () => { if (o.onRun) o.onRun(); });
  stopBtn.addEventListener('click', () => { if (o.onStop) o.onStop(); });
  undoBtn.addEventListener('click', () => doUndo());
  redoBtn.addEventListener('click', () => doRedo());
  fitBtn.addEventListener('click', () => fit());
  zoomOutBtn.addEventListener('click', () => { closeZoomMenu(); zoomBy(-1); });
  zoomInBtn.addEventListener('click', () => { closeZoomMenu(); zoomBy(1); });
  zoomLabel.addEventListener('click', () => { if (zoomMenu.hidden) openZoomMenu(); else closeZoomMenu(); });

  // ---- state -----------------------------------------------------------------------------------
  /** @type {{x: number, y: number, zoom: number}} */
  let view = { x: 0, y: 0, zoom: 1 };
  /** @type {Map<string, any>} */ const boxes = new Map();
  /** @type {string[]} */ let selWires = [];
  /** @type {any} */ let drag = null;
  /** @type {any} */ let viewTimer = null;
  let spaceDown = false;
  let destroyed = false;
  /** 'select' | 'hand' (critic R1, A4). */
  let tool = 'select';
  /** The pointer's last CLIENT position over the canvas (paste at the cursor, wire hover), or null. */
  /** @type {{x: number, y: number}|null} */ let pointer = null;
  /** What the pointer was over at that position — the hover check reads it in the frame. */
  /** @type {any} */ let hoverTarget = null;
  /** The kind the last wheel event chose and when: a gesture keeps its target (gestures.mjs). */
  /** @type {{kind: 'pan'|'scroll-inner'|null, at: number}} */ let wheelLatch = { kind: null, at: 0 };
  /** One zoom sentence per gesture, not one per wheel event (the live region churned). */
  /** @type {any} */ let zoomSayTimer = null;
  let zoomShown = '';
  let lastSaid = '';
  /** Parts whose settings edit is still running: the first keystroke opens ONE undo entry. */
  /** @type {Set<string>} */ const editing = new Set();

  // ONE rAF for the whole canvas: no part ever schedules a frame of its own.
  let raf = 0;
  let needView = false;
  let needWires = false;
  let needHover = false;
  /** @type {any} */ let dragDoc = null;

  /** @param {'view'|'wires'|'hover'} what */
  function schedule(what) {
    if (what === 'view') needView = true;
    if (what === 'wires') needWires = true;
    if (what === 'hover') needHover = true;
    if (raf || destroyed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (needView) { needView = false; applyView(); }
      if (needWires) {
        needWires = false;
        const doc = dragDoc || session.doc();
        wires.render(doc);
        markWires(doc);
        // Which inputs are plugged (critic R1, A5) moves only with the DOCUMENT, never mid-drag.
        if (!dragDoc) markPorts(doc);
      }
      if (needHover) { needHover = false; updateHover(); }
    });
  }

  function applyView() {
    layer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    wires.setView(view);
    // Written only when the NUMBER moves: a pan at a fixed zoom is still exactly two style writes.
    const shown = t('graph.zoom', { percent: Math.round(view.zoom * 100) });
    if (shown !== zoomShown) { zoomShown = shown; zoomLabel.textContent = shown; }
  }

  // ---- what the wires say about the last run (K3-U3, COMPUTER_PLAN §8.2, §8.3, §6.6) -----------
  //
  // Two flags, both written HERE and never inside `graph/wires.mjs`: a wire is `data-back` when
  // the document declares it a loop edge, and `data-barred` when a gate refused to activate what
  // it feeds. They are set on the wire RENDER and never on a pan — pan is still one transform
  // write on the layer and one on the wire <g>, which is what the perf gate measures.

  /** Parts a barrier stopped in the last run (§4.5): their outgoing wires drop to 35 %. */
  /** @type {Set<string>} */ let barred = new Set();
  /** wireId → the flags already written, so a re-render writes an attribute only when it moved. */
  /** @type {Map<string, string>} */ const wireFlags = new Map();

  /** @param {any} doc */
  function markWires(doc) {
    /** @type {Map<string, any>} */ const byId = new Map();
    for (const w of doc.wires) byId.set(w.id, w);
    const paths = svg.querySelectorAll('path.graph-wire[data-wire]');
    for (const path of Array.from(paths)) {
      const id = path.getAttribute('data-wire') || '';
      const w = byId.get(id);
      if (!w) continue;
      const back = w.back === true ? 'true' : 'false';
      // BOTH ENDS (K3 landing). The runner's `barred` names the parts a gate DROPPED — the boxes
      // that never ran — so the arrow that died is the one the wave failed to cross INTO a dropped
      // box as much as the ones leaving it. Greying only the out-edges left the entry arrow bright,
      // which is the one a reader is looking at: a Toggle switched off greyed nothing at all unless
      // something happened to sit past the box it held. §8.2's grey is most of the teaching, so it
      // has to land on the edge where the wave stopped.
      const grey = (barred.has(w.from) || barred.has(w.to)) ? 'true' : 'false';
      const key = `${back}|${grey}`;
      if (wireFlags.get(id) === key) continue;
      wireFlags.set(id, key);
      path.setAttribute('data-back', back);
      path.setAttribute('data-barred', grey);
      // The label pill wears the same two flags, so the `↺` of §9 sits ON the arrow's name and a
      // greyed branch greys whole rather than leaving a bright pill floating over a faded wire.
      const pill = svg.querySelector(`.graph-wire-pill[data-wire="${id}"]`);
      if (pill) {
        pill.setAttribute('data-back', back);
        pill.setAttribute('data-barred', grey);
      }
    }
    if (wireFlags.size > byId.size) {
      for (const id of Array.from(wireFlags.keys())) if (!byId.has(id)) wireFlags.delete(id);
    }
  }

  /** @type {any} */ let flowTimer = null;

  function clearFlow() {
    if (flowTimer) { clearTimeout(flowTimer); flowTimer = null; }
    for (const el2 of Array.from(svg.querySelectorAll('[data-flow="true"]'))) {
      el2.setAttribute('data-flow', 'false');
    }
  }

  /** The travelling dot (§8.3): the wires a freshly finished part delivers on, briefly lit.
   *  Back edges are left out — their value is the PREVIOUS iteration's and nothing travelled now.
   *  @param {string} partId */
  function flowFrom(partId) {
    if (destroyed) return;
    // Nothing leaves this box, so nothing travels — and the DOM is not touched at all. A run over
    // a thousand wireless Notes finishes a thousand parts, and a query per finish is a query too
    // many (the perf fixture is exactly that graph).
    const ids = session.doc().wires
      .filter((/** @type {any} */ w) => w.from === partId && w.back !== true)
      .map((/** @type {any} */ w) => w.id);
    if (!ids.length) return;
    clearFlow();                                    // one animation at a time, §8.3
    for (const id of ids) {
      const path = svg.querySelector(`path.graph-wire[data-wire="${id}"]`);
      if (path) path.setAttribute('data-flow', 'true');
    }
    flowTimer = setTimeout(() => { flowTimer = null; clearFlow(); }, FLOW_MS);
  }

  /** What the last run's barriers greyed. The run bar hands the report's `barred` straight in.
   *  @param {string[]} ids @returns {string[]} */
  function setBarred(ids) {
    const next = new Set((ids || []).filter((id) => typeof id === 'string' && id));
    if (next.size === barred.size && Array.from(next).every((id) => barred.has(id))) {
      return Array.from(barred);
    }
    barred = next;
    schedule('wires');
    return Array.from(barred);
  }

  /** Pan/zoom is not a document edit; it rides the save debounce and never touches undo.
   * Critic R1, B12: and it is never a write at all while no document is open — a wheel during the
   * migration wait used to save the blank placeholder as an "Untitled" library row. */
  function commitView() {
    if (viewTimer) clearTimeout(viewTimer);
    if (!hasDoc()) { viewTimer = null; return; }
    viewTimer = setTimeout(() => { viewTimer = null; if (!destroyed && hasDoc()) session.setView(view); }, 150);
  }

  /** @param {{x: number, y: number, zoom: number}} next @param {{commit?: boolean}} [opt] */
  function setView(next, opt = {}) {
    view = { x: next.x, y: next.y, zoom: clampZoom(next.zoom) };
    schedule('view');
    if (opt.commit !== false) commitView();
    return view;
  }

  function viewport() {
    return { w: canvas.clientWidth || 800, h: canvas.clientHeight || 600 };
  }

  /** @param {{say?: boolean}} [opt] */
  function fit(opt = {}) {
    setView(fitView(session.doc().parts, viewport()));
    if (opt.say !== false) announce(t('graph.saidFit'));
    return { ...view };
  }

  // ---- critic R1, A4: zoom controls and the two tools ------------------------------------------

  /** Zoom about the CENTRE of the view to `z` (the buttons and keys have no cursor to zoom about).
   * @param {number} z */
  function zoomTo(z) {
    const v = viewport();
    const target = clampZoom(z);
    setView(zoomAbout(view, v.w / 2, v.h / 2, target / (view.zoom || 1)));
    announce(t('graph.saidZoom', { percent: Math.round(view.zoom * 100) }));
    return { ...view };
  }

  /** One step of ZOOM_STEPS in or out (the + / − buttons, Ctrl+= / Ctrl+−). @param {1|-1} dir */
  function zoomBy(dir) { return zoomTo(zoomStep(view.zoom, dir)); }

  /** Fit the SELECTED boxes (Shift+2). Nothing selected says so rather than doing nothing. */
  function zoomToSelection() {
    const ids = new Set(session.selected());
    const parts = session.doc().parts.filter((/** @type {any} */ p) => ids.has(p.id));
    if (!parts.length) { announce(t('graph.saidNothingToZoom')); return null; }
    setView(fitView(parts, viewport()));
    announce(t('graph.saidZoomSelection'));
    return { ...view };
  }

  /** Open the zoom menu — under the % button, or beside `anchor` (the run bar's zoom chip).
   * @param {HTMLElement|null} [anchor] */
  function openZoomMenu(anchor) {
    closeAddMenu();
    closeExportMenu();
    if (anchor && anchor !== zoomLabel && typeof anchor.getBoundingClientRect === 'function') {
      const r = root.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      zoomMenu.classList.add('graph-zoom-menu-floating');
      zoomMenu.style.left = `${Math.max(8, a.left - r.left)}px`;
      zoomMenu.style.top = `${Math.max(8, a.top - r.top - 4)}px`;
      root.appendChild(zoomMenu);
    } else if (zoomMenu.parentNode !== zoomWrap) {
      zoomMenu.classList.remove('graph-zoom-menu-floating');
      zoomMenu.style.left = '';
      zoomMenu.style.top = '';
      zoomWrap.appendChild(zoomMenu);
    }
    zoomMenu.hidden = false;
    zoomLabel.setAttribute('aria-expanded', 'true');
    const first = /** @type {any} */ (zoomMenu.firstChild);
    if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
    return true;
  }
  function closeZoomMenu() {
    if (zoomMenu.hidden) return false;
    const hadFocus = zoomMenu.contains(document.activeElement);
    zoomMenu.hidden = true;
    zoomLabel.setAttribute('aria-expanded', 'false');
    if (hadFocus) { try { zoomLabel.focus({ preventScroll: true }); } catch { /* gone */ } }
    return true;
  }

  /** @param {string} name 'select' | 'hand' @param {{say?: boolean}} [opt] */
  function setTool(name, opt = {}) {
    tool = name === 'hand' ? 'hand' : 'select';
    canvas.classList.toggle('graph-hand', tool === 'hand');
    selectToolBtn.setAttribute('aria-pressed', tool === 'select' ? 'true' : 'false');
    handToolBtn.setAttribute('aria-pressed', tool === 'hand' ? 'true' : 'false');
    if (opt.say !== false) announce(tool === 'hand' ? t('graph.saidToolHand') : t('graph.saidToolSelect'));
    return tool;
  }

  /** One live-region line per change, never the same line twice in a row. @param {string} text */
  function announce(text) {
    if (!text || text === lastSaid) return;
    lastSaid = text;
    live.textContent = text;
  }

  const partById = (/** @type {string} */ id) => session.doc().parts.find((/** @type {any} */ p) => p.id === id) || null;

  const labelOf = (/** @type {any} */ part) => titleFor(part);

  /** K5 (KE-2, PartSpec.titleOf): the box's title — a preset's name ("p5.js sketch") when the
   * part is one, the spec's label otherwise. The ONE place `titleOf` is read. @param {any} part */
  function titleFor(part) {
    const spec = part && specs.get(part.type);
    if (spec && typeof spec.titleOf === 'function') {
      try {
        const named = spec.titleOf(part);
        if (typeof named === 'string' && named) return named;
      } catch (err) { console.warn('[lolchat] titleOf threw', err); }
    }
    return (spec && spec.label) || (part ? part.type : '');
  }

  // ---- mutation doors --------------------------------------------------------------------------

  /** @param {string} type @param {number} wx @param {number} wy */
  function placeAt(type, wx, wy) {
    if (!hasDoc()) return null;
    const out = addPart(session.doc(), { type, x: snap(wx), y: snap(wy) }, { specs, newId: app.newId, now: app.now });
    if (!out.part) return null;
    session.apply(out.doc, { label: 'place' });
    select([out.part.id], { say: false });
    announce(t('graph.saidPlaced', { part: labelOf(out.part) }));
    return out.part.id;
  }

  /** @param {string} type */
  function placeCentred(type) {
    const v = viewport();
    const spec = specs.get(type);
    const size = (spec && spec.size) || { w: 220, h: 120 };
    const c = screenToWorld(view, v.w / 2, v.h / 2);
    return placeAt(type, c.x - size.w / 2, c.y - size.h / 2);
  }

  /**
   * K5 kickoff (KE-2): place a ＋ menu row — a plain part or a PRESET (type + settings + size) —
   * at a world point, or centred in the view when `at` is null. One undo entry, like `placeAt`.
   * @param {any} entry a PaletteEntry @param {{x: number, y: number}|null} [at] @returns {string|null}
   */
  function placeEntry(entry, at) {
    if (!hasDoc() || !entry) return null;
    const spec = specs.get(entry.type);
    if (!spec) return null;
    const size = entry.size || spec.size || { w: 220, h: 120 };
    let wx = 0;
    let wy = 0;
    const v = viewport();
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      // K5 landing (U2's contract request): a right-click near the right or bottom edge used to
      // put the box's top-left corner there, so the new box sat almost entirely off-screen. Pull
      // it back so it lands wholly in view; a box bigger than the view keeps its top-left visible.
      const tl = screenToWorld(view, 0, 0);
      const br = screenToWorld(view, v.w, v.h);
      const m = 16 / (view.zoom || 1);
      wx = Math.max(tl.x + m, Math.min(at.x, br.x - size.w - m));
      wy = Math.max(tl.y + m, Math.min(at.y, br.y - size.h - m));
    } else {
      const c = screenToWorld(view, v.w / 2, v.h / 2);
      wx = c.x - size.w / 2;
      wy = c.y - size.h / 2;
    }
    /** @type {any} */ const want = { type: entry.type, x: snap(wx), y: snap(wy), settings: entry.settings || {} };
    if (entry.size) { want.w = entry.size.w; want.h = entry.size.h; }
    const out = addPart(session.doc(), want, { specs, newId: app.newId, now: app.now });
    if (!out.part) return null;
    session.apply(out.doc, { label: 'place' });
    select([out.part.id], { say: false });
    announce(t('graph.saidPlaced', { part: labelOf(out.part) }));
    return out.part.id;
  }

  /**
   * K5 kickoff (KE-6): bring one part into view and flash it — the tutorial's `Show me`.
   * @param {string} id @returns {boolean}
   */
  function reveal(id) {
    const p = partById(id);
    if (!p) return false;
    const v = viewport();
    setView({ x: v.w / 2 - (p.x + p.w / 2) * view.zoom, y: v.h / 2 - (p.y + p.h / 2) * view.zoom, zoom: view.zoom });
    select([id], { say: false });
    const box = boxes.get(id);
    if (box) {
      box.node.dataset.flash = 'true';
      setTimeout(() => { if (box.node) delete box.node.dataset.flash; }, 1200);
    }
    return true;
  }

  /** @param {string} from @param {string} to @param {string} port */
  function wire(from, to, port) {
    const doc = session.doc();
    const out = addWire(doc, { from, to, port }, { specs, newId: app.newId, now: app.now });
    const fromPart = doc.parts.find((/** @type {any} */ p) => p.id === from);
    const toPart = doc.parts.find((/** @type {any} */ p) => p.id === to);
    if (!out.ok) {
      const key = /** @type {any} */ (WIRE_REASON)[out.reason];
      const fromSpec = fromPart && specs.get(fromPart.type);
      const vars = { from: labelOf(fromPart), to: labelOf(toPart), kind: (fromSpec && fromSpec.output) || '' };
      announce(key ? t(/** @type {any} */ (WIRE_REASON)[out.reason], vars) : t('graph.wireRefused'));
      // §8.4: a refusal that names a CONCEPT gets the strip and the lesson button, because
      // "you can't draw that" with no way to learn why is the refusal people give up on.
      if (out.reason === 'loop-ungated') sayLoopUngated();
      return { ok: false, reason: out.reason };
    }
    session.apply(out.doc, { label: 'wire' });
    announce(t('graph.saidWired', { from: labelOf(fromPart), to: labelOf(toPart) }));
    return { ok: true, id: out.wire.id };
  }

  /**
   * Name an arrow (K2-U1, COMPUTER_PLAN §5.1). ONE door for the pill, the keyboard and the debug
   * call, so every route makes the same undoable, `rev`-bumping edit that stales what it feeds.
   * Renaming to the same thing is not an edit and returns `false` — there is nothing to undo.
   * @param {string} wireId @param {string} text @returns {boolean}
   */
  function commitLabel(wireId, text) {
    if (!hasDoc()) return false;
    const doc = session.doc();
    const next = setWireLabel(doc, wireId, text, { now: app.now });
    if (next === doc) return false;
    session.apply(next, { label: 'label' });
    const named = next.wires.find((/** @type {any} */ w) => w.id === wireId);
    const name = named && named.label ? named.label : '';
    announce(name ? t('graph.saidWireNamed', { name }) : t('graph.saidWireUnnamed'));
    return true;
  }

  /**
   * Unplug ONE wire (critic R1, A5): the ✕ on its pill, and a wire end dragged onto nothing. One
   * undo entry, `rev` bumped and what it fed marked stale — graph/model.mjs's `removeWire`, the same
   * door Delete uses — and a sentence that says how to get it back.
   * @param {string} wireId @returns {boolean}
   */
  function unplugWire(wireId) {
    if (!hasDoc()) return false;
    const doc = session.doc();
    const w = doc.wires.find((/** @type {any} */ x) => x.id === wireId);
    if (!w) return false;
    selWires = selWires.filter((id) => id !== wireId);
    wires.setSelected(selWires);
    wires.setHover('');
    session.apply(removeWire(doc, wireId, { now: app.now }), { label: 'unwire' });
    announce(t('graph.saidWireUnplugged', { from: labelOf(partById(w.from)), to: labelOf(partById(w.to)) }));
    return true;
  }

  /**
   * Drop a picked-up wire end (critic R1, A5) — on an input (`target`) or on nothing (null).
   * @param {string} wireId @param {{partId: string, port: string}|null} target @returns {string} the outcome kind
   */
  function dropWireEnd(wireId, target) {
    if (!hasDoc()) return 'missing';
    const doc = session.doc();
    const out = rewireOutcome(doc, wireId, target, { specs, newId: app.newId, now: app.now });
    const was = out.was;
    if (out.kind === 'unplug') {
      selWires = selWires.filter((id) => id !== wireId);
      wires.setSelected(selWires);
      session.apply(out.doc, { label: 'unwire' });
      announce(t('graph.saidWireUnplugged', { from: labelOf(partById(was.from)), to: labelOf(partById(was.to)) }));
    } else if (out.kind === 'replug') {
      selWires = [];
      wires.setSelected(selWires);
      session.apply(out.doc, { label: 'rewire' });
      announce(t('graph.saidWireReplugged', { from: labelOf(partById(was.from)), to: labelOf(partById(target ? target.partId : '')) }));
    } else if (out.kind === 'refused') {
      // The wire stays exactly where it was; the reason is the same sentence drawing it would give.
      const fromPart = partById(was.from);
      const fromSpec = fromPart && specs.get(fromPart.type);
      const vars = { from: labelOf(fromPart), to: labelOf(partById(target ? target.partId : '')), kind: (fromSpec && fromSpec.output) || '' };
      const key = /** @type {any} */ (WIRE_REASON)[out.reason || ''];
      announce(key ? t(/** @type {any} */ (WIRE_REASON)[out.reason || ''], vars) : t('graph.wireRefused'));
      if (out.reason === 'loop-ungated') sayLoopUngated();
    }
    schedule('wires');
    return out.kind;
  }

  /**
   * What a keystroke acts on: the FOCUSED part when it is not part of the selection, otherwise the
   * selection. Tabbing to a box and pressing an arrow must move THAT box — that is the whole point
   * of it being in the tab order — while a marquee selection still moves as one.
   * @returns {string[]}
   */
  function targets() {
    const active = /** @type {any} */ (document.activeElement);
    const node = active && active.closest ? active.closest('.graph-part') : null;
    const id = node && node.dataset ? node.dataset.id : null;
    const sel = session.selected();
    if (id && sel.indexOf(id) < 0 && layer.contains(node)) return [id];
    return sel;
  }

  function deleteSelection() {
    const ids = targets();
    const doomedWires = selWires.slice();
    if (!ids.length && !doomedWires.length) return false;
    let doc = session.doc();
    for (const id of doomedWires) doc = removeWire(doc, id, { now: app.now });
    if (ids.length) doc = removeParts(doc, ids, { now: app.now });
    selWires = [];
    wires.setSelected(selWires);
    session.apply(doc, { label: 'delete' });
    session.select([]);
    announce(ids.length ? t('graph.saidDeleted', { count: ids.length }) : t('graph.saidWireDeleted'));
    return true;
  }

  function doUndo() {
    const ok = session.undo();
    announce(ok ? t('graph.saidUndo') : t('graph.saidNothingToUndo'));
    return ok;
  }

  function doRedo() {
    const ok = session.redo();
    announce(ok ? t('graph.saidRedo') : t('graph.saidNothingToRedo'));
    return ok;
  }

  /** @param {string[]} ids @param {{say?: boolean}} [opt] */
  function select(ids, opt = {}) {
    selWires = [];
    wires.setSelected(selWires);
    session.select(ids);
    if (opt.say !== false) {
      announce(ids.length ? t('graph.saidSelected', { count: ids.length }) : t('graph.saidNothingSelected'));
    }
    return ids;
  }

  // ---- clipboard -------------------------------------------------------------------------------

  function copyText() {
    const ids = session.selected();
    if (!ids.length) return null;
    return JSON.stringify(toClipboard(session.doc(), ids));
  }

  /**
   * @param {string} text
   * @param {{at?: {x: number, y: number}|null, label?: string}} [opt] `at` is the WORLD point the
   *   group's top-left lands on (the pointer, for Ctrl+V); without one it lands 20 px down-right.
   * @returns {string[]} the ids of the pasted parts */
  function pasteText(text, opt = {}) {
    const payload = fromClipboard(text);
    if (!payload || !hasDoc()) { announce(t('graph.saidNothingToPaste')); return []; }
    let doc = session.doc();
    const off = pasteOffset(payload.parts, opt.at || null);
    /** @type {Map<number, string>} */ const minted = new Map();
    for (const p of payload.parts) {
      /** @type {any} */ const want = { type: p.type, x: snap(p.x + off.dx), y: snap(p.y + off.dy), settings: p.settings };
      if (Number(/** @type {any} */ (p).w) > 0 && Number(/** @type {any} */ (p).h) > 0) {
        want.w = /** @type {any} */ (p).w;
        want.h = /** @type {any} */ (p).h;
      }
      const out = addPart(doc, want, { specs, newId: app.newId, now: app.now });
      if (!out.part) continue;                       // a type this build does not have: dropped
      doc = out.doc;
      minted.set(p.i, out.part.id);
    }
    for (const w of payload.wires) {
      const from = minted.get(w.from);
      const to = minted.get(w.to);
      if (!from || !to) continue;
      const out = addWire(doc, { from, to, port: w.port, label: w.label }, { specs, newId: app.newId, now: app.now });
      if (out.ok) doc = out.doc;
    }
    const ids = Array.from(minted.values());
    if (!ids.length) { announce(t('graph.saidNothingToPaste')); return []; }
    const dup = opt.label === 'duplicate';
    session.apply(doc, { label: dup ? 'duplicate' : 'paste' });
    select(ids, { say: false });
    announce(dup ? t('graph.saidDuplicated', { count: ids.length }) : t('graph.saidPasted', { count: ids.length }));
    return ids;
  }

  /** Ctrl+D (critic R1, tldraw tool #4): the selection, again, 20 px down-right. One undo entry. */
  function duplicate() {
    const text = copyText();
    return text ? pasteText(text, { label: 'duplicate' }) : [];
  }

  /**
   * Plain text pasted onto the canvas becomes a Text box holding it, at the pointer (A7, the tldraw
   * gesture). Only when nothing is being typed into and the text is not one of our own payloads.
   * @param {string} text @param {{x: number, y: number}|null} at @returns {string|null}
   */
  function pastePlainText(text, at) {
    if (!hasDoc() || !specs.get('note')) return null;
    const v = viewport();
    const c = at || screenToWorld(view, v.w / 2, v.h / 2);
    const out = addPart(session.doc(), { type: 'note', x: snap(c.x), y: snap(c.y), settings: { text: String(text) } }, { specs, newId: app.newId, now: app.now });
    if (!out.part) return null;
    session.apply(out.doc, { label: 'paste' });
    select([out.part.id], { say: false });
    announce(t('graph.saidPastedText'));
    return out.part.id;
  }

  /** The pointer's world point while it is over the canvas, else null. */
  function pointerWorld() {
    if (!pointer) return null;
    const r = canvas.getBoundingClientRect();
    if (pointer.x < r.left || pointer.x > r.right || pointer.y < r.top || pointer.y > r.bottom) return null;
    return screenToWorld(view, pointer.x - r.left, pointer.y - r.top);
  }

  /**
   * K-2 (critic R1, A6): ask a box to open its editor — double-click on its body, Enter or F2 with
   * it the only thing selected. A part that has no `edit()` answers false and nothing happens.
   * @param {string} id @returns {boolean}
   */
  function editPart(id) {
    const box = boxes.get(id);
    if (!box || !box.inst || typeof box.inst.edit !== 'function') return false;
    try { return box.inst.edit() !== false; } catch (err) {
      console.warn('[lolchat] part edit() threw', err);
      return false;
    }
  }

  // ---- C3-U3: tidy, export, import -------------------------------------------------------------

  /**
   * Lay the graph out, left to right. ONE undo entry, and only ever from the button: `tidy()` is
   * pure and this is its only caller, which is how "never automatic" (spec §4) is kept true.
   * @returns {number} how many parts moved
   */
  function doTidy() {
    const doc = session.doc();
    const next = tidy(doc, { now: app.now });
    if (next === doc) { announce(t('graph.tidyNothing')); return 0; }
    const moved = next.parts.reduce(
      (/** @type {number} */ n, /** @type {any} */ p, /** @type {number} */ i) => n + (p === doc.parts[i] ? 0 : 1),
      0,
    );
    session.apply(next, { label: 'tidy' });
    announce(t('graph.tidyMoved', { n: moved }));
    return moved;
  }

  /**
   * Write the graph out as one `.lolgraph.json`. `values:true` carries the cached values, and an
   * image value carries its data URL — so a Render part's picture travels INSIDE the file (spec §5)
   * and a file with pictures in it is large on purpose. Never throws: ui/transfer.mjs's ladder
   * (object URL → data URL → "copy it instead") already has a last resort, and if even that fails
   * the reader is told rather than left watching a button that did nothing.
   * @param {{values?: boolean}} [opts]
   * @returns {Promise<{ok: boolean, name: string, bytes: number, values: boolean, mode: string}>}
   */
  async function doExport(opts = {}) {
    const doc = session.doc();
    const values = opts.values !== undefined ? !!opts.values : !!valuesInput.checked;
    // K1: a library document has no thread, so its own title is the only one there is.
    const title = doc.title || '';
    const name = `${slugify(title || 'graph')}-${stampOf(app)}${FILE_SUFFIX}`;
    const text = toText(doc, { values, title, specs });
    /** @type {any} */ let out = null;
    try {
      out = await download(name, text, 'application/json', { app });
    } catch (err) {
      console.warn('[lolchat] exporting the graph failed', err);
    }
    if (destroyed) return { ok: !!(out && out.ok), name, bytes: text.length, values, mode: out ? out.mode : 'none' };
    if (out && out.ok) announce(t('graph.exportDone', { name }));
    else announce(t('graph.exportFailed'));
    return { ok: !!(out && out.ok), name, bytes: text.length, values, mode: out ? out.mode : 'none' };
  }

  /** The reason codes an import can come back with, as one sentence. @param {string[]} errors */
  function refusalSentence(errors) {
    for (const code of errors || []) {
      if (/** @type {any} */ (IMPORT_ERROR)[code]) return t(/** @type {any} */ (IMPORT_ERROR)[code]);
    }
    return t('graph.errImportNotGraph');
  }

  /** What an otherwise-good import LEFT BEHIND, in words and without repeats. @param {string[]} errors */
  function droppedSentence(errors) {
    /** @type {string[]} */ const why = [];
    for (const code of errors || []) {
      const phrase = t(/** @type {any} */ (DROPPED_WHY)[code] || 'graph.dropOther');
      if (why.indexOf(phrase) < 0) why.push(phrase);
    }
    return t('graph.importDropped', { n: (errors || []).length, why: why.join(', ') });
  }

  /**
   * Adopt a `.lolgraph.json`. ONE undo entry for the whole file (§2.6 BJ-17), asked for first when
   * the canvas already has parts on it, and always reported: what came in, and what did not.
   * @param {string} text
   * @param {{name?: string, confirm?: boolean}} [o]
   * @returns {Promise<{ok: boolean, cancelled?: boolean, parts: number, wires: number,
   *   errors: string[], message: string}>}
   */
  async function importText(text, o = {}) {
    const nothing = { ok: false, parts: 0, wires: 0, errors: /** @type {string[]} */ ([]), message: '' };
    const before = session.doc();
    if (before.parts.length && o.confirm !== false) {
      const dialogs = app && app.dialogs;
      const go = dialogs && typeof dialogs.confirm === 'function'
        ? await dialogs.confirm({
          title: t('graph.importReplaceTitle'),
          body: t('graph.importReplaceBody', { n: before.parts.length }),
          ok: t('graph.importGraph'),
        })
        : true;
      if (!go) {
        announce(t('graph.importCancelled'));
        return { ...nothing, cancelled: true, message: t('graph.importCancelled') };
      }
      if (destroyed) return { ...nothing, cancelled: true, message: '' };
    }
    const doc = session.doc();
    const out = fromText(text, {
      specs, newId: app.newId, now: app.now, id: doc.id, threadId: doc.threadId, values: true,
    });
    if (!out.ok || !out.doc) {
      const message = refusalSentence(out.errors);
      announce(message);
      if (app && app.dialogs && typeof app.dialogs.toast === 'function') app.dialogs.toast(message, { kind: 'error' });
      return { ...nothing, errors: out.errors, message };
    }
    // ONE apply, so ONE undo entry takes the whole file back — parts, wires, title and all.
    session.apply(out.doc, { label: 'import' });
    select([], { say: false });
    selWires = [];
    fit();
    const parts = out.doc.parts.length;
    const wires = out.doc.wires.length;
    const message = out.errors.length
      ? droppedSentence(out.errors)
      : (parts ? t('graph.importDone', { n: parts, w: wires }) : t('graph.importEmpty'));
    announce(message);
    return { ok: true, parts, wires, errors: out.errors, message };
  }

  /** The file picker half of Import… A dismissed picker resolves null and says nothing. */
  async function pickAndImport() {
    const picked = await pickImportFile({ maxBytes: MAX_IMPORT_BYTES });
    if (!picked || destroyed) return null;
    if (picked.tooBig) {
      const message = t('graph.errImportTooBig');
      announce(message);
      if (app && app.dialogs && typeof app.dialogs.toast === 'function') app.dialogs.toast(message, { kind: 'error' });
      return { ok: false, parts: 0, wires: 0, errors: ['too-big'], message };
    }
    return importText(picked.text, { name: picked.name });
  }

  // ---- C3-U3: drop a graph file on the canvas ---------------------------------------------------
  // dragenter/dragleave fire for every child element the pointer crosses, so the overlay is driven
  // by a DEPTH COUNT rather than by the last event seen — otherwise it flickers off the moment the
  // drag passes over a part.
  let dragDepth = 0;

  function hideDrop() { dragDepth = 0; dropZone.hidden = true; }

  /** K6 kickoff (addendum KF-7): the overlay's words come from the drop router when there is one,
   * so they say what a drop will actually do. */
  function syncDropHint() {
    const drops = app && app.drops;
    let text = '';
    try { text = drops && typeof drops.hint === 'function' ? String(drops.hint() || '') : ''; } catch { text = ''; }
    const p = dropZone.firstChild;
    const want = text || t('graph.dropHint');
    if (p && p.textContent !== want) p.textContent = want;
  }

  /** @param {any} ev */
  function onDragEnter(ev) {
    if (!dragHasFile(ev)) return;
    ev.preventDefault();
    dragDepth++;
    syncDropHint();
    dropZone.hidden = false;
  }

  /** @param {any} ev */
  function onDragOver(ev) {
    if (!dragHasFile(ev)) return;
    ev.preventDefault();                       // without this the drop event never fires at all
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    if (dropZone.hidden) { dragDepth = 1; dropZone.hidden = false; }
  }

  /** @param {any} ev */
  function onDragLeave(ev) {
    if (!dragHasFile(ev)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropZone.hidden = true;
  }

  /** K6 landing: a file dropped ON a box (Image, Document, Sound) is taken and stopped by that
   * box, so the bubbling `onDrop` below never runs. This capture-phase listener sees every drop
   * first and only hides the overlay, so it never stays on screen after a drop on a box.
   * @param {any} ev */
  function onDropCapture(ev) {
    if (dragHasFile(ev)) hideDrop();
  }

  /** @param {any} ev */
  function onDrop(ev) {
    if (!dragHasFile(ev)) return;              // not ours: the document guard still preventDefaults it
    const files = ev.dataTransfer.files ? Array.from(/** @type {ArrayLike<any>} */ (ev.dataTransfer.files)) : [];
    ev.preventDefault();
    // Handled here and nowhere else: the composer's own drop handling must not also see a graph
    // file. This is the ONE place that stops the event, and only once a file is really in hand.
    ev.stopPropagation();
    hideDrop();
    if (!files.length) return;
    // K6 kickoff (addendum KF-7): with a drop router installed, EVERY file goes through it — a
    // picture becomes an Image box, a PDF a Document box, a sound a Sound box, a text file a Text
    // box, a graph file opens as before, and anything else is refused with a sentence. Without
    // one (a build that lacks the feature), a drop is a graph file, exactly as before K6.
    const drops = app && app.drops;
    if (drops && typeof drops.route === 'function') {
      const at = hasDoc() ? worldOf(ev) : null;
      Promise.resolve(drops.route(files, { at, importGraph: importGraphFile }))
        .catch((err) => {
          console.warn('[lolcomputer] the drop router failed', err);
          if (!destroyed) announce(t('graph.errImportUnreadable'));
        });
      return;
    }
    importGraphFile(files[0]);
  }

  /** The pre-K6 drop: a graph file, read and imported. The router calls it for `graph` files —
   * with the File, or with `{name, text}` when it already read the text to peek at it.
   * @param {any} file @returns {Promise<void>} */
  function importGraphFile(file) {
    if (!file) return Promise.resolve();
    // Refused before the read, not after: `file.text()` on a few hundred megabytes is the cost we
    // are avoiding. fromText() holds the same line for every other way in.
    if (Number(file.size) > MAX_IMPORT_BYTES) {
      const message = t('graph.errImportTooBig');
      announce(message);
      if (app && app.dialogs && typeof app.dialogs.toast === 'function') app.dialogs.toast(message, { kind: 'error' });
      return Promise.resolve();
    }
    return Promise.resolve(typeof file.text === 'function' ? file.text() : String(file.text || ''))
      .then((text) => { if (!destroyed) importText(String(text || ''), { name: file.name }); })
      .catch((err) => {
        console.warn('[lolchat] reading the dropped graph failed', err);
        if (!destroyed) announce(t('graph.errImportUnreadable'));
      });
  }

  // ---- part boxes ------------------------------------------------------------------------------

  /** @param {any} part */
  function makeBox(part) {
    const spec = specs.get(part.type);
    const node = el('div', 'graph-part');
    node.dataset.id = part.id;
    node.dataset.type = part.type;
    node.tabIndex = 0;
    node.setAttribute('role', 'group');
    const head = el('div', 'graph-part-head');
    const title = el('span', 'graph-part-title', titleFor(part));
    // K5 kickoff (KE-7): the permanent badge on a lesson's RECORDED answer. Hidden unless
    // `part.demo`; syncBox owns it.
    const demo = el('span', 'graph-part-demo', t('computer.demoBadge'));
    demo.hidden = true;
    const state = el('span', 'graph-part-state');
    const dot = el('i', 'graph-dot');
    dot.setAttribute('aria-hidden', 'true');
    const stateText = el('span', 'graph-state-label');
    state.append(dot, stateText);
    const fanout = el('span', 'graph-part-fanout');
    fanout.hidden = true;
    // K3-U3 (COMPUTER_PLAN §4.2, §9's title-bar row): ▶ on EVERY box. Pressing it is the push
    // entry point — `run({mode:'from', seeds:[id]})` — and it goes out through `o.onPlay`, so a
    // part never reaches for the runner and there is exactly one scheduler on this surface.
    // It is a <button>, which `onPointerDown`'s `interactive` guard already excludes from drags.
    const play = /** @type {any} */ (el('button', 'graph-part-play'));
    play.type = 'button';
    play.dataset.part = part.id;
    play.textContent = PLAY_GLYPH;
    play.title = t('computer.runPlayTitle');
    play.setAttribute('aria-label', t('computer.runPlayTitle'));
    play.addEventListener('click', (/** @type {any} */ ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (o.onPlay) o.onPlay(part.id);
    });
    head.append(title, demo, fanout, state, play);
    const body = el('div', 'graph-part-body');
    // §6.6, resolved at the K3 landing: a Button's FACE and its ▶ are ONE gesture — "clicking it
    // is `run({mode:'from', seeds:[id]})`". The part records the press itself (button.mjs owns
    // that) and the canvas starts the push run through the same `onPlay` the title-bar ▶ uses, so
    // neither has to know about the other and there is still exactly one scheduler. Delegated,
    // because the part's own DOM is rebuilt by its `render()` whenever it repaints.
    body.addEventListener('click', (/** @type {any} */ ev) => {
      const face = ev.target && ev.target.closest
        ? ev.target.closest('.graph-part-control[data-action="press"]') : null;
      if (!face || !body.contains(face)) return;
      if (o.onPlay) o.onPlay(part.id);
    });
    const error = el('p', 'graph-part-error');
    error.hidden = true;
    const foot = el('div', 'graph-part-foot');
    const value = /** @type {HTMLButtonElement} */ (el('button', 'graph-value'));
    value.type = 'button';
    value.hidden = true;
    value.title = t('graph.valueOpen');
    const cost = el('span', 'graph-cost graph-part-cost');
    foot.append(value, cost);
    const items = el('ul', 'graph-item-errors');
    items.hidden = true;
    node.append(head, body, error, foot, items);

    // Ports are positioned from the SAME function the wire ends use, so the picture and the
    // geometry cannot drift apart. Critic R1, A3: they are KEPT, so a resize moves them with the
    // box (`layoutPorts`) instead of leaving them where the box's first height put them.
    const inputs = (spec && spec.inputs) || [];
    /** @type {{in: HTMLElement[], out: HTMLElement|null}} */ const ports = { in: [], out: null };
    inputs.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
      const port = el('span', 'graph-port');
      port.dataset.port = p.name;
      port.dataset.dir = 'in';
      port.dataset.label = p.label || p.name;
      port.dataset.wired = 'false';
      port.setAttribute('aria-hidden', 'true');
      port.title = t('graph.portIn', { label: p.label || p.name });
      port.style.top = `${portOffsetY(part.h, i, inputs.length)}px`;
      node.appendChild(port);
      ports.in.push(port);
    });
    if (spec && spec.output) {
      const port = el('span', 'graph-port');
      port.dataset.port = 'out';
      port.dataset.dir = 'out';
      port.setAttribute('aria-hidden', 'true');
      port.title = t('graph.portOut');
      port.style.top = `${part.h / 2}px`;
      node.appendChild(port);
      ports.out = port;
    }
    // Critic R1, A3: the resize handle, bottom-right, on EVERY box (tldraw's corner). Decorative
    // for a screen reader — Alt+Shift+arrows is the keyboard way, and its title says so.
    const grip = el('span', 'graph-part-resize');
    grip.title = t('graph.resizeHandle');
    grip.setAttribute('aria-hidden', 'true');
    node.appendChild(grip);

    /** The PartCtx (BG-5): a part edits its own settings through here and through nothing else. */
    const ctx = {
      app,
      get part() { return partById(part.id) || part; },
      /** A keystroke: applied at once, but only the FIRST of an edit run opens an undo entry. */
      update(/** @type {object} */ patch) {
        const first = !editing.has(part.id);
        editing.add(part.id);
        session.apply(
          setSettings(session.doc(), part.id, patch, { specs, now: app.now }),
          { label: 'settings', undoable: first },
        );
      },
      /** The edit is over (blur/change): the next keystroke starts a new undo entry. */
      commit() { editing.delete(part.id); },
      open(/** @type {any} */ v) { session.inspect(v); },
      /** K5 kickoff (KE-3): the ONE sandbox guest, for a creative box re-drawing its own source. */
      sandbox() {
        return typeof session.sandbox === 'function' ? Promise.resolve(session.sandbox()).catch(() => null) : Promise.resolve(null);
      },
    };
    let inst = null;
    if (spec && typeof spec.render === 'function') {
      try { inst = spec.render(body, part, /** @type {any} */ (ctx)); } catch (err) { console.warn('[lolchat] part render failed', err); }
    }
    value.addEventListener('click', () => {
      const p = partById(part.id);
      if (p && p.value) session.inspect(p.value);
    });

    const box = { node, title, demo, stateText, body, value, cost, error, fanout, items, inst, spec, ports, last: /** @type {any} */ ({}) };
    layer.appendChild(node);
    boxes.set(part.id, box);
    return box;
  }

  /** Put a box's ports where the wire ends are for height `h` (critic R1, A3).
   * @param {any} box @param {number} h */
  function layoutPorts(box, h) {
    const list = box.ports ? box.ports.in : [];
    list.forEach((/** @type {HTMLElement} */ port, /** @type {number} */ i) => {
      port.style.top = `${portOffsetY(h, i, list.length)}px`;
    });
    if (box.ports && box.ports.out) box.ports.out.style.top = `${h / 2}px`;
  }

  /** @param {any} box @param {any} part @param {Set<string>} selectedSet */
  function syncBox(box, part, selectedSet) {
    const last = box.last;
    if (last.x !== part.x) { box.node.style.left = `${part.x}px`; last.x = part.x; }
    if (last.y !== part.y) { box.node.style.top = `${part.y}px`; last.y = part.y; }
    if (last.w !== part.w) { box.node.style.width = `${part.w}px`; last.w = part.w; }
    // K-3 (critic R1, A3): the box is EXACTLY `part.h` tall. It used to be a MIN-height, so content
    // grew the box past the height the ports, Fit and the marquee all believed in; now the body
    // scrolls inside it and the resize handle is how a box gets taller.
    if (last.h !== part.h) { box.node.style.height = `${part.h}px`; layoutPorts(box, part.h); last.h = part.h; }
    const state = part.state || 'idle';
    if (last.state !== state) {
      // §8.3: "the delivering wire animates a single travelling dot from source to target". It is
      // what makes "data flowed" legible to someone who has never seen a dataflow graph — so it
      // fires on the transition INTO `done`, on that part's outgoing wires, and nowhere else.
      if (state === 'done' && last.state && last.state !== 'done') flowFrom(part.id);
      box.node.dataset.state = state;
      box.stateText.textContent = t(/** @type {any} */ (STATE_LABEL)[state] || 'graph.stateIdle');
      last.state = state;
    }
    const sel = selectedSet.has(part.id);
    if (last.sel !== sel) { box.node.setAttribute('aria-selected', sel ? 'true' : 'false'); last.sel = sel; }
    // K5 (KE-2): a preset's title follows its settings — switch an SVG box to HTML and it says so.
    const named = titleFor(part);
    if (last.title !== named) { box.title.textContent = named; last.title = named; }
    const isDemo = part.demo === true;
    if (last.demo !== isDemo) { box.demo.hidden = !isDemo; box.node.dataset.demo = isDemo ? 'true' : 'false'; last.demo = isDemo; }
    // K4 kickoff (addendum KD-4): a `quiet` part draws its own value — Text renders it as
    // markdown, Preview draws it — so the canvas does not print the same words a second time in
    // the foot strip. Every other part keeps the strip, and the "open the value" click with it.
    const text = part.value && !(box.spec && /** @type {any} */ (box.spec).quiet) ? preview(part.value) : '';
    if (last.value !== text) {
      box.value.textContent = text;
      box.value.hidden = !text;
      last.value = text;
    }
    // A fanned part says how far through its items it is WHILE it runs (§2.6 BH-3) — `7/40` is
    // the difference between "something is happening" and "34 of my items are still to come".
    const fan = part.fanout && Number(part.fanout.n) > 0 ? part.fanout : null;
    const badge = fan ? t('graph.fanout', { done: fan.done || 0, n: fan.n }) : '';
    if (last.fanout !== badge) { box.fanout.textContent = badge; box.fanout.hidden = !badge; last.fanout = badge; }
    // One bad item never kills the run, so the bad ones have to be READABLE, by number.
    const itemErrors = (fan && Array.isArray(fan.errors) ? fan.errors : []).slice(0, ITEM_ERRORS_SHOWN);
    const errKey = itemErrors.map((/** @type {any} */ e) => `${e.i}:${e.message}`).join('|');
    if (last.items !== errKey) {
      box.items.replaceChildren(...itemErrors.map((/** @type {any} */ e) =>
        el('li', 'graph-item-error', t('parts.itemError', { i: Number(e.i) + 1, message: String(e.message || '') }))));
      box.items.hidden = !itemErrors.length;
      last.items = errKey;
    }
    const st = part.stats;
    const vars = st ? { sec: ((st.ms || 0) / 1000).toFixed(1), tokens: st.tokens || 0, calls: st.calls || 0 } : null;
    const stats = !vars ? '' : (vars.calls > 1 ? t('graph.costCalls', vars) : t('graph.cost', vars));
    if (last.cost !== stats) { box.cost.textContent = stats; last.cost = stats; }
    const err = part.error ? String(part.error) : '';
    if (last.error !== err) { box.error.textContent = err; box.error.hidden = !err; last.error = err; }
    const aria = t('graph.partAria', {
      label: (box.spec && box.spec.label) || part.type,
      state: t(/** @type {any} */ (STATE_LABEL)[state] || 'graph.stateIdle'),
    });
    if (last.aria !== aria) { box.node.setAttribute('aria-label', aria); last.aria = aria; }
    if (box.inst && typeof box.inst.update === 'function') {
      try { box.inst.update(part); } catch (err2) { console.warn('[lolchat] part update failed', err2); }
    }
  }

  /**
   * Critic R1, B8: a freshly LOADED document starts with no boxes. Lessons reuse ids (`n_title`,
   * `n_next`…), so reusing a box across a graph switch kept the OLD document's per-box closures —
   * a Preview's live draw, an edit timer, a Text box's editing flag — alive in the new one.
   */
  function resetBoxes() {
    for (const box of boxes.values()) {
      if (box.inst && typeof box.inst.destroy === 'function') {
        try { box.inst.destroy(); } catch { /* a part never blocks its own removal */ }
      }
      box.node.remove();
    }
    boxes.clear();
    editing.clear();
    wireFlags.clear();
    selWires = [];
    wires.setSelected(selWires);
    wires.setHover('');
    wires.setPreview(null);
    if (drag && drag.captured) { try { canvas.releasePointerCapture(drag.pointerId); } catch { /* gone */ } }
    drag = null;
    dragDoc = null;
    marquee.hidden = true;
    canvas.classList.remove('graph-wiring', 'graph-grabbing');
  }

  function renderParts() {
    const doc = session.doc();
    const selectedSet = new Set(session.selected());
    /** @type {Set<string>} */ const liveIds = new Set();
    for (const part of doc.parts) {
      liveIds.add(part.id);
      const box = boxes.get(part.id) || makeBox(part);
      syncBox(box, part, selectedSet);
    }
    for (const [id, box] of Array.from(boxes)) {
      if (liveIds.has(id)) continue;
      if (box.inst && typeof box.inst.destroy === 'function') {
        try { box.inst.destroy(); } catch { /* a part never blocks its own removal */ }
      }
      box.node.remove();
      boxes.delete(id);
      editing.delete(id);
    }
    const open = hasDoc();
    empty.textContent = open ? t('graph.empty') : t('graph.noDoc');
    empty.hidden = doc.parts.length > 0;
    addBtn.disabled = !open;
    runBtn.disabled = !open;
    const depth = session.undoDepth() || { past: 0, future: 0 };
    undoBtn.disabled = !depth.past;
    redoBtn.disabled = !depth.future;
  }

  /**
   * The NARROW path for a runtime patch. `session.patchPart`/`patchParts` already name the parts
   * that changed, so a Run over N parts must cost O(changed), not O(N) boxes per patch: without
   * this, one Run over 500 parts was ~3 full re-renders per part — 250 000 syncBox calls on the
   * main thread before the first request left the page (C1 fix pass).
   * The full `render()` stays for `doc`/`select`, where the part SET or the selection moved.
   * @param {string[]} ids @returns {boolean} true when every id had a box to sync
   */
  function syncOnly(ids) {
    const doc = session.doc();
    const selectedSet = new Set(session.selected());
    for (const id of ids) {
      const box = boxes.get(id);
      const part = doc.parts.find((/** @type {any} */ p) => p.id === id);
      // A part that has no box yet (or is gone) is a SET change wearing a patch's clothes: the
      // caller falls back to the full render rather than leaving the canvas half-drawn.
      if (!box || !part) return false;
      syncBox(box, part, selectedSet);
    }
    return true;
  }

  function render() {
    renderParts();
    schedule('wires');
  }

  // ---- pointer ---------------------------------------------------------------------------------
  //
  // CRITIC R1 (A6/A7, proven with real input): pointer capture is taken only once a press has
  // really become a DRAG — moved DRAG_SLOP px. Chromium delivers the click (and the dblclick) that
  // follows a captured press to the capture target, so capturing on every press sent every click
  // on a box body to the canvas: a filled Text box could not be opened for editing, and a double-
  // click on a box opened the ＋ menu on top of it. An uncaptured press that never moves is now an
  // ordinary click on whatever was under it.
  //
  // K-1: a press inside `[data-selectable]` (rendered text a person may want to copy) selects the
  // part and does NOTHING else — no drag, no preventDefault, no capture — so the browser starts a
  // text selection there. The box is dragged by its title bar and its chrome.

  /** Pointer → screen coordinates inside `.graph-canvas`. */
  function screenOf(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  const worldOf = (/** @type {any} */ ev) => {
    const s = screenOf(ev);
    return screenToWorld(view, s.x, s.y);
  };

  /** Every input port of every part, in world coordinates — the snap targets while wiring. */
  function inPorts(doc) {
    /** @type {{partId: string, port: string, x: number, y: number}[]} */ const out = [];
    for (const part of doc.parts) {
      const spec = specs.get(part.type);
      const inputs = (spec && spec.inputs) || [];
      inputs.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
        const pt = portPoint(part, { dir: 'in', index: i, count: inputs.length });
        out.push({ partId: part.id, port: p.name, x: pt.x, y: pt.y });
      });
    }
    return out;
  }

  /** @param {any[]} targets @param {{x: number, y: number}} p */
  function nearestPort(targets, p) {
    let best = null;
    let bestD = Infinity;
    for (const target of targets) {
      const d = Math.hypot(target.x - p.x, target.y - p.y);
      if (d < bestD) { bestD = d; best = target; }
    }
    return best && bestD <= SNAP_PX ? best : null;
  }

  /** The wire a press on this input port picks up: the LAST one drawn into it (the one on top).
   * @param {string} partId @param {string} port */
  function wireInto(partId, port) {
    const list = session.doc().wires.filter((/** @type {any} */ w) => w.to === partId && w.port === port);
    return list.length ? list[list.length - 1] : null;
  }

  /** Which inputs have a wire (critic R1, A5): a plugged input shows a grab cursor and says, in
   * its title, that dragging its wire off unplugs it. @param {any} doc */
  function markPorts(doc) {
    /** @type {Set<string>} */ const wired = new Set();
    for (const w of doc.wires) wired.add(`${w.to}\u0000${w.port}`);
    for (const [id, box] of boxes) {
      for (const port of (box.ports ? box.ports.in : [])) {
        const on = wired.has(`${id}\u0000${port.dataset.port}`) ? 'true' : 'false';
        if (port.dataset.wired === on) continue;
        port.dataset.wired = on;
        port.title = on === 'true'
          ? t('graph.portInWired', { label: port.dataset.label || '' })
          : t('graph.portIn', { label: port.dataset.label || '' });
      }
    }
  }

  /** The input port under a pointer event. A captured pointer's events all target the canvas, so
   * the element under the pointer is asked for when the event's own target is not a port.
   * @param {any} ev @returns {{partId: string, port: string}|null} */
  function portUnder(ev) {
    let node = ev && ev.target;
    const onPort = node && node.closest && node.closest('.graph-port[data-dir="in"]');
    if (!onPort && typeof document.elementFromPoint === 'function' && Number.isFinite(ev.clientX)) {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      if (hit) node = hit;
    }
    const portEl = node && node.closest ? node.closest('.graph-port[data-dir="in"]') : null;
    const partEl = portEl && portEl.closest ? portEl.closest('.graph-part') : null;
    return partEl && portEl && canvas.contains(partEl) ? { partId: partEl.dataset.id, port: portEl.dataset.port } : null;
  }

  /** Is this press on a scrollbar of the element it hit? A press on a box's scrollbar scrolls, it
   * never drags the box (critic R1, A7). @param {any} target @param {any} ev */
  function onScrollbar(target, ev) {
    if (!target || typeof target.getBoundingClientRect !== 'function' || !Number.isFinite(ev.clientX)) return false;
    const tall = target.scrollHeight > target.clientHeight + 1;
    const wide = target.scrollWidth > target.clientWidth + 1;
    if (!tall && !wide) return false;
    const cs = getComputedStyle(target);
    const scrollsY = tall && (/(auto|scroll)/.test(cs.overflowY) || target.tagName === 'TEXTAREA');
    const scrollsX = wide && (/(auto|scroll)/.test(cs.overflowX) || target.tagName === 'TEXTAREA');
    if (!scrollsY && !scrollsX) return false;
    const r = target.getBoundingClientRect();
    const k = target.offsetWidth ? r.width / target.offsetWidth : 1;      // the canvas zoom
    const x = (ev.clientX - r.left) / (k || 1);
    const y = (ev.clientY - r.top) / (k || 1);
    return (scrollsY && x >= target.clientLeft + target.clientWidth) || (scrollsX && y >= target.clientTop + target.clientHeight);
  }

  /** Which ways the scrollable thing under a wheel can still move, or null (K-1, A4). Walks from
   * the target up to its part; outside a part there is nothing to scroll but the canvas.
   * @param {any} target */
  function innerScroll(target) {
    let node = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    if (!node || !node.closest || !node.closest('.graph-part')) return null;
    const room = { up: false, down: false, left: false, right: false };
    let any = false;
    for (; node && node !== layer && node !== canvas; node = node.parentElement) {
      const cs = getComputedStyle(node);
      const y = /(auto|scroll)/.test(cs.overflowY) || node.tagName === 'TEXTAREA';
      const x = /(auto|scroll)/.test(cs.overflowX) || node.tagName === 'TEXTAREA';
      if (!x && !y) continue;
      const r = scrollRoom(node, { x, y });
      if (r.up || r.down || r.left || r.right) {
        any = true;
        room.up = room.up || r.up;
        room.down = room.down || r.down;
        room.left = room.left || r.left;
        room.right = room.right || r.right;
      }
    }
    return any ? room : null;
  }

  /** Take the pointer for a drag that has really started. @param {any} d */
  function capture(d) {
    if (d.captured) return;
    d.captured = true;
    try { canvas.setPointerCapture(d.pointerId); } catch { /* a synthetic pointer has no capture */ }
  }

  /** Give the canvas the keyboard after a press on a box's chrome, so Delete, arrows, Ctrl+C and
   * Enter reach it — without scrolling anything, and without stealing focus from the box itself.
   * @param {any} [partEl] the box that was pressed, if any */
  function takeFocus(partEl) {
    const active = /** @type {any} */ (document.activeElement);
    if (active === canvas) return;
    // The pressed box itself keeps its focus (it is what the arrows move); a field being typed in
    // does not — pressing a box's chrome is "click away", and it commits the edit.
    if (partEl && active && partEl.contains(active) && !isTyping(active)) return;
    try { canvas.focus({ preventScroll: true }); } catch { /* not focusable yet */ }
  }

  /** A highlighted sentence inside the canvas is cleared by a press on a box's chrome (the press
   * is cancelled, so the browser would otherwise keep it — and Ctrl+C would then copy the text,
   * not the box the person just clicked). */
  function clearTextSelection() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.anchorNode && root.contains(sel.anchorNode)) {
      try { sel.removeAllRanges(); } catch { /* read-only selection */ }
    }
  }

  function onPointerDown(ev) {
    if (ev.button !== 0 && ev.button !== 1) return;
    // Pressing anywhere else on the graph commits an open arrow name, the way clicking away from a
    // field always has. The pill's own press never reaches here — it stops at the pill — so this
    // cannot cancel the edit it just opened. (K2-U1: `blur` alone would lose the name in a window
    // that does not hold the OS focus, where Chromium fires no focus events at all.)
    wires.endLabelEdit();
    closeZoomMenu();
    if (drag) cancelDrag();                          // a second button mid-drag ends the first
    const target = /** @type {HTMLElement} */ (ev.target);
    const portEl = target && target.closest ? target.closest('.graph-port') : null;
    const partEl = target && target.closest ? target.closest('.graph-part') : null;
    const start = screenOf(ev);
    const base = { pointerId: ev.pointerId, start, captured: false, armed: false };

    // PAN: the middle button, Space held, or the Hand tool on empty canvas (Shift keeps the marquee).
    if (ev.button === 1 || spaceDown || (tool === 'hand' && !partEl && !ev.shiftKey)) {
      ev.preventDefault();                           // no middle-click autoscroll, no text selection
      drag = { ...base, kind: 'pan', view: { ...view }, click: ev.button === 0 && !spaceDown };
      canvas.classList.add('graph-grabbing');
      takeFocus();
      return;
    }
    if (portEl && partEl && portEl.dataset.dir === 'out') {
      drag = { ...base, kind: 'wire', from: partEl.dataset.id, targets: inPorts(session.doc()), snap: null };
      ev.preventDefault();
      takeFocus();
      return;
    }
    // A5: pressing a PLUGGED input picks its wire's end up (ComfyUI/tldraw). An empty input is
    // chrome, as it always was.
    if (portEl && partEl && portEl.dataset.dir === 'in') {
      const w = wireInto(partEl.dataset.id || '', portEl.dataset.port || '');
      if (w) {
        drag = { ...base, kind: 'rewire', wireId: w.id, from: w.from, targets: null, snap: null };
        ev.preventDefault();
        takeFocus();
        return;
      }
    }
    if (partEl) {
      const id = partEl.dataset.id;
      const selected = session.selected();
      const inSel = selected.indexOf(id) >= 0;
      const additive = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      // A3: the corner handle resizes THIS box, whatever else is selected.
      if (target.closest('.graph-part-resize')) {
        if (!inSel || selected.length !== 1) select([id], { say: false });
        const part = partById(id);
        if (!part) return;
        drag = { ...base, kind: 'resize', id, from: { w: part.w, h: part.h }, size: null };
        ev.preventDefault();
        takeFocus();
        return;
      }
      let ids = selected;
      if (additive) ids = inSel ? selected.filter((/** @type {string} */ s) => s !== id) : selected.concat([id]);
      else if (!inSel) ids = [id];
      if (ids !== selected) select(ids, { say: false });
      // Typing (or clicking a control) inside a part must not be hijacked by a drag.
      // `[contenteditable]:not([contenteditable="false"])`, not `="true"` (fix pass, finding 5):
      // the wire's label pill is `contentEditable = 'plaintext-only'`, which the narrower selector
      // does not match. It behaved only because the pill stops its own events.
      const interactive = target.closest && target.closest('input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])');
      if (interactive) { drag = null; return; }
      // K-1: text a person can select. The part is selected (above) and that is all.
      if (target.closest('[data-selectable]')) { drag = null; return; }
      if (onScrollbar(target, ev)) { drag = null; return; }
      drag = { ...base, kind: 'move', moved: false, ids: session.selected().slice(), origin: new Map() };
      for (const part of session.doc().parts) {
        if (drag.ids.indexOf(part.id) >= 0) drag.origin.set(part.id, { x: part.x, y: part.y });
      }
      ev.preventDefault();
      clearTextSelection();
      takeFocus(partEl);
      return;
    }
    // Empty space: a wire under the pointer (an 8 SCREEN px band at any zoom), else a marquee.
    const hit = wireAt(session.doc(), specs, worldOf(ev), WIRE_HIT / (view.zoom || 1));
    if (hit) {
      selWires = [hit.wire.id];
      wires.setSelected(selWires);
      session.select([]);
      schedule('wires');
      announce(t('graph.wireAria', {
        from: labelOf(partById(hit.wire.from)),
        to: labelOf(partById(hit.wire.to)),
      }));
      return;
    }
    drag = { ...base, kind: 'marquee', additive: ev.shiftKey };
    marquee.hidden = false;
    marquee.style.left = `${start.x}px`;
    marquee.style.top = `${start.y}px`;
    marquee.style.width = '0px';
    marquee.style.height = '0px';
    if (!ev.shiftKey) select([], { say: false });
  }

  function onPointerMove(ev) {
    pointer = { x: ev.clientX, y: ev.clientY };
    if (!drag) {
      // Nothing held: the only work is ONE hover check per frame (A5), never while a drag or a
      // pan is live, so neither pays for it.
      hoverTarget = ev.target;
      if (!ev.buttons) schedule('hover');
      return;
    }
    if (ev.pointerId !== undefined && drag.pointerId !== undefined && ev.pointerId !== drag.pointerId) return;
    // A release the canvas never heard (outside the window, before capture): end it here rather
    // than leave a drag stuck to a pointer with no button down.
    if (ev.isTrusted && ev.buttons === 0) { onPointerUp(ev); return; }
    const here = screenOf(ev);
    const dx = here.x - drag.start.x;
    const dy = here.y - drag.start.y;
    if (!drag.armed) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
      drag.armed = true;
      capture(drag);
      if (drag.kind === 'rewire') armRewire(drag);
      if (drag.kind === 'wire') canvas.classList.add('graph-wiring');
      if (drag.kind === 'resize') canvas.classList.add('graph-resizing');
      wires.setHover('');
    }
    if (drag.kind === 'pan') {
      setView({ x: drag.view.x + dx, y: drag.view.y + dy, zoom: view.zoom }, { commit: false });
      return;
    }
    if (drag.kind === 'move') {
      drag.moved = true;
      const wx = dx / view.zoom;
      const wy = dy / view.zoom;
      /** @type {Map<string, {x: number, y: number}>} */ const at = new Map();
      for (const [id, origin] of drag.origin) at.set(id, { x: snap(origin.x + wx), y: snap(origin.y + wy) });
      for (const [id, p] of at) {
        const box = boxes.get(id);
        if (!box) continue;
        box.node.style.left = `${p.x}px`;
        box.node.style.top = `${p.y}px`;
        box.last.x = p.x;
        box.last.y = p.y;
      }
      const doc = session.doc();
      dragDoc = { ...doc, parts: doc.parts.map((/** @type {any} */ p) => (at.has(p.id) ? { ...p, ...at.get(p.id) } : p)) };
      drag.at = at;
      schedule('wires');
      return;
    }
    if (drag.kind === 'resize') {
      const size = resizeRect(drag.from, dx, dy, view.zoom, undefined, GRID);
      drag.size = size;
      const box = boxes.get(drag.id);
      if (box) {
        box.node.style.width = `${size.w}px`;
        box.node.style.height = `${size.h}px`;
        box.last.w = size.w;
        box.last.h = size.h;
        layoutPorts(box, size.h);
      }
      const doc = session.doc();
      dragDoc = { ...doc, parts: doc.parts.map((/** @type {any} */ p) => (p.id === drag.id ? { ...p, w: size.w, h: size.h } : p)) };
      schedule('wires');
      return;
    }
    if (drag.kind === 'wire' || drag.kind === 'rewire') {
      const world = worldOf(ev);
      const doc = dragDoc || session.doc();
      const snapped = nearestPort((drag.targets || []).filter((/** @type {any} */ p) => p.partId !== drag.from), world);
      drag.snap = snapped;
      const from = doc.parts.find((/** @type {any} */ p) => p.id === drag.from);
      if (from) {
        wires.setPreview({
          a: portPoint(from, { dir: 'out' }),
          b: snapped ? { x: snapped.x, y: snapped.y } : world,
        });
      }
      return;
    }
    if (drag.kind === 'marquee') {
      const r = normaliseRect(drag.start, here);
      marquee.style.left = `${r.x}px`;
      marquee.style.top = `${r.y}px`;
      marquee.style.width = `${r.w}px`;
      marquee.style.height = `${r.h}px`;
      drag.rect = r;
    }
  }

  /** The picked-up wire leaves the picture (the document keeps it until the drop decides).
   * @param {any} d */
  function armRewire(d) {
    const doc = session.doc();
    dragDoc = { ...doc, wires: doc.wires.filter((/** @type {any} */ w) => w.id !== d.wireId) };
    d.targets = inPorts(dragDoc);
    canvas.classList.add('graph-wiring');
    schedule('wires');
  }

  function onPointerUp(ev) {
    if (!drag) return;
    if (ev && ev.pointerId !== undefined && drag.pointerId !== undefined && ev.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    if (d.captured) { try { canvas.releasePointerCapture(d.pointerId); } catch { /* the capture may already be gone */ } }
    canvas.classList.remove('graph-grabbing', 'graph-resizing');
    if (d.kind === 'pan') {
      if (d.armed) commitView();
      // A click with the Hand on empty canvas is still "click away": it clears the selection.
      else if (d.click && tool === 'hand') { selWires = []; wires.setSelected(selWires); select([], { say: false }); schedule('wires'); }
      return;
    }
    if (d.kind === 'move') {
      dragDoc = null;
      if (!d.moved || !d.at) { schedule('wires'); return; }
      let doc = session.doc();
      for (const [id, p] of d.at) doc = movePart(doc, id, p, { now: app.now });
      session.apply(doc, { label: 'move' });
      if (d.at.size === 1) {
        const [id, p] = Array.from(d.at.entries())[0];
        announce(t('graph.saidMoved', { part: labelOf(partById(id)), x: p.x, y: p.y }));
      }
      return;
    }
    if (d.kind === 'resize') {
      dragDoc = null;
      if (!d.armed || !d.size) { schedule('wires'); return; }
      const next = resizePart(session.doc(), d.id, d.size, { now: app.now });
      session.apply(next, { label: 'resize' });
      const part = partById(d.id);
      if (part) announce(t('graph.saidResized', { part: labelOf(part), w: part.w, h: part.h }));
      return;
    }
    if (d.kind === 'wire') {
      canvas.classList.remove('graph-wiring');
      wires.setPreview(null);
      if (!d.armed) return;
      const to = portUnder(ev) || d.snap;
      if (to) wire(d.from, to.partId, to.port);
      schedule('wires');
      return;
    }
    if (d.kind === 'rewire') {
      canvas.classList.remove('graph-wiring');
      wires.setPreview(null);
      dragDoc = null;
      if (!d.armed) {
        // A click on a plugged input selects its wire — Delete then removes it, F2 names it.
        selWires = [d.wireId];
        wires.setSelected(selWires);
        session.select([]);
        schedule('wires');
        const w = session.doc().wires.find((/** @type {any} */ x) => x.id === d.wireId);
        if (w) announce(t('graph.wireAria', { from: labelOf(partById(w.from)), to: labelOf(partById(w.to)) }));
        return;
      }
      const under = portUnder(ev);
      dropWireEnd(d.wireId, under && under.partId !== d.from ? under : d.snap);
      return;
    }
    if (d.kind === 'marquee') {
      marquee.hidden = true;
      const r = d.rect;
      if (!r || (r.w < DRAG_SLOP && r.h < DRAG_SLOP)) return;
      const a = screenToWorld(view, r.x, r.y);
      const b = screenToWorld(view, r.x + r.w, r.y + r.h);
      const hits = marqueeHits(session.doc().parts, normaliseRect(a, b));
      select(d.additive ? Array.from(new Set(session.selected().concat(hits))) : hits);
    }
  }

  /** Escape mid-gesture: everything goes back to where it was and nothing is written. */
  function cancelDrag() {
    const d = drag;
    drag = null;
    if (!d) return false;
    if (d.captured) { try { canvas.releasePointerCapture(d.pointerId); } catch { /* gone */ } }
    canvas.classList.remove('graph-grabbing', 'graph-wiring', 'graph-resizing');
    wires.setPreview(null);
    marquee.hidden = true;
    dragDoc = null;
    if (d.kind === 'pan' && d.armed) setView(d.view);
    if (d.kind === 'move' && d.origin) {
      for (const [id, o0] of d.origin) {
        const box = boxes.get(id);
        if (!box) continue;
        box.node.style.left = `${o0.x}px`;
        box.node.style.top = `${o0.y}px`;
        box.last.x = o0.x;
        box.last.y = o0.y;
      }
    }
    if (d.kind === 'resize') {
      const box = boxes.get(d.id);
      if (box) {
        box.node.style.width = `${d.from.w}px`;
        box.node.style.height = `${d.from.h}px`;
        box.last.w = d.from.w;
        box.last.h = d.from.h;
        layoutPorts(box, d.from.h);
      }
    }
    schedule('wires');
    return true;
  }

  /** The pointer lost the canvas mid-drag (a system dialog, a window switch): keep what was done. */
  function onLostCapture(ev) {
    if (drag && drag.captured && ev.pointerId === drag.pointerId) {
      drag.captured = false;
      onPointerUp(ev);
    }
  }

  function onPointerLeave() {
    pointer = null;
    hoverTarget = null;
    wires.setHover('');
    canvas.classList.remove('graph-wire-hover');
  }

  /** The wire under a still pointer (A5): it thickens, its pill shows ✕, the cursor says "click". */
  function updateHover() {
    if (drag || !pointer || destroyed) { wires.setHover(''); canvas.classList.remove('graph-wire-hover'); return; }
    const target = hoverTarget;
    let id = '';
    let onPill = false;
    const pill = target && target.closest ? target.closest('.graph-wire-pill') : null;
    if (pill) { id = pill.dataset.wire || ''; onPill = true; } else if (!(target && target.closest && target.closest('.graph-part, .graph-toolbar'))) {
      const doc = session.doc();
      if (doc.wires.length) {
        const r = canvas.getBoundingClientRect();
        const w = screenToWorld(view, pointer.x - r.left, pointer.y - r.top);
        const hit = wireAt(doc, specs, w, WIRE_HIT / (view.zoom || 1));
        id = hit ? hit.wire.id : '';
      }
    }
    wires.setHover(id);
    canvas.classList.toggle('graph-wire-hover', !!id && !onPill);
  }

  /** Say the zoom ONCE, when the gesture has settled (A4): a pinch is dozens of events. */
  function sayZoomSoon() {
    if (zoomSayTimer) clearTimeout(zoomSayTimer);
    zoomSayTimer = setTimeout(() => {
      zoomSayTimer = null;
      if (!destroyed) announce(t('graph.saidZoom', { percent: Math.round(view.zoom * 100) }));
    }, 300);
  }

  function onWheel(ev) {
    closeCtxMenu();
    const now = Date.now();
    const latched = wheelLatch.kind && now - wheelLatch.at < WHEEL_LATCH_MS ? wheelLatch.kind : null;
    const zooming = ev.ctrlKey || ev.metaKey;
    const it = wheelIntent(ev, zooming ? null : innerScroll(ev.target), { latched, pagePx: viewport().h });
    if (it.kind === 'scroll-inner') {
      // K-1: the box's own content scrolls — the browser does it; the canvas stays put.
      wheelLatch = { kind: 'scroll-inner', at: now };
      return;
    }
    ev.preventDefault();
    if (it.kind === 'zoom') {
      wheelLatch = { kind: null, at: 0 };
      const p = screenOf(ev);
      setView(zoomAbout(view, p.x, p.y, it.factor));
      sayZoomSoon();
      return;
    }
    wheelLatch = { kind: 'pan', at: now };
    setView({ x: view.x - it.dx, y: view.y - it.dy, zoom: view.zoom });
  }

  /** The canvas is `overflow:hidden`, which is still a scroll container: a focus or a selection
   * drag could scroll it and shift every coordinate the canvas computes. It never scrolls. */
  function onCanvasScroll() {
    if (canvas.scrollTop || canvas.scrollLeft) { canvas.scrollTop = 0; canvas.scrollLeft = 0; }
  }

  // ---- keyboard --------------------------------------------------------------------------------

  /** Is the keystroke going into something that edits text? True whatever FLAVOUR of
   * contenteditable it is — the label pill is `plaintext-only` (fix pass, finding 5) — so the
   * guard holds even for a key path that never reaches the pill's own handler. */
  const isTyping = (/** @type {any} */ target) => !!(target && target.closest
    && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));

  function setSpace(on) {
    spaceDown = !!on;
    canvas.classList.toggle('graph-panning', spaceDown);
  }

  function onKeyDown(ev) {
    const typing = isTyping(ev.target);
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); if (o.onRun) o.onRun(); return; }
    if (ev.key === 'Escape') {
      // §8.1's ladder (critic R1, B7). Leaving a field is ALL Escape does while typing: it used to
      // stop the run first, so Escape out of a text box killed a three-minute run.
      if (typing) {
        ev.preventDefault();
        if (ev.target && typeof ev.target.blur === 'function') ev.target.blur();
        return;
      }
      if (cancelDrag() || closeZoomMenu() || closeCtxMenu()) { ev.preventDefault(); return; }
      // Then the surface's own CANCEL_HANDLERS, in order: the drawer closes before a run stops.
      if (o.onCancel && o.onCancel()) { ev.preventDefault(); return; }
      if (session.selected().length || selWires.length) {
        ev.preventDefault();
        selWires = [];
        wires.setSelected(selWires);
        schedule('wires');
        select([]);
      }
      return;
    }
    if (typing) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && (ev.key === 'z' || ev.key === 'Z')) {
      ev.preventDefault();
      if (ev.shiftKey) doRedo(); else doUndo();
      return;
    }
    if (mod && (ev.key === 'y' || ev.key === 'Y')) { ev.preventDefault(); doRedo(); return; }
    if (mod && (ev.key === 'a' || ev.key === 'A')) {
      ev.preventDefault();
      select(session.doc().parts.map((/** @type {any} */ p) => p.id));
      return;
    }
    // A4: the zoom keys (tldraw's). The window has no menu, so none of these is taken.
    if (mod && (ev.key === '=' || ev.key === '+')) { ev.preventDefault(); zoomBy(1); return; }
    if (mod && (ev.key === '-' || ev.key === '_')) { ev.preventDefault(); zoomBy(-1); return; }
    if (mod && ev.key === '0') { ev.preventDefault(); zoomTo(1); return; }
    if (mod && (ev.key === 'd' || ev.key === 'D')) { ev.preventDefault(); duplicate(); return; }
    // A7: the key is left to the browser (it raises the copy/paste events above); these only
    // cover a platform where it raises none.
    if (mod && (ev.key === 'c' || ev.key === 'C') && !ev.shiftKey && wantsPartCopy(ev)) { copyFallback(); return; }
    if (mod && (ev.key === 'v' || ev.key === 'V') && !ev.shiftKey && hasDoc()) { pasteFallback(); return; }
    if (!mod && ev.shiftKey && ev.code === 'Digit1') { ev.preventDefault(); fit(); return; }
    if (!mod && ev.shiftKey && ev.code === 'Digit2') { ev.preventDefault(); zoomToSelection(); return; }
    // K2-U1: a selected arrow can be NAMED without a mouse. F2 is the rename key everywhere else
    // in this app's ancestry; Enter is what a reader tries first.
    if ((ev.key === 'F2' || ev.key === 'Enter') && selWires.length === 1) {
      ev.preventDefault();
      wires.editLabel(selWires[0]);
      return;
    }
    // K-2 (critic R1, A6): Enter or F2 on the ONE selected box opens its editor. A button that has
    // the focus keeps Enter for itself.
    if ((ev.key === 'F2' || ev.key === 'Enter') && !selWires.length && !mod) {
      const tag = ev.target && ev.target.tagName;
      const ids = targets();
      if (tag !== 'BUTTON' && ids.length === 1 && editPart(ids[0])) { ev.preventDefault(); return; }
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelection(); return; }
    if (!mod && (ev.key === 'f' || ev.key === 'F') && !ev.shiftKey) { ev.preventDefault(); fit(); return; }
    if (!mod && !ev.altKey && (ev.key === 'h' || ev.key === 'H')) { ev.preventDefault(); setTool('hand'); return; }
    if (!mod && !ev.altKey && (ev.key === 'v' || ev.key === 'V')) { ev.preventDefault(); setTool('select'); return; }
    if (ev.key === ' ') {
      // A focused button keeps Space (it is how a keyboard presses it).
      if (ev.target && ev.target.tagName === 'BUTTON') return;
      ev.preventDefault();
      setSpace(true);
      return;
    }
    if (String(ev.key).indexOf('Arrow') === 0) {
      const ids = targets();
      if (!ids.length) return;
      ev.preventDefault();
      const step = ev.shiftKey && !ev.altKey ? 1 : GRID;
      const dx = (ev.key === 'ArrowRight' ? step : 0) - (ev.key === 'ArrowLeft' ? step : 0);
      const dy = (ev.key === 'ArrowDown' ? step : 0) - (ev.key === 'ArrowUp' ? step : 0);
      let doc = session.doc();
      /** @type {any} */ let last = null;
      // A3: Alt+Shift+arrows RESIZE by the grid — the keyboard way to the corner handle.
      const resizing = ev.altKey && ev.shiftKey;
      for (const id of ids) {
        const part = doc.parts.find((/** @type {any} */ p) => p.id === id);
        if (!part) continue;
        if (resizing) {
          last = { w: part.w + dx, h: part.h + dy };
          doc = resizePart(doc, id, last, { now: app.now });
        } else {
          last = { x: part.x + dx, y: part.y + dy };
          doc = movePart(doc, id, last, { now: app.now });
        }
      }
      session.apply(doc, { label: resizing ? 'resize' : 'move' });
      if (ids.length === 1 && last) {
        const p = partById(ids[0]);
        if (resizing && p) announce(t('graph.saidResized', { part: labelOf(p), w: p.w, h: p.h }));
        else if (!resizing) announce(t('graph.saidMoved', { part: labelOf(p), x: last.x, y: last.y }));
      }
    }
  }

  function onKeyUp(ev) {
    if (ev.key === ' ') setSpace(false);
  }

  /** Critic R1, A4: Space released OUTSIDE the canvas (or while the window was elsewhere) must
   * still end the pan, or every left-drag pans for ever and the marquee is gone. */
  function onWindowKeyUp(ev) { if (ev.key === ' ' && spaceDown) setSpace(false); }
  function onWindowBlur() { if (spaceDown) setSpace(false); }
  function onFocusOut(ev) {
    const next = ev.relatedTarget;
    if (spaceDown && !(next && root.contains(next))) setSpace(false);
  }

  function onFocusIn(ev) {
    const partEl = ev.target && ev.target.closest ? ev.target.closest('.graph-part') : null;
    if (!partEl || !partEl.dataset.id) return;
    const sel = session.selected();
    if (sel.length === 1 && sel[0] === partEl.dataset.id) return;
    select([partEl.dataset.id], { say: false });
  }

  /** Has the page a text selection INSIDE the Computer's canvas? */
  function textSelected() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || !String(sel)) return false;
    return !!(sel.anchorNode && root.contains(sel.anchorNode));
  }

  // ---- the clipboard, as a REAL Ctrl+C / Ctrl+V reaches it (critic R1, A7) ---------------------
  //
  // Chromium sends a keyboard copy/paste to the node the SELECTION starts in — and to <body> when
  // nothing is selected and the focus is not in a field. So with a box selected and the canvas
  // focused, the copy event never passed through the canvas at all, and the Copy command is not
  // even enabled unless someone cancels `beforecopy`. The listeners are therefore on the DOCUMENT,
  // and act only while this canvas has the focus or the event is aimed inside it.

  /** Is this clipboard event ours to answer? @param {any} ev */
  const ownsClipboard = (ev) => {
    if (destroyed) return false;
    const target = ev && ev.target;
    if (target && target.nodeType === 1 && root.contains(target)) return true;
    const active = document.activeElement;
    return !!(active && root.contains(active));
  };
  /** @param {any} ev */
  const wantsPartCopy = (ev) => shouldCopyParts({
    typing: isTyping(ev && ev.target) || isTyping(document.activeElement),
    selectionCollapsed: !textSelected(),
    selected: session.selected().length,
  });
  /** A copy that the key asked for and no copy event answered (the fallback below). */
  let copyPending = false;
  let pastePending = false;

  /** `beforecopy` cancelled = "Copy is enabled here" (how Chromium decides for a non-field). */
  function onBeforeCopy(ev) { if (ownsClipboard(ev) && wantsPartCopy(ev)) ev.preventDefault(); }
  function onBeforePaste(ev) {
    if (ownsClipboard(ev) && !isTyping(ev.target) && !isTyping(document.activeElement) && hasDoc()) ev.preventDefault();
  }

  function onCopy(ev) {
    if (!ownsClipboard(ev)) return;
    // K-1 / A7: highlighted words in a box are the READER's copy. Parts are copied only when
    // nothing is typed into and no text is selected (gestures.mjs `shouldCopyParts`).
    if (!wantsPartCopy(ev)) { copyPending = false; return; }
    const text = copyText();
    if (!text || !ev.clipboardData) return;
    copyPending = false;
    ev.preventDefault();
    ev.clipboardData.setData('text/plain', text);
    announce(t('graph.saidCopied', { count: session.selected().length }));
  }

  /** Ctrl+C on selected boxes where the platform fired no copy event: write the clipboard directly. */
  function copyFallback() {
    copyPending = true;
    setTimeout(() => {
      if (!copyPending || destroyed) return;
      copyPending = false;
      const text = copyText();
      const clip = typeof navigator !== 'undefined' ? /** @type {any} */ (navigator).clipboard : null;
      if (!text || !clip || typeof clip.writeText !== 'function') return;
      Promise.resolve(clip.writeText(text))
        .then(() => { if (!destroyed) announce(t('graph.saidCopied', { count: session.selected().length })); })
        .catch(() => { /* no clipboard access here: nothing was copied, and nothing says it was */ });
    }, 0);
  }

  /** Ctrl+V with no paste event (same platforms): read the clipboard directly. */
  function pasteFallback() {
    pastePending = true;
    const at = pointerWorld();
    setTimeout(() => {
      if (!pastePending || destroyed) return;
      pastePending = false;
      const clip = typeof navigator !== 'undefined' ? /** @type {any} */ (navigator).clipboard : null;
      if (!clip || typeof clip.readText !== 'function') return;
      Promise.resolve(clip.readText())
        .then((text) => {
          if (destroyed || !text) return;
          if (fromClipboard(text)) pasteText(text, { at });
          else if (String(text).trim() && hasDoc()) pastePlainText(text, at);
        })
        .catch(() => { /* no clipboard access: the key did nothing, as it did before */ });
    }, 0);
  }

  function onPaste(ev) {
    if (!ownsClipboard(ev)) return;
    pastePending = false;
    if (isTyping(ev.target) || isTyping(document.activeElement) || !ev.clipboardData) return;
    const text = ev.clipboardData.getData('text/plain');
    if (fromClipboard(text)) {
      ev.preventDefault();
      pasteText(text, { at: pointerWorld() });      // tldraw: the paste lands where you point
      return;
    }
    // Not ours. Plain words onto the canvas become a Text box (A7, tldraw); anything else is left
    // to whoever wants it.
    if (!text || !String(text).trim() || !hasDoc()) return;
    ev.preventDefault();
    pastePlainText(text, pointerWorld());
  }

  /**
   * K5 kickoff (KE-2): a double-click or a right-click on EMPTY canvas opens the ＋ menu there, and
   * the pick lands where the pointer was. Not on a part, a port, a wire or its label, and not on
   * anything that takes input — those gestures already mean something.
   * Critic R1, A6: "empty" is decided from what is UNDER THE POINTER, not from `ev.target` — a
   * double-click that followed a captured press arrived targeted at the canvas and opened the menu
   * on top of the box that was double-clicked.
   * @param {MouseEvent} ev */
  function onEmptyGesture(ev) {
    let target = /** @type {any} */ (ev.target);
    if (typeof document.elementFromPoint === 'function' && Number.isFinite(ev.clientX)) {
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      if (under) target = under;
    }
    if (target && target.closest && target.closest('.graph-part, .graph-port, .graph-wire-pill, .graph-wire-label, .graph-add-menu, button, input, textarea, select, a')) return;
    if (!hasDoc()) return;
    const world = worldOf(ev);
    if (wireAt(session.doc(), specs, world, WIRE_HIT / (view.zoom || 1))) return;
    ev.preventDefault();
    const r = root.getBoundingClientRect();
    openPalette({ at: world, screen: { x: ev.clientX - r.left, y: ev.clientY - r.top } });
  }

  /** A double-click on a box's body asks it to edit (K-2); anywhere else it is the empty gesture.
   * @param {MouseEvent} ev */
  function onDblClick(ev) {
    const target = /** @type {any} */ (ev.target);
    const partEl = target && target.closest ? target.closest('.graph-part') : null;
    if (partEl) {
      if (target.closest('input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])')) return;
      if (target.closest('.graph-part-body') && editPart(partEl.dataset.id || '')) ev.preventDefault();
      return;                                        // a box is never "empty canvas"
    }
    onEmptyGesture(ev);
  }

  /** A press outside the zoom menu closes it (the menu lives in the toolbar, not the canvas). */
  function onRootPointerDown(ev) {
    const target = ev.target;
    if (!ctxMenu.hidden && !(target && ctxMenu.contains(target))) closeCtxMenu();
    if (zoomMenu.hidden) return;
    if (target && (zoomMenu.contains(target) || zoomLabel.contains(target))) return;
    closeZoomMenu();
  }

  // ---- critic R1: the right-click menu on a box or a wire (tldraw tool #6) ----------------------
  // Every keyboard-only action gets a visible door here — Duplicate, Copy, Zoom to it, Delete,
  // Unplug, Name — each row naming its key. And "Copy text": the window has no native context
  // menu at all, so without this row a right-click could never copy the words in a box.
  const ctxMenu = el('div', 'graph-zoom-menu graph-ctx-menu');
  ctxMenu.hidden = true;
  ctxMenu.setAttribute('role', 'menu');
  root.appendChild(ctxMenu);

  /** @param {string} act @param {string} label @param {string} key @param {() => void} fn */
  function ctxRow(act, label, key, fn) {
    const b = button('graph-zoom-item', '');
    b.dataset.act = act;
    b.setAttribute('role', 'menuitem');
    b.append(el('span', 'graph-zoom-item-label', label));
    if (key) b.append(el('kbd', 'graph-zoom-key', key));
    b.addEventListener('click', () => { closeCtxMenu(); fn(); });
    return b;
  }

  /** @param {HTMLElement[]} rows @param {string} label @param {MouseEvent} ev */
  function openCtxMenu(rows, label, ev) {
    closeZoomMenu();
    closeAddMenu();
    closeExportMenu();
    ctxMenu.replaceChildren(...rows);
    ctxMenu.setAttribute('aria-label', label);
    const r = root.getBoundingClientRect();
    ctxMenu.style.left = `${Math.max(4, Math.min(ev.clientX - r.left, r.width - 230))}px`;
    ctxMenu.style.top = `${Math.max(4, Math.min(ev.clientY - r.top, r.height - rows.length * 34 - 12))}px`;
    ctxMenu.hidden = false;
    const first = /** @type {any} */ (ctxMenu.firstChild);
    if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
  }
  function closeCtxMenu() {
    if (ctxMenu.hidden) return false;
    const hadFocus = ctxMenu.contains(document.activeElement);
    ctxMenu.hidden = true;
    ctxMenu.replaceChildren();
    if (hadFocus) { try { canvas.focus({ preventScroll: true }); } catch { /* gone */ } }
    return true;
  }

  /** Copy through the browser's own Copy command (the copy listener above decides what goes on
   * the clipboard); where the command is refused, the clipboard API. */
  function copyNow() {
    let done = false;
    try { done = document.execCommand('copy'); } catch { done = false; }
    if (done) return;
    const text = textSelected() ? String(window.getSelection()) : copyText();
    const clip = typeof navigator !== 'undefined' ? /** @type {any} */ (navigator).clipboard : null;
    if (text && clip && typeof clip.writeText === 'function') Promise.resolve(clip.writeText(text)).catch(() => { /* no clipboard here */ });
  }

  /** @param {string} id @param {MouseEvent} ev */
  function openPartMenu(id, ev) {
    if (session.selected().indexOf(id) < 0) select([id], { say: false });
    const box = boxes.get(id);
    /** @type {HTMLElement[]} */ const rows = [];
    if (textSelected()) rows.push(ctxRow('copy-text', t('graph.ctxCopyText'), t('graph.keyCopy'), () => copyNow()));
    if (box && box.inst && typeof box.inst.edit === 'function') rows.push(ctxRow('edit', t('graph.ctxEdit'), t('graph.keyEdit'), () => { editPart(id); }));
    rows.push(
      ctxRow('duplicate', t('graph.ctxDuplicate'), t('graph.keyDuplicate'), () => { duplicate(); }),
      ctxRow('copy', t('graph.ctxCopy'), textSelected() ? '' : t('graph.keyCopy'), () => { clearTextSelection(); copyNow(); }),
      ctxRow('zoom', t('graph.ctxZoom'), t('graph.zoomKeySelection'), () => { zoomToSelection(); }),
      ctxRow('delete', t('graph.ctxDelete'), t('graph.keyDelete'), () => { deleteSelection(); }),
    );
    openCtxMenu(rows, t('graph.ctxPartMenu'), ev);
  }

  /** @param {string} wireId @param {MouseEvent} ev */
  function openWireMenu(wireId, ev) {
    selWires = [wireId];
    wires.setSelected(selWires);
    session.select([]);
    schedule('wires');
    openCtxMenu([
      ctxRow('name', t('graph.ctxWireName'), t('graph.keyRename'), () => { wires.editLabel(wireId); }),
      ctxRow('unplug', t('graph.ctxWireUnplug'), t('graph.keyDelete'), () => { unplugWire(wireId); }),
    ], t('graph.ctxWireMenu'), ev);
  }

  /** Right-click: a box's menu, a wire's menu, or — on empty canvas — the ＋ menu, as before.
   * A field keeps its own right-click. @param {MouseEvent} ev */
  function onContextMenu(ev) {
    let target = /** @type {any} */ (ev.target);
    if (typeof document.elementFromPoint === 'function' && Number.isFinite(ev.clientX)) {
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      if (under && canvas.contains(under)) target = under;
    }
    if (!target || !target.closest || !hasDoc()) return;
    // A wire's name pill first: the right button's press FOCUSES the pill, which opens its name
    // editor — a right-click there means the wire's menu, so that edit is put back unchanged.
    const pill = target.closest('.graph-wire-pill');
    if (pill && pill.dataset.wire) {
      wires.endLabelEdit({ cancel: true });
      ev.preventDefault();
      openWireMenu(pill.dataset.wire, ev);
      return;
    }
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const partEl = target.closest('.graph-part');
    if (partEl && partEl.dataset.id) { ev.preventDefault(); openPartMenu(partEl.dataset.id, ev); return; }
    const hit = (() => {
      const w = wireAt(session.doc(), specs, worldOf(ev), WIRE_HIT / (view.zoom || 1));
      return w ? { id: w.wire.id } : null;
    })();
    if (hit && hit.id) { ev.preventDefault(); openWireMenu(hit.id, ev); return; }
    onEmptyGesture(ev);
  }

  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', onLostCapture);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('scroll', onCanvasScroll);
  canvas.addEventListener('dragenter', onDragEnter);
  canvas.addEventListener('dragover', onDragOver);
  canvas.addEventListener('dragleave', onDragLeave);
  canvas.addEventListener('drop', onDrop);
  canvas.addEventListener('drop', onDropCapture, true);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('keyup', onKeyUp);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  document.addEventListener('beforecopy', onBeforeCopy);
  document.addEventListener('copy', onCopy);
  document.addEventListener('beforepaste', onBeforePaste);
  document.addEventListener('paste', onPaste);
  root.addEventListener('pointerdown', onRootPointerDown, true);
  window.addEventListener('keyup', onWindowKeyUp, true);
  window.addEventListener('blur', onWindowBlur);

  // ---- session events --------------------------------------------------------------------------

  const off = session.on((/** @type {any} */ ev) => {
    if (destroyed) return;
    if (ev.type === 'view') {
      const v = session.doc().view;
      if (v && (v.x !== view.x || v.y !== view.y || v.zoom !== view.zoom)) setView(v, { commit: false });
      return;
    }
    if (ev.type === 'part' && Array.isArray(ev.ids) && ev.ids.length && syncOnly(ev.ids)) return;
    // Critic R1, B8: a LOADED document gets fresh boxes, never the last graph's.
    if (ev.type === 'doc' && ev.loaded) resetBoxes();
    render();
  });

  // A part's MODEL PICKER is built from `app.farm.get().models`, and the farm is discovered
  // asynchronously after boot: "cold launch → open the Computer on a saved graph → the farm
  // arrives two seconds later" otherwise left every Ask box offering nothing but Automatic for the
  // life of the panel. The catalogue moving is a re-sync of the boxes, nothing more (C1 fix pass).
  const offFarm = app && app.bus && typeof app.bus.on === 'function'
    ? app.bus.on(EV.FARM_CHANGE, (/** @type {any} */ ev) => {
      if (destroyed) return;
      if (ev && Array.isArray(ev.changed) && ev.changed.indexOf('models') < 0) return;
      renderParts();
    })
    : () => {};

  applyView();
  render();

  return {
    root,
    canvas,
    layer,
    render,
    announce,
    said: () => live.textContent || '',
    fit,
    view: () => ({ ...view }),
    setView: (/** @type {any} */ v) => setView(v),
    /** Adopt the view a freshly loaded document carries. */
    adoptView(/** @type {any} */ v) {
      setView(v && Number.isFinite(v.zoom) ? v : { x: 0, y: 0, zoom: 1 }, { commit: false });
    },
    place: placeAt,
    placeCentred,
    // K5 kickoff (KE-2, KE-6): the ＋ menu and `Show me`. `openPalette` is what the first-run offer
    // and the tutorial call; a scenario clicks the ＋ itself.
    placeEntry,
    openPalette,
    paletteOpen: () => palette.isOpen(),
    closePalette: () => palette.close(),
    reveal,
    wire,
    select,
    selectedWires: () => selWires.slice(),
    // K2-U1 (COMPUTER_PLAN §5.1): naming an arrow, from the pill, the keyboard or `debug.label()` —
    // the same door in all three cases, which is what makes the scenario's `h.computer.label()`
    // proof about the shipped control rather than about a second code path.
    setWireLabel: (/** @type {string} */ wireId, /** @type {any} */ text) => commitLabel(wireId, String(text == null ? '' : text)),
    editWireLabel: (/** @type {string} */ wireId) => wires.editLabel(wireId),
    editingWireLabel: () => wires.editingLabel(),
    copyText,
    pasteText,
    deleteSelection,
    // ---- critic R1 (Package B) ------------------------------------------------------------------
    duplicate,
    /** A4: the zoom controls, as the buttons and keys call them. */
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    zoomTo,
    zoomToSelection,
    /** The zoom menu: under the % button, or next to `anchor` (the run bar's zoom chip). */
    openZoomMenu,
    closeZoomMenu,
    zoomMenuOpen: () => !zoomMenu.hidden,
    ctxMenuOpen: () => !ctxMenu.hidden,
    closeCtxMenu,
    tool: () => tool,
    setTool: (/** @type {string} */ name) => setTool(name),
    /** A5: unplug one wire (the ✕'s door) and drop a picked-up wire end (null = on nothing). */
    unplugWire,
    dropWireEnd,
    /** K-2: ask the box to open its editor. */
    editPart,
    hoveredWire: () => wires.hovered(),
    spaceHeld: () => spaceDown,
    // C3-U3. The panel's debug door calls exactly these, so a scenario and the buttons walk the
    // same path (BG-3); `exportText` is the only one that touches nothing, which is why the
    // round-trip scenario can use it without a file dialog.
    tidy: doTidy,
    exportFile: doExport,
    exportText: (/** @type {any} */ opt) => toText(session.doc(), { ...(opt || {}), specs }),
    importText,
    dropOpen: () => !dropZone.hidden,
    undo: doUndo,
    redo: doRedo,
    focus: () => canvas.focus(),
    setCapped,
    // K3-U3 (COMPUTER_PLAN §8.4): the run-notice strip, and the three rows a RUN can put in it.
    // The run bar owns when they appear — it is the module that reads the report — so each of
    // these takes the handler for its own button rather than reaching for the runner.
    setNotice,
    notice: () => (notice ? { ...notice } : null),
    setLimited,
    sayLoopUngated,
    // §4.5 / §8.2: which parts a gate stopped, and therefore which arrows grey.
    setBarred,
    barred: () => Array.from(barred),
    capField: () => ({ cap: Math.floor(Number(capInput.value)) || 0 }),
    /** The panel tells the canvas what the runner is doing; the canvas owns no run logic. */
    setRunning(/** @type {{running: boolean, progress: any}} */ s) {
      const running = !!(s && s.running);
      runBtn.hidden = running;
      stopBtn.hidden = !running;
      root.dataset.running = running ? 'true' : 'false';
      const p = s && s.progress;
      stopBtn.textContent = p
        ? (p.item
          ? t('graph.runningItems', { i: (p.i || 0) + 1, n: p.n || 0, item: (p.item.i || 0) + 1, items: p.item.n || 0 })
          : t('graph.running', { i: (p.i || 0) + 1, n: p.n || 0 }))
        : t('graph.stop');
    },
    destroy() {
      destroyed = true;
      off();
      offFarm();
      if (flowTimer) { clearTimeout(flowTimer); flowTimer = null; }
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (viewTimer) clearTimeout(viewTimer);
      viewTimer = null;
      if (zoomSayTimer) clearTimeout(zoomSayTimer);
      zoomSayTimer = null;
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      palette.destroy();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('lostpointercapture', onLostCapture);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('scroll', onCanvasScroll);
      canvas.removeEventListener('dragenter', onDragEnter);
      canvas.removeEventListener('dragover', onDragOver);
      canvas.removeEventListener('dragleave', onDragLeave);
      canvas.removeEventListener('drop', onDrop);
      canvas.removeEventListener('drop', onDropCapture, true);
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('keyup', onKeyUp);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('beforecopy', onBeforeCopy);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('beforepaste', onBeforePaste);
      document.removeEventListener('paste', onPaste);
      root.removeEventListener('pointerdown', onRootPointerDown, true);
      window.removeEventListener('keyup', onWindowKeyUp, true);
      window.removeEventListener('blur', onWindowBlur);
      for (const box of boxes.values()) {
        if (box.inst && typeof box.inst.destroy === 'function') {
          try { box.inst.destroy(); } catch { /* nothing may block teardown */ }
        }
      }
      boxes.clear();
      wires.destroy();
      root.remove();
      o.host.replaceChildren();
    },
  };
}
