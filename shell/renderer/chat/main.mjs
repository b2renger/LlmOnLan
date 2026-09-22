// @ts-check
// LOL Chat entry point (integrator-owned; units NEVER edit this file). Plan §3.1.
//
// Loaded as <script type="module" src="chat/main.mjs"> AFTER the classic app.js (P1 landing; in P0
// only the chat harness page loads it). Statically imports only core/* and ui/layout.mjs; every
// other module comes from the MODULES table through dynamic import() — verified to work from plain
// file:// AND from inside an @electron/asar-packed app.asar on Electron 42.5.1, under the exact
// renderer CSP (P0 kickoff probe, 2026-09-15; see DEVLOG). A missing path rejects cleanly with
// "Failed to fetch dynamically imported module", which is the loader's failure path. The
// static-import fallback of plan §3.1 is therefore NOT needed.
//
// Loader contract (frozen at P0 kickoff):
//   - MODULES rows: {key, path, role:'component'|'feature', fake, phase}. The integrator adds the rows
//     of a phase at its kickoff; a unit's module "lights up" as soon as its file exists.
//   - flags.skipModules: an array of loader KEYS or PATHS (as written in MODULES); a listed module is
//     treated as failed without importing it.
//   - core/fakes.mjs is DEVELOPMENT ONLY: it is dynamically imported, and only when
//     flags.allowFakes is set, so production never fetches or runs it (plan §3.1 amended at the
//     P0 fix round; it used to be a static core import).
//   - Failed module → LolChat.failed[key] = {key, path, role, error, faked}.
//       component + flags.allowFakes → core/fakes.mjs[fake] is used (faked:true; a row with
//                                     fake:null, e.g. migrate, simply stays absent — faked:false);
//       component in production     → the loader banner "Part of LOL Chat failed to load ({key})"
//                                     in els.banner (.chat-banner-loader), composer disabled — but
//                                     ONLY for keys the COMPONENTS table builds from; `migrate`
//                                     (fake:null, no COMPONENTS row) is survivable and stays quiet;
//       feature                     → skipped, one console.warn.
//   - Components NOT (yet) listed in MODULES: with allowFakes they get their fake and their key is
//     pushed to LolChat.fakes (they are not failures); without allowFakes they stay null.
//   - Component construction (COMPONENTS below, in this order): repo → farm → gov → dialogs → view →
//     sidebar → composer → picker → controller. Each real module must export the named factory.
//   - Feature modules export install(app); installed in table order after all components exist.
//     A throwing install() is recorded in LolChat.failed like a failed import (faked:false).
//     A feature therefore NEVER sees a bus event emitted during component construction (step 7) —
//     `storeBanner` must read app.repo.mode at install time as well as listening for STORE_MODE.
//   - Every loaded namespace is kept on app.modules[key] (e.g. app.modules.migrate.migrateV1).
//   - els.banner is SHARED: main.mjs owns `.chat-banner-loader` (below), the storeBanner feature owns
//     exactly one `.chat-banner-store` child. Neither clears the other; nobody replaces els.banner's
//     children wholesale, so a broken storeBanner can never hide the loader's own failure banner.
//
// window.LolChat = {ready, version, app, failed, fakes, migration, debug}
//   ready      true once components + features are installed (never waits on IndexedDB/network).
//   migration  the promise of the §3.1 step-12 block; resolves with migrateV1()'s result
//              {status:'done'|'already'|'none'|'failed', imported, copies, skipped}, or
//              {status:'skipped', reason:'no-repo'|'no-migrate'|'memory'|'error', …zero counts}.
//              Replaced by a new promise when a late IndexedDB attach re-runs the block.

import { flags, now } from './core/env.mjs';
import { createApp } from './core/app.mjs';
import { EV } from './core/events.mjs';
import { t } from './core/i18n.mjs';
import { buildLayout, installDropGuard } from './ui/layout.mjs';
import './strings/core.en.mjs';

const PHASE = 'K1';
const LAST_THREAD_KEY = 'ui:lastThreadId';       // §3.7; written on THREAD_SELECTED, read at boot

