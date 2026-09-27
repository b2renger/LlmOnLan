// @ts-check
// Code (C3-U2) — deterministic JavaScript, `(inputs) => value`, run in the sandbox with no network
// and no file access (spec §3, plan §2.6 BJ-8/BJ-9). This is where arithmetic, parsing and sorting
// belong: a model that sorts forty items is forty chances to drop one, and it costs a generation.
//
// What this file owns:
//   - the PART, and only the PART: ports that take a list WHOLE (BJ-9), the plain-value boundary in
//     both directions, an editor, and a failure that says WHICH LINE broke. The bridge from the
//     conversation went out at the K1 landing with the panel that placed its parts (see below).
//
// The line number is the one piece of state that does not fit the frozen runtime fields
// (value/state/error/stats/fanout are the whole of what a part may write, BG-5). It is a render
// HINT, not document state, so it lives in a module-level map keyed by part id: written by run(),
// read by the editor, and dropped the moment the part succeeds.

import { fromPlain, toPlain, isValue } from '../values.mjs';
import { partFail } from './common.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/sandbox.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

/** The starting body. `inputs.in` is an ARRAY (several wires may land on one port). */
export const DEFAULT_CODE = 'return inputs.in.map(String).join("\\n");';

/** How long one Code part may hold the sandbox before the host calls it a loop. */
export const CODE_TIMEOUT_MS = 5000;

/** Where the editor's "Line 7" chip comes from: partId -> {line, col}. Never persisted. */
const errorLines = new Map();

/** @param {string} id @returns {{line: number, col: number}|null} */
export function errorHint(id) { return errorLines.get(String(id)) || null; }

/** @param {string} id @param {{line: number, col: number}|null} hint */
export function setErrorHint(id, hint) {
  if (hint && hint.line > 0) errorLines.set(String(id), hint);
  else errorLines.delete(String(id));
}

// ---------------------------------------------------------------------------------------------
// the plain-value boundary (BJ-8) — pure, and the reason a reader never types `.data.data`
// ---------------------------------------------------------------------------------------------

/**
 * What the guest is handed: every port as an ORDERED ARRAY of plain values, plus the fan-out
 * position when this part runs inside one. A port with nothing wired into it is an empty array,
 * never `undefined` — `inputs.in.map(...)` must not be the thing that throws.
 * @param {Record<string, GraphValue[]>} inputs @param {{i: number, n: number}|null} [item]
 * @returns {{[port: string]: any}}
 */
export function marshalInputs(inputs, item) {
  /** @type {any} */ const out = {};
  const ports = inputs && typeof inputs === 'object' ? inputs : {};
  for (const port of Object.keys(ports)) {
    const values = Array.isArray(ports[port]) ? ports[port] : [];
    out[port] = values.map((v) => toPlain(v));
  }
  out.item = item && Number.isFinite(item.i) ? { i: item.i, n: item.n } : null;
  return out;
}

/** Did a list arrive at this part? It is not an error (BJ-9) — it is the one thing worth SAYING
 * when the reader's code then throws. @param {Record<string, GraphValue[]>} inputs */
export function hasListInput(inputs) {
  const ports = inputs && typeof inputs === 'object' ? inputs : {};
  for (const port of Object.keys(ports)) {
    for (const v of Array.isArray(ports[port]) ? ports[port] : []) {
      if (isValue(v) && /** @type {any} */ (v).kind === 'list') return true;
    }
  }
  return false;
}

/**
 * The JSON string the guest posted, as a GraphValue — or a reason it is not one. A `computed`
 * result is JSON by construction, so a parse failure here means the host and the guest disagree
 * about the protocol, not that the reader wrote bad code.
 * @param {string|null} json @returns {{ok: true, value: GraphValue}|{ok: false, why: 'empty'|'json'}}
 */
export function coerceResult(json) {
  if (json === null || json === undefined || json === '') return { ok: false, why: 'empty' };
  let plain = null;
  try { plain = JSON.parse(String(json)); } catch { return { ok: false, why: 'json' }; }
  const value = fromPlain(plain);
  return value ? { ok: true, value } : { ok: false, why: 'empty' };
}

// ---------------------------------------------------------------------------------------------
// the failure a reader can act on
// ---------------------------------------------------------------------------------------------

/** Anything that looks like a path or a URL, gone. A stack from inside the guest names its own
 * document and, on some engines, the file: URL it was loaded from; neither is the reader's code,
 * and one of them is a path off their own disk. @param {any} s @returns {string} */
