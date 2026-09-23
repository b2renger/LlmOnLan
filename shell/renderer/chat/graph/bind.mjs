// @ts-check
// K2-U2 — arrow labels as named parameters, and the prompt they assemble (COMPUTER_PLAN §5).
// PURE: no DOM, no farm, no storage, no clock. Listed in chat-lint.js PURE_MODULES, which is what
// lets `computer-bind.test.mjs` — the most important test file in the build — run in Node.
//
// The whole of §5 lives here, and NOTHING else assembles a prompt: `assemblePrompt(` appears in
// this file only, so the Sent tab and the Instruction's run() cannot drift apart (§8.1, KB-4).
//
// The shape of the thing:
//
//   bindInputs(doc, partId)      the PRE-RUN door — walks the document, so the transcript can
//                                show the prompt before anything has a value
//   bindArrivals({values,...})   the RUN door — the runner already walked the wires and hands
//                                over `inputs[port]` + `labels[port]` in the same order
//         both -> bindCore()     the nine rules, once
//   assemblePrompt(params, …)    §5.3's exact body + §5.4's budget
//   planFor({part, bind, …})     everything the part will send, assembled once and read twice
//
// Why characters and not tokens: the assembly is TEXT. A character count is exact where a token
// count is a guess, §5.4's own cut marker counts characters, and `ctx/budget.mjs` does the one
// piece of arithmetic that turns a farm's advertised window into a character budget.

import { partById, wiresInto } from './model.mjs';
import { isValue, itemsOf } from './values.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/parts.en.mjs';

/** @typedef {import('../core/types.mjs').GraphDoc} GraphDoc */
/** @typedef {import('../core/types.mjs').GraphValue} GraphValue */
/** @typedef {import('../core/types.mjs').BoundParam} BoundParam */
/** @typedef {import('../core/types.mjs').BindResult} BindResult */
/** @typedef {import('../core/types.mjs').AssembledPrompt} AssembledPrompt */
/** @typedef {import('../core/types.mjs').InstructionPlan} InstructionPlan */

/** The system message, verbatim from §5.3. A 12B local model follows STRUCTURE far more reliably
 * than instructions about structure, so this says as little as possible and the USER message does
 * the work. Frozen: changing it changes every answer the Computer has ever given. */
export const SYSTEM = t('parts.insSystem');

/** §5.3: an empty instruction with at least one input is not an error — it is this sentence. */
export const FALLBACK = t('parts.insFallback');

/** The biggest label the UI will render whole (§5.1: longer is accepted, truncated in the UI ONLY
 * — the model always sees the reader's own spelling in full). */
export const LABEL_DISPLAY_MAX = 64;

/** §5.3's inline substitution only ever applies to a SHORT text value. Longer than this and the
 * value belongs under its own heading, where the reader can see how much it costs. */
export const INLINE_MAX = 200;

/** A `file` value carries a path, not bytes (§6.8: reading contents is async and belongs to the
 * part that wants them). When a producer HAS attached text, §5.3 says to fence it up to this. */
export const FILE_TEXT_MAX = 64 * 1024;

// ---------------------------------------------------------------------------------------------
// §5.1 — the two normalisations
// ---------------------------------------------------------------------------------------------

