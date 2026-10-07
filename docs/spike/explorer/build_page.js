// Inline the catalog, the measured data (trimmed to what the page and the estimator read) and the estimator into
// one HTML file: explorer.html. Run: node build_page.js
const fs = require('fs');
const path = require('path');
const here = __dirname;
const cat = JSON.parse(fs.readFileSync(path.join(here, 'catalog.json'), 'utf8'));
const meas = JSON.parse(fs.readFileSync(path.join(here, 'measured.json'), 'utf8'));
const keepLevel = (l) => {
  const o = { c: l.c, ttft_p95: l.ttft_p95, dec_p10: l.dec_p10, pass_every: l.pass_every, pass_steady: l.pass_steady };
  for (const k of ['r1', 'r2']) if (l[k]) o[k] = { ttft_p95: l[k].ttft_p95, dec_p10: l[k].dec_p10, pass: l[k].pass };
  return o;
};
const trimmed = {
  generated: meas.generated, pass_rule: meas.pass_rule,
  configs: meas.configs.map((c) => ({
    id: c.id, box: c.box, engine: c.engine, model: c.model, people: c.people,
    profiles: Object.fromEntries(Object.entries(c.profiles).map(([k, p]) => [k, { levels: (p.levels || []).map(keepLevel) }])),
    single_user: c.single_user, cold_prefill_single_user: c.cold_prefill_single_user,
  })),
};
const safe = (s) => s.replace(/<\//g, '<\\/');
let html = fs.readFileSync(path.join(here, 'explorer.src.html'), 'utf8');
html = html.replace('/*__CATALOG__*/', () => safe(JSON.stringify(cat)))
  .replace('/*__MEASURED__*/', () => safe(JSON.stringify(trimmed)))
  .replace('/*__ESTIMATOR__*/', () => safe(fs.readFileSync(path.join(here, 'estimator.js'), 'utf8')));
fs.writeFileSync(path.join(here, 'explorer.html'), html);
console.log('explorer.html', (html.length / 1024).toFixed(0), 'KB');
