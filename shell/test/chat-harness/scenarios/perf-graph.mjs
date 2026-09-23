// @ts-check
// The C1 perf group (C1-U2): 500 parts on the canvas, built once and then panned for 60 frames
// (`perf: true`; run.js does the three runs and the median, plan §2.6 G).
//
// WHAT IT IS DEFENDING. The canvas is a DOM graph with ONE transformed layer: pan and zoom write
// `transform` on `.graph-layer` and on the wire layer's single <g>, and nothing else moves
// (§2.6 BG-8). Every cheap-looking alternative — a transform per part, a rAF per part, rebuilding
// the wire paths from scratch each frame — still LOOKS right at three parts and dies at five
// hundred. Only a timing gate catches that, so this group builds the graph nobody will ever draw
// by hand and measures what a pan costs.
//
// THE THREE GATES:
//   build ≤ 1500 ms          500 parts + 250 wires from one `apply()` to painted DOM;
//   p95 pan work ≤ 16 ms     the per-frame WORK of a pan (see below), inside one 60 Hz budget;
//   parts transformed = 0    no part may carry a transform — the structural half of the same claim.
//
// HOW "pan work" IS MEASURED, and why it is not the inter-frame delta. A rAF callback's `ts`
// argument is the FRAME START. Our probe schedules its own rAF right after driving the pan, so the
// canvas's callback (scheduled first) has already run when ours starts: `performance.now() - ts` is
// therefore the time the frame spent in script before us — the canvas's whole pan, including the
// wire layer. Adding a forced `getBoundingClientRect()` on the layer charges the style+layout the
// pan caused. The inter-frame delta is reported too (`frameMs`), but it cannot be the gate: a
// healthy 60 Hz page is vsync-bound at ~16.7 ms, which is already over the 16 ms budget by
// definition. Work is the number that distinguishes an O(1) pan from an O(500) one.

const PARTS = 500;                 // 250 Note → 250 Ask pairs
const WIRES = PARTS / 2;
const COLS = 25;
const STEP_X = 320;
const STEP_Y = 200;
const PAN_FRAMES = 60;
const RUN_PARTS = 1000;            // the run-path fixture: 1000 Notes, no farm traffic
const FAN_ITEMS = 10000;           // the fan fixture: one part run 10000 times, all of it free

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly if the Computer is faked — every number below would be a lie. */
const requireReal = async (/** @type {any} */ h) => {
    await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
    await h.waitFor(() => (window.LolComputer && window.LolComputer.ready ? true : null));
    await h.eval(() => {
        const failed = (window.LolComputer && window.LolComputer.failed) || {};
        if (failed.host) throw new Error(`perf-graph needs the REAL computer/host.mjs: ${failed.host.error}`);
        return true;
    });
};

