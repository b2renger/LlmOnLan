// @ts-check
// The Computer's right-hand drawer (COMPUTER_PLAN §8.1, §11 K1-U3). K1 lands the HOST: the panel
// that holds a value while you read it, and the chrome around it — Close, Escape, and a grip that
// remembers how wide you dragged it. K2-U3 mounts the Sent/Got/Cost transcript INTO it through the
// same `open()` door, which is why the drawer owns the frame and not the contents.
//
// Why a drawer and not a popover over the canvas: a value you are reading is the one thing on this
// surface that is TEXT, and text wants a column with a width you chose. A popover would also close
// itself on the next click, which is exactly wrong for something you read while you edit the part
// that produced it.
//
// It renders `graph/inspect.mjs`'s renderers — the same pure `bodyText`/`headingText` the chat
// column used — through inspect's new `host` argument (K1-U3, §3.2). Nothing about how a value
// READS changed; only where it lands.
//
// Feature contract (computer/main.mjs's loader, `drawer` row):
//   install(app) -> void, publishing app.drawer = {open(value, opts), close(), isOpen(), width()}
// K2 kickoff adds the PANEL door to that contract — {mountPanel(name, node), showPanel(name),
// panel()} — because §11 K2-U3 says the transcript mounts INTO this drawer and is "not an edit of
// drawer.mjs". The door has to exist for that to be true, so the integrator built it here.
// It renders into app.els.drawer and nothing else.
//
// HOW A VALUE CHIP GETS HERE. The canvas opens a value by calling `session.inspect(value)`
// (graph/canvas.mjs:918,926) and that call is frozen — it is how a value chip has worked since C2.
// computer/host.mjs's session forwards it to `app.drawer.inspect(value, opts)` and looks the
// drawer up at CALL time, so neither module imports the other and the order they install in does
// not matter. `inspect` is therefore part of this file's published API, alongside `open` (which is
// the same function under the name the plan's feature contract uses).

import { t } from '../core/i18n.mjs';
import { createInspector } from '../graph/inspect.mjs';
import '../strings/computer.en.mjs';

/** The drawer's width, in CSS pixels. Narrower than MIN and the heading wraps to three lines;
 * wider than MAX and the canvas it belongs to is gone. §8.1 calls the default "~440 px". */
export const DRAWER_MIN = 280;
export const DRAWER_MAX = 720;
export const DRAWER_DEFAULT = 440;

/** kv key (plan §7.1: the drawer's width is remembered, like the sidebar's).
 * NOT in core/types.mjs's KV_KEYS yet — that file belongs to nobody in K1; see the report. */
export const DRAWER_WIDTH_KEY = 'computer:drawerWidth';

/**
 * A width as the drawer will actually use it. PURE — a dragged pointer, a stored number from an
 * older build and a corrupt kv row all come through here.
 * @param {any} px @returns {number}
 */
export function clampDrawerWidth(px) {
  // `null`/`undefined`/'' are "nothing stored", not "zero pixels" — Number(null) is 0, which would
  // silently clamp an empty kv row to the minimum and make the default unreachable.
  if (px === null || px === undefined || px === '') return DRAWER_DEFAULT;
  const n = Math.round(Number(px));
  if (!Number.isFinite(n)) return DRAWER_DEFAULT;
  return Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, n));
}

/** @param {string} cls @param {HTMLElement} [parent] */
function div(cls, parent) {
  const el = document.createElement('div');
  el.className = cls;
  if (parent) parent.appendChild(el);
  return el;
}

