// @ts-check
// The Computer panel (docs/LOLCHAT_COMPUTER_SPEC.md): a FEATURE that registers one
// SLOTS.WORKBENCH_PANELS item and owns the per-thread graph SESSION every other C1 module talks
// to. The session contract, the debug door and the persistence rules are frozen in plan §2.6 BG-7.
//
// The panel is deliberately thin: it owns the SESSION (the one mutation door, undo, selection,
// persistence and the thread it belongs to) and the WIRING between three things that know nothing
// about each other — the pure engine (C1-U1), the canvas (graph/canvas.mjs) and the runner
// (C1-U3). It publishes nothing on `app`: it is reached through `app.work`, never as `app.graph`.

import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { createUndo } from './undo.mjs';
import { specMap } from './parts/index.mjs';
import { createRunner } from './runner.mjs';
import { createCanvas } from './canvas.mjs';
import { createGraphStore, SAVE_DEBOUNCE_MS } from './store.mjs';
import { createInspector } from './inspect.mjs';
import { installCodeBridge } from './parts/code.mjs';
import { createSandbox } from '../sandbox/host.mjs';
import { createDoc, patchPart as patchPartIn, removeParts, setSettings, setView } from './model.mjs';
import '../strings/graph.en.mjs';

export const PANEL_ID = 'computer';
/** How much of a value the inspector shows before it says how much is left now lives with the
 * inspector itself (graph/inspect.mjs INSPECT_CAP) — the panel no longer renders values. */
export { SAVE_DEBOUNCE_MS };

/**
 * The object every other C1 module is handed. There is no bus event and no global for the graph.
 * @param {any} app @param {HTMLElement} host
 */
