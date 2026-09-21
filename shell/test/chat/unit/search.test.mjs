// @ts-check
// P2-U4's library surface in Node: the search fold, the snippet, the date groups, and the sidebar
// behaviours built on them (search results, the row … menu, pin, inline rename, ephemeral rows).
//
// `fold`, `foldIndex`, `makeSnippet`, `groupKeyFor` and `groupLabel` are pure and tested directly.
// The rest runs the REAL createSidebar over the runner's DOM shim, the way sidebar.test.mjs does —
// `document` is a global for ui/* modules, so each test installs the shim and restores it.
import assert from 'node:assert/strict';

import { createBus, EV } from '../../../renderer/chat/core/events.mjs';
import { createRegistry, SLOTS } from '../../../renderer/chat/core/registry.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import {
  createSidebar, fold, foldIndex, makeSnippet, groupKeyFor, groupLabel, messageHaystack,
} from '../../../renderer/chat/ui/sidebar.mjs';

const DAY = 86_400_000;
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` with the shim installed as `globalThis.document`. */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  try {
    return await fn(doc);
  } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
  }
}

const thread = (/** @type {string} */ id, /** @type {string} */ title, patch = {}) => ({
  id, title, pinned: false, ephemeral: false, updatedAt: Date.now(), ...patch,
});

function fakeRepo(threads = [], messages = []) {
  const calls = { scans: 0, updated: /** @type {any[]} */ ([]), deleted: /** @type {string[]} */ ([]) };
  return {
    mode: 'idb',
    calls,
    list: threads,
    messages,
    async listThreads() {
      return threads.slice().sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    },
    async getThread(id) { return threads.find((x) => x.id === id) || null; },
    async updateThread(id, patch) {
      calls.updated.push({ id, patch });
      const th = threads.find((x) => x.id === id);
      if (th) Object.assign(th, patch);
      return th || null;
    },
    async deleteThread(id) {
      calls.deleted.push(id);
      const i = threads.findIndex((x) => x.id === id);
      if (i >= 0) threads.splice(i, 1);
    },
    async scanMessages(visitor) {
      calls.scans += 1;
      for (const m of messages) if (visitor(m) === false) return;
    },
  };
}

function fakeApp(doc, repo, extra = {}) {
  const bus = createBus();
  const make = (/** @type {string} */ cls) => { const el = doc.createElement('div'); el.className = cls; return el; };
  const els = {
    list: make('chat-threads'), sideHead: make('chat-side-head'),
    sideTools: make('chat-side-tools'), sideFoot: make('chat-side-foot'),
  };
  const log = { selected: /** @type {any[]} */ ([]), scrolled: /** @type {any[]} */ ([]), created: /** @type {any[]} */ ([]) };
  const app = {
    bus,
    registry: createRegistry(),
    els,
    root: make('lolchat'),
    state: { threadId: null, storeMode: 'idb' },
    now: () => Date.now(),
    rng: Math.random,
    repo,
    log,
    dialogs: {
      async confirm() { return true; },
      popover(anchor, build) {
        const box = doc.createElement('div');
        app.log.popover = box;
        build(box, () => { app.log.closed = true; });
        return { el: box, close() { app.log.closed = true; } };
      },
      toast() { return { close() {} }; },
    },
    view: { scrollToMessage: (id, opts) => log.scrolled.push({ id, opts }) },
    controller: {
      async selectThread(id) { log.selected.push(id); app.state.threadId = id; bus.emit(EV.THREAD_SELECTED, { threadId: id }); },
      newThread(init) { log.created.push(init); return { id: 'fresh' }; },
    },
    ...extra,
  };
  bus.on(EV.THREAD_SELECTED, (p) => { app.state.threadId = p && p.threadId ? p.threadId : null; });
  return app;
}

const click = (/** @type {any} */ el) => el.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
const rowIds = (/** @type {any} */ el) => [...el.querySelectorAll('.chat-thread-row')].map((n) => n.getAttribute('data-id'));

/** Type into the search box the way a person does: set the value, fire `input`, wait out the debounce. */
async function search(app, text) {
  const input = app.els.sideTools.querySelector('.chat-search-input');
  input.value = text;
  input.dispatchEvent({ type: 'input' });
  await wait(240);
  return input;
}

export default (test) => {
  // ------------------------------------------------------------------ pure: folding
  test('search: fold strips diacritics and case', async () => {
    assert.equal(fold('Éléphant'), fold('elephant'));
    assert.equal(fold('Éléphant'), 'elephant');
    assert.equal(fold('CRÈME brûlée'), 'creme brulee');
    assert.equal(fold(null), '');
    assert.equal(fold(42), '42');
  });

  test('search: foldIndex maps every folded character back to the original one', async () => {
    const { folded, map } = foldIndex('Éléphant');
    assert.equal(folded, 'elephant');
    assert.equal(map.length, folded.length);
    // 'É' is one character in the source; its folded 'e' must point at index 0, not at the
    // combining mark NFD inserted after it.
    assert.equal(map[0], 0);
    assert.equal('Éléphant'[map[folded.indexOf('phant')]], 'p');
  });

  test('search: a snippet lands on the accented word and marks where it was cut', async () => {
    const text = 'Le projet dit de l’Éléphant de la Bastille est resté inachevé pendant des décennies, ce qui en dit long.';
    const snip = makeSnippet(text, fold('elephant'), { radius: 12 });
    assert.ok(snip.includes('Éléphant'), `the snippet quotes the source text: ${snip}`);
    assert.ok(snip.startsWith('…'), 'it says text was cut on the left');
    assert.ok(snip.endsWith('…'), 'and on the right');
    assert.equal(makeSnippet(text, fold('zebra')), null);
    assert.equal(makeSnippet('anything', ''), null);
  });

  test('search: a snippet collapses newlines so a row stays one line', async () => {
    const snip = makeSnippet('a\n\nmirror\n\nmodifier', fold('mirror'));
    assert.equal(snip, 'a mirror modifier');
  });

  test('search: the haystack covers the content AND the text parts, without repeating itself', async () => {
    assert.equal(messageHaystack({ content: 'hi' }), 'hi');
    assert.equal(messageHaystack({ content: '', parts: [{ type: 'text', text: 'from a part' }, { type: 'image', attId: 'a' }] }), 'from a part');
    // A user turn is stored twice over (content AND a text part); a snippet that read "hi hi" was
    // the visible symptom.
    assert.equal(messageHaystack({ content: 'hi', parts: [{ type: 'text', text: 'hi' }] }), 'hi');
    assert.equal(messageHaystack({ content: 'hi', parts: [{ type: 'text', text: 'and more' }] }), ['hi', 'and more'].join('\n'));
    assert.equal(messageHaystack(null), '');
  });

  // ------------------------------------------------------------------ pure: groups
  test('search: the date buckets are measured from local midnight', async () => {
    const now = new Date(2026, 8, 15, 14, 30).getTime();          // a Tuesday afternoon
    const midnight = new Date(2026, 8, 15).getTime();
    const key = (/** @type {number} */ ts, patch = {}) => groupKeyFor({ updatedAt: ts, ...patch }, now);

    assert.equal(key(now), 'today');
    assert.equal(key(midnight), 'today', 'one minute after midnight is still today');
    assert.equal(key(midnight - 1), 'yesterday', 'one minute before it is not');
    assert.equal(key(midnight - DAY), 'yesterday');
    assert.equal(key(midnight - DAY - 1), 'week');
    assert.equal(key(midnight - 6 * DAY), 'week');
    assert.equal(key(midnight - 7 * DAY - 1), 'month');
    assert.equal(key(midnight - 29 * DAY), 'month');
    assert.equal(key(midnight - 40 * DAY), 'm:2026-08', 'older than a month goes by month name');
    assert.equal(key(now, { pinned: true }), 'pinned', 'pinning wins over every date');
  });

  test('search: group headings come from the strings file, month names from the platform', async () => {
    const now = new Date(2026, 8, 15).getTime();
    assert.equal(groupLabel('pinned', now), t('sidebar.pinned'));
    assert.equal(groupLabel('today', now), t('library.groupToday'));
    assert.equal(groupLabel('yesterday', now), t('library.groupYesterday'));
    assert.equal(groupLabel('week', now), t('library.groupWeek'));
    assert.equal(groupLabel('month', now), t('library.groupMonth'));
    const august = groupLabel('m:2026-08', now);
    assert.ok(august && august !== 'm:2026-08', 'a month bucket gets a real name');
    const old = groupLabel('m:2019-02', now);
    assert.match(old, /2019/, 'a different year says so');
  });

  test('search: the list is grouped in the order the repo already sorts', async () => {
    await withDom(async (doc) => {
      const now = Date.now();
      const repo = fakeRepo([
        thread('t1', 'this morning', { updatedAt: now }),
        thread('t2', 'last week', { updatedAt: now - 4 * DAY }),
        thread('t3', 'kept', { pinned: true, updatedAt: now - 40 * DAY }),
      ]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      const nodes = [...app.els.list.childNodes].map((n) => (n.className.includes('group') ? `#${n.textContent}` : n.getAttribute('data-id')));
      assert.deepEqual(nodes, [`#${t('sidebar.pinned')}`, 't3', `#${t('library.groupToday')}`, 't1', `#${t('library.groupWeek')}`, 't2']);
    });
  });

  // ------------------------------------------------------------------ search in the sidebar
  test('search: a query finds a message body and offers a snippet', async () => {
    await withDom(async (doc) => {
      const messages = [
        { id: 'm1', threadId: 't1', role: 'user', content: 'how do I mirror weights?' },
        { id: 'm2', threadId: 't2', role: 'user', content: 'parle-moi de l’Éléphant de la Bastille' },
      ];
      const repo = fakeRepo([thread('t1', 'Rig notes'), thread('t2', 'Un monument')], messages);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      assert.ok(app.els.sideTools.querySelector('.chat-search-input'), 'the search box lives in els.sideTools');

      await search(app, 'elephant');
      assert.deepEqual(rowIds(app.els.list), ['t2'], 'the ASCII query found the accented message');
      const snippet = app.els.list.querySelector('.chat-result-snippet').textContent;
      assert.ok(snippet.includes('Éléphant'), `the snippet quotes the message: ${snippet}`);
      assert.equal(app.els.list.querySelector('.chat-thread-group').textContent, t('library.searchResults'));

      // Clicking a result opens the thread AND flashes the message it was found in.
      click(app.els.list.querySelector('.chat-result .chat-thread'));
      await wait(0);
      assert.deepEqual(app.log.selected, ['t2']);
      assert.deepEqual(app.log.scrolled, [{ id: 'm2', opts: { flash: true } }]);
    });
  });

  test('search: a title matches even when no message does', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo([thread('t1', 'Crème brûlée'), thread('t2', 'Rig notes')], [
        { id: 'm1', threadId: 't2', role: 'user', content: 'nothing about desserts' },
      ]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      await search(app, 'creme');
      assert.deepEqual(rowIds(app.els.list), ['t1']);
      assert.equal(app.els.list.querySelectorAll('.chat-result-snippet').length, 0, 'a title hit has no message snippet');
    });
  });

  test('search: nothing found says so, and clearing brings the groups back', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo([thread('t1', 'Rig notes')], [{ id: 'm1', threadId: 't1', content: 'weights' }]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();

      await search(app, 'zebra');
      assert.deepEqual(rowIds(app.els.list), []);
      assert.equal(app.els.list.querySelector('.chat-search-empty').textContent, t('library.searchNone', { q: 'zebra' }));

      click(app.els.sideTools.querySelector('.chat-search-clear'));
      await wait(0);
      assert.deepEqual(rowIds(app.els.list), ['t1'], 'the whole list is back');
      assert.equal(app.els.list.querySelector('.chat-search-empty'), null);
    });
  });

  test('search: keystrokes are debounced into ONE scan, and no render rescans for dots', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo([thread('t1', 'Rig notes')], [{ id: 'm1', threadId: 't1', content: 'mirror' }]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      await wait(0);
      const afterBoot = repo.calls.scans;                 // the one interrupted-dot scan

      const input = app.els.sideTools.querySelector('.chat-search-input');
      for (const value of ['m', 'mi', 'mir', 'mirr', 'mirro', 'mirror']) {
        input.value = value;
        input.dispatchEvent({ type: 'input' });
        await wait(20);
      }
      await wait(240);
      assert.equal(repo.calls.scans, afterBoot + 1, 'six keystrokes, one store scan');
      assert.deepEqual(rowIds(app.els.list), ['t1']);
    });
  });

  // P2 review, minor: every debounced keystroke cursored the WHOLE message store (this file's own
  // measurement: ~140 ms at 12k messages), even though a longer needle can only match where the
  // shorter one already did. The narrowing must be invisible: same rows, same snippets.
  test('search: a longer needle re-filters the last result instead of rescanning the store', async () => {
    await withDom(async (doc) => {
      const messages = [
        { id: 'm1', threadId: 't1', role: 'user', content: 'how do I mirror weights?' },
        { id: 'm2', threadId: 't1', role: 'assistant', content: 'mirror modifier, then weight mirroring' },
        { id: 'm3', threadId: 't2', role: 'user', content: 'mirrors in the hallway' },
        { id: 'm4', threadId: 't3', role: 'user', content: 'nothing relevant here' },
      ];
      const repo = fakeRepo([thread('t1', 'Rig notes'), thread('t2', 'House'), thread('t3', 'Other')], messages);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      await wait(0);

      await search(app, 'mirror');
      const scansAfterFirst = repo.calls.scans;
      assert.deepEqual(rowIds(app.els.list), ['t1', 't2']);

      await search(app, 'mirror w');
      assert.equal(repo.calls.scans, scansAfterFirst, 'an extension of the needle costs no store scan');
      const narrowed = rowIds(app.els.list);
      const narrowedSnippet = app.els.list.querySelector('.chat-result-snippet').textContent;

      // …and it is the SAME answer a cold scan gives. Typing the query from scratch is that scan.
      const fresh = fakeApp(doc, fakeRepo([thread('t1', 'Rig notes'), thread('t2', 'House'), thread('t3', 'Other')], messages));
      const sb2 = createSidebar(fresh, fresh.els.list);
      await sb2.render();
      await search(fresh, 'mirror w');
      assert.deepEqual(narrowed, rowIds(fresh.els.list), 'narrowing and scanning agree on the rows');
      assert.equal(narrowedSnippet, fresh.els.list.querySelector('.chat-result-snippet').textContent,
        'and on the snippet, which is the message the hit was found in');

      // A needle that is NOT an extension has to go back to the store.
      await search(app, 'hallway');
      assert.equal(repo.calls.scans, scansAfterFirst + 1, 'a different query rescans');
      assert.deepEqual(rowIds(app.els.list), ['t2']);

      // …and so does a needle typed after the store moved under the cache.
      await search(app, 'hall');
      const beforeMove = repo.calls.scans;
      app.bus.emit(EV.MESSAGE_PUT, { id: 'm5', threadId: 't3', status: 'done' });
      await search(app, 'hallw');
      assert.equal(repo.calls.scans, beforeMove + 1, 'a write drops the cache rather than answering from it');
    });
  });

  // ------------------------------------------------------------------ the row … menu
  test('search: the … menu lists the built-ins, Pin and Unpin never together', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo([thread('t1', 'Rig notes')]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();

      click(app.els.list.querySelector('.chat-thread-more'));
      const items = [...app.log.popover.querySelectorAll('.chat-menu-item')].map((n) => n.getAttribute('data-item'));
      assert.deepEqual(items, ['rename', 'pin', 'export-md', 'export-json', 'delete']);
      assert.equal(app.log.popover.getAttribute('role'), 'menu');

      // Pinning swaps the item and moves the row into the Pinned group.
      const pin = [...app.log.popover.querySelectorAll('.chat-menu-item')].find((n) => n.getAttribute('data-item') === 'pin');
      click(pin);
      await wait(0);
      assert.deepEqual(repo.calls.updated, [{ id: 't1', patch: { pinned: true } }]);
      await sb.render();
      assert.equal(app.els.list.querySelector('.chat-thread-group').textContent, t('sidebar.pinned'));

      click(app.els.list.querySelector('.chat-thread-more'));
      const after = [...app.log.popover.querySelectorAll('.chat-menu-item')].map((n) => n.getAttribute('data-item'));
      assert.deepEqual(after, ['rename', 'unpin', 'export-md', 'export-json', 'delete']);
    });
  });

  test('search: a feature can add its own item, and it is read at OPEN time', async () => {
    await withDom(async (doc) => {
      const app = fakeApp(doc, fakeRepo([thread('t1', 'Rig notes')]));
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      let got = null;
      app.registry.add(SLOTS.THREAD_MENU, { id: 'late', order: 15, label: 'Later feature', run: (th) => { got = th.id; } });

      click(app.els.list.querySelector('.chat-thread-more'));       // no re-render in between
      const items = [...app.log.popover.querySelectorAll('.chat-menu-item')].map((n) => n.getAttribute('data-item'));
      assert.deepEqual(items, ['rename', 'late', 'pin', 'export-md', 'export-json', 'delete'], 'ordered by `order`');
      click([...app.log.popover.querySelectorAll('.chat-menu-item')][1]);
      assert.equal(got, 't1', 'the item is handed the thread it was opened on');
    });
  });

  test('search: Delete from the menu goes through the same confirm as the ×', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo([thread('t1', 'Rig notes')]);
      const asked = [];
      const app = fakeApp(doc, repo);
      app.dialogs.confirm = async (o) => { asked.push(o); return true; };
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      click(app.els.list.querySelector('.chat-thread-more'));
      click([...app.log.popover.querySelectorAll('.chat-menu-item')].find((n) => n.getAttribute('data-item') === 'delete'));
      await wait(0);
      assert.equal(asked.length, 1);
      assert.equal(asked[0].danger, true);
      assert.deepEqual(repo.calls.deleted, ['t1']);
    });
  });

  // ------------------------------------------------------------------ rename
  test('search: a double-click renames inline, Enter saves it as the user’s title', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo([thread('t1', 'Rig notes')]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();

      const btn = app.els.list.querySelector('.chat-thread');
      btn.dispatchEvent({ type: 'dblclick', preventDefault() {} });
      const input = app.els.list.querySelector('.chat-thread-rename');
      assert.ok(input, 'an input replaced the row');
      assert.equal(input.value, 'Rig notes', 'it starts on the current name');
      assert.equal(btn.hidden, true, 'the row button is out of the way while renaming');

      input.value = '  Shoulder rig  ';
      input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {}, stopPropagation() {} });
      await wait(0);
      assert.deepEqual(repo.calls.updated, [{ id: 't1', patch: { title: 'Shoulder rig', titleSource: 'user' } }]);
      assert.equal(app.els.list.querySelector('.chat-thread-rename'), null, 'the input is gone again');
      assert.equal(btn.hidden, false);
    });
  });

  test('search: Escape cancels a rename and writes nothing', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo([thread('t1', 'Rig notes')]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      app.els.list.querySelector('.chat-thread').dispatchEvent({ type: 'dblclick', preventDefault() {} });
      const input = app.els.list.querySelector('.chat-thread-rename');
      input.value = 'never';
      input.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() {} });
      await wait(0);
      assert.deepEqual(repo.calls.updated, []);
      assert.equal(app.els.list.querySelector('.chat-thread-rename'), null);
      // And a blur arriving after the cancel must not resurrect the write.
      input.dispatchEvent({ type: 'blur' });
      await wait(0);
      assert.deepEqual(repo.calls.updated, []);
    });
  });

  test('search: renaming to the same text or to nothing writes nothing', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo([thread('t1', 'Rig notes')]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      for (const value of ['Rig notes', '   ']) {
        app.els.list.querySelector('.chat-thread').dispatchEvent({ type: 'dblclick', preventDefault() {} });
        const input = app.els.list.querySelector('.chat-thread-rename');
        input.value = value;
        input.dispatchEvent({ type: 'blur' });
        await wait(0);
      }
      assert.deepEqual(repo.calls.updated, []);
    });
  });

  // ------------------------------------------------------------------ ephemeral
  test('search: the ⌄ menu starts an ephemeral chat, and its row is marked', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo([thread('t1', 'saved'), thread('t2', 'quick', { ephemeral: true })]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();

      const row = app.els.list.querySelector('.chat-thread-row[data-id=t2]');
      assert.ok(row.classList.contains('ephemeral'));
      const eye = row.querySelector('.chat-thread-eye');
      assert.ok(!eye.classList.contains('hidden'), 'the eye-off marker is shown');
      assert.equal(eye.title, t('library.ephemeral'), 'and it says what that means');
      const saved = app.els.list.querySelector('.chat-thread-row[data-id=t1] .chat-thread-eye');
      assert.ok(saved.classList.contains('hidden'), 'a saved chat has no marker');

      click(app.els.sideHead.querySelector('.chat-new-menu'));
      click([...app.log.popover.querySelectorAll('.chat-menu-item')].find((n) => n.getAttribute('data-item') === 'ephemeral'));
      assert.deepEqual(app.log.created, [{ ephemeral: true }]);
    });
  });
};
