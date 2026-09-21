// @ts-check
// P1-U4 in Node: the thread list and the store banner over the runner's DOM shim.
//
// These cover the logic that does NOT need a browser — ordering and grouping, keyed rows, the
// active highlight, the delete conversation with dialogs/repo/controller, the skeleton, the
// interrupted dot, the NEW_MENU button, and the banner's "own node only" rule. The real IndexedDB,
// <dialog>, the Popover API and the boot sequence are covered by the p1-store-ui harness scenarios.
//
// `document` is a global for ui/* modules, so each test installs the shim and restores whatever was
// there before: the runner shares ONE process with every other test file.
import assert from 'node:assert/strict';

import { createBus, EV } from '../../../renderer/chat/core/events.mjs';
import { createRegistry, SLOTS } from '../../../renderer/chat/core/registry.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import { createSidebar, groupKeyFor, groupLabel } from '../../../renderer/chat/ui/sidebar.mjs';
import { install as installStoreBanner } from '../../../renderer/chat/ui/store-banner.mjs';

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

/** A repo with exactly the surface the sidebar uses. */
function fakeRepo(doc, threads = [], messages = []) {
  const calls = { deleted: /** @type {string[]} */ ([]), scans: 0 };
  return {
    mode: 'idb',
    calls,
    list: threads,
    async listThreads() {
      return threads
        .slice()
        .sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    },
    async getThread(id) { return threads.find((x) => x.id === id) || null; },
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
  const make = (cls) => { const el = doc.createElement('div'); if (cls) el.className = cls; return el; };
  const els = { list: make('chat-threads'), sideHead: make('chat-side-head'), banner: make('chat-banner') };
  const selected = /** @type {(string|null)[]} */ ([]);
  const app = {
    bus,
    registry: createRegistry(),
    els,
    root: make('lolchat'),
    state: { threadId: null, storeMode: 'idb' },
    repo,
    dialogs: null,
    controller: {
      async selectThread(id) { selected.push(id); app.state.threadId = id; bus.emit(EV.THREAD_SELECTED, { threadId: id }); },
    },
    selected,
    ...extra,
  };
  bus.on(EV.THREAD_SELECTED, (p) => { app.state.threadId = p && p.threadId ? p.threadId : null; });
  return app;
}

const thread = (id, title, patch = {}) => ({ id, title, pinned: false, updatedAt: Number(id.replace(/\D/g, '')) || 1, ...patch });
const titles = (el) => [...el.querySelectorAll('.chat-thread-title')].map((n) => n.textContent);
const rowIds = (el) => [...el.querySelectorAll('.chat-thread-row')].map((n) => n.getAttribute('data-id'));
const click = (el) => el.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });

