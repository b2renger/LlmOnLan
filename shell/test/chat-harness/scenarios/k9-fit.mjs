// @ts-check
// Critic R2, N1: a box is exactly its stored height since R1 (K-3), and nothing adjusted the boxes
// that already existed — lessons 1 and 2, the Research template and every graph saved before R1
// opened with Instruction boxes that scrolled inside, their prompt squeezed to the floor, the seed
// line below the fold, and a scrollbar beside the tour's title.
//
// This opens EVERY lesson (the tour included) and EVERY template the way a person does — by
// clicking it on the Learn shelf — plus a graph saved before R1 holding every part type at its
// pre-R1 default size, and asserts on each box: the body does not scroll (scrollHeight −
// clientHeight ≤ 1) and an Instruction's prompt is at least 60 px tall. The old-size graph is
// measured twice: as it opens, and after its Instruction ran — its answer in the foot, the "last
// run: seed … · Keep" line and the "cut off" chip: the tallest it gets with its default settings.

import { LESSONS, TEMPLATES } from '../../../renderer/chat/computer/tutorial/registry.mjs';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Every part type at its default size BEFORE critic R1 (git afff65a). Section is a frame, so it
 * sits on its own; the rest are laid out on a grid with room between them. */
const LEGACY = [
    ['audio', 280, 220], ['button', 200, 120], ['code', 280, 200], ['collect', 260, 160],
    ['condition', 240, 170], ['confirm', 240, 150], ['dialog', 260, 190], ['document', 300, 200],
    ['file', 260, 170], ['filter', 260, 220], ['from-thread', 250, 160], ['image', 240, 200],
    ['ask', 300, 260], ['preview', 320, 260], ['render', 280, 260], ['repeat', 240, 170],
    ['split', 250, 180], ['sticky', 200, 200], ['note', 260, 170], ['timer', 220, 140],
    ['title', 360, 88], ['to-thread', 250, 170], ['toggle', 200, 120], ['section', 460, 340],
];

/** A graph file as a build before R1 wrote it: every type, its old size, its default settings. */
function legacyFile() {
    const parts = LEGACY.map(([type, w, h], i) => ({
        id: `old_${i}`, type, x: 40 + (i % 5) * 420, y: 40 + Math.floor(i / 5) * 400, w, h, settings: {},
    }));
    return JSON.stringify({ lolgraph: 1, title: 'Saved before round 1', parts, wires: [] });
}

/** Every box on screen, measured: how far its body scrolls, and the Instruction prompt's height. */
const measure = (/** @type {any} */ h) => h.eval(() => {
    /** @type {any[]} */ const out = [];
    for (const el of Array.from(document.querySelectorAll('#lolcomputer .graph-part[data-id]'))) {
        const body = /** @type {any} */ (el.querySelector('.graph-part-body'));
        const area = /** @type {any} */ (el.querySelector('.graph-ins-instruction'));
        const pick = /** @type {any} */ (el.querySelector('.graph-ins-fields .graph-part-select'));
        out.push({
            id: el.getAttribute('data-id'),
            type: el.getAttribute('data-type'),
            h: /** @type {any} */ (el).offsetHeight,
            over: body ? body.scrollHeight - body.clientHeight : 0,
            prompt: area ? area.offsetHeight : null,
            // Critic R3-1: the Model picker must stay readable (it once shrank to "Au").
            modelW: pick ? pick.offsetWidth : null,
        });
    }
    return out;
});

/** Two frames, so layout (and a late farm-caps repaint) has settled before measuring. */
const frames = (/** @type {any} */ h) => h.eval(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(true)))));

/** Click a lesson on the Learn shelf and wait until its document is the open one. */
async function openLesson(/** @type {any} */ h, /** @type {string} */ id) {
    await h.computer.tutorial.openLesson(id);
    await h.waitFor((lid) => {
        const a = window.LolComputer.app.tutorial.active();
        return a && a.lessonId === lid && window.LolComputer.debug.computer.docId() === a.docId ? true : null;
    }, { timeout: 15000, args: [id] });
}

