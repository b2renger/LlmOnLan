// The P4 agent spike (docs/ECOSYSTEM_PLAN.md §5, §8d): how reliably does the farm's model call tools?
// Exit bar: ≥ 80% correct tool calls → the Agent box (P4) and DeepSeek Harness for the IDE (P5); below →
// the Agent box waits and the IDE uses our own minimal loop.
//
//   node docs/research/agent-spike/run.mjs --base http://127.0.0.1:4000/v1 --key <farm password> \
//        [--model assistant] [--reps 4] [--mode native|json|both] [--out result.json]
//
// ONE request at a time (one seat). It stops at once on a 429 (seats full) or when the farm says someone
// is waiting, so it never pushes a person aside. Nothing is stored on the farm.
//
// A call is CORRECT only when it names the right tool AND its arguments parse AND carry what the task
// asked for (the right path, the right box type…). Two modes:
//   native — the OpenAI `tools` field (LiteLLM → the engine's chat template);
//   json   — no tools field: the answer is forced to {"tool", "args"} by a JSON schema (what our own
//            minimal loop would use; the Instruction box's JSON mode already works this way).

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const BASE = args.base || 'http://127.0.0.1:4000/v1';
const KEY = args.key || '';
const MODEL = args.model || 'assistant';
const REPS = Math.max(1, Number(args.reps) || 4);
const MODES = args.mode === 'native' ? ['native'] : args.mode === 'json' ? ['json'] : ['native', 'json'];

// ---- the tools: an IDE's file tools and the Computer's graph tools (what P4/P5 would expose) ----------
const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const TOOLS = [
  fn('list_files', 'List the files in a folder of the project.', { dir: { type: 'string', description: 'folder, "." for the project root' } }, ['dir']),
  fn('read_file', 'Read a text file of the project.', { path: { type: 'string' } }, ['path']),
  fn('write_file', 'Create or replace a text file of the project.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  fn('preview', 'Open a file of the project in the preview pane.', { path: { type: 'string' } }, ['path']),
  fn('add_box', 'Add a box to the Computer graph. Types: note (text), ask (instruction), fetch (web address), code, preview, classify.', { type: { type: 'string' }, settings: { type: 'object' } }, ['type']),
  fn('wire', 'Draw an arrow from one box to another.', { from: { type: 'string' }, to: { type: 'string' }, port: { type: 'string' } }, ['from', 'to']),
  fn('set_settings', 'Change settings of a box.', { id: { type: 'string' }, settings: { type: 'object' } }, ['id', 'settings']),
  fn('run_graph', 'Run the whole graph.', {}, []),
];

const SYSTEM = 'You are an assistant inside a creative-coding tool. Use exactly one tool call to do what the person asks. The project has: index.html, style.css, sketch.js. The graph has boxes n1 (a note), n2 (an instruction) and c1 (a classify box).';

/** Each task: a request and the check of the call. `none` = the right answer is NO tool call. */
const TASKS = [
  { id: 'list', ask: 'What files are in the project?', tool: 'list_files', ok: (a) => typeof a.dir === 'string' },
  { id: 'read', ask: 'Show me index.html.', tool: 'read_file', ok: (a) => /index\.html$/.test(String(a.path)) },
  { id: 'write', ask: 'Create a file hello.txt that contains exactly: Hi there', tool: 'write_file', ok: (a) => /hello\.txt$/.test(String(a.path)) && /Hi there/.test(String(a.content)) },
  { id: 'page', ask: 'Write index.html: a page titled Garden with a green heading that says Welcome.', tool: 'write_file', ok: (a) => /index\.html$/.test(String(a.path)) && /<title>\s*Garden\s*<\/title>/i.test(String(a.content)) && /Welcome/.test(String(a.content)) },
  { id: 'preview', ask: 'Show me the page in the preview.', tool: 'preview', ok: (a) => /index\.html$/.test(String(a.path)) },
  { id: 'note', ask: 'Add a text box that says bonjour.', tool: 'add_box', ok: (a) => a.type === 'note' && /bonjour/i.test(JSON.stringify(a.settings || {})) },
  { id: 'fetchbox', ask: 'Add a box that fetches https://example.com/data.json', tool: 'add_box', ok: (a) => a.type === 'fetch' && /example\.com\/data\.json/.test(JSON.stringify(a.settings || {})) },
  { id: 'wire', ask: 'Connect the note n1 to the instruction n2.', tool: 'wire', ok: (a) => a.from === 'n1' && a.to === 'n2' },
  { id: 'settings', ask: 'Set the threshold of the classify box c1 to 0.7.', tool: 'set_settings', ok: (a) => a.id === 'c1' && Number((a.settings || {}).threshold) === 0.7 },
  { id: 'run', ask: 'Run the graph now.', tool: 'run_graph', ok: () => true },
];

const headers = { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) };

