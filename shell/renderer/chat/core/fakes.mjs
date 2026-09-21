// @ts-check
// Development fakes for the loader (plan §3.1). NEVER used in production: main.mjs only reaches
// for them when `flags.allowFakes` is true (the harness default; off with --strict).
//
// Each named export has the SAME signature as the real factory it stands in for, and returns an
// object with the §3.4 API keys (see API_KEYS in core/types.mjs; core.test.mjs checks the lists):
//   repo(opts)              ↔ state/repo.mjs        openRepoSync(opts)
//   farm(app)               ↔ net/farm.mjs          createFarmModel(app)
//   gov(app)                ↔ net/governor.mjs      createGovernor(app)
//   dialogs(app)            ↔ ui/dialogs.mjs        createDialogs(app)
//   view(app, el)           ↔ render/thread-view.mjs createThreadView(app, els.messages)
//   sidebar(app, el)        ↔ ui/sidebar.mjs        createSidebar(app, els.list)
//   composer(app, els)      ↔ ui/composer.mjs       createComposer(app, els)
//   picker(app, selectEl)   ↔ ui/model-picker.mjs   createModelPicker(app, els.model)
//   controller(app)         ↔ app/controller.mjs    createController(app)
// They are deliberately small and plain: text-only rendering, no markdown, no IndexedDB.

import { EV } from './events.mjs';
import { t } from './i18n.mjs';
import { newId as makeId } from './ids.mjs';
import '../strings/core.en.mjs';

// -------------------------------------------------------------------------------------------
// repo — in-memory, same API surface as state/repo.mjs. mode is 'memory-final' (honest: nothing
// is persisted), ready is already resolved.
// -------------------------------------------------------------------------------------------

