// @ts-check
// Critic R1 A6 + A7, BOX SIDE (Package C), with REAL input (K-6: CDP's Input domain — hit testing,
// pointer capture, focus, text selection and default actions, exactly as a person's mouse):
//
//   A6 "there is an issue with editing a textbox that was created before" — a Text box that holds
//      words is opened by a DOUBLE-CLICK on its words, by ✎ Edit, and by Enter/F2 with the box
//      selected (K-2); a single click only selects it; the editor opens on what was shown; and an
//      edit of a box that something is wired INTO survives the next run (the first keystroke
//      locks it, and the box says so).
//   A7 "we should be able to copy / paste texts from the boxes" — a drag across the rendered words
//      selects them (and does not move the box); Ctrl+C copies them; Copy copies the whole text.
//      The same for a Markdown view's page.
//
// These drive the canvas too: the press on a selectable zone (K-1) and the K-2 calls are Package
// B's side of the same contracts. A failure here names which side it saw.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The Computer, shown, an EMPTY document open, the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    const d = await h.computer.doc();
    if (d.parts.length) await h.computer.remove(d.parts.map((/** @type {any} */ p) => p.id));
    await h.mock.reset();
    return true;
}

/** A string as the page itself resolves it. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** `#lolcomputer .graph-part[data-id=…] <sel>` */
const inBox = (/** @type {string} */ id, /** @type {string} */ sel) => `#lolcomputer .graph-part[data-id="${id}"] ${sel}`;

/** What a Text box shows, and where the focus is. */
const textBox = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const box = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"]');
    if (!box) throw new Error('no box ' + pid);
    const area = /** @type {any} */ (box.querySelector('.graph-text-source'));
    const body = /** @type {any} */ (box.querySelector('.graph-text-body'));
    const notice = /** @type {any} */ (box.querySelector('.graph-text-notice'));
    const doc = window.LolComputer.debug.computer.doc();
    const part = doc.parts.find((/** @type {any} */ p) => p.id === pid);
    return {
        editing: !!area && !area.hidden,
        focused: !!area && document.activeElement === area,
        value: area ? area.value : null,
        bodyText: body && !body.hidden ? (body.textContent || '').trim() : null,
        notice: notice && !notice.hidden ? notice.textContent : '',
        selected: window.LolComputer.debug.computer.state().selected,
        x: part ? part.x : null, y: part ? part.y : null,
        settings: part ? part.settings : null,
        value2: part ? part.value : null,
        active: document.activeElement ? document.activeElement.tagName.toLowerCase() + '.' + String(document.activeElement.className || '') : '',
    };
}, id);

/** Is the ＋ menu open? (a double-click on a box used to open it ON the box) */
const menuOpen = (/** @type {any} */ h) => h.eval(() => {
    const m = document.querySelector('#lolcomputer .graph-add-menu');
    return !!m && !m.hidden;
});

/** A client point on EMPTY canvas, well away from the boxes (bottom-right corner). */
const emptySpot = (/** @type {any} */ h) => h.eval(() => {
    const c = document.querySelector('#lolcomputer .graph-canvas');
    if (!c) throw new Error('no canvas');
    const r = c.getBoundingClientRect();
    return { x: r.right - 40, y: r.bottom - 40 };
});

/**
 * A Text box that holds `words`, filled THE WAY A PERSON DOES: click into the fresh box, type,
 * click away. → its id
 */
async function filledText(/** @type {any} */ h, /** @type {string} */ words, x = 60, y = 80) {
    const id = await h.computer.place('note', x, y);
    await h.input.click(inBox(id, '.graph-text-source'));
    await h.input.type(words);
    await h.input.click(await emptySpot(h));
    await h.waitFor((pid) => {
        const body = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-text-body');
        return body && !body.hidden ? true : null;
    }, { args: [id], timeout: 5000 });
    return id;
}

/** Leave whatever field has the focus: a real click on empty canvas. */
const clickAway = async (/** @type {any} */ h) => h.input.click(await emptySpot(h));

/** The first paragraph's client box inside a selector's element. */
const paraBox = (/** @type {any} */ h, /** @type {string} */ sel) => h.eval((s) => {
    const host = document.querySelector(s);
    const p = host && (host.querySelector('p') || host);
    if (!p) throw new Error('no text in ' + s);
    const range = document.createRange();
    range.selectNodeContents(p);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2 };
}, sel);

