// A graph someone hands you (owner 2026-11-06): before its first run, the real window asks, and lists what the file would
// reach. Cancel runs nothing and asks again; yes runs and is not asked twice; a template asks nothing.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const FILE = JSON.stringify({
    lolgraph: 1,
    title: 'A gift',
    settings: { handed: false },
    parts: [{ id: 'a', type: 'fetch', x: 0, y: 0, w: 300, h: 200, settings: { url: 'http://handed.invalid/secret' } }],
    wires: [],
});
const RUN = '#lolcomputer .comp-run-all';
const OPEN = 'dialog.chat-dialog[open]';

const lib = (h, name, ...args) => h.eval((n, a) => window.LolComputer.debug.library[n](...a), name, args);
const fetchState = (h) => h.eval(() => window.LolComputer.debug.computer.doc().parts[0].state || '');
const asked = (h) => h.waitFor((sel) => {
    const d = document.querySelector(sel);
    return d ? d.textContent : null;
}, { timeout: 5000, args: [OPEN] });

export default [
    {
        name: 'k28-handed-a-file-lists-what-it-reaches-before-its-first-run',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.view('computer');
            await h.waitFor(() => {
                const d = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.library;
                return d && typeof d.openId === 'function' && d.openId() ? d.openId() : null;
            }, { timeout: 20000 });

            const out = await lib(h, 'importText', FILE, {});
            h.assert(out.ok, 'the file imported: ' + out.message);

            // Run all asks, with the address the file carries, and Cancel has the focus.
            await h.input.click(RUN);
            const first = await asked(h);
            h.assert(first.includes('came from a file') && first.includes('http://handed.invalid/secret'), `the question lists the address: ${first}`);
            h.eq(await h.eval(() => document.activeElement && document.activeElement.className.includes('chat-dialog-cancel')), true, 'Cancel has the focus');

            // Cancel: nothing ran, and the next Run all asks again.
            await h.input.click(`${OPEN} .chat-dialog-cancel`);
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog') ? null : true), { timeout: 5000 });
            h.eq(await fetchState(h), 'idle', 'Cancel: the box did not run');

            // The box's own ▶ goes through the same door. Answer yes this time.
            await h.eval(() => { void window.LolComputer.debug.computer.runFrom(window.LolComputer.debug.computer.doc().parts[0].id); return true; });
            await asked(h);
            await h.input.click(`${OPEN} .chat-dialog-ok`);
            await h.waitFor(() => {
                const s = window.LolComputer.debug.computer.doc().parts[0].state;
                return s && !['idle', 'queued', 'running'].includes(s) ? s : null;
            }, { timeout: 20000 });

            // Asked once: the third run goes straight through, and the mark survives neither in the doc nor in a save.
            await h.eval(() => window.LolComputer.debug.computer.run({ force: true }));
            h.eq(await h.eval((sel) => !!document.querySelector(sel), OPEN), false, 'no second question');
            h.eq(await h.eval(() => !!window.LolComputer.debug.computer.doc().settings.handed), false);

            // What we ship asks nothing.
            const shipped = await lib(h, 'importText', FILE, { shipped: true });
            h.assert(shipped.ok);
            await h.input.click(RUN);
            await h.waitFor(() => {
                const s = window.LolComputer.debug.computer.doc().parts[0].state;
                return s && !['idle', 'queued', 'running'].includes(s) ? s : null;
            }, { timeout: 20000 });
            h.eq(await h.eval((sel) => !!document.querySelector(sel), OPEN), false, 'a template runs with no question');
        },
    },
];
