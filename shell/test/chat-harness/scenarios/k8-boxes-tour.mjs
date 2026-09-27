// @ts-check
// Critic R1 B6 (Package C): the Tour's "Delete the sticky note: click it once to select it, then
// press Delete" was impossible as written — the note's face was one textarea, so the click put a
// caret in the words and Delete deleted a CHARACTER; Ctrl+Z in the next step was the textarea's
// own undo. A note that holds words is READ now (graph/parts/sticky.mjs): one click selects it,
// Delete deletes it, Ctrl+Z brings it back, and a double-click opens it for typing.
//
// Driven with REAL input (K-6) on the Tour's own document, the way a learner does it.

import { lessonById } from '../../../renderer/chat/computer/tutorial/registry.mjs';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const TOUR = /** @type {any} */ (lessonById('l00-tour'));

/** `#lolcomputer .graph-part[data-id=…] <sel>` */
const inBox = (/** @type {string} */ id, /** @type {string} */ sel) => `#lolcomputer .graph-part[data-id="${id}"] ${sel}`;

const hasPart = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) =>
    window.LolComputer.debug.computer.doc().parts.some((/** @type {any} */ p) => p.id === pid), id);

/** The sticky's field, as the person meets it. */
const stickyField = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((sel) => {
    const el = /** @type {any} */ (document.querySelector(sel));
    return el ? { readOnly: el.readOnly, reading: el.classList.contains('is-reading'), focused: document.activeElement === el, value: el.value } : null;
}, inBox(id, '.graph-sticky-text'));

export default [
    {
        name: 'k8-boxes-tour-the-sticky-note-is-selected-deleted-and-undone-with-real-clicks-and-keys',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.view('computer');
            await h.waitFor(() => (window.LolComputer && window.LolComputer.ready && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
            await h.setFarm(null);
            const welcome = await h.computer.welcome.state();
            h.assert(welcome.shown && welcome.actions.includes('tour'), `the first-run offer has the tour: ${JSON.stringify(welcome)}`);
            await h.computer.welcome.press('tour');
            await h.waitFor(() => (window.LolComputer.debug.computer.doc().parts.some((/** @type {any} */ p) => p.id === 'p_bin') ? true : null), { timeout: 10000 });

            const step = TOUR.steps.find((/** @type {any} */ s) => s.id === 's-delete');
            h.assert(/click it once to select it, then press Delete/.test(step.text), 'the step still asks for exactly this');

            // The note shows words: it is READ, so a click does not put a caret in them.
            let field = await stickyField(h, 'p_bin');
            h.eq([field.readOnly, field.reading], [true, true], 'a note that holds words is read, not typed into');

            // ONE real click on the note's face selects it.
            await h.input.click(inBox('p_bin', '.graph-sticky-text'));
            h.eq((await h.computer.state()).selected, ['p_bin'], 'one click selected the sticky');
            field = await stickyField(h, 'p_bin');
            h.eq(field.focused, false, 'and put no caret in its words');

            // Delete, on the real keyboard: the NOTE goes, not a character of it.
            await h.input.key('Delete');
            await h.waitFor(() => (window.LolComputer.debug.computer.doc().parts.some((/** @type {any} */ p) => p.id === 'p_bin') ? null : true), { timeout: 5000 });
            h.eq(await hasPart(h, 'p_bin'), false, 'Delete removed the note');

            // Ctrl+Z, straight away, on the real keyboard: the note comes back, words intact.
            await h.input.key('z', { ctrl: true });
            await h.waitFor(() => (window.LolComputer.debug.computer.doc().parts.some((/** @type {any} */ p) => p.id === 'p_bin') ? true : null), { timeout: 5000 });
            h.eq(await hasPart(h, 'p_bin'), true, 'Ctrl+Z brought it back');
            field = await stickyField(h, 'p_bin');
            h.assert(/^I am a sticky note/.test(String(field.value)), `with its words: ${field.value}`);

            // And a DOUBLE-click opens it for typing, caret at the end.
            await h.input.dblclick(inBox('p_bin', '.graph-sticky-text'));
            field = await stickyField(h, 'p_bin');
            h.eq([field.readOnly, field.focused], [false, true], 'a double-click opens the note for typing');
            await h.input.type(' Edited.');
            await h.input.key('Escape');
            const text = await h.eval(() => (window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ p) => p.id === 'p_bin') || { settings: {} }).settings.text);
            h.assert(String(text).endsWith(' Edited.'), `typing went into the note: ${text}`);
            h.eq((await stickyField(h, 'p_bin')).readOnly, true, 'leaving it puts it back to reading');
        },
    },
];
