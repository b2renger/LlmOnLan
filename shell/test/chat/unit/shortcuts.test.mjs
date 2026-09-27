// @ts-check
// ui/shortcuts.mjs — the one document keydown listener, driven through `app.shortcuts.handle` with a
// minimal `document` (activeElement, body, and a no-op listener API). Docs review SA-7: Alt+←/→ must
// not steal the system's word jump (Option+arrow on a Mac) from a field that holds text.
import assert from 'node:assert/strict';
import { createApp } from '../../../renderer/chat/core/app.mjs';
import { install, matchesKeys } from '../../../renderer/chat/ui/shortcuts.mjs';

function world() {
  const composer = { tagName: 'TEXTAREA', value: '' };
  const rename = { tagName: 'INPUT', value: 'Half a new ti' };
  const body = { tagName: 'BODY' };
  const doc = {
    body,
    activeElement: /** @type {any} */ (body),
    addEventListener: () => {}, removeEventListener: () => {}, querySelectorAll: () => [],
  };
  const app = createApp({ root: null, els: /** @type {any} */ ({ input: composer }) });
  app.root = /** @type {any} */ ({ contains: (el) => el === composer || el === rename });
  app.state.visible = true;
  const switched = [];
  app.controller = /** @type {any} */ ({
    current: () => ({ thread: { id: 't' }, path: [{ id: 'u1', role: 'user' }, { id: 'a1', role: 'assistant' }] }),
    stop: () => false,
    newThread: () => {},
  });
  app.branching = /** @type {any} */ ({ switchSibling: (id, dir) => { switched.push([id, dir]); } });
  return { app, doc, composer, rename, body, switched };
}

/** A keydown the handler can mark. */
const key = (k, mods = {}) => ({
  key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods,
  prevented: false, preventDefault() { this.prevented = true; },
});

export default (test) => {
  test('matchesKeys: Alt+ArrowLeft needs Alt and nothing else', () => {
    assert.equal(matchesKeys('Alt+ArrowLeft', key('ArrowLeft', { altKey: true })), true);
    assert.equal(matchesKeys('Alt+ArrowLeft', key('ArrowLeft')), false);
    assert.equal(matchesKeys('Alt+ArrowLeft', key('ArrowLeft', { altKey: true, shiftKey: true })), false);
  });

  test('SA-7: Alt+←/→ in a composer or field with text is the word jump — never a version flip', async () => {
    const { app, doc, composer, rename, switched } = world();
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
    const saved = globalThis.document;
    globalThis.document = /** @type {any} */ (doc);
    try {
      install(app);

      composer.value = 'the quick brown fox';
      doc.activeElement = composer;
      const inText = key('ArrowLeft', { altKey: true });
      app.shortcuts.handle(inText);
      assert.equal(inText.prevented, false, 'the caret must move by a word');
      const inTextRight = key('ArrowRight', { altKey: true });
      app.shortcuts.handle(inTextRight);
      assert.equal(inTextRight.prevented, false);

      doc.activeElement = rename;                                  // a sidebar rename, inside the chat
      const inRename = key('ArrowLeft', { altKey: true });
      app.shortcuts.handle(inRename);
      assert.equal(inRename.prevented, false);
      await Promise.resolve();
      assert.deepEqual(switched, [], 'no version was flipped');

      composer.value = '';                                         // an EMPTY composer has no caret to move
      doc.activeElement = composer;
      const empty = key('ArrowLeft', { altKey: true });
      app.shortcuts.handle(empty);
      assert.equal(empty.prevented, true);
      doc.activeElement = doc.body;                                // nothing focused
      const none = key('ArrowRight', { altKey: true });
      app.shortcuts.handle(none);
      assert.equal(none.prevented, true);
      await Promise.resolve();
      assert.deepEqual(switched, [['a1', -1], ['a1', 1]], 'the shortcut still walks the last reply from there');
      app.shortcuts.off();
    } finally {
      if (had) globalThis.document = saved; else delete globalThis.document;
    }
  });
};