export function sanitizeErrorText(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s)'"]+/g, '…')
    .replace(/\b[A-Za-z]:[\\/][^\s)'"]+/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which line of the READER's code failed. The guest compiles the body into a function, which shifts
 * every reported line by a fixed preamble; rather than guess the preamble we take the first
 * candidate that can exist in this code.
 * @param {any} error a `computed.error` (protocol.mjs shapes it: {message, stack, line, col})
 * @param {string} code @returns {{line: number, col: number}|null}
 */
export function errorLine(error, code) {
  const lines = String(code || '').split('\n').length;
  const col = error && Number.isFinite(error.col) ? Math.max(0, Math.floor(error.col)) : 0;
  /** @type {number[]} */ const raw = [];
  if (error && Number.isFinite(error.line) && error.line > 0) raw.push(Math.floor(error.line));
  const stack = String((error && error.stack) || '');
  const re = /:(\d+):(\d+)/g;
  let m;
  while ((m = re.exec(stack))) raw.push(Number(m[1]));
  // A function compiled from a string reports line 1 for the header the engine wrote itself, so
  // the reader's line 1 arrives as 2 or 3 depending on the engine. A candidate that cannot exist
  // in this code is not a line at all.
  for (const n of raw) {
    for (const off of [0, 2, 3, 1]) {
      const line = n - off;
      if (line >= 1 && line <= lines) return { line, col };
    }
  }
  return null;
}

/**
 * The sentence the canvas shows, and the hint the editor points with.
 * @param {any} error @param {string} code @param {boolean} listArrived
 * @returns {{message: string, hint: {line: number, col: number}|null}}
 */
export function codeFailure(error, code, listArrived) {
  const raw = sanitizeErrorText((error && error.message) || '') || t('sandbox.errNotBuilt');
  const hint = errorLine(error, code);
  let message = hint ? t('parts.errCodeLine', { line: hint.line, message: raw }) : raw;
  // The one thing worth adding: a list arrived WHOLE, which is this part's documented behaviour
  // and the likeliest reason a first attempt throws (BJ-9).
  if (listArrived) message = `${message}\n${t('parts.errCodeList')}`;
  return { message, hint };
}

// ---------------------------------------------------------------------------------------------
// THE BRIDGE FROM THE CONVERSATION IS GONE (K1 landing, COMPUTER_PLAN §3.2).
// ---------------------------------------------------------------------------------------------
// `installCodeBridge(app, {place})` registered a "Send to the Computer" button on every JavaScript
// fence and a matching message action, and the Computer PANEL passed in the placer. The Computer is
// no longer a panel inside a conversation: it is the third top-level surface, with its own library
// of documents and no chat message in sight. There is nothing for a fence button to place into, so
// the two registry rows (CODE_DECORATORS + MESSAGE_ACTIONS, id `code-to-computer`) and the three
// fence helpers that only served them (`looksLikeJs`, `codeFromFence`, `firstJsFence`) are deleted
// rather than left dangling. The Code PART below is untouched; it is reached by placing one.

// ---------------------------------------------------------------------------------------------
// the part
// ---------------------------------------------------------------------------------------------

/** Put the caret on `line` and select it, which is what "point at the line" means in a textarea.
 * @param {any} area @param {number} line */
function selectLine(area, line) {
  const text = String(area.value || '');
  const lines = text.split('\n');
  const n = Math.min(Math.max(1, Math.floor(line)), lines.length);
  let start = 0;
  for (let i = 0; i < n - 1; i++) start += lines[i].length + 1;
  const end = start + lines[n - 1].length;
  if (typeof area.focus === 'function') area.focus();
  if (typeof area.setSelectionRange === 'function') area.setSelectionRange(start, end);
}

/** @type {PartSpec} */
export const code = /** @type {any} */ ({
  type: 'code',
  order: 800,
  label: t('parts.codeLabel'),
  thinks: false,
  size: { w: 280, h: 200 },
  // Accepts everything and DECLINES to fan: a Code part that wants the whole list gets the whole
  // list (BJ-9 — arithmetic over forty items is one program, not forty; the way to fan is to wire
  // the list into something that wants `text`).
  inputs: [{ name: 'in', label: t('parts.codeIn'), accepts: ['text', 'json', 'list', 'image', 'file'], many: true }],
  output: 'json',
  defaults: () => ({ code: DEFAULT_CODE }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-code';

    const area = document.createElement('textarea');
    area.className = 'graph-code-text';
    area.spellcheck = false;
    area.setAttribute('aria-label', t('parts.codeLabel'));
    // What `inputs.in` IS is the one thing the editor cannot show, so it rides on the control.
    area.title = t('parts.codeHint');
    area.value = String(part.settings.code || '');
    area.addEventListener('input', () => ctx.update({ code: area.value }));
    area.addEventListener('change', () => ctx.commit(t('parts.codeLabel')));

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'graph-code-line';
    chip.hidden = true;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const hint = errorHint(part.id);
      if (hint) selectLine(area, hint.line);
    });

    wrap.append(area, chip);
    host.replaceChildren(wrap);

    /** @param {any} p */
    const paint = (p) => {
      const hint = p.state === 'error' ? errorHint(p.id) : null;
      chip.hidden = !hint;
      if (hint) {
        chip.textContent = t('parts.codeLineChip', { line: hint.line });
        chip.title = t('parts.codeLineTitle');
      }
    };
    paint(part);

    return {
      update(next) {
        if (document.activeElement !== area) area.value = String(next.settings.code || '');
        paint(next);
      },
      destroy() { wrap.remove(); },
    };
  },

  async run(input) {
    const sandbox = typeof input.sandbox === 'function' ? await input.sandbox() : null;
    if (!sandbox) throw partFail(t('sandbox.errDisabled'), 'part');

    const body = String(input.part.settings.code || '');
    if (!body.trim()) throw partFail(t('parts.errCodeEmpty'), 'empty');

    const inputs = marshalInputs(input.inputs || {}, input.item || null);
    const out = await sandbox.compute({
      code: body,
      inputs,
      timeoutMs: CODE_TIMEOUT_MS,
      signal: input.signal,
    });

    if (!out || !out.ok) {
      const fail = codeFailure(out && out.error, body, hasListInput(input.inputs || {}));
      setErrorHint(input.part.id, fail.hint);
      throw partFail(fail.message, 'part');
    }

    const result = coerceResult(out.json);
    setErrorHint(input.part.id, null);
    if (!result.ok) {
      throw partFail(result.why === 'json' ? t('sandbox.errResultJson') : t('parts.errCodeNoValue'), 'part');
    }
    return result.value;
  },
});
