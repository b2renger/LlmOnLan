// @ts-check
// The C1 landing's LOOK: the Computer panel, photographed in both themes and checked by machine
// first (integrator-owned, like s0-shots.mjs / p2-shots.mjs).
//
// What has to be IN the picture: the rail with the Computer tab selected, the toolbar, a real
// three-part program (Note -> Ask -> Collect) that has RUN — so every part carries a state chip and
// a value preview — and the two wires between them, drawn in the one SVG layer.
//
// The assertions are the part that survives a screenshot nobody looks at: the parts are inside the
// canvas box (the 0 px-tall-host bug painted them outside it and still looked plausible in a
// thumbnail), the wire paths have real geometry, the state reads as text and not colour alone, the
// conversation keeps a readable column and the page never scrolls sideways.

import fs from 'node:fs';
import path from 'node:path';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolChat && window.LolChat.failed) || {};
    const missing = ['computer', 'ask', 'work'].filter((k) => failed[k]);
    if (missing.length) throw new Error('c1-shots needs the REAL modules, but the loader dropped: ' + missing.join(', '));
    return true;
});

/** A thread, the panel open on it, and a Note -> Ask -> Collect program that has run. */
async function buildScene(/** @type {any} */ h) {
    await h.fresh();
    await requireReal(h);
    await h.waitFor(() => (window.__lolFarm ? true : null));
    await h.submit('Plan the studio open day.');
    await h.waitReply();
    await h.eval(async () => {
        const app = window.LolChat.app;
        const rows = await app.repo.listThreads();
        return app.controller.selectThread(rows[0].id);
    });
    const state = await h.graph.open();
    h.eq(state.panel, 'computer', 'the rail opened the Computer panel');
    await h.waitFor(() => (window.LolChat.debug.computer.doc().threadId ? true : null));

    // Laid out so the three frames do not overlap at their own default sizes (Note 220, Ask 300,
    // Collect 260 wide) — an overlap hides the very wires this picture exists to show.
    const note = await h.graph.place('note', 20, 20);
    const ask = await h.graph.place('ask', 340, 20);
    const collect = await h.graph.place('collect', 720, 20);
    await h.graph.set(note, { text: 'Paris' });
    await h.graph.set(ask, { instruction: 'name three things to see', model: 'mock-echo' });
    await h.graph.set(collect, { mode: 'numbered' });
    await h.graph.wire(note, ask, 'context');
    await h.graph.wire(ask, collect, 'items');
    const report = await h.graph.run();
    h.eq(report.errors.length, 0, 'the photographed run failed: ' + JSON.stringify(report.errors));
    h.eq(report.ran, 3, 'the photographed run ran ' + report.ran + ' parts, not 3');
    return { note, ask, collect };
}

/**
 * Take the column to `mode`, WAIT for the 160 ms grid transition to finish, and only then fit.
 * Fitting first is what made the first version of this picture photograph a 29 % zoom: fitView
 * measures `canvas.clientWidth`, so a fit taken mid-transition zooms to a column that no longer
 * exists and nobody ever presses Fit again.
 * @returns {Promise<number>} the zoom the canvas settled at
 */
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

