// @ts-check
// Critic R1 A8 (Package A, engine side) in the real app, with REAL input for every click:
//
//   "Write SVG, p5js and threejs do not work — I think the model needs more and better
//    instructions to be able to write in the context of the computer." — the owner.
//
// What is proven here, against the mock farm (never a real one — the rig check on gemma4:12b is
// the integrator's):
//   - a Write-… Instruction sends the sandbox's rules for its kind in the SYSTEM message and asks
//     for 4096 tokens — and the transcript's Sent tab, opened with a real click on the box's strip,
//     shows exactly that system text, `max_tokens: 4096` and the seed;
//   - a CODE answer that hits max_tokens (`mock-length`: 200 tokens, then finish_reason "length")
//     is a named error on the box, never a success that draws half a program;
//   - a PROSE answer that hits max_tokens is kept, and the box says the end is missing.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const COMPLETIONS = '/v1/chat/completions';

/** The Computer, shown, an EMPTY document open, the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.computer
        && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    const failed = await h.eval(() => Object.keys((window.LolComputer && window.LolComputer.failed) || {}));
    for (const k of ['host', 'ask', 'transcript', 'drawer']) h.assert(!failed.includes(k), `the real ${k} module loaded`);
    const d = await h.computer.doc();
    if (d.parts.length) await h.computer.remove(d.parts.map((/** @type {any} */ p) => p.id));
    await h.mock.reset();
    return true;
}

const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

const inBox = (/** @type {string} */ id, /** @type {string} */ sel) => `#lolcomputer .graph-part[data-id="${id}"] ${sel}`;

const partOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
    return p ? JSON.parse(JSON.stringify(p)) : null;
}, id);

const markRun = (/** @type {any} */ h) => h.eval(() => {
    /** @type {any} */ (window).__k8genReport = window.LolComputer.app.host.runner.report();
    return true;
});
const runEnded = (/** @type {any} */ h) => h.waitFor(() => {
    const r = window.LolComputer.app.host.runner;
    return !r.running() && r.report() && r.report() !== /** @type {any} */ (window).__k8genReport ? true : null;
}, { timeout: 30000 });

/** Press a box's ▶ with a REAL click, and wait until THAT run is over. */
async function play(/** @type {any} */ h, /** @type {string} */ id) {
    await markRun(h);
    await h.input.click(`#lolcomputer .graph-part-play[data-part="${id}"]`);
    await runEnded(h);
}

export default [
    {
        name: 'k8-gen-write-svg-sends-the-rules-and-4096-and-the-sent-tab-shows-them',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const ins = await h.computer.place('ask', 60, 40);
            await h.computer.set(ins, { code: 'svg', shape: 'text', instruction: 'A sun over two hills.', model: 'mock-code' });
            await play(h, ins);

            const [sent] = await h.mock.log({ path: COMPLETIONS });
            h.assert(sent && sent.body, 'one request left');
            h.eq(sent.body.max_tokens, 4096, 'a code answer asks for 4096 tokens');
            h.eq(typeof sent.body.seed, 'number', 'with a seed');
            const system = (sent.body.messages || []).filter((/** @type {any} */ m) => m.role === 'system')
                .map((/** @type {any} */ m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
            const rules = await str(h, 'parts.genSystemSvg');
            h.assert(system.endsWith(rules), 'the SVG rules ride the system message, after the frozen SYSTEM');
            h.assert(system.includes('xmlns="http://www.w3.org/2000/svg"'), 'and name the namespace an <img> needs');
            const user = (sent.body.messages || []).find((/** @type {any} */ m) => m.role === 'user');
            const prompt = typeof user.content === 'string' ? user.content : '';
            h.eq(prompt, '# Instruction\nA sun over two hills.', 'the person\'s instruction is the task only');

            const part = await partOf(h, ins);
            h.eq(part.state, 'done');
            h.eq(part.value.format, 'svg', 'the answer landed as an SVG');
            h.assert(/^<svg[\s>]/.test(part.value.data), `unfenced: ${String(part.value.data).slice(0, 40)}`);

            // The Sent tab, opened the way a person opens it: a real click on the box's strip.
            await h.input.click(inBox(ins, '.graph-ins-strip'));
            const shown = await h.waitFor(() => {
                const body = document.querySelector('#lolcomputer .comp-tx-body');
                const text = body ? body.textContent || '' : '';
                return text.includes('max_tokens') ? text : null;
            });
            h.assert(shown.includes(rules.split('\n')[0]), 'the Sent tab shows the SVG rules');
            h.assert(shown.includes('max_tokens: 4096'), 'and the real max_tokens');
            h.assert(shown.includes(await str(h, 'computer.genTxSeedNewLast', { seed: sent.body.seed })),
                'and the seed: new each run, and the one the answer came from');
        },
    },
    {
        name: 'k8-gen-a-cut-off-sketch-is-a-named-error-and-cut-prose-says-so',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const sketch = await h.computer.place('ask', 60, 40);
            await h.computer.set(sketch, { code: 'p5', shape: 'text', instruction: 'A spiral.', model: 'mock-length' });
            await play(h, sketch);
            const cut = await partOf(h, sketch);
            h.eq(cut.state, 'error', 'half a program is not a program');
            h.eq(cut.error, await str(h, 'parts.errCutOff', { n: 4096 }), 'and the box says why, and what to do');
            const shownError = await h.eval((sel) => ((document.querySelector(sel) || {}).textContent || ''), inBox(sketch, '.graph-part-error'));
            h.eq(shownError, cut.error, 'on the box itself');

            const essay = await h.computer.place('ask', 460, 40);
            await h.computer.set(essay, { instruction: 'A long essay.', model: 'mock-length' });
            await play(h, essay);
            const prose = await partOf(h, essay);
            h.eq(prose.state, 'done', 'prose that was cut is still worth reading');
            h.eq(prose.stats.cut, true);
            const chip = await h.eval((sel) => {
                const el = /** @type {any} */ (document.querySelector(sel));
                return el && !el.hidden && el.getClientRects().length > 0 ? el.textContent : '';
            }, inBox(essay, '.graph-ins-cut'));
            h.eq(chip, await str(h, 'parts.genCutChip', { n: 2048 }), 'and the box says the end is missing');
            const posts = await h.mock.log({ path: COMPLETIONS });
            h.eq(posts.map((/** @type {any} */ p) => p.body.max_tokens), [4096, 2048], 'code 4096, prose 2048');
        },
    },
];
