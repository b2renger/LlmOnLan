// @ts-check
// Filter (C2) — keeps the items of a list that match (spec §3, plan §2.6 BH). Four modes, and the
// difference between them is money: contains / matches / length are DETERMINISTIC and free, while
// `model` spends one cheap yes/no generation per item.
//
// Three properties worth stating, because each one is a rule somewhere else in the Computer:
//
//   1. It accepts `list` on `items`, so the runner does NOT fan it out (values.mjs accepts() only
//      fans a list into a port that wants text). Filter iterates internally — which is why it must
//      rethrow a CONTROL failure (capped / busy / aborted) instead of blaming the item it happened
//      to be on: isControl() in common.mjs, §2.6 BH-4. Swallowing one would turn "the farm is busy"
//      into "item 7 is bad" and keep spending the cap on the rest.
//   2. Model mode is CACHED BY ITEM: the prompt is the criterion plus the item text, and the ask
//      spine's cache key is that prompt, so re-running a filtered list after editing something
//      downstream costs nothing at all. No salt is ever passed here — a repeated item is the same
//      question and deserves the same answer, which is the opposite of Repeat's case.
//   3. A per-item failure that is NOT a control failure fails the PART, naming the item
//      (parts.itemError). A yes/no that never arrived cannot be answered by dropping the item:
//      that would be exactly the silent loss §1.2 bans, on a part whose whole job is deciding what
//      to keep. The cached verdicts of the items that did answer make the re-run cheap.

import { listOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { itemsOf, textOf, pickerRow, partFail, isControl, setPicked, slicer } from './common.mjs';
import { modelOptions, optionSig } from './ask.mjs';
import { itemsLine, numberField, textField, checkField } from './fields.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

export const MODES = ['contains', 'matches', 'length', 'model'];

/** The longest pattern `matches` will compile. A regular expression a person typed into a 260px
 * box is short; anything longer is a paste, and a long pattern is where the pathological ones live. */
export const MAX_PATTERN = 200;

/** Patterns whose EXECUTION can run away: a quantified group that is itself quantified
 * (`(a+)+`, `(a*)*`, `(a|aa)+`…) backtracks exponentially, and `RegExp` has no timeout — the
 * renderer simply stops, with Stop unclickable because the loop is inside one macrotask. Compiling
 * is guarded already; RUNNING was not (fix pass, finding 3). */
const NESTED_QUANTIFIER = /\([^)]*[+*}][^)]*\)\s*[+*{]|\([^)]*\|[^)]*\)\s*[+*{]/;

/** Is this pattern safe to RUN? @param {string} source @returns {boolean} */
export function safePattern(source) {
  const s = String(source || '');
  return s.length <= MAX_PATTERN && !NESTED_QUANTIFIER.test(s);
}

/** The yes/no the model is asked for. A fixed schema, so the ask spine's verdict cache hits. */
export const KEEP_SCHEMA = {
  type: 'object',
  properties: { keep: { type: 'boolean' } },
  required: ['keep'],
  additionalProperties: false,
};

/** @param {any} settings @returns {string} */
export function modeOf(settings) {
  const mode = String((settings && settings.mode) || 'contains');
  return MODES.includes(mode) ? mode : 'contains';
}

/**
 * The deterministic verdict for one item — PURE, exported, and what the unit test asserts.
 * `invert` is applied by the caller, once, so this stays a plain "does it match".
 * @param {string} text
 * @param {{mode?: string, text?: string, min?: number, max?: number}} settings
 * @returns {boolean}
 */
export function keeps(text, settings) {
  const mode = modeOf(settings);
  const s = String(text == null ? '' : text);
  if (mode === 'matches') {
    const source = String((settings && settings.text) || '');
    if (!source) return false;
    if (!safePattern(source)) throw partFail(t('parts.errUnsafePattern'), 'invalid');
    try { return new RegExp(source, 'i').test(s); } catch { throw partFail(t('parts.errBadPattern'), 'invalid'); }
  }
  if (mode === 'length') {
    const min = Math.max(0, Math.floor(Number(settings && settings.min) || 0));
    const rawMax = Math.floor(Number(settings && settings.max) || 0);
    const max = rawMax > 0 ? rawMax : Infinity;
    return s.length >= min && s.length <= max;
  }
  // `contains` — and the fallback for an unknown mode, because a picker that lost its value must
  // still filter by something the reader can see rather than silently keeping everything.
  return s.toLowerCase().includes(String((settings && settings.text) || '').toLowerCase());
}

/** The prompt one item is judged with. Exported: the harness asserts this body on the wire.
 * @param {string} criterion @param {string} item @returns {string} */
export function verdictPrompt(criterion, item) {
  return `${String(criterion).trim()}\n\n---\n${item}`;
}

/** An AskResult that is not ok becomes the right THROW: a control failure keeps its reason so the
 * runner can end the run, anything else names the item. @param {any} res @param {number} i */
function failFor(res, i) {
  const kind = (res && res.error && res.error.kind) || 'farm';
  if (kind === 'busy') return partFail(t('parts.errBusy'), 'busy');
  if (kind === 'aborted') return partFail(t('parts.errAborted'), 'aborted');
  if (kind === 'no_farm') return partFail(t('parts.errNoFarm'), 'no-farm');
  const message = kind === 'empty' ? t('parts.errEmpty')
    : kind === 'invalid' ? t('parts.errInvalid')
      : ((res && res.error && res.error.message)
        ? t('parts.errFarm', { message: res.error.message })
        : t('parts.errFarmSilent'));
  return partFail(t('parts.itemError', { i: i + 1, message }), 'part');
}

/** @type {PartSpec} */
export const filter = /** @type {any} */ ({
  type: 'filter',
  order: 270,
  label: t('parts.filterLabel'),
  thinks: true,
  size: { w: 260, h: 220 },
  inputs: [
    { name: 'items', label: t('parts.filterItems'), accepts: ['list'], many: false, required: true },
    { name: 'criterion', label: t('parts.filterCriterion'), accepts: ['text'], many: false, required: false },
  ],
  output: 'list',
  defaults: () => ({ mode: 'contains', text: '', min: 0, max: 0, invert: false, model: '' }),

  render(host, part, ctx) {
    // chat-lint rule 5: literal keys, never a key built from the mode id (§2.6 BH-12).
    const options = [
      { value: 'contains', label: t('parts.filterMode_contains') },
      { value: 'matches', label: t('parts.filterMode_matches') },
      { value: 'length', label: t('parts.filterMode_length') },
      { value: 'model', label: t('parts.filterMode_model') },
    ];
    const mode = pickerRow(t('parts.filterMode'), options, modeOf(part.settings), (v) => {
      ctx.update({ mode: v });
      ctx.commit(t('parts.filterLabel'));
      paint(ctx.part);
    });

    const text = textField(t('parts.filterCriterion'), String(part.settings.text || ''), {
      onInput: (v) => ctx.update({ text: v }),
      onCommit: () => ctx.commit(t('parts.filterCriterion')),
      placeholder: t('parts.filterCriterionPlaceholder'),
    });
    const min = numberField(t('parts.filterMin'), Number(part.settings.min) || 0, 0, (n) => {
      ctx.update({ min: n });
      ctx.commit(t('parts.filterMin'));
    });
    const max = numberField(t('parts.filterMax'), Number(part.settings.max) || 0, 0, (n) => {
      ctx.update({ max: n });
      ctx.commit(t('parts.filterMax'));
    });
    const invert = checkField(t('parts.filterInvert'), !!part.settings.invert, (on) => {
      ctx.update({ invert: on });
      ctx.commit(t('parts.filterInvert'));
    });

    let modelSig = optionSig(modelOptions(ctx.app));
    const model = pickerRow(t('parts.filterModel'), modelOptions(ctx.app), String(part.settings.model || ''), (v) => {
      ctx.update({ model: v });
      ctx.commit(t('parts.filterModel'));
    });
    const count = itemsLine();
    host.replaceChildren(mode, text.node, min.node, max.node, invert.node, model, count.node);

    /**
     * The farm is discovered AFTER boot, so the catalogue this picker was built from is routinely
     * the empty one — rebuild when the list really moved, keeping the current selection (the same
     * rule Ask follows: a picker must never lie about what will be asked).
     * @param {string} picked
     */
    function refreshModels(picked) {
      const next = modelOptions(ctx.app);
      const sig = optionSig(next);
      if (sig === modelSig) return;
      modelSig = sig;
      const select = /** @type {any} */ (model.querySelector('select'));
      if (!select) return;
      select.replaceChildren();
      for (const o of next) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        select.appendChild(opt);
      }
      setPicked(select, picked);
    }

    /** @param {any} next */
    function paint(next) {
      const m = modeOf(next.settings);
      text.node.hidden = m === 'length';
      min.node.hidden = m !== 'length';
      max.node.hidden = m !== 'length';
      model.hidden = m !== 'model';
      text.update(String(next.settings.text || ''));
      min.update(Number(next.settings.min) || 0);
      max.update(Number(next.settings.max) || 0);
      invert.update(!!next.settings.invert);
      refreshModels(String(next.settings.model || ''));
      count.update(next.value);
    }
    paint(part);

    return {
      update(next) { paint(next); },
      destroy() { host.replaceChildren(); },
    };
  },

  async run(input) {
    const settings = input.part.settings || {};
    const items = itemsOf((input.inputs.items || [])[0] || null);
    const wired = textOf((input.inputs.criterion || [])[0] || null);
    const criterion = wired || String(settings.text || '');
    const invert = !!settings.invert;
    const mode = modeOf(settings);
    /** @type {GraphValue[]} */ const kept = [];

    // A WIRED criterion in `matches` mode is a regular expression WRITTEN BY A MODEL, compiled and
    // run over reader text: the one input that can hand this part a pattern designed (or merely
    // unlucky enough) to backtrack forever. Refused by name rather than defused quietly — the
    // pattern belongs in the box, where a person can see it (fix pass, finding 3).
    if (mode === 'matches' && wired) throw partFail(t('parts.errWiredPattern'), 'invalid');

    const breathe = slicer();
    if (mode !== 'model') {
      const rules = { ...settings, mode, text: criterion };
      if (mode !== 'length' && !criterion) throw partFail(t('parts.errNoCriterion'), 'invalid');
      for (const item of items) {
        if (keeps(textOf(item), rules) !== invert) kept.push(item);
        // eslint-disable-next-line no-await-in-loop
        await breathe();
      }
      return listOf(kept);
    }

    if (!criterion) throw partFail(t('parts.errNoCriterion'), 'invalid');
    if (!input.ask) throw partFail(t('parts.errNoFarm'), 'no-farm');
    const model = String(settings.model || '') || null;

    for (let i = 0; i < items.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await breathe();
      /** @type {any} */ let res;
      try {
        res = await input.ask.json({
          task: 'graph:filter',
          model,
          system: t('parts.filterSystem'),
          prompt: verdictPrompt(criterion, textOf(items[i])),
          schema: KEEP_SCHEMA,
        });
      } catch (err) {
        // The metered wrapper throws the cap (BH-4), and an aborted fetch can throw too: both are
        // about the RUN, so they travel up untouched.
        if (isControl(err)) throw err;
        throw partFail(t('parts.itemError', { i: i + 1, message: String((err && /** @type {any} */ (err).message) || '') }), 'part');
      }
      if (!res || !res.ok) {
        const fail = failFor(res, i);
        throw fail;                                  // control or not, the reason rides with it
      }
      const yes = !!(res.value && res.value.keep);
      if (yes !== invert) kept.push(items[i]);
    }
    return listOf(kept);
  },
});
