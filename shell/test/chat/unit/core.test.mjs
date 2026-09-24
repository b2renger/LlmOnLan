// Core contract tests (P0 kickoff): ids, hash, events, registry ordering, i18n, env RNG, the
// fakes' API surfaces against §3.4, the fake repo's tree behaviour, the skeleton layout and the
// drop guard (on the DOM shim), and the pure-module import trap.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newId, hash } from '../../../renderer/chat/core/ids.mjs';
import { EV, createBus } from '../../../renderer/chat/core/events.mjs';
import { SLOTS, createRegistry } from '../../../renderer/chat/core/registry.mjs';
import { registerStrings, t, missingKeys, hasKey } from '../../../renderer/chat/core/i18n.mjs';
import { mulberry32, now, rng, flags } from '../../../renderer/chat/core/env.mjs';
import { API_KEYS } from '../../../renderer/chat/core/types.mjs';
import * as fakes from '../../../renderer/chat/core/fakes.mjs';

const CORE = new URL('../../../renderer/chat/core/', import.meta.url);

export default (test) => {
  // ---------------------------------------------------------------- ids
  test('newId: 17 chars of base36, 9-char timestamp prefix', () => {
    const id = newId();
    assert.match(id, /^[0-9a-z]{17}$/);
    assert.equal(parseInt(id.slice(0, 9), 36), parseInt(newId({ now: parseInt(id.slice(0, 9), 36) }).slice(0, 9), 36));
  });
  test('newId: lexicographic order follows time', () => {
    const ids = [1, 2, 1000, 1_700_000_000_000, 1_789_420_302_332, 4_000_000_000_000].map((n) => newId({ now: n }));
    const sorted = ids.slice().sort();
    assert.deepEqual(sorted, ids);
    assert.equal(newId({ now: 1_789_420_302_332 }).slice(0, 9), (1_789_420_302_332).toString(36).padStart(9, '0'));
  });
  test('newId: injected rng is deterministic; default ids are unique', () => {
    const a = newId({ now: 5, rng: mulberry32(42) });
    const b = newId({ now: 5, rng: mulberry32(42) });
    assert.equal(a, b);
    const set = new Set(Array.from({ length: 5000 }, () => newId()));
    assert.equal(set.size, 5000);
  });
  test('hash: FNV-1a 32-bit known vectors, 8 hex chars', () => {
    assert.equal(hash(''), '811c9dc5');
    assert.equal(hash('a'), 'e40c292c');
    assert.equal(hash('foobar'), 'bf9cf968');
    assert.match(hash('ünïcödé ⏳'), /^[0-9a-f]{8}$/);
    assert.notEqual(hash('[{"role":"user"}]'), hash('[{"role":"user"} ]'));
  });

  // ---------------------------------------------------------------- env
  test('env: mulberry32 is deterministic and in [0,1); now/rng work without window', () => {
    const r1 = mulberry32(7), r2 = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const x = r1();
      assert.equal(x, r2());
      assert.ok(x >= 0 && x < 1);
    }
    assert.deepEqual({ ...flags }, {});
    assert.ok(Math.abs(now() - Date.now()) < 50);
    const x = rng();
    assert.ok(x >= 0 && x < 1);
  });

  // ---------------------------------------------------------------- events
  test('events: EV names are the §3.2 set', () => {
    assert.deepEqual(Object.keys(EV).sort(), ['BRANCH_SWITCH', 'DRAFT_CHANGE', 'FARM_CHANGE', 'FARM_TICK', 'GOV_CHANGE', 'MESSAGE_PUT',
      'REQUEST_PREVIEW', 'STORE_ERROR', 'STORE_MODE', 'STREAM_END', 'STREAM_START', 'THREADS_CHANGED', 'THREAD_SELECTED', 'VISIBLE']);
    assert.equal(EV.FARM_TICK, 'farm:tick');
    assert.equal(EV.STORE_MODE, 'store:mode');
    assert.ok(Object.isFrozen(EV));
  });
  test('bus: on/off/once, synchronous, snapshot semantics, throwing listener isolated', () => {
    const bus = createBus();
    const seen = [];
    const off = bus.on('x', (p) => seen.push(['a', p]));
    bus.once('x', (p) => seen.push(['once', p]));
    bus.on('x', () => { bus.on('x', () => seen.push(['late'])); });
    const origError = console.error;
    let errors = 0;
    console.error = () => { errors++; };
    try {
      bus.on('x', () => { throw new Error('boom'); });
      bus.on('x', (p) => seen.push(['after-throw', p]));
      bus.emit('x', 1);
    } finally {
      console.error = origError;
    }
    assert.deepEqual(seen, [['a', 1], ['once', 1], ['after-throw', 1]]);
    assert.equal(errors, 1);
    off();
    off();
    seen.length = 0;
    console.error = () => {};
    try { bus.emit('x', 2); } finally { console.error = origError; }
    assert.deepEqual(seen.map((s) => s[0]), ['after-throw', 'late']);
    bus.emit('nobody-listens', 3);
    assert.equal(bus.listenerCount('nobody-listens'), 0);
  });

  // ---------------------------------------------------------------- registry
  test('registry: SLOTS values are the §3.2 set', () => {
    assert.equal(Object.keys(SLOTS).length, 25);   // 21 + the 4 Studio slots (S0 kickoff)
    assert.equal(SLOTS.BEFORE_SEND, 'composer.beforeSend');
    assert.equal(SLOTS.REQUEST_TRANSFORMS, 'request.transforms');
    assert.equal(SLOTS.PART_RENDERERS, 'message.parts');
    assert.equal(SLOTS.NEW_MENU, 'sidebar.newMenu');
    assert.equal(SLOTS.CITATIONS, 'render.citations');
    assert.equal(new Set(Object.values(SLOTS)).size, 25);
    assert.equal(SLOTS.WORKBENCH_PANELS, 'workbench.panels');
  });
  test('registry: list sorts by (order ?? 500, id) and returns a copy', () => {
    const reg = createRegistry();
    reg.add(SLOTS.REQUEST_TRANSFORMS, { id: 'budget-trim', order: 800 });
    reg.add(SLOTS.REQUEST_TRANSFORMS, { id: 'zeta' });
    reg.add(SLOTS.REQUEST_TRANSFORMS, { id: 'recipe', order: 100 });
    reg.add(SLOTS.REQUEST_TRANSFORMS, { id: 'alpha' });
    reg.add(SLOTS.REQUEST_TRANSFORMS, { id: 'params-resolve', order: 250 });
    reg.add(SLOTS.REQUEST_TRANSFORMS, { id: 'neg', order: -1 });
    const ids = reg.list(SLOTS.REQUEST_TRANSFORMS).map((x) => x.id);
    assert.deepEqual(ids, ['neg', 'recipe', 'params-resolve', 'alpha', 'zeta', 'budget-trim']);
    const l = reg.list(SLOTS.REQUEST_TRANSFORMS);
    l.pop();
    assert.equal(reg.list(SLOTS.REQUEST_TRANSFORMS).length, 6);
    assert.equal(reg.first(SLOTS.REQUEST_TRANSFORMS).id, 'neg');
    assert.equal(reg.first(SLOTS.PALETTE), null);
    assert.deepEqual(reg.list(SLOTS.SHORTCUTS), []);
  });
  test('registry: unregister, duplicate ids, unknown slots, PART_RENDERERS keyed by type', () => {
    const reg = createRegistry();
    const un = reg.add(SLOTS.MESSAGE_ACTIONS, { id: 'copy', order: 10 });
    reg.add(SLOTS.MESSAGE_ACTIONS, { id: 'retry', order: 20 });
    assert.throws(() => reg.add(SLOTS.MESSAGE_ACTIONS, { id: 'copy' }), /duplicate id "copy"/);
    un();
    un();
    assert.deepEqual(reg.list(SLOTS.MESSAGE_ACTIONS).map((x) => x.id), ['retry']);
    reg.add(SLOTS.MESSAGE_ACTIONS, { id: 'copy', order: 30 });
    assert.deepEqual(reg.list(SLOTS.MESSAGE_ACTIONS).map((x) => x.id), ['retry', 'copy']);
    assert.throws(() => reg.add('composer.action', { id: 'x' }), /unknown slot/);
    assert.throws(() => reg.list('nope'), /unknown slot/);
    assert.throws(() => reg.add(SLOTS.PALETTE, { label: 'no id' }), /needs a string id/);
    reg.add(SLOTS.PART_RENDERERS, { type: 'image' });
    reg.add(SLOTS.PART_RENDERERS, { type: 'doc' });
    assert.throws(() => reg.add(SLOTS.PART_RENDERERS, { type: 'doc' }), /duplicate/);
    assert.deepEqual(reg.list(SLOTS.PART_RENDERERS).map((x) => x.type), ['doc', 'image']);
  });

  // ---------------------------------------------------------------- i18n
  test('i18n: placeholders, plurals, missing keys recorded', () => {
    registerStrings('coretest', { hello: 'Hello {name}, {name}!', keep: 'x {unknown} y', n: { one: '{count} chat', other: '{count} chats' }, 'group.today': 'Today' });
    assert.equal(t('coretest.hello', { name: 'Ada' }), 'Hello Ada, Ada!');
    assert.equal(t('coretest.keep', {}), 'x {unknown} y');
    assert.equal(t('coretest.n', { count: 1 }), '1 chat');
    assert.equal(t('coretest.n', { count: 3 }), '3 chats');
    assert.equal(t('coretest.group.today'), 'Today');
    assert.ok(hasKey('coretest.hello'));
    assert.equal(t('coretest.absent'), 'coretest.absent');
    assert.ok(missingKeys().includes('coretest.absent'));
    registerStrings('coretest', { absent: 'now here' });
    assert.ok(!missingKeys().includes('coretest.absent'));
    assert.throws(() => registerStrings('Bad NS', {}), /bad namespace/);
    assert.throws(() => registerStrings('coretest', { 'bad key': 'x' }), /bad key/);
    assert.throws(() => registerStrings('coretest', { k: 5 }), /must be a string/);
  });
  test('i18n: core strings are registered by the fakes/layout strings file', () => {
    assert.ok(hasKey('core.newChat'));
    assert.ok(hasKey('core.loaderFailed'));
    assert.equal(t('core.loaderFailed', { key: 'repo' }), 'Part of LOL Chat failed to load (repo).');
    assert.equal(t('core.stats', { tokens: 12, tokPerSec: '48.0', ttft: '0.25' }), '12 tok · 48.0 tok/s · first token 0.25s');
  });

  // ---------------------------------------------------------------- API surfaces
  test('API_KEYS.repo is exactly the §3.4 Repo key list', () => {
    const plan = ['mode', 'ready', 'listThreads', 'getThread', 'createThread', 'updateThread', 'deleteThread', 'getMessages', 'getPath',
      'appendMessage', 'putMessage', 'checkpoint', 'finalize', 'deleteSubtree', 'scanMessages', 'putAttachment', 'getAttachment',
      'listAttachments', 'deleteAttachment', 'listRecipes', 'putRecipe', 'deleteRecipe', 'findLegacy', 'kvGet', 'kvSet',
      'recoverInterrupted', 'flush', 'estimate', 'runTx', 'debug',
      // S0 kickoff (studio plan §3.6.2): the graphs + project-ref doors.
      'listGraphs', 'getGraph', 'putGraph', 'deleteGraph',
      'listProjectRefs', 'getProjectRef', 'putProjectRef', 'deleteProjectRef'];
    assert.deepEqual([...API_KEYS.repo].sort(), plan.slice().sort());
  });
  // K1 landing (COMPUTER_PLAN §11): the two coherence facts the landing is asked to ASSERT rather
  // than merely do, so neither can rot silently.
  test('API_KEYS.computerDebug is graphDebug plus exactly docId and open', () => {
    const graph = [...API_KEYS.graphDebug];
    const computer = [...API_KEYS.computerDebug];
    for (const key of graph) {
      assert.ok(computer.includes(key), `the Computer's door dropped ${key}, which graphDebug froze`);
    }
    assert.deepEqual(computer.filter((k) => !graph.includes(k)).sort(), ['docId', 'open'],
      'the standalone surface added a key without freezing it here');
    assert.equal(new Set(computer).size, computer.length, 'a key is listed twice');
  });

  test('css/graph.css is re-scoped to both surfaces: 123 selectors, and none left behind', () => {
    // The K1 kickoff's ONE mechanical edit (§3.2): `#lolchat ` -> `:is(#lolchat, #lolcomputer) `.
    // The count is asserted because the rewrite is what makes the SAME canvas paint on the new
    // surface; a rule missed here is a piece of the Computer that is simply invisible. The two
    // remaining `#lolchat ` hits are in the file's own header comment, explaining the rewrite.
    const css = fs.readFileSync(new URL('../../../renderer/chat/css/graph.css', import.meta.url), 'utf8');
    const scoped = css.match(/:is\(#lolchat, #lolcomputer\) /g) || [];
    // K2-U1 raised it from the K1 landing's 106 to 120: the 14 rules of the wire label pill
    // (COMPUTER_PLAN §5.1, §8.2). The K2 LANDING added one: `.graph-ins-strip`, which had to stop
    // sharing `.graph-value` — one selector must not open two doors. The COUNT is a snapshot that
    // moves whenever the sheet honestly grows; the assertion below it — that no `#lolchat `
    // selector survived — is the guarantee, and it is untouched.
    // The K3 landing added two: `input[type="checkbox"]` and `.graph-part-check`'s
    // `justify-content` — a checkbox was inheriting the 100 % width meant for a text field, so
    // every control part's switches rendered as full-width lanes with the caption crushed right.
    // Critic R1 (Package B) added 39: the resize handle, the exact-height body (K-3), the plugged
    // input, the wire hover and its ✕, the Select/Hand tools, the zoom cluster and its menu, and
    // the right-click menu.
    assert.equal(scoped.length, 162, `the graph.css re-scope is ${scoped.length} selectors, not 162`);
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal((body.match(/#lolchat /g) || []).length, 0,
      'a `#lolchat ` selector survived the re-scope: that rule paints in the chat and nowhere else');
    // base.css and sandbox.css are deliberately NOT rewritten (§3.2): `.chat-layer` is what makes
    // `.hidden` work outside #lolchat, and sandbox.css never had a #lolchat selector at all.
    const sandbox = fs.readFileSync(new URL('../../../renderer/chat/css/sandbox.css', import.meta.url), 'utf8');
    assert.equal((sandbox.match(/#lolchat/g) || []).length, 0, 'sandbox.css grew a #lolchat selector');
  });

  test('fake repo API surface matches §3.4 by key list', () => {
    const repo = fakes.repo({});
    assert.deepEqual(Object.keys(repo).sort(), [...API_KEYS.repo].sort());
    assert.deepEqual(Object.keys(repo.debug).sort(), [...API_KEYS.repoDebug].sort());
    assert.ok(repo.ready instanceof Promise);
  });
  test('every fake matches its API_KEYS list', () => {
    const bus = createBus();
    const el = () => globalThis.__chatTestDom.createElement('div');
    const els = { messages: el(), list: el(), model: el(), empty: el(), jump: el(), live: el(), form: el(), input: el(), send: el(), stop: el(), newBtn: el(), above: el(), tray: el(), tools: el(), meter: el() };
    const app = { bus, els, root: el(), now: Date.now, state: { threadId: null }, repo: null };
    const built = {
      farm: fakes.farm(app), gov: fakes.gov(app), controller: fakes.controller(app), view: fakes.view(app, els.messages),
      composer: fakes.composer(app, els), picker: fakes.picker(app, els.model), sidebar: fakes.sidebar(app, els.list), dialogs: fakes.dialogs(app),
    };
    for (const [k, obj] of Object.entries(built)) {
      assert.deepEqual(Object.keys(obj).sort(), [...API_KEYS[k]].sort(), `fake ${k}`);
    }
  });
  test('fake repo: sync create/append, path, headId, deleteSubtree repair, legacy lookup, kv, recover', async () => {
    const bus = createBus();
    const changes = [];
    bus.on(EV.THREADS_CHANGED, (p) => changes.push(p.reason));
    let clock = 1000;
    const repo = fakes.repo({ bus, now: () => clock++ });
    const th = repo.createThread({ legacyId: 'L1', legacyHash: 'abcd1234' });
    assert.equal(typeof th.id, 'string');
    const u = repo.appendMessage(th.id, { role: 'user', content: 'hi' });
    const a = repo.appendMessage(th.id, { role: 'assistant', content: 'yo', status: 'streaming' });
    assert.equal(a.parentId, u.id);
    assert.equal((await repo.getThread(th.id)).headId, a.id);
    assert.deepEqual((await repo.getPath(th.id)).map((m) => m.id), [u.id, a.id]);
    assert.deepEqual((await repo.getPath(th.id, u.id)).map((m) => m.id), [u.id]);
    assert.equal(await repo.recoverInterrupted(), 1);
    assert.equal((await repo.getPath(th.id))[1].status, 'interrupted');
    const res = await repo.deleteSubtree(a.id);
    assert.deepEqual(res, { removed: [a.id], headId: u.id });
    assert.equal((await repo.findLegacy('L1', 'abcd1234')).id, th.id);
    assert.equal(await repo.findLegacy('L1', 'other'), null);
    assert.equal(await repo.kvGet('missing', 'fb'), 'fb');
    await repo.kvSet('k', { a: 1 });
    assert.deepEqual(await repo.kvGet('k'), { a: 1 });
    const id1 = await repo.putAttachment({ threadId: th.id, sha256: 'x', name: 'a.png' });
    const id2 = await repo.putAttachment({ threadId: th.id, sha256: 'x', name: 'b.png' });
    assert.equal(id1, id2);
    await repo.deleteThread(th.id);
    assert.deepEqual(await repo.listThreads(), []);
    assert.deepEqual(changes, ['create', 'delete']);
  });
  test('fake farm: FARM_TICK on every update, FARM_CHANGE only when caps change, Bearer header', () => {
    const bus = createBus();
    const ticks = [], changes = [];
    bus.on(EV.FARM_TICK, (p) => ticks.push(p));
    bus.on(EV.FARM_CHANGE, (p) => changes.push(p));
    const farm = fakes.farm({ bus, now: () => 42 });
    const bridge = { name: 'Mock', openaiBaseUrl: 'http://127.0.0.1:4009/v1', defaultModel: 'assistant', busy: null, apiKey: null };
    farm.update(bridge);
    farm.update({ ...bridge });
    farm.update({ ...bridge, apiKey: 'pw' });
    assert.equal(ticks.length, 3);
    assert.equal(ticks[0].now, 42);
    assert.equal(changes.length, 2);
    assert.ok(changes[1].changed.includes('apiKey'));
    assert.deepEqual(farm.headers(), { authorization: 'Bearer pw' });
    farm.update(null);
    assert.equal(farm.get().present, false);
    assert.deepEqual(farm.headers(), {});
  });

  // ---------------------------------------------------------------- layout + drop guard (DOM shim)
  test('layout: skeleton has every D-4 id/class and the §3.5 Els keys; jump is last in messages', async () => {
    const doc = globalThis.__chatTestDom.createDocument();
    const prev = globalThis.document;
    globalThis.document = doc;
    try {
      const { buildLayout } = await import('../../../renderer/chat/ui/layout.mjs');
      const root = doc.createElement('section');
      root.id = 'lolchat';
      root.appendChild(doc.createElement('p')).className = 'chat-fallback';
      const els = buildLayout(root);
      assert.equal(root.querySelector('.chat-fallback'), null);
      const keys = ['root', 'side', 'sideHead', 'newBtn', 'sideTools', 'list', 'sideFoot', 'main', 'banner', 'topline', 'header', 'model',
        'strip', 'messages', 'jump', 'empty', 'form', 'above', 'tray', 'tools', 'input', 'meter', 'send', 'stop', 'live',
        // S0 kickoff: the workbench column, built empty and hidden (studio plan 3.5.1).
        'work', 'workRail', 'workHead', 'workBody'];
      assert.deepEqual(Object.keys(els).sort(), keys.slice().sort());
      for (const k of keys) assert.ok(els[k], `els.${k}`);
      const byId = (id) => root.querySelector('#' + id);
      for (const id of ['chat-threads', 'chat-messages', 'chat-form', 'chat-input', 'chat-send', 'chat-stop', 'chat-model', 'chat-new', 'chat-empty']) {
        assert.ok(byId(id), `#${id}`);
      }
      assert.equal(els.newBtn, byId('chat-new'));
      assert.ok(els.newBtn.classList.contains('btn-accent'));
      assert.equal(els.send.getAttribute('type'), 'submit');
      assert.ok(els.stop.classList.contains('hidden'));
      assert.equal(els.stop.getAttribute('type'), 'button');
      assert.equal(els.input.localName, 'textarea');
      assert.equal(els.model.localName, 'select');
      assert.equal(els.messages.lastChild, els.jump);
      assert.ok(els.jump.classList.contains('hidden'));
      assert.equal(els.live.getAttribute('aria-live'), 'polite');
      assert.ok(els.live.classList.contains('visually-hidden'));
      assert.equal(els.newBtn.parentNode, els.sideHead);
      assert.ok(root.querySelector('.chat-main .chat-topline .chat-thread-header'));
      assert.ok(root.querySelector('form.chat-form .chat-composer-row textarea'));
      assert.deepEqual(root.children.map((c) => c.className),
        ['chat-side', 'chat-main', 'chat-work hidden', 'chat-live visually-hidden']);
      // The workbench column is built EMPTY and hidden (S0 kickoff): ui/workbench.mjs fills it.
      assert.deepEqual(els.work.children.map((c) => c.className), ['chat-work-rail', 'chat-work-head', 'chat-work-body']);
      assert.equal(els.workBody.children.length, 0);
      assert.equal(els.send.textContent, 'Send');
    } finally {
      globalThis.document = prev;
    }
  });
  test('main.mjs loads the development fakes on demand, never as a production import', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../../renderer/chat/main.mjs', import.meta.url), 'utf8');
    // A static import would fetch, parse and RUN ~20 KB of second implementation on every real
    // boot, and a top-level error in it would take the whole mount down with it.
    assert.equal(/^\s*import\s[^\n]*fakes\.mjs/m.test(src), false, 'fakes.mjs must not be statically imported');
    assert.ok(/await import\(['"]\.\/core\/fakes\.mjs['"]\)/.test(src), 'fakes.mjs must be imported dynamically');
    // …and only when the harness asked for them.
    const at = src.indexOf('await import(\'./core/fakes.mjs\')');
    assert.ok(/flags\.allowFakes/.test(src.slice(Math.max(0, at - 400), at)), 'the dynamic import must be behind flags.allowFakes');
  });

  test('drop guard: preventDefault only, never stopPropagation; idempotent; uninstall', async () => {
    const { installDropGuard } = await import('../../../renderer/chat/ui/layout.mjs');
    const listeners = new Map();
    const doc = {
      addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
      removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)),
    };
    const off = installDropGuard(doc);
    assert.equal(installDropGuard(doc), off);
    for (const type of ['dragover', 'drop']) {
      assert.equal((listeners.get(type) || []).length, 1);
      let prevented = 0, stopped = 0;
      const ev = { type, preventDefault: () => prevented++, stopPropagation: () => stopped++, stopImmediatePropagation: () => stopped++ };
      listeners.get(type)[0](ev);
      assert.equal(prevented, 1);
      assert.equal(stopped, 0);
    }
    off();
    assert.equal(listeners.get('drop').length, 0);
  });

  // ---------------------------------------------------------------- purity
  test('pure core modules import with window/document/localStorage/indexedDB trapped', async () => {
    const names = ['window', 'document', 'localStorage', 'indexedDB'];
    const saved = names.map((n) => Object.getOwnPropertyDescriptor(globalThis, n));
    for (const n of names) {
      Object.defineProperty(globalThis, n, { configurable: true, get() { throw new Error(`pure module touched ${n}`); } });
    }
    try {
      for (const file of ['ids.mjs', 'events.mjs', 'registry.mjs', 'i18n.mjs', 'types.mjs']) {
        const mod = await import(new URL(file + '?trap=' + Date.now(), CORE).href);
        assert.ok(Object.keys(mod).length > 0, file);
      }
      const ids = await import(new URL('ids.mjs?trap2=' + Date.now(), CORE).href);
      ids.hash(ids.newId());
      const ev = await import(new URL('events.mjs?trap2=' + Date.now(), CORE).href);
      ev.createBus().emit('x', 1);
      const reg = await import(new URL('registry.mjs?trap2=' + Date.now(), CORE).href);
      reg.createRegistry().list(reg.SLOTS.PALETTE);
    } finally {
      names.forEach((n, i) => {
        if (saved[i]) Object.defineProperty(globalThis, n, saved[i]);
        else delete globalThis[n];
      });
    }
  });
};
