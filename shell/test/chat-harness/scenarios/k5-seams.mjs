// @ts-check
// K5 kickoff (addendum KE): the SEAMS between the four K5 units, in the real browser, reached the
// way a person reaches them (build rule 6) — the ＋ menu is CLICKED, a row is CLICKED, the canvas
// is DOUBLE-CLICKED, the Learn shelf is CLICKED. Integrator-owned; each unit has its own scenario
// file (k5-creative, k5-palette, k5-tutorial, k5-lessons) for the depth.
//
// It exists because the owner could not find the p5/three/SVG boxes that already worked: this is
// the regression test for "a capability nobody can reach".

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The Computer, shown, with a document open and the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();
    return true;
}

/** A box's title as drawn. */
const titleOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const el = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-part-title');
    return el ? el.textContent : null;
}, id);

export default [
    {
        name: 'k5-seams-the-plus-menu-offers-the-creative-boxes-by-name',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const welcome = await h.computer.welcome.state();
            h.eq(welcome.shown, true, 'an empty canvas offers something instead of blank dots');
            h.eq(welcome.actions.join(','), 'tour,template,add', 'the three first-run actions are there');

            const rows = await h.computer.menu.open();
            h.eq((await h.computer.menu.groups()).map((/** @type {any} */ g) => g.group).join(','),
                'bring,think,show,control,annotate', 'the ＋ menu is grouped, in the frozen order');
            const show = rows.filter((/** @type {any} */ r) => r.group === 'show').map((/** @type {any} */ r) => r.entry);
            for (const id of ['p5', 'three', 'svg', 'html', 'markdown']) h.assert(show.includes(id), `Show offers ${id}: ${show}`);
            const think = rows.filter((/** @type {any} */ r) => r.group === 'think').map((/** @type {any} */ r) => r.entry);
            for (const id of ['write-p5', 'write-three', 'write-svg', 'write-html']) h.assert(think.includes(id), `Think offers ${id}: ${think}`);
            h.assert(rows.every((/** @type {any} */ r) => r.desc.length > 0), 'every row says what it does');
            h.assert(!rows.some((/** @type {any} */ r) => ['from-thread', 'to-thread', 'render'].includes(r.type)), 'no legacy part is offered');

            const p5 = await h.computer.menu.pick('p5');
            h.assert(!!p5, 'clicking "p5.js sketch" placed a box');
            const doc = await h.computer.doc();
            const part = doc.parts.find((/** @type {any} */ p) => p.id === p5);
            h.eq(part.type, 'preview', 'a creative box is a preset of Preview (KE-2)');
            h.eq(part.settings.mode, 'p5');
            h.assert(/function setup/.test(part.settings.source), 'with starter code in it');
            h.eq(await titleOf(h, p5), await h.eval(() => window.LolComputer.app.t('parts.creativeP5Label')), 'titled by the name it was picked by');
            h.eq((await h.computer.welcome.state()).shown, false, 'the first-run offer steps aside once there is a box');

            // A search finds a box by what it does, and a double-click on empty canvas opens the SAME menu.
            await h.computer.menu.open();
            const found = (await h.computer.menu.search('svg')).map((/** @type {any} */ r) => r.entry);
            h.assert(found.includes('svg') && found.includes('write-svg'), `"svg" finds both SVG rows: ${found}`);
            await h.computer.menu.key('Escape');
            h.eq(await h.computer.menu.isOpen(), false, 'Escape closes it');
            const at = await h.computer.menu.openAt(40, 40);
            h.eq(at.open, true, 'a double-click on empty canvas opens the ＋ menu there');
            const svg = await h.computer.menu.pick('svg');
            const placed = (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === svg);
            h.assert(!!placed && placed.settings.mode === 'svg', 'and the pick lands as an SVG box');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'placing boxes asks the farm nothing');
        },
    },
    {
        name: 'k5-seams-write-an-svg-into-an-svg-box-draws-the-models-picture',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const write = await h.computer.add('write-svg', { query: 'write an svg' });
            h.assert(!!write, 'Write an SVG was found by search and placed');
            const svg = await h.computer.add('svg');
            await h.computer.move(svg, 520, 40);
            await h.computer.set(write, { model: 'mock-code' });   // setup: the deterministic mock model
            h.eq((await h.computer.wire(write, svg, 'content')).ok, true, 'Write an SVG wires into the SVG box');
            await h.computer.play(svg);
            await h.waitFor(() => {
                const doc = window.LolComputer.debug.computer.doc();
                const p = doc.parts.find((/** @type {any} */ x) => x.type === 'preview');
                return p && (p.state === 'done' || p.state === 'error') ? p.state : null;
            }, { timeout: 60000 });
            const doc = await h.computer.doc();
            const answer = doc.parts.find((/** @type {any} */ p) => p.id === write);
            const box = doc.parts.find((/** @type {any} */ p) => p.id === svg);
            h.eq(box.state, 'done', `the SVG box drew: ${box.error || ''}`);
            h.assert(/^<svg/.test(String(answer.value && answer.value.data)), 'the answer arrived CLEAN — the markdown fence is gone');
            h.eq(answer.value.format, 'svg', 'stamped as SVG');
            const src = await h.eval((pid) => {
                const img = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] img');
                return img ? img.getAttribute('src') : '';
            }, svg);
            h.assert(/^data:image\/svg\+xml/.test(String(src)), 'and the box shows the picture');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 1, 'exactly one generation');
        },
    },
    {
        name: 'k5-seams-the-learn-shelf-opens-a-lesson-with-its-rail',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const learn = await h.eval(() => {
                const el = document.querySelector('#lolcomputer .comp-learn');
                return el ? { text: el.textContent, visible: !!(/** @type {any} */ (el).offsetParent) } : null;
            });
            h.assert(!!learn && learn.visible, 'a visible Learn entry point in the sidebar');
            await h.computer.tutorial.openLesson('l01-hello-farm');
            await h.waitFor(() => {
                const rail = document.querySelector('#lolcomputer .comp-rail');
                return rail && !rail.classList.contains('hidden') ? true : null;
            }, { timeout: 10000 });
            let rail = await h.computer.tutorial.rail();
            h.eq(rail.lesson, 'l01-hello-farm');
            h.assert(/1/.test(String(rail.step)), `the rail is on step 1: ${rail.step}`);
            const doc = await h.computer.doc();
            h.assert(doc.parts.some((/** @type {any} */ p) => p.id === 'p_ask'), 'the fork kept the AUTHORED part ids');
            await h.computer.set('p_ask', { instruction: 'A haiku about the sea.' });
            await h.waitFor(() => {
                const s = document.querySelector('#lolcomputer .comp-rail .comp-rail-step');
                return s && /2/.test(s.textContent || '') ? true : null;
            }, { timeout: 5000 });
            rail = await h.computer.tutorial.rail();
            h.assert(/2/.test(String(rail.step)), `typing the instruction ticked step 1: ${rail.step}`);
        },
    },
];
