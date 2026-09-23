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

import { t } from '../core/i18n.mjs';
import { KV_KEYS } from '../core/types.mjs';
import { EV } from '../core/events.mjs';
import { partSpecs } from './parts/index.mjs';
import { addPart, addWire, movePart, removeParts, removeWire, setSettings, setWireLabel } from './model.mjs';
import { preview } from './values.mjs';
import { createWireLayer, portOffsetY, portPoint, wireAt, SNAP_PX } from './wires.mjs';
import { DEFAULT_MAX_ITEMS } from './runner.mjs';
import { tidy } from './tidy.mjs';
import { toText, fromText, FILE_SUFFIX, MAX_IMPORT_BYTES } from './serialize.mjs';
import { download, pickImportFile, slugify } from '../ui/transfer.mjs';
import '../strings/graph.en.mjs';
import '../strings/parts.en.mjs';

/** How many per-item failures a part lists before the rest live in the run report (§2.6 BH-3).
 *  A fan of 40 that fails 40 times must not turn one part into a wall of red. */
export const ITEM_ERRORS_SHOWN = 5;

/** Parts land on a 10 px grid, so a hand-dragged graph still lines up. */
export const GRID = 10;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
/** Padding kept around the graph by fit-to-content, in screen px. */
export const FIT_PADDING = 40;
/** A pointer that moved less than this was a click, not a drag. */
export const DRAG_SLOP = 3;
/** The clipboard payload's format tag — the same name graph/serialize.mjs (C1-U1) uses for files. */
export const CLIP_FORMAT = 'lolgraph';

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

/** Fit-to-content. Never zooms IN past 1: a two-part graph should not fill the screen with one box.
 * @param {any[]} parts @param {{w: number, h: number}} viewport @returns {{x: number, y: number, zoom: number}} */
