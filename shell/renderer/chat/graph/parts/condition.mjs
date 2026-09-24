// @ts-check
// Condition (K3-U2, COMPUTER_PLAN §6.6) — classifies its input yes/no/maybe and bars every branch
// but its own. Three Conditions off one Instruction give the Yes/No/Maybe fan of lesson 9, and the
// grey of the two barred wires is most of the teaching.
//
// TWO MODES, and the default is the free one.
//   'text'   casefold, first match wins, and ANYTHING UNMATCHED IS `maybe` — never silently "no",
//            which would send a learner's branch the wrong way without a word. Costs nothing.
//   'model'  ONE cheap generation with the fixed `{verdict}` schema, so the ask spine's cache hits
//            on (input, question): the prompt is built from exactly those two, and the spine
//            forces `cache:true`, so two Conditions asking the same question of the same text
//            cost one generation between them and a re-run of a settled graph costs none.
//
// `thinksFor` is why the plan preview does not quote a generation for a text-mode Condition: the
// number on the run bar is a promise about spending, and a free part must not inflate it (§4.6).

import { valueOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { textOf, pickerRow, setPicked, partFail, isControl } from './common.mjs';
import { textField } from './fields.mjs';
import { modelOptions, optionSig } from './instruction.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const BRANCHES = Object.freeze(['yes', 'no', 'maybe']);
export const MODES = Object.freeze(['text', 'model']);

/** chat-lint rule 5: a t() key is a literal or a same-file literal MAP, never a built string. */
const BRANCH_LABEL = {
  yes: () => t('parts.cond_yes'),
  no: () => t('parts.cond_no'),
  maybe: () => t('parts.cond_maybe'),
};

/** The verdict the model is asked for. A FIXED schema, so the spine's verdict cache hits. */
export const VERDICT_SCHEMA = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['yes', 'no', 'maybe'] } },
  required: ['verdict'],
  additionalProperties: false,
};

const YES = /^(yes|true|y|oui|affirmative|1)$/;
const NO = /^(no|false|n|non|0)$/;
const MAYBE = /^(maybe|perhaps|unsure|unclear|partly|it depends)$/;

/**
 * The free classifier (§6.6 `mode:'text'`). Casefold, first match wins, and ANYTHING UNMATCHED IS
 * `maybe` — never silently "no", which would send a learner's branch the wrong way without a word.
 * PURE, exported, and the table the unit test walks.
 * @param {any} value a GraphValue, or a raw string @returns {'yes'|'no'|'maybe'}
 */
export function classify(value) {
  if (value && typeof value === 'object' && value.kind === 'json') {
    if (value.data === true) return 'yes';
    if (value.data === false) return 'no';
    if (value.data === null) return 'maybe';
  }
  const raw = typeof value === 'string' ? value : textOf(value);
  const text = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!text) return 'maybe';
  if (text === 'true') return 'yes';
  if (text === 'false') return 'no';
  if (text === 'null') return 'maybe';
  // The first WORD-ISH token decides, so "Yes — because the study says so" is a yes.
  const head = (text.match(/[a-z0-9]+(?:\s+[a-z]+)?/) || [text])[0];
  for (const probe of [text, head, head.split(/\s+/)[0]]) {
    if (YES.test(probe)) return 'yes';
    if (NO.test(probe)) return 'no';
    if (MAYBE.test(probe)) return 'maybe';
  }
  return 'maybe';
}

/** Whatever the farm said, read as one of the three. An answer off the schema is `maybe`, by the
 * same rule as the text mode: unreadable is never "no". @param {any} raw @returns {string} */
export function readVerdict(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  return BRANCHES.includes(/** @type {any} */ (v)) ? v : classify(v);
}

/** @param {any} settings @returns {string} */
export function branchOf(settings) {
  const b = String((settings && settings.branch) || 'yes');
  return BRANCHES.includes(/** @type {any} */ (b)) ? b : 'yes';
}

/** @param {any} settings @returns {string} */
export function modeOf(settings) {
  const m = String((settings && settings.mode) || 'text');
  return MODES.includes(/** @type {any} */ (m)) ? m : 'text';
}

/** What the model is asked, built from EXACTLY the two things the cache keys on.
 * @param {string} question @param {string} text @returns {string} */
export function verdictPrompt(question, text) {
  return t('parts.condPrompt', { question: String(question || '').trim() || t('parts.condAsking'), text: String(text || '') });
}

/** The last verdict each box actually reached, so a model-mode box reports what the FARM said
 * rather than what `classify()` would have made of the value passing through it. @type {Map<string, string>} */
const verdicts = new Map();

/** @param {string} partId @returns {string} */
export function lastVerdict(partId) {
  return verdicts.get(String(partId || '')) || '';
}

