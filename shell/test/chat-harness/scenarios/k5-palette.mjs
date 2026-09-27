// @ts-check
// K5-U2 (addendum KE-2, KE-6): the ＋ menu, grouped and searchable, and the first-run offer — in
// the real browser, reached the way a PERSON reaches them (build rule 6): the ＋ is CLICKED, the
// search box is TYPED into, a row is CLICKED or chosen with the arrows and Enter, the canvas is
// DOUBLE-CLICKED and RIGHT-CLICKED, the offer's buttons are CLICKED. `h.computer.place()` is never
// used to make a box under test here.
//
// The owner's bug report this phase answers: "I do not see the coding in p5js or threejs nodes, or
// the svg write and svg render nodes, don't see them anywhere." Each of those boxes is created
// below by clicking through the menu, by name.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The Computer, shown, a document open, the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();
    return true;
}

/** The label a string key resolves to in the page. */
const say = (/** @type {any} */ h, /** @type {string} */ key) => h.eval((k) => window.LolComputer.app.t(k), key);

/** A box's title as drawn. */
const titleOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const el = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-part-title');
    return el ? el.textContent : null;
}, id);

/** Where the open menu is, against the canvas root it must stay inside. */
const menuBox = (/** @type {any} */ h) => h.eval(() => {
    const m = document.querySelector('#lolcomputer .graph-add-menu');
    const root = document.querySelector('#lolcomputer .graph');
    const canvas = document.querySelector('#lolcomputer .graph-canvas');
    if (!m || !root || !canvas) return null;
    const r = (/** @type {Element} */ el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height }; };
    const search = m.querySelector('.graph-add-search');
    return {
        open: !(/** @type {any} */ (m)).hidden,
        menu: r(m), root: r(root), canvas: r(canvas),
        focused: document.activeElement === search,
        display: getComputedStyle(m).display,
    };
});

/** The welcome panel as painted (the CSS may hide it while the ＋ menu is open). */
const welcomePainted = (/** @type {any} */ h) => h.eval(() => {
    const el = document.querySelector('#lolcomputer .comp-welcome');
    return !!el && !(/** @type {any} */ (el)).hidden && getComputedStyle(el).display !== 'none';
});

