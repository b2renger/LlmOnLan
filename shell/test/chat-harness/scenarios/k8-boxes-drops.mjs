// @ts-check
// Critic R1 B17 (Package C): a slow drop lands in whichever graph is open when it FINISHES. A
// picture dropped on graph A, then a click on "New" while it is still being read, used to place
// its Image box in the new graph. The router now asks again which graph is open before it places
// anything; a switch means nothing is placed, the person is told, and the kept bytes are let go.
//
// The read is held open with a gate on the page's own intake (setup, not under test), so the
// switch happens mid-read every time; the drop and the "New" click are real.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** A valid 1x1 PNG. */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export default [
    {
        name: 'k8-boxes-drops-a-drop-then-a-graph-switch-mid-read-places-nothing-in-the-new-graph',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.view('computer');
            await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
            const first = await h.eval(() => window.LolComputer.debug.computer.docId());
            const d = await h.computer.doc();
            if (d.parts.length) await h.computer.remove(d.parts.map((/** @type {any} */ p) => p.id));

            // Hold the picture's read open until the test says so.
            await h.eval(() => {
                const w = /** @type {any} */ (window);
                const intake = w.LolComputer.app.intake;
                w.__k8gate = null;
                w.__k8release = null;
                w.__k8gate = new Promise((r) => { w.__k8release = r; });
                w.__k8orig = intake.fromFile;
                intake.fromFile = async (/** @type {any} */ file) => { await w.__k8gate; return w.__k8orig(file); };
                return true;
            });
            try {
                const before = await h.eval(() => window.LolComputer.app.drops.debug().routed);
                await h.computer.dropFiles([{ name: 'late.png', mime: 'image/png', base64: PNG_1PX }]);

                // The person opens a NEW graph while the picture is still being read.
                await h.input.click('#lolcomputer .comp-side-head .comp-btn-accent');
                await h.waitFor((a) => {
                    const id = window.LolComputer.debug.computer.docId();
                    return id && id !== a ? id : null;
                }, { args: [first], timeout: 10000 });
                const second = await h.eval(() => window.LolComputer.debug.computer.docId());
                h.assert(second !== first, 'a new graph is open');

                await h.eval(() => { /** @type {any} */ (window).__k8release(); return true; });
                const last = await h.waitFor((n) => {
                    const dbg = window.LolComputer.app.drops.debug();
                    return dbg.routed > n && dbg.last && dbg.last.files.includes('late.png') && (dbg.last.placed.length || dbg.last.refused.length) ? dbg.last : null;
                }, { args: [before], timeout: 15000 });

                h.eq(last.placed, [], 'nothing was placed');
                h.eq((await h.computer.doc()).parts.length, 0, 'the graph that is open now got no box it never asked for');
                const said = await h.eval((n) => window.LolComputer.app.t('computer.dropSwitched', { name: n }), 'late.png');
                h.eq(last.refused.map((/** @type {any} */ r) => r.reason), [said], 'and the refusal is a sentence');
                await h.waitFor((w) => (Array.from(document.querySelectorAll('.chat-toast')).some((el) => el.textContent === w) ? true : null), { args: [said], timeout: 8000 });
            } finally {
                await h.eval(() => {
                    const w = /** @type {any} */ (window);
                    if (w.__k8release) w.__k8release();
                    if (w.__k8orig) w.LolComputer.app.intake.fromFile = w.__k8orig;
                    return true;
                });
            }
        },
    },
];
