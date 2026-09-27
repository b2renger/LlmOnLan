// @ts-check
// The way IN to the workbench, from a reader's point of view.
//
// Written when 194 scenarios passed while the Computer panel was, for a human, unreachable: the
// rail that holds the tabs lives INSIDE the work column, which is 0 px wide while the workbench is
// closed, so the only openers were Ctrl+\ and Ctrl+1..4. The owner opened the client, went looking
// for the Computer, and could not find it.
//
// AMENDED AT THE K1 LANDING (COMPUTER_PLAN §3.7). The Computer is no longer a workbench panel —
// its door is the topbar's segmented control, which this page cannot exercise (it has no topbar
// and never loads app.js; rig item §13.1). With the Computer gone the chat ships NO panels at all
// today, and `ui/workbench.mjs` correctly renders no header button when none is registered. The
// guarantee worth keeping is therefore the MECHANISM, not the Computer: a registered panel gets a
// visible, named button in the thread header that opens it and closes it again. The scenario
// registers its own panel, exactly as `s0-workbench` does, so the door stays tested for whatever
// panel the chat grows next.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** A panel with a name a reader would recognise, registered by this scenario alone. */
const installPanel = (/** @type {any} */ h) => h.eval(() => {
    const app = window.LolChat.app;
    app.registry.add(app.SLOTS.WORKBENCH_PANELS, {
        id: 'notebook',
        order: 100,
        label: 'Notebook',
        defaultWidth: 'split',
        available: () => true,
        create(/** @type {any} */ host) {
            const p = document.createElement('p');
            p.className = 'c4-notebook';
            p.textContent = 'notebook';
            host.appendChild(p);
            return { show() {}, hide() {}, destroy() { host.replaceChildren(); }, onThread() {} };
        },
    });
    return true;
});

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

            // With NO panel registered there must be no button at all — a door to nowhere is worse
            // than no door (this is the state the chat actually ships in after K1).
            await h.submit('a thread to hang a workbench off');
            await h.waitReply();
            h.eq(await door(h), null, 'a header button exists although no panel is registered');

            await installPanel(h);
            // The header host rebuilds its row on its own events; selecting the thread again is the
            // ordinary route that re-renders it.
            await h.eval(async () => {
                const app = window.LolChat.app;
                const rows = await app.repo.listThreads();
                return app.controller.selectThread(rows[0].id);
            });

            const before = await h.waitFor(() => {
                const b = document.querySelector('[data-workbench-toggle]');
                return b ? true : null;
            }, { timeout: 15000 });
            h.assert(before, 'a registered panel got no way in: the thread header has no button');

            const shut = await door(h);
            h.assert(shut.visible, 'the header button is in the DOM but has no size');
            h.eq(shut.panel, 'notebook', 'the header button should offer the registered panel');
            h.assert(/notebook/i.test(shut.label), `the button must name the panel, got "${shut.label}"`);
            h.eq(shut.pressed, 'false', 'a closed workbench must not read as pressed');
            h.eq(await workWidth(h), 0, 'the work column should have no width while closed');

            // Click it the way a person does.
            await h.click('[data-workbench-toggle]');
            const open = await h.waitFor(() => {
                const w = document.querySelector('#lolchat .chat-work');
                const live = window.LolChat.app.work.current();
                return w && w.getBoundingClientRect().width > 100 && live ? live : null;
            }, { timeout: 15000 });
            h.eq(open, 'notebook', 'the button opened something other than the panel it names');

            const opened = await door(h);
            h.eq(opened.pressed, 'true', 'an open workbench must read as pressed');
            h.assert(/close/i.test(opened.title), `an open button should offer to close, got "${opened.title}"`);

            // The panel's own body is really there, not just a column.
            h.assert(await h.eval(() => !!document.querySelector('#lolchat .chat-work-body .c4-notebook')),
                'the column opened but the panel did not mount into it');

            // And the same button closes it again.
            await h.click('[data-workbench-toggle]');
            await h.waitFor(() => (window.LolChat.app.work.current() ? null : true), { timeout: 15000 });
            h.eq(await workWidth(h), 0, 'the work column kept its width after closing');
            h.eq((await door(h)).pressed, 'false', 'the button still reads as pressed after closing');
        },
    },
];
