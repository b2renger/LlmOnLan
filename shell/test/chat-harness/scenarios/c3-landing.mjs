// @ts-check
// The C3 landing's own seam (integrator-owned, like c1-landing.mjs): the ONE wire the phase needed
// in a shared file, and the two coherence facts a landing is for.
//
// 1. (RETIRED AT THE K1 LANDING.) "THE CODE BRIDGE SHIPS" proved that the shipped panel registered
//    "Send to the Computer" on every JavaScript fence and took it off again when it closed. The
//    Computer is not a panel inside a conversation any more, so there is nothing for a fence button
//    to place into: `installCodeBridge` and its two registry rows are deleted, and guarantee BH-7
//    leaves the suite by decision (COMPUTER_PLAN §3.7, named in the DEVLOG).
// 2. THE CATALOGUE IS NINE, IN PALETTE ORDER (BJ-1, amended at K1: `from-thread` and `to-thread`
//    are demoted to legacy and leave the palette while staying in `specMap()`), and the CHAT no
//    longer loads the graph tree at all — the sandbox's iframe only exists once the Computer's own
//    surface has asked for one.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
// K3 kickoff (COMPUTER_PLAN §6.6): the six control parts join at the END of the palette.
// K4 kickoff (COMPUTER_PLAN §6.4-§6.7): Image, Preview (which replaces Render in the palette)
// and the three annotation parts join; Render stays loadable so a C3 graph still opens.
// K6 kickoff (LOLCHAT_PLAN 2.6 KF-4): Document and Sound join "bring in", right after Image.
const PALETTE = ['note', 'ask', 'split', 'repeat', 'filter', 'code', 'collect', 'preview', 'file',
    'image', 'document', 'audio', 'button', 'condition', 'confirm', 'dialog', 'toggle', 'timer',
    'sticky', 'section', 'title'];
const LEGACY = ['from-thread', 'to-thread', 'render'];

export default [
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
            await h.waitFor(() => ((window.LolComputer.debug.computer.doc() || {}).id ? true : null));

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
                    const dbg = window.LolComputer.debug.computer.sandbox();
                    return dbg.state === 'booting' ? null : dbg;
                }, { timeout: 20000 });
            }
            h.eq(quiet.blocked, true, 'the ladder never blocked (state "' + quiet.state + '", '
                + quiet.rebuilds + ' rebuilds)');
            h.eq(quiet.state, 'disabled', 'a blocked ladder should leave the sandbox disabled, got "' + quiet.state + '"');

            // A part asking on its own must NOT bring it back — that is the whole point of the
            // ladder. Ask exactly as a part does, with no rearm, and expect a refusal.
            const partTry = await h.eval(async () => {
                const sb = window.LolComputer.debug.computer.session().sandboxNow();
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
        // `workGraceMs` used to be set LONGER than the sandbox's own 10 s grace so the workbench
        // could not destroy the panel first and make the iframe vanish for a reason that proves
        // nothing. The Computer is never destroyed now — it is hidden — so the flag is kept only
        // because the chat's workbench still reads it, and the grace that matters is the guest's.
        name: 'c3-landing-hiding-the-computer-suspends-the-guest',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh({ flags: { workGraceMs: 60000 } });
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
            await h.submit('a thread with something running in it');
            await h.waitReply();
            await h.graph.open();
            await h.waitFor(() => ((window.LolComputer.debug.computer.doc() || {}).id ? true : null));

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

            // Nobody is looking any more. K1 landing: it is the COMPUTER's own section that is
            // hidden now — the sandbox belongs to that surface, not to the chat.
            await h.view('chat');

            // The panel is SUSPENDED, not destroyed (workGraceMs is a minute), so anything still
            // running in the guest is running for no one.
            await h.waitFor(() => (window.LolComputer.debug.computer ? true : null));
            await h.waitFor(() => (document.querySelectorAll('iframe').length === 0 ? true : null),
                { timeout: 20000 });
            h.assert(await h.eval(() => !!window.LolComputer.debug.computer),
                'the panel instance was torn down instead — this proves nothing about hide()');
            const asleep = await h.graph.call('sandbox');
            h.eq(asleep.framed, false, 'the guest process is gone');
            h.eq(asleep.state, 'idle', `a suspended sandbox ends up idle, got "${asleep.state}"`);

            // Coming back is a rebuild, and it works: a suspend must not be a one-way door.
            await h.view('computer');
            await h.waitFor(() => (window.LolComputer.debug.computer ? true : null));
            await h.graph.set(code, { code: 'return inputs.in[0].toUpperCase();' });
            const again = await h.graph.run();
            h.eq(again.errors.length, 0, `the run after coming back failed: ${JSON.stringify(again.errors)}`);
            const part = (await h.graph.doc()).parts.find((/** @type {any} */ p) => p.id === code);
            h.eq(part.value.data, 'GO', 'and the rebuilt guest computed');
            h.note('hidden Computer -> the guest stops and its process is released; coming back rebuilds it');
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

            await h.waitFor(() => (window.LolComputer && window.LolComputer.ready ? true : null));

            const seen = await h.eval(async () => {
                const mod = await import('../../renderer/chat/graph/parts/index.mjs');
                return {
                    types: mod.partSpecs().map((/** @type {any} */ p) => p.type),
                    loadable: Array.from(mod.specMap().keys()),
                    version: window.LolChat.version,
                    computerVersion: window.LolComputer.version,
                    failed: Object.keys(window.LolChat.failed || {}),
                    computerFailed: Object.keys(window.LolComputer.failed || {}),
                };
            });
            h.eq(seen.types.join(','), PALETTE.join(','), 'the catalogue is not the twenty-one in palette order: ' + seen.types.join(','));
            for (const type of LEGACY) {
                h.eq(seen.types.indexOf(type), -1, type + ' is still offered in the palette');
                h.assert(seen.loadable.indexOf(type) >= 0,
                    type + ' left specMap() too — a migrated graph would trip part:unknown-type');
            }
            h.eq(seen.failed.length, 0, 'chat modules failed to load: ' + seen.failed.join(', '));
            h.eq(seen.computerFailed.length, 0, 'Computer modules failed to load: ' + seen.computerFailed.join(', '));
            h.eq(seen.version, 'vnext-k1', 'the chat loader says it is ' + seen.version);
            h.eq(seen.computerVersion, 'vnext-k7', 'the Computer loader says it is ' + seen.computerVersion);

            // The sandbox is imported by its consumers, never installed as a feature (BG-2/BJ-1),
            // and the CHAT no longer reaches the graph tree at all (K1: the `computer` loader row
            // is gone). Nothing under #lolchat may hold a guest iframe, ever.
            const mounts = await h.eval(() => document.querySelectorAll('#lolchat iframe').length);
            h.eq(mounts, 0, 'the chat is holding a sandbox iframe it has no way to have asked for');
            h.note('catalogue: ' + seen.types.join(' · ') + ' · legacy: ' + LEGACY.join(' · '));
        },
    },
];
