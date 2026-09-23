// @ts-check
// Instruction (K2-U2) — the part `ask` becomes (COMPUTER_PLAN §6.3). The TYPE ID stays `ask` so
// every stored graph loads; the file, the label and the behaviour are new.
//
// What changed from `ask.mjs`, and why:
//
//   ONE PORT, `in`, every kind, `many:true`. C1's Ask distinguished its inputs by ORDER
//   ("Context 1", "Context 2"); the Instruction distinguishes them by the ARROW'S LABEL (§5.2
//   rule 7). That is the whole of K2: `societal research` on the wire becomes `## societal
//   research` in the prompt, and the reader's own spelling is what the model sees.
//
//   THE PROMPT IS NOT ASSEMBLED HERE. `graph/bind.mjs` does it, and the transcript drawer calls
//   the SAME `planFor()` — which is what makes §8.1's promise ("what you read is what will be
//   sent") a fact rather than a claim. `assemblePrompt(` appears in bind.mjs only.
//
//   VISION IS NOT A SEPARATE BOX. An image bound to a label rides `ask({images})`. A farm that
//   advertises no vision is a HARD error naming the farm's model, refused BEFORE any request goes
//   out (§6.3) — never a silent text-only fallback that quietly answers about nothing.
//
// The box shows what it will spend before it spends it: a strip with the assembled word count and
// how many named inputs it found, the `unused:` and `— not wired` chips of rules 4 and 5, and the
// `truncated` badge when §5.4 had to cut. Clicking the strip opens the transcript.

import { valueOf, listOf, isValue, valueStamp } from '../values.mjs';
import { partById } from '../model.mjs';
import { bindArrivals, bindInputs, planFor } from '../bind.mjs';
import { budgetFor } from '../../ctx/budget.mjs';
import { t } from '../../core/i18n.mjs';
import { partFail, pickerRow, setPicked } from './common.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */
/** @typedef {import('../../core/types.mjs').InstructionPlan} InstructionPlan */

/** The shape `list` asks for. A fixed schema, so the ask spine's verdict cache actually hits. */
export const LIST_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'string' } } },
  required: ['items'],
  additionalProperties: false,
};

const SHAPES = ['text', 'list', 'json'];

/** An AskResult that is not ok becomes the right THROW (see common.mjs on `reason`). @param {any} res */
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

/** @param {any} app @returns {any} the live FarmCaps, or null */
function capsOf(app) {
  return app && app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null;
}

/** @param {any} app @returns {{value: string, label: string}[]} */
export function modelOptions(app) {
  const caps = capsOf(app);
  const models = caps && Array.isArray(caps.models) ? caps.models : [];
  return [{ value: '', label: t('parts.insModelAuto') }]
    .concat(models.map((/** @type {any} */ m) => ({ value: String(m.id), label: String(m.id) })));
}

/** The cheap signature of an option list: what has to change before the picker is rebuilt.
 * @param {{value: string, label: string}[]} options @returns {string} */
export function optionSig(options) {
  return options.map((o) => o.value).join('|');
}

/** The model this part would really ask, and the underlying id the capability table is keyed by.
 * @param {any} app @param {any} settings @returns {{alias: string, underlying: string}} */
export function modelFor(app, settings) {
  const caps = capsOf(app);
  const alias = String((settings && settings.model) || '') || String((caps && caps.defaultModel) || '');
  const info = alias && app && app.farm && typeof app.farm.modelInfo === 'function'
    ? app.farm.modelInfo(alias) : null;
  return { alias, underlying: (info && info.underlying) || alias };
}

/** The open document, asked for at CALL time — the host publishes itself after the parts load. A
 * part that cannot see one still renders; its strip simply has nothing to count yet.
 * @param {any} app @returns {any} */
function docOf(app) {
  const session = app && app.host && app.host.session;
  return session && typeof session.doc === 'function' ? session.doc() : null;
}

/**
 * What this box would send RIGHT NOW, from the document — the same assembly `run()` uses, so the
 * strip never advertises a prompt the run would not produce.
 * @param {any} app @param {any} part @returns {InstructionPlan}
 */
export function planNow(app, part) {
  const doc = docOf(app);
  const live = doc ? partById(doc, part.id) : null;
  const on = live || part;
  const bind = doc
    ? bindInputs(doc, part.id, { instruction: String((on.settings || {}).instruction || '') })
    : { params: [], unused: [], unwired: [] };
  return planFor({ part: on, bind, budget: budgetFor(capsOf(app)) });
}

