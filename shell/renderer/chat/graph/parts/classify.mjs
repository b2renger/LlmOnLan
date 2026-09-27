// @ts-check
// Classify (docs/ECOSYSTEM_PLAN.md v2 §3.2) — Laya, the farm's fast decision model, answers ONE
// multiple-choice question for every item of a list, with a confidence. Not a generation: one
// forward pass per item on the farm (net/classify.mjs), no prose, no seat.
//
// Laya is a FIRST PASS (our spike: ≈7–8/10 right on topics, and the wrong answers carried lower
// confidence), so the box never hides its doubt: an answer below the threshold is passed on as
// `sure: false`, for a thinking model or a person to check. Its confidence is uncalibrated and the
// face says so.
//
// Output (the same `labels` shape the Read-the-news labelling Instruction returns, so a graph can
// put either in front of the same Code):
//   { labels: [{id, label, confidence, sure}], unsure: [id…], check: [{id, text}], by: 'laya' | 'none', ms, threshold }
// `check` carries the words of the UNSURE items only, so a model can give a second opinion from
// Classify's answers alone, and never re-reads an item Laya was sure of (owner, 2026-09-27).
// With no Classify service on the farm (it is off by default), nothing is sent: every item comes
// out unsure (`by: 'none'`) and the face says so — a graph built for Laya still runs, and the model
// behind it labels everything.
//
// Items: a list, an object holding a list (its first array property), or lines of text. An item
// with a string `title` or `text` is sent as that string; any other object is sent as JSON.

import { toPlain, valueOf } from '../values.mjs';
import { partFail } from './common.mjs';
import { classifyItems } from '../../net/classify.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-classify.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const DEFAULT_THRESHOLD = 0.6;
/** The farm's own ceiling (classify.maxItems default) — refused here before anything is sent. */
export const MAX_ITEMS = 200;

/** A literal map, so lint rule 5 can see every key a person may read. */
const ERR_KEY = {
  unauthorized: 'parts.classifyErr_unauthorized',
  busy: 'parts.classifyErr_busy',
  warming: 'parts.classifyErr_warming',
  'too-many': 'parts.classifyErr_tooMany',
  farm: 'parts.classifyErr_farm',
  timeout: 'parts.classifyErr_timeout',
  network: 'parts.classifyErr_network',
};

/** partId -> the face's status line. Never persisted (a render hint, like the Code box's chip). */
const notes = new Map();

/**
 * PURE: whatever arrived → the items and their ids.
 * @param {any} plain @returns {{id: any, item: any}[]}
 */
export function itemsOf(plain) {
  let list = null;
  if (Array.isArray(plain)) list = plain;
  else if (plain && typeof plain === 'object') list = Object.values(plain).find((v) => Array.isArray(v)) || null;
  else if (typeof plain === 'string') list = plain.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!list) return [];
  return list.map((item, i) => ({
    id: item && typeof item === 'object' && (typeof item.id === 'number' || typeof item.id === 'string') ? item.id : i + 1,
    item,
  }));
}

/** PURE: what Laya reads for one item. @param {any} item */
export function stateOf(item) {
  if (item && typeof item === 'object') {
    if (typeof item.title === 'string' && item.title.trim()) return item.title;
    if (typeof item.text === 'string' && item.text.trim()) return item.text;
    return item;
  }
  return String(item);
}

/** PURE: options from a wire (text, list) or the box's own lines → a clean list. @param {any} plain */
export function optionsOf(plain) {
  const raw = Array.isArray(plain) ? plain.map(String) : String(plain || '').split(/[\n,]+/);
  const out = [];
  for (const o of raw.map((s) => s.trim().toLowerCase()).filter(Boolean)) if (!out.includes(o)) out.push(o);
  return out;
}

/**
 * PURE: what arrived on the `question` port → the question and, when it brought them, the options.
 * Text is the question; an object (a "Write a Laya question" answer) carries `question` (or
 * `instructions`) and `options`. @param {any} plain @returns {{question: string, options: string[]|null}}
 */
export function questionOf(plain) {
  if (typeof plain === 'string') return { question: plain.trim(), options: null };
  if (!plain || typeof plain !== 'object' || Array.isArray(plain)) return { question: '', options: null };
  const question = String(plain.question || plain.instructions || '').trim();
  const raw = plain.options;
  const options = raw === undefined || raw === null ? null
    : optionsOf(raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw) : raw);
  return { question, options: options && options.length ? options : null };
}

/** PURE: the words Laya read for an item, capped (the output's `check` list). @param {any} item @returns {string} */
export function textOf(item) {
  const st = stateOf(item);
  return (typeof st === 'string' ? st : JSON.stringify(st)).slice(0, 300);
}

/**
 * PURE: answers → the box's output.
 * @param {{id: any}[]} rows @param {({choice: string|null, confidence: number})[]|null} answers
 * @param {number} threshold @param {number} ms
 */
export function labelsFrom(rows, answers, threshold, ms) {
  const labels = rows.map((r, i) => {
    const a = answers ? answers[i] : null;
    const confidence = a ? Math.round(a.confidence * 1000) / 1000 : 0;
    return { id: r.id, label: a ? a.choice : null, confidence, sure: !!a && !!a.choice && confidence >= threshold };
  });
  const check = rows.filter((r, i) => !labels[i].sure).map((r) => ({ id: r.id, text: textOf(/** @type {any} */ (r).item) }));
  return { labels, unsure: check.map((c) => c.id), check, by: answers ? 'laya' : 'none', ms, threshold };
}

