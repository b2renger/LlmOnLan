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
import { bindArrivals, bindInputs, planFor, parseSeed, maxTokensOf, SEED_SPAN } from '../bind.mjs';
import '../../strings/computer-gen.en.mjs';
import { budgetFor } from '../../ctx/budget.mjs';
import { t } from '../../core/i18n.mjs';
import { partFail, pickerRow, setPicked } from './common.mjs';
// K5 kickoff (addendum KE-3): an Instruction placed as "Write an SVG" (etc.) answers in CODE. The
// answer is unwrapped from a markdown fence and stamped with the facets its kind declares, ONCE,
// here — so it lands clean in an SVG box, and a Preview in `auto` knows how to draw it.
import { codeValue, CODE_KINDS } from '../unfence.mjs';
import { presetTitle } from './creative.mjs';
// K6 kickoff (addendum KF-3): the line that says what THIS box's model can take, as far as the
// farm has said. K6-U1 owns what it says (graph/takes-view.mjs); this file only hosts it.
import { modelCapsLine } from '../takes-view.mjs';
import { EV } from '../../core/events.mjs';
import { CAPS_EVENT } from '../../app/caps.mjs';

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

/**
 * The model picker's options. `named` (critic R4-2): the Instruction hides the picker's caption, so
 * its "automatic" row says what it is; Condition and Filter keep their caption and the plain word.
 * @param {any} app @param {{named?: boolean}} [o] @returns {{value: string, label: string}[]}
 */