/** Everything timed happens INSIDE the page: a CDP round trip is 1-3 ms, the same order as a frame. */
const measure = (/** @type {any} */ h) => h.eval(async (cfg) => {
    const dbg = window.LolComputer.debug.computer;
    const session = dbg.session();
    const app = session.app;
    const frame = () => new Promise((done) => requestAnimationFrame(done));

    // ---- build: ONE apply, then wait for the paint --------------------------------------------
    const base = session.doc();
    const parts = [];
    const wires = [];
    for (let i = 0; i < cfg.PARTS; i++) {
        const type = i % 2 === 0 ? 'note' : 'ask';
        const spec = session.specs.get(type);
        const size = (spec && spec.size) || { w: 220, h: 120 };
        parts.push({
            id: app.newId(),
            type,
            x: (i % cfg.COLS) * cfg.STEP_X,
            y: Math.floor(i / cfg.COLS) * cfg.STEP_Y,
            w: size.w,
            h: size.h,
            settings: typeof spec.defaults === 'function' ? spec.defaults() : {},
            value: null,
            state: 'idle',
            error: null,
            stats: null,
        });
    }
    for (let i = 0; i + 1 < parts.length; i += 2) {
        wires.push({ id: app.newId(), from: parts[i].id, to: parts[i + 1].id, port: 'in' });
    }

    const buildStart = performance.now();
    session.apply({ ...base, parts, wires, rev: (base.rev || 1) + 1 }, { label: 'perf' });
    let painted = 0;
    let paths = 0;
    for (let guard = 0; guard < 240; guard++) {
        // eslint-disable-next-line no-await-in-loop
        await frame();
        painted = document.querySelectorAll('#lolcomputer .graph-part').length;
        paths = document.querySelectorAll('#lolcomputer .graph-wires path').length;
        if (painted >= cfg.PARTS && paths >= cfg.WIRES) break;
    }
    const buildMs = performance.now() - buildStart;

    const layer = document.querySelector('#lolcomputer .graph-layer');
    const svgGroup = document.querySelector('#lolcomputer .graph-wires g');
    const firstPaths = Array.from(document.querySelectorAll('#lolcomputer .graph-wires path'));

    // ---- pan: 60 frames, one step each --------------------------------------------------------
    dbg.view({ x: 0, y: 0, zoom: 1 });
    await frame();
    const work = [];
    const deltas = [];
    let previous = performance.now();
    for (let i = 1; i <= cfg.PAN_FRAMES; i++) {
        dbg.view({ x: -i * 11, y: -i * 5, zoom: 1 });
        // eslint-disable-next-line no-await-in-loop
        const sample = await new Promise((done) => requestAnimationFrame((ts) => {
            const beforeUs = performance.now() - ts;      // the canvas's own rAF work, this frame
            const t0 = performance.now();
            layer.getBoundingClientRect();                 // force the style + layout the pan caused
            done(beforeUs + (performance.now() - t0));
        }));
        const now = performance.now();
        deltas.push(now - previous);
        previous = now;
        work.push(sample);
    }

    const pct = (xs, p) => {
        const sorted = xs.slice().sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    };
    const samePaths = Array.from(document.querySelectorAll('#lolcomputer .graph-wires path'));
    const transformed = Array.from(document.querySelectorAll('#lolcomputer .graph-part'))
        .filter((el) => getComputedStyle(el).transform !== 'none').length;

    return {
        parts: painted,
        wirePaths: paths,
        buildMs,
        workP50: pct(work, 0.5),
        workP95: pct(work, 0.95),
        workMax: Math.max(...work),
        frameMs: pct(deltas, 0.5),
        frameP95: pct(deltas, 0.95),
        transformedParts: transformed,
        layerTransformed: layer && getComputedStyle(layer).transform !== 'none' ? 1 : 0,
        groupTransformed: svgGroup && svgGroup.getAttribute('transform') ? 1 : 0,
        // A pan that REBUILT the wire layer would hand back different elements.
        pathsReused: firstPaths.length === samePaths.length
            && firstPaths.every((el, i) => el === samePaths[i]) ? 1 : 0,
    };
}, { PARTS, WIRES, COLS, STEP_X, STEP_Y, PAN_FRAMES });


/**
 * Press Run on a graph of NOTES (they compute locally, so this measures the CANVAS, not the farm)
 * and report what the main thread paid. The defect this defends against: `session.patchPart` names
 * the one part that changed, but the canvas discarded `ev.ids` and re-rendered EVERY box — and the
 * runner made ~3 patches per part. One Run over 500 parts was therefore ~1500 full renders of 500
 * boxes, all of it synchronous, BEFORE a single byte went to the farm. Build and pan are already
 * gated; the run path was not, and it is the same O(N²) shape.
 *
 * `blockMs` is the longest gap between two 10 ms timer ticks during the run — i.e. the longest
 * stretch in which the window could not have answered the reader at all.
 */