/** @param {any} [opts] */
export function repo(opts = {}) {
  const bus = opts.bus || null;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const nid = typeof opts.newId === 'function' ? opts.newId : () => makeId({ now });
  /** @type {Map<string, any>} */ const threads = new Map();
  /** @type {Map<string, any>} */ const messages = new Map();
  /** @type {Map<string, any>} */ const attachments = new Map();
  /** @type {Map<string, any>} */ const recipes = new Map();
  /** @type {Map<string, any>} */ const kv = new Map();
  /** @type {Map<string, any>} */ const graphs = new Map();          // S0 kickoff
  /** @type {Map<string, any>} */ const projectRefs = new Map();     // S0 kickoff
  const clone = (/** @type {any} */ x) => (x == null ? x : structuredClone(x));
  const emit = (/** @type {string} */ name, /** @type {any} */ p) => { if (bus) bus.emit(name, p); };

  /** @param {string} threadId @param {string|null|undefined} headId */
  function path(threadId, headId) {
    const th = threads.get(threadId);
    let id = headId === undefined ? (th ? th.headId : null) : headId;
    const out = [];
    const seen = new Set();
    while (id && messages.has(id) && !seen.has(id)) {
      seen.add(id);
      const m = messages.get(id);
      out.push(clone(m));
      id = m.parentId;
    }
    return out.reverse();
  }

  const api = {
    mode: /** @type {'pending'|'idb'|'memory'|'memory-final'} */ ('memory-final'),
    ready: Promise.resolve(),
    async listThreads() {
      return [...threads.values()].map(clone).sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (b.updatedAt - a.updatedAt));
    },
    async getThread(/** @type {string} */ id) { return clone(threads.get(id) || null); },
    createThread(/** @type {any} */ init = {}) {
      const ts = now();
      const th = {
        id: nid(), title: t('core.newChat'), titleSource: 'auto', createdAt: ts, updatedAt: ts, headId: null,
        pinned: false, ephemeral: false, recipeId: null, systemOverride: null, params: null, model: null,
        modelSource: null, farmId: null, draft: null, ...init,
      };
      threads.set(th.id, th);
      emit(EV.THREADS_CHANGED, { reason: 'create', ids: [th.id] });
      return clone(th);
    },
    async updateThread(/** @type {string} */ id, /** @type {any} */ patch) {
      const th = threads.get(id);
      if (!th) return null;
      Object.assign(th, patch, { id });
      emit(EV.THREADS_CHANGED, { reason: 'update', ids: [id] });
      return clone(th);
    },
    async deleteThread(/** @type {string} */ id) {
      threads.delete(id);
      for (const [mid, m] of messages) if (m.threadId === id) messages.delete(mid);
      for (const [aid, a] of attachments) if (a.threadId === id) attachments.delete(aid);
      emit(EV.THREADS_CHANGED, { reason: 'delete', ids: [id] });
    },
    async getMessages(/** @type {string} */ threadId) {
      return [...messages.values()].filter((m) => m.threadId === threadId).map(clone);
    },
    async getPath(/** @type {string} */ threadId, /** @type {string|null|undefined} */ headId) { return path(threadId, headId); },
    appendMessage(/** @type {string} */ threadId, /** @type {any} */ partial = {}) {
      const th = threads.get(threadId);
      const ts = now();
      const m = {
        id: nid(), threadId, parentId: th ? th.headId : null, role: 'user', createdAt: ts, updatedAt: ts,
        parts: [], content: '', reasoning: null, reasoningMs: null, sawToolCalls: false, model: null,
        underlying: null, farmName: null, farmId: null, params: null, recipeId: null, stats: null,
        status: 'done', error: null, pinned: false, ...partial,
      };
      if (m.parentId === undefined) m.parentId = null;
      messages.set(m.id, m);
      if (th) { th.headId = m.id; th.updatedAt = ts; }
      return clone(m);
    },
    async putMessage(/** @type {any} */ msg) { messages.set(msg.id, clone(msg)); },
    checkpoint(/** @type {any} */ msg) { messages.set(msg.id, clone(msg)); },
    async finalize(/** @type {any} */ msg) { messages.set(msg.id, clone(msg)); },
    async deleteSubtree(/** @type {string} */ messageId) {
      const root = messages.get(messageId);
      if (!root) return { removed: [], headId: null };
      const removed = [messageId];
      for (let i = 0; i < removed.length; i++) {
        for (const m of messages.values()) if (m.parentId === removed[i]) removed.push(m.id);
      }
      for (const id of removed) messages.delete(id);
      const th = threads.get(root.threadId);
      let headId = th ? th.headId : null;
      if (th && (headId == null || removed.includes(headId))) { headId = root.parentId || null; th.headId = headId; }
      return { removed, headId };
    },
    async scanMessages(/** @type {(m: any) => any} */ visitor) {
      for (const m of [...messages.values()]) if (visitor(clone(m)) === false) break;
    },
    async putAttachment(/** @type {any} */ att) {
      for (const a of attachments.values()) if (a.threadId === att.threadId && a.sha256 && a.sha256 === att.sha256) return a.id;
      const id = att.id || nid();
      attachments.set(id, { ...att, id });
      return id;
    },
    async getAttachment(/** @type {string} */ id) { return attachments.get(id) || null; },
    async listAttachments(/** @type {string} */ threadId) { return [...attachments.values()].filter((a) => a.threadId === threadId); },
    async deleteAttachment(/** @type {string} */ id) { attachments.delete(id); },
    // S0 kickoff: the two Studio stores. The fake keeps them in Maps like every other record.
    async listGraphs(/** @type {string|undefined} */ threadId) {
      return [...graphs.values()].filter((g) => !threadId || g.threadId === threadId).map(clone);
    },
    async getGraph(/** @type {string} */ id) { return graphs.has(id) ? clone(graphs.get(id)) : null; },
    async putGraph(/** @type {any} */ doc) { graphs.set(doc.id, clone(doc)); },
    async deleteGraph(/** @type {string} */ id) { graphs.delete(id); },
    async listProjectRefs(/** @type {string|undefined} */ threadId) {
      return [...projectRefs.values()].filter((r) => !threadId || r.threadId === threadId).map(clone);
    },
    async getProjectRef(/** @type {string} */ id) { return projectRefs.has(id) ? clone(projectRefs.get(id)) : null; },
    async putProjectRef(/** @type {any} */ ref) { projectRefs.set(ref.id, clone(ref)); },
    async deleteProjectRef(/** @type {string} */ id) { projectRefs.delete(id); },
    async listRecipes() { return [...recipes.values()].map(clone); },
    async putRecipe(/** @type {any} */ r) { recipes.set(r.id, clone(r)); },
    async deleteRecipe(/** @type {string} */ id) { recipes.delete(id); },
    async findLegacy(/** @type {string} */ legacyId, /** @type {string} */ legacyHash) {
      for (const th of threads.values()) if (th.legacyId === legacyId && th.legacyHash === legacyHash) return clone(th);
      return null;
    },
    async kvGet(/** @type {string} */ key, /** @type {any} */ fallback) { return kv.has(key) ? clone(kv.get(key)) : fallback; },
    async kvSet(/** @type {string} */ key, /** @type {any} */ value) { kv.set(key, clone(value)); },
    async recoverInterrupted() {
      let n = 0;
      for (const m of messages.values()) if (m.status === 'streaming') { m.status = 'interrupted'; n++; }
      return n;
    },
    async flush() {},
    async estimate() { return null; },
    async runTx(/** @type {string[]} */ _stores, /** @type {string} */ _mode, /** @type {(tx: any) => any} */ fn) { return fn(api); },
    debug: { journalLength: () => 0, persistentIds: () => /** @type {string[]} */ ([]) },
  };
  return api;
}

