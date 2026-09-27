// @ts-check
// Owner, 2026-09-27: "shortcuts to switch between hand and edit" and "the zoom controls … there
// (there is already one, we should review it and move it)". The view controls now sit TOGETHER on
// the canvas toolbar — Select (V) · Hand (H) · − 100% + Fit — the run bar's duplicate zoom chip is
// gone, and V / H answer from anywhere on the Computer, never while typing. REAL input throughout.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

async function open(/** @type {any} */ h) {
    await h.fresh();
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.computer.place('note', 80, 80);
}

const toolNow = (/** @type {any} */ h) => h.eval(() => {
    const on = document.querySelector('#lolcomputer .graph-tool[aria-pressed="true"]');
    return on ? on.getAttribute('data-tool') : null;
});

export default [
    {
        name: 'k12-view-tools-sit-together-with-their-keys-and-one-zoom-control',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const seen = await h.eval(() => {
                const tools = document.querySelector('#lolcomputer .graph-toolbar .graph-tools');
                const zoom = document.querySelector('#lolcomputer .graph-toolbar .graph-zoom-wrap');
                return {
                    zoomRightAfterTools: !!tools && tools.nextElementSibling === zoom,
                    fitInZoom: !!(zoom && zoom.querySelector('.graph-fit')),
                    keys: Array.from(document.querySelectorAll('#lolcomputer .graph-tool')).map((b) => [b.getAttribute('data-tool'), (b.querySelector('.graph-tool-key') || {}).textContent, b.getAttribute('aria-keyshortcuts')]),
                    runBarChip: !!document.querySelector('#lolcomputer .comp-run-zoom'),
                    zoomControls: document.querySelectorAll('#lolcomputer .graph-zoom-wrap').length,
                };
            });
            h.eq(seen.zoomRightAfterTools, true, 'the zoom cluster sits right after the Select/Hand tools');
            h.eq(seen.fitInZoom, true, 'with Fit at its end');
            h.eq(seen.keys, [['select', 'V', 'V'], ['hand', 'H', 'H']], 'each tool shows its key');
            h.eq(seen.runBarChip, false, 'the run bar no longer carries a second zoom control');
            h.eq(seen.zoomControls, 1, 'one zoom control');

            // The + button zooms, the % opens the menu, and the readout follows.
            const before = await h.eval(() => window.LolComputer.debug.computer.view().zoom);
            await h.input.click('#lolcomputer .graph-zoom-wrap .graph-zoom-in');
            const after = await h.eval(() => window.LolComputer.debug.computer.view().zoom);
            h.assert(after > before, `+ zooms in: ${before} -> ${after}`);
            h.assert(/%$/.test(await h.eval(() => document.querySelector('#lolcomputer .graph-zoom-wrap .graph-zoom').textContent.trim())), 'the readout is a percentage');
        },
    },
    {
        name: 'k12-view-tools-v-and-h-answer-from-anywhere-on-the-computer-but-never-while-typing',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            h.eq(await toolNow(h), 'select', 'Select is the starting tool');

            // Focus OUTSIDE the canvas: a real click on the run bar's counts (not a button).
            await h.input.click('#lolcomputer .comp-run-counts');
            const inCanvas = await h.eval(() => !!document.activeElement && !!document.activeElement.closest('#lolcomputer .graph'));
            h.eq(inCanvas, false, 'the focus is outside the canvas');
            await h.input.key('h');
            h.eq(await toolNow(h), 'hand', 'H from the run bar switches to the Hand');
            await h.input.key('v');
            h.eq(await toolNow(h), 'select', 'V switches back to Select');

            // Inside the canvas they still work (the canvas's own handler).
            await h.input.click('#lolcomputer .graph-canvas', { at: { x: 20, y: 400 } });
            await h.input.key('h');
            h.eq(await toolNow(h), 'hand', 'H on the canvas');
            await h.input.key('v');

            // Typing never switches: an "h" typed into the library search stays text.
            await h.input.click('#lolcomputer .comp-side-head input');
            await h.input.key('h');
            h.eq(await toolNow(h), 'select', 'typing "h" into a field does not switch the tool');
            const typed = await h.eval(() => /** @type {any} */ (document.querySelector('#lolcomputer .comp-side-head input')).value);
            h.eq(typed, 'h', 'the letter went into the field');
            await h.eval(() => { const i = /** @type {any} */ (document.querySelector('#lolcomputer .comp-side-head input')); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); return true; });

            // A zoom key from outside the canvas too: zoom in, then Ctrl+0 back to 100 %.
            await h.input.click('#lolcomputer .comp-run-counts');
            await h.input.key('=', { ctrl: true });
            const zoomed = await h.eval(() => window.LolComputer.debug.computer.view().zoom);
            h.assert(zoomed > 1, `Ctrl+= from the run bar zooms in: ${zoomed}`);
            await h.input.key('0', { ctrl: true });
            h.eq(await h.eval(() => window.LolComputer.debug.computer.view().zoom), 1, 'Ctrl+0 from the run bar resets to 100 %');

            // Delete from outside the canvas never removes a box (only the view keys act there).
            await h.eval(() => window.LolComputer.debug.computer.select(window.LolComputer.debug.computer.doc().parts.map((p) => p.id)));
            await h.input.click('#lolcomputer .comp-run-counts');
            await h.input.key('Delete');
            h.eq(await h.eval(() => window.LolComputer.debug.computer.doc().parts.length), 1, 'Delete in the run bar deleted nothing');
        },
    },
];
