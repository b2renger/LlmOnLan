// @ts-check
// K6 landing: the phase photographed the way the owner will first meet it. Every box is placed by
// CLICKING the ＋ menu and every file arrives by a real DragEvent (build rule 6).
//  1. A Document box whose PDF the (mock) farm extractor has read on ▶, wired into an Instruction,
//     beside a wired Sound box that says why its sound is not sent — in both themes. Measured
//     before it is photographed: the extracted text is visible, stays inside its box and scrolls
//     inside it, and the two "takes:" lines sit inside their boxes.
//  2. Two refusals on a farm that advertises NO extractor: a PDF dropped on a Document box and a
//     program dropped on the canvas — each refusal a sentence on screen, and nothing sent anywhere.

import fs from 'node:fs';
import path from 'node:path';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const OCR = '/ocr/process';

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
const pdf = (/** @type {string} */ tag) => Buffer.from(`%PDF-1.4\n% LOL K6 landing ${tag}\n%%EOF\n`).toString('base64');
const body = (/** @type {string} */ id) => `#lolcomputer .graph-part[data-id="${id}"] .graph-part-body`;

const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

const settle = (/** @type {any} */ h) => h.eval(() => new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
}));

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
    const shot = await h.screenshot(name);
    h.assert(!!shot, name + ': no screenshot was produced');
    const size = fs.statSync(shot).size;
    h.assert(size > 4000, name + ': the screenshot is only ' + size + ' bytes');
    h.note('screenshot ' + path.basename(shot) + ' (' + size + ' bytes)');
}

/** The Computer shown, a fresh graph, the mock clear, the extractor advertised or not. */
async function open(/** @type {any} */ h, /** @type {boolean} */ ocr) {
    await h.fresh();
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();
    await h.mock.state({ ocrDelayMs: 0 });
    await h.computer.ocr(ocr);
    await h.waitFor((want) => {
        const f = window.LolComputer.app.farm.get();
        return f && f.present && !!(f.ocr && f.ocr.url) === want ? true : null;
    }, { args: [ocr], timeout: 8000 });
}

