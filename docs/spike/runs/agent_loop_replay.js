// AGENT_LOOP_PLAN step 1: the Agent box's loopOf rule (graph/parts/agent.mjs: the same step three times in a row, or
// A B A B) replayed on dsh's session logs. Two keys: strict (tool + arguments + result) and loose (tool + file + ok or
// the error's first line). node agent_loop_replay.js <IDE_DATA folder of docs/spike/ide/run.js>...  → one line per folder, and the tasks it would stop.
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const loopAt = (keys) => { for (let n = 3; n <= keys.length; n++) {
  const k = keys.slice(0, n);
  if (k[n - 1] === k[n - 2] && k[n - 2] === k[n - 3]) return n;
  if (n >= 4 && k[n - 1] === k[n - 3] && k[n - 2] === k[n - 4] && k[n - 1] !== k[n - 2]) return n;
} return 0; };
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.zstd')) out.push(p); } return out; };
const all = { tasks: 0, strict: { pass: 0, fail: 0 }, loose: { pass: 0, fail: 0 } }; const stops = [];
for (const dir of process.argv.slice(2)) {
  const rows = fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  for (const f of walk(path.join(dir, 'lol-studio', 'dsh', 'sessions'))) {
    const m = /lol-(t\d-[a-z0-9]+)-(\d+)-\d+-/.exec(f); if (!m) continue;
    const row = rows.find((r) => r.task === m[1] && String(r.rep) === m[2] && f.includes(r.id)); if (!row) continue;
    const ev = zlib.zstdDecompressSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(JSON.parse);
    const calls = []; const res = {};
    for (const e of ev) {
      if (e.type === 'assistant/message') for (const c of (e.data.message.content || [])) if (c.type === 'tool-call') calls.push(c);
      if (e.type === 'tool/result') { const t = (e.data.message.content || []).map((x) => x.text || '').join(' ').split('\n')[0]; res[e.data.message.toolCallId] = e.data.message.isError ? 'ERR ' + t.replace(/\d+/g, '#').slice(0, 80) : 'ok'; }
    }
    const target = (a) => { try { const o = JSON.parse(a || '{}'); return o.file_path || o.path || o.pattern || ''; } catch { return ''; } };
    const strict = calls.map((c) => `${c.name}|${c.arguments}|${res[c.id]}`);
    const loose = calls.map((c) => `${c.name}|${target(c.arguments)}|${res[c.id]}`);
    const s = loopAt(strict), l = loopAt(loose);
    all.tasks++;
    const ok = row.check.pass;
    if (s) all.strict[ok ? 'pass' : 'fail']++;
    if (l) all.loose[ok ? 'pass' : 'fail']++;
    if (s || l) stops.push(`${path.basename(dir)} ${row.task}#${row.rep} ${ok ? 'PASS' : 'MISS'} ${Math.round(row.wallS)}s/${row.steps} steps: strict@${s || '-'} loose@${l || '-'} (${(loose[(l || s) - 1] || '').slice(0, 90)})`);
  }
}
console.log(JSON.stringify(all)); for (const x of stops) console.log(x);
