// @ts-check
// K6-U3 (LOLCHAT_PLAN 2.6 KF-7): the canvas drop router, in the real window. Files are DROPPED on
// empty canvas with a real DragEvent carrying a real DataTransfer (build rule 6); each becomes the
// box that holds its kind, side by side, one undo entry per box — or is refused with a sentence the
// reader SEES (a toast) and hears (the canvas's live region). A PDF on a farm with no extractor is
// refused before anything is kept; with one it becomes a Document box — and nothing is sent to the
// farm on a drop either way.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** A valid 1x1 PNG (the smallest picture Chromium decodes). */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A mono 8-bit PCM WAV of silence. @param {number} seconds */
function wav(seconds) {
    const rate = 8000;
    const n = Math.round(seconds * rate);
    const b = Buffer.alloc(44 + n);
    b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii');
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28);
    b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(n, 40); b.fill(128, 44);
    return b;
}
const file = (/** @type {string} */ name, /** @type {string} */ mime, /** @type {Buffer|string} */ bytes) =>
    ({ name, mime, base64: (Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)).toString('base64') });
const PDF = () => file('paper.pdf', 'application/pdf', '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

/** A string as the page itself resolves it. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** The Computer, shown, an EMPTY document open, the real K6 doors installed, the mock clear. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    const doors = await h.eval(() => ({
        media: !!(window.LolComputer.app.media && window.LolComputer.app.media.put),
        drops: !!(window.LolComputer.app.drops && window.LolComputer.app.drops.route),
        intake: !!(window.LolComputer.app.intake && window.LolComputer.app.intake.fromFile),
        failed: Object.keys(window.LolComputer.failed || {}),
    }));
    if (!doors.media || !doors.drops || !doors.intake) throw new Error(`K6-U3 needs the real media, intake and drops doors; loader failed: ${doors.failed.join(', ')}`);
    const d = await h.computer.doc();
    if (d.parts.length) await h.computer.remove(d.parts.map((/** @type {any} */ p) => p.id));
    await h.mock.reset();
    await h.mock.state({ extract: null });
    await h.publishFarm();
    return true;
}

/** Wait until a toast saying exactly `want` is on screen. */
const toastSays = (/** @type {any} */ h, /** @type {string} */ want) => h.waitFor((w) => (
    Array.from(document.querySelectorAll('.chat-toast')).some((el) => el.textContent === w) ? true : null
), { args: [want], timeout: 8000 });
/** Wait until the router has finished `n` drops. */
const routed = (/** @type {any} */ h, /** @type {number} */ n) => h.waitFor((k) => {
    const d = window.LolComputer.app.drops.debug();
    return d.routed >= k && d.last ? d : null;
}, { args: [n], timeout: 15000 });
/** Wait until the document has `n` parts. */
const partsAre = (/** @type {any} */ h, /** @type {number} */ n) => h.waitFor((k) => {
    const parts = window.LolComputer.debug.computer.doc().parts;
    return parts.length === k ? parts : null;
}, { args: [n], timeout: 15000 });

