// @ts-check
// The C3 landing's own seam (integrator-owned, like c1-landing.mjs): the ONE wire the phase needed
// in a shared file, and the two coherence facts a landing is for.
//
// 1. THE CODE BRIDGE SHIPS. C3-U2 built "Send to the Computer" (a button on a JavaScript fence and
//    a message action) but `installCodeBridge` registers NOTHING without a placer, and only the
//    panel can place a part. c3-parts proves the affordance by installing its OWN placer; this
//    scenario installs nothing at all and asserts the SHIPPED app has it — the panel wires it in
//    `create()` and takes it off in `destroy()`. A bridge registered twice, or left behind when the
//    panel closes, is exactly the failure a landing is for.
// 2. THE CATALOGUE IS ELEVEN, IN PALETTE ORDER (BJ-1), and the loader still has ONE Computer row
//    (BG-2) — the sandbox is imported by its consumers, never installed as a feature.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const BRIDGE_ID = 'code-to-computer';

const PALETTE = ['note', 'from-thread', 'ask', 'split', 'repeat', 'filter', 'code', 'collect', 'render', 'file', 'to-thread'];

/** The registry rows the bridge owns, counted in both slots. */
const bridgeRows = (/** @type {any} */ h) => h.eval((id) => {
    const app = window.LolChat.app;
    const list = (/** @type {string} */ slot) => app.registry.list(slot).filter((/** @type {any} */ x) => x && x.id === id);
    return { actions: list(app.SLOTS.MESSAGE_ACTIONS).length, decorators: list(app.SLOTS.CODE_DECORATORS).length };
}, BRIDGE_ID);

