// @ts-check
// The way IN to the workbench, from a reader's point of view.
//
// Every other workbench and Computer scenario opens a panel by calling `app.work.open(...)` (that is
// what `h.work()` does), and 194 of them passed while the panel was, for a human, unreachable: the
// rail that holds the tabs lives INSIDE the work column, which is 0 px wide while the workbench is
// closed, so the only openers were Ctrl+\ and Ctrl+1..4. The owner opened the client, went looking
// for the Computer, and could not find it.
//
// So this file asserts the door itself, through the DOM a person actually touches: a button in the
// thread header that names the panel, opens it, and closes it again. No API calls.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The header button, as a reader sees it: label, pressed state, and whether it is even on screen. */
const door = async (/** @type {any} */ h) => h.eval(() => {
    const b = document.querySelector('[data-workbench-toggle]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {
        label: (b.textContent || '').trim(),
        panel: b.getAttribute('data-workbench-toggle'),
        pressed: b.getAttribute('aria-pressed'),
        title: b.getAttribute('title') || '',
        visible: r.width > 0 && r.height > 0,
    };
});

const workWidth = async (/** @type {any} */ h) => h.eval(() => {
    const w = document.querySelector('#lolchat .chat-work');
    return w ? Math.round(w.getBoundingClientRect().width) : 0;
});

export default [
    {
        name: 'c4-header-door-opens-the-computer',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));

            // A thread, because the header only renders with one — the same route a reader takes.
            await h.submit('a thread to hang a workbench off');
            await h.waitReply();

            const shut = await h.waitFor(() => {
                const b = document.querySelector('[data-workbench-toggle]');
                return b ? true : null;
            }, { timeout: 15000 });
            h.assert(shut, 'no way into the workbench: the thread header has no panel button');

            const before = await door(h);
            h.assert(before.visible, 'the header button is in the DOM but has no size');
            h.eq(before.panel, 'computer', 'the header button should offer the Computer');
            h.assert(/computer/i.test(before.label), `the button must name the panel, got "${before.label}"`);
            h.eq(before.pressed, 'false', 'a closed workbench must not read as pressed');
            h.eq(await workWidth(h), 0, 'the work column should have no width while closed');

            // Click it the way a person does.
            await h.click('[data-workbench-toggle]');
            const open = await h.waitFor(() => {
                const w = document.querySelector('#lolchat .chat-work');
                const live = window.LolChat.app.work.current();
                return w && w.getBoundingClientRect().width > 100 && live ? live : null;
            }, { timeout: 15000 });
            h.eq(open, 'computer', 'the button opened something other than the Computer');

            const opened = await door(h);
            h.eq(opened.pressed, 'true', 'an open workbench must read as pressed');
            h.assert(/close/i.test(opened.title), `an open button should offer to close, got "${opened.title}"`);

            // The canvas is really there, not just a column.
            const canvas = await h.eval(() => !!document.querySelector('#lolchat .chat-work-body .graph-canvas .graph-layer'));
            h.assert(canvas, 'the column opened but the Computer canvas did not mount into it');

            // And the same button closes it again.
            await h.click('[data-workbench-toggle]');
            await h.waitFor(() => (window.LolChat.app.work.current() ? null : true), { timeout: 15000 });
            h.eq(await workWidth(h), 0, 'the work column kept its width after closing');
            h.eq((await door(h)).pressed, 'false', 'the button still reads as pressed after closing');
        },
    },
];