// -------------------------------------------------------------------------------------------
// farm — minimal capsFromBridge (baseUrl, apiKey, defaultModel, busy) + the model API surface.
// -------------------------------------------------------------------------------------------

/** @param {any} b @returns {import('./types.mjs').FarmCaps} */
function fakeCaps(b) {
  const present = !!(b && b.openaiBaseUrl);
  const busy = b && b.busy && b.busy.label ? { label: String(b.busy.label), percent: b.busy.percent ?? null } : null;
  const apiKey = (b && b.apiKey) || null;
  return {
    present, id: (b && b.id) || null, name: (b && b.name) || null, baseUrl: present ? b.openaiBaseUrl : null,
    proxyRoot: present ? String(b.openaiBaseUrl).replace(/\/v1\/?$/, '') : null, apiKey,
    requiresKey: !!(b && b.requiresKey), keyMissing: !!(b && b.requiresKey && !apiKey), healthy: !(b && b.healthy === false),
    stale: !!(b && b.stale), lastSeen: (b && b.lastSeen) || null, defaultModel: (b && b.defaultModel) || null,
    models: (b && Array.isArray(b.models)) ? b.models : [], engine: null,
    budget: { tokens: 8192, advertised: null, source: 'default' }, seats: null, busy, perf: null, gpuUtil: null,
    search: null, tts: null, ocr: null,
  };
}

/** @param {import('./types.mjs').App} app */
export function farm(app) {
  let caps = fakeCaps(null);
  let key = JSON.stringify(caps);
  return {
    update(/** @type {any} */ bridge) {
      const prev = caps;
      const next = fakeCaps(bridge);
      const nextKey = JSON.stringify(next);
      caps = next;
      if (nextKey !== key) {
        key = nextKey;
        const changed = Object.keys(next).filter((k) => JSON.stringify(/** @type {any} */ (next)[k]) !== JSON.stringify(/** @type {any} */ (prev)[k]));
        app.bus.emit(EV.FARM_CHANGE, { caps, prev, changed });
      }
      app.bus.emit(EV.FARM_TICK, { caps, now: app.now() });
    },
    get() { return caps; },
    headers() { return caps.apiKey ? { authorization: `Bearer ${caps.apiKey}` } : {}; },
    async fetchModels() {
      if (!caps.baseUrl) return { ids: [], state: 'no-farm' };
      try {
        const r = await fetch(caps.baseUrl + '/models', { headers: this.headers() });
        if (r.status === 400 || r.status === 401 || r.status === 403) return { ids: [], state: 'auth' };
        const j = await r.json();
        const ids = ((j && j.data) || []).map((/** @type {any} */ m) => m.id);
        return { ids, state: ids.length ? 'ok' : 'no-models' };
      } catch {
        return { ids: [], state: 'unreachable' };
      }
    },
    modelInfo(/** @type {string} */ id) { return caps.models.find((m) => m.id === id) || null; },
    setCapResolver() {},
    cap() { return 'unknown'; },
  };
}

// -------------------------------------------------------------------------------------------
// gov — one foreground slot.
// -------------------------------------------------------------------------------------------

