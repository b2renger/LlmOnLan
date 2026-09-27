// @ts-check
// K5-U4 (COMPUTER_PLAN §10; addendum KE-4): the lessons and templates, walked in the real browser
// the way a person walks them (build rule 6) — a lesson is opened by CLICKING it on the Learn
// shelf, `Show me` and `Got it` and the saved-answer offer are CLICKED on the rail, a box's ▶ is
// CLICKED in its title bar, a box the lesson asks for is picked from the ＋ menu, a template is
// opened by clicking it on the shelf and run with the run bar's Run button. Typing into a box and
// dragging a wire (shipped K1–K4 gestures) go through the debug doors, as every K-scenario does.
//
// §10.2: "the harness walks the lessons against the mock farm in demo mode and asserts every
// checkpoint can be satisfied" — lessons 2 and 4 are walked with the farm GONE (h.setFarm(null)),
// on their saved answers, and assert that nothing was sent anywhere; 1, 3 and 4 with the farm.

import { lessonById, TEMPLATES } from '../../../renderer/chat/computer/tutorial/registry.mjs';
import { refsOf } from '../../../renderer/chat/computer/tutorial/check.mjs';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The Computer, shown, a document open, the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.waitFor(() => (window.LolComputer.app.tutorial ? true : null), { timeout: 10000 });
    await h.mock.reset();
    return true;
}

/** Click a lesson on the Learn shelf and wait for its rail. */
async function openLesson(/** @type {any} */ h, /** @type {string} */ id) {
    const visible = await h.eval((lid) => {
        const b = document.querySelector('#lolcomputer .comp-lesson[data-lesson="' + lid + '"]');
        return !!b && !!(/** @type {any} */ (b).offsetParent);
    }, id);
    h.assert(visible, `the Learn shelf shows ${id} — a person can see what they click`);
    await h.computer.tutorial.openLesson(id);
    await h.waitFor((lid) => {
        const a = window.LolComputer.app.tutorial.active();
        const rail = document.querySelector('#lolcomputer .comp-rail');
        return a && a.lessonId === lid && window.LolComputer.debug.computer.docId() === a.docId
            && rail && !rail.classList.contains('hidden') ? a : null;
    }, { timeout: 15000, args: [id] });
    return h.computer.doc();
}

/** Wait until the lesson has ticked `n` steps (or every step, for 'done'). */
async function waitStep(/** @type {any} */ h, /** @type {number|string} */ n, /** @type {string} */ why) {
    try {
        return await h.waitFor((want) => {
            const a = window.LolComputer.app.tutorial.active();
            if (!a) return null;
            return (want === 'done' ? a.step >= a.of : a.step === want) ? a : null;
        }, { timeout: 20000, args: [n] });
    } catch (e) {
        const a = await h.eval(() => window.LolComputer.app.tutorial.active());
        throw new Error(`${why}: expected step ${n}, the rail is at ${JSON.stringify(a)}`);
    }
}

/** Wait for the run to finish (nothing running). */
async function idle(/** @type {any} */ h) {
    await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 60000 });
}

/** Press ▶ on a box and wait for the run it starts to settle. A box whose input failed may end
 * in any state, so this waits on the RUNNER, not on the box: first for the run to start (or the
 * box to leave idle/stale), then for it to finish. → the box's state. */
async function play(/** @type {any} */ h, /** @type {string} */ id) {
    const stamp = await h.eval(() => window.LolComputer.debug.computer.doc().updatedAt);
    await h.computer.play(id);
    await h.waitFor((was) => {
        const dbg = window.LolComputer.debug.computer;
        return !dbg.running() && dbg.doc().updatedAt !== was ? true : null;
    }, { timeout: 60000, args: [stamp] });
    await idle(h);
    return (await part(h, id)).state;
}

const part = async (/** @type {any} */ h, /** @type {string} */ id) => (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === id);
const wireId = async (/** @type {any} */ h, /** @type {string} */ from, /** @type {string} */ to) =>
    ((await h.computer.doc()).wires.find((/** @type {any} */ w) => w.from === from && w.to === to) || {}).id;

/** The rail offers the lesson's saved answer for a failed box: click it. → the part it filled.
 * "Filled" = a box that was in `error` before the click and is `done` + flagged after it. */
