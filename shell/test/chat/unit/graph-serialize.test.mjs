// graph/serialize.mjs (C1-U1): the .lolgraph.json format — export, import, validation.
//
// What these assertions protect:
//   - spec §5's privacy line: a graph file carries the PROGRAM, never the machine. No thread id,
//     no farm address, no run stats, no client id — asserted on the exported keys themselves, so a
//     field added to GraphDoc later cannot ride along;
//   - fresh ids on import: dropping the same file on one canvas twice must produce two graphs, not
//     a collision that silently rewires the first;
//   - a malformed or hostile file is REFUSED by name, never thrown at the drop handler, and a file
//     from a later phase (unknown part types, a hand-added cycle) imports as much as is runnable
//     and reports the rest;
//   - the round trip: export → import → the same program.
import assert from 'node:assert/strict';
import {
  FORMAT, FORMAT_VERSION, FILE_SUFFIX, isGraphFile, toJson, toText, fromJson, fromText,
  MAX_IMPORT_BYTES, MAX_VALUE_BYTES,
} from '../../../renderer/chat/graph/serialize.mjs';
import { createDoc, addPart, addWire, patchPart, inputsOf } from '../../../renderer/chat/graph/model.mjs';
import { runSet } from '../../../renderer/chat/graph/topo.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { specs, ids, clock } from './graph-fixture.mjs';

const map = specs();

/** note → ask → collect, the C1 shape, with one part already run. */
function sample() {
  const now = clock(100);
  const newId = ids('p');
  const o = { specs: map, newId, now };
  let doc = createDoc({ id: 'g1', threadId: 't1', title: 'Names', now });
  const note = addPart(doc, { type: 'note', x: 10, y: 20, settings: { text: 'five names' } }, o);
  doc = note.doc;
  const ask = addPart(doc, { type: 'ask', x: 260, y: 20, settings: { prompt: 'go', shape: 'text' } }, o);
  doc = ask.doc;
  doc = addWire(doc, { from: note.part.id, to: ask.part.id, port: 'in' }, o).doc;
  doc = patchPart(doc, ask.part.id, {
    state: 'done', value: valueOf('text', 'Ada'), stats: { ms: 900, tokens: 42 },
  });
  return { doc, noteId: note.part.id, askId: ask.part.id };
}

const importOpts = (prefix = 'i') => ({ specs: map, newId: ids(prefix), now: clock(500) });

