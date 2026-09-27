// @ts-check
// The K3 landing's LOOK (integrator-owned, like c1-shots / c2-shots / k2-shots): what the Computer
// is while a run is HAPPENING. COMPUTER_PLAN §8.3 (what running looks like) and §8.2 (the wire is
// the teaching), photographed in both themes.
//
// What has to be IN the picture, because it is what K3 added:
//   · a PARKED box — a Dialog asking its question on the canvas, with its own field and Send, the
//     state the reader has never seen before this phase (`data-state="waiting"`);
//   · a BARRED branch — a Toggle switched off, its outgoing wire `data-barred`, and the box past
//     it left STALE rather than red: the graph is not broken, it is held;
//   · a ▶ in every part's title bar (`.graph-part-play[data-part]`), the per-box push;
//   · the run bar mid-run, counting what is waiting.
//
// The assertions are the half that survives a screenshot nobody looks at: the waiting box and the
// barred wire are distinguishable FROM THE DOM the way §8.3 promises a reader can distinguish them,
// every box carries its own play button, the parked question is readable text and not an empty
// shell, and the page never scrolls sideways in either theme.

import fs from 'node:fs';
import path from 'node:path';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host', 'ask', 'library'].filter((k) => failed[k]);
    if (missing.length) throw new Error('k3-shots needs the REAL modules, but the loader dropped: ' + missing.join(', '));
    return true;
});

/**
 * Two branches off one premise: one runs into a question and PARKS, the other runs into a Toggle
 * that is off and is HELD. Both states live in the same frame on purpose — that contrast is the
 * whole of §8.3, and a picture with only one of them teaches half of it.
 */
async function buildScene(/** @type {any} */ h) {
    await h.fresh();
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.__lolFarm ? true : null));
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();

    const premise = await h.computer.place('note', 20, 20);
    await h.computer.set(premise, { text: 'A museum wants a quiet hour. Draft the announcement.' });

    // Branch one: think, then ask the person. The Dialog is what parks.
    const draft = await h.computer.place('ask', 300, 20);
    await h.computer.set(draft, { instruction: 'Draft the announcement in two sentences.', model: 'mock-echo' });
    await h.computer.wire(premise, draft, 'in');
    const question = await h.computer.place('dialog', 620, 20);
    await h.computer.set(question, { question: 'Which tone: warm, or plain?', placeholder: 'warm' });
    const w1 = await h.computer.wire(draft, question, 'in');

    // Branch two: a Toggle that is OFF. The value still flows; the activation does not.
    const gate = await h.computer.place('toggle', 20, 400);
    await h.computer.set(gate, { on: false });
    await h.computer.wire(premise, gate, 'in');
    const translate = await h.computer.place('ask', 300, 400);
    await h.computer.set(translate, { instruction: 'Translate the announcement into French.', model: 'mock-echo' });
    const w2 = await h.computer.wire(gate, translate, 'in');
    // Something past the held box, so the held branch HAS a wire to grey: the canvas fades the
    // wires OUT OF a barred part (K3-U3's rule, asserted in k3-canvas), so a branch that ends at
    // the barred box itself greys nothing. Worth knowing when reading this picture.
    const publish = await h.computer.place('ask', 620, 400);
    await h.computer.set(publish, { instruction: 'Shorten it for the door sign.', model: 'mock-echo' });
    const w3 = await h.computer.wire(translate, publish, 'in');
    h.assert(w1.ok && w2.ok && w3.ok, 'the scene could not be wired');

    // START the run WITHOUT awaiting it: the picture we want is the middle of a run, and the run
    // does not end until a person answers. The promise is parked on `window` so nothing warns
    // about it, and `stop()` at the end of the case is what ends it.
    await h.eval(() => {
        window.__k3shotsRun = window.LolComputer.debug.computer.run({});
        return true;
    });
    // BOTH halves of the picture, not just the first to arrive: the question has to be parked AND
    // the held branch has to have gone grey. They happen in whichever order the topological scan
    // reaches them, and photographing after only one of them is how a shot scenario lies.
    await h.waitFor(() => {
        const st = window.LolComputer.debug.computer.state().parts;
        return st.some((p) => p.state === 'waiting') ? true : null;
    }, { timeout: 30000 });
    // The held branch goes grey in its own time — the scan reaches the Toggle when it reaches it,
    // which may be after the question parks. Give it a beat rather than racing the paint.
    await new Promise((r) => setTimeout(r, 1500));
    return { premise, draft, question, gate, translate, publish };
}

