// @ts-check
// Owner, 2026-09-28 (NIGHT_LOG 21:30): ONE d3-force viewer for node-link JSON — graphify's
// graph.json, or any {nodes, links|edges} — shared by the Computer's Graph preset and the IDE.
// What is pinned here, in Node: how a graph is READ (both shapes, the cap, the line a broken JSON
// names), that the guest program names d3 (so the sandbox loads the vendored one), and that the
// drawing function closes over nothing (its source text is what the guest runs). The real drawing,
// with the real d3 in the real guest, is test/chat-harness/scenarios/k25-graph-preview.mjs.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  readNodeLink, graphProgram, drawNodeLink, jsonErrorLine, MAX_NODES, MAX_LINKS,
} from '../../../renderer/chat/sandbox/graph-view.mjs';
import { libsFor } from '../../../renderer/chat/sandbox/host.mjs';
import { STARTER, saveFormats } from '../../../renderer/chat/graph/parts/creative.mjs';
import { graphCode, modeFor } from '../../../renderer/chat/graph/parts/preview.mjs';

/** A d3 that answers every chain (`d3.select(el).append('svg').attr(…)…`) and records nothing: it
 * lets the drawing's top level run with no DOM, so a name it does not own would throw. */
function chainD3() {
  /** @type {any} */ let chain;
  chain = new Proxy(function stub() {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : chain), apply: () => chain });
  return chain;
}

/** Run a guest program the way the guest does, in a context holding only `lol` and `d3`. */
function runGuest(/** @type {string} */ program, /** @type {any} */ d3) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const root = doc.createElement('div');
  vm.runInNewContext(`"use strict";\n${program}`, { lol: { root, size: { w: 320, h: 240 } }, d3 });
  return root;
}

export default (/** @type {any} */ test) => {
  test('graph view: graphify\'s graph.json reads as nodes, links, communities and confidence', () => {
    const g = readNodeLink(STARTER.graph);
    assert.equal(g.tooMany, false);
    assert.equal(g.nodes.length, 6);
    assert.equal(g.links.length, 6);
    assert.equal(g.dropped, 0);
    assert.deepEqual(g.total, { nodes: 6, links: 6 });
    assert.deepEqual(g.nodes[0], { id: 'preview', label: 'Preview box', community: 0, community_name: 'The Computer' });
    assert.deepEqual(g.links.find((l) => l.relation === 'shares_data_with'), { source: 'graph_json', target: 'graph_view', relation: 'shares_data_with', confidence: 'INFERRED' });
    // The object reads the same as its text.
    assert.deepEqual(readNodeLink(JSON.parse(STARTER.graph)), g);
  });

  test('graph view: {nodes, edges}, bare ids, index ends, d3-mutated ends; a link to nowhere is dropped', () => {
    const g = readNodeLink({
      nodes: ['a', { name: 'b', group: 'x' }, { id: 3, label: null }, { id: 'a' }],
      edges: [
        { source: 0, target: 1 },
        { source: { id: 'b' }, target: 3, type: 'uses', confidence: 'ambiguous' },
        { source: 'a', target: 'nowhere' },
      ],
    });
    assert.deepEqual(g.nodes.map((n) => [n.id, n.label, n.community]), [['a', 'a', null], ['b', 'b', 'x'], ['3', '3', null]], 'the duplicate a is kept once');
    assert.deepEqual(g.links, [
      { source: 'a', target: 'b', relation: '', confidence: '' },
      { source: 'b', target: '3', relation: 'uses', confidence: 'AMBIGUOUS' },
    ]);
    assert.equal(g.dropped, 1);
    assert.equal(readNodeLink({ nodes: [{ id: 'solo' }] }).links.length, 0, 'a graph with no links is still a graph');
  });

  test('graph view: past the cap it is a sentence, not a layout', () => {
    const many = { nodes: Array.from({ length: MAX_NODES + 1 }, (_, i) => ({ id: `n${i}` })), links: [] };
    const g = readNodeLink(many);
    assert.equal(g.tooMany, true);
    assert.deepEqual([g.nodes.length, g.links.length], [0, 0], 'nothing big travels to the guest');
    assert.deepEqual(g.total, { nodes: MAX_NODES + 1, links: 0 });
    const dense = { nodes: [{ id: 'a' }], links: Array.from({ length: MAX_LINKS + 1 }, () => ({ source: 'a', target: 'a' })) };
    assert.equal(readNodeLink(dense).tooMany, true);
    assert.equal(readNodeLink({ nodes: many.nodes.slice(0, MAX_NODES) }).tooMany, false, 'exactly the cap still draws');
  });

  test('graph view: a broken JSON names its line; JSON that is not a graph says so', () => {
    const text = '{\n  "nodes": [\n    {"id": "a"}\n    {"id": "b"}\n  ]\n}';
    assert.throws(() => readNodeLink(text), (/** @type {any} */ e) => e.code === 'not-json' && e.line === 4 && !/position/.test(e.message));
    assert.equal(jsonErrorLine('a\nb\nc', { message: 'Unexpected token in JSON at position 4' }), 3, 'an engine that says only the position');
    assert.throws(() => readNodeLink('[1, 2]'), (/** @type {any} */ e) => e.code === 'no-nodes' && e.line === 0);
    assert.throws(() => readNodeLink({ links: [] }), (/** @type {any} */ e) => e.code === 'no-nodes');
  });

  test('graph view: the guest program names d3 (the host loads the vendored one) and parses', () => {
    const program = graphProgram(readNodeLink(STARTER.graph), { tooMany: 'too many', empty: 'empty' });
    assert.deepEqual(libsFor('dom', program), ['d3']);
    assert.doesNotThrow(() => new vm.Script(`(function (lol, d3) { "use strict";\n${program}\n})`));
  });

  test('graph view: the drawing closes over nothing — it runs from its own source text, with only lol and d3', () => {
    assert.doesNotThrow(() => runGuest(graphProgram(readNodeLink(STARTER.graph), {}), chainD3()));
    const root = runGuest(graphProgram(readNodeLink({ nodes: Array.from({ length: MAX_NODES + 5 }, (_, i) => i) }), { tooMany: 'Too many nodes to draw.' }), chainD3());
    const p = root.querySelector('p');
    assert.equal(p.getAttribute('data-graph'), 'too-many');
    assert.equal(p.textContent, 'Too many nodes to draw.');
    const empty = runGuest(graphProgram(readNodeLink({ nodes: [] }), { empty: 'No nodes.' }), chainD3());
    assert.equal(empty.querySelector('p').getAttribute('data-graph'), 'empty');
    assert.equal(typeof drawNodeLink, 'function');
  });

  test('graph view: the Preview reads a graph only when told to, saves .json + .png, and names the JSON\'s line', () => {
    assert.equal(modeFor('auto', /** @type {any} */ ({ kind: 'json', data: JSON.parse(STARTER.graph) })), 'markdown', 'auto never guesses a graph');
    assert.equal(modeFor('graph', null), 'graph');
    assert.deepEqual(saveFormats('graph'), ['json', 'png']);
    assert.match(graphCode(STARTER.graph), /\bd3\s*\./);
    assert.throws(() => graphCode('{\n"nodes": [}\n'), (/** @type {any} */ e) => e.line === 2 && /line 2/.test(e.message));
  });
};
