// Two locker lists (~100k tokens at ~30 tokens a line, measured on Qwen3.6 2026-11-20) and three pupils to ask about.
//   node owui_doc_gen.mjs <seed> <records> <out .txt> <out answers .json>
import { writeFileSync } from 'node:fs';
const [seedArg, nArg, txt, ans] = process.argv.slice(2);
let s = Number(seedArg);
const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const used = new Set(); const rec = [];
for (let n = 1; n <= Number(nArg); n++) {
  let id; do { id = 10000 + Math.floor(rnd() * 90000); } while (used.has(id)); used.add(id);
  const code = String(1000 + Math.floor(rnd() * 9000)); const room = `${'ABCDEF'[Math.floor(rnd() * 6)]}-${10 + Math.floor(rnd() * 40)}`;
  rec.push({ id, code, text: `Locker ${String(n).padStart(4, '0')}: pupil P-${id}, room ${room}, code ${code}.` });
}
writeFileSync(txt, rec.map((r) => r.text).join('\n') + '\n');
writeFileSync(ans, JSON.stringify([0.1, 0.5, 0.9].map((f) => { const r = rec[Math.floor(f * rec.length)]; return { id: r.id, code: r.code }; })));
console.log(txt, rec.length, 'records');
