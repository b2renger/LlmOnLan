// @ts-check
// Critic R1 A1 + A2 (Package A) in the real app, driven with REAL input (K-6: CDP's Input domain —
// hit testing, focus, default actions — exactly as a person's mouse and keyboard). Every new
// control is reached by CLICKING it: the seed field, 🎲, ✕, Keep, "Run everything again" and the
// "Fill in {names}" checkbox. The debug door only places boxes and draws the wires.
//
//   A1 "when we rerun we need a new seed, because we always get the same results; we want control
//      about the seed" — ▶ twice is two requests with two seeds (no cache replay); a pinned seed is
//      one request and then the cache; Keep pins the seed an answer came from; a Run all that finds
//      nothing stale offers "Run everything again" and that re-run brings new seeds.
//   A2 "what does 'substitute short values in place' mean?" — the row is "Fill in {names} with
//      their values", it is offered only when a bound name is written in braces, and it fills ONLY
//      the braced form: "Stay on topic." stays a sentence.
//
// The mock farm answers `mock-echo`; each request's body (and so its `seed` and `max_tokens`) is
// read back from the mock's own log. The mock never beacons, and nothing here reaches a real farm.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const COMPLETIONS = '/v1/chat/completions';

/** The Computer, shown, an EMPTY document open, the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.computer
        && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    const failed = await h.eval(() => Object.keys((window.LolComputer && window.LolComputer.failed) || {}));
    for (const k of ['host', 'ask', 'runbar', 'transcript']) h.assert(!failed.includes(k), `the real ${k} module loaded`);
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

/** One part as the document holds it. */
const partOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
    return p ? JSON.parse(JSON.stringify(p)) : null;
}, id);

/** What the Instruction box shows about its seed. */
const seedView = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const box = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"]');
    if (!box) throw new Error('no box ' + pid);
    const q = (/** @type {string} */ s) => /** @type {any} */ (box.querySelector(s));
    const shown = (/** @type {any} */ el) => !!el && !el.hidden && el.getClientRects().length > 0;
    return {
        input: q('.graph-ins-seed-input') ? q('.graph-ins-seed-input').value : null,
        placeholder: q('.graph-ins-seed-input') ? q('.graph-ins-seed-input').placeholder : null,
        used: shown(q('.graph-ins-seed-used')) ? q('.graph-ins-seed-used').textContent : '',
        keep: shown(q('.graph-ins-seed-keep')),
        dice: shown(q('.graph-ins-seed-dice')),
        clear: shown(q('.graph-ins-seed-clear')),
        inline: shown(q('.graph-ins-inline-wrap')),
        inlineText: q('.graph-ins-inline span') ? q('.graph-ins-inline span').textContent : '',
        inlineTitle: q('.graph-ins-inline') ? q('.graph-ins-inline').title : '',
        inlineHint: shown(q('.graph-ins-hint')) ? q('.graph-ins-hint').textContent : '',
    };
}, id);

/** Every completion the mock received since `since`, as {seed, maxTokens, body}. */
async function posts(/** @type {any} */ h, since = 0) {
    const log = await h.mock.log({ path: COMPLETIONS, since });
    return log.map((/** @type {any} */ e) => ({ seed: e.body ? e.body.seed : undefined, maxTokens: e.body ? e.body.max_tokens : undefined, body: e.body }));
}

/** Wait until no run is live. */
const settled = (/** @type {any} */ h) => h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true));

/** Remember the runner's last report, so a wait can tell THIS run's end from the previous one's. */
const markRun = (/** @type {any} */ h) => h.eval(() => {
    const r = window.LolComputer.app.host.runner;
    /** @type {any} */ (window).__k8genReport = r.report();
    return true;
});

/** Wait until a run that started after `markRun` has finished. */
const runEnded = (/** @type {any} */ h) => h.waitFor(() => {
    const r = window.LolComputer.app.host.runner;
    return !r.running() && r.report() && r.report() !== /** @type {any} */ (window).__k8genReport ? r.report().mode || true : null;
}, { timeout: 20000 });

/** Press a box's ▶ with a REAL click, and wait until THAT run is over. */
async function play(/** @type {any} */ h, /** @type {string} */ id) {
    await markRun(h);
    await h.input.click(`#lolcomputer .graph-part-play[data-part="${id}"]`);
    await runEnded(h);
}

/** A Text brief wired, LABELLED, into an Instruction that answers on `mock-echo`. */
async function briefInto(/** @type {any} */ h, /** @type {string} */ instruction, label = 'brief', words = 'a slow spiral') {
    const note = await h.computer.place('note', 40, 60);
    await h.computer.set(note, { text: words });
    const ins = await h.computer.place('ask', 340, 40);
    await h.computer.set(ins, { instruction, model: 'mock-echo' });
    const w = await h.computer.wire(note, ins, 'in');
    h.eq(w.ok, true, 'the brief feeds the Instruction');
    h.eq(await h.computer.label(w.id, label), true, 'and the arrow is named');
    return { note, ins };
}