const measureRun = (/** @type {any} */ h) => h.eval(async (cfg) => {
    const dbg = window.LolComputer.debug.computer;
    const session = dbg.session();
    const app = session.app;
    const frame = () => new Promise((done) => requestAnimationFrame(done));

    const base = session.doc();
    const spec = session.specs.get('note');
    const size = (spec && spec.size) || { w: 220, h: 120 };
    const parts = [];
    for (let i = 0; i < cfg.RUN_PARTS; i++) {
        parts.push({
            id: app.newId(),
            type: 'note',
            x: (i % cfg.COLS) * cfg.STEP_X,
            y: Math.floor(i / cfg.COLS) * cfg.STEP_Y,
            w: size.w,
            h: size.h,
            settings: { text: `note ${i}` },
            value: null,
            state: 'idle',
            error: null,
            stats: null,
        });
    }
    session.apply({ ...base, parts, wires: [], rev: (base.rev || 1) + 1 }, { label: 'perf-run' });
    let painted = 0;
    for (let guard = 0; guard < 240; guard++) {
        // eslint-disable-next-line no-await-in-loop
        await frame();
        painted = document.querySelectorAll('#lolcomputer .graph-part').length;
        if (painted >= cfg.RUN_PARTS) break;
    }

    // The block sampler: a 10 ms timer whose lateness IS the main thread being held.
    let worst = 0;
    let previous = performance.now();
    const timer = setInterval(() => {
        const now = performance.now();
        worst = Math.max(worst, now - previous - 10);
        previous = now;
    }, 10);

    const t0 = performance.now();
    const report = await dbg.run({ maxItems: cfg.RUN_PARTS + 10 });
    const runMs = performance.now() - t0;
    clearInterval(timer);
    await frame();

    const done = Array.from(document.querySelectorAll('#lolcomputer .graph-part'))
        .filter((el) => el.dataset.state === 'done').length;
    return {
        parts: painted,
        ran: report ? report.ran : -1,
        errors: report && report.errors ? report.errors.length : -1,
        runMs,
        blockMs: worst,
        perPartMs: runMs / Math.max(1, painted),
        paintedDone: done,
    };
}, { RUN_PARTS, COLS, STEP_X, STEP_Y });

/**
 * A FANNED run: one Note of N lines, Split into N items, and a second Split that the runner fans
 * once per item. Every part here is FREE — no farm call anywhere — which is exactly the case the
 * 500-note fixture above cannot reach: `await spec.run(...)` on a free part resolves on the
 * microtask queue, so a fan used to run start to finish inside ONE macrotask, with a `patchPart`
 * (and a synchronous canvas sync) per item and no chance for the badge to paint or for Stop to be
 * clicked. `blockMs` — the longest gap between two 10 ms timer ticks — is the whole measurement.
 */
