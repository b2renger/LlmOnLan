// The capacity explorer lives in the farm (farm/src/capacity/, served at /lol/capacity). This writes:
//  1. farm/src/capacity/measured.json: measured.json trimmed to what the page and the estimator read (the vLLM
//     configs' follow-up runs and cold prefill), the copy the farm serves;
//  2. explorer.html (or the path given): the same page with the catalog, that data and both scripts inlined, one
//     file with no request anywhere, to share or publish (generated, not committed).
// Run: node build_page.js [out.html]
const fs = require('fs');
const path = require('path');
const here = __dirname;
const farm = path.join(here, '..', '..', '..', 'farm', 'src', 'capacity');
const meas = JSON.parse(fs.readFileSync(path.join(here, 'measured.json'), 'utf8'));
const keepLevel = (l) => {
  const o = { c: l.c, ttft_p95: l.ttft_p95, dec_p10: l.dec_p10, pass_every: l.pass_every, pass_steady: l.pass_steady };
  for (const k of ['r1', 'r2']) if (l[k]) o[k] = { ttft_p95: l[k].ttft_p95, dec_p10: l[k].dec_p10, pass: l[k].pass };
  return o;
};
const followups = (o) => Object.entries(o || {}).filter(([k]) => k.startsWith('followup_'));
const trimmed = {
  generated: meas.generated, pass_rule: meas.pass_rule,
  configs: meas.configs.filter((c) => /\/vllm\//.test(c.id)).map((c) => ({
    id: c.id, box: c.box, engine: c.engine, model: c.model,
    people: Object.fromEntries(followups(c.people)),
    profiles: Object.fromEntries(followups(c.profiles).map(([k, p]) => [k, { levels: (p.levels || []).map(keepLevel) }])),
    cold_prefill_single_user: c.cold_prefill_single_user,
  })),
};
const data = JSON.stringify(trimmed);
fs.writeFileSync(path.join(farm, 'measured.json'), data + '\n');
console.log('farm/src/capacity/measured.json', (data.length / 1024).toFixed(0), 'KB');

const safe = (s) => s.replace(/<\//g, '<\\/');
const swap = (html, from, to) => { if (!html.includes(from)) throw new Error('index.html moved: missing ' + from); return html.replace(from, () => to); };
let html = fs.readFileSync(path.join(farm, 'index.html'), 'utf8');
const script = (f) => '<script>' + safe(fs.readFileSync(path.join(farm, f), 'utf8')) + '</script>';
html = swap(html, '<script id="catalog-data" type="application/json"></script>',
  '<script id="catalog-data" type="application/json">' + safe(fs.readFileSync(path.join(farm, 'catalog.json'), 'utf8').trim()) + '</script>');
html = swap(html, '<script id="measured-data" type="application/json"></script>', '<script id="measured-data" type="application/json">' + safe(data) + '</script>');
html = swap(html, '<script src="/lol/capacity/estimator.js"></script>', script('estimator.js'));
html = swap(html, '<script src="/lol/capacity/scenarios.js"></script>', script('scenarios.js'));
const out = path.resolve(process.argv[2] || path.join(here, 'explorer.html'));
fs.writeFileSync(out, html);
console.log(out, (html.length / 1024).toFixed(0), 'KB');
