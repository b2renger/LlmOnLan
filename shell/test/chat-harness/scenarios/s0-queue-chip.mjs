// @ts-check
// The batch queue chip (S0-U3, ui/queue.mjs) in the real DOM.
//
// studio plan §3.5.4: "Nothing in this plan starts a batch without a visible queue chip", and the
// chip "is the one place a user can stop a batch, and Escape ... reaches it through
// CANCEL_HANDLERS." S0 shipped `app.ask.queue` callable with no chip at all (S0 review, finding 7).
// This scenario is that constraint made into a gate: a running batch is SEEN, and the chip's own
// button stops it. No farm is involved — the batch's `run` is ours, so nothing is generated.

const CHIP = '#chat-queue-chip';
const CANCEL = '#chat-queue-cancel';

/** Everything the chip is showing right now. */
const chip = (/** @type {any} */ h) => h.eval((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { present: false };
    const text = el.querySelector('.chat-queue-text');
    const note = el.querySelector('.chat-queue-note');
    const cancel = el.querySelector('.chat-queue-cancel');
    return {
        present: true,
        hidden: !!el.hidden,
        text: text ? text.textContent : '',
        note: note && !note.hidden ? note.textContent : '',
        cancelVisible: !!(cancel && !cancel.hidden),
    };
}, CHIP);

export default [
    {
        name: 's0-queue-chip',
        async run(h) {
            const wired = await h.eval(() => !!(window.LolChat.app.ask && !window.LolChat.failed.queue));
            h.assert(wired, 'ask and the queue chip both installed');

            const idle = await chip(h);
            h.assert(idle.present, 'the chip exists in the DOM from install');
            h.eq(idle.hidden, true, 'and is hidden while nothing is batching');

            // A batch that parks on a gate we hold, so the chip can be read mid-run.
            await h.eval(() => {
                const app = window.LolChat.app;
                let open = () => {};
                window.__gate = new Promise((r) => { open = r; });
                window.__openGate = open;
                window.__ran = [];
                window.__batch = app.ask.queue({
                    label: 'Naming 3 sketches',
                    items: ['a', 'b', 'c'],
                    run: async (item) => { window.__ran.push(item); await window.__gate; return { ok: true }; },
                });
                return true;
            });
            await h.waitFor((sel) => {
                const el = document.querySelector(sel);
                return !!(el && !el.hidden);
            }, { args: [CHIP] });

            const running = await chip(h);
            h.eq(running.text, 'Naming 3 sketches — 0/3', 'it names the batch and its progress');
            h.eq(running.cancelVisible, true, 'and offers the one way to stop it');
            h.eq(running.note, '', 'nothing was dropped, so no batch-limit note');

            // The chip's button is the door: it emits, it does not hold a handle.
            await h.click(CANCEL);
            await h.eval(() => { window.__openGate(); return true; });
            const out = await h.eval(() => window.__batch.promise);
            h.eq(out.cancelled, true, 'the batch was stopped from the chip');
            h.eq(await h.eval(() => window.__ran.length), 1, 'nothing after the in-flight item ran');
            await h.waitFor((sel) => {
                const el = document.querySelector(sel);
                return !!(el && el.hidden);
            }, { args: [CHIP] });

            // A batch longer than pref:queueMax says so, instead of dropping items silently.
            await h.eval(() => {
                const app = window.LolChat.app;
                let open = () => {};
                window.__gate2 = new Promise((r) => { open = r; });
                window.__openGate2 = open;
                window.__batch2 = app.ask.queue({
                    label: 'Ten nodes',
                    items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                    run: async () => { await window.__gate2; return { ok: true }; },
                });
                return true;
            });
            await h.waitFor((sel) => {
                const el = document.querySelector(sel);
                return !!(el && !el.hidden);
            }, { args: [CHIP] });
            // A photograph in both themes when the run was asked for shots; the chip is only on
            // screen while a batch runs, so this is the only place it can be caught.
            for (const theme of ['dark', 'light']) {
                await h.eval((cls) => { document.documentElement.className = cls; return true; }, theme);
                const shot = await h.screenshot(`s0-queue-chip-${theme}`);
                if (shot) h.note(`screenshot s0-queue-chip-${theme}`);
            }
            await h.eval(() => { document.documentElement.className = 'dark'; return true; });

            const capped = await chip(h);
            h.eq(capped.text, 'Ten nodes — 0/4', 'the batch was cut to pref:queueMax (4)');
            h.eq(capped.note, '6 not run (batch limit)', 'and the chip SAYS six items never ran');

            await h.eval(() => { window.LolChat.app.bus.emit('ask:queue:cancel', { from: 'test' }); return true; });
            await h.eval(() => { window.__openGate2(); return true; });
            const out2 = await h.eval(() => window.__batch2.promise);
            h.eq(out2.truncated, 6, 'the result carries it too, so a caller can tell 4 done from 10 done');
            await h.waitFor((sel) => {
                const el = document.querySelector(sel);
                return !!(el && el.hidden);
            }, { args: [CHIP] });
            return null;
        },
    },
];
