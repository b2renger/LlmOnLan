// @ts-check
// The way IN to the workbench, from a reader's point of view.
//
// Written when 194 scenarios passed while the Computer panel was, for a human, unreachable: the
// rail that holds the tabs lives INSIDE the work column, which is 0 px wide while the workbench is
// closed, so the only openers were Ctrl+\ and Ctrl+1..4. The owner opened the client, went looking
// for the Computer, and could not find it.
//
// AMENDED AT THE K1 LANDING (COMPUTER_PLAN §3.7): the Computer left the workbench, the chat shipped no
// panel, and this scenario registered a stand-in to keep the MECHANISM tested.
// AMENDED AT P5 (docs/IDE_PLAN.md): the chat ships a panel again — the IDE's **Project** — so the door is
// tested on the real thing: a thread's header names it, opens it, and closes it again.

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
        name: 'c4-header-door-opens-a-panel',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));

            // A first launch — no chat at all yet — already shows the door, and its tooltip names the key.
            const first = await h.waitFor(() => {
                const b = document.querySelector('[data-workbench-toggle]');
                return b ? { title: b.getAttribute('title') || '' } : null;
            }, { timeout: 5000 });
            h.assert(/^Open the Project panel \((Ctrl\+|⌃)1\)$/.test(first.title), `the door before any chat: "${first.title}"`);

            await h.submit('a thread to hang a workbench off');
            await h.waitReply();

            const before = await h.waitFor(() => {
                const b = document.querySelector('[data-workbench-toggle]');
                return b ? true : null;
            }, { timeout: 15000 });
            h.assert(before, 'the chat ships the Project panel, but the thread header has no button for it');

            const shut = await door(h);
            h.assert(shut.visible, 'the header button is in the DOM but has no size');
            h.eq(shut.panel, 'project', 'the header button should offer the Project panel');
            h.assert(/project/i.test(shut.label), `the button must name the panel, got "${shut.label}"`);
            h.eq(shut.pressed, 'false', 'a closed workbench must not read as pressed');
            h.eq(await workWidth(h), 0, 'the work column should have no width while closed');

            // Click it the way a person does.
            await h.click('[data-workbench-toggle]');
            const open = await h.waitFor(() => {
                const w = document.querySelector('#lolchat .chat-work');
                const live = window.LolChat.app.work.current();
                return w && w.getBoundingClientRect().width > 100 && live ? live : null;
            }, { timeout: 15000 });
            h.eq(open, 'project', 'the button opened something other than the panel it names');

            const opened = await door(h);
            h.eq(opened.pressed, 'true', 'an open workbench must read as pressed');
            h.assert(/close/i.test(opened.title), `an open button should offer to close, got "${opened.title}"`);

            // The panel's own body is really there, not just a column.
            h.assert(await h.eval(() => !!document.querySelector('#lolchat .chat-work-body .chat-proj')),
                'the column opened but the Project panel did not mount into it');

            // And the same button closes it again.
            await h.click('[data-workbench-toggle]');
            await h.waitFor(() => (window.LolChat.app.work.current() ? null : true), { timeout: 15000 });
            h.eq(await workWidth(h), 0, 'the work column kept its width after closing');
            h.eq((await door(h)).pressed, 'false', 'the button still reads as pressed after closing');
        },
    },
];
