// @ts-check
// The settings popover (plan §4 P2-U4) — a FEATURE: it exports install(app), called by main.mjs
// after every component exists.
//
// It owns els.sideFoot (§2.6 AE): one gear button, whose popover is the HOST of
// SLOTS.SETTINGS_SECTIONS. The two built-in sections are ordinary slot items, so a later feature's
// section (P3's tools, P4's recipes) lands among them by `order` and this file never learns about
// it. The list is read at OPEN time, never cached at install (§2.6 AD).
//
// Built-in **Storage**: where history lives, how much room it takes, export all / import, and the
// "remove the old v1 copy" button — shown only when the v0.1.45 localStorage key still exists, and
// deliberately cautious: it asks v1Status first and offers to bring the stragglers over rather than
// throwing away a chat that was never migrated (§3.7 step 5; the client can still be rolled back to
// v0.1.45, which keeps writing that key).
//
// Built-in **About**: the promise in one sentence — everything stays on this computer.
//
// install() stays cheap enough to run headless (§2.6 AH): createElement, addEventListener,
// appendChild. Nothing measures layout, nothing reads the store — the popover does that when it
// opens.

import { t } from '../core/i18n.mjs';
import { SLOTS } from '../core/registry.mjs';
import { icon } from './layout.mjs';
import { exportAll, importChats } from './transfer.mjs';
import '../strings/library.en.mjs';

/** Lucide `settings` (the gear), trimmed to two paths. */
const GEAR = [
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
];

/** The store-mode sentence, by repo.mode. A literal map, so chat-lint can check every key. */
const MODE_LINE = {
  idb: 'library.storeIdb',
  pending: 'library.storePending',
  memory: 'library.storeMemory',
  'memory-final': 'library.storeMemoryFinal',
};

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/** @param {string} cls @param {string} label @param {() => any} run */
function button(cls, label, run) {
  const b = /** @type {HTMLButtonElement} */ (h('button', cls, label));
  b.type = 'button';
  b.addEventListener('click', () => { void run(); });
  return b;
}

