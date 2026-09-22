// @ts-check
// The Computer's library sidebar (COMPUTER_PLAN §3.4, §7.1, §7.6 — K1-U2).
//
// The library is the one part of K1 that stands between a person and their own work, so what these
// scenarios prove is deliberately boring and total: a document they make is there after a reload,
// the one they left open is the one that comes back, a file they export imports as the same graph,
// and a file from a future version is refused with a sentence rather than half-read.
//
// They drive `window.LolComputer.debug.library` — the SAME functions the buttons call, so a
// scenario and a click walk one path — and they never touch h.graph.*, which still drives the
// chat's panel until the K1 landing.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** One call on the library's debug door. @param {any} h @param {string} name @param {any[]} args */
const lib = (h, name, ...args) => h.eval((n, a) => {
    const d = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.library;
    if (!d) throw new Error('no window.LolComputer.debug.library: the library did not mount');
    if (typeof d[n] !== 'function') throw new Error('debug.library has no ' + n + '()');
    return d[n](...a);
}, name, args);

/** Open the Computer and wait until the library has finished its first paint. @param {any} h */
async function ready(h) {
    await h.view('computer');
    await h.waitFor(() => {
        const d = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.library;
        return d && typeof d.openId === 'function' && d.openId() ? d.openId() : null;
    }, { timeout: 20000 });
}

/** A three-part, two-wire graph file: two Notes into one Ask. */
const FILE = JSON.stringify({
    lolgraph: 1,
    title: 'Round trip',
    view: { x: 0, y: 0, zoom: 1 },
    settings: {},
    parts: [
        { id: 'a', type: 'note', x: 0, y: 0, w: 220, h: 140, settings: { text: 'one' } },
        { id: 'b', type: 'note', x: 0, y: 200, w: 220, h: 140, settings: { text: 'two' } },
        { id: 'c', type: 'ask', x: 320, y: 90, w: 300, h: 220, settings: { instruction: 'summarise', model: '', shape: 'text', schema: '' } },
    ],
    wires: [
        { from: 'a', to: 'c', port: 'context' },
        { from: 'b', to: 'c', port: 'context' },
    ],
}, null, 2);