const measureFan = (/** @type {any} */ h) => h.eval(async (cfg) => {
    const dbg = window.LolComputer.debug.computer;
    const session = dbg.session();
    const app = session.app;
    const frame = () => new Promise((done) => requestAnimationFrame(done));

    const base = session.doc();
    const lines = [];
    for (let i = 0; i < cfg.FAN_ITEMS; i++) lines.push(`line ${i} of the pasted document`);
    const mk = (type, x, settings) => {
        const spec = session.specs.get(type);
        const size = (spec && spec.size) || { w: 220, h: 120 };
        return {
            id: app.newId(),
            type,
            x,
            y: 0,
            w: size.w,
            h: size.h,
            settings: { ...(typeof spec.defaults === 'function' ? spec.defaults() : {}), ...settings },
            value: null,
            state: 'idle',
            error: null,
            stats: null,
        };
    };
    const note = mk('note', 0, { text: lines.join('\n') });
    const one = mk('split', 320, { mode: 'lines' });
    const two = mk('split', 640, { mode: 'separator', separator: ' ' });
    session.apply({
        ...base,
        parts: [note, one, two],
        wires: [
            { id: app.newId(), from: note.id, to: one.id, port: 'text' },
            { id: app.newId(), from: one.id, to: two.id, port: 'text' },
        ],
        rev: (base.rev || 1) + 1,
    }, { label: 'perf-fan' });
    for (let guard = 0; guard < 120; guard++) {
        // eslint-disable-next-line no-await-in-loop
        await frame();
        if (document.querySelectorAll('#lolcomputer .graph-part').length >= 3) break;
    }

    let worst = 0;
    let ticks = 0;
    let previous = performance.now();
    const timer = setInterval(() => {
        const now = performance.now();
        worst = Math.max(worst, now - previous - 10);
        previous = now;
        ticks++;
    }, 10);

    const t0 = performance.now();
    const report = await dbg.run({ maxItems: cfg.FAN_ITEMS + 10 });
    const runMs = performance.now() - t0;
    clearInterval(timer);
    await frame();

    const fanned = session.doc().parts.find((p) => p.id === two.id);
    const badge = document.querySelector('#lolcomputer .graph-part[data-id="' + two.id + '"] .graph-part-fanout');
    return {
        items: fanned && fanned.fanout ? fanned.fanout.n : -1,
        ok: fanned && fanned.fanout ? fanned.fanout.ok : -1,
        state: fanned ? fanned.state : 'missing',
        ran: report ? report.ran : -1,
        capped: report && report.capped ? 1 : 0,
        errors: report && report.errors ? report.errors.length : -1,
        runMs,
        blockMs: worst,
        ticks,
        perItemMs: runMs / Math.max(1, cfg.FAN_ITEMS),
        badge: badge ? String(badge.textContent || '') : '',
    };
}, { FAN_ITEMS });

