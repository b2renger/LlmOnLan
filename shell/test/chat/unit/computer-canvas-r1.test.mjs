// Critic R1, Package B: the canvas under a real mouse and a real trackpad, and the session and
// library defects that rode with it. Everything here is the PURE half — what a wheel means, how far
// a resize handle resizes, what dropping a wire end does, when Ctrl+C copies parts, what Undo
// brings back — plus the session, store, library and migration rules that only need a fake repo.
// The real-input half (a real wheel over a real box, a real drag of a real handle) is the harness's
// k8-input-* scenarios.

import assert from 'node:assert/strict';
import {
  wheelIntent, wheelPx, scrollRoom, zoomStep, resizeRect, rewireOutcome, shouldCopyParts,
  ZOOM_RATE, ZOOM_CLAMP, LINE_PX, MIN_BOX, ZOOM_STEPS,
} from '../../../renderer/chat/graph/gestures.mjs';
import {
  MIN_ZOOM, MAX_ZOOM, GRID, fitView, toClipboard, fromClipboard, pasteOffset, clampZoom,
} from '../../../renderer/chat/graph/canvas.mjs';
import { restoreProgram, createUndo } from '../../../renderer/chat/graph/undo.mjs';
import * as model from '../../../renderer/chat/graph/model.mjs';
import { createDocStore } from '../../../renderer/chat/computer/docstore.mjs';
import { createSession } from '../../../renderer/chat/computer/host.mjs';
import { lastRunAt, cardMeta } from '../../../renderer/chat/computer/library.mjs';
import { migrateGraphsV1, derivedId, MIGRATED_KEY, MIGRATED_SOURCES_KEY } from '../../../renderer/chat/computer/migrate.mjs';
import { journalKey } from '../../../renderer/chat/graph/journal.mjs';
import { install as installDrawer } from '../../../renderer/chat/computer/drawer.mjs';
import { createRegistry, SLOTS } from '../../../renderer/chat/core/registry.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { specs, ids, clock } from './graph-fixture.mjs';

const map = specs();

