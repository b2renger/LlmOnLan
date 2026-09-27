// @ts-check
// K6-U1 in the real browser (LOLCHAT_PLAN 2.6 KF-2, KF-3): a box says what it can pass on, from
// what the farm REALLY said about the models it is wired to — reached the way a person reaches it.
// The Image box comes from the ＋ menu, the picture is DROPPED on it with a real DragEvent, the
// Instruction comes from the ＋ menu and its model is chosen in its own picker. What is asserted
// is what is on screen: the "takes:" line's state, its sentence (visible, inside the box), and
// the Instruction's model line.
//
// The resolver's whole table is pinned in Node (chat-unit computer-takes); what only a browser can
// answer is here: that the mock farm's /model_group/info reaches the line through the real probe,
// that a catalogue read repaints a canvas it was not emitted on (the Computer shares the chat's
// caps install but not its bus), and that nothing here costs a generation or an upload.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const COMPLETIONS = '/v1/chat/completions';

/** The snapshot's two models plus the K6 capability rows (KF-10), so the picker offers them. */
const MODELS = [
    { id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true },
    { id: 'gemma4:12b', underlying: 'gemma4:12b', default: false },
    { id: 'mock-nocaps', underlying: 'mock-nocaps', default: false },
    { id: 'mock-hears', underlying: 'mock-hears', default: false },
];

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

/** The Computer, shown, with a document open and the mock's counters at zero. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();
    return true;
}

/** The takes line once it reports `state`. */
const takesIn = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ state, ms = 8000) => until(h, async () => {
    const t = await h.computer.takes(id);
    return t && t.state === state ? t : null;
}, ms, `the takes line of ${id} to say ${state}`);

/** Where the sentence is drawn: it must be ON SCREEN — laid out, and inside its own box. */
const onScreen = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const box = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"]`);
    const why = box && box.querySelector('.graph-takes-why');
    if (!box || !why) return null;
    const b = box.getBoundingClientRect();
    const w = why.getBoundingClientRect();
    return {
        drawn: w.width > 0 && w.height > 0 && getComputedStyle(why).display !== 'none',
        inside: w.left >= b.left - 1 && w.right <= b.right + 1 && w.top >= b.top - 1 && w.bottom <= b.bottom + 1,
    };
}, id);

/** The Instruction's model line as drawn, or null while hidden. */
const insLine = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const el = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-ins-caps`);
    return el && !el.hidden && el.textContent ? el.textContent : null;
}, id);

/** Choose a model in an Instruction's own picker, the way a person does. */
const chooseModel = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ model) => h.eval((pid, m) => {
    const sel = /** @type {any} */ (document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-part-select`));
    if (!sel) throw new Error('the Instruction has no model picker');
    const values = Array.prototype.map.call(sel.options, (/** @type {any} */ o) => o.value);
    if (values.indexOf(m) < 0) throw new Error(`the picker does not offer ${m}: ${values.join(',')}`);
    sel.value = m;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}, id, model);

/** A real PNG painted in the page (nothing fetched), as base64 for h.computer.dropFiles. */
const paintPng = (/** @type {any} */ h) => h.eval(() => {
    const c = document.createElement('canvas');
    c.width = 48; c.height = 32;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.fillStyle = '#2a6'; g.fillRect(0, 0, 48, 32);
    g.fillStyle = '#e4e'; g.fillRect(8, 8, 20, 12);
    return c.toDataURL('image/png').split(',')[1];
});

/** A farm answer the page's shared farm can be asked for, by model and capability. */
const capOf = (/** @type {any} */ h, /** @type {string} */ model, /** @type {string} */ name) =>
    h.eval((m, n) => window.LolComputer.app.farm.cap(m, n), model, name);

/** What the mock farm was asked, by path. */
async function asked(/** @type {any} */ h) {
    return {
        completions: (await h.mock.log({ path: COMPLETIONS })).length,
        ocr: (await h.mock.log({ path: '/ocr/process' })).length,
    };
}

