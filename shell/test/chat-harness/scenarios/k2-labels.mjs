// @ts-check
// K2-U1 in the real browser: the arrow's NAME (COMPUTER_PLAN §5.1, §8.2, §11).
//
// The pill is the one place in the Computer where a person turns an arrow into a named parameter,
// so everything here presses the SHIPPED control: the pill is clicked, the name is typed into the
// contenteditable the click opened, and the blur is what commits. `h.computer.label()` — the debug
// door — is asserted to reach the SAME edit, because K1 froze it as the route every other K2
// scenario uses (KA-10 / KB-2.4), and a door that quietly forked would make those scenarios lie.
//
// What only a browser can answer, and is therefore here rather than in computer-label.test.mjs:
//   - every wire really wears a pill, and an unnamed one really shows the dashed plea;
//   - what you type lands in the DOCUMENT and survives a reload;
//   - naming an arrow makes the thinking part below it go `stale` — the visible half of "this
//     answer was built from a heading that no longer exists";
//   - Escape puts the old name back, and does NOT leak into the canvas's own Escape (Stop);
//   - the canvas does not start a marquee when you click a name.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when the surface this unit decorates was faked or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host'].filter((k) => failed[k]);
    if (missing.length) throw new Error(`K2-U1 needs the REAL host: ${missing.join(', ')}`);
    return true;
});

/** The Computer, shown, with a document open. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    return true;
}

/** The thinking part this build ships: `instruction` after the K2 landing swaps the palette row,
 * `ask` until then (KB-1 deferral 1). Read off the canvas rather than hard-coded, so this file
 * does not have to be edited on the day the swap happens. */
const thinker = (/** @type {any} */ h, /** @type {number} */ x, /** @type {number} */ y) => h.eval((px, py) => {
    const dbg = window.LolComputer.debug.computer;
    let type = 'instruction';
    let id = dbg.place(type, px, py);
    if (!id) { type = 'ask'; id = dbg.place(type, px, py); }
    if (!id) throw new Error('neither instruction nor ask is in the palette');
    // Its FIRST input port, read off the box rather than hard-coded: `ask` declares `context`,
    // the Instruction declares `in` (§5.2 rule 7), and this file should survive the swap.
    const dot = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-port[data-dir="in"]`);
    if (!dot) throw new Error(`the ${type} box drew no input port`);
    return { type, id, port: dot.getAttribute('data-port') };
}, x, y);

/** note → thinking part, wired. @returns {Promise<{note: string, ask: string, wire: string}>} */
async function pair(/** @type {any} */ h) {
    const note = await h.computer.place('note', 40, 40);
    const think = await thinker(h, 420, 40);
    const wired = await h.computer.wire(note, think.id, think.port);
    h.eq(wired.ok, true, `the note must feed the ${think.type}: ${JSON.stringify(wired)}`);
    // The wire layer redraws inside the canvas's ONE rAF, so the pill exists a frame later.
    await h.waitFor((id) => (document.querySelector(`#lolcomputer .graph-wire-pill[data-wire="${id}"]`) ? true : null),
        { args: [wired.id] });
    return { note, ask: think.id, wire: wired.id };
}

/** Every pill on the canvas: `{wire, text}` per `.graph-wire-label` (the frozen probe). */
const pills = (/** @type {any} */ h) => h.eval(() => Array.from(
    document.querySelectorAll('#lolcomputer .graph-wire-pill'),
).map((el) => {
    const label = el.querySelector('.graph-wire-label');
    const ph = el.querySelector('.graph-wire-ph');
    const seen = (/** @type {any} */ node) => !!node && !!node.getClientRects().length;
    return {
        wire: el.getAttribute('data-wire'),
        text: label ? label.textContent : null,
        empty: el.getAttribute('data-empty'),
        labelShown: seen(label),
        placeholder: ph ? ph.textContent : null,
        placeholderShown: seen(ph),
        dashed: ph ? getComputedStyle(ph).borderStyle : '',
    };
}));

