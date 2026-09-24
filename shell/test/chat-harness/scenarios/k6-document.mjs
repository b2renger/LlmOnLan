// @ts-check
// K6-U2 in the real browser: the Document (PDF) box (LOLCHAT_PLAN 2.6 KF-5), reached the way a
// person reaches it (build rule 6) — the box is placed by CLICKING the ＋ menu, a PDF is DROPPED on
// it with a real DragEvent (or chosen through a real file input, or pasted), and every refusal is
// read off the screen. What only a browser can answer is here: that the bytes really stay local
// until a run, that the farm's extractor gets exactly one PUT with the key and the name, that the
// text really flows on to an Instruction, and that Stop and the page cap say what happened. The
// arithmetic (the cut, the queue, the error table) is `chat-unit computer-document`'s.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const OCR = '/ocr/process';
const COMPLETIONS = '/v1/chat/completions';

/** Bytes that are a PDF as far as the box can tell: the signature, and a body that makes each
 * file's hash its own. */
const pdfB64 = (/** @type {string} */ tag) => Buffer.from(`%PDF-1.4\n% LOL K6 test document ${tag}\n%%EOF\n`).toString('base64');

/** Poll a NODE-side async check (h.waitFor runs its function in the page). */
async function until(/** @type {any} */ h, /** @type {() => Promise<any>} */ fn, /** @type {number} */ ms, /** @type {string} */ what) {
    const end = Date.now() + ms;
    let last = null;
    while (Date.now() < end) {
        last = await fn();
        if (last) return last;
        await h.sleep(80);
    }
    throw new Error(`timed out after ${ms} ms waiting for ${what}; last: ${JSON.stringify(last)}`);
}

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** The Computer, shown, with a document open, the mock's log clear and OCR as asked. */
async function open(/** @type {any} */ h, /** @type {boolean} */ ocr) {
    await h.fresh();
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.eval(() => {
        const failed = (window.LolComputer && window.LolComputer.failed) || {};
        if (failed.media) throw new Error(`the media feature failed to load: ${failed.media.error}`);
        if (!window.LolComputer.app.media) throw new Error('app.media was never installed');
        return true;
    });
    await h.mock.reset();
    await h.mock.state({ ocrDelayMs: 0 });
    await h.computer.ocr(ocr);
    // The snapshot reaches the renderer on the farm's own schedule: wait until the app sees it.
    await until(h, () => h.eval((want) => {
        const f = window.LolComputer.app.farm.get();
        return !!(f && f.present) && !!(f.ocr && f.ocr.url) === want ? true : null;
    }, ocr), 8000, `the app to see the extractor ${ocr ? 'advertised' : 'withdrawn'}`);
    return true;
}

/** What a Document box shows, read off the screen. */
const shows = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const box = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"]`);
    if (!box) return null;
    const pick = (sel) => box.querySelector(sel);
    const vis = (sel) => { const el = pick(sel); return !!el && !el.hidden && el.getClientRects().length > 0; };
    const txt = (sel) => { const el = pick(sel); return el ? el.textContent : ''; };
    const note = pick('.graph-doc-note');
    return {
        empty: vis('.graph-doc-empty'),
        name: txt('.graph-doc-name'),
        meta: txt('.graph-doc-meta'),
        note: vis('.graph-doc-note') ? txt('.graph-doc-note') : '',
        noteState: note ? note.getAttribute('data-state') : null,
        cut: vis('.graph-doc-cut') ? txt('.graph-doc-cut') : '',
        text: vis('.graph-doc-text') ? txt('.graph-doc-text') : '',
        italic: !!box.querySelector('.graph-doc-text em'),
    };
}, id);

/** One part of the open document. */
const partOf = async (/** @type {any} */ h, /** @type {string} */ id) =>
    (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === id) || null;

/** The run state of a part, as the canvas holds it. */
const stateOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const p = window.LolComputer.debug.computer.state().parts.find((x) => x.id === pid);
    return p ? { state: p.state, error: p.error, value: p.value } : null;
}, id);

/** Wait until no run is going. */
const settled = (/** @type {any} */ h) => h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 20000 });

/** Drop one PDF ON a box's body, the way a person does. */
const dropOn = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ b64, mime = 'application/pdf') =>
    h.computer.dropFiles([{ name, mime, base64: b64 }], null, `#lolcomputer .graph-part[data-id="${id}"] .graph-doc`);

/** Wait until a box holds a file. */
const held = (/** @type {any} */ h, /** @type {string} */ id) => until(h, async () => {
    const p = await partOf(h, id);
    return p && p.settings && p.settings.fileId ? p.settings : null;
}, 8000, `box ${id} to hold a file`);

