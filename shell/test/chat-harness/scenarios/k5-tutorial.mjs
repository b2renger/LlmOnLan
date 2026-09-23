// @ts-check
// K5-U3 (COMPUTER_PLAN §10; addendum KE-4..KE-7): the tutorial MECHANIC in the real browser, driven
// the way a person drives it (build rule 6) — the first-run offer is PRESSED, the Learn shelf is
// CLICKED, the rail's buttons are CLICKED, a box comes from the ＋ menu, a wire is DRAGGED from port
// to port, ▶ is the box's own button, Delete and Ctrl+Z are keystrokes. The debug door only sets up
// what is not under test (a "wandering off" deletion, a model name).
//
//   the Tour           walked end to end with NO farm, from the first-run offer to "Next"
//   resume             a restart lands on the same step of the same fork; the shelf reopens it
//   Show me            points at the box; Put it back re-adds a deleted one where it shipped;
//                      ticks latch when the learner undoes their own work
//   Reset lesson       asks first, restores the shipped graph as ONE undo entry, restarts the steps
//   never a dead end   a box the farm cannot answer offers the lesson's saved answer, badged
//                      "demo answer — not generated", which ticks a ran: step and says so
//   the doors          the run bar's ?, the fold-to-a-pill, the shelf's rows, a template

import { LESSONS, TEMPLATES, lessonById } from '../../../renderer/chat/computer/tutorial/registry.mjs';
import { advance, evaluate, freshProgress } from '../../../renderer/chat/computer/tutorial/check.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { normaliseDoc } from '../../../renderer/chat/graph/model.mjs';
import { API_KEYS } from '../../../renderer/chat/core/types.mjs';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const TOUR = /** @type {any} */ (lessonById('l00-tour'));
const SPECS = specMap();

/** The Computer, shown, with a document open. */
async function openComputer(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.ready && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    return true;
}

/** Wait until the rail shows `stepId` of `lesson` (its sentence, word for word). */
async function waitStep(/** @type {any} */ h, /** @type {any} */ lesson, /** @type {string} */ stepId, timeout = 8000) {
    const step = lesson.steps.find((/** @type {any} */ s) => s.id === stepId);
    if (!step) throw new Error(`waitStep: ${lesson.id} has no step ${stepId}`);
    await h.waitFor((txt) => {
        const el = document.querySelector('#lolcomputer .comp-rail:not(.hidden) .comp-rail-text');
        return el && el.textContent === txt ? true : null;
    }, { timeout, args: [step.text] });
    return h.computer.tutorial.rail();
}

/** A string as the page resolves it. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || {}), key, vars || null);

/** The id of the document open in the Computer. */
const docId = (/** @type {any} */ h) => h.eval(() => window.LolComputer.debug.computer.docId());

/** Type into a Text box's source and click away, as a person would. */
const typeInto = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ text) => h.eval((partId, value) => {
    const area = document.querySelector(`#lolcomputer .graph-part[data-id="${partId}"] .graph-text-source`);
    if (!area || area.hidden) throw new Error(`part ${partId} is not showing its source`);
    area.focus();
    area.value = value;
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.dispatchEvent(new Event('change', { bubbles: true }));
    area.blur();
    return true;
}, id, text);

/** Drag a wire from one part's output port to another part's input port, with real PointerEvents. */
const dragWire = (/** @type {any} */ h, /** @type {string} */ from, /** @type {string} */ outPort, /** @type {string} */ to, /** @type {string} */ inPort) => h.eval((f, fp, tt, tp) => {
    const a = document.querySelector(`#lolcomputer .graph-part[data-id="${f}"] .graph-port[data-port="${fp}"][data-dir="out"]`);
    const b = document.querySelector(`#lolcomputer .graph-part[data-id="${tt}"] .graph-port[data-port="${tp}"][data-dir="in"]`);
    const canvas = document.querySelector('#lolcomputer .graph-canvas');
    if (!a || !b || !canvas) throw new Error('dragWire: a port or the canvas is missing');
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const fire = (/** @type {string} */ type, /** @type {Element} */ target, /** @type {number} */ x, /** @type {number} */ y) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, pointerType: 'mouse',
        clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    }));
    const ax = ra.left + ra.width / 2; const ay = ra.top + ra.height / 2;
    const bx = rb.left + rb.width / 2; const by = rb.top + rb.height / 2;
    fire('pointerdown', a, ax, ay);
    for (let i = 1; i <= 6; i++) fire('pointermove', canvas, ax + ((bx - ax) * i) / 6, ay + ((by - ay) * i) / 6);
    fire('pointerup', b, bx, by);
    return true;
}, from, outPort, to, inPort);

