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
//
// COMPUTER_LIVE_PLAN K-8 — THE CODE EDITOR. `editCode({partId, title, mode, source, onChange,
// onRun})` opens a large code editor in this drawer and returns `{close(), setSource(text),
// setError({line, message}|null)}`; the Preview's **Edit code** button calls it. It is a PANEL
// (the K2 door above), so "one drawer, one thing in it" still holds: opening a value, showing the
// transcript, Close, Escape or a second editCode all end the edit in progress. The text rules —
// the gutter, Tab, Enter, the caret readout — are PURE, in computer/code-edit.mjs. Additive to
// the frozen contract, and optional: `onClose()` in the options (called once, however the editor
// ends), `isOpen()` and `text()` (what the field holds now, L1-2) on the handle, and
// `app.drawer.editing()` (the part id being edited, or '').
// With no drawer element there is no `editCode` at all, so the Preview hides its button.

import { t } from '../core/i18n.mjs';
import { SLOTS } from '../core/registry.mjs';
import { createInspector } from '../graph/inspect.mjs';
import { createCodeEditor, CODE_CHANGE_MS } from './code-editor.mjs';
import '../strings/computer.en.mjs';
import '../strings/computer-edit.en.mjs';

/** The drawer's width, in CSS pixels. Narrower than MIN and the heading wraps to three lines;
 * wider than MAX and the canvas it belongs to is gone. §8.1 calls the default "~440 px". */
export const DRAWER_MIN = 280;
export const DRAWER_MAX = 720;
export const DRAWER_DEFAULT = 440;

/** kv key (plan §7.1: the drawer's width is remembered, like the sidebar's).
 * NOT in core/types.mjs's KV_KEYS yet — that file belongs to nobody in K1; see the report. */
export const DRAWER_WIDTH_KEY = 'computer:drawerWidth';

/** K-8: the panel name the code editor mounts under. Reserved: nobody else mounts it. */
export const CODE_PANEL = 'code-editor';

/** K-8: code wants a wider column than a value does. While an editor is open the drawer is at
 * least this wide; the widening is NOT remembered, and a width dragged while editing is kept. */
export const CODE_WIDTH = 560;

/** K-8: how long typing must pause before `onChange` hears it (the Preview box's own field waits
 * EDIT_DEBOUNCE_MS = 400 before drawing). The editor itself is computer/code-editor.mjs since 2026-11-18. */
