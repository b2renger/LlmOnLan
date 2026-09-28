// @ts-check
// Agent (ecosystem plan v2 P4; the spike passed 2026-09-27: gemma4:12b 95% native / 90% JSON-mode tool calls,
// 10/10 episodes — docs/research/agent-spike/RESULTS.md). A model that works in SHORT STEPS: each step it
// picks ONE tool, the box runs it and shows the model the result, until it answers or runs out of steps.
//
// The tools (owner, 2026-09-27) — few, with names and descriptions that cannot be confused (the spike's
// one miss was two overlapping tools):
//   run_code  JavaScript in the Computer's ONE sandbox (no network), over the box's inputs and every
//             earlier result — how numbers get computed, never written by the model;
//   fetch     ONE GET on a host a PERSON listed on the box (none listed: no fetch), through io.ts's checks;
//   laya      the farm's Classify, one multiple-choice question over a list an earlier step made;
//   answer    the end: the model's answer, shown above every step it took, so a person can check it.
// It has no output tool: an agent never sends to a device and never arms anything (plan §3.5, §8c).
//
// ponytail: JSON mode through the SAME ask door every Instruction uses (one schema'd call per step, each
// a generation on the run's Cap, the background lane, a hidden window sends nothing). Native `tools`
// would need the shared network layer to learn tool_calls; the spike measured JSON mode at 90%, and a
// model/engine without native tools works the same. Upgrade path: native tools in app/ask.mjs.

import { valueOf, toPlain, isValue } from '../values.mjs';
import { partFail, pickerRow, setPicked, failFromAsk } from './common.mjs';
import { numberField, textField } from './fields.mjs';
import { modelOptions, optionSig, modelFor, capsOf } from './instruction.mjs';
import { fetchError, valueFromAnswer } from './fetch.mjs';
import { classifyItems } from '../../net/classify.mjs';
import { clampMaxTokens, promptTokensOf, MAX_TOKENS_CODE } from '../bind.mjs';
import { trustedBudget } from '../../ctx/budget.mjs';
import { ioDoor } from '../../projects/bridge.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-agent.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const DEFAULT_STEPS = 6;
export const MAX_STEPS = 12;
const CODE_TIMEOUT_MS = 10000;
const PREVIEW = 4000;        // what the model sees of one input or one result (its sketch)
const MAX_LAYA_ITEMS = 200;

/** chat-lint rule 5: a literal map — what the face says a step is doing, per tool. */
const DOING = {
  run_code: 'parts.agentDoing_run_code',
  fetch: 'parts.agentDoing_fetch',
  laya: 'parts.agentDoing_laya',
};

/** partId -> the face's live line. Never persisted (a render hint, like Fetch's). */
const notes = new Map();
/** partId -> repaint its face now: a running agent changes no document between steps, so the face is
 * told directly ("Step 3 of 8: fetch…"). */
const painters = new Map();
/** partId -> the steps of its last run, kept in this window only: what it did, even when it gave up. */
const lastRuns = new Map();
/** The steps of a box's last run (the rig and tests read them; nothing is persisted). @param {string} id */
export function lastSteps(id) { return lastRuns.get(String(id)) || []; }
/** Set (or clear) a box's live line and show it. @param {string} id @param {string|null} text */
function say(id, text) {
  if (text) notes.set(id, text); else notes.delete(id);
  const paint = painters.get(id);
  if (paint) paint();
}

/** PURE: the hosts a person listed — lower case, no scheme, no path; anything else dropped. @param {unknown} text */
export function hostsOf(text) {
  const out = [];
  for (const raw of String(text == null ? '' : text).split(/[\s,;]+/)) {
    const h = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/.test(h) && !out.includes(h)) out.push(h);
  }
  return out;
}