export default [
    {
        name: 'k6-drops-a-picture-a-text-file-and-a-sound-dropped-on-the-canvas-become-their-boxes-and-an-exe-is-refused-in-words',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            h.eq((await h.computer.doc()).parts.length, 0, 'an empty canvas to drop onto');

            const out = await h.computer.dropFiles([
                file('shot.png', 'image/png', Buffer.from(PNG_1PX, 'base64')),
                file('notes.md', 'text/markdown', '# Plan\n\n- buy milk\n- call Sam\n'),
                file('memo.wav', 'audio/wav', wav(1)),
                file('setup.exe', 'application/x-msdownload', 'MZ\u0090\u0000binary'),
            ]);
            h.eq(out.defaultPrevented, true, 'the canvas took the drop');
            const parts = await partsAre(h, 3);
            const dbg = await routed(h, 1);
            h.eq(parts.map((/** @type {any} */ p) => p.type).join(','), 'image,note,audio', 'a picture → Image, a .md → Text, a .wav → Sound, in drop order');

            // What each box holds came through that kind's own door.
            const [img, txt, snd] = parts;
            h.assert(/^data:image\//.test(img.settings.dataUrl), 'the picture went through the intake into the Image box');
            h.eq(img.settings.name, 'shot.png');
            h.eq(txt.settings.text, '# Plan\n\n- buy milk\n- call Sam\n', 'the Text box holds the file\'s contents');
            h.eq(snd.settings.name, 'memo.wav');
            h.eq(snd.settings.durationSec, 1, 'the sound was decoded and measured');
            h.assert(!!snd.settings.fileId, 'and kept on this computer');

            // Laid out inside the view, never on top of each other.
            for (let i = 0; i < parts.length; i++) {
                for (let j = 0; j < i; j++) {
                    const a = parts[j];
                    const b = parts[i];
                    const apart = b.x >= a.x + a.w || a.x >= b.x + b.w || b.y >= a.y + a.h || a.y >= b.y + b.h;
                    h.assert(apart, `box ${i + 1} does not overlap box ${j + 1}: ${JSON.stringify([a.x, a.y, a.w, a.h, b.x, b.y])}`);
                }
            }

            // The .exe: refused, and SAID — on screen and in the live region.
            const why = await str(h, 'drops.refusedKind', { name: 'setup.exe', type: 'application/x-msdownload' });
            await toastSays(h, why);
            h.eq(await h.eval(() => window.LolComputer.app.host.canvas.said()), why, 'the live region says it too');
            h.eq(dbg.last.refused.length, 1);
            h.eq(dbg.last.refused[0].name, 'setup.exe');

            // The overlay says what a drop does now.
            h.eq(await h.eval(() => (document.querySelector('#lolcomputer .graph-drop-text') || {}).textContent), await str(h, 'drops.hint'),
                'the drop overlay names every kind it takes');

            // ONE undo entry per box: undo takes back the Sound box and nothing else.
            await h.computer.undo();
            const after = await partsAre(h, 2);
            h.eq(after.map((/** @type {any} */ p) => p.type).join(','), 'image,note');
            await h.computer.redo();
            await partsAre(h, 3);

            // A .csv and a .json that is not a graph: Text boxes with the contents.
            await h.computer.dropFiles([
                file('scores.csv', 'text/csv', 'name,score\nAda,9\n'),
                file('rows.json', 'application/json', '{"rows":[1,2,3]}'),
            ]);
            const five = await partsAre(h, 5);
            h.eq(five[3].type, 'note');
            h.eq(five[3].settings.text, 'name,score\nAda,9\n');
            h.eq(five[4].settings.text, '{"rows":[1,2,3]}');

            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'a drop asks the farm nothing');
            h.eq((await h.mock.log({ path: '/ocr/process' })).length, 0, 'and sends it nothing');
        },
    },
    {
        name: 'k6-drops-a-pdf-is-refused-when-the-farm-offers-no-extractor-and-becomes-a-document-box-when-it-does-with-nothing-sent',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const puts = await h.eval(() => window.LolComputer.app.media.debug().puts);

            // The mock farm is connected and advertises NO extractor: the PDF is refused, in words.
            await h.computer.dropFiles([PDF()]);
            const dbg = await routed(h, 1);
            // The sentence is the page's own resolver's (graph/takes.mjs; K6-U1 owns the words).
            const noOcr = await h.eval(async () => {
                const m = await import('../../renderer/chat/graph/takes.mjs');
                return m.reasonFor(m.WHY.noOcr, null);
            });
            h.assert(typeof noOcr === 'string' && noOcr.length > 20, `a real sentence: ${noOcr}`);
            h.eq(dbg.last.refused.length, 1, 'refused');
            h.eq(dbg.last.refused[0].reason, noOcr);
            await toastSays(h, noOcr);
            h.eq((await h.computer.doc()).parts.length, 0, 'no Document box');
            h.eq(await h.eval(() => window.LolComputer.app.media.debug().puts), puts, 'the bytes were not even kept');

            // The farm turns its extractor on: the same drop becomes a Document box holding the file.
            await h.computer.ocr(true);
            await h.waitFor(() => (window.LolComputer.app.farm.get().ocr ? true : null), { timeout: 8000 });
            await h.computer.dropFiles([PDF()]);
            const parts = await partsAre(h, 1);
            h.eq(parts[0].type, 'document', 'a PDF → a Document box');
            h.eq(parts[0].settings.name, 'paper.pdf');
            h.assert(!!parts[0].settings.fileId, 'holding the kept file');
            // Its "takes:" line says the farm will read it — when a run needs it, not now.
            await h.waitFor((pid) => {
                const el = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-takes`);
                return el && el.getAttribute('data-state') === 'yes' ? true : null;
            }, { args: [parts[0].id], timeout: 8000 });
            await h.sleep(300);
            h.eq((await h.mock.log({ path: '/ocr/process' })).length, 0, 'NOTHING is sent to the farm on a drop — the PDF is read only when a run needs it');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0);
        },
    },
];
