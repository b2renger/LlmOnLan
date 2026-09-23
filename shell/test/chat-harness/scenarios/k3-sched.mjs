// @ts-check
// K3-U1 in the real browser: ONE scheduler, push and pull (COMPUTER_PLAN §4, §7.5, §11 K3-U1).
//
// The unit test owns the interleavings; this owns the SHIPPED PATH — the canvas's ▶ (or, until
// K3-U3's button lands, the same door it calls) through `computer/host.mjs` into the runner, with a
// real document, a real store and a real reload. What it asserts, verbatim from §11 K3-U1:
//
//   ▶ on a mid-graph box runs it and everything downstream and NOTHING upstream · a second ▶
//   during a run merges · Stop returns everything to `stale` with values kept · reload mid-run →
//   the resume banner, and Resume costs only the unfinished part.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The Computer, shown, with a document open. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.eval(() => {
        const failed = (window.LolComputer && window.LolComputer.failed) || {};
        if (failed.host) throw new Error('K3 needs the REAL host');
        return true;
    });
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    return true;
}

/** Every part's stored state and value, off the document. */
const snap = (/** @type {any} */ h) => h.eval(() => {
    const doc = window.LolComputer.debug.computer.doc();
    /** @type {any} */ const out = {};
    for (const p of doc.parts) out[p.id] = { state: p.state, value: p.value ? p.value.data : null };
    return out;
});

/** A chain of four free parts: a → b → c → d. Free, so this scenario never spends a seat. */
async function chain(/** @type {any} */ h) {
    const a = await h.computer.place('note', 40, 40);
    await h.computer.set(a, { text: 'alpha' });
    const b = await h.computer.place('collect', 40, 200);
    const c = await h.computer.place('collect', 40, 360);
    const d = await h.computer.place('collect', 40, 520);
    await h.computer.wire(a, b, 'items');
    await h.computer.wire(b, c, 'items');
    await h.computer.wire(c, d, 'items');
    return { a, b, c, d };
}

