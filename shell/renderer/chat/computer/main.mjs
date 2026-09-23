// @ts-check
// The Computer's entry point (COMPUTER_PLAN §3.3). Integrator-owned; units NEVER edit this file.
//
// Loaded as <script type="module" src="chat/computer/main.mjs"> AFTER chat/main.mjs, so the chat's
// spine is already being built when this runs (computer/boot.mjs waits for it and adopts it).
//
// Same loader contract as chat/main.mjs, frozen at the K1 kickoff:
//   - MODULES rows: {key, path, role:'component'|'feature', fake, phase}. A unit's module "lights
//     up" as soon as its file exists.
//   - flags.skipModules: an array of loader KEYS or PATHS; a listed module is treated as failed
//     without importing it.
//   - Failed module → LolComputer.failed[key] = {key, path, role, error, faked}.
//       component  → the loader banner "Part of the Computer failed to load ({key})" in
//                    els.banner, for keys the COMPONENTS table builds from. A row with fake:null
//                    and no COMPONENTS entry (`migrate`) is survivable and stays quiet.
//       feature    → skipped, one console.warn.
//   - There is NO `caps` row (§2.3): app/caps.mjs owns the ONE cap resolver on the SHARED farm, so
//     it is installed exactly once — by the chat's loader when the chat is alive, by boot.mjs when
//     it is not. A second install would overwrite the first's resolver and double the
//     /model_group/info GET.
//   - There is no fakes table. core/fakes.mjs fakes the CHAT's components; the Computer's
//     components are its own, and a missing one is a loader failure the banner names.
//
// window.LolComputer = {ready, version, app, failed, fakes, migration, debug}
//   debug.computer  the host's debug door — the SAME frozen key list as API_KEYS.graphDebug plus
//                   the K1–K5 additions. The harness drives the Computer through it.
//   migration       the promise of computer/migrate.mjs's verdict (§7.2).

import { flags } from '../core/env.mjs';
import { createApp } from '../core/app.mjs';
import { EV } from '../core/events.mjs';
import { t } from '../core/i18n.mjs';
import { buildComputerLayout } from './layout.mjs';
import { spine } from './boot.mjs';
import { computeVisible, runnerExecuting } from './visible.mjs';
import '../strings/computer.en.mjs';

const PHASE = 'K4';   // each LANDING bumps this, with the c3-landing assertion in the same edit

/** @type {import('../core/types.mjs').ModuleRow[]} */
const MODULES = [
  { key: 'host',     path: './host.mjs',            role: 'component', fake: null, phase: 'K1' },
  { key: 'library',  path: './library.mjs',         role: 'component', fake: null, phase: 'K1' },
  { key: 'migrate',  path: './migrate.mjs',         role: 'component', fake: null, phase: 'K1' },
  { key: 'dialogs',  path: '../ui/dialogs.mjs',     role: 'component', fake: null, phase: 'K1' },
  { key: 'ask',      path: '../app/ask.mjs',        role: 'feature',   fake: null, phase: 'K1' },
  { key: 'projects', path: '../projects/bridge.mjs', role: 'feature',  fake: null, phase: 'K1' },
  { key: 'drawer',   path: './drawer.mjs',          role: 'feature',   fake: null, phase: 'K2' },
  // K2: the transcript mounts its panel INTO the drawer, so its row comes AFTER the drawer's —
  // features install in this table's order.
  { key: 'transcript', path: './transcript.mjs',    role: 'feature',   fake: null, phase: 'K2' },
  { key: 'runbar',   path: './runbar.mjs',          role: 'feature',   fake: null, phase: 'K3' },
  // K4 (COMPUTER_PLAN §6.4): the ONE door a picture comes in by. A `feature`, so a build without
  // it still runs graphs — the Image part then says it cannot read a picture instead of throwing.
  { key: 'intake',   path: './intake.mjs',          role: 'feature',   fake: null, phase: 'K4' },
  // K5 rows (welcome, tutorial) are added at that kickoff.
  //
  // LEAVES WITH NO ROW — a static import of their consumer, so a typo surfaces as that consumer
  // failing: graph/**, sandbox/**, computer/{boot,layout,visible,docstore}.mjs, every
  // strings/*.en.mjs, and (K5) tutorial/{check,registry}.mjs with every lesson module.
];

/**
 * How each component is built. `slot` is the field it fills on the App.
 * @type {{key: string, slot: string, factory: string, args: (app: any) => any[]}[]}
 */
const COMPONENTS = [
  { key: 'dialogs', slot: 'dialogs', factory: 'createDialogs', args: (app) => [app] },
  { key: 'host',    slot: 'host',    factory: 'createHost',    args: (app) => [app, app.els] },
  { key: 'library', slot: 'library', factory: 'createLibrary', args: (app) => [app, app.els] },
];

