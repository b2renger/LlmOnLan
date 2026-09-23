// @ts-check
// K4-U2 in the real browser: a picture that really enters the Computer, and really reaches the
// farm (COMPUTER_PLAN §6.4, addendum KD-5).
//
// What only a browser can answer is here, and nothing else is:
//   - the intake pipeline is REAL — createImageBitmap, OffscreenCanvas, convertToBlob and
//     FileReader are Chromium's, not a fake, so the numbers a picture comes out at and the fact
//     that it comes out at all are proven against the engine that ships.
//   - the bytes reach the farm as an `image_url` part and NOT as text in the prompt, asserted
//     against `GET /mock/last-body` (the raw request) and against `mock-vision-echo`, which
//     answers with what it received.
//   - a farm that cannot see refuses BEFORE any request goes out.
// The arithmetic (fitWithin's golden numbers, the ladder, every refusal sentence, the part's run
// rules) belongs to `chat-unit computer-intake` and is not repeated here.

const COMPLETIONS = '/v1/chat/completions';
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when the surface this unit decorates was faked or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host', 'ask', 'intake'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`K4-U2 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    if (!window.LolComputer.app.intake) throw new Error('app.intake was never installed');
    return true;
});

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** The Computer, shown, with a document open and the mock's log clear. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null));
    await h.mock.reset();
    return true;
}

/** Every part, by id. */
const parts = (/** @type {any} */ h) => h.eval(() => {
    const out = {};
    for (const p of window.LolComputer.debug.computer.state().parts) {
        out[p.id] = { type: p.type, state: p.state, error: p.error, value: p.value, settings: p.settings };
    }
    return out;
});

/** Wait until a run has finished. */
const settled = (/** @type {any} */ h) => h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 20000 });

/** A REAL picture file, painted in the page: `w` x `h` PNG with two blocks of colour, so a JPEG
 * of it is neither empty nor pathologically compressible. Nothing is fetched and nothing is
 * downloaded — the bytes are made here. */
const paintFile = (/** @type {any} */ h, /** @type {number} */ w, /** @type {number} */ h2, /** @type {string} */ name) =>
    h.eval((width, height, fileName) => new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#204080';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#e0b020';
        ctx.fillRect(0, 0, Math.round(width / 2), Math.round(height / 2));
        canvas.toBlob((blob) => {
            if (!blob) { reject(new Error('the page could not paint a picture')); return; }
            const file = new File([blob], fileName, { type: 'image/png' });
            window.__k4file = file;
            resolve({ name: file.name, type: file.type, size: file.size });
        }, 'image/png');
    }), w, h2, name);

/** A small, valid JPEG data URL, made by the same door the intake uses — what a box HOLDS. */
const heldPicture = (/** @type {any} */ h, /** @type {number} */ w, /** @type {number} */ height) =>
    h.eval(async (width, tall) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = tall;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#307030';
        ctx.fillRect(0, 0, width, tall);
        const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.8));
        const url = await new Promise((done) => {
            const reader = new FileReader();
            reader.onload = () => done(String(reader.result || ''));
            reader.readAsDataURL(blob);
        });
        return { dataUrl: url, name: 'held.jpg', w: width, h: tall };
    }, w, height);