/** @param {import('./types.mjs').App} app */
export function gov(app) {
  /** @type {{foreground: 'idle'|'streaming'|'held', holder: string|null}} */
  let st = { foreground: 'idle', holder: null };
  /** @type {Set<Function>} */ const subs = new Set();
  const set = (/** @type {any} */ next) => {
    st = next;
    app.bus.emit(EV.GOV_CHANGE, { ...st });
    for (const fn of subs) fn({ ...st });
  };
  return {
    canStart() { return st.foreground === 'idle'; },
    acquire(/** @type {string} */ _kind, /** @type {any} */ o = {}) {
      if (st.foreground !== 'idle') return null;
      const holder = o.holder || 'send';
      set({ foreground: 'streaming', holder });
      let done = false;
      return () => { if (!done && st.holder === holder && st.foreground === 'streaming') { done = true; set({ foreground: 'idle', holder: null }); } };
    },
    hold(/** @type {string} */ holder) { set({ foreground: 'held', holder }); },
    release(/** @type {string} */ holder) { if (st.holder === holder) set({ foreground: 'idle', holder: null }); },
    state() { return { ...st }; },
    onChange(/** @type {Function} */ fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

// -------------------------------------------------------------------------------------------
// dialogs — non-blocking stubs (a hidden harness window must never block on window.confirm).
// -------------------------------------------------------------------------------------------

/** @param {import('./types.mjs').App} app */
export function dialogs(app) {
  return {
    async confirm() { return true; },
    async prompt(/** @type {any} */ o = {}) { return o.value ?? ''; },
    popover(/** @type {HTMLElement} */ _anchor, /** @type {(el: HTMLElement) => void} */ build) {
      const el = document.createElement('div');
      el.className = 'chat-popover';
      build(el);
      app.root.appendChild(el);
      return { close() { el.remove(); } };
    },
    toast(/** @type {string} */ text) { app.els.live.textContent = String(text); },
  };
}

// -------------------------------------------------------------------------------------------
// view — plain-text rows with the §3.5 message-row classes.
// -------------------------------------------------------------------------------------------

/** @param {import('./types.mjs').App} app @param {HTMLElement} el */
export function view(app, el) {
  /** @type {Map<string, HTMLElement>} */ const rows = new Map();

  /** @param {any} msg */
  function fill(row, msg) {
    row.className = `chat-msg ${msg.role}`;
    row.dataset.id = msg.id;
    row.dataset.status = msg.status;
    const parts = document.createElement('div'); parts.className = 'chat-msg-parts';
    const body = document.createElement('div'); body.className = 'chat-body';
    body.textContent = msg.content || '';
    const note = document.createElement('div'); note.className = 'chat-msg-note';
    if (msg.error && msg.error.message) note.textContent = msg.error.message;
    const foot = document.createElement('div'); foot.className = 'chat-msg-foot';
    /** @type {Node[]} */ const kids = [parts];
    if (msg.reasoning) {
      const d = document.createElement('details'); d.className = 'chat-reasoning';
      const s = document.createElement('summary'); s.textContent = t('core.reasoning');
      const rb = document.createElement('div'); rb.className = 'chat-reasoning-body'; rb.textContent = msg.reasoning;
      d.append(s, rb);
      kids.push(d);
    }
    kids.push(body, note);
    if ((msg.status === 'done' || msg.status === 'aborted') && msg.stats && msg.stats.text) {
      const st = document.createElement('div'); st.className = 'chat-stats'; st.textContent = msg.stats.text;
      foot.appendChild(st);
    }
    kids.push(foot);
    row.replaceChildren(...kids);
  }

  function place(/** @type {HTMLElement} */ row) {
    const jump = app.els.jump;
    if (jump && jump.parentNode === el) el.insertBefore(row, jump); else el.appendChild(row);
  }

  const api = {
    showPath(/** @type {any} */ _thread, /** @type {any[]} */ path) {
      for (const r of rows.values()) r.remove();
      rows.clear();
      for (const m of path || []) api.upsert(m);
      app.els.empty.classList.toggle('hidden', !!(path && path.length));
    },
    upsert(/** @type {any} */ msg) {
      let row = rows.get(msg.id);
      if (!row) { row = document.createElement('div'); rows.set(msg.id, row); place(row); }
      fill(row, msg);
      app.els.empty.classList.add('hidden');
      el.scrollTop = el.scrollHeight;
    },
    remove(/** @type {string[]} */ ids) { for (const id of ids) { const r = rows.get(id); if (r) r.remove(); rows.delete(id); } },
    beginStream(/** @type {string} */ msgId) {
      let raf = 0; let content = ''; let reasoning = /** @type {string|null} */ (null);
      const paint = () => {
        raf = 0;
        const row = rows.get(msgId);
        if (!row) return;
        const body = row.querySelector('.chat-body');
        if (body) body.textContent = content;
        if (reasoning) {
          let rb = row.querySelector('.chat-reasoning-body');
          if (!rb) {
            const d = document.createElement('details'); d.className = 'chat-reasoning';
            const s = document.createElement('summary'); s.textContent = t('core.reasoning');
            rb = document.createElement('div'); rb.className = 'chat-reasoning-body';
            d.append(s, rb);
            row.insertBefore(d, body);
          }
          rb.textContent = reasoning;
        }
        el.scrollTop = el.scrollHeight;
      };
      return {
        paint(/** @type {string} */ c, /** @type {string|null} */ r) { content = c; reasoning = r; if (!raf) raf = requestAnimationFrame(paint); },
        setStatus(/** @type {string} */ s) { const row = rows.get(msgId); if (row) row.dataset.status = s; },
        end(/** @type {any} */ msg) { if (raf) cancelAnimationFrame(raf); raf = 0; api.upsert(msg); },
      };
    },
    scrollToMessage(/** @type {string} */ id) { const r = rows.get(id); if (r) r.scrollIntoView({ block: 'nearest' }); },
    isStuck() { return true; },
    setOutsideContext() {},
    rowOf(/** @type {string} */ id) { return rows.get(id) || null; },
    debug: {
      paintStats: () => ({ count: 0, p50: 0, p95: 0, max: 0 }),
      renderOneShot: (/** @type {string} */ md) => { const d = document.createElement('div'); d.textContent = md; return d; },
    },
  };
  return api;
}

// -------------------------------------------------------------------------------------------
// sidebar — thread buttons.
// -------------------------------------------------------------------------------------------

/** @param {import('./types.mjs').App} app @param {HTMLElement} el */
export function sidebar(app, el) {
  let seq = 0;
  const api = {
    render() {
      const mine = ++seq;
      if (!app.repo) { el.replaceChildren(); return; }
      app.repo.listThreads().then((list) => {
        if (mine !== seq) return;
        el.replaceChildren(...list.map((th) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chat-thread' + (th.id === app.state.threadId ? ' active' : '');
          b.dataset.id = th.id;
          b.textContent = th.title;
          b.addEventListener('click', () => { if (app.controller) app.controller.selectThread(th.id); });
          return b;
        }));
      });
    },
    highlight(/** @type {string|null} */ threadId) {
      for (const b of el.querySelectorAll('.chat-thread')) b.classList.toggle('active', /** @type {HTMLElement} */ (b).dataset.id === threadId);
    },
  };
  app.bus.on(EV.THREADS_CHANGED, () => api.render());
  app.bus.on(EV.THREAD_SELECTED, (p) => api.highlight(p && p.threadId));
  return api;
}

// -------------------------------------------------------------------------------------------
// picker — fills #chat-model from farm.fetchModels on FARM_CHANGE.
// -------------------------------------------------------------------------------------------

/** @param {import('./types.mjs').App} app @param {HTMLSelectElement} selectEl */
export function picker(app, selectEl) {
  const PLACEHOLDER = { 'no-farm': 'core.noFarm', 'no-models': 'core.noModels', unreachable: 'core.unreachable', auth: 'core.passwordRefused' };
  let from = /** @type {string|null} */ (null);
  const api = {
    value() { return selectEl.value; },
    set(/** @type {string} */ id) { selectEl.value = id; },
    async refresh(/** @type {any} */ o = {}) {
      if (!app.farm) return;
      const caps = app.farm.get();
      const sig = `${caps.baseUrl}|${caps.apiKey}`;
      if (!o.force && sig === from && selectEl.value) return;
      const res = await app.farm.fetchModels({ force: !!o.force });
      if (res.state !== 'ok') {
        from = null;
        selectEl.replaceChildren(new Option(t(/** @type {any} */ (PLACEHOLDER)[res.state] || 'core.unreachable'), ''));
        return;
      }
      const prev = selectEl.value;
      selectEl.replaceChildren(...res.ids.map((id) => new Option(id, id)));
      const def = caps.defaultModel;
      selectEl.value = res.ids.includes(prev) ? prev : (def && res.ids.includes(def) ? def : res.ids[0]);
      from = sig;
    },
  };
  app.bus.on(EV.FARM_CHANGE, () => { api.refresh(); });
  // First tick fills the placeholder even when the farm never changes (e.g. 'no farm' at boot).
  app.bus.once(EV.FARM_TICK, () => { if (!selectEl.options.length) api.refresh(); });
  return api;
}

// -------------------------------------------------------------------------------------------
// composer — binds #chat-form submit + Enter to controller.send({text}).
// -------------------------------------------------------------------------------------------

/** @param {import('./types.mjs').App} app @param {import('./types.mjs').Els} els */
export function composer(app, els) {
  /** @type {Map<string, Set<Function>>} */ const subs = new Map();
  const fire = (/** @type {string} */ ev, /** @type {any} */ p) => { for (const fn of subs.get(ev) || []) fn(p); };
  let locked = false;
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (locked) return;
    const text = els.input.value.trim();
    if (!text || !app.controller) return;
    const draft = api.getDraft();
    els.input.value = '';
    fire('submit', draft);
    app.controller.send(draft);
  });
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); els.form.requestSubmit(); }
  });
  els.input.addEventListener('input', () => fire('input', api.getDraft()));
  const api = {
    getDraft() { return { text: els.input.value.trim(), parts: [], model: app.picker ? app.picker.value() : els.model.value }; },
    setText(/** @type {string} */ s) { els.input.value = s; },
    insertText(/** @type {string} */ s) { els.input.value += s; },
    clear() { els.input.value = ''; },
    focus() { els.input.focus(); },
    addPart() { return ''; },
    updatePart() {},
    removePart() {},
    setBusy(/** @type {any} */ on) {
      els.send.classList.toggle('hidden', !!on);
      els.stop.classList.toggle('hidden', !on);
    },
    setSendState(/** @type {any} */ s) { els.send.textContent = s.label; els.send.disabled = !!s.disabled; },
    isLocked() { return locked; },
    region(/** @type {'above'|'tray'|'tools'|'meter'} */ name) { return els[name]; },
    on(/** @type {string} */ ev, /** @type {Function} */ fn) {
      const set = subs.get(ev) || new Set(); set.add(fn); subs.set(ev, set);
      return () => set.delete(fn);
    },
  };
  els.stop.addEventListener('click', () => { if (app.controller) app.controller.stop(); });
  els.newBtn.addEventListener('click', () => { if (app.controller) app.controller.newThread(); });
  return api;
}

