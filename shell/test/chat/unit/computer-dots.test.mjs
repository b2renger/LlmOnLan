// @ts-check
// COMPUTER_DOTS_PLAN (the owner's J21, 2026-11-27): Filter's and Code's rows, rendered on the unit runner's DOM shim.
// Classify's are in classify-part.test.mjs. Written after night n° 19's Code change read a `const` before it was
// declared: the harness caught it (k19-dots), no unit test rendered Code's new rows.
import assert from 'node:assert/strict';
import { filter } from '../../../renderer/chat/graph/parts/filter.mjs';
import { code } from '../../../renderer/chat/graph/parts/code.mjs';

/** Run `fn` with the unit runner's DOM shim as `globalThis.document`. */
async function withDom(/** @type {() => any} */ fn) {
  const G = /** @type {any} */ (globalThis);
  const had = Object.prototype.hasOwnProperty.call(G, 'document');
  const prev = G.document;
  G.document = G.__chatTestDom.createDocument();
  try { return await fn(); } finally { if (had) G.document = prev; else delete G.document; }
}

/** A PartCtx with the canvas's `wiredFrom`, answering from `wired`. */
const ctxFor = (/** @type {any} */ part, /** @type {Record<string, string[]>} */ wired) => ({
  app: {}, part, update() {}, commit() {}, wiredFrom: (/** @type {string} */ port) => wired[port] || [],
});

export default (/** @type {any} */ test) => {
  test('COMPUTER_DOTS filter: an Items row first, the criterion field named by its dot; a wired criterion is read-only and names its source', async () => {
    assert.deepEqual(filter.inputs.map((/** @type {any} */ p) => [p.name, p.row]),
      [['items', '.graph-filter-items'], ['criterion', '.graph-filter-criterion']]);
    await withDom(async () => {
      const part = { id: 'f1', type: 'filter', settings: { mode: 'contains', text: 'cats', min: 0, max: 0, invert: false, model: '' } };
      const host = document.createElement('div');
      filter.render(host, part, /** @type {any} */ (ctxFor(part, {})));
      const items = host.querySelector('.graph-filter-items');
      const field = host.querySelector('.graph-filter-criterion input');
      assert.ok(items && field, 'both rows are drawn');
      assert.equal(host.children[0].querySelector('.graph-filter-items'), items, 'the Items row is the first');
      assert.match(items.textContent, /Wire a list here/);
      assert.equal(field.value, 'cats');
      // The same box with a list on Items and a Text box on Criterion.
      const wiredHost = document.createElement('div');
      filter.render(wiredHost, part, /** @type {any} */ (ctxFor(part, { items: ['Split'], criterion: ['Text'] })));
      assert.match(wiredHost.querySelector('.graph-filter-items').textContent, /From the wire: “Split”/);
      const wiredField = wiredHost.querySelector('.graph-filter-criterion input');
      assert.equal(wiredField.readOnly, true, 'a wired criterion cannot be typed into');
      assert.match(wiredField.placeholder, /From the wire: “Text”/);
      assert.equal(part.settings.text, 'cats', 'the typed criterion stays in the settings');
    });
  });

  test('COMPUTER_DOTS code: Inputs and Code rows above the editor, named; the Code row hides with the editor', async () => {
    assert.deepEqual(code.inputs.map((/** @type {any} */ p) => [p.name, p.row]), [['in', '.graph-code-in'], ['code', '.graph-code-src']]);
    await withDom(async () => {
      const part = { id: 'k1', type: 'code', settings: { code: 'return 1;', about: '', folded: false, locked: false } };
      const host = document.createElement('div');
      const inst = code.render(host, part, /** @type {any} */ (ctxFor(part, {})));
      const names = host.querySelectorAll('.graph-port-name').map((/** @type {any} */ n) => n.textContent);
      assert.deepEqual(names, ['Inputs', 'Code'], 'each row starts with its dot\'s name');
      assert.match(host.querySelector('.graph-code-in').textContent, /your code reads inputs\.in/);
      assert.match(host.querySelector('.graph-code-src').textContent, /Below, or wire in a program/);
      const wiredHost = document.createElement('div');
      code.render(wiredHost, part, /** @type {any} */ (ctxFor(part, { in: ['Text', 'Fetch'], code: ['Write code'] })));
      assert.match(wiredHost.querySelector('.graph-code-in').textContent, /From the wire: “Text”, “Fetch” \(your code reads inputs\.in\)/);
      assert.match(wiredHost.querySelector('.graph-code-src').textContent, /From the wire: “Write code”/);
      const folded = { ...part, settings: { ...part.settings, folded: true } };
      inst.update(folded);
      const srcRow = host.querySelector('.graph-code-src').parentNode;
      assert.equal(srcRow.hidden, true, 'folded: the Code row goes with the editor (its dot then sits below Inputs)');
      assert.equal(host.querySelector('.graph-code-in').parentNode.hidden, undefined, 'the Inputs row stays');
    });
  });
};
