// @ts-check
// K3-U3 in the real browser: per-box ▶, the run states and the run bar
// (COMPUTER_PLAN §8.2, §8.3, §8.4, §11 K3-U3).
//
// Everything here presses the SHIPPED control or reads the DOM a person looks at. The frozen
// probes (KC-4) are the contract between this file, the canvas and the sheet:
//
//   .graph-part[data-state="queued|running|waiting|stale|done|error|idle"]
//   .graph-part-play[data-part="<id>"]        the per-box ▶
//   .graph-wire[data-barred="true"]           a wire a barrier greyed
//   .graph-wire[data-back="true"]             a declared loop edge
//
// The acceptance list this unit owes, verbatim: ▶ in every part's title bar · the
// queued/running/waiting/stale/error looks are distinguishable by `data-state` · a barred wire is
// `data-barred` · the run bar shows the RANGE on a looping graph · the cap meter turns amber past
// 80 % · every §8.4 message appears with its action button.
//
// WHAT IS DELIBERATELY NOT HERE. §8.4's `no farm`, `no vision`, `invalid shape`, `empty`, `sandbox
// throw` and `newer file` rows are a PART's error strip or a phase that has not landed (K4's
// vision unit owns two of them) and none of their sentences exists in `strings/*` yet — a test
// that asserted them would be asserting a string it had just invented. The rows this unit owns
// are the run-level ones: capped, the four ceilings of §4.6, and loop-ungated.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when the surface this unit decorates was faked or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host', 'runbar'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`K3-U3 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
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

/** The shipped canvas the host built — never a second instance. Each caller below reaches for it
 *  inside its own `h.eval`, because the harness serialises the function, not a closure. */

/** What the §8.4 strip is showing, buttons and all. */
const strip = (/** @type {any} */ h) => h.eval(() => {
    const el = /** @type {any} */ (document.querySelector('#lolcomputer .graph-cap'));
    const btn = (/** @type {any} */ sel) => {
        const b = /** @type {any} */ (document.querySelector(`#lolcomputer ${sel}`));
        return b ? { label: (b.textContent || '').trim(), hidden: !!b.hidden, disabled: !!b.disabled, action: b.dataset.action || '' } : null;
    };
    return {
        hidden: el ? !!el.hidden : true,
        kind: el ? (el.getAttribute('data-notice') || '') : '',
        title: el ? ((el.querySelector('.graph-cap-title') || {}).textContent || '') : '',
        body: el ? ((el.querySelector('.graph-cap-body') || {}).textContent || '') : '',
        primary: btn('.graph-cap-raise'),
        secondary: btn('.graph-cap-more'),
    };
});

/** The run bar's chips, as the DOM has them. */
const bar = (/** @type {any} */ h) => h.eval(() => {
    const pick = (/** @type {any} */ sel) => document.querySelector(`#lolcomputer ${sel}`);
    const text = (/** @type {any} */ sel) => { const el = pick(sel); return el ? (el.textContent || '').trim() : null; };
    const cap = /** @type {any} */ (pick('.comp-run-cap'));
    return {
        present: !!pick('.comp-run'),
        parts: text('.comp-run-parts'),
        gens: text('.comp-run-gens'),
        cap: text('.comp-run-cap'),
        capAmber: cap ? cap.dataset.amber : null,
        waits: text('.comp-run-waits'),
    };
});

/** Write a whole document in one apply — the only way to put a BACK edge on the canvas before
 *  K3-U2's `wireRefusal` declares one, and the same door `perf-graph` builds its 500 parts with. */
