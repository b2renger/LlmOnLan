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
import { lineRange } from '../graph/unfence.mjs';
import {
  gutterModel, gutterPatch, caretAt, tabEdit, newlineEdit, applyEdit, scrollForLine,
} from './code-edit.mjs';
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

/** K-8: how long typing must pause before `onChange` hears it. Short, because the caller redraws
 * on it (the Preview box's own field waits EDIT_DEBOUNCE_MS = 400 before drawing); pending text is
 * always delivered before Run code, on blur and on close, so no keystroke is ever lost. */
export const CODE_CHANGE_MS = 250;

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
  // A textarea — the browser's own caret, selection, IME, clipboard and undo — with a line-number
  // gutter beside it and an error band behind it. No syntax colouring and no library: the goal is
  // a plain, roomy monospace editor whose every line has a number the error can point at.

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
    const name = String(o.title == null ? '' : o.title).trim();
    const mode = String(o.mode == null ? '' : o.mode);
    const source = String(o.source == null ? '' : o.source);

    // Where the focus goes back to: whatever had it (the box's Edit code button), unless that is
    // inside this drawer — then the editor being replaced knew better.
    const inherited = edit ? edit.returnTo : null;
    endEdit(false);
    const active = typeof document !== 'undefined' ? /** @type {any} */ (document.activeElement) : null;
    const returnTo = active && active !== document.body && !root.contains(active) ? active : inherited;

    // ---- the panel ---------------------------------------------------------------------------
    const panel = document.createElement('section');
    panel.className = 'comp-code';
    panel.setAttribute('data-part', partId);
    panel.setAttribute('data-mode', mode);

    const top = div('comp-code-head', panel);
    const heading = document.createElement('h3');
    heading.className = 'comp-code-title';
    heading.textContent = name ? t('computer.codeTitle', { title: name }) : t('computer.codeTitleNone');
    const caret = document.createElement('span');
    caret.className = 'comp-code-caret';
    top.append(heading, caret);

    const tools = div('comp-code-tools', panel);
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'comp-code-run';
    run.textContent = t('computer.codeRun');
    run.title = t('computer.codeRunHint');
    const hint = document.createElement('span');
    hint.className = 'comp-code-hint';
    hint.textContent = t('computer.codeHint');
    tools.append(run, hint);

    const body = div('comp-code-body', panel);
    const gutter = div('comp-code-gutter', body);
    gutter.setAttribute('aria-hidden', 'true');
    const rows = div('comp-code-rows', gutter);
    const field = div('comp-code-field', body);
    const band = div('comp-code-band', field);
    band.setAttribute('aria-hidden', 'true');
    band.hidden = true;
    const area = /** @type {any} */ (document.createElement('textarea'));
    area.className = 'comp-code-area';
    area.setAttribute('spellcheck', 'false');
    area.setAttribute('wrap', 'off');
    area.setAttribute('autocomplete', 'off');
    area.setAttribute('autocapitalize', 'off');
    area.setAttribute('data-part', partId);
    area.setAttribute('aria-label', t('computer.codeField', { title: name || t('computer.codeTitleNone') }));
    area.value = source;
    field.appendChild(area);

    const fault = div('comp-code-error', panel);
    fault.setAttribute('aria-live', 'polite');
    fault.hidden = true;
    const faultText = document.createElement('span');
    faultText.className = 'comp-code-error-text';
    const gotoBtn = document.createElement('button');
    gotoBtn.type = 'button';
    gotoBtn.className = 'comp-code-goto';
    gotoBtn.title = t('computer.codeGotoHint');
    gotoBtn.hidden = true;
    fault.append(faultText, gotoBtn);

    // ---- state -------------------------------------------------------------------------------
    let alive = true;
    let timer = /** @type {any} */ (0);
    let sent = source;          // what onChange last heard (the opening source counts as heard)
    let rowCount = 0;
    let marked = 0;             // the gutter row marked as the error line
    let errLine = 0;
    /** @type {{lh: number, pad: number}|null} */ let measured = null;

    /** The field's line height and top padding, read once it is laid out. */
    function metrics() {
      if (measured) return measured;
      let lh = 18;
      let pad = 8;
      try {
        const cs = typeof getComputedStyle === 'function' ? getComputedStyle(area) : null;
        const l = cs ? parseFloat(cs.lineHeight) : NaN;
        const p = cs ? parseFloat(cs.paddingTop) : NaN;
        if (Number.isFinite(l) && l > 0) {
          lh = l;
          if (Number.isFinite(p)) pad = p;
          measured = { lh, pad };
        }
      } catch { /* not laid out yet: the defaults match the stylesheet */ }
      return { lh, pad };
    }

    /** The gutter and the band follow the field's vertical scroll. */
    function place() {
      const y = Number(area.scrollTop) || 0;
      rows.style.transform = `translateY(${-y}px)`;
      if (marked) {
        const m = metrics();
        band.style.transform = `translateY(${m.pad + (marked - 1) * m.lh - y}px)`;
        band.style.height = `${m.lh}px`;
      }
    }

    /** Rows appended or dropped at the end only; the error row marked. */
    function renderGutter() {
      const model = gutterModel(area.value, errLine);
      const patch = gutterPatch(rowCount, model.count);
      for (let i = 0; i < patch.drop; i++) {
        const last = rows.lastChild;
        if (last) rows.removeChild(last);
      }
      for (const n of patch.add) {
        const row = document.createElement('div');
        row.className = 'comp-code-ln';
        row.textContent = String(n);
        rows.appendChild(row);
      }
      rowCount = model.count;
      rows.style.minWidth = `${model.digits}ch`;
      if (marked && marked !== model.error) {
        const old = rows.childNodes[marked - 1];
        if (old) old.classList.remove('is-error');
      }
      if (model.error) {
        const row = rows.childNodes[model.error - 1];
        if (row) row.classList.add('is-error');
      }
      marked = model.error;
      band.hidden = !marked;
      place();
    }

    function showCaret() {
      caret.textContent = t('computer.codeCaret', caretAt(area.value, Number(area.selectionStart) || 0));
    }

    /** Deliver the text if it changed since onChange last heard it. */
    function flush() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (!alive) return;
      const text = String(area.value);
      if (text === sent) return;
      sent = text;
      call(o.onChange, text);
    }

    function onInput() {
      renderGutter();
      showCaret();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = 0; flush(); }, CODE_CHANGE_MS);
    }

    function runNow() {
      if (!alive) return;
      flush();                  // the box gets the code before it is asked to run it
      if (alive) call(o.onRun);
    }

    /**
     * One rule from code-edit.mjs, applied THROUGH the field so Ctrl+Z undoes it. When the
     * browser will not (no execCommand), the value is set and the input path runs by hand.
     * @param {import('./code-edit.mjs').CodeEdit} e
     */
    function applyToField(e) {
      const before = String(area.value);
      let done = false;
      try {
        if (typeof area.setSelectionRange === 'function') area.setSelectionRange(e.from, e.to);
        if (typeof document.execCommand === 'function') {
          done = e.insert ? document.execCommand('insertText', false, e.insert) : document.execCommand('delete', false);
        }
      } catch { done = false; }
      if (!done) {
        area.value = applyEdit(before, e);
        onInput();
      }
      try { if (typeof area.setSelectionRange === 'function') area.setSelectionRange(e.selStart, e.selEnd); } catch { /* detached */ }
      showCaret();
    }

    /** Select one line and bring it into view. @param {number} line */
    function gotoLine(line) {
      if (!alive || !(line > 0)) return;
      const [a, b] = lineRange(String(area.value), line);
      try { area.focus(); } catch { /* detached */ }
      try { if (typeof area.setSelectionRange === 'function') area.setSelectionRange(a, b); } catch { /* detached */ }
      const m = metrics();
      const want = scrollForLine({
        line, lineHeight: m.lh, pad: m.pad, scrollTop: Number(area.scrollTop) || 0, height: Number(area.clientHeight) || 0,
      });
      if (want !== null) area.scrollTop = want;
      area.scrollLeft = 0;
      place();
      showCaret();
    }

    // ---- listeners ---------------------------------------------------------------------------
    area.addEventListener('input', onInput);
    area.addEventListener('scroll', place);
    area.addEventListener('blur', flush);
    for (const type of ['keyup', 'click', 'select', 'focus']) area.addEventListener(type, showCaret);
    area.addEventListener('keydown', (/** @type {any} */ ev) => {
      if (!ev || ev.isComposing) return;
      const mod = !!(ev.ctrlKey || ev.metaKey);
      if (ev.key === 'Enter' && mod) {
        ev.preventDefault();
        if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
        runNow();
        return;
      }
      if (ev.key === 'Tab' && !mod && !ev.altKey) {
        // Tab indents rather than leaving the field: Escape is the way out (it closes the editor
        // and hands the focus back), and the key hint under the Run button says so.
        ev.preventDefault();
        const e = tabEdit(area.value, area.selectionStart, area.selectionEnd, !!ev.shiftKey);
        if (e) applyToField(e);
        return;
      }
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey) {
        ev.preventDefault();
        applyToField(newlineEdit(area.value, area.selectionStart, area.selectionEnd));
      }
    });
    run.addEventListener('click', (/** @type {any} */ ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      runNow();
    });
    gotoBtn.addEventListener('click', (/** @type {any} */ ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      gotoLine(Number(gotoBtn.getAttribute('data-line')) || 0);
    });
    // The marked number in the gutter is a way to the line too.
    rows.addEventListener('click', (/** @type {any} */ ev) => {
      const row = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('.comp-code-ln') : null;
      if (row && row.classList.contains('is-error')) gotoLine(Number(row.textContent) || 0);
    });

    // ---- the session -------------------------------------------------------------------------
    const narrow = width;
    const widened = width < CODE_WIDTH;
    const session = {
      partId,
      returnTo,
      end() {
        if (!alive) return;
        flush();
        alive = false;
        if (timer) { clearTimeout(timer); timer = 0; }
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
    renderGutter();
    showCaret();
    try { area.focus(); } catch { /* detached */ }
    try { if (typeof area.setSelectionRange === 'function') area.setSelectionRange(0, 0); } catch { /* detached */ }
    area.scrollTop = 0;
    place();

    return {
      close() {
        if (edit !== session) return false;
        close();
        return true;
      },
      /** Two-way with the box's own field: the box says what it holds now. Never echoes onChange.
       * Keystrokes still pending here reach the box FIRST — and when they did, the box now holds
       * the person's text and will say so: nothing is overwritten (critic L1-2, a run landing inside
       * the typing pause used to put its text here while the box kept the typed one). */
      setSource(text) {
        if (!alive) return false;
        const next = text == null ? '' : String(text);
        if (next === String(area.value)) { sent = next; return false; }
        const heard = sent;
        flush();
        if (!alive || sent !== heard) return false;
        const a = Number(area.selectionStart) || 0;
        const b = Number(area.selectionEnd) || 0;
        area.value = next;
        sent = next;
        try { if (typeof area.setSelectionRange === 'function') area.setSelectionRange(Math.min(a, next.length), Math.min(b, next.length)); } catch { /* detached */ }
        renderGutter();
        showCaret();
        return true;
      },
      setError(err) {
        if (!alive) return false;
        if (!err) {
          errLine = 0;
          faultText.textContent = '';
          gotoBtn.hidden = true;
          fault.hidden = true;
          renderGutter();
          return true;
        }
        const line = Math.max(0, Math.floor(Number(err.line) || 0));
        errLine = line;
        faultText.textContent = String(err.message == null ? '' : err.message);
        gotoBtn.hidden = !(line > 0);
        gotoBtn.textContent = line > 0 ? t('computer.codeGoto', { line }) : '';
        gotoBtn.setAttribute('data-line', String(line));
        fault.hidden = false;
        renderGutter();
        return true;
      },
      isOpen: () => edit === session,
      /** What the editor really holds, typing not yet delivered included (L1-2). */
      text: () => (alive ? String(area.value) : ''),
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