// -------------------------------------------------------------------------------------------
// controller — fetch + line-split SSE into view.beginStream; busy label, Bearer, stats format.
// -------------------------------------------------------------------------------------------

/** @param {import('./types.mjs').App} app */
export function controller(app) {
  /** @type {AbortController|null} */ let abort = null;

  const api = {
    newThread(/** @type {any} */ init) {
      const th = app.repo ? app.repo.createThread(init) : null;
      app.bus.emit(EV.THREAD_SELECTED, { threadId: th ? th.id : null });
      if (app.view) app.view.showPath(th, []);
      if (app.sidebar) app.sidebar.render();
      return th;
    },
    async selectThread(/** @type {string|null} */ id) {
      app.bus.emit(EV.THREAD_SELECTED, { threadId: id });
      const th = id && app.repo ? await app.repo.getThread(id) : null;
      const path = th && app.repo ? await app.repo.getPath(th.id) : [];
      if (app.view) app.view.showPath(th, path);
    },
    current() { return { thread: null, path: [] }; },
    async send(/** @type {any} */ draft) {
      if (!app.repo) return;
      let threadId = app.state.threadId;
      if (!threadId || !(await app.repo.getThread(threadId))) threadId = api.newThread().id;
      const th = await app.repo.getThread(/** @type {string} */ (threadId));
      if (th && th.titleSource === 'auto' && th.headId == null) await app.repo.updateThread(th.id, { title: String(draft.text).slice(0, 40) });
      const user = app.repo.appendMessage(/** @type {string} */ (threadId), { role: 'user', content: draft.text, parts: [{ type: 'text', text: draft.text }] });
      if (app.view) app.view.upsert(user);
      await api.generate({ threadId: /** @type {string} */ (threadId), parentId: user.id, model: draft.model });
      if (app.sidebar) app.sidebar.render();
    },
    async generate(/** @type {any} */ o) {
      if (!app.repo || !app.farm) return null;
      const caps = app.farm.get();
      const path = await app.repo.getPath(o.threadId, o.parentId);
      const msg = app.repo.appendMessage(o.threadId, { role: 'assistant', parentId: o.parentId, model: o.model || null, status: 'streaming' });
      if (caps.busy && caps.busy.label) {
        const percent = caps.busy.percent != null ? t('core.busyPercent', { percent: caps.busy.percent }) : '';
        Object.assign(msg, { status: 'local', content: t('core.busyNote', { label: caps.busy.label, percent }) });
        await app.repo.finalize(msg);
        if (app.view) app.view.upsert(msg);
        return null;
      }
      const release = app.gov ? app.gov.acquire('foreground', { holder: 'send' }) : () => {};
      if (!release) { if (app.dialogs) app.dialogs.toast(t('core.alreadyRunning')); return null; }
      if (app.view) app.view.upsert(msg);
      const stream = app.view ? app.view.beginStream(msg.id) : null;
      if (app.composer) app.composer.setBusy(true);
      abort = new AbortController();
      const t0 = performance.now();
      let ttft = /** @type {number|null} */ (null), tokens = 0, deltas = 0;
      /** @type {any} */ let result = { status: 'done', abortedBy: null, error: null };
      try {
        const res = await fetch(caps.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...app.farm.headers() },
          signal: abort.signal,
          body: JSON.stringify({
            model: o.model || caps.defaultModel,
            messages: path.filter((m) => m.status === 'done').map((m) => ({ role: m.role, content: m.content })),
            stream: true,
            stream_options: { include_usage: true },
          }),
        });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        const rd = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            let obj; try { obj = JSON.parse(data); } catch { continue; }
            if (obj.error) throw new Error(obj.error.message || 'stream error');
            if (obj.usage && obj.usage.completion_tokens != null) tokens = obj.usage.completion_tokens;
            const d = obj.choices && obj.choices[0] && obj.choices[0].delta;
            if (!d) continue;
            const r = d.reasoning || d.reasoning_content || '';
            if (d.content) msg.content += d.content;
            if (r) msg.reasoning = (msg.reasoning || '') + r;
            if (d.content || r) {
              deltas += 1;
              if (ttft === null) ttft = performance.now() - t0;
              if (stream) stream.paint(msg.content, msg.reasoning);
            }
          }
        }
        const total = (performance.now() - t0) / 1000;
        const gen = Math.max(0.001, total - (ttft || 0) / 1000);
        if (!tokens) tokens = deltas;
        msg.status = 'done';
        if (tokens) {
          const tokPerSec = tokens / gen;
          msg.stats = {
            promptTokens: null, completionTokens: tokens, ttftMs: ttft, tokPerSec, finishReason: null,
            text: t('core.stats', { tokens, tokPerSec: tokPerSec.toFixed(1), ttft: ((ttft || 0) / 1000).toFixed(2) }),
          };
        }
      } catch (e) {
        const err = /** @type {any} */ (e);
        if (err && err.name === 'AbortError') {
          msg.status = 'aborted';
          result = { status: 'aborted', abortedBy: 'user', error: null };
        } else {
          const busy = app.farm.get().busy;
          msg.status = 'error';
          const message = busy && busy.label ? t('core.busyFailNote', { label: busy.label }) : t('core.errorNote', { message: err && err.message });
          msg.error = { kind: 'http', code: null, message, retryAfter: null };
          result = { status: 'error', abortedBy: null, error: { kind: 'http', status: null, code: null, message, farmMessage: null, retryAfter: null } };
        }
      } finally {
        abort = null;
        if (!msg.reasoning) msg.reasoning = null;
        await app.repo.finalize(msg);
        if (stream) stream.end(msg);
        release();
        if (app.composer) { app.composer.setBusy(false); app.composer.focus(); }
      }
      return { ...result, content: msg.content, reasoning: msg.reasoning, reasoningMs: null, usage: null, finishReason: null, ttftMs: ttft, durationMs: null, tokPerSec: msg.stats ? msg.stats.tokPerSec : null };
    },
    async preview() {
      return /** @type {any} */ ({ model: null, system: null, systemAppend: [], messages: [], paramLayers: { recipe: {}, thread: {}, call: {} }, params: {}, responseFormat: null, mode: 'new', meta: { engine: null, budget: null, estimate: 0, trimmedIds: [], newTurnEstimate: 0, allowances: [] } });
    },
    stop() { if (abort) abort.abort(); },
    isStreaming() { return !!abort; },
    /** The real controller tracks which thread it is generating into; the fake only ever has one. */
    async abortThread(/** @type {string|null} */ threadId) {
      if (!threadId || !abort) return false;
      abort.abort();
      return true;
    },
    async refreshView() { await api.selectThread(app.state.threadId); },
  };
  return api;
}
