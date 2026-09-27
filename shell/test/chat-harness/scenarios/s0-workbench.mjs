// @ts-check
// S0-U1 in the real browser: the workbench column, its panel lifecycle and the three width states
// (studio plan §3.5, DOM contract §2.6 BD-8).
//
// The unit tests (studio-state) prove the merge/clamp table. Only these scenarios can prove the
// parts that are not arithmetic:
//   - that exactly ONE panel is ever live — the old one's hide() AND destroy() run before the new
//     one's show(), asserted through a call log the test panels write;
//   - that hidden really means idle: a panel's rAF stops when #lolchat is hidden and the instance
//     is destroyed after the grace, then re-created when the reader comes back;
//   - that the grid column really changes width, and that the drag survives a reload;
//   - that a thread reopens the workbench it was left with, and a thread with no studio state
//     closes it;
//   - that all of this costs the chat nothing while it is closed (the parity scenario).
//
// No real panel exists in S0 (the Computer panel arrives with docs/LOLCHAT_COMPUTER_SPEC.md), so
// the panels here are registered from the scenario through `app.registry` — which is also a test of
// §2.6 AD: the rail is built from the slot AT RENDER TIME, so a panel registered after boot
// appears without the workbench being told.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const COMPLETIONS = '/v1/chat/completions';

/** The POSTs the page really made to the mock proxy. */
const completions = async (/** @type {any} */ h) =>
    (await h.mock.log({ path: COMPLETIONS })).filter((/** @type {any} */ e) => e.method === 'POST');

/** Fail loudly when the workbench did not load (a fake would make a green run meaningless). */
const requireReal = async (/** @type {any} */ h) => {
    await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
    await h.eval(() => {
        const failed = (window.LolChat && window.LolChat.failed) || {};
        if (failed.work) throw new Error(`S0-U1 needs the REAL ui/workbench.mjs: ${failed.work.error}`);
        const app = window.LolChat.app;
        if (!app.work) throw new Error('ui/workbench.mjs loaded but installed nothing (app.work is missing)');
        const want = ['open', 'close', 'current', 'width', 'panels', 'request', 'on'];
        const got = Object.keys(app.work).sort();
        if (got.join(',') !== want.slice().sort().join(',')) {
            throw new Error(`app.work must be exactly ${want.join('/')}, got ${got.join('/')}`);
        }
        if (!document.querySelector('.chat-work')) throw new Error('no .chat-work in the layout');
        return true;
    });
};

/**
 * Register test-only panels. Each one logs every lifecycle call and runs a rAF loop, so a scenario
 * can see both the ORDER of the calls and whether the panel is really idle while hidden.
 * @param {any} h @param {string[]} ids
 */
const installPanels = (/** @type {any} */ h, ids = ['alpha', 'beta']) => h.eval((list) => {
    const app = window.LolChat.app;
    window.__panelLog = [];
    window.__panelFrames = {};
    list.forEach((id, i) => {
        app.registry.add(app.SLOTS.WORKBENCH_PANELS, {
            id,
            order: 100 + i,
            label: `Panel ${id}`,
            defaultWidth: 'split',
            create(host) {
                // A 20 ms setTimeout chain, not requestAnimationFrame: the harness window produces
                // no frames unless run.js was started with --show, so rAF would never tick and the
                // "hidden means idle" assertions would pass for the wrong reason.
                let raf = 0;
                let frames = 0;
                const tick = () => { frames++; window.__panelFrames[id] = frames; raf = setTimeout(tick, 20); };
                const stop = () => { if (raf) clearTimeout(raf); raf = 0; };
                const body = document.createElement('p');
                body.textContent = id;
                host.appendChild(body);
                window.__panelLog.push(`${id}:create`);
                return {
                    show() { window.__panelLog.push(`${id}:show`); if (!raf) raf = setTimeout(tick, 20); },
                    hide() { window.__panelLog.push(`${id}:hide`); stop(); },
                    destroy() { window.__panelLog.push(`${id}:destroy`); stop(); host.replaceChildren(); },
                    onThread() { window.__panelLog.push(`${id}:onThread`); },
                    debug: { frames: () => frames, running: () => !!raf },
                };
            },
        });
    });
    // Reading the slot renders the rail. Filtered to THIS scenario's panels: from C1 the real
    // `computer` panel registers itself into the same slot, and these assertions are about the
    // test panels, not about the slot being globally empty (C1 kickoff, §2.6 BG).
    return app.work.panels().map((/** @type {any} */ p) => p.id).filter((/** @type {any} */ id) => list.includes(id));
}, ids);

