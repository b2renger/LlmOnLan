// @ts-check
// K2-U2 in the real browser: the owner's Graph B in miniature, and the vision refusal
// (COMPUTER_PLAN §5, §6.3, §11 K2-U2).
//
// What only a browser can answer is here. The unit test (`chat-unit.js computer-bind`) owns the
// nine rules and the exact prompt; this proves the whole chain actually carries them — the wire's
// label reaches the runner, the runner reaches the part, the part reaches `bind.mjs`, and the
// BODY THE FARM RECEIVED has the headings in the order rule 9 promises. It is asserted against
// `mock-headings`, which reports the markdown headings of the last user message (KB-7): the
// structure is the contract, so the structure is what is checked, not a sentence a model produced.
//
// Until the K2 LANDING swaps `graph/parts/index.mjs` (KB-1 deferral 1), `ask.mjs` is still the
// catalogue's row for type `ask`. Each scenario therefore puts the real `instruction` spec into
// the session's spec map first — the same Map the canvas and the runner read — so what runs here
// is the shipped part file and not a copy of it.

const COMPLETIONS = '/v1/chat/completions';
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when the surface this unit decorates was faked or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host', 'ask'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`K2-U2 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    return true;
});

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** The Computer, shown, with a document open and the Instruction spec in the session's map. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null));
    const label = await h.eval(async () => {
        const session = window.LolComputer.debug.computer.session();
        const mod = await import('../../renderer/chat/graph/parts/instruction.mjs');
        session.specs.set('ask', mod.instruction);              // the SAME Map canvas + runner read
        return session.specs.get('ask').label;
    });
    if (label !== await str(h, 'parts.insLabel')) throw new Error(`the Instruction spec did not take: ${label}`);
    await h.mock.reset();
    return true;
}

/** Name a wire. K2-U1's pill is `k2-labels`' business; what this scenario is about is what a label
 * BINDS, so it presses the canvas door when that door exists and edits the document when it does
 * not — and says which happened, so a green run can never hide a missing door. */
const nameWire = (/** @type {any} */ h, /** @type {string} */ wireId, /** @type {string} */ text) =>
    h.eval((id, txt) => {
        const dbg = window.LolComputer.debug.computer;
        if (dbg.label(id, txt)) return 'canvas';
        const session = dbg.session();
        const doc = session.doc();
        session.apply(
            { ...doc, wires: doc.wires.map((w) => (w.id === id ? { ...w, label: txt } : w)), rev: (doc.rev || 1) + 1 },
            { label: 'label' },
        );
        return 'document';
    }, wireId, text);

/** Place a Note carrying `text`, wire it into `to`, and name the wire. → the wire's id. */
async function feed(/** @type {any} */ h, /** @type {string} */ to, /** @type {string} */ text, /** @type {string} */ label, /** @type {number} */ y) {
    const note = await h.computer.place('note', 40, y);
    await h.computer.set(note, { text });
    await h.computer.wire(note, to, 'in');
    const wire = await h.eval((from, into) => {
        const w = window.LolComputer.debug.computer.doc().wires.filter((x) => x.from === from && x.to === into);
        if (!w.length) throw new Error('the wire was refused');
        return w[w.length - 1].id;
    }, note, to);
    if (label) await nameWire(h, wire, label);
    return { note, wire };
}

/** Every part, by id. */
const parts = (/** @type {any} */ h) => h.eval(() => {
    const out = {};
    for (const p of window.LolComputer.debug.computer.state().parts) {
        out[p.id] = { type: p.type, state: p.state, error: p.error, value: p.value };
    }
    return out;
});

/** The chips the Instruction box is showing. */
const chips = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((partId) => Array.from(
    document.querySelectorAll(`#lolcomputer .graph-part[data-id="${partId}"] .graph-ins-chip`),
).map((el) => el.textContent), id);

/** Wait until a run has finished. */
const settled = (/** @type {any} */ h) => h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 20000 });

