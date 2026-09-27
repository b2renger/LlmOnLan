// @ts-check
// K4-U3 in the real browser: the Preview family (COMPUTER_PLAN §6.5, §6.8; K4 addendum KD-6).
//
// The unit test (test/chat/unit/computer-format.test.mjs) owns the modes, the sentences and the
// marshalling against fakes. What ONLY a real browser can show, and what this file is for:
//
//   1. markdown and SVG render with NO IFRAME EVER CREATED. That is the headline of §6.5 and it is
//      a COUNT, not an opinion: `#lolcomputer iframe` before and after. One live iframe per part
//      is one process per part against a canvas that must pan 500 parts at 60 fps (§2.6 BJ-7), so
//      the two common modes must cost nothing at all.
//   2. the markdown really becomes ELEMENTS — a heading is an `<h1>`, a table is a `<table>` — and
//      it got there through render/dom.mjs, which is the only route model text may take to the DOM.
//   3. a `<script>` inside an incoming SVG is gone from the bytes the box shows AND from the bytes
//      "Save…" would write, because those bytes leave the app.
//   4. `auto` never sniffs: text that LOOKS like an SVG but declares nothing reads as markdown.
//   5. the mode a reader picked survives a save, a reload and an export — it is the program.
//   6. html/three/p5 really come back as a picture from the single guest (guarded: when the
//      sandbox cannot draw on this machine the part must FAIL VISIBLY, never pretend).
//
// Everything here is local: not one completion is sent, and the mock's counter proves it.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** A string as the page resolves it, so a test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** Fail loudly when the surface this unit decorates was faked or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`K4-U3 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    return true;
});

/** The Computer, shown, with a document open and the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();
    return true;
}

/** The live parts, by id — off the DOC, where the runner writes state/error. */
const parts = async (/** @type {any} */ h) => {
    const doc = await h.computer.doc();
    /** @type {Record<string, any>} */ const out = {};
    for (const p of doc.parts) out[p.id] = p;
    return out;
};

/** Every iframe under the Computer surface. The sandbox's guest is the only one there may be, and
 * §6.5's free modes must not add a second — or a first. */
const iframes = (/** @type {any} */ h) => h.eval(() => document.querySelectorAll('#lolcomputer iframe').length);

/** What one Preview box is actually showing, straight off the DOM. */
const shown = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((partId) => {
    const box = document.querySelector('#lolcomputer .graph-part[data-id="' + partId + '"]');
    if (!box) return null;
    const body = box.querySelector('.graph-preview-body');
    const tile = box.querySelector('.graph-preview-tile');
    const note = box.querySelector('.graph-preview-note');
    const save = box.querySelector('.graph-preview-save');
    return {
        state: box.getAttribute('data-state'),
        tags: body ? Array.from(body.querySelectorAll('*')).map((el) => el.tagName.toLowerCase()) : [],
        text: body ? body.textContent : '',
        src: tile ? tile.getAttribute('src') : null,
        note: note && !note.hidden ? note.textContent : '',
        canSave: !!(save && !save.hidden),
        // The canvas value strip: a `quiet` part draws its own value, so the strip must be silent
        // rather than printing the same report a second time under the box (KD-3).
        strip: (() => {
            const v = box.querySelector('.graph-part-value');
            return v && !v.hidden ? v.textContent : '';
        })(),
    };
}, id);

