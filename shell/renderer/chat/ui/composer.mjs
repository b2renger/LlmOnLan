// @ts-check
// The composer: the form, the draft, the part tray and the submit pipeline (plan §3.4, §3.6.1).
//
// Contract (plan §3.4):
//   createComposer(app, els) → {
//     getDraft(), setText(s), insertText(s), clear(), focus(),
//     addPart(part, {label, thumbDataUrl?, status?}) → key, updatePart(key, patch), removePart(key),
//     setBusy(state), setSendState({label, disabled?, armed?}), isLocked(),
//     region('above'|'tray'|'tools'|'meter'), on('input'|'submit', fn) → off }
//
// Submit pipeline (§3.6.1, in this exact order):
//   1. submit (button / Enter / requestSubmit) → preventDefault; ignored while locked or while the
//      governor's foreground is not idle; otherwise the composer LOCKS for the whole chain.
//   2. getDraft() reads #chat-input.value NOW (the e2e same-tick contract).
//   3. fingerprint = hash(text + parts + recipeId + vars + model) — only what the user wrote or
//      chose, never an enrichment result, so a confirm gate's "second click" matches.
//   4. BEFORE_SEND stage 'gate' items, in order. Any null stops the send, the draft STAYS, unlock.
//   5. BEFORE_SEND stage 'enrich' items, in order (they may use the network; they run once per
//      actual send, after every gate passed).
//   6. controller.send(draft); the composer unlocks as soon as `send` has appended its messages —
//      observed as the FIRST of EV.STREAM_START, a non-idle EV.GOV_CHANGE, or send() settling
//      (a local note, e.g. the farm-busy answer, never streams).
//   After 150 ms still locked, Send shows "Preparing…".
//
// Two skeleton buttons that live in another unit's region are bound HERE (plan §2.6 P):
//   #chat-new  → controller.newThread(), then clear + focus (the sidebar must NOT bind it; the
//                harness clicks it on every h.submit()),
//   #chat-stop → controller.stop().
//
// While the governor is busy: Stop shown, Send hidden, and the textarea stays ENABLED (v0.1.45
// disabled it, which threw away what the user was typing during a long reply).

import { EV } from '../core/events.mjs';
import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { hash } from '../core/ids.mjs';
import '../strings/composer.en.mjs';

const PREPARING_MS = 150;
const REFUSED_TOAST_MS = 3000;          // rate limit for "A reply is already running."

const MAX_INPUT_PX = 200;
/** Safety net: a controller.send() that never settles and never streams must not lock the composer
 *  for the rest of the session. */
const UNLOCK_TIMEOUT_MS = 20000;

/** @param {string} tag @param {string} cls @returns {HTMLElement} */
function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

/**
 * @param {import('../core/types.mjs').App} app
 * @param {import('../core/types.mjs').Els} els
 */