export default [
    {
        name: 'c3-landing-code-bridge-ships',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));

            // Before the panel is ever opened there is no bridge: nothing can place a part yet, and
            // a button that cannot deliver is worse than no button.
            const closed = await bridgeRows(h);
            h.eq(closed.actions, 0, 'the message action exists before any Computer panel does');
            h.eq(closed.decorators, 0, 'the fence decorator exists before any Computer panel does');

            await h.submit('a thread for the landing');
            await h.waitReply();
            const state = await h.graph.open();
            h.eq(state.panel, 'computer', 'the rail did not open the Computer');
            await h.waitFor(() => (window.LolChat.debug.computer.doc().threadId ? true : null));

            const open = await bridgeRows(h);
            h.eq(open.actions, 1, 'the shipped panel did not register the message action');
            h.eq(open.decorators, 1, 'the shipped panel did not register the fence decorator');

            // The action really places a Code part carrying the fence body. No placer of the
            // scenario's own — this is the app's wiring.
            const before = (await h.graph.doc()).parts.length;
            const placed = await h.eval(async () => {
                const app = window.LolChat.app;
                const action = app.registry.list(app.SLOTS.MESSAGE_ACTIONS)
                    .find((/** @type {any} */ a) => a.id === 'code-to-computer');
                const message = {
                    id: 'm-land',
                    role: 'assistant',
                    content: 'Here:\n```js\nreturn inputs.in.length;\n```\n',
                };
                const visible = action.visible(message, {});
                const out = await action.run(message, app);
                return { visible, id: out && out.id ? out.id : null };
            });
            h.eq(placed.visible, true, 'a reply carrying a JavaScript fence did not offer the action');
            h.assert(!!placed.id, 'the action placed nothing');

            const doc = await h.graph.doc();
            h.eq(doc.parts.length, before + 1, 'exactly one part should have arrived');
            const part = doc.parts.find((/** @type {any} */ p) => p.id === placed.id);
            h.assert(part && part.type === 'code', 'what arrived is not a Code part: ' + (part && part.type));
            h.assert(String(part.settings.code).includes('inputs.in.length'),
                'the fence body did not travel: ' + JSON.stringify(part.settings.code));
            h.assert(!String(part.settings.code).includes('```'), 'the fence markers travelled with it');

            // Close the panel: the bridge goes with it, and re-opening installs exactly one again
            // (a second install would throw inside the registry and take the panel with it).
            await h.work(null);
            await h.waitFor(() => (window.LolChat.debug.computer ? null : true), { timeout: 8000 });
            const gone = await bridgeRows(h);
            h.eq(gone.actions, 0, 'the message action outlived the panel that can serve it');
            h.eq(gone.decorators, 0, 'the fence decorator outlived the panel');

            await h.graph.open();
            await h.waitFor(() => (window.LolChat.debug.computer ? true : null));
            const again = await bridgeRows(h);
            h.eq(again.actions, 1, 're-opening the panel left ' + again.actions + ' message actions');
            h.eq(again.decorators, 1, 're-opening the panel left ' + again.decorators + ' decorators');
            h.note('bridge rows: closed 0 · open 1 · closed 0 · re-opened 1');
        },
    },
    {
        // C3-U1's contract request, resolved in the panel: the rebuild ladder goes quiet after
        // three rebuilds in a minute and only an explicit re-arm brings it back — and the host
        // cannot tell a human's Run from an automatic re-run, so the CALLER has to say. The Run
        // button says it; parts never do (a part that loops would otherwise rebuild for ever).
        name: 'c3-landing-run-rearms-a-quiet-sandbox',
        needsMock: true,
        timeoutMs: 240000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
            await h.submit('a thread whose code keeps looping');
            await h.waitReply();
            await h.graph.open();
            await h.waitFor(() => (window.LolChat.debug.computer.doc().threadId ? true : null));

            const note = await h.graph.place('note', 40, 40);
            const code = await h.graph.place('code', 340, 40);
            await h.graph.set(note, { text: 'anything' });
            await h.graph.set(code, { code: 'while (true) {}' });
            h.eq((await h.graph.wire(note, code, 'in')).ok, true);

            // Runaway runs inside the ladder's window: rebuild, rebuild, then quiet. A rebuild is
            // asynchronous, so the state is read once it has settled rather than the instant the
            // run returns.
            let quiet = null;
            for (let i = 0; i < 5 && !(quiet && quiet.blocked); i += 1) {
                await h.graph.run();
                quiet = await h.waitFor(() => {
                    const dbg = window.LolChat.debug.computer.sandbox();
                    return dbg.state === 'booting' ? null : dbg;
                }, { timeout: 20000 });
            }
            h.eq(quiet.blocked, true, 'the ladder never blocked (state "' + quiet.state + '", '
                + quiet.rebuilds + ' rebuilds)');
            h.eq(quiet.state, 'disabled', 'a blocked ladder should leave the sandbox disabled, got "' + quiet.state + '"');

            // A part asking on its own must NOT bring it back — that is the whole point of the
            // ladder. Ask exactly as a part does, with no rearm, and expect a refusal.
            const partTry = await h.eval(async () => {
                const sb = window.LolChat.debug.computer.session().sandboxNow();
                const out = await sb.compute({ code: 'return 1;', timeoutMs: 2000 });
                return { ok: out.ok, state: sb.state() };
            });
            h.eq(partTry.ok, false, 'a part re-armed the ladder by asking politely');
            h.eq(partTry.state, 'disabled', 'and the sandbox is "' + partTry.state + '" after it');

            // The human presses Run. The panel spends the one re-arm and the graph computes again.
            await h.graph.set(code, { code: 'return inputs.in[0].toUpperCase();' });
            const report = await h.graph.run();
            h.eq(report.errors.length, 0, 'the run after the re-arm failed: ' + JSON.stringify(report.errors));
            const parts = await h.graph.doc();
            const part = parts.parts.find((/** @type {any} */ p) => p.id === code);
            h.eq(part.state, 'done', 'the Code part is "' + part.state + '" after the human pressed Run');
            h.eq(part.value.data, 'ANYTHING', 'and it computed ' + JSON.stringify(part.value && part.value.data));
            const back = await h.graph.call('sandbox');
            h.eq(back.blocked, false, 'the ladder is still blocked after a human Run');
            h.note('ladder: 3 runaways -> disabled · a part asking is refused · Run re-arms and the graph computes');
        },
    },
    {
        // The fix pass. host.mjs shipped hide() — "the sketch stops now, the watchdog stops now,
        // and the frame goes after a grace period" — and NOTHING in the product called it: the
        // panel's own hide() hook only ran `runner.stop()`, which aborts a request still in
        // FLIGHT. A Code or Render part whose run already finished leaves live timers and rafs in
        // the guest (it resets on boot/run/stop/dispose, never on a panel flip), so a sketch kept
        // painting — and the 1 Hz watchdog kept pinging it — for as long as the app stayed open
        // with nobody looking. The C3 grace behaviour was asserted only by a test calling the host
        // by hand; this one goes through the product: hide the chat surface, and the guest process
        // must really go.
        //
        // `workGraceMs` is set LONGER than the sandbox's own 10 s grace on purpose: otherwise the
        // workbench would destroy the whole panel first and the iframe would vanish for a reason
        // that proves nothing.
        name: 'c3-landing-hiding-the-chat-suspends-the-guest',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh({ flags: { workGraceMs: 60000 } });
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
            await h.submit('a thread with something running in it');
            await h.waitReply();
            await h.graph.open();
            await h.waitFor(() => (window.LolChat.debug.computer.doc().threadId ? true : null));

            // A part that FINISHES and leaves work behind — the exact case runner.stop() cannot
            // touch, because there is no request in flight to abort.
            const note = await h.graph.place('note', 40, 40);
            const code = await h.graph.place('code', 340, 40);
            await h.graph.set(note, { text: 'go' });
            await h.graph.set(code, {
                code: 'self.__lolTicks = 0; setInterval(() => { self.__lolTicks += 1; }, 16); return "started";',
            });
            h.eq((await h.graph.wire(note, code, 'in')).ok, true);
            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `the run failed: ${JSON.stringify(report.errors)}`);
            h.eq(await h.eval(() => document.querySelectorAll('iframe').length), 1, 'the guest is up');
            h.eq((await h.graph.call('sandbox')).framed, true, 'and the host agrees it has a frame');

            // Nobody is looking any more.
            await h.eval(() => { document.getElementById('lolchat').classList.add('hidden'); return true; });

            // The panel is SUSPENDED, not destroyed (workGraceMs is a minute), so anything still
            // running in the guest is running for no one.
            await h.waitFor(() => (window.LolChat.debug.computer ? true : null));
            await h.waitFor(() => (document.querySelectorAll('iframe').length === 0 ? true : null),
                { timeout: 20000 });
            h.assert(await h.eval(() => !!window.LolChat.debug.computer),
                'the panel instance was torn down instead — this proves nothing about hide()');
            const asleep = await h.graph.call('sandbox');
            h.eq(asleep.framed, false, 'the guest process is gone');
            h.eq(asleep.state, 'idle', `a suspended sandbox ends up idle, got "${asleep.state}"`);

            // Coming back is a rebuild, and it works: a suspend must not be a one-way door.
            await h.eval(() => { document.getElementById('lolchat').classList.remove('hidden'); return true; });
            await h.waitFor(() => (window.LolChat.debug.computer ? true : null));
            await h.graph.set(code, { code: 'return inputs.in[0].toUpperCase();' });
            const again = await h.graph.run();
            h.eq(again.errors.length, 0, `the run after coming back failed: ${JSON.stringify(again.errors)}`);
            const part = (await h.graph.doc()).parts.find((/** @type {any} */ p) => p.id === code);
            h.eq(part.value.data, 'GO', 'and the rebuilt guest computed');
            h.note('hidden chat -> the guest stops and its process is released; coming back rebuilds it');
        },
    },
    {
        name: 'c3-landing-catalogue-and-loader',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));

            const seen = await h.eval(async () => {
                const mod = await import('../../renderer/chat/graph/parts/index.mjs');
                return {
                    types: mod.partSpecs().map((/** @type {any} */ p) => p.type),
                    version: window.LolChat.version,
                    failed: Object.keys(window.LolChat.failed || {}),
                };
            });
            h.eq(seen.types.join(','), PALETTE.join(','), 'the catalogue is not the eleven in palette order: ' + seen.types.join(','));
            h.eq(seen.failed.length, 0, 'modules failed to load: ' + seen.failed.join(', '));
            h.eq(seen.version, 'vnext-c3', 'the loader still says it is ' + seen.version);

            // The sandbox is imported by its consumers, never installed as a feature (BG-2/BJ-1):
            // the Computer panel is the ONE row that reaches the graph tree, and the guest's
            // iframe only exists once a panel has asked for it.
            const mounts = await h.eval(() => document.querySelectorAll('#lolchat iframe').length);
            h.eq(mounts, 0, 'an iframe exists before any panel asked for a sandbox');
            h.note('catalogue: ' + seen.types.join(' · '));
        },
    },
];
