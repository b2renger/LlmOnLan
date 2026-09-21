// @ts-check
// The workbench: the third column of LOL Chat and the host of SLOTS.WORKBENCH_PANELS
// (S0-U1, studio plan §3.5.1–§3.5.3, DOM contract frozen in LOLCHAT_PLAN.md §2.6 BD-8). A FEATURE:
// install(app) publishes `app.work` and nothing else on the page changes until a panel registers.
//
// The four things this file is responsible for, and the reason each one is here rather than in a
// panel:
//
// 1. ONE LIVE PANEL, EVER. Switching tabs calls the old panel's hide() and destroy() BEFORE the new
//    one is created, so two panels can never both hold a rAF, a sandbox iframe or an in-flight ask
//    — not even for a frame. A panel owns only the element the workbench hands it (§2.6 AE); only
//    the workbench replaceChildren()s els.workBody.
// 2. HIDDEN MEANS IDLE. EV.VISIBLE with visible:false or pageVisible:false suspends the live panel
//    (hide()), and a panel still hidden after GRACE_MS is destroyed outright. The shell hides
//    #lolchat whenever the reader is in Open WebUI; a panel that kept animating there would burn
//    the battery of a machine whose whole point is that the GPU work happens elsewhere.
// 3. THE WIDTH IS THE READER'S, PER THREAD. `chat | split | work` lives in `thread.studio` (written
//    silently and debounced, §3.5.3) and the split fraction in `kv ui:workWidth`, so a conversation
//    reopens the way it was left and a drag survives a relaunch.
// 4. THE RAIL IS BUILT AT RENDER TIME (§2.6 AD). `registry.list(WORKBENCH_PANELS)` is read on every
//    sync, never cached at install, so a panel that registers later simply appears. With the slot
//    empty — the whole of S0 — there is no rail, no column and no grid change at all.
//
// The Computer panel (docs/LOLCHAT_COMPUTER_SPEC.md) is the first real tenant; it registers itself
// from its own module in the next phase. Nothing here knows what a panel contains.

import { EV } from '../core/events.mjs';
import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { KV_KEYS } from '../core/types.mjs';
import { icon } from './layout.mjs';
import {
  WIDTHS, DEFAULT_WIDTH, DEFAULT_FRACTION, isWidth, nextWidth, clampFraction, parseFraction,
  formatFraction, emptyStudio, sanitizeStudio, mergeStudio, createStudioWriter,
} from '../app/studio-state.mjs';
import '../strings/studio.en.mjs';

/** A panel hidden this long is destroyed rather than kept suspended (§4 S0-U1). */
export const GRACE_MS = 10000;

/** How long a studio write waits for the next change, like drafts (§3.5.3). */
export const STUDIO_DEBOUNCE_MS = 500;

/** Lucide-style glyphs, so a panel that ships no icon still gets a tab that reads as a tab. */
const DEFAULT_ICON = 'M4 5h16v14H4z';
const GRIP_STEP = 0.02;

// t() needs a string literal or a same-file literal map (lint rule 5), which is also why these two
// tables are module-level consts rather than inline objects.
const WIDTH_LABEL = {
  chat: 'studio.widthChat',
  split: 'studio.widthSplit',
  work: 'studio.widthWork',
};
const WIDTH_HINT = {
  chat: 'studio.widthChatHint',
  split: 'studio.widthSplitHint',
  work: 'studio.widthWorkHint',
};