/** Type a name the way a person does: click the pill, type into what opens, press somewhere else.
 * @returns {Promise<any>} */
const typeName = (/** @type {any} */ h, /** @type {string} */ wireId, /** @type {string} */ text) => h.eval((id, v) => {
    const pill = document.querySelector(`#lolcomputer .graph-wire-pill[data-wire="${id}"]`);
    if (!pill) throw new Error('no pill for wire ' + id);
    pill.click();
    const label = pill.querySelector('.graph-wire-label');
    if (!label.isContentEditable) throw new Error('clicking the pill did not open an editor');
    label.textContent = v;
    // Clicking away = a press on the empty canvas, which is what a person actually does.
    const canvas = document.querySelector('#lolcomputer .graph-canvas');
    const r = canvas.getBoundingClientRect();
    const opts = {
        bubbles: true, cancelable: true, composed: true, button: 0,
        clientX: r.left + 6, clientY: r.bottom - 6,
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
    canvas.dispatchEvent(new PointerEvent('pointerup', opts));
    return { text: label.textContent, editing: pill.getAttribute('data-editing') };
}, wireId, text);

/** Type, then press Escape instead of clicking away. */
const typeThenEscape = (/** @type {any} */ h, /** @type {string} */ wireId, /** @type {string} */ text) => h.eval((id, v) => {
    const pill = document.querySelector(`#lolcomputer .graph-wire-pill[data-wire="${id}"]`);
    pill.click();
    const label = pill.querySelector('.graph-wire-label');
    label.textContent = v;
    let reachedTheCanvas = false;
    const spy = () => { reachedTheCanvas = true; };
    document.querySelector('#lolcomputer .graph').addEventListener('keydown', spy);
    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, composed: true }));
    document.querySelector('#lolcomputer .graph').removeEventListener('keydown', spy);
    return { text: label.textContent, reachedTheCanvas, editing: pill.getAttribute('data-editing') };
}, wireId, text);

/** Wait until the pill's own text catches the document up — the wire layer repaints inside the
 * canvas's one rAF, so "the DOM agrees" is a thing that becomes true, not a thing that is. */
const pillReads = (/** @type {any} */ h, /** @type {string} */ wireId, /** @type {string} */ want) => h.waitFor(
    (id, v) => {
        const el = document.querySelector(`#lolcomputer .graph-wire-label[data-wire="${id}"]`);
        return el && el.textContent === v ? true : null;
    },
    { args: [wireId, want], timeout: 10000 },
);

/** The part states, by id. */
const states = (/** @type {any} */ h) => h.eval(() => {
    /** @type {any} */ const out = {};
    for (const p of window.LolComputer.debug.computer.doc().parts) out[p.id] = p.state;
    return out;
});

/** The labels the DOCUMENT carries, by wire id — the state() door K1 froze. */
const stored = async (/** @type {any} */ h) => {
    const st = await h.computer.state();
    /** @type {any} */ const out = {};
    for (const w of st.wires) out[w.id] = w.label;
    return out;
};