async function busy() {
  // The farm's own snapshot says whether people are waiting; never push a person aside.
  try {
    const self = new URL(BASE); self.port = '41997'; self.pathname = '/lol/self';
    const s = await (await fetch(self.href, { signal: AbortSignal.timeout(3000) })).json();
    return !!(s.capacity && (s.capacity.queued > 0));
  } catch { return false; }
}

const JSON_SCHEMA = {
  type: 'object',
  properties: { tool: { type: 'string', enum: TOOLS.map((t) => t.function.name) }, args: { type: 'object' } },
  required: ['tool', 'args'],
};

async function ask(task, mode) {
  const user = task.ask;
  const body = mode === 'native'
    ? { model: MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 2048 }
    : {
      model: MODEL, temperature: 0.2, max_tokens: 2048,
      response_format: { type: 'json_schema', json_schema: { name: 'call', schema: JSON_SCHEMA } },
      messages: [
        { role: 'system', content: `${SYSTEM}\nThe tools, as JSON: ${JSON.stringify(TOOLS.map((t) => t.function))}\nAnswer ONLY with {"tool": <a tool name>, "args": {…}}.` },
        { role: 'user', content: user },
      ],
    };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  if (res.status === 429) return { stop: '429 seats full' };
  const text = await res.text();
  if (!res.ok) return { tool: null, why: `HTTP ${res.status}: ${text.slice(0, 200)}`, ms: Date.now() - t0 };
  let msg;
  try { msg = JSON.parse(text).choices[0].message; } catch { return { tool: null, why: 'not JSON', ms: Date.now() - t0 }; }
  let tool = null; let a = null; let why = '';
  if (mode === 'native') {
    const call = (msg.tool_calls || [])[0];
    if (!call) why = `no tool call: ${String(msg.content || '').slice(0, 120)}`;
    else {
      tool = call.function && call.function.name;
      try { a = JSON.parse(call.function.arguments || '{}'); } catch { why = 'arguments are not JSON'; }
    }
  } else {
    try { const j = JSON.parse(String(msg.content || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); tool = j.tool; a = j.args || {}; } catch { why = `not JSON: ${String(msg.content || '').slice(0, 120)}`; }
  }
  return { tool, args: a, why, ms: Date.now() - t0 };
}

// ---- episodes: several turns, the tool results fed back (what an agent really does) ---------------------
// "Change the page's title": the model must look (list or read), then write index.html with the new title
// AND the rest of the page intact, within MAX_TURNS calls, every call valid.
const PAGE = '<!doctype html>\n<html>\n<head><title>Garden</title><link rel="stylesheet" href="style.css"></head>\n<body><h1>Welcome</h1><p>Flowers and trees.</p></body>\n</html>';
const FAKE = {
  list_files: () => JSON.stringify(['index.html', 'style.css', 'sketch.js']),
  read_file: (a) => (/index\.html$/.test(String(a.path)) ? PAGE : /style\.css$/.test(String(a.path)) ? 'h1 { color: green; }' : 'not found'),
  preview: () => 'the preview shows the page',
  write_file: () => 'written',
};
const MAX_TURNS = 4;
async function episode() {
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Change the title of the page in this project to "Night Garden". Keep everything else on the page as it is.' }];
  const calls = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers, signal: AbortSignal.timeout(180000), body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 4096 }) });
    if (res.status === 429) return { stop: '429 seats full' };
    if (!res.ok) return { ok: false, calls, why: `HTTP ${res.status}` };
    const msg = JSON.parse(await res.text()).choices[0].message;
    const call = (msg.tool_calls || [])[0];
    if (!call) return { ok: false, calls, why: `stopped without writing: ${String(msg.content || '').slice(0, 100)}` };
    let a = {};
    try { a = JSON.parse(call.function.arguments || '{}'); } catch { return { ok: false, calls, why: 'arguments are not JSON' }; }
    calls.push(call.function.name);
    if (call.function.name === 'write_file') {
      const c = String(a.content || '');
      const ok = /index\.html$/.test(String(a.path)) && /<title>\s*Night Garden\s*<\/title>/i.test(c) && /<h1>Welcome<\/h1>/.test(c) && /style\.css/.test(c);
      return { ok, calls, why: ok ? '' : `wrote: ${c.slice(0, 160)}` };
    }
    const out = FAKE[call.function.name] ? FAKE[call.function.name](a) : 'no such tool';
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: [call] });
    messages.push({ role: 'tool', tool_call_id: call.id, content: out });
  }
  return { ok: false, calls, why: `no write within ${MAX_TURNS} calls` };
}
if (args.mode === 'episode') {
  const eps = [];
  for (let i = 0; i < REPS; i++) {
    if (await busy()) { console.log('the farm has people waiting: stopping'); break; }
    const t0 = Date.now();
    let e;
    try { e = await episode(); } catch (err) { e = { ok: false, calls: [], why: String(err && err.message || err) }; }
    if (e.stop) { console.log(`stopping: ${e.stop}`); break; }
    eps.push({ ...e, ms: Date.now() - t0 });
    console.log(`episode ${String(i + 1).padStart(2)} ${e.ok ? 'OK  ' : 'MISS'} ${String(Date.now() - t0).padStart(6)} ms  ${e.calls.join(' → ')}  ${e.why}`);
  }
  const s = { episodes: eps.length, ok: eps.filter((e) => e.ok).length, rate: Math.round((eps.filter((e) => e.ok).length / Math.max(1, eps.length)) * 1000) / 10 };
  console.log(JSON.stringify(s, null, 2));
  if (args.out) (await import('node:fs')).writeFileSync(args.out, JSON.stringify({ base: BASE, model: MODEL, at: new Date().toISOString(), summary: s, episodes: eps }, null, 2));
  process.exit(0);
}