export function modelOptions(app, o = {}) {
  const caps = capsOf(app);
  const models = caps && Array.isArray(caps.models) ? caps.models : [];
  const auto = o.named ? t('parts.insModelAutoNamed') : t('parts.insModelAuto');
  return [{ value: '', label: auto }]
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
  // A box is exactly its height since critic R1 (K-3). R1 grew this to 340 so the new seed row fit;
  // critic R2 (N1) compacted the rows instead — Model and Answer shape on one row, the last-run line
  // folded into the seed row — so the 300×260 of every graph saved before R1 fits again, with a
  // prompt of 129 px before a run and 63 px after one that was cut off. A NEW box is 300 tall: the
  // densest state it meets — a {name} bound, so the "Fill in {names}" row and its hint show, and
  // an answer in the foot — still leaves a 70 px prompt (measured; k9-fit holds the old sizes).
  size: { w: 300, h: 300 },
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
  // K5 kickoff (KE-3): `code` is '' (prose, exactly as before) or one of CODE_KINDS. It changes
  // what a `shape:'text'` answer becomes and — since critic R1 A8 — the SYSTEM message (the
  // sandbox's rules for that kind, graph/bind.mjs planFor) and max_tokens (4096). The instruction
  // the person reads and edits stays the task only.
  // Critic R1 A1: `seed` is '' (new each run — the default) or a whole number as a string (pinned).
  // Declared here because `serialize` only exports declared keys.
  defaults: () => ({ instruction: '', model: '', shape: 'text', schema: '', inlineVars: false, code: '', seed: '' }),
  // K5 kickoff (KE-2): a box placed as "Write an SVG" is titled that, not "Instruction".
  titleOf: (/** @type {any} */ part) => presetTitle(part),
  // K6 kickoff (addendum KF-4): this part SENDS what arrives to a model — which one is what the
  // capability resolver (graph/takes.mjs) asks about when an Image or Sound box is wired in.
  modelOf: (/** @type {any} */ part) => String((part && part.settings && part.settings.model) || ''),

  render(host, part, ctx) {
    const area = document.createElement('textarea');
    area.className = 'graph-ins-instruction';
    area.setAttribute('aria-label', t('parts.insLabel'));
    area.placeholder = t('parts.insPlaceholder');
    area.value = String(part.settings.instruction || '');
    area.addEventListener('input', () => ctx.update({ instruction: area.value }));
    area.addEventListener('change', () => ctx.commit(t('parts.insLabel')));

    let modelSig = optionSig(modelOptions(ctx.app, { named: true }));
    const model = pickerRow(t('parts.insModel'), modelOptions(ctx.app, { named: true }), String(part.settings.model || ''), (v) => {
      ctx.update({ model: v });
      ctx.commit(t('parts.insModel'));
    });

    /** The farm is discovered AFTER boot, so the catalogue this picker was built from is routinely
     * the empty one. Rebuild when the list really moved, keeping the current selection.
     * @param {string} picked */
    function refreshModels(picked) {
      const options = modelOptions(ctx.app, { named: true });
      const sig = optionSig(options);
      if (sig === modelSig) return;
      const select = /** @type {any} */ (model.querySelector('select'));
      // Critic R1 B9: the signature is stored only once the list is REALLY rebuilt. It used to be
      // stored first, so a picker that was focused when the farm's catalogue arrived bailed out
      // here and then never rebuilt again — the new models never appeared in it.
      if (!select || document.activeElement === select) return;
      modelSig = sig;
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
    // Critic R1 A2: named for what it does — "Fill in {names} with their values" — with a one-line
    // hint (also the tooltip), and shown only when the instruction really writes a bound name in
    // braces: anywhere else it would do nothing, and a control that does nothing is a question.
    const inlineWrap = document.createElement('div');
    inlineWrap.className = 'graph-ins-inline-wrap';
    const inlineRow = document.createElement('label');
    inlineRow.className = 'graph-part-check graph-ins-inline';
    inlineRow.title = t('parts.insInlineHint');
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
    const inlineHint = document.createElement('p');
    inlineHint.className = 'graph-ins-hint';
    inlineHint.textContent = t('parts.insInlineHint');
    inlineWrap.append(inlineRow, inlineHint);
    inlineWrap.hidden = true;                     // paint() shows it when a {name} is bound

    // Critic R1 A1: the SEED, in the box's visible settings. Empty = a new seed every run (the
    // default: ▶ again gives a new answer); a number = pinned. 🎲 pins a random one, ✕ goes back
    // to new each run. Each is one undoable edit, like every other setting on the box.
    const seedRow = document.createElement('div');
    seedRow.className = 'graph-ins-seed';
    const seedField = document.createElement('label');
    seedField.className = 'graph-part-field graph-ins-seed-field';
    const seedCaption = document.createElement('span');
    seedCaption.className = 'graph-part-field-label';
    seedCaption.textContent = t('parts.genSeed');
    const seedInput = document.createElement('input');
    seedInput.type = 'text';
    seedInput.className = 'graph-part-input graph-ins-seed-input';
    seedInput.setAttribute('inputmode', 'numeric');
    seedInput.setAttribute('autocomplete', 'off');
    seedInput.setAttribute('aria-label', t('parts.genSeed'));
    seedInput.placeholder = t('parts.genSeedNew');
    seedInput.title = t('parts.genSeedHint');
    seedInput.value = String(part.settings.seed == null ? '' : part.settings.seed);
    seedField.append(seedCaption, seedInput);
    /** Digits only, as typed; a number too big to send is flagged, and means new each run. */
    const markSeed = () => {
      const bad = seedInput.value !== '' && parseSeed(seedInput.value) === null;
      if (bad) seedInput.setAttribute('aria-invalid', 'true'); else seedInput.removeAttribute('aria-invalid');
    };
    seedInput.addEventListener('input', () => {
      const digits = seedInput.value.replace(/\D+/g, '').slice(0, 10);
      if (digits !== seedInput.value) seedInput.value = digits;
      markSeed();
      ctx.update({ seed: digits });
    });
    seedInput.addEventListener('change', () => ctx.commit(t('parts.genSeed')));
    /** @param {string} value @param {string} label */
    const setSeed = (value, label) => {
      seedInput.value = value;
      markSeed();
      ctx.update({ seed: value });
      ctx.commit(label);
    };
    /** Critic R2, N3: Keep pins the seed the answer ON SCREEN came from. That changes nothing that
     * was computed, so — unlike a typed seed or 🎲 — it stales nothing: this box and everything
     * downstream stay done, and the next Run all has nothing to do. Not while the box is running
     * or queued: the answer on its way has another seed, so the pin is a real edit then.
     * @param {string} value */
    const keepSeed = (value) => {
      const now = /** @type {any} */ (ctx.part || runPart);
      const s = now && now.stats;
      const same = !!s && s.seed === Number(value) && now.state !== 'running' && now.state !== 'queued';
      seedInput.value = value;
      markSeed();
      ctx.update({ seed: value }, same ? { stale: false } : undefined);
      ctx.commit(t('parts.genSeedKeep'));
    };
    const dice = seedButton('graph-ins-seed-dice', t('parts.genSeedDice'), t('parts.genSeedDiceTitle'), () => {
      setSeed(String(1 + Math.floor(Math.random() * (SEED_SPAN - 1))), t('parts.genSeedDiceTitle'));
    });
    const clearSeed = seedButton('graph-ins-seed-clear', t('parts.genSeedClear'), t('parts.genSeedClearTitle'), () => {
      setSeed('', t('parts.genSeedClearTitle'));
    });
    seedRow.append(seedField, dice, clearSeed);

    // What the LAST run used, said on the box: "last run: 48213 · Keep". Keep pins exactly
    // that number (one undo entry), so the answer on screen can be asked for again. A prose answer
    // that hit max_tokens says so on its own line (A8): it is kept, but the end is missing.
    // Critic R2, N1: the last-run line is folded INTO the seed row — it wraps under the field only
    // when the box is too narrow — so an Instruction fits the 300×260 it had before R1.
    const runLine = document.createElement('div');
    runLine.className = 'graph-ins-run';
    const seedUsed = document.createElement('span');
    seedUsed.className = 'graph-cost graph-ins-seed-used';
    const keep = seedButton('graph-ins-seed-keep', t('parts.genSeedKeep'), t('parts.genSeedKeepTitle'), () => {
      const s = runPart.stats;
      if (s && typeof s.seed === 'number') keepSeed(String(s.seed));
    });
    const cutChip = document.createElement('span');
    cutChip.className = 'graph-cost graph-ins-chip graph-ins-cut';
    runLine.append(seedUsed, keep);
    seedRow.append(runLine);
    /** @type {any} */ let runPart = part;
    /** @type {string} */ let runSig = '-';
    /** @param {any} p */
    function paintRun(p) {
      runPart = p;
      const s = p.stats || null;
      const seed = s && typeof s.seed === 'number' ? s.seed : null;
      const cut = !!(s && s.cut);
      const pinnedNow = parseSeed(p.settings && p.settings.seed);
      const next = `${seed}|${s && s.pinned ? 1 : 0}|${cut ? 1 : 0}|${pinnedNow}|${maxTokensOf(p.settings)}`;
      if (next === runSig) return;
      runSig = next;
      seedUsed.textContent = seed === null ? ''
        : (s.pinned ? t('parts.genSeedUsedPinned', { seed }) : t('parts.genSeedUsed', { seed }));
      seedUsed.hidden = seed === null;
      // Nothing to keep when that seed is already the pinned one.
      keep.hidden = seed === null || pinnedNow === seed;
      cutChip.textContent = cut ? t('parts.genCutChip', { n: maxTokensOf(p.settings) }) : '';
      cutChip.hidden = !cut;
      runLine.hidden = seed === null;
    }

    // Critic R2, N1: Model and Answer shape share ONE row, the seed row is the next one.
    const fields = document.createElement('div');
    fields.className = 'graph-part-fields graph-ins-fields';
    // Critic R3-1: the captions are visually hidden (graph.css), so each picker says what it is on hover.
    const modelSel = model.querySelector('select');
    if (modelSel) modelSel.title = t('parts.insModel');
    const shapeSel = shape.querySelector('select');
    if (shapeSel) shapeSel.title = t('parts.insShape');
    fields.append(model, shape, seedRow);

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

    // K6 kickoff (KF-3): `.graph-ins-caps` — "gemma4:12b: pictures ✓ · sound ? · PDF directly ?".
    // Shown while a picture or a sound is wired in; hidden when there is nothing honest to say.
    const capsLine = document.createElement('p');
    capsLine.className = 'graph-ins-caps';
    /** @type {any} */ let capsPart = part;
    const paintCaps = () => {
      let line = '';
      try { line = modelCapsLine(ctx.app, String((capsPart.settings && capsPart.settings.model) || ''), String(capsPart.id || '')); } catch (err) { console.warn('[lolcomputer] caps line failed', err); }
      if (capsLine.textContent !== line) capsLine.textContent = line;
      capsLine.hidden = !line;
    };
    /** @type {Array<() => void>} */ const capsOffs = [];
    const bus = ctx && ctx.app && ctx.app.bus;
    if (bus && typeof bus.on === 'function') {
      for (const name of [EV.FARM_CHANGE, CAPS_EVENT]) {
        const off = bus.on(name, paintCaps);
        if (typeof off === 'function') capsOffs.push(off);
      }
    }
    paintCaps();

    host.replaceChildren(area, fields, cutChip, capsLine, schema, inlineWrap, strip, chips);

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
      // A2: the Fill-in row is offered only where it can do something — a bound {name} — and
      // stays while it is on, so it can always be switched back off.
      const braced = plan.bind.params.some((q) => /** @type {any} */ (q).mentionedBraced);
      inlineWrap.hidden = !(braced || p.settings.inlineVars === true);
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

    /** A small ghost button (the seed row's 🎲 / ✕ / Keep). @param {string} cls @param {string} label
     * @param {string} title @param {() => void} onClick @returns {HTMLButtonElement} */
    function seedButton(cls, label, title, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `graph-btn graph-ins-seed-btn ${cls}`;
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', onClick);
      return b;
    }

    paint(part);
    paintRun(part);
    markSeed();

    return {
      update(next) {
        if (document.activeElement !== area) area.value = String(next.settings.instruction || '');
        if (document.activeElement !== schema) schema.value = String(next.settings.schema || '');
        if (document.activeElement !== seedInput) {
          const want = String(next.settings.seed == null ? '' : next.settings.seed);
          if (seedInput.value !== want) { seedInput.value = want; markSeed(); }
        }
        paintRun(next);
        refreshModels(String(next.settings.model || ''));
        const ms = /** @type {any} */ (model.querySelector('select'));
        const ss = /** @type {any} */ (shape.querySelector('select'));
        if (ms && document.activeElement !== ms) setPicked(ms, String(next.settings.model || ''));
        if (ss && document.activeElement !== ss) ss.value = String(next.settings.shape || 'text');
        capsPart = next;
        paintCaps();
        paint(next);
      },
      destroy() {
        for (const off of capsOffs.splice(0)) { try { off(); } catch { /* already gone */ } }
        host.replaceChildren();
      },
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

    const maxTokens = Number(/** @type {any} */ (plan.call).maxTokens) || maxTokensOf(settings);
    /** @type {any} */ const call = {
      task: plan.call.task,
      prompt: plan.assembled.prompt,
      system: plan.assembled.system,
      images,
      model: plan.call.model,
      priority: plan.call.priority,
      // Critic R1 A8: the real length (4096 for code, 2048 otherwise), never the silent 512.
      maxTokens,
    };
    // Critic R1 A1 (K-5): the seed the runner picked for this activation — pinned or new each run.
    // It is sent, and it is part of the ask cache's key, so a new seed is a new generation.
    if (typeof input.seed === 'number') call.seed = input.seed;

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

    /** Did the farm stop because the answer hit max_tokens? @param {any} res */
    const cutOff = (res) => !!res && res.finishReason === 'length';

    if (plan.call.shape === 'text') {
      const res = kept(await input.ask.text(call));
      if (!res || !res.ok) throw failFrom(res);
      const code = String(settings.code || '');
      if (CODE_KINDS.indexOf(code) >= 0) {
        // Critic R1 A8: half a program is not a program. A CODE answer cut off at max_tokens is a
        // named failure — never a success that draws nothing or throws a SyntaxError in the box.
        if (cutOff(res)) throw partFail(t('parts.errCutOff', { n: maxTokens }), 'part');
        return /** @type {any} */ (codeValue(String(res.value), code));
      }
      // Prose that was cut is still worth reading: it is kept, and the box says the end is
      // missing (the runner records `stats.cut`, the box paints the chip).
      return valueOf('text', String(res.value));
    }

    if (plan.call.shape === 'list') {
      const res = kept(await input.ask.json({ ...call, schema: LIST_SCHEMA }));
      if (!res || !res.ok) {
        if (cutOff(res)) throw partFail(t('parts.errCutOffData', { n: maxTokens }), 'part');
        throw failFrom(res);
      }
      const items = res.value && Array.isArray(res.value.items) ? res.value.items : [];
      return listOf(items.map((/** @type {any} */ s) => valueOf('text', String(s))));
    }

    const raw = String(plan.call.schema || '').trim();
    if (!raw) throw partFail(t('parts.errNoSchema'), 'part');
    /** @type {any} */ let schema = null;
    try { schema = JSON.parse(raw); } catch { throw partFail(t('parts.errBadSchema'), 'part'); }
    const res = kept(await input.ask.json({ ...call, schema }));
    if (!res || !res.ok) {
      if (cutOff(res)) throw partFail(t('parts.errCutOffData', { n: maxTokens }), 'part');
      throw failFrom(res);
    }
    const value = valueOf('json', res.value);
    if (!isValue(value)) throw partFail(t('parts.errNoValue'), 'part');
    return value;
  },
});
