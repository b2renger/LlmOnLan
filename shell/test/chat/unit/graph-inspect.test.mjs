// @ts-check
// C2-U3: the chat-column value inspector (plan §2.6 BH-7).
//
// Two halves, both tested here: the PURE text of one opening (what a value looks like full size,
// and what the heading says), and the ELEMENT's lifecycle — where it is inserted, that there is
// never more than one, and that Escape closes it without the run hearing the key.

import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { createInspector, bodyText, headingText, INSPECT_CAP } from '../../../renderer/chat/graph/inspect.mjs';
import '../../../renderer/chat/strings/graph.en.mjs';

/** Run `fn` with the unit runner's DOM shim installed as `globalThis.document`. */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
  }
}

/** The conversation column as ui/layout.mjs builds it: messages, then the composer, inside main. */
function layout() {
  const main = document.createElement('div');
  main.className = 'chat-main';
  const messages = document.createElement('div');
  messages.id = 'chat-messages';
  const form = document.createElement('form');
  form.id = 'chat-form';
  main.append(messages, form);
  return { app: { els: { main, form, messages } }, main, messages, form };
}

/** A keydown as the shim dispatches one, recording what the handler did with it. */
function keydown(key) {
  const ev = /** @type {any} */ ({
    type: 'keydown', key, prevented: false, stopped: false,
    preventDefault() { ev.prevented = true; },
    stopPropagation() { ev.stopped = true; },
  });
  return ev;
}

export default (test) => {
  test('bodyText keeps a text value whole and renders every other kind honestly', () => {
    assert.equal(bodyText(valueOf('text', 'line one\nline two')), 'line one\nline two',
      'the inspector is where an answer is READ: its line breaks survive');
    assert.equal(bodyText(listOf([valueOf('text', 'a'), valueOf('text', 'b')])), '1. a\n2. b',
      'a list reads as its items, one numbered line each — not the canvas\' one-line run');
    assert.equal(bodyText(listOf([])), '', 'an empty list has nothing to read');
    assert.equal(bodyText(valueOf('json', { a: 1 })), '{\n  "a": 1\n}', 'json is pretty-printed for reading');
    assert.equal(bodyText(null), '', 'nothing to show is empty, not a crash');
  });

  test('bodyText caps a runaway value and says how much is left', () => {
    const huge = 'x'.repeat(INSPECT_CAP + 500);
    const shown = bodyText(valueOf('text', huge));
    assert.ok(shown.length < huge.length, 'the column is not asked to paint megabytes');
    assert.ok(shown.includes(t('graph.valueMore', { n: 500 })), 'and the reader is told what was cut');
  });

  test('headingText names the part and the item when it knows them', () => {
    assert.equal(headingText({}), t('graph.inspectTitle'));
    assert.equal(headingText({ partLabel: 'Ask' }), t('graph.inspectFrom', { part: 'Ask' }));
    const withItem = headingText({ partLabel: 'Ask', item: { i: 2, n: 7 } });
    assert.ok(withItem.includes(t('graph.inspectItem', { i: 3, n: 7 })), 'items are counted from 1 for a reader');
  });

  test('the inspector opens in the conversation column, above the composer, never inside the messages', async () => {
    await withDom(async () => {
      const l = layout();
      const ins = createInspector(l.app);
      const el = ins.show(valueOf('text', 'the whole answer'));

      assert.ok(el, 'it opened');
      assert.equal(el.className, 'graph-inspect');
      assert.equal(el.parentNode, l.main, 'a DIRECT child of the conversation column');
      assert.equal(el.nextSibling, l.form, 'inserted immediately before the composer (BH-7)');
      assert.equal(l.messages.querySelectorAll('.graph-inspect').length, 0,
        'and NOT inside #chat-messages — that subtree belongs to the thread view');
      assert.equal(el.querySelector('.graph-inspect-body').textContent, 'the whole answer');
      assert.ok(el.querySelector('.graph-inspect-head'), 'with a head to close it from');
      assert.equal(ins.open(), true);
    });
  });

  test('there is only ever one inspector, and closing leaves nothing behind', async () => {
    await withDom(async () => {
      const l = layout();
      const ins = createInspector(l.app);
      ins.show(valueOf('text', 'first'));
      ins.show(valueOf('text', 'second'));
      assert.equal(l.main.querySelectorAll('.graph-inspect').length, 1, 'the second opening replaced the first');
      assert.equal(l.main.querySelector('.graph-inspect-body').textContent, 'second');

      assert.equal(ins.close(), true);
      assert.equal(l.main.querySelectorAll('.graph-inspect').length, 0);
      assert.equal(ins.open(), false);
      assert.equal(ins.close(), false, 'closing twice is a no-op, not a throw');

      ins.show(valueOf('text', 'again'));
      ins.destroy();
      assert.equal(l.main.querySelectorAll('.graph-inspect').length, 0, 'destroy takes it with it');
    });
  });

  test('Escape closes the inspector and stops there — it must not also stop the run', async () => {
    await withDom(async () => {
      const l = layout();
      const ins = createInspector(l.app);
      const el = ins.show(valueOf('text', 'reading this'));

      const other = keydown('a');
      el.dispatchEvent(other);
      assert.equal(ins.open(), true, 'an ordinary key changes nothing');
      assert.equal(other.stopped, false, 'and is not swallowed');

      const esc = keydown('Escape');
      el.dispatchEvent(esc);
      assert.equal(ins.open(), false, 'Escape closed it');
      assert.equal(esc.prevented, true);
      assert.equal(esc.stopped, true,
        'the key is consumed here, so ui/shortcuts.mjs never reads it as "stop the run" (BH-7)');
    });
  });

  test('an empty value still says something, and a missing column refuses to half-open', async () => {
    await withDom(async () => {
      const l = layout();
      const ins = createInspector(l.app);
      const el = ins.show(valueOf('text', ''));
      assert.equal(el.querySelector('.graph-inspect-body').textContent, t('graph.inspectEmpty'),
        'a blank panel is indistinguishable from a broken one, so it says so');

      const nowhere = createInspector({ els: { main: null, form: null } });
      assert.equal(nowhere.show(valueOf('text', 'x')), null);
      assert.equal(nowhere.open(), false, 'no element was left dangling');

      const detached = createInspector({ els: { main: l.main, form: document.createElement('form') } });
      assert.equal(detached.show(valueOf('text', 'x')), null, 'a composer that is not in this column is not a slot');
    });
  });
};
