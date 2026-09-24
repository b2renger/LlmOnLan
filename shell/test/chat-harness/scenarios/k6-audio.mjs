// @ts-check
// K6-U3 (LOLCHAT_PLAN 2.6 KF-6): the Sound box, in the real window, reached the way a person reaches
// it (build rule 6): placed from the ＋ menu, a file DROPPED on it with a real DragEvent, ▶ CLICKED.
// The sound files are made here, in Node — real WAV bytes of SILENCE (8-bit PCM at 128), so a
// playback test on the owner's box makes no noise — and Chromium's own decoder reads them.
//
// What it proves: a sound is kept and measured; what Chromium cannot decode and what is too long
// are refused IN WORDS on the box; ▶ plays through Web Audio and one sound plays at a time; the
// box says, from the farm's engine and models, why the sound will not be sent; and a run sends the
// file's name and length as TEXT — the farm never receives a sound part.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const COMPLETIONS = '/v1/chat/completions';

/** A mono 8-bit PCM WAV of silence. @param {number} seconds @param {number} [rate] */
function wav(seconds, rate = 8000) {
    const n = Math.round(seconds * rate);
    const b = Buffer.alloc(44 + n);
    b.write('RIFF', 0, 'ascii');
    b.writeUInt32LE(36 + n, 4);
    b.write('WAVE', 8, 'ascii');
    b.write('fmt ', 12, 'ascii');
    b.writeUInt32LE(16, 16);           // fmt chunk size
    b.writeUInt16LE(1, 20);            // PCM
    b.writeUInt16LE(1, 22);            // mono
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate, 28);         // byte rate (1 byte per sample)
    b.writeUInt16LE(1, 32);            // block align
    b.writeUInt16LE(8, 34);            // bits per sample
    b.write('data', 36, 'ascii');
    b.writeUInt32LE(n, 40);
    b.fill(128, 44);                   // 8-bit silence
    return b;
}
const file = (/** @type {string} */ name, /** @type {string} */ mime, /** @type {Buffer} */ bytes) => ({ name, mime, base64: bytes.toString('base64') });

/** Poll a NODE-side async check (h.waitFor runs its function in the page); the timeout says what it last saw. */
async function until(/** @type {any} */ h, /** @type {() => Promise<any>} */ fn, /** @type {number} */ ms, /** @type {string} */ what) {
    const end = Date.now() + ms;
    let last = null;
    while (Date.now() < end) {
        last = await fn();
        if (last) return last;
        await h.sleep(100);
    }
    throw new Error(`timed out after ${ms} ms waiting for ${what}; last: ${JSON.stringify(last)}`);
}

/** What the page's OWN resolver (graph/takes.mjs, the module instance the boxes use) answers for the
 * Sound box `id` on the live document and farm: the why CODE is what is asserted, so rewording a
 * sentence (K6-U1 owns the words) cannot break this scenario, and the box must show exactly it. */
const verdictOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval(async (pid) => {
    const m = await import('../../renderer/chat/graph/takes.mjs');
    const app = window.LolComputer.app;
    const s = app.host.session;
    const v = m.takesFor(s.doc(), pid, 'audio', m.farmViewOf(app), s.specs);
    return { state: v.state, why: v.why, reason: v.reason };
}, id);

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** The Computer, shown, with a document open, the real K6 doors installed, and the mock clear. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    const doors = await h.eval(() => ({
        media: !!(window.LolComputer.app.media && window.LolComputer.app.media.put),
        drops: !!(window.LolComputer.app.drops && window.LolComputer.app.drops.route),
        failed: Object.keys(window.LolComputer.failed || {}),
    }));
    if (!doors.media || !doors.drops) throw new Error(`K6-U3 needs the real media and drops doors; loader failed: ${doors.failed.join(', ')}`);
    await h.mock.reset();
    await h.mock.state({ extract: null });
    await h.publishFarm();
    return true;
}

