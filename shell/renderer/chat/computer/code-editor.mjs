// @ts-check
// The code editor's VIEW (COMPUTER_LIVE_PLAN K-8; shared since VIBE_PAGE_PLAN, 2026-11-18): a textarea — the
// browser's own caret, selection, IME, clipboard and undo — with a line-number gutter beside it, an error band
// behind it, a Run button and the error with its "Go to line". No syntax colouring and no library: a plain, roomy
// monospace editor whose every line has a number an error can point at. Its text rules (the gutter, Tab, Enter,
// the caret readout) are PURE, in ./code-edit.mjs.
//
// Two hosts build it: the Computer's drawer (`computer/drawer.mjs` editCode, a box's code) and LOL Vibe's Page
// panel (`render/page-panel.mjs`, an answer's page), so there is one editor. The host owns where it is mounted,
// focus and width; this file owns the field. Its CSS is css/code-editor.css.

import { t } from '../core/i18n.mjs';
import { lineRange } from '../graph/unfence.mjs';
import {
  gutterModel, gutterPatch, caretAt, tabEdit, newlineEdit, applyEdit, scrollForLine,
} from './code-edit.mjs';
import '../strings/computer-edit.en.mjs';

/** How long typing must pause before `onChange` hears it. Short, because the caller redraws on it; pending text is
 * always delivered before Run, on blur and on `end()`, so no keystroke is ever lost. */
export const CODE_CHANGE_MS = 250;

/** @param {string} cls @param {HTMLElement} [parent] */
function div(cls, parent) {
  const el = document.createElement('div');
  el.className = cls;
  if (parent) parent.appendChild(el);
  return el;
}

/** A callback the caller gave us, called so that its exception is its own and not ours.
 * @param {any} fn @param {...any} args */
function call(fn, ...args) {
  if (typeof fn !== 'function') return;
  try { fn(...args); } catch (err) { console.warn('[lolchat] a code editor callback threw', err); }
}

/**
 * @typedef {{ el: HTMLElement, area: any, setSource: (text: any) => boolean,
 *   setError: (err: {line?: number, message?: any}|null) => boolean, text: () => string, sent: () => string,
 *   gotoLine: (line: number) => void, flush: () => void, refresh: () => void, end: () => void,
 *   alive: () => boolean }} CodeEditor
 */

/**
 * One editor. The words default to the Computer's (a box's code); a host names its own.
 * @param {{partId?: any, title?: any, mode?: any, source?: any, onChange?: (text: string) => void,
 *   onRun?: () => void, heading?: string, label?: string, runLabel?: string, runHint?: string, hint?: string,
 *   changeMs?: number}} [opts]
 * @returns {CodeEditor}
 */
export function createCodeEditor(opts) {
  const o = opts || {};
  const partId = String(o.partId == null ? '' : o.partId);
  const name = String(o.title == null ? '' : o.title).trim();
  const mode = String(o.mode == null ? '' : o.mode);
  const source = String(o.source == null ? '' : o.source);
  const changeMs = Number.isFinite(o.changeMs) ? Number(o.changeMs) : CODE_CHANGE_MS;

  const panel = document.createElement('section');
  panel.className = 'comp-code';
  panel.setAttribute('data-part', partId);
  panel.setAttribute('data-mode', mode);

  const top = div('comp-code-head', panel);
  const heading = document.createElement('h3');
  heading.className = 'comp-code-title';
  heading.textContent = o.heading != null ? String(o.heading)
    : (name ? t('computer.codeTitle', { title: name }) : t('computer.codeTitleNone'));
  const caret = document.createElement('span');
  caret.className = 'comp-code-caret';
  top.append(heading, caret);

  const tools = div('comp-code-tools', panel);
  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'comp-code-run';
  run.textContent = o.runLabel != null ? String(o.runLabel) : t('computer.codeRun');
  run.title = o.runHint != null ? String(o.runHint) : t('computer.codeRunHint');
  const hint = document.createElement('span');
  hint.className = 'comp-code-hint';
  hint.textContent = o.hint != null ? String(o.hint) : t('computer.codeHint');
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
  area.setAttribute('aria-label', o.label != null ? String(o.label)
    : t('computer.codeField', { title: name || t('computer.codeTitleNone') }));
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

  // ---- state ---------------------------------------------------------------------------------
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
    timer = setTimeout(() => { timer = 0; flush(); }, changeMs);
  }

  function runNow() {
    if (!alive) return;
    flush();                  // the host gets the code before it is asked to run it
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

  // ---- listeners -------------------------------------------------------------------------------
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
      // Tab indents rather than leaving the field: Escape is the way out (the drawer closes the editor and hands
      // the focus back; elsewhere it leaves the field), and the key hint under the Run button says so.
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

  return {
    el: panel,
    area,
    /** Two-way with the host's own copy: the host says what it holds now. Never echoes onChange. Keystrokes still
     * pending here reach the host FIRST — and when they did, the host now holds the person's text and will say so:
     * nothing is overwritten (critic L1-2, a run landing inside the typing pause used to put its text here while
     * the box kept the typed one). */
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
    /** What the field really holds, typing not yet delivered included (L1-2). */
    text: () => (alive ? String(area.value) : ''),
    /** What onChange last heard. */
    sent: () => sent,
    gotoLine,
    flush,
    /** Lay the gutter and the caret out again (after the field was mounted or shown). */
    refresh() { renderGutter(); showCaret(); place(); },
    /** The last text is delivered, and the editor goes inert. */
    end() {
      if (!alive) return;
      flush();
      alive = false;
      if (timer) { clearTimeout(timer); timer = 0; }
    },
    alive: () => alive,
  };
}