export function fitView(parts, viewport, pad = FIT_PADDING) {
  const b = bounds(parts);
  const vw = Math.max(1, viewport.w);
  const vh = Math.max(1, viewport.h);
  if (!b) return { x: 0, y: 0, zoom: 1 };
  const zoom = clampZoom(Math.min(1, (vw - pad * 2) / Math.max(1, b.w), (vh - pad * 2) / Math.max(1, b.h)));
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
    parts: parts.map((/** @type {any} */ p) => ({
      i: index.get(p.id), type: p.type, x: p.x, y: p.y, settings: { ...p.settings },
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
    .map((/** @type {any} */ p, /** @type {number} */ i) => ({
      i: Number.isFinite(p.i) ? p.i : i,
      type: p.type,
      x: p.x,
      y: p.y,
      settings: p.settings && typeof p.settings === 'object' ? p.settings : {},
    }));
  if (!parts.length) return null;
  const known = new Set(parts.map((/** @type {any} */ p) => p.i));
  const wires = (Array.isArray(raw.wires) ? raw.wires : [])
    .filter((/** @type {any} */ w) => w && known.has(w.from) && known.has(w.to) && typeof w.port === 'string');
  return { parts, wires };
}

// ---- the live canvas ----------------------------------------------------------------------------

/** @param {string} tag @param {string} cls @param {string} [text] */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {{
 *   session: any, host: HTMLElement,
 *   onRun?: () => void, onStop?: () => void,
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
  const addMenu = el('div', 'graph-add-menu');
  addMenu.hidden = true;
  const undoBtn = button('graph-btn graph-undo', t('graph.undo'));
  const redoBtn = button('graph-btn graph-redo', t('graph.redo'));
  const fitBtn = button('graph-btn graph-fit', t('graph.fit'));
  const zoomLabel = el('span', 'graph-zoom');
  zoomLabel.title = t('graph.zoomLabel');
  const addWrap = el('div', 'graph-add-wrap');
  addWrap.append(addBtn, addMenu);

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
  capBanner.append(capText, capRaiseBtn);

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
    runBtn, stopBtn, addWrap, undoBtn, redoBtn, fitBtn, tidyBtn, exportWrap, importBtn,
    capField, zoomLabel,
  );

  /** What the raise button should ask for: twice the cap the LAST run stopped at, or — when an
   * item ceiling stopped it — exactly enough for that fan. Never "unlimited". */
  let raiseTo = 0;
  capRaiseBtn.addEventListener('click', () => {
    if (!raiseTo || !o.onRaiseCap) return;
    setCapped(null);
    o.onRaiseCap(raiseTo);
  });
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

  /**
   * The cap banner: what a run that stopped at the cap says, and the one button that finishes it.
   * `null` clears it — a new run always starts with no banner (§2.6 BH-4).
   * @param {{cap: number, spent?: number, stopped?: number, items?: number, raiseTo?: number}|null} info
   */
  function setCapped(info) {
    const cap = info && Number(info.cap) > 0 ? Math.floor(Number(info.cap)) : 0;
    if (!cap) {
      raiseTo = 0;
      capBanner.hidden = true;
      capTitleEl.textContent = '';
      capBodyEl.textContent = '';
      return;
    }
    const items = Math.floor(Number((info && info.items) || 0));
    raiseTo = Math.floor(Number((info && info.raiseTo) || 0)) || cap * 2;
    // Two lines, not one run-on sentence: the title says what happened, the body says why it is
    // a promise rather than a limitation (seen in the C2 landing screenshots). A run stopped by the
    // ITEM ceiling says so in its own words: "50 generations" would be a lie about a part that was
    // going to spend none of them.
    capTitleEl.textContent = items > 0 ? t('graph.capItemsTitle', { items }) : t('graph.capTitle', { cap });
    capBodyEl.textContent = items > 0
      ? t('graph.capItemsBody', { cap, raise: raiseTo })
      : t('graph.capBody', { n: Number((info && info.stopped) || 0) });
    capBanner.hidden = false;
  }

  function closeAddMenu() { addMenu.hidden = true; addBtn.setAttribute('aria-expanded', 'false'); }
  function closeExportMenu() { exportMenu.hidden = true; exportBtn.setAttribute('aria-expanded', 'false'); }

  // The ＋ menu is the PALETTE — `partSpecs()` — and NOT everything the engine can load. K1
  // demoted `from-thread`/`to-thread` to legacy (COMPUTER_PLAN §3.2): a migrated graph still opens
  // one and it still says why it cannot run, but nobody may place a NEW one, so it must not be on
  // offer here. `specs` (the session's `specMap()`) stays the set the canvas RENDERS and wires.
  const palette = partSpecs().filter((/** @type {any} */ s) => specs.has(s.type));
  for (const spec of palette.sort((/** @type {any} */ a, /** @type {any} */ b) => (a.order || 0) - (b.order || 0))) {
    const item = button('graph-add-item', spec.label);
    item.dataset.type = spec.type;
    item.addEventListener('click', () => { closeAddMenu(); placeCentred(spec.type); });
    addMenu.appendChild(item);
  }

  addBtn.addEventListener('click', () => {
    closeExportMenu();
    addMenu.hidden = !addMenu.hidden;
    addBtn.setAttribute('aria-expanded', addMenu.hidden ? 'false' : 'true');
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

  // ---- state -----------------------------------------------------------------------------------
  /** @type {{x: number, y: number, zoom: number}} */
  let view = { x: 0, y: 0, zoom: 1 };
  /** @type {Map<string, any>} */ const boxes = new Map();
  /** @type {string[]} */ let selWires = [];
  /** @type {any} */ let drag = null;
  /** @type {any} */ let viewTimer = null;
  let spaceDown = false;
  let destroyed = false;
  let lastSaid = '';
  /** Parts whose settings edit is still running: the first keystroke opens ONE undo entry. */
  /** @type {Set<string>} */ const editing = new Set();

  // ONE rAF for the whole canvas: no part ever schedules a frame of its own.
  let raf = 0;
  let needView = false;
  let needWires = false;
  /** @type {any} */ let dragDoc = null;

  /** @param {'view'|'wires'} what */
  function schedule(what) {
    if (what === 'view') needView = true;
    if (what === 'wires') needWires = true;
    if (raf || destroyed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (needView) { needView = false; applyView(); }
      if (needWires) { needWires = false; wires.render(dragDoc || session.doc()); }
    });
  }

  function applyView() {
    layer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    wires.setView(view);
    zoomLabel.textContent = t('graph.zoom', { percent: Math.round(view.zoom * 100) });
  }

  /** Pan/zoom is not a document edit; it rides the save debounce and never touches undo. */
  function commitView() {
    if (viewTimer) clearTimeout(viewTimer);
    viewTimer = setTimeout(() => { viewTimer = null; if (!destroyed) session.setView(view); }, 150);
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

  /** One live-region line per change, never the same line twice in a row. @param {string} text */
  function announce(text) {
    if (!text || text === lastSaid) return;
    lastSaid = text;
    live.textContent = text;
  }

  const partById = (/** @type {string} */ id) => session.doc().parts.find((/** @type {any} */ p) => p.id === id) || null;

  const labelOf = (/** @type {any} */ part) => {
    const spec = part && specs.get(part.type);
    return (spec && spec.label) || (part ? part.type : '');
  };

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

  /** @param {string} text @returns {string[]} the ids of the pasted parts */
  function pasteText(text) {
    const payload = fromClipboard(text);
    if (!payload || !hasDoc()) { announce(t('graph.saidNothingToPaste')); return []; }
    let doc = session.doc();
    /** @type {Map<number, string>} */ const minted = new Map();
    for (const p of payload.parts) {
      const out = addPart(
        doc,
        { type: p.type, x: snap(p.x + GRID * 2), y: snap(p.y + GRID * 2), settings: p.settings },
        { specs, newId: app.newId, now: app.now },
      );
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
    session.apply(doc, { label: 'paste' });
    select(ids, { say: false });
    announce(t('graph.saidPasted', { count: ids.length }));
    return ids;
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

  /** @param {any} ev */
  function onDragEnter(ev) {
    if (!dragHasFile(ev)) return;
    ev.preventDefault();
    dragDepth++;
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

  /** @param {any} ev */
  function onDrop(ev) {
    if (!dragHasFile(ev)) return;              // not ours: the document guard still preventDefaults it
    const file = ev.dataTransfer.files && ev.dataTransfer.files[0];
    ev.preventDefault();
    // Handled here and nowhere else: the composer's own drop handling must not also see a graph
    // file. This is the ONE place that stops the event, and only once a file is really in hand.
    ev.stopPropagation();
    hideDrop();
    if (!file) return;
    // Refused before the read, not after: `file.text()` on a few hundred megabytes is the cost we
    // are avoiding. fromText() holds the same line for every other way in.
    if (Number(file.size) > MAX_IMPORT_BYTES) {
      const message = t('graph.errImportTooBig');
      announce(message);
      if (app && app.dialogs && typeof app.dialogs.toast === 'function') app.dialogs.toast(message, { kind: 'error' });
      return;
    }
    Promise.resolve(typeof file.text === 'function' ? file.text() : '')
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
    const title = el('span', 'graph-part-title', (spec && spec.label) || part.type);
    const state = el('span', 'graph-part-state');
    const dot = el('i', 'graph-dot');
    dot.setAttribute('aria-hidden', 'true');
    const stateText = el('span', 'graph-state-label');
    state.append(dot, stateText);
    const fanout = el('span', 'graph-part-fanout');
    fanout.hidden = true;
    head.append(title, fanout, state);
    const body = el('div', 'graph-part-body');
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
    // geometry cannot drift apart.
    const inputs = (spec && spec.inputs) || [];
    inputs.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
      const port = el('span', 'graph-port');
      port.dataset.port = p.name;
      port.dataset.dir = 'in';
      port.setAttribute('aria-hidden', 'true');
      port.title = t('graph.portIn', { label: p.label || p.name });
      port.style.top = `${portOffsetY(part.h, i, inputs.length)}px`;
      node.appendChild(port);
    });
    if (spec && spec.output) {
      const port = el('span', 'graph-port');
      port.dataset.port = 'out';
      port.dataset.dir = 'out';
      port.setAttribute('aria-hidden', 'true');
      port.title = t('graph.portOut');
      port.style.top = `${part.h / 2}px`;
      node.appendChild(port);
    }

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
    };
    let inst = null;
    if (spec && typeof spec.render === 'function') {
      try { inst = spec.render(body, part, /** @type {any} */ (ctx)); } catch (err) { console.warn('[lolchat] part render failed', err); }
    }
    value.addEventListener('click', () => {
      const p = partById(part.id);
      if (p && p.value) session.inspect(p.value);
    });

    const box = { node, title, stateText, body, value, cost, error, fanout, items, inst, spec, last: /** @type {any} */ ({}) };
    layer.appendChild(node);
    boxes.set(part.id, box);
    return box;
  }

  /** @param {any} box @param {any} part @param {Set<string>} selectedSet */
  function syncBox(box, part, selectedSet) {
    const last = box.last;
    if (last.x !== part.x) { box.node.style.left = `${part.x}px`; last.x = part.x; }
    if (last.y !== part.y) { box.node.style.top = `${part.y}px`; last.y = part.y; }
    if (last.w !== part.w) { box.node.style.width = `${part.w}px`; last.w = part.w; }
    if (last.h !== part.h) { box.node.style.minHeight = `${part.h}px`; last.h = part.h; }
    const state = part.state || 'idle';
    if (last.state !== state) {
      box.node.dataset.state = state;
      box.stateText.textContent = t(/** @type {any} */ (STATE_LABEL)[state] || 'graph.stateIdle');
      last.state = state;
    }
    const sel = selectedSet.has(part.id);
    if (last.sel !== sel) { box.node.setAttribute('aria-selected', sel ? 'true' : 'false'); last.sel = sel; }
    const text = part.value ? preview(part.value) : '';
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

  function onPointerDown(ev) {
    if (ev.button !== 0 && ev.button !== 1) return;
    // Pressing anywhere else on the graph commits an open arrow name, the way clicking away from a
    // field always has. The pill's own press never reaches here — it stops at the pill — so this
    // cannot cancel the edit it just opened. (K2-U1: `blur` alone would lose the name in a window
    // that does not hold the OS focus, where Chromium fires no focus events at all.)
    wires.endLabelEdit();
    const target = /** @type {HTMLElement} */ (ev.target);
    const portEl = target && target.closest ? target.closest('.graph-port') : null;
    const partEl = target && target.closest ? target.closest('.graph-part') : null;
    const start = screenOf(ev);

    if (ev.button === 1 || spaceDown) {
      drag = { kind: 'pan', start, view: { ...view } };
    } else if (portEl && portEl.dataset.dir === 'out' && partEl) {
      drag = { kind: 'wire', from: partEl.dataset.id, targets: inPorts(session.doc()), snap: null, start };
      canvas.classList.add('graph-wiring');
      ev.preventDefault();
    } else if (partEl) {
      const id = partEl.dataset.id;
      const selected = session.selected();
      const inSel = selected.indexOf(id) >= 0;
      const additive = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      let ids = selected;
      if (additive) ids = inSel ? selected.filter((/** @type {string} */ s) => s !== id) : selected.concat([id]);
      else if (!inSel) ids = [id];
      if (ids !== selected) select(ids, { say: false });
      // Typing (or clicking a control) inside a part must not be hijacked by a drag.
      // `[contenteditable]:not([contenteditable="false"])`, not `="true"` (fix pass, finding 5):
      // the wire's label pill is `contentEditable = 'plaintext-only'`, which the narrower selector
      // does not match. It behaved only because the pill stops its own events.
      const interactive = target.closest && target.closest('input, textarea, select, button, [contenteditable]:not([contenteditable="false"])');
      if (interactive) { drag = null; return; }
      drag = { kind: 'move', start, moved: false, ids: session.selected().slice(), origin: new Map() };
      for (const part of session.doc().parts) {
        if (drag.ids.indexOf(part.id) >= 0) drag.origin.set(part.id, { x: part.x, y: part.y });
      }
      ev.preventDefault();
    } else {
      // Empty space: a wire under the pointer, else a marquee.
      const hit = wireAt(session.doc(), specs, worldOf(ev));
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
      drag = { kind: 'marquee', start, additive: ev.shiftKey };
      marquee.hidden = false;
      marquee.style.left = `${start.x}px`;
      marquee.style.top = `${start.y}px`;
      marquee.style.width = '0px';
      marquee.style.height = '0px';
      if (!ev.shiftKey) select([], { say: false });
    }
    if (drag) {
      drag.pointerId = ev.pointerId;
      try { canvas.setPointerCapture(ev.pointerId); } catch { /* a synthetic pointer has no capture */ }
    }
  }

  function onPointerMove(ev) {
    if (!drag) return;
    const here = screenOf(ev);
    const dx = here.x - drag.start.x;
    const dy = here.y - drag.start.y;
    if (drag.kind === 'pan') {
      setView({ x: drag.view.x + dx, y: drag.view.y + dy, zoom: view.zoom }, { commit: false });
      return;
    }
    if (drag.kind === 'move') {
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
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
    if (drag.kind === 'wire') {
      const world = worldOf(ev);
      const snapped = nearestPort(drag.targets.filter((/** @type {any} */ p) => p.partId !== drag.from), world);
      drag.snap = snapped;
      const from = partById(drag.from);
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

  function onPointerUp(ev) {
    if (!drag) return;
    const d = drag;
    drag = null;
    try { canvas.releasePointerCapture(d.pointerId); } catch { /* the capture may already be gone */ }
    if (d.kind === 'pan') { commitView(); return; }
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
    if (d.kind === 'wire') {
      canvas.classList.remove('graph-wiring');
      wires.setPreview(null);
      const target = /** @type {HTMLElement} */ (ev.target);
      const portEl = target && target.closest ? target.closest('.graph-port[data-dir="in"]') : null;
      const partEl = portEl && portEl.closest ? portEl.closest('.graph-part') : null;
      const to = partEl ? { partId: partEl.dataset.id, port: portEl.dataset.port } : d.snap;
      if (to) wire(d.from, to.partId, to.port);
      schedule('wires');
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

  function onWheel(ev) {
    ev.preventDefault();
    const p = screenOf(ev);
    if (ev.ctrlKey || ev.metaKey) {
      setView(zoomAbout(view, p.x, p.y, Math.exp(-ev.deltaY / 400)));
      announce(t('graph.saidZoom', { percent: Math.round(view.zoom * 100) }));
      return;
    }
    setView({ x: view.x - ev.deltaX, y: view.y - ev.deltaY, zoom: view.zoom });
  }

  // ---- keyboard --------------------------------------------------------------------------------

  /** Is the keystroke going into something that edits text? True whatever FLAVOUR of
   * contenteditable it is — the label pill is `plaintext-only` (fix pass, finding 5) — so the
   * guard holds even for a key path that never reaches the pill's own handler. */
  const isTyping = (/** @type {any} */ target) => !!(target && target.closest
    && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));

  function onKeyDown(ev) {
    const typing = isTyping(ev.target);
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); if (o.onRun) o.onRun(); return; }
    if (ev.key === 'Escape') {
      if (o.onStop) o.onStop();
      if (typing && ev.target && typeof ev.target.blur === 'function') ev.target.blur();
      return;                                    // Escape also reaches the CANCEL_HANDLERS door
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
    // K2-U1: a selected arrow can be NAMED without a mouse. F2 is the rename key everywhere else
    // in this app's ancestry; Enter is what a reader tries first.
    if ((ev.key === 'F2' || ev.key === 'Enter') && selWires.length === 1) {
      ev.preventDefault();
      wires.editLabel(selWires[0]);
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelection(); return; }
    if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); fit(); return; }
    if (ev.key === ' ') { spaceDown = true; canvas.classList.add('graph-panning'); return; }
    if (String(ev.key).indexOf('Arrow') === 0) {
      const ids = targets();
      if (!ids.length) return;
      ev.preventDefault();
      const step = ev.shiftKey ? 1 : GRID;
      const dx = (ev.key === 'ArrowRight' ? step : 0) - (ev.key === 'ArrowLeft' ? step : 0);
      const dy = (ev.key === 'ArrowDown' ? step : 0) - (ev.key === 'ArrowUp' ? step : 0);
      let doc = session.doc();
      /** @type {any} */ let last = null;
      for (const id of ids) {
        const part = doc.parts.find((/** @type {any} */ p) => p.id === id);
        if (!part) continue;
        last = { x: part.x + dx, y: part.y + dy };
        doc = movePart(doc, id, last, { now: app.now });
      }
      session.apply(doc, { label: 'move' });
      if (ids.length === 1 && last) {
        announce(t('graph.saidMoved', { part: labelOf(partById(ids[0])), x: last.x, y: last.y }));
      }
    }
  }

  function onKeyUp(ev) {
    if (ev.key === ' ') { spaceDown = false; canvas.classList.remove('graph-panning'); }
  }

  function onFocusIn(ev) {
    const partEl = ev.target && ev.target.closest ? ev.target.closest('.graph-part') : null;
    if (!partEl || !partEl.dataset.id) return;
    const sel = session.selected();
    if (sel.length === 1 && sel[0] === partEl.dataset.id) return;
    select([partEl.dataset.id], { say: false });
  }

  function onCopy(ev) {
    if (isTyping(ev.target)) return;
    const text = copyText();
    if (!text || !ev.clipboardData) return;
    ev.preventDefault();
    ev.clipboardData.setData('text/plain', text);
    announce(t('graph.saidCopied', { count: session.selected().length }));
  }

  function onPaste(ev) {
    if (isTyping(ev.target) || !ev.clipboardData) return;
    const text = ev.clipboardData.getData('text/plain');
    if (!fromClipboard(text)) return;              // not ours: leave it to whoever wants it
    ev.preventDefault();
    pasteText(text);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dragenter', onDragEnter);
  canvas.addEventListener('dragover', onDragOver);
  canvas.addEventListener('dragleave', onDragLeave);
  canvas.addEventListener('drop', onDrop);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('keyup', onKeyUp);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('copy', onCopy);
  root.addEventListener('paste', onPaste);

  // ---- session events --------------------------------------------------------------------------

  const off = session.on((/** @type {any} */ ev) => {
    if (destroyed) return;
    if (ev.type === 'view') {
      const v = session.doc().view;
      if (v && (v.x !== view.x || v.y !== view.y || v.zoom !== view.zoom)) setView(v, { commit: false });
      return;
    }
    if (ev.type === 'part' && Array.isArray(ev.ids) && ev.ids.length && syncOnly(ev.ids)) return;
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
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (viewTimer) clearTimeout(viewTimer);
      viewTimer = null;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dragenter', onDragEnter);
      canvas.removeEventListener('dragover', onDragOver);
      canvas.removeEventListener('dragleave', onDragLeave);
      canvas.removeEventListener('drop', onDrop);
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('keyup', onKeyUp);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('copy', onCopy);
      root.removeEventListener('paste', onPaste);
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
