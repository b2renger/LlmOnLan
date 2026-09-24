// @ts-check
// K7 (COMPUTER_PLAN addendum KG, owner request 2026-09-24): the Computer's debug log, end to end,
// reached the way a person reaches it (build rule 6) — the Record switch, Mark bug and the folder
// button are CLICKED, the note is TYPED into the real dialog, and the file is read back from the
// disk the REAL main-side writer (build/main/debugLog.js) put it on.
//
// What a bug report needs, asserted line by line: the header with its key; the minutes BEFORE the
// switch (flagged pre); the graph edits; the run, part by part; the farm request without its key;
// an uncaught error, a rejection and a console.error with their words; a marker with the note, the
// state and the graph; the main process's own last line. And the switch survives a reload.
import fs from 'node:fs';
import path from 'node:path';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const PLANTED = [/k7 planted/];
const MOCK_KEY = 'harness-pw';

/** The Computer, shown, with a document open. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    return true;
}

/** The switch as drawn. */
const drawn = (/** @type {any} */ h) => h.eval(() => {
    const g = document.querySelector('#lolcomputer .comp-runbar .comp-rec');
    const toggle = g && g.querySelector('.comp-rec-toggle');
    const mark = g && g.querySelector('.comp-rec-mark');
    const folder = g && g.querySelector('.comp-rec-folder');
    const vis = (/** @type {any} */ el) => !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
    return {
        present: !!g, shown: vis(g),
        label: toggle ? toggle.textContent.trim() : null,
        pressed: toggle ? toggle.getAttribute('aria-pressed') : null,
        markShown: vis(mark), folderShown: vis(folder),
    };
});

const status = (/** @type {any} */ h) => h.eval(() => window.LolComputer.debug.devlog.status());

/** Every recording on disk, oldest first. The harness shares one userData across scenarios, so
 *  pass `since` (an earlier call's result) to get only the recordings made after it. */
function files(/** @type {any} */ h, /** @type {string[]} */ since = []) {
    const dir = path.join(h.tmpDir, 'logs', 'computer');
    try { return fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().map((n) => path.join(dir, n)).filter((f) => !since.includes(f)); } catch { return []; }
}

/** @param {string} file */
const linesOf = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

