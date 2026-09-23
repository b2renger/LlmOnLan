// @ts-check
// The transcript drawer — "what gets sent" (COMPUTER_PLAN §8.1, §11 K2-U3).
//
// A node graph that hides what it sent to the model teaches nothing. This panel is the whole of
// the answer: three tabs on one thinking part, mounted INTO K1-U3's drawer through its
// `mountPanel(name, node)` door, so the frame, the grip, the remembered width and Escape stay in
// exactly one file and this one only owns what is inside the panel.
//
//   Sent   the assembled prompt EXACTLY as it goes on the wire — the system message, one tinted
//          card per named parameter in the wire's kind colour, the instruction last in the accent
//          colour, then the declared call. It works BEFORE a run: an input that has not produced a
//          value yet renders as `⟨topic — has not run yet⟩`, which is precisely the text that will
//          be replaced by the real value. Reading your prompt, fixing it and reading it again is
//          free, and that single behaviour is worth more to a learner than any explanation.
//   Got    the raw reply, verbatim, plus the repair ladder when a shape was requested.
//   Cost   `3.4 s · 612 tokens · not cached · farm: Studio Farm`, or the refusal in the same plain
//          sentence the box shows.
//
// THE IDENTITY THAT MAKES §8.1 TRUE (§2.6 KB-4). `planFor(partId)` is one call into `graph/bind.mjs`
// — `planFor({part, bind: bindInputs(doc, partId), budget: budgetFor(caps)})` — and it is the SAME
// assembly the Instruction's `run()` uses. Nothing here re-renders a value, re-orders a parameter or
// re-words a heading: the Sent tab SPLITS the assembled prompt at its own headings rather than
// rebuilding it, so a card can never drift from the bytes. `assemblePrompt(` appears in bind.mjs and
// nowhere else, on purpose, and a reviewer can check that by grepping.
//
// Feature contract (computer/main.mjs's loader, `transcript` row, AFTER `drawer`):
//   install(app) -> void, publishing app.transcript = {open, close, isOpen, tab, part, planFor,
//                                                      record, results, el}
// `computer/host.mjs`'s `debug.preview(partId)` resolves `planFor` at CALL time, so neither module
// imports the other.

import { t } from '../core/i18n.mjs';
import { bindInputs, planFor as planFrom } from '../graph/bind.mjs';
import { budgetFor } from '../ctx/budget.mjs';
import { partById } from '../graph/model.mjs';
import { bodyText } from '../graph/inspect.mjs';
import '../strings/computer.en.mjs';
import '../strings/parts.en.mjs';

/** The name this panel is mounted under in the drawer. Frozen (§2.6 KB-3). */
export const PANEL = 'transcript';

/** The three tabs, in the order §8.1 lists them. Frozen (§2.6 KB-3). */
export const TABS = Object.freeze(['sent', 'got', 'cost']);

/** Which part types have a transcript. The Instruction keeps the type id `ask` (§6.3), so this is
 * one entry today and the place a later thinking part adds itself. */
export const THINK_TYPES = Object.freeze(['ask']);

/** How much of a raw reply the Got tab shows before it says how much is left. The inspector's own
 * cap does the same job for a value; this is the same number for the same reason (a 2 MB reply
 * must not freeze the drawer). */
export const RAW_CAP = 40000;

// ---------------------------------------------------------------------------------------------
// PURE — everything the unit test drives without a DOM. The renderers below only place these.
// ---------------------------------------------------------------------------------------------

/**
 * Split an assembled prompt back into its parts, at ITS OWN headings.
 *
 * This is deliberately a read of the bytes rather than a second rendering: the Sent tab promises
 * "nothing paraphrased", and the only way to keep that promise is to show what `assemblePrompt()`
 * produced, cut where it put its headings. Fences are honoured because a wired code value is
 * fenced (§5.3) and a `#` inside it is Python, not structure — the same rule the `mock-headings`
 * model uses when it reports headings back (§2.6 KB-7).
 *
 * @param {string} prompt the assembled USER message
 * @returns {{cards: {name: string, body: string}[], instruction: string}}
 */
