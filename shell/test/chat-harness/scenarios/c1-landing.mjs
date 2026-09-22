// @ts-check
// The C1 landing's own seams (integrator-owned), AMENDED AT THE K1 LANDING (COMPUTER_PLAN §3.7).
//
// 1. WHICH DOCUMENT THE SURFACE LANDS ON, AND HOW MANY IT MAKES. The C1 version of this scenario
//    was "the brand-new-thread handoff": §2.6 AP.1 started a fresh thread with the workbench
//    closed, and a panel opened afterwards was handed `ctx.thread === null` for the rest of its
//    life. There is no workbench and no per-thread graph any more, so that guarantee is retired
//    with the panel. What replaced it is the SAME CLASS OF BUG on the new surface, and it was
//    really measured during K1: the host opens a document at boot (last id -> newest row -> a new
//    one) and the library used to open one too, so a fresh client ended up with TWO untitled
//    documents. This scenario asserts the surface lands on exactly one document, that it is
//    placeable straight away, and that the library holds ONE row for it — not two.
// 2. THE RUN SENTENCES. A yield and a generation cap are run outcomes of their own; both used to
//    announce as `graph.runNothing`. The strings exist and the run branches on them.
// 3. THE MODEL PICKER GOING STALE (see the scenario's own note).

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

export default [
    {
        name: 'c1-landing-one-document',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));

            // A brand-new client: nothing in the library, no last-opened marker.
            await h.view('computer');
            const doc = await h.waitFor(() => {
                const dbg = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.computer;
                if (!dbg) return null;
                const d = dbg.doc();
                return d && d.id ? d : null;
            }, { timeout: 15000 });
            h.eq(doc.threadId, null, 'a library document belongs to no conversation');
            h.eq(doc.parts.length, 0, 'a fresh client opens an empty document');

            // It is placeable straight away — the point of landing on a document at all.
            const id = await h.graph.place('note', 40, 40);
            h.assert(!!id, 'the surface must be able to place a part the moment it is shown');
            await h.graph.save();

            // ONE row. The host and the library each used to create their own, and the next launch
            // could reopen the empty one — a graph that silently lost its parts.
            const rows = await h.eval(() => window.LolComputer.app.host.store.list()
                .then((/** @type {any[]} */ r) => r.map((/** @type {any} */ g) => ({ id: g.id, parts: g.parts.length }))));
            h.eq(rows.length, 1, 'the library has ' + rows.length + ' documents after one launch: ' + JSON.stringify(rows));
            h.eq(rows[0].id, doc.id, 'and it is the one that is open');
            h.eq(rows[0].parts, 1, 'the saved row lost the part that was placed');
            h.note('landing: opened ' + doc.id + ' · rows ' + JSON.stringify(rows));
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
            await h.waitFor(() => ((window.LolComputer.debug.computer.doc() || {}).id ? true : null));

            const ask = await h.graph.place('ask', 40, 40);
            h.assert(!!ask, 'an Ask part was placed');
            await h.graph.set(ask, { instruction: 'anything', model: 'mock-echo' });

            const before = await h.eval(() => {
                const sel = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-type="ask"] .graph-part-select'));
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
                const sel = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-type="ask"] .graph-part-select'));
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
