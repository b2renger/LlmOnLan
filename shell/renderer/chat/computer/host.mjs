// @ts-check
// The Computer's host (COMPUTER_PLAN §3.2, §11 K1-U1), owned by K1-U1.
//
// This is graph/panel.mjs's `createSession` plus the body of its `create()`, re-homed onto the
// standalone surface. It owns the session (the one mutation door, undo, selection, persistence),
// the runner, the canvas, the sandbox and the `debug` door — and NOTHING about the workbench:
// no SLOTS.WORKBENCH_PANELS row, no `resolveThread`, no `installCodeBridge`.
//
// The one substitution that matters: a graph used to belong to a THREAD, and now it belongs to a
// LIBRARY DOCUMENT. So `attach(thread)` becomes `open(graphId)`, `store.load(threadId)` becomes
// `docstore.load(graphId)`, and the question the canvas asks before it lets you place a part —
// "is there somewhere to put this?" — is `session.docId()` instead of `session.thread()`.
//
// `session.thread()` SURVIVES as a compat shim returning null, and that is deliberate (§3.2,
// revision 2). `graph/runner.mjs:371` passes `thread:` into EVERY `spec.run()`; deleting the
// method would make every part run throw. Returning null instead makes the two legacy parts
// (From thread / To thread) fail with their one sentence for free, which is exactly what K1 wants
// of them.
//
// What this module publishes, frozen at the K1 kickoff:
//   createHost(app, els) -> {session, canvas, runner, store, open, rename, close, debug}

import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { createUndo, restoreProgram } from '../graph/undo.mjs';
import { specMap } from '../graph/parts/index.mjs';
import { createRunner } from '../graph/runner.mjs';
// K3 kickoff: the journal's read side and the park registry. Both are PURE and both are read by
// the debug door from hour one, so the door and the units' files land together (§11 K3).
import { readRuns } from '../graph/journal.mjs';
import { pending as pendingParks, cancelAll as cancelParks } from '../graph/parts/control-bus.mjs';
import { clearPresses } from '../graph/parts/button.mjs';
import { createCanvas } from '../graph/canvas.mjs';
import { createDocStore, SAVE_DEBOUNCE_MS } from './docstore.mjs';
import { createSandbox } from '../sandbox/host.mjs';
import { createDoc, movePart, patchPart as patchPartIn, removeParts, removeWire, setSettings as setSettingsIn, setView } from '../graph/model.mjs';
import '../strings/graph.en.mjs';

export { SAVE_DEBOUNCE_MS };

/** How long `ensure()` will wait for the migration's verdict before opening anything. */
const MIGRATION_WAIT_MS = 5000;
const MIGRATION_POLL_MS = 25;

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A first launch after the upgrade must not open a blank document a second before the migration
 * fills the library — the reader would see "no graphs" and then, silently, twelve.
 *
 * `computer/main.mjs` publishes `window.LolComputer.migration` a beat after it builds the
 * components, so this polls for the promise rather than for a value, and gives up rather than
 * blocking the surface for ever. A page with no `LolComputer` at all (a unit test) skips instantly.
 * @returns {Promise<void>}
 */
async function settled() {
  const g = typeof window === 'undefined' ? null : /** @type {any} */ (window).LolComputer;
  if (!g) return;
  const deadline = Date.now() + MIGRATION_WAIT_MS;
  while (!g.migration && Date.now() < deadline) await sleep(MIGRATION_POLL_MS);
  if (!g.migration) return;
  try { await g.migration; } catch { /* the migration reports its own verdict; we only wait */ }
}

/**
 * The object the canvas, the runner and every K1 unit talk to. There is no bus event and no global
 * for the graph: the library is handed the host, and the host hands out the session.
 * @param {any} app @param {HTMLElement|null} host
 */