const buildDoc = (/** @type {any} */ h, /** @type {any} */ plan) => h.eval((p) => {
    const dbg = window.LolComputer.debug.computer;
    const session = dbg.session();
    const app = session.app;
    const base = session.doc();
    const ids = {};
    const parts = p.parts.map((/** @type {any} */ row) => {
        const spec = session.specs.get(row.type);
        const size = (spec && spec.size) || { w: 220, h: 120 };
        const id = app.newId();
        ids[row.name] = id;
        return {
            id,
            type: row.type,
            x: row.x,
            y: row.y,
            w: size.w,
            h: size.h,
            settings: Object.assign(typeof spec.defaults === 'function' ? spec.defaults() : {}, row.settings || {}),
            value: null,
            state: row.state || 'idle',
            error: null,
            stats: null,
        };
    });
    const wires = p.wires.map((/** @type {any} */ w) => {
        const wire = { id: app.newId(), from: ids[w.from], to: ids[w.to], port: w.port };
        if (w.back) wire.back = true;
        if (w.label) wire.label = w.label;
        return wire;
    });
    session.apply({ ...base, parts, wires, rev: (base.rev || 1) + 1 }, { label: 'k3-canvas' });
    return ids;
}, plan);

/** One animation frame, twice — the canvas paints on its own rAF. */
const settle = (/** @type {any} */ h) => h.eval(() => new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
}));

