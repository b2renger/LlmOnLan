// @ts-check
// Critic S1, Package A (docs/reviews/COMPUTER_CRITIC_S1.md) in the real app, with REAL input for
// every click and every key (K-6: CDP's Input domain). The debug door only places boxes.
//
//   S1-1  a run refused because the window was hidden said "Nothing to run — every box is up to
//         date" and offered "Run everything again", which re-rolled the finished boxes;
//   S1-2  the run bar's sentence outlived its run — an edit, a ▶ run, a Dialog answered;
//   S1-3  a thinking model spent the whole answer budget thinking; S1-4 its thoughts came back as
//         the answer (`mock-think-length`: reasoning only, then finish_reason "length");
//   S1-8  "Show me" beside "1 question waiting" left an off-screen Dialog off screen;
//   S1-15 Ctrl+Enter in a Dialog's multi-line answer also reached the canvas as "Run".
//   S2-2  a box behind an unpressed Button read "Nothing to run — every box is up to date" and
//         offered "Run everything again"; it now names the Button to press.
//
// The mock farm answers; it never beacons. Nothing here reaches a real farm.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const COMPLETIONS = '/v1/chat/completions';

/** The Computer, shown, on a NEW empty document at 100 % from the origin, the mock at zero. */
async function freshDoc(/** @type {any} */ h, /** @type {string} */ title) {
    await h.view('computer');
    await h.waitFor(() => {
        const d = window.LolComputer && window.LolComputer.debug;
        return d && d.library && typeof d.library.openId === 'function' && d.library.openId() && d.computer ? true : null;
    }, { timeout: 20000 });
    const id = await h.eval((t) => window.LolComputer.debug.library.create(t), title);
    await h.waitFor((want) => (window.LolComputer.debug.computer.docId() === want ? true : null), { args: [id], timeout: 15000 });
    await h.eval(() => {
        const c = window.LolComputer.app.host.canvas;
        c.setView({ x: 0, y: 0, zoom: 1 });
        c.setTool('select');
        c.closePalette();
        return true;
    });
    await frame(h);
    await h.mock.reset();
    return id;
}

/** Two frames: the canvas's ONE rAF has run. */
const frame = (/** @type {any} */ h) => h.eval(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
const inBox = (/** @type {string} */ id, /** @type {string} */ sel) => `#lolcomputer .graph-part[data-id="${id}"] ${sel}`;
const partOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
    return p ? JSON.parse(JSON.stringify(p)) : null;
}, id);
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** What the run bar shows: its sentence, and whether "Run everything again" is offered. */
const bar = (/** @type {any} */ h) => h.eval(() => {
    const status = document.querySelector('#lolcomputer .comp-run-status');
    const again = /** @type {any} */ (document.querySelector('#lolcomputer .comp-run-again'));
    return {
        status: status ? status.textContent || '' : null,
        again: !!again && !again.hidden && again.getClientRects().length > 0,
    };
});

/** Every line the canvas's live region says from now on (the last one alone can hide a lie). */
const listen = (/** @type {any} */ h) => h.eval(() => {
    const live = document.querySelector('#lolcomputer .graph-live');
    if (!live) throw new Error('no .graph-live region');
    const w = /** @type {any} */ (window);
    if (w.__k10Obs) w.__k10Obs.disconnect();
    w.__k10Said = [];
    w.__k10Obs = new MutationObserver(() => { w.__k10Said.push(live.textContent || ''); });
    w.__k10Obs.observe(live, { childList: true, characterData: true, subtree: true });
    return true;
});
const heard = (/** @type {any} */ h) => h.eval(() => (/** @type {any} */ (window).__k10Said || []).slice());
const said = (/** @type {any} */ h) => h.eval(() => window.LolComputer.debug.computer.state().said);

/** Remember the runner's last report, so a wait can tell THIS run's end from the previous one's. */
const markRun = (/** @type {any} */ h) => h.eval(() => {
    /** @type {any} */ (window).__k10Report = window.LolComputer.app.host.runner.report();
    return true;
});
const runEnded = (/** @type {any} */ h) => h.waitFor(() => {
    const r = window.LolComputer.app.host.runner;
    return !r.running() && r.report() && r.report() !== /** @type {any} */ (window).__k10Report ? true : null;
}, { timeout: 30000 });
const lastReport = (/** @type {any} */ h) => h.eval(() => JSON.parse(JSON.stringify(window.LolComputer.app.host.runner.report())));

/** Press the run bar's Run all with a real click and wait for THAT run to end. */
async function runAll(/** @type {any} */ h) {
    await markRun(h);
    await h.input.click('#lolcomputer .comp-run-all');
    await runEnded(h);
    await frame(h);
}