export function createSession(app, host) {
  const specs = specMap();
  const undoStack = createUndo({});
  const store = createDocStore({ app, specs });
  /** @type {Set<Function>} */ const listeners = new Set();
  /** @type {string[]} */ let selected = [];
  /** @type {any} */ let doc = createDoc({ id: app.newId(), threadId: null, now: app.now });
  /** The id of the document really OPEN, as opposed to the blank placeholder above. Null until
   * `open()` has resolved one: the canvas reads this as "is there somewhere to put a part". */
  /** @type {string|null} */ let docIdOpen = null;
  /** The Computer's ONE sandbox and where its iframe lives (§2.6 BJ). */
  /** @type {any} */ let sandbox = null;
  /** @type {HTMLElement|null} */ let sandboxMount = null;
  /** The open that is allowed to publish its result: a later open wins. */
  let epoch = 0;
  /** @type {string|null} */ let openingId = null;
  let opening = false;
  /** The open in flight, so a second ask for the SAME graph waits on it instead of answering null. */
  /** @type {Promise<any>|null} */ let openingPromise = null;

  /**
   * Critic R1, B12: a document is written only while it IS the open one. Before the first open the
   * session holds a blank placeholder with a fresh id, and a wheel or an async adoption landing on
   * it used to save that placeholder as an "Untitled" library row — which `open(null)` could then
   * pick as the newest graph.
   */
  const persist = () => { if (docIdOpen && doc && doc.id === docIdOpen) store.put(doc); };

  /** @param {any} ev */
  const emit = (ev) => {
    for (const fn of Array.from(listeners)) {
      try { fn(ev); } catch (err) { console.error('[lolcomputer] graph listener threw', err); }
    }
  };

  const session = {
    app,
    host,
    specs,
    doc: () => doc,
    /**
     * THE COMPAT SHIM (§3.2). A library document has no thread and never will; `runner.mjs` passes
     * this into every `spec.run()` and the two legacy parts refuse on it, which is the whole
     * behaviour K1 asks of them. Deleting the method would instead throw inside the runner.
     */
    thread: () => null,
    /** The open library document's id, or null. The question that replaced "is there a thread". */
    docId: () => docIdOpen,
    /** The ONE undoable mutation door. @param {any} next @param {{label?: string, undoable?: boolean}} [o] */
    apply(next, o = {}) {
      if (!next || next === doc) return;
      if (o.undoable !== false) undoStack.push(doc, o.label || '');
      doc = next;
      persist();
      // `label` names the edit for the debug log (addendum KG); no other listener reads it.
      emit({ type: 'doc', doc, label: o.label || '' });
    },
    /** Runtime fields only. Never undoable, never marks anything stale, never a history entry. */
    patchPart(/** @type {string} */ id, /** @type {any} */ patch) {
      doc = patchPartIn(doc, id, patch, { now: app.now });
      persist();
      emit({ type: 'part', doc, ids: [id] });
    },
    /** The SAME door for many parts at once: one document, one save, ONE event naming every id.
     * @param {string[]} ids @param {any} patch */
    patchParts(ids, patch) {
      const list = Array.isArray(ids) ? ids.filter((id) => !!id) : [];
      if (!list.length) return;
      for (const id of list) doc = patchPartIn(doc, id, patch, { now: app.now });
      persist();
      emit({ type: 'part', doc, ids: list.slice() });
    },
    select(/** @type {string[]} */ ids) {
      selected = Array.isArray(ids) ? ids.slice() : [];
      emit({ type: 'select', doc, ids: selected });
    },
    selected: () => selected.slice(),
    setView(/** @type {any} */ view) {
      doc = setView(doc, view);
      persist();
      emit({ type: 'view', doc });
    },
    /**
     * Critic R1, B1: Undo takes back the last EDIT of the program and nothing else. The stack holds
     * whole documents, so what it hands back is merged through `restoreProgram`: the snapshot's
     * parts, settings and wires; the present's answers, run states, title and view. Undoing a move
     * after a run keeps every answer; undoing during a run cannot bring back `running` spinners.
     */
    undo() {
      const e = undoStack.undo(doc);
      if (!e) return false;
      doc = restoreProgram(doc, e.doc, { label: e.label, now: app.now });
      selected = selected.filter((id) => doc.parts.some((/** @type {any} */ p) => p.id === id));
      persist();
      emit({ type: 'doc', doc, label: 'undo' });
      return true;
    },
    redo() {
      const e = undoStack.redo(doc);
      if (!e) return false;
      doc = restoreProgram(doc, e.doc, { label: e.label, now: app.now });
      selected = selected.filter((id) => doc.parts.some((/** @type {any} */ p) => p.id === id));
      persist();
      emit({ type: 'doc', doc, label: 'redo' });
      return true;
    },
    undoDepth: () => undoStack.depth(),
    /** The documents Undo and Redo could bring back (K6 fix round): computer/media.mjs keeps every
     * file they refer to. */
    history: () => undoStack.docs(),
    save: () => store.flush(),
    /**
     * Open a value full size. On the chat surface this used to be the conversation column; the
     * standalone surface has no column, so the RIGHT-HAND DRAWER hosts it (§3.2) — K1-U3's
     * `computer/drawer.mjs`, reached through `app.drawer` so the host never imports it. Until that
     * lands, clicking a value chip is a no-op rather than an exception.
     * @param {any} value @param {any} [opts]
     */
    inspect(value, opts) {
      const drawer = app && app.drawer;
      if (drawer && typeof drawer.inspect === 'function') return drawer.inspect(value, opts || {});
      return null;
    },
    /**
     * The Computer's ONE sandbox. Created on the first part that asks for it, destroyed with the
     * host. At most one iframe in the process, which is why a Render part shows a SNAPSHOT.
     * @returns {Promise<any|null>}
     */
    async sandbox() {
      if (!sandbox) {
        if (!host) return null;
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
    /**
     * Load a LIBRARY DOCUMENT into the session. `open(null)` means "whatever I was last looking
     * at": the kv marker, then the newest library row, then a brand-new document — so the surface
     * always lands on something rather than on a dead canvas.
     * @param {string|null} [graphId]
     * @returns {Promise<{id: string, created: boolean}|null>}
     */
    async open(graphId) {
      const wanted = graphId || null;
      if (wanted && docIdOpen === wanted && doc && doc.id === wanted) {
        // Critic R1, B11: "A is open, click B, click A again before B loads". The reader came BACK:
        // the open of B still in flight must not land after this and show B under A's highlight.
        if (opening) { epoch++; opening = false; openingId = null; openingPromise = null; }
        return { id: wanted, created: false };
      }
      if (opening && openingId === wanted && openingPromise) return openingPromise;
      const mine = ++epoch;
      opening = true;
      openingId = wanted;
      const run = openInner(wanted, mine).finally(() => {
        if (mine === epoch) { opening = false; openingId = null; openingPromise = null; }
      });
      openingPromise = run;
      return run;
    },
    /** Is an open in flight? (The host's switch uses it: a click on the open graph's card is not a
     * switch — unless another graph is still loading.) */
    opening: () => opening,
    /** Host teardown: flush, then stop accepting writes. */
    async close() {
      epoch++;
      docIdOpen = null;
      await store.flush();
      store.destroy();
      if (sandbox) { sandbox.destroy(); sandbox = null; }
      if (sandboxMount) { sandboxMount.remove(); sandboxMount = null; }
      listeners.clear();
    },
    store,
  };

  /** The body of `open()`, for ONE epoch. @param {string|null} wanted @param {number} mine
   * @returns {Promise<{id: string, created: boolean}|null>} */
  async function openInner(wanted, mine) {
    await store.flush();
    if (mine !== epoch) return null;

    let id = wanted;
    let created = false;
    if (!id) {
      id = await store.lastId();
      if (mine !== epoch) return null;
      if (id) {
        // The marker can name a graph that has since been deleted on another machine's copy of
        // the folder, or by a failed migration. Falling through to the newest row is kinder than
        // creating an empty one beside the library the reader can see.
        const rows = await store.list();
        if (mine !== epoch) return null;
        if (!rows.some((/** @type {any} */ r) => r && r.id === id)) id = rows.length ? rows[0].id : null;
      } else {
        const rows = await store.list();
        if (mine !== epoch) return null;
        id = rows.length ? rows[0].id : null;
      }
      if (!id) {
        const made = await store.create({});
        if (mine !== epoch) return null;
        id = made ? made.id : null;
        created = true;
      }
    }
    if (!id) return null;

    const out = await store.load(id);
    if (mine !== epoch) return null;
    // Critic R1, B12: the history and the selection are cleared in the SAME synchronous block
    // that swaps the document. Clearing them before the await let an edit that landed during the
    // load push graph A onto graph B's undo stack.
    undoStack.clear();
    selected = [];
    doc = out.doc;
    docIdOpen = doc.id;
    await store.setLastId(doc.id);
    emit({ type: 'doc', doc, loaded: true, dropped: out.dropped });
    return { id: doc.id, created: created || out.created };
  }
  return session;
}

/**
 * The Computer's one host. `computer/main.mjs` builds it as the `host` component and hands it
 * `app.els`; everything else on the surface reaches the graph through it.
 * @param {any} app @param {any} els
 * @returns {any}
 */
export function createHost(app, els) {
  const mount = /** @type {HTMLElement} */ (els && els.canvas);
  const session = createSession(app, mount || null);
  const runner = createRunner({ session, app });

  const canvas = createCanvas({
    session,
    host: mount,
    onRun: () => { start(); },
    onStop: () => runner.stop(),
    // Critic R1, B7: Escape on the canvas walks this surface's cancel ladder (the drawer closes
    // before a run stops) instead of stopping the run outright. Resolved at call time: the
    // function is declared below.
    onCancel: () => cancelActive(),
    // K3 kickoff (COMPUTER_PLAN §4.2, §11 K3-U3): the per-box ▶, and a Button's own face. Both
    // are the SAME gesture — `run({mode:'from', seeds:[partId]})` — so a part never reaches for
    // the runner itself and there is never a second scheduler on this surface.
    onPlay: (/** @type {string} */ partId) => { start({ mode: 'from', seeds: [partId] }); },
    // The cap banner's one button: finish THIS run at twice the cap it stopped at (§2.6 BH-4).
    onRaiseCap: (/** @type {number} */ cap) => { start({ maxItems: cap }); },
  });

  // Escape, and any other cancel gesture the surface grows, stop the run. The Computer has its own
  // registry (§2.3), so this row is the Computer's and never reaches the chat's — which also means
  // NOTHING walks it unless this surface does: app/controller.mjs is the only other reader of
  // CANCEL_HANDLERS and the Computer does not load the controller. So the row below is registered
  // AND walked here. Without the listener, Escape stopped a run only while focus was inside the
  // canvas (graph/canvas.mjs's own keydown) — never from the run bar, the library or the drawer.
  if (app && app.registry && typeof app.registry.add === 'function') {
    app.registry.add(SLOTS.CANCEL_HANDLERS, {
      id: 'computer-run',
      order: 400,
      active: () => runner.running(),
      cancel: () => runner.stop(),
    });
  }

  /** Walk this surface's own CANCEL_HANDLERS. @returns {boolean} whether anything was cancelled */
  function cancelActive() {
    const reg = app && app.registry;
    if (!reg || typeof reg.list !== 'function') return false;
    for (const handler of reg.list(SLOTS.CANCEL_HANDLERS) || []) {
      let isActive = false;
      try { isActive = !!handler.active(app); } catch (err) { console.warn(`[lolcomputer] cancel handler "${handler.id}" threw`, err); }
      if (!isActive) continue;
      try { handler.cancel(app); } catch (err) { console.warn(`[lolcomputer] cancel handler "${handler.id}" threw`, err); }
      return true;
    }
    return false;
  }

  // An Escape the canvas already acted on arrives here `defaultPrevented` (it blurred a field,
  // cancelled a drag, or walked this same ladder through `onCancel`) and is left alone; any other
  // Escape pressed on the surface walks the ladder here. It cancels nothing when nothing is
  // active, so Escape keeps its usual meaning (close the popover, blur the field) everywhere else.
  const surface = /** @type {HTMLElement|null} */ ((app && app.root) || null);
  /** @param {KeyboardEvent} e */
  const onSurfaceKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (cancelActive()) e.preventDefault();
  };
  if (surface) surface.addEventListener('keydown', onSurfaceKey);

  /** The Run button, ctrl+enter, the run bar and the debug door all land here.
   * @param {any} [opts] */
  async function start(opts) {
    // §6.6: a Button press authorises ONE wave. If there is no document to run it on, no wave is
    // coming — and a press left in the registry would silently open that gate for some LATER run
    // the person never pressed anything for (K3 fix pass).
    if (!session.docId()) { clearPresses(); return null; }
    const o = opts || {};
    // K3 kickoff (COMPUTER_PLAN §4.4): a ▶ pressed MID-RUN MERGES, never refuses — "the user's
    // press is never swallowed". A second `mode:'all'` is still a refusal (the Run button reads
    // Stop while a run is live). `addToRun` lands with K3-U1's scheduler; until then the feature
    // test below keeps the old refusal rather than pretending the merge happened.
    if (runner.running()) {
      const seeds = Array.isArray(o.seeds) ? o.seeds.filter((/** @type {any} */ id) => typeof id === 'string' && id) : [];
      if (seeds.length && typeof (/** @type {any} */ (runner).addToRun) === 'function') {
        const merged = /** @type {any} */ (runner).addToRun(seeds);
        canvas.announce(t('computer.runMerged'));
        return { merged: Number(merged) || seeds.length, busy: false };
      }
      // A Run with nothing to merge WHILE a run is live is a refusal, and §4.2 has one rule about
      // refusals: never a silently no-op button. It used to `return null` — the caller announced
      // nothing, so pressing Run on a busy Computer looked exactly like pressing a dead button.
      canvas.announce(t('graph.runBusy'));
      return { ran: 0, busy: true, merged: 0 };
    }
    canvas.setCapped(null);          // a new run starts with no banner, whatever the last one said
    // The rebuild ladder (C3-U1): three rebuilds in a minute leave the sandbox quiet until an
    // explicit re-arm, and the host cannot tell a human's Run from an automatic re-run — only the
    // caller knows. THIS is the human's Run button, so it spends the one `rearm` the contract
    // allows. Parts never pass it; a part that loops would otherwise rebuild for ever.
    const sb = session.sandboxNow();
    if (sb && sb.state() === 'disabled') {
      await sb.compute({ code: 'return 0;', rearm: true, timeoutMs: 2000 });
    }
    // The host does NOT narrow `A` (K3 landing): the scheduler builds its own active set from
    // `mode`/`seeds`/`force`, prologue included (§4.2). The K3 kickoff shim that used to pre-set
    // `only` here is gone — it called the same `activeSet`, so it was harmless, but it hid where
    // the entry point actually lives.
    const report = await runner.run(o);
    // A refused run activates nothing, so it consumes no press. Same rule as above: the
    // authorisation dies with the wave it was for, rather than waiting to open a gate by itself.
    if (report && report.cycle) clearPresses();
    canvas.setRunning({ running: false, progress: null });
    if (report) {
      if (report.busy) canvas.announce(t('graph.runBusy'));
      else if (report.cycle) canvas.announce(t('graph.runCycle'));
      else if (report.cancelled) canvas.announce(t('graph.runStopped'));
      else if (report.errors && report.errors.length) canvas.announce(t('graph.runErrors', { n: report.errors.length }));
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

  const offRunner = runner.on(() => {
    canvas.setRunning({ running: runner.running(), progress: runner.progress() });
  });

  // The canvas re-renders itself from the session; the host only has to adopt the VIEW a freshly
  // loaded document carries (the canvas keeps the live one, the doc keeps the saved one).
  const offSession = session.on((/** @type {any} */ ev) => {
    if (ev.type === 'doc' && ev.loaded) canvas.adoptView(ev.doc.view);
  });

  let closed = false;

  /**
   * Land on a document without being told which one. The library calls `open(id)` when it starts;
   * this is what happens when it never does — a Computer whose library failed to load, or a page
   * that loads the surface alone — and it is also the first launch, where the library has nothing
   * to open until the migration has run.
   */
  const ready = (async () => {
    const repo = app && app.repo;
    if (repo && repo.ready) { try { await repo.ready; } catch { /* the store speaks for itself */ } }
    await settled();
    if (closed || session.docId()) return null;
    return session.open(null);
  })().catch((err) => {
    // A store that cannot open anything is the banner's problem, not an unhandled rejection.
    console.warn('[lolcomputer] could not open a document', err);
    return null;
  });

  /**
   * Retitle a document. The OPEN one goes through the session — a row rewritten behind the
   * session's back is overwritten by the next debounced save — and any other straight to the store.
   * @param {string} id @param {string} title
   */
  async function rename(id, title) {
    if (id && id === session.docId()) {
      session.apply({ ...session.doc(), title: String(title || '') }, { label: 'rename', undoable: false });
      await session.save();
      return true;
    }
    return !!(await session.store.rename(id, title));
  }

  /**
   * Switch the surface to another document (§4.8, K3 fix pass). A run belongs to the graph it was
   * started on: handed a DIFFERENT one, it would go on marking ids that now mean other boxes, its
   * parked Dialog would still own the run bar's Stop for a graph nobody can see, and the new
   * document's Run would be refused as busy. So a switch ends the run exactly the way `close()`
   * does — stop it, reject every park, and forget every Button press no run ever consumed — and
   * only then loads.
   * @param {string|null} [graphId]
   */
  function openDoc(graphId) {
    const id = graphId || null;
    // Critic R1, B3: clicking the card of the graph that is ALREADY open is not a switch. It used
    // to stop the live run, reject the Dialog that was asking, and waste the farm call — before
    // `session.open` noticed there was nothing to load. Unless another open is still in flight
    // (then this click is "come back", and the session's own open handles the race, B11).
    if (id && id === session.docId() && !session.opening()) return Promise.resolve({ id, created: false });
    runner.stop();
    cancelParks();
    clearPresses();
    return session.open(id);
  }

  /**
   * Resolve once no run is live (critic R1, B4): a stopped run still unwinds — its journal's last
   * write lands after `stop()` returns — and a graph must not be deleted underneath that write.
   * @param {number} [maxMs] @returns {Promise<boolean>} true when the runner really is idle
   */
  async function settle(maxMs = 5000) {
    const end = Date.now() + maxMs;
    while (runner.running() && Date.now() < end) await sleep(25);
    return !runner.running();
  }

  return {
    session,
    canvas,
    runner,
    store: session.store,
    /** Resolves once the host has a document open (or decided it cannot get one). */
    ready,
    /** @param {string|null} [graphId] */
    open: (graphId) => openDoc(graphId),
    settle,
    rename,
    async close() {
      closed = true;
      runner.stop();
      // §4.8 / §7.5: closing the document rejects every park. A Timer does not survive a close,
      // and a Dialog that was asking comes back `stale` and asks again.
      cancelParks();
      // §6.6: a Button press is an authorisation for ONE wave. An unconsumed one must not outlive
      // the document that owned it, or the next run through that box passes a manual gate nobody
      // clicked.
      clearPresses();
      if (surface) surface.removeEventListener('keydown', onSurfaceKey);
      offRunner();
      offSession();
      canvas.destroy();
      await session.close();
      if (mount) mount.replaceChildren();
    },
    // ---- the debug door ------------------------------------------------------------------------
    // API_KEYS.graphDebug verbatim, plus the two K1 additions the standalone surface needs: `open`
    // (the library's door, and the harness's) and `docId` (what replaced "is there a thread").
    // Every entry is the SAME function the toolbar calls, so a scenario that presses them
    // exercises the shipped path and not a second implementation (§2.6 BG-3). Critic R1, B10:
    // `unwire` and `move` hand-edited the document (no `rev`, nothing marked stale) and so drifted
    // from that promise; they go through graph/model.mjs's doors now, like the canvas.
    debug: {
      doc: () => session.doc(),
      session: () => session,
      place: (/** @type {string} */ type, /** @type {number} */ x, /** @type {number} */ y) => canvas.place(type, x, y),
      remove: (/** @type {string[]} */ ids) => {
        session.apply(removeParts(session.doc(), ids, { now: app.now }), { label: 'remove' });
        session.select(session.selected().filter((id) => (ids || []).indexOf(id) < 0));
        return true;
      },
      wire: (/** @type {string} */ from, /** @type {string} */ to, /** @type {string} */ port) => canvas.wire(from, to, port),
      unwire: (/** @type {string} */ id) => {
        canvas.select([], { say: false });
        const doc = session.doc();
        if (!doc.wires.some((/** @type {any} */ w) => w.id === id)) return false;
        session.apply(removeWire(doc, id, { now: app.now }), { label: 'unwire' });
        return true;
      },
      select: (/** @type {string[]} */ ids) => canvas.select(ids || []),
      move: (/** @type {string} */ id, /** @type {number} */ x, /** @type {number} */ y) => {
        const doc = session.doc();
        if (!doc.parts.some((/** @type {any} */ p) => p.id === id)) return false;
        session.apply(movePart(doc, id, { x, y }, { now: app.now }), { label: 'move' });
        return true;
      },
      setSettings: (/** @type {string} */ id, /** @type {any} */ patch) => {
        session.apply(setSettingsIn(session.doc(), id, patch, { specs: session.specs, now: app.now }), { label: 'settings' });
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
        // The standalone surface's document, not a thread: `threadId` is null by definition and
        // `docId` is the id a scenario actually wants.
        threadId: session.doc().threadId,
        docId: session.docId(),
        title: session.doc().title || '',
        parts: session.doc().parts.map((/** @type {any} */ p) => ({
          id: p.id, type: p.type, state: p.state, value: p.value, x: p.x, y: p.y, settings: p.settings,
          error: p.error || null, stats: p.stats || null, fanout: p.fanout || null,
        })),
        wires: session.doc().wires.map((/** @type {any} */ w) => ({ id: w.id, from: w.from, to: w.to, port: w.port, label: typeof w.label === 'string' ? w.label : '' })),
        view: canvas.view(),
      }),
      run: (/** @type {any} */ opts) => start(opts || {}),
      stop: () => runner.stop(),
      running: () => runner.running(),
      undo: () => canvas.undo(),
      redo: () => canvas.redo(),
      save: () => session.save(),
      tidy: () => canvas.tidy(),
      /** The .lolgraph.json TEXT, so a scenario can round-trip without a file dialog. */
      exportText: (/** @type {any} */ o) => canvas.exportText(o || {}),
      /** The real import, dialog and all: a non-empty canvas still asks first. */
      importText: (/** @type {string} */ text, /** @type {any} */ o) => canvas.importText(text, o || {}),
      sandbox: () => {
        const live = session.sandboxNow();
        return live ? live.debug() : { state: 'idle', framed: false, runs: 0 };
      },
      // ---- K2 additions (COMPUTER_PLAN §5, §8.1) ---------------------------------------------
      /**
       * Name a wire. The SAME edit the label pill makes — undoable, `rev`-bumping, staling `to`
       * and everything downstream (§5.1). The canvas owns it; this is the door a scenario presses.
       * K2-U1 lands `canvas.setWireLabel`; until then the door answers `false` rather than
       * pretending it renamed something.
       * @param {string} wireId @param {string} text @returns {boolean}
       */
      label: (wireId, text) => (typeof (/** @type {any} */ (canvas).setWireLabel) === 'function'
        ? !!(/** @type {any} */ (canvas).setWireLabel(wireId, String(text == null ? '' : text)))
        : false),
      /**
       * The prompt a thinking part WOULD send, without sending it (§8.1: "you can read your
       * prompt, fix it, and read it again, for free"). It is the transcript's own assembly — the
       * same `bind.mjs` call — resolved at CALL time through `app.transcript`, so this file never
       * imports K2-U3's module and the order they install in does not matter.
       * @param {string} partId @returns {any} an InstructionPlan, or null
       */
      preview: (partId) => {
        const tx = app && /** @type {any} */ (app).transcript;
        return tx && typeof tx.planFor === 'function' ? tx.planFor(partId) : null;
      },
      // ---- K3 additions (COMPUTER_PLAN §4.2, §7.3, §11 K3) -----------------------------------
      /**
       * Press ▶ on ONE box: run it, everything downstream, and — the §4.2 prologue — whatever
       * upstream of it holds no value yet. The same door the canvas's per-box ▶ and a Button's
       * face press, so a scenario exercises the shipped path.
       * @param {string} partId @param {any} [opts] @returns {Promise<any>}
       */
      runFrom: (partId, opts) => start({ ...(opts || {}), mode: 'from', seeds: [partId] }),
      /** Every stored run for the open document, oldest first (§7.3). @returns {Promise<any[]>} */
      journal: () => readRuns(app && app.repo, session.docId() || ''),
      /** What is parked right now (§4.1): a Confirm, a Dialog's question, a Timer's countdown. */
      waits: () => pendingParks(),
      // ---- K1 additions (§2.4) -------------------------------------------------------------
      /** @param {string|null} [graphId] */
      open: (graphId) => openDoc(graphId),
      docId: () => session.docId(),
    },
  };
}