function createSession(app, host) {
  const specs = specMap();
  const undoStack = createUndo({});
  const store = createGraphStore({ app, specs });
  const inspector = createInspector(app);
  /** @type {Set<Function>} */ const listeners = new Set();
  /** @type {string[]} */ let selected = [];
  /** @type {any} */ let doc = createDoc({ id: app.newId(), threadId: null, now: app.now });
  /** @type {any} */ let thread = null;
  /** The panel's ONE sandbox and where its iframe lives (C3 kickoff, §2.6 BJ). */
  /** @type {any} */ let sandbox = null;
  /** @type {HTMLElement|null} */ let sandboxMount = null;
  /** The attach that is allowed to publish its result: a later thread switch wins. */
  let epoch = 0;
  /** The thread an attach is currently loading, when one is (C1 landing — see attach()). */
  let attaching = false;
  /** @type {string|null} */ let attachingId = null;

  /** @param {any} ev */
  const emit = (ev) => {
    for (const fn of Array.from(listeners)) {
      try { fn(ev); } catch (err) { console.error('[lolchat] graph listener threw', err); }
    }
  };

  const session = {
    app,
    host,
    specs,
    doc: () => doc,
    thread: () => thread,
    /** The ONE undoable mutation door. @param {any} next @param {{label?: string, undoable?: boolean}} [o] */
    apply(next, o = {}) {
      if (!next || next === doc) return;
      if (o.undoable !== false) undoStack.push(doc, o.label || '');
      doc = next;
      store.put(doc);
      emit({ type: 'doc', doc });
    },
    /** Runtime fields only. Never undoable, never marks anything stale, never a history entry. */
    patchPart(/** @type {string} */ id, /** @type {any} */ patch) {
      doc = patchPartIn(doc, id, patch, { now: app.now });
      store.put(doc);
      emit({ type: 'part', doc, ids: [id] });
    },
    /** The SAME door for many parts at once: one document, one save, ONE event naming every id.
     * The runner marks a whole run set `queued` up front; N separate patches was N events and, on
     * a 500-part graph, N full canvas renders before the first request (C1 fix pass).
     * @param {string[]} ids @param {any} patch */
    patchParts(ids, patch) {
      const list = Array.isArray(ids) ? ids.filter((id) => !!id) : [];
      if (!list.length) return;
      for (const id of list) doc = patchPartIn(doc, id, patch, { now: app.now });
      store.put(doc);
      emit({ type: 'part', doc, ids: list.slice() });
    },
    select(/** @type {string[]} */ ids) {
      selected = Array.isArray(ids) ? ids.slice() : [];
      emit({ type: 'select', doc, ids: selected });
    },
    selected: () => selected.slice(),
    setView(/** @type {any} */ view) {
      doc = setView(doc, view);
      store.put(doc);
      emit({ type: 'view', doc });
    },
    undo() {
      const e = undoStack.undo(doc);
      if (!e) return false;
      doc = e.doc;
      selected = selected.filter((id) => doc.parts.some((/** @type {any} */ p) => p.id === id));
      store.put(doc);
      emit({ type: 'doc', doc });
      return true;
    },
    redo() {
      const e = undoStack.redo(doc);
      if (!e) return false;
      doc = e.doc;
      selected = selected.filter((id) => doc.parts.some((/** @type {any} */ p) => p.id === id));
      store.put(doc);
      emit({ type: 'doc', doc });
      return true;
    },
    undoDepth: () => undoStack.depth(),
    save: () => store.flush(),
    /**
     * Open a value FULL SIZE in the conversation column (§2.6 BH-7). C1 showed it in a popover over
     * the graph; the column is where reading happens, and a value read next to the answer it came
     * from is the whole point of the Computer living beside the chat. graph/inspect.mjs owns the
     * element, and closes it on Escape, on a thread change (attach below) and on close().
     * @param {any} value @param {any} [opts]
     */
    inspect(value, opts) {
      return inspector.show(value, opts || {});
    },
    /**
     * The panel's ONE sandbox (C3 kickoff, §2.6 BJ). Created on the first part that asks for it,
     * never while the panel is hidden, destroyed with the panel. At most one iframe in the process
     * (studio plan §3.7.7), which is why a Render part shows a SNAPSHOT and not a live frame.
     * The runner hands this function to every part as `input.sandbox`.
     * @returns {Promise<any|null>}
     */
    async sandbox() {
      if (!sandbox) {
        if (!sandboxMount) {
          sandboxMount = document.createElement('div');
          sandboxMount.className = 'sandbox-mount';
          host.appendChild(sandboxMount);
        }
        sandbox = createSandbox({ app });
        sandbox.mount(sandboxMount);
      }
      const ok = await sandbox.ready();
      return ok ? sandbox : null;
    },
    /** The live sandbox, or null when nothing has asked for one yet. For the debug door only. */
    sandboxNow: () => sandbox,
    /** @param {(ev: any) => void} fn */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Load (or create) THIS thread's graph. One graph per thread in C1 (plan §2.6 BG-7). */
    async attach(/** @type {any} */ next) {
      const nextId = next ? next.id : null;
      // C1 landing, two guards where there used to be one. Being asked to attach to the thread we
      // are ALREADY on is a no-op only once that thread's document is really loaded (`thread` is
      // set before the awaits below, so the old check was true while nothing had been read yet).
      // And an attach to the thread an attach is already LOADING must stand aside rather than
      // start a second one: two loads of a thread with no graph row each create and WRITE a fresh
      // document, so the thread ends up with two rows and the next visit can pick the empty one.
      // Two attaches in flight is ordinary — show() and a thread resolving a moment later.
      if (thread && next && thread.id === nextId && doc && doc.threadId === nextId) return;
      if (attaching && attachingId === nextId) return;
      inspector.close();          // the open value belonged to the thread we are leaving (BH-7)
      const mine = ++epoch;
      attaching = true;
      attachingId = nextId;
      await store.flush();
      if (mine !== epoch) return;
      thread = next || null;
      undoStack.clear();
      selected = [];
      const out = await store.load(thread ? thread.id : null);
      if (mine !== epoch) return;
      attaching = false;
      doc = out.doc;
      emit({ type: 'doc', doc, loaded: true });
    },
    /** Panel teardown: flush, then stop accepting writes. */
    async close() {
      epoch++;
      await store.flush();
      store.destroy();
      inspector.destroy();
      if (sandbox) { sandbox.destroy(); sandbox = null; }
      if (sandboxMount) { sandboxMount.remove(); sandboxMount = null; }
      listeners.clear();
    },
    store,
  };
  return session;
}