const inspect = () => {
    const q = (/** @type {string} */ s) => document.querySelector(s);
    const rect = (/** @type {any} */ el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const canvas = q('#lolchat .graph-canvas');
    const svg = q('#lolchat .graph-wires');
    const parts = Array.from(document.querySelectorAll('#lolchat .graph-part'));
    const toolbar = q('#lolchat .graph-toolbar');
    return {
        theme: document.documentElement.className,
        tabs: Array.from(document.querySelectorAll('.chat-work-rail [role="tab"]')).map((t) => ({
            panel: t.getAttribute('data-panel'),
            label: (t.textContent || '').trim(),
            selected: t.getAttribute('aria-selected'),
        })),
        toolbar: toolbar ? Array.from(toolbar.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean) : [],
        toolbarRect: rect(toolbar),
        canvasRect: rect(canvas),
        parts: parts.map((el) => {
            const r = el.getBoundingClientRect();
            const head = el.querySelector('.graph-part-head');
            const value = el.querySelector('.graph-value');
            return {
                type: el.getAttribute('data-type'),
                state: el.getAttribute('data-state'),
                head: ((head && head.textContent) || '').replace(/\s+/g, ' ').trim(),
                value: ((value && value.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                transform: getComputedStyle(el).transform,
                // Every picker in the body, so a blank <select> over a real setting is caught.
                selects: Array.from(el.querySelectorAll('select')).map((sel) => ({
                    label: ((sel.closest('.graph-part-field') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
                    value: sel.value,
                    shown: sel.selectedIndex >= 0 ? (sel.options[sel.selectedIndex].textContent || '').trim() : '',
                })),
            };
        }),
        wires: svg ? Array.from(svg.querySelectorAll('path')).map((p) => (p.getAttribute('d') || '').slice(0, 24)) : [],
        // The hint ELEMENT always exists; what matters is whether it is painted over the graph.
        empty: (() => {
            const e = q('#lolchat .graph-empty');
            return e ? getComputedStyle(e).display !== 'none' : false;
        })(),
        messagesRect: rect(q('#chat-messages')),
        formRect: rect(q('#chat-form')),
        docScrollX: document.documentElement.scrollWidth,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
    };
};

function check(/** @type {any} */ h, /** @type {any} */ m, /** @type {string} */ theme, /** @type {string} */ mode) {
    h.eq(m.theme, theme, 'the <html> class did not switch');
    const tab = m.tabs.filter((/** @type {any} */ t) => t.panel === 'computer');
    h.eq(tab.length, 1, 'the rail should show the Computer tab (' + JSON.stringify(m.tabs) + ')');
    h.eq(tab[0].selected, 'true', 'the Computer tab is not the selected one');
    h.assert(tab[0].label.length > 0, 'the Computer tab has no label');
    h.assert(m.toolbar.length >= 2, 'the toolbar has no buttons (' + JSON.stringify(m.toolbar) + ')');
    h.assert(m.toolbarRect && m.toolbarRect.h > 20, 'the toolbar is not a row (' + JSON.stringify(m.toolbarRect) + ')');

    // The canvas is a real box, not the 0 px-tall host that still paints its parts.
    h.assert(m.canvasRect && m.canvasRect.h > 200, 'the canvas is only ' + (m.canvasRect && m.canvasRect.h) + ' px tall');
    h.assert(!m.empty, 'the "place a part" hint is still painted over a three-part graph');
    h.eq(m.parts.length, 3, 'three parts should be painted (' + m.parts.length + ')');
    const types = m.parts.map((/** @type {any} */ p) => p.type).sort();
    h.eq(types, ['ask', 'collect', 'note'], 'the painted part types are ' + JSON.stringify(types));
    for (const p of m.parts) {
        h.eq(p.state, 'done', p.type + ' is ' + p.state + ' after a clean run');
        // BG-8: a part's state reads as colour AND text.
        h.assert(/[A-Za-z]/.test(p.head), p.type + ' carries no readable text in its head: "' + p.head + '"');
        h.assert(p.value.length > 0, p.type + ' shows no value preview after a run');
        h.eq(p.transform, 'none', p.type + ' carries a transform — only .graph-layer may (perf contract)');
        h.assert(p.rect.x + p.rect.w > m.canvasRect.x - 1 && p.rect.x < m.canvasRect.x + m.canvasRect.w + 1,
            p.type + ' is painted outside the canvas horizontally (' + JSON.stringify(p.rect) + ' vs ' + JSON.stringify(m.canvasRect) + ')');
        h.assert(p.rect.y + p.rect.h > m.canvasRect.y - 1 && p.rect.y < m.canvasRect.y + m.canvasRect.h + 1,
            p.type + ' is painted outside the canvas vertically (' + JSON.stringify(p.rect) + ' vs ' + JSON.stringify(m.canvasRect) + ')');
        h.assert(p.rect.w > 60 && p.rect.h > 30, p.type + ' collapsed to ' + p.rect.w + 'x' + p.rect.h);
    }
    // The Ask part's model picker must SHOW the model the run will use. A `select.value = v` that
    // matches no option leaves it blank while the part happily runs on that model.
    const askPart = m.parts.filter((/** @type {any} */ p) => p.type === 'ask')[0];
    const picked = askPart.selects.filter((/** @type {any} */ sel) => sel.value === 'mock-echo');
    h.eq(picked.length, 1, 'the Ask part does not show the model it runs on (' + JSON.stringify(askPart.selects) + ')');
    h.assert(picked[0].shown.length > 0, 'the model picker shows a blank option for mock-echo');
    for (const sel of askPart.selects) {
        h.assert(sel.shown.length > 0, 'a picker on Ask shows nothing at all (' + JSON.stringify(sel) + ')');
    }

    h.eq(m.wires.length, 2, 'two wires should be drawn (' + JSON.stringify(m.wires) + ')');
    for (const d of m.wires) h.assert(/^M\s*-?\d/.test(d), 'a wire path has no geometry: "' + d + '"');

    // The frozen layout still holds around the panel. In the `work` width the conversation is
    // deliberately gone, so only split can ask about it.
    if (mode === 'split') h.assert(m.messagesRect.w > 280, 'the conversation was squeezed to ' + m.messagesRect.w + ' px');
    h.assert(m.docScrollX <= m.viewportW, 'the page scrolls sideways (' + m.docScrollX + ' > ' + m.viewportW + ')');
    h.assert(m.formRect.y + m.formRect.h <= m.viewportH + 1, 'the composer is not inside the viewport');
}

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
    const shot = await h.screenshot(name);
    h.assert(!!shot, name + ': no screenshot was produced');
    const size = fs.statSync(shot).size;
    h.assert(size > 4000, name + ': the screenshot is only ' + size + ' bytes — the window painted nothing');
    h.note('screenshot ' + path.basename(shot) + ' (' + size + ' bytes)');
}

export default [
    {
        name: 'c1-shots-dark',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await buildScene(h);
            await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            const splitZoom = await settle(h, 'split', 320);
            const split = await h.eval(inspect);
            check(h, split, 'dark', 'split');
            h.note('dark split: zoom ' + Math.round(splitZoom * 100) + '% · toolbar ' + JSON.stringify(split.toolbar)
                + ' · parts ' + split.parts.map((/** @type {any} */ p) => p.type + ':' + p.state).join(' '));
            await shoot(h, 'c1-shots-dark-split');

            // The whole-window state, where a three-part program is meant to be read at 100 %.
            const workZoom = await settle(h, 'work', 600);
            const work = await h.eval(inspect);
            check(h, work, 'dark', 'work');
            h.assert(workZoom >= 0.9, 'Fit in the work width zoomed to ' + Math.round(workZoom * 100)
                + '% — a three-part program fits at 100 % in a 1000 px column');
            h.note('dark work: zoom ' + Math.round(workZoom * 100) + '% · canvas ' + JSON.stringify(work.canvasRect));
            await shoot(h, 'c1-shots-dark-work');
        },
    },
    {
        name: 'c1-shots-light',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await buildScene(h);
            try {
                await h.eval(() => { document.documentElement.className = 'light'; return true; });
                const splitZoom = await settle(h, 'split', 320);
                const split = await h.eval(inspect);
                check(h, split, 'light', 'split');
                h.note('light split: zoom ' + Math.round(splitZoom * 100) + '% · parts '
                    + split.parts.map((/** @type {any} */ p) => p.type + ':' + p.state).join(' '));
                await shoot(h, 'c1-shots-light-split');

                const workZoom = await settle(h, 'work', 600);
                const work = await h.eval(inspect);
                check(h, work, 'light', 'work');
                h.note('light work: zoom ' + Math.round(workZoom * 100) + '%');
                await shoot(h, 'c1-shots-light-work');
            } finally {
                await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            }
        },
    },
];
