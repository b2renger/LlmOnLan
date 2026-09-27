// @ts-check
// The model picker: #chat-model, filled from the farm's own catalog (plan §3.4, §3.10).
//
// Contract (plan §3.4):
//   createModelPicker(app, selectEl) → {value(), set(id, {byUser}), refresh({force})}
//
// Farm-honest selection (plan §3.10), applied on every thread selection and farm change:
//   1. the current thread's own pick, when `thread.modelSource === 'user'` and the model is STILL
//      served by this farm;
//   2. otherwise the farm's advertised default, when served;
//   3. otherwise the first served model.
// A NEW thread therefore always starts on the farm default: there is deliberately no cross-thread
// and no cross-session memory of the last pick (on a one-model Ollama box a remembered pick would
// force a model swap for everyone else on that GPU).
//
// A user change writes `{model, modelSource:'user'}` onto the CURRENT thread. With no thread yet
// the pick is HELD and applied only to a thread that is BRAND NEW — a THREAD_SELECTED carrying
// `created:true`, which only `controller.newThread()` emits, i.e. the thread the next send creates.
// It is deliberately NOT applied to a thread the reader merely clicked in the sidebar: that wrote a
// `modelSource:'user'` pin onto stored history the pick was never about (§3.10 rule 1 then keeps it
// forever). A cold boot with history selects nothing, so that was the common case, not the rare one.
// The held pick is not even CONSULTED once a thread is open: it used to win over the farm default
// for any thread, so a pick made during the boot window (main.mjs reopens `ui:lastThreadId` only
// after `repo.ready`) rode into the next chat the reader clicked and served the turn from a model
// the thread record knew nothing about. Opening an existing thread drops it.
//
// The catalog is refetched when the endpoint or the password changes, and retried on every farm
// tick while the last fetch did not succeed (a farm that was down or refused the password comes
// back on its own). Placeholders: `no farm` / `no models` / `unreachable` / `password refused`.

import { EV } from '../core/events.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/composer.en.mjs';

/** fetchModels state → the placeholder string key (§3.10). */
const PLACEHOLDER = {
  'no-farm': 'core.noFarm',
  'no-models': 'core.noModels',
  unreachable: 'core.unreachable',
  auth: 'core.passwordRefused',
};

/**
 * @param {import('../core/types.mjs').App} app
 * @param {HTMLSelectElement} selectEl
 */
