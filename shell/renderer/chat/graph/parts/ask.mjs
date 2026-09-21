// @ts-check
// Ask (C1) — the workhorse (spec §3). Wired inputs become LABELLED context, the part's own text is
// the instruction, and the whole thing goes to the farm through the S0 ask spine at BACKGROUND
// priority, so a human typing in the chat always takes the seat first (spec §2 etiquette).
//
// Three answer shapes:
//   text   app.ask.text   -> a `text` value
//   list   app.ask.json   -> a `list` of `text` values, through a fixed items schema
//   json   app.ask.json   -> a `json` value, against the schema the reader typed
// The list and json shapes ride the ask spine's schema->prompt->text ladder for free, which is the
// whole reason this part does not talk to net/run.mjs itself.
//
// TWO SETTINGS OF SPEC §3 ARE DELIBERATELY NOT SHIPPED HERE: `thinking` and `temperature`. The ask
// spine's wire body is {model, system, prompt, images, max_tokens, response_format} (app/ask.mjs
// buildBody) — there is no door for either, and a control that silently does nothing is worse than
// no control. Both are logged as a contract request against app/ask.mjs; their strings are already
// registered so the day the door opens this file grows two rows and nothing else moves.
//
// OUTPUT KIND. `PartSpec.output` is static (the wire type-check reads it before any run), so Ask
// declares `text` — its common shape, and the shape every 'any' port accepts. With shape `list` the
// VALUE really is a list, and wiring that into a port that only accepts text now FANS at run
// time (C2, §2.6 BH-2): the part runs once per item. `Collect` accepts `list`, which ends a fan.

import { valueOf, listOf, isValue } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { partFail, textOf, pickerRow, setPicked } from './common.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

/** The shape `list` asks for. A fixed schema, so the ask spine's verdict cache actually hits. */
export const LIST_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'string' } } },
  required: ['items'],
  additionalProperties: false,
};

const SHAPES = ['text', 'list', 'json'];

/** The label each wired value gets in the prompt. @param {number} i @param {number} n */
function contextLabel(i, n) {
  return n > 1 ? t('parts.askContextN', { n: i + 1 }) : t('parts.askContext');
}

/**
 * The prompt exactly as it goes on the wire: every input labelled, then the instruction. Exported
 * because it is what the unit test asserts — the body the farm sees is the contract, not the UI.
 * @param {GraphValue[]} context @param {string} instruction @returns {string}
 */
export function promptFrom(context, instruction) {
  const blocks = context.map((v, i) => `${contextLabel(i, context.length)}:\n${textOf(v)}`);
  const head = blocks.join('\n\n');
  const tail = String(instruction || '').trim();
  if (!head) return tail;
  return tail ? `${head}\n\n${tail}` : head;
}

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

/** @param {any} app @returns {{value: string, label: string}[]} */
export function modelOptions(app) {
  const caps = app && app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null;
  const models = caps && Array.isArray(caps.models) ? caps.models : [];
  return [{ value: '', label: t('parts.askModelAuto') }]
    .concat(models.map((/** @type {any} */ m) => ({ value: String(m.id), label: String(m.id) })));
}

/** The cheap signature of an option list: what has to change before the picker is rebuilt.
 * @param {{value: string, label: string}[]} options @returns {string} */
export function optionSig(options) {
  return options.map((o) => o.value).join('|');
}

