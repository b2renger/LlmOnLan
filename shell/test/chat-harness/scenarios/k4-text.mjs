// @ts-check
// K4-U1 in the real browser: the Text part — the box you type into AND the box an answer lands in
// (COMPUTER_PLAN §6.2 revision 2, K4 kickoff addendum KD-4, the owner's requirement).
//
// The unit test (`chat-unit.js computer-text`) owns the pure rules — what `adopt()` makes of what
// arrived, what `bodyOf()` shows, what the two guards return. What only a browser can answer is
// here: that a real run through the real canvas puts a real answer into a real box, that the box
// draws it as markdown and not as text, and that a locked box and a box being typed into survive
// the run with the person's words intact.
//
// THE FROZEN PROBES for this part, which the sheet and the canvas must keep honouring:
//
//   .graph-part[data-id="<id>"] .graph-text-body        the rendered value (hidden while editing)
//   .graph-part[data-id="<id>"] .graph-text-source      the textarea (hidden while rendered)
//   .graph-part[data-id="<id>"] .graph-text-from        "from input" / "locked" / "editing"
//   .graph-part[data-id="<id>"] .graph-text-clear       ↺ Clear
//   .graph-text-lock[data-part="<id>"]                  the lock
//   .graph-part[data-id="<id>"] .graph-text-notice      the quiet line a refusal writes

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** A markdown report of the kind the owner's graphs actually produce. */
const REPORT = [
    '# Forestry',
    '',
    'A **bold** claim, with `code` in it.',
    '',
    '- one',
    '- two',
    '',
    '| site | trees |',
    '| --- | --- |',
    '| north | 12 |',
    '',
    '<img src=x onerror="boom()">',
].join('\n');

/** Fail loudly when the surface this unit decorates was faked or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`K4-U1 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    return true;
});

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** The Computer, shown, with a document open and an empty mock log. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();
    return true;
}

const settled = (/** @type {any} */ h) =>
    h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 20000 });

/** Every part of the open document, by id. */
const parts = (/** @type {any} */ h) => h.eval(() => {
    const doc = window.LolComputer.debug.computer.doc();
    /** @type {any} */ const out = {};
    for (const p of doc.parts) out[p.id] = { type: p.type, state: p.state, value: p.value, error: p.error, settings: p.settings };
    return out;
});

/** What one Text box is actually showing, straight off the DOM a person looks at. */
const boxOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((partId) => {
    const root = document.querySelector(`#lolcomputer .graph-part[data-id="${partId}"]`);
    if (!root) throw new Error(`no box on the canvas for ${partId}`);
    const pick = (/** @type {string} */ sel) => root.querySelector(sel);
    const el = (/** @type {any} */ node) => (node ? { text: (node.textContent || '').trim(), hidden: !!node.hidden } : null);
    const body = pick('.graph-text-body');
    const source = pick('.graph-text-source');
    const foot = pick('.graph-value');
    return {
        body: el(body),
        // What the markdown actually became: elements, counted, never a string of HTML.
        tags: body ? Array.from(body.querySelectorAll('*')).map((n) => n.tagName.toLowerCase()) : [],
        headings: body ? Array.from(body.querySelectorAll('h1')).map((n) => (n.textContent || '').trim()) : [],
        images: body ? body.querySelectorAll('img').length : -1,
        source: source ? { value: source.value, hidden: !!source.hidden } : null,
        from: el(pick('.graph-text-from')),
        clear: el(pick('.graph-text-clear')),
        notice: el(pick('.graph-text-notice')),
        lockPressed: (() => { const l = pick('.graph-text-lock'); return l ? l.getAttribute('aria-pressed') : null; })(),
        footHidden: foot ? !!foot.hidden : null,
    };
}, id);

/** Click something inside a box, the way a person does. */
const click = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ sel) =>
    h.eval((partId, selector) => {
        const el = document.querySelector(`#lolcomputer .graph-part[data-id="${partId}"] ${selector}`);
        if (!el) throw new Error(`no ${selector} on part ${partId}`);
        el.click();
        return true;
    }, id, sel);

/** Type into a box's source editor and click away, exactly as a person would. */
const type = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ text) =>
    h.eval((partId, value) => {
        const area = document.querySelector(`#lolcomputer .graph-part[data-id="${partId}"] .graph-text-source`);
        if (!area || area.hidden) throw new Error(`part ${partId} is not showing its source`);
        area.focus();
        area.value = value;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        area.dispatchEvent(new Event('change', { bubbles: true }));
        area.blur();
        return true;
    }, id, text);

