// lol-agent.mjs — agent loops for LlmOnLan project pages (IDE_PLAN §5 option A; the agent-page skill says how to use it).
// LlmOnLan serves this file at /lol-agent.mjs, and the farm's address at /lol-farm.json, to a project's page on THIS
// computer only (the Preview, "Open in browser") — never on the LAN share, and never the farm's password.
//
//   import { runAgent, ask, setKey } from '/lol-agent.mjs';
//   const { answer, steps } = await runAgent({ task, tools: { add: { description, args, run } }, maxSteps: 6, onStep, onWait });
//
// A model on the LAN farm works in short steps — ONE of the page's tools per step, or the answer — like the Computer's
// Agent box: a failed or malformed step is fed back, the last step must answer. Everything runs in the page: the model
// sees only what the page sends it, and each step is one generation on the farm.

/** @type {{baseUrl: string, requiresKey: boolean, defaultModel?: string | null} | null} */
let farmInfo = null;

/** Where the farm is, and its default model (LlmOnLan tells the page). */
export async function farm() {
  if (farmInfo) return farmInfo;
  const r = await fetch('/lol-farm.json', { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) throw new Error('No farm here: open this page from LlmOnLan (the project Preview, or "Open in browser" on the computer that made it).');
  farmInfo = await r.json();
  return /** @type {any} */ (farmInfo);
}

const KEY = 'lol-farm-key';
/** The farm's password, when it has one: asked from the person, kept for this page's session only. */
export function setKey(/** @type {string} */ key) { try { sessionStorage.setItem(KEY, String(key || '')); } catch { /* private mode */ } }
function auth() {
  let k = '';
  try { k = sessionStorage.getItem(KEY) || ''; } catch { /* private mode */ }
  return k ? { authorization: `Bearer ${k}` } : {};
}

const NEEDS_KEY = 'The farm needs its password: ask the person for it and call setKey(password).';
const WRONG_KEY = 'The farm did not accept the password: ask the person for it again and call setKey(password).';
/**
 * The farm refused or failed: a sentence the page can show. A refused password is the seat gate's 401, or LiteLLM's
 * 400 that names the key (a 400 about the context window is the conversation's length, not the password).
 * @param {Response} r @param {boolean} keyed @param {string} text the answer's body
 */
function why(r, keyed, text) {
  const refused = r.status === 401 || r.status === 403 || (r.status === 400 && /authenticat|api.?key|\bkey\b/i.test(text));
  if (refused) return keyed ? ('authorization' in auth() ? WRONG_KEY : NEEDS_KEY) : 'The farm refused the request.';
  return `The farm answered ${r.status}.`;
}

// A full farm answers 429 with Retry-After: the soonest a seat can free (the soonest idle seat, if its holder stays
// quiet; a whole idle window after its holder's last reply when every seat is generating). No seat frees sooner,
// unless the farm's operator shortens that window. When it is within `waitFor` seconds the page waits, checking at
// most a minute apart so the person sees the wait move and a shortened window is found; when it is not, the farm's
// estimate is said at once. Once a page holds a seat its next steps are let in, so only the first step of a run waits.
const WAIT_STEP = 60;
const WAIT_FOR = 300;
/** Seconds the way a person reads them. @param {number} s */
const secs = (s) => (s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);
/** Wait `s` seconds, or stop the moment the page's signal aborts. @param {number} s @param {AbortSignal} [signal] */
function pause(s, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Error('stopped'));
    const stop = () => { clearTimeout(timer); reject(new Error('stopped')); };
    const timer = setTimeout(() => { if (signal) signal.removeEventListener('abort', stop); resolve(undefined); }, s * 1000);
    if (signal) signal.addEventListener('abort', stop, { once: true });
  });
}

/** The models the farm serves. ask() uses the farm's default unless told otherwise (the first, from an older LlmOnLan). */
export async function models() {
  const f = await farm();
  const r = await fetch(`${f.baseUrl}/models`, { headers: auth() });
  if (!r.ok) throw new Error(why(r, f.requiresKey, await r.text().catch(() => '')));
  const j = await r.json();
  return (j.data || []).map((/** @type {any} */ m) => m.id);
}

/**
 * One answer from the farm's model. A full farm is waited out (see WAIT_STEP) only by a page that shows the wait:
 * `onWait({seconds, waited, message})` is told before each wait, so the page can show "The farm is full: a seat frees
 * in about 2 min; checking again in 60 s."; `waitFor` (seconds, default 300 with onWait, 0 without) bounds the
 * waiting, and 0 gives up at once.
 * @param {{messages: Array<{role: string, content: string}>, json?: boolean, maxTokens?: number, model?: string, signal?: AbortSignal,
 *   onWait?: (w: {seconds: number, waited: number, message: string}) => void, waitFor?: number}} o
 */