const inspect = () => {
    const q = (/** @type {string} */ s) => document.querySelector(s);
    const rect = (/** @type {any} */ el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
        theme: document.documentElement.className,
        canvasRect: rect(q('#lolcomputer .graph-canvas')),
        parts: Array.from(document.querySelectorAll('#lolcomputer .graph-part')).map((el) => ({
            id: el.getAttribute('data-id'),
            type: el.getAttribute('data-type'),
            state: el.getAttribute('data-state'),
            rect: rect(el),
        })),
        wires: Array.from(document.querySelectorAll('#lolcomputer .graph-wire')).map((el) => ({
            barred: el.getAttribute('data-barred') === 'true',
            back: el.getAttribute('data-back') === 'true',
        })),
        plays: Array.from(document.querySelectorAll('#lolcomputer .graph-part-play')).length,
        askField: !!q('#lolcomputer .graph-part-answer'),
        askText: ((q('#lolcomputer .graph-part[data-type="dialog"]') || {}).textContent || '')
            .replace(/\s+/g, ' ').trim().slice(0, 200),
        runbar: ((q('#lolcomputer .comp-run') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        docScrollX: document.documentElement.scrollWidth,
        viewportW: window.innerWidth,
    };
};

function check(/** @type {any} */ h, /** @type {any} */ m, /** @type {string} */ theme) {
    h.eq(m.theme, theme, 'the <html> class did not switch');
    h.assert(m.canvasRect && m.canvasRect.h > 200, 'the canvas is only ' + (m.canvasRect && m.canvasRect.h) + ' px tall');
    h.eq(m.parts.length, 6, 'six boxes are in the frame: ' + JSON.stringify(m.parts.map((/** @type {any} */ p) => p.type)));

    const byType = (/** @type {string} */ t2) => m.parts.filter((/** @type {any} */ p) => p.type === t2);
    h.eq(byType('dialog')[0].state, 'waiting', 'the Dialog is not showing the waiting look');
    h.eq(m.askField, true, 'the parked question has no field to answer it in');
    h.assert(/[A-Za-z]{4}/.test(m.askText), 'the parked box carries no readable question: "' + m.askText + '"');

    const held = byType('ask').filter((/** @type {any} */ p) => p.state === 'stale');
    h.assert(held.length >= 1, 'nothing was left STALE by the Toggle: '
        + JSON.stringify(m.parts.map((/** @type {any} */ p) => p.type + ':' + p.state)));
    h.assert(!m.parts.some((/** @type {any} */ p) => p.state === 'error'),
        'a held branch was painted as an ERROR, which is the lie §8.3 exists to prevent: '
        + JSON.stringify(m.parts.map((/** @type {any} */ p) => p.type + ':' + p.state)));
    h.assert(m.wires.some((/** @type {any} */ w) => w.barred), 'no wire is marked data-barred: '
        + JSON.stringify(m.wires) + ' · ' + JSON.stringify(m.parts.map((/** @type {any} */ p) => p.type + ':' + p.state)));

    h.eq(m.plays, 6, 'every box carries its own ▶ (' + m.plays + ' of 6)');
    for (const p of m.parts) {
        h.assert(p.rect.w > 60 && p.rect.h > 40, 'a box collapsed to ' + p.rect.w + 'x' + p.rect.h);
    }
    h.assert(/[A-Za-z]/.test(m.runbar), 'the run bar says nothing while a run is live: "' + m.runbar + '"');
    h.assert(m.docScrollX <= m.viewportW, 'the page scrolls sideways (' + m.docScrollX + ' > ' + m.viewportW + ')');
}

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
    const shot = await h.screenshot(name);
    h.assert(!!shot, name + ': no screenshot was produced');
    const size = fs.statSync(shot).size;
    h.assert(size > 4000, name + ': the screenshot is only ' + size + ' bytes — the window painted nothing');
    h.note('screenshot ' + path.basename(shot) + ' (' + size + ' bytes)');
}

/** Whatever the case did, the parked run must not outlive it. */
async function endRun(/** @type {any} */ h) {
    try { await h.computer.stop(); } catch { /* the run may already have ended */ }
}

export default [
    {
        name: 'k3-shots-dark',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await buildScene(h);
            try {
                await h.eval(() => { document.documentElement.className = 'dark'; return true; });
                await new Promise((r) => setTimeout(r, 200));
                const m = await h.eval(inspect);
                check(h, m, 'dark');
                h.note('dark: ' + JSON.stringify(m.parts.map((/** @type {any} */ p) => p.type + ':' + p.state))
                    + ' · run bar "' + m.runbar.slice(0, 80) + '"');
                await shoot(h, 'k3-shots-dark');
            } finally {
                await endRun(h);
            }
        },
    },
    {
        name: 'k3-shots-light',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await buildScene(h);
            try {
                await h.eval(() => { document.documentElement.className = 'light'; return true; });
                await new Promise((r) => setTimeout(r, 200));
                const m = await h.eval(inspect);
                check(h, m, 'light');
                h.note('light: ' + JSON.stringify(m.parts.map((/** @type {any} */ p) => p.type + ':' + p.state)));
                await shoot(h, 'k3-shots-light');
            } finally {
                await endRun(h);
                await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            }
        },
    },
];