/** What the Sound box `id` shows, straight off the DOM. */
const face = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const box = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"]`);
    if (!box) return null;
    const q = (/** @type {string} */ s) => /** @type {any} */ (box.querySelector(s));
    const body = q('.graph-part-body');
    const note = q('.graph-audio-note');
    return {
        empty: !q('.graph-audio-empty').hidden,
        player: !q('.graph-audio-player').hidden,
        name: q('.graph-audio-name').textContent,
        time: q('.graph-audio-time').textContent,
        note: note && !note.hidden ? note.textContent : '',
        playing: body.dataset.playing === 'true',
        pressed: q('.graph-audio-play').getAttribute('aria-pressed'),
        playLabel: q('.graph-audio-play').textContent,
    };
}, id);

/** The settings the document holds for part `id`. */
const settingsOf = async (/** @type {any} */ h, /** @type {string} */ id) =>
    ((await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === id) || {}).settings || {};

const onBox = (/** @type {string} */ id) => `#lolcomputer .graph-part[data-id="${id}"] .graph-part-body`;

export default [
    {
        name: 'k6-audio-a-sound-dropped-on-its-box-is-kept-measured-and-played-and-bad-files-are-refused-in-words',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);

            // Placed from the menu, the way a person does it.
            const id = await h.computer.add('audio');
            h.assert(!!id, 'clicking "Sound" in the ＋ menu placed a box');
            let f = await face(h, id);
            h.eq(f.empty, true, 'an empty Sound box shows its drop/choose face');
            h.eq(f.player, false);

            // A real WAV, dropped ON the box: kept, measured by Chromium's decoder, shown.
            const before = (await h.computer.doc()).parts.length;
            const drop = await h.computer.dropFiles([file('beep.wav', 'audio/wav', wav(1))], null, onBox(id));
            h.eq(drop.defaultPrevented, true, 'the box took the drop');
            // K6 landing: the box stops the drop, yet the canvas's "Drop a picture, a PDF…" overlay
            // must not stay on screen afterwards (a capture-phase listener hides it).
            h.eq(await h.eval(() => { const z = document.querySelector('#lolcomputer .graph-drop'); return !z || z.hidden; }), true,
                'the drop overlay is gone after a drop on a box');
            await h.waitFor((pid) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
                return p && p.settings && p.settings.fileId ? true : null;
            }, { args: [id], timeout: 10000 });
            const s = await settingsOf(h, id);
            h.eq(s.name, 'beep.wav');
            h.eq(s.mime, 'audio/wav');
            h.eq(s.durationSec, 1, 'Chromium measured one second');
            h.eq(s.size, 44 + 8000);
            h.assert(/^[0-9a-f]{64}$/.test(s.sha256), 'kept by content hash');
            h.eq((await h.computer.doc()).parts.length, before, 'a drop ON a box does not place a second box');
            f = await face(h, id);
            h.eq(f.player, true);
            h.eq(f.name, 'beep.wav');
            h.eq(f.time, await str(h, 'parts.audioTime', { at: '0:00', duration: '0:01', mb: '0.0' }));
            h.eq(f.note, '', 'nothing to complain about');
            const kept = await h.eval((fid) => window.LolComputer.app.media.get(fid).then((r) => (r ? { name: r.name, owner: r.threadId, size: r.size } : null)), s.fileId);
            h.eq(kept && kept.owner, 'computer:media', 'the bytes are on THIS computer, in the Computer\'s file store');

            // Bytes Chromium cannot decode, wearing an .mp3 name: refused on the box, in words.
            await h.computer.dropFiles([file('noise.mp3', 'audio/mpeg', Buffer.from('this is not an mp3 at all, just words'))], null, onBox(id));
            const undecodable = await str(h, 'parts.audioUndecodable', { name: 'noise.mp3' });
            await h.waitFor((pid, want) => {
                const n = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-audio-note`);
                return n && !n.hidden && n.textContent === want ? true : null;
            }, { args: [id, undecodable], timeout: 10000 });
            h.eq((await settingsOf(h, id)).name, 'beep.wav', 'the refusal changed nothing: the box still holds beep.wav');

            // Longer than the cap: decoded, measured, refused naming both lengths.
            await h.computer.dropFiles([file('lecture.wav', 'audio/wav', wav(601, 3000))], null, onBox(id));
            const tooLong = await str(h, 'parts.audioTooLong', { name: 'lecture.wav', duration: '10:01', cap: '10:00' });
            await h.waitFor((pid, want) => {
                const n = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-audio-note`);
                return n && !n.hidden && n.textContent === want ? true : null;
            }, { args: [id, tooLong], timeout: 15000 });

            // A PDF dropped on the Sound box: this box holds sound, and it says where the PDF goes.
            await h.computer.dropFiles([file('paper.pdf', 'application/pdf', Buffer.from('%PDF-1.4 x'))], null, onBox(id));
            h.eq((await face(h, id)).note, await str(h, 'parts.audioNotSound', { name: 'paper.pdf' }));

            // ▶ plays it through Web Audio; the one-second sound ends by itself and the button resets.
            await h.click(`${onBox(id)} .graph-audio-play`);
            await h.waitFor((pid) => {
                const b = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-part-body`);
                return b && b.getAttribute('data-playing') === 'true' ? true : null;
            }, { args: [id], timeout: 8000 });
            f = await face(h, id);
            h.eq(f.pressed, 'true');
            h.eq(f.playLabel, await str(h, 'parts.audioStop'));
            h.eq(f.note, '', 'a successful play clears the last refusal');
            await h.waitFor((pid) => {
                const b = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-part-body`);
                return b && b.getAttribute('data-playing') === 'false' ? true : null;
            }, { args: [id], timeout: 8000 });
            h.eq((await face(h, id)).playLabel, await str(h, 'parts.audioPlay'), 'the end of the sound resets ▶');

            // One sound at a time: a second box with a longer sound; ▶ on it stops the first.
            await h.computer.dropFiles([file('long.wav', 'audio/wav', wav(4))], null, onBox(id));
            await h.waitFor((pid) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
                return p && p.settings.name === 'long.wav' ? true : null;
            }, { args: [id], timeout: 10000 });
            const id2 = await h.computer.add('audio');
            await h.computer.dropFiles([file('other.wav', 'audio/wav', wav(4, 4000))], null, onBox(id2));
            await h.waitFor((pid) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
                return p && p.settings.fileId ? true : null;
            }, { args: [id2], timeout: 10000 });
            await h.click(`${onBox(id)} .graph-audio-play`);
            await h.waitFor((pid) => (document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-part-body`).getAttribute('data-playing') === 'true' ? true : null), { args: [id], timeout: 8000 });
            await h.click(`${onBox(id2)} .graph-audio-play`);
            await h.waitFor((pid) => (document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-part-body`).getAttribute('data-playing') === 'true' ? true : null), { args: [id2], timeout: 8000 });
            h.eq((await face(h, id)).playing, false, 'pressing ▶ on the second box stopped the first');
            // ■ stops it.
            await h.click(`${onBox(id2)} .graph-audio-play`);
            h.eq((await face(h, id2)).playing, false, '■ stops it');

            // Remove, then undo: the box forgets the file and gets it back, one undo entry.
            await h.click(`${onBox(id2)} .graph-audio-remove`);
            h.eq((await face(h, id2)).empty, true, 'Remove empties the box');
            await h.computer.undo();
            await h.waitFor((pid) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
                return p && p.settings.name === 'other.wav' ? true : null;
            }, { args: [id2], timeout: 5000 });

            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 0, 'keeping and playing sounds asks the farm nothing');
            h.eq((await h.mock.log({ path: '/ocr/process' })).length, 0, 'and sends it nothing');
        },
    },
    {
        name: 'k6-audio-a-wired-sound-box-says-why-it-is-not-sent-and-a-run-passes-on-its-name-and-length-as-text',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const id = await h.computer.add('audio');
            await h.computer.dropFiles([file('meeting.wav', 'audio/wav', wav(2))], null, onBox(id));
            await h.waitFor((pid) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
                return p && p.settings.fileId ? true : null;
            }, { args: [id], timeout: 10000 });

            // Unwired: the line says so.
            let takes = await h.computer.takes(id);
            h.eq(takes.kind, 'audio');
            h.eq(takes.state, 'unwired');

            // Wired into an Instruction on the mock's llama.cpp farm, whose models report nothing
            // about sound: no, with the sentence — never "the model cannot listen".
            const ask = await h.computer.add('ask');
            h.assert(await h.computer.wire(id, ask, 'in'), 'a Sound box wires into an Instruction');
            takes = await until(h, async () => {
                const x = await h.computer.takes(id);
                return x && x.state === 'no' ? x : null;
            }, 8000, 'the wired Sound box to say no');
            let v = await verdictOf(h, id);
            h.eq(v.why, 'audio-unreported', 'nobody SAID it can listen — which is not the same as "it cannot"');
            h.eq(takes.whyShown, true, 'the refusal is a visible sentence');
            h.eq(takes.why, v.reason, 'the box shows the resolver sentence');
            h.assert(/not sent/.test(takes.why), `and it says the sound is not sent: ${takes.why}`);

            // The farm switches to the Ollama engine: the line changes with no reload, and names the engine.
            await h.mock.state({ backend: { engine: 'ollama' } });
            await h.publishFarm();
            takes = await until(h, async () => {
                const x = await h.computer.takes(id);
                const now = await verdictOf(h, id);
                return x && now.why === 'engine-no-audio' && x.why === now.reason ? x : null;
            }, 8000, 'the Sound box to name the Ollama engine');
            v = await verdictOf(h, id);
            const engine = String(v.reason);
            h.assert(/Ollama/.test(engine), `the sentence names the engine: ${engine}`);
            // The box as a person sees it: the player, and the sentence under it, inside the box.
            const fits = await h.eval((pid) => {
                const box = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"]`);
                const body = box && box.querySelector('.graph-part-body');
                return body ? { scroll: body.scrollHeight, client: body.clientHeight } : null;
            }, id);
            h.assert(!!fits, 'the box is drawn');
            // Side by side for the picture (both were placed centred by the menu).
            await h.computer.move(id, 40, 40);
            await h.computer.move(ask, 420, 40);
            await h.computer.call('fit');
            const shot = await h.screenshot('k6-audio-wired');
            if (shot) h.note(`screenshot ${shot} (body ${fits.scroll}/${fits.client} px)`);
            h.eq(takes.state, 'no');
            h.eq(takes.whyShown, true);

            // A run: the Sound box passes on TEXT; the farm receives text parts only.
            await h.computer.set(ask, { instruction: 'Summarise what was attached.' });
            const mark = Date.now();
            await h.computer.run({});
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 20000 });
            const parts = await h.eval(() => {
                /** @type {any} */ const out = {};
                for (const p of window.LolComputer.debug.computer.state().parts) out[p.id] = { state: p.state, error: p.error, value: p.value };
                return out;
            });
            h.eq(parts[id].state, 'done', `the Sound box ran: ${parts[id].error || ''}`);
            h.eq(parts[id].value.kind, 'text', 'what it passed on is text');
            const said = await str(h, 'parts.audioValue', { name: 'meeting.wav', duration: '0:02', mb: '0.0', why: engine });
            h.eq(parts[id].value.data, said, 'its name, its length, and why the sound itself was not sent');
            h.eq(parts[ask].state, 'done', `the Instruction ran: ${parts[ask].error || ''}`);

            const posts = await h.mock.log({ path: COMPLETIONS, since: mark });
            h.eq(posts.length, 1, 'one generation');
            const body = await h.mock.lastBody();
            const user = [...body.messages].reverse().find((/** @type {any} */ m) => m.role === 'user');
            const content = Array.isArray(user.content) ? user.content : [{ type: 'text', text: String(user.content) }];
            h.eq(content.filter((/** @type {any} */ p) => p.type !== 'text').length, 0,
                `only text parts reached the farm: ${content.map((/** @type {any} */ p) => p.type).join(',')}`);
            const sent = content.map((/** @type {any} */ p) => p.text).join('\n');
            h.assert(sent.indexOf('meeting.wav') >= 0, 'the file\'s name went along as text');
            h.assert(sent.indexOf('UklGR') < 0, 'and the WAV bytes did not (no base64 RIFF anywhere)');
            const warnings = await h.mock.warnings();
            h.eq((Array.isArray(warnings) ? warnings : []).filter((/** @type {any} */ w) => /K6:/.test(String(w && (w.message || w)))).length, 0,
                'the mock saw no sound or file part');
            h.eq((await h.mock.log({ path: '/ocr/process' })).length, 0);
        },
    },
];
