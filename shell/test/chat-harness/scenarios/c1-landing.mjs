// @ts-check
// The C1 landing's own seams (integrator-owned): the two things that only broke once a REAL panel
// was registered into the workbench, and the two run outcomes that had no sentence.
//
// 1. THE BRAND-NEW-THREAD HANDOFF. §2.6 AP.1 starts a fresh thread with the workbench closed and
//    `thread = null`, and no second THREAD_SELECTED ever arrives for it — so "start a chat, then
//    open a panel", the most ordinary route there is, handed every panel `ctx.thread === null` for
//    the rest of its life. The workbench now resolves the row lazily and tells the live panel. The
//    fix also exposed a race in the Computer's own attach() (two attaches in flight cancelled each
//    other and left the panel with no document at all), so this scenario asserts BOTH: a probe
//    panel is told the real thread, and the Computer really lands on that thread's graph.
// 2. THE RUN SENTENCES. A yield and a generation cap are run outcomes of their own; both used to
//    announce as `graph.runNothing`. The strings exist and the panel branches on them.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** A panel that records the thread id it is handed, every time it is handed one. */
const installProbe = (/** @type {any} */ h) => h.eval(() => {
    const app = window.LolChat.app;
    /** @type {any} */ (window).__probe = { seen: [] };
    app.registry.add(app.SLOTS.WORKBENCH_PANELS, {
        id: 'probe',
        order: 900,
        label: 'Probe',
        defaultWidth: 'split',
        available: () => true,
        create(/** @type {any} */ host) {
            const p = document.createElement('p');
            p.textContent = 'probe';
            host.appendChild(p);
            const seen = (/** @type {any} */ ctx) => {
                /** @type {any} */ (window).__probe.seen.push(ctx && ctx.thread ? ctx.thread.id : null);
            };
            return {
                show(/** @type {any} */ ctx) { seen(ctx); },
                hide() { },
                destroy() { host.replaceChildren(); },
                onThread(/** @type {any} */ ctx) { seen(ctx); },
            };
        },
    });
    return true;
});