const log = (/** @type {any} */ h) => h.eval(() => (window.__panelLog || []).slice());
const clearLog = (/** @type {any} */ h) => h.eval(() => { window.__panelLog = []; return true; });
const frames = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((i) => (window.__panelFrames || {})[i] || 0, id);
const workDebug = (/** @type {any} */ h) => h.eval(() => window.LolChat.debug.work.state());
const flushStudio = (/** @type {any} */ h) => h.eval(() => { window.LolChat.debug.work.flush(); return true; });

/** The resolved grid tracks, in px. The column TRANSITIONS (160 ms), so every read waits. */
const columns = (/** @type {any} */ h) => h.eval(() => {
    const cols = getComputedStyle(document.getElementById('lolchat')).gridTemplateColumns.split(/\s+/);
    return cols.map((c) => parseFloat(c) || 0);
});
const workColumnPx = async (/** @type {any} */ h) => (await columns(h))[2];
/** Wait until the third track satisfies `test` (a function body, evaluated in the page). */
const waitColumn = (/** @type {any} */ h, /** @type {string} */ op, /** @type {number} */ n) => h.waitFor((o, want) => {
    const cols = getComputedStyle(document.getElementById('lolchat')).gridTemplateColumns.split(/\s+/);
    const px = parseFloat(cols[cols.length - 1]) || 0;
    const ok = o === 'gt' ? px > want : o === 'lt' ? px < want : px === want;
    return ok ? { px, cols: cols.map((c) => parseFloat(c) || 0) } : null;
}, { args: [op, n], timeout: 5000 });

const liveText = (/** @type {any} */ h) => h.eval(() => {
    const el = document.querySelector('#lolchat .chat-live');
    return el ? (el.textContent || '').trim() : '';
});

/** Ctrl+\ — the width cycle. The listener is ui/shortcuts.mjs's single document handler. */
const cycle = (/** @type {any} */ h) => h.key('body', '\\', { ctrl: true });

/** Select a thread the way the sidebar does. */
const select = (/** @type {any} */ h, /** @type {string} */ id) =>
    h.eval((i) => window.LolChat.app.controller.selectThread(i), id);

const threadIds = (/** @type {any} */ h) => h.eval(() => window.LolChat.app.repo.listThreads().then(
    (/** @type {any[]} */ list) => list.map((t) => ({ id: t.id, title: t.title || '' })),
));