/** Press a box's ▶ with a real click and wait for THAT run to end. */
async function play(/** @type {any} */ h, /** @type {string} */ id) {
    await markRun(h);
    await h.input.click(`#lolcomputer .graph-part-play[data-part="${id}"]`);
    await runEnded(h);
    await frame(h);
}

/** Type at the end of a box's prompt, the way a person does: click into it, End, type. */
async function typeInto(/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ text) {
    await h.input.click(inBox(id, '.graph-ins-instruction'));
    await h.input.key('End', { ctrl: true });
    await h.input.type(text);
    await frame(h);
}

/** The expected sentence for a finished report, from the SAME keys runbar.mjs's outcomeOf uses. */
const doneSentence = (/** @type {any} */ h, /** @type {any} */ r) => str(h,
    Number(r.ran) === 1 ? 'computer.runOutcomeDoneOne' : 'computer.runOutcomeDone',
    { n: Number(r.ran) || 0, sec: ((Number(r.ms) || 0) / 1000).toFixed(1) });

export default [
    {
        name: 'k10-run-outcomes-a-hidden-run-says-so-and-offers-no-re-roll',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k10 hidden');
            const a = await h.computer.place('ask', 40, 40);
            const b = await h.computer.place('ask', 400, 40);
            await h.computer.set(a, { instruction: 'Name a colour.', model: 'mock-echo' });
            await h.computer.set(b, { instruction: 'Name a fruit.', model: 'mock-echo' });
            await frame(h);

            await runAll(h);
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 2, 'both boxes ran');
            const doneB = await partOf(h, b);
            h.eq(doneB.state, 'done');
            h.eq(typeof doneB.stats.seed, 'number', 'with a seed');

            // Edit A (a real click and real typing), so it is stale; B stays done.
            await typeInto(h, a, ' Again.');
            h.eq((await partOf(h, a)).state, 'stale', 'the edited box needs a re-run');
            h.eq((await partOf(h, b)).state, 'done');

            try {
                await h.setPageVisible(false);
                await listen(h);
                const mark = Date.now();
                await runAll(h);
                const report = await lastReport(h);
                h.eq(report.yielded, true, 'the run yielded');
                h.eq(report.ran, 0);
                h.eq(report.yieldedBy && report.yieldedBy.hidden, true, 'and the report says why: the window was hidden');
                h.eq(report.yieldedBy.partId, a);
                h.eq((await h.mock.log({ path: COMPLETIONS, since: mark })).length, 0, '0 requests went out');

                const hidden = await str(h, 'computer.runOutcomeHidden');
                const shown = await bar(h);
                h.eq(shown.status, hidden, 'the bar says the window was in the background');
                h.eq(shown.again, false, '"Run everything again" is NOT offered after a run that sent nothing');
                const nothing = await str(h, 'computer.runNothing');
                h.assert(await said(h) !== nothing, 'the live region does not say "up to date"');
                h.eq(await said(h), hidden, 'it says the same sentence as the bar');
                const lines = await heard(h);
                h.assert(!lines.includes(nothing) && !lines.includes(await str(h, 'graph.runNothing')),
                    `one sentence, never overwritten by "Nothing to run": ${JSON.stringify(lines)}`);
            } finally {
                await h.setPageVisible(true);
            }

            // Visible again: Run all sends exactly ONE request — the edited box — and the finished
            // box keeps its seed and its answer.
            const mark = Date.now();
            await runAll(h);
            const posts = await h.mock.log({ path: COMPLETIONS, since: mark });
            h.eq(posts.length, 1, 'exactly one request: only the stale box');
            const afterA = await partOf(h, a);
            const afterB = await partOf(h, b);
            h.eq(afterA.state, 'done');
            h.eq(afterB.state, 'done');
            h.eq(afterB.stats.seed, doneB.stats.seed, 'the done box keeps its seed');
            h.eq(afterB.value, doneB.value, 'and its answer');
            h.eq((await bar(h)).status, await doneSentence(h, await lastReport(h)), 'and the bar reports THIS run');
        },
    },
    {
        name: 'k10-run-outcomes-the-sentence-clears-on-an-edit-and-reports-a-play-run',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k10 sentence');
            const ins = await h.computer.place('ask', 40, 40);
            await h.computer.set(ins, { instruction: 'Say hello.', model: 'mock-echo' });
            await frame(h);

            await runAll(h);
            await runAll(h);
            const nothing = await str(h, 'computer.runNothing');
            h.eq((await bar(h)).status, nothing, 'the second Run all found nothing to do, and says so');
            h.eq((await bar(h)).again, true, 'and offers "Run everything again"');

            await typeInto(h, ins, ' Again.');
            h.eq((await partOf(h, ins)).state, 'stale');
            const edited = await bar(h);
            h.eq(edited.status, '', 'an edit retires the sentence: the box is not up to date any more');
            h.eq(edited.again, false);

            await play(h, ins);
            h.eq((await partOf(h, ins)).state, 'done');
            const report = await lastReport(h);
            h.eq(report.mode, 'from', 'that was the box\'s ▶, not Run all');
            const want = await doneSentence(h, report);
            h.eq((await bar(h)).status, want, 'the bar reports the ▶ run');
            h.eq(await said(h), want, 'and the live region says the same sentence');
        },
    },
    {
        // Critic S2-2: Button → Instruction, Run all. The Instruction waits for the press; the bar
        // used to say "Nothing to run — every box is up to date" and offer "Run everything again".
        name: 'k10-run-outcomes-a-box-behind-an-unpressed-button-names-the-button',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k10 held');
            const btn = await h.computer.place('button', 40, 40);
            const ins = await h.computer.place('ask', 400, 40);
            await h.computer.set(btn, { text: 'Go' });
            await h.computer.set(ins, { instruction: 'Say hello.', model: 'mock-echo' });
            h.eq((await h.computer.wire(btn, ins, 'in')).ok, true, 'the Button feeds the Instruction');
            await frame(h);

            await listen(h);
            await runAll(h);
            const report = await lastReport(h);
            h.eq(report.ran, 0, 'Run all never presses a Button');
            h.eq(report.heldBy, [btn], 'the report names the Button that held the run');
            h.eq(report.held, [ins], 'and the box waiting for its press');
            h.eq((await partOf(h, ins)).state, 'stale');
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 0, 'nothing was sent');

            const want = await str(h, 'computer.runOutcomeHeldOne', { button: 'Go' });
            const shown = await bar(h);
            h.eq(shown.status, want, 'the bar says which Button to press');
            h.eq(shown.again, false, '"Run everything again" is NOT offered');
            h.eq(await said(h), want, 'the live region says the same sentence');
            const nothing = await str(h, 'computer.runNothing');
            h.assert(!(await heard(h)).includes(nothing), 'never "every box is up to date"');

            // The press, with a real click on the Button's face, runs the box after it.
            await markRun(h);
            await h.input.click(`#lolcomputer .graph-part[data-id="${btn}"] .graph-btn-face`);
            await runEnded(h);
            await frame(h);
            h.eq((await partOf(h, ins)).state, 'done', 'pressing the Button ran the Instruction');
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 1, 'one request: the Instruction');
            const pressed = await lastReport(h);
            h.eq(pressed.heldBy, [], 'nothing is held any more');
            h.eq((await bar(h)).status, await doneSentence(h, pressed), 'and the bar reports that run');
        },
    },
    {
        name: 'k10-run-outcomes-a-thinking-cut-is-a-named-error-with-no-value',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k10 think');
            const svg = await h.computer.place('ask', 40, 40);
            await h.computer.set(svg, { code: 'svg', shape: 'text', instruction: 'A sun over two hills.', model: 'mock-think-length' });
            const essay = await h.computer.place('ask', 400, 40);
            await h.computer.set(essay, { instruction: 'A short essay.', model: 'mock-think-length' });
            await frame(h);

            await play(h, svg);
            const [sent] = await h.mock.log({ path: COMPLETIONS });
            h.assert(sent && sent.body, 'one request left');
            const planned = (await h.computer.preview(svg)).call.maxTokens;
            h.eq(sent.body.max_tokens, planned, 'the request carries the planned max_tokens');
            h.assert(planned > 4096 && planned < 16384,
                `S1-3: the 16384 ceiling, clamped to what the prompt leaves of the mock's 16k slot: ${planned}`);
            const cut = await partOf(h, svg);
            h.eq(cut.state, 'error', 'a sketch cut off while thinking is not a sketch');
            h.eq(cut.error, await str(h, 'parts.errCutOffThinking', { n: planned }), 'and the box says the tokens went on thinking');
            h.eq(cut.value, null, 'S1-4: no value — the thoughts are not the answer');

            // The Sent tab, opened with a real click on the box's strip, shows the same number.
            await h.input.click(inBox(svg, '.graph-ins-strip'));
            const text = await h.waitFor(() => {
                const body = document.querySelector('#lolcomputer .comp-tx-body');
                const s = body ? body.textContent || '' : '';
                return s.includes('max_tokens') ? s : null;
            });
            h.assert(text.includes(`max_tokens: ${planned}`), 'the Sent tab shows the clamped max_tokens');
            await h.computer.transcript.close();

            await play(h, essay);
            const prose = await partOf(h, essay);
            const proseMax = (await h.computer.preview(essay)).call.maxTokens;
            h.eq(proseMax, 8192, 'prose: its 8192 ceiling fits the slot whole');
            h.eq(prose.state, 'error', 'prose cut before a word was written is not an answer either');
            h.eq(prose.error, await str(h, 'parts.errCutOffThinking', { n: proseMax }));
            h.eq(prose.value, null, 'and nothing flows downstream');

            // F8 still holds under `stop`: JSON that arrives only as reasoning has answered.
            const list = await h.computer.place('ask', 40, 400);
            await h.computer.set(list, { instruction: 'Three fruits.', shape: 'list', model: 'mock-json-reasoning-only' });
            await frame(h);
            await play(h, list);
            const got = await partOf(h, list);
            h.eq(got.state, 'done', 'mock-json-reasoning-only (finish stop) still parses');
            h.eq(got.value && got.value.kind, 'list');
        },
    },
    {
        name: 'k10-run-outcomes-show-me-brings-the-question-into-view-and-focuses-it',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k10 show me');
            const dlg = await h.computer.place('dialog', 3000, 2000);
            await h.computer.set(dlg, { question: 'Which colour?' });
            await frame(h);

            await markRun(h);
            await h.input.click('#lolcomputer .comp-run-all');
            await h.waitFor(() => {
                const b = /** @type {any} */ (document.querySelector('#lolcomputer .comp-run-show-waiting'));
                return b && !b.hidden ? true : null;
            }, { timeout: 15000 });
            const offscreen = await h.eval((sel) => {
                const box = document.querySelector(sel).getBoundingClientRect();
                const c = document.querySelector('#lolcomputer .graph-canvas').getBoundingClientRect();
                return box.left >= c.right || box.top >= c.bottom || box.right <= c.left || box.bottom <= c.top;
            }, `#lolcomputer .graph-part[data-id="${dlg}"]`);
            h.eq(offscreen, true, 'the question starts off screen');

            await h.input.click('#lolcomputer .comp-run-show-waiting');
            await frame(h);
            const seen = await h.eval((sel, id) => {
                const box = document.querySelector(sel).getBoundingClientRect();
                const c = document.querySelector('#lolcomputer .graph-canvas').getBoundingClientRect();
                const inter = box.left < c.right && box.right > c.left && box.top < c.bottom && box.bottom > c.top;
                const a = document.activeElement;
                return {
                    inter,
                    focused: !!a && a.classList.contains('graph-part-answer') && a.getAttribute('data-part') === id,
                };
            }, `#lolcomputer .graph-part[data-id="${dlg}"]`, dlg);
            h.eq(seen.inter, true, 'S1-8: after "Show me" the Dialog intersects the canvas');
            h.eq(seen.focused, true, 'and its answer field has the focus');
            h.eq((await bar(h)).status, await str(h, 'computer.runWaitFor', { part: await str(h, 'parts.dlgLabel') }));

            // The next keys ARE the answer.
            await h.input.type('blue');
            await h.input.key('Enter');
            await runEnded(h);
            await frame(h);
            const answered = await partOf(h, dlg);
            h.eq(answered.state, 'done');
            h.eq(answered.value && answered.value.data, 'blue');
            const status = (await bar(h)).status;
            h.assert(status !== await str(h, 'computer.runWaitFor', { part: await str(h, 'parts.dlgLabel') }),
                'S1-2: "Waiting for Dialog" does not outlive the question');
            h.eq(status, await doneSentence(h, await lastReport(h)), 'the bar reports the run instead');
        },
    },
    {
        name: 'k10-run-outcomes-ctrl-enter-in-a-dialog-answers-and-starts-nothing',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k10 ctrl enter');
            const dlg = await h.computer.place('dialog', 40, 40);
            await h.computer.set(dlg, { question: 'Describe it.', multiline: true });
            await frame(h);

            await markRun(h);
            await h.input.click('#lolcomputer .comp-run-all');
            await h.waitFor((id) => {
                const f = /** @type {any} */ (document.querySelector(`#lolcomputer .graph-part-answer[data-part="${id}"]`));
                return f && !f.hidden && f.getClientRects().length > 0 ? true : null;
            }, { args: [dlg], timeout: 15000 });
            await h.input.click(`#lolcomputer .graph-part-answer[data-part="${dlg}"]`);
            await h.input.type('deep blue');
            await listen(h);
            await h.input.key('Enter', { ctrl: true });
            await runEnded(h);
            await frame(h);

            const answered = await partOf(h, dlg);
            h.eq(answered.state, 'done', 'Ctrl+Enter sent the answer');
            h.eq(answered.value && answered.value.data, 'deep blue');
            const lines = await heard(h);
            const already = await str(h, 'computer.runOutcomeAlready');
            const busy = await str(h, 'graph.runBusy');
            h.assert(!lines.includes(already) && !lines.includes(busy),
                `S1-15: the key never reached the canvas as "Run": ${JSON.stringify(lines)}`);
            h.eq(await h.computer.running(), false, 'and no second run was started');
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 0, 'a Dialog asks the person, never the farm');
        },
    },
];