export function createComposer(app, els) {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  /** @type {Map<string, {part: any, label: string, thumbDataUrl: string|null, status: string, row: HTMLElement}>} */
  const parts = new Map();

  let locked = false;
  let lastRefusedToast = 0;               // app.now() of the last "a reply is already running" toast
  /** @type {any} */
  let prepTimer = null;
  /** @type {string|null} */
  let labelBeforePreparing = null;

  const autogrows = (() => {
    try {
      return !!(typeof CSS !== 'undefined' && CSS && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content'));
    } catch {
      return false;
    }
  })();

  // ---- events ------------------------------------------------------------------------------

  /** @param {string} name @param {any} payload */
  function fire(name, payload) {
    for (const fn of listeners.get(name) || []) {
      try { fn(payload); } catch (err) { console.warn('[lolchat] composer listener threw', err); }
    }
  }

  function draftChanged() {
    const draft = api.getDraft();
    fire('input', draft);
    app.bus.emit(EV.DRAFT_CHANGE, draft);
    return draft;
  }

  // ---- the part tray -----------------------------------------------------------------------

  /** @param {string} key */
  function renderChip(key) {
    const entry = parts.get(key);
    if (!entry) return;
    const row = entry.row;
    row.className = `chat-chip is-${entry.status}`;
    row.dataset.key = key;
    row.dataset.type = entry.part && entry.part.type ? String(entry.part.type) : 'text';

    /** @type {Node[]} */
    const kids = [];
    if (entry.thumbDataUrl) {
      const img = /** @type {HTMLImageElement} */ (el('img', 'chat-chip-thumb'));
      img.src = entry.thumbDataUrl;
      img.alt = '';
      kids.push(img);
    }
    const label = /** @type {HTMLButtonElement} */ (el('button', 'chat-chip-label'));
    label.type = 'button';
    label.textContent = entry.label;
    label.title = entry.label;
    // The chip's NAME is the file, not the affordance: an aria-label of just "Options" replaced the
    // visible text for a screen reader and announced every chip in the tray identically.
    label.removeAttribute('aria-label');
    label.setAttribute('aria-haspopup', 'menu');
    label.addEventListener('click', () => openChipMenu(key, label));
    kids.push(label);

    const x = /** @type {HTMLButtonElement} */ (el('button', 'chat-chip-x'));
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', t('composer.removePart'));
    x.addEventListener('click', () => api.removePart(key));
    kids.push(x);

    row.replaceChildren(...kids);
  }

  /** @param {string} key @param {HTMLElement} anchor */
  function openChipMenu(key, anchor) {
    const entry = parts.get(key);
    if (!entry || !app.dialogs) return;
    const items = app.registry.list(SLOTS.CHIP_ACTIONS)
      .filter((a) => { try { return a.visible ? !!a.visible(entry.part, app) : true; } catch { return false; } });
    if (!items.length) return;
    // `build` is handed the popover's OWN root: fill it, never rename it (its classes are what
    // dialogs.mjs positions and light-dismisses). The menu is a child.
    const popover = app.dialogs.popover(anchor, (/** @type {HTMLElement} */ root, /** @type {Function} */ closeArg) => {
      const menu = el('div', 'chat-menu');
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', `${entry.label} — ${t('composer.partMenu')}`);
      for (const item of items) {
        const b = /** @type {HTMLButtonElement} */ (el('button', 'chat-menu-item'));
        b.type = 'button';
        b.textContent = item.label;
        b.addEventListener('click', () => {
          try { item.run(entry.part, key, app); } catch (err) { console.warn('[lolchat] chip action threw', err); }
          const close = typeof closeArg === 'function' ? closeArg : (popover && popover.close);
          if (typeof close === 'function') close();
        });
        menu.appendChild(b);
      }
      root.appendChild(menu);
    });
  }

  function syncTray() {
    els.tray.classList.toggle('hidden', parts.size === 0);
  }

  // ---- COMPOSER_ACTIONS (P3 registers attach buttons here) ---------------------------------

  function renderActions() {
    const caps = app.farm ? app.farm.get() : null;
    /** @type {Node[]} */
    const kids = [];
    for (const action of app.registry.list(SLOTS.COMPOSER_ACTIONS)) {
      try {
        if (action.visible && !action.visible(caps, app)) continue;
        const node = action.render(app);
        if (node) kids.push(node);
      } catch (err) {
        console.warn(`[lolchat] composer action "${action.id}" threw`, err);
      }
    }
    els.tools.replaceChildren(...kids);
  }

  // ---- lock, Preparing… ---------------------------------------------------------------------

  function lock() {
    locked = true;
    prepTimer = setTimeout(() => {
      prepTimer = null;
      if (!locked) return;
      labelBeforePreparing = els.send.textContent;
      api.setSendState({ label: t('composer.preparing'), disabled: true });
    }, PREPARING_MS);
  }

  function unlock() {
    locked = false;
    if (prepTimer) { clearTimeout(prepTimer); prepTimer = null; }
    if (labelBeforePreparing !== null) {
      api.setSendState({ label: labelBeforePreparing, disabled: false });
      labelBeforePreparing = null;
    }
  }

  /**
   * Resolve as soon as the send has taken hold: the stream started, the governor left idle, or
   * `send()` settled (local notes never stream).
   * @param {Promise<any>} sent
   */
  function untilSendTookHold(sent) {
    return new Promise((resolve) => {
      let done = false;
      /** @type {Function[]} */
      const offs = [];
      /** @type {any} */
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        for (const off of offs) { try { off(); } catch { /* already off */ } }
        if (timer) clearTimeout(timer);
        resolve(undefined);
      };
      offs.push(app.bus.on(EV.STREAM_START, finish));
      offs.push(app.bus.on(EV.GOV_CHANGE, (/** @type {any} */ st) => { if (st && st.foreground !== 'idle') finish(); }));
      timer = setTimeout(finish, UNLOCK_TIMEOUT_MS);
      sent.then(finish, finish);
    });
  }

  // ---- submit -------------------------------------------------------------------------------

  /** @param {any} draft */
  function fingerprintOf(draft) {
    const partKeys = (draft.parts || [])
      .map((/** @type {any} */ p) => `${p && p.type}:${(p && p.attId) || ''}:${JSON.stringify((p && p.pages) || null)}`)
      .join('|');
    return hash([
      draft.text || '',
      partKeys,
      draft.recipeId || '',
      JSON.stringify(draft.vars || null),
      draft.model || '',
    ].join('\u0000'));
  }

  /** @returns {Promise<boolean>} true when controller.send was reached */
  async function doSubmit() {
    if (locked) return false;
    if (app.gov && app.gov.state().foreground !== 'idle') {
      // Enter during a running reply used to do NOTHING visible: no toast, no shake, and the
      // textarea deliberately stays enabled, so the key just vanished. Say why (at most once
      // every REFUSED_TOAST_MS, so leaning on Enter does not stack toasts).
      //
      // A HOLD is not a running reply: while a seat wait is queued nothing is running at all, and
      // "A reply is already running" was simply false (P2 review). The holder supplies the true
      // sentence through gov.hold({note}); the composer never has to know what a seat is.
      const now = app.now();
      if (app.dialogs && now - lastRefusedToast > REFUSED_TOAST_MS) {
        lastRefusedToast = now;
        const held = typeof app.gov.holdNote === 'function' ? app.gov.holdNote() : null;
        app.dialogs.toast(held || t('core.alreadyRunning'));
      }
      return false;
    }
    const draft = api.getDraft();
    if (!draft.text && !draft.parts.length) return false;
    if (!app.controller) return false;

    lock();
    try {
      const fingerprint = fingerprintOf(draft);
      let current = draft;
      for (const stage of ['gate', 'enrich']) {
        for (const item of app.registry.list(SLOTS.BEFORE_SEND)) {
          if ((item.stage || 'gate') !== stage) continue;
          const next = await item.run(current, app, { fingerprint });
          if (!next) return false;                 // a gate said no: the draft stays put
          current = next;
        }
      }
      fire('submit', current);
      clearDraft();
      draftChanged();
      const sent = Promise.resolve(app.controller.send(current))
        .catch((err) => { console.warn('[lolchat] send failed', err); });
      await untilSendTookHold(sent);
      return true;
    } finally {
      unlock();
    }
  }

  function clearDraft() {
    els.input.value = '';
    for (const entry of parts.values()) entry.row.remove();
    parts.clear();
    syncTray();
    autogrow();
  }

  function autogrow() {
    if (autogrows) return;
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, MAX_INPUT_PX)}px`;
  }

  // ---- wiring -------------------------------------------------------------------------------

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    void doSubmit();
  });

  els.input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // IME: a composing Enter commits the candidate, it does not send. `keyCode === 229` is the
    // legacy signal some IMEs still use and `isComposing` misses.
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    els.form.requestSubmit();
  });

  els.input.addEventListener('input', () => {
    autogrow();
    draftChanged();
  });

  els.stop.addEventListener('click', () => {
    if (app.controller) app.controller.stop();
  });

  els.newBtn.addEventListener('click', () => {
    if (!app.controller) return;
    app.controller.newThread();
    api.clear();
    api.focus();
  });

  app.bus.on(EV.GOV_CHANGE, (/** @type {any} */ st) => api.setBusy(!!st && st.foreground !== 'idle'));
  app.bus.on(EV.FARM_CHANGE, () => renderActions());

  // ---- the API ------------------------------------------------------------------------------

  const api = {
    /** @returns {import('../core/types.mjs').Draft} */
    getDraft() {
      return {
        text: els.input.value.trim(),
        parts: [...parts.values()].map((e) => e.part),
        model: app.picker ? app.picker.value() : els.model.value,
      };
    },

    /** @param {string} s */
    setText(s) {
      els.input.value = s == null ? '' : String(s);
      autogrow();
      draftChanged();
    },

    /** @param {string} s */
    insertText(s) {
      const text = s == null ? '' : String(s);
      const input = els.input;
      const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
      const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : input.value.length;
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
      const caret = start + text.length;
      try { input.setSelectionRange(caret, caret); } catch { /* detached input */ }
      autogrow();
      draftChanged();
    },

    clear() {
      clearDraft();
      draftChanged();
    },

    focus() {
      try { els.input.focus(); } catch { /* not focusable yet */ }
    },

    /**
     * @param {any} part
     * @param {{label?: string, thumbDataUrl?: string|null, status?: string}} [meta]
     * @returns {string} the chip key (stable for updatePart/removePart)
     */
    addPart(part, meta = {}) {
      const key = app.newId();
      const row = el('div', 'chat-chip');
      parts.set(key, {
        part,
        label: meta.label == null ? String((part && part.type) || '') : String(meta.label),
        thumbDataUrl: meta.thumbDataUrl || null,
        status: meta.status || 'ready',
        row,
      });
      els.tray.appendChild(row);
      renderChip(key);
      syncTray();
      draftChanged();
      return key;
    },

    /** @param {string} key @param {any} patch */
    updatePart(key, patch) {
      const entry = parts.get(key);
      if (!entry) return;
      const p = patch || {};
      if (p.part !== undefined) entry.part = p.part;
      if (p.label !== undefined) entry.label = String(p.label);
      if (p.thumbDataUrl !== undefined) entry.thumbDataUrl = p.thumbDataUrl || null;
      if (p.status !== undefined) entry.status = String(p.status);
      renderChip(key);
      draftChanged();
    },

    /** @param {string} key */
    removePart(key) {
      const entry = parts.get(key);
      if (!entry) return;
      entry.row.remove();
      parts.delete(key);
      syncTray();
      draftChanged();
    },

    /**
     * @param {any} state truthy = the foreground slot is taken
     *
     * STREAMING hides Send and shows Stop. A HOLD keeps Send ON SCREEN (disabled, wearing whatever
     * label the holder gave it) beside Stop: the seat wait writes "Waiting for a seat…" there, and
     * hiding the button hid the only words on screen that tell a queued send apart from a running
     * one — §4 P2-U1 asks for exactly that label (P2 review).
     */
    setBusy(state) {
      const busy = !!state;
      const held = busy && !!app.gov && app.gov.state().foreground === 'held';
      els.send.classList.toggle('hidden', busy && !held);
      els.stop.classList.toggle('hidden', !busy);
    },

    /** @param {{label?: string, disabled?: boolean, armed?: boolean}} state */
    setSendState(state = {}) {
      if (state.label != null) els.send.textContent = String(state.label);
      if (state.disabled !== undefined) els.send.disabled = !!state.disabled;
      if (state.armed !== undefined) els.send.classList.toggle('armed', !!state.armed);
    },

    isLocked() {
      return locked;
    },

    /** @param {'above'|'tray'|'tools'|'meter'} name */
    region(name) {
      if (name === 'above') return els.above;
      if (name === 'tray') return els.tray;
      if (name === 'tools') return els.tools;
      if (name === 'meter') return els.meter;
      throw new Error(`composer.region: unknown region "${name}"`);
    },

    /** @param {'input'|'submit'} name @param {Function} fn @returns {() => void} */
    on(name, fn) {
      const set = listeners.get(name) || new Set();
      set.add(fn);
      listeners.set(name, set);
      return () => set.delete(fn);
    },
  };

  syncTray();
  autogrow();
  renderActions();
  api.setBusy(app.gov ? app.gov.state().foreground !== 'idle' : false);

  return api;
}