export function splitAssembled(prompt) {
  const INPUTS = t('parts.insInputsHeading');
  const INSTR = t('parts.insInstructionHeading');
  /** @type {{name: string, body: string}[]} */ const cards = [];
  /** @type {string[]} */ let buf = [];
  /** @type {'head'|'card'|'instruction'} */ let mode = 'head';
  let instruction = '';
  let fence = '';

  const flush = () => {
    const body = trimBlank(buf).join('\n');
    if (mode === 'card' && cards.length) cards[cards.length - 1].body = body;
    else if (mode === 'instruction') instruction = body;
    buf = [];
  };

  for (const line of String(prompt || '').split('\n')) {
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open) {
      const mark = open[1][0];
      if (!fence) fence = mark;
      else if (fence === mark) fence = '';
      buf.push(line);
      continue;
    }
    if (fence) { buf.push(line); continue; }
    if (line === INSTR) { flush(); mode = 'instruction'; continue; }
    if (line === INPUTS) { flush(); mode = 'head'; continue; }
    const head = /^##\s+(.*)$/.exec(line);
    if (head) { flush(); cards.push({ name: head[1], body: '' }); mode = 'card'; continue; }
    buf.push(line);
  }
  flush();
  return { cards, instruction };
}

/** @param {string[]} lines @returns {string[]} */
function trimBlank(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

/**
 * What the Sent tab shows, as data. The cards come from the PROMPT (above); the tint, the pending
 * flag and the mentioned flag come from the bound parameter at the same index — `assemblePrompt()`
 * emits one block per parameter, in order, so index IS the pairing. A parameter with no card (a
 * value substituted inline, §5.3) simply has no card to tint, and a card with no parameter is
 * still shown, untinted: neither is worth losing text over.
 *
 * @param {any} plan an InstructionPlan (core/types.mjs), or null
 * @returns {{system: string, cards: {name: string, body: string, kind: string, pending: boolean,
 *   mentioned: boolean, unlabelled: boolean}[], instruction: string, fallback: boolean,
 *   call: string, words: number, images: number, unused: string[], unwired: string[],
 *   truncated: string}|null}
 */
export function sentView(plan) {
  if (!plan || !plan.assembled) return null;
  const split = splitAssembled(plan.assembled.prompt);
  const params = (plan.bind && plan.bind.params) || [];
  const cards = split.cards.map((c, i) => {
    const p = params[i] || null;
    return {
      name: c.name,
      body: c.body,
      kind: kindOf(p),
      pending: !!(p && p.pending && !(p.values && p.values.length)),
      mentioned: !!(p && p.mentioned),
      unlabelled: !!(p && p.unlabelled),
    };
  });
  return {
    system: String(plan.assembled.system || ''),
    cards,
    instruction: split.instruction,
    fallback: !!plan.fallback,
    call: callLine(plan.call),
    words: Number(plan.assembled.words) || 0,
    images: ((plan.assembled.images) || []).length,
    unused: ((plan.bind && plan.bind.unused) || []).slice(),
    unwired: ((plan.bind && plan.bind.unwired) || []).slice(),
    truncated: truncatedLine(plan),
  };
}

/** The kind slot a card is tinted with (§9's five `--comp-kind-*` names). An image parameter is
 * never in the text, so it is the kind of the HEADING rather than of a body.
 * @param {any} p a BoundParam, or null @returns {string} */
function kindOf(p) {
  const values = (p && p.values) || [];
  if (values.some((/** @type {any} */ v) => v && v.kind === 'image')) return 'image';
  const first = values.find((/** @type {any} */ v) => v && v.kind);
  if (!first) return 'text';
  if (first.kind === 'list') return 'list';
  if (first.kind === 'json') return 'code';
  if (first.kind === 'text' && (first.format === 'code' || first.format === 'svg'
    || first.format === 'html' || first.format === 'css' || first.format === 'js')) return 'code';
  return 'text';
}

/** `model: gemma4:12b · response_format: json_schema · max_tokens: 2048 · priority: background`
 * — the DECLARED request (§8.1). `maxTokens: null` means the ask spine decides, which is a fact
 * about the call and is said as one rather than printed as `null`.
 * @param {any} call @returns {string} */
export function callLine(call) {
  const c = call || {};
  const auto = t('computer.txParamsAuto');
  return t('computer.txParams', {
    model: c.model || auto,
    format: c.shape === 'json' ? 'json_schema' : (c.shape || 'text'),
    maxTokens: c.maxTokens == null ? auto : String(c.maxTokens),
    priority: c.priority || 'background',
  });
}

/** The truncation badge, in the numbers §5.4 requires — and saying `assumed` when the farm never
 * advertised a window, so the sentence never quotes a number the farm did not say.
 * @param {any} plan @returns {string} */
export function truncatedLine(plan) {
  const cut = plan && plan.assembled && plan.assembled.truncated;
  if (!cut) return '';
  const tokens = (plan.budget && plan.budget.tokens) || 0;
  const vars = { cut: Number(cut.cut) || 0, of: Number(cut.of) || 0, tokens };
  return plan.budget && plan.budget.assumed
    ? t('parts.insTruncatedAssumed', vars)
    : t('parts.insTruncated', vars);
}

/**
 * The repair ladder (§8.1): `asked with schema → model returned prose with a fenced object →
 * extracted → validated ✓`. It is only shown when a SHAPE was asked for — a text answer has
 * nothing to repair — and every rung is read off the recorded `AskResult`, never guessed:
 *
 *   mode      which lane of the ask spine answered ('schema' | 'prompt' | 'text', §3.4.2)
 *   raw       the reply verbatim; JSON that did not start as JSON was extracted from prose
 *   ok        whether `validate()` accepted it in the end
 *
 * @param {any} result an AskResult, or null
 * @param {{shape?: string}} [o] the shape the part ASKED for, when the result cannot say
 * @returns {{text: string, ok: boolean}[]}
 */
export function ladderFor(result, o) {
  const shape = String((o && o.shape) || '');
  const mode = result && result.mode ? String(result.mode) : '';
  const wanted = shape === 'json' || shape === 'list' || mode === 'schema' || mode === 'prompt';
  if (!result || !wanted) return [];
  /** @type {{text: string, ok: boolean}[]} */ const rungs = [
    { text: t('computer.txLadderSchema'), ok: true },
  ];
  const raw = String(result.raw || '');
  const head = raw.trim().slice(0, 1);
  const prose = !!raw.trim() && head !== '{' && head !== '[';
  if (prose) {
    rungs.push({ text: t('computer.txLadderProse'), ok: true });
    rungs.push({ text: t('computer.txLadderExtract'), ok: true });
  }
  rungs.push(result.ok
    ? { text: t('computer.txLadderValid'), ok: true }
    : { text: t('computer.txLadderFailed'), ok: false });
  return rungs;
}

/**
 * The cost line's fields (§8.1). `cached` is read off the run rather than asserted: the runner
 * meters a call only when one really left the window (`stats.calls`), so a part that produced a
 * value having made no call was answered from the ask spine's cache and cost the farm nothing.
 *
 * @param {{stats?: any, farm?: string, value?: any}} o
 * @returns {{seconds: number, tokens: number, cached: boolean, farm: string, line: string}|null}
 */
export function costView(o) {
  const stats = (o && o.stats) || null;
  if (!stats) return null;
  const seconds = Math.round((Number(stats.ms) || 0) / 100) / 10;
  const tokens = Number(stats.tokens) || 0;
  const cached = Number(stats.calls) === 0 && !!(o && o.value);
  const farm = String((o && o.farm) || '') || t('computer.txUnknownFarm');
  return {
    seconds,
    tokens,
    cached,
    farm,
    line: t('computer.txCostLine', {
      seconds,
      tokens,
      cached: cached ? t('computer.txCached') : t('computer.txNotCached'),
      farm,
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// The feature
// ---------------------------------------------------------------------------------------------

/** @param {string} cls @param {HTMLElement} [parent] @returns {HTMLElement} */
function div(cls, parent) {
  const el = document.createElement('div');
  el.className = cls;
  if (parent) parent.appendChild(el);
  return el;
}

/** A verbatim block: `pre` so every space the model saw survives the trip to the eye.
 * @param {string} text @param {HTMLElement} parent @param {string} [cls] @returns {HTMLElement} */
function pre(text, parent, cls) {
  const el = document.createElement('pre');
  el.className = cls || 'comp-tx-pre';
  el.textContent = String(text == null ? '' : text);
  parent.appendChild(el);
  return el;
}

/** @param {any} app */
export function install(app) {
  const node = div('comp-tx');

  const title = document.createElement('h3');
  title.className = 'comp-tx-title';
  title.textContent = t('computer.txTitle');

  const tabs = div('comp-tx-tabs');
  tabs.setAttribute('role', 'tablist');
  const body = div('comp-tx-body');
  node.append(title, tabs, body);

  /** @type {string} */ let tab = 'sent';
  /** @type {string} */ let openFor = '';
  /** The last raw reply per part, when something recorded one (see `record` below). */
  /** @type {Map<string, any>} */ const results = new Map();
  /** @type {Function|null} */ let offSession = null;

  // The tab labels as a same-file literal map: chat-lint rule 5 wants a literal at every `t()`
  // call site, and a computed key would also hide a missing string from its check.
  const TAB_LABEL = {
    sent: () => t('computer.txSent'),
    got: () => t('computer.txGot'),
    cost: () => t('computer.txCost'),
  };

  for (const name of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'comp-tx-tab';
    b.setAttribute('data-tab', name);
    b.setAttribute('role', 'tab');
    b.textContent = TAB_LABEL[name]();
    b.addEventListener('click', () => { tab = name; paint(); });
    tabs.appendChild(b);
  }

  /** The session, asked for at CALL time: the host installs before this feature, but a Computer
   * whose host failed to load must degrade to an empty panel rather than throw. */
  const session = () => {
    const host = app && app.host;
    return host && host.session ? host.session : null;
  };
  const doc = () => {
    const s = session();
    return s && typeof s.doc === 'function' ? s.doc() : null;
  };
  const caps = () => (app && app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null);

  /**
   * The plan for one part — THE assembly, shared with the Instruction's `run()` (§2.6 KB-4).
   * @param {string} partId @returns {any} an InstructionPlan, or null
   */
  function planFor(partId) {
    const d = doc();
    const part = d ? partById(d, partId) : null;
    if (!part || THINK_TYPES.indexOf(String(part.type)) < 0) return null;
    return planFrom({ part, bind: bindInputs(d, partId), budget: budgetFor(caps()) });
  }

  /** @param {string} partId @returns {any} */
  function partOf(partId) {
    const d = doc();
    return d && partId ? partById(d, partId) : null;
  }

  /** @returns {string} */
  function farmName() {
    const c = caps();
    return (c && (c.name || c.farmName)) || '';
  }

  // ---- painting ------------------------------------------------------------------------------

  function paint() {
    for (const b of Array.from(tabs.querySelectorAll('.comp-tx-tab'))) {
      const el = /** @type {any} */ (b);
      const on = el.getAttribute('data-tab') === tab;
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    body.replaceChildren();
    body.setAttribute('data-tab', tab);
    if (tab === 'sent') paintSent();
    else if (tab === 'got') paintGot();
    else paintCost();
  }

  function paintSent() {
    const plan = openFor ? planFor(openFor) : null;
    // §5.3's one genuine error: nothing wired in AND no instruction. There is no prompt to read,
    // so the tab says what is missing instead of showing a system message and a blank page.
    const view = plan && plan.error !== 'no-instruction' ? sentView(plan) : null;
    if (!view) { say(t('computer.txSentEmpty')); return; }

    const chips = div('comp-tx-chips', body);
    if (view.truncated) chip(chips, view.truncated, 'warn');
    for (const name of view.unwired) chip(chips, t('parts.insUnwired', { name }), 'warn');
    for (const name of view.unused) chip(chips, t('parts.insUnused', { name }), 'muted');
    if (!chips.childNodes.length) chips.remove();

    card(view.system, t('computer.txSystem'), 'system');
    for (const c of view.cards) {
      const el = card(c.body, c.name, 'param');
      el.setAttribute('data-kind', c.kind);
      if (c.pending) el.setAttribute('data-pending', 'true');
      if (c.mentioned) el.setAttribute('data-mentioned', 'true');
    }
    // §5.3: THE INSTRUCTION IS ALWAYS LAST, and it is the one card in the accent colour.
    if (view.instruction) card(view.instruction, t('computer.txInstruction'), 'instruction');
    pre(view.call, body, 'comp-tx-call');
  }

  function paintGot() {
    const part = partOf(openFor);
    const recorded = results.get(openFor) || null;
    const raw = recorded && typeof recorded.raw === 'string' && recorded.raw
      ? recorded.raw
      : (part && part.value ? bodyText(part.value) : '');
    if (!raw && !(part && part.error)) { say(t('computer.txGotEmpty')); return; }
    if (part && part.error) {
      const box = div('comp-tx-error', body);
      box.textContent = String(part.error);
    }
    if (raw) pre(raw.length > RAW_CAP ? raw.slice(0, RAW_CAP) : raw, body, 'comp-tx-raw');

    const plan = openFor ? planFor(openFor) : null;
    const shape = plan && plan.call ? String(plan.call.shape || '') : '';
    const rungs = ladderFor(recorded || (part && part.value ? { ok: !part.error, mode: '', raw } : null), { shape });
    if (!rungs.length) return;
    const ladder = document.createElement('ol');
    ladder.className = 'comp-tx-ladder';
    for (const rung of rungs) {
      const li = document.createElement('li');
      li.className = 'comp-tx-rung';
      li.setAttribute('data-ok', rung.ok ? 'true' : 'false');
      li.textContent = rung.text;
      ladder.appendChild(li);
    }
    body.appendChild(ladder);
  }

  function paintCost() {
    const part = partOf(openFor);
    const cost = costView({
      stats: part ? part.stats : null,
      farm: farmName(),
      value: part ? part.value : null,
    });
    if (!cost && !(part && part.error)) { say(t('computer.txCostEmpty')); return; }
    if (cost) pre(cost.line, body, 'comp-tx-cost');
    // §8.4: a refusal is said in the same plain sentence the box shows, never a code.
    if (part && part.error) {
      const box = div('comp-tx-error', body);
      box.textContent = String(part.error);
    }
  }

  /** One sentence, when there is nothing else to show. @param {string} text */
  function say(text) {
    const p = document.createElement('p');
    p.className = 'comp-tx-empty';
    p.textContent = text;
    body.appendChild(p);
  }

  /** @param {HTMLElement} row @param {string} text @param {string} tone */
  function chip(row, text, tone) {
    const el = document.createElement('span');
    el.className = 'comp-tx-chip';
    el.setAttribute('data-tone', tone);
    el.textContent = text;
    row.appendChild(el);
  }

  /** @param {string} text @param {string} heading @param {string} role @returns {HTMLElement} */
  function card(text, heading, role) {
    const el = div('comp-tx-card', body);
    el.setAttribute('data-role', role);
    const h = document.createElement('h4');
    h.className = 'comp-tx-card-head';
    h.textContent = heading;
    el.appendChild(h);
    pre(text, el, 'comp-tx-card-body');
    return el;
  }

  // ---- the door ------------------------------------------------------------------------------

  /** Repaint while the panel is up. A label renamed, a value that just arrived and an instruction
   * edited in place are all the same event to this panel: what WOULD be sent has changed. */
  function watch() {
    if (offSession) return;
    const s = session();
    if (!s || typeof s.on !== 'function') return;
    offSession = s.on(() => { if (api.isOpen()) paint(); });
  }

  const api = {
    /** @param {string} partId @param {string} [which] @returns {boolean} */
    open(partId, which) {
      const drawer = app && app.drawer;
      if (!drawer || typeof drawer.showPanel !== 'function') return false;
      openFor = String(partId || '');
      tab = TABS.indexOf(String(which)) >= 0 ? String(which) : 'sent';
      watch();
      paint();
      return drawer.showPanel(PANEL);
    },
    close() {
      const drawer = app && app.drawer;
      openFor = '';
      return drawer && typeof drawer.close === 'function' ? drawer.close() : false;
    },
    isOpen() {
      const drawer = app && app.drawer;
      return !!(drawer && typeof drawer.panel === 'function' && drawer.panel() === PANEL);
    },
    tab: () => tab,
    part: () => openFor,
    planFor,
    /**
     * Remember the RAW reply for a part, so Got can show it verbatim and the ladder can be read
     * rather than inferred. `graph/model.mjs`'s `patchPart` whitelists `state/value/error/stats/
     * fanout`, so an AskResult cannot live on the part — and it should not: it is a fact about the
     * last run in this window, not about the document. A part that never calls this still gets a
     * Got tab, rendered from its value.
     * @param {string} partId @param {any} result an AskResult @returns {boolean}
     */
    record(partId, result) {
      if (!partId || !result) return false;
      results.set(String(partId), result);
      if (api.isOpen() && String(partId) === openFor) paint();
      return true;
    },
    /** What has been recorded, by part id — for a scenario and for the value inspector. */
    results: () => Object.fromEntries(results),
    el: () => node,
  };

  // The collapsed strip on the box (§8.1) is rendered by the part, which is a different unit's
  // file; the door it clicks is here. Anything on the surface carrying `data-transcript="<partId>"`
  // opens this panel on that part — delegated, so a part that re-renders never loses its handle,
  // and passive, so nothing else on the canvas changes behaviour.
  const surface = app && app.els ? app.els.root : null;
  if (surface && typeof surface.addEventListener === 'function') {
    surface.addEventListener('click', (/** @type {any} */ e) => {
      const target = e && e.target;
      const hit = target && typeof target.closest === 'function' ? target.closest('[data-transcript]') : null;
      if (!hit) return;
      const id = hit.getAttribute('data-transcript');
      if (!id) return;
      api.open(id, hit.getAttribute('data-transcript-tab') || undefined);
    });
  }

  const drawer = app && app.drawer;
  if (drawer && typeof drawer.mountPanel === 'function') drawer.mountPanel(PANEL, node);
  watch();
  app.transcript = api;
}