/** @type {import('./core/types.mjs').ModuleRow[]} */
const MODULES = [
  // role 'component': a factory main.mjs calls; 'feature': exports install(app)
  { key: 'repo',       path: './state/repo.mjs',        role: 'component', fake: 'repo',       phase: 'P0' },
  { key: 'migrate',    path: './state/migrate-v0.mjs',  role: 'component', fake: null,         phase: 'P0' },
  { key: 'farm',       path: './net/farm.mjs',          role: 'component', fake: 'farm',       phase: 'P1' },
  { key: 'governor',   path: './net/governor.mjs',      role: 'component', fake: 'gov',        phase: 'P1' },
  { key: 'dialogs',    path: './ui/dialogs.mjs',        role: 'component', fake: 'dialogs',    phase: 'P1' },
  { key: 'view',       path: './render/thread-view.mjs', role: 'component', fake: 'view',      phase: 'P1' },
  { key: 'sidebar',    path: './ui/sidebar.mjs',        role: 'component', fake: 'sidebar',    phase: 'P1' },
  { key: 'composer',   path: './ui/composer.mjs',       role: 'component', fake: 'composer',   phase: 'P1' },
  { key: 'picker',     path: './ui/model-picker.mjs',   role: 'component', fake: 'picker',     phase: 'P1' },
  { key: 'controller', path: './app/controller.mjs',    role: 'component', fake: 'controller', phase: 'P1' },
  // Features (install(app), in THIS order, after every component exists).
  { key: 'code',       path: './render/code.mjs',       role: 'feature',   fake: null,         phase: 'P1' },
  { key: 'storeBanner', path: './ui/store-banner.mjs',  role: 'feature',   fake: null,         phase: 'P1' },
  // P2 features, in install order (§2.6 AA). Every one of them is a FEATURE: it exports
  // install(app), it is installed after every component exists, and a failure to load costs only
  // that feature — the chat keeps working. `sidebar` (P2-U4) and `governor` (P2-U1) are existing
  // COMPONENT rows whose files those units take over, so they need no new row.
  { key: 'seatWait',   path: './app/seat-wait.mjs',     role: 'feature',   fake: null,         phase: 'P2' },
  { key: 'strip',      path: './ui/strip.mjs',          role: 'feature',   fake: null,         phase: 'P2' },
  { key: 'notify',     path: './ui/notify.mjs',         role: 'feature',   fake: null,         phase: 'P2' },
  { key: 'context',    path: './app/context.mjs',       role: 'feature',   fake: null,         phase: 'P2' },
  { key: 'branching',  path: './app/branching.mjs',     role: 'feature',   fake: null,         phase: 'P2' },
  { key: 'continue',   path: './app/continue.mjs',      role: 'feature',   fake: null,         phase: 'P2' },
  { key: 'messageActions', path: './ui/message-actions.mjs', role: 'feature', fake: null,      phase: 'P2' },
  { key: 'threadHeader', path: './ui/thread-header.mjs', role: 'feature',  fake: null,         phase: 'P2' },
  { key: 'drafts',     path: './app/drafts.mjs',        role: 'feature',   fake: null,         phase: 'P2' },
  { key: 'shortcuts',  path: './ui/shortcuts.mjs',      role: 'feature',   fake: null,         phase: 'P2' },
  { key: 'settings',   path: './ui/settings.mjs',       role: 'feature',   fake: null,         phase: 'P2' },
  // S0 (Studio rails). All four are FEATURES: each publishes its own API on `app` from install()
  // (§2.6 AQ) and a failure costs only that rail — the chat keeps working. Install order matters
  // only in that `work` exists before a panel asks for it; every rail reaches another rail's API
  // LAZILY at run time (§2.6 AA), never during its own install.
  //   work     → app.work      (studio plan §3.5, hosts SLOTS.WORKBENCH_PANELS)
  //   ask      → app.ask       (studio plan §3.4, the one-shot typed model call)
  //   queue    → the batch chip (studio plan §3.5.4). Landed with the S0 fix pass: `app.ask.queue`
  //              was callable with nothing rendering it and Escape unable to reach it, which
  //              §3.5.4 forbids outright. It installs AFTER ask so the QUEUE_EVENT emitter exists,
  //              though the coupling is the bus, not the module.
  //   projects → app.projects  (studio plan §3.8, the only window.lol consumer)
  { key: 'work',       path: './ui/workbench.mjs',      role: 'feature',   fake: null,         phase: 'S0' },
  { key: 'ask',        path: './app/ask.mjs',           role: 'feature',   fake: null,         phase: 'S0' },
  { key: 'queue',      path: './ui/queue.mjs',          role: 'feature',   fake: null,         phase: 'S0' },
  { key: 'caps',       path: './app/caps.mjs',          role: 'feature',   fake: null,         phase: 'S0' },
  { key: 'projects',   path: './projects/bridge.mjs',   role: 'feature',   fake: null,         phase: 'S0' },
  // C1's `computer` row is GONE (K1 landing, COMPUTER_PLAN §11). The Computer stopped being a
  // workbench panel and became the third top-level surface: `graph/panel.mjs` and `graph/store.mjs`
  // are deleted, and `chat/computer/main.mjs` — its own loader, its own App — mounts `#lolcomputer`
  // from its own <script type="module"> in index.html. The chat no longer loads any of graph/**.
  // LEAVES WITH NO ROW (§2.6 I, extended for P2 by §2.6 AB): a module that no unit installs on its
  // own — ctx/{tokens,budget}.mjs (← app/context.mjs), ui/meter.mjs (← app/context.mjs),
  // ui/edit-inline.mjs (← ui/message-actions.mjs + ui/shortcuts.mjs), ui/transfer.mjs +
  // app/transfer-format.mjs (← ui/settings.mjs + ui/sidebar.mjs) and every strings/*.en.mjs — is a
  // STATIC import of its consumer, so a break in it surfaces as that consumer failing to load.
  // net/{sse,delta,errors,request,run}.mjs are PURE leaves with no factory and no install(): they
  // are static imports of their consumers (run ← controller, sse/delta ← run, errors ← run + farm +
  // controller, request ← controller), so a typo in one of them surfaces as its consumer failing to
  // load, with the consumer's fake taking over. They deliberately get no loader row.
];