async function useSaved(/** @type {any} */ h) {
    await h.waitFor(() => (document.querySelector('#lolcomputer .comp-rail .comp-rail-demo') ? true : null), { timeout: 10000 });
    const failed = (await h.computer.doc()).parts.filter((/** @type {any} */ p) => p.state === 'error').map((/** @type {any} */ p) => p.id);
    await h.computer.tutorial.press('demo');
    let filled = '';
    try {
        filled = await h.waitFor((was) => {
            const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => was.indexOf(x.id) >= 0 && x.demo && x.state === 'done');
            return p ? p.id : null;
        }, { timeout: 5000, args: [failed] });
    } catch (e) {
        const seen = await h.eval(() => window.LolComputer.debug.computer.doc().parts
            .filter((/** @type {any} */ p) => p.type !== 'sticky' && p.type !== 'title')
            .map((/** @type {any} */ p) => `${p.id}:${p.state}${p.demo ? ':demo' : ''}`));
        throw new Error(`the saved answer did not land (failed before: ${failed}): ${JSON.stringify(seen)}`);
    }
    const badge = await h.eval((pid) => {
        const el = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"]');
        return !!el && el.getAttribute('data-demo') === 'true' && !!el.querySelector('.graph-part-demo');
    }, filled);
    h.assert(badge, `${filled} wears the "demo answer — not generated" badge`);
    return filled;
}

/** The farm is gone, and the client knows it. */
async function noFarm(/** @type {any} */ h) {
    await h.setFarm(null);
    await h.waitFor(() => {
        const caps = window.LolChat.app.farm.get();
        return caps && caps.present ? null : true;
    });
}

/** What an SVG box shows: the data: URL of its picture, or ''. */
const picture = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const img = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] img');
    return img ? decodeURIComponent(String(img.getAttribute('src') || '')) : '';
}, id);


/**
 * What the open document looks like ON SCREEN: every box inside the canvas, every sticky's and
 * title's words fully shown (a clipped sentence is a lesson nobody can read), and — with a lesson
 * open — the rail covering none of the boxes its steps are about (§10.1 mechanism 2).
 * @param {any} h @param {string[]} named
 */
async function layout(h, named) {
    return h.eval((ids) => {
        const root = document.querySelector('#lolcomputer .graph-canvas');
        const c = root ? root.getBoundingClientRect() : null;
        const rail = document.querySelector('#lolcomputer .comp-rail');
        const r = rail && !rail.classList.contains('hidden') ? rail.getBoundingClientRect() : null;
        const hit = (/** @type {DOMRect} */ a, /** @type {DOMRect} */ b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const out = { canvas: c ? [Math.round(c.width), Math.round(c.height)] : null, rail: r && c ? [Math.round(r.left - c.left), Math.round(r.top - c.top), Math.round(r.width), Math.round(r.height)] : null, off: [], clipped: [], covered: [] };
        const boxes = Array.from(document.querySelectorAll('#lolcomputer .graph-part[data-id]'))
            .map((el) => ({ id: el.getAttribute('data-id') || '', b: el.getBoundingClientRect() }));
        /** @type {string[]} */ const touching = [];
        boxes.forEach((x, i) => boxes.slice(i + 1).forEach((y) => { if (hit(x.b, y.b)) touching.push(`${x.id}+${y.id}`); }));
        /** @type {any} */ (out).overlap = touching;
        const doc = window.LolComputer.debug.computer.doc();
        const z = (doc.view && doc.view.zoom) || 1;
        /** @type {any} */ (out).grown = boxes.map((x) => {
            const p = doc.parts.find((/** @type {any} */ q) => q.id === x.id);
            return p && x.b.height / z > p.h + 2 ? `${x.id}:${p.type} ${p.h}→${Math.round(x.b.height / z)}` : '';
        }).filter(Boolean);
        for (const el of Array.from(document.querySelectorAll('#lolcomputer .graph-part[data-id]'))) {
            const id = el.getAttribute('data-id') || '';
            const b = el.getBoundingClientRect();
            if (c && (b.left < c.left - 1 || b.top < c.top - 1 || b.right > c.right + 1 || b.bottom > c.bottom + 1)) out.off.push(`${id} [${Math.round(b.left - c.left)},${Math.round(b.top - c.top)} ${Math.round(b.width)}×${Math.round(b.height)}]`);
            const area = /** @type {any} */ (el.querySelector('.graph-sticky-text'));
            if (area && area.scrollHeight > area.clientHeight + 2) out.clipped.push(`${id} (${area.scrollHeight}>${area.clientHeight})`);
            const field = /** @type {any} */ (el.querySelector('.graph-title-text'));
            if (field && field.scrollWidth > field.clientWidth + 2) out.clipped.push(`${id} (${field.scrollWidth}>${field.clientWidth})`);
            if (r && ids.indexOf(id) >= 0 && hit(b, r)) out.covered.push(id);
        }
        return out;
    }, named);
}

/** Every part id a lesson's steps check or point at. @param {any} lesson */
function namedBy(lesson) {
    const ids = new Set();
    for (const s of lesson.steps) {
        for (const id of refsOf(s.check).parts) ids.add(id);
        if (s.show && s.show.partId) ids.add(s.show.partId);
    }
    return [...ids];
}

/** Type into a creative box's own code editor, as the browser reports typing, then leave it. */
const typeCode = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ text) => h.eval((pid, v) => {
    const el = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-source'));
    if (!el) throw new Error('typeCode: no code editor on ' + pid);
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // Leaving the field: a hidden test window may never have focused it, so say what the browser
    // says when an edited textarea is left — `change` — and blur it too.
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return true;
}, id, text);

