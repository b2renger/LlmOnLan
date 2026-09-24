// The pure half of the canvas (C1-U2): view maths, marquee hits, the clipboard payload and the
// wire geometry. These are the parts that are easy to get subtly wrong and impossible to SEE —
// a fit that is one zoom step off still looks like a canvas, and a port whose model point and DOM
// point disagree by four pixels still looks wired.
//
// Everything imported here is dependency-free at module scope (the DOM is only touched inside
// createCanvas/createWireLayer, which these tests never call), so it runs in plain Node.

import assert from 'node:assert/strict';
import {
  GRID, MIN_ZOOM, MAX_ZOOM, CLIP_FORMAT,
  snap, clampZoom, screenToWorld, worldToScreen, zoomAbout,
  bounds, fitView, normaliseRect, marqueeHits, toClipboard, fromClipboard, acceptSeed,
} from '../../../renderer/chat/graph/canvas.mjs';
import { HEAD_H, portOffsetY, portPoint, wirePath, wireDistance, wireEnds } from '../../../renderer/chat/graph/wires.mjs';

const part = (o) => ({ id: o.id, type: o.type || 'note', x: o.x, y: o.y, w: o.w || 220, h: o.h || 120, settings: o.settings || {} });

export default (test) => {
  test('the stored cap seeds the field only while the reader has not touched it', () => {
    assert.equal(acceptSeed(200, {}), true, 'the ordinary case: the field still shows the default');
    assert.equal(acceptSeed(200, { edited: true }), false,
      'the reader typed a cap and it is already stored: repainting the OLD one would make the '
      + 'field and the store disagree, with the run using the store');
    assert.equal(acceptSeed(200, { focused: true }), false, 'and typing right now is not interrupted');
    assert.equal(acceptSeed(200, { destroyed: true }), false, 'a closed panel paints nothing');
    assert.equal(acceptSeed(0, {}), false, 'a missing or nonsense preference leaves the default alone');
    assert.equal(acceptSeed(Number.NaN, {}), false);
  });

  // ---- view maths ------------------------------------------------------------------------

  test('snap puts a part on the grid, in both directions', () => {
    assert.equal(snap(0), 0);
    assert.equal(snap(4), 0);
    assert.equal(snap(6), GRID);
    assert.equal(snap(-6), -GRID);
    assert.equal(snap(123), 120);
  });

  test('clampZoom never leaves the legible range', () => {
    assert.equal(clampZoom(1), 1);
    assert.equal(clampZoom(0.01), MIN_ZOOM);
    assert.equal(clampZoom(99), MAX_ZOOM);
    assert.equal(clampZoom(Number.NaN), 1, 'a NaN zoom would blank the canvas');
  });

  test('screenToWorld and worldToScreen are inverses at any view', () => {
    const view = { x: -140, y: 37, zoom: 0.8 };
    const w = screenToWorld(view, 400, 300);
    const s = worldToScreen(view, w.x, w.y);
    assert.ok(Math.abs(s.x - 400) < 1e-9 && Math.abs(s.y - 300) < 1e-9, `round trip drifted: ${JSON.stringify(s)}`);
  });

  test('zoomAbout keeps the point under the cursor exactly where it was', () => {
    const view = { x: 0, y: 0, zoom: 1 };
    const before = screenToWorld(view, 300, 200);
    const next = zoomAbout(view, 300, 200, 1.5);
    const after = screenToWorld(next, 300, 200);
    assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9,
      `the cursor point moved: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    assert.equal(next.zoom, 1.5);
  });

  test('zoomAbout clamps, and a clamped zoom still holds the anchor', () => {
    const view = { x: 10, y: 10, zoom: MAX_ZOOM };
    const next = zoomAbout(view, 100, 100, 4);
    assert.equal(next.zoom, MAX_ZOOM);
    assert.deepEqual(next, { x: 10, y: 10, zoom: MAX_ZOOM }, 'a no-op zoom must not pan');
  });

  // ---- fit -------------------------------------------------------------------------------

  test('bounds spans every part, including its size', () => {
    const b = bounds([part({ id: 'a', x: 0, y: 0 }), part({ id: 'b', x: 300, y: 100 })]);
    assert.deepEqual(b, { x: 0, y: 0, w: 520, h: 220 });
    assert.equal(bounds([]), null);
  });

  test('fit centres the graph and never zooms IN past 1', () => {
    const parts = [part({ id: 'a', x: 0, y: 0 })];
    const v = fitView(parts, { w: 1200, h: 900 });
    assert.equal(v.zoom, 1, 'one small part must not be blown up to fill the panel');
    // the part's centre lands in the middle of the viewport
    const c = worldToScreen(v, 110, 60);
    assert.ok(Math.abs(c.x - 600) < 1e-9 && Math.abs(c.y - 450) < 1e-9, `not centred: ${JSON.stringify(c)}`);
  });

  test('fit zooms OUT to hold a wide graph, with padding', () => {
    const parts = [part({ id: 'a', x: 0, y: 0 }), part({ id: 'b', x: 2000, y: 0 })];
    const v = fitView(parts, { w: 800, h: 600 });
    assert.ok(v.zoom < 1 && v.zoom > MIN_ZOOM, `zoom ${v.zoom}`);
    const left = worldToScreen(v, 0, 0);
    const right = worldToScreen(v, 2220, 0);
    assert.ok(left.x >= 0 && right.x <= 800, `the graph must fit on screen: ${left.x} … ${right.x}`);
  });

  test('a graph too big for the zoom floor clamps instead of becoming illegible', () => {
    const parts = [part({ id: 'a', x: 0, y: 0 }), part({ id: 'b', x: 40000, y: 0 })];
    const v = fitView(parts, { w: 800, h: 600 });
    assert.equal(v.zoom, MIN_ZOOM, 'fit must stop at the floor and let the reader pan');
  });

  test('fit on an empty canvas is the identity view', () => {
    assert.deepEqual(fitView([], { w: 800, h: 600 }), { x: 0, y: 0, zoom: 1 });
  });

  // ---- selection -------------------------------------------------------------------------

  test('normaliseRect turns any two corners into a positive rectangle', () => {
    assert.deepEqual(normaliseRect({ x: 100, y: 80 }, { x: 20, y: 10 }), { x: 20, y: 10, w: 80, h: 70 });
  });

  test('the marquee takes every part it OVERLAPS, not only the ones it contains', () => {
    const parts = [
      part({ id: 'a', x: 0, y: 0 }),        // 0..220 x 0..120
      part({ id: 'b', x: 400, y: 0 }),      // far right
      part({ id: 'c', x: 200, y: 100 }),    // clipped by one corner
    ];
    assert.deepEqual(marqueeHits(parts, { x: -10, y: -10, w: 60, h: 60 }), ['a']);
    assert.deepEqual(marqueeHits(parts, { x: 210, y: 110, w: 5, h: 5 }), ['a', 'c'], 'a corner overlap counts');
    assert.deepEqual(marqueeHits(parts, { x: 0, y: 0, w: 1000, h: 1000 }), ['a', 'b', 'c']);
    assert.deepEqual(marqueeHits(parts, { x: 900, y: 900, w: 10, h: 10 }), []);
  });

  test('a marquee that only TOUCHES an edge selects nothing (no accidental grabs)', () => {
    const parts = [part({ id: 'a', x: 0, y: 0 })];
    assert.deepEqual(marqueeHits(parts, { x: 220, y: 0, w: 50, h: 50 }), []);
  });

  // ---- clipboard -------------------------------------------------------------------------

  const doc = {
    parts: [
      part({ id: 'p1', type: 'note', x: 0, y: 0, settings: { text: 'hello' } }),
      part({ id: 'p2', type: 'note', x: 300, y: 0, settings: { text: 'there' } }),
      part({ id: 'p3', type: 'note', x: 600, y: 0 }),
    ],
    wires: [
      { id: 'w1', from: 'p1', to: 'p2', port: 'in' },
      { id: 'w2', from: 'p2', to: 'p3', port: 'in' },
    ],
  };

  test('copy carries types, positions, SIZES and settings — never runtime values or ids', () => {
    const clip = toClipboard(doc, ['p1', 'p2']);
    assert.equal(clip[CLIP_FORMAT], 1);
    assert.equal(clip.parts.length, 2);
    // Critic R1, A3: the size travels, so a pasted 380×520 sketch does not come back 320×260.
    assert.deepEqual(clip.parts[0], { i: 0, type: 'note', x: 0, y: 0, w: 220, h: 120, settings: { text: 'hello' } });
    const json = JSON.stringify(clip);
    assert.ok(!json.includes('"p1"'), 'a document id must never travel on the clipboard');
  });

  test('copy keeps only the wires whose BOTH ends were selected', () => {
    const clip = toClipboard(doc, ['p1', 'p2']);
    assert.deepEqual(clip.wires, [{ from: 0, to: 1, port: 'in' }], 'p2→p3 leaves the selection and must be dropped');
  });

  test('copy → paste payload round-trips through JSON', () => {
    const back = fromClipboard(JSON.stringify(toClipboard(doc, ['p1', 'p2', 'p3'])));
    assert.equal(back.parts.length, 3);
    assert.equal(back.wires.length, 2);
    assert.equal(back.parts[1].settings.text, 'there');
  });

  test('anything that is not our format is null, never a throw', () => {
    assert.equal(fromClipboard('hello there'), null);
    assert.equal(fromClipboard(''), null);
    assert.equal(fromClipboard(null), null);
    assert.equal(fromClipboard('{"lolgraph":2,"parts":[]}'), null, 'a future format version is not ours to guess at');
    assert.equal(fromClipboard('{"parts":[{"type":"note","x":0,"y":0}]}'), null, 'no tag, no paste');
    assert.equal(fromClipboard(JSON.stringify({ [CLIP_FORMAT]: 1, parts: [] })), null, 'an empty selection is nothing to paste');
  });

  test('a malformed part in the payload is dropped without losing the rest', () => {
    const back = fromClipboard(JSON.stringify({
      [CLIP_FORMAT]: 1,
      parts: [{ i: 0, type: 'note', x: 0, y: 0 }, { i: 1, x: 'nope', y: 0 }, { i: 2, type: 'note', x: 10, y: 10 }],
      wires: [{ from: 0, to: 2, port: 'in' }, { from: 0, to: 9, port: 'in' }],
    }));
    assert.equal(back.parts.length, 2);
    assert.deepEqual(back.wires, [{ from: 0, to: 2, port: 'in' }], 'a wire to a dropped part goes with it');
  });

  // ---- wire geometry ---------------------------------------------------------------------

  test('inputs are spread down the body, below the head, and never overlap', () => {
    const ys = [0, 1, 2].map((i) => portOffsetY(120, i, 3));
    assert.ok(ys[0] > HEAD_H, `the first port must clear the head: ${ys[0]} vs ${HEAD_H}`);
    assert.ok(ys[2] < 120, 'the last port must stay inside the box');
    assert.ok(ys[0] < ys[1] && ys[1] < ys[2], `ports must be ordered: ${ys.join(',')}`);
  });

  test('a single input sits in the middle of the body', () => {
    assert.equal(portOffsetY(120, 0, 1), HEAD_H + (120 - HEAD_H) / 2);
  });

  test('the output port is on the right edge, the input on the left', () => {
    const p = part({ id: 'a', x: 100, y: 50 });
    assert.deepEqual(portPoint(p, { dir: 'out' }), { x: 320, y: 110 });
    assert.equal(portPoint(p, { dir: 'in', index: 0, count: 1 }).x, 100);
  });

  test('wireEnds reads the port INDEX off the target spec, so a second input is not the first', () => {
    const specs = new Map([
      ['note', { type: 'note', output: 'text', inputs: [] }],
      ['ask', { type: 'ask', output: 'text', inputs: [{ name: 'prompt' }, { name: 'context' }] }],
    ]);
    const d = {
      parts: [part({ id: 'a', type: 'note', x: 0, y: 0 }), part({ id: 'b', type: 'ask', x: 400, y: 0 })],
      wires: [{ id: 'w', from: 'a', to: 'b', port: 'context' }],
    };
    const ends = wireEnds(d, d.wires[0], specs);
    assert.equal(ends.b.x, 400);
    assert.equal(ends.b.y, portOffsetY(120, 1, 2), 'the wire must land on the SECOND port');
    assert.equal(wireEnds(d, { from: 'a', to: 'gone', port: 'x' }, specs), null);
  });

  test('the drawn path and the hit test agree: a point ON the curve is distance ~0', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 200 };
    const d = wirePath(a, b);
    assert.ok(d.startsWith('M 0 0 C '), `unexpected path: ${d}`);
    assert.ok(wireDistance(a, b, a) < 1e-6, 'the start point is on the wire');
    assert.ok(wireDistance(a, b, b) < 1e-6, 'the end point is on the wire');
    // the midpoint of a symmetric cubic is the midpoint of its endpoints
    assert.ok(wireDistance(a, b, { x: 200, y: 100 }) < 1, 'the middle of the curve is between the ends');
    assert.ok(wireDistance(a, b, { x: 200, y: 400 }) > 100, 'a point far off the curve is far off');
  });
};