/** The MATCHING form of a label: casefolded, whitespace-collapsed. @param {any} label */
export function labelKey(label) {
  return String(label == null ? '' : label).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The DISPLAY form: whitespace-collapsed, the reader's own case. This is what becomes a `##`
 * heading, because the user's own spelling is what the model should see. @param {any} label */
export function labelName(label) {
  return String(label == null ? '' : label).trim().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------------------------
// §5.2 rules 5, 6, 9 — mention detection. Deterministic and free: no model call, ever.
// ---------------------------------------------------------------------------------------------

/** Is `key` a word-boundary phrase inside `instruction`, or written `{key}` / `$key`?
 * @param {string} instruction @param {string} key @returns {boolean} */
export function mentions(instruction, key) {
  return mentionAt(instruction, key) >= 0;
}

/** Where `key` is first mentioned, or -1. The INDEX is what rule 9 orders by.
 * @param {string} instruction @param {string} key @returns {number} */
export function mentionAt(instruction, key) {
  const hay = String(instruction || '');
  const needle = labelKey(key);
  if (!needle || !hay) return -1;
  let best = -1;
  for (const form of formsOf(needle)) {
    const re = new RegExp(form.source, 'gi');
    for (let m = re.exec(hay); m; m = re.exec(hay)) {
      // A braced form carries its own boundary; only a bare phrase has to prove it is not inside
      // a longer word — "research" is not mentioned by "researcher".
      if (!form.braced && !isPhrase(hay, m.index, m[0].length)) continue;
      if (best < 0 || m.index < best) best = m.index;
      break;
    }
  }
  return best;
}

/** The three ways a reader can name a parameter, longest first so `{x}` wins over `x` at the same
 * index. `braced` marks the two EXPLICIT forms: §5.3 replaces those by the bare word even when
 * inline substitution is off, because braces read to a model as an unsubstituted template and
 * invite it to echo them.
 *
 * Each is a case-insensitive PATTERN rather than a string, for two reasons: matching is
 * whitespace-collapsed (§5.1 — `societal  research` across a line break still names the parameter
 * `societal research`), and matching the ORIGINAL text rather than a casefolded copy keeps every
 * index exactly where `rewrite` needs it.
 * @param {string} key @returns {{source: string, braced: boolean}[]} */
function formsOf(key) {
  const core = key.split(' ').map(escapeRe).join('\\s+');
  return [
    { source: `\\{${core}\\}`, braced: true },
    { source: `\\$${core}`, braced: true },
    { source: core, braced: false },
  ];
}

/** @param {string} s @returns {string} */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Neither neighbour may be a letter or a digit.
 * @param {string} hay @param {number} at @param {number} len @returns {boolean} */
function isPhrase(hay, at, len) {
  const word = /[\p{L}\p{N}]/u;
  const before = at > 0 ? hay[at - 1] : '';
  const after = at + len < hay.length ? hay[at + len] : '';
  return !(before && word.test(before)) && !(after && word.test(after));
}

// ---------------------------------------------------------------------------------------------
// §5.2 — binding. Two doors into ONE core, so the transcript and the run can never disagree.
// ---------------------------------------------------------------------------------------------

/**
 * Bind from the DOCUMENT — the pre-run door (§8.1: the Sent tab works before anything has run).
 * An upstream part with no value yet becomes a `pending` parameter, which renders as
 * `⟨topic — has not run yet⟩` and is exactly what the real value will replace.
 *
 * `specs` is accepted for signature symmetry with the rest of the engine and is not read: labels,
 * not ports, do the distinguishing here (rule 7), so every wire INTO the part is an arrival.
 * @param {GraphDoc} doc @param {string} partId
 * @param {{specs?: Map<string, any>, instruction?: string}} [o] @returns {BindResult}
 */
export function bindInputs(doc, partId, o) {
  const part = doc ? partById(doc, partId) : null;
  if (!part) return { params: [], unused: [], unwired: [] };
  const instruction = (o && typeof o.instruction === 'string')
    ? o.instruction
    : String((part.settings && /** @type {any} */ (part.settings).instruction) || '');
  const byPort = wiresInto(doc, partId);
  /** @type {{value: GraphValue|null, label: string, from: string}[]} */ const arrivals = [];
  for (const port of Object.keys(byPort)) {
    for (const wire of byPort[port]) {
      const up = partById(doc, wire.from);
      arrivals.push({
        value: up && isValue(up.value) ? up.value : null,
        label: typeof wire.label === 'string' ? wire.label : '',
        from: wire.from,
      });
    }
  }
  // `prerun` marks this as the DOCUMENT door, which is the only one that may still be looking at a
  // list the runner is going to fan (see `fanOf`). The run door is handed one item at a time and
  // must never fan a second time.
  return bindCore(arrivals, instruction, true);
}

/**
 * Bind from a RUN — `input.inputs[port]` and `input.labels[port]`, in the same order.
 * @param {{values: GraphValue[], labels: string[], instruction: string}} o @returns {BindResult}
 */
export function bindArrivals(o) {
  const values = Array.isArray(o && o.values) ? o.values : [];
  const labels = Array.isArray(o && o.labels) ? o.labels : [];
  const arrivals = values.map((value, i) => ({
    value: isValue(value) ? value : null,
    label: typeof labels[i] === 'string' ? labels[i] : '',
    from: '',
  }));
  return bindCore(arrivals, String((o && o.instruction) || ''));
}

/**
 * The nine rules, in one place.
 *   1. unlabelled  -> a positional `Input n`
 *   2. duplicates  -> ONE parameter whose values are a list, in wire order. Never last-wins.
 *   3. a duplicate is a JOIN, not a MAP: nothing here fans.
 *   4. an unmentioned label is still supplied, last, and reported in `unused`.
 *   5. a mentioned name with no arrow is reported in `unwired` and is not an error.
 *   8. a label that normalises to empty IS unlabelled.
 *   9. order = mentioned (by first mention) · unmentioned (wire order) · unlabelled (wire order).
 * @param {{value: GraphValue|null, label: string, from: string}[]} arrivals
 * @param {string} instruction @param {boolean} [prerun] @returns {BindResult}
 */
function bindCore(arrivals, instruction, prerun) {
  /** @type {Map<string, BoundParam>} */ const named = new Map();
  /** @type {BoundParam[]} */ const positional = [];

  for (const a of arrivals) {
    const key = labelKey(a.label);
    if (!key) {                                            // rules 1 + 8
      positional.push({
        name: '', key: '', mentioned: false, unlabelled: true,
        values: a.value ? [a.value] : [], pending: !a.value, from: [a.from],
      });
      continue;
    }
    const existing = named.get(key);                       // rule 2 — a JOIN, in wire order
    if (existing) {
      if (a.value) existing.values.push(a.value);
      else existing.pending = true;
      existing.from.push(a.from);
      continue;
    }
    named.set(key, {
      name: labelName(a.label), key,
      mentioned: mentions(instruction, key), unlabelled: false,
      values: a.value ? [a.value] : [], pending: !a.value, from: [a.from],
    });
  }

  const all = [...named.values()];
  const mentioned = all.filter((p) => p.mentioned)         // rule 9a — by FIRST mention
    .sort((x, y) => mentionAt(instruction, x.key) - mentionAt(instruction, y.key));
  const rest = all.filter((p) => !p.mentioned);            // rule 9b — wire order
  positional.forEach((p, i) => { p.name = t('parts.insPositional', { n: i + 1 }); });

  return {
    params: [...mentioned, ...rest, ...positional],        // rule 9c — unlabelled last
    unused: rest.map((p) => p.name),                       // rule 4 — a chip, not an error
    unwired: unwiredNames(instruction, new Set(all.map((p) => p.key))),  // rule 5
    prerun: prerun === true,
  };
}

// ---------------------------------------------------------------------------------------------
// §4.7 — the fan the RUNNER would plan, seen from the pre-run door
// ---------------------------------------------------------------------------------------------

/**
 * Which arrival the runner is going to fan, and how many times this box will therefore run.
 *
 * The Instruction's port takes every kind but `list` (parts/instruction.mjs), so a `list` arriving
 * there means `accepts()` answers `'fanout'` and `fanout.mjs`'s `planFan` runs the part ONCE PER
 * ITEM with that arrival replaced by the item. Before this existed (fix pass, finding 2) the Sent
 * tab and the box's own strip showed the whole list under one heading — a prompt that would never
 * be sent, on the one multi-generation path K2 went out of its way to keep. §8.1's promise is
 * "what you read is what will be sent", so what is read is now generation 1, and it says so.
 *
 * Only a SINGLE list fans: two is `planFan`'s `refuse` and the runner reports it, so there is no
 * generation 1 to show; an empty list runs zero times and there is no item to substitute. Both
 * answer null, and the prompt is shown exactly as assembled from what is really there.
 * @param {BoundParam[]} params @returns {{param: number, at: number, n: number}|null}
 */
export function fanOf(params) {
  /** @type {{param: number, at: number, n: number}|null} */ let found = null;
  let lists = 0;
  const all = Array.isArray(params) ? params : [];
  for (let pi = 0; pi < all.length; pi++) {
    const values = (all[pi] && all[pi].values) || [];
    for (let at = 0; at < values.length; at++) {
      const v = /** @type {any} */ (values[at]);
      if (!v || v.kind !== 'list') continue;
      lists += 1;
      if (!found) found = { param: pi, at, n: itemsOf(v).length };
    }
  }
  return lists === 1 && found && found.n > 0 ? found : null;
}

/** The same parameters, with the fanning list replaced by item `i` — exactly the substitution
 * `planFan(...).inputsFor(i)` makes at run time, so the preview assembles the run's own bytes.
 * @param {BoundParam[]} params @param {{param: number, at: number}} fan @param {number} i */
function forItem(params, fan, i) {
  return params.map((p, pi) => (pi !== fan.param ? p : /** @type {any} */ ({
    ...p,
    values: p.values.map((v, at) => (at === fan.at ? itemsOf(/** @type {any} */ (v))[i] : v)),
  })));
}

/** Names the instruction writes as `{name}` or `$name` that no arrow supplies. A bare phrase
 * cannot be told from prose, so only the two explicit forms are detected — a reader who wants the
 * warning has a way to ask for it, and nobody gets a warning for writing an English sentence.
 * @param {string} instruction @param {Set<string>} bound @returns {string[]} */
function unwiredNames(instruction, bound) {
  /** @type {string[]} */ const out = [];
  const re = /\{([^{}\n]{1,64})\}|\$([\p{L}\p{N}_-]{1,64})/gu;
  for (const m of String(instruction || '').matchAll(re)) {
    const raw = m[1] !== undefined ? m[1] : m[2];
    const key = labelKey(raw);
    if (!key || bound.has(key) || out.indexOf(labelName(raw)) >= 0) continue;
    out.push(labelName(raw));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// §5.3 — the prompt, exactly as it goes on the wire
// ---------------------------------------------------------------------------------------------

/**
 * @param {BoundParam[]|BindResult} params the bound parameters (a BindResult is accepted too)
 * @param {string} instruction
 * @param {{budget?: number, inline?: boolean}} [o] `budget` in CHARACTERS (ctx/budget.mjs
 *   `budgetFor(caps).chars`); `inline` is §5.3's opt-in substitution, default off.
 * @returns {AssembledPrompt}
 */
export function assemblePrompt(params, instruction, o) {
  const list = Array.isArray(params) ? params : ((params && params.params) || []);
  const opts = o || {};
  const inline = opts.inline === true;
  const budget = typeof opts.budget === 'number' && Number.isFinite(opts.budget) && opts.budget > 0
    ? Math.floor(opts.budget) : 0;

  // 1. The instruction as the model will read it: `{topic}` and `$topic` become the bare word, and
  //    — when inline substitution is on — a short text value takes the place of its own name.
  const inlined = inline ? new Set(list.filter(canInline).map((p) => p.key)) : new Set();
  const text = rewrite(String(instruction || '').trim(), list, inlined);

  // 2. One block per parameter that is still supplied under `# Inputs`. An inlined one is NOT
  //    repeated here (§5.3) — that is the whole point of substituting it in place.
  //
  //    Each block REMEMBERS the parameter it was built from. The transcript's Sent tab reads these
  //    blocks (fix pass, finding 1): it used to re-derive the cards by scanning the assembled
  //    prompt for `## ` lines, which invented a card out of every `##` heading a reader had typed
  //    inside their own markdown note, and shifted every tint and flag after it by one. The
  //    "nothing paraphrased" promise is kept by showing each block's EXACT body — it never
  //    required re-parsing the concatenation.
  /** @type {string[]} */ const images = [];
  /** @type {{heading: string, body: string, name: string, param: BoundParam}[]} */ const blocks = [];
  for (const p of list) {
    for (const url of imagesOf(p)) images.push(url);
    if (p.key && inlined.has(p.key)) continue;
    blocks.push({ heading: headingFor(p), body: bodyFor(p), name: nameFor(p), param: p });
  }

  const tail = text || (blocks.length || images.length ? FALLBACK : '');
  const join = () => assemble(blocks, tail);
  const was = join();
  let prompt = was;

  // 3. §5.4 — the budget. Middle-out per input, proportional to size, longest first, each cut
  //    marked inline, and the HEADING always survives so the model is told the input existed.
  //    Never a silently dropped input.
  let truncated = null;
  if (budget > 0 && prompt.length > budget) {
    const params = trim(blocks, prompt.length, budget);
    prompt = join();
    // `cut` is MEASURED — the prompt as it was minus the prompt as it is (fix pass, finding 3).
    // It used to be the sum of the omissions the cutter intended, which over-counted by the
    // length of every marker it wrote and, when a cut could not shrink its block, was simply
    // false. The badge prints this number as fact, so it has to be one.
    const cut = was.length - prompt.length;
    truncated = cut > 0 ? { cut, of: was.length, params } : null;
  }

  return {
    system: SYSTEM,
    prompt,
    images,
    words: prompt ? prompt.split(/\s+/).filter(Boolean).length : 0,
    truncated,
    blocks: blocks.map((b) => ({ name: b.name, heading: b.heading, body: b.body, param: b.param })),
    instruction: tail,
  };
}

/** `# Inputs` … then `# Instruction`, which is ALWAYS last: recency is the strongest lever on a
 * small model. @param {{heading: string, body: string}[]} blocks @param {string} tail */
function assemble(blocks, tail) {
  const head = blocks.length
    ? `${t('parts.insInputsHeading')}\n\n${blocks.map((b) => `${b.heading}\n${b.body}`).join('\n\n')}`
    : '';
  return [head, tail ? `${t('parts.insInstructionHeading')}\n${tail}` : ''].filter(Boolean).join('\n\n');
}

/** Can this parameter be substituted in place? §5.3: only a MENTIONED label (there is nowhere else
 * to put it), carrying exactly one short text value. @param {BoundParam} p @returns {boolean} */
function canInline(p) {
  if (!p.key || !p.mentioned || p.pending || p.values.length !== 1) return false;
  const v = /** @type {any} */ (p.values[0]);
  return !!v && v.kind === 'text' && String(v.data == null ? '' : v.data).length <= INLINE_MAX;
}

/**
 * Rewrite the instruction: every `{name}` / `$name` of a BOUND parameter becomes the bare word,
 * and every mention of an inlined parameter becomes its value. A name the arrows do not supply
 * keeps its braces — it is reported as `— not wired`, and silently un-bracing it would hide that.
 * @param {string} text @param {BoundParam[]} list @param {Set<string>} inlined @returns {string}
 */
function rewrite(text, list, inlined) {
  const targets = list.filter((p) => p.key).map((p) => ({
    name: p.name,
    value: inlined.has(p.key) ? String(/** @type {any} */ (p.values[0]).data ?? '') : null,
    // Sticky, so each form can be tried AT one offset and nowhere else: the scan owns the walk.
    forms: formsOf(p.key).map((f) => ({ re: new RegExp(f.source, 'iy'), braced: f.braced })),
  }));
  if (!targets.length || !text) return text;

  let out = '';
  let i = 0;
  while (i < text.length) {
    /** @type {{len: number, to: string}|null} */ let hit = null;
    for (const tgt of targets) {
      for (const form of tgt.forms) {
        form.re.lastIndex = i;
        const m = form.re.exec(text);
        if (!m) continue;
        if (!form.braced && !isPhrase(text, i, m[0].length)) continue;
        // A bare phrase with nothing to substitute is left exactly as the reader wrote it.
        const to = tgt.value !== null ? tgt.value : (form.braced ? tgt.name : null);
        if (to === null) continue;
        if (!hit || m[0].length > hit.len) hit = { len: m[0].length, to };
      }
    }
    if (hit) { out += hit.to; i += hit.len; } else { out += text[i]; i += 1; }
  }
  return out;
}

/** The heading TEXT: the reader's own spelling, or `<name> (image, attached)` — an image is NEVER
 * in the text (§5.3). This is what a transcript card is titled with. @param {BoundParam} p */
function nameFor(p) {
  const name = p.name || t('parts.insPositional', { n: 1 });
  return imagesOf(p).length ? t('parts.insImageHeading', { name }) : name;
}

/** `## <name>` — the line itself. @param {BoundParam} p @returns {string} */
function headingFor(p) {
  return `## ${nameFor(p)}`;
}

/** The data URLs this parameter carries, in wire order. @param {BoundParam} p @returns {string[]} */
function imagesOf(p) {
  return p.values
    .filter((v) => v && /** @type {any} */ (v).kind === 'image')
    .map((v) => String((/** @type {any} */ (v).data && /** @type {any} */ (v).data.dataUrl) || ''))
    .filter(Boolean);
}

/** The body under one heading. Several values under one label are numbered `### 1`, `### 2` — the
 * JOIN of rule 2, never a dropped report. @param {BoundParam} p @returns {string} */
function bodyFor(p) {
  if (p.pending && !p.values.length) return t('parts.insPending', { name: p.name });
  const rendered = p.values
    .filter((v) => !(v && /** @type {any} */ (v).kind === 'image'))
    .map(renderValue);
  if (!rendered.length) return '';                 // an image-only parameter: the bytes ride along
  // §5.3: an EMPTY value still gets its heading, with `*(empty)*` beneath. Never omitted.
  if (rendered.length === 1) return rendered[0] || t('parts.insEmpty');
  return rendered.map((body, i) => `### ${i + 1}\n${body || t('parts.insEmpty')}`).join('\n\n');
}

/** One value as prompt text, by kind and — advisory (§6.8) — by `format`. The table is §5.3's.
 * @param {GraphValue} v @returns {string} */
function renderValue(v) {
  const value = /** @type {any} */ (v);
  const kind = value && value.kind;
  if (kind === 'image') return '';                 // never in the text; the bytes ride `images`
  if (kind === 'list') return itemsOf(value).map(bullet).join('\n');
  if (kind === 'json') return fence('json', stringify(value.data));
  if (kind === 'file') return fileText(value.data);
  const text = String(value && value.data == null ? '' : value.data);
  const format = value && value.format;
  if (format === 'code') return fence(String(value.lang || ''), text);
  if (format === 'svg' || format === 'html' || format === 'css' || format === 'js') return fence(format, text);
  return text;                                     // plain and markdown go in VERBATIM
}

/** One `-` bullet per item; a multi-line item keeps its bullet readable by indenting the rest.
 * @param {GraphValue} item @returns {string} */
function bullet(item) {
  const body = renderValue(item);
  return `- ${body.split('\n').join('\n  ')}`;
}

/** §5.3: a file is its PATH, plus its contents in a fence when text-like and under 64 KB. A `file`
 * value carries `{path, project, size}` — reading bytes is async and belongs to the part that
 * wants them (§6.8) — so the fence appears only when a producer already attached the text.
 * @param {any} data @returns {string} */
function fileText(data) {
  const path = String((data && data.path) || '');
  const text = data && typeof data.text === 'string' ? data.text : '';
  if (!text || text.length > FILE_TEXT_MAX) return path;
  return `${path}\n${fence(extOf(path), text)}`;
}

/** The fence tag for a path: its extension, lowercased, or nothing. @param {string} path */
function extOf(path) {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

/** @param {string} lang @param {string} body @returns {string} */
function fence(lang, body) {
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

/** @param {any} data @returns {string} */
function stringify(data) {
  try {
    const s = JSON.stringify(data, null, 2);
    return s === undefined ? String(data) : s;
  } catch { return String(data); }
}

// ---------------------------------------------------------------------------------------------
// §5.4 — the size budget
// ---------------------------------------------------------------------------------------------

/**
 * Cut the parameter BODIES down until the assembled prompt fits, and say exactly what was cut.
 *
 * Proportional, longest first: every body over-budget loses the same FRACTION of itself, so one
 * enormous report is not paid for by six short ones, and the rounding remainder goes to the
 * longest bodies. Each cut is middle-out — the opening and the closing of a document are where a
 * model finds its subject and its conclusion — and marked inline with the number of characters
 * removed. The heading always survives, so the model is told the input existed.
 *
 * A CUT MUST SHRINK (fix pass, finding 3). The marked-up form of a body is `head + marker + foot`,
 * and the marker costs ~25 characters however short the body was — so cutting a ten-character note
 * used to make it 25 characters long, and a prompt of many small inputs came back from `trim()`
 * LONGER than it went in and still three times over budget. A block's floor is therefore
 * `min(bodyLength, markerLength)`: a body no longer than its own marker is left exactly as the
 * reader wrote it, and the allowance it did not need is handed back to the blocks that can really
 * use it (water-filling, longest-first on the remainder). The consequence is arithmetic rather
 * than hope: every block ends at or under its allowance, the allowances sum to the room the
 * headings and the instruction left, and so the re-assembled prompt fits — unless the floors alone
 * do not fit, which only happens when the headings themselves exceed the budget, and which the
 * caller reports honestly by measuring rather than by claiming.
 *
 * Mutates `blocks[i].body` in place; the caller re-assembles and measures.
 * @param {{heading: string, body: string, name: string}[]} blocks
 * @param {number} was the assembled length before cutting
 * @param {number} budget in characters
 * @returns {{name: string, omitted: number}[]}
 */
function trim(blocks, was, budget) {
  const lens = blocks.map((b) => b.body.length);
  const body = lens.reduce((n, l) => n + l, 0);
  const fixed = was - body;                        // headings, the instruction, the separators
  const target = Math.max(0, budget - fixed);
  // The marker that names the WHOLE body is the longest one this block can ever write, so a block
  // reserving that much can never over-spend, and a block whose body is shorter than it cannot be
  // improved by cutting at all.
  const reserve = lens.map((len) => t('parts.insOmitted', { n: len }).length);
  const floor = lens.map((len, i) => Math.min(len, reserve[i]));

  // Water-filling: share `target` in proportion to size, but never below a block's floor and never
  // above its length. Each pass fixes the blocks whose proportional share is outside those bounds
  // and re-shares what is left among the rest, so at most one block is fixed per pass.
  /** @type {(number|null)[]} */ const keep = lens.map(() => null);
  let pool = target;
  let free = lens.map((len, i) => i);
  while (free.length) {
    const total = free.reduce((n, i) => n + lens[i], 0);
    let fixedOne = -1;
    for (const i of free) {
      const share = total > 0 ? Math.floor((pool * lens[i]) / total) : 0;
      if (share >= lens[i]) { keep[i] = lens[i]; fixedOne = i; break; }
      if (share <= floor[i]) { keep[i] = floor[i]; fixedOne = i; break; }
    }
    if (fixedOne >= 0) {
      pool -= /** @type {number} */ (keep[fixedOne]);
      free = free.filter((i) => i !== fixedOne);
      continue;
    }
    // Everything left is strictly between its floor and its length: share it out, and give the
    // rounding remainder to the longest bodies — "longest first" decides the odd character.
    for (const i of free) keep[i] = Math.floor((pool * lens[i]) / total);
    let spare = pool - free.reduce((n, i) => n + /** @type {number} */ (keep[i]), 0);
    for (const i of free.slice().sort((a, b) => lens[b] - lens[a])) {
      if (spare <= 0) break;
      const room = Math.min(spare, lens[i] - /** @type {number} */ (keep[i]));
      if (room > 0) { keep[i] = /** @type {number} */ (keep[i]) + room; spare -= room; }
    }
    break;
  }

  /** @type {{name: string, omitted: number}[]} */ const params = [];
  for (let i = 0; i < blocks.length; i++) {
    const allow = /** @type {number} */ (keep[i]);
    if (allow >= lens[i]) continue;                // nothing to gain: this body stays whole
    const room = Math.max(0, allow - reserve[i]);  // head + foot, middle-out
    const head = Math.ceil(room / 2);
    const foot = room - head;
    const omitted = lens[i] - room;
    const text = blocks[i].body;
    blocks[i].body = text.slice(0, head)
      + t('parts.insOmitted', { n: omitted })
      + (foot > 0 ? text.slice(text.length - foot) : '');
    params.push({ name: blocks[i].name, omitted });
  }
  return params;
}

// ---------------------------------------------------------------------------------------------
// The ONE assembly, read twice (§8.1) — by the Instruction's run() and by the transcript drawer.
// This is what makes "what you read is what will be sent" true rather than merely claimed.
// ---------------------------------------------------------------------------------------------

/**
 * @param {{part: any, bind: BindResult,
 *   budget?: {chars: number, tokens: number, assumed: boolean}}} o
 * @returns {InstructionPlan}
 */
export function planFor(o) {
  const part = (o && o.part) || null;
  const settings = (part && part.settings) || {};
  const bind = (o && o.bind) || { params: [], unused: [], unwired: [] };
  const budget = (o && o.budget) || { chars: 0, tokens: 0, assumed: true };
  const instruction = String(settings.instruction || '').trim();
  const fallback = !instruction && bind.params.length > 0;
  const shape = ['text', 'list', 'json'].indexOf(String(settings.shape)) >= 0
    ? String(settings.shape) : 'text';
  // §4.7: from the pre-run door a list still standing at the port is N generations, not one big
  // input. Assemble what generation 1 will really send, and hand the count up so the strip and the
  // Sent tab can say `runs 3 times` instead of showing a prompt nobody will receive.
  const fan = bind.prerun ? fanOf(bind.params) : null;
  const params = fan ? forItem(bind.params, fan, 0) : bind.params;
  const assembled = assemblePrompt(params, instruction, {
    budget: budget.chars,
    inline: settings.inlineVars === true,
  });
  return {
    bind,
    fan: fan ? { n: fan.n, index: 0 } : null,
    assembled,
    instruction,
    fallback,
    budget,
    call: {
      model: String(settings.model || '') || null,
      shape: /** @type {any} */ (shape),
      schema: shape === 'json' ? String(settings.schema || '') : null,
      maxTokens: null,                             // the ask spine decides (§3.4.1)
      priority: 'background',                      // a human typing always takes the seat first
      task: 'graph:ask',
    },
    // No inputs AND no instruction is the one case that is genuinely an error (§5.3).
    error: (!instruction && !bind.params.length) ? 'no-instruction' : null,
  };
}