/** Where things are, measured: each box, its body, and what is inside it. */
const layout = (/** @type {any} */ h, /** @type {string[]} */ ids) => h.eval((list) => {
    const r = (/** @type {any} */ el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const out = {};
    for (const id of list) {
        const box = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"]`);
        const text = box && box.querySelector('.graph-doc-text');
        const takes = box && box.querySelector('.graph-takes');
        out[id] = {
            box: r(box),
            text: text && !text.hidden ? r(text) : null,
            textScrolls: !!text && text.scrollHeight > text.clientHeight,
            textOverflowY: text ? getComputedStyle(text).overflowY : '',
            takes: takes ? r(takes) : null,
            why: takes ? ((takes.querySelector('.graph-takes-why') || {}).textContent || '') : '',
        };
    }
    return out;
}, ids);

const inside = (/** @type {any} */ inner, /** @type {any} */ outer) =>
    !!inner && !!outer && inner.l >= outer.l - 1 && inner.t >= outer.t - 1 && inner.r <= outer.r + 1 && inner.b <= outer.b + 1;

export default [
    {
        name: 'k6-shots-a-pdf-read-on-the-farm-beside-a-sound-that-cannot-be-heard',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h, true);
            await h.mock.state({ ocrPages: 6 });

            const docId = await h.computer.add('document');
            h.assert(!!docId, '＋ → Document placed a box');
            await h.computer.move(docId, 40, 40);
            await h.computer.dropFiles([{ name: 'field-notes.pdf', mime: 'application/pdf', base64: pdf('A') }], null, body(docId));
            await h.waitFor((pid) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
                return p && p.settings && p.settings.fileId ? true : null;
            }, { args: [docId], timeout: 8000 });
            h.eq((await h.mock.log({ path: OCR })).length, 0, 'nothing is sent on drop');

            const sndId = await h.computer.add('audio');
            h.assert(!!sndId, '＋ → Sound placed a box');
            await h.computer.move(sndId, 40, 470);
            await h.computer.dropFiles([{ name: 'interview.wav', mime: 'audio/wav', base64: wav(2).toString('base64') }], null, body(sndId));
            await h.waitFor((pid) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
                return p && p.settings && p.settings.fileId ? true : null;
            }, { args: [sndId], timeout: 10000 });

            const askId = await h.computer.add('ask');
            await h.computer.move(askId, 460, 200);
            h.assert(await h.computer.wire(docId, askId, 'in'), 'the Document box wires into the Instruction');
            h.assert(await h.computer.wire(sndId, askId, 'in'), 'the Sound box wires into the Instruction');

            await h.computer.run();
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 30000 });
            h.eq((await h.mock.log({ path: OCR })).length, 1, 'one extraction, on run');
            await h.waitFor((pid) => {
                const el = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-doc-text`);
                return el && !el.hidden && /Page 6 of field-notes\.pdf/.test(el.textContent || '') ? true : null;
            }, { args: [docId], timeout: 8000 });

            await h.computer.call('fit');
            await settle(h);
            try {
                for (const theme of ['dark', 'light']) {
                    await h.eval((t) => { document.documentElement.className = t; return true; }, theme);
                    await settle(h);
                    const m = await layout(h, [docId, sndId]);
                    const d = m[docId];
                    const s = m[sndId];
                    h.assert(inside(d.text, d.box), `${theme}: the extracted text stays inside its box: ${JSON.stringify(d)}`);
                    h.assert(d.text && d.text.h >= 60, `${theme}: the extracted text has room to be read: ${JSON.stringify(d.text)}`);
                    h.assert(d.textScrolls && /auto|scroll/.test(d.textOverflowY), `${theme}: six pages scroll inside the box (${d.textOverflowY})`);
                    h.assert(inside(d.takes, d.box), `${theme}: the Document's "takes:" line is inside its box`);
                    h.assert(inside(s.takes, s.box), `${theme}: the Sound's "takes:" line is inside its box: ${JSON.stringify(s)}`);
                    h.assert(s.why.length > 20, `${theme}: the Sound box says why nothing is sent: ${s.why}`);
                    await shoot(h, `k6-shots-document-${theme}`);
                }
            } finally {
                await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            }
            const sent = JSON.stringify(await h.mock.lastBody());
            h.assert(!/input_audio|"type":"file"/.test(sent), 'only text reached the model');
        },
    },

    {
        name: 'k6-shots-refusals-are-sentences-on-screen',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h, false);
            const docId = await h.computer.add('document');
            await h.computer.move(docId, 40, 40);
            await h.computer.dropFiles([{ name: 'report.pdf', mime: 'application/pdf', base64: pdf('B') }], null, body(docId));
            const noOcr = await h.eval(() => window.LolComputer.app.t('takes.whyNoOcr'));
            const note = await h.waitFor((pid) => {
                const el = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-doc-note`);
                return el && !el.hidden && (el.textContent || '').length > 20 ? el.textContent : null;
            }, { args: [docId], timeout: 8000 });
            h.eq(note, await str(h, 'parts.docRefusedNoOcr', { name: 'report.pdf' }), 'the Document box names the refused file');
            const line = await h.computer.takes(docId);
            h.eq(line.why, noOcr, "the takes line says why, in the farm's sentence");
            h.eq(line.whyShown, true);
            h.assert(note !== line.why, 'the same sentence is not said twice on one box');
            const kept = await h.eval((pid) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
                return !!(p && p.settings && p.settings.fileId);
            }, docId);
            h.eq(kept, false, 'a farm with no extractor: the PDF is refused and nothing is kept');

            await h.computer.dropFiles([{ name: 'setup.exe', mime: 'application/x-msdownload', base64: Buffer.from('MZ program bytes').toString('base64') }]);
            const why = await str(h, 'drops.refusedKind', { name: 'setup.exe', type: 'application/x-msdownload' });
            await h.waitFor((w) => (Array.from(document.querySelectorAll('.chat-toast')).some((el) => el.textContent === w) ? true : null),
                { args: [why], timeout: 8000 });
            const vis = await h.eval(() => {
                const t = document.querySelector('.chat-toast');
                const z = document.querySelector('#lolcomputer .graph-drop');
                const b = t ? t.getBoundingClientRect() : null;
                return { toast: b ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null, vw: innerWidth, vh: innerHeight, overlay: !!z && !z.hidden };
            });
            h.assert(vis.toast && vis.toast.l >= 0 && vis.toast.t >= 0 && vis.toast.r <= vis.vw && vis.toast.b <= vis.vh,
                `the refusal toast is whole on screen: ${JSON.stringify(vis)}`);
            h.eq(vis.overlay, false, 'the drop overlay is gone after the drop');
            await shoot(h, 'k6-shots-refused-drop');
            h.eq((await h.mock.log({ path: OCR })).length, 0, 'nothing went to the extractor');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'nothing went to a model');
        },
    },
];