export default (test) => {
  // ------------------------------------------------------------------ ordering and grouping
  test('sidebar: newest first, pinned grouped on top with labels', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [
        thread('t1', 'oldest'), thread('t2', 'middle'), thread('t3', 'newest'),
        thread('t4', 'kept', { pinned: true }),
      ]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();

      assert.deepEqual(titles(app.els.list), ['kept', 'newest', 'middle', 'oldest']);
      const groups = [...app.els.list.querySelectorAll('.chat-thread-group')].map((n) => n.textContent);
      // P2-U4 replaced the single "Recent" heading with date buckets (Today / Yesterday /
      // Previous 7 days / Previous 30 days / month names). Pinned still comes first, and the
      // unpinned threads of this fixture (epoch-era updatedAt) all land in one month bucket.
      assert.equal(groups.length, 2, 'pinned, then one date group');
      assert.equal(groups[0], t('sidebar.pinned'));
      assert.notEqual(groups[1], t('sidebar.pinned'));
      assert.equal(app.els.list.firstChild.className, 'chat-thread-group', 'the pinned label comes first');
    });
  });

  test('sidebar: a date group heading appears even when nothing is pinned', async () => {
    await withDom(async (doc) => {
      const app = fakeApp(doc, fakeRepo(doc, [thread('t1', 'a'), thread('t2', 'b')]));
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      const groups = [...app.els.list.querySelectorAll('.chat-thread-group')].map((n) => n.textContent);
      assert.equal(groups.length, 1, 'both threads are in the same bucket, so one heading');
      assert.equal(groups[0], groupLabel(groupKeyFor({ updatedAt: 2 }, Date.now()), Date.now()));
      assert.deepEqual(rowIds(app.els.list), ['t2', 't1']);
    });
  });

  test('sidebar: a thread with no title falls back to the untitled string', async () => {
    await withDom(async (doc) => {
      const app = fakeApp(doc, fakeRepo(doc, [thread('t1', '')]));
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      assert.deepEqual(titles(app.els.list), [t('sidebar.untitled')]);
    });
  });

  // ------------------------------------------------------------------ keyed rows
  test('sidebar: rows are keyed — a re-render reuses and reorders the same nodes', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'a'), thread('t2', 'b'), thread('t3', 'c')]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      const before = new Map([...app.els.list.querySelectorAll('.chat-thread-row')].map((n) => [n.getAttribute('data-id'), n]));
      assert.deepEqual([...before.keys()], ['t3', 't2', 't1']);

      // t1 gets a new reply: it moves to the top and is renamed. Same nodes, new order.
      repo.list.find((x) => x.id === 't1').updatedAt = 99;
      repo.list.find((x) => x.id === 't1').title = 'renamed';
      await sb.render();

      const after = new Map([...app.els.list.querySelectorAll('.chat-thread-row')].map((n) => [n.getAttribute('data-id'), n]));
      assert.deepEqual([...after.keys()], ['t1', 't3', 't2'], 'the order followed updatedAt');
      for (const id of ['t1', 't2', 't3']) assert.equal(after.get(id), before.get(id), `row ${id} is the SAME node`);
      assert.deepEqual(titles(app.els.list), ['renamed', 'c', 'b']);
    });
  });

  test('sidebar: a deleted thread drops its row and its bookkeeping', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'a'), thread('t2', 'b')]);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      repo.list.splice(0, 1);                       // t1 is gone
      await sb.render();
      assert.deepEqual(rowIds(app.els.list), ['t2']);
      // The one surviving row plus its date heading (P2-U4's groups) — and nothing else.
      assert.equal(app.els.list.childNodes.length, 2, 'no orphan nodes are left behind');
    });
  });

  // ------------------------------------------------------------------ selection
  test('sidebar: a row click selects that thread; the active row is marked', async () => {
    await withDom(async (doc) => {
      const app = fakeApp(doc, fakeRepo(doc, [thread('t1', 'a'), thread('t2', 'b')]));
      const sb = createSidebar(app, app.els.list);
      await sb.render();

      click(app.els.list.querySelector('.chat-thread[data-id=t1]'));
      assert.deepEqual(app.selected, ['t1']);
      const row = app.els.list.querySelector('.chat-thread[data-id=t1]');
      assert.ok(row.classList.contains('active'), 'THREAD_SELECTED highlighted the row');
      assert.equal(row.getAttribute('aria-current'), 'true');
      assert.equal(app.els.list.querySelector('.chat-thread[data-id=t2]').getAttribute('aria-current'), null);

      sb.highlight('t2');
      assert.ok(!app.els.list.querySelector('.chat-thread[data-id=t1]').classList.contains('active'));
      assert.ok(app.els.list.querySelector('.chat-thread[data-id=t2]').classList.contains('active'));
    });
  });

  test('sidebar: a THREADS_CHANGED event re-renders', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'a')]);
      const app = fakeApp(doc, repo);
      createSidebar(app, app.els.list);
      repo.list.push(thread('t2', 'b'));
      app.bus.emit(EV.THREADS_CHANGED, { reason: 'create', ids: ['t2'] });
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(rowIds(app.els.list), ['t2', 't1']);
    });
  });

  // ------------------------------------------------------------------ delete
  test('sidebar: × asks for confirmation and deletes nothing when refused', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'Rig notes')]);
      const asked = [];
      const app = fakeApp(doc, repo, { dialogs: { async confirm(o) { asked.push(o); return false; } } });
      const sb = createSidebar(app, app.els.list);
      await sb.render();

      click(app.els.list.querySelector('.chat-thread-x'));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(asked.length, 1);
      assert.equal(asked[0].danger, true);
      assert.match(asked[0].body, /Rig notes/, 'the confirm names the thread');
      assert.deepEqual(repo.calls.deleted, [], 'a refused confirm deletes nothing');
      assert.deepEqual(rowIds(app.els.list), ['t1']);
    });
  });

  test('sidebar: a confirmed × deletes and selects the next thread', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'a'), thread('t2', 'b'), thread('t3', 'c')]);
      const app = fakeApp(doc, repo, { dialogs: { async confirm() { return true; } } });
      const sb = createSidebar(app, app.els.list);
      await sb.render();                              // order: t3, t2, t1
      await app.controller.selectThread('t3');

      click(app.els.list.querySelector('.chat-thread-row[data-id=t3] .chat-thread-x'));
      await new Promise((r) => setTimeout(r, 0));

      assert.deepEqual(repo.calls.deleted, ['t3']);
      assert.deepEqual(app.selected, ['t3', 't2'], 'the row below took its place');
      assert.deepEqual(rowIds(app.els.list), ['t2', 't1']);
    });
  });

  test('sidebar: deleting the thread a reply is streaming into stops it FIRST', async () => {
    // The generation used to run on after the delete: the farm kept generating (and kept this
    // client's seat), the governor stayed busy so the composer refused every send, and the last
    // checkpoint re-inserted the assistant row into a thread that no longer existed.
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'a'), thread('t2', 'b')]);
      const order = [];
      const app = fakeApp(doc, repo, { dialogs: { async confirm() { return true; } } });
      let streaming = 't2';
      app.controller.isStreaming = () => streaming !== null;
      app.controller.abortThread = async (id) => {
        if (id !== streaming) return false;
        order.push(`abort:${id}`);
        await Promise.resolve();      // the settle a real generation needs
        streaming = null;
        return true;
      };
      const realDelete = repo.deleteThread.bind(repo);
      repo.deleteThread = async (id) => { order.push(`delete:${id}`); return realDelete(id); };

      const sb = createSidebar(app, app.els.list);
      await sb.render();
      await app.controller.selectThread('t2');
      click(app.els.list.querySelector('.chat-thread-row[data-id=t2] .chat-thread-x'));
      await new Promise((r) => setTimeout(r, 0));

      assert.deepEqual(order, ['abort:t2', 'delete:t2'], 'the reply is stopped and settled BEFORE the cascade');
      assert.equal(streaming, null, 'and nothing is left generating on the farm');
      assert.deepEqual(repo.calls.deleted, ['t2']);
    });
  });

  test('sidebar: deleting a thread while ANOTHER one streams leaves that stream alone', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'a'), thread('t2', 'b')]);
      const app = fakeApp(doc, repo, { dialogs: { async confirm() { return true; } } });
      let aborted = null;
      app.controller.abortThread = async (id) => { if (id !== 't1') return false; aborted = id; return true; };
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      click(app.els.list.querySelector('.chat-thread-row[data-id=t2] .chat-thread-x'));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(aborted, null, 'the running reply belongs to a thread nobody deleted');
      assert.deepEqual(repo.calls.deleted, ['t2']);
    });
  });

  test('sidebar: deleting the last thread clears the view', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'only')]);
      const app = fakeApp(doc, repo, { dialogs: { async confirm() { return true; } } });
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      await app.controller.selectThread('t1');

      click(app.els.list.querySelector('.chat-thread-x'));
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(repo.calls.deleted, ['t1']);
      assert.deepEqual(app.selected, ['t1', null], 'THREAD_SELECTED{null} clears the view');
      assert.deepEqual(rowIds(app.els.list), []);
    });
  });

  test('sidebar: deleting a thread that is NOT active leaves the selection alone', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'a'), thread('t2', 'b')]);
      const app = fakeApp(doc, repo, { dialogs: { async confirm() { return true; } } });
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      await app.controller.selectThread('t2');

      click(app.els.list.querySelector('.chat-thread-row[data-id=t1] .chat-thread-x'));
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(repo.calls.deleted, ['t1']);
      assert.deepEqual(app.selected, ['t2'], 'no re-selection happened');
      assert.equal(app.state.threadId, 't2');
    });
  });

  test('sidebar: with no dialogs component nothing is ever deleted', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'a')]);
      const app = fakeApp(doc, repo);                 // dialogs: null
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      const warns = [];
      const realWarn = console.warn;
      console.warn = (...a) => warns.push(a.join(' '));
      try {
        click(app.els.list.querySelector('.chat-thread-x'));
        await new Promise((r) => setTimeout(r, 0));
      } finally { console.warn = realWarn; }
      assert.deepEqual(repo.calls.deleted, []);
      assert.equal(warns.length, 1);
    });
  });

  // ------------------------------------------------------------------ pending store
  test('sidebar: skeleton rows while the store is pending, real rows once it answers', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, []);
      repo.mode = 'pending';
      const app = fakeApp(doc, repo);
      // ui/layout.mjs names the list; the skeleton only BORROWS that name (see below).
      app.els.list.setAttribute('aria-label', 'Chats');
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      assert.equal(app.els.list.querySelectorAll('.chat-thread-skel').length, 5);
      assert.equal(app.els.list.getAttribute('aria-busy'), 'true');
      assert.equal(app.els.list.getAttribute('aria-label'), t('sidebar.loading'));
      assert.equal(repo.calls.scans, 0, 'a pending store is never scanned');

      repo.mode = 'idb';
      repo.list.push(thread('t1', 'a'));
      await sb.render();
      assert.equal(app.els.list.querySelectorAll('.chat-thread-skel').length, 0);
      assert.deepEqual(rowIds(app.els.list), ['t1']);
      assert.equal(app.els.list.getAttribute('aria-busy'), null);
      assert.equal(app.els.list.getAttribute('aria-label'), 'Chats',
        'the list gets its own name back — a list still called "Loading chats…" lies to a screen reader');
    });
  });

  // ------------------------------------------------------------------ interrupted dot
  test('sidebar: an interrupted reply lights a dot — after the rows, never before them', async () => {
    await withDom(async (doc) => {
      const messages = [
        { id: 'm1', threadId: 't1', status: 'done' },
        { id: 'm2', threadId: 't2', status: 'streaming' },       // recovery has not run yet
      ];
      const repo = fakeRepo(doc, [thread('t1', 'a'), thread('t2', 'b')], messages);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      const dot = (id) => app.els.list.querySelector(`.chat-thread[data-id=${id}] .chat-thread-dot`);

      // Boot render #1 (main.mjs §3.1 step 11): rows are up, nothing is interrupted yet.
      await sb.render();
      assert.deepEqual(rowIds(app.els.list), ['t2', 't1'], 'the rows are painted before any scan');
      await new Promise((r) => setTimeout(r, 0));
      assert.ok(dot('t2').classList.contains('hidden'));

      // An ordinary render (a thread create/update/delete — three per send) must NOT cursor the
      // whole message store: at 12k messages that is ~140 ms of main-thread work per render.
      const scansAfterBoot = repo.calls.scans;
      await sb.render();
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(repo.calls.scans, scansAfterBoot, 'a plain render does not rescan the store');

      // repo.recoverInterrupted() runs, THEN main.mjs renders again (step 12) — with rescan:true,
      // because recovery rewrote records behind the sidebar's back. That is the one boot the dots
      // exist for, and the only place the full cursor is paid.
      messages[1].status = 'interrupted';
      await sb.render({ rescan: true });
      await new Promise((r) => setTimeout(r, 0));
      assert.ok(!dot('t2').classList.contains('hidden'), 't2 was cut off');
      assert.ok(dot('t1').classList.contains('hidden'), 't1 finished');
      assert.equal(dot('t2').title, t('sidebar.interrupted'));
    });
  });

  test('sidebar: a pending store is never scanned, and scans coalesce', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'a')], [{ id: 'm1', threadId: 't1', status: 'done' }]);
      repo.mode = 'pending';
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(repo.calls.scans, 0, 'nothing to scan while the store is still opening');

      repo.mode = 'idb';
      let release = () => {};
      const gate = new Promise((r) => { release = r; });
      const realScan = repo.scanMessages.bind(repo);
      repo.scanMessages = async (v) => { await gate; return realScan(v); };
      await sb.render({ rescan: true });
      await sb.render({ rescan: true });
      await sb.render({ rescan: true });
      release();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      // One scan for the first render, ONE follow-up covering the two that arrived during it —
      // never three, and never zero (the follow-up is what makes the boot dot appear at all).
      assert.equal(repo.calls.scans, 2, 'renders during a scan queue exactly one more');
      await sb.render();
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(repo.calls.scans, 2, 'and an ordinary render after it scans nothing at all');
    });
  });

  test('sidebar: MESSAGE_PUT with status interrupted lights the dot without a rescan', async () => {
    await withDom(async (doc) => {
      const repo = fakeRepo(doc, [thread('t1', 'a')], []);
      const app = fakeApp(doc, repo);
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      const dot = () => app.els.list.querySelector('.chat-thread-dot');
      assert.ok(dot().classList.contains('hidden'));
      app.bus.emit(EV.MESSAGE_PUT, { id: 'm1', threadId: 't1', status: 'interrupted' });
      assert.ok(!dot().classList.contains('hidden'));
      assert.equal(repo.calls.scans, 1, 'no extra scan');
    });
  });

  // ------------------------------------------------------------------ NEW_MENU
  test('sidebar: the ⌄ button shows SLOTS.NEW_MENU, built-in item and all', async () => {
    await withDom(async (doc) => {
      const app = fakeApp(doc, fakeRepo(doc, [thread('t1', 'a')]));
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      // P2-U4 registers "New ephemeral chat" itself, so the slot is never empty any more and the
      // button is there from the first render (the P1 build had no built-in item and no button).
      const btn = app.els.sideHead.querySelector('.chat-new-menu');
      assert.ok(btn, 'the ⌄ button was added to els.sideHead');
      assert.equal(btn.getAttribute('aria-label'), t('sidebar.newMenu'));

      let ran = 0;
      app.registry.add(SLOTS.NEW_MENU, { id: 'quick', order: 50, label: 'Quick chat', run: () => { ran += 1; } });
      await sb.render();
      assert.equal(app.els.sideHead.querySelectorAll('.chat-new-menu').length, 1, 'never added twice');

      // Clicking it opens a popover through dialogs; the item runs when picked.
      let built = null;
      app.dialogs = { popover(anchor, build) { const box = doc.createElement('div'); built = box; build(box, () => {}); return { el: box, close() {} }; } };
      click(btn);
      assert.ok(built, 'the ⌄ button opened a popover');
      const items = [...built.querySelectorAll('.chat-menu-item')];
      assert.deepEqual(items.map((n) => n.getAttribute('data-item')), ['ephemeral', 'quick'], 'both items, in order');
      click(items[1]);
      assert.equal(ran, 1);
    });
  });

  test('sidebar: it never binds #chat-new (plan §2.6 P — that is the composer\'s)', async () => {
    await withDom(async (doc) => {
      const app = fakeApp(doc, fakeRepo(doc, []));
      const newBtn = doc.createElement('button');
      newBtn.id = 'chat-new';
      app.els.sideHead.appendChild(newBtn);
      app.els.newBtn = newBtn;
      let created = 0;
      app.controller.newThread = () => { created += 1; };
      const sb = createSidebar(app, app.els.list);
      await sb.render();
      click(newBtn);
      assert.equal(created, 0, 'the sidebar must leave #chat-new to the composer');
    });
  });

  // ------------------------------------------------------------------ store banner
  test('store-banner: renders the mode it finds at install time', async () => {
    await withDom(async (doc) => {
      const app = fakeApp(doc, fakeRepo(doc, []));
      app.repo.mode = 'memory-final';                 // the forceMemoryStore boot: the event is long gone
      installStoreBanner(app);
      const node = app.els.banner.querySelector('.chat-banner-store');
      assert.ok(node, 'a feature must READ the mode, not only subscribe');
      assert.equal(node.textContent, t('store.memoryFinal'));
      assert.equal(node.getAttribute('role'), 'alert');
      assert.equal(node.getAttribute('data-mode'), 'memory-final');
    });
  });

  test('store-banner: memory → banner, idb → cleared, and only its own node', async () => {
    await withDom(async (doc) => {
      const app = fakeApp(doc, fakeRepo(doc, []));
      app.repo.mode = 'pending';
      installStoreBanner(app);
      assert.equal(app.els.banner.querySelectorAll('.chat-banner-store').length, 0, 'pending says nothing');

      // main.mjs owns this one; the store banner must never touch it (plan §2.6 J).
      const loader = doc.createElement('div');
      loader.className = 'chat-banner-loader';
      app.els.banner.appendChild(loader);

      app.bus.emit(EV.STORE_MODE, 'memory');
      const node = app.els.banner.querySelector('.chat-banner-store');
      assert.ok(node);
      assert.equal(node.textContent, t('store.memory'));
      assert.equal(node.getAttribute('role'), 'status');

      app.bus.emit(EV.STORE_MODE, 'memory');
      assert.equal(app.els.banner.querySelectorAll('.chat-banner-store').length, 1, 'one node, updated in place');

      app.bus.emit(EV.STORE_MODE, 'idb');
      assert.equal(app.els.banner.querySelectorAll('.chat-banner-store').length, 0, 'a late attach clears it');
      assert.equal(app.els.banner.querySelectorAll('.chat-banner-loader').length, 1, "the loader's banner survived");
    });
  });

  test('store-banner: without els.banner it installs quietly', async () => {
    await withDom(async (doc) => {
      const app = fakeApp(doc, fakeRepo(doc, []));
      app.els.banner = null;
      installStoreBanner(app);
      app.bus.emit(EV.STORE_MODE, 'memory');         // must not throw
      assert.ok(true);
    });
  });
};