/** Run `fn` with the unit runner's DOM shim as `document` (and a do-nothing `window`). */
async function withDom(fn) {
  const g = /** @type {any} */ (globalThis);
  const doc = g.__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(g, 'document');
  const prev = g.document;
  const hadWin = Object.prototype.hasOwnProperty.call(g, 'window');
  const prevWin = g.window;
  g.document = doc;
  g.window = { addEventListener() {}, removeEventListener() {} };
  try { return await fn(doc); } finally {
    if (had) g.document = prev; else delete g.document;
    if (hadWin) g.window = prevWin; else delete g.window;
  }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/** A repo with the graph doors and kv; `getGraph` can be held open for one id. */
function fakeRepo({ rows = [] } = {}) {
  const puts = [];
  const kv = new Map();
  /** @type {Record<string, Promise<void>>} */ const holds = {};
  return {
    puts,
    rows,
    kv,
    holds,
    listGraphs: async (threadId) => (threadId ? rows.filter((r) => r.threadId === threadId) : rows.slice()),
    getGraph: async (id) => {
      if (holds[id]) await holds[id];
      return rows.find((r) => r.id === id) || null;
    },
    putGraph: async (doc) => {
      puts.push(doc);
      const i = rows.findIndex((r) => r.id === doc.id);
      if (i >= 0) rows[i] = doc; else rows.push(doc);
    },
    deleteGraph: async (id) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
    kvGet: async (key, fallback = null) => (kv.has(key) ? kv.get(key) : fallback),
    kvSet: async (key, value) => { kv.set(key, value); },
  };
}

/** note → ask(in), plus a second ask and an image-only looker: the rewire fixture. */
function wiredDoc() {
  const newId = ids('p');
  const now = clock();
  let doc = model.createDoc({ id: 'g1', threadId: null, now });
  const add = (type) => {
    const out = model.addPart(doc, { type, x: 0, y: 0 }, { specs: map, newId, now });
    doc = out.doc;
    return out.part.id;
  };
  const src = add('note');
  const a1 = add('ask');
  const a2 = add('ask');
  const look = add('looker');
  const w = model.addWire(doc, { from: src, to: a1, port: 'in', label: 'topic' }, { specs: map, newId: ids('w'), now });
  doc = w.doc;
  return { doc, src, a1, a2, look, wireId: w.wire.id, now };
}

export default (test) => {
  // ---- A4: the wheel -----------------------------------------------------------------------------

  test('wheel: ctrl (a trackpad pinch) zooms at exp(-deltaY/100), one to one with the fingers', () => {
    const pinch = wheelIntent({ deltaY: -5, ctrlKey: true });
    assert.equal(pinch.kind, 'zoom');
    assert.ok(near(/** @type {any} */ (pinch).factor, Math.exp(5 / ZOOM_RATE)), 'a small pinch is NOT slowed down');
    assert.equal(ZOOM_RATE, 100, 'Chromium sends deltaY = -100·ln(scale) for a pinch');
    const meta = wheelIntent({ deltaY: 5, metaKey: true });
    assert.equal(meta.kind, 'zoom', 'Cmd+wheel on a Mac zooms too');
  });

  test('wheel: one mouse notch zooms a sane step, and a burst cannot jump the whole range', () => {
    const notch = /** @type {any} */ (wheelIntent({ deltaY: 120, ctrlKey: true }));
    assert.ok(near(notch.factor, Math.exp(-ZOOM_CLAMP / ZOOM_RATE)), `clamped to ${ZOOM_CLAMP}: ${notch.factor}`);
    assert.ok(notch.factor > 0.7 && notch.factor < 0.85, 'one notch out is about ×0.78, not ×0.3');
    const lines = /** @type {any} */ (wheelIntent({ deltaY: -3, deltaMode: 1, ctrlKey: true }));
    assert.ok(near(lines.factor, Math.exp(ZOOM_CLAMP / ZOOM_RATE)), 'a LINE-mode notch is px ×16 and clamped the same');
  });

  test('wheel: a plain wheel or a two-finger scroll PANS by its delta in px, lines and pages too', () => {
    assert.deepEqual(wheelIntent({ deltaX: 12, deltaY: -30 }), { kind: 'pan', dx: 12, dy: -30 });
    assert.deepEqual(wheelIntent({ deltaY: 3, deltaMode: 1 }), { kind: 'pan', dx: 0, dy: 3 * LINE_PX });
    assert.deepEqual(wheelIntent({ deltaY: 1, deltaMode: 2 }, null, { pagePx: 600 }), { kind: 'pan', dx: 0, dy: 600 });
    assert.equal(wheelPx(2, 1), 32);
    assert.deepEqual(wheelIntent({ deltaY: 40, shiftKey: true }), { kind: 'pan', dx: 40, dy: 0 },
      'Shift+wheel on a mouse moves sideways');
  });

  test('wheel over a box that can still scroll that way scrolls THE BOX (K-1), not the canvas', () => {
    const room = { up: false, down: true, left: false, right: false };
    assert.equal(wheelIntent({ deltaY: 40 }, room).kind, 'scroll-inner');
    assert.equal(wheelIntent({ deltaY: -40 }, room).kind, 'pan', 'at the top, scrolling up pans');
    assert.equal(wheelIntent({ deltaY: 40 }, { up: true, down: false }).kind, 'pan', 'at its end the canvas pans');
    assert.equal(wheelIntent({ deltaX: 50, deltaY: 2 }, room).kind, 'pan', 'a sideways swipe over a box that only scrolls down pans');
    assert.equal(wheelIntent({ deltaX: 50, deltaY: 2 }, { right: true }).kind, 'scroll-inner');
    assert.equal(wheelIntent({ deltaY: 40, ctrlKey: true }, room).kind, 'zoom', 'a pinch over a box still zooms');
  });

  test('wheel: a gesture keeps the target it chose (no lurch when it slides over a box)', () => {
    const room = { down: true };
    assert.equal(wheelIntent({ deltaY: 40 }, room, { latched: 'pan' }).kind, 'pan',
      'a two-finger pan that slides over a scrollable box keeps panning');
    assert.equal(wheelIntent({ deltaY: 40 }, { down: false, up: true }, { latched: 'scroll-inner' }).kind, 'scroll-inner',
      'a scroll inside a box that reaches its end does not suddenly pan the canvas');
    assert.equal(wheelIntent({ deltaY: 40 }, null, { latched: 'scroll-inner' }).kind, 'pan',
      'once the pointer has left the box, the canvas takes over');
  });

  test('scrollRoom reads the four scroll numbers', () => {
    assert.deepEqual(scrollRoom({ scrollTop: 0, scrollHeight: 500, clientHeight: 200, scrollLeft: 0, scrollWidth: 100, clientWidth: 100 }),
      { up: false, down: true, left: false, right: false });
    assert.deepEqual(scrollRoom({ scrollTop: 300, scrollHeight: 500, clientHeight: 200, scrollLeft: 0, scrollWidth: 100, clientWidth: 100 }),
      { up: true, down: false, left: false, right: false });
    assert.deepEqual(scrollRoom({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 }), { up: false, down: false, left: false, right: false },
      'content that fits scrolls nowhere');
    assert.deepEqual(scrollRoom({ scrollTop: 10, scrollHeight: 500, clientHeight: 200 }, { y: false }), { up: false, down: false, left: false, right: false },
      'an axis the element does not scroll (overflow visible/hidden) is not room');
  });

  test('zoom limits: 10 % to 400 %, and Fit can fit a graph far wider than the window', () => {
    assert.equal(MIN_ZOOM, 0.1);
    assert.equal(MAX_ZOOM, 4);
    assert.equal(clampZoom(0.05), 0.1);
    const parts = [{ x: 0, y: 0, w: 220, h: 120 }, { x: 5000, y: 400, w: 220, h: 120 }];
    const v = fitView(parts, { w: 1000, h: 700 });
    assert.ok(v.zoom < 0.25, `a 5000-px graph needs less than the old 25 % floor: ${v.zoom}`);
    assert.ok(v.zoom * 5220 <= 1000, 'and it really fits');
    const one = fitView([{ x: 0, y: 0, w: 220, h: 120 }], { w: 1000, h: 700 });
    assert.equal(one.zoom, 1, 'zoom to one small box never zooms in past 100 %');
  });

  test('zoomStep walks the + / − ladder from wherever the zoom is', () => {
    assert.equal(zoomStep(1, 1), 1.5);
    assert.equal(zoomStep(1, -1), 0.75);
    assert.equal(zoomStep(0.3, 1), 0.5);
    assert.equal(zoomStep(0.3, -1), 0.25);
    assert.equal(zoomStep(4, 1), 4, 'the top stays the top');
    assert.equal(zoomStep(0.1, -1), 0.1, 'and the floor the floor');
    assert.deepEqual([ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.length - 1]], [MIN_ZOOM, MAX_ZOOM], 'the ladder spans the limits exactly');
  });

  // ---- A3: the resize handle ---------------------------------------------------------------------

  test('resizeRect: screen px ÷ zoom, snapped to the grid, never below the model minimum', () => {
    assert.deepEqual(resizeRect({ w: 220, h: 120 }, 80, 120, 1), { w: 300, h: 240 });
    assert.deepEqual(resizeRect({ w: 220, h: 120 }, 80, 120, 2), { w: 260, h: 180 }, 'at 200 % a screen px is half a world px');
    assert.deepEqual(resizeRect({ w: 220, h: 120 }, 83, 4, 1), { w: 300, h: 120 }, 'snapped to the 10 px grid');
    assert.deepEqual(resizeRect({ w: 220, h: 120 }, -900, -900, 1), { w: MIN_BOX.w, h: MIN_BOX.h },
      'the handle stops where model.resizePart does (80×60)');
    const stored = model.resizePart({ parts: [{ id: 'a', w: 1, h: 1 }], wires: [], rev: 1 }, 'a', resizeRect({ w: 220, h: 120 }, -900, -900, 1));
    assert.deepEqual([stored.parts[0].w, stored.parts[0].h], [MIN_BOX.w, MIN_BOX.h], 'what is drawn and what is stored agree');
  });

  test('the clipboard carries each box’s SIZE, and an older payload without one still pastes', () => {
    const doc = { parts: [{ id: 'p1', type: 'note', x: 10, y: 20, w: 380, h: 520, settings: { text: 'x' } }], wires: [] };
    const back = fromClipboard(JSON.stringify(toClipboard(doc, ['p1'])));
    assert.equal(back.parts[0].w, 380);
    assert.equal(back.parts[0].h, 520);
    const old = fromClipboard(JSON.stringify({ lolgraph: 1, parts: [{ type: 'note', x: 0, y: 0, settings: {} }], wires: [] }));
    assert.equal(old.parts.length, 1);
    assert.equal('w' in old.parts[0], false, 'no size: the part type’s own default applies');
  });

  test('paste lands under the pointer; without one, 20 px down-right of the original', () => {
    const parts = [{ x: 100, y: 200 }, { x: 300, y: 260 }];
    assert.deepEqual(pasteOffset(parts, { x: 500, y: 500 }), { dx: 400, dy: 300 }, 'the group’s top-left goes where you point');
    assert.deepEqual(pasteOffset(parts, null), { dx: GRID * 2, dy: GRID * 2 });
    assert.deepEqual(pasteOffset([], { x: 1, y: 1 }), { dx: 0, dy: 0 });
  });

  // ---- A5: unplugging a wire ---------------------------------------------------------------------

  test('rewireOutcome: dropped on nothing UNPLUGS, one new document, `to` marked stale', () => {
    const { doc, a1, wireId, now } = wiredDoc();
    const out = rewireOutcome(doc, wireId, null, { specs: map, newId: ids('w'), now });
    assert.equal(out.kind, 'unplug');
    assert.equal(out.doc.wires.length, 0);
    assert.equal(model.partById(out.doc, a1).state, 'stale');
    assert.ok(out.doc.rev > doc.rev, 'an unplug is a program edit: rev moves');
  });

  test('rewireOutcome: dropped on another input RE-PLUGS it, keeping its source and its name', () => {
    const { doc, src, a2, wireId, now } = wiredDoc();
    const out = rewireOutcome(doc, wireId, { partId: a2, port: 'in' }, { specs: map, newId: ids('x'), now });
    assert.equal(out.kind, 'replug');
    assert.equal(out.doc.wires.length, 1);
    assert.deepEqual([out.doc.wires[0].from, out.doc.wires[0].to, out.doc.wires[0].label], [src, a2, 'topic']);
    // One document = one undo entry: remove + add land together.
    const u = createUndo();
    u.push(doc, 'rewire');
    assert.equal(u.undo(out.doc).doc, doc, 'one undo takes the whole re-plug back');
  });

  test('rewireOutcome: back where it was is nothing; a refused port leaves the wire where it was', () => {
    const { doc, a1, look, wireId, now } = wiredDoc();
    const same = rewireOutcome(doc, wireId, { partId: a1, port: 'in' }, { specs: map, newId: ids('w'), now });
    assert.equal(same.kind, 'same');
    assert.equal(same.doc, doc);
    const refused = rewireOutcome(doc, wireId, { partId: look, port: 'image' }, { specs: map, newId: ids('w'), now });
    assert.equal(refused.kind, 'refused');
    assert.equal(refused.reason, 'type', 'text into an image-only input: the same reason drawing it would give');
    assert.equal(refused.doc, doc, 'the wire STAYS: a refused re-plug is not an unplug');
    assert.equal(rewireOutcome(doc, 'nope', null, { specs: map, newId: ids('w'), now }).kind, 'missing');
  });

  // ---- A7: Ctrl+C --------------------------------------------------------------------------------

  test('shouldCopyParts: parts only when nothing is typed into and no text is selected', () => {
    assert.equal(shouldCopyParts({ selectionCollapsed: true, typing: false, selected: 2 }), true);
    assert.equal(shouldCopyParts({ selectionCollapsed: false, typing: false, selected: 2 }), false,
      'highlighted words in a box are the reader’s copy, not ours');
    assert.equal(shouldCopyParts({ selectionCollapsed: true, typing: true, selected: 2 }), false);
    assert.equal(shouldCopyParts({ selectionCollapsed: true, typing: false, selected: 0 }), false);
    assert.equal(shouldCopyParts(/** @type {any} */ (null)), false);
  });

  // ---- B1: Undo keeps what a run produced --------------------------------------------------------

  /** a → b (a note feeding an ask), both done with values, as after a run. */
  function ranDoc() {
    const { doc: d0, src, a1, now } = wiredDoc();
    let doc = model.movePart(d0, src, { x: 0, y: 0 }, { now });
    doc = model.patchPart(doc, src, { state: 'done', value: { kind: 'text', data: 'cats' }, stats: { ms: 5, tokens: 0, calls: 0 } }, { now });
    doc = model.patchPart(doc, a1, { state: 'done', value: { kind: 'text', data: 'a poem' }, stats: { ms: 900, tokens: 40, calls: 1 } }, { now });
    return { doc, src, a1, now };
  }

  test('B1 (a): move, Run all, undo the move — the box goes back and EVERY answer stays', () => {
    const { doc: ran, src, a1, now } = ranDoc();
    const before = model.movePart(ran, src, { x: 0, y: 0 }, { now });
    const beforeIdle = { ...before, parts: before.parts.map((p) => ({ ...p, state: 'idle', value: null, stats: null })) };
    const moved = model.movePart(ran, src, { x: 300, y: 40 }, { now });
    const back = restoreProgram(moved, beforeIdle, { label: 'move', now });
    assert.deepEqual([model.partById(back, src).x, model.partById(back, src).y], [0, 0], 'the move is undone');
    assert.equal(model.partById(back, a1).state, 'done', 'the answer is not rewound');
    assert.equal(model.partById(back, a1).value.data, 'a poem');
    assert.equal(model.partById(back, a1).stats.calls, 1);
  });

  test('B1 (b): a snapshot taken mid-run never brings back running/queued spinners', () => {
    const { doc: ran, src, a1, now } = ranDoc();
    const snap = { ...ran, parts: ran.parts.map((p) => (p.id === a1 ? { ...p, state: 'running' } : p.id === src ? { ...p, state: 'queued', x: 50 } : p)) };
    const back = restoreProgram(ran, snap, { label: 'move', now });
    assert.equal(model.partById(back, a1).state, 'done');
    assert.equal(model.partById(back, src).state, 'done');
    assert.equal(model.partById(back, src).x, 50, 'the program came back');
  });

  test('B1 (c): undoing a SETTINGS edit marks that box (and what it feeds) stale, answers kept', () => {
    const { doc: ran, src, a1, now } = ranDoc();
    const edited = model.patchPart(model.setSettings(ran, src, { text: 'dogs' }, { specs: map, now }), src, { state: 'running' }, { now });
    const back = restoreProgram(edited, ran, { label: 'settings', now });
    assert.equal(model.partById(back, src).settings.text, '', 'the old settings are back');
    assert.equal(model.partById(back, src).state, 'stale', 'its answer came from settings no longer on the canvas');
    assert.equal(model.partById(back, a1).state, 'stale', 'and so did everything downstream');
    assert.equal(model.partById(back, a1).value.data, 'a poem', 'stale keeps the last answer, greyed');
  });

  test('B1 (c): an undone WIRE change stales the box it fed', () => {
    const { doc: ran, a1, now } = ranDoc();
    const unplugged = model.removeWire(ran, ran.wires[0].id, { now });
    const done = model.patchPart(unplugged, a1, { state: 'done' }, { now });
    const back = restoreProgram(done, ran, { label: 'unwire', now });
    assert.equal(back.wires.length, 1, 'the wire is back');
    assert.equal(model.partById(back, a1).state, 'stale', 'what arrives at it changed, so its answer is stale');
  });

  test('B1 (d): title and view stay the present’s — except when undoing an import', () => {
    const { doc: ran, src, now } = ranDoc();
    const snap = { ...ran, title: 'old', view: { x: 0, y: 0, zoom: 1 } };
    const cur = { ...model.movePart(ran, src, { x: 90, y: 0 }, { now }), title: 'Renamed', view: { x: -40, y: 10, zoom: 0.5 } };
    const back = restoreProgram(cur, snap, { label: 'move', now });
    assert.equal(back.title, 'Renamed', 'a rename is not undoable and an earlier undo must not revert it');
    assert.deepEqual(back.view, { x: -40, y: 10, zoom: 0.5 }, 'a pan is not an edit');
    const imp = restoreProgram(cur, snap, { label: 'import', now });
    assert.equal(imp.title, 'old', 'undoing an import takes the whole file back out');
  });

  test('B1: an undone delete brings the box back WITH its answer; runtime is grafted generically', () => {
    const { doc: ran, src, a1, now } = ranDoc();
    const tagged = { ...ran, parts: ran.parts.map((p) => (p.id === a1 ? { ...p, stats: { ...p.stats, seed: 42 }, futureField: 'kept' } : p)) };
    const gone = model.removeParts(tagged, [src], { now });
    const back = restoreProgram(gone, { ...tagged, parts: tagged.parts.map((p) => (p.id === src ? { ...p, state: 'running' } : p)) }, { label: 'delete', now });
    assert.equal(model.partById(back, src).value.data, 'cats', 'the deleted box’s own answer comes back with it');
    assert.equal(model.partById(back, src).state, 'stale', 'but not the `running` it was photographed in');
    const a = model.partById(back, a1);
    assert.equal(a.stats.seed, 42, 'K-5: every runtime field is grafted, including ones added later');
    assert.equal(a.futureField, 'kept');
    assert.ok(back.rev > gone.rev, 'an undo is a NEW revision, never an old one handed back');
  });

  // ---- B1, B11, B12 through the real session -----------------------------------------------------

  test('session: undo after a run keeps the answers (B1 through the one door)', async () => {
    const repo = fakeRepo();
    const app = { repo, now: clock(), newId: ids('g') };
    const s = createSession(app, null);
    await s.open('lib-1');
    const placed = model.addPart(s.doc(), { type: 'note', x: 0, y: 0 }, { specs: s.specs, newId: ids('p'), now: app.now });
    s.apply(placed.doc, { label: 'place' });
    const id = placed.part.id;
    s.apply(model.movePart(s.doc(), id, { x: 200, y: 0 }, { now: app.now }), { label: 'move' });
    s.patchPart(id, { state: 'done', value: { kind: 'text', data: 'kept' } });
    assert.equal(s.undo(), true);
    const p = model.partById(s.doc(), id);
    assert.equal(p.x, 0, 'the move is undone');
    assert.equal(p.value && p.value.data, 'kept', 'and the answer is not');
    assert.equal(s.redo(), true);
    assert.equal(model.partById(s.doc(), id).x, 200);
    assert.equal(model.partById(s.doc(), id).value.data, 'kept');
    await s.close();
  });

  test('B12: nothing is written before a document is open — the placeholder never becomes a row', async () => {
    const repo = fakeRepo();
    const app = { repo, now: clock(), newId: ids('g') };
    const s = createSession(app, null);
    s.setView({ x: 10, y: 10, zoom: 0.5 });
    s.apply({ ...s.doc(), title: 'phantom' }, { label: 'rename', undoable: false });
    await s.save();
    assert.equal(repo.puts.length, 0, 'a wheel during the migration wait saved an "Untitled" row');
    await s.open('lib-1');
    const writesAtOpen = repo.puts.length;
    s.setView({ x: 1, y: 2, zoom: 1 });
    await s.save();
    assert.equal(repo.puts.length, writesAtOpen + 1, 'the open document is written as before');
    assert.deepEqual(s.undoDepth(), { past: 0, future: 0 }, 'a freshly opened graph has no history');
    await s.close();
  });

  test('B11: A open, click B, click A again before B loads — B never lands', async () => {
    const repo = fakeRepo({ rows: [
      { ...model.createDoc({ id: 'A', threadId: null, now: () => 1 }), title: 'A' },
      { ...model.createDoc({ id: 'B', threadId: null, now: () => 2 }), title: 'B' },
    ] });
    const app = { repo, now: clock(), newId: ids('g') };
    const s = createSession(app, null);
    await s.open('A');
    /** @type {Function} */ let releaseB = () => {};
    repo.holds.B = new Promise((done) => { releaseB = done; });
    const toB = s.open('B');
    await new Promise((done) => setTimeout(done, 5));
    assert.equal(s.opening(), true, 'B is loading');
    const backToA = await s.open('A');
    assert.deepEqual(backToA, { id: 'A', created: false });
    releaseB();
    assert.equal(await toB, null, 'the superseded open publishes nothing');
    assert.equal(s.docId(), 'A', 'the canvas shows what the reader last asked for');
    assert.equal(s.opening(), false);
    await s.close();
  });

  // ---- B4 / B13: the store -----------------------------------------------------------------------

  test('B4: after remove, every write for that graph is refused and its run journal is gone', async () => {
    const repo = fakeRepo();
    const app = { repo, now: clock(), newId: ids('g') };
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    const doc = model.createDoc({ id: 'A', threadId: null, now: app.now });
    store.put(doc);
    await store.flush();
    await repo.kvSet(journalKey('A'), [{ id: 'run1', startedAt: 1, endedAt: 2 }]);
    assert.equal(await store.remove('A'), true);
    assert.equal(repo.rows.length, 0);
    assert.equal(await repo.kvGet(journalKey('A'), null), null, 'the journal (a Dialog’s questions) goes with it');
    store.put({ ...doc, rev: 9 });                    // a run still unwinding on the deleted graph
    await store.flush();
    assert.equal(repo.rows.length, 0, 'the deleted graph does not come back');
    assert.equal(store.isGone('A'), true);
  });

  test('B13: a duplicate has never run — its parts keep their answers, not their stats', async () => {
    const repo = fakeRepo();
    const app = { repo, now: clock(), newId: ids('g') };
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    const doc = { ...model.createDoc({ id: 'A', threadId: null, now: app.now }), parts: [{ id: 'p', type: 'note', x: 0, y: 0, w: 1, h: 1, settings: {}, value: { kind: 'text', data: 'v' }, stats: { ms: 1, calls: 1, tokens: 1 } }] };
    store.put(doc);
    await store.flush();
    const copyId = await store.duplicate('A', { title: 'copy' });
    const copy = repo.rows.find((r) => r.id === copyId);
    assert.equal(copy.parts[0].stats, null);
    assert.equal(copy.parts[0].value.data, 'v');
    assert.equal(lastRunAt(copy, []), 0, '"never run", not "last run just now"');
  });

  test('B13: the card’s "last run" is the journal’s newest run, not the last edit', () => {
    const doc = { parts: [{ id: 'a', stats: { calls: 1 } }], updatedAt: 9000 };
    assert.equal(lastRunAt(doc, [{ startedAt: 100, endedAt: 200 }, { startedAt: 300, endedAt: 450 }]), 450);
    assert.equal(lastRunAt(doc, [{ startedAt: 700, endedAt: null }]), 700, 'a live run counts from its start');
    assert.equal(lastRunAt(doc, []), 9000, 'no journal: the pre-K3 approximation stands');
    assert.equal(lastRunAt({ parts: [], updatedAt: 9000 }, []), 0);
    const now = Date.UTC(2026, 8, 24, 12);
    assert.match(cardMeta({ parts: [{ id: 'a' }], updatedAt: now }, now, [{ startedAt: now - 1000, endedAt: now }]), /^1 part · /);
  });

  // ---- B14: the migration ------------------------------------------------------------------------

  test('B14: a migrated graph the reader deleted is not carried over again while the migration retries', async () => {
    const rows = [
      { id: 'g1', threadId: 't1', title: '', parts: [], wires: [], rev: 1, createdAt: 1, updatedAt: 2 },
      { id: 'g2', threadId: 't2', title: '', parts: [], wires: [], rev: 1, createdAt: 1, updatedAt: 2 },
    ];
    const repo = fakeRepo({ rows });
    /** @type {any} */ (repo).getThread = async () => null;
    let failG2 = true;
    const put = repo.putGraph;
    repo.putGraph = async (doc) => {
      if (failG2 && doc.id === derivedId('g2')) throw new Error('QuotaExceededError');
      return put(doc);
    };
    const first = await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(first.errors, 1);
    assert.equal(await repo.kvGet(MIGRATED_KEY, null), null, 'a row still waits, so no done-marker');
    await repo.deleteGraph(derivedId('g1'));               // the reader deletes the migrated copy
    failG2 = false;
    const second = await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(second.imported, 1, 'g2 finally lands');
    assert.equal(repo.rows.some((r) => r.id === derivedId('g1')), false, 'g1 stays deleted');
    assert.deepEqual((await repo.kvGet(MIGRATED_SOURCES_KEY, [])).slice().sort(), ['g1', 'g2']);
  });

  // ---- B7: the Escape ladder ---------------------------------------------------------------------

  test('B7: the drawer is a cancel rung BEFORE the run — the first Escape closes it, the run goes on', async () => {
    await withDom(() => {
      const root = document.createElement('div');
      const drawer = document.createElement('div');
      root.appendChild(drawer);
      const registry = createRegistry();
      const app = /** @type {any} */ ({ els: { root, drawer }, repo: null, host: null, registry });
      let stopped = 0;
      registry.add(SLOTS.CANCEL_HANDLERS, { id: 'computer-run', order: 400, active: () => true, cancel: () => { stopped += 1; } });
      installDrawer(app);
      app.drawer.open(valueOf('text', 'being read'));
      /** The host's walk: the first ACTIVE handler, in order. */
      const walk = () => {
        for (const hnd of registry.list(SLOTS.CANCEL_HANDLERS)) {
          if (!hnd.active(app)) continue;
          hnd.cancel(app);
          return hnd.id;
        }
        return null;
      };
      assert.equal(walk(), 'computer-drawer', 'the open drawer is the first rung');
      assert.equal(app.drawer.isOpen(), false, 'and Escape closed it');
      assert.equal(stopped, 0, 'without stopping the run');
      assert.equal(walk(), 'computer-run', 'with nothing left to close, the next Escape stops the run');
      assert.equal(stopped, 1);
    });
  });
};
