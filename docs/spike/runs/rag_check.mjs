// The RAG check the 28-item gate lacks (2026-11-12): answers out of a whole document sent in the prompt, as Open WebUI's
// full-context mode sends it. A haystack of real text (this repo's DEVLOG) with planted facts at known depths, at the
// sizes asked, by several people at once, each with their own slice of text and their own facts (so a prefix cache
// cannot share the work). A fact counts as found when the reply contains its value.
//
//   node docs/spike/runs/rag_check.mjs <farm or engine /v1 URL> <model> [--sizes 30000,60000] [--people 1,4]
//        [--thinking off|on] [--key sk-…] [--label name]
//
// Writes docs/spike/results/<label>__rag__<stamp>.json and prints one line per (size, people).
// ponytail: tokens are estimated at 3.1 characters each (measured on the DEVLOG through Gemma 4's tokenizer, 2026-11-10:
// 120,000 characters = 39,333 tokens); the reply's usage.prompt_tokens is recorded beside each run as the truth.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const [base, model] = argv;
if (!base || !model) { console.log('usage: node rag_check.mjs <…/v1 URL> <model> [--sizes 30000,60000] [--people 1,4] [--thinking off|on] [--key k] [--label l]'); process.exit(2); }
const SIZES = opt('sizes', '30000,60000').split(',').map(Number);
const PEOPLE = opt('people', '1,4').split(',').map(Number);
const THINK = opt('thinking', 'off');
const KEY = opt('key', 'sk-lol-lan');
const LABEL = opt('label', model.replace(/[^\w.-]+/g, '-'));
const CHARS_PER_TOKEN = 3.1;

// node:http rather than fetch: fetch refuses the web's blocked ports (4190 among them).
function post(url, body) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.setTimeout(600_000, () => req.destroy(new Error('no answer in 10 min')));
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}

// The haystack: the DEVLOG, whose text a model has not seen, cut into one slice per person.
const HAY = fs.readFileSync(path.join(ROOT, 'docs', 'DEVLOG.md'), 'utf8');
// Facts no text could guess: a made-up name and a number per person, so a model that guesses scores nothing.
const PLACES = ['the Lyon workshop', 'the Brest studio', 'the Nantes lab', 'the Lille room', 'the Rennes class', 'the Dijon atelier'];
const fact = (seed, k) => {
  const n = 1000 + ((seed * 7919 + k * 104729) % 9000);
  const place = PLACES[(seed + k) % PLACES.length];
  return { place, value: String(n), text: `Note for the record: the door code of ${place} is ${n}.` };
};
const DEPTHS = [0.1, 0.5, 0.9];

function documentFor(person, tokens) {
  const chars = Math.round(tokens * CHARS_PER_TOKEN);
  const start = (person * 211_000) % Math.max(1, HAY.length - chars);
  let doc = HAY.slice(start, start + chars);
  const facts = DEPTHS.map((d, k) => ({ ...fact(person + tokens, k), depth: d }));
  // Plant from the deepest so earlier offsets stay right; each at a line break near its depth.
  for (const f of [...facts].reverse()) {
    const at = doc.indexOf('\n', Math.floor(doc.length * f.depth));
    const i = at < 0 ? Math.floor(doc.length * f.depth) : at + 1;
    doc = doc.slice(0, i) + f.text + '\n' + doc.slice(i);
  }
  return { doc, facts };
}

async function ask(doc, f) {
  const body = {
    model, max_tokens: THINK === 'on' ? 4096 : 200, temperature: 0.2,
    messages: [{ role: 'user', content: `Here is a document:\n\n${doc}\n\nAnswer from the document only, in one short sentence: what is the door code of ${f.place}?` }],
  };
  if (THINK === 'off') { body.chat_template_kwargs = { enable_thinking: false }; body.think = false; }
  if (THINK === 'on') { body.chat_template_kwargs = { enable_thinking: true }; body.think = true; }
  const t0 = performance.now();
  const r = await post(base.replace(/\/$/, '') + '/chat/completions', body).catch((e) => ({ status: 0, body: String(e.message) }));
  const s = (performance.now() - t0) / 1000;
  if (r.status !== 200) return { ok: false, s, err: `HTTP ${r.status} ${r.body.slice(0, 200)}` };
  const j = JSON.parse(r.body);
  const text = (j.choices && j.choices[0].message.content) || '';
  return { ok: true, s, found: text.includes(f.value), prompt: j.usage && j.usage.prompt_tokens, reply: text.slice(0, 160) };
}

const runs = [];
for (const size of SIZES) {
  for (const people of PEOPLE) {
    // Each person asks about each of their facts, one after another; the people ask at the same time.
    const t0 = performance.now();
    const per = await Promise.all(Array.from({ length: people }, async (_, p) => {
      const { doc, facts } = documentFor(p, size);
      const out = [];
      for (const f of facts) out.push({ depth: f.depth, ...(await ask(doc, f)) });
      return out;
    }));
    const all = per.flat();
    const ok = all.filter((a) => a.ok);
    const found = ok.filter((a) => a.found).length;
    const secs = ok.map((a) => a.s).sort((a, b) => a - b);
    const row = {
      size, people, asked: all.length, errors: all.length - ok.length, found,
      byDepth: Object.fromEntries(DEPTHS.map((d) => [d, `${ok.filter((a) => a.depth === d && a.found).length}/${all.filter((a) => a.depth === d).length}`])),
      promptTokens: ok.map((a) => a.prompt).filter(Boolean),
      secondsMedian: secs.length ? +secs[Math.floor(secs.length / 2)].toFixed(1) : null,
      secondsWorst: secs.length ? +secs[secs.length - 1].toFixed(1) : null,
      wallSeconds: +((performance.now() - t0) / 1000).toFixed(1),
      misses: all.filter((a) => !a.ok || !a.found).map((a) => ({ depth: a.depth, err: a.err, reply: a.reply })),
    };
    runs.push(row);
    console.log(`[rag] ${LABEL} ~${size} tok × ${people} people: found ${found}/${all.length} (by depth ${JSON.stringify(row.byDepth)}), ${row.errors} errors, median ${row.secondsMedian ?? '-'}s, worst ${row.secondsWorst ?? '-'}s, prompt ${row.promptTokens[0] ?? '?'} tok`);
  }
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const out = path.join(ROOT, 'docs', 'spike', 'results', `${LABEL}__rag__think-${THINK}__${stamp}.json`);
fs.writeFileSync(out, JSON.stringify({ kind: 'rag', label: LABEL, model, base, thinking: THINK, sizes: SIZES, people: PEOPLE, depths: DEPTHS, runs }, null, 1));
console.log(`[rag] -> ${out}`);
