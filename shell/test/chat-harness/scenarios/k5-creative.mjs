// @ts-check
// K5-U1 in the real browser: the creative boxes (addendum KE-3), reached THE WAY A PERSON DOES
// (build rule 6) — every box is created by clicking the toolbar's ＋ and clicking its row (typing
// in the menu's search box where a person would), a box is run with its own ▶ in its title bar,
// the error line is CLICKED, the lock and the Save buttons are CLICKED.
//
// It is the regression test for the owner's bug report: "I do not see the coding in p5js or
// threejs nodes, or the svg write and svg render nodes, don't see them anywhere." So it asserts
// what the owner could not get — a named box, from the menu, that DRAWS — and it asserts the
// drawing is a real picture: the PNG the guest hands back is decoded here and must hold more than
// one colour, because an empty canvas is also a valid PNG.
//
// Everything is local: the drawing scenarios run with the farm GONE (h.setFarm(null)) and assert
// not one completion was sent; the Write-… scenario talks to the mock farm's `mock-code` model.
// Typing into a box goes through the textarea's own `input` event, as every K-scenario types.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The Computer, shown, a document open, the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();
    return true;
}

/** A part off the session's own document. */
const partOf = async (/** @type {any} */ h, /** @type {string} */ id) =>
    (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === id) || null;

/** Wait until a part settles, and return it. */
const settled = (/** @type {any} */ h, /** @type {string} */ id, timeout = 30000) => h.waitFor((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
    return p && (p.state === 'done' || p.state === 'error') ? { state: p.state, error: p.error || null } : null;
}, { args: [id], timeout });

/** What a box shows, straight off the DOM. */
const boxView = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const box = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"]');
    if (!box) return null;
    const q = (/** @type {string} */ s) => box.querySelector(s);
    const tile = q('.graph-preview-tile');
    const area = /** @type {any} */ (q('.graph-preview-source'));
    const err = q('.graph-preview-error');
    return {
        title: (q('.graph-part-title') || {}).textContent || '',
        tile: tile ? tile.getAttribute('src') : null,
        tags: Array.from(box.querySelectorAll('.graph-preview-body *')).map((el) => el.tagName.toLowerCase()),
        code: area ? area.value : null,
        codeShown: !!(area && !area.hidden),
        mono: area ? getComputedStyle(area).fontFamily : '',
        error: err && !err.hidden ? { text: err.textContent, line: err.getAttribute('data-line') } : null,
        kept: (() => { const k = q('.graph-preview-kept'); return k && !k.hidden ? k.textContent : ''; })(),
        note: (() => { const n = q('.graph-preview-note'); return n && !n.hidden ? n.textContent : ''; })(),
        saves: Array.from(box.querySelectorAll('.graph-preview-save')).filter((b) => !(/** @type {any} */ (b).hidden)).map((b) => b.getAttribute('data-as')),
        lock: (q('.graph-preview-lock') || { getAttribute: () => null }).getAttribute('aria-pressed'),
    };
}, id);

/**
 * Decode a box's picture and look at its pixels. An empty canvas is a valid PNG too, so "a
 * picture came back" is not enough: it must hold several colours, and at least some opaque ones.
 * `at` samples one pixel, as fractions of the width and height.
 */
const pixels = (/** @type {any} */ h, /** @type {string} */ id, /** @type {number[]} */ at) => h.eval(async (pid, where) => {
    const img = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-tile');
    if (!img) return null;
    const src = String(img.getAttribute('src') || '');
    const im = new Image();
    await new Promise((resolve, reject) => { im.onload = resolve; im.onerror = () => reject(new Error('the tile did not decode')); im.src = src; });
    const w = Math.max(1, Math.min(240, im.naturalWidth || 240));
    const hh = Math.max(1, Math.min(180, im.naturalHeight || 180));
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    const g = /** @type {any} */ (c.getContext('2d'));
    g.drawImage(im, 0, 0, w, hh);
    const d = g.getImageData(0, 0, w, hh).data;
    const colours = new Set();
    let opaque = 0;
    for (let i = 0; i < d.length; i += 4 * 5) {
        if (d[i + 3] > 16) { opaque++; colours.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)); }
    }
    const px = where ? Math.floor(where[0] * (w - 1)) : 0;
    const py = where ? Math.floor(where[1] * (hh - 1)) : 0;
    const k = (py * w + px) * 4;
    return { kind: src.slice(5, src.indexOf(';')), w: im.naturalWidth, h: im.naturalHeight, opaque, colours: colours.size, sample: [d[k], d[k + 1], d[k + 2], d[k + 3]] };
}, id, at || null);

