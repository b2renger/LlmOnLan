// @ts-check
// Converse (docs/COMPUTER_VOICE_PLAN.md §11), in the real page on the mock farm. The microphone is
// Chromium's fake device playing chat-harness/mic-fixture.js (1 s of silence, 1.5 s of a speech-like
// voice, 2 s of silence, looped), so every loop is one turn of "the person's". A live p5 Preview is the
// face: its sketch logs every conversation event it receives through lol.on, and the scenario reads
// those logs through the live guest's handle.
//   1. ● Start opens the microphone; a whole turn reaches the face in the order of §4 — user.start,
//      user.end, transcript, thinking, bot.start, three bot.sentence, bot.end, turn — and the first
//      sentence is sent to the farm's voice before the model's stream has ended.
//   2. With a slow voice, the next turn of the person's speaks over the bot: `interrupted`, the voice
//      stops, what was said is kept, and that next turn is answered.
//   3. Switching to LOL Vibe ends the conversation (`ended {why:'hidden'}`), the microphone's track
//      is stopped, and the box's value is the transcript.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const QUIET_KINDS = ['user.level', 'bot.level', 'bot.text'];

/** The face: a p5 sketch that writes down every event it hears (its console comes back to the host). */
const FACE = [
    "lol.on('*', (e) => { if (e.type !== 'user.level' && e.type !== 'bot.level' && e.type !== 'bot.text') console.log('VOICE ' + e.type); });",
    'let level = 0;',
    "lol.on('user.level', (e) => { level = e.level; });",
    'function setup() { createCanvas(240, 180); noStroke(); }',
    'function draw() { background(20); fill(230); circle(120, 90, 40 + 120 * level); }',
].join('\n');

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}
const click = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ sel) => h.eval((pid, s) => {
    const el = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] ${s}`);
    if (!el) return false;
    /** @type {any} */ (el).click();
    return true;
}, id, sel);

/** The conversation's events so far (levels and streaming text left out). */
const voiceEvents = (/** @type {any} */ h) => h.eval(() => /** @type {any} */ (window).__voice.slice());

export default [
    {
        name: 'k27-converse-a-spoken-conversation-reaches-the-live-face-is-interrupted-and-ends-when-the-computer-is-left',
        needsMock: true,
        timeoutMs: 150000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.computer.stt(true);
            await h.computer.tts(true);
            await h.mock.state({ ttsMsPerChar: 12, voiceChunkMs: 350 });
            await open(h);

            // The face: a p5 Preview, ▶ Live.
            const face = await h.computer.place('preview', 520, 40);
            await h.computer.set(face, { mode: 'p5', source: FACE, w: 240, h: 180 });
            await h.waitFor((id) => !!document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-preview-live:not([disabled])`), { timeout: 15000, args: [face] });
            h.eq(await click(h, face, '.graph-preview-live'), true, 'the Preview has ▶ Live');
            await h.waitFor(() => {
                const sb = window.LolComputer.app.host.session.sandboxNow();
                const live = sb && sb.liveNow();
                return live && live.state() === 'running' ? true : null;
            }, { timeout: 20000 });

            // The box, on the mock's three-sentence speaker, impatient enough for the fixture's loop.
            const conv = await h.computer.place('converse', 40, 40);
            await h.computer.set(conv, { model: 'mock-voice', voice: 'farm', endSilenceMs: 600, interruptible: true, cues: 'none', maxTurns: 8, language: 'fr' });
            const noFace = await h.eval((id) => /** @type {any} */ (document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-converse-noface`)).hidden, conv);
            h.eq(noFace, true, 'the box sees its face (a Preview is Live)');

            // Watch what the page asks of the microphone, and what the box announces.
            await h.eval(() => {
                const w = /** @type {any} */ (window);
                w.__mics = [];
                w.__voice = [];
                const md = navigator.mediaDevices;
                const orig = md.getUserMedia.bind(md);
                md.getUserMedia = async (/** @type {any} */ c) => { const s = await orig(c); w.__mics.push(s); return s; };
                window.LolComputer.app.bus.on('voice:event', (/** @type {any} */ e) => {
                    if (['user.level', 'bot.level', 'bot.text'].includes(e.type)) return;
                    w.__voice.push({ type: e.type, state: e.state, t: e.t, why: e.why, said: e.said, text: e.text, index: e.index });
                });
                return true;
            });
            h.eq(await h.eval(() => /** @type {any} */ (window).__mics.length), 0, 'nothing has opened the microphone');

            // 1. ● Start.
            h.eq(await click(h, conv, '.graph-converse-start'), true, 'the box has ● Start');
            await h.waitFor(() => (/** @type {any} */ (window).__mics.length ? true : null), { timeout: 10000 });
            const micOn = await h.eval((id) => !/** @type {any} */ (document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-converse-mic`)).hidden, conv);
            h.eq(micOn, true, 'the face says the microphone is on');
            // A whole turn: a `turn` right after a `bot.end`.
            const deadline = Date.now() + 45000;
            /** @type {any[]} */ let evs = [];
            for (;;) {
                evs = await voiceEvents(h);
                const i = evs.findIndex((e, k) => e.type === 'turn' && k > 0 && evs[k - 1].type === 'bot.end');
                if (i >= 0) break;
                if (Date.now() > deadline) throw new Error(`no complete turn in 45 s: ${evs.map((e) => e.type).join(' ')}`);
                await new Promise((r) => setTimeout(r, 250));
            }
            const end = evs.findIndex((e, k) => e.type === 'turn' && k > 0 && evs[k - 1].type === 'bot.end');
            const startAt = evs.slice(0, end).map((e) => e.type).lastIndexOf('user.start');
            const turn1 = evs.slice(startAt, end + 1).map((e) => e.type);
            h.eq(turn1, ['user.start', 'user.end', 'transcript', 'thinking', 'bot.start', 'bot.sentence', 'bot.sentence', 'bot.sentence', 'bot.end', 'turn'], 'one turn, in the order of §4');
            h.assert(/Mock transcript of turn\.wav/.test(String(evs.slice(startAt, end).find((e) => e.type === 'transcript').text)), 'the farm wrote down a 16 kHz WAV of the turn');

            // The first sentence went to the voice before the stream ended.
            const completions = (await h.mock.log({ path: '/v1/chat/completions' })).filter((e) => e.model === 'mock-voice' && e.streamEndedAt);
            const speeches = await h.mock.log({ path: '/tts/v1/audio/speech' });
            h.assert(completions.length >= 1 && speeches.length >= 1, `asked and spoken: ${completions.length} / ${speeches.length}`);
            h.assert(speeches[0].ts < completions[0].streamEndedAt, `the first sentence went to the voice ${completions[0].streamEndedAt - speeches[0].ts} ms before the stream ended`);
            h.eq(speeches[0].voice, 'af_heart', 'the farm\'s own voice (none set on the box)');

            // 2. A slow voice: the person's next turn speaks over it.
            await h.mock.state({ ttsMsPerChar: 90, voiceChunkMs: 350 });
            const seen = evs.length;
            const deadline2 = Date.now() + 45000;
            for (;;) {
                evs = await voiceEvents(h);
                const after = evs.slice(seen);
                const k = after.findIndex((e) => e.type === 'interrupted');
                if (k >= 0 && after.slice(k).some((e) => e.type === 'user.end')) break;
                if (Date.now() > deadline2) throw new Error(`no interruption in 45 s: ${after.map((e) => e.type).join(' ')}`);
                await new Promise((r) => setTimeout(r, 250));
            }
            const after = evs.slice(seen);
            const cut = after.find((e) => e.type === 'interrupted');
            h.assert(String(cut.said || '').startsWith('Bonjour, je vous entends.'), `what was said is kept: ${cut.said}`);
            const types = after.map((e) => e.type);
            h.assert(types.indexOf('interrupted') > types.indexOf('bot.start'), `interrupted while it spoke: ${types.join(' ')}`);
            // interrupt() says so, records what was said as its turn, then the person's speech is the next turn.
            const at = types.indexOf('interrupted');
            h.eq(types.slice(at, at + 3), ['interrupted', 'turn', 'user.start'], `the person's speech is what cut it: ${types.join(' ')}`);

            // The face heard all of it (its sketch's console, read through the live guest's handle).
            const faceLog = await h.eval(() => {
                const live = window.LolComputer.app.host.session.sandboxNow().liveNow();
                return live ? live.logs().map((/** @type {any} */ l) => String(l.text)) : null;
            });
            h.assert(Array.isArray(faceLog), 'the face is still Live');
            for (const kind of ['start', 'listening', 'user.start', 'user.end', 'transcript', 'thinking', 'bot.start', 'bot.sentence', 'bot.end', 'turn', 'interrupted']) {
                h.assert(faceLog.includes(`VOICE ${kind}`), `the face got ${kind}`);
            }
            h.eq(faceLog.filter((l) => l === 'VOICE bot.sentence').length >= 3, true, 'and every sentence');
            h.assert(!faceLog.some((l) => QUIET_KINDS.some((q) => l === `VOICE ${q}`)), 'the sketch filtered the levels itself');

            // 3. Leave the Computer: the conversation ends, the microphone closes.
            await h.view('chat');
            await h.waitFor(() => {
                const v = /** @type {any} */ (window).__voice;
                return v.some((/** @type {any} */ e) => e.type === 'ended') ? true : null;
            }, { timeout: 10000 });
            const ended = (await voiceEvents(h)).find((e) => e.type === 'ended');
            h.eq(ended.why, 'hidden', 'leaving the Computer ends it');
            const tracks = await h.eval(() => /** @type {any} */ (window).__mics.flatMap((/** @type {any} */ s) => s.getTracks().map((/** @type {any} */ t) => t.readyState)));
            h.assert(tracks.length >= 1 && tracks.every((s) => s === 'ended'), `every microphone track stopped: ${tracks.join(',')}`);
            const part = await h.waitFor((id) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === id);
                return p && p.state === 'done' ? p : null;
            }, { timeout: 15000, args: [conv] });
            h.eq(part.value.kind, 'json');
            h.eq(part.value.data.why, 'hidden');
            h.assert(part.value.data.turns.length >= 2, `the transcript is the box's value: ${part.value.data.turns.length} turns`);
            h.assert(part.value.data.turns.some((/** @type {any} */ x) => x.interrupted), 'with the interrupted turn');
            const first = part.value.data.turns[0];
            h.assert(first.ms && typeof first.ms.firstSound === 'number' && first.ms.firstSound > 600, `the wait it made: first sound ${first.ms && first.ms.firstSound} ms`);
            h.note(`first sound ${first.ms.firstSound} ms (mock farm), heard ${first.ms.heard} ms, first word ${first.ms.firstWord} ms`);
        },
    },
];
