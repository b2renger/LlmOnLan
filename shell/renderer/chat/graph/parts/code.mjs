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
import { partFail, sandboxDownText } from './common.mjs';
import { t } from '../../core/i18n.mjs';
import { unfence } from '../unfence.mjs';
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
// the program that arrives on the `code` port (owner, 2026-09-27: a model can write a Code box)
// ---------------------------------------------------------------------------------------------

/** partId -> the program that last arrived on the `code` port, unfenced. A render HINT like the
 * line chip: written by run(), read by the editor, never persisted. */
const ARRIVED = new Map();

/**
 * PURE: the program on the `code` port, unfenced (a model's "Here is the code: ```js …```" runs as
 * the code alone) — or null when nothing arrived there.
 * @param {GraphValue[]} values @returns {string|null}
 */
export function arrivedCode(values) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return null;
  const text = list.map((v) => { const p = toPlain(v); return typeof p === 'string' ? p : ''; }).join('\n');
  return unfence(text, 'js').code;
}

/** Is anything wired into this box's `code` port? null when there is no document to ask (a unit
 * test), which must not read as "unwired". @param {any} ctx @param {string} id @returns {boolean|null} */
function codeWired(ctx, id) {
  try {
    const session = ctx && ctx.app && ctx.app.host && ctx.app.host.session;
    const doc = session && typeof session.doc === 'function' ? session.doc() : null;
    if (!doc || !Array.isArray(doc.wires)) return null;
    return doc.wires.some((/** @type {any} */ w) => w && w.to === id && w.port === 'code');
  } catch { return null; }
}

/** The arrival the editor shows, or null: nothing arrived, the wire is gone, or the box is locked
 * to the person's own code. @param {any} part @param {any} ctx @returns {string|null} */
