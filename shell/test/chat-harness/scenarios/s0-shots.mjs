// @ts-check
// The S0 landing's LOOK: the one visible surface the Studio rails added — the workbench column —
// photographed in both themes and checked by machine first (integrator-owned; the P1/P2 equivalents
// are p1-shots.mjs / p2-shots.mjs).
//
// S0 ships no real panel (the Computer panel arrives with docs/LOLCHAT_COMPUTER_SPEC.md), so the
// picture registers one test panel through `app.registry`, exactly as s0-workbench.mjs does. What
// has to be IN the picture: the rail with its tab selected, the width radios, the grip, a panel body
// beside a live conversation (split), and the same panel taking the window (work).
//
// The assertions are the part that survives a screenshot nobody looks at: the conversation keeps a
// readable column in split, the panel column stays inside its clamp, the composer stays in the
// viewport and the page never scrolls sideways.

import fs from 'node:fs';
import path from 'node:path';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolChat && window.LolChat.failed) || {};
    const want = ['view', 'controller', 'composer', 'sidebar', 'picker', 'work'];
    const missing = want.filter((k) => failed[k]);
    if (missing.length) throw new Error('s0-shots needs the REAL modules, but the loader faked or dropped: ' + missing.join(', '));
    if (!window.LolChat.app.work) throw new Error('app.work is missing');
    return true;
});

/** One panel worth photographing: a heading, a little body text, a footer row. */
const installPanel = (/** @type {any} */ h) => h.eval(() => {
    const app = window.LolChat.app;
    app.registry.add(app.SLOTS.WORKBENCH_PANELS, {
        id: 'notes',
        order: 100,
        label: 'Notes',
        defaultWidth: 'split',
        create(host) {
            const wrap = document.createElement('div');
            const head = document.createElement('h3');
            head.textContent = 'Bevel notes';
            const body = document.createElement('p');
            body.textContent = 'A workbench panel lives here, beside the conversation. '
                + 'It keeps its own state per thread and is destroyed when the reader looks away.';
            const foot = document.createElement('p');
            foot.textContent = 'width: split - drag the grip to resize';
            wrap.append(head, body, foot);
            host.appendChild(wrap);
            return {
                show() { wrap.hidden = false; },
                hide() { wrap.hidden = true; },
                destroy() { host.replaceChildren(); },
                onThread() { },
            };
        },
    });
    return app.work.panels().map((/** @type {any} */ p) => p.id);
});

const waitSettled = (/** @type {any} */ h, /** @type {number} */ rows) => h.waitFor((want) => {
    const all = document.querySelectorAll('.chat-msg');
    if (all.length !== want) return null;
    return all[all.length - 1].getAttribute('data-status') === 'done' ? true : null;
}, { args: [rows], timeout: 45000 });

const pickModel = async (/** @type {any} */ h, /** @type {string} */ id) => {
    await h.waitFor((want) => {
        const s = /** @type {any} */ (document.getElementById('chat-model'));
        return s && Array.prototype.some.call(s.options, (o) => o.value === want) ? true : null;
    }, { args: [id], timeout: 20000 });
    await h.eval((want) => {
        const s = /** @type {any} */ (document.getElementById('chat-model'));
        s.value = want;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return s.value;
    }, id);
};

/** A conversation on the left, a panel open on the right. */
async function buildScene(/** @type {any} */ h) {
    await h.fresh();
    await requireReal(h);
    await h.waitFor(() => (window.__lolFarm ? true : null));
    await installPanel(h);
    await pickModel(h, 'mock-md');
    await h.submit('Show me the whole formatting range.');
    await waitSettled(h, 2);
    await h.work('notes');
    await h.width('split');
    // The column transitions over 160 ms; wait for the PANEL BODY (not just the grid track, which
    // computes to its target while the transition still runs) to be at its width before the shutter.
    await h.waitFor(() => {
        const body = document.querySelector('.chat-work-body');
        return body && body.getBoundingClientRect().width > 300 ? true : null;
    }, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 300));
}

