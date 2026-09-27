// @ts-check
// Ecosystem plan v2 §3.3 (the owner's next goal: STT and TTS nodes for the Computer).
//   1. Listen: a Sound box, turned to Listen, sends its recording to the farm's speech-to-text and hands
//      on the WORDS. A farm without the service says so, and nothing is sent.
//   2. Speak: says what arrives — with the farm's voice (one call to its /audio/speech) or this
//      computer's own — and passes the text on.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

function wav(/** @type {number} */ seconds, rate = 8000) {
    const n = Math.round(seconds * rate);
    const b = Buffer.alloc(44 + n);
    b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii');
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36, 'ascii');
    b.writeUInt32LE(n, 40); b.fill(128, 44);
    return b;
}
const file = (/** @type {string} */ name, /** @type {string} */ mime, /** @type {Buffer} */ bytes) => ({ name, mime, base64: bytes.toString('base64') });
const onBox = (/** @type {string} */ id) => `#lolcomputer .graph-part[data-id="${id}"] .graph-part-body`;

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}

/** Press ▶ on one box and wait for it to settle. → the part */
async function runOne(/** @type {any} */ h, /** @type {string} */ id) {
    const stamp = (await h.computer.doc()).updatedAt;
    await h.computer.runFrom(id);
    await h.waitFor((pid, was) => {
        const dbg = window.LolComputer.debug.computer;
        const d = dbg.doc();
        const p = d.parts.find((x) => x.id === pid);
        return !dbg.running() && d.updatedAt !== was && p && (p.state === 'done' || p.state === 'error' || p.state === 'stale') ? true : null;
    }, { timeout: 60000, args: [id, stamp] });
    return (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === id);
}

export default [
    {
        name: 'k15-speech-a-sound-box-listens-through-the-farm-and-hands-on-the-words',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.computer.stt(false);
            await open(h);
            const snd = await h.computer.place('audio', 60, 60);
            await h.computer.dropFiles([file('greeting.wav', 'audio/wav', wav(1))], null, onBox(snd));
            await h.waitFor((id) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === id);
                return p && p.settings.fileId ? true : null;
            }, { timeout: 15000, args: [snd] });

            // The switch is on the face, and it says where the sound goes.
            await h.input.click(`#lolcomputer .graph-part[data-id="${snd}"] .graph-audio-listen-box`);
            h.eq((await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === snd).settings.listen, true, 'the Listen switch sets the box');

            // No speech to text on this farm: a sentence, and nothing sent.
            let p = await runOne(h, snd);
            h.eq(p.state, 'error');
            h.assert(/cannot listen/.test(String(p.error)), `says the farm cannot listen: ${p.error}`);
            h.eq((await h.mock.log({ path: '/stt/v1/audio/transcriptions' })).length, 0, 'nothing was sent');

            // With it: the recording goes once, and the words flow on.
            await h.computer.stt(true);
            p = await runOne(h, snd);
            h.eq(p.state, 'done', `transcribed: ${p.error}`);
            h.eq(p.value.kind, 'text');
            h.assert(/Mock transcript of greeting\.wav/.test(String(p.value.data)), `the farm's words for THIS recording: ${p.value.data}`);
            h.eq((await h.mock.log({ path: '/stt/v1/audio/transcriptions' })).length, 1, 'one upload');
        },
    },

    {
        name: 'k15-speech-a-speak-box-says-the-text-with-the-farm-voice-or-this-computers',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.computer.tts(true);
            await open(h);
            const txt = await h.computer.place('note', 60, 60);
            await h.computer.set(txt, { text: 'Hello from the Computer.' });
            const spk = await h.computer.place('speak', 460, 60);
            await h.computer.wire(txt, spk, 'in');

            await h.computer.set(spk, { voice: 'farm' });
            let p = await runOne(h, spk);
            h.eq(p.state, 'done', `the farm's voice: ${p.error}`);
            h.eq(p.value && p.value.data, 'Hello from the Computer.', 'the text is passed on');
            const calls = await h.mock.log({ path: '/tts/v1/audio/speech' });
            h.eq(calls.length, 1, 'one call to the farm voice');
            const said = await h.eval((id) => (document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-speak-said`) || {}).textContent || '', spk);
            h.assert(/the farm’s voice/.test(said), `the face says which voice: ${said}`);

            // This computer's own voice: nothing more goes to the farm.
            await h.computer.set(spk, { voice: 'local' });
            p = await runOne(h, spk);
            h.eq(p.state, 'done', `this computer's voice: ${p.error}`);
            h.eq((await h.mock.log({ path: '/tts/v1/audio/speech' })).length, 1, 'no new farm call');

            // The farm voice asked for when the farm has none: a sentence, not a silent pass.
            await h.computer.tts(false);
            await h.computer.set(spk, { voice: 'farm' });
            p = await runOne(h, spk);
            h.eq(p.state, 'error');
            h.assert(/offers no voice/.test(String(p.error)), `says so: ${p.error}`);
        },
    },
];