/** Record what each copy event put on the clipboard: the canvas's parts, or the page's selection. */
const copySpy = (/** @type {any} */ h) => h.eval(() => {
    const w = /** @type {any} */ (window);
    w.__k8copies = [];
    if (!w.__k8copyHooked) {
        w.__k8copyHooked = true;
        // Bubble phase on window: AFTER the canvas's own copy handler has had its say.
        window.addEventListener('copy', (ev) => {
            const hijacked = ev.defaultPrevented;
            const data = hijacked && ev.clipboardData ? ev.clipboardData.getData('text/plain') : String(window.getSelection() || '');
            w.__k8copies.push({ hijacked, data });
        });
    }
    return true;
});
const copies = (/** @type {any} */ h) => h.eval(() => /** @type {any} */ (window).__k8copies || []);

const WORDS = 'Alpha beta gamma delta epsilon zeta';

export default [
    {
        name: 'k8-boxes-text-a-double-click-on-a-filled-text-opens-its-editor',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const id = await filledText(h, WORDS);
            let box = await textBox(h, id);
            h.eq(box.editing, false, 'a filled box shows its rendered words');
            h.eq(box.bodyText, WORDS);

            await h.input.dblclick(inBox(id, '.graph-text-body p'));
            box = await textBox(h, id);
            h.eq(await menuOpen(h), false, 'a double-click on a box does NOT open the ＋ menu on top of it');
            h.eq(box.editing, true, 'a double-click on the words opens the editor');
            h.eq(box.focused, true, `with the caret in it (focus: ${box.active})`);
            h.eq(box.value, WORDS, 'seeded with what was shown');

            await h.input.key('End');
            await h.input.type(' eta');
            await clickAway(h);
            box = await textBox(h, id);
            h.eq(box.settings.text, `${WORDS} eta`, 'the typing landed in the box');
            h.eq(box.bodyText, `${WORDS} eta`, 'and it shows rendered again after leaving');

            // A box that was made, left and REOPENED (the owner's words: "created before").
            await h.computer.save();
            await h.input.dblclick(inBox(id, '.graph-text-body p'));
            box = await textBox(h, id);
            h.eq(box.editing && box.focused, true, 'a second time, too');
            await clickAway(h);
        },
    },
    {
        name: 'k8-boxes-text-one-click-selects-and-enter-or-f2-opens-the-editor',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const id = await filledText(h, WORDS);
            await h.input.click(inBox(id, '.graph-text-body p'));
            let box = await textBox(h, id);
            h.eq(box.selected, [id], 'one click selects the box');
            h.eq(box.editing, false, 'and only selects it: the editor stays shut');
            h.eq(await menuOpen(h), false, 'no ＋ menu');

            await h.input.key('Enter');
            box = await textBox(h, id);
            h.eq(box.editing && box.focused, true, `Enter on the selected box opens the editor (K-2; focus: ${box.active})`);
            h.eq(box.value, WORDS, 'on what was shown, with no stray newline from the Enter');

            await clickAway(h);
            await h.input.click(inBox(id, '.graph-part-title'));
            await h.input.key('F2');
            box = await textBox(h, id);
            h.eq(box.editing && box.focused, true, 'F2 does the same');
            await clickAway(h);
        },
    },
    {
        name: 'k8-boxes-text-the-edit-button-opens-the-editor-with-a-real-click',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const id = await filledText(h, WORDS);
            await h.input.move(inBox(id, '.graph-text-body'));
            await h.sleep(300);                          // the fade-in is 120 ms
            const shown = await h.eval((sel) => {
                const b = document.querySelector(sel);
                return b ? { hidden: !!(/** @type {any} */ (b)).hidden, opacity: getComputedStyle(b).opacity, label: b.textContent } : null;
            }, inBox(id, '.graph-text-edit'));
            h.assert(shown && !shown.hidden && Number(shown.opacity) > 0.5, `✎ is visible on a hovered box: ${JSON.stringify(shown)}`);
            h.eq(shown.label, await str(h, 'parts.textEdit'));
            await h.screenshot('k8-boxes-text-hover');
            await h.input.click(inBox(id, '.graph-text-edit'));
            const box = await textBox(h, id);
            h.eq(box.editing && box.focused, true, '✎ Edit opens the editor, caret in it');
            h.eq(box.value, WORDS);
            await clickAway(h);
        },
    },
    {
        name: 'k8-boxes-text-a-drag-across-the-words-selects-them-and-ctrl-c-copies-them',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const id = await filledText(h, WORDS);
            const before = await textBox(h, id);
            const p = await paraBox(h, inBox(id, '.graph-text-body'));
            await h.input.drag({ x: p.left + 1, y: p.mid }, { x: p.right - 1, y: p.mid }, { steps: 10 });
            const sel = await h.input.selection();
            const after = await textBox(h, id);
            h.eq([after.x, after.y], [before.x, before.y], 'dragging across the words does NOT move the box');
            h.assert(sel.indexOf('beta gamma delta') >= 0, `the words are selected: "${sel}"`);
            h.eq(after.editing, false, 'and selecting is not editing');

            await copySpy(h);
            await h.input.key('c', { ctrl: true });
            const got = await copies(h);
            h.assert(got.length >= 1, 'Ctrl+C fired a copy');
            const last = got[got.length - 1];
            h.eq(last.hijacked, false, 'the canvas left a text selection alone (it copies PARTS only with nothing selected)');
            h.assert(last.data.indexOf('beta gamma delta') >= 0, `the selected words were copied: "${last.data}"`);
        },
    },
    {
        name: 'k8-boxes-text-copy-copies-the-whole-text-with-a-real-click',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const id = await filledText(h, WORDS);
            const clip = await h.spy.clipboard();
            await h.input.click(inBox(id, '.graph-text-copy'));
            await h.waitFor(() => ((/** @type {any} */ (window)).__spyClipboard || []).length ? true : null, { timeout: 3000 });
            h.eq(await clip(), [WORDS], 'Copy puts exactly the box\'s words on the clipboard');
            const label = await h.eval((sel) => (document.querySelector(sel) || {}).textContent, inBox(id, '.graph-text-copy'));
            h.eq(label, await str(h, 'parts.textCopied'), 'and says it did');
        },
    },
    {
        name: 'k8-boxes-text-editing-a-wired-text-box-survives-the-next-run',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const ins = await h.computer.place('ask', 40, 60);
            const out = await h.computer.place('note', 420, 60);
            await h.computer.set(ins, { instruction: 'write one line about forests', model: 'mock-echo' });
            h.eq((await h.computer.wire(ins, out, 'in')).ok, true, 'Instruction -> Text');
            await h.computer.run({});
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 30000 });
            let box = await textBox(h, out);
            h.assert(box.bodyText && box.bodyText.length > 0, 'the answer landed in the Text box');
            const answer = box.bodyText;

            // The person edits the ANSWER: ✎, End, type, leave.
            await h.input.click(inBox(out, '.graph-text-edit'));
            await h.input.key('End');
            await h.input.type(' MY EDIT');
            await clickAway(h);
            box = await textBox(h, out);
            h.eq(box.settings.locked, true, 'the first keystroke on a wired box locked it');
            h.eq(box.notice, await str(h, 'parts.textAutoLocked'), 'and the box says why, in words');
            h.assert(String(box.settings.text).endsWith(' MY EDIT'), `the edit is the box's text: ${box.settings.text}`);
            const edited = box.settings.text;

            // ONE undo entry holds the words and the lock together; redo puts both back.
            await h.computer.undo();
            box = await textBox(h, out);
            h.eq([box.settings.text, box.settings.locked], ['', false], 'one Undo takes back the edit AND the lock');
            await h.computer.redo();
            box = await textBox(h, out);
            h.eq([box.settings.text, box.settings.locked], [edited, true], 'one Redo puts both back');

            // Run everything again: the answer must NOT come back over the edit.
            await h.computer.set(ins, { instruction: 'write one line about rivers' });
            await h.computer.run({});
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 30000 });
            box = await textBox(h, out);
            h.assert(String(box.bodyText).indexOf('MY EDIT') >= 0, `the edit survived the run: ${box.bodyText}`);
            h.eq(box.value2 && box.value2.data, box.settings.text, 'and it is what flows on downstream');
            h.assert(String(box.bodyText).indexOf(answer.slice(0, 20)) >= 0, 'the words the person started from are still the ones on screen');
        },
    },
    {
        name: 'k8-boxes-text-a-markdown-view-is-selectable-too',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            await h.setFarm(null);
            const id = await h.computer.place('preview', 60, 60);
            await h.computer.set(id, { mode: 'markdown', source: `# Title\n\n${WORDS}` });
            await h.computer.play(id);
            await h.waitFor((pid) => {
                const b = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-body p');
                return b ? true : null;
            }, { args: [id], timeout: 10000 });
            h.eq(await h.eval((sel) => (document.querySelector(sel) || { getAttribute: () => null }).getAttribute('data-selectable'), inBox(id, '.graph-preview-body')), 'text');
            const doc0 = (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === id);
            const p = await paraBox(h, inBox(id, '.graph-preview-body'));
            await h.input.drag({ x: p.left + 1, y: p.mid }, { x: p.right - 1, y: p.mid }, { steps: 10 });
            const sel = await h.input.selection();
            const doc1 = (await h.computer.doc()).parts.find((/** @type {any} */ x) => x.id === id);
            h.eq([doc1.x, doc1.y], [doc0.x, doc0.y], 'the view did not move');
            h.assert(sel.indexOf('gamma delta') >= 0, `the page's words are selected: "${sel}"`);
        },
    },
];