export default [
    {
        name: 'k2-labels',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const g = await pair(h);

            // 1. Every wire wears a pill, and an unnamed one is the dashed plea — not an empty gap
            //    a reader has no reason to click.
            const fresh = await pills(h);
            h.eq(fresh.length, 1, 'the wire drew exactly one pill');
            h.eq(fresh[0].wire, g.wire, 'and it names the wire it belongs to');
            h.eq(fresh[0].text, '', 'an unnamed arrow reports an EMPTY label, never the placeholder text');
            h.eq(fresh[0].empty, 'true');
            h.eq(fresh[0].placeholderShown, true, 'the plea is visible: an unnamed arrow is the #1 cause of a mushy answer');
            h.eq(fresh[0].labelShown, false, 'and the empty field is not also showing');
            h.eq(fresh[0].dashed, 'dashed', 'drawn dashed, as §8.2 asks');
            h.eq(fresh[0].placeholder, await h.eval(() => window.LolComputer.app.t('graph.wireNameMe')),
                'in the page\'s own words, not a sentence this test re-typed');

            // The same probe the other K2 scenarios read.
            const dom = await h.computer.dom();
            h.eq(dom.labels.length, 1, 'h.computer.dom().labels sees it');
            h.eq(dom.labels[0].wire, g.wire);

            // 2. Settle the graph, then type a name: the thinking part below must go stale.
            await h.computer.run({ maxItems: 8 });
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 60000 });
            const settled = await states(h);
            h.eq(settled[g.ask], 'done', `the ${g.ask} must have run before staleness means anything: ${JSON.stringify(settled)}`);

            const typed = await typeName(h, g.wire, 'societal research');
            h.eq(typed.text, 'societal research', 'the pill kept what was typed');
            h.eq(typed.editing, null, 'and clicking away closed the editor');
            h.eq((await stored(h))[g.wire], 'societal research', 'the DOCUMENT carries the name, not just the pill');

            const after = await states(h);
            h.eq(after[g.ask], 'stale',
                'naming the arrow changed which parameter arrives, so the part below must re-run');
            h.eq(after[g.note], 'done', 'and nothing upstream was disturbed');

            // 3. It survives a reload — the whole point of it being a program edit. (`save()` is
            //    the flush K1 froze; without it this would be a race with the save debounce, not a
            //    test of whether the name is persisted at all.)
            await h.computer.save();
            await h.reload();
            await open(h);
            const back = await pills(h);
            h.eq(back.length, 1, 'the wire came back');
            h.eq(back[0].text, 'societal research', 'and so did its name');
            h.eq(back[0].empty, 'false', 'the pill knows it is named now');
            h.eq((await stored(h))[g.wire], 'societal research', 'the reloaded document agrees');

            // 4. Escape puts the old name back, and does not reach the canvas behind it.
            const escaped = await typeThenEscape(h, g.wire, 'environmental research');
            h.eq(escaped.text, 'societal research', 'Escape cancels the edit rather than committing it');
            h.eq(escaped.reachedTheCanvas, false,
                'and it never reached the canvas behind the pill, which would have stopped the run');
            h.eq(escaped.editing, null, 'the editor closed');
            h.eq((await stored(h))[g.wire], 'societal research', 'and the document never heard about the typing');

            // 5. Whitespace and case: what the reader typed is what the model will read, collapsed.
            await typeName(h, g.wire, '  Societal   Research  ');
            h.eq((await stored(h))[g.wire], 'Societal Research',
                'runs of spaces collapse; the reader\'s own capitals survive, because the model reads them');

            // 6. Clearing it is an edit too, and the plea comes back.
            await typeName(h, g.wire, '   ');
            h.eq((await stored(h))[g.wire], '', 'a name that is all spaces is an unlabelled arrow (§5.2 rule 8)');
            await pillReads(h, g.wire, '');
            const cleared = await pills(h);
            h.eq(cleared[0].empty, 'true');
            h.eq(cleared[0].placeholderShown, true, 'and the dashed plea is back');

            // 7. The debug door K1 froze reaches the SAME edit — every other K2 scenario depends on it.
            h.eq(await h.computer.label(g.wire, 'budget'), true, 'debug.label() reports that it named something');
            h.eq((await stored(h))[g.wire], 'budget');
            await pillReads(h, g.wire, 'budget');
            h.note('the pill repainted from the document');
            h.eq(await h.computer.label(g.wire, ' budget '), false,
                'naming it the same thing again is not an edit, so there is nothing to undo');

            // 8. One undo takes a name back — it is a program edit, on the same stack as everything else.
            await h.computer.undo();
            h.eq((await stored(h))[g.wire], '', 'undo restores the arrow to unnamed');
        },
    },

    {
        name: 'k2-labels-canvas',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const g = await pair(h);

            // Clicking a NAME must not also start a marquee or clear the selection behind it: the
            // pill lives inside `.graph-canvas`, which owns the pointer everywhere else.
            await h.computer.select([g.note]);
            const marquee = await h.eval((id) => {
                const pill = document.querySelector(`#lolcomputer .graph-wire-pill[data-wire="${id}"]`);
                const rect = pill.getBoundingClientRect();
                const opts = { bubbles: true, cancelable: true, composed: true, clientX: rect.left + 4, clientY: rect.top + 4, button: 0 };
                pill.dispatchEvent(new PointerEvent('pointerdown', opts));
                const box = document.querySelector('#lolcomputer .graph-marquee');
                const shown = !!box && !box.hidden;
                pill.dispatchEvent(new PointerEvent('pointerup', opts));
                return { shown };
            }, g.wire);
            h.eq(marquee.shown, false, 'pressing on a name did not start a rubber band');
            h.eq((await h.computer.state()).selected.join(','), g.note,
                'and it did not clear what was selected either');

            // The keyboard route: select the wire, press F2, type, Enter.
            const named = await h.eval((id) => {
                const canvas = document.querySelector('#lolcomputer .graph-canvas');
                const path = document.querySelector(`#lolcomputer .graph-wire[data-wire="${id}"]`);
                if (!path) throw new Error('no wire path to select');
                const rect = canvas.getBoundingClientRect();
                // The pill sits at the curve's MIDPOINT, so press the wire a quarter along it.
                const mid = path.getPointAtLength(path.getTotalLength() * 0.25);
                const layer = document.querySelector('#lolcomputer .graph-layer');
                const m = new DOMMatrix(getComputedStyle(layer).transform);
                const opts = {
                    bubbles: true, cancelable: true, composed: true, button: 0,
                    clientX: rect.left + mid.x * m.a + m.e, clientY: rect.top + mid.y * m.d + m.f,
                };
                canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
                canvas.dispatchEvent(new PointerEvent('pointerup', opts));
                const selected = window.LolComputer.debug.computer.state().selectedWires || [];
                const root = document.querySelector('#lolcomputer .graph');
                root.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true, composed: true }));
                const label = document.querySelector(`#lolcomputer .graph-wire-label[data-wire="${id}"]`);
                const editing = !!label && label.isContentEditable;
                if (editing) {
                    label.textContent = 'topic';
                    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));
                }
                return { selected, editing };
            }, g.wire);
            h.eq(named.selected.join(','), g.wire, 'clicking the wire selected it');
            h.eq(named.editing, true, 'F2 on a selected arrow opens its name for editing — no mouse needed');
            h.eq((await h.computer.state()).wires[0].label, 'topic', 'and Enter commits it');

            // Fix pass, finding 5. The canvas suppresses its shortcuts while a control is being
            // typed in, and it decides that by SELECTOR. The pill is `contenteditable` in its
            // `plaintext-only` flavour, which `[contenteditable="true"]` does not match — so the
            // suppression rested entirely on the pill stopping every key itself, and any key path
            // that skipped that handler would have deleted the selection instead of a character.
            // Nothing the pill does can be observed through that handler, so what is asserted here
            // is the fact the guard now depends on: which selector really sees the pill.
            const guard = await h.eval((id) => {
                const label = document.querySelector(`#lolcomputer .graph-wire-label[data-wire="${id}"]`);
                document.querySelector('#lolcomputer .graph').dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true, composed: true }));
                return {
                    mode: label.getAttribute('contenteditable'),
                    wide: !!label.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
                    narrow: !!label.closest('input, textarea, select, [contenteditable="true"]'),
                };
            }, g.wire);
            h.eq(guard.mode, 'plaintext-only', 'the pill edits in the plaintext-only flavour');
            h.eq(guard.wide, true, 'the guard the canvas ships now sees it');
            h.eq(guard.narrow, false, 'and the one it used to ship did not — which is the bug');
        },
    },
];