const inspect = () => {
    const q = (/** @type {string} */ s) => document.querySelector(s);
    const rect = (/** @type {any} */ el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const root = document.getElementById('lolchat');
    const rail = q('.chat-work-rail');
    const bodyEl = q('.chat-work-body');
    return {
        theme: document.documentElement.className,
        bg: getComputedStyle(root).backgroundColor,
        width: root.getAttribute('data-width') || (q('.chat-work') || {}).getAttribute?.('data-width'),
        cols: getComputedStyle(root).gridTemplateColumns.split(' ').map((c) => Math.round(parseFloat(c) || 0)),
        railRect: rect(rail),
        tabs: rail ? Array.from(rail.querySelectorAll('[role="tab"]')).map((t) => ({
            panel: t.getAttribute('data-panel'),
            label: (t.textContent || '').trim(),
            selected: t.getAttribute('aria-selected'),
        })) : [],
        widths: Array.from(document.querySelectorAll('.chat-work-head [data-width]')).map((r) => ({
            w: r.getAttribute('data-width'), checked: r.getAttribute('aria-checked'),
        })),
        bodyText: bodyEl ? (bodyEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '',
        bodyRect: rect(bodyEl),
        gripRect: rect(q('.chat-work-grip')),
        messagesRect: rect(q('#chat-messages')),
        formRect: rect(q('#chat-form')),
        msgs: document.querySelectorAll('.chat-msg').length,
        docScrollX: document.documentElement.scrollWidth,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
    };
};

function check(/** @type {any} */ h, /** @type {any} */ m, /** @type {string} */ theme, /** @type {string} */ mode) {
    h.eq(m.theme, theme, 'the <html> class did not switch');
    // The rail: this scenario's tab, selected, with its label readable. From C1 the real
    // `computer` panel registers into the same slot, so the assertion is about OUR tab, not about
    // the rail holding exactly one (C1 kickoff, §2.6 BG).
    const tabs = m.tabs.filter((/** @type {any} */ t) => t.panel === 'notes');
    h.eq(tabs.length, 1, `the rail should show the registered panel (${JSON.stringify(m.tabs)})`);
    h.eq(tabs[0].selected, 'true', 'the open panel is not the selected tab');
    h.assert(/Notes/.test(tabs[0].label), `the tab has no label: "${tabs[0].label}"`);
    h.assert(m.railRect && m.railRect.h > 0 && m.railRect.h <= 44, `the rail is not one row (${JSON.stringify(m.railRect)})`);
    // The width control shows which state we are in.
    const checked = m.widths.filter((/** @type {any} */ w) => w.checked === 'true').map((/** @type {any} */ w) => w.w);
    h.eq(checked, [mode], `the width radios do not agree with the state (${JSON.stringify(m.widths)})`);
    // The panel body really carries the panel's content.
    h.assert(/Bevel notes/.test(m.bodyText), `the panel body is empty: "${m.bodyText}"`);
    h.assert(m.bodyRect && m.bodyRect.w > 280, `the panel column is only ${m.bodyRect && m.bodyRect.w} px wide`);
    if (mode === 'split') {
        // Both halves are readable and the grip sits between them.
        h.assert(m.cols[2] >= 320, `the split column fell below its 320 px clamp (${JSON.stringify(m.cols)})`);
        h.assert(m.cols[2] <= Math.round(m.viewportW * 0.7) + 2, `the split column passed its 70 % clamp (${JSON.stringify(m.cols)})`);
        h.assert(m.messagesRect.w > 280, `the conversation was squeezed to ${m.messagesRect.w} px`);
        h.assert(m.msgs === 2, `the conversation is not in the picture (${m.msgs} rows)`);
        h.assert(m.gripRect && m.gripRect.h > 40, 'the drag grip is not in the picture');
    } else {
        h.assert(m.cols[2] >= m.viewportW - m.cols[0] - 2, `work width did not take the window (${JSON.stringify(m.cols)})`);
    }
    // And the frozen layout still holds.
    h.assert(m.docScrollX <= m.viewportW, `the page scrolls sideways (${m.docScrollX} > ${m.viewportW})`);
    h.assert(m.formRect.y + m.formRect.h <= m.viewportH + 1, 'the composer is not inside the viewport');
}

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
    const shot = await h.screenshot(name);
    h.assert(!!shot, `${name}: no screenshot was produced`);
    const size = fs.statSync(shot).size;
    h.assert(size > 4000, `${name}: the screenshot is only ${size} bytes — the window painted nothing`);
    h.note(`screenshot ${path.basename(shot)} (${size} bytes)`);
}

export default [
    {
        name: 's0-shots-dark',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (h) => {
            await buildScene(h);
            await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            const split = await h.eval(inspect);
            check(h, split, 'dark', 'split');
            h.note(`dark split: tracks ${JSON.stringify(split.cols)} · panel "${split.bodyText.slice(0, 60)}"`);
            await shoot(h, 's0-shots-dark-split');

            await h.width('work');
            // The whole-window state: wait for the body to actually be at its width (the grid
            // transition), then photograph.
            const grew = await h.eval(() => new Promise((resolve) => {
                const t0 = Date.now();
                const tick = () => {
                    const b = document.querySelector('.chat-work-body');
                    const w = b ? Math.round(b.getBoundingClientRect().width) : 0;
                    if (w > 600 || Date.now() - t0 > 5000) resolve(w);
                    else setTimeout(tick, 50);
                };
                tick();
            }));
            h.note(`work-state panel body: ${grew} px`);
            await new Promise((r) => setTimeout(r, 300));
            const work = await h.eval(inspect);
            check(h, work, 'dark', 'work');
            h.note(`dark work: tracks ${JSON.stringify(work.cols)}`);
            await shoot(h, 's0-shots-dark-work');
        },
    },
    {
        name: 's0-shots-light',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (h) => {
            await buildScene(h);
            try {
                await h.eval(() => { document.documentElement.className = 'light'; return true; });
                const m = await h.eval(inspect);
                check(h, m, 'light', 'split');
                h.note(`light split: tracks ${JSON.stringify(m.cols)} · panel "${m.bodyText.slice(0, 60)}"`);
                await shoot(h, 's0-shots-light-split');
            } finally {
                await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            }
        },
    },
];
