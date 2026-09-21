// @ts-check
// The C2 landing's LOOK: fan-out, per-item failures, the cost line, the cap banner and the
// chat-column inspector, photographed in both themes and checked by machine first
// (integrator-owned, like c1-shots.mjs).
//
// What has to be IN the picture:
//   - a fanned Ask carrying its `5/5` badge, its cost with a call count, and ONE readable per-item
//     failure under its value (the mock refuses the item "pear");
//   - the value inspector open in the CONVERSATION column, above the composer, beside the graph
//     that produced the value — the whole reason BH-7 moved it out of a popover;
//   - the cap banner over the canvas with its one raise button, and the cap field in the toolbar.
//
// The assertions are the part that survives a screenshot nobody looks at: a hidden badge, an empty
// failure line, a cost that says "1 calls", an inspector that drifted inside #chat-messages or a
// banner squeezed to nothing all look plausible in a thumbnail and are caught here.

import fs from 'node:fs';
import path from 'node:path';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const ITEMS = ['apple', 'banana', 'cherry', 'pear', 'plum'];

const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolChat && window.LolChat.failed) || {};
    const missing = ['computer', 'ask', 'work'].filter((k) => failed[k]);
    if (missing.length) throw new Error('c2-shots needs the REAL modules, but the loader dropped: ' + missing.join(', '));
    return true;
});

/** A thread, the panel open on it, and a Note -> Split -> Ask -> Collect fan that has run once. */
async function buildScene(/** @type {any} */ h) {
    await h.fresh();
    await requireReal(h);
    await h.waitFor(() => (window.__lolFarm ? true : null));
    await h.submit('Check the open-day list, one line at a time.');
    await h.waitReply();
    await h.eval(async () => {
        const app = window.LolChat.app;
        const rows = await app.repo.listThreads();
        return app.controller.selectThread(rows[0].id);
    });
    const state = await h.graph.open();
    h.eq(state.panel, 'computer', 'the rail opened the Computer panel');
    await h.waitFor(() => (window.LolChat.debug.computer.doc().threadId ? true : null));

    // Laid out so the four frames do not overlap at their own default widths — an overlap hides
    // the wires and the badges this picture exists to show.
    const note = await h.graph.place('note', 20, 20);
    const split = await h.graph.place('split', 280, 20);
    const ask = await h.graph.place('ask', 540, 20);
    const collect = await h.graph.place('collect', 900, 20);
    await h.graph.set(note, { text: ITEMS.join('\n') });
    await h.graph.set(split, { mode: 'lines' });
    await h.graph.set(ask, { instruction: 'say one thing about it', model: 'mock-item' });
    await h.graph.set(collect, { mode: 'numbered' });
    await h.graph.wire(note, split, 'text');
    await h.graph.wire(split, ask, 'context');
    await h.graph.wire(ask, collect, 'items');

    await h.mock.state({ failWhen: 'pear' });     // ONE item the farm refuses, out of five
    const report = await h.graph.run();
    await h.mock.state({ failWhen: '' });
    h.eq(report.errors.length, 0, 'one bad item must not fail the photographed run: ' + JSON.stringify(report.errors));
    return { note, split, ask, collect };
}

/** Take the column to `mode`, let the 160 ms grid transition finish, and only then fit. */
async function settle(/** @type {any} */ h, /** @type {string} */ mode, /** @type {number} */ minWidth) {
    await h.width(mode);
    await h.waitFor((want) => {
        const body = document.querySelector('.chat-work-body');
        return body && body.getBoundingClientRect().width >= want ? true : null;
    }, { args: [minWidth], timeout: 8000 });
    await new Promise((r) => setTimeout(r, 300));
    const view = await h.graph.call('fit');
    await new Promise((r) => setTimeout(r, 120));
    return view.zoom;
}