export default [
    {
        // The pipeline itself, against Chromium's own decoder and encoder.
        name: 'k4-vision-the-intake-really-resizes-re-encodes-and-refuses',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);

            const made = await paintFile(h, 2000, 1000, 'holiday.png');
            h.assert(made.size > 0, `the page painted a ${made.size}-byte PNG`);

            const out = await h.eval(() => window.LolComputer.app.intake.fromFile(window.__k4file));
            h.assert(!out.error, `the real pipeline read it: ${out.error || ''}`);
            h.eq(out.w, 1536, 'the long side came down to MAX_EDGE');
            h.eq(out.h, 768, '…and the aspect ratio survived it');
            h.eq(out.name, 'holiday.png', 'the name is kept');
            h.assert(String(out.dataUrl).startsWith('data:image/jpeg;base64,'),
                `a PNG is re-encoded as JPEG, which is also what strips EXIF: ${String(out.dataUrl).slice(0, 32)}`);
            h.assert(out.dataUrl.length < 1024 * 1024,
                `the picture fits what a value may carry: ${Math.round(out.dataUrl.length / 1024)} KB`);

            // A file that is not a picture never reaches the decoder, and says so in one sentence.
            const refused = await h.eval(() => window.LolComputer.app.intake.fromFile(
                new File(['# not a picture'], 'notes.md', { type: 'text/markdown' })));
            h.eq(refused.error, await str(h, 'parts.imageNotAnImage', { type: 'text/markdown' }),
                'the refusal names the type it got');

            const debug = await h.eval(() => window.LolComputer.app.intake.debug());
            h.eq(debug.reads, 1, 'one picture read');
            h.eq(debug.refused, 1, 'one refusal, counted');
            h.note(`intake: 2000x1000 PNG -> ${out.w}x${out.h} JPEG, ${Math.round(out.dataUrl.length / 1024)} KB`);
        },
    },

    {
        // The whole point of the part: a picture wired into an Instruction is SEEN.
        name: 'k4-vision-a-wired-picture-reaches-the-farm-as-an-image-part',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const held = await heldPicture(h, 64, 48);

            const box = await h.computer.place('image', 60, 120);
            await h.computer.set(box, held);
            const ins = await h.computer.place('ask', 460, 120);
            await h.computer.wire(box, ins, 'in');
            await h.computer.set(ins, { instruction: 'what is in this picture?', model: 'mock-vision-echo' });

            const mark = Date.now();
            await h.computer.run({});
            await settled(h);

            const live = await parts(h);
            h.eq(live[box].state, 'done', `the Image box ran: ${live[box].error || ''}`);
            h.eq(live[box].value.kind, 'image', 'and what it passed on is an image value');
            h.eq(live[ins].state, 'done', `the Instruction ran: ${live[ins].error || ''}`);

            // The model reports what it received, so the ANSWER is the assertion.
            const lines = String(live[ins].value.data).split('\n').filter(Boolean);
            const said = Object.fromEntries(lines.map((l) => l.split(': ')).map(([k, v]) => [k, v]));
            h.eq(said.images, '1', `exactly one picture arrived at the farm: ${JSON.stringify(lines)}`);
            h.eq(said.mimes, 'image/jpeg', 'as the JPEG the intake made');

            // …and the RAW request agrees: an image_url part, and no base64 anywhere in the text.
            const posts = await h.mock.log({ path: COMPLETIONS, since: mark });
            h.eq(posts.length, 1, 'one generation, not two');
            const body = await h.mock.lastBody();
            const user = [...body.messages].reverse().find((m) => m.role === 'user');
            h.assert(Array.isArray(user.content), 'the user message is a PARTS array, not a string');
            const kinds = user.content.map((p) => p.type);
            h.eq(kinds.filter((k) => k === 'image_url').length, 1, `one image_url part: ${kinds.join(',')}`);
            const picture = user.content.find((p) => p.type === 'image_url');
            h.eq(picture.image_url.url, held.dataUrl, 'byte for byte the picture the box held');
            const text = user.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
            h.assert(text.indexOf('base64') < 0, 'an image is never pasted into the prompt as text (§5.3)');
            h.assert(text.indexOf('what is in this picture?') >= 0, 'the instruction itself did go out');
        },
    },

    {
        // §6.3: a farm that cannot see is refused BEFORE the request, with the real Image part in
        // the graph rather than a hand-made value.
        name: 'k4-vision-a-blind-farm-is-refused-before-the-request',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            await h.waitFor(() => (window.LolComputer.app.ask.vision('assistant') === 'no' ? true : null));
            const held = await heldPicture(h, 32, 32);

            const box = await h.computer.place('image', 60, 120);
            await h.computer.set(box, held);
            const ins = await h.computer.place('ask', 460, 120);
            await h.computer.wire(box, ins, 'in');
            await h.computer.set(ins, { instruction: 'describe it', model: 'assistant' });

            const mark = Date.now();
            await h.computer.run({});
            await settled(h);

            const live = await parts(h);
            h.eq(live[ins].state, 'error', 'a blind farm is a hard error, never a silent text-only answer');
            h.eq(live[ins].error, await str(h, 'parts.errNoVision', { alias: 'assistant' }),
                'and the sentence names the model the farm is serving');
            const posts = await h.mock.log({ path: COMPLETIONS, since: mark });
            h.eq(posts.length, 0, 'nothing was generated to find this out');
        },
    },

    {
        // The owner's promise, in the graph: a run adopts what arrives and never rewrites the
        // picture the person put in the box.
        name: 'k4-vision-an-arrival-is-adopted-and-the-held-picture-survives-it',
        needsMock: false,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const first = await heldPicture(h, 48, 24);
            const second = await heldPicture(h, 24, 48);
            h.assert(first.dataUrl !== second.dataUrl, 'two different pictures');

            const source = await h.computer.place('image', 60, 120);
            await h.computer.set(source, first);
            const sink = await h.computer.place('image', 420, 120);
            await h.computer.set(sink, second);
            await h.computer.wire(source, sink, 'file');

            await h.computer.run({});
            await settled(h);

            const live = await parts(h);
            h.eq(live[sink].state, 'done', `the second box ran: ${live[sink].error || ''}`);
            h.eq(live[sink].value.data.dataUrl, first.dataUrl, 'it passed on what arrived');
            h.eq(live[sink].settings.dataUrl, second.dataUrl,
                'and the picture someone dropped in is still there: a run never rewrites the program');

            // What the box DRAWS is the arrival, and it says where it came from.
            const badge = await h.eval((id) => {
                const el = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-image-badge`);
                const shot = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-image-shot`);
                return { badge: el && !el.hidden ? el.textContent : null, src: shot ? shot.getAttribute('src') : null };
            }, sink);
            h.eq(badge.badge, await str(h, 'parts.imageFromInput'), 'the box says the picture came off the wire');
            h.eq(badge.src, first.dataUrl, 'and shows it');
        },
    },

    {
        // The paste door: one keystroke, one Image box, one undoable edit.
        name: 'k4-vision-a-pasted-picture-lands-in-an-image-box',
        needsMock: false,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            await paintFile(h, 200, 100, 'pasted.png');

            const before = await h.eval(() => window.LolComputer.debug.computer.doc().parts.length);
            const carried = await h.eval(() => {
                const dt = new DataTransfer();
                dt.items.add(window.__k4file);
                const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                const surface = document.getElementById('lolcomputer');
                // Chromium refuses a synthetic clipboardData in some builds; say so rather than
                // asserting on an event that carried nothing.
                const ok = !!(ev.clipboardData && ev.clipboardData.files && ev.clipboardData.files.length);
                if (ok) surface.dispatchEvent(ev);
                return ok;
            });
            h.assert(carried, 'the synthetic paste really carried the file');

            await h.waitFor(() => {
                const doc = window.LolComputer.debug.computer.doc();
                const box = doc.parts.find((p) => p.type === 'image' && p.settings && p.settings.dataUrl);
                return box ? true : null;
            }, { timeout: 10000 });

            const after = await h.eval(() => {
                const doc = window.LolComputer.debug.computer.doc();
                const box = doc.parts.find((p) => p.type === 'image' && p.settings && p.settings.dataUrl);
                return { parts: doc.parts.length, settings: box.settings, id: box.id };
            });
            h.eq(after.parts, before + 1, 'one new box, placed where the canvas is looking');
            h.eq(after.settings.name, 'pasted.png', 'named after the file');
            h.eq(after.settings.w, 200, 'a small picture is not enlarged');
            h.eq(after.settings.h, 100);
            h.assert(String(after.settings.dataUrl).startsWith('data:image/jpeg;base64,'), 'and it went through the one intake');

            // One undoable edit for the settings write: undo takes the picture off, not the box.
            await h.computer.undo();
            const undone = await h.eval((id) => {
                const part = window.LolComputer.debug.computer.doc().parts.find((p) => p.id === id);
                return part ? String(part.settings.dataUrl || '') : 'gone';
            }, after.id);
            h.eq(undone, '', 'the paste is one undo away');
        },
    },
];