export default [
    {
        name: 'k3-sched',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            // 1. The three doors §11 K3 names exist and ANSWER — a door that is only in the key
            //    list is a door a scenario cannot press.
            const keys = await h.eval(() => {
                const dbg = window.LolComputer.debug.computer;
                return ['runFrom', 'journal', 'waits'].filter((k) => typeof dbg[k] !== 'function');
            });
            h.eq(keys.length, 0, `the debug door is missing: ${keys.join(', ')}`);
            h.eq(Array.isArray(await h.computer.waits()), true, 'waits() answers a list');
            h.eq(Array.isArray(await h.computer.journal()), true, 'journal() answers a list');

            const ids = await chain(h);

            // 2. THE PROLOGUE (§4.2). Nothing has ever run, so a ▶ on the THIRD box pulls the two
            //    ancestors it needs rather than refusing with "Items: nothing arrived".
            await h.computer.runFrom(ids.c);
            let now = await snap(h);
            h.eq(now[ids.a].state, 'done', 'the prologue pulled the source the seed needed');
            h.eq(now[ids.b].state, 'done', 'and the one in between');
            h.eq(now[ids.c].state, 'done', 'the seed itself ran');
            h.eq(now[ids.d].state, 'done', 'and everything downstream of it');
            h.eq(String(now[ids.c].value).includes('alpha'), true, 'the value really flowed down the chain');

            // 3. ▶ RUNS NOTHING UPSTREAM. Edit the second box: it and its downstream go stale. A ▶
            //    on the THIRD box then runs the third and the fourth — and leaves the second stale,
            //    because it still HOLDS a value and the prologue only pulls what holds none.
            await h.computer.set(ids.b, { separator: ' | ' });
            now = await snap(h);
            h.eq(now[ids.b].state, 'stale', 'the edit staled the box it touched');
            await h.computer.runFrom(ids.c);
            now = await snap(h);
            h.eq(now[ids.b].state, 'stale', '▶ on a mid-graph box ran NOTHING upstream of it');
            h.eq(now[ids.a].state, 'done', 'and left the source alone');
            h.eq(now[ids.c].state, 'done', 'while the seed…');
            h.eq(now[ids.d].state, 'done', '…and everything downstream ran');

            // The DOM ▶ is K3-U3's; when it is there, the same gesture goes through the same door.
            const hasPlay = await h.eval((id) => !!document.querySelector(`#lolcomputer .graph-part-play[data-part="${id}"]`), ids.c);
            if (hasPlay) {
                await h.computer.play(ids.c);
                await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 20000 });
                h.note('the per-box ▶ is on the canvas and drives the same scheduler');
            } else {
                h.note('no .graph-part-play yet (K3-U3): the ▶ door was driven directly');
            }

            // 4. A SECOND ▶ DURING A RUN MERGES (§4.4) — it is never swallowed and never refused.
            //    `run()` and `runFrom()` are started in ONE page call so the second really lands
            //    while the first is live.
            await h.computer.run({});                       // everything done again
            await h.computer.set(ids.a, { text: 'beta' });   // the whole chain is stale
            const merge = await h.eval(async (p) => {
                const dbg = window.LolComputer.debug.computer;
                const running = dbg.run({});                 // deliberately NOT awaited
                const second = await dbg.runFrom(p.d);       // lands mid-run
                const report = await running;
                return { second, report };
            }, ids);
            h.eq(!!merge.second, true, 'the second ▶ answered');
            h.eq(merge.second.busy === true, false, 'and it was NOT refused as busy');
            h.eq(Number(merge.second.merged) > 0, true, 'it MERGED into the live run');
            h.eq(merge.report.cancelled, false, 'the first run finished on its own terms');
            now = await snap(h);
            h.eq(now[ids.d].state, 'done', 'and the merged seed ran');
            h.eq(String(now[ids.d].value).includes('beta'), true, 'with the new value all the way down');

            // 5. STOP returns everything to `stale` and KEEPS every finished value (§4.8).
            await h.computer.set(ids.a, { text: 'gamma' });
            const stopped = await h.eval(async () => {
                const dbg = window.LolComputer.debug.computer;
                const running = dbg.run({});
                dbg.stop();
                return running;
            });
            h.eq(stopped.cancelled, true, 'Stop reports a real cancel, never a fabricated one');
            now = await snap(h);
            const live = Object.keys(now).filter((id) => ['queued', 'running', 'waiting'].includes(now[id].state));
            h.eq(live.length, 0, `nothing was left mid-flight: ${live.join(', ')}`);
            h.eq(now[ids.d].value !== null, true, 'and every value already paid for is KEPT');

            // 6. THE JOURNAL (§7.3). Every one of those runs is on the record, newest last, with
            //    the mode it ran in — which is what "show me what just happened" reads.
            const rows = await h.computer.journal();
            h.eq(rows.length > 0, true, 'the runs were journalled');
            h.eq(rows.length <= 5, true, 'and never more than five are kept');
            const lastRow = rows[rows.length - 1];
            h.eq(lastRow.status, 'stopped', 'the last run says it was stopped');
            h.eq(lastRow.endedAt !== null, true, 'a finished run is not resumable');
            h.eq(rows.some((r) => r.mode === 'from'), true, 'and a ▶ is recorded as a push');

            // 7. A CRASH MID-RUN (§7.5). The row is written the moment a run opens, so a reload
            //    that never reaches the end comes back with a row that says a run was live — which
            //    is exactly what puts the resume banner up. Then Resume is `run({mode:'all'})`,
            //    and the dirty rule makes everything already finished free.
            await h.computer.set(ids.a, { text: 'delta' });
            // A Timer at the end of the chain parks the run on a clock, which is the only way a
            // scenario can hold a run open long enough to be interrupted the way a crash is.
            const timer = await h.computer.place('timer', 320, 520);
            await h.computer.set(timer, { seconds: 20, repeats: 1 });
            await h.computer.wire(ids.d, timer, 'in');
            await h.eval(() => { window.LolComputer.debug.computer.run({}); return true; });
            await h.waitFor((id) => {
                const doc = window.LolComputer.debug.computer.doc();
                const p = doc.parts.find((x) => x.id === id);
                return p && p.state === 'waiting' ? true : null;
            }, { timeout: 20000, args: [timer] });
            h.eq((await h.computer.waits()).length, 1, 'the run really parked on the clock');
            await h.reload();
            await open(h);
            const after = await h.computer.journal();
            const liveRow = after.filter((r) => r.endedAt === null);
            h.eq(liveRow.length >= 1, true, 'the reload came back with a row that says a run was live');
            h.eq(['running', 'waiting'].includes(liveRow[liveRow.length - 1].status), true,
                'and it says which kind of live it was');
            const beforeResume = await snap(h);
            const stale = Object.keys(beforeResume).filter((id) => beforeResume[id].state === 'stale');
            h.eq(Object.keys(beforeResume).every((id) => beforeResume[id].state !== 'running'), true,
                'nothing came back mid-flight after the reload (§7.5)');
            const resume = await h.computer.run({});
            h.eq(resume.ran <= stale.length, true,
                `Resume ran ${resume.ran} of the ${stale.length} boxes the crash left unfinished, and nothing else`);
            now = await snap(h);
            h.eq(Object.keys(now).every((id) => now[id].state === 'done'), true, 'and it finished the graph');
        },
    },
];