/** @param {any} app */
export function install(app) {
  const root = app && app.els ? app.els.drawer : null;
  if (!root) {
    // No skeleton to render into is not a crash: the Computer without a drawer still runs graphs.
    app.drawer = {
      open: () => null, inspect: () => null, close: () => false, isOpen: () => false,
      width: () => DRAWER_DEFAULT, el: () => null,
      // The panel door answers too, so K2's transcript degrades to "no drawer" instead of throwing.
      mountPanel: (/** @type {string} */ _n, /** @type {any} */ node) => node,
      showPanel: () => false, panel: () => '',
    };
    return;
  }

  let width = DRAWER_DEFAULT;

  // ---- the frame -------------------------------------------------------------------------------
  const grip = div('comp-drawer-grip');
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');

  const head = div('comp-drawer-head');
  const shut = document.createElement('button');
  shut.type = 'button';
  shut.className = 'comp-drawer-close';
  shut.textContent = t('computer.drawerClose');
  shut.addEventListener('click', () => api.close());
  head.appendChild(shut);

  const mount = div('comp-drawer-mount');

  // K2 kickoff — the PANEL door (COMPUTER_PLAN §11 K2-U3). The drawer owns the frame; a panel is
  // a named node someone else built and this file only shows or hides. `computer/transcript.mjs`
  // mounts the Sent/Got/Cost tabs through it and never edits this file, which is what keeps the
  // Escape ladder, the grip and the remembered width in ONE place.
  const panels = div('comp-drawer-panels');
  panels.classList.add('hidden');
  /** @type {Map<string, HTMLElement>} */ const mounted = new Map();
  /** @type {string} */ let shown = '';

  const empty = document.createElement('p');
  empty.className = 'comp-drawer-empty';
  empty.textContent = t('computer.drawerEmpty');

  root.replaceChildren(grip, head, mount, panels, empty);
  root.classList.add('hidden');
  root.setAttribute('aria-label', t('computer.surface'));
  root.style.width = `${width}px`;

  // ---- the value -------------------------------------------------------------------------------
  // inspect.mjs's hosted mode: the same heading, the same body, the same cap. It renders into
  // `mount`, has no close button of its own and does not touch Escape — this file owns both.
  const inspector = createInspector(app, {
    el: mount,
    onClose: () => hide(),
  });

  function hide() {
    root.classList.add('hidden');
    empty.classList.remove('hidden');
    hidePanels();
  }

  /** Every panel down, the inspector's mount back. @returns {void} */
  function hidePanels() {
    shown = '';
    panels.classList.add('hidden');
    for (const node of mounted.values()) node.classList.add('hidden');
    mount.classList.remove('hidden');
  }

  /**
   * Register a panel. Mounting the SAME name twice replaces the node (a unit that rebuilds its
   * panel must not leave the old one behind). The node arrives hidden; `showPanel` raises it.
   * @param {string} name @param {HTMLElement} node @returns {HTMLElement}
   */
  function mountPanel(name, node) {
    const key = String(name || '');
    const old = mounted.get(key);
    if (old && old !== node) old.remove();
    node.classList.add('hidden');
    node.setAttribute('data-panel', key);
    if (node.parentNode !== panels) panels.appendChild(node);
    mounted.set(key, node);
    return node;
  }

  /** Raise one panel and open the drawer. Unknown name → nothing happens and it says so.
   * @param {string} name @returns {boolean} */
  function showPanel(name) {
    const key = String(name || '');
    const node = mounted.get(key);
    if (!node) return false;
    for (const [k, el] of mounted) el.classList.toggle('hidden', k !== key);
    shown = key;
    panels.classList.remove('hidden');
    // A panel and the value inspector are alternatives, never a stack: one drawer, one thing in it.
    mount.classList.add('hidden');
    empty.classList.add('hidden');
    root.classList.remove('hidden');
    try { shut.focus(); } catch (err) { void err; }
    return true;
  }

  /** @param {any} value @param {any} [opts] @returns {any} the value's element, or null */
  function open(value, opts) {
    hidePanels();
    const node = inspector.show(value, opts || {});
    // A drawer that opened onto nothing is worse than one that did not open: say what it is for.
    if (node) empty.classList.add('hidden');
    else empty.classList.remove('hidden');
    root.classList.remove('hidden');
    // Focus the Close button: it is inside `root`, so the Escape below actually reaches this
    // handler instead of the canvas's "stop the run" (§8.1's ladder, rungs 2 and 4).
    try { shut.focus(); } catch (err) { void err; }
    return node;
  }

  function close() {
    const had = !root.classList.contains('hidden');
    inspector.close();          // onClose -> hide(), so there is one place that hides the drawer
    if (had) hide();
    return had;
  }

  // Escape closes the drawer and STOPS THERE. ui/shortcuts.mjs reads Escape on `document` as
  // "stop the run"; someone closing a value they are reading has not asked for that (BH-7, §8.1).
  root.addEventListener('keydown', (/** @type {any} */ e) => {
    if (!e || e.key !== 'Escape') return;
    if (root.classList.contains('hidden')) return;
    e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    close();
  });

  // ---- the grip --------------------------------------------------------------------------------
  /** @param {any} px @param {boolean} [save] */
  function setWidth(px, save) {
    width = clampDrawerWidth(px);
    root.style.width = `${width}px`;
    if (save) store(width);
  }

  /** @param {number} px */
  function store(px) {
    const repo = app && app.repo;
    if (!repo || typeof repo.kvSet !== 'function') return;
    Promise.resolve(repo.kvSet(DRAWER_WIDTH_KEY, px)).catch(() => { /* kv speaks through its own banner */ });
  }

  grip.addEventListener('pointerdown', (/** @type {any} */ e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const startX = Number(e && e.clientX) || 0;
    const startW = width;
    // The drawer is pinned to the RIGHT edge, so dragging the grip LEFT makes it wider.
    const move = (/** @type {any} */ ev) => setWidth(startW + (startX - (Number(ev.clientX) || 0)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      store(width);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  // The remembered width, applied as soon as the store answers. Read AFTER the frame is up so a
  // slow (or missing) repo never delays the drawer existing.
  const repo = app && app.repo;
  if (repo && typeof repo.kvGet === 'function') {
    Promise.resolve(repo.kvGet(DRAWER_WIDTH_KEY, DRAWER_DEFAULT))
      .then((stored) => { if (stored !== null && stored !== undefined) setWidth(stored); })
      .catch(() => { /* the default is a fine answer */ });
  }

  const api = {
    open,
    // K2: the panel door. `panel()` names what is up ('' when it is the value inspector).
    mountPanel,
    showPanel,
    panel: () => shown,
    /** What computer/host.mjs's `session.inspect()` calls — the same door under the canvas's name. */
    inspect: open,
    close,
    isOpen: () => !root.classList.contains('hidden'),
    width: () => width,
    /** The element, for the run bar and (K2) the transcript tabs. */
    el: () => root,
  };
  app.drawer = api;
}