export default [
    {
        // Create, rename, duplicate, delete, reload. The plan's acceptance, in order.
        name: 'k1-library-crud',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await ready(h);

            // A first launch with nothing in the database lands on a document rather than on an
            // empty canvas: there is always something to draw on.
            const first = await lib(h, 'list');
            h.eq(first.length, 1, 'a first launch opens one document');
            h.assert(await lib(h, 'openId'), 'and it is open');

            const alpha = await lib(h, 'create', 'Alpha');
            const beta = await lib(h, 'create', 'Beta');
            const gamma = await lib(h, 'create', 'Gamma');
            h.assert(alpha && beta && gamma, 'three documents were created');
            h.eq((await lib(h, 'list')).length, 4, 'four documents now');
            h.eq(await lib(h, 'openId'), gamma, 'creating a document opens it');

            // Rename — the same call the inline box commits.
            await lib(h, 'rename', alpha, 'Alpha renamed');
            const named = (await lib(h, 'list')).find((/** @type {any} */ r) => r.id === alpha);
            h.eq(named.title, 'Alpha renamed', 'the rename landed');

            // Duplicate — a NEW document, a new id, the copy's own title.
            const copy = await lib(h, 'duplicate', beta);
            h.assert(copy && copy !== beta, 'the duplicate is a different document');
            const copied = (await lib(h, 'list')).find((/** @type {any} */ r) => r.id === copy);
            h.eq(copied.title, 'Beta (copy)', 'the copy says so in its name');
            h.eq((await lib(h, 'list')).length, 5);

            // Delete — the debug door skips the confirm; the button always asks.
            await lib(h, 'remove', gamma);
            const afterDelete = await lib(h, 'list');
            h.eq(afterDelete.length, 4, 'the deleted document is gone');
            h.assert(!afterDelete.some((/** @type {any} */ r) => r.id === gamma), 'and it is really gone');
            h.assert(await lib(h, 'openId') !== gamma, 'deleting the open document opens another one');

            // The cards in the DOM say what the rows say.
            await lib(h, 'open', beta);
            const cards = await lib(h, 'cards');
            h.eq(cards.length, 4, 'one card per document');
            const betaCard = cards.find((/** @type {any} */ c) => c.id === beta);
            h.eq(betaCard.title, 'Beta');
            h.eq(betaCard.open, true, 'the open document is marked on its card');
            h.assert(/0 parts/.test(betaCard.meta) && /never run/.test(betaCard.meta),
                'a fresh document says it has no parts and has never run: ' + betaCard.meta);

            // …and all of it survives a reload, including WHICH document was open.
            await h.reload();
            await ready(h);
            const after = await lib(h, 'list');
            h.eq(after.length, 4, 'the library came back whole');
            h.eq(await lib(h, 'openId'), beta, 'the document you left open is the one that reopens');
            const titles = after.map((/** @type {any} */ r) => r.title).sort();
            h.eq(JSON.stringify(titles), JSON.stringify(['', 'Alpha renamed', 'Beta', 'Beta (copy)'].sort()),
                'the titles are right: ' + JSON.stringify(titles));
        },
    },

    {
        name: 'k1-library-search',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await ready(h);
            await lib(h, 'create', 'Rig notes');
            await lib(h, 'create', 'Weather report');
            await lib(h, 'create', 'Rig checklist');

            await lib(h, 'search', 'rig');
            const hits = await lib(h, 'cards');
            h.eq(hits.length, 2, 'search is case-insensitive and matches a substring');

            await lib(h, 'search', 'zzz');
            h.eq((await lib(h, 'cards')).length, 0, 'no cards for a query nothing matches');
            const empty = await lib(h, 'empty');
            h.assert(empty && empty.indexOf('zzz') >= 0, 'the no-match line quotes what was typed: ' + empty);

            await lib(h, 'search', '');
            h.eq((await lib(h, 'cards')).length, 4, 'clearing the box brings them all back');
        },
    },

    {
        // Export → import → the same parts and wires, new ids (§7.6).
        name: 'k1-library-roundtrip',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await ready(h);

            const imported = await lib(h, 'importText', FILE, {});
            h.assert(imported.ok, 'the file imported: ' + imported.message);
            h.eq(imported.parts, 3, 'three parts came in');
            h.eq(imported.wires, 2, 'two wires came in');
            h.eq(await lib(h, 'openId'), imported.id, 'an imported graph opens');

            const row = (await lib(h, 'list')).find((/** @type {any} */ r) => r.id === imported.id);
            h.eq(row.title, 'Round trip', 'the file carried its title');
            h.eq(row.parts, 3);

            // Export what came in, and compare it with the file it came from.
            const text = await lib(h, 'exportText', imported.id, {});
            const out = JSON.parse(text);
            const src = JSON.parse(FILE);
            h.eq(out.parts.length, 3, 'the export has the same parts');
            h.eq(out.wires.length, 2, 'and the same wires');
            h.eq(JSON.stringify(out.parts.map((/** @type {any} */ p) => p.type)),
                JSON.stringify(src.parts.map((/** @type {any} */ p) => p.type)), 'in the same order, the same types');
            const sameIds = out.parts.filter((/** @type {any} */ p) => src.parts.some((/** @type {any} */ q) => q.id === p.id));
            h.eq(sameIds.length, 0, 'every part id was re-minted on the way in');
            // …and the wires still point at the parts they pointed at.
            const byType = Object.fromEntries(out.parts.map((/** @type {any} */ p) => [p.id, p.type]));
            h.eq(out.wires.filter((/** @type {any} */ w) => byType[w.to] === 'ask').length, 2,
                'both wires still land on the Ask');

            // Importing the export makes a SECOND document, never an overwrite.
            const again = await lib(h, 'importText', text, {});
            h.assert(again.ok && again.id !== imported.id, 'a second import is a second document');
            h.eq((await lib(h, 'list')).length, 3, 'the first launch document plus the two imports');

            // "Include results" off strips every cached value (§7.6) — a Dialog answer is a
            // person's own words and must be able to stay home.
            const stripped = JSON.parse(await lib(h, 'exportText', imported.id, { values: false }));
            h.eq(stripped.parts.filter((/** @type {any} */ p) => p.value !== undefined).length, 0,
                'no value rode out with the checkbox unticked');
        },
    },

    {
        // A newer file is REFUSED, not imported with a warning (§7.6).
        name: 'k1-library-refuses-newer',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await ready(h);
            const before = (await lib(h, 'list')).length;

            const newer = JSON.stringify({ lolgraph: 99, title: 'From the future', parts: [], wires: [] });
            const refused = await lib(h, 'importText', newer, {});
            h.assert(!refused.ok, 'a newer file is not imported');
            h.assert(refused.message.indexOf('newer version') >= 0,
                'and it is refused in a sentence: ' + refused.message);
            h.eq((await lib(h, 'list')).length, before, 'nothing was written');

            const junk = await lib(h, 'importText', 'this is not json', {});
            h.assert(!junk.ok && junk.message.length > 0, 'so is a file that is not a graph at all');
            h.eq((await lib(h, 'list')).length, before);
        },
    },

    {
        // The sidebar's width is the reader's, and it is remembered (§3.4).
        name: 'k1-library-width',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await ready(h);

            h.eq(await lib(h, 'setWidth', 330), 330, 'the width is set');
            h.eq(await lib(h, 'setWidth', 20), 180, 'and it cannot be dragged out of existence');
            await lib(h, 'setWidth', 9999);
            h.eq(await lib(h, 'width'), 520, 'nor across the whole window');

            await lib(h, 'setWidth', 300);
            await h.reload();
            await ready(h);
            h.eq(await lib(h, 'width'), 300, 'the width came back');
            const px = await h.eval(() => getComputedStyle(document.getElementById('lolcomputer'))
                .getPropertyValue('--comp-side-w').trim());
            h.eq(px, '300px', 'and the sheet is reading it');
        },
    },

    {
        // A toast is the ONLY visible feedback this surface has — .comp-live is screen-reader-only
        // — and the stack is appended to the owning App's root, i.e. #lolcomputer. #lolcomputer is
        // a three-column grid, so an unpositioned stack auto-places into an implicit FOURTH area:
        // a new grid row that appears for the toast's lifetime and squeezes the canvas.
        name: 'k1-library-toast-is-at-home-on-the-computer',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await ready(h);

            const shown = await h.eval(() => {
                const surface = document.getElementById('lolcomputer');
                const rowsBefore = getComputedStyle(surface).gridTemplateRows;
                const canvasBefore = document.querySelector('#lolcomputer .comp-main').getBoundingClientRect().height;
                window.LolComputer.app.dialogs.toast('a toast from the Computer', { kind: 'error' });
                const stack = surface.querySelector('.chat-toasts');
                const el = stack ? stack.querySelector('.chat-toast') : null;
                const cs = stack ? getComputedStyle(stack) : null;
                const ecs = el ? getComputedStyle(el) : null;
                return {
                    inSurface: !!stack,
                    position: cs ? cs.position : null,
                    rowsBefore,
                    rowsAfter: getComputedStyle(surface).gridTemplateRows,
                    canvasBefore,
                    canvasAfter: document.querySelector('#lolcomputer .comp-main').getBoundingClientRect().height,
                    border: ecs ? ecs.borderTopWidth : null,
                    radius: ecs ? ecs.borderTopLeftRadius : null,
                    bg: ecs ? ecs.backgroundColor : null,
                    text: el ? el.textContent : null,
                };
            });

            h.eq(shown.inSurface, true, 'the stack really lands inside #lolcomputer');
            h.eq(shown.text, 'a toast from the Computer');
            h.assert(shown.position !== 'static',
                `the stack is out of flow, so it can never become a grid item (position: ${shown.position})`);
            h.eq(shown.rowsAfter, shown.rowsBefore, 'and the grid grew no implicit row');
            h.eq(shown.canvasAfter, shown.canvasBefore, 'so the canvas was not squeezed to make room');
            h.assert(shown.border !== '0px', `the toast is styled here, not bare text (border ${shown.border})`);
            h.assert(shown.radius !== '0px', `with the surface's radius (${shown.radius})`);
            h.assert(shown.bg !== 'rgba(0, 0, 0, 0)', `and a background (${shown.bg})`);

            // ...and it has to LOOK like the rest of the surface, in both themes.
            for (const theme of ['dark', 'light']) {
                await h.eval((t) => {
                    document.documentElement.className = t;
                    const old = document.querySelector('#lolcomputer .chat-toasts');
                    if (old) old.remove();
                    window.LolComputer.app.dialogs.toast('a toast from the Computer', { kind: 'error', ms: 60000 });
                    return true;
                }, theme);
                const shot = await h.screenshot(`k1-toast-${theme}`);
                h.assert(!!shot, `k1-toast-${theme}: no screenshot was produced`);
                h.note(`screenshot k1-toast-${theme}`);
            }
            await h.eval(() => { document.documentElement.className = 'dark'; return true; });
        },
    },
];