export default [
    {
        // ▶ in EVERY part's title bar, and pressing it runs that box and no other.
        name: 'k3-canvas-play-on-every-box',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const a = await h.computer.place('note', 60, 60);
            await h.computer.set(a, { text: 'one' });
            const b = await h.computer.place('collect', 340, 60);
            await h.computer.wire(a, b, 'items');
            await settle(h);

            const seen = await h.computer.states();
            h.eq(seen.parts.length, 2, 'two boxes on the canvas');
            h.eq(seen.plays.length, 2, `a ▶ on every box, got ${seen.plays.length}`);
            h.eq(seen.plays.slice().sort().join(','), [a, b].sort().join(','),
                'and each ▶ names the box it belongs to (data-part)');
            for (const part of seen.parts) h.assert(part.state, `part ${part.id} has no data-state`);

            // Run everything once, so both boxes hold a value.
            await h.computer.run({});
            const warm = await h.computer.states();
            h.eq(warm.parts.every((/** @type {any} */ p) => p.state === 'done'), true,
                `every box finished: ${warm.parts.map((/** @type {any} */ p) => p.id + '=' + p.state).join(',')}`);

            // Now the gesture this unit exists for: ▶ on the SECOND box. Push runs it and what is
            // downstream of it — one box — and the run bar's count is what says so.
            await h.computer.play(b);
            await h.waitFor(() => (window.LolComputer.debug.computer.running() === false ? true : null), { timeout: 20000 });
            await settle(h);
            const after = await bar(h);
            h.eq(after.parts, await str(h, 'computer.runPartsOne'),
                `▶ on one box ran exactly that box, the bar says "${after.parts}"`);
            const still = await h.computer.states();
            h.eq(still.parts.every((/** @type {any} */ p) => p.state === 'done'), true,
                'and nothing upstream was knocked back to stale by it');
        },
    },

    {
        // §8.3: the five run looks. A reader has to be able to tell them apart, and the sheet
        // paints them off `data-state` — so the gate is that each state LOOKS different and each
        // still carries its written label, never colour alone (§9's honest constraint).
        name: 'k3-canvas-states-are-distinguishable',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const states = ['idle', 'stale', 'queued', 'running', 'waiting', 'done', 'error'];
            await buildDoc(h, {
                parts: states.map((state, i) => ({ name: state, type: 'note', x: 60 + i * 300, y: 60, state })),
                wires: [],
            });
            await settle(h);

            const looks = await h.eval((want) => {
                const out = [];
                for (const el of Array.from(document.querySelectorAll('#lolcomputer .graph-part'))) {
                    const node = /** @type {any} */ (el);
                    const cs = getComputedStyle(node);
                    const label = node.querySelector('.graph-state-label');
                    const head = node.querySelector('.graph-part-head');
                    const bar2 = head ? getComputedStyle(head, '::after') : null;
                    out.push({
                        state: node.getAttribute('data-state'),
                        label: ((label && label.textContent) || '').trim(),
                        look: [
                            cs.outlineStyle, cs.outlineColor, cs.borderTopColor, cs.boxShadow,
                            cs.backgroundImage, bar2 ? bar2.content : '',
                        ].join('|'),
                    });
                }
                return { rows: out, wanted: want };
            }, states);

            h.eq(looks.rows.length, states.length, 'one box per state');
            const bad = looks.rows.filter((/** @type {any} */ r) => !r.label);
            h.eq(bad.length, 0, `every box says its state in words too: ${JSON.stringify(bad)}`);

            // The five §8.3 looks the acceptance names, plus idle and done for company.
            const five = ['queued', 'running', 'waiting', 'stale', 'error'];
            const byState = new Map(looks.rows.map((/** @type {any} */ r) => [r.state, r.look]));
            for (const s of five) h.assert(byState.has(s), `no box rendered for state "${s}"`);
            const seenLooks = new Map();
            for (const s of five) {
                const look = byState.get(s);
                const clash = seenLooks.get(look);
                h.assert(!clash, `"${s}" and "${clash}" are drawn identically — a reader cannot tell them apart`);
                seenLooks.set(look, s);
            }
            h.note(`five distinguishable run looks: ${five.join(', ')}`);
        },
    },

    {
        // §8.2 / §6.6: a declared loop edge is dashed, and a branch a gate stopped goes grey while
        // its value still flows. "Most of the teaching" is in that second picture.
        name: 'k3-canvas-back-and-barred-wires',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const ids = await buildDoc(h, {
                parts: [
                    { name: 'seed', type: 'note', x: 60, y: 60, settings: { text: 'one' } },
                    { name: 'gate', type: 'collect', x: 360, y: 60 },
                    { name: 'tail', type: 'collect', x: 660, y: 60 },
                ],
                wires: [
                    { from: 'seed', to: 'gate', port: 'items', label: 'topic' },
                    { from: 'gate', to: 'tail', port: 'items' },
                    { from: 'tail', to: 'gate', port: 'items', back: true },
                ],
            });
            await settle(h);

            const drawn = await h.computer.states();
            h.eq(drawn.wires.length, 3, `three arrows drawn, got ${drawn.wires.length}`);
            h.eq(drawn.wires.filter((/** @type {any} */ w) => w.back).length, 1,
                'exactly the declared loop edge carries data-back');
            h.eq(drawn.wires.some((/** @type {any} */ w) => w.barred), false,
                'and nothing is barred before a run has said so');

            // The run bar hands the report's `barred` to the canvas; here the canvas is told
            // directly, because the report is K3-U1's and the PICTURE is this unit's.
            await h.eval((id) => window.LolComputer.app.host.canvas.setBarred([id]), ids.gate);
            await settle(h);
            const greyed = await h.computer.states();
            const barred = greyed.wires.filter((/** @type {any} */ w) => w.barred);
            // BOTH ENDS since the K3 landing: a barred id names a box the run DROPPED, so the
            // arrows into it are as dead as the arrows out of it. This fixture hands the canvas
            // the gate itself — which a real report never does, since the gate ran — so all three
            // of its arrows touch the named box and all three grey.
            h.eq(barred.length, 3, `every arrow touching the barred box greyed (got ${barred.length})`);

            const paint = await h.eval(() => {
                const el = document.querySelector('#lolcomputer .graph-wire[data-barred="true"]');
                const back = document.querySelector('#lolcomputer .graph-wire[data-back="true"]');
                return {
                    opacity: el ? getComputedStyle(el).opacity : null,
                    dash: back ? getComputedStyle(back).strokeDasharray : null,
                };
            });
            h.eq(Number(paint.opacity) < 0.5, true, `a barred wire is faded, not gone (opacity ${paint.opacity})`);
            h.assert(paint.dash && paint.dash !== 'none', `a back edge is dashed, got "${paint.dash}"`);

            // And it clears: a barrier is a fact about ONE run, never about the document.
            await h.eval(() => window.LolComputer.app.host.canvas.setBarred([]));
            await settle(h);
            const clear = await h.computer.states();
            h.eq(clear.wires.some((/** @type {any} */ w) => w.barred), false, 'the next run starts with no grey');
        },
    },

    {
        // §4.6: "the plan preview shows a range. A graph with a loop reads 6–48 generations. On a
        // shared farm that honesty is the point."
        name: 'k3-canvas-run-bar-shows-the-range',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            // A straight line first: two thinking boxes, no loop, so the bar quotes ONE number.
            await buildDoc(h, {
                parts: [
                    { name: 'one', type: 'ask', x: 60, y: 60, settings: { instruction: 'a', model: 'mock-echo' } },
                    { name: 'two', type: 'ask', x: 360, y: 60, settings: { instruction: 'b', model: 'mock-echo' } },
                ],
                wires: [{ from: 'one', to: 'two', port: 'in' }],
            });
            await settle(h);
            const straight = await bar(h);
            h.eq(straight.present, true, 'the run bar is on the surface');
            h.eq(straight.gens, await str(h, 'computer.runGenerations', { n: 2 }),
                `a graph with no loop quotes one number, got "${straight.gens}"`);

            // The same two boxes with a back edge between them: now it is a range.
            await buildDoc(h, {
                parts: [
                    { name: 'one', type: 'ask', x: 60, y: 60, settings: { instruction: 'a', model: 'mock-echo' } },
                    { name: 'two', type: 'ask', x: 360, y: 60, settings: { instruction: 'b', model: 'mock-echo' } },
                ],
                wires: [
                    { from: 'one', to: 'two', port: 'in' },
                    { from: 'two', to: 'one', port: 'in', back: true },
                ],
            });
            await settle(h);
            const looped = await bar(h);
            h.assert(/–/.test(String(looped.gens)),
                `a looping graph reads as a range, got "${looped.gens}"`);
            const parsed = String(looped.gens).match(/(\d+)–(\d+)/);
            h.assert(parsed, `and the range is two numbers, got "${looped.gens}"`);
            h.eq(Number(parsed[2]) > Number(parsed[1]), true,
                `the maximum is above the minimum (${looped.gens})`);
            h.note(`the loop's plan preview reads "${looped.gens}"`);
        },
    },

    {
        // §8.3: "the cap as a spent/limit meter, turning amber past 80 %". One generation against a
        // cap of one is 100 %, and the meter is the only thing on the bar that changes colour.
        name: 'k3-canvas-cap-meter-turns-amber',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            const ids = await buildDoc(h, {
                parts: [
                    { name: 'seed', type: 'note', x: 60, y: 60, settings: { text: 'one thing' } },
                    { name: 'think', type: 'ask', x: 360, y: 60, settings: { instruction: 'name one thing', model: 'mock-echo' } },
                ],
                wires: [{ from: 'seed', to: 'think', port: 'in' }],
            });
            h.assert(ids.think, 'the thinking box was placed');

            // The cap is a toolbar FIELD (BH-4) and the meter's denominator follows it. Type in it
            // the way a person does, so the meter is proved against the shipped control.
            await h.eval(() => {
                const input = /** @type {any} */ (document.querySelector('#lolcomputer .graph-cap-input'));
                if (!input) throw new Error('the canvas toolbar has no cap field');
                input.value = '1';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            });

            // The meter re-reads the stored cap on its next paint, and a paint is something a RUN
            // causes — so the run is the gesture that proves both halves at once: the denominator
            // followed the field, and one generation against a cap of one is 100 %.
            await h.computer.run({});
            const after = await h.waitFor(() => {
                const el = document.querySelector('#lolcomputer .comp-run-cap');
                const text = el ? (el.textContent || '').trim() : '';
                return text === '1 / 1' ? { text, amber: /** @type {any} */ (el).dataset.amber } : null;
            }, { timeout: 15000 });
            h.eq(after.text, '1 / 1', `one generation against a cap of one, got "${after.text}"`);
            h.eq(after.amber, 'true', 'and the meter is amber at 100 % of the cap');
        },
    },

    {
        // §8.4: "one sentence for what happened, one for what to do, never a code, never a stack"
        // — and never without the button that finishes it.
        name: 'k3-canvas-every-notice-has-its-button',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await h.computer.place('note', 60, 60);
            await settle(h);

            // 1. capped — C2's row, unchanged in its words, now with §8.4's SECOND button.
            await h.eval(() => window.LolComputer.app.host.canvas.setCapped({ cap: 50, spent: 50, stopped: 3, raiseTo: 100 }));
            const capped = await strip(h);
            h.eq(capped.hidden, false, 'the capped strip is up');
            h.eq(capped.kind, 'capped');
            h.eq(capped.title, await str(h, 'graph.capTitle', { cap: 50 }), 'with C2\'s own sentence');
            h.eq(capped.primary.label, await str(h, 'graph.capRaise'), 'and its raise button');
            h.eq(capped.primary.hidden, false);
            h.eq(capped.secondary.label, await str(h, 'computer.limitShowSpend'),
                '§8.4\'s second button: show me what spent it');
            h.eq(capped.secondary.hidden, false);

            // 2. the four ceilings of §4.6. Each is a STOP that names the ceiling and offers ONE
            //    raise — and the raise goes through `run({limits})`, the frozen door.
            const ceilings = [
                { ceiling: 'maxIterations', partId: null, limit: 8, reached: 8, raiseTo: 100 },
                { ceiling: 'maxGenerations', partId: null, limit: 50, reached: 50, raiseTo: 100 },
                { ceiling: 'maxWallMs', partId: null, limit: 600000, reached: 600000, raiseTo: 1200000 },
                { ceiling: 'maxActivations', partId: null, limit: 2000, reached: 2000, raiseTo: 4000 },
            ];
            for (const row of ceilings) {
                // eslint-disable-next-line no-await-in-loop
                const raised = await h.eval((limit) => {
                    const c = window.LolComputer.app.host.canvas;
                    /** @type {any} */ (window).__k3raise = null;
                    c.setLimited(limit, { onRaise: (l) => { /** @type {any} */ (window).__k3raise = l; } });
                    const btn = /** @type {any} */ (document.querySelector('#lolcomputer .graph-cap-raise'));
                    const shown = { label: (btn.textContent || '').trim(), disabled: !!btn.disabled };
                    btn.click();
                    return { shown, raisedWith: /** @type {any} */ (window).__k3raise };
                }, row);
                h.eq(raised.shown.disabled, false, `${row.ceiling}: the raise button is pressable`);
                // eslint-disable-next-line no-await-in-loop
                h.eq(raised.shown.label, await str(h, 'computer.limitRaise'), `${row.ceiling}: and says "raise it for this run"`);
                h.assert(raised.raisedWith && raised.raisedWith[row.ceiling] === row.raiseTo,
                    `${row.ceiling}: pressing it raises THAT ceiling for this run, got ${JSON.stringify(raised.raisedWith)}`);
            }

            // The wall-clock ceiling reads differently when a PARK is what ran out the clock —
            // "nobody answered the question in X" is a different fact from "the run was long".
            const ids = await h.computer.doc();
            const firstPart = ids.parts[0].id;
            await h.eval((id) => window.LolComputer.app.host.canvas.setLimited(
                { ceiling: 'maxWallMs', partId: id, limit: 600000, reached: 600000, raiseTo: 1200000 }), firstPart);
            const park = await strip(h);
            h.eq(park.title, await str(h, 'computer.limitWallPark', { part: 'Note', minutes: 10 }),
                `an unanswered question says so by name, got "${park.title}"`);

            // 3. loop-ungated — the strongest safety property in the build, and the one refusal
            //    that MUST carry the lesson that explains it.
            await h.eval(() => window.LolComputer.app.host.canvas.sayLoopUngated());
            const loop = await strip(h);
            h.eq(loop.kind, 'loop-ungated');
            h.eq(loop.title, await str(h, 'computer.loopUngated'), 'with §8.4\'s exact sentence');
            h.eq(loop.primary.label, await str(h, 'computer.loopLesson'), 'and the button that opens lesson 10');
            h.eq(loop.primary.hidden, false, 'the button is THERE');
            h.eq(loop.primary.disabled, true,
                'and honestly disabled until K5 ships the lesson behind it');

            // 4. and every one of them clears — a new run always starts with a clean strip.
            await h.eval(() => window.LolComputer.app.host.canvas.setNotice(null));
            const gone = await strip(h);
            h.eq(gone.hidden, true, 'the strip is gone when there is nothing to say');
            h.eq(gone.primary.hidden, true, 'and it leaves no orphan button behind');
        },
    },
];
