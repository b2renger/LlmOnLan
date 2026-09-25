// @ts-check
// C1-U3. What every part needs and nothing else: how a part FAILS, and how a GraphValue becomes
// the text a prompt can carry (plan §2.6 BG-5, docs/LOLCHAT_COMPUTER_SPEC.md §2-§3).
//
// A part fails by THROWING (BG-5): `err.message` is the sentence the canvas shows, and `err.reason`
// is the machine-readable half the runner reads to tell three different things apart —
//   'busy' / 'aborted'  the farm said "not now" (the human took the seat, or Stop was pressed):
//                       the part is NOT wrong, so the runner puts it back to `stale`, keeps every
//                       finished value and ends the run. Nothing about the graph changed.
//   anything else       a real failure: the part goes `error` and its downstream stays `stale`.
// That distinction is the whole of spec §2's etiquette on the part side, which is why it lives in
// the error object rather than in prose parsing.

import { isValue } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts.en.mjs';
import '../../strings/computer-gen.en.mjs';

/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

/**
 * @param {string} message the sentence the canvas shows on the part
 * @param {'part'|'busy'|'aborted'|'capped'|'no-farm'|'invalid'|'empty'|'farm'} [reason]
 * @returns {Error}
 */
export function partFail(message, reason) {
  const err = new Error(message);
  /** @type {any} */ (err).reason = reason || 'part';
  return err;
}

/**
 * Is this failure a CONTROL failure rather than a wrong answer? (§2.6 BH-4)
 *   'capped'   the run hit `pref:computeMaxItems` and must stop asking
 *   'busy'     the human took the seat back
 *   'aborted'  Stop, or the panel closing
 * A part that loops over items itself (Filter in model mode, anything C3 adds) MUST rethrow these
 * instead of recording them against one item: they are about the RUN, not about the item, and
 * swallowing one turns "the farm is busy" into "item 7 is bad" and keeps spending the cap.
 * @param {any} err @returns {boolean}
 */
export function isControl(err) {
  const reason = err && err.reason;
  return reason === 'capped' || reason === 'busy' || reason === 'aborted';
}

/**
 * An AskResult that is not ok, as the right THROW. ONE mapping for every part that asks the farm
 * (critic S1-1, S1-7, S1-13): the Instruction, Condition and Filter each had their own copy, and
 * each dropped the ask's own sentence — so a farm that still needed its password said "No farm is
 * connected", and a window in the background said "the farm is busy".
 *
 *   busy       the ask's own sentence, `reason:'busy'`, and `hidden:true` when the window was in
 *              the background — the runner carries both into `report.yieldedBy`
 *   no_farm    the ask's own sentence ("…needs its password…" is not "no farm")
 *   no_vision  `parts.errNoVision` naming THIS box's model when the caller knows it
 *   thought    (critic S1-3/S1-4) cut off while still thinking: `parts.errCutOffThinking`
 *   the rest   as before: aborted, empty, invalid, and the farm's own words
 * @param {any} res an AskResult
 * @param {{model?: string, maxTokens?: number}} [o] what the caller asked with, for the sentence
 * @returns {Error}
 */
export function failFromAsk(res, o) {
  const opts = o || {};
  const error = res && res.error ? res.error : null;
  const kind = error ? String(error.kind || 'farm') : 'farm';
  const said = error && typeof error.message === 'string' ? error.message : '';
  if (kind === 'busy') {
    const err = partFail(said || t('parts.errBusy'), 'busy');
    if (error && error.hidden) /** @type {any} */ (err).hidden = true;
    return err;
  }
  if (kind === 'aborted') return partFail(t('parts.errAborted'), 'aborted');
  if (kind === 'no_farm') return partFail(said || t('parts.errNoFarm'), 'no-farm');
  if (kind === 'no_vision') {
    return partFail(opts.model ? t('parts.errNoVision', { model: opts.model }) : (said || t('parts.errFarmSilent')), 'part');
  }
  if (res && res.thought) {
    const n = Math.floor(Number(opts.maxTokens) || Number(res.maxTokens) || 0);
    return partFail(t('parts.errCutOffThinking', { n: n || '?' }), 'part');
  }
  if (kind === 'empty') return partFail(t('parts.errEmpty'), 'empty');
  if (kind === 'invalid') return partFail(t('parts.errInvalid'), 'invalid');
  return partFail(said ? t('parts.errFarm', { message: said }) : t('parts.errFarmSilent'), 'farm');
}