export { CODE_CHANGE_MS };

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
      // K-8: deliberately NO `editCode` — the Preview hides its Edit code button when it is absent.
      editing: () => '',
    };
    return;
  }

  let width = DRAWER_DEFAULT;

  /** K-8: the edit in progress, or null. Declared before anything that can end one.
   * @type {{partId: string, returnTo: any, end: () => void, giveFocusBack: () => void}|null} */
  let edit = null;

  // ---- the frame -------------------------------------------------------------------------------
  const grip = div('comp-drawer-grip');
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.title = t('computer.drawerGripHint');

  const head = div('comp-drawer-head');
  const shut = document.createElement('button');
  shut.type = 'button';
  shut.className = 'comp-drawer-close';
  shut.textContent = t('computer.drawerClose');
  shut.title = t('computer.drawerCloseHint');
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
  root.setAttribute('aria-label', t('computer.drawerLabel'));
  root.style.width = `${width}px`;

  // ---- the value -------------------------------------------------------------------------------
  // inspect.mjs's hosted mode: the same heading, the same body, the same cap. It renders into
  // `mount`, has no close button of its own and does not touch Escape — this file owns both.
  const inspector = createInspector(app, {
    el: mount,
    onClose: () => hide(),
  });

  function hide() {
    // K-8: an editor that closes with the drawer gives the focus back to where it came from.
    endEdit(true);
    root.classList.add('hidden');
    empty.classList.remove('hidden');
    hidePanels();
  }

  /** Every panel down, the inspector's mount back. @returns {void} */
  function hidePanels() {
    endEdit(false);
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
    // K-8: another panel replaces the code editor — the edit ends (its text is delivered first).
    if (key !== CODE_PANEL) endEdit(false);
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

  // Critic R1, B7 — §8.1's ladder from ANYWHERE on the surface: with the drawer open and the focus
  // on the canvas, Escape used to stop the run and leave the drawer open. The drawer is a rung of
  // this surface's CANCEL_HANDLERS, ordered BEFORE the run's (`computer-run`, order 400), so the
  // first Escape closes what you are reading and only the next one stops anything.
  if (app && app.registry && typeof app.registry.add === 'function') {
    app.registry.add(SLOTS.CANCEL_HANDLERS, {
      id: 'computer-drawer',
      order: 100,
      active: () => !root.classList.contains('hidden'),
      cancel: () => { close(); },
    });
  }

  // ---- the code editor (COMPUTER_LIVE_PLAN K-8) -----------------------------------------------
  // The field itself is computer/code-editor.mjs (shared with LOL Vibe's Page panel since 2026-11-18); the drawer
  // owns what is the drawer's: one editor at a time, the panel door, the width, and where the focus goes back.

  /** A callback the caller gave us, called so that its exception is its own and not ours.
   * @param {any} fn @param {...any} args */
  function call(fn, ...args) {
    if (typeof fn !== 'function') return;
    try { fn(...args); } catch (err) { console.warn('[lolcomputer] a code editor callback threw', err); }
  }

  /**
   * End the edit in progress: its last text is delivered, `onClose` runs, the handle goes inert,
   * the panel is taken down. `restore` gives the focus back to where it was before the editor.
   * @param {boolean} restore @returns {boolean} whether there was one
   */
  function endEdit(restore) {
    const e = edit;
    if (!e) return false;
    edit = null;
    e.end();
    const node = mounted.get(CODE_PANEL);
    if (node) { node.remove(); mounted.delete(CODE_PANEL); }
    if (shown === CODE_PANEL) shown = '';
    if (restore) e.giveFocusBack();
    return true;
  }

  /**
   * K-8. Open the code editor for one part. One at a time: a second call ends the first.
   * @param {{partId?: any, title?: any, mode?: any, source?: any, onChange?: (text: string) => void,
   *   onRun?: () => void, onClose?: () => void}} opts
   * @returns {{close: () => boolean, setSource: (text: any) => boolean,
   *   setError: (err: {line?: number, message?: any}|null) => boolean, isOpen: () => boolean,
   *   text: () => string}}
   */
  function editCode(opts) {
    const o = opts || {};
    const partId = String(o.partId == null ? '' : o.partId);

    // Where the focus goes back to: whatever had it (the box's Edit code button), unless that is
    // inside this drawer — then the editor being replaced knew better.
    const inherited = edit ? edit.returnTo : null;
    endEdit(false);
    const active = typeof document !== 'undefined' ? /** @type {any} */ (document.activeElement) : null;
    const returnTo = active && active !== document.body && !root.contains(active) ? active : inherited;

    const ed = createCodeEditor({
      partId, title: o.title, mode: o.mode, source: o.source, onChange: o.onChange, onRun: o.onRun,
    });
    const panel = ed.el;
    const area = ed.area;

    // ---- the session -------------------------------------------------------------------------
    const narrow = width;
    const widened = width < CODE_WIDTH;
    const session = {
      partId,
      returnTo,
      end() {
        if (!ed.alive()) return;
        ed.end();
        // Back to the remembered width, unless the person dragged it while editing.
        if (widened && width === CODE_WIDTH) setWidth(narrow);
        call(o.onClose);
      },
      giveFocusBack() {
        /** @type {any} */ let el = returnTo;
        if (!el || el.isConnected === false || typeof el.focus !== 'function') {
          // The button that opened the editor may have been rebuilt: the box itself, then.
          el = null;
          const boxes = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('.graph-part') : [];
          for (const box of Array.from(boxes)) {
            if (/** @type {any} */ (box).getAttribute('data-id') === partId) { el = box; break; }
          }
        }
        if (!el || typeof el.focus !== 'function') return;
        try { el.focus({ preventScroll: true }); } catch { /* detached */ }
      },
    };

    mountPanel(CODE_PANEL, panel);
    edit = session;
    if (widened) setWidth(CODE_WIDTH);
    showPanel(CODE_PANEL);
    ed.refresh();
    try { area.focus(); } catch { /* detached */ }
    try { if (typeof area.setSelectionRange === 'function') area.setSelectionRange(0, 0); } catch { /* detached */ }
    area.scrollTop = 0;
    ed.refresh();

    return {
      close() {
        if (edit !== session) return false;
        close();
        return true;
      },
      setSource: ed.setSource,
      setError: ed.setError,
      isOpen: () => edit === session,
      /** What the editor really holds, typing not yet delivered included (L1-2). */
      text: ed.text,
    };
  }

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
    // K-8: the code editor, and which part it is editing ('' when none is open).
    editCode,
    editing: () => (edit ? edit.partId : ''),
  };
  app.drawer = api;
}