/** @type {PartSpec} */
export const classifyPart = /** @type {any} */ ({
  type: 'classify',
  order: 250,
  label: t('parts.classifyLabel'),
  thinks: false,
  size: { w: 320, h: 230 },
  // Takes the list WHOLE (no fan-out: Laya answers them in one call).
  inputs: [
    { name: 'items', label: t('parts.classifyItemsIn'), accepts: ['json', 'list', 'text'] },
    { name: 'options', label: t('parts.classifyOptionsIn'), accepts: ['text', 'json', 'list'] },
    // Owner, 2026-09-27: a model can write the question ("＋ → Think → Write a Laya question").
    { name: 'question', label: t('parts.classifyQuestionIn'), accepts: ['json', 'text'] },
  ],
  output: 'json',
  defaults: () => ({ question: t('parts.classifyQuestionPlaceholder'), options: '', threshold: DEFAULT_THRESHOLD }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-classify';
    const q = document.createElement('input');
    q.type = 'text';
    q.className = 'graph-classify-q';
    q.placeholder = t('parts.classifyQuestionPlaceholder');
    q.setAttribute('aria-label', t('parts.classifyQuestion'));
    q.value = String(part.settings.question || '');
    q.addEventListener('input', () => ctx.update({ question: q.value }));
    q.addEventListener('change', () => ctx.commit(t('parts.classifyQuestion')));
    const opts = document.createElement('textarea');
    opts.className = 'graph-classify-opts';
    opts.placeholder = t('parts.classifyOptionsPlaceholder');
    opts.setAttribute('aria-label', t('parts.classifyOptions'));
    opts.value = String(part.settings.options || '');
    opts.addEventListener('input', () => ctx.update({ options: opts.value }));
    opts.addEventListener('change', () => ctx.commit(t('parts.classifyOptions')));
    const thr = document.createElement('label');
    thr.className = 'graph-classify-thr';
    thr.title = t('parts.classifyThresholdHint');
    const num = document.createElement('input');
    num.type = 'number';
    num.min = '0.3'; num.max = '0.95'; num.step = '0.05';
    num.value = String(part.settings.threshold ?? DEFAULT_THRESHOLD);
    num.addEventListener('change', () => {
      const v = Math.min(0.95, Math.max(0.3, Number(num.value) || DEFAULT_THRESHOLD));
      ctx.update({ threshold: v });
      ctx.commit(t('parts.classifyThreshold'));
    });
    thr.append(document.createTextNode(`${t('parts.classifyThreshold')} `), num);
    const status = document.createElement('div');
    status.className = 'graph-classify-status';
    wrap.append(q, opts, thr, status);
    host.replaceChildren(wrap);
    /** @param {any} p */
    const paint = (p) => { status.textContent = notes.get(String(p.id)) || ''; };
    paint(part);
    return {
      update(next) {
        if (document.activeElement !== q) q.value = String(next.settings.question || '');
        if (document.activeElement !== opts) opts.value = String(next.settings.options || '');
        if (document.activeElement !== num) num.value = String(next.settings.threshold ?? DEFAULT_THRESHOLD);
        paint(next);
      },
      destroy() { wrap.remove(); },
    };
  },

  async run(input) {
    const id = String(input.part.id);
    const s = input.part.settings || {};
    const inputs = input.inputs || {};
    // The wire wins over the box's own field: a question (and options) a model wrote.
    const qIn = (inputs.question || [])[0];
    const wired = qIn ? questionOf(toPlain(qIn)) : { question: '', options: null };
    const question = wired.question || String(s.question || '').trim();
    if (!question) throw partFail(t('parts.classifyNoQuestion'), 'empty');
    const itemsIn = (inputs.items || [])[0];
    const rows = itemsOf(itemsIn ? toPlain(itemsIn) : null);
    if (!rows.length) throw partFail(t('parts.classifyNoItems'), 'empty');
    if (rows.length > MAX_ITEMS) throw partFail(t('parts.classifyTooMany', { n: rows.length, max: MAX_ITEMS }), 'part');
    const optsIn = (inputs.options || [])[0];
    const options = optsIn ? optionsOf(toPlain(optsIn)) : wired.options || optionsOf(s.options);
    if (options.length < 2 || options.length > 20) throw partFail(t('parts.classifyBadOptions'), 'part');
    const threshold = Math.min(0.95, Math.max(0.3, Number(s.threshold) || DEFAULT_THRESHOLD));

    // Read the capability NOW, not at mount: the client may have moved to another farm (plan v2 §4.1).
    const farm = input.app && input.app.farm && typeof input.app.farm.get === 'function' ? input.app.farm.get() : null;
    const svc = farm && farm.classify ? farm.classify : null;
    if (!svc) {
      notes.set(id, t('parts.classifyNoLaya'));
      return valueOf('json', labelsFrom(rows, null, threshold, 0));
    }
    const out = await classifyItems({
      url: svc.url, key: svc.key, items: rows.map((r) => stateOf(r.item)), instructions: question, options, signal: input.signal,
    });
    if ('error' in out) {
      notes.delete(id);
      if (out.code === 'aborted') throw partFail(t('parts.classifyErr_busy'), 'aborted');
      const message = t(/** @type {any} */ (ERR_KEY)[out.code] || ERR_KEY.farm, { message: out.error });
      // "Not now" is the farm's etiquette, not a broken box: the runner puts it back to stale.
      throw partFail(message, out.code === 'busy' || out.code === 'warming' ? 'busy' : 'part');
    }
    const value = labelsFrom(rows, out.answers, threshold, out.ms);
    const status = t('parts.classifyStatus', { n: rows.length, unsure: value.unsure.length, sec: (out.ms / 1000).toFixed(1) });
    notes.set(id, wired.question ? t('parts.classifyAsked', { question, options: options.join(', ') }) + ' · ' + status : status);
    return valueOf('json', value);
  },
});