/** @param {any} app @returns {any} */
export function install(app) {
  if (!app || !app.registry) return null;
  /** @type {any} */ let liveRunner = null;

  app.registry.add(SLOTS.CANCEL_HANDLERS, {
    id: 'graph.run',
    order: 400,
    active: () => !!(liveRunner && liveRunner.running()),
    cancel: () => { if (liveRunner) liveRunner.stop(); },
  });

  app.registry.add(SLOTS.WORKBENCH_PANELS, {
    id: PANEL_ID,
    order: 100,
    icon: 'M4 5h6v6H4zM14 13h6v6h-6zM10 8h4M16 11v2',
    label: t('graph.panelLabel'),
    defaultWidth: 'split',
    available: () => true,
    create(host, hostApp) {
      const session = createSession(hostApp, host);
      const runner = createRunner({ session, app: hostApp });
      liveRunner = runner;

      const canvas = createCanvas({
        session,
        host,
        onRun: () => { start(); },
        onStop: () => runner.stop(),
        // The cap banner's one button: finish THIS run at twice the cap it stopped at (§2.6 BH-4).
        // It never raises the stored preference — the toolbar field is the only place that changes.
        onRaiseCap: (/** @type {number} */ cap) => { start({ maxItems: cap }); },
      });

      /** The Run button, ctrl+enter and the debug door all land here; the runner owns what it means.
       * @param {any} [opts] */
      async function start(opts) {
        if (runner.running() || !session.thread()) return null;
        canvas.setCapped(null);          // a new run starts with no banner, whatever the last one said
        // The rebuild ladder (C3-U1): three rebuilds in a minute leave the sandbox quiet until an
        // explicit re-arm, and the host cannot tell a human's Run from an automatic re-run — only
        // the caller knows. THIS is the human's Run button, so it spends the one `rearm` the
        // contract allows. Parts never pass it; a part that loops would otherwise rebuild forever.
        const sb = session.sandboxNow();
        if (sb && sb.state() === 'disabled') {
          await sb.compute({ code: 'return 0;', rearm: true, timeoutMs: 2000 });
        }
        const report = await runner.run(opts || {});
        canvas.setRunning({ running: false, progress: null });
        if (report) {
          if (report.busy) canvas.announce(t('graph.runBusy'));
          else if (report.cycle) canvas.announce(t('graph.runCycle'));
          else if (report.cancelled) canvas.announce(t('graph.runStopped'));
          else if (report.errors && report.errors.length) canvas.announce(t('graph.runErrors', { n: report.errors.length }));
          // C1 landing: a yield and a cap are run outcomes of their own, not "nothing to run".
          else if (report.yielded) canvas.announce(t('graph.runBusy'));
          else if (report.capped && report.capped.items) {
            canvas.announce(t('graph.runCappedItems', { items: report.capped.items, cap: report.capped.cap }));
          } else if (report.capped) canvas.announce(t('graph.runCapped', { cap: report.capped.cap, n: report.capped.stopped }));
          if (report.capped) canvas.setCapped(report.capped);
          else if (!report.ran) canvas.announce(t('graph.runNothing'));
          else canvas.announce(t('graph.runDone', { n: report.ran, sec: (report.ms / 1000).toFixed(1) }));
        }
        return report;
      }

      /**
       * "Send to the Computer" on a JavaScript fence in the conversation (C3-U2's contract request
       * at the C3 landing). The bridge can only exist while the panel does, because placing a part
       * needs the live canvas — so it is installed with the panel and taken off with it, and
       * `installCodeBridge` registers NOTHING without a placer. The placer puts the code down,
       * brings the panel forward (the reader clicked in the conversation, so the panel may be
       * behind it) and hands the new id back to the toast.
       */
      const offBridge = installCodeBridge(hostApp, {
        place: (/** @type {{code: string, lang: string}} */ o) => {
          // Centred, not at a fixed 40,40: the reader has usually panned somewhere, and a part
          // that lands off-screen reads as "nothing happened".
          const id = canvas.placeCentred('code');
          if (!id) return null;
          session.apply(
            setSettings(session.doc(), id, { code: o.code }, { specs: session.specs, now: hostApp.now }),
            { label: 'code' },
          );
          if (hostApp.work && typeof hostApp.work.request === 'function') hostApp.work.request(PANEL_ID);
          return { id };
        },
      });

      const offRunner = runner.on(() => {
        canvas.setRunning({ running: runner.running(), progress: runner.progress() });
      });

      // The canvas re-renders itself from the session; the panel only has to adopt the VIEW a
      // freshly loaded document carries (the canvas keeps the live one, the doc keeps the saved one).
      const offSession = session.on((/** @type {any} */ ev) => {
        if (ev.type === 'doc' && ev.loaded) canvas.adoptView(ev.doc.view);
      });

      /**
       * The thread this graph belongs to. `ctx.thread` is the workbench's answer and is usually
       * right — but a BRAND-NEW thread (§2.6 AP.1) makes the workbench return early with
       * `thread = null` while `app.state.threadId` already names it, and "I just started a chat,
       * then opened the Computer" is the most ordinary way in there is. So the panel falls back to
       * the live thread id and reads the row itself; an ephemeral thread that has no row yet is
       * still a thread, and `{id}` is all C1 needs of it.
       * @param {any} ctx
       */
      async function resolveThread(ctx) {
        if (ctx && ctx.thread) return ctx.thread;
        const id = hostApp.state && hostApp.state.threadId;
        if (!id) return null;
        const repo = hostApp.repo;
        if (repo && typeof repo.getThread === 'function') {
          try {
            const row = await repo.getThread(id);
            if (row) return row;
          } catch { /* the store speaks through its own banner */ }
        }
        return { id };
      }

      /** @param {any} ctx */
      const attach = async (ctx) => session.attach(await resolveThread(ctx));

      return {
        show(ctx) { attach(ctx); },
        onThread(ctx) { runner.stop(); attach(ctx); },
        // Hiding the panel SUSPENDS the guest. `runner.stop()` only aborts a request that is
        // still in flight; a Render or Code part whose run already FINISHED leaves live rafs and
        // timers behind (the guest resets on boot/run/stop/dispose, not on a panel flip), so a p5
        // draw loop kept painting — and the host's watchdog kept pinging it — for as long as the
        // app stayed open behind another panel. `sandbox.hide()` stops the sketch and the watchdog
        // now and drops the frame after TIMEOUTS.hideGrace, so flipping back inside the grace
        // still costs no rebuild.
        hide() {
          runner.stop();
          const live = session.sandboxNow();
          if (live && typeof live.hide === 'function') live.hide();
          session.save();
        },
        destroy() {
          runner.stop();
          offBridge();
          offRunner();
          offSession();
          canvas.destroy();
          session.close();
          if (liveRunner === runner) liveRunner = null;
          host.replaceChildren();
        },
        debug: {
          doc: () => session.doc(),
          session: () => session,
          // The mutation door as a scenario drives it: every entry goes through the canvas, so a
          // scenario exercises the same code path the pointer does (BG-3).
          place: (/** @type {string} */ type, /** @type {number} */ x, /** @type {number} */ y) => canvas.place(type, x, y),
          remove: (/** @type {string[]} */ ids) => {
            session.apply(removeParts(session.doc(), ids, { now: hostApp.now }), { label: 'remove' });
            session.select(session.selected().filter((id) => (ids || []).indexOf(id) < 0));
            return true;
          },
          wire: (/** @type {string} */ from, /** @type {string} */ to, /** @type {string} */ port) => canvas.wire(from, to, port),
          unwire: (/** @type {string} */ id) => {
            canvas.select([], { say: false });
            const doc = session.doc();
            const wire = doc.wires.find((/** @type {any} */ w) => w.id === id);
            if (!wire) return false;
            session.apply(
              { ...doc, wires: doc.wires.filter((/** @type {any} */ w) => w.id !== id) },
              { label: 'unwire' },
            );
            return true;
          },
          select: (/** @type {string[]} */ ids) => canvas.select(ids || []),
          move: (/** @type {string} */ id, /** @type {number} */ x, /** @type {number} */ y) => {
            const doc = session.doc();
            session.apply(
              { ...doc, parts: doc.parts.map((/** @type {any} */ p) => (p.id === id ? { ...p, x, y } : p)) },
              { label: 'move' },
            );
            return true;
          },
          setSettings: (/** @type {string} */ id, /** @type {any} */ patch) => {
            session.apply(setSettings(session.doc(), id, patch, { specs: session.specs, now: hostApp.now }), { label: 'settings' });
            return true;
          },
          view: (/** @type {any} */ v) => (v ? canvas.setView(v) : canvas.view()),
          fit: () => canvas.fit(),
          state: () => ({
            running: runner.running(),
            progress: runner.progress(),
            selected: session.selected(),
            selectedWires: canvas.selectedWires(),
            said: canvas.said(),
            undo: session.undoDepth(),
            threadId: session.doc().threadId,
            parts: session.doc().parts.map((/** @type {any} */ p) => ({
              id: p.id, type: p.type, state: p.state, value: p.value, x: p.x, y: p.y, settings: p.settings,
              // C2 (§2.6 BH-13): the three runtime fields the canvas now paints. The KEY LIST of
              // the debug door itself is unchanged — API_KEYS.graphDebug does not move.
              error: p.error || null, stats: p.stats || null, fanout: p.fanout || null,
            })),
            wires: session.doc().wires.map((/** @type {any} */ w) => ({ id: w.id, from: w.from, to: w.to, port: w.port })),
            view: canvas.view(),
          }),
          run: (/** @type {any} */ opts) => start(opts || {}),
          stop: () => runner.stop(),
          running: () => runner.running(),
          undo: () => canvas.undo(),
          redo: () => canvas.redo(),
          save: () => session.save(),
          // ---- C3 (§2.6 BJ-17, C3-U3). Four keys frozen in API_KEYS.graphDebug; every one of them
          // is the SAME function the toolbar button calls, so a scenario that presses them
          // exercises the shipped path and not a second implementation (BG-3).
          tidy: () => canvas.tidy(),
          /** The .lolgraph.json TEXT, so a scenario can round-trip without a file dialog. */
          exportText: (/** @type {any} */ o) => canvas.exportText(o || {}),
          /** The real import, dialog and all: a non-empty canvas still asks first. */
          importText: (/** @type {string} */ text, /** @type {any} */ o) => canvas.importText(text, o || {}),
          sandbox: () => {
            const live = session.sandboxNow();
            return live ? live.debug() : { state: 'idle', framed: false, runs: 0 };
          },
        },
      };
    },
  });
  return { panelId: PANEL_ID };
}
