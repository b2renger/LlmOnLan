// @ts-check
// K3-U2 in the real browser: the six control parts (COMPUTER_PLAN §6.6, §4.5, §4.6, §11 K3-U2).
//
// The acceptance list this file owns, verbatim:
//
//   the lesson-9 fan (one Instruction → three Conditions → three Confirms): exactly one branch
//   continues and the other two wires grey · a Confirm parks and THE OTHER BRANCH KEEPS RUNNING ·
//   Cancel ends that branch and the report counts `barred` · two Dialogs wait at once and the bar
//   says `2 questions waiting` · the text-adventure loop with the Toggle OFF advances exactly one
//   step per ▶, and with it ON stops at `maxIterations` with the ceiling named.
//
// WHAT NEEDS THE SCHEDULER, AND WHAT DOES NOT. Five of those six clauses are statements about the
// RUN LOOP — other branches continuing past a park, the barred count in the report, two parks at
// once, the loop ceilings — and the run loop is K3-U1's. While the kickoff shim in
// `graph/runner.mjs` stands, a park is awaited INLINE: the run does not continue, so those clauses
// cannot be true yet and asserting them would only be asserting the shim. So this file PROBES for
// the real scheduler once (a report that carries `mode`/`barred` is K3-U1's; the C1 report is not)
// and runs the branch block only against it. Everything that is K3-U2's alone — the six parts, the
// parks and their DOM, cancel-by-Stop, the loop-gate refusal, the declared back edge, the Toggle's
// bar-and-publish — runs unconditionally, against the shipped canvas.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

const CONTROLS = ['button', 'condition', 'confirm', 'dialog', 'toggle', 'timer'];

/** Fail loudly when the surface this unit decorates was faked or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host', 'ask'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`K3-U2 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    return true;
});

/** The Computer, shown, with a document open and the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();
    return true;
}

/** The live parts, by id. */
const parts = (/** @type {any} */ h) => h.eval(() => {
    const out = {};
    for (const p of window.LolComputer.debug.computer.state().parts) {
        out[p.id] = { type: p.type, state: p.state, error: p.error, value: p.value && p.value.data };
    }
    return out;
});

/** What the canvas last said, in the live region a screen reader hears. */
const said = (/** @type {any} */ h) => h.eval(() => {
    const el = document.querySelector('#lolcomputer .graph-live');
    return el ? el.textContent : '';
});

/**
 * Start a run WITHOUT waiting for it. A run that parks does not resolve until somebody answers,
 * so awaiting it here would hang the scenario instead of testing it. The report lands on
 * `window.__k3` when the run ends.
 * @param {any} h @param {any} [opts] @param {string} [from] a part id → the per-box ▶ door
 */
const startRun = (h, opts, from) => h.eval((o, seed) => {
    const dbg = window.LolComputer.debug.computer;
    window.__k3 = null;
    const p = seed ? dbg.runFrom(seed, o || {}) : dbg.run(o || {});
    Promise.resolve(p).then((r) => { window.__k3 = r; });
    return true;
}, opts || {}, from || null);

/** Wait for the run started by `startRun` to end, and hand back its report. */
const report = (h, timeout = 30000) => h.waitFor(() => (window.__k3 === null ? null : window.__k3), { timeout });

/** Does the REAL scheduler serve this page, or the kickoff shim? One cheap run of one Note. */
async function hasScheduler(/** @type {any} */ h) {
    const note = await h.computer.place('note', 20, 20);
    await h.computer.set(note, { text: 'probe' });
    await startRun(h, {});
    const r = await report(h);
    await h.computer.remove([note]);
    // K3-U1's `RunReport` grows `mode`, `seeds`, `barred`, `activations` (KC-5). The C1 report has
    // none of them, so one key is enough and no version number has to be invented.
    return !!(r && (typeof r.mode === 'string' || typeof r.barred === 'number'));
}