function shownArrival(part, ctx) {
  const s = (part && part.settings) || {};
  const id = String(part && part.id);
  if (s.locked === true && String(s.code || '').trim()) return null;
  if (!ARRIVED.has(id) || codeWired(ctx, id) === false) return null;
  return String(ARRIVED.get(id));
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
  // Owner, 2026-09-27: a second port, `code`, takes a PROGRAM a model wrote ("＋ → Think → Write
  // code", graph/parts/creative.mjs) — the same discipline as a Preview's arriving code:
  //   1. Nothing on `code`, or the box LOCKED → it runs its own `settings.code`. Something arrived →
  //      it runs that, unfenced, and the editor SHOWS it (a run never writes `settings.code`).
  //   2. Typing in the code the box is showing makes it yours: the arrival plus the keystroke is
  //      written to `settings.code` and the box locks, so the next run keeps the person's code.
  //      "Use the model's code" unlocks.
  inputs: [
    { name: 'in', label: t('parts.codeIn'), accepts: ['text', 'json', 'list', 'image', 'file'], many: true },
    // Takes a list WHOLE too, like `in`: a list wired here must never fan the box out (BJ-9).
    { name: 'code', label: t('parts.codeCodeIn'), accepts: ['text', 'json', 'list'] },
  ],
  output: 'json',
  // `about` is what the code does, in plain words; `folded` hides the code behind it (owner,
  // 2026-09-27: "the code boxes are too intimidating"). Neither changes what a run computes.
  defaults: () => ({ code: DEFAULT_CODE, about: '', folded: false, locked: false }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-code';

    const about = document.createElement('input');
    about.type = 'text';
    about.className = 'graph-code-about';
    about.placeholder = t('parts.codeAboutPlaceholder');
    about.setAttribute('aria-label', t('parts.codeAbout'));
    about.title = t('parts.codeAboutHint');
    about.value = String(part.settings.about || '');
    about.addEventListener('input', () => ctx.update({ about: about.value }, { stale: false }));
    about.addEventListener('change', () => ctx.commit(t('parts.codeAbout')));

    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'graph-code-fold';
    fold.title = t('parts.codeFoldHint');
    fold.addEventListener('click', (e) => {
      e.preventDefault();
      ctx.update({ folded: !(ctx.part.settings && ctx.part.settings.folded) }, { stale: false, undoable: false });
    });

    const area = document.createElement('textarea');
    area.className = 'graph-code-text';
    area.spellcheck = false;
    area.setAttribute('aria-label', t('parts.codeLabel'));
    // What `inputs.in` IS is the one thing the editor cannot show, so it rides on the control.
    area.title = t('parts.codeHint');
    area.addEventListener('input', () => {
      // Rule 2: typing in the model's code makes it yours.
      const lock = shownArrival(ctx.part, ctx) !== null ? { locked: true } : {};
      ctx.update({ code: area.value, ...lock });
    });
    area.addEventListener('change', () => ctx.commit(t('parts.codeLabel')));

    const whose = document.createElement('p');
    whose.className = 'graph-code-whose';
    whose.hidden = true;
    const unlock = document.createElement('button');
    unlock.type = 'button';
    unlock.className = 'graph-code-unlock';
    unlock.textContent = t('parts.codeUseModel');
    unlock.title = t('parts.codeUseModelHint');
    unlock.hidden = true;
    unlock.addEventListener('click', (e) => {
      e.preventDefault();
      ctx.update({ locked: false });
      ctx.commit(t('parts.codeUseModel'));
    });

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'graph-code-line';
    chip.hidden = true;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const hint = errorHint(part.id);
      if (hint) selectLine(area, hint.line);
    });

    const head = document.createElement('div');
    head.className = 'graph-code-head';
    head.append(about, fold);
    wrap.append(head, whose, unlock, area, chip);
    host.replaceChildren(wrap);

    /** @param {any} p */
    const paint = (p) => {
      const s = p.settings || {};
      const folded = s.folded === true;
      const arrived = shownArrival(p, ctx);
      const shown = arrived !== null ? arrived : String(s.code || '');
      if (document.activeElement !== area && area.value !== shown) area.value = shown;
      if (document.activeElement !== about && about.value !== String(s.about || '')) about.value = String(s.about || '');
      const lines = shown ? shown.split('\n').length : 0;
      fold.textContent = folded ? t('parts.codeShow', { n: lines }) : t('parts.codeHide');
      fold.setAttribute('aria-expanded', folded ? 'false' : 'true');
      area.hidden = folded;
      wrap.classList.toggle('folded', folded);
      const wired = ARRIVED.has(String(p.id)) && codeWired(ctx, String(p.id)) !== false;
      whose.hidden = !wired;
      if (wired) whose.textContent = s.locked === true ? t('parts.codeWhoseMine') : t('parts.codeWhoseModel');
      unlock.hidden = !(wired && s.locked === true);
      const hint = p.state === 'error' && !folded ? errorHint(p.id) : null;
      chip.hidden = !hint;
      if (hint) {
        chip.textContent = t('parts.codeLineChip', { line: hint.line });
        chip.title = t('parts.codeLineTitle');
      }
    };
    paint(part);

    return {
      update(next) { paint(next); },
      destroy() { wrap.remove(); },
    };
  },

  async run(input) {
    const sandbox = typeof input.sandbox === 'function' ? await input.sandbox() : null;
    if (!sandbox) throw partFail(sandboxDownText(input.app), 'part');

    const id = String(input.part.id);
    const settings = input.part.settings || {};
    const arrived = arrivedCode((input.inputs && input.inputs.code) || []);
    if (arrived !== null) ARRIVED.set(id, arrived);
    else ARRIVED.delete(id);
    const own = String(settings.code || '');
    const body = arrived && !(settings.locked === true && own.trim()) ? arrived : own;
    if (!body.trim()) throw partFail(arrived === null ? t('parts.errCodeEmpty') : t('parts.errCodeEmptyWire'), 'empty');

    // The program is not data: the guest sees only the value ports.
    /** @type {Record<string, GraphValue[]>} */ const values = { ...(input.inputs || {}) };
    delete values.code;
    const inputs = marshalInputs(values, input.item || null);
    const out = await sandbox.compute({
      code: body,
      inputs,
      timeoutMs: CODE_TIMEOUT_MS,
      signal: input.signal,
    });

    if (!out || !out.ok) {
      const fail = codeFailure(out && out.error, body, hasListInput(values));
      setErrorHint(id, fail.hint);
      throw partFail(fail.message, 'part');
    }

    const result = coerceResult(out.json);
    setErrorHint(id, null);
    if (!result.ok) {
      throw partFail(result.why === 'json' ? t('sandbox.errResultJson') : t('parts.errCodeNoValue'), 'part');
    }
    return result.value;
  },
});
