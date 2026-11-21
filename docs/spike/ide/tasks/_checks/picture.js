// PICTURE_TO_PAGE_PLAN step 1: what a script can see of a page rebuilt from a picture, from the task's truth.json.
//   page:  {kind:"page", texts:[...], fields:N, button:"Label", colours:[[r,g,b],...]}
//   scene: {kind:"scene", geometries:["BoxGeometry",...], hues:[["red",340,15],...], light?:true}
// The look itself is compared by eye (docs/spike/ide/pictures/render.js). Prints {pass, fails, ...} and exits 0/1.
const fs = require('fs'); const path = require('path');
module.exports = function check(dir, truth) {
    const fails = [];
    const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
    const html = read('index.html');
    if (!html) { console.log(JSON.stringify({ pass: false, fails: ['no index.html'] })); process.exit(1); }
    const extra = (rx) => fs.readdirSync(dir).filter((f) => rx.test(f) && f !== 'three.min.js').map(read).join('\n');
    const out = {};
    if (truth.kind === 'page') {
        const css = extra(/\.css$/i) + html;
        const text = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').toLowerCase();
        const missing = truth.texts.filter((w) => !text.includes(w.toLowerCase()));
        out.texts = `${truth.texts.length - missing.length}/${truth.texts.length}`;
        if (missing.length) fails.push('missing texts: ' + missing.join(', '));
        const fields = (html.match(/<input\b/gi) || []).length + (html.match(/<select\b/gi) || []).length;
        if (fields < (truth.fields || 0)) fails.push(`${fields} form fields, not ${truth.fields}`);
        const buttons = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || []).map((b) => b.replace(/<[^>]+>/g, '').trim().toLowerCase());
        if (truth.button && !buttons.includes(truth.button.toLowerCase())) fails.push(`no ${truth.button} button`);
        const hexes = (css.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []).map((h) => (h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h)).map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
        const rgbs = (css.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/gi) || []).map((r) => r.match(/\d+/g).slice(0, 3).map(Number));
        const near = (t) => [...hexes, ...rgbs].some((c) => Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]) < 48);
        const far = (truth.colours || []).filter((t) => !near(t)).map((t) => '#' + t.map((v) => v.toString(16).padStart(2, '0')).join(''));
        out.colours = `${(truth.colours || []).length - far.length}/${(truth.colours || []).length}`;
        if (far.length) fails.push('no colour near ' + far.join(', '));
    } else {
        const js = html + extra(/\.js$/i);
        if (!/<script[^>]+src=["']\.?\/?three\.min\.js["']/i.test(html)) fails.push('three.min.js is not loaded from the folder');
        if (/https?:\/\//i.test(js.replace(/https?:\/\/www\.w3\.org[^"']*/g, ''))) fails.push('something is loaded from the internet');
        for (const g of truth.geometries) if (!js.includes(g)) fails.push(`no ${g}`);
        if (truth.light && !/PointLight|SpotLight/.test(js)) fails.push('no point or spot light (the lamp)');
        const cols = (js.match(/0x[0-9a-f]{6}\b|#[0-9a-f]{6}\b/gi) || []).map((h) => h.replace(/^0x|^#/i, '')).map((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)));
        const hue = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < 40) return null; return mx === r ? (g >= b ? (60 * (g - b)) / (mx - mn) : 360 + (60 * (g - b)) / (mx - mn)) : mx === g ? 120 + (60 * (b - r)) / (mx - mn) : 240 + (60 * (r - g)) / (mx - mn); };
        const has = (lo, hi) => cols.some((c) => { const h = hue(c); return h != null && (lo < hi ? h >= lo && h < hi : h >= lo || h < hi); });
        const missing = truth.hues.filter(([, lo, hi]) => !has(lo, hi)).map(([n]) => n);
        out.hues = `${truth.hues.length - missing.length}/${truth.hues.length}`;
        if (missing.length) fails.push('no colour of hue ' + missing.join(', '));
    }
    console.log(JSON.stringify({ pass: fails.length === 0, fails, ...out }));
    process.exit(fails.length ? 1 : 0);
};
