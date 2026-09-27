// @ts-check
// MOSTLY DELETED AT THE K1 LANDING (COMPUTER_PLAN §3.7, the one named exception to LOLCHAT_PLAN
// §2.6's "amended, never loosened").
//
// This file used to hold four scenarios proving the two bridges between the canvas and the
// conversation — `From thread` reading the open thread, `To thread` writing a `.chat-msg` row, the
// round trip costing exactly one generation, and the value inspector opening in the chat column.
// All four described a Computer that lived INSIDE a conversation as a workbench panel. It does
// not any more: it is the third top-level surface, a graph belongs to a library document, and
// there is no thread to read from or write to. Three frozen guarantees therefore LEAVE the suite
// by decision, named in the DEVLOG:
//
//   BH-1  `From thread` reads the conversation the reader is looking at.
//   BH-6  `To thread` lands in the transcript, safely rendered, and survives a reload.
//   BH-7  the chat-fence bridge ("Send to the Computer") places a Code part.
//
// BH-7's code is deleted outright (`installCodeBridge` and its two registry rows, K1 landing).
// BH-1 and BH-6's parts are DEMOTED, not deleted: a migrated graph must still open. What survives
// here is the half of that demotion no other scenario watches — the CATALOGUE. `k1-runbar-legacy`
// proves the badge and the one-sentence refusal on the canvas; this proves a reader can no longer
// reach for one in the first place, while the engine can still load one from a document.
//
// The inspector's own guarantees are not lost: they moved to `k1-runbar-drawer` with the drawer
// that now hosts them.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The palette as the READER sees it: the ＋ menu's own items, in its own order. */
const paletteTypes = (/** @type {any} */ h) => h.eval(async () => {
    const menu = document.querySelector('#lolcomputer .graph-add');
    if (!menu) throw new Error('the canvas has no Add button');
    /** @type {any} */ (menu).click();
    await new Promise((r) => setTimeout(r, 50));
    const items = Array.prototype.slice.call(document.querySelectorAll('#lolcomputer .graph-add-item'));
    const types = items.map((el) => el.getAttribute('data-type'));
    /** @type {any} */ (menu).click();
    return types;
});

export default [
    {
        name: 'c2-bridges-legacy-out-of-the-palette',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.waitFor(() => (window.LolComputer && window.LolComputer.ready ? true : null));
            await h.view('computer');
            await h.waitFor(() => ((window.LolComputer.debug.computer.doc() || {}).id ? true : null));

            // 1. A reader cannot place one. The ＋ menu is built from partSpecs(), and the two
            //    bridges are out of it — nothing offers a part that can only ever refuse.
            const types = await paletteTypes(h);
            h.assert(types.length > 0, 'the Add menu offered nothing at all');
            h.eq(types.indexOf('from-thread'), -1, `From thread is still in the palette: ${types.join(',')}`);
            h.eq(types.indexOf('to-thread'), -1, `To thread is still in the palette: ${types.join(',')}`);
            h.eq(types.indexOf('note') >= 0 && types.indexOf('ask') >= 0, true,
                `the palette lost real parts too: ${types.join(',')}`);

            // 2. The ENGINE can still load one, which is the whole reason they were demoted rather
            //    than deleted: a graph migrated out of an old chat contains them, and a document
            //    that will not open is worse than a part that says why it cannot run.
            const loaded = await h.eval(async () => {
                const dbg = window.LolComputer.debug.computer;
                const doc = dbg.doc();
                const text = JSON.stringify({
                    lolgraph: 1,
                    title: 'a graph migrated out of an old chat',
                    parts: [{ id: 'legacy-1', type: 'from-thread', x: 40, y: 40, w: 0, h: 0, settings: {} }],
                    wires: [],
                });
                const out = await dbg.importText(text, { confirm: false });
                if (!out.ok) throw new Error(`the import refused: ${JSON.stringify(out.errors)}`);
                return {
                    types: dbg.state().parts.map((/** @type {any} */ p) => p.type),
                    wasOpen: !!doc.id,
                };
            });
            h.eq(loaded.wasOpen, true, 'a document was open to import into');
            h.assert(loaded.types.indexOf('from-thread') >= 0,
                `a migrated graph failed to load its legacy part: ${JSON.stringify(loaded.types)}`);
            h.note(`palette: ${types.join(',')} · loaded: ${loaded.types.join(',')}`);
        },
    },
];