export default [
    {
        name: 'perf-graph-500',
        perf: true,
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await requireReal(h);
            await h.submit('a graph with five hundred parts');
            await h.waitReply();
            await h.view('computer');
            await h.waitFor(() => {
                const dbg = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.computer;
                return dbg && dbg.state().docId ? true : null;
            }, { timeout: 15000 });

            const m = await measure(h);
            h.eq(m.parts, PARTS, `all ${PARTS} parts must be painted — anything less is not the measurement`);
            h.eq(m.wirePaths, WIRES, `and all ${WIRES} wires`);
            h.note(`500 parts: build ${Math.round(m.buildMs)} ms · pan work p50 ${m.workP50.toFixed(2)} ms `
                + `p95 ${m.workP95.toFixed(2)} ms max ${m.workMax.toFixed(2)} ms · frame p50 ${m.frameMs.toFixed(1)} ms `
                + `p95 ${m.frameP95.toFixed(1)} ms · ${m.transformedParts} transformed parts`);
            return m;
        },
        /** @param {any} med @param {any} h */
        judge: (med, h) => {
            h.assert(med.buildMs <= 1500, `building ${PARTS} parts took ${Math.round(med.buildMs)} ms, the budget is 1500 ms`);
            h.assert(med.workP95 <= 16, `pan work p95 is ${med.workP95.toFixed(2)} ms, the 60 Hz budget is 16 ms`);
            h.eq(med.transformedParts, 0, 'no part may carry a transform: pan/zoom is the LAYER (BG-8)');
            h.eq(med.layerTransformed, 1, 'the layer is what moved');
            h.eq(med.groupTransformed, 1, 'and the wire group moved with it');
            h.eq(med.pathsReused, 1, 'a pan must not rebuild the wire paths — they are redrawn in one pass, not recreated');
            h.assert(med.frameP95 <= 34, `the page dropped frames while panning: p95 inter-frame ${med.frameP95.toFixed(1)} ms`);
            h.note(`perf-graph MEDIAN: build ${Math.round(med.buildMs)} ms · work p50 ${med.workP50.toFixed(2)} / `
                + `p95 ${med.workP95.toFixed(2)} ms · frame p50 ${med.frameMs.toFixed(1)} / p95 ${med.frameP95.toFixed(1)} ms`);
        },
    },
    {
        name: 'perf-graph-run',
        perf: true,
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await requireReal(h);
            await h.submit('a graph with five hundred parts to run');
            await h.waitReply();
            await h.view('computer');
            await h.waitFor(() => {
                const dbg = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.computer;
                return dbg && dbg.state().docId ? true : null;
            }, { timeout: 15000 });

            const m = await measureRun(h);
            h.eq(m.parts, RUN_PARTS, `all ${RUN_PARTS} parts must be painted — anything less is not the measurement`);
            h.eq(m.ran, RUN_PARTS, 'and every one of them ran');
            h.eq(m.errors, 0, 'a Note cannot fail: an error here means the fixture is wrong');
            h.note(`run of ${RUN_PARTS} notes: ${Math.round(m.runMs)} ms total · `
                + `${m.perPartMs.toFixed(2)} ms/part · longest main-thread block ${Math.round(m.blockMs)} ms`);
            return m;
        },
        /** @param {any} med @param {any} h */
        judge: (med, h) => {
            h.eq(med.paintedDone, RUN_PARTS, 'every box shows `done`: the narrow sync must still paint');
            h.assert(med.perPartMs <= 0.4, `a run costs ${med.perPartMs.toFixed(2)} ms per part; the budget is 0.4 ms `
                + '— a full canvas re-render per runtime patch is O(N) per part and blows this at a thousand');
            h.assert(med.blockMs <= 250, `the main thread was held for ${Math.round(med.blockMs)} ms in one stretch, `
                + 'the budget is 250 ms — the up-front `queued` marking must be ONE write, not N');
            h.note(`perf-graph-run MEDIAN: ${Math.round(med.runMs)} ms · ${med.perPartMs.toFixed(2)} ms/part · `
                + `block ${Math.round(med.blockMs)} ms`);
        },
    },
    {
        name: 'perf-graph-fan',
        perf: true,
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await requireReal(h);
            await h.submit('a graph that fans one part over three thousand items');
            await h.waitReply();
            await h.view('computer');
            await h.waitFor(() => {
                const dbg = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.computer;
                return dbg && dbg.state().docId ? true : null;
            }, { timeout: 15000 });

            const m = await measureFan(h);
            h.eq(m.items, FAN_ITEMS, `the part must really have fanned ${FAN_ITEMS} times`);
            h.eq(m.ok, FAN_ITEMS, 'and every item succeeded: a failure here means the fixture is wrong');
            h.eq(m.capped, 0, 'the cap was raised for this run, so nothing was refused');
            h.eq(m.errors, 0, 'no part errors');
            h.note(`fan of ${FAN_ITEMS} free items: ${Math.round(m.runMs)} ms total · `
                + `${m.perItemMs.toFixed(3)} ms/item · longest main-thread block ${Math.round(m.blockMs)} ms `
                + `· ${m.ticks} timer ticks got through · badge "${m.badge}"`);
            return m;
        },
        /** @param {any} med @param {any} h */
        judge: (med, h) => {
            h.assert(med.blockMs <= 100, `the main thread was held for ${Math.round(med.blockMs)} ms in one `
                + 'stretch; the budget is 100 ms, well inside the 250 ms the 1000-part run is judged on '
                + '— a fan must hand the thread back every slice, or the badge cannot paint and Stop '
                + 'cannot be clicked. Unfixed, ten thousand free items ran in ONE macrotask.');
            h.assert(med.ticks >= 1, `not one timer tick got through the whole run: the fan is holding `
                + 'the event loop end to end, which is exactly the defect — a timer scheduled BEFORE '
                + 'the run must fire DURING it');
            h.note(`perf-graph-fan MEDIAN: ${Math.round(med.runMs)} ms · block ${Math.round(med.blockMs)} ms `
                + `· ${med.ticks} ticks`);
        },
    },
];