export default [
    {
        name: 'k8-gen-play-twice-gives-two-seeds',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const { ins } = await briefInto(h, 'Describe the {brief}.');
            const before = await seedView(h, ins);
            h.eq(before.input, '', 'the seed starts as "new each run"');
            h.eq(before.placeholder, await str(h, 'parts.genSeedNew'), 'and says so in the field');
            h.eq(before.dice && before.clear, true, 'the 🎲 and ✕ are on the box');
            // …and they FIT: the row sits inside the box, and the instruction keeps room to type.
            const fit = await h.eval((pid) => {
                const box = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"]');
                const r = (/** @type {string} */ s) => { const el = box && box.querySelector(s); return el ? el.getBoundingClientRect() : null; };
                const b = box.getBoundingClientRect();
                const row = r('.graph-ins-seed');
                const clear = r('.graph-ins-seed-clear');
                const area = r('.graph-ins-instruction');
                return { boxL: b.left, boxR: b.right, rowL: row && row.left, clearR: clear && clear.right, areaH: area && area.height };
            }, ins);
            h.assert(fit.rowL >= fit.boxL && fit.clearR <= fit.boxR + 0.5, `the seed row fits the box width: ${JSON.stringify(fit)}`);
            h.assert(fit.areaH >= 40, `the instruction field keeps room to type: ${JSON.stringify(fit)}`);
            h.note(`layout: ${JSON.stringify(fit)}`);

            await play(h, ins);
            const one = await posts(h);
            h.eq(one.length, 1, 'the first ▶ is one generation');
            h.eq(typeof one[0].seed, 'number', `the request carries a seed: ${JSON.stringify(one[0].body && Object.keys(one[0].body))}`);
            const after1 = await seedView(h, ins);
            h.eq(after1.used, await str(h, 'parts.genSeedUsed', { seed: one[0].seed }), 'the box says which seed its answer came from');

            await play(h, ins);
            const two = await posts(h);
            h.eq(two.length, 2, 'the second ▶ is a REAL second generation, not the cache replaying the first');
            h.assert(two[1].seed !== two[0].seed, `two different seeds: ${two[0].seed} then ${two[1].seed}`);
            const part = await partOf(h, ins);
            h.eq(part.stats.calls, 1, 'not cached');
            h.eq(part.stats.seed, two[1].seed);
            h.eq((await seedView(h, ins)).used, await str(h, 'parts.genSeedUsed', { seed: two[1].seed }));
            h.eq(two[1].maxTokens, 2048, 'and a prose answer asks for 2048 tokens, not a silent 512');
        },
    },
    {
        name: 'k8-gen-a-typed-seed-is-pinned-and-the-dice-and-cross-work',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const { ins } = await briefInto(h, 'Describe the {brief}.');
            // Type a seed the way a person does: click into the field, type, leave it.
            await h.input.click(inBox(ins, '.graph-ins-seed-input'));
            const focus = await h.eval(() => (document.activeElement ? String(document.activeElement.className) : ''));
            h.assert(/graph-ins-seed-input/.test(focus), `a real click focuses the seed field: ${focus}`);
            await h.input.type('42x42');
            await h.input.key('Tab');
            h.eq((await partOf(h, ins)).settings.seed, '4242', 'digits only, written to the box');

            await play(h, ins);
            await play(h, ins);
            const sent = await posts(h);
            h.eq(sent.length, 1, 'a pinned seed on the same inputs is the same answer: one request, then the cache');
            h.eq(sent[0].seed, 4242, 'with exactly the seed that was typed');
            h.eq((await seedView(h, ins)).used, await str(h, 'parts.genSeedUsedPinned', { seed: 4242 }));

            // ✕ goes back to new each run; 🎲 pins a random number.
            await h.input.click(inBox(ins, '.graph-ins-seed-clear'));
            h.eq((await partOf(h, ins)).settings.seed, '', '✕ = new each run');
            h.eq((await seedView(h, ins)).input, '');
            await h.input.click(inBox(ins, '.graph-ins-seed-dice'));
            const rolled = (await partOf(h, ins)).settings.seed;
            h.assert(/^\d+$/.test(rolled), `🎲 pinned a number: ${rolled}`);
            h.eq((await seedView(h, ins)).input, rolled, 'and the field shows it');
            await h.computer.undo();
            h.eq((await partOf(h, ins)).settings.seed, '', 'one undo takes the 🎲 back');
        },
    },
    {
        name: 'k8-gen-keep-pins-the-seed-an-answer-came-from',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const { ins } = await briefInto(h, 'Describe the {brief}.');
            await play(h, ins);
            const used = (await partOf(h, ins)).stats.seed;
            h.eq((await seedView(h, ins)).keep, true, 'Keep is offered next to the seed that was used');
            await h.input.click(inBox(ins, '.graph-ins-seed-keep'));
            h.eq((await partOf(h, ins)).settings.seed, String(used), 'Keep pins exactly that seed');
            const view = await seedView(h, ins);
            h.eq(view.input, String(used));
            h.eq(view.keep, false, 'nothing left to keep');
            await play(h, ins);
            h.eq((await posts(h)).length, 1, 'the kept seed asks for the answer already on screen: the cache, not the farm');
        },
    },
    {
        name: 'k8-gen-run-everything-again-when-nothing-is-stale',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const { ins } = await briefInto(h, 'Describe the {brief}.');
            const again = () => h.eval(() => {
                const b = /** @type {any} */ (document.querySelector('#lolcomputer .comp-run-again'));
                return { shown: !!b && !b.hidden && b.getClientRects().length > 0, text: b ? b.textContent : null, title: b ? b.title : null };
            });
            h.eq((await again()).shown, false, 'not offered before anything ran');
            await markRun(h);
            await h.input.click('#lolcomputer .comp-run-all');
            await runEnded(h);
            h.eq((await posts(h)).length, 1);
            h.eq((await again()).shown, false, 'a run that did something does not offer it');

            await markRun(h);
            await h.input.click('#lolcomputer .comp-run-all');
            await runEnded(h);
            await h.waitFor(() => ((document.querySelector('#lolcomputer .comp-run-status') || {}).textContent ? true : null));
            h.eq(await h.eval(() => document.querySelector('#lolcomputer .comp-run-status').textContent), await str(h, 'computer.runNothing'));
            const offered = await again();
            h.eq(offered.shown, true, 'nothing stale: "Run everything again" instead of a dead end');
            h.eq(offered.text, await str(h, 'computer.genRunAgain'));
            h.eq(offered.title, await str(h, 'computer.genRunAgainHint'));
            h.eq((await posts(h)).length, 1, 'the second Run all spent nothing');

            await markRun(h);
            await h.input.click('#lolcomputer .comp-run-again');
            await runEnded(h);
            await settled(h);
            const sent = await posts(h);
            h.eq(sent.length, 2, 'every box ran again — one new generation');
            h.assert(sent[1].seed !== sent[0].seed, `with a new seed: ${sent[0].seed} then ${sent[1].seed}`);
            h.eq((await partOf(h, ins)).state, 'done');
            h.eq((await again()).shown, false, 'a run that did something retires the offer');
        },
    },
    {
        name: 'k8-gen-fill-in-names-fills-only-the-braced-name',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const say = 'The topic of the essay is {topic}. Stay on topic.';
            const { ins } = await briefInto(h, say, 'topic', 'cats');
            const view = await seedView(h, ins);
            h.eq(view.inline, true, 'a bound {name} in braces: the row is offered');
            h.eq(view.inlineText, await str(h, 'parts.insInline'), 'named for what it does');
            h.eq(view.inlineText, 'Fill in {names} with their values');
            h.eq(view.inlineTitle, await str(h, 'parts.insInlineHint'), 'with its hint as the tooltip');
            h.eq(view.inlineHint, await str(h, 'parts.insInlineHint'), 'and as a line on the box');

            await h.input.click(inBox(ins, '.graph-ins-inline input'));
            h.eq((await partOf(h, ins)).settings.inlineVars, true, 'a real click ticks it');
            await play(h, ins);
            const [sent] = await posts(h);
            const user = (sent.body.messages || []).find((/** @type {any} */ m) => m.role === 'user');
            const text = typeof user.content === 'string' ? user.content : user.content.map((/** @type {any} */ c) => c.text || '').join('');
            h.eq(text, '# Instruction\nThe topic of the essay is cats. Stay on topic.',
                'the braced name is filled; the two bare words stay the reader’s sentence');

            // A bare mention only: nothing to fill, so nothing is offered.
            const other = await h.computer.place('ask', 340, 380);
            await h.computer.set(other, { instruction: 'Write about the topic.', model: 'mock-echo' });
            const note2 = await h.computer.place('note', 40, 400);
            await h.computer.set(note2, { text: 'dogs' });
            const w2 = await h.computer.wire(note2, other, 'in');
            await h.computer.label(w2.id, 'topic');
            await h.waitFor((pid) => {
                const el = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-ins-inline-wrap'));
                return el ? true : null;
            }, { args: [other] });
            h.eq((await seedView(h, other)).inline, false, 'a bare word is not a slot: the row is not shown');
        },
    },
];
