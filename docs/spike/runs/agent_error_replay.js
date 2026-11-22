// AGENT_LOOP_PLAN (night n° 13): usage node agent_error_replay.js <IDE_DATA folder of docs/spike/ide/run.js>...
// Variant: the most times one failure repeats in a turn (tool + file + the error's first line), anywhere in the turn.
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.zstd')) out.push(p); } return out; };
const out = [];
for (const dir of process.argv.slice(2)) {
  const rows = fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  for (const f of walk(path.join(dir, 'lol-studio', 'dsh', 'sessions'))) {
    const m = /lol-(t\d-[a-z0-9]+)-(\d+)-\d+-/.exec(f); if (!m) continue;
    const row = rows.find((r) => r.task === m[1] && String(r.rep) === m[2] && f.includes(r.id)); if (!row) continue;
    const ev = zlib.zstdDecompressSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(JSON.parse);
    const calls = {}; const count = {};
    for (const e of ev) {
      if (e.type === 'assistant/message') for (const c of (e.data.message.content || [])) if (c.type === 'tool-call') calls[c.id] = c;
      if (e.type === 'tool/result' && e.data.message.isError) {
        const c = calls[e.data.message.toolCallId] || {}; let file = ''; try { const o = JSON.parse(c.arguments || '{}'); file = o.file_path || o.path || ''; } catch {}
        const k = `${c.name}|${file}|${(e.data.message.content || []).map((x) => x.text || '').join(' ').split('\n')[0].replace(/\d+/g, '#').slice(0, 60)}`;
        count[k] = (count[k] || 0) + 1;
      }
    }
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0] || ['', 0];
    out.push({ who: `${path.basename(dir)} ${row.task}#${row.rep}`, pass: row.check.pass, wall: Math.round(row.wallS), max: top[1], what: top[0].slice(0, 100) });
  }
}
for (const th of [3, 5, 8, 10]) {
  const hit = out.filter((o) => o.max >= th);
  console.log(`same failure >= ${th}: passing ${hit.filter((o) => o.pass).length}, failing ${hit.filter((o) => !o.pass).length}, past 300 s ${hit.filter((o) => o.wall > 300).length}`);
}
for (const o of out.filter((o) => o.max >= 5).sort((a, b) => b.max - a.max)) console.log(o.max, o.pass ? 'PASS' : 'MISS', o.wall + 's', o.who, o.what);