export default [
    {
        name: 'c1-landing-thread-handoff',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
            await installProbe(h);

            // A brand-new thread, created by the composer — NOT selected from the sidebar.
            await h.submit('a thread nobody has opened a panel on yet');
            await h.waitReply();
            const threadId = await h.eval(() => window.LolChat.app.state.threadId);
            h.assert(!!threadId, 'the composer did not put a thread id in app.state');

            // A panel opened now must be told about that thread, not about null.
            await h.work('probe');
            const seen = await h.waitFor((want) => {
                const p = /** @type {any} */ (window).__probe;
                return p && p.seen.indexOf(want) >= 0 ? p.seen.slice() : null;
            }, { args: [threadId], timeout: 15000 });
            h.assert(seen.indexOf(threadId) >= 0,
                'the workbench never handed the panel the live thread (' + JSON.stringify(seen) + ')');

            // And the real panel lands on that thread's graph, with no attach race losing the doc.
            await h.work('computer');
            const doc = await h.waitFor((want) => {
                const dbg = window.LolChat && window.LolChat.debug && window.LolChat.debug.computer;
                if (!dbg) return null;
                const d = dbg.doc();
                return d && d.threadId === want ? d : null;
            }, { args: [threadId], timeout: 15000 });
            h.eq(doc.threadId, threadId, 'the Computer attached to a different thread');
            h.eq(doc.parts.length, 0, 'a fresh thread should open an empty graph');

            // The graph is placeable straight away — the point of having a thread at all.
            const id = await h.graph.place('note', 40, 40);
            h.assert(!!id, 'a panel that knows its thread must be able to place a part');
            await h.graph.save();

            // ONE row per thread. Two attaches in flight used to each create and write their own
            // document for a thread that had none, and the next visit could load the empty one —
            // a graph that silently lost its parts. The handoff above is exactly what makes two
            // attaches ordinary, so the invariant is asserted right here.
            const rows = await h.eval((want) => window.LolChat.app.repo.listGraphs(want)
                .then((/** @type {any[]} */ r) => r.map((/** @type {any} */ g) => ({ id: g.id, parts: g.parts.length }))), threadId);
            h.eq(rows.length, 1, 'this thread has ' + rows.length + ' graph rows: ' + JSON.stringify(rows));
            h.eq(rows[0].parts, 1, 'the saved row lost the part that was placed');
            h.note('handoff: panel saw ' + JSON.stringify(seen) + ' · graph on ' + doc.threadId
                + ' · rows ' + JSON.stringify(rows));
        },
    },
    {
        name: 'c1-landing-run-sentences',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
            const lines = await h.eval(() => {
                const t = window.LolChat.app.t;
                return {
                    busy: t('graph.runBusy'),
                    capped: t('graph.runCapped', { cap: 50, n: 3 }),
                    nothing: t('graph.runNothing'),
                };
            });
            // A missing key resolves to the key itself (core/strings), which is the failure mode
            // this guards: the runner reports `yielded`/`capped`, so the panel must have a sentence.
            for (const [key, line] of Object.entries(lines)) {
                h.assert(!/^graph\./.test(String(line)), 'graph.run' + key + ' is not registered: "' + line + '"');
            }
            h.assert(lines.capped.indexOf('50') >= 0 && lines.capped.indexOf('3') >= 0,
                'runCapped does not interpolate the cap and the remainder: "' + lines.capped + '"');
            h.assert(lines.busy !== lines.nothing, 'a yield reads the same as "nothing to run"');
            h.note('run sentences: ' + JSON.stringify(lines));
        },
    },
    {
        // 3. THE MODEL PICKER GOING STALE. `modelOptions(app)` reads `app.farm.get().models` once,
        //    when the box is built — and the farm is discovered ASYNCHRONOUSLY after boot. "Cold
        //    launch → open the Computer on a saved graph → the farm arrives two seconds later"
        //    therefore left every Ask box offering nothing but Automatic for the life of the panel,
        //    recoverable only by tearing the panel down. The canvas now re-syncs its boxes when the
        //    farm's catalogue moves, and Ask rebuilds its options while keeping the selection.
        name: 'c1-landing-model-picker-refresh',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
            await h.submit('a graph whose farm shows up late');
            await h.waitReply();
            await h.eval(async () => {
                const app = window.LolChat.app;
                const rows = await app.repo.listThreads();
                return app.controller.selectThread(rows[0].id);
            });
            await h.graph.open();
            await h.waitFor(() => (window.LolChat.debug.computer.doc().threadId ? true : null));

            const ask = await h.graph.place('ask', 40, 40);
            h.assert(!!ask, 'an Ask part was placed');
            await h.graph.set(ask, { instruction: 'anything', model: 'mock-echo' });

            const before = await h.eval(() => {
                const sel = /** @type {any} */ (document.querySelector('#lolchat .graph-part[data-type="ask"] .graph-part-select'));
                if (!sel) throw new Error('the Ask box has no model picker');
                return { n: sel.options.length, value: sel.value };
            });
            h.eq(before.value, 'mock-echo', 'the picker shows the model the part will really ask');

            // The farm publishes two more models — the ordinary "it was discovered later" event,
            // driven through the REAL farm model so a real EV.FARM_CHANGE is emitted.
            await h.eval(() => {
                const bridge = /** @type {any} */ (window).__lolFarm || {};
                const models = (bridge.models || []).concat([{ id: 'late-arrival-a' }, { id: 'late-arrival-b' }]);
                window.LolChat.app.farm.update(Object.assign({}, bridge, { models }));
                return true;
            });

            const after = await h.waitFor(() => {
                const sel = /** @type {any} */ (document.querySelector('#lolchat .graph-part[data-type="ask"] .graph-part-select'));
                if (!sel) return null;
                const values = Array.prototype.map.call(sel.options, (/** @type {any} */ o) => o.value);
                return values.indexOf('late-arrival-a') >= 0
                    ? { n: sel.options.length, value: sel.value, values }
                    : null;
            }, { timeout: 10000 });

            h.eq(after.n, before.n + 2, 'both late models joined the list');
            h.assert(after.values.indexOf('late-arrival-b') >= 0, 'the second one too');
            h.eq(after.value, 'mock-echo', 'and the selection survived the rebuild');
            h.note('picker: ' + before.n + ' -> ' + after.n + ' options, still on ' + after.value);
        },
    },
];