export default [
    {
        // Everything that is K3-U2's alone, on the shipped canvas, whatever the runner is.
        name: 'k3-control',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            // 1. All six are in the palette, place without throwing, and DECLARE what the
            //    scheduler reads. A declaration the canvas cannot see is one the scheduler will
            //    not honour either.
            const placed = {};
            let x = 40;
            for (const type of CONTROLS) {
                placed[type] = await h.computer.place(type, x, 40);
                h.assert(placed[type], `${type} did not place`);
                x += 220;
            }
            const decls = await h.eval(() => {
                const specs = window.LolComputer.debug.computer.session().specs;
                const out = {};
                for (const [type, spec] of specs) {
                    out[type] = {
                        control: !!spec.control,
                        manual: !!spec.manual,
                        output: spec.output || null,
                        thinks: !!spec.thinks,
                        volatile: typeof spec.volatileFor === 'function',
                    };
                }
                return out;
            });
            h.eq(decls.button.manual, true, 'Button must be manual:true or Run-all presses it');
            for (const type of CONTROLS) h.eq(decls[type].control, true, `${type} is not control:true`);
            h.eq(decls.dialog.volatile, true, 'Dialog decides askEveryRun per box, through volatileFor');
            h.eq(decls.condition.thinks, true, 'a model-mode Condition spends a generation, and says so');

            // 2. THE RULE EVERYTHING RESTS ON (§4.5): a Toggle that is off BARS and still
            //    PUBLISHES. Never conflate activation with value.
            await h.computer.remove([placed.confirm, placed.dialog, placed.timer, placed.condition, placed.button]);
            const note = await h.computer.place('note', 40, 300);
            await h.computer.set(note, { text: 'carried' });
            const toggle = placed.toggle;
            await h.computer.wire(note, toggle, 'in');
            await h.computer.set(toggle, { on: false });
            await startRun(h, {}, note);
            await report(h);
            const afterToggle = (await parts(h))[toggle];
            h.eq(afterToggle.value, 'carried', 'a barred Toggle still publishes its value');
            h.eq(afterToggle.state, 'done', 'and it RAN — barring is not failing');

            // 3. A loop needs a gate. Two Instructions feeding each other is refused BEFORE a
            //    generation is spent, and the refusal is a sentence with the fix in it (§4.6).
            const a = await h.computer.place('ask', 40, 500);
            const b = await h.computer.place('ask', 400, 500);
            h.eq((await h.computer.wire(a, b, 'in')).ok, true);
            const ungated = await h.computer.wire(b, a, 'in');
            h.eq(ungated.ok, false, 'a loop with nothing that can stop it is not drawable');
            h.eq(ungated.reason, 'loop-ungated');
            const sentence = await said(h);
            h.assert(/loop/i.test(sentence) && /toggle/i.test(sentence),
                `the refusal names the fix, not a code: "${sentence}"`);

            // …and with a Toggle in the ring it IS drawable, and the closing edge is DECLARED.
            const gate = await h.computer.place('toggle', 400, 640);
            h.eq((await h.computer.wire(b, gate, 'in')).ok, true);
            const closing = await h.computer.wire(gate, a, 'in');
            h.eq(closing.ok, true, 'a loop with a gate in it is a graph we draw');
            const wires = await h.eval(() => window.LolComputer.debug.computer.doc().wires
                .map((w) => ({ id: w.id, from: w.from, to: w.to, back: !!w.back })));
            const backs = wires.filter((w) => w.back);
            h.eq(backs.length, 1, `exactly one declared back edge: ${JSON.stringify(wires)}`);
            h.eq(backs[0].to, a, 'and it is the one that closes the ring');

            // 4. A park is real, is ON THE BOX, and Stop ends it. This is the half of the wait
            //    that is K3-U2's: the question renders in the part with its own field and Send,
            //    the park registry sees it, and an abort answers it instead of throwing.
            await h.fresh();
            await open(h);
            const dlg = await h.computer.place('dialog', 200, 120);
            await h.computer.set(dlg, { question: 'Which door?', default: 'left' });
            await startRun(h, {}, dlg);
            await h.waitFor(() => (document.querySelector('#lolcomputer .graph-part-answer') ? true : null), { timeout: 15000 });
            const waiting = await h.computer.waits();
            h.eq(waiting.length, 1, 'the park registry holds exactly the one question');
            h.eq(waiting[0].kind, 'dialog');
            h.eq(waiting[0].question, 'Which door?');
            h.eq((await parts(h))[dlg].state, 'waiting', 'the box says it is waiting for a person');

            await h.computer.stop();
            const stopped = await report(h);
            h.assert(stopped, 'Stop ended the run rather than leaving it parked for ever');
            h.eq((await h.computer.waits()).length, 0, 'and no park is left behind the run (§4.8)');

            // 5. …and an ANSWER is what it wants. Same box, same door, this time a human types.
            await startRun(h, {}, dlg);
            await h.waitFor(() => (document.querySelector('#lolcomputer .graph-part-answer') ? true : null), { timeout: 15000 });
            await h.computer.answer(dlg, 'the red one');
            const answered = await report(h);
            h.assert(answered, 'the run ended once the question was answered');
            h.eq((await parts(h))[dlg].value, 'the red one', 'and what the human typed IS the value');

            // 6. THE BUTTON, in the browser. K3-U2 filed this as a contract request and the K3
            //    landing resolved it in `graph/topo.mjs`: §6.6 excludes a `manual` part from
            //    RUN-ALL only, so a WAVE into a Button now activates it (that is the only way it
            //    can bar) and a press on its own face is a seed. The three sentences below are
            //    the ones that were unassertable while `activeSet` filtered `manual` out of
            //    mode 'from' as well.
            await h.fresh();
            await open(h);
            const src = await h.computer.place('note', 40, 40);
            await h.computer.set(src, { text: 'the expensive branch starts here' });
            const gateBtn = await h.computer.place('button', 340, 40);
            const after = await h.computer.place('toggle', 640, 40);
            await h.computer.set(after, { on: true });
            await h.computer.wire(src, gateBtn, 'in');
            await h.computer.wire(gateBtn, after, 'in');

            const waveReport = await h.computer.runFrom(src);
            const afterWave = await parts(h);
            h.eq(afterWave[gateBtn].state, 'done',
                'a wave into an unpressed Button must RUN it so it can bar: ' + JSON.stringify(afterWave[gateBtn]));
            h.eq(afterWave[after].state, 'stale',
                'the box past an unpressed Button is stale, never red: ' + JSON.stringify(afterWave[after]));
            h.eq(afterWave[after].error, null, 'and it carries no error sentence');
            h.assert((waveReport.barred || []).includes(after),
                'the report counts the held branch as barred: ' + JSON.stringify(waveReport.barred));

            // The gesture: one click on the face records the press AND starts the push run.
            await h.computer.control(gateBtn, 'press');
            await h.waitFor(() => {
                const st = window.LolComputer.debug.computer.state().parts;
                const t2 = st.find((p) => p.type === 'toggle');
                return t2 && t2.state === 'done' ? true : null;
            }, { timeout: 20000 });
            const afterPress = await parts(h);
            h.eq(afterPress[after].state, 'done', 'a pressed Button lets the wave carry on');
            h.eq(afterPress[after].value, 'the expensive branch starts here',
                'and what carries on is the value that arrived: ' + JSON.stringify(afterPress[after].value));

            h.note('K3-U2: six parts placed, Toggle bars-and-publishes, loop-gate refusal, park + Stop + answer, '
                + 'and the Button gate asserted in the browser after the landing fixed activeSet.');
        },
    },
    {
        // The five clauses that are statements about the RUN LOOP. Gated on K3-U1's scheduler:
        // see the header — under the kickoff shim they cannot be true, and a test that passes
        // against a shim is a test that has to be deleted.
        name: 'k3-control-branches',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            if (!await hasScheduler(h)) {
                h.note('SKIPPED: graph/runner.mjs is still the K3 kickoff shim (a park is awaited '
                    + 'inline, so no branch can continue past one). K3-U1 lands the loop; this '
                    + 'block asserts the fan, the concurrent waits, the barred count and the two '
                    + 'loop ceilings the moment it does.');
                return;
            }

            // ---- the lesson-9 fan -------------------------------------------------------------
            // One Instruction, three Conditions (yes/no/maybe), three Confirms. The model is
            // scripted to say `yes`, so exactly one branch continues and the other two wires grey.
            await h.mock.state({ verdicts: ['yes'] });
            const ins = await h.computer.place('ask', 40, 40);
            await h.computer.set(ins, { instruction: 'is the draft finished?', model: 'mock-echo' });
            const branches = {};
            let y = 40;
            for (const branch of ['yes', 'no', 'maybe']) {
                const cond = await h.computer.place('condition', 400, y);
                await h.computer.set(cond, { branch, mode: 'model', question: 'Is it finished?', model: 'mock-verdict' });
                await h.computer.wire(ins, cond, 'in');
                const after = await h.computer.place('confirm', 760, y);
                await h.computer.set(after, { message: `continue the ${branch} branch?` });
                await h.computer.wire(cond, after, 'in');
                // Something past the Confirm, so a barred branch has a wire to grey: a barrier
                // refuses what comes NEXT, and "next" is what the reader sees go grey.
                const tail = await h.computer.place('collect', 1120, y);
                await h.computer.wire(after, tail, 'items');
                branches[branch] = { cond, confirm: after, tail };
                y += 200;
            }
            // A branch off the Instruction that no Condition gates: it must finish WHILE the
            // Confirm is parked, which is the whole point of parking instead of blocking.
            const other = await h.computer.place('collect', 400, 700);
            await h.computer.wire(ins, other, 'items');

            await startRun(h, {});
            await h.waitFor(() => (window.LolComputer.debug.computer.waits().length ? true : null), { timeout: 30000 });
            const live = await parts(h);
            h.eq(live[branches.yes.confirm].state, 'waiting', 'the matched branch reached its Confirm and parked');
            h.eq(live[branches.no.confirm].state, 'stale', 'a barred branch goes STALE, never error (§4.5)');
            h.eq(live[branches.maybe.confirm].state, 'stale');
            h.eq(live[other].state, 'done', 'and the other branch kept running past the park');

            // Cancel ends that branch, and the report counts what was barred.
            await h.computer.control(branches.yes.confirm, 'cancel');
            const fan = await report(h);
            h.assert(fan, 'the run ended when the last question was answered');
            const barredIds = Array.isArray(fan.barred) ? fan.barred : [];
            const barredCount = Array.isArray(fan.barred) ? fan.barred.length : Number(fan.barred || 0);
            h.assert(barredCount >= 2, `the report counts what was barred: ${JSON.stringify(fan.barred)}`);
            for (const branch of ['no', 'maybe']) {
                h.assert(barredIds.indexOf(branches[branch].confirm) >= 0,
                    `the ${branch} branch was barred by its Condition: ${JSON.stringify(barredIds)}`);
            }
            h.assert(barredIds.indexOf(branches.yes.tail) >= 0,
                'and Cancel barred what came after the Confirm — that is what Cancel MEANS');

            // …and a reader sees it without reading a report: the wires out of a barred box grey.
            // The canvas repaints on its own schedule, so this waits for the picture rather than
            // racing it.
            // BOTH ENDS since the K3 landing: a barred id names a box the run DROPPED, so the
            // arrow the wave failed to cross INTO it is grey too — that is the one the reader is
            // looking at when a Condition chooses one branch of three.
            const want = (await h.eval(() => window.LolComputer.debug.computer.doc().wires))
                .filter((w) => barredIds.indexOf(w.from) >= 0 || barredIds.indexOf(w.to) >= 0)
                .map((w) => w.id).sort();
            h.assert(want.length >= 2, `the barred boxes really do feed something: ${JSON.stringify(want)}`);
            const grey = await h.waitFor(() => {
                const on = Array.from(document.querySelectorAll('#lolcomputer .graph-wire[data-barred="true"]'))
                    .map((el) => el.getAttribute('data-wire')).sort();
                return on.length ? on : null;
            }, { timeout: 10000 });
            h.eq(JSON.stringify(grey), JSON.stringify(want),
                'exactly the wires out of a barred box are grey, and that grey is most of the teaching');

            // ---- two questions waiting at once -----------------------------------------------
            await h.fresh();
            await open(h);
            const d1 = await h.computer.place('dialog', 40, 40);
            const d2 = await h.computer.place('dialog', 400, 40);
            await h.computer.set(d1, { question: 'Which door?' });
            await h.computer.set(d2, { question: 'Which key?' });
            await startRun(h, {});
            await h.waitFor(() => (window.LolComputer.debug.computer.waits().length >= 2 ? true : null), { timeout: 30000 });
            const two = await h.computer.states();
            h.assert(/2/.test(String(two.runbar)), `the bar counts the waiting questions: "${two.runbar}"`);
            await h.computer.answer(d1, 'the red one');
            await h.computer.answer(d2, 'the brass one');
            await report(h);

            // ---- the text-adventure loop ------------------------------------------------------
            await h.fresh();
            await open(h);
            await h.mock.reset();
            const step = await h.computer.place('ask', 40, 40);
            await h.computer.set(step, { instruction: 'take one step', model: 'mock-echo' });
            const gate = await h.computer.place('toggle', 400, 40);
            const story = await h.computer.place('ask', 760, 40);
            await h.computer.set(story, { instruction: 'tell what happened', model: 'mock-echo' });
            await h.computer.wire(step, gate, 'in');
            await h.computer.wire(gate, story, 'in');
            const loop = await h.computer.wire(story, step, 'in');
            h.eq(loop.ok, true, 'the Toggle makes the ring legal');

            // OFF: the wave stops AT the gate. One ▶ advances exactly one step — the Instruction
            // before the Toggle runs, and the one after it does not — and a second ▶ does exactly
            // the same, which is what makes a text adventure a text adventure and not a runaway.
            // (Generations are not the measure here: iteration 1 is unsalted, so the second press
            // is answered from the ask cache for free — §4.6. ACTIVATIONS are the measure.)
            await h.computer.set(gate, { on: false });
            await startRun(h, {}, step);
            const first = await report(h);
            const stepsOf = (r) => Number(r && (r.activations != null ? r.activations : r.ran)) || 0;
            h.eq(stepsOf(first), 2, `one ▶ ran the step and the gate, and stopped there: ${JSON.stringify(first)}`);
            h.eq((await parts(h))[story].state, 'stale', 'nothing past the gate was activated');
            await startRun(h, {}, step);
            const second = await report(h);
            h.eq(stepsOf(second), 2, 'and the next ▶ takes exactly one more step — never two, never none');
            const offSpend = (await h.mock.log({ path: '/v1/chat/completions' })).length;

            // ON: it spins — and STOPS, at a ceiling, with the ceiling named.
            await h.computer.set(gate, { on: true });
            await startRun(h, {}, step);
            const spun = await report(h, 120000);
            h.assert(spun, 'a loop that cannot be stopped by hand still ends on its own');
            // NAMED means the STRUCTURED field, not a substring: every report carries an
            // `iterations` map whatever ended the run, so a /iteration/i match over the JSON would
            // pass for a plain break and test nothing (K3 fix pass).
            const ceiling = spun.limited && spun.limited.ceiling;
            h.eq(ceiling, 'maxIterations',
                `the stop names maxIterations as the ceiling it hit: ${JSON.stringify(spun.limited)}`);
            h.eq(spun.limited.partId, step, 'and names the part that was going round');
            const named = JSON.stringify(spun) + ' ' + String((await h.computer.states()).runbar);
            h.assert(/maxIterations|iteration/i.test(named),
                `and the reader is told, not just the report: ${named}`);
            const spins = (await h.mock.log({ path: '/v1/chat/completions' })).length - offSpend;
            h.assert(spins > 1 && spins <= 40, `the loop really iterated, and really stopped: ${spins} generations`);

            h.note('K3-U2 branches: the lesson-9 fan, two parks at once, and both halves of the loop.');
        },
    },
];