/**
 * How each component is built. `key` = loader key, `slot` = the App field it fills, `factory` = the
 * named export of the real module, `args` = the call arguments (the fake gets the same ones).
 * @type {{key: string, slot: string, factory: string, fake: string, args: (app: any) => any[]}[]}
 */
const COMPONENTS = [
  {
    key: 'repo', slot: 'repo', factory: 'openRepoSync', fake: 'repo',
    args: (app) => [{
      idbName: 'lol-chat', forceMemory: !!flags.forceMemoryStore, timeoutMs: 3000,
      idbOpenDelayMs: Number(flags.idbOpenDelayMs) || 0, bus: app.bus, now: app.now, newId: app.newId,
    }],
  },
  { key: 'farm',       slot: 'farm',       factory: 'createFarmModel',   fake: 'farm',       args: (app) => [app] },
  { key: 'governor',   slot: 'gov',        factory: 'createGovernor',    fake: 'gov',        args: (app) => [app] },
  { key: 'dialogs',    slot: 'dialogs',    factory: 'createDialogs',     fake: 'dialogs',    args: (app) => [app] },
  { key: 'view',       slot: 'view',       factory: 'createThreadView',  fake: 'view',       args: (app) => [app, app.els.messages] },
  { key: 'sidebar',    slot: 'sidebar',    factory: 'createSidebar',     fake: 'sidebar',    args: (app) => [app, app.els.list] },
  { key: 'composer',   slot: 'composer',   factory: 'createComposer',    fake: 'composer',   args: (app) => [app, app.els] },
  { key: 'picker',     slot: 'picker',     factory: 'createModelPicker', fake: 'picker',     args: (app) => [app, app.els.model] },
  { key: 'controller', slot: 'controller', factory: 'createController',  fake: 'controller', args: (app) => [app] },
];

/** @param {unknown} err */
const errText = (err) => (err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : String(err));

/** @param {import('./core/types.mjs').ModuleRow} row @returns {Promise<{row: any, mod: any, error: string|null}>} */
function load(row) {
  const skip = Array.isArray(flags.skipModules) ? flags.skipModules : [];
  if (skip.includes(row.key) || skip.includes(row.path)) return Promise.resolve({ row, mod: null, error: 'skipped by flags.skipModules' });
  return import(row.path).then((mod) => ({ row, mod, error: null }), (err) => ({ row, mod: null, error: errText(err) }));
}

