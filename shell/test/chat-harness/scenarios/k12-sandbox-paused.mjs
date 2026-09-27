// @ts-check
// Docs review 2026-09-27, CA-1: after three stalls inside a minute the sandbox PAUSES, and it used
// to say so nowhere — the pause notice had no listener on the Computer, and every box that asked
// for the sandbox afterwards read "The sandbox could not start", which was false (it started three
// times). Now the notice is a toast, a box that asks while paused says it is paused and names what
// brings it back, and Run all does bring it back. The real guest, a real infinite loop, no farm.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

async function open(/** @type {any} */ h) {
    await h.fresh();
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.setFarm(null);
}

const sandbox = (/** @type {any} */ h) => h.eval(() => window.LolComputer.debug.computer.sandbox());

export default [
    {
        name: 'k12-sandbox-paused-after-three-stalls-says-so-and-run-all-brings-it-back',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        timeoutMs: 120000,
        async run(/** @type {any} */ h) {
            await open(h);
            const words = await h.eval(() => ({
                disabled: window.LolComputer.app.t('sandbox.disabled'),
                stalled: window.LolComputer.app.t('sandbox.stalled'),
                paused: window.LolComputer.app.t('sandbox.errPaused'),
                couldNot: window.LolComputer.app.t('sandbox.errDisabled'),
            }));
            // Every toast that appears, kept: a toast lives 4.2 s, a stall takes about as long.
            await h.eval(() => {
                const w = /** @type {any} */ (window);
                w.__k12toasts = [];
                const seen = new WeakSet();
                const mo = new MutationObserver(() => {
                    for (const el of Array.from(document.querySelectorAll('.chat-toast'))) {
                        if (seen.has(el)) continue;
                        seen.add(el);
                        w.__k12toasts.push({ text: el.textContent, error: el.classList.contains('chat-toast-error') });
                    }
                });
                mo.observe(document.body, { childList: true, subtree: true });
                w.__k12mo = mo;
                return true;
            });

            const code = await h.computer.place('code', 80, 80);
            await h.computer.set(code, { code: 'while (true) {}' });

            // Press ▶ until the watchdog has torn the looping guest down three times. Usually three
            // presses; sometimes more, because Chromium can put the rebuilt frame in the process that
            // is still spinning, and that frame's boot times out (a boot timeout is not a stall).
            // `runFrom` is the door ▶ presses (host.start), and it resolves when the run is over.
            let presses = 0;
            for (; presses < 10; presses++) {
                if ((await sandbox(h)).blocked) break;
                await h.computer.runFrom(code);
                // ...and the guest is not half way through its rebuild.
                await h.waitFor(() => {
                    const sb = window.LolComputer.debug.computer.sandbox();
                    return sb.state !== 'booting' && sb.state !== 'stalled' ? true : null;
                }, { timeout: 30000 });
            }
            h.note(`${presses} presses of ▶ to reach three stalls`);
            const after = await sandbox(h);
            h.eq(after.blocked, true, 'the third stall inside a minute pauses the sandbox');
            h.eq(after.state, 'disabled', 'and its state says so');

            const toasts = await h.waitFor((want) => {
                const all = /** @type {any} */ (window).__k12toasts || [];
                return all.some((x) => x.text === want) ? all : null;
            }, { args: [words.disabled], timeout: 8000 });
            h.assert(toasts.some((x) => x.text === words.disabled && x.error), 'the pause is an error toast on screen');
            h.assert(toasts.some((x) => x.text === words.stalled), 'each earlier stall said the preview was restarted');
            h.assert(/Run all/.test(words.disabled) && !/Run again/.test(words.disabled), `the pause names Run all: ${words.disabled}`);

            // A box that asks for the sandbox without re-arming it (a Preview's Run code) is told it
            // is PAUSED and how to bring it back — never "could not start".
            const pre = await h.computer.place('preview', 420, 80);
            await h.computer.set(pre, { mode: 'p5', source: 'function setup() { createCanvas(40, 40); background(200); }' });
            await h.waitFor((id) => (document.querySelector('#lolcomputer .graph-preview-run[data-part="' + id + '"]') ? true : null), { args: [pre], timeout: 10000 });
            await h.eval((id) => { /** @type {any} */ (document.querySelector('#lolcomputer .graph-preview-run[data-part="' + id + '"]')).click(); return true; }, pre);
            const said = await h.waitFor((id) => {
                const el = document.querySelector('#lolcomputer .graph-part[data-id="' + id + '"] .graph-preview-error');
                const text = el && !el.hidden ? el.textContent : '';
                return text ? text : null;
            }, { args: [pre], timeout: 15000 });
            h.eq(said, words.paused, 'Run code while paused says the sandbox is paused');
            h.assert(said !== words.couldNot, 'not "could not start"');
            h.eq((await sandbox(h)).blocked, true, 'Run code does not re-arm it');

            // Run all brings it back: fix the loop, press the run bar's Run all.
            await h.computer.set(code, { code: 'return 7;' });
            await h.input.click('#lolcomputer .comp-run-all');
            const done = await h.waitFor((id) => {
                const d = window.LolComputer.debug.computer;
                const p = d.doc().parts.find((/** @type {any} */ x) => x.id === id);
                return p && !d.running() && (p.state === 'done' || p.state === 'error') ? { state: p.state, error: p.error || null } : null;
            }, { args: [code], timeout: 30000 });
            h.eq(done.state, 'done', `Run all ran the Code box again: ${JSON.stringify(done)}`);
            const back = await sandbox(h);
            h.eq(back.blocked, false, 'Run all re-armed the sandbox');
            await h.eval(() => { const w = /** @type {any} */ (window); if (w.__k12mo) w.__k12mo.disconnect(); return true; });
        },
    },
];
