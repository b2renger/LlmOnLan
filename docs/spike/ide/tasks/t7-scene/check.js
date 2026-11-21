// node check.js <project dir> → what a script can see of the rebuilt scene (PICTURE_TO_PAGE_PLAN step 1): three.js
// loaded from the folder, the four shapes, their four colours. Its look is compared by eye (pictures/render.js).
const fs = require('fs'); const path = require('path');
const dir = process.argv[2];
const fails = [];
const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
const html = read('index.html');
if (!html) { console.log(JSON.stringify({ pass: false, fails: ['no index.html'] })); process.exit(1); }
const js = html + fs.readdirSync(dir).filter((f) => /\.js$/i.test(f) && f !== 'three.min.js').map(read).join('\n');
if (!/<script[^>]+src=["']\.?\/?three\.min\.js["']/i.test(html)) fails.push('three.min.js is not loaded from the folder');
if (/https?:\/\//i.test(js.replace(/https?:\/\/www\.w3\.org[^"']*/g, ''))) fails.push('something is loaded from the internet');
const shapes = { BoxGeometry: 'the cube', SphereGeometry: 'the sphere', ConeGeometry: 'the cone' };
for (const [g, what] of Object.entries(shapes)) if (!js.includes(g)) fails.push(`no ${g} (${what})`);
if (!/PlaneGeometry|CircleGeometry/.test(js)) fails.push('no ground plane');
const cols = [...(js.match(/0x[0-9a-f]{6}\b|#[0-9a-f]{6}\b/gi) || [])].map((h) => h.replace(/^0x|^#/i, '')).map((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)));
const hue = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < 40) return null; return mx === r ? (g >= b ? (60 * (g - b)) / (mx - mn) : 360 + (60 * (g - b)) / (mx - mn)) : mx === g ? 120 + (60 * (b - r)) / (mx - mn) : 240 + (60 * (r - g)) / (mx - mn); };
const has = (lo, hi) => cols.some((c) => { const h = hue(c); return h != null && (lo < hi ? h >= lo && h < hi : h >= lo || h < hi); });
for (const [name, lo, hi] of [['red', 340, 15], ['yellow', 38, 65], ['green', 90, 160], ['blue', 200, 250]]) if (!has(lo, hi)) fails.push(`no ${name} colour`);
console.log(JSON.stringify({ pass: fails.length === 0, fails }));
process.exit(fails.length ? 1 : 0);