async function mount() {
  const root = document.getElementById('lolchat');
  if (!root) return;

  // 2. skeleton, synchronously, before any module import
  const els = buildLayout(root);

  // 3.
  /** @type {import('./core/types.mjs').LolChatGlobal} */
  const LolChat = { ready: false, version: `vnext-${PHASE.toLowerCase()}`, app: null, failed: {}, fakes: [], migration: null, debug: {} };
  /** @type {any} */ (window).LolChat = LolChat;

  // 4.
  const app = createApp({ root, els });
  LolChat.app = app;

  // 5.
  installDropGuard(document);

  // 5b. core/fakes.mjs is development-only (a whole second repo, view, composer and SSE streamer).
  // It is imported ON DEMAND so production neither fetches nor executes it, and so a top-level
  // error in it can never take the real chat down — a static core import would do both.
  /** @type {any} */
  let fakes = null;
  if (flags.allowFakes) {
    try {
      fakes = await import('./core/fakes.mjs');
    } catch (err) {
      console.warn(`[lolchat] fakes requested but not loadable: ${errText(err)}`);
    }
  }

  // 6. loader (local files only)
  const results = await Promise.all(MODULES.map(load));
  /** @type {Map<string, any>} */
  const loaded = new Map();
  for (const { row, mod, error } of results) {
    if (mod) { loaded.set(row.key, mod); app.modules[row.key] = mod; continue; }
    const faked = row.role === 'component' && !!fakes && !!row.fake;
    LolChat.failed[row.key] = { key: row.key, path: row.path, role: row.role, error: /** @type {string} */ (error), faked };
    if (row.role === 'feature') console.warn(`[lolchat] feature "${row.key}" not loaded: ${error}`);
    else if (!flags.allowFakes) console.warn(`[lolchat] component "${row.key}" failed to load: ${error}`);
  }
  const listed = new Set(MODULES.map((m) => m.key));

  // 7. components, in order
  for (const c of COMPONENTS) {
    const mod = loaded.get(c.key);
    let instance = null;
    if (mod && typeof mod[c.factory] === 'function') {
      try {
        instance = mod[c.factory](...c.args(app));
      } catch (err) {
        LolChat.failed[c.key] = { key: c.key, path: MODULES.find((m) => m.key === c.key)?.path || '', role: 'component', error: errText(err), faked: !!fakes };
        console.warn(`[lolchat] component "${c.key}" threw while starting: ${errText(err)}`);
      }
    } else if (mod) {
      LolChat.failed[c.key] = { key: c.key, path: MODULES.find((m) => m.key === c.key)?.path || '', role: 'component', error: `missing export ${c.factory}`, faked: !!fakes };
    }
    if (!instance && fakes) {
      instance = /** @type {any} */ (fakes)[c.fake](...c.args(app));
      if (!listed.has(c.key)) LolChat.fakes.push(c.key);
    }
    /** @type {any} */ (app)[c.slot] = instance;
  }

  // 8. features, in table order
  for (const row of MODULES) {
    if (row.role !== 'feature') continue;
    const mod = loaded.get(row.key);
    if (!mod) continue;
    try {
      if (typeof mod.install !== 'function') throw new Error('missing export install');
      mod.install(app);
    } catch (err) {
      LolChat.failed[row.key] = { key: row.key, path: row.path, role: 'feature', error: errText(err), faked: false };
      console.warn(`[lolchat] feature "${row.key}" failed to install: ${errText(err)}`);
    }
  }

  // Production loader banner: a listed component the chat is actually BUILT from failed (never
  // shown with allowFakes — there the harness judges LolChat.failed itself, and --strict turns any
  // entry into a failed run). A role:'component' row that has no COMPONENTS entry — `migrate`, the
  // one module with fake:null — is recorded as faked:false and must NOT raise the banner: the chat
  // runs fine without it, it just does not import the v1 history.
  const componentKeys = new Set(COMPONENTS.map((c) => c.key));
  const brokenComponents = Object.values(LolChat.failed)
    .filter((f) => f.role === 'component' && !f.faked && componentKeys.has(f.key));
  if (brokenComponents.length && !flags.allowFakes) {
    const b = document.createElement('div');
    b.className = 'chat-banner-loader';
    b.setAttribute('role', 'alert');
    b.textContent = t('core.loaderFailed', { key: brokenComponents.map((f) => f.key).join(', ') });
    els.banner.appendChild(b);
    // Plan §3.1: in production a broken component locks the composer (the history view stays,
    // so a user can still read what they had). The old guard asked `!app.controller || !app.composer`,
    // which only fired while those rows did not exist yet: from P1 on, a broken `repo` leaves a
    // perfectly constructed controller and the chat looked usable while nothing could be saved.
    els.input.disabled = true;
    els.send.disabled = true;
  }

  // 9. farm refresh hook (app.js calls it on every publishFarm tick)
  /** @type {any} */ (window).__lolChatRefresh = () => {
    try {
      if (app.farm) app.farm.update(/** @type {any} */ (window).__lolFarm || null);
    } catch (err) {
      console.error('[lolchat] farm refresh failed', err);
    }
  };

  // 10. visibility
  const emitVisible = () => app.bus.emit(EV.VISIBLE, { visible: app.state.visible, pageVisible: app.state.pageVisible });
  new MutationObserver(() => {
    const v = !root.classList.contains('hidden');
    if (v !== app.state.visible) { app.state.visible = v; emitVisible(); }
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    // Re-read the flag object at event time: the harness toggles forcePageVisible on the live object.
    const live = /** @type {any} */ (window).__lolChatTestFlags;
    const forced = live && typeof live.forcePageVisible === 'boolean' ? live.forcePageVisible : undefined;
    app.state.pageVisible = forced ?? document.visibilityState === 'visible';
    emitVisible();
  });

  // 11. ready — never waits on IndexedDB or the network
  LolChat.ready = true;
  /** @type {any} */ (window).__lolChatRefresh();
  if (app.sidebar) app.sidebar.render();

  // 11b. remember which conversation the reader is in, so a relaunch reopens it (§3.7
  // `ui:lastThreadId`; v0.1.45 parity - chat.js:44 opened the newest chat on every launch, and
  // "close means close" since v0.1.45 makes a relaunch the EVERY-day experience).
  app.bus.on(EV.THREAD_SELECTED, (/** @type {any} */ p) => {
    const repo = app.repo;
    if (!repo || typeof repo.kvSet !== 'function') return;
    Promise.resolve(repo.kvSet(LAST_THREAD_KEY, (p && p.threadId) ? String(p.threadId) : ''))
      .catch(() => { /* a memory store speaks through its own banner */ });
  });

  /** Reopen `ui:lastThreadId` (or, failing that, the newest thread) - only if nothing is open. */
  async function reopenLast() {
    const repo = app.repo;
    if (!repo || !app.controller || app.state.threadId) return;
    let want = null;
    try { want = await repo.kvGet(LAST_THREAD_KEY, null); } catch (err) { void err; }
    const threads = await repo.listThreads();
    if (!threads.length) return;
    const id = (want && threads.some((th) => th.id === want)) ? String(want) : threads[0].id;
    if (app.state.threadId) return;                  // the reader got there first
    await app.controller.selectThread(id);
  }

  // 12. migration + crash recovery once the store settles (and again on a late IDB attach)
  const skipped = (/** @type {string} */ reason) => ({ status: 'skipped', reason, imported: 0, copies: 0, skipped: 0 });
  const settle = async () => {
    const repo = app.repo;
    if (!repo) return skipped('no-repo');
    await repo.ready;
    let result = skipped('memory');
    if (repo.mode === 'idb') {
      const migrate = loaded.get('migrate');
      if (migrate && typeof migrate.migrateV1 === 'function') {
        try {
          result = await migrate.migrateV1({ repo, storage: window.localStorage, now, bus: app.bus });
        } catch (err) {
          console.error('[lolchat] v1 migration threw', err);
          result = skipped('error');
        }
      } else {
        result = skipped('no-migrate');
      }
    }
    try { await repo.recoverInterrupted(); } catch (err) { console.error('[lolchat] recoverInterrupted failed', err); }
    // rescan:true - recoverInterrupted() just rewrote records BEHIND the sidebar's back, and the
    // whole-store cursor that finds them is a boot job, not a per-render one.
    if (app.sidebar) app.sidebar.render({ rescan: true });
    try { await reopenLast(); } catch (err) { console.error('[lolchat] reopening the last thread failed', err); }
    return result;
  };
  LolChat.migration = settle();
  app.bus.on(EV.THREADS_CHANGED, (p) => {
    if (p && p.reason === 'attach') LolChat.migration = settle();
  });
}

mount().catch((err) => {
  console.error('[lolchat] mount failed', err);
});