/** @param {string} tag @param {Record<string, string>} attrs @returns {HTMLElement} */
function el(tag, attrs = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Never let one panel's throw take the workbench (or the chat) down. @param {string} what @param {() => any} fn */
function safe(what, fn) {
  try { return fn(); } catch (err) { console.warn(`[lolchat] workbench: ${what} threw`, err); return null; }
}

/**
 * @param {any} app
 * @returns {any} app.work
 */
export function install(app) {
  const els = app.els || {};
  if (!els.work || !els.workRail || !els.workHead || !els.workBody || !app.root) return null;

  const root = app.root;
  const bus = app.bus;
  // The 10 s grace is a real wall-clock delay; the harness shortens it with `flags.workGraceMs`
  // rather than sleeping ten seconds per scenario (the same trick as `idbOpenDelayMs`).
  const graceMs = Number(app.flags && app.flags.workGraceMs) > 0 ? Number(app.flags.workGraceMs) : GRACE_MS;

  /** The panel the workbench is OPEN on (what current() reports and the rail selects). */
  /** @type {string|null} */ let openId = null;
  /** The panel that is INSTANTIATED right now. Equal to openId unless the grace destroyed it. */
  /** @type {string|null} */ let liveId = null;
  /** @type {any} */ let live = null;
  /** @type {boolean} */ let suspended = false;
  /** @type {any} */ let destroyTimer = null;

  /** @type {string} */ let width = DEFAULT_WIDTH;
  /** @type {number} */ let fraction = DEFAULT_FRACTION;

  /** @type {any} */ let thread = null;
  /** @type {number} */ let threadEpoch = 0;
  /** @type {import('../core/types.mjs').StudioState} */ let studio = emptyStudio(app.now());

  /** @type {Set<(s: any) => void>} */ const listeners = new Set();
  /** @type {Map<string, HTMLElement>} */ const tabs = new Map();
  /** @type {string} */ let railSignature = '';
  /** @type {string} */ let lastAnnounced = '';

  // ---- persistence -----------------------------------------------------------------------------

  const writer = createStudioWriter({
    delayMs: STUDIO_DEBOUNCE_MS,
    save: (id, value) => {
      const repo = app.repo;
      if (!repo || typeof repo.updateThread !== 'function') return null;
      // §2.6 BB-7: silent — neither the thread list nor the header renders studio state.
      return Promise.resolve(repo.updateThread(id, { studio: value }, { silent: true }))
        .catch((err) => { console.warn('[lolchat] workbench: studio write failed', err); });
    },
  });

  /** @param {string} key @param {any} value */
  function kvSet(key, value) {
    const repo = app.repo;
    if (!repo || typeof repo.kvSet !== 'function') return;
    Promise.resolve(repo.kvSet(key, value)).catch(() => { /* a memory store speaks through its banner */ });
  }

  /** @param {string} key */
  async function kvGet(key) {
    const repo = app.repo;
    if (!repo || typeof repo.kvGet !== 'function') return null;
    try { return await repo.kvGet(key, null); } catch (err) { void err; return null; }
  }

  /** Push the current panel + width into `thread.studio` (debounced, silent). */
  function persistStudio() {
    const before = studio;
    const next = mergeStudio(before, { panel: openId, width }, { now: app.now(), panels: panelIds() });
    if (next === before) return;                    // mergeStudio keeps the identity when nothing moved
    studio = next;
    if (app.state.threadId) writer.put(app.state.threadId, next);
  }

  // ---- the registry slot, read at render time (§2.6 AD) ----------------------------------------

  /** @returns {any[]} every registered panel, with its availability resolved. */
  function items() {
    let list = [];
    try { list = app.registry.list(SLOTS.WORKBENCH_PANELS); } catch (err) { void err; return []; }
    return list.map((item) => {
      let verdict = true;
      if (typeof item.available === 'function') verdict = safe(`available(${item.id})`, () => item.available(app));
      const reason = verdict && typeof verdict === 'object' && typeof verdict.no === 'string' ? verdict.no : null;
      return { item, id: String(item.id), label: String(item.label || item.id), available: verdict === true || verdict == null, reason };
    });
  }

  /** @returns {Set<string>} */
  function panelIds() {
    return new Set(items().map((p) => p.id));
  }

  /** @param {string|null} id */
  function entry(id) {
    if (!id) return null;
    return items().find((p) => p.id === id) || null;
  }

  // ---- the rail --------------------------------------------------------------------------------

  /** @param {any} p @returns {HTMLElement} */
  function buildTab(p) {
    const tab = el('button', {
      type: 'button',
      class: 'chat-work-tab',
      role: 'tab',
      'data-panel': p.id,
      id: `chat-work-tab-${p.id}`,
      'aria-controls': 'chat-work-body',
      'aria-selected': 'false',
      tabindex: '-1',
    });
    const glyph = typeof p.item.icon === 'string' && p.item.icon ? p.item.icon : DEFAULT_ICON;
    tab.appendChild(icon(glyph));
    const label = el('span', { class: 'chat-work-tab-label' });
    label.textContent = p.label;
    tab.appendChild(label);
    if (!p.available) {
      tab.setAttribute('aria-disabled', 'true');
      tab.setAttribute('title', p.reason ? t('studio.panelUnavailable', { panel: p.label, reason: p.reason }) : p.label);
    } else {
      tab.setAttribute('title', p.label);
    }
    tab.addEventListener('click', () => {
      if (!p.available) return;
      if (openId === p.id) close();                       // BD-8: clicking the live tab closes it
      else open(p.id);
    });
    return tab;
  }

  /** Rebuild the rail only when the SET of panels changed; always refresh selection state. */
  function syncRail() {
    const list = items();
    const signature = list.map((p) => `${p.id}:${p.label}:${p.available ? 1 : 0}`).join('|');
    if (signature !== railSignature) {
      railSignature = signature;
      tabs.clear();
      const nodes = list.map((p) => {
        const tab = buildTab(p);
        tabs.set(p.id, tab);
        return tab;
      });
      els.workRail.replaceChildren(...nodes);
    }
    let roving = false;
    for (const [id, tab] of tabs) {
      const selected = id === openId;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.classList.toggle('is-live', selected);
      if (selected) { tab.setAttribute('tabindex', '0'); roving = true; } else tab.setAttribute('tabindex', '-1');
    }
    if (!roving) {
      const first = els.workRail.querySelector('[role="tab"]:not([aria-disabled="true"])');
      if (first) first.setAttribute('tabindex', '0');
    }
    const p = entry(openId);
    headTitle.textContent = p ? p.label : t('studio.bodyLabel');
    els.workBody.setAttribute('aria-labelledby', p ? `chat-work-tab-${p.id}` : 'chat-work-title');
    return list;
  }

  /** Roving tabindex: ←/→ walk the rail, Home/End jump. @param {any} e */
  function onRailKey(e) {
    const order = Array.from(tabs.keys()).filter((id) => {
      const tab = tabs.get(id);
      return tab && tab.getAttribute('aria-disabled') !== 'true';
    });
    if (!order.length) return;
    const active = document.activeElement;
    const at = order.findIndex((id) => tabs.get(id) === active);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1 + order.length) % order.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + order.length) % order.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = order.length - 1;
    else return;
    e.preventDefault();
    for (const id of order) {
      const tab = tabs.get(id);
      if (tab) tab.setAttribute('tabindex', id === order[next] ? '0' : '-1');
    }
    const target = tabs.get(order[next]);
    if (target && typeof target.focus === 'function') target.focus();
  }

  // ---- the head: title + the width radiogroup ---------------------------------------------------

  const headTitle = el('div', { class: 'chat-work-title', id: 'chat-work-title' });
  headTitle.textContent = t('studio.bodyLabel');
  const widthGroup = el('div', { class: 'chat-work-widths', role: 'radiogroup', 'aria-label': t('studio.widthLabel') });
  /** @type {Map<string, HTMLElement>} */ const widthButtons = new Map();
  for (const state of WIDTHS) {
    const btn = el('button', {
      type: 'button',
      class: 'chat-work-width',
      role: 'radio',
      'data-width': state,
      'aria-checked': 'false',
      'aria-label': t(/** @type {any} */ (WIDTH_LABEL)[state]),
      title: t(/** @type {any} */ (WIDTH_HINT)[state]),
      tabindex: '-1',
    });
    btn.textContent = t(/** @type {any} */ (WIDTH_LABEL)[state]);
    btn.addEventListener('click', () => setWidth(state));
    widthButtons.set(state, btn);
    widthGroup.appendChild(btn);
  }
  els.workHead.replaceChildren(headTitle, widthGroup);
  els.workRail.setAttribute('role', 'tablist');
  els.workRail.setAttribute('aria-label', t('studio.railLabel'));
  els.workRail.setAttribute('aria-orientation', 'horizontal');
  els.workRail.addEventListener('keydown', onRailKey);
  els.workBody.setAttribute('role', 'tabpanel');
  els.workBody.setAttribute('id', 'chat-work-body');
  els.workBody.setAttribute('aria-labelledby', 'chat-work-title');

  // ---- the drag handle --------------------------------------------------------------------------

  const grip = el('div', {
    class: 'chat-work-grip',
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': t('studio.gripLabel'),
    tabindex: '0',
  });
  els.work.appendChild(grip);

  /** @param {number} clientX @returns {number} */
  function fractionAt(clientX) {
    const rect = root.getBoundingClientRect();
    if (!rect || !rect.width) return fraction;
    return clampFraction((rect.right - clientX) / rect.width);
  }

  let dragging = false;
  let fractionTouched = false;                      // the reader moved the handle in this session
  grip.addEventListener('pointerdown', (/** @type {any} */ e) => {
    if (width !== 'split') return;
    dragging = true;
    grip.classList.add('is-dragging');
    try { grip.setPointerCapture(e.pointerId); } catch (err) { void err; }
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (/** @type {any} */ e) => {
    if (!dragging) return;
    fraction = fractionAt(e.clientX);
    applyWidth();
  });
  const endDrag = (/** @type {any} */ e) => {
    if (!dragging) return;
    dragging = false;
    grip.classList.remove('is-dragging');
    try { if (e && e.pointerId != null) grip.releasePointerCapture(e.pointerId); } catch (err) { void err; }
    fractionTouched = true;
    kvSet(KV_KEYS.workWidth, formatFraction(fraction));
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('keydown', (/** @type {any} */ e) => {
    if (width !== 'split') return;
    let delta = 0;
    if (e.key === 'ArrowLeft') delta = GRIP_STEP;          // the panel grows leftwards
    else if (e.key === 'ArrowRight') delta = -GRIP_STEP;
    else return;
    e.preventDefault();
    fraction = clampFraction(fraction + delta);
    fractionTouched = true;
    applyWidth();
    kvSet(KV_KEYS.workWidth, formatFraction(fraction));
  });

  // ---- width -----------------------------------------------------------------------------------

  /**
   * The split column in pixels: the reader's fraction, floored at 320px and capped at 70 % of the
   * window — studio plan §3.5.1's clamp(), computed here rather than in CSS because a clamp() with
   * a percentage inside a grid track sizes to ZERO in the shipped Chromium (measured in the harness
   * at the S0 build: `240px 1024px 0px`). The ResizeObserver below keeps it honest as the window
   * changes; nothing about it is a wall clock.
   */
  function splitPx() {
    const w = root.getBoundingClientRect().width || 0;
    if (!w) return Math.round(DEFAULT_FRACTION * 1000);
    return Math.round(Math.min(w * 0.7, Math.max(320, w * fraction)));
  }

  /** Paint the resolved width state onto the grid, the column and the radiogroup. */
  function applyWidth() {
    const hasPanels = tabs.size > 0;
    const resolved = openId ? width : DEFAULT_WIDTH;
    els.work.setAttribute('data-width', resolved);
    const closed = resolved === 'chat' || !hasPanels;
    els.work.classList.toggle('hidden', closed);
    for (const state of WIDTHS) root.classList.toggle(`chat-w-${state}`, !closed && state === resolved);
    root.style.setProperty('--chat-work-user', `${Math.round(fraction * 10000) / 100}%`);
    root.style.setProperty('--chat-work-w', closed ? '0px' : `${splitPx()}px`);
    for (const [state, btn] of widthButtons) {
      const on = state === resolved;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.setAttribute('tabindex', on ? '0' : '-1');
      btn.classList.toggle('is-on', on);
    }
    grip.classList.toggle('hidden', resolved !== 'split');
  }

  /**
   * @param {string} next
   * @param {{announce?: boolean}} [o]
   */
  function setWidth(next, o = {}) {
    const want = isWidth(next) ? next : DEFAULT_WIDTH;
    if (want !== DEFAULT_WIDTH && !openId) {
      // asking for a width with nothing open means "open the workbench"
      const target = defaultPanel();
      if (!target) return width;
      open(target, { width: want });
      return width;
    }
    if (want === DEFAULT_WIDTH && openId) { close(); return width; }
    const changed = want !== width;
    width = want;
    applyWidth();
    if (changed) {
      persistStudio();
      if (o.announce !== false) announce(t('studio.announceWidth', { width: t(/** @type {any} */ (WIDTH_LABEL)[width]) }));
      emit();
    }
    return width;
  }

  // ---- panel lifecycle --------------------------------------------------------------------------

  function cancelGrace() {
    if (destroyTimer != null) { clearTimeout(destroyTimer); destroyTimer = null; }
  }

  function ctx() {
    return { thread, studio: sanitizeStudio({ ...studio, panel: openId, width }, { panels: panelIds() }) };
  }

  /**
   * C1 landing fix (contract request from C1-U2). §2.6 AP.1 starts a BRAND-NEW thread with the
   * workbench closed and `thread = null`, and no second THREAD_SELECTED ever arrives for it — so a
   * panel opened on the most ordinary route there is (start a chat, then open the panel) was handed
   * `ctx.thread === null` for the rest of its life and could not load or write its per-thread state.
   * Resolve the row lazily, once, when a panel is instantiated, and TELL the live panel.
   * Epoch-guarded like onThreadSelected: a reader who moved on wins.
   */
  function ensureThread() {
    if (thread) return;
    const id = app.state && typeof app.state.threadId === 'string' ? app.state.threadId : null;
    const repo = app.repo;
    if (!id || !repo || typeof repo.getThread !== 'function') return;
    const epoch = threadEpoch;
    void Promise.resolve()
      .then(() => repo.getThread(id))
      .then((row) => {
        if (!row || thread || epoch !== threadEpoch) return;
        thread = row;
        if (live && !suspended) safe(`${liveId}.onThread()`, () => live.onThread(ctx()));
      }, () => {});
  }

  /** Suspend the live panel: everything expensive stops, the DOM stays. */
  function suspend() {
    if (!live || suspended) return;
    suspended = true;
    safe(`${liveId}.hide()`, () => live.hide());
    cancelGrace();
    destroyTimer = setTimeout(() => { destroyTimer = null; if (suspended) teardown(); }, graceMs);
  }

  function resume() {
    if (!live) { instantiate(); return; }
    cancelGrace();
    if (!suspended) return;
    suspended = false;
    safe(`${liveId}.show()`, () => live.show(ctx()));
  }

  /** Destroy the instance (the panel id stays OPEN: it is re-created when the chat comes back). */
  function teardown() {
    cancelGrace();
    if (!live) { liveId = null; suspended = false; els.workBody.replaceChildren(); return; }
    const id = liveId;
    safe(`${id}.destroy()`, () => live.destroy());
    live = null;
    liveId = null;
    suspended = false;
    els.workBody.replaceChildren();
    const debug = app.root && window.LolChat && window.LolChat.debug;
    if (debug && id && Object.prototype.hasOwnProperty.call(debug, id)) delete debug[id];
  }

  /** Create + show the open panel. Called only when the chat is really on screen. */
  function instantiate() {
    if (live || !openId) return;
    const p = entry(openId);
    if (!p || !p.available || typeof p.item.create !== 'function') return;
    const host = el('div', { class: 'chat-work-panel', 'data-panel': p.id });
    els.workBody.replaceChildren(host);             // only the workbench writes into els.workBody
    const instance = safe(`${p.id}.create()`, () => p.item.create(host, app));
    if (!instance || typeof instance.show !== 'function') {
      els.workBody.replaceChildren();
      return;
    }
    live = instance;
    liveId = p.id;
    suspended = false;
    const debug = window.LolChat && window.LolChat.debug;
    if (debug && instance.debug) debug[p.id] = instance.debug;
    safe(`${p.id}.show()`, () => instance.show(ctx()));
    ensureThread();
  }

  const onScreen = () => !!(app.state.visible && app.state.pageVisible);

  // ---- the public API ---------------------------------------------------------------------------

  /** `kv ui:workPanel`: the last panel opened, used only when a thread names none. */
  /** @type {string|null} */ let lastPanelKv = null;

  /** @returns {string|null} the panel a bare "open the workbench" should use */
  function defaultPanel() {
    const list = items().filter((p) => p.available);
    if (!list.length) return null;
    if (lastPanelKv && list.some((p) => p.id === lastPanelKv)) return lastPanelKv;
    return list[0].id;
  }

  /**
   * @param {string} id
   * @param {{width?: string, announce?: boolean}} [o]
   */
  function open(id, o = {}) {
    const p = entry(id);
    if (!p || !p.available) return snapshot();
    if (openId === id) {
      if (onScreen()) resume();
      syncRail();
      applyWidth();
      return snapshot();
    }
    // Rule 1 (§3.5.2): the old panel is hidden AND destroyed before the new one exists.
    if (live) { suspend(); teardown(); }
    openId = id;
    lastPanelKv = id;
    kvSet(KV_KEYS.workPanel, id);
    const wanted = o.width && isWidth(o.width) ? o.width : (isWidth(p.item.defaultWidth) ? String(p.item.defaultWidth) : 'split');
    width = wanted;
    syncRail();
    applyWidth();
    if (onScreen()) instantiate();
    persistStudio();
    if (o.announce !== false) {
      announce(t('studio.announceOpen', { panel: p.label, width: t(/** @type {any} */ (WIDTH_LABEL)[width]) }));
    }
    emit();
    return snapshot();
  }

  /** @param {{announce?: boolean}} [o] */
  function close(o = {}) {
    if (!openId && width === DEFAULT_WIDTH) return snapshot();
    if (live) { suspend(); teardown(); }
    openId = null;
    width = DEFAULT_WIDTH;
    syncRail();
    applyWidth();
    persistStudio();
    if (o.announce !== false) announce(t('studio.announceClose'));
    emit();
    return snapshot();
  }

  function snapshot() {
    return { panel: openId, width: openId ? width : DEFAULT_WIDTH };
  }

  function emit() {
    const s = snapshot();
    for (const fn of Array.from(listeners)) safe('work.on listener', () => fn(s));
  }

  /** One live-region line per change, never the same line twice in a row. @param {string} text */
  function announce(text) {
    if (!els.live || !text || text === lastAnnounced) return;
    lastAnnounced = text;
    els.live.textContent = text;
  }

  // ---- thread switching --------------------------------------------------------------------------

  /** @param {any} payload */
  async function onThreadSelected(payload) {
    const id = payload && typeof payload.threadId === 'string' ? payload.threadId : null;
    const epoch = ++threadEpoch;
    writer.flush();                                  // the pending value belongs to the old thread
    thread = null;

    // §2.6 AP.1: a brand-new thread nobody has used yet starts closed.
    if (!id || (payload && payload.created)) {
      studio = emptyStudio(app.now());
      if (openId) { if (live) { suspend(); teardown(); } openId = null; width = DEFAULT_WIDTH; }
      syncRail(); applyWidth(); emit();
      return;
    }

    const repo = app.repo;
    let row = null;
    if (repo && typeof repo.getThread === 'function') {
      try { row = await repo.getThread(id); } catch (err) { void err; }
    }
    if (epoch !== threadEpoch) return;               // the reader moved on while we were reading
    thread = row;
    const known = panelIds();
    const next = sanitizeStudio(row && row.studio, { panels: known });
    studio = next;

    if (next.panel && known.has(next.panel)) {
      if (openId === next.panel) {
        // Rule 4: the panel is TOLD, never re-created.
        width = next.width;
        syncRail(); applyWidth();
        if (live) safe(`${openId}.onThread()`, () => live.onThread(ctx()));
        else if (onScreen()) instantiate();
        emit();
      } else {
        open(next.panel, { width: next.width, announce: false });
      }
      return;
    }
    if (openId) close({ announce: false });
    else { syncRail(); applyWidth(); }
  }

  // ---- wiring -------------------------------------------------------------------------------------

  bus.on(EV.VISIBLE, (/** @type {any} */ p) => {
    const on = !!(p && p.visible && p.pageVisible);
    if (!openId) return;
    if (on) resume();
    else suspend();
  });

  bus.on(EV.THREAD_SELECTED, (/** @type {any} */ p) => {
    void onThreadSelected(p);
  });

  // Shortcuts are registry items, so ui/shortcuts.mjs keeps the single document listener and its
  // "only while the chat is visible and focus is ours" rule (§4 S0-U1).
  app.registry.add(SLOTS.SHORTCUTS, {
    id: 'work-cycle',
    keys: 'Ctrl+\\',
    label: t('studio.shortcutCycle'),
    run() { setWidth(nextWidth(openId ? width : DEFAULT_WIDTH)); },
  });
  for (let n = 1; n <= 4; n++) {
    app.registry.add(SLOTS.SHORTCUTS, {
      id: `work-panel-${n}`,
      keys: `Ctrl+${n}`,
      label: t('studio.shortcutPanel', { n }),
      run() {
        const list = items().filter((p) => p.available);
        const p = list[n - 1];
        if (!p) return;
        if (openId === p.id) close();
        else open(p.id);
      },
    });
  }

  syncRail();
  applyWidth();

  // A window resize re-resolves the split column (the 320px floor and the 70 % cap are in px).
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => { if (openId && width === 'split') applyWidth(); });
    ro.observe(root);
  }

  // The stored split fraction and the last panel. Read at install AND again when the store settles:
  // at install the repo may still be opening IndexedDB, and kvGet then answers with the fallback
  // rather than waiting — which silently lost every dragged width across a relaunch (caught by
  // s0-workbench-open). A fraction the reader has already touched in this session always wins.
  function loadPrefs() {
    void (async () => {
      const stored = parseFraction(await kvGet(KV_KEYS.workWidth));
      if (stored != null && !dragging && !fractionTouched) { fraction = stored; applyWidth(); }
      const last = await kvGet(KV_KEYS.workPanel);
      if (typeof last === 'string' && last) lastPanelKv = last;
    })();
  }
  loadPrefs();
  bus.on(EV.STORE_MODE, () => loadPrefs());

  const api = {
    open: (/** @type {string} */ id) => open(id),
    close: () => close(),
    current: () => openId,
    /** @param {string} [state] getter with no argument, setter with one */
    width: (/** @type {any} */ state) => (state === undefined ? (openId ? width : DEFAULT_WIDTH) : setWidth(state)),
    /** The registered panels, read from the slot AT CALL TIME, and a rail re-sync as a side effect. */
    panels: () => syncRail().map((p) => ({ id: p.id, label: p.label, available: p.available, reason: p.reason })),
    /** A panel (or a feature) asking the workbench to show it. @param {string} id @param {string} [state] */
    request: (/** @type {string} */ id, /** @type {any} */ state) => open(id, { width: state }),
    /** @param {(s: any) => void} fn */
    on: (fn) => {
      if (typeof fn !== 'function') return () => { };
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  app.work = api;

  // ---- the way IN ------------------------------------------------------------------------------
  // The rail is inside the work column, so while the workbench is closed it has zero width and the
  // only openers are the shortcuts. That made the Computer invisible to the first person who ran
  // the client. One button in the thread header, listed by the header host on every render, is the
  // visible door: it opens the panel you used last (or the first available one) and closes the live
  // one. It renders nothing at all when no panel is registered, so a build without panels is
  // unchanged.
  // The header host rebuilds its row on ITS own events, not on ours, so one subscription for the
  // life of the app keeps whichever button is currently mounted in step — no per-node observers.
  const HEADER_HINT = { on: 'studio.headerClose', off: 'studio.headerOpen' };

  function syncHeaderButton() {
    const b = app.root && app.root.querySelector('[data-workbench-toggle]');
    if (!b) return;
    const on = !!openId;
    const id = b.getAttribute('data-workbench-toggle') || '';
    const p = entry(on ? openId : id) || entry(id);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = t(HEADER_HINT[on ? 'on' : 'off'], { panel: p ? p.label : t('studio.bodyLabel') });
  }
  api.on(syncHeaderButton);

  app.registry.add(SLOTS.THREAD_HEADER, {
    id: 'workbench',
    order: 300,
    render() {
      const list = items().filter((p) => p.available);
      if (!list.length) return null;
      const target = list.find((p) => p.id === (openId || lastPanelKv)) || list[0];
      const live = !!openId && list.some((p) => p.id === openId);
      const b = el('button', {
        type: 'button',
        class: live ? 'chat-header-work on' : 'chat-header-work',
        'data-workbench-toggle': target.id,
        'aria-pressed': live ? 'true' : 'false',
        title: t(HEADER_HINT[live ? 'on' : 'off'], { panel: target.label }),
      });
      b.appendChild(icon(typeof target.item.icon === 'string' && target.item.icon ? target.item.icon : DEFAULT_ICON));
      const label = el('span');
      label.textContent = target.label;
      b.appendChild(label);
      b.addEventListener('click', () => {
        if (openId) close();
        else open(target.id);
        syncHeaderButton();
      });
      return b;
    },
  });

  const debug = window.LolChat && window.LolChat.debug;
  if (debug) {
    debug.work = {
      state: () => ({ open: openId, live: liveId, suspended, width, fraction, panels: Array.from(tabs.keys()) }),
      studio: () => ({ ...studio }),
      flush: () => writer.flush(),
      graceMs,
    };
  }

  return api;
}