/**
 * The cheap signature of everything the strip depends on. Re-assembling a prompt on every render
 * would put the cost of the reader's longest document into the pan loop; this puts it behind a
 * walk of the wires, which the canvas already pays for.
 * Exported for its own unit test: a stale signature shows as a stale number on screen, which is
 * exactly the kind of quiet wrongness nobody notices until they have paid for it.
 * @param {any} app @param {any} part @returns {string}
 */
export function stripSig(app, part) {
  const doc = docOf(app);
  if (!doc) return 'no-doc';
  const s = part.settings || {};
  /** @type {string[]} */ const bits = [String(doc.rev || 0), String(s.instruction || '').length + '', s.inlineVars ? '1' : '0'];
  for (const w of doc.wires || []) {
    if (w.to !== part.id) continue;
    const up = partById(doc, w.from);
    const v = up && up.value;
    // `valueStamp`, not `data.length` (fix pass, finding 4). A runtime write does not move
    // `doc.rev` — `patchPart` is deliberately neither undoable nor rev-bumping — so an upstream
    // that re-ran and produced a DIFFERENT list or json of the same size used to leave this
    // signature identical, and the strip went on advertising the previous prompt's word count.
    bits.push(`${w.from}~${w.label || ''}~${v ? /** @type {any} */ (v).kind : '-'}~${valueStamp(v)}`);
  }
  return bits.join('|');
}