export default [
    {
        // Graph B in miniature: three labelled notes and one unnamed one into a single Instruction
        // whose prose names two of the three. Everything §5.2 rule 9 promises about ORDER is
        // visible in the body the farm received.
        name: 'k2-instruction-labels-become-headings',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const ins = await h.computer.place('ask', 460, 120);
            // Deliberately the reverse of the prompt's order on the canvas: the arrows are drawn
            // environmental-first, and the INSTRUCTION names societal first. Rule 9a says the
            // instruction wins.
            await feed(h, ins, 'Lighting and wayfinding are the two most cited barriers.', 'environmental research', 40);
            await feed(h, ins, 'Visitors leave because of the sound of the room.', 'societal research', 180);
            await feed(h, ins, 'France', 'country', 320);
            await feed(h, ins, 'a loose note nobody named', '', 460);
            await h.computer.set(ins, {
                instruction: 'write a problematic about societal research and environmental research',
                model: 'mock-headings',
            });

            // §6.3: the box says what it will spend BEFORE it spends it, and it counts the three
            // named arrows, not the four arrivals.
            const strip = await h.eval((partId) => {
                const el = document.querySelector(`#lolcomputer .graph-part[data-id="${partId}"] .graph-ins-strip`);
                return el ? el.textContent : null;
            }, ins);
            const words = Number((String(strip || '').match(/\d+/) || [0])[0]);
            h.assert(words > 0, `the strip counted the assembled prompt: ${strip}`);
            h.eq(strip, await str(h, 'parts.insStrip', { words, n: 3 }),
                'three NAMED inputs — the unlabelled arrival is not one of them');

            const seen = await chips(h, ins);
            h.assert(seen.indexOf(await str(h, 'parts.insUnused', { name: 'country' })) >= 0,
                `the box says which arrow the instruction never named: ${JSON.stringify(seen)}`);

            await h.computer.run({});
            await settled(h);

            const live = await parts(h);
            h.eq(live[ins].state, 'done', `the Instruction ran: ${live[ins].error || ''}`);
            const lines = String(live[ins].value.data).split('\n').filter(Boolean);
            const headings = lines.filter((l) => l.startsWith('heading: ')).map((l) => l.slice(9));

            h.eq(headings[0], '# Inputs', 'the body opens with the inputs section');
            h.eq(headings[headings.length - 1], '# Instruction', '…and the instruction is ALWAYS last');
            const at = (text) => headings.indexOf(text);
            h.assert(at('## societal research') > 0, `societal research got its own heading: ${JSON.stringify(headings)}`);
            h.assert(at('## societal research') < at('## environmental research'),
                'rule 9a: mentioned parameters come in order of FIRST MENTION, not of wiring');
            h.assert(at('## environmental research') < at('## country'),
                'rule 4: a label the instruction never mentions is supplied LAST — and supplied');
            h.assert(at('## country') < at('## Input 1'),
                'rule 9c: the unlabelled arrival comes after every named one');

            const summary = Object.fromEntries(lines
                .filter((l) => !l.startsWith('heading: '))
                .map((l) => l.split(': ')).map(([k, v]) => [k, Number(v)]));
            h.eq(summary.images, 0, 'no image was wired, so none was sent');
            h.assert(summary.systemChars > 0, 'the frozen SYSTEM message rode along (§5.3)');
            h.assert(summary.promptChars > 100, `the whole prompt went out: ${summary.promptChars} characters`);
            h.note(`headings: ${headings.join(' | ')}`);
        },
    },
    {
        // §6.3: vision is not a separate box, and a farm that says it cannot see is refused BEFORE
        // any request goes out. `assistant` is the mock's deliberately blind model (plan §2.3).
        name: 'k2-instruction-no-vision-is-refused-before-the-request',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            await h.waitFor(() => (window.LolComputer.app.ask.vision('assistant') === 'no' ? true : null));

            const ins = await h.computer.place('ask', 460, 120);
            const { note, wire } = await feed(h, ins, 'a picture', 'plan', 40);
            h.assert(wire, 'the image arrives on a named wire');
            // An image VALUE on the note: K4 ships the Image part, and what this scenario is about
            // is the refusal, not the intake.
            await h.eval((id) => {
                const session = window.LolComputer.debug.computer.session();
                const doc = session.doc();
                session.apply({
                    ...doc,
                    parts: doc.parts.map((p) => (p.id === id
                        ? { ...p, state: 'done', value: { kind: 'image', data: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', name: 'plan.png' } } }
                        : p)),
                    rev: (doc.rev || 1) + 1,
                }, { label: 'image' });
                return true;
            }, note);
            await h.computer.set(ins, { instruction: 'describe the plan', model: 'assistant' });

            const mark = Date.now();
            await h.computer.run({ only: [ins] });
            await settled(h);

            const live = await parts(h);
            h.eq(live[ins].state, 'error', 'a blind farm is a hard error, never a silent text-only answer');
            // Critic S1-13: {model} is this box's model, and the fix named is its Model menu.
            h.eq(live[ins].error, await str(h, 'parts.errNoVision', { model: 'assistant' }),
                'and the sentence names the model this box asks');
            const posts = await h.mock.log({ path: COMPLETIONS, since: mark });
            h.eq(posts.length, 0, 'nothing was generated to find this out');
        },
    },
];