/** No input_audio / file part ever reached the farm (the mock's KF-10 tripwire). */
async function noStrayParts(/** @type {any} */ h) {
    const w = await h.mock.warnings();
    const list = Array.isArray(w) ? w : ((w && w.warnings) || []);
    const k6 = list.filter((/** @type {any} */ x) => /K6:/.test(typeof x === 'string' ? x : JSON.stringify(x)));
    h.eq(k6.length, 0, `no sound or native-PDF part reached the farm: ${JSON.stringify(k6)}`);
}

export default [
    {
        name: 'k6-takes-an-image-box-says-what-the-model-it-is-wired-to-can-see',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            await h.setFarm({ models: MODELS });
            // The catalogue read is the real probe against the mock's /model_group/info.
            await until(h, async () => ((await capOf(h, 'mock-hears', 'audio')) === 'yes' ? true : null), 8000, 'the catalogue to be read');
            h.eq(await capOf(h, 'assistant', 'vision'), 'no', 'the mock farm lists assistant as not seeing');
            h.eq(await capOf(h, 'mock-nocaps', 'vision'), 'unknown', 'a row that says nothing stays unknown');
            h.eq(await capOf(h, 'gemma4:12b', 'audio'), 'unknown', 'and nothing is concluded about sound from silence');

            // ＋ → Image. Before anything is wired, the box says so, in words.
            const img = await h.computer.add('image');
            h.assert(!!img, 'clicking "Image" placed a box');
            let takes = await takesIn(h, img, 'unwired');
            h.eq(takes.kind, 'image');
            h.assert(/picture/.test(takes.label), `the label names what it holds: ${takes.label}`);
            h.eq(takes.whyShown, true, 'the sentence is shown, not hidden behind a hover');
            h.assert(/Wire it into an Instruction/.test(takes.why), `and says what would make it work: ${takes.why}`);
            const seen = await onScreen(h, img);
            h.assert(seen && seen.drawn && seen.inside, `the sentence is drawn inside the box: ${JSON.stringify(seen)}`);

            // A picture DROPPED on the box lands in it, and the line still tells the truth.
            const base64 = await paintPng(h);
            const drop = await h.computer.dropFiles([{ name: 'plan.png', mime: 'image/png', base64 }], null,
                `#lolcomputer .graph-part[data-id="${img}"] .graph-image`);
            h.eq(drop.defaultPrevented, true, 'the box took the drop');
            await until(h, async () => {
                const d = await h.computer.doc();
                const p = d.parts.find((/** @type {any} */ x) => x.id === img);
                return p && String(p.settings.dataUrl || '').startsWith('data:image/') ? true : null;
            }, 8000, 'the dropped picture to land in the box');
            h.eq((await h.computer.takes(img)).state, 'unwired', 'holding a picture changes nothing until it is wired');

            // ＋ → Instruction, wired in. On "auto" it asks the farm default — assistant, which the
            // farm does not list as seeing: a refusal, named, BEFORE any run.
            const ins = await h.computer.add('ask');
            h.assert(!!ins, 'clicking "Instruction" placed a box');
            h.assert(await h.computer.wire(img, ins, 'in'), 'the picture wires into the Instruction');
            takes = await takesIn(h, img, 'no');
            h.eq(takes.whyShown, true);
            h.assert(/does not list assistant as able to see/.test(takes.why), `the farm's declaration, named: ${takes.why}`);
            h.assert(!/cannot see/.test(takes.why), 'never more than the farm said');
            h.assert(/✗/.test(takes.label), `the mark says no: ${takes.label}`);
            const blindLine = await until(h, () => insLine(h, ins), 5000, 'the Instruction\'s model line');
            h.assert(/^assistant: pictures ✗/.test(blindLine), `the Instruction says what its model takes: ${blindLine}`);
            h.assert(/sound \?/.test(blindLine) && /PDF directly \?/.test(blindLine), `unknown is shown as ?: ${blindLine}`);

            // Choose a model that sees, in the Instruction's own picker → yes, and nothing to explain.
            await chooseModel(h, ins, 'gemma4:12b');
            takes = await takesIn(h, img, 'yes');
            h.eq(takes.whyShown, false, 'a yes has no refusal to show');
            h.assert(/✓/.test(takes.label), `the mark says yes: ${takes.label}`);
            const seeingLine = await until(h, async () => {
                const l = await insLine(h, ins);
                return l && l.startsWith('gemma4:12b') ? l : null;
            }, 5000, 'the model line to follow the picker');
            h.assert(/pictures ✓/.test(seeingLine), seeingLine);

            // A model the farm says nothing about → unknown, shown as unknown (never folded into no).
            await chooseModel(h, ins, 'mock-nocaps');
            takes = await takesIn(h, img, 'unknown');
            h.eq(takes.whyShown, true);
            h.assert(/does not say whether mock-nocaps can see/.test(takes.why), takes.why);
            h.assert(/\?/.test(takes.label), `the mark is a question: ${takes.label}`);

            // The mock-hears row reports sound: the Instruction's line says so, and it is still
            // not a picture model (its row says supports_vision: false).
            await chooseModel(h, ins, 'mock-hears');
            const hearsLine = await until(h, async () => {
                const l = await insLine(h, ins);
                return l && l.startsWith('mock-hears') ? l : null;
            }, 5000, 'the model line for mock-hears');
            h.assert(/pictures ✗/.test(hearsLine) && /sound ✓/.test(hearsLine), `the catalogue's own words: ${hearsLine}`);
            h.eq((await h.computer.takes(img)).state, 'no');

            const n = await asked(h);
            h.eq(n.completions, 0, 'knowing all this cost no generation');
            h.eq(n.ocr, 0, 'and sent nothing to be read');
            await noStrayParts(h);
        },
    },
    {
        name: 'k6-takes-a-catalogue-read-repaints-the-canvas-and-a-lost-farm-says-so',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            // No periodic publish: every farm change in this scenario is one we make.
            await h.fresh({ refreshMs: 600000 });
            await open(h);
            h.note(`surfaces share one bus: ${await h.eval(() => !!(window.LolChat && window.LolChat.app && window.LolChat.app.bus === window.LolComputer.app.bus))}`);

            // The farm first lists gemma4:12b as NOT seeing.
            await h.mock.state({ modelGroupInfo: { data: [
                { model_group: 'assistant', supports_vision: false },
                { model_group: 'gemma4:12b', supports_vision: false },
            ] } });
            await h.setFarm({ models: MODELS.slice(0, 3) });
            await until(h, async () => ((await capOf(h, 'gemma4:12b', 'vision')) === 'no' ? true : null), 8000, 'the first catalogue');

            const img = await h.computer.add('image');
            const ins = await h.computer.add('ask');
            h.assert(await h.computer.wire(img, ins, 'in'), 'wired');
            await chooseModel(h, ins, 'gemma4:12b');
            await takesIn(h, img, 'no');
            const edits = await h.eval(() => window.LolComputer.debug.computer.doc().rev);

            // The farm changes its mind. The farm change repaints the line at once (still "no": the
            // catalogue has not been read yet); only the catalogue read, announced on the bus, can
            // turn it to yes — with no edit on the canvas and no periodic publish to lean on.
            await h.mock.state({ modelGroupInfo: { data: [
                { model_group: 'assistant', supports_vision: false },
                { model_group: 'gemma4:12b', supports_vision: true },
            ] } });
            await h.setFarm({ models: MODELS });
            const t0 = Date.now();
            const yes = await takesIn(h, img, 'yes', 5000);
            h.note(`repainted ${Date.now() - t0} ms after the farm change`);
            h.eq(yes.whyShown, false);
            h.eq(await h.eval(() => window.LolComputer.debug.computer.doc().rev), edits, 'no document edit did it');

            // The farm goes away: nobody can say — unknown, and the Instruction's line hides.
            await h.setFarm(null);
            const away = await takesIn(h, img, 'unknown');
            h.assert(/No farm is connected/.test(away.why), away.why);
            h.eq(away.whyShown, true);
            await until(h, async () => ((await insLine(h, ins)) === null ? true : null), 5000, 'the model line to hide with no farm');

            const n = await asked(h);
            h.eq(n.completions, 0);
            h.eq(n.ocr, 0);
            await noStrayParts(h);
        },
    },
];