export default (test) => {
  test('the format constants are the frozen ones', () => {
    assert.equal(FORMAT, 'lolgraph');
    // K2 kickoff (COMPUTER_PLAN §11 item 5): v2 carries `wire.label` and a value's advisory
    // format/lang facets. A v1 file still opens; a v3 file is still REFUSED whole.
    assert.equal(FORMAT_VERSION, 2);
    assert.equal(FILE_SUFFIX, '.lolgraph.json');
  });

  test('toJson exports the PROGRAM and nothing about the machine that ran it', () => {
    const { doc } = sample();
    const file = toJson(doc);
    assert.deepEqual(Object.keys(file).sort(), ['lolgraph', 'parts', 'settings', 'title', 'view', 'wires']);
    assert.equal(file.lolgraph, FORMAT_VERSION);
    assert.equal(file.title, 'Names');
    const text = JSON.stringify(file);
    for (const forbidden of ['threadId', 't1', 'stats', 'tokens', 'createdAt', 'rev', 'error']) {
      assert.ok(!text.includes(forbidden), `a graph file must not carry ${forbidden}`);
    }
    assert.deepEqual(Object.keys(file.parts[0]).sort(), ['h', 'id', 'settings', 'type', 'w', 'x', 'y']);
    assert.deepEqual(file.wires[0], { from: 'p1', to: 'p2', port: 'in' });
    assert.ok(isGraphFile(file));
    assert.ok(!isGraphFile({ parts: [] }));
    assert.ok(!isGraphFile(null));
  });

  test('an imported part carries no RUN of anyone else: state, error, stats and the item record', () => {
    // `fromJson` scrubbed three of the four runtime fields and left `fanout` in the spread (fix
    // pass, finding 6). It was inert only because the reload path dropped it — two defects
    // cancelling, and fixing the reload made this one live: a hand-edited file could hand a fresh
    // canvas an arbitrarily large per-item record for a run that never happened here.
    const res = fromJson({
      [FORMAT]: FORMAT_VERSION,
      parts: [{
        id: 'a', type: 'note', x: 0, y: 0, settings: { text: 'hi' },
        value: { kind: 'text', data: 'hi' },
        state: 'done', error: 'boom', stats: { ms: 9, tokens: 9, calls: 9 },
        fanout: { n: 9000, done: 9000, ok: 1, failed: 8999, errors: [{ i: 0, message: 'x' }] },
      }],
      wires: [],
    }, { specs: map, newId: ids('n'), now: clock(), values: true });
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    const part = res.doc.parts[0];
    assert.equal(part.state, 'stale', 'a cached value is not proof this machine ran the graph');
    assert.equal(part.error, null);
    assert.equal(part.stats, null);
    assert.equal(part.fanout, null, 'and no item record travels with a program');
  });

  test('cached values are opt-in (spec §5), and never carry the state that produced them', () => {
    const { doc } = sample();
    assert.equal(toJson(doc).parts[1].value, undefined);
    const withValues = toJson(doc, { values: true });
    assert.deepEqual(withValues.parts[1].value, { kind: 'text', data: 'Ada' });
    assert.equal(withValues.parts[1].state, undefined);
    assert.equal(withValues.parts[0].value, undefined, 'a part that never ran has nothing to carry');
  });

  test('round trip: export → import → the same program, with NEW ids', () => {
    const { doc, noteId, askId } = sample();
    const res = fromJson(toJson(doc), { ...importOpts(), id: 'g2', threadId: 't2' });
    assert.equal(res.ok, true);
    assert.deepEqual(res.errors, []);
    const back = res.doc;
    assert.equal(back.id, 'g2');
    assert.equal(back.threadId, 't2');
    assert.equal(back.title, 'Names');
    assert.deepEqual(back.parts.map((p) => p.type), ['note', 'ask']);
    assert.deepEqual(back.parts.map((p) => [p.x, p.y, p.w, p.h]), [[10, 20, 200, 100], [260, 20, 220, 120]]);
    assert.deepEqual(back.parts.map((p) => p.settings), [{ text: 'five names' }, { prompt: 'go', shape: 'text' }]);
    assert.ok(!back.parts.some((p) => p.id === noteId || p.id === askId), 'every id is fresh');
    assert.deepEqual(inputsOf(back, back.parts[1].id), { in: [back.parts[0].id] }, 'the wiring survives');
    assert.deepEqual(back.parts.map((p) => p.state), ['idle', 'idle'], 'an imported graph has not run');
    assert.deepEqual(runSet(back), back.parts.map((p) => p.id));
    assert.deepEqual(back.view, doc.view);
  });

  test('importing the same file twice mints different ids — two graphs, not a collision', () => {
    const { doc } = sample();
    const file = toJson(doc);
    const a = fromJson(file, importOpts('a')).doc;
    const b = fromJson(file, importOpts('b')).doc;
    assert.equal(a.parts.length, 2);
    const shared = a.parts.map((p) => p.id).filter((id) => b.parts.some((p) => p.id === id));
    assert.deepEqual(shared, []);
    assert.deepEqual(a.parts.map((p) => p.type), b.parts.map((p) => p.type));
  });

  test('an exported value comes back STALE: it is cached, not proof this machine ran the graph', () => {
    const { doc } = sample();
    const back = fromJson(toJson(doc, { values: true }), importOpts()).doc;
    assert.deepEqual(back.parts.map((p) => p.state), ['idle', 'stale']);
    assert.deepEqual(back.parts[1].value, { kind: 'text', data: 'Ada' });
    assert.equal(back.parts[1].stats, null, 'somebody else\'s timing is not ours');
    const stripped = fromJson(toJson(doc, { values: true }), { ...importOpts(), values: false }).doc;
    assert.equal(stripped.parts[1].value, null, 'values:false drops them on the way in too');
  });

  test('toText is the file on disk, and fromText reads it back', () => {
    const { doc } = sample();
    const text = toText(doc);
    assert.ok(text.endsWith('\n'));
    assert.equal(JSON.parse(text).lolgraph, FORMAT_VERSION);
    assert.equal(fromText(text, importOpts()).doc.parts.length, 2);
    assert.deepEqual(fromText('{ not json', importOpts()), { ok: false, doc: null, errors: ['not-json'] });
  });

  test('a file that is not a graph is refused by name, never thrown', () => {
    const o = importOpts();
    assert.deepEqual(fromJson(null, o).errors, ['not-an-object']);
    assert.deepEqual(fromJson('lolgraph', o).errors, ['not-an-object']);
    assert.deepEqual(fromJson([{ lolgraph: 1 }], o).errors, ['not-an-object']);
    assert.deepEqual(fromJson({ parts: [], wires: [] }, o).errors, ['not-a-graph']);
    assert.deepEqual(fromJson({ lolgraph: 'yes' }, o).errors, ['not-a-graph']);
    assert.deepEqual(fromJson({ lolgraph: FORMAT_VERSION + 1 }, o).errors, ['unsupported-version'],
      'a file from a later format is refused, not half-read');
    assert.equal(fromJson({ lolgraph: 1, parts: [], wires: [] }, o).ok, true,
      'a v1 file still opens: every v1 field means in v2 exactly what it meant in v1');
    for (const bad of [null, 'x', [{ lolgraph: 1 }], { parts: [] }, { lolgraph: FORMAT_VERSION + 1 }]) {
      assert.equal(fromJson(bad, o).doc, null);
      assert.equal(fromJson(bad, o).ok, false);
    }
  });

  test('a file with parts C1 does not have imports what it can and reports the rest', () => {
    const res = fromJson({
      lolgraph: 1,
      parts: [
        { id: 'x1', type: 'note', x: 0, y: 0, settings: { text: 'keep' } },
        { id: 'x2', type: 'repeat', x: 0, y: 0 },           // a C2 part
        { id: 'x3', type: 'ask', x: 0, y: 0 },
      ],
      wires: [
        { from: 'x1', to: 'x3', port: 'in' },
        { from: 'x1', to: 'x2', port: 'in' },               // into the part C1 dropped
        { from: 'x3', to: 'x1', port: 'in' },               // a hand-added cycle
        { from: 'ghost', to: 'x3', port: 'in' },
      ],
    }, importOpts());
    assert.equal(res.ok, true);
    assert.deepEqual(res.doc.parts.map((p) => p.type), ['note', 'ask']);
    assert.equal(res.doc.parts[0].settings.text, 'keep');
    assert.equal(res.doc.wires.length, 1);
    // the file's own errors first (a wire from an id the file never declared), then everything
    // normaliseDoc dropped: the C2 part, the wire that fed it, and the cycle — which lands as
    // 'unknown-port' because a Note has no input at all to close a loop through.
    assert.deepEqual(res.errors,
      ['wire:unknown-part', 'part:unknown-type', 'wire:unknown-part', 'wire:unknown-port']);
    assert.equal(runSet(res.doc).length, 2, 'what imports is runnable');
  });

  test('an empty file is an empty canvas, not a failure', () => {
    const res = fromJson({ lolgraph: 1 }, importOpts());
    assert.equal(res.ok, true);
    assert.deepEqual(res.doc.parts, []);
    assert.deepEqual(res.doc.wires, []);
    assert.deepEqual(res.doc.view, { x: 0, y: 0, zoom: 1 });
    assert.equal(res.doc.threadId, null);
  });

  test('toJson survives a doc that is not one', () => {
    assert.deepEqual(toJson(null), { lolgraph: FORMAT_VERSION, title: '', settings: {}, parts: [], wires: [] });
  });

  // ---- the fix pass: a graph file comes from someone ELSE'S machine, by design -----------------

  test('the file is too big to open: refused at the door, not adopted and then regretted', () => {
    const fat = `{"lolgraph":1,"parts":[],"wires":[],"pad":"${'x'.repeat(MAX_IMPORT_BYTES)}"}`;
    const res = fromText(fat, importOpts());
    assert.equal(res.ok, false);
    assert.deepEqual(res.errors, ['too-big'], 'and it says which refusal it is');
    assert.equal(res.doc, null);
    // and the limit is a limit, not a shape: a well-formed small file still opens
    assert.equal(fromText('{"lolgraph":1}', importOpts()).ok, true);
  });

  test('one cached picture cannot be bigger than one this machine would have made', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(MAX_VALUE_BYTES + 10);
    const file = {
      lolgraph: 1,
      parts: [
        { id: 'a', type: 'note', x: 0, y: 0, settings: { text: 'hi' }, value: { kind: 'image', data: { dataUrl: big } } },
        { id: 'b', type: 'note', x: 0, y: 0, settings: { text: 'ok' }, value: { kind: 'text', data: 'small' } },
      ],
      wires: [],
    };
    const res = fromJson(file, importOpts());
    assert.equal(res.ok, true);
    assert.ok(res.errors.indexOf('part:value-too-big') >= 0, 'and the reader is told');
    assert.equal(res.doc.parts[0].value, null, 'the oversize picture did not come in');
    assert.equal(res.doc.parts[0].state, 'idle', 'so the part is ready to be re-run');
    assert.deepEqual(res.doc.parts[1].value, { kind: 'text', data: 'small' }, 'a normal value is untouched');
    assert.equal(res.doc.parts[1].state, 'stale');
  });

  test('export copies settings key by key from the SPEC, so a later phase cannot widen the file', () => {
    const now = clock(100);
    const newId = ids('q');
    const o = { specs: map, newId, now };
    let doc = createDoc({ id: 'g2', threadId: 't9', title: 'T', now });
    const added = addPart(doc, { type: 'note', x: 0, y: 0, settings: { text: 'hi' } }, o);
    doc = added.doc;
    // a field no spec declares — a private id, a path, a farm name — put on the part by hand,
    // exactly the way a later phase would add one
    doc = {
      ...doc,
      parts: doc.parts.map((/** @type {any} */ q) => (q.id === added.part.id
        ? { ...q, settings: { text: 'hi', messageId: 'm-from-my-history', secret: 'x' } }
        : q)),
    };
    doc = { ...doc, settings: { ...doc.settings, lastFarm: 'http://10.10.16.9:4000' } };

    const spread = toJson(doc);
    assert.equal(spread.parts[0].settings.secret, 'x', 'without a spec table the whole bag travels');

    const file = toJson(doc, { specs: map });
    assert.deepEqual(file.parts[0].settings, { text: 'hi' }, 'only what the spec declares');
    assert.deepEqual(file.settings, {}, 'and no doc-level bag rides along');
    const text = JSON.stringify(file);
    for (const forbidden of ['secret', 'messageId', '10.10.16.9']) {
      assert.ok(!text.includes(forbidden), `a graph file must not carry ${forbidden}`);
    }
  });

  test("from-thread's messageId names a message on the SENDER's machine and never travels", () => {
    const withFromThread = specs({
      'from-thread': {
        type: 'from-thread', label: 'From thread', inputs: [], output: 'text',
        defaults: () => ({ source: 'lastAnswer', messageId: '' }),
      },
    });
    const now = clock(100);
    const o = { specs: withFromThread, newId: ids('f'), now };
    let doc = createDoc({ id: 'g3', threadId: 't1', title: '', now });
    const added = addPart(doc, {
      type: 'from-thread', x: 0, y: 0, settings: { source: 'message', messageId: 'm-42' },
    }, o);
    doc = added.doc;
    const file = toJson(doc, { specs: withFromThread });
    assert.deepEqual(file.parts[0].settings, { source: 'message' });
    assert.ok(!JSON.stringify(file).includes('m-42'));
  });
};