export default [
    {
        // 1-4: the two free modes, the iframe count, the sanitiser and the no-sniffing rule.
        name: 'k4-preview-free-modes-never-make-an-iframe',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const before = await iframes(h);
            h.eq(before, 0, 'a fresh Computer has no guest yet — that is the baseline this scenario measures against');

            const note = await h.computer.place('note', 40, 40);
            const box = await h.computer.place('preview', 420, 40);
            h.assert(box, 'Preview is in the palette');
            h.eq((await h.computer.wire(note, box, 'content')).ok, true, 'text wires into `content`');

            // ---- markdown, drawn here, through the safe builder.
            await h.computer.set(note, {
                text: '# Rig notes\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n',
            });
            await h.computer.set(box, { mode: 'markdown' });
            await h.computer.run({});
            let view = await shown(h, box);
            h.eq((await parts(h))[box].state, 'done', 'the window ran');
            h.assert(view.tags.includes('h1'), `the heading became an <h1>: ${JSON.stringify(view.tags)}`);
            h.assert(view.tags.includes('li'), 'and the bullets became list items');
            h.assert(view.tags.includes('table') && view.tags.includes('td'), 'and the table became a table');
            h.assert(!view.tags.includes('script'), 'nothing executable ever comes out of the markdown path');
            h.eq(view.src, null, 'markdown is nodes, not a picture');
            h.eq(view.canSave, true, 'and what is on screen can be saved');
            h.eq(view.strip, '', 'a `quiet` part does not have the canvas print its report a second time');
            h.eq(await iframes(h), before, 'MARKDOWN COST NO IFRAME');

            // ---- SVG, sanitised, shown as the bytes we encoded.
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">'
                + '<script>fetch("http://example.com")</script>'
                + '<rect width="80" height="40" fill="#123456"/></svg>';
            await h.computer.set(note, { text: svg });
            await h.computer.set(box, { mode: 'svg' });
            await h.computer.run({});
            view = await shown(h, box);
            h.eq((await parts(h))[box].state, 'done', 'the SVG was accepted');
            h.assert(String(view.src).startsWith('data:image/svg+xml'), `a picture we encoded ourselves: ${String(view.src).slice(0, 40)}`);
            const bytes = decodeURIComponent(String(view.src).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
            h.assert(!/<script/i.test(bytes), 'the script is gone from the bytes on screen');
            h.assert(!/example\.com/i.test(bytes), 'and so is what it was going to fetch');
            h.assert(/<rect/i.test(bytes), 'and it is still the drawing');
            h.eq(await iframes(h), before, 'AN SVG COST NO IFRAME EITHER');

            // ---- `auto` never sniffs the bytes (§6.5). The SAME text, undeclared, reads as prose.
            await h.computer.set(box, { mode: 'auto' });
            await h.computer.run({});
            view = await shown(h, box);
            h.eq(view.src, null, 'text that merely LOOKS like an SVG is not sniffed into svg mode');
            h.assert(view.text.length > 0, 'it is shown as what it is: text');
            h.eq(await iframes(h), before, 'and auto-on-text still costs no iframe');

            // ---- and not one generation was spent by any of it.
            const asked = await h.mock.log({ path: '/v1/chat/completions' });
            h.eq(asked.length, 0, 'a window spends no generations — §6.5, thinks:false');
        },
    },

    {
        // 5: the picked mode is the PROGRAM, and the program is what survives.
        name: 'k4-preview-the-picked-mode-survives-save-reload-and-export',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const first = await h.computer.call('docId');
            const box = await h.computer.place('preview', 120, 120);
            await h.computer.set(box, { mode: 'three', w: 640, h: 480 });
            await h.computer.save();

            const exported = await h.computer.exportText({});
            const text = typeof exported === 'string' ? exported : JSON.stringify(exported);
            h.assert(/"mode"\s*:\s*"three"/.test(text), 'the export carries the picked mode');
            h.assert(/"type"\s*:\s*"preview"/.test(text), 'and the type it belongs to');

            // Away to a second document and back: the canvas repaints from the STORE.
            const second = await h.eval(async () => {
                const dbg = window.LolComputer.debug.computer;
                const row = await window.LolComputer.app.host.store.create({ title: 'somewhere else' });
                await dbg.open(row.id);
                return row.id;
            });
            h.assert(second !== first, 'a second library document');
            await h.eval((id) => window.LolComputer.debug.computer.open(id), first);
            const state = await h.waitFor((id) => {
                const s = window.LolComputer.debug.computer.state();
                return s.docId === id ? s : null;
            }, { args: [first], timeout: 15000 });
            const back = state.parts.find((/** @type {any} */ p) => p.id === box);
            h.assert(back, 'the Preview came back');
            h.eq(back.settings.mode, 'three', 'with the mode the reader picked');
            h.eq(back.settings.w, 640, 'and the drawing size they set');
            h.eq(back.settings.h, 480);
        },
    },

    {
        // 6: the guest-drawn half. Guarded: on a machine where the sandbox cannot draw, the part
        // must fail with a SENTENCE — both outcomes are asserted and neither is silence.
        name: 'k4-preview-a-page-comes-back-as-a-picture',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const note = await h.computer.place('note', 40, 40);
            const box = await h.computer.place('preview', 420, 40);
            h.eq((await h.computer.wire(note, box, 'content')).ok, true);
            await h.computer.set(note, { text: '<h1>Hello</h1><p>a page the guest lays out</p>' });
            await h.computer.set(box, { mode: 'html', w: 320, h: 240 });
            await h.computer.run({});

            const p = (await parts(h))[box];
            if (p.state === 'done') {
                const view = await shown(h, box);
                h.assert(/^data:image\/(png|jpeg|webp)/.test(String(view.src)),
                    `a raster picture came back: ${String(view.src).slice(0, 30)}`);
                h.eq(view.note, await str(h, 'parts.previewSnapshot'),
                    'and the box SAYS it is a picture, so nothing on it lies');
                h.eq(view.canSave, true, 'a picture can be saved');
                h.assert((await iframes(h)) <= 1, 'ONE guest drew it — never one iframe per part');
                h.note('the sandbox drew the page and handed back a picture');
            } else {
                h.eq(p.state, 'error', 'no picture means a visible failure, never an empty window');
                const message = String(p.error || '');
                h.assert(message.length > 0, 'with a sentence');
                h.assert(!/file:/i.test(message), `and no path in it: ${message}`);
                h.note(`the sandbox cannot draw here; the part said: ${message}`);
            }

            // Whatever the guest managed, the farm was never asked.
            const asked = await h.mock.log({ path: '/v1/chat/completions' });
            h.eq(asked.length, 0, 'drawing a page spends no generation');
        },
    },
];
