// The usage report (INSIGHTS_PLAN §6.5, 2026-11-12), in the real window: a LOL Vibe reply's end and a Computer run are
// counted through their hooks, a graph's own words never reach the report. Saving it opens the system's save dialog,
// which a harness cannot click: HUMAN_TESTS A24 covers it.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const SECRET = 'Private words from a student';
const FILE = JSON.stringify({
    lolgraph: 1,
    title: SECRET,
    parts: [{ id: 'a', type: 'note', x: 0, y: 0, w: 300, h: 200, settings: { text: SECRET } }],
    wires: [],
});
const RUN = '#lolcomputer .comp-run-all';
const report = (h) => h.eval(() => window.lolUsage.report({ appVersion: '0.2.17' }));
const today = (rep) => rep.days[rep.days.length - 1] || { counts: {}, timings: {}, boxesRun: {} };

export default [
    {
        name: 'k29-usage-a-reply-and-a-run-are-counted-and-no-words-reach-the-report',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.waitFor(() => (window.lolUsage && window.LolChat && window.LolChat.app ? true : null), { timeout: 20000 });

            // A reply's end, as the controller emits it (STREAM_END): counted once, with its timings.
            const before = today(await report(h)).counts['vibe.reply'] || 0;
            await h.eval(() => window.LolChat.app.bus.emit('stream:end', { message: {}, result: { status: 'done', ttftMs: 321, durationMs: 2000, tokPerSec: 40 } }));
            await h.eval(() => window.LolChat.app.bus.emit('stream:end', { message: {}, result: { status: 'error', local: true, error: { kind: 'local' } } }));
            const r1 = today(await report(h));
            h.assert((r1.counts['vibe.reply'] || 0) === before + 1, `one reply counted: ${JSON.stringify(r1.counts)}`);
            h.assert(r1.timings['vibe.first_word_ms'] && r1.timings['vibe.first_word_ms'].n >= 1, 'its first-word time kept');

            // A Computer run of a graph a file brought: counted with its box type; the graph's words nowhere.
            await h.view('computer');
            await h.waitFor(() => {
                const d = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.library;
                return d && typeof d.openId === 'function' && d.openId() ? d.openId() : null;
            }, { timeout: 20000 });
            const out = await h.eval((f) => window.LolComputer.debug.library.importText(f, {}), FILE);
            h.assert(out.ok && out.parts === 1, 'the graph imported with its box: ' + JSON.stringify(out));
            const runsBefore = today(await report(h)).counts['run.done'] || 0;
            await h.input.click(RUN);
            await h.waitFor((n) => {
                const c = window.lolUsage.report({}).days.slice(-1)[0];
                return c && (c.counts['run.done'] || 0) > n ? true : null;
            }, { timeout: 20000, args: [runsBefore] });
            const rep = await report(h);
            const d = today(rep);
            h.assert((d.boxesRun.note || 0) >= 1, `the Text box (type note) counted: ${JSON.stringify(d.boxesRun)}`);
            h.assert(!JSON.stringify(rep).includes('Private words'), 'no word of the graph in the report');
            h.assert(rep.app === '0.2.17' && rep.kind === 'lol-usage-report', 'the header');
            // The surface switch counts when app.js runs in this window (the full app); say what this one did.
            console.log(`surface counts: ${JSON.stringify({ owui: d.counts['open.owui'] || 0, vibe: d.counts['open.vibe'] || 0, computer: d.counts['open.computer'] || 0 })}`);
        },
    },
];