export default [
    {
        name: 's0-workbench-open',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Ctrl+\ cycles chat → split → work → chat, the grid column really changes, and the split
        // fraction the reader dragged survives a reload (kv ui:workWidth).
        run: async (h) => {
            await requireReal(h);

            // With the slot empty there is no column at all — the whole of S0's visible state.
            let state = await h.workState();
            h.eq(state.hidden, true, 'no panels registered: no column');
            h.eq(state.panel, null);
            h.eq(await workColumnPx(h), 0, 'the third grid track is 0px while the workbench is closed');

            h.eq((await installPanels(h)).join(','), 'alpha,beta', 'the rail is built from the slot at render time');
            h.eq((await h.workState()).hidden, true, 'registering a panel does not OPEN the workbench');

            await cycle(h);                                    // chat → split
            state = await h.workState();
            h.eq(state.width, 'split', 'Ctrl+\\ opens the workbench at the split width');
            h.eq(state.panel, 'alpha', 'with nothing remembered, the first panel opens');
            h.eq(state.hidden, false);
            const splitPx = (await waitColumn(h, 'gt', 300)).px;
            h.note(`split column: ${Math.round(splitPx)}px`);

            await cycle(h);                                    // split → work
            state = await h.workState();
            h.eq(state.width, 'work');
            await waitColumn(h, 'gt', splitPx + 20);
            // The two tracks move on the SAME 160 ms grid transition, and `waitColumn` returns the
            // instant the work track passes its threshold — which can be a frame before the chat
            // track has finished collapsing (seen once in a 211-scenario run: 500.391 px, and green
            // on every isolated re-run). Wait for the state this line is about, then assert it.
            const collapsed = await h.waitFor(() => {
                const cols = getComputedStyle(document.getElementById('lolchat')).gridTemplateColumns.split(/\s+/);
                return (parseFloat(cols[1]) || 0) === 0 ? cols.map((c) => parseFloat(c) || 0) : null;
            }, { timeout: 5000 });
            h.eq(collapsed[1], 0, 'the chat column is collapsed in the work state');
            h.note(`work column: ${Math.round(collapsed[collapsed.length - 1])}px`);
            h.assert(collapsed[collapsed.length - 1] > splitPx + 20,
                `the work width is no wider than the split width: ${Math.round(collapsed[collapsed.length - 1])}px vs ${Math.round(splitPx)}px`);
            h.assert(await h.eval(() => {
                const form = document.getElementById('chat-form');
                return !!form && form.getBoundingClientRect().height > 0;
            }), 'the composer still has a docked one-line bar in the work state');

            await cycle(h);                                    // work → chat
            state = await h.workState();
            h.eq(state.width, 'chat');
            h.eq(state.panel, null, 'the cycle back to chat closes the panel');
            h.eq(state.hidden, true);
            await waitColumn(h, 'eq', 0);

            // Ctrl+1..4 open the n-th panel of the rail; pressing the live one closes it again.
            // "the n-th" is read off the rail, not hard-coded: from C1 the shipped Computer panel
            // registers into the same slot and sorts between the two test panels (§2.6 BG).
            const railIds = await h.eval(() => Array.from(document.querySelectorAll('.chat-work-rail [role="tab"]'))
                .map((el) => el.getAttribute('data-panel')));
            h.eq(railIds[0], 'alpha', 'the first tab of the rail');
            await h.key('body', '2', { ctrl: true });
            h.eq((await h.workState()).panel, railIds[1], 'Ctrl+2 opens the second panel');
            await h.key('body', '1', { ctrl: true });
            h.eq((await h.workState()).panel, 'alpha', 'Ctrl+1 switches to the first');
            await h.key('body', '1', { ctrl: true });
            h.eq((await h.workState()).panel, null, 'and Ctrl+1 again closes it');

            // The width control drives the same thing (BD-8: [data-width] radios in .chat-work-head).
            await h.work('alpha');
            h.eq(await h.width('work'), 'work');
            h.eq(await h.width('split'), 'split');

            // Drag the handle to 60 %, then reload: the fraction is remembered in kv ui:workWidth.
            const dragged = await h.eval(() => {
                const grip = document.querySelector('.chat-work-grip');
                const rect = document.getElementById('lolchat').getBoundingClientRect();
                const at = (f) => ({
                    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
                    clientX: rect.right - rect.width * f, clientY: rect.top + 20,
                });
                grip.dispatchEvent(new PointerEvent('pointerdown', at(0.46)));
                grip.dispatchEvent(new PointerEvent('pointermove', at(0.6)));
                grip.dispatchEvent(new PointerEvent('pointerup', at(0.6)));
                return getComputedStyle(document.getElementById('lolchat')).getPropertyValue('--chat-work-user').trim();
            });
            h.assert(/^59\.|^60\.|^60%|^59%/.test(dragged) || Math.abs(parseFloat(dragged) - 60) < 1.5,
                `the drag moved the split to ~60 %, got "${dragged}"`);
            const stored = await h.eval(() => window.LolChat.app.repo.kvGet('ui:workWidth', null));
            h.assert(Math.abs(parseFloat(stored) - 0.6) < 0.02, `kv ui:workWidth = ${stored}`);

            await h.reload();
            await requireReal(h);
            await installPanels(h);
            await h.work('alpha');
            await h.width('split');
            await h.sleep(300);
            const after = await h.eval(() => window.LolChat.app.repo.kvGet('ui:workWidth', null).then((kv) => ({
                kv,
                user: getComputedStyle(document.getElementById('lolchat')).getPropertyValue('--chat-work-user').trim(),
                mode: window.LolChat.app.state.storeMode,
            })));
            h.assert(Math.abs(parseFloat(after.user) - 60) < 1.5,
                `the dragged split fraction came back after a reload: ${JSON.stringify(after)}`);
            h.note(`split fraction restored after a reload: ${after.user}`);
        },
    },

    {
        name: 's0-workbench-single',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Rule 1 (§3.5.2): opening B while A is live calls A.hide() BEFORE B.show(), and the
        // workbench never holds two live panels — not even for a frame.
        run: async (h) => {
            await requireReal(h);
            await installPanels(h);

            await h.work('alpha');
            h.eq((await h.workState()).panel, 'alpha');
            h.eq((await workDebug(h)).live, 'alpha');
            await clearLog(h);

            await h.work('beta');
            const calls = await log(h);
            const hideAt = calls.indexOf('alpha:hide');
            const destroyAt = calls.indexOf('alpha:destroy');
            const showAt = calls.indexOf('beta:show');
            h.assert(hideAt >= 0 && showAt >= 0, `both calls happened: ${calls.join(' ')}`);
            h.assert(hideAt < showAt, `A.hide() before B.show(): ${calls.join(' ')}`);
            h.assert(destroyAt >= 0 && destroyAt < showAt, `A.destroy() before B.show(): ${calls.join(' ')}`);
            h.eq(await h.eval(() => document.querySelectorAll('.chat-work-panel').length), 1,
                'exactly one panel element lives in els.workBody');
            h.eq((await workDebug(h)).live, 'beta');
            h.eq(await h.eval(() => !!(window.LolChat.debug.alpha)), false,
                "the old panel's debug handle is gone with it");
            h.eq(await h.eval(() => window.LolChat.debug.beta.running()), true, 'the new panel is running');

            // Clicking the LIVE tab closes the workbench (BD-8) — that is how h.work(null) works.
            await clearLog(h);
            const closed = await h.work(null);
            h.eq(closed.panel, null);
            h.eq(closed.hidden, true);
            const after = await log(h);
            h.assert(after.includes('beta:hide') && after.includes('beta:destroy'), `closing tears down: ${after.join(' ')}`);

            // request() is the same door for a panel that wants to show itself.
            const req = await h.eval(() => window.LolChat.app.work.request('beta', 'work'));
            h.eq(req.panel, 'beta');
            h.eq(req.width, 'work');

            // A panel that says it cannot run shows its reason and refuses to open (§3.5.2).
            const refused = await h.eval(() => {
                const app = window.LolChat.app;
                app.registry.add(app.SLOTS.WORKBENCH_PANELS, {
                    id: 'gamma', order: 300, label: 'Panel gamma',
                    available: () => ({ no: 'needs a farm with vision' }),
                    create() { throw new Error('an unavailable panel must never be created'); },
                });
                app.work.panels();
                const tab = document.querySelector('.chat-work-rail [data-panel="gamma"]');
                const before = app.work.current();
                tab.click();
                return {
                    disabled: tab.getAttribute('aria-disabled'),
                    title: tab.getAttribute('title'),
                    before,
                    after: app.work.current(),
                    open: app.work.open('gamma').panel,
                };
            });
            h.eq(refused.disabled, 'true', 'the tab is disabled');
            h.assert(/vision/.test(refused.title), `the reason is on the tab: "${refused.title}"`);
            h.eq(refused.after, refused.before, 'clicking it opens nothing');
            h.eq(refused.open, 'beta', 'and open() refuses it too');
        },
    },

    {
        name: 's0-workbench-hidden',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Rule 3: hidden means idle. #lolchat hidden → hide(); the rAF stops; after the grace the
        // instance is destroyed; coming back re-creates and shows it.
        run: async (h) => {
            await h.fresh({ flags: { workGraceMs: 400 } });      // the real grace is 10 s (S0-U1)
            await requireReal(h);
            await installPanels(h, ['alpha']);
            await h.work('alpha');
            await h.waitFor(() => ((window.__panelFrames.alpha || 0) > 2 ? true : null));

            await clearLog(h);
            await h.eval(() => { document.getElementById('lolchat').classList.add('hidden'); return true; });
            await h.waitFor(() => ((window.__panelLog || []).includes('alpha:hide') ? true : null));
            const parked = await frames(h, 'alpha');
            await h.sleep(250);
            h.eq(await frames(h, 'alpha'), parked, 'a hidden panel holds no rAF');
            h.eq(await h.eval(() => window.LolChat.debug.alpha.running()), false, 'and says so itself');

            // The grace: still hidden → the instance goes, but the workbench stays OPEN on it.
            await h.waitFor(() => ((window.__panelLog || []).includes('alpha:destroy') ? true : null), { timeout: 5000 });
            const suspendedState = await workDebug(h);
            h.eq(suspendedState.live, null, 'the instance was released after the grace');
            h.eq(suspendedState.open, 'alpha', 'but the workbench is still open on that panel');

            await clearLog(h);
            await h.eval(() => { document.getElementById('lolchat').classList.remove('hidden'); return true; });
            await h.waitFor(() => ((window.__panelLog || []).includes('alpha:show') ? true : null));
            const back = await frames(h, 'alpha');
            await h.waitFor((was) => ((window.__panelFrames.alpha || 0) > was ? true : null), { args: [back] });
            h.eq((await workDebug(h)).live, 'alpha', 'coming back re-creates the panel');

            // The page going to the background counts as hidden too.
            await clearLog(h);
            await h.setPageVisible(false);
            await h.waitFor(() => ((window.__panelLog || []).includes('alpha:hide') ? true : null));
            await h.setPageVisible(true);
            await h.waitFor(() => ((window.__panelLog || []).includes('alpha:show') ? true : null));
        },
    },

    {
        name: 's0-workbench-thread',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Rule 4 + §2.6 AP.1: a brand-new thread starts closed; a thread that names a panel reopens
        // it at its own width; a thread that names none closes the workbench; and a switch between
        // two threads that name the SAME panel tells it through onThread instead of re-creating it.
        run: async (h) => {
            await requireReal(h);
            await installPanels(h);

            await h.submit('one');
            await h.waitReply();
            h.eq((await h.workState()).panel, null, 'a brand-new thread starts closed (§2.6 AP.1)');

            await h.work('alpha');
            await h.width('work');
            await flushStudio(h);
            const threads = await threadIds(h);
            h.eq(threads.length, 1, 'one thread so far');
            const first = threads[0].id;

            await h.submit('two');
            await h.waitReply();
            let state = await h.workState();
            h.eq(state.panel, null, 'the new thread starts closed even with a panel open before it');
            h.eq(state.width, 'chat');
            h.eq(state.hidden, true);

            await select(h, first);
            state = await h.waitFor((want) => {
                const work = window.LolChat.app.work;
                return work.current() === want ? { panel: work.current(), width: work.width() } : null;
            }, { args: ['alpha'] });
            h.eq(state.width, 'work', 'panel AND width come back from thread.studio');
            h.eq((await h.workState()).hidden, false);

            // The second thread now names the same panel: switching TELLS it, never re-creates it.
            const second = (await threadIds(h)).find((/** @type {any} */ t) => t.id !== first).id;
            await select(h, second);
            await h.waitFor(() => (window.LolChat.app.work.current() === null ? true : null));
            h.eq((await h.workState()).hidden, true, 'a thread with no studio state closes the panel');

            await h.work('alpha');
            await flushStudio(h);
            await clearLog(h);
            await select(h, first);
            const calls = await h.waitFor(() => {
                const l = window.__panelLog || [];
                return l.includes('alpha:onThread') ? l.slice() : null;
            });
            h.assert(!calls.includes('alpha:destroy'), `the live panel was told, not rebuilt: ${calls.join(' ')}`);
            h.eq(await h.eval(() => window.LolChat.app.work.width()), 'work', "and took the thread's width");
        },
    },

    {
        name: 's0-workbench-a11y',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The rail is a tablist with a roving tabindex, the body is its tabpanel, the width control
        // is a radiogroup, and every state change announces exactly once.
        run: async (h) => {
            await requireReal(h);
            await installPanels(h);

            const roles = await h.eval(() => {
                const rail = document.querySelector('.chat-work-rail');
                const body = document.querySelector('.chat-work-body');
                const group = document.querySelector('.chat-work-head [role="radiogroup"]');
                return {
                    rail: rail.getAttribute('role'),
                    railLabel: !!rail.getAttribute('aria-label'),
                    tabs: Array.from(rail.querySelectorAll('[role="tab"]')).map((t) => ({
                        panel: t.getAttribute('data-panel'),
                        selected: t.getAttribute('aria-selected'),
                        tabindex: t.getAttribute('tabindex'),
                    })),
                    body: body.getAttribute('role'),
                    labelledBy: body.getAttribute('aria-labelledby'),
                    radios: Array.from(group.querySelectorAll('[role="radio"]')).map((r) => ({
                        width: r.getAttribute('data-width'), checked: r.getAttribute('aria-checked'),
                    })),
                };
            });
            h.eq(roles.rail, 'tablist');
            h.eq(roles.railLabel, true, 'the rail names itself');
            h.eq(roles.body, 'tabpanel');
            const mine = roles.tabs.filter((/** @type {any} */ t) => t.panel === 'alpha' || t.panel === 'beta');
            h.eq(mine.map((/** @type {any} */ t) => t.panel).join(','), 'alpha,beta');
            h.eq(roles.tabs.filter((/** @type {any} */ t) => t.tabindex === '0').length, 1, 'roving tabindex: exactly one 0');
            h.eq(roles.radios.map((/** @type {any} */ r) => r.width).join(','), 'chat,split,work');

            await h.work('alpha');
            const opened = await h.eval(() => {
                const rail = document.querySelector('.chat-work-rail');
                const body = document.querySelector('.chat-work-body');
                return {
                    tabs: Array.from(rail.querySelectorAll('[role="tab"]')).map((t) => ({
                        panel: t.getAttribute('data-panel'), selected: t.getAttribute('aria-selected'), tabindex: t.getAttribute('tabindex'),
                    })),
                    labelledBy: body.getAttribute('aria-labelledby'),
                    checked: Array.from(document.querySelectorAll('.chat-work-head [role="radio"]'))
                        .filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.getAttribute('data-width')),
                };
            });
            h.eq(opened.tabs.filter((/** @type {any} */ t) => t.selected === 'true').map((/** @type {any} */ t) => t.panel).join(','), 'alpha',
                'exactly one tab is selected');
            h.eq(opened.tabs.find((/** @type {any} */ t) => t.panel === 'alpha').tabindex, '0');
            h.eq(opened.tabs.find((/** @type {any} */ t) => t.panel === 'beta').tabindex, '-1');
            h.eq(opened.labelledBy, 'chat-work-tab-alpha', 'the body is labelled by the live tab');
            h.eq(opened.checked.join(','), 'split', 'the width radio reflects the state');

            // ← / → walk the rail without opening anything.
            const roved = await h.eval(() => {
                const rail = document.querySelector('.chat-work-rail');
                const tabs = Array.from(rail.querySelectorAll('[role="tab"]')).map((el) => el.getAttribute('data-panel'));
                const alpha = rail.querySelector('[data-panel="alpha"]');
                alpha.focus();
                rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
                return {
                    focused: document.activeElement.getAttribute('data-panel'),
                    next: tabs[tabs.indexOf('alpha') + 1],
                    open: window.LolChat.app.work.current(),
                };
            });
            h.eq(roved.focused, roved.next, 'ArrowRight moves the focus along the rail');
            h.eq(roved.open, 'alpha', 'and moving the focus opens nothing');

            // One announcement per change, and never the same line twice.
            const first = await liveText(h);
            h.assert(/Panel alpha/.test(first), `opening announced itself: "${first}"`);
            await h.width('work');
            const second = await liveText(h);
            h.assert(second !== first && second.length > 0, `the width change announced once: "${second}"`);
            await h.work(null);
            const third = await liveText(h);
            h.assert(third !== second && third.length > 0, `closing announced itself: "${third}"`);
        },
    },

    {
        name: 's0-workbench-parity',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The third column costs the chat nothing while it is closed: p1-basic-stream, re-run with
        // the workbench installed, must produce the same DOM and the same wire body.
        run: async (h) => {
            await requireReal(h);
            await h.waitFor(() => {
                const select = document.getElementById('chat-model');
                return !!(window.__lolFarm && select && select.options.length > 1) || null;
            });

            const before = await h.workState();
            h.eq(before.hidden, true, 'the workbench starts closed');
            h.eq(await workColumnPx(h), 0, 'and takes no width');

            await h.submit('hello there');
            const reply = await h.waitReply();
            h.assert(/^\d+ tok · \d+\.\d tok\/s · first token \d+\.\d\ds$/.test(reply.stats), `stats format: "${reply.stats}"`);
            h.assert(reply.reasoning && reply.reasoning.includes('think0'), 'the reasoning block is shown');
            h.assert(reply.text.includes('tok0 ') && reply.text.includes('tok999'), 'the whole answer landed');

            const posts = await completions(h);
            h.eq(posts.length, 1, 'exactly one completion');
            h.eq(posts[0].model, 'assistant', 'the farm default was auto-selected');
            h.assert(posts[0].body.stream === true, 'streamed');
            h.eq((await h.workState()).hidden, true, 'and the workbench never opened itself');
        },
    },
];