/** @param {unknown} err */
const errText = (err) => (err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : String(err));

/** @param {import('../core/types.mjs').ModuleRow} row */
function load(row) {
  const skip = Array.isArray(flags.skipModules) ? flags.skipModules : [];
  if (skip.includes(row.key) || skip.includes(row.path)) return Promise.resolve({ row, mod: null, error: 'skipped by flags.skipModules' });
  return import(row.path).then((mod) => ({ row, mod, error: null }), (err) => ({ row, mod: null, error: errText(err) }));
}

async function mount() {
  const root = document.getElementById('lolcomputer');
  if (!root) return;

  const els = buildComputerLayout(root);

  /** @type {any} */
  const LolComputer = { ready: false, version: `vnext-${PHASE.toLowerCase()}`, app: null, failed: {}, fakes: [], migration: null, debug: {} };
  /** @type {any} */ (window).LolComputer = LolComputer;

  const app = createApp({ root, els: /** @type {any} */ (els) });
  LolComputer.app = app;

  // The shared spine: repo, farm and gov are the CHAT's instances when the chat is alive, and the
  // Computer's own when it is not. `mirror` re-emits GOV_CHANGE/FARM_CHANGE/FARM_TICK onto our bus.
  const shared = await spine(app);
  app.repo = shared.repo;
  app.farm = shared.farm;
  app.gov = shared.gov;
  LolComputer.debug.spine = () => ({ owner: shared.owner, repo: !!app.repo, farm: !!app.farm, gov: !!app.gov });

  const results = await Promise.all(MODULES.map(load));
  /** @type {Map<string, any>} */
  const loaded = new Map();
  for (const { row, mod, error } of results) {
    if (mod) { loaded.set(row.key, mod); app.modules[row.key] = mod; continue; }
    LolComputer.failed[row.key] = { key: row.key, path: row.path, role: row.role, error: /** @type {string} */ (error), faked: false };
    if (row.role === 'feature') console.warn(`[lolcomputer] feature "${row.key}" not loaded: ${error}`);
    else console.warn(`[lolcomputer] component "${row.key}" failed to load: ${error}`);
  }

  for (const c of COMPONENTS) {
    const mod = loaded.get(c.key);
    let instance = null;
    if (mod && typeof mod[c.factory] === 'function') {
      try {
        instance = mod[c.factory](...c.args(app));
      } catch (err) {
        LolComputer.failed[c.key] = { key: c.key, path: MODULES.find((m) => m.key === c.key)?.path || '', role: 'component', error: errText(err), faked: false };
        console.warn(`[lolcomputer] component "${c.key}" threw while starting: ${errText(err)}`);
      }
    } else if (mod) {
      LolComputer.failed[c.key] = { key: c.key, path: MODULES.find((m) => m.key === c.key)?.path || '', role: 'component', error: `missing export ${c.factory}`, faked: false };
    }
    /** @type {any} */ (app)[c.slot] = instance;
  }

  for (const row of MODULES) {
    if (row.role !== 'feature') continue;
    const mod = loaded.get(row.key);
    if (!mod) continue;
    try {
      if (typeof mod.install !== 'function') throw new Error('missing export install');
      mod.install(app);
    } catch (err) {
      LolComputer.failed[row.key] = { key: row.key, path: row.path, role: 'feature', error: errText(err), faked: false };
      console.warn(`[lolcomputer] feature "${row.key}" failed to install: ${errText(err)}`);
    }
  }

  const componentKeys = new Set(COMPONENTS.map((c) => c.key));
  const broken = Object.values(LolComputer.failed).filter((/** @type {any} */ f) => f.role === 'component' && componentKeys.has(f.key));
  if (broken.length) {
    const b = document.createElement('div');
    b.className = 'comp-banner-loader';
    b.setAttribute('role', 'alert');
    b.textContent = t('computer.loaderFailed', { key: broken.map((/** @type {any} */ f) => f.key).join(', ') });
    els.banner.appendChild(b);
  }

  // The debug door: the host's, verbatim. The harness drives the Computer through it, and its key
  // list is API_KEYS.graphDebug plus the K1–K5 additions.
  if (app.host && app.host.debug) LolComputer.debug.computer = app.host.debug;
  if (app.library) LolComputer.debug.library = app.library.debug || null;

  // ---- the `visible` rule (COMPUTER_PLAN §2.3, the one line this file owns) -------------------
  // True while #lolcomputer is SHOWN or an activation of a run it started is EXECUTING; false
  // while a run is merely parked on a Dialog. computer/visible.mjs is the predicate; this is its
  // only caller.
  const emitVisible = () => app.bus.emit(EV.VISIBLE, { visible: app.state.visible, pageVisible: app.state.pageVisible });
  const syncVisible = () => {
    const next = computeVisible({
      shown: !root.classList.contains('hidden'),
      executing: runnerExecuting(app.host && app.host.runner),
    });
    if (next !== app.state.visible) { app.state.visible = next; emitVisible(); }
  };
  LolComputer.debug.visible = () => app.state.visible;

  /**
   * WHAT HIDING THE SURFACE COSTS (K1 landing). `graph/panel.mjs` had a `hide()` the workbench
   * called when the reader switched away: stop the run, put the sandbox to sleep, save. Deleting
   * the panel deleted its only caller, and a guest left ticking in a hidden surface burns a CPU
   * for nobody — `c3-landing-hiding-the-computer-suspends-the-guest` is exactly that guarantee.
   * The surface is never destroyed now, so this is the successor, with ONE deliberate difference:
   * it does NOT stop the run.
   *
   * The panel could stop it because a panel the reader switched away from was gone. §2.3 says the
   * opposite about the surface: a run the human deliberately started, bounded by its ceilings,
   * keeps its seat while they look at something else in the same window — which is the whole of
   * why `visible` is `shown || runner.executing()`. So while an activation is executing, hiding
   * costs nothing at all; the sandbox is suspended and the document saved only once the run is
   * idle. `sandbox.hide()` keeps its own grace period, so flipping straight back costs no rebuild.
   */
  let wasShown = !root.classList.contains('hidden');
  const parkIfIdle = () => {
    const host = app.host;
    if (!host || !root || !root.classList.contains('hidden')) return;
    if (runnerExecuting(host.runner)) return;         // §2.3: a live run keeps its seat and its guest
    try {
      const live = host.session && typeof host.session.sandboxNow === 'function' ? host.session.sandboxNow() : null;
      if (live && typeof live.hide === 'function') live.hide();
    } catch (err) { console.error('[lolcomputer] suspending the sandbox on hide threw', err); }
    try { if (host.session && typeof host.session.save === 'function') void host.session.save(); } catch (err) { console.error('[lolcomputer] saving on hide threw', err); }
  };
  const onShownChange = () => {
    const shown = !root.classList.contains('hidden');
    if (shown === wasShown) return;
    wasShown = shown;
    if (!shown) parkIfIdle();
  };

  new MutationObserver(() => { syncVisible(); onShownChange(); })
    .observe(root, { attributes: true, attributeFilter: ['class'] });
  // A run that ENDS while the surface is hidden parks the guest then, not never.
  if (app.host && app.host.runner && typeof app.host.runner.on === 'function') {
    app.host.runner.on(() => { syncVisible(); parkIfIdle(); });
  }
  document.addEventListener('visibilitychange', () => {
    const live = /** @type {any} */ (window).__lolChatTestFlags;
    const forced = live && typeof live.forcePageVisible === 'boolean' ? live.forcePageVisible : undefined;
    app.state.pageVisible = forced ?? document.visibilityState === 'visible';
    emitVisible();
  });
  syncVisible();

  LolComputer.ready = true;

  // ---- the migration, once the store settles (§7.2) -------------------------------------------
  const skipped = (/** @type {string} */ reason) => ({ status: 'skipped', reason, imported: 0, skipped: 0, errors: 0 });
  LolComputer.migration = (async () => {
    const repo = app.repo;
    if (!repo) return skipped('no-repo');
    await repo.ready;
    if (repo.mode !== 'idb') return skipped('memory');
    const mod = loaded.get('migrate');
    if (!mod || typeof mod.migrateGraphsV1 !== 'function') return skipped('no-migrate');
    try {
      return await mod.migrateGraphsV1({ repo, now: app.now });
    } catch (err) {
      console.error('[lolcomputer] graph migration threw', err);
      return skipped('error');
    }
  })();

  // A row that THREW is not the same as a row that was already there: migrate.mjs withholds the
  // done-marker so the next launch retries it, but a reader who is never told just sees a graph
  // missing from the library. Say it once, here, where the toast stack exists.
  LolComputer.migration.then((out) => {
    const n = out && Number(out.errors) > 0 ? Number(out.errors) : 0;
    if (!n || !app.dialogs || typeof app.dialogs.toast !== 'function') return;
    app.dialogs.toast(n === 1 ? t('computer.migrateStrandedOne') : t('computer.migrateStranded', { n }), { kind: 'error' });
  }).catch(() => { /* the verdict is already logged; a toast is not worth a second failure */ });

  // The library opens the last document once the migration has had its say, so a first launch
  // after the upgrade lands on something rather than on an empty list.
  if (app.library && typeof app.library.start === 'function') {
    LolComputer.migration.then(() => app.library.start()).catch(() => app.library.start());
  }
}

mount().catch((err) => {
  console.error('[lolcomputer] mount failed', err);
});