export function createModelPicker(app, selectEl) {
  /** @type {string[]} */
  let ids = [];
  /** @type {string} */
  let state = 'no-farm';
  /** @type {string|null} */
  let from = null;                 // the `${baseUrl}|${apiKey}` the current catalog came from
  /** @type {string|null} */
  let heldPick = null;             // a user pick made before any thread existed (see below)
  /** @type {{threadId: string, model: string}|null} */
  let pendingPick = null;          // a pick made on a thread whose store write has not landed yet
  /** @type {Promise<any>} */
  let queue = Promise.resolve();

  const capsNow = () => (app.farm ? app.farm.get() : null);

  /** Serialise everything that touches the <select>, so two farm ticks cannot interleave. */
  const serial = (/** @type {() => Promise<any>} */ fn) => {
    queue = queue.then(fn, fn).catch((err) => { console.warn('[lolchat] model picker', err); });
    return queue;
  };

  /**
   * Say that the effective model changed, for surfaces beside the picker (ui/strip.mjs today).
   *
   * A `<select>` whose value is assigned programmatically fires NO 'change' event, so the strip —
   * which listens for one — had no model field at all until the next farm tick, 4 s in production
   * (P2 review). A DOM event on the shared element rather than a new bus event: EV is frozen
   * (§3.2) and anyone who can see #chat-model can hear this.
   */
  let announced = null;
  function announce() {
    const now = selectEl.value || '';
    if (now === announced) return;
    announced = now;
    try {
      selectEl.dispatchEvent(new CustomEvent('lolchat:model', { bubbles: true, detail: { model: now } }));
    } catch (err) { console.warn('[lolchat] model picker announce failed', err); }
  }

  /** @param {string} which a fetchModels state (PLACEHOLDER's keys) */
  function showPlaceholder(which) {
    const option = new Option(t(/** @type {any} */ (PLACEHOLDER)[which] || 'core.unreachable'), '');
    selectEl.replaceChildren(option);
    selectEl.value = '';
    announce();
  }

  /** The §3.10 rule, applied to whatever is served right now. */
  async function applySelection() {
    if (!ids.length) return;
    const caps = capsNow();
    let want = null;

    const threadId = app.state.threadId;
    if (threadId && app.repo) {
      const thread = await app.repo.getThread(threadId);
      if (thread && thread.modelSource === 'user' && thread.model && ids.includes(thread.model)) want = thread.model;
      // A pick the user just made on THIS thread counts even before `updateThread` has landed.
      // Without this, clicking New chat and choosing a model in the same beat lost the choice: the
      // THREAD_SELECTED task is queued first, reads a thread that is still on the farm default, and
      // its `selectEl.value = want` overwrites the user's selection a few ms later — silently, and
      // with the thread record saying one model while the next send used another (caught by a
      // flaky p1-errors at the P1 landing, which sent to `assistant` instead of `mock-429`).
      if (!want && pendingPick && pendingPick.threadId === threadId && ids.includes(pendingPick.model)) want = pendingPick.model;
    }
    // A pick made before any thread existed rides on the DRAFT (§3.10): it is only ever the answer
    // while no thread is open. Consulting it for an open thread made it leak onto every chat the
    // reader clicked — the picker showed it, `composer.getDraft()` sent it, and the thread record
    // still said `modelSource:null`, so the next launch silently reverted the same conversation.
    if (!want && !threadId && heldPick && ids.includes(heldPick)) want = heldPick;
    if (!want && caps && caps.defaultModel && ids.includes(caps.defaultModel)) want = caps.defaultModel;
    if (!want) want = ids[0];

    if (selectEl.value !== want) selectEl.value = want;
    announce();
  }

  /** @param {{force?: boolean}} [opts] */
  async function refreshNow(opts = {}) {
    if (!app.farm) return;
    const caps = app.farm.get();
    const signature = `${caps && caps.baseUrl}|${caps && caps.apiKey}`;
    if (!opts.force && signature === from && ids.length) {
      await applySelection();
      return;
    }
    const res = await app.farm.fetchModels({ force: !!opts.force });
    state = res && res.state ? res.state : 'unreachable';
    if (state !== 'ok') {
      from = null;
      ids = [];
      showPlaceholder(state);
      return;
    }
    ids = res.ids.slice();
    from = signature;
    const previous = selectEl.value;
    selectEl.replaceChildren(...ids.map((id) => new Option(id, id)));
    // Keep what was on screen if the new catalog still serves it; applySelection has the last word.
    if (ids.includes(previous)) selectEl.value = previous;
    await applySelection();
  }

  const api = {
    value() {
      return selectEl.value;
    },

    /**
     * @param {string} id
     * @param {{byUser?: boolean}} [opts]
     */
    set(id, opts = {}) {
      const next = id == null ? '' : String(id);
      if (next && ids.length && !ids.includes(next)) return;     // never select what the farm does not serve
      if (selectEl.value !== next) selectEl.value = next;
      announce();
      if (!opts.byUser) return;
      const threadId = app.state.threadId;
      if (threadId && app.repo) {
        heldPick = null;
        pendingPick = { threadId, model: next };
        void Promise.resolve(app.repo.updateThread(threadId, { model: next, modelSource: 'user' }))
          .then(() => {
            if (pendingPick && pendingPick.threadId === threadId && pendingPick.model === next) pendingPick = null;
          }, () => { /* the store said no; applySelection falls back to the farm default */ });
      } else {
        heldPick = next;                                          // rides on the draft (§3.10)
      }
    },

    /** @param {{force?: boolean}} [opts] */
    refresh(opts = {}) {
      return serial(() => refreshNow(opts));
    },
  };

  selectEl.addEventListener('change', () => api.set(selectEl.value, { byUser: true }));

  // A new endpoint or password → a new catalog; anything else → re-apply the rule.
  app.bus.on(EV.FARM_CHANGE, () => { void api.refresh(); });

  // Wall-clock retries ride the farm tick (plan §3.9: no module starts its own timer). A farm that
  // was unreachable or refused the password recovers here without a reload.
  app.bus.on(EV.FARM_TICK, () => {
    if (state !== 'ok' || !selectEl.options.length) void api.refresh();
  });

  app.bus.on(EV.THREAD_SELECTED, (/** @type {any} */ p) => {
    const threadId = p && p.threadId;
    if (pendingPick && pendingPick.threadId !== threadId) pendingPick = null;
    const created = !!(p && p.created);
    // Opening an EXISTING thread ends the draft the held pick belonged to.
    if (threadId && !created) heldPick = null;
    void serial(async () => {
      if (threadId && created && heldPick && app.repo) {
        const pick = heldPick;
        heldPick = null;
        pendingPick = { threadId, model: pick };
        await app.repo.updateThread(threadId, { model: pick, modelSource: 'user' });
        if (pendingPick && pendingPick.threadId === threadId && pendingPick.model === pick) pendingPick = null;
      }
      await applySelection();
    });
  });

  return api;
}