/** 1.2 MB / 340 kB / 900 B — enough precision for "is my history huge?" and no more. @param {number} n */
export function formatBytes(n) {
  const bytes = Number(n);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** @param {any} app */
export function install(app) {
  const foot = app.els && app.els.sideFoot;

  // ---- the built-in sections -----------------------------------------------------------------

  app.registry.add(SLOTS.SETTINGS_SECTIONS, {
    id: 'storage',
    order: 10,
    title: t('library.storage'),
    render: (/** @type {HTMLElement} */ el) => { renderStorage(el, app); },
  });

  app.registry.add(SLOTS.SETTINGS_SECTIONS, {
    id: 'about',
    // 900, not 90: About is the FOOTER of this popover and every later phase adds a section
    // (P2 already added Context and Notifications, which landed after it and read as a middle
    // section). Anything that is not About sorts above it. Raised at the P2 landing.
    order: 900,
    title: t('library.about'),
    render: (/** @type {HTMLElement} */ el) => {
      el.appendChild(h('p', 'chat-settings-line', t('library.aboutBody')));
      el.appendChild(h('p', 'chat-settings-detail', t('library.aboutWhere')));
    },
  });

  if (!foot) return;

  // ---- the gear ------------------------------------------------------------------------------

  const gear = /** @type {HTMLButtonElement} */ (h('button', 'chat-settings-gear'));
  gear.type = 'button';
  gear.setAttribute('aria-label', t('library.settings'));
  gear.title = t('library.settings');
  gear.setAttribute('aria-haspopup', 'dialog');
  gear.appendChild(icon(GEAR, { size: 15 }));
  gear.appendChild(h('span', 'chat-settings-gear-label', t('library.settings')));

  /** @type {{el?: any, close: () => void}|null} */
  let open = null;
  gear.addEventListener('click', () => {
    // The handle alone is not proof that the popover is on SCREEN. A light dismiss — a click
    // elsewhere, or a modal <dialog> taking the top layer, which is what the confirm inside this
    // very popover does — hides it first and removes the node in the `toggle` task that follows, so
    // there is a window in which `open` still points at a connected but hidden element. Asking
    // `:popover-open` is the only answer that is right in both halves of that window. Whatever the
    // verdict, the old handle is dropped: a stale one closes, a visible one closes AND stays closed.
    const el = open ? open.el : null;
    let visible = !!open;
    if (el) {
      try {
        visible = !!el.isConnected
          && (typeof el.matches === 'function' && typeof el.hasAttribute === 'function' && el.hasAttribute('popover')
            ? el.matches(':popover-open')
            : true);
      } catch {
        visible = !!el.isConnected;
      }
    }
    if (open) { open.close(); open = null; }
    if (visible) return;
    if (!app.dialogs) return;
    open = app.dialogs.popover(gear, (/** @type {HTMLElement} */ box, /** @type {() => void} */ close) => {
      box.classList.add('chat-settings');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', t('library.settingsTitle'));
      // Read the slot at OPEN time: a section registered after this feature installed must appear.
      for (const item of app.registry.list(SLOTS.SETTINGS_SECTIONS)) {
        const section = h('section', 'chat-settings-section');
        section.setAttribute('data-section', String(item.id));
        if (item.title) section.appendChild(h('h3', 'chat-settings-title', String(item.title)));
        const body = h('div', 'chat-settings-body');
        section.appendChild(body);
        box.appendChild(section);
        try {
          item.render(body, app, { close });
        } catch (err) {
          console.warn(`[lolchat] settings section "${item.id}" failed to render`, err);
        }
      }
    });
  });

  foot.replaceChildren(gear);
}

// ---------------------------------------------------------------------------------------------
// the Storage section
// ---------------------------------------------------------------------------------------------

/** @param {HTMLElement} el @param {any} app */
function renderStorage(el, app) {
  const repo = app.repo;
  const mode = (repo && repo.mode) || (app.state && app.state.storeMode) || 'pending';
  const line = h('p', 'chat-settings-line', t(MODE_LINE[mode] || MODE_LINE.pending));
  line.setAttribute('data-mode', String(mode));
  el.appendChild(line);

  const usage = h('p', 'chat-settings-detail', t('library.usageUnknown'));
  usage.setAttribute('data-usage', 'pending');
  el.appendChild(usage);
  if (repo && typeof repo.estimate === 'function') {
    Promise.resolve(repo.estimate()).then(
      (/** @type {any} */ est) => {
        if (!est || !Number.isFinite(Number(est.usage))) { usage.setAttribute('data-usage', 'unknown'); return; }
        usage.textContent = t('library.usage', { used: formatBytes(est.usage), quota: formatBytes(est.quota) });
        usage.setAttribute('data-usage', String(Math.round(Number(est.usage))));
      },
      () => { usage.setAttribute('data-usage', 'unknown'); },
    );
  }

  const actions = h('div', 'chat-settings-actions');
  actions.appendChild(button('btn-ghost chat-settings-export', t('library.exportAll'), () => exportAll(app)));
  actions.appendChild(button('btn-ghost chat-settings-import', t('library.importChats'), () => importChats(app)));
  el.appendChild(actions);

  renderV1(el, app);
}

/**
 * "Remove the old v1 copy", and only when there is one. The button never removes anything the
 * migration has not accounted for: `v1Status` decides whether it offers a removal or offers to
 * bring the stragglers over first (a rollback to v0.1.45 and back leaves exactly that state).
 * @param {HTMLElement} el @param {any} app
 */
function renderV1(el, app) {
  const migrate = app.modules && app.modules.migrate;
  if (!migrate || typeof migrate.v1Status !== 'function') return;
  /** @type {any} */
  let storage = null;
  try {
    storage = window.localStorage;
    if (!storage || storage.getItem(migrate.V1_KEY) === null) return;
  } catch {
    return;                                   // no localStorage at all: nothing to offer
  }
  const repo = app.repo;
  if (!repo) return;

  const row = h('div', 'chat-settings-actions');
  const btn = button('btn-ghost chat-settings-removev1', t('library.removeV1'), () => act());
  btn.setAttribute('data-state', 'checking');
  /** @type {any} */ (btn).disabled = true;
  row.appendChild(btn);
  el.appendChild(row);

  /** @type {any} */
  let status = null;

  const refresh = async () => {
    status = await migrate.v1Status({ repo, storage });
    if (!status || !status.present) { row.remove(); return; }
    const pending = Number(status.pending) || 0;
    btn.textContent = pending > 0 ? t('library.removeV1Pending', { n: pending }) : t('library.removeV1');
    btn.setAttribute('data-state', pending > 0 ? 'pending' : 'ready');
    /** @type {any} */ (btn).disabled = false;
  };

  const act = async () => {
    if (!status) return;
    /** @type {any} */ (btn).disabled = true;
    if (Number(status.pending) > 0) {
      // Bring the stragglers over FIRST; the key stays until they are all here.
      await migrate.migrateV1({ repo, storage, now: app.now, bus: app.bus });
      if (app.sidebar) await app.sidebar.render();
      await refresh();
      return;
    }
    const ok = app.dialogs
      ? await app.dialogs.confirm({
        title: t('library.removeV1Title'),
        body: t('library.removeV1Body'),
        ok: t('library.removeV1'),
        danger: true,
      })
      : false;
    if (!ok) {
      /** @type {any} */ (btn).disabled = false;
      if (app.dialogs) app.dialogs.toast(t('library.removeV1Kept'));
      return;
    }
    const removed = await migrate.removeV1Copy({ repo, storage, now: app.now, bus: app.bus });
    if (removed) {
      // Nothing about the stored chats changed — only the old copy is gone — so no THREADS_CHANGED.
      if (app.dialogs) app.dialogs.toast(t('library.removeV1Done'), { kind: 'success' });
      row.remove();
    } else {
      await refresh();
    }
  };

  void refresh();
}