export default [
    {
        name: 'k5-palette-every-creative-box-by-clicking-its-name',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const rows = await h.computer.menu.open();
            h.eq((await h.computer.menu.groups()).map((/** @type {any} */ g) => g.group).join(','),
                'bring,think,show,control,annotate', 'grouped, in the frozen order');
            const groups = await h.computer.menu.groups();
            h.assert(groups.every((/** @type {any} */ g) => g.label && g.label !== g.group), 'each group has a heading a person can read');
            h.assert(rows.every((/** @type {any} */ r) => r.glyph && r.label && r.desc.length > 10), 'every row: a glyph, a name, a one-liner');
            const show = rows.filter((/** @type {any} */ r) => r.group === 'show').map((/** @type {any} */ r) => r.entry);
            h.eq(show.join(','), 'p5,three,svg,html,markdown,preview,code', 'the named boxes lead Show; the generic Preview follows');

            // The fix pass: Show is below nine Think rows, so the boxes that draw with code — the
            // ones the owner could not find — are ALSO a strip at the top, inside the menu's
            // visible rect the moment it opens, without scrolling or typing.
            const strip = await h.eval(() => {
                const m = document.querySelector('#lolcomputer .graph-add-menu:not([hidden])');
                if (!m) return null;
                const mr = m.getBoundingClientRect();
                return Array.from(m.querySelectorAll('.graph-add-quick')).map((b) => {
                    const r = b.getBoundingClientRect();
                    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    return {
                        entry: b.getAttribute('data-entry'),
                        name: ((b.querySelector('.graph-add-quick-name') || {}).textContent) || '',
                        seen: r.width > 0 && r.height > 0 && r.top >= mr.top && r.bottom <= mr.bottom && r.left >= mr.left && r.right <= mr.right
                            && !!hit && (hit === b || b.contains(hit)),
                    };
                });
            });
            h.eq((strip || []).map((/** @type {any} */ q) => q.entry).join(','), 'p5,three,svg,html', 'the strip: the four boxes that draw with code');
            for (const q of strip) h.assert(q.seen, `${q.entry} ("${q.name}") is on screen when the menu opens: ${JSON.stringify(strip)}`);
            h.eq(strip[0].name, await say(h, 'parts.creativeP5Label'), 'named as in Show');
            const before = (await h.computer.doc()).parts.map((/** @type {any} */ p) => p.id);
            await h.click('#lolcomputer .graph-add-menu:not([hidden]) .graph-add-quick[data-entry="p5"]');
            const placed = (await h.computer.doc()).parts.find((/** @type {any} */ p) => before.indexOf(p.id) < 0);
            h.assert(!!placed && placed.type === 'preview' && placed.settings.mode === 'p5', 'clicking the p5.js sketch in the strip placed one');
            h.eq(await h.computer.menu.isOpen(), false, 'and closed the menu');
            await h.computer.remove([placed.id]);
            await h.computer.menu.open();
            await h.computer.menu.search('p5');
            h.eq(await h.eval(() => {
                const q = document.querySelector('#lolcomputer .graph-add-menu:not([hidden]) .graph-add-quicks');
                return !!q && getComputedStyle(q).display === 'none';
            }), true, 'a search hides the strip — the ranked rows are the answer');
            await h.computer.menu.key('Escape');

            // The five creative boxes, each by clicking ＋ and then its name.
            const boxes = [
                { entry: 'p5', mode: 'p5', label: 'parts.creativeP5Label' },
                { entry: 'three', mode: 'three', label: 'parts.creativeThreeLabel' },
                { entry: 'svg', mode: 'svg', label: 'parts.creativeSvgLabel' },
                { entry: 'html', mode: 'html', label: 'parts.creativeHtmlLabel' },
                { entry: 'markdown', mode: 'markdown', label: 'parts.creativeMarkdownLabel' },
            ];
            for (const b of boxes) {
                const id = await h.computer.add(b.entry);
                h.assert(!!id, `clicking "${b.entry}" in the ＋ menu placed a box`);
                const part = (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === id);
                h.eq(part.type, 'preview', `${b.entry} is a Preview preset`);
                h.eq(part.settings.mode, b.mode);
                h.assert(String(part.settings.source || '').trim().length > 0, `${b.entry} comes with starter code`);
                h.eq(await titleOf(h, id), await say(h, b.label), `${b.entry} is titled by its name`);
            }

            // The four Write-… boxes, found by what a person would type.
            const writes = [
                { entry: 'write-p5', query: 'write p5', code: 'p5' },
                { entry: 'write-three', query: 'write three', code: 'three' },
                { entry: 'write-svg', query: 'svg', code: 'svg' },
                { entry: 'write-html', query: 'html', code: 'html' },
            ];
            for (const w of writes) {
                await h.computer.menu.open();
                const found = await h.computer.menu.search(w.query);
                h.assert(found.slice(0, 2).some((/** @type {any} */ r) => r.entry === w.entry), `"${w.query}" puts ${w.entry} at the top: ${found.map((/** @type {any} */ r) => r.entry)}`);
                const id = await h.computer.menu.pick(w.entry);
                h.assert(!!id, `${w.entry} placed`);
                const part = (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === id);
                h.eq(part.type, 'ask', `${w.entry} is an Instruction preset`);
                h.eq(part.settings.code, w.code);
            }
            h.eq((await h.computer.doc()).parts.length, 9, 'nine boxes, nine clicks');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'placing boxes asks the farm nothing');
        },
    },
    {
        name: 'k5-palette-type-to-search-and-the-keyboard',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            await h.computer.menu.open();
            let box = await menuBox(h);
            h.assert(box && box.open && box.display !== 'none', 'the ＋ opened the menu, painted');
            h.assert(box.focused, 'the search box has the focus: a person can type at once');
            h.eq(await h.eval(() => document.querySelector('#lolcomputer .graph-add').getAttribute('aria-expanded')), 'true');

            // A typo still finds the sketch, and it is the row Enter adds.
            let rows = await h.computer.menu.search('skecth');
            h.eq(rows[0].entry, 'p5', `"skecth" finds the p5.js sketch first: ${rows.map((/** @type {any} */ r) => r.entry)}`);
            h.eq(rows[0].active, true, 'the best match is already the keyboard row');
            h.eq((await h.computer.menu.groups()).length, 0, 'a search ranks across groups — no headings');
            h.assert(await h.eval(() => !!document.querySelector('#lolcomputer .graph-add-item[data-entry="p5"] .graph-add-tag')), 'and each found row names its group');
            await h.screenshot('k5-palette-search-typo');

            rows = await h.computer.menu.search('picture');
            const pics = rows.map((/** @type {any} */ r) => r.entry);
            h.assert(pics.includes('image') && pics.includes('svg'), `"picture" finds Image and SVG: ${pics}`);
            rows = await h.computer.menu.search('prompt');
            h.eq(rows[0].entry, 'ask', '"prompt" finds the Instruction');

            rows = await h.computer.menu.search('xyzzy');
            h.eq(rows.length, 0);
            const empty = await h.eval(() => {
                const e = document.querySelector('#lolcomputer .graph-add-menu:not([hidden]) .graph-add-empty');
                return e ? e.textContent : null;
            });
            h.assert(!!empty && empty.includes('xyzzy'), `nothing found says so: ${empty}`);

            // The arrows move the keyboard row; Enter adds it.
            rows = await h.computer.menu.search('svg');
            h.eq(rows[0].entry, 'svg');
            await h.computer.menu.key('ArrowDown');
            rows = await h.computer.menu.rows();
            h.eq(rows.find((/** @type {any} */ r) => r.active).entry, rows[1].entry, 'ArrowDown moved to the second row');
            await h.computer.menu.key('ArrowUp');
            await h.computer.menu.key('Enter');
            h.eq(await h.computer.menu.isOpen(), false, 'Enter adds and closes');
            let doc = await h.computer.doc();
            h.eq(doc.parts.length, 1);
            h.eq(doc.parts[0].settings.mode, 'svg', 'Enter added the SVG box');

            // Escape closes and adds nothing; it never stops a run (the menu keeps it).
            await h.computer.menu.open();
            await h.computer.menu.search('timer');
            await h.computer.menu.key('Escape');
            h.eq(await h.computer.menu.isOpen(), false, 'Escape closes');
            h.eq((await h.computer.doc()).parts.length, 1, 'and adds nothing');
            h.eq(await h.eval(() => document.querySelector('#lolcomputer .graph-add').getAttribute('aria-expanded')), 'false');

            // The ＋ toggles; a press elsewhere closes it.
            await h.computer.menu.open();
            await h.click('#lolcomputer .graph-add');
            h.eq(await h.computer.menu.isOpen(), false, 'a second click on ＋ closes it');
            await h.computer.menu.open();
            await h.eval(() => {
                const c = document.querySelector('#lolcomputer .graph-canvas');
                c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
                c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
                return true;
            });
            h.eq(await h.computer.menu.isOpen(), false, 'a press on the canvas closes it');

            // Show me, from a lesson: the menu opens with that row marked.
            await h.eval(() => window.LolComputer.app.host.canvas.openPalette({ highlight: 'write-svg' }));
            rows = await h.computer.menu.rows();
            h.eq(rows.find((/** @type {any} */ r) => r.active).entry, 'write-svg', 'the highlighted row is the keyboard row');
            h.assert(await h.eval(() => {
                const b = document.querySelector('#lolcomputer .graph-add-item[data-entry="write-svg"]');
                if (!b || b.getAttribute('data-hint') !== 'true') return false;
                const list = document.querySelector('#lolcomputer .graph-add-list');
                const lr = list.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                return br.top >= lr.top - 1 && br.bottom <= lr.bottom + 1;
            }), 'marked, and scrolled into view');
            await h.computer.menu.key('Escape');
            doc = await h.computer.doc();
            h.eq(doc.parts.length, 1);
        },
    },
    {
        name: 'k5-palette-opens-where-you-click-and-stays-on-screen',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            // A double-click on empty canvas: the menu at the pointer, the pick at the pointer.
            const at = await h.computer.menu.openAt(120, 90);
            h.eq(at.open, true, 'a double-click on empty canvas opens the ＋ menu');
            let box = await menuBox(h);
            const px = box.canvas.left + 120;
            const py = box.canvas.top + 90;
            h.assert(Math.abs(box.menu.left - px) <= 2 && (Math.abs(box.menu.top - py) <= 2 || Math.abs(box.menu.bottom - py) <= 2),
                `it opens at the pointer (below it, or above it in a short window): ${JSON.stringify(box.menu)} vs canvas ${JSON.stringify(box.canvas)}`);
            h.assert(box.focused, 'ready to type');
            const view = (await h.computer.state()).view;
            const p5 = await h.computer.menu.pick('p5');
            let part = (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === p5);
            const wx = (120 - view.x) / view.zoom;
            const wy = (90 - view.y) / view.zoom;
            h.assert(Math.abs(part.x - wx) <= 30 && Math.abs(part.y - wy) <= 30, `the box lands where the double-click was: part ${part.x},${part.y} vs ${wx},${wy}`);

            // A right-click in the bottom-right corner: the menu opens up-and-left, whole.
            const size = await h.eval(() => {
                const c = document.querySelector('#lolcomputer .graph-canvas').getBoundingClientRect();
                return { w: c.width, h: c.height };
            });
            const corner = await h.computer.menu.openAt(size.w - 12, size.h - 12, 'contextmenu');
            h.eq(corner.open, true, 'a right-click on empty canvas opens it too');
            box = await menuBox(h);
            const inside = box.menu.left >= box.root.left - 1 && box.menu.top >= box.root.top - 1
                && box.menu.right <= box.root.right + 1 && box.menu.bottom <= box.root.bottom + 1;
            h.assert(inside, `kept whole inside the canvas: menu ${JSON.stringify(box.menu)} root ${JSON.stringify(box.root)}`);
            h.assert(box.menu.right <= box.canvas.left + size.w - 12 + 2, 'past the right edge it opens to the LEFT of the pointer');
            const three = await h.computer.menu.pick('three');
            h.assert(!!three, 'and a pick from it places a box');
            // K5 landing: and that box lands wholly in view, not with its top-left in the corner.
            const cv = (await h.computer.state()).view;
            const tp = (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === three);
            const sx = tp.x * cv.zoom + cv.x;
            const sy = tp.y * cv.zoom + cv.y;
            h.assert(sx >= 0 && sy >= 0 && sx + tp.w * cv.zoom <= size.w + 1 && sy + tp.h * cv.zoom <= size.h + 1,
                `the corner pick lands wholly in view: ${Math.round(sx)},${Math.round(sy)} ${tp.w}x${tp.h} in ${size.w}x${size.h}`);
            await h.screenshot('k5-palette-after-corner-pick');

            // A double-click ON a box is the box's own gesture, not the menu's.
            await h.eval((pid) => {
                const el = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-part-title')
                    || document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"]');
                el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
                return true;
            }, p5);
            h.eq(await h.computer.menu.isOpen(), false, 'a double-click on a box does not open the menu');

            // The menu grows no taller than the canvas: a short window still shows search + rows.
            await h.computer.menu.open();
            box = await menuBox(h);
            h.assert(box.menu.bottom <= box.root.bottom + 1, `the toolbar's menu fits the canvas height: ${JSON.stringify(box.menu)}`);
            await h.screenshot('k5-palette-menu-open');
            await h.computer.menu.key('Escape');
            part = (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === three);
            h.assert(!!part && part.settings.mode === 'three');
        },
    },
    {
        name: 'k5-palette-first-run-offer-on-an-empty-canvas',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            let w = await h.computer.welcome.state();
            h.eq(w.shown, true, 'a new, empty graph offers a start instead of blank dots');
            h.eq(w.actions.join(','), 'tour,template,add');
            h.eq(await welcomePainted(h), true, 'and it is painted');
            const panel = await h.eval(() => {
                const el = document.querySelector('#lolcomputer .comp-welcome');
                return {
                    title: (el.querySelector('.comp-welcome-title') || {}).textContent || '',
                    tip: (el.querySelector('.comp-welcome-tip') || {}).textContent || '',
                    picks: Array.from(el.querySelectorAll('.comp-welcome-pick')).filter((b) => !(/** @type {any} */ (b)).hidden).map((b) => b.getAttribute('data-entry')),
                };
            });
            h.assert(panel.title.length > 0 && panel.tip.length > 10, 'a title and the double-click tip');
            h.eq(panel.picks.join(','), 'note,ask,p5,three,svg', 'quick picks, the creative boxes among them');
            await h.screenshot('k5-palette-welcome');

            // "Add your first box" opens the ＋ menu; the offer steps back while it is open.
            await h.computer.welcome.press('add');
            h.eq(await h.computer.menu.isOpen(), true, 'Add your first box opens the ＋ menu');
            h.eq(await welcomePainted(h), false, 'the offer steps back while the menu is open');
            await h.computer.menu.key('Escape');
            h.eq(await welcomePainted(h), true, 'and comes back when it closes on nothing');

            // A double-click on the canvas AROUND the offer still opens the menu there.
            const around = await h.computer.menu.openAt(30, 30);
            h.eq(around.open, true, 'the offer covers only itself');
            await h.computer.menu.key('Escape');

            // A quick pick places that box in the middle of the view; the offer steps aside.
            await h.click('#lolcomputer .comp-welcome:not([hidden]) .comp-welcome-pick[data-entry="svg"]');
            let doc = await h.computer.doc();
            h.eq(doc.parts.length, 1, 'one click, one box');
            h.eq(doc.parts[0].type, 'preview');
            h.eq(doc.parts[0].settings.mode, 'svg', 'the SVG box, with its preset');
            w = await h.computer.welcome.state();
            h.eq(w.shown, false, 'a canvas with a box has no offer');

            // Empty again (undo), the offer is back.
            await h.computer.undo();
            await h.waitFor(() => {
                const el = document.querySelector('#lolcomputer .comp-welcome');
                return el && !(/** @type {any} */ (el)).hidden ? true : null;
            }, { timeout: 5000 });

            // "Open a template" shows the template shelf.
            await h.computer.welcome.press('template');
            const shelf = await h.waitFor(() => {
                const el = document.querySelector('#lolcomputer .comp-template[data-template]');
                return el && (/** @type {any} */ (el)).offsetParent ? true : null;
            }, { timeout: 5000 });
            h.eq(shelf, true, 'the templates are on screen');

            // "Take the tour" opens the Tour, which has boxes — so the offer steps aside.
            await h.computer.welcome.press('tour');
            await h.waitFor(() => {
                const a = window.LolComputer.app.tutorial && window.LolComputer.app.tutorial.active();
                return a && a.lessonId === 'l00-tour' ? true : null;
            }, { timeout: 10000 });
            await h.waitFor(() => {
                const el = document.querySelector('#lolcomputer .comp-welcome');
                return el && (/** @type {any} */ (el)).hidden ? true : null;
            }, { timeout: 5000 });
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'the first-run offer asks the farm nothing');
        },
    },
];