export default [
    {
        name: 'k9-fit',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.view('computer');
            await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() && window.LolComputer.app.tutorial ? true : null), { timeout: 20000 });
            await h.mock.reset();

            /** @type {string[]} */ const problems = [];
            /** @type {string[]} */ const seen = [];
            const judge = async (/** @type {string} */ what, /** @type {number} */ n) => {
                await frames(h);
                const boxes = await measure(h);
                h.eq(boxes.length, n, `${what}: every box is on the canvas`);
                for (const b of boxes) {
                    if (b.over > 1) problems.push(`${what}: ${b.type} ${b.id} (h ${b.h}) scrolls by ${b.over}px`);
                    if (b.modelW !== null && b.modelW < 90) problems.push(`${what}: ${b.type} ${b.id} Model picker is ${b.modelW}px wide`);
                    if (b.prompt !== null && b.prompt < 60) problems.push(`${what}: ${b.type} ${b.id} (h ${b.h}) prompt is ${b.prompt}px`);
                }
                const ins = boxes.filter((b) => b.prompt !== null).map((b) => `${b.h}:${b.prompt}`);
                seen.push(`${what}${ins.length ? ` [prompt ${ins.join(' ')}]` : ''}`);
            };

            for (const lesson of LESSONS) {
                await openLesson(h, lesson.id);
                await judge(lesson.id, lesson.doc.parts.length);
            }
            for (const tpl of TEMPLATES) {
                const was = await h.computer.call('docId');
                await h.computer.tutorial.openTemplate(tpl.id);
                await h.waitFor((prev, n) => {
                    const doc = window.LolComputer.debug.computer.doc();
                    return window.LolComputer.debug.computer.docId() !== prev && doc && doc.parts.length === n ? true : null;
                }, { timeout: 15000, args: [was, tpl.doc.parts.length] });
                await judge(tpl.id, tpl.doc.parts.length);
            }

            // A graph saved before R1: a new library document, then the real import.
            const fresh = await h.eval(() => window.LolComputer.debug.library.create('Saved before round 1'));
            await h.waitFor((want) => (window.LolComputer.debug.computer.docId() === want ? true : null), { args: [fresh], timeout: 15000 });
            const done = await h.computer.importText(legacyFile(), { confirm: false });
            h.eq(done.ok, true, `the old file imports: ${JSON.stringify(done.errors)}`);
            h.eq(done.errors, [], 'with nothing dropped');
            await judge('saved-before-r1', LEGACY.length);

            // …and its Instruction after a run that was cut off: the seed line and the cut chip.
            const ask = await h.eval(() => {
                const dbg = window.LolComputer.debug.computer;
                const p = dbg.doc().parts.find((/** @type {any} */ x) => x.type === 'ask');
                dbg.session().patchPart(p.id, {
                    state: 'done',
                    value: { kind: 'text', data: 'The answer, cut off at the end.' },
                    stats: { seed: 816897, pinned: false, cut: true, calls: 1, tokens: 2048 },
                });
                return p.id;
            });
            await h.waitFor((pid) => {
                const run = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-ins-run'));
                return run && !run.hidden ? true : null;
            }, { args: [ask] });
            await judge('saved-before-r1-after-a-cut-run', LEGACY.length);
            const row = await h.eval((pid) => {
                const box = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"]'));
                const body = box.querySelector('.graph-part-body').getBoundingClientRect();
                const inside = (/** @type {string} */ s) => {
                    const el = box.querySelector(s);
                    if (!el || el.hidden || !el.getClientRects().length) return `${s}: not shown`;
                    const r = el.getBoundingClientRect();
                    return r.top >= body.top - 0.5 && r.bottom <= body.bottom + 0.5 && r.left >= body.left - 0.5 && r.right <= body.right + 0.5 ? '' : `${s}: outside the body`;
                };
                return ['.graph-ins-seed-input', '.graph-ins-seed-dice', '.graph-ins-seed-clear', '.graph-ins-seed-used',
                    '.graph-ins-seed-keep', '.graph-ins-cut', '.graph-ins-strip', '.graph-part-fields select']
                    .map(inside).filter(Boolean);
            }, ask);
            for (const miss of row) problems.push(`saved-before-r1-after-a-cut-run: the old-size Instruction's ${miss}`);

            // A NEW Instruction, at its own default size, in the densest state it meets: a {name}
            // bound (so the "Fill in {names}" row and its hint show) and an answer in the foot.
            const note = await h.computer.place('note', 2200, 40);
            await h.computer.set(note, { text: 'cats' });
            const fresh2 = await h.computer.place('ask', 2200, 240);
            await h.computer.set(fresh2, { instruction: 'Write about {topic}.' });
            const w = await h.computer.wire(note, fresh2, 'in');
            h.eq(await h.computer.label(w.id, 'topic'), true);
            await h.eval((pid) => {
                window.LolComputer.debug.computer.session().patchPart(pid, {
                    state: 'done', value: { kind: 'text', data: 'An answer about cats.' }, stats: { seed: 816897, pinned: false, calls: 1, tokens: 20 },
                });
                return true;
            }, fresh2);
            await h.waitFor((pid) => {
                const wrap = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-ins-inline-wrap'));
                return wrap && !wrap.hidden ? true : null;
            }, { args: [fresh2] });
            await frames(h);
            const dense = (await measure(h)).find((b) => b.id === fresh2);
            seen.push(`new-instruction-dense [prompt ${dense.h}:${dense.prompt}]`);
            if (dense.over > 1) problems.push(`a new Instruction (h ${dense.h}) with a bound {name} and an answer scrolls by ${dense.over}px`);
            if (dense.prompt < 60) problems.push(`a new Instruction (h ${dense.h}) with a bound {name} and an answer has a ${dense.prompt}px prompt`);

            h.note(seen.join(' · '));
            await h.screenshot('k9-fit-saved-before-r1');
            h.eq(problems.join(' || '), '', 'no box body scrolls, no Instruction prompt is under 60 px, and every Instruction control is inside its box');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'opening all of it asked the farm nothing');
        },
    },
];