export default [
    {
        // The owner's sentence, end to end: "render generated text from instruct or other boxes
        // into those text boxes". A Text box feeds an Instruction, the Instruction's answer lands
        // in a second Text box, and the second box shows it.
        name: 'k4-text-a-generated-answer-lands-in-a-text-box',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const src = await h.computer.place('note', 40, 60);
            const ins = await h.computer.place('ask', 360, 60);
            const out = await h.computer.place('note', 680, 60);
            await h.computer.set(src, { text: 'forestry' });
            await h.computer.set(ins, { instruction: 'write about it', model: 'mock-echo' });
            h.eq((await h.computer.wire(src, ins, 'in')).ok, true, 'Text -> Instruction');
            h.eq((await h.computer.wire(ins, out, 'in')).ok, true,
                'Instruction -> Text: the port KD-4 added is what makes this wire legal at all');

            await h.computer.run({});
            await settled(h);

            const live = await parts(h);
            h.eq(live[out].state, 'done', `the receiving box ran: ${live[out].error || ''}`);
            h.eq(live[out].value.kind, 'text');
            h.eq(live[out].value.data, live[ins].value.data,
                'what the farm generated is what the Text box holds — verbatim, and passed on');
            h.eq(live[out].settings.text, '',
                'rule 1: a run produced a VALUE and never wrote the program');

            const box = await boxOf(h, out);
            h.eq(box.body.hidden, false, 'the answer shows rendered, not as a textarea');
            h.eq(box.source.hidden, true);
            h.assert(box.body.text.indexOf('mock-echo') >= 0, `the answer is on screen: ${box.body.text.slice(0, 80)}`);
            h.eq(box.from.text, await str(h, 'parts.textFromInput'), 'and the box says where it came from');
            h.eq(box.clear.hidden, false, 'with a way back to what you typed');
            h.eq(box.footHidden, true,
                '`quiet`: the canvas foot strip stands down, so the same words are not printed twice');
            h.note(`answer landed in a Text box: ${box.body.text.replace(/\s+/g, ' ').slice(0, 70)}…`);
        },
    },
    {
        // "It renders markdown." The owner's graphs are full markdown reports, so this is the
        // common case — and the ONE way model text becomes nodes is render/dom.mjs, which is what
        // the injected <img> at the end of REPORT is there to prove.
        name: 'k4-text-renders-markdown-and-never-html',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const a = await h.computer.place('note', 40, 60);
            const b = await h.computer.place('note', 360, 60);
            await h.computer.set(a, { text: REPORT });
            h.eq((await h.computer.wire(a, b, 'in')).ok, true, 'Text -> Text: a box can feed a box');

            const before = await h.mock.log({ path: '/v1/chat/completions' });
            await h.computer.run({});
            await settled(h);
            const after = await h.mock.log({ path: '/v1/chat/completions' });
            h.eq(after.length, before.length, 'two Text boxes are free: no generation was spent');

            const live = await parts(h);
            h.eq(live[b].value.data, REPORT, 'the report arrived whole');

            const box = await boxOf(h, b);
            h.eq(box.headings[0], 'Forestry', 'a heading is an <h1>, not a line starting with #');
            for (const tag of ['h1', 'strong', 'code', 'ul', 'li', 'table', 'td']) {
                h.assert(box.tags.indexOf(tag) >= 0, `the markdown became a real <${tag}>: ${box.tags.join(',')}`);
            }
            h.eq(box.images, 0, 'the injected <img> never became an element');
            h.assert(box.body.text.indexOf('onerror') >= 0,
                'it stayed TEXT, visible and inert — model text becomes HTML by no route at all');
            h.note(`rendered: ${box.tags.join(' ')}`);
        },
    },
    {
        // "Clicking into the box lets the user edit it (source), and the box returns to rendered
        // on commit." Plus the half that matters: an edit is not lost the moment you click away.
        name: 'k4-text-clicking-in-shows-the-source-and-editing-keeps-it',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const a = await h.computer.place('note', 40, 60);
            const b = await h.computer.place('note', 360, 60);
            await h.computer.set(a, { text: REPORT });
            await h.computer.wire(a, b, 'in');
            await h.computer.run({});
            await settled(h);

            const undoBefore = (await h.computer.state()).undo.past;
            await click(h, b, '.graph-text-body');
            let box = await boxOf(h, b);
            h.eq(box.source.hidden, false, 'clicking in shows the SOURCE');
            h.eq(box.body.hidden, true);
            h.eq(box.source.value, REPORT, 'and the source is what was on screen, not an empty field');
            h.eq(box.from.text, await str(h, 'parts.textEditing'), 'the box says it is being edited');

            await type(h, b, '# My own heading\n\nmine now');
            box = await boxOf(h, b);
            h.eq(box.body.hidden, false, 'committing goes back to rendered');
            h.eq(box.headings[0], 'My own heading', 'showing what the person wrote, not what arrived');
            h.eq(box.from.hidden, true, 'these are their words now, so nothing claims otherwise');

            const live = await parts(h);
            h.eq(live[b].settings.text, '# My own heading\n\nmine now',
                'typing is the ONLY thing that writes settings.text');
            h.assert((await h.computer.state()).undo.past > undoBefore,
                'and the edit entered undo: one history entry, opened by the first keystroke');
            await h.computer.undo();
            h.eq((await parts(h))[b].settings.text, '', 'one history entry per edit — undo gives it back');
        },
    },
    {
        // The lock, and the guarantee under it: it must be impossible to lose typing silently.
        name: 'k4-text-a-locked-box-keeps-what-you-typed',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const a = await h.computer.place('note', 40, 60);
            const b = await h.computer.place('note', 360, 60);
            await h.computer.set(a, { text: REPORT });
            await h.computer.set(b, { text: 'my own notes' });
            await h.computer.wire(a, b, 'in');

            await click(h, b, '.graph-text-lock');
            let box = await boxOf(h, b);
            h.eq(box.lockPressed, 'true', 'the lock is on');
            h.eq(box.from.text, await str(h, 'parts.textLocked'));

            await h.computer.run({});
            await settled(h);

            let live = await parts(h);
            h.eq(live[b].state, 'done', 'a refusal is not a failure: nothing went wrong');
            h.eq(live[b].error, null);
            h.eq(live[b].value.data, 'my own notes',
                'the locked box kept its words AND still passed them on downstream');
            box = await boxOf(h, b);
            h.eq(box.notice.hidden, false);
            h.eq(box.notice.text, await str(h, 'parts.textRefused'), 'and it said so, quietly');

            // Unlocked, the same run lands the report: the lock is a choice, not a wall.
            await click(h, b, '.graph-text-lock');
            await h.computer.run({});
            await settled(h);
            live = await parts(h);
            h.eq(live[b].value.data, REPORT, 'unlocked, the arrival lands');
            box = await boxOf(h, b);
            h.eq(box.notice.hidden, true, 'and the notice is gone');
            h.eq(box.from.text, await str(h, 'parts.textFromInput'));

            // ↺ Clear gives the typed words back without touching the program.
            await click(h, b, '.graph-text-clear');
            box = await boxOf(h, b);
            h.eq(box.source.hidden, true, 'a non-empty box stays rendered');
            h.eq(box.body.text.indexOf('my own notes') >= 0, true, 'showing what the person typed again');
            h.eq((await parts(h))[b].settings.text, 'my own notes', 'and their text was never touched');
        },
    },
    {
        // Rule 4, the part that is not optional: an answer arriving while someone is typing keeps
        // the person's words and says so. This is the one that stops a re-run destroying notes.
        name: 'k4-text-an-arrival-never-lands-on-an-open-editor',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const a = await h.computer.place('note', 40, 60);
            const b = await h.computer.place('note', 360, 60);
            await h.computer.set(a, { text: REPORT });
            await h.computer.set(b, { text: 'half a thou' });
            await h.computer.wire(a, b, 'in');

            // The person is mid-sentence: the source editor is open and focused.
            await click(h, b, '.graph-text-body');
            h.eq((await boxOf(h, b)).source.hidden, false, 'the editor is open');

            await h.computer.run({});
            await settled(h);

            const live = await parts(h);
            h.eq(live[b].value.data, 'half a thou', 'the run kept the words that were being typed');
            const box = await boxOf(h, b);
            h.eq(box.source.hidden, false, 'and it did not pull the textarea out from under them');
            h.eq(box.source.value, 'half a thou');
            h.eq(box.notice.text, await str(h, 'parts.textRefusedUnsaved'), 'the box explains itself');
            h.note('an open editor beats an arriving answer — nothing was lost');
        },
    },
];