/** Everything this picture claims, measured off the live DOM. */
const inspect = () => {
    const q = (/** @type {string} */ s) => document.querySelector(s);
    const rect = (/** @type {any} */ el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const seen = (/** @type {any} */ el) => {
        if (!el || el.hidden) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const askNode = q('#lolchat .graph-part[data-type="ask"]');
    const inspectEl = q('#lolchat .graph-inspect');
    const cap = q('#lolchat .graph-cap');
    const capInput = /** @type {any} */ (q('#lolchat .graph-cap-input'));
    const text = (/** @type {any} */ el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    return {
        theme: document.documentElement.className,
        canvasRect: rect(q('#lolchat .graph-canvas')),
        parts: Array.from(document.querySelectorAll('#lolchat .graph-part')).map((el) => ({
            type: el.getAttribute('data-type'),
            state: el.getAttribute('data-state'),
            rect: rect(el),
            transform: getComputedStyle(el).transform,
        })),
        ask: askNode ? {
            badge: text(askNode.querySelector('.graph-part-fanout')),
            badgeSeen: seen(askNode.querySelector('.graph-part-fanout')),
            cost: text(askNode.querySelector('.graph-part-cost')),
            value: text(askNode.querySelector('.graph-value')).slice(0, 60),
            itemErrors: Array.from(askNode.querySelectorAll('.graph-item-errors li')).map((li) => text(li)),
            itemErrorsSeen: seen(askNode.querySelector('.graph-item-errors')),
        } : null,
        inspector: inspectEl ? {
            rect: rect(inspectEl),
            beforeComposer: inspectEl.nextElementSibling === q('#chat-form'),
            insideMessages: !!(q('#chat-messages') && /** @type {any} */ (q('#chat-messages')).contains(inspectEl)),
            insidePanel: !!inspectEl.closest('.graph'),
            body: text(inspectEl.querySelector('.graph-inspect-body')).slice(0, 60),
            head: text(inspectEl.querySelector('.graph-inspect-head')),
        } : null,
        cap: {
            seen: seen(cap),
            rect: rect(cap),
            text: text(cap),
            button: text(q('#lolchat .graph-cap-raise')),
            field: capInput ? capInput.value : null,
            fieldSeen: seen(capInput),
        },
        wires: Array.from(document.querySelectorAll('#lolchat .graph-wires path')).map((p) => (p.getAttribute('d') || '').slice(0, 20)),
        messagesRect: rect(q('#chat-messages')),
        formRect: rect(q('#chat-form')),
        docScrollX: document.documentElement.scrollWidth,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
    };
};

/** The frozen layout every C2 picture still has to honour. */
function checkFrame(/** @type {any} */ h, /** @type {any} */ m, /** @type {string} */ theme) {
    h.eq(m.theme, theme, 'the <html> class did not switch');
    h.assert(m.canvasRect && m.canvasRect.h > 200, 'the canvas is only ' + (m.canvasRect && m.canvasRect.h) + ' px tall');
    h.eq(m.parts.length, 4, 'four parts should be painted (' + m.parts.length + ')');
    for (const p of m.parts) {
        h.eq(p.transform, 'none', p.type + ' carries a transform — only .graph-layer may (perf contract)');
        h.assert(p.rect.w > 60 && p.rect.h > 30, p.type + ' collapsed to ' + p.rect.w + 'x' + p.rect.h);
    }
    h.eq(m.wires.length, 3, 'three wires should be drawn (' + JSON.stringify(m.wires) + ')');
    h.assert(m.docScrollX <= m.viewportW, 'the page scrolls sideways (' + m.docScrollX + ' > ' + m.viewportW + ')');
    h.assert(m.formRect.y + m.formRect.h <= m.viewportH + 1, 'the composer is not inside the viewport');
    h.assert(m.cap.fieldSeen, 'the cap field is not visible in the toolbar');
    h.assert(/^\d+$/.test(String(m.cap.field)), 'the cap field shows "' + m.cap.field + '"');
}

/** The fan picture: badge, per-item failure, cost, and the inspector in the column. */
function checkFan(/** @type {any} */ h, /** @type {any} */ m) {
    h.assert(m.ask, 'no Ask part was painted');
    h.assert(m.ask.badgeSeen, 'the fan-out badge is not visible on a part that ran five items');
    h.eq(m.ask.badge, '5/5', 'the badge should read 5/5, got "' + m.ask.badge + '"');
    h.assert(/\d+ calls$/.test(m.ask.cost), 'a fanned part must say what it cost in calls, got "' + m.ask.cost + '"');
    h.assert(m.ask.value.length > 0, 'the four items that worked show no value preview');
    h.assert(m.ask.itemErrorsSeen, 'the per-item failure list is not visible');
    h.eq(m.ask.itemErrors.length, 1, 'exactly one item failed: ' + JSON.stringify(m.ask.itemErrors));
    h.assert(/^Item 4: \S/.test(m.ask.itemErrors[0]),
        'the failure must name its item by number AND say what went wrong, got "' + m.ask.itemErrors[0] + '"');

    h.assert(m.inspector, 'the value inspector is not in the DOM');
    h.eq(m.inspector.insideMessages, false, 'the inspector drifted inside #chat-messages (§2.6 AE)');
    h.eq(m.inspector.insidePanel, false, 'the inspector is inside the panel — BH-7 puts it in the column');
    h.eq(m.inspector.beforeComposer, true, 'the inspector is not immediately above the composer');
    h.assert(m.inspector.rect.h > 30, 'the inspector collapsed to ' + m.inspector.rect.h + ' px');
    h.assert(m.inspector.body.length > 0, 'the inspector shows no value at all');
    h.assert(m.inspector.head.length > 0, 'the inspector has no heading, so nothing says what it is');
    h.assert(m.messagesRect.w > 280, 'the conversation was squeezed to ' + m.messagesRect.w + ' px');
}

/** The cap picture: the banner and the one button out of it. */
function checkCap(/** @type {any} */ h, /** @type {any} */ m) {
    h.assert(m.cap.seen, 'the cap banner is not visible after a run that stopped at the cap');
    h.assert(m.cap.rect.h > 24, 'the cap banner collapsed to ' + m.cap.rect.h + ' px');
    h.assert(m.cap.rect.w > 200, 'the cap banner is only ' + m.cap.rect.w + ' px wide');
    h.assert(m.cap.text.includes('2'), 'the banner does not say the cap it stopped at: "' + m.cap.text + '"');
    h.assert(m.cap.text.includes('5'), 'nor how many items the part would have run, nor what raising the '
        + 'cap has to reach: "' + m.cap.text + '"');
    h.assert(m.cap.button.length > 0, 'the banner has no raise button');
    h.eq(m.cap.field, '50', 'a run-only cap must not have moved the stored preference');
}

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
    const shot = await h.screenshot(name);
    h.assert(!!shot, name + ': no screenshot was produced');
    const size = fs.statSync(shot).size;
    h.assert(size > 4000, name + ': the screenshot is only ' + size + ' bytes — the window painted nothing');
    h.note('screenshot ' + path.basename(shot) + ' (' + size + ' bytes)');
}

/** Both pictures in one theme: the fan with the inspector open, then the cap banner. */
async function shootTheme(/** @type {any} */ h, /** @type {string} */ theme) {
    const ids = await buildScene(h);
    await h.eval((cls) => { document.documentElement.className = cls; return true; }, theme);
    await settle(h, 'split', 320);
    // Fit puts a four-part fan at 44 % in a split column, where a 5/5 badge and a per-item
    // failure are unreadable — and THOSE are what this picture exists to show. So the fan shot is
    // framed on the Ask part at 100 %; the cap shot below keeps the whole-graph fit.
    const view = await h.graph.call('view', { x: -470, y: 8, zoom: 1 });
    const zoom = view.zoom;
    await new Promise((r) => setTimeout(r, 120));

    // Open the value in the conversation column — the surface BH-7 moved there.
    await h.click(`#lolchat .graph-part[data-id="${ids.collect}"] .graph-value`);
    await h.waitFor(() => (document.querySelector('#lolchat .graph-inspect') ? true : null), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 120));

    const fan = await h.eval(inspect);
    checkFrame(h, fan, theme);
    checkFan(h, fan);
    h.note(theme + ' fan: zoom ' + Math.round(zoom * 100) + '% · badge ' + fan.ask.badge + ' · cost "' + fan.ask.cost
        + '" · item error "' + fan.ask.itemErrors[0] + '" · inspector ' + JSON.stringify(fan.inspector.rect));
    await shoot(h, 'c2-shots-' + theme + '-fan');

    // Now the cap: close the inspector, make the graph stale and run it on a cap of two.
    await h.eval(() => {
        const el = /** @type {any} */ (document.querySelector('#lolchat .graph-inspect'));
        if (el) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
    });
    await h.graph.set(ids.note, { text: ITEMS.map((s) => s + ' tart').join('\n') });
    const capped = await h.graph.run({ maxItems: 2 });
    h.eq(capped.capped.cap, 2, 'the photographed run did not stop at the cap');
    await new Promise((r) => setTimeout(r, 150));

    const cap = await h.eval(inspect);
    checkFrame(h, cap, theme);
    checkCap(h, cap);
    h.note(theme + ' cap: "' + cap.cap.text + '" · button "' + cap.cap.button + '" · field ' + cap.cap.field);
    await shoot(h, 'c2-shots-' + theme + '-cap');
}

export default [
    {
        name: 'c2-shots-dark',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: (/** @type {any} */ h) => shootTheme(h, 'dark'),
    },
    {
        name: 'c2-shots-light',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            try {
                await shootTheme(h, 'light');
            } finally {
                await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            }
        },
    },
];