/** @type {PartSpec} */
export const instruction = /** @type {any} */ ({
  type: 'ask',
  order: 200,
  label: t('parts.insLabel'),
  thinks: true,
  size: { w: 300, h: 260 },
  // ONE port, and it takes every kind: labels do all the distinguishing (§5.2 rule 7).
  //
  // K2 LANDING, the one place §6.3 and §4.7 disagreed. §6.3 writes `accepts:['any']`, which makes a
  // `list` arriving here `'ok'` — so it would be rendered as one list and the part would run ONCE.
  // §4.7 says the opposite and is the behaviour C2 shipped and proved (Split → Ask runs once per
  // item, `⋮⋮` on the port, "Instruction: 6 times" in the pre-run plan). Ending that silently at a
  // landing would delete a shipped guarantee, so the port names the four non-list kinds instead:
  // `accepts()` then answers `'fanout'` for a list (values.mjs, kind==='list' && accepts 'text')
  // and `'ok'` for everything else — identical to `['any']` in every other respect. Kinds stay at
  // five (§6.8), so this list IS "anything but a list".
  //
  // A duplicated LABEL is still a JOIN, not a MAP (§5.2 rule 3): that is two arrows, and bind.mjs
  // makes one parameter out of them. Fan-out is one arrow carrying a list, which is a different
  // question, answered by fanout.mjs exactly as before.
  inputs: [{ name: 'in', label: t('parts.insIn'), accepts: ['text', 'image', 'json', 'file'], many: true }],
  output: 'text',
  defaults: () => ({ instruction: '', model: '', shape: 'text', schema: '', inlineVars: false }),

  render(host, part, ctx) {
    const area = document.createElement('textarea');
    area.className = 'graph-ins-instruction';
    area.setAttribute('aria-label', t('parts.insLabel'));
    area.placeholder = t('parts.insPlaceholder');
    area.value = String(part.settings.instruction || '');
    area.addEventListener('input', () => ctx.update({ instruction: area.value }));
    area.addEventListener('change', () => ctx.commit(t('parts.insLabel')));

    let modelSig = optionSig(modelOptions(ctx.app));
    const model = pickerRow(t('parts.insModel'), modelOptions(ctx.app), String(part.settings.model || ''), (v) => {
      ctx.update({ model: v });
      ctx.commit(t('parts.insModel'));
    });

    /** The farm is discovered AFTER boot, so the catalogue this picker was built from is routinely
     * the empty one. Rebuild when the list really moved, keeping the current selection.
     * @param {string} picked */
    function refreshModels(picked) {
      const options = modelOptions(ctx.app);
      const sig = optionSig(options);
      if (sig === modelSig) return;
      modelSig = sig;
      const select = /** @type {any} */ (model.querySelector('select'));
      if (!select || document.activeElement === select) return;
      select.replaceChildren();
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        select.appendChild(opt);
      }
      setPicked(select, picked);
    }

    const shape = pickerRow(t('parts.insShape'), [
      { value: 'text', label: t('parts.insShapeText') },
      { value: 'list', label: t('parts.insShapeList') },
      { value: 'json', label: t('parts.insShapeJson') },
    ], String(part.settings.shape || 'text'), (v) => {
      ctx.update({ shape: v });
      ctx.commit(t('parts.insShape'));
      paint(/** @type {any} */ ({ ...part, settings: { ...part.settings, shape: v } }));
    });

    const schema = document.createElement('textarea');
    schema.className = 'graph-ins-schema';
    schema.setAttribute('aria-label', t('parts.insSchema'));
    schema.placeholder = t('parts.insSchemaPlaceholder');
    schema.value = String(part.settings.schema || '');
    schema.addEventListener('input', () => ctx.update({ schema: schema.value }));
    schema.addEventListener('change', () => ctx.commit(t('parts.insSchema')));

    // §5.3's opt-in substitution. Default OFF: a reader who has not asked for it must be able to
    // read the prompt as "here are the inputs, here is what to do with them".
    const inlineRow = document.createElement('label');
    inlineRow.className = 'graph-ins-inline';
    const inlineBox = document.createElement('input');
    inlineBox.type = 'checkbox';
    inlineBox.checked = part.settings.inlineVars === true;
    inlineBox.addEventListener('change', () => {
      ctx.update({ inlineVars: inlineBox.checked });
      ctx.commit(t('parts.insInline'));
    });
    const inlineText = document.createElement('span');
    inlineText.textContent = t('parts.insInline');
    inlineRow.append(inlineBox, inlineText);

    const fields = document.createElement('div');
    fields.className = 'graph-part-fields';
    fields.append(model, shape);

    // The strip: what this box will spend, before it spends it. Clicking it opens the transcript,
    // which is the same assembly read in full (§8.1).
    const strip = document.createElement('button');
    strip.type = 'button';
    // NOT `.graph-value`: that class is the canvas's own value chip, the door to the inspector.
    // Two doors in one box must not answer to one selector (K2 landing).
    strip.className = 'graph-ins-strip';
    strip.addEventListener('click', () => {
      const tx = ctx.app && ctx.app.transcript;
      if (tx && typeof tx.open === 'function') tx.open(part.id, 'sent');
    });

    const chips = document.createElement('div');
    chips.className = 'graph-ins-chips';

    host.replaceChildren(area, fields, schema, inlineRow, strip, chips);

    /** @type {string} */ let sig = '';

    /** The schema box exists only for the shape that uses one; the strip and the chips follow the
     * document, and only when something they depend on actually moved. @param {any} p */
    function paint(p) {
      schema.hidden = String(p.settings.shape || 'text') !== 'json';
      inlineBox.checked = p.settings.inlineVars === true;
      const next = stripSig(ctx.app, p);
      if (next === sig) return;
      sig = next;
      const plan = planNow(ctx.app, p);
      const named = plan.bind.params.filter((q) => !q.unlabelled).length;
      const words = plan.assembled.words;
      strip.textContent = named === 0
        ? t('parts.insStripNone', { words })
        : (named === 1 ? t('parts.insStripOne', { words }) : t('parts.insStrip', { words, n: named }));
      strip.title = t('parts.insOpen');

      /** @type {HTMLElement[]} */ const rows = [];
      if (!plan.instruction && plan.bind.params.length) rows.push(chip(t('parts.insNoInstruction')));
      for (const name of plan.bind.unused) rows.push(chip(t('parts.insUnused', { name })));
      for (const name of plan.bind.unwired) rows.push(chip(t('parts.insUnwired', { name })));
      // §4.7: a list still standing at the port means this box runs once per item, and the word
      // count above is generation 1's (fix pass, finding 2). Nothing used to say so, so a reader
      // read one prompt and got N different ones.
      if (plan.fan && plan.fan.n > 1) rows.push(chip(t('parts.insFanout', { n: plan.fan.n })));
      const cutTo = plan.assembled.truncated;
      if (cutTo) {
        rows.push(chip(plan.budget.assumed
          ? t('parts.insTruncatedAssumed', { cut: cutTo.cut, of: cutTo.of, tokens: plan.budget.tokens })
          : t('parts.insTruncated', { cut: cutTo.cut, of: cutTo.of, tokens: plan.budget.tokens })));
      }
      chips.replaceChildren(...rows);
    }

    /** @param {string} text @returns {HTMLElement} */
    function chip(text) {
      const el = document.createElement('span');
      el.className = 'graph-cost graph-ins-chip';
      el.textContent = text;
      return el;
    }

    paint(part);

    return {
      update(next) {
        if (document.activeElement !== area) area.value = String(next.settings.instruction || '');
        if (document.activeElement !== schema) schema.value = String(next.settings.schema || '');
        refreshModels(String(next.settings.model || ''));
        const ms = /** @type {any} */ (model.querySelector('select'));
        const ss = /** @type {any} */ (shape.querySelector('select'));
        if (ms && document.activeElement !== ms) setPicked(ms, String(next.settings.model || ''));
        if (ss && document.activeElement !== ss) ss.value = String(next.settings.shape || 'text');
        paint(next);
      },
      destroy() { host.replaceChildren(); },
    };
  },

  async run(input) {
    const settings = input.part.settings || {};
    const values = (input.inputs && input.inputs.in) || [];
    const labels = (input.labels && input.labels.in) || [];
    const text = String(settings.instruction || '').trim();

    // ONE assembly, the same one the transcript shows (§8.1, KB-4).
    const bind = bindArrivals({ values, labels, instruction: text });
    const plan = planFor({ part: input.part, bind, budget: budgetFor(capsOf(input.app)) });
    if (plan.error === 'no-instruction') throw partFail(t('parts.errNoInstruction'), 'part');
    if (!input.ask) throw partFail(t('parts.errNoFarm'), 'no-farm');

    // §6.3: a farm that says it cannot see is refused HERE, before any request goes out, naming
    // the model it is serving. A silent text-only fallback would answer about an image nobody
    // sent — the quiet loss this project bans.
    const images = plan.assembled.images;
    // Both names are asked, because both are in play: a farm advertises `supports_vision` against
    // the model GROUP it publishes (the alias a reader picks), while the capability table is also
    // seeded against the UNDERLYING model behind it. Either saying "no" is the farm saying no.
    if (images.length && typeof input.ask.vision === 'function') {
      const { alias, underlying } = modelFor(input.app, settings);
      const blind = [alias, underlying].filter(Boolean).some((id) => input.ask.vision(id) === 'no');
      if (blind) throw partFail(t('parts.errNoVision', { alias: alias || underlying }), 'part');
    }

    const call = {
      task: plan.call.task,
      prompt: plan.assembled.prompt,
      system: plan.assembled.system,
      images,
      model: plan.call.model,
      priority: plan.call.priority,
    };

    // K2 landing: hand the raw AskResult to the transcript, so its Got tab shows what the farm
    // actually said and its repair ladder is READ rather than inferred from the parsed value
    // (§8.1). It is a fact about the last run in this window, never about the document, which is
    // why it lives there and not on the part.
    /** @param {any} res @returns {any} */
    const kept = (res) => {
      const tx = input.app && input.app.transcript;
      if (tx && typeof tx.record === 'function' && input.part && input.part.id) tx.record(input.part.id, res);
      return res;
    };

    if (plan.call.shape === 'text') {
      const res = kept(await input.ask.text(call));
      if (!res || !res.ok) throw failFrom(res);
      return valueOf('text', String(res.value));
    }

    if (plan.call.shape === 'list') {
      const res = kept(await input.ask.json({ ...call, schema: LIST_SCHEMA }));
      if (!res || !res.ok) throw failFrom(res);
      const items = res.value && Array.isArray(res.value.items) ? res.value.items : [];
      return listOf(items.map((/** @type {any} */ s) => valueOf('text', String(s))));
    }

    const raw = String(plan.call.schema || '').trim();
    if (!raw) throw partFail(t('parts.errNoSchema'), 'part');
    /** @type {any} */ let schema = null;
    try { schema = JSON.parse(raw); } catch { throw partFail(t('parts.errBadSchema'), 'part'); }
    const res = kept(await input.ask.json({ ...call, schema }));
    if (!res || !res.ok) throw failFrom(res);
    const value = valueOf('json', res.value);
    if (!isValue(value)) throw partFail(t('parts.errNoValue'), 'part');
    return value;
  },
});