/** @type {PartSpec} */
export const ask = /** @type {any} */ ({
  type: 'ask',
  order: 200,
  label: t('parts.askLabel'),
  thinks: true,
  size: { w: 300, h: 220 },
  // `list` is NOT accepted: a list arriving here is a fan-out, which C2 implements and C1 refuses
  // out loud (spec §2). Images belong to `Look`, which is C2's too.
  inputs: [{ name: 'context', label: t('parts.askContext'), accepts: ['text', 'json', 'file'], many: true }],
  output: 'text',
  defaults: () => ({ instruction: '', model: '', shape: 'text', schema: '' }),

  render(host, part, ctx) {
    const area = document.createElement('textarea');
    area.className = 'graph-ask-instruction';
    area.setAttribute('aria-label', t('parts.askInstruction'));
    area.placeholder = t('parts.askInstructionPlaceholder');
    area.value = String(part.settings.instruction || '');
    area.addEventListener('input', () => ctx.update({ instruction: area.value }));
    area.addEventListener('change', () => ctx.commit(t('parts.askLabel')));

    let modelSig = optionSig(modelOptions(ctx.app));
    const model = pickerRow(t('parts.askModel'), modelOptions(ctx.app), String(part.settings.model || ''), (v) => {
      ctx.update({ model: v });
      ctx.commit(t('parts.askModel'));
    });

    /**
     * The farm is discovered asynchronously AFTER boot, so the catalogue this picker was built
     * from is routinely the empty one. Rebuild when the list really moved, keeping the current
     * selection (setPicked re-adds a value the farm no longer publishes, so a part never lies
     * about what it will ask). C1 fix pass: without this, a saved graph opened on a cold launch
     * offered nothing but Automatic for the life of the panel.
     * @param {string} picked
     */
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

    const shape = pickerRow(t('parts.askShape'), [
      { value: 'text', label: t('parts.askShapeText') },
      { value: 'list', label: t('parts.askShapeList') },
      { value: 'json', label: t('parts.askShapeJson') },
    ], String(part.settings.shape || 'text'), (v) => {
      ctx.update({ shape: v });
      ctx.commit(t('parts.askShape'));
      paint(/** @type {any} */ ({ ...part, settings: { ...part.settings, shape: v } }));
    });

    const schema = document.createElement('textarea');
    schema.className = 'graph-ask-schema';
    schema.setAttribute('aria-label', t('parts.askSchema'));
    schema.placeholder = t('parts.askSchemaPlaceholder');
    schema.value = String(part.settings.schema || '');
    schema.addEventListener('input', () => ctx.update({ schema: schema.value }));
    schema.addEventListener('change', () => ctx.commit(t('parts.askSchema')));

    const fields = document.createElement('div');
    fields.className = 'graph-part-fields';
    fields.append(model, shape);
    host.replaceChildren(area, fields, schema);

    /** The schema box exists only for the shape that uses one. @param {any} p */
    function paint(p) {
      schema.hidden = String(p.settings.shape || 'text') !== 'json';
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
    const context = (input.inputs && input.inputs.context) || [];
    const instruction = String(settings.instruction || '').trim();
    if (!instruction && !context.length) throw partFail(t('parts.errNoInstruction'), 'part');
    if (!input.ask) throw partFail(t('parts.errNoFarm'), 'no-farm');

    const prompt = promptFrom(context, instruction);
    const model = String(settings.model || '') || null;
    const shape = SHAPES.includes(String(settings.shape)) ? String(settings.shape) : 'text';

    if (shape === 'text') {
      const res = await input.ask.text({ task: 'graph:ask', prompt, model });
      if (!res || !res.ok) throw failFrom(res);
      return valueOf('text', String(res.value));
    }

    if (shape === 'list') {
      const res = await input.ask.json({ task: 'graph:ask', prompt, model, schema: LIST_SCHEMA });
      if (!res || !res.ok) throw failFrom(res);
      const items = res.value && Array.isArray(res.value.items) ? res.value.items : [];
      return listOf(items.map((/** @type {any} */ s) => valueOf('text', String(s))));
    }

    const raw = String(settings.schema || '').trim();
    if (!raw) throw partFail(t('parts.errNoSchema'), 'part');
    /** @type {any} */ let schema = null;
    try { schema = JSON.parse(raw); } catch { throw partFail(t('parts.errBadSchema'), 'part'); }
    const res = await input.ask.json({ task: 'graph:ask', prompt, model, schema });
    if (!res || !res.ok) throw failFrom(res);
    const value = valueOf('json', res.value);
    if (!isValue(value)) throw partFail(t('parts.errNoValue'), 'part');
    return value;
  },
});