/** Click a creative box's lock. */
const lockBox = (/** @type {any} */ h, /** @type {string} */ id) => h.click('#lolcomputer .graph-part[data-id="' + id + '"] .graph-preview-lock');

const completions = async (/** @type {any} */ h) => h.mock.log({ path: '/v1/chat/completions' });

export default [
    {
        name: 'k5-lessons-the-learn-shelf-lists-every-lesson-and-template',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const shelf = await h.eval(() => ({
                lessons: Array.from(document.querySelectorAll('#lolcomputer .comp-lesson[data-lesson]'))
                    .map((el) => ({ id: el.getAttribute('data-lesson'), text: el.textContent, visible: !!(/** @type {any} */ (el).offsetParent) })),
                templates: Array.from(document.querySelectorAll('#lolcomputer .comp-template[data-template]'))
                    .map((el) => ({ id: el.getAttribute('data-template'), text: el.textContent, visible: !!(/** @type {any} */ (el).offsetParent) })),
            }));
            h.eq(shelf.lessons.map((/** @type {any} */ l) => l.id).join(','), 'l00-tour,l01-hello-farm,l02-wires,l03-labels,l04-draw', 'the Tour, then lessons 1–4, in order');
            h.eq(shelf.templates.map((/** @type {any} */ x) => x.id).join(','), 'research-problematic,creative-coding', 'the two templates');
            for (const row of [...shelf.lessons, ...shelf.templates]) h.assert(row.visible, `${row.id} is on screen`);
            for (const [id, words] of [['l01-hello-farm', 'hello, farm'], ['l02-wires', 'wires carry values'], ['l03-labels', 'arrow labels are names'], ['l04-draw', 'make a picture']]) {
                const row = shelf.lessons.find((/** @type {any} */ l) => l.id === id);
                h.assert(row.text.includes(words), `${id} is named on the shelf: ${row.text}`);
            }
            h.eq((await completions(h)).length, 0, 'looking at the shelf asks the farm nothing');
        },
    },

    {
        name: 'k5-lessons-hello-farm-walks-to-done-on-the-farm',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const doc = await openLesson(h, 'l01-hello-farm');
            h.eq(doc.title, await h.eval(() => window.LolComputer.app.t('tutorial.lessonTitle', { n: 1, title: 'hello, farm' })), 'the fork is named for the lesson');
            h.assert(['n_title', 'p_ask', 'p_answer'].every((id) => doc.parts.some((/** @type {any} */ p) => p.id === id)), 'the fork kept the authored ids');
            await waitStep(h, 0, 'the lesson opens on step 1');

            await h.computer.set('p_ask', { instruction: 'Write a haiku about the sea.' });
            await waitStep(h, 1, 'typing the instruction ticks step 1');
            await play(h, 'p_ask');
            await waitStep(h, 3, '▶ on the Instruction pushes its answer into the Text box: steps 2 and 3');
            const ask = await part(h, 'p_ask');
            const answer = await part(h, 'p_answer');
            h.eq(ask.state, 'done');
            h.assert(!ask.demo, 'a real generation is not a demo answer');
            h.eq(answer.value && answer.value.data, ask.value.data, 'the answer travelled along the arrow, word for word');

            await h.click('#lolcomputer .graph-part[data-id="p_answer"] .graph-text-lock');
            const done = await waitStep(h, 'done', 'the lock on the Text box ticks the last step');
            h.eq(done.ticks.join(','), 's1,s2,s3,s4');
            const rail = await h.computer.tutorial.rail();
            h.assert(/wires carry values/.test(String(rail.next)), `the rail offers the next lesson: ${rail.next}`);
            h.eq((await completions(h)).length, 1, 'one generation, exactly');
        },
    },

    {
        name: 'k5-lessons-wires-walks-to-done-with-the-farm-absent',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await noFarm(h);
            await openLesson(h, 'l02-wires');

            h.eq((await h.computer.wire('p_note', 'p_story', 'in')).ok, true, 'the Text box wires into the story');
            await waitStep(h, 1, 'the wire ticks step 1');
            const rail = await h.computer.tutorial.rail();
            h.assert(rail.gotIt, 'reading the prompt cannot be detected, so the rail offers Got it');
            await h.computer.tutorial.press('got');
            await waitStep(h, 2, 'Got it ticks the manual step');

            // ▶ on the LAST box: the prologue pulls the story, which fails — no farm.
            await play(h, 'p_title');
            h.eq((await part(h, 'p_story')).state, 'error', 'the story could not be written without a farm');
            h.eq(await useSaved(h), 'p_story', 'the rail offers the story\'s saved answer');
            if ((await part(h, 'p_title')).state !== 'error') await play(h, 'p_title');
            h.eq(await useSaved(h), 'p_title', 'and then the title\'s');
            await waitStep(h, 3, 'two saved answers tick "the story runs first"');

            await h.computer.set('p_note', { text: 'A beekeeper who has never been stung.' });
            h.eq((await part(h, 'p_title')).state, 'stale', 'the edit staled everything below it');
            await play(h, 'p_note');
            h.eq((await part(h, 'p_story')).state, 'error', 'the push re-asked the story, and the farm is still gone');
            h.eq(await useSaved(h), 'p_story');
            // The title below it either failed in the same push, or waits for its own ▶.
            if ((await part(h, 'p_title')).state !== 'error') await play(h, 'p_title');
            h.eq(await useSaved(h), 'p_title');
            await waitStep(h, 'done', 'the push after the edit, on saved answers, finishes the lesson');
            const doc = await h.computer.doc();
            h.assert(doc.parts.filter((/** @type {any} */ p) => p.demo).map((/** @type {any} */ p) => p.id).sort().join(',') === 'p_story,p_title',
                'both answers are flagged as saved, never as generated');
            h.eq((await completions(h)).length, 0, 'with no farm, nothing was sent anywhere');
        },
    },

    {
        name: 'k5-lessons-labels-change-the-prompt-and-swapping-them-reverses-it',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await openLesson(h, 'l03-labels');
            // Setup, not under test: mock-headings answers with the headings the prompt carried.
            await h.computer.set('p_ask', { model: 'mock-headings' });
            const headings = async () => String(((await part(h, 'p_ask')).value || {}).data || '')
                .split('\n').filter((l) => l.startsWith('heading: ##')).map((l) => l.replace('heading: ## ', ''));

            await play(h, 'p_ask');
            h.eq((await headings()).join(' | '), 'Input 1 | Input 2', 'blank arrows reach the model as Input 1 and Input 2');
            await waitStep(h, 1, 'the blank run ticks step 1');

            await h.computer.label(await wireId(h, 'p_cars', 'p_ask'), 'before');
            await h.computer.label(await wireId(h, 'p_trees', 'p_ask'), 'after');
            await waitStep(h, 2, 'naming both arrows ticks step 2');
            const plan = await h.computer.preview('p_ask');
            h.assert(/## before[\s\S]*## after/.test(JSON.stringify(plan)), 'what WILL be sent is headed before, then after — before any generation');
            h.eq((await part(h, 'p_ask')).state, 'stale', 'renaming staled the answer');
            await h.computer.tutorial.press('got');
            await waitStep(h, 3, 'Got it after reading the prompt');
            await play(h, 'p_ask');
            h.eq((await headings()).join(' | '), 'before | after', 'the names ARE the prompt now');
            await waitStep(h, 4, 'running with the names ticks step 4');

            await h.computer.label(await wireId(h, 'p_trees', 'p_ask'), 'before');
            await h.computer.label(await wireId(h, 'p_cars', 'p_ask'), 'after');
            await play(h, 'p_ask');
            const body = (await completions(h)).map((/** @type {any} */ e) => JSON.stringify(e.body)).pop() || '';
            h.assert(body.indexOf('## before') < body.indexOf('young trees') && body.indexOf('young trees') < body.indexOf('## after'),
                'swapped: the tree-lined street is now what came BEFORE');
            await waitStep(h, 'done', 'the swap and the run finish the lesson');
            h.eq((await completions(h)).length, 3, 'three runs, three generations');
        },
    },

    {
        name: 'k5-lessons-make-a-picture-adds-write-an-svg-from-the-plus-menu',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await openLesson(h, 'l04-draw');
            await play(h, 'p_svg');
            h.assert((await picture(h, 'p_svg')).includes('my picture'), 'the SVG box drew its own code, with no generation');
            await waitStep(h, 1, 'the first ▶ ticks step 1');
            const src = (await part(h, 'p_svg')).settings.source;
            await typeCode(h, 'p_svg', src.replace('#e4572e', '#2e86ab'));
            await waitStep(h, 2, 'editing the code ticks step 2');

            // `Show me` on "add Write an SVG" OPENS the ＋ menu with that row picked out.
            await h.computer.tutorial.press('show');
            await h.waitFor(() => {
                const m = document.querySelector('#lolcomputer .graph-add-menu');
                return m && !m.hidden ? true : null;
            }, { timeout: 5000 });
            const rows = await h.computer.menu.rows();
            const row = rows.find((/** @type {any} */ r) => r.entry === 'write-svg');
            h.assert(!!row && row.active, `Show me highlights "Write an SVG" in the ＋ menu: ${JSON.stringify(rows.filter((/** @type {any} */ r) => r.active))}`);
            h.eq(row.group, 'think', 'under Think, where the lesson says it is');
            const write = await h.computer.menu.pick('write-svg');
            h.assert(!!write, 'clicking the row placed the box');
            await waitStep(h, 3, 'the box from the ＋ menu ticks step 3');

            await h.computer.set(write, { model: 'mock-code' });   // setup: the deterministic code model
            h.eq((await h.computer.wire(write, 'p_svg', 'content')).ok, true);
            await waitStep(h, 4, 'the wire ticks step 4');
            await play(h, 'p_svg');
            const w = await part(h, write);
            h.eq(w.state, 'done', `Write an SVG ran first: ${w.error || ''}`);
            h.assert(/^<svg/.test(String(w.value.data)) && !w.demo, 'its answer arrived clean, and generated');
            h.eq((await part(h, 'p_svg')).state, 'done');
            h.assert((await picture(h, 'p_svg')).includes('#bfe3f2'), 'the SVG box now shows the model\'s picture');
            await waitStep(h, 5, 'both boxes done ticks step 5');

            await lockBox(h, 'p_svg');
            h.eq((await part(h, 'p_svg')).settings.locked, true, 'the lock on the SVG box keeps its code');
            await waitStep(h, 'done', 'the lock finishes the lesson');
            const rail = await h.computer.tutorial.rail();
            h.assert(!rail.next, 'the last lesson points nowhere it cannot go');
            h.eq((await completions(h)).length, 1, 'one generation');
        },
    },

    {
        name: 'k5-lessons-make-a-picture-with-the-farm-absent-draws-the-saved-svg',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await noFarm(h);
            await openLesson(h, 'l04-draw');
            await play(h, 'p_svg');
            h.eq((await part(h, 'p_svg')).state, 'done', 'drawing its own code needs no farm');
            await typeCode(h, 'p_svg', (await part(h, 'p_svg')).settings.source.replace('#e4572e', '#2e86ab'));
            await waitStep(h, 2, 'steps 1–2 need no farm');

            const write = await h.computer.add('write-svg', { query: 'svg' });
            h.assert(!!write, '"svg" in the ＋ search finds Write an SVG, and a click places it');
            await h.computer.wire(write, 'p_svg', 'content');
            await waitStep(h, 4, 'placed and wired');
            await play(h, 'p_svg');
            h.eq((await part(h, write)).state, 'error', 'no farm: Write an SVG failed');
            h.eq(await useSaved(h), write, 'the saved answer is offered for the box the LEARNER added (@write-svg)');
            if ((await part(h, 'p_svg')).state !== 'done' || !(await picture(h, 'p_svg')).includes('#4a7a49')) await play(h, 'p_svg');
            h.assert((await picture(h, 'p_svg')).includes('#4a7a49'), 'the SVG box draws the saved picture');
            await waitStep(h, 5, 'a saved answer ticks step 5, flagged');
            await lockBox(h, 'p_svg');
            h.eq((await part(h, 'p_svg')).settings.locked, true, 'the lock on the SVG box keeps its code');
            await waitStep(h, 'done', 'the lesson completes offline');

            // Reset lesson — the rail's button, then OK — puts the SVG box's OWN code back, drawn,
            // and forgets the answer it showed. The box keeps its authored id, so the canvas reuses
            // it and only its update() hears about the reset.
            await h.computer.tutorial.press('reset');
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog[open]') ? true : null));
            await h.click('dialog.chat-dialog[open] .chat-dialog-ok');
            await waitStep(h, 0, 'reset starts the steps over');
            const shippedSrc = (await part(h, 'p_svg')).settings.source;
            h.assert(shippedSrc.includes('my picture'), 'the doc holds the shipped code');
            await h.waitFor((pid) => {
                const box = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"]');
                const area = /** @type {any} */ (box && box.querySelector('.graph-preview-source'));
                const from = box && box.querySelector('.graph-preview-from');
                return area && area.value.includes('my picture') && from && from.getAttribute('data-from') === 'own' ? true : null;
            }, { timeout: 10000, args: ['p_svg'] });
            h.assert((await picture(h, 'p_svg')).includes('my picture') && !(await picture(h, 'p_svg')).includes('#4a7a49'), 'the box draws the shipped picture, not the old answer');
            h.eq((await completions(h)).length, 0, 'nothing was sent anywhere');
        },
    },

    {
        name: 'k5-lessons-research-template-opens-from-the-shelf-and-runs-eight-generations',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const before = await h.computer.call('docId');
            await h.computer.tutorial.openTemplate('research-problematic');
            await h.waitFor((was) => {
                const id = window.LolComputer.debug.computer.docId();
                const doc = window.LolComputer.debug.computer.doc();
                return id && id !== was && doc && doc.parts.length === 12 ? id : null;
            }, { timeout: 15000, args: [before] });
            const doc = await h.computer.doc();
            h.eq(doc.title, 'Research → problematic', 'a new library document, named for the template');
            h.eq(doc.wires.filter((/** @type {any} */ w) => w.label).length, 13, 'every arrow arrives named');
            const gens = await h.eval(() => (document.querySelector('#lolcomputer .comp-run-gens') || {}).textContent || '');
            h.assert(/\b8\b/.test(gens), `the run bar says what it will cost before it spends: ${gens}`);

            // Setup, not under test: the mock's default model answers prose; this one honours a schema.
            await h.computer.set(doc.parts.find((/** @type {any} */ p) => p.settings.shape === 'json').id, { model: 'mock-studio-json' });
            await h.click('#lolcomputer .comp-run-all');
            await h.waitFor(() => {
                const d = window.LolComputer.debug.computer.doc();
                const asks = d.parts.filter((/** @type {any} */ p) => p.type === 'ask');
                return !window.LolComputer.debug.computer.running() && asks.every((/** @type {any} */ p) => p.state === 'done' || p.state === 'error') ? true : null;
            }, { timeout: 90000 });
            const after = await h.computer.doc();
            const bad = after.parts.filter((/** @type {any} */ p) => p.type === 'ask' && p.state !== 'done');
            h.eq(bad.length, 0, `every box ran: ${bad.map((/** @type {any} */ p) => p.id + ' ' + p.error).join('; ')}`);
            const log = await completions(h);
            h.eq(log.length, 8, 'eight generations, as the shelf said');
            const prob = log.map((/** @type {any} */ e) => JSON.stringify(e.body)).find((/** @type {string} */ b) => b.includes('Write a problematic'));
            h.assert(!!prob, 'the problematic was asked');
            for (const name of ['topic', 'societal research', 'environmental research', 'technological research', 'business research', 'existing initiatives']) {
                h.assert(prob.includes(`## ${name}`), `the problematic's prompt carries ## ${name}`);
            }
            const json = after.parts.find((/** @type {any} */ p) => p.settings.shape === 'json');
            h.eq(json.value.kind, 'json', 'the JSON concept came back as an object');
        },
    },

    {
        name: 'k5-lessons-creative-coding-template-writes-and-draws-a-p5-sketch',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const before = await h.computer.call('docId');
            await h.computer.tutorial.openTemplate('creative-coding');
            await h.waitFor((was) => {
                const id = window.LolComputer.debug.computer.docId();
                const doc = window.LolComputer.debug.computer.doc();
                return id && id !== was && doc && doc.parts.length === 7 ? id : null;
            }, { timeout: 15000, args: [before] });
            const doc = await h.computer.doc();
            const write = doc.parts.find((/** @type {any} */ p) => p.settings && p.settings.code === 'p5');
            const sketch = doc.parts.find((/** @type {any} */ p) => p.settings && p.settings.mode === 'p5');
            h.assert(write && sketch, 'a Write a p5.js sketch and a p5.js sketch box');
            const titles = await h.eval((ids) => ids.map((/** @type {string} */ id) => {
                const el = document.querySelector('#lolcomputer .graph-part[data-id="' + id + '"] .graph-part-title');
                return el ? el.textContent : '';
            }), [write.id, sketch.id]);
            const want = await h.eval(() => ['parts.writeP5Label', 'parts.creativeP5Label'].map((k) => window.LolComputer.app.t(k)));
            h.eq(titles.join(' | '), want.join(' | '), 'each box is titled by its ＋ menu name');
            const gens = await h.eval(() => (document.querySelector('#lolcomputer .comp-run-gens') || {}).textContent || '');
            h.assert(/\b1\b/.test(gens), `the run bar says one generation: ${gens}`);

            await h.computer.set(write.id, { model: 'mock-code' });   // setup: the deterministic code model
            await h.click('#lolcomputer .comp-run-all');
            await h.waitFor((id) => {
                const d = window.LolComputer.debug.computer.doc();
                const p = d.parts.find((/** @type {any} */ x) => x.id === id);
                return !window.LolComputer.debug.computer.running() && p && ['done', 'error'].indexOf(p.state) >= 0 ? true : null;
            }, { timeout: 90000, args: [sketch.id] });
            const after = await h.computer.doc();
            const st = (/** @type {string} */ id) => after.parts.find((/** @type {any} */ p) => p.id === id);
            h.eq(st(write.id).value.lang, 'p5', 'the answer arrived stamped as p5');
            h.assert(/^function setup/.test(String(st(write.id).value.data)), 'and clean — the markdown fence is gone');
            h.eq(st(sketch.id).state, 'done', `the p5.js sketch ran in the sandbox: ${st(sketch.id).error || ''}`);
            h.eq((await completions(h)).length, 1, 'one generation, as the shelf said');
        },
    },

    {
        name: 'k5-lessons-every-lesson-and-template-opens-readable-and-framed',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            /** @type {string[]} */ const problems = [];
            const judge = (/** @type {string} */ what, /** @type {any} */ seen, /** @type {boolean} */ lesson) => {
                h.note(`${what}: canvas ${seen.canvas}, rail at ${seen.rail}`);
                if (seen.off.length) problems.push(`${what}: off screen when it opens: ${seen.off}`);
                if (seen.clipped.length) problems.push(`${what}: words cut off: ${seen.clipped}`);
                if (seen.overlap.length) problems.push(`${what}: boxes drawn on top of each other: ${seen.overlap} (grown: ${seen.grown})`);
                if (lesson && seen.covered.length) problems.push(`${what}: the rail covers ${seen.covered}`);
            };
            for (const id of ['l01-hello-farm', 'l02-wires', 'l03-labels', 'l04-draw']) {
                await openLesson(h, id);
                await h.waitFor(() => (document.querySelector('#lolcomputer .comp-rail .comp-rail-text') ? true : null), { timeout: 5000 });
                judge(id, await layout(h, namedBy(lessonById(id))), true);
            }
            for (const tpl of TEMPLATES) {
                const was = await h.computer.call('docId');
                await h.computer.tutorial.openTemplate(tpl.id);
                await h.waitFor((prev, n) => {
                    const doc = window.LolComputer.debug.computer.doc();
                    return window.LolComputer.debug.computer.docId() !== prev && doc && doc.parts.length === n ? true : null;
                }, { timeout: 15000, args: [was, tpl.doc.parts.length] });
                judge(tpl.id, await layout(h, []), false);
            }
            h.eq(problems.join(' || '), '', 'every lesson and template opens framed, readable, and with nothing under the rail');
            h.eq((await completions(h)).length, 0, 'opening lessons and templates asks the farm nothing');
        },
    },
];