/** The items a value carries: a `list` is its own items, anything else is one item.
 * @param {GraphValue|null} value @returns {GraphValue[]} */
export function itemsOf(value) {
  if (!isValue(value)) return [];
  const v = /** @type {any} */ (value);
  if (v.kind !== 'list') return [v];
  return (Array.isArray(v.data) ? v.data : []).map((item) => (isValue(item) ? item : { kind: 'text', data: String(item) }));
}

/**
 * A value as the text a prompt (or a join) can carry. Deliberately total: every kind has an honest
 * rendering, because a part that silently produced '' would be exactly the empty result §1.2 bans.
 * @param {GraphValue|null} value @returns {string}
 */
export function textOf(value) {
  if (!isValue(value)) return '';
  const v = /** @type {any} */ (value);
  if (v.kind === 'text') return String(v.data === null || v.data === undefined ? '' : v.data);
  if (v.kind === 'json') { try { return JSON.stringify(v.data, null, 2); } catch { return String(v.data); } }
  if (v.kind === 'list') return itemsOf(v).map(textOf).join('\n');
  if (v.kind === 'file') return String((v.data && v.data.path) || '');
  return '';
}

/** `{item}` / `{i}` / `{n}` in a per-item template.
 * @param {string} tpl @param {string} item @param {number} i @param {number} n @returns {string} */
export function fillTemplate(tpl, item, i, n) {
  return String(tpl)
    .replace(/\{item\}/g, item)
    .replace(/\{i\}/g, String(i + 1))
    .replace(/\{n\}/g, String(n));
}

/** A labelled `<select>`, the one control shape three parts share. Returns the element.
 * @param {string} label @param {{value: string, label: string}[]} options @param {string} value
 * @param {(v: string) => void} onPick @returns {HTMLElement}
 */
export function pickerRow(label, options, value, onPick) {
  const row = document.createElement('label');
  row.className = 'graph-part-field';
  const caption = document.createElement('span');
  caption.className = 'graph-part-field-label';
  caption.textContent = label;
  const select = document.createElement('select');
  select.className = 'graph-part-select';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    select.appendChild(opt);
  }
  setPicked(select, value);
  select.addEventListener('change', () => onPick(select.value));
  row.append(caption, select);
  return row;
}

/**
 * Select `value`, adding an option for it when the list does not carry it.
 * C1 landing: the model picker's options come from `app.farm.get().models`, which on a cold panel
 * can be empty or simply not carry the model this part was set to — and a bare `select.value = v`
 * that matches nothing leaves the picker BLANK while the part really runs on that model. A picker
 * must never lie about what will be asked.
 * @param {any} select @param {string} value
 */
export function setPicked(select, value) {
  const v = String(value == null ? '' : value);
  const has = Array.prototype.some.call(select.children || [], (/** @type {any} */ o) => o && o.value === v);
  if (v && !has) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
  select.value = v;
}

/**
 * A part that loops INSIDE one execution (Filter over its items, and any part that follows it)
 * holds the main thread for the whole loop unless it hands it back: an `await` on a promise that
 * resolves on the microtask queue does not let a paint, a timer or a click through. This is the
 * runner's own `YIELD_SLICE_MS` etiquette, in the one place a part can reach it (fix pass,
 * finding 3): call the returned function each iteration and it yields a REAL macrotask at most
 * once every `ms`.
 * @param {number} [ms] @returns {() => Promise<void>}
 */
export function slicer(ms = 8) {
  let at = Date.now();
  return async () => {
    if (Date.now() - at < ms) return;
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    at = Date.now();
  };
}