export async function ask(o) {
  const f = await farm();
  // No password yet on a farm that has one: said before asking, because an older farm's refusal is unreadable (below).
  if (f.requiresKey && !('authorization' in auth())) throw new Error(NEEDS_KEY);
  const model = o.model || f.defaultModel || (await models())[0];
  // A page written before onWait shows nothing while it waits, so it fails fast, as it always did.
  const budget = o.waitFor == null ? (o.onWait ? WAIT_FOR : 0) : Math.max(0, Number(o.waitFor) || 0);
  let waited = 0;
  for (;;) {
    const r = await fetch(`${f.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify({ model, messages: o.messages, max_tokens: o.maxTokens || 2048, stream: false, ...(o.json ? { response_format: { type: 'json_object' } } : {}) }),
      signal: o.signal,
    }).catch((e) => {
      // The browser says only "Failed to fetch" for a farm it cannot reach — and for an answer this page may not read:
      // a seat gate that sends its own 429/401/502 without CORS headers (farm/src/seats.js up to farm-v0.0.41), so on
      // a farm with a password this may be the password refused.
      if (e && e.name === 'TypeError') {
        throw new Error(f.requiresKey
          ? 'The farm did not answer, or did not accept the password: ask the person for it again and call setKey(password). It may also be off the network, restarting, or full.'
          : 'The farm did not answer (it may be off the network, restarting, or full): try again in a few minutes.');
      }
      throw e;
    });
    if (r.status === 429) {
      await r.text().catch(() => '');
      // Checked every 30 s when there is no Retry-After to read (a farm that does not expose it to another origin).
      const after = Math.ceil(Number(r.headers.get('retry-after')));
      const known = after > 0;
      const s = Math.min(WAIT_STEP, known ? after : 30);
      if (known ? waited + after > budget : waited + s > budget) {
        const full = waited ? `The farm stayed full for ${secs(waited)} (every seat is taken)` : 'The farm is full (every seat is taken)';
        throw new Error(known ? `${full}: the next seat frees in about ${secs(after)}.` : `${full}: try again in a few minutes.`);
      }
      if (o.onWait) {
        o.onWait({ seconds: s, waited, message: known ? `The farm is full: a seat frees in about ${secs(after)}; checking again in ${secs(s)}.`
          : `The farm is full: checking again in ${secs(s)}.` });
      }
      await pause(s, o.signal);
      waited += s;
      continue;
    }
    if (!r.ok) throw new Error(why(r, f.requiresKey, await r.text().catch(() => '')));
    const j = await r.json();
    return String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '');
  }
}

/** A result as the model reads it: long ones cut, with what was left out counted. */
function look(/** @type {unknown} */ v, n = 1500) {
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) s = String(v);
  return s.length > n ? `${s.slice(0, n)}… (${s.length - n} more characters)` : s;
}

const SYSTEM = 'You are an agent inside a web page. You work in short steps. At each step reply with ONE JSON object: '
  + '{"tool": "<one of the tools>", "args": {…}, "why": "<why this step>"} to use a tool, or {"answer": "<your answer for '
  + 'the person>"} when you have what the task needs. Facts and numbers must come from the tool results — never invent '
  + 'them. JSON only.';

/**
 * The loop: the task, the page's tools, at most `maxSteps` steps (1–20). Resolves {answer, steps}; `stopped:
 * 'max-steps'` when the last step still did not answer. A tool's `run(args)` may be async; what it returns (or the
 * error it throws) is the step's result, shown to the model at the next step. `onWait` and `waitFor` as in ask().
 * @param {{task: string, tools?: Record<string, {description: string, args?: Record<string, string>, run: (args: any) => any}>,
 *   maxSteps?: number, onStep?: (step: any) => void, model?: string, signal?: AbortSignal,
 *   onWait?: (w: {seconds: number, waited: number, message: string}) => void, waitFor?: number}} o
 */
export async function runAgent(o) {
  const tools = o.tools || {};
  const names = Object.keys(tools);
  const cap = Math.max(1, Math.min(20, Math.floor(Number(o.maxSteps) || 8)));
  const toolLines = names.map((n) => `- ${n}: ${tools[n].description || ''}${tools[n].args ? ` Args: ${JSON.stringify(tools[n].args)}` : ''}`);
  /** @type {any[]} */ const steps = [];
  for (let k = 1; k <= cap; k++) {
    if (o.signal && o.signal.aborted) throw new Error('stopped');
    const done = steps.map((s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.args || {})} — ${s.why || ''}\n   ${s.ok ? `result: ${look(s.result)}` : `ERROR: ${s.error}`}`);
    const prompt = [
      `## Task\n${o.task}`,
      `## Tools\n${toolLines.join('\n') || '(none: answer from the task alone)'}`,
      `## Steps so far\n${done.join('\n') || '(none yet)'}`,
      k === cap ? `## Now\nStep ${k} of ${cap}, the LAST: reply with {"answer": …} now, from what the results show.`
        : `## Now\nStep ${k} of at most ${cap}: one tool, or the answer.`,
    ].join('\n\n');
    // A full farm is waited out (onWait says so); the farm failing otherwise (a password, down, full for too long)
    // ends the run with its sentence; a malformed reply is fed back.
    const reply = await ask({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], json: true, model: o.model,
      signal: o.signal, onWait: o.onWait, waitFor: o.waitFor });
    let out;
    try { out = JSON.parse(reply); } catch {
      const bad = { tool: '(reply)', ok: false, error: 'the reply was not the JSON object asked for — reply with the JSON object only' };
      steps.push(bad);
      if (o.onStep) o.onStep(bad);
      continue;
    }
    if (out && typeof out.answer === 'string' && (!out.tool || out.tool === 'answer')) {
      if (o.onStep) o.onStep({ tool: 'answer', answer: out.answer });
      return { answer: out.answer, steps };
    }
    const name = String((out && out.tool) || '');
    /** @type {any} */ const step = { tool: name, args: (out && out.args) || {}, why: String((out && out.why) || '') };
    const t = tools[name];
    if (!t) { step.ok = false; step.error = `there is no tool "${name}": use one of ${names.join(', ') || '(none)'}, or answer`; } else {
      try { step.result = await t.run(step.args); step.ok = true; } catch (e) { step.ok = false; step.error = String((e && /** @type {any} */ (e).message) || e); }
    }
    steps.push(step);
    if (o.onStep) o.onStep(step);
  }
  return { answer: '', steps, stopped: 'max-steps' };
}
