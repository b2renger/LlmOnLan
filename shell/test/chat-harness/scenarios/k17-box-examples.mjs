// @ts-check
// Owner, 2026-09-27: "one example per box — a small ? on the box opens a simple example".
//   1. Every box placed from the ＋ menu shows a ? in its title bar.
//   2. The ? on a Code box opens "Example — Code" as a library graph, which RUNS (no farm needed) and
//      ends in a Preview showing the Code box's answer.
//   3. The same ? again reopens that graph instead of making a second one.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}

const docId = (/** @type {any} */ h) => h.eval(() => window.LolComputer.debug.computer.docId());

export default [
    {
        name: 'k17-box-examples-every-box-has-a-question-mark-and-it-opens-a-working-example-once',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const ids = [];
            let x = 40;
            for (const type of ['note', 'ask', 'classify', 'code', 'send', 'toggle', 'sticky']) {
                ids.push(await h.computer.place(type, x, 60));
                x += 260;
            }
            const shown = await h.eval((list) => list.map((id) => {
                const b = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-part-help`);
                return !!b && !b.hidden;
            }), ids);
            h.eq(shown, ids.map(() => true), 'a ? on every box');

            const code = ids[3];
            const before = await docId(h);
            await h.click(`#lolcomputer .graph-part[data-id="${code}"] .graph-part-help`);
            const example = await h.waitFor((was) => {
                const dbg = window.LolComputer.debug.computer;
                const d = dbg.doc();
                return dbg.docId() && dbg.docId() !== was && d && /^Example — Code$/.test(d.title) ? dbg.docId() : null;
            }, { timeout: 15000, args: [before] });
            let doc = await h.computer.doc();
            const about = doc.parts.find((/** @type {any} */ p) => p.type === 'sticky');
            h.assert(about && /What it does/.test(about.settings.text) && /How to use it/.test(about.settings.text), 'the sticky explains the box');

            await h.click('#lolcomputer .comp-run-all');
            await h.waitFor(() => {
                const dbg = window.LolComputer.debug.computer;
                const d = dbg.doc();
                return !dbg.running() && d.parts.filter((p) => p.type === 'code' || p.type === 'preview').every((p) => p.state === 'done') ? true : null;
            }, { timeout: 30000 });
            doc = await h.computer.doc();
            const shot = await h.screenshot('k17-example-code');
            if (shot) h.note(`screenshot ${shot}`);
            const box = doc.parts.find((/** @type {any} */ p) => p.type === 'code');
            h.eq(box.value.data, { count: 4, longest: 'blackberry' }, 'the example runs: the Code box computed its answer');

            // The same ? again: the same graph, not a second copy.
            const codeHere = box.id;
            await h.click(`#lolcomputer .graph-part[data-id="${codeHere}"] .graph-part-help`);
            await new Promise((r) => setTimeout(r, 800));
            h.eq(await docId(h), example, 'the ? reopens the example it opened before');
            const titles = await h.eval(() => window.LolComputer.debug.library.list()
                .map((r) => r.title).filter((t) => /^Example — /.test(String(t))));
            h.eq(titles, ['Example — Code'], 'one example graph in the library');
        },
    },
];