const results = [];
outer:
for (const mode of MODES) {
  for (let r = 0; r < REPS; r++) {
    for (const task of TASKS) {
      if (await busy()) { console.log('the farm has people waiting: stopping'); break outer; }
      let out;
      try { out = await ask(task, mode); } catch (e) { out = { tool: null, why: String(e && e.message || e) }; }
      if (out.stop) { console.log(`stopping: ${out.stop}`); break outer; }
      const rightTool = out.tool === task.tool;
      let rightArgs = false;
      if (rightTool && out.args && typeof out.args === 'object') { try { rightArgs = !!task.ok(out.args); } catch { rightArgs = false; } }
      const row = { mode, rep: r, task: task.id, tool: out.tool, rightTool, rightArgs, correct: rightTool && rightArgs, ms: out.ms, why: out.why || (rightTool && !rightArgs ? `args: ${JSON.stringify(out.args).slice(0, 160)}` : (!rightTool && out.tool ? `called ${out.tool}` : '')) };
      results.push(row);
      console.log(`${mode.padEnd(6)} ${task.id.padEnd(9)} ${row.correct ? 'OK  ' : 'MISS'} ${String(out.ms || '').padStart(6)} ms ${row.why}`);
    }
  }
}

const summary = {};
for (const mode of MODES) {
  const rows = results.filter((r) => r.mode === mode);
  if (!rows.length) continue;
  const byTask = {};
  for (const r of rows) { byTask[r.task] = byTask[r.task] || [0, 0]; byTask[r.task][0] += r.correct ? 1 : 0; byTask[r.task][1] += 1; }
  summary[mode] = {
    requests: rows.length,
    correct: rows.filter((r) => r.correct).length,
    rate: Math.round((rows.filter((r) => r.correct).length / rows.length) * 1000) / 10,
    rightTool: Math.round((rows.filter((r) => r.rightTool).length / rows.length) * 1000) / 10,
    medianMs: rows.map((r) => r.ms || 0).sort((x, y) => x - y)[Math.floor(rows.length / 2)],
    byTask: Object.fromEntries(Object.entries(byTask).map(([k, [c, n]]) => [k, `${c}/${n}`])),
  };
}
console.log(JSON.stringify(summary, null, 2));
if (args.out) (await import('node:fs')).writeFileSync(args.out, JSON.stringify({ base: BASE, model: MODEL, reps: REPS, at: new Date().toISOString(), summary, results }, null, 2));