export default [
    {
        name: 'k7-recorder-a-bug-report-from-the-switch-to-the-file',
        needsMock: true,
        needsDebugLog: 'real',
        timeoutMs: 90000,
        allowConsoleErrors: [...FARM_ERRORS, ...PLANTED],
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const before = files(h);

            // Off: a quiet button in the run bar, no Mark, and nothing on disk.
            let d = await drawn(h);
            h.assert(d.present && d.shown, 'the Record switch is in the run bar and visible');
            h.eq(d.pressed, 'false');
            h.eq(d.label, await h.eval(() => window.LolComputer.app.t('computer.recOff')));
            h.eq(d.markShown, false, 'no Mark bug while not recording');
            h.eq(files(h, before).length, 0, 'nothing written before the switch');

            // Something happens BEFORE the switch: a Note, placed from the ＋ menu by clicks.
            const note = await h.computer.add('note');
            h.assert(!!note, 'a Note was placed from the ＋ menu');

            // ON — by clicking.
            await h.click('#lolcomputer .comp-rec-toggle');
            await h.waitFor(() => (window.LolComputer.debug.devlog.status().recording ? true : null), { timeout: 10000 });
            d = await drawn(h);
            h.eq(d.pressed, 'true', 'the switch says it is on');
            h.assert(/Recording/.test(String(d.label)), `the switch counts: ${d.label}`);
            h.eq(d.markShown, true, 'Mark bug appears while recording');
            const st = await status(h);
            h.assert(/^computer-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jsonl$/.test(st.name), `a timestamped file: ${st.name}`);

            // A small graph, run from the bar: Note -> Ask, one generation on the mock farm.
            const ask = await h.computer.place('ask', 360, 60);
            await h.computer.set(note, { text: 'Paris' });
            await h.computer.set(ask, { instruction: 'name three things', model: 'mock-echo' });
            h.eq((await h.computer.wire(note, ask, 'in')).ok, true, 'Note feeds Ask');
            await h.computer.label((await h.computer.state()).wires[0].id, 'city');
            await h.click('#lolcomputer .comp-run-all');
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 30000 });

            // Errors, the three ways they happen.
            await h.eval(() => {
                setTimeout(() => { throw new Error('k7 planted uncaught'); }, 0);
                void Promise.reject(new Error('k7 planted rejection'));
                console.error('[k7] k7 planted console error');
                return true;
            });
            await h.sleep(300);

            // MARK — by clicking, and the note TYPED into the real dialog.
            await h.click('#lolcomputer .comp-rec-mark');
            await h.waitFor(() => (document.querySelector('.chat-dialog-input') ? true : null), { timeout: 10000 });
            await h.type('.chat-dialog-input', 'the answer box stayed grey after the run');
            await h.click('.chat-dialog-ok');
            await h.waitFor(() => (window.LolComputer.debug.devlog.status().marks === 1 ? true : null), { timeout: 10000 });

            // OFF — by clicking. The folder button then shows the file.
            await h.click('#lolcomputer .comp-rec-toggle');
            await h.waitFor(() => (window.LolComputer.debug.devlog.status().recording ? null : true), { timeout: 10000 });
            d = await drawn(h);
            h.eq(d.pressed, 'false');
            h.eq(d.folderShown, true, 'the folder button stays after a recording');
            await h.click('#lolcomputer .comp-rec-folder');
            await h.sleep(200);
            const shown = h.shellCalls().filter((/** @type {any} */ c) => c.call === 'showItemInFolder');
            h.assert(shown.length >= 1 && /computer-.*\.jsonl$/.test(shown[shown.length - 1].path), `the folder button selects the file: ${JSON.stringify(shown)}`);

            // ---- the file ------------------------------------------------------------------------
            const all = files(h, before);
            h.eq(all.length, 1, 'one recording');
            // K7_KEEP=<path> keeps a copy of the recording, to READ what a bug report looks like.
            if (process.env.K7_KEEP) fs.copyFileSync(all[0], process.env.K7_KEEP);
            const text = fs.readFileSync(all[0], 'utf8');
            const lines = linesOf(all[0]);
            const kinds = lines.map((l) => l.k);
            h.eq(kinds[0], 'log.start', 'the header first');
            h.assert(/One JSON object per line/.test(lines[0].readme), 'the header carries the key to the file');
            h.eq(kinds[1], 'log.main', 'then the facts only main knows');
            h.eq(lines[1].app, 'harness');
            h.eq(kinds[kinds.length - 1], 'log.end', "main's own last line closes the file");

            const pre = lines.filter((l) => l.pre === 1);
            h.assert(pre.some((l) => l.k === 'doc.edit' && Array.isArray(l.added) && l.added.some((/** @type {any} */ a) => a.id === note)),
                'the Note placed BEFORE the switch is in the file, flagged pre');
            h.assert(pre.some((l) => l.k === 'ui.click' && /Record log/.test(String(l.target && l.target.label))), 'so is the click on the switch itself');

            const live = lines.filter((l) => !l.pre);
            h.assert(live.some((l) => l.k === 'doc.edit' && Array.isArray(l.wiresAdded)), 'the wire, as an edit');
            h.assert(live.some((l) => l.k === 'doc.edit' && Array.isArray(l.relabeled) && l.relabeled[0].label === 'city'), 'the wire label, as an edit');
            h.assert(live.some((l) => l.k === 'doc.edit' && Array.isArray(l.settings) && l.settings.some((/** @type {any} */ s) => s.changed && s.changed.instruction === 'name three things')),
                'the prompt as it was typed');
            h.assert(live.some((l) => l.k === 'ui.click' && /comp-run-all/.test(String(l.target && l.target.sel))), 'the click on Run all');
            h.assert(live.some((l) => l.k === 'run.start'), 'run.start');
            h.assert(live.some((l) => l.k === 'run.part' && l.id === ask && l.state === 'done'), 'the Ask box finishing');
            h.assert(live.some((l) => l.k === 'run.end'), 'run.end');
            const req = live.find((l) => l.k === 'http.req' && /chat\/completions$/.test(String(l.url)));
            h.assert(!!req, 'the farm request');
            h.eq(req.model, 'mock-echo');
            h.assert(Array.isArray(req.msgs) && req.msgs.some((/** @type {any} */ m) => /Paris/.test(String(m.text))), 'with the prompt it carried');
            h.assert(live.some((l) => l.k === 'http.res' && l.id === req.id), 'and its answer');
            h.assert(!text.includes(MOCK_KEY), 'the farm password is NOT in the file');
            h.assert(!/Bearer\s+[^\s[]/.test(text), 'no bearer token in the file');

            h.assert(live.some((l) => l.k === 'err.uncaught' && /k7 planted uncaught/.test(String(l.message))), 'the uncaught error');
            h.assert(live.some((l) => l.k === 'err.rejection' && /k7 planted rejection/.test(JSON.stringify(l.reason))), 'the unhandled rejection');
            h.assert(live.some((l) => l.k === 'con.error' && /k7 planted console error/.test(String(l.text))), 'the console.error');

            const mark = live.find((l) => l.k === 'mark');
            h.assert(!!mark, 'the marker');
            h.eq(mark.note, 'the answer box stayed grey after the run');
            h.eq(mark.i, 1);
            h.assert(mark.doc && Array.isArray(mark.doc.parts) && mark.doc.parts.length === 2, 'the marker carries the whole graph');
            h.assert(mark.state && mark.state.docId, 'and the state');
            h.assert(mark.farm && mark.farm.apiKey !== MOCK_KEY, 'and the farm, key redacted');
            if (mark.png) h.assert(fs.existsSync(path.join(h.tmpDir, 'logs', 'computer', mark.png)), 'the screenshot is next to the file');
            else h.note('no screenshot: a hidden window has no compositor frame (run with --show to see one)');
            h.assert(live.some((l) => l.k === 'ui.toast' && /Marker 1/.test(String(l.text))), 'what the person was told is in the log too');
            h.note(`${lines.length} lines, ${(text.length / 1024).toFixed(0)} KB, ${pre.length} from before the switch`);
        },
    },
    {
        name: 'k7-recorder-the-switch-survives-a-reload-and-starts-a-new-file',
        needsMock: true,
        needsDebugLog: 'real',
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const before = files(h);
            await h.click('#lolcomputer .comp-rec-toggle');
            await h.waitFor(() => (window.LolComputer.debug.devlog.status().recording ? true : null), { timeout: 10000 });
            const first = (await status(h)).name;
            await h.sleep(1100);                      // file names carry seconds

            await h.reload();
            await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.devlog && window.LolComputer.debug.devlog.status().recording ? true : null), { timeout: 20000 });
            const second = (await status(h)).name;
            h.assert(second && second !== first, `a new file after the reload: ${first} -> ${second}`);
            const all = files(h, before);
            h.eq(all.length, 2, 'two recordings');
            const old = linesOf(all[0]);
            h.assert(old.some((l) => l.k === 'log.pagehide'), 'the first file says the page went away');
            h.eq(linesOf(all[1])[0].why, 'resume', 'the second says it resumed');

            await open(h);
            h.eq((await drawn(h)).pressed, 'true', 'the switch is drawn on after the reload');
            await h.click('#lolcomputer .comp-rec-toggle');
            await h.waitFor(() => (window.LolComputer.debug.devlog.status().recording ? null : true), { timeout: 10000 });
            await h.reload();
            await h.waitFor(() => (window.LolComputer && window.LolComputer.ready ? true : null), { timeout: 20000 });
            await h.sleep(300);
            h.eq((await status(h)).recording, false, 'turned off stays off across a reload');
            h.eq(files(h, before).length, 2, 'and starts no file');
        },
    },
];