export default [
    {
        name: 'k6-document-a-pdf-dropped-on-its-box-stays-here-until-a-run-reads-it-on-the-farm-once',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h, true);
            const docId = await h.computer.add('document');
            h.assert(!!docId, 'clicking "Document" in the ＋ menu placed a box');
            let seen = await shows(h, docId);
            h.eq(seen.empty, true, 'an empty box invites a drop');
            h.eq((await h.computer.takes(docId)).state, 'yes', 'this farm reads documents, and the box says so');

            // DROP: kept here, and NOTHING goes to the farm.
            const bytes = pdfB64('A');
            const out = await dropOn(h, docId, 'pages-3.pdf', bytes);
            h.eq(out.defaultPrevented, true, 'the box took the drop');
            const s = await held(h, docId);
            h.eq(s.name, 'pages-3.pdf');
            h.eq(s.mime, 'application/pdf');
            h.assert(/^[0-9a-f]{64}$/.test(s.sha256), 'the reference carries the content hash');
            h.eq(s.size, Buffer.from(bytes, 'base64').length);
            seen = await until(h, async () => { const x = await shows(h, docId); return x && x.note ? x : null; }, 5000, 'the kept note');
            h.eq(seen.name, 'pages-3.pdf', 'the file is named on the box');
            h.eq(seen.note, await str(h, 'parts.docKept'), 'the box promises nothing was sent');
            h.eq((await h.mock.log({ path: OCR })).length, 0, 'NOTHING IS SENT ON DROP');
            h.eq(await h.computer.exportText({}).then((t) => String(t).includes(bytes)), false, 'the graph file never carries the bytes');

            // RUN: one PUT to the extractor; the text flows on to the Instruction as text.
            const askId = await h.computer.add('ask');
            h.assert(await h.computer.wire(docId, askId, 'in'), 'a Document box wires into an Instruction');
            await h.computer.run();
            await settled(h);
            const log = await h.mock.log({ path: OCR });
            h.eq(log.length, 1, 'one extraction');
            h.eq(log[0].headers.authorization, 'Bearer mock-extract-key', 'with the farm\'s key');
            h.eq(log[0].headers['x-filename'], 'pages-3.pdf', 'and the file\'s name');
            h.eq(log[0].headers['content-type'], 'application/pdf');
            h.eq(log[0].bytes, Buffer.from(bytes, 'base64').length, 'the exact bytes');
            const doc = await stateOf(h, docId);
            h.eq(doc.state, 'done', `the Document box finished: ${doc.error || ''}`);
            h.eq(doc.value.kind, 'text');
            h.eq(doc.value.format, 'markdown');
            seen = await until(h, async () => { const x = await shows(h, docId); return x && x.text ? x : null; }, 5000, 'the extracted text in the box');
            h.assert(/Page 2 of pages-3\.pdf/.test(seen.text), `the box shows what the farm read: ${seen.text.slice(0, 120)}`);
            h.eq(seen.cut, '', 'three pages are not cut');
            h.assert(/3 pages read/.test(seen.meta), `the head says how many pages: ${seen.meta}`);
            const body = JSON.stringify(await h.mock.lastBody());
            h.assert(/Page 3 of pages-3\.pdf/.test(body), 'the text reached the Instruction\'s request as TEXT');
            h.assert(!/input_audio|"type":"file"/.test(body), 'and nothing but text and pictures went with it');
            const warned = ((await h.mock.warnings()) || []).filter((/** @type {any} */ w) => /K6:/.test(String(w && (w.message || w))));
            h.eq(warned.length, 0, 'the mock saw no stray content part');

            // A SECOND box with the same bytes (another name): the cache answers, the farm is not asked.
            const twinId = await h.computer.add('document');
            await dropOn(h, twinId, 'renamed-copy.pdf', bytes);
            const twin = await held(h, twinId);
            h.eq(twin.fileId, s.fileId, 'the same content is the same file on this computer');
            await h.computer.runFrom(twinId);
            await settled(h);
            h.eq((await stateOf(h, twinId)).state, 'done');
            h.eq((await h.mock.log({ path: OCR })).length, 1, 'the same bytes are never sent twice');
            seen = await until(h, async () => { const x = await shows(h, twinId); return x && x.text ? x : null; }, 5000, 'the twin\'s text');
            h.assert(/Page 1 of pages-3\.pdf/.test(seen.text), 'the twin shows the cached text');
        },
    },
    {
        name: 'k6-document-a-farm-that-reads-no-documents-gets-a-sentence-and-nothing-is-sent',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h, false);
            const noOcr = await h.eval(() => window.LolComputer.app.t('takes.whyNoOcr'));
            const docId = await h.computer.add('document');
            h.eq((await h.computer.takes(docId)).state, 'no', 'the box says, before any drop, that this farm reads no documents');

            // Dropped anyway: refused on screen, kept nowhere.
            await dropOn(h, docId, 'refused.pdf', pdfB64('R'));
            let seen = await until(h, async () => { const x = await shows(h, docId); return x && x.note ? x : null; }, 5000, 'the refusal');
            h.eq(seen.note, await str(h, 'parts.docRefusedNoOcr', { name: 'refused.pdf' }), 'the refusal names the file and what happened');
            const line = await h.computer.takes(docId);
            h.eq(line.why, noOcr, 'the why, and who can change it, is the takes line right above');
            h.eq(line.whyShown, true);
            h.eq(seen.noteState, 'error');
            h.eq((await partOf(h, docId)).settings.fileId, '', 'nothing was kept');
            h.eq(await h.eval(() => window.LolComputer.app.media.debug().puts), 0, 'not even locally');

            // Not a PDF at all: its own sentence, naming the file and its type.
            await dropOn(h, docId, 'notes.txt', Buffer.from('plain words').toString('base64'), 'text/plain');
            seen = await until(h, async () => { const x = await shows(h, docId); return x && /notes\.txt/.test(x.note) ? x : null; }, 5000, 'the not-a-PDF sentence');
            h.eq(seen.note, await str(h, 'parts.docNotAPdf', { name: 'notes.txt', type: 'text/plain' }));

            // The farm starts reading documents → kept. It stops again → the run refuses, zero requests.
            await h.computer.ocr(true);
            await until(h, async () => ((await h.computer.takes(docId)).state === 'yes' ? true : null), 8000, 'the line to flip to yes');
            await dropOn(h, docId, 'kept.pdf', pdfB64('K'));
            await held(h, docId);
            await h.computer.ocr(false);
            await until(h, async () => ((await h.computer.takes(docId)).state === 'no' ? true : null), 8000, 'the line to flip back');
            await h.computer.runFrom(docId);
            await settled(h);
            const st = await stateOf(h, docId);
            h.eq(st.state, 'error', 'a run with no extractor fails the box');
            h.eq(st.error, noOcr, 'with the same sentence');
            h.eq((await h.mock.log({ path: OCR })).length, 0, 'and NOT ONE request reached the farm');
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 0);
        },
    },
    {
        name: 'k6-document-a-long-pdf-says-first-60-of-120-pages-and-stop-caches-nothing',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h, true);

            // 120 pages: 60 flow on, and both the box and the value say so.
            const longId = await h.computer.add('document');
            await dropOn(h, longId, 'pages-120.pdf', pdfB64('L'));
            await held(h, longId);
            await h.computer.runFrom(longId);
            await settled(h);
            const st = await stateOf(h, longId);
            h.eq(st.state, 'done', `read: ${st.error || ''}`);
            const note = await str(h, 'parts.docCutPages', { shown: 60, total: 120 });
            h.assert(String(st.value.data).startsWith(`*${note}*`), 'the value tells the next box it was cut, first');
            h.assert(/Page 60 of pages-120/.test(st.value.data) && !/Page 61 of pages-120/.test(st.value.data), 'pages 1-60 and nothing after');
            const seen = await until(h, async () => { const x = await shows(h, longId); return x && x.cut ? x : null; }, 5000, 'the cut line');
            h.eq(seen.cut, note, 'the box says "first 60 of 120 pages"');
            h.assert(/First 60 of 120 pages/.test(seen.cut));
            h.eq(seen.italic, true, 'the note inside the text is rendered markdown (nodes, not tags)');

            // Stop while the farm is reading: the box said so while it waited, and nothing is cached.
            await h.mock.state({ ocrDelayMs: 1000 });
            const slowId = await h.computer.add('document');
            await dropOn(h, slowId, 'pages-4.pdf', pdfB64('S'));
            await held(h, slowId);
            const reading = await str(h, 'parts.docReading', { name: 'pages-4.pdf' });
            // The box's own ▶, clicked: it returns at once, so the line can be read while it waits.
            await h.computer.play(slowId);
            await until(h, async () => ((await shows(h, slowId)).note === reading ? true : null), 5000, 'the "reading on the farm" line');
            await h.computer.stop();
            await settled(h);
            const stopped = await stateOf(h, slowId);
            h.assert(stopped.state !== 'done' && stopped.state !== 'error', `Stop is not a failure (state ${stopped.state})`);
            h.eq((await shows(h, slowId)).note === reading, false, 'nobody says "reading" after Stop');
            h.eq((await h.mock.log({ path: OCR })).filter((/** @type {any} */ e) => e.headers['x-filename'] === 'pages-4.pdf').length, 1);
            await h.mock.state({ ocrDelayMs: 0 });
            await h.computer.runFrom(slowId);
            await settled(h);
            h.eq((await stateOf(h, slowId)).state, 'done');
            h.eq((await h.mock.log({ path: OCR })).filter((/** @type {any} */ e) => e.headers['x-filename'] === 'pages-4.pdf').length, 2,
                'a stopped read was not cached: the next run asked again');
        },
    },
    {
        name: 'k6-document-choose-or-paste-a-pdf-into-the-box',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h, true);
            const docId = await h.computer.add('document');

            // CHOOSE: clicking the empty box opens a real <input type=file>; the dialog is the OS's,
            // so its answer is the one thing stood in for — through the input's own `files`.
            const chosen = pdfB64('C');
            await h.eval((b64) => {
                const real = HTMLInputElement.prototype.click;
                HTMLInputElement.prototype.click = function click() {
                    if (this.type !== 'file') return real.call(this);
                    HTMLInputElement.prototype.click = real;
                    window.__k6accept = this.accept;
                    const bin = atob(b64);
                    const u8 = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                    const dt = new DataTransfer();
                    dt.items.add(new File([u8], 'chosen.pdf', { type: 'application/pdf' }));
                    this.files = dt.files;
                    this.dispatchEvent(new Event('change'));
                    return undefined;
                };
                return true;
            }, chosen);
            await h.eval((pid) => { document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-doc-empty`).click(); return true; }, docId);
            const s = await held(h, docId);
            h.eq(s.name, 'chosen.pdf', 'the picked file is kept');
            h.assert(/application\/pdf/.test(await h.eval(() => window.__k6accept)), 'the picker offers PDFs');

            // PASTE: the box focused, a PDF on the clipboard → Replace, one undoable edit.
            await h.eval((pid) => {
                const box = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"]`);
                box.focus();
                const dt = new DataTransfer();
                dt.items.add(new File([new TextEncoder().encode('%PDF-1.5\n% pasted\n')], 'pasted.pdf', { type: 'application/pdf' }));
                box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
                return true;
            }, docId);
            const p = await until(h, async () => {
                const x = await partOf(h, docId);
                return x && x.settings.name === 'pasted.pdf' ? x.settings : null;
            }, 8000, 'the pasted PDF');
            h.assert(p.fileId !== s.fileId, 'a different file');
            await h.computer.undo();
            h.eq((await partOf(h, docId)).settings.name, 'chosen.pdf', 'Undo brings the chosen one back');
            h.eq((await h.mock.log({ path: OCR })).length, 0, 'choosing and pasting send nothing');
        },
    },
    {
        // The canvas's drop router is K6-U3's (computer/drops.mjs); what this unit owns is that the
        // box it places, with `adopt()` of what app.media kept, is a working Document box.
        name: 'k6-document-a-pdf-dropped-on-the-canvas-becomes-a-document-box-that-reads-on-run',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h, true);
            const before = (await h.computer.doc()).parts.length;
            const out = await h.computer.dropFiles([{ name: 'pages-2.pdf', mime: 'application/pdf', base64: pdfB64('canvas') }]);
            h.eq(out.defaultPrevented, true, 'the canvas took the drop');
            const box = await until(h, async () => {
                const d = await h.computer.doc();
                const p = d.parts.find((/** @type {any} */ x) => x.type === 'document');
                return p && p.settings.fileId ? p : null;
            }, 8000, 'a Document box holding the dropped PDF');
            h.eq((await h.computer.doc()).parts.length, before + 1, 'one box for one file');
            h.eq(box.settings.name, 'pages-2.pdf');
            const seen = await until(h, async () => { const x = await shows(h, box.id); return x && x.note ? x : null; }, 5000, 'the placed box to paint');
            h.eq(seen.note, await str(h, 'parts.docKept'), 'the placed box says it is kept and nothing was sent');
            h.eq((await h.mock.log({ path: OCR })).length, 0, 'NOTHING IS SENT ON DROP');
            await h.computer.runFrom(box.id);
            await settled(h);
            h.eq((await stateOf(h, box.id)).state, 'done');
            h.eq((await h.mock.log({ path: OCR })).length, 1, 'read once, on the run');
        },
    },
];
