// node check.js <project dir> → what a script can see of the rebuilt page (PICTURE_TO_PAGE_PLAN step 1): the texts, the
// form, the two colours that carry the page. Its look is compared by eye (docs/spike/ide/pictures/render.js).
const fs = require('fs'); const path = require('path');
const dir = process.argv[2];
const fails = [];
const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
const html = read('index.html');
if (!html) { console.log(JSON.stringify({ pass: false, fails: ['no index.html'] })); process.exit(1); }
const css = fs.readdirSync(dir).filter((f) => /\.css$/i.test(f)).map(read).join('\n') + html;
const text = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&middot;|&#183;/g, '·').replace(/\s+/g, ' ');
const want = ['Room booking', 'My bookings', 'Book a room', 'Your name', 'Upcoming', 'Art studio', 'Library room 2', 'Science lab B12', 'Thu 10:30', '3 bookings this week'];
const missing = want.filter((w) => !text.toLowerCase().includes(w.toLowerCase()) && !html.toLowerCase().includes(w.toLowerCase()));
if (missing.length) fails.push('missing texts: ' + missing.join(', '));
const fields = (html.match(/<input\b/gi) || []).length + (html.match(/<select\b/gi) || []).length;
if (fields < 3) fails.push(`${fields} form fields, not 3`);
if (!/<button\b[^>]*>\s*Book\s*</i.test(html)) fails.push('no Book button');
// The header's dark teal and the button's orange: any colour within 40 of each (RGB distance).
const hexes = (css.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []).map((h) => (h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h))
    .map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const rgbs = (css.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/gi) || []).map((r) => r.match(/\d+/g).slice(0, 3).map(Number));
const near = (t) => [...hexes, ...rgbs].some((c) => Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]) < 40);
if (!near([0x0f, 0x4c, 0x5c])) fails.push('no colour near the header\'s #0f4c5c');
if (!near([0xe3, 0x64, 0x14])) fails.push('no colour near the button\'s #e36414');
console.log(JSON.stringify({ pass: fails.length === 0, fails, texts: `${want.length - missing.length}/${want.length}` }));
process.exit(fails.length ? 1 : 0);
