// @ts-check
// Event names and the in-page bus. PURE.
//
// Contract (plan §3.2, frozen at P0 kickoff). Payloads per event are documented inline.
// Bus semantics:
//   - emit is SYNCHRONOUS; listeners run in subscription order over a snapshot taken at emit time
//     (a listener added during an emit is not called for that emit; one removed during it still is).
//   - a throwing listener is reported with console.error and never stops the other listeners or the
//     emitter.
//   - on/once return an `off()` function; calling it twice is harmless.
//   - event names are not validated (features may use private names like 'search:done'), but core
//     code only emits names from EV.

export const EV = Object.freeze({
  FARM_CHANGE: 'farm:change',         // {caps, prev, changed: string[]} — only when a caps field changed
  FARM_TICK: 'farm:tick',             // {caps, now} — on EVERY __lolChatRefresh call (wall-clock rules run here)
  VISIBLE: 'ui:visible',              // {visible, pageVisible}
  // {threadId, created?}  threadId null = no thread / empty view; created:true ONLY from
  // controller.newThread() - a thread nobody has used yet (the model picker writes a held pick
  // onto one of those and never onto a thread the reader merely opened).
  THREAD_SELECTED: 'thread:selected',
  THREADS_CHANGED: 'threads:changed', // {reason:'create'|'update'|'delete'|'import'|'migrate'|'attach', ids: string[]}
  MESSAGE_PUT: 'message:put',         // Message (non-streaming updates)
  STREAM_START: 'stream:start',       // {message}
  STREAM_END: 'stream:end',           // {message, result}
  DRAFT_CHANGE: 'composer:draft',     // Draft — also emitted by addPart/updatePart/removePart
  GOV_CHANGE: 'gov:change',           // {foreground:'idle'|'streaming'|'held', holder}
  STORE_MODE: 'store:mode',           // 'pending'|'idb'|'memory'|'memory-final'  (payload is the bare string)
  STORE_ERROR: 'store:error',         // {op, error}
  BRANCH_SWITCH: 'branch:switch',     // {messageId, dir: -1|1}
  REQUEST_PREVIEW: 'request:preview', // {request: RequestDraft}
});

/**
 * @typedef {{
 *   on(name: string, fn: (payload: any) => void): () => void,
 *   once(name: string, fn: (payload: any) => void): () => void,
 *   emit(name: string, payload?: any): void,
 *   listenerCount(name: string): number,
 * }} Bus
 */

/** @returns {Bus} */
export function createBus() {
  /** @type {Map<string, Array<(payload: any) => void>>} */
  const map = new Map();

  /** @param {string} name @param {(payload: any) => void} fn */
  function on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError(`bus.on(${name}): listener must be a function`);
    const list = map.get(name) || [];
    // Wrap so the same function subscribed twice gets two independent subscriptions.
    const entry = (/** @type {any} */ p) => fn(p);
    list.push(entry);
    map.set(name, list);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const cur = map.get(name);
      if (!cur) return;
      const i = cur.indexOf(entry);
      if (i >= 0) cur.splice(i, 1);
      if (!cur.length) map.delete(name);
    };
  }

  /** @param {string} name @param {(payload: any) => void} fn */
  function once(name, fn) {
    const off = on(name, (p) => { off(); fn(p); });
    return off;
  }

  /** @param {string} name @param {any} [payload] */
  function emit(name, payload) {
    const list = map.get(name);
    if (!list || !list.length) return;
    for (const fn of list.slice()) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[lolchat] listener for "${name}" threw`, err);
      }
    }
  }

  /** @param {string} name */
  function listenerCount(name) {
    const list = map.get(name);
    return list ? list.length : 0;
  }

  return { on, once, emit, listenerCount };
}
