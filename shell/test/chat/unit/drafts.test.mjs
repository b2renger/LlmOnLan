// @ts-check
// app/drafts.mjs against the REAL repo (memory backend) and a composer double that records what it
// was told. Docs review SA-13: text typed before any chat is open (launch, before reopenLast()
// selects the last chat) used to be wiped by the restore.
import assert from 'node:assert/strict';
import { createApp } from '../../../renderer/chat/core/app.mjs';
import { EV } from '../../../renderer/chat/core/events.mjs';
import { openRepoSync } from '../../../renderer/chat/state/repo.mjs';
import { createMemoryBackend } from '../../../renderer/chat/state/backend-memory.mjs';
import { install } from '../../../renderer/chat/app/drafts.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await sleep(0);
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

async function world() {
  const app = createApp({ root: null, els: /** @type {any} */ ({}) });
  app.repo = openRepoSync({ openPersistent: () => createMemoryBackend({ kind: 'idb' }), bus: app.bus, now: app.now, newId: app.newId });
  await app.repo.ready;
  let text = '';
  const sets = [];
  app.composer = /** @type {any} */ ({
    getDraft: () => ({ text, parts: [] }),
    setText: (v) => { sets.push(v); text = v; },
    on: () => () => {},
  });
  const drafts = install(app);
  const type = (v) => { text = v; app.bus.emit(EV.DRAFT_CHANGE, { text: v, parts: [] }); };
  const select = (id) => app.bus.emit(EV.THREAD_SELECTED, { threadId: id });
  return { app, drafts, type, select, sets, text: () => text };
}

export default (test) => {
  test('SA-13: text typed while no chat is open survives the first selection and becomes its draft', async () => {
    const w = await world();
    const last = w.app.repo.createThread({ title: 'Yesterday' });
    await settle();

    w.type('a question I started typing at launch');   // no thread yet: nothing to save it under
    w.select(last.id);                                  // reopenLast() lands
    await settle();
    assert.equal(w.text(), 'a question I started typing at launch', 'the composer kept it');
    assert.deepEqual(w.sets, [], 'nothing was written over it');

    await w.drafts.flush();
    await settle();
    assert.equal((await w.app.repo.getThread(last.id)).draft, 'a question I started typing at launch',
      'and it is saved as that chat\'s draft');
  });

  test('switching between two chats still restores each one\'s own draft', async () => {
    const w = await world();
    const a = w.app.repo.createThread({ title: 'A' });
    const b = w.app.repo.createThread({ title: 'B' });
    await settle();
    w.select(a.id); await settle();
    w.type('draft for A');
    w.select(b.id); await settle();                     // B has no draft: the composer empties
    assert.equal(w.text(), '');
    assert.equal((await w.app.repo.getThread(a.id)).draft, 'draft for A', 'the switch flushed A first');
    w.select(a.id); await settle();
    assert.equal(w.text(), 'draft for A');
  });
};