/** @param {any} res @returns {Error} */
function failFrom(res) {
  const kind = res && res.error ? res.error.kind : 'farm';
  if (kind === 'no_farm') return partFail(t('parts.errNoFarm'), 'no-farm');
  if (kind === 'busy') return partFail(t('parts.errBusy'), 'busy');
  if (kind === 'aborted') return partFail(t('parts.errAborted'), 'aborted');
  if (kind === 'empty') return partFail(t('parts.errEmpty'), 'empty');
  if (kind === 'invalid') return partFail(t('parts.errInvalid'), 'invalid');
  const said = (res && res.error && res.error.message) || '';
  return partFail(said ? t('parts.errFarm', { message: said }) : t('parts.errFarmSilent'), 'farm');
}

/** @type {PartSpec} */
export const condition = /** @type {any} */ ({
  type: 'condition',
  // K6 fix round: what arrives goes on unchanged, so graph/takes.mjs looks THROUGH this box for the
  // model a picture or a sound is headed to.
  passes: true,
  order: 620,
  label: t('parts.condLabel'),
  thinks: true,
  // The plan preview must not quote a generation for a FREE text-mode Condition (§4.6's honesty).
  thinksFor: (/** @type {any} */ part) => modeOf(part && part.settings) === 'model',
  control: true,
  size: { w: 240, h: 170 },
  inputs: [{ name: 'in', label: t('parts.ctlIn'), accepts: ['any'], many: false, required: true }],
  output: 'any',
  defaults: () => ({ branch: 'yes', mode: 'text', question: '', model: '' }),

  render(host, part, ctx) {
    const branch = pickerRow(t('parts.condBranch'), BRANCHES.map((v) => ({ value: v, label: BRANCH_LABEL[v]() })),
      branchOf(part.settings), (v) => { ctx.update({ branch: v }); ctx.commit(t('parts.condBranch')); });
    const mode = pickerRow(t('parts.condMode'), [
      { value: 'text', label: t('parts.condModeText') },
      { value: 'model', label: t('parts.condModeModel') },
    ], modeOf(part.settings), (v) => { ctx.update({ mode: v }); ctx.commit(t('parts.condMode')); });
    const question = textField(t('parts.condQuestion'), String(part.settings.question || ''), {
      onInput: (v) => ctx.update({ question: v }),
      onCommit: () => ctx.commit(t('parts.condQuestion')),
    });

    // The farm is discovered AFTER boot, so the catalogue this picker was built from is routinely
    // the empty one — rebuild it when the list really moved, keeping the current selection. The
    // same rule Filter and the Instruction follow: a picker must never lie about what will be asked.
    let modelSig = optionSig(modelOptions(ctx.app));
    const model = pickerRow(t('parts.condModel'), modelOptions(ctx.app), String(part.settings.model || ''), (v) => {
      ctx.update({ model: v });
      ctx.commit(t('parts.condModel'));
    });
    /** @param {string} picked */
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

    const verdict = document.createElement('p');
    verdict.className = 'graph-part-hint graph-cond-verdict';
    const hint = document.createElement('p');
    hint.className = 'graph-part-hint';
    hint.textContent = t('parts.condHint');
    host.replaceChildren(branch, mode, question.node, model, verdict, hint);
    const paint = (/** @type {any} */ p) => {
      question.update(String(p.settings.question || ''));
      const asking = modeOf(p.settings) === 'model';
      model.hidden = !asking;
      refreshModels(String(p.settings.model || ''));
      // In model mode the verdict is the FARM's, not this box's reading of the value it passes on.
      const got = asking ? lastVerdict(p.id) : (p.value ? classify(p.value) : '');
      verdict.textContent = got ? t('parts.condVerdict', { verdict: BRANCH_LABEL[got] ? BRANCH_LABEL[got]() : got }) : '';
      verdict.dataset.verdict = got;
    };
    paint(part);
    return { update: paint, destroy() { host.replaceChildren(); } };
  },

  async run(input) {
    const part = input.part;
    const value = ((input.inputs && input.inputs.in) || [])[0] || valueOf('text', '');
    const branch = branchOf(part.settings);
    let verdict = '';

    if (modeOf(part.settings) === 'model') {
      if (!input.ask) throw partFail(t('parts.errNoFarm'), 'no-farm');
      /** @type {any} */ let res;
      try {
        res = await input.ask.json({
          task: 'graph:condition',
          model: String(part.settings.model || '') || null,
          system: t('parts.condSystem'),
          prompt: verdictPrompt(String(part.settings.question || ''), textOf(value)),
          schema: VERDICT_SCHEMA,
        });
      } catch (err) {
        // The metered wrapper throws the cap, and an aborted fetch can throw too: both are about
        // the RUN, never about this box, so they travel up untouched (§2.6 BH-4).
        if (isControl(err)) throw err;
        throw partFail(String((err && /** @type {any} */ (err).message) || ''), 'part');
      }
      if (!res || !res.ok) throw failFrom(res);
      verdict = readVerdict(res.value && res.value.verdict);
    } else {
      verdict = classify(value);
    }

    verdicts.set(part.id, verdict);
    // §4.5: the value flows whatever the verdict. Only ACTIVATION is refused.
    return { value, bar: verdict !== branch };
  },
});