/** PURE: may the agent GET this address? http(s), and its host is EXACTLY one a person listed. @param {unknown} url @param {string[]} hosts */
export function allowedUrl(url, hosts) {
  let u;
  try { u = new URL(String(url || '')); } catch { return false; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  return hosts.includes(u.host.toLowerCase());
}

/** PURE: the tools on offer. @param {{hosts: string[], laya: boolean}} o @returns {string[]} */
export function toolsFor(o) {
  return ['run_code', ...(o.hosts.length ? ['fetch'] : []), ...(o.laya ? ['laya'] : []), 'answer'];
}

/** PURE: one step's answer shape — every field required (strict engines), only the fields these tools use. @param {string[]} tools */
export function stepSchema(tools) {
  /** @type {Record<string, any>} */ const properties = { tool: { type: 'string', enum: tools }, why: { type: 'string' } };
  if (tools.includes('run_code')) properties.code = { type: 'string' };
  if (tools.includes('fetch')) properties.url = { type: 'string' };
  if (tools.includes('laya')) {
    properties.question = { type: 'string' };
    properties.options = { type: 'array', items: { type: 'string' } };
    properties.from = { type: 'integer' };
  }
  if (tools.includes('answer')) properties.answer = { type: 'string' };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/**
 * PURE: the SHAPE of a value — long texts cut, long lists shortened to their first items with a count —
 * so every key of a big object reaches the model. (The rig: a dataset's 1500-character description hid
 * its `columns`, and the model spent three steps finding them.) @param {unknown} v @param {number} [depth]
 */
export function sketch(v, depth = 0) {
  if (typeof v === 'string') return v.length > 300 ? `${v.slice(0, 300)}… (${v.length - 300} more characters)` : v;
  if (Array.isArray(v)) {
    const head = v.slice(0, 8).map((x) => sketch(x, depth + 1));
    if (v.length > 8) head.push(`… ${v.length - 8} more items (${v.length} in all)`);
    return head;
  }
  if (v && typeof v === 'object') {
    if (depth > 5) return '{…}';
    /** @type {Record<string, any>} */ const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = sketch(x, depth + 1);
    return out;
  }
  return v;
}

/** PURE: a value as the model reads it — its sketch as JSON (or the text), cut at `n` characters with the rest counted. @param {unknown} v @param {number} [n] */
export function preview(v, n = PREVIEW) {
  let s;
  if (typeof v === 'string') s = v;
  else { try { s = JSON.stringify(sketch(v)); } catch { s = String(v); } }
  s = String(s == null ? 'null' : s);
  return s.length > n ? `${s.slice(0, n)}… (${s.length - n} more characters)` : s;
}

/** The words of one tool, for the prompt. @param {string} tool @param {string[]} hosts */
function toolLine(tool, hosts) {
  if (tool === 'run_code') return t('parts.agentToolCode');
  if (tool === 'fetch') return t('parts.agentToolFetch', { hosts: hosts.join(', ') });
  if (tool === 'laya') return t('parts.agentToolLaya');
  return t('parts.agentToolAnswer');
}

/**
 * PURE: the prompt for step `k` — the task, a look at each input, the tools, every step so far with its
 * result, and what to do now.
 * @param {{task: string, inputs: Record<string, any>, steps: any[], tools: string[], hosts: string[], k: number, max: number}} o
 * @returns {{system: string, prompt: string}}
 */
export function promptFor(o) {
  const lines = ['## Task', o.task, ''];
  const names = Object.keys(o.inputs);
  lines.push('## Inputs');
  if (!names.length) lines.push(t('parts.agentNoInputs'));
  for (const name of names) lines.push(`- inputs[${JSON.stringify(name)}]: ${preview(o.inputs[name])}`);
  lines.push('', '## Tools');
  for (const tool of o.tools) lines.push(`- ${tool}: ${toolLine(tool, o.hosts)}`);
  lines.push('', '## Steps so far');
  if (!o.steps.length) lines.push(t('parts.agentNoSteps'));
  o.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.tool} — ${s.why || ''}`);
    if (s.tool === 'run_code') lines.push('   code: ' + preview(s.code, 800));
    if (s.tool === 'fetch') lines.push('   url: ' + s.url);
    if (s.tool === 'laya') lines.push(`   question: ${s.question} · options: ${(s.options || []).join(', ')} · items from step ${s.from}`);
    lines.push(s.result && s.result.ok ? `   result (results[${i}]): ${preview(s.result.value)}` : `   ERROR: ${s.result ? s.result.error : '?'}`);
  });
  lines.push('', '## Now', o.k === o.max ? t('parts.agentLastStep', { k: o.k, max: o.max }) : t('parts.agentNextStep', { k: o.k, max: o.max }));
  return { system: t('parts.agentSystem'), prompt: lines.join('\n') };
}

/** PURE: the box's answer — the model's words, then every step it took with a look at its result. @param {string} answer @param {any[]} steps */
export function reportOf(answer, steps) {
  const out = [String(answer || '').trim(), '', '---', t('parts.agentHow', { n: steps.length })];
  steps.forEach((s, i) => {
    let what = s.tool;
    if (s.tool === 'fetch') what += ' ' + s.url;
    if (s.tool === 'laya') what += ' — ' + s.question;
    out.push(`${i + 1}. **${what}** — ${String(s.why || '').replace(/\s+/g, ' ')}`);
    if (s.result) out.push('   → ' + (s.result.ok ? preview(s.result.value, 300) : 'error: ' + s.result.error).replace(/\n/g, ' '));
  });
  return out.join('\n');
}

/** The inputs by the arrow's label (an unlabelled one is input1, input2…), as plain data. @param {any[]} values @param {any[]} labels */
function labelled(values, labels) {
  /** @type {Record<string, any>} */ const out = {};
  (values || []).forEach((v, i) => {
    let name = String((labels && labels[i]) || '').trim() || `input${i + 1}`;
    while (name in out) name += '′';
    out[name] = isValue(v) ? toPlain(v) : v;
  });
  return out;
}

/** The texts of a list an earlier step made, for Laya. @param {unknown} v @returns {string[] | null} */
function textsOf(v) {
  if (!Array.isArray(v)) return null;
  return v.map((x) => (typeof x === 'string' ? x : (x && typeof x === 'object' && typeof x.text === 'string') ? x.text : JSON.stringify(x)));
}

/** Run one tool. Never throws for the tool's own failure: that is a result the model reads and can fix. */
async function runTool(/** @type {any} */ step, /** @type {any} */ c) {
  try {
    if (step.tool === 'run_code') {
      const sandbox = typeof c.input.sandbox === 'function' ? await c.input.sandbox() : null;
      if (!sandbox) return { ok: false, error: t('parts.agentNoSandbox') };
      if (!String(step.code || '').trim()) return { ok: false, error: t('parts.agentEmptyCode') };
      const out = await sandbox.compute({
        // `results` is in scope too: on the rig gemma4 wrote results[0] five times running, whatever the
        // tool's words said. An inner function, so code that declares its own `results` still runs.
        code: `const results = inputs.results;\nreturn (function () {\n${String(step.code)}\n})();`,
        inputs: { ...c.inputs, results: c.steps.map((/** @type {any} */ s) => (s.result && s.result.ok ? s.result.value : null)) },
        timeoutMs: CODE_TIMEOUT_MS,
        signal: c.input.signal,
      });
      if (!out || !out.ok) return { ok: false, error: String((out && out.error && (out.error.message || out.error)) || t('parts.agentCodeFailed')) };
      let value = null;
      try { value = JSON.parse(String(out.json)); } catch { value = out.json; }
      // The rig: a model that logs instead of returning gets null twice. Say so, so the next step returns.
      if (value === null || value === undefined) return { ok: false, error: t('parts.agentReturnedNothing') };
      return { ok: true, value };
    }
    if (step.tool === 'fetch') {
      if (!allowedUrl(step.url, c.hosts)) return { ok: false, error: t('parts.agentHostRefused', { hosts: c.hosts.join(', ') }) };
      const door = ioDoor();
      if (!door) return { ok: false, error: t('parts.fetchNoDoor') };
      // The hosts ride along: main refuses every hop outside them, a redirect included (critic S3).
      const r = await door.get(String(step.url), { hosts: c.hosts });
      if (!r || r.ok !== true) return { ok: false, error: fetchError(r) };
      return { ok: true, value: toPlain(valueFromAnswer(r)) };
    }
    if (step.tool === 'laya') {
      const svc = c.laya;
      if (!svc) return { ok: false, error: t('parts.classifyNoLaya') };
      const k = Math.floor(Number(step.from));
      const from = c.steps[k - 1];
      const items = from && from.result && from.result.ok ? textsOf(from.result.value) : null;
      if (!items || !items.length) return { ok: false, error: t('parts.agentLayaFrom', { from: step.from }) };
      if (items.length > MAX_LAYA_ITEMS) return { ok: false, error: t('parts.classifyTooMany', { n: items.length, max: MAX_LAYA_ITEMS }) };
      const options = (Array.isArray(step.options) ? step.options : []).map(String).filter(Boolean);
      if (options.length < 2 || options.length > 20) return { ok: false, error: t('parts.classifyBadOptions') };
      const out = await classifyItems({ url: svc.url, key: svc.key, items, instructions: String(step.question || ''), options, signal: c.input.signal });
      if ('error' in out) return { ok: false, error: String(out.error) };
      return { ok: true, value: items.map((text, i) => ({ text, label: out.answers[i] ? out.answers[i].choice : null, confidence: out.answers[i] ? out.answers[i].confidence : 0 })) };
    }
    return { ok: false, error: t('parts.agentNotATool', { tool: String(step.tool) }) };
  } catch (e) {
    return { ok: false, error: String((e && /** @type {any} */ (e).message) || e) };
  }
}

/** @type {PartSpec} */
export const agentPart = /** @type {any} */ ({
  type: 'agent',
  order: 260,
  label: t('parts.agentLabel'),
  thinks: true,
  // The run plan counts one generation for a thinking box; an agent may spend one per step (topo.mjs).
  mostGenerations: (/** @type {any} */ part) => Math.max(1, Math.min(MAX_STEPS, Math.floor(Number(part && part.settings && part.settings.maxSteps) || DEFAULT_STEPS))),
  // Task, hosts, steps, model and the live line: 460 leaves the task ~128 px, an Instruction's (k9-fit).
  size: { w: 340, h: 460 },
  // Lists arrive WHOLE (an agent works over the list; it is not run once per item).
  inputs: [{ name: 'in', label: t('parts.agentIn'), accepts: ['text', 'json', 'list'], many: true }],
  output: 'text',
  defaults: () => ({ task: '', hosts: '', maxSteps: DEFAULT_STEPS, model: '' }),

  render(host, part, ctx) {
    const area = document.createElement('textarea');
    area.className = 'graph-ins-instruction';
    area.setAttribute('aria-label', t('parts.agentTask'));
    area.placeholder = t('parts.agentPlaceholder');
    area.value = String(part.settings.task || '');
    area.addEventListener('input', () => ctx.update({ task: area.value }));
    area.addEventListener('change', () => ctx.commit(t('parts.agentTask')));

    const hostsF = textField(t('parts.agentHosts'), String(part.settings.hosts || ''), {
      placeholder: t('parts.agentHostsPlaceholder'),
      onInput: (v) => ctx.update({ hosts: v }),
      onCommit: () => ctx.commit(t('parts.agentHosts')),
    });
    hostsF.input.title = t('parts.agentHostsHint');
    const stepsF = numberField(t('parts.agentSteps'), Number(part.settings.maxSteps) || DEFAULT_STEPS, 1,
      (n) => { ctx.update({ maxSteps: n }); ctx.commit(t('parts.agentSteps')); }, MAX_STEPS);
    stepsF.input.title = t('parts.agentStepsHint', { max: MAX_STEPS });

    let modelSig = optionSig(modelOptions(ctx.app, { named: true }));
    const model = pickerRow(t('parts.insModel'), modelOptions(ctx.app, { named: true }), String(part.settings.model || ''), (v) => {
      ctx.update({ model: v });
      ctx.commit(t('parts.insModel'));
    });
    const modelSel = model.querySelector('select');
    if (modelSel) modelSel.title = t('parts.agentModelHint');
    /** The farm's catalogue arrives after boot: rebuild the menu when it really moved. @param {string} picked */
    const refreshModels = (picked) => {
      const options = modelOptions(ctx.app, { named: true });
      const sig = optionSig(options);
      const select = /** @type {any} */ (model.querySelector('select'));
      if (sig === modelSig || !select || document.activeElement === select) return;
      modelSig = sig;
      select.replaceChildren();
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        select.appendChild(opt);
      }
      setPicked(select, picked);
    };

    const status = document.createElement('div');
    status.className = 'graph-fetch-status';
    // Straight into the body (a flex column), as the Instruction's: the task is the field that grows with the box.
    const nodes = [area, hostsF.node, stepsF.node, model, status];
    host.replaceChildren(...nodes);

    /** @param {any} p */
    const paint = (p) => { status.textContent = notes.get(String(p.id)) || ''; };
    paint(part);
    painters.set(String(part.id), () => paint(part));
    return {
      update(next) {
        if (document.activeElement !== area) area.value = String(next.settings.task || '');
        hostsF.update(String(next.settings.hosts || ''));
        stepsF.update(Number(next.settings.maxSteps) || DEFAULT_STEPS);
        refreshModels(String(next.settings.model || ''));
        paint(next);
      },
      destroy() { painters.delete(String(part.id)); for (const n of nodes) n.remove(); },
    };
  },

  async run(input) {
    const id = String(input.part.id);
    const s = input.part.settings || {};
    const task = String(s.task || '').trim();
    if (!task) throw partFail(t('parts.agentNoTask'), 'part');
    if (!input.ask) throw partFail(t('parts.errNoFarm'), 'no-farm');
    const max = Math.max(1, Math.min(MAX_STEPS, Math.floor(Number(s.maxSteps) || DEFAULT_STEPS)));
    const hosts = hostsOf(s.hosts);
    const farm = capsOf(input.app);
    const laya = farm && farm.classify ? farm.classify : null;
    const tools = toolsFor({ hosts, laya: !!laya });
    const inputs = labelled(input.inputs && input.inputs.in, input.labels && input.labels.in);
    /** @type {any[]} */ const steps = [];
    lastRuns.set(id, steps);
    const tx = input.app && input.app.transcript;

    for (let k = 1; k <= max; k += 1) {
      if (input.signal && input.signal.aborted) throw partFail(t('parts.errAborted'), 'aborted');
      const now = k === max ? ['answer'] : tools;
      const { system, prompt } = promptFor({ task, inputs, steps, tools: now, hosts, k, max });
      say(id, t('parts.agentThinking', { k, max }));
      // Room for a thinking model to reason and then write code (the rig: 4096 was all spent thinking),
      // clamped to what this prompt leaves of the farm's window — as the Condition's verdict is.
      const maxTokens = clampMaxTokens({ ceiling: MAX_TOKENS_CODE, window: trustedBudget(capsOf(input.app)), promptTokens: promptTokensOf(system, prompt, 0) });
      /** @type {any} */ const call = { task: 'graph:agent', prompt, system, images: [], model: s.model || null, priority: 'background', maxTokens, schema: stepSchema(now) };
      if (typeof input.seed === 'number') call.seed = input.seed;
      const res = await input.ask.json(call);
      if (tx && typeof tx.record === 'function') tx.record(id, res);
      // A step that is not the JSON asked for is fed back like a failed tool (JSON mode is ~90% per call:
      // eight steps would otherwise all have to land). A farm that failed, or thinking cut off, stops the box.
      const kind = res && !res.ok && res.error ? String(res.error.kind || '') : '';
      if (res && !res.ok && (kind === 'invalid' || kind === 'empty') && !res.thought) {
        steps.push({ tool: 'invalid', why: '', result: { ok: false, error: t('parts.agentBadStep', { raw: preview(res.raw || '', 300) }) } });
        continue;
      }
      if (!res || !res.ok) { say(id, null); throw failFromAsk(res, { model: modelFor(input.app, s).alias, maxTokens }); }
      const v = res.value && typeof res.value === 'object' ? res.value : {};
      const step = { tool: String(v.tool || ''), why: String(v.why || ''), code: v.code, url: v.url, question: v.question, options: v.options, from: v.from, answer: v.answer };
      if (step.tool === 'answer' || (k === max && typeof v.answer === 'string' && v.answer.trim())) {
        steps.push({ tool: 'answer', why: step.why });
        say(id, t('parts.agentDone', { n: steps.length }));
        return valueOf('text', reportOf(String(v.answer || ''), steps.slice(0, -1)));
      }
      if (!now.includes(step.tool)) {
        steps.push({ ...step, result: { ok: false, error: t('parts.agentNotATool', { tool: step.tool }) } });
        continue;
      }
      const known = Object.prototype.hasOwnProperty.call(DOING, step.tool);
      say(id, t('parts.agentUsing', { k, max, tool: known ? t(/** @type {any} */ (DOING)[step.tool]) : step.tool }));
      const result = await runTool(step, { input, inputs, steps, hosts, laya });
      steps.push({ ...step, result });
    }
    say(id, null);
    throw partFail(t('parts.agentNoAnswer', { max, tools: steps.map((x) => x.tool).join(' → ') }), 'part');
  },
});
