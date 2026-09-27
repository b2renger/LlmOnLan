// @ts-check
// K6 kickoff (LOLCHAT_PLAN 2.6 KF): the SEAMS between the three K6 units, in the real browser,
// reached the way a person reaches them (build rule 6) — the ＋ menu is CLICKED, a file is DROPPED
// with a real DragEvent. Integrator-owned; each unit has its own scenario file (k6-takes,
// k6-document, k6-audio, k6-drops) for the depth.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Poll a NODE-side async check (h.waitFor runs its function in the page). */
async function until(/** @type {any} */ h, /** @type {() => Promise<any>} */ fn, /** @type {number} */ ms, /** @type {string} */ what) {
    const end = Date.now() + ms;
    let last = null;
    while (Date.now() < end) {
        last = await fn();
        if (last) return last;
        await h.sleep(100);
    }
    throw new Error(`timed out after ${ms} ms waiting for ${what}; last: ${JSON.stringify(last)}`);
}

/** The Computer, shown, with a document open and the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();
    await h.mock.state({ extract: null });
    await h.publishFarm();
    return true;
}

export default [
    {
        name: 'k6-seams-bring-in-offers-a-document-and-a-sound-box-that-say-what-this-farm-takes',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const rows = await h.computer.menu.open();
            const bring = rows.filter((/** @type {any} */ r) => r.group === 'bring').map((/** @type {any} */ r) => r.entry);
            h.eq(bring.slice(0, 5).join(','), 'note,image,document,audio,file', '"Bring in" offers Document and Sound right after Image');
            await h.computer.menu.key('Escape');

            // A PDF box on a farm with NO extractor says so, in words, before anything is dropped.
            const docId = await h.computer.add('document');
            h.assert(!!docId, 'clicking "Document" placed a box');
            let takes = await until(h, () => h.computer.takes(docId), 5000, 'the takes line of the Document box');
            h.eq(takes.kind, 'pdf');
            h.eq(takes.state, 'no', 'the default mock farm advertises no extractor');
            h.eq(takes.whyShown, true, 'the refusal is a visible sentence, not a tooltip');
            h.assert(/document reading/i.test(takes.why), `it says why: ${takes.why}`);

            // The farm starts advertising its extractor → the same box says yes, with no reload.
            await h.computer.ocr(true);
            takes = await until(h, async () => {
                const t = await h.computer.takes(docId);
                return t && t.state === 'yes' ? t : null;
            }, 8000, 'the PDF line to say yes');
            h.eq(takes.state, 'yes', 'a farm that reads documents flips the line to yes');

            // A Sound box: nothing wired → "wire it"; wired into an Instruction → "not sent", and why.
            const audioId = await h.computer.add('audio');
            h.eq((await h.computer.takes(audioId)).state, 'unwired');
            const askId = await h.computer.add('ask');
            h.assert(await h.computer.wire(audioId, askId, 'in'), 'a Sound box wires into an Instruction');
            takes = await until(h, async () => {
                const t = await h.computer.takes(audioId);
                return t && t.state === 'no' ? t : null;
            }, 5000, 'the wired Sound box to say no');
            h.eq(takes.whyShown, true);
            h.assert(/not sent/i.test(takes.why), `the sound is not sent, and the box says so: ${takes.why}`);

            // The Instruction says what ITS model can take, as far as the farm has said.
            const line = await until(h, () => h.eval((id) => {
                const el = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-ins-caps`);
                return el && !el.hidden && el.textContent ? el.textContent : null;
            }, askId), 8000, 'the model line of the Instruction');
            h.assert(/pictures/.test(line) && /sound/.test(line), `the model line names what it can take: ${line}`);

            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'placing and wiring asks the farm nothing');
            h.eq((await h.mock.log({ path: '/ocr/process' })).length, 0, 'and sends it nothing to read');
        },
    },
    {
        name: 'k6-seams-a-graph-file-dropped-on-the-canvas-still-opens-through-the-router',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const id = await h.computer.place('note', 40, 40);
            await h.computer.set(id, { text: 'dropped graph marker' });
            const text = await h.computer.exportText({});
            await h.computer.remove([id]);
            h.eq((await h.computer.doc()).parts.length, 0, 'an empty canvas to drop onto');

            const out = await h.computer.dropFiles([{
                name: 'k6.lolgraph.json', mime: 'application/json', base64: Buffer.from(String(text)).toString('base64'),
            }]);
            h.eq(out.defaultPrevented, true, 'the canvas took the drop');
            const found = await until(h, async () => {
                const d = await h.computer.doc();
                const p = d.parts.find((/** @type {any} */ x) => x.type === 'note' && x.settings && x.settings.text === 'dropped graph marker');
                return p ? p : null;
            }, 8000, 'the dropped graph to open');
            h.assert(!!found, 'the graph file opened, exactly as before K6');
            const routed = await h.eval(() => window.LolComputer.app.drops.debug().routed);
            h.eq(routed, 1, 'and it went through the drop router (app.drops), the one door');
        },
    },
];