/** Click a part once (pointer down + up on its box), which selects it. */
const clickPart = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const el = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"]`);
    const canvas = document.querySelector('#lolcomputer .graph-canvas');
    if (!el || !canvas) throw new Error('clickPart: no part ' + pid);
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(40, r.width / 2);
    const y = r.top + 10;
    const init = (/** @type {number} */ buttons) => ({ bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: x, clientY: y, button: 0, buttons });
    el.dispatchEvent(new PointerEvent('pointerdown', init(1)));
    canvas.dispatchEvent(new PointerEvent('pointerup', init(0)));
    return window.LolComputer.debug.computer.state().selected;
}, id);

/** Titles of the library's documents. */
const libraryTitles = (/** @type {any} */ h) => h.eval(async () => (await window.LolComputer.app.repo.listGraphs()).map((/** @type {any} */ g) => g.title));

/** The shipped doc of a lesson, as the fork opens it. */
const shippedOf = (/** @type {any} */ lesson) => normaliseDoc({ ...lesson.doc, id: 'x', threadId: null }, { specs: SPECS, now: () => 1 }).doc;

export default [
    {
        name: 'k5-tutorial-the-tour-by-hand-with-no-farm',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await openComputer(h);
            await h.setFarm(null);
            await h.waitFor(() => {
                const c = window.LolComputer.app.farm.get();
                return c && !c.present ? true : null;
            });
            await h.mock.reset();

            // The first-run offer is the door (KE-6).
            const welcome = await h.computer.welcome.state();
            h.eq(welcome.shown, true, 'an empty canvas offers the tour');
            h.assert(welcome.actions.includes('tour'), `"Take the tour" is offered: ${welcome.actions}`);
            await h.computer.welcome.press('tour');
            let rail = await waitStep(h, TOUR, 's-look');
            h.eq(rail.lesson, 'l00-tour', 'the rail is the Tour\'s');
            h.eq(rail.step, await str(h, 'tutorial.stepOf', { i: 1, n: TOUR.steps.length }));
            h.eq(rail.gotIt, true, 'a manual step has its Got it');
            h.eq((await h.computer.welcome.state()).shown, false, 'the offer steps aside: the fork has boxes');
            await h.screenshot('k5-tutorial-tour-step-1');
            const fork = await docId(h);
            const doc0 = await h.computer.doc();
            h.eq(doc0.parts.map((/** @type {any} */ p) => p.id).join(','), TOUR.doc.parts.map((/** @type {any} */ p) => p.id).join(','), 'the fork keeps the AUTHORED part ids');
            h.assert((await libraryTitles(h)).includes(await str(h, 'tutorial.tourTitle')), 'the fork is a real library document');
            h.eq(await h.eval(() => !!document.querySelector('#lolcomputer .comp-rail .comp-rail-farm')), false, 'an offline lesson does not warn about the farm');

            await h.computer.tutorial.press('got');
            rail = await waitStep(h, TOUR, 's-add');
            h.eq(rail.show, await str(h, 'tutorial.showMe'));

            // Show me opens the ＋ menu with Text picked out; the learner clicks it.
            await h.computer.tutorial.press('show');
            h.eq(await h.computer.menu.isOpen(), true, 'Show me opened the ＋ menu');
            const picked = await h.eval(() => {
                const el = document.querySelector('#lolcomputer .graph-add-menu:not([hidden]) .graph-add-item[data-entry="note"]');
                return el ? { selected: el.getAttribute('aria-selected'), hint: el.getAttribute('data-hint') } : null;
            });
            h.assert(!!picked && (picked.selected === 'true' || picked.hint === 'true'), `the Text row is the one picked out: ${JSON.stringify(picked)}`);
            const note = await h.computer.menu.pick('note');
            h.assert(!!note, 'clicking Text placed a Text box');
            await waitStep(h, TOUR, 's-type');
            // Setup, not under test: put the new box somewhere clear of the others before wiring.
            await h.computer.move(note, 320, 200);

            await typeInto(h, note, 'Hello from the tour.');
            await waitStep(h, TOUR, 's-wire');

            await dragWire(h, note, 'out', 'p_view', 'content');
            const wired = await h.computer.doc();
            h.assert(wired.wires.some((/** @type {any} */ w) => w.from === note && w.to === 'p_view'), 'the drag made the wire');
            await waitStep(h, TOUR, 's-run');

            await h.computer.play('p_view');
            await h.waitFor(() => {
                const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === 'p_view');
                return p && (p.state === 'done' || p.state === 'error') ? p.state : null;
            }, { timeout: 20000 });
            await waitStep(h, TOUR, 's-delete');
            const shown = await h.eval(() => {
                const el = document.querySelector('#lolcomputer .graph-part[data-id="p_view"]');
                return el ? el.textContent : '';
            });
            h.assert(/Hello from the tour\./.test(String(shown)), 'the sentence travelled down the wire into the view');

            h.eq((await clickPart(h, 'p_bin')).join(','), 'p_bin', 'one click selected the sticky');
            await h.key('#lolcomputer .graph', 'Delete');
            await waitStep(h, TOUR, 's-undo');
            h.eq((await h.computer.doc()).parts.some((/** @type {any} */ p) => p.id === 'p_bin'), false, 'Delete removed it');
            rail = await h.computer.tutorial.rail();
            h.eq(rail.show, await str(h, 'tutorial.putBack'), 'the step about a deleted box offers to put it back');

            await h.key('#lolcomputer .graph', 'z', { ctrl: true });
            await waitStep(h, TOUR, 's-library');
            h.eq((await h.computer.doc()).parts.some((/** @type {any} */ p) => p.id === 'p_bin'), true, 'Ctrl+Z brought it back');

            await h.computer.tutorial.press('got');
            await h.waitFor((txt) => {
                const el = document.querySelector('#lolcomputer .comp-rail .comp-rail-text');
                return el && el.textContent === txt ? true : null;
            }, { args: [await str(h, 'tutorial.done')] });
            rail = await h.computer.tutorial.rail();
            const l1 = /** @type {any} */ (lessonById(TOUR.next));
            h.eq(rail.next, await str(h, 'tutorial.next', { title: await str(h, 'tutorial.lessonTitle', { n: l1.n, title: l1.title }) }), 'the finished tour leads to lesson 1');
            const ticks = await h.eval(() => Array.from(document.querySelectorAll('#lolcomputer .comp-rail-tick')).map((el) => el.getAttribute('data-state')));
            h.eq(ticks.join(','), TOUR.steps.map(() => 'done').join(','), 'every step is a tick in the row');
            await h.screenshot('k5-tutorial-tour-done');

            const dbg = await h.computer.tutorial.debug();
            h.eq(dbg.progress['l00-tour'].ticks.join(','), TOUR.steps.map((/** @type {any} */ s) => s.id).join(','), 'ticked in order');
            h.assert(!!dbg.progress['l00-tour'].doneAt, 'and finished');
            h.eq(await h.eval(() => document.querySelector('#lolcomputer .comp-lesson[data-lesson="l00-tour"]').getAttribute('data-state')), 'done', 'the shelf says so');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'the whole tour asked the farm NOTHING');
            h.eq(await docId(h), fork, 'the tour never left its fork');

            // Next is a real door, and lesson 1 — which needs the farm — says there is none.
            await h.computer.tutorial.press('next');
            await h.waitFor((id) => {
                const r = document.querySelector('#lolcomputer .comp-rail:not(.hidden)');
                return r && r.getAttribute('data-lesson') === id ? true : null;
            }, { args: [l1.id] });
            if (l1.needsFarm !== 'no') {
                h.eq(await h.eval(() => !!document.querySelector('#lolcomputer .comp-rail .comp-rail-farm')), true, 'a farm lesson with no farm says it can still be finished');
            }
        },
    },
    {
        name: 'k5-tutorial-resume-where-you-left-off',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await openComputer(h);
            const learn = await h.eval(() => {
                const el = /** @type {any} */ (document.querySelector('#lolcomputer .comp-learn'));
                return el ? { visible: !!el.offsetParent, expanded: el.getAttribute('aria-expanded') } : null;
            });
            h.assert(!!learn && learn.visible, 'the Learn shelf is visible in the sidebar');
            // An impatient double-click on the shelf forks the lesson ONCE.
            await h.eval(() => {
                const b = /** @type {any} */ (document.querySelector('#lolcomputer .comp-lesson[data-lesson="l00-tour"]'));
                b.click();
                b.click();
                return true;
            });
            await waitStep(h, TOUR, 's-look');
            const fork = await docId(h);
            const tourTitle = await str(h, 'tutorial.tourTitle');
            h.eq((await libraryTitles(h)).filter((/** @type {string} */ t) => t === tourTitle).length, 1, 'a double-click made one fork');
            await h.computer.tutorial.press('got');
            await waitStep(h, TOUR, 's-add');
            const note = await h.computer.add('note');
            await waitStep(h, TOUR, 's-type');
            await h.computer.save();

            // A restart: the Computer reopens the last document, and the rail resumes on its step.
            await h.reload();
            await openComputer(h);
            h.eq(await docId(h), fork, 'the restart reopened the lesson');
            let rail = await waitStep(h, TOUR, 's-type', 15000);
            h.eq(rail.lesson, 'l00-tour');
            const ticks = await h.eval(() => Array.from(document.querySelectorAll('#lolcomputer .comp-rail-tick')).map((el) => el.getAttribute('data-state')));
            h.eq(ticks.slice(0, 3).join(','), 'done,done,now', 'the ticks came back with it');
            h.assert((await h.computer.doc()).parts.some((/** @type {any} */ p) => p.id === note), 'and so did the learner\'s box');
            const meta = await h.eval(() => (document.querySelector('#lolcomputer .comp-lesson[data-lesson="l00-tour"] .comp-lesson-meta') || {}).textContent || '');
            h.assert(meta.includes(await str(h, 'tutorial.progressSome', { done: 2, n: TOUR.steps.length })), `the shelf shows how far: ${meta}`);

            // Somewhere else: the rail goes; the shelf brings back the SAME fork, not a second one.
            await h.click('#lolcomputer .comp-side-head .comp-btn-accent');
            await h.waitFor((f) => {
                const id = window.LolComputer.debug.computer.docId();
                return id && id !== f ? true : null;
            }, { args: [fork] });
            await h.waitFor(() => {
                const r = document.querySelector('#lolcomputer .comp-rail');
                return r && r.classList.contains('hidden') ? true : null;
            });
            h.eq((await h.computer.tutorial.debug()).current, null, 'no lesson in a blank graph');
            await h.computer.tutorial.openLesson('l00-tour');
            rail = await waitStep(h, TOUR, 's-type');
            h.eq(await docId(h), fork, 'the shelf reopened the fork');
            h.eq((await libraryTitles(h)).filter((/** @type {string} */ t) => t === tourTitle).length, 1, 'one fork, however many times it is opened');
            const active = await h.eval(() => window.LolComputer.app.tutorial.active());
            h.eq(active.lessonId, 'l00-tour');
            h.eq(active.step, 2);
            h.eq(active.of, TOUR.steps.length);
        },
    },
    {
        name: 'k5-tutorial-show-me-and-put-it-back-and-the-latch',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await openComputer(h);
            await h.computer.tutorial.openLesson('l00-tour');
            await waitStep(h, TOUR, 's-look');
            await h.computer.tutorial.press('got');
            await waitStep(h, TOUR, 's-add');
            const note = await h.computer.add('note');
            await h.computer.set(note, { text: 'A sentence.' });
            let rail = await waitStep(h, TOUR, 's-wire');
            h.eq(rail.show, await str(h, 'tutorial.showMe'));

            // Show me: the view moves to the box, and the box flashes, selected.
            await h.computer.call('view', { x: -2000, y: -2000, zoom: 1 });   // setup: look elsewhere
            await h.computer.tutorial.press('show');
            const flashed = await h.eval(() => {
                const el = document.querySelector('#lolcomputer .graph-part[data-id="p_view"]');
                return { flash: el ? el.getAttribute('data-flash') : null, selected: window.LolComputer.debug.computer.state().selected };
            });
            h.eq(flashed.flash, 'true', 'Show me flashes the box it means');
            h.eq(flashed.selected.join(','), 'p_view', 'and selects it');
            const v = await h.computer.call('view');
            h.assert(v.x > -2000, `and brings it into view: ${JSON.stringify(v)}`);

            // Wandering off: the box this step is about is deleted. Show me becomes Put it back.
            await h.computer.remove(['p_view']);
            await h.waitFor((txt) => {
                const el = document.querySelector('#lolcomputer .comp-rail .comp-rail-show');
                return el && el.textContent === txt ? true : null;
            }, { args: [await str(h, 'tutorial.putBack')] });
            await h.computer.tutorial.press('show');
            const back = (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === 'p_view');
            const authored = TOUR.doc.parts.find((/** @type {any} */ p) => p.id === 'p_view');
            h.assert(!!back, 'Put it back re-added the box, with its authored id');
            h.eq([back.x, back.y, back.settings.mode].join(','), [authored.x, authored.y, authored.settings.mode].join(','), 'where the lesson had it, as the lesson had it');
            rail = await h.computer.tutorial.rail();
            h.eq(rail.show, await str(h, 'tutorial.showMe'), 'and the button is Show me again');
            h.eq(await h.eval(() => {
                const el = document.querySelector('#lolcomputer .graph-part[data-id="p_view"]');
                return el ? el.getAttribute('data-flash') : null;
            }), 'true', 'flashed as it came back');

            // The latch: undoing their own work does not un-tick what the learner already did.
            await h.computer.remove([note]);
            rail = await waitStep(h, TOUR, 's-wire');
            const dbg = await h.computer.tutorial.debug();
            h.eq(dbg.progress['l00-tour'].ticks.join(','), 's-look,s-add,s-type', 'a latched tick never un-ticks');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0);
        },
    },
    {
        name: 'k5-tutorial-reset-lesson-asks-then-restores-as-one-undo',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await openComputer(h);
            await h.computer.tutorial.openLesson('l00-tour');
            await waitStep(h, TOUR, 's-look');
            const fork = await docId(h);
            await h.computer.tutorial.press('got');
            await waitStep(h, TOUR, 's-add');
            const note = await h.computer.add('note');
            await waitStep(h, TOUR, 's-type');
            await h.computer.remove(['p_bin']);

            // Cancel changes nothing.
            await h.computer.tutorial.press('reset');
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog[open]') ? true : null));
            await h.click('dialog.chat-dialog[open] .chat-dialog-cancel');
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog[open]') ? null : true));
            let doc = await h.computer.doc();
            h.assert(doc.parts.some((/** @type {any} */ p) => p.id === note) && !doc.parts.some((/** @type {any} */ p) => p.id === 'p_bin'), 'cancel kept the learner\'s version');
            await waitStep(h, TOUR, 's-type');

            // OK restores the shipped graph onto the SAME fork, and the steps start over.
            await h.computer.tutorial.press('reset');
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog[open]') ? true : null));
            await h.click('dialog.chat-dialog[open] .chat-dialog-ok');
            await waitStep(h, TOUR, 's-look');
            doc = await h.computer.doc();
            h.eq(doc.parts.map((/** @type {any} */ p) => p.id).join(','), TOUR.doc.parts.map((/** @type {any} */ p) => p.id).join(','), 'exactly the shipped boxes');
            h.eq(doc.wires.length, TOUR.doc.wires.length, 'and the shipped wires');
            h.eq(await docId(h), fork, 'on the same fork, not a new document');
            const dbg = await h.computer.tutorial.debug();
            h.eq(dbg.progress['l00-tour'].ticks.length, 0, 'the steps start over');
            h.eq(dbg.progress['l00-tour'].forkedDocId, fork);

            // ONE undo entry: Ctrl+Z brings the learner's version back.
            await h.key('#lolcomputer .graph', 'z', { ctrl: true });
            doc = await h.computer.doc();
            h.assert(doc.parts.some((/** @type {any} */ p) => p.id === note) && !doc.parts.some((/** @type {any} */ p) => p.id === 'p_bin'), 'one Undo brings the learner\'s version back');
        },
    },
    {
        name: 'k5-tutorial-a-farm-that-cannot-answer-is-not-a-dead-end',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            // A lesson that needs the farm and ships a saved answer for one of its own boxes.
            const lesson = /** @type {any} */ (LESSONS.find((l) => l.needsFarm !== 'no' && l.demo
                && Object.keys(l.demo).some((k) => l.doc.parts.some((/** @type {any} */ p) => p.id === k && p.type === 'ask'))));
            h.assert(!!lesson, 'the shelf has a farm lesson with a saved answer');
            const partId = Object.keys(lesson.demo).find((k) => lesson.doc.parts.some((/** @type {any} */ p) => p.id === k && p.type === 'ask'));
            const saved = lesson.demo[partId];

            await h.fresh();
            await openComputer(h);
            await h.setFarm(null);
            await h.waitFor(() => {
                const c = window.LolComputer.app.farm.get();
                return c && !c.present ? true : null;
            });
            await h.mock.reset();
            await h.computer.tutorial.openLesson(lesson.id);
            await waitStep(h, lesson, lesson.steps[0].id);
            h.eq(await h.eval(() => !!document.querySelector('#lolcomputer .comp-rail .comp-rail-farm')), true, 'the rail says there is no farm, and that the lesson still works');

            const shippedPart = lesson.doc.parts.find((/** @type {any} */ p) => p.id === partId);
            if (!String((shippedPart.settings || {}).instruction || '').trim()) {
                await h.computer.set(partId, { instruction: 'A haiku about the sea.' });   // setup
            }
            await h.computer.play(partId);
            await h.waitFor((id) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === id);
                return p && p.state === 'error' ? true : null;
            }, { timeout: 20000, args: [partId] });

            // The offer, on the rail, naming the box.
            await h.waitFor((id) => (document.querySelector(`#lolcomputer .comp-rail .comp-rail-demo[data-part="${id}"]`) ? true : null), { args: [partId] });
            const offer = await h.eval(() => (document.querySelector('#lolcomputer .comp-rail .comp-rail-demo-text') || {}).textContent || '');
            h.assert(offer.length > 20, `the offer says what it is: ${offer}`);
            await h.computer.tutorial.press('demo');

            const doc = await h.computer.doc();
            const part = doc.parts.find((/** @type {any} */ p) => p.id === partId);
            h.eq(part.state, 'done', 'the box continues with the saved answer');
            h.eq(part.demo, true, 'flagged as a demo answer (KE-7)');
            h.eq(part.value && part.value.data, saved.data, 'the lesson\'s own recorded answer');
            const badge = await h.eval((id) => {
                const box = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"]`);
                const b = box && box.querySelector('.graph-part-demo');
                return { flag: box ? box.getAttribute('data-demo') : null, text: b ? b.textContent : null, shown: !!(b && !b.hidden) };
            }, partId);
            h.eq(badge.flag, 'true');
            h.eq(badge.shown, true, 'the box wears the badge');
            h.eq(badge.text, await str(h, 'computer.demoBadge'), '"demo answer — not generated"');
            h.eq(await h.eval(() => !!document.querySelector('#lolcomputer .comp-rail .comp-rail-demo')), false, 'the offer is spent');
            h.eq(await h.eval(() => !!document.querySelector('#lolcomputer .comp-rail .comp-rail-demo-note')), true, 'and the rail says a saved answer is showing');
            const dbg = await h.computer.tutorial.debug();
            h.assert(dbg.progress[lesson.id].demo.includes(partId), 'progress remembers which box was a demo');
            await h.screenshot('k5-tutorial-demo-answer');
            // The same rail in the light theme (tokens only: the amber must read on both grounds).
            const theme = await h.eval(() => { const was = document.documentElement.className; document.documentElement.className = 'light'; return was; });
            await h.eval(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
            await h.screenshot('k5-tutorial-demo-answer-light');
            await h.eval((was) => { document.documentElement.className = was; return true; }, theme);

            // The checkpoint accepts it: the rail is at least where the pure interpreter says.
            h.eq(evaluate({ ran: { partId } }, { doc }), true, 'a ran: step accepts the saved answer');
            h.eq(evaluate({ ran: { partId, demoOk: false } }, { doc }), false, 'and knows it was not generated');
            const want = advance(lesson, freshProgress(), { doc, base: shippedOf(lesson), report: null }).step;
            const active = await h.eval(() => window.LolComputer.app.tutorial.active());
            h.assert(active.step >= want, `the rail moved as far as the saved answer allows: ${active.step} ≥ ${want}`);

            // The badge travels with the value, and the file says it is a v4 file.
            const text = await h.computer.exportText({ values: true });
            h.assert(/"demo": true/.test(text) && /"lolgraph": 4/.test(text), 'exported with its badge, as v4');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'nothing reached a farm');

            // A real generation, once the farm is back, clears the badge.
            await h.setFarm({});
            await h.waitFor(() => {
                const c = window.LolComputer.app.farm.get();
                return c && c.present ? true : null;
            });
            await h.computer.play(partId);
            await h.waitFor((id) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === id);
                return p && p.state === 'done' && p.demo !== true ? true : null;
            }, { timeout: 30000, args: [partId] });
            h.eq(await h.eval((id) => {
                const b = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-part-demo`);
                return !!(b && !b.hidden);
            }, partId), false, 'a real answer wears no badge');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 1, 'exactly one generation');
        },
    },
    {
        name: 'k5-tutorial-the-doors-question-mark-fold-shelf-template',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await openComputer(h);
            await h.mock.reset();

            // app.tutorial is exactly the frozen API (KE-6): a feature has no fake, so this is its check.
            const keys = await h.eval(() => Object.keys(window.LolComputer.app.tutorial));
            h.eq(keys.join(','), [...API_KEYS.tutorial].join(','), 'app.tutorial publishes the frozen keys, in order');
            h.eq(await h.eval(() => window.LolComputer.app.tutorial.has('l10-loops')), false, 'a lesson this build lacks is not claimed');
            h.eq(await h.eval(async () => window.LolComputer.app.tutorial.open('l99-nope')), null, 'and opening one is a polite null');

            // The shelf lists every lesson and template, in shelf order, each one click away.
            const shelf = await h.eval(() => ({
                lessons: Array.from(document.querySelectorAll('#lolcomputer .comp-lesson')).map((el) => ({
                    id: el.getAttribute('data-lesson'),
                    chip: (el.querySelector('.comp-lesson-chip') || {}).textContent || '',
                    state: el.getAttribute('data-state'),
                })),
                templates: Array.from(document.querySelectorAll('#lolcomputer .comp-template')).map((el) => el.getAttribute('data-template')),
            }));
            h.eq(shelf.lessons.map((/** @type {any} */ l) => l.id).join(','), LESSONS.map((l) => l.id).join(','), 'every lesson, in shelf order');
            h.eq(shelf.templates.join(','), TEMPLATES.map((x) => x.id).join(','), 'every template');
            const offline = await str(h, 'tutorial.chipOffline');
            const farm = await str(h, 'tutorial.chipFarm');
            for (const l of LESSONS) {
                const row = shelf.lessons.find((/** @type {any} */ r) => r.id === l.id);
                h.eq(row.chip, l.needsFarm === 'no' ? offline : farm, `${l.id} says whether it needs the farm`);
                h.eq(row.state, 'new');
            }
            await h.click('#lolcomputer .comp-learn');
            h.eq(await h.eval(() => document.querySelector('#lolcomputer .comp-shelf-body').hidden), true, 'Learn folds the shelf');
            await h.click('#lolcomputer .comp-learn');
            h.eq(await h.eval(() => document.querySelector('#lolcomputer .comp-shelf-body').hidden), false, 'and unfolds it');

            // The run bar's ? opens a card in the rail's dock, with the tour one click away.
            await h.click('#lolcomputer .comp-run-help');
            await h.waitFor(() => (document.querySelector('#lolcomputer .comp-rail:not(.hidden) .comp-rail-explain') ? true : null));
            h.eq(await h.eval(() => document.querySelector('#lolcomputer .comp-rail').getAttribute('data-lesson')), null, 'no lesson is pretending to be open');
            await h.click('#lolcomputer .comp-rail .comp-explain-tour');
            await waitStep(h, TOUR, 's-look');
            h.eq(await h.eval(() => !!document.querySelector('#lolcomputer .comp-rail .comp-rail-explain')), false, 'the card made way for the lesson');
            h.eq(await h.eval(() => document.querySelector('#lolcomputer .comp-lesson[data-lesson="l00-tour"]').getAttribute('aria-current')), 'true', 'the shelf marks the open lesson');

            // The rail folds to a pill and back.
            await h.click('#lolcomputer .comp-rail .comp-rail-collapse');
            const folded = await h.eval(() => {
                const r = document.querySelector('#lolcomputer .comp-rail');
                return {
                    collapsed: r.getAttribute('data-collapsed'),
                    pill: (r.querySelector('.comp-rail-pill') || {}).textContent || null,
                    text: !!r.querySelector('.comp-rail-text'),
                };
            });
            h.eq(folded.collapsed, 'true');
            h.eq(folded.text, false, 'folded, the step text steps aside');
            h.eq(folded.pill, await str(h, 'tutorial.pill', { i: 1, n: TOUR.steps.length, title: await str(h, 'tutorial.tourTitle') }), 'the pill still says where you are');
            await h.click('#lolcomputer .comp-rail .comp-rail-pill');
            await waitStep(h, TOUR, 's-look');
            // The ? while a lesson is open shows the card above the step, not instead of it.
            await h.click('#lolcomputer .comp-run-help');
            const both = await h.eval(() => ({
                card: !!document.querySelector('#lolcomputer .comp-rail .comp-rail-explain'),
                step: !!document.querySelector('#lolcomputer .comp-rail .comp-rail-text'),
            }));
            h.eq(both.card && both.step, true, 'the ? card and the step together');
            await h.click('#lolcomputer .comp-rail .comp-explain-close');
            h.eq(await h.eval(() => !!document.querySelector('#lolcomputer .comp-rail .comp-rail-explain')), false, 'Close closes it');

            // A template: a NEW library document, fresh ids, no rail, nothing asked of the farm.
            const tour = await docId(h);
            const tpl = /** @type {any} */ (TEMPLATES[0]);
            await h.computer.tutorial.openTemplate(tpl.id);
            await h.waitFor((f) => {
                const id = window.LolComputer.debug.computer.docId();
                return id && id !== f ? true : null;
            }, { args: [tour] });
            const doc = await h.computer.doc();
            h.eq(doc.parts.length, tpl.doc.parts.length, 'the template opened whole');
            h.eq(doc.wires.length, tpl.doc.wires.length);
            await h.waitFor(() => {
                const r = document.querySelector('#lolcomputer .comp-rail');
                return r && r.classList.contains('hidden') ? true : null;
            });
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'opening a template asks the farm nothing');
        },
    },
];