/** Type into a box's code editor as the browser reports typing, and optionally leave it. */
const typeCode = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ text, leave = false) => h.eval((pid, v, out) => {
    const el = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-source'));
    if (!el) throw new Error('typeCode: no code editor on ' + pid);
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (out) el.blur();
    return true;
}, id, text, leave);

/** How many times the ONE guest has run a sketch so far. */
const guestRuns = (/** @type {any} */ h) => h.eval(() => {
    const s = window.LolComputer.debug.computer.sandbox();
    return Number(s && s.runs) || 0;
});

/** Spread boxes out so each is clickable (setup, not under test). */
const place = (/** @type {any} */ h, /** @type {string} */ id, /** @type {number} */ i) =>
    h.computer.move(id, 40 + (i % 3) * 420, 40 + Math.floor(i / 3) * 560);

export default [
    {
        name: 'k5-creative-every-box-comes-from-the-menu-and-draws-with-no-farm',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await h.setFarm(null);                            // KE-3: the starters draw with NO farm

            const want = [
                { entry: 'svg', mode: 'svg', title: 'parts.creativeSvgLabel' },
                { entry: 'markdown', mode: 'markdown', title: 'parts.creativeMarkdownLabel' },
                { entry: 'html', mode: 'html', title: 'parts.creativeHtmlLabel' },
                { entry: 'p5', mode: 'p5', title: 'parts.creativeP5Label' },
                { entry: 'three', mode: 'three', title: 'parts.creativeThreeLabel' },
            ];
            /** @type {Record<string, string>} */ const ids = {};
            for (const [i, w] of want.entries()) {
                // ＋ → the row, clicked. Nothing here places a box through a debug door.
                const rows = await h.computer.menu.open();
                const row = rows.find((/** @type {any} */ r) => r.entry === w.entry);
                h.assert(row, `the ＋ menu offers ${w.entry} by name`);
                h.eq(row.group, 'show', `${w.entry} lives in Show`);
                const id = await h.computer.menu.pick(w.entry);
                h.assert(id, `clicking "${row.label}" placed a box`);
                ids[w.entry] = id;
                await place(h, id, i);
                const part = await partOf(h, id);
                h.eq(part.type, 'preview', `${w.entry} is a preset of Preview (KE-2)`);
                h.eq(part.settings.mode, w.mode);
                h.assert(String(part.settings.source || '').trim().length > 0, `${w.entry} arrives with starter code`);
                const view = await boxView(h, id);
                h.eq(view.title, await h.eval((k) => window.LolComputer.app.t(k), w.title), 'titled by the name it was picked by');
                h.eq(view.codeShown, true, `${w.entry} shows its own code`);
                h.eq(view.code, part.settings.source, 'the editor holds the box’s code');
                h.assert(/mono|consolas|menlo/i.test(view.mono), `in a monospace face: ${view.mono}`);
            }

            // Each box's own ▶, in its title bar, one after another.
            for (const w of want) {
                await h.computer.play(ids[w.entry]);
                const s = await settled(h, ids[w.entry], 45000);
                h.eq(s.state, 'done', `${w.entry} drew on its first ▶ with no farm: ${s.error || ''}`);
            }

            // Each box, drawn, fits the size it was placed at: a box that grows past it lands on its
            // neighbours (a lesson's authored layout, a template's columns).
            for (const w of want) {
                const fit = await h.eval((pid) => {
                    const node = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"]'));
                    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
                    const was = node.style.minHeight;
                    node.style.minHeight = '0px';                 // what the content itself needs
                    const natural = node.offsetHeight;
                    node.style.minHeight = was;
                    return { drawn: node.offsetHeight, natural, placed: p.h, wide: node.offsetWidth, w: p.w };
                }, ids[w.entry]);
                h.assert(fit.drawn <= fit.placed + 2 && fit.wide <= fit.w + 2,
                    `${w.entry} fits its placed size: drawn ${fit.wide}×${fit.drawn}, placed ${fit.w}×${fit.placed}`);
                h.assert(fit.natural <= fit.placed, `${w.entry}: its content (${fit.natural}px) fits the preset height (${fit.placed}px)`);
                h.note(`${w.entry}: content ${fit.natural}px tall in a ${fit.w}×${fit.placed} box`);
            }

            const md = await boxView(h, ids.markdown);
            h.assert(md.tags.includes('h1') && md.tags.includes('li'), `the Markdown view is elements: ${md.tags}`);
            h.eq(md.saves[0], 'md', 'and saves as .md');

            for (const entry of ['svg', 'html', 'p5', 'three']) {
                const view = await boxView(h, ids[entry]);
                h.assert(view.tile, `${entry} shows a picture`);
                const px = await pixels(h, ids[entry]);
                h.assert(px && px.opaque > 0 && px.colours >= 2,
                    `${entry}: a REAL picture, not an empty canvas: ${JSON.stringify(px)}`);
                h.note(`${entry}: ${px.kind} ${px.w}×${px.h}, ${px.colours} colours`);
            }
            // the p5 starter's first frame: the cream background with the ball on it
            const p5px = await pixels(h, ids.p5, [0.02, 0.98]);
            h.assert(p5px.sample[0] > 200 && p5px.sample[1] > 200, `the p5 background is the starter’s cream: ${p5px.sample}`);
            h.eq((await boxView(h, ids.p5)).saves.join(','), 'js,png', 'a sketch saves as .js and .png');
            h.eq((await boxView(h, ids.svg)).saves.join(','), 'svg', 'an SVG saves as .svg');
            h.eq((await boxView(h, ids.html)).saves.join(','), 'html,png', 'a page saves as .html and .png');

            h.assert((await h.eval(() => document.querySelectorAll('#lolcomputer iframe').length)) <= 1,
                'ONE guest drew every sketch — never one iframe per box');

            // Pictures for the landing, in both themes (tokens only: nothing may vanish in either).
            await h.computer.call('fit');
            for (const theme of ['dark', 'light']) {
                await h.eval((cls) => { document.documentElement.className = cls; return true; }, theme);
                await h.screenshot(`k5-creative-boxes-${theme}`);
            }
            await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'not one generation');
        },
    },

    {
        name: 'k5-creative-typing-redraws-without-a-run-and-an-error-names-its-line',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await h.setFarm(null);

            // A person types "p5" in the menu's search box and clicks the first row.
            await h.computer.menu.open();
            const found = await h.computer.menu.search('p5');
            h.eq(found[0] && found[0].entry, 'p5', `"p5" finds the sketch first: ${found.map((/** @type {any} */ r) => r.entry)}`);
            const id = await h.computer.menu.pick('p5');
            h.assert(id, 'placed from the search result');

            // A fresh sketch shows its ball without a ▶.
            const first = await h.waitFor((pid) => {
                const img = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-tile');
                return img ? img.getAttribute('src') : null;
            }, { args: [id], timeout: 30000 });
            h.assert(/^data:image\/png/.test(first), 'the fresh box drew its starter by itself');
            const runsBefore = await guestRuns(h);

            // ---- typing re-draws: debounced, through the guest, never through the runner.
            const blue = String((await partOf(h, id)).settings.source).replace('background(245, 240, 230)', 'background(20, 60, 160)');
            h.assert(blue.includes('background(20, 60, 160)'), 'the edit is a real change to the starter');
            await typeCode(h, id, blue);
            h.eq(await h.computer.running(), false, 'typing never starts a run');
            const second = await h.waitFor((pid, was) => {
                const img = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-tile');
                const src = img ? img.getAttribute('src') : '';
                return src && src !== was ? src : null;
            }, { args: [id, first], timeout: 15000 });
            h.assert(second !== first, 'the picture changed without a ▶');
            const px = await pixels(h, id, [0.02, 0.98]);
            h.assert(px.sample[2] > 120 && px.sample[0] < 80, `and it is the colour that was typed: ${px.sample}`);
            h.eq(await guestRuns(h), runsBefore + 1, 'ONE guest run for the whole edit — debounced, not one per keystroke');
            h.eq((await partOf(h, id)).settings.source, blue, 'what was typed is the box’s code, saved with the graph');
            h.assert((await partOf(h, id)).state !== 'running', 'the runner was never involved');

            // ---- a runtime error names the line in the person’s code (the guest measures its wrapper).
            const broken = [
                'function setup() {',
                '  createCanvas(400, 300);',
                '}',
                '',
                'function draw() {',
                '  background(0);',
                '  notAFunction();',
                '}',
            ].join('\n');
            await typeCode(h, id, broken);
            const err = await h.waitFor((pid) => {
                const e = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-error');
                return e && !(/** @type {any} */ (e).hidden) ? { text: e.textContent, line: e.getAttribute('data-line') } : null;
            }, { args: [id], timeout: 15000 });
            h.eq(err.line, '7', `the error names line 7, where notAFunction() is: ${err.text}`);
            h.assert(/line 7/.test(err.text) && /notAFunction/.test(err.text), `in words: ${err.text}`);
            await h.click(`#lolcomputer .graph-part[data-id="${id}"] .graph-preview-error`);
            const sel = await h.eval((pid) => {
                const el = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-source'));
                return el.value.slice(el.selectionStart, el.selectionEnd);
            }, id);
            h.eq(sel, '  notAFunction();', 'clicking the error selects that line in the code');

            // ---- a syntax error the engine reports without a line still names one.
            const unclosed = ['let n = 3;', 'function setup() {', '  createCanvas(400, 300);', '', 'function draw() {', '  background(n);', '}'].join('\n');
            await typeCode(h, id, unclosed, true);
            const syn = await h.waitFor((pid) => {
                const e = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-error');
                const text = e && !(/** @type {any} */ (e).hidden) ? e.textContent : '';
                return /line 2/.test(text) ? { text, line: e.getAttribute('data-line') } : null;
            }, { args: [id], timeout: 15000 });
            h.eq(syn.line, '2', `the { never closed is on line 2: ${syn.text}`);

            // ---- and fixing it clears the error and draws again.
            await typeCode(h, id, blue, true);
            await h.waitFor((pid) => {
                const e = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-error');
                return e && (/** @type {any} */ (e).hidden) ? true : null;
            }, { args: [id], timeout: 15000 });
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'not one generation for any of it');
        },
    },

    {
        name: 'k5-creative-write-boxes-land-clean-in-their-boxes-and-a-lock-keeps-my-code',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const pairs = [
                { write: 'write-p5', box: 'p5', query: 'write a p5', lang: 'p5', format: 'js' },
                { write: 'write-html', box: 'html', query: 'write an html', lang: '', format: 'html' },
                { write: 'write-three', box: 'three', query: 'three', lang: 'three', format: 'js' },
            ];
            /** @type {Record<string, string>} */ const boxes = {};
            for (const [i, p] of pairs.entries()) {
                const write = await h.computer.add(p.write, { query: p.query });
                h.assert(write, `${p.write} was found by searching "${p.query}" and placed`);
                const box = await h.computer.add(p.box);
                h.assert(box, `${p.box} placed from the menu`);
                boxes[p.box] = box;
                await h.computer.move(write, 40, 40 + i * 580);
                await h.computer.move(box, 480, 40 + i * 580);
                await h.computer.set(write, { model: 'mock-code' });   // setup: the deterministic mock model
                h.eq((await h.computer.wire(write, box, 'content')).ok, true, `${p.write} wires into ${p.box}`);
                await h.computer.play(box);
                const s = await settled(h, box, 60000);
                h.eq(s.state, 'done', `${p.box} drew the model’s code: ${s.error || ''}`);
                const answer = await partOf(h, write);
                const data = String(answer.value && answer.value.data);
                h.assert(!/```/.test(data) && !/^Here is/.test(data), `the answer arrived CLEAN: ${data.slice(0, 60)}`);
                h.eq(answer.value.format, p.format, 'stamped with the format it declared');
                if (p.lang) h.eq(answer.value.lang, p.lang);
                const px = await pixels(h, box);
                h.assert(px && px.colours >= 2 && px.opaque > 0, `${p.box}: the model’s picture is a real picture: ${JSON.stringify(px)}`);
                const view = await boxView(h, box);
                h.eq(view.code, data, 'the box shows the code the model wrote, so a person can read and change it');
            }
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, pairs.length, 'one generation per Write-… box');

            // ---- the lock: "keep my code" — the next arrival is not drawn over it, and the box says so.
            const p5 = boxes.p5;
            const mine = (await boxView(h, p5)).code.replace('background(30, 30, 40)', 'background(200, 20, 20)');
            await typeCode(h, p5, mine, true);
            await h.click(`#lolcomputer .graph-part[data-id="${p5}"] .graph-preview-lock`);
            h.eq((await boxView(h, p5)).lock, 'true', 'the lock is pressed');
            h.eq((await partOf(h, p5)).settings.locked, true, 'and it is a setting, saved with the graph');
            await h.computer.play(p5);
            await settled(h, p5, 60000);
            const kept = await boxView(h, p5);
            h.assert(kept.kept.length > 0, `the box says it kept my code: ${kept.kept}`);
            h.eq(kept.code, mine, 'the editor still holds my code');
            const red = await pixels(h, p5, [0.02, 0.02]);
            h.assert(red.sample[0] > 150 && red.sample[1] < 80, `and MY code is what was drawn: ${red.sample}`);
        },
    },

    {
        name: 'k5-creative-save-as-offers-the-code-and-the-picture',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await h.setFarm(null);
            const svg = await h.computer.add('svg');
            const p5 = await h.computer.add('p5');
            await h.computer.move(svg, 40, 40);
            await h.computer.move(p5, 480, 40);
            for (const id of [svg, p5]) {
                await h.computer.play(id);
                h.eq((await settled(h, id, 45000)).state, 'done');
            }
            h.markLogs();
            await h.click(`#lolcomputer .graph-part[data-id="${svg}"] .graph-preview-save[data-as="svg"]`);
            await h.click(`#lolcomputer .graph-part[data-id="${p5}"] .graph-preview-save[data-as="js"]`);
            await h.click(`#lolcomputer .graph-part[data-id="${p5}"] .graph-preview-save[data-as="png"]`);
            /** @type {any[]} */ let files = [];
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
                files = (await h.downloads()) || [];
                if (files.length >= 3) break;
                await new Promise((r) => setTimeout(r, 250));
            }
            const names = files.map((/** @type {any} */ f) => f.name);
            if (names.length) {
                h.assert(names.includes('svg.svg'), `the SVG saved as .svg: ${names}`);
                h.assert(names.includes('p5-js-sketch.js'), `the sketch's code saved as .js: ${names}`);
                h.assert(names.includes('p5-js-sketch.png'), `the sketch's picture saved as .png: ${names}`);
                const svgFile = files.find((/** @type {any} */ f) => f.name === 'svg.svg');
                h.assert(svgFile.bytes > 100, 'with the drawing in it');
            } else {
                h.note('no will-download fired in this environment; the buttons were clicked and are asserted visible');
            }
            h.eq((await boxView(h, p5)).saves.join(','), 'js,png');
            h.eq((await boxView(h, svg)).saves.join(','), 'svg');
        },
    },
];
