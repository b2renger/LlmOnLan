// @ts-check
// Split (C2) — text into items: the entry point to fan-out (spec §3, plan §2.6 BH). Deterministic,
// no farm call, no clock. Five ways to cut, and NONE of them guesses:
//
//   lines       one item per non-empty line
//   numbered    one item per list marker (1. / 2) / - / * / •), continuation lines kept with their
//               item, and a preamble ("Here are three things:") dropped rather than smuggled in as
//               item 0 — which is what a model's list answer really looks like
//   json        a JSON array becomes its items; a JSON object or scalar becomes one item
//   separator   one item per piece of the typed separator
//   paragraphs  one item per blank-line-separated block
//
// WHERE IT REFUSES instead of inventing (§1.2 "never a silent empty"): text that is not JSON in
// json mode, an empty separator in separator mode, and a split that produced NO items out of text
// that had some. A part that quietly emitted an empty list would make the whole fan-out downstream
// do nothing at all and look successful doing it.

import { valueOf, listOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { textOf, partFail, pickerRow } from './common.mjs';
import { itemsLine, numberField, textField } from './fields.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

export const MODES = ['lines', 'numbered', 'json', 'separator', 'paragraphs'];

/** A list marker at the head of a line. */
const MARKER = /^\s*(?:\d+[.)]|[-*•])\s+/;

/** @param {any} settings @returns {string} */
export function modeOf(settings) {
  const mode = String((settings && settings.mode) || 'lines');
  return MODES.includes(mode) ? mode : 'lines';
}

/** @param {any} settings @returns {string} */
function separatorOf(settings) {
  return String(settings && settings.separator === undefined ? ',' : settings.separator);
}

/** @param {any} settings @returns {number} */
function limitOf(settings) {
  const n = Number(settings && settings.limit);
  return n > 0 ? Math.floor(n) : 0;
}

/**
 * The split itself — PURE, exported, and what the unit test asserts (never re-derived in render()).
 * Throws partFail() when the settings and the text cannot honestly produce items.
 * @param {GraphValue|null} value @param {{mode?: string, separator?: string, limit?: number}} settings
 * @returns {GraphValue}
 */
export function split(value, settings) {
  const mode = modeOf(settings);
  const v = /** @type {any} */ (value);
  /** @type {GraphValue[]} */ let items = [];

  if (mode === 'json') {
    const data = v && v.kind === 'json' ? v.data : parseJson(textOf(value));
    items = (Array.isArray(data) ? data : [data]).map(asValue);
  } else if (mode === 'numbered') {
    items = numbered(textOf(value)).map((s) => valueOf('text', s));
  } else {
    const text = textOf(value);
    /** @type {string[]} */ let pieces;
    if (mode === 'paragraphs') pieces = text.split(/\r?\n\s*\r?\n/);
    else if (mode === 'separator') {
      const sep = separatorOf(settings);
      if (!sep) throw partFail(t('parts.errNoSeparator'), 'invalid');
      pieces = text.split(sep);
    } else pieces = text.split(/\r?\n/);
    items = pieces.map((s) => s.trim()).filter((s) => s.length).map((s) => valueOf('text', s));
  }

  const limit = limitOf(settings);
  return listOf(limit ? items.slice(0, limit) : items);
}

/** Unparseable text is a refusal, never "the whole text as one item".
 * @param {string} s @returns {any} */
function parseJson(s) {
  const text = String(s).trim();
  if (!text) throw partFail(t('parts.errNotJson'), 'invalid');
  try { return JSON.parse(text); } catch { throw partFail(t('parts.errNotJson'), 'invalid'); }
}

/** @param {any} d @returns {GraphValue} */
function asValue(d) {
  return typeof d === 'string' ? valueOf('text', d) : valueOf('json', d);
}

/**
 * A model's list answer, cut at its markers. Lines before the FIRST marker are the preamble and are
 * dropped; a line after one belongs to the item above it, so a wrapped bullet survives intact.
 * @param {string} text @returns {string[]}
 */
export function numbered(text) {
  /** @type {string[]} */ const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (MARKER.test(line)) out.push(line.replace(MARKER, '').trim());
    else if (out.length && line.trim()) out[out.length - 1] = `${out[out.length - 1]}\n${line.trim()}`;
  }
  return out.filter((s) => s.length);
}

/** @type {PartSpec} */
export const splitPart = /** @type {any} */ ({
  type: 'split',
  order: 250,
  label: t('parts.splitLabel'),
  thinks: false,
  size: { w: 250, h: 180 },
  inputs: [{ name: 'text', label: t('parts.splitInput'), accepts: ['text', 'json'], many: false, required: true }],
  output: 'list',
  defaults: () => ({ mode: 'lines', separator: ',', limit: 0 }),

  render(host, part, ctx) {
    // chat-lint rule 5: every t() key is a LITERAL, so the mode list is written out, never built
    // from the mode id (§2.6 BH-12).
    const options = [
      { value: 'lines', label: t('parts.splitMode_lines') },
      { value: 'numbered', label: t('parts.splitMode_numbered') },
      { value: 'json', label: t('parts.splitMode_json') },
      { value: 'separator', label: t('parts.splitMode_separator') },
      { value: 'paragraphs', label: t('parts.splitMode_paragraphs') },
    ];
    const mode = pickerRow(t('parts.splitMode'), options, modeOf(part.settings), (v) => {
      ctx.update({ mode: v });
      ctx.commit(t('parts.splitLabel'));
      paint(ctx.part);
    });

    const sep = textField(t('parts.splitSeparator'), separatorOf(part.settings), {
      onInput: (v) => ctx.update({ separator: v }),
      onCommit: () => ctx.commit(t('parts.splitSeparator')),
      placeholder: t('parts.splitSeparatorPlaceholder'),
    });
    const limit = numberField(t('parts.splitLimit'), limitOf(part.settings), 0, (n) => {
      ctx.update({ limit: n });
      ctx.commit(t('parts.splitLimit'));
    });
    const count = itemsLine();
    host.replaceChildren(mode, sep.node, limit.node, count.node);

    /** @param {any} next */
    function paint(next) {
      sep.node.hidden = modeOf(next.settings) !== 'separator';
      sep.update(separatorOf(next.settings));
      limit.update(limitOf(next.settings));
      count.update(next.value);
    }
    paint(part);

    return {
      update(next) { paint(next); },
      destroy() { host.replaceChildren(); },
    };
  },

  async run(input) {
    const value = (input.inputs.text || [])[0] || null;
    const out = split(value, input.part.settings || {});
    const items = /** @type {any} */ (out).data;
    // Text went in and nothing came out: this way of splitting does not fit this text. Saying so is
    // the difference between a mistake the reader can see and a fan-out that quietly does nothing.
    if (!items.length && textOf(value).trim()) throw partFail(t('parts.errNoItems'), 'part');
    return out;
  },
});
