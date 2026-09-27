// @ts-check
// The C3 landing's LOOK (integrator-owned, like c1-shots.mjs / c2-shots.mjs): the three new parts
// and the new toolbar, photographed in both themes and checked by machine first.
//
// What has to be IN the picture:
//   - a Code part with real code in its editor and the answer its sandbox computed underneath;
//   - a Render part showing an actual PICTURE (the snapshot, not a placeholder) with its two
//     save buttons;
//   - a File part naming the path it wrote and offering Reveal;
//   - the new toolbar row: Tidy, Export…, Import… — and, in the second shot, the export popover
//     open over the canvas.
//
// The assertions are the part that survives a screenshot nobody looks at: a tile that is 0 px, a
// value line that stayed empty, a popover that opened off-screen or under the canvas, a control
// squeezed to nothing, and a part whose text spills out of its own frame all look plausible in a
// thumbnail and are caught here.

import fs from 'node:fs';
import path from 'node:path';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

const SOURCE = '# Open day\n\n- the small kiln\n- the big kiln\n';

const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};   // K1: the Computer's own loader
    const missing = ['host', 'library'].filter((k) => failed[k]);
    if (missing.length) throw new Error('c3-shots needs the REAL modules, but the loader dropped: ' + missing.join(', '));
    return true;
});

/** A thread, the panel open on it, and a Note -> {Code, Render, File} graph that has run once. */
async function buildScene(/** @type {any} */ h) {
    await h.fresh();
    await requireReal(h);
    await h.waitFor(() => (window.__lolFarm ? true : null));
    await h.submit('Write the open-day list into the project.');
    await h.waitReply();
    const state = await h.graph.open();
    h.eq(state.computer, true, 'the rail did not open the Computer');
    await h.waitFor(() => ((window.LolComputer.debug.computer.doc() || {}).id ? true : null));

    // Laid out so the four frames do not overlap at their own default widths — an overlap hides
    // the wires and the values this picture exists to show.
    const note = await h.graph.place('note', 20, 20);
    const code = await h.graph.place('code', 300, 20);
    const draw = await h.graph.place('render', 300, 260);
    const write = await h.graph.place('file', 640, 20);
    await h.graph.set(note, { text: SOURCE });
    await h.graph.set(code, { code: 'const lines = inputs.in[0].split("\\n").filter(Boolean);\nreturn lines.length + " lines";' });
    await h.graph.set(draw, { mode: 'markdown', width: 260, height: 180 });
    await h.graph.set(write, { path: 'out/open-day.md' });
    h.eq((await h.graph.wire(note, code, 'in')).ok, true, 'Note feeds Code');
    h.eq((await h.graph.wire(note, draw, 'in')).ok, true, 'Note feeds Render');
    h.eq((await h.graph.wire(note, write, 'in')).ok, true, 'Note feeds File');

    const report = await h.graph.run();
    h.eq(report.errors.length, 0, 'the photographed run failed: ' + JSON.stringify(report.errors));
    return { note, code, draw, write };
}

/** K1 landing (§3.7): there is no workbench column any more — one surface, one width. `mode` is
 * kept as a label so every call site reads unchanged; the wait is still real, because Fit measures
 * `canvas.clientWidth` and a fit taken before the layout settles photographs the wrong zoom. */
async function settle(/** @type {any} */ h, /** @type {string} */ mode, /** @type {number} */ minWidth) {
    await h.view('computer');
    await h.waitFor((want) => {
        const el = document.querySelector('#lolcomputer .graph-canvas');
        return el && el.getBoundingClientRect().width >= want ? true : null;
    }, { args: [Math.min(minWidth, 320)], timeout: 8000 });
    await new Promise((r) => setTimeout(r, 300));
    const view = await h.graph.call('fit');
    await new Promise((r) => setTimeout(r, 150));
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
    const text = (/** @type {any} */ el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    const partOf = (/** @type {string} */ type) => q('#lolcomputer .graph-part[data-type="' + type + '"]');
    /** Does the part's CONTENT stay inside its own frame? The ports straddle the edge on purpose
     *  (that is what makes them grabbable), so they are not content. */
    const spill = (/** @type {any} */ el) => {
        if (!el) return null;
        const outer = el.getBoundingClientRect();
        let worst = 0;
        for (const child of Array.from(el.querySelectorAll('*'))) {
            const node = /** @type {any} */ (child);
            if (node.closest('.graph-port')) continue;
            const r = node.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            worst = Math.max(worst, Math.round(r.right - outer.right), Math.round(r.bottom - outer.bottom));
        }
        return worst;
    };
    const codeEl = partOf('code');
    const renderEl = partOf('render');
    const fileEl = partOf('file');
    // The tile IS the <img> (hidden until a run produces a picture), not a box around one.
    const tile = renderEl ? renderEl.querySelector('.graph-render-tile') : null;
    const img = tile && tile.tagName === 'IMG' && !(/** @type {any} */ (tile).hidden) ? tile : null;
    return {
        theme: document.documentElement.className,
        canvasRect: rect(q('#lolcomputer .graph-canvas')),
        parts: Array.from(document.querySelectorAll('#lolcomputer .graph-part')).map((el) => ({
            type: el.getAttribute('data-type'),
            state: el.getAttribute('data-state'),
            rect: rect(el),
            transform: getComputedStyle(el).transform,
            spill: spill(el),
        })),
        code: codeEl ? {
            editor: text(codeEl.querySelector('.graph-code-text')).slice(0, 40),
            editorValue: (/** @type {any} */ (codeEl.querySelector('.graph-code-text')) || {}).value || '',
            editorRect: rect(codeEl.querySelector('.graph-code-text')),
            value: text(codeEl.querySelector('.graph-value')),
            lineChip: seen(codeEl.querySelector('.graph-code-line')),
            chain: (() => {
                const out = [];
                let n = codeEl.querySelector('.graph-code-text');
                while (n && n !== codeEl.parentElement) {
                    const cs = getComputedStyle(n);
                    out.push(n.className + ':' + Math.round(n.getBoundingClientRect().height)
                        + ' d=' + cs.display + ' f=' + cs.flex + ' mh=' + cs.minHeight + ' oy=' + cs.overflowY);
                    n = n.parentElement;
                }
                return out;
            })(),
        } : null,
        render: renderEl ? {
            tileRect: rect(tile),
            hasImage: !!img,
            imgSrc: img ? String(/** @type {any} */ (img).src).slice(0, 22) : '',
            imgRect: rect(img),
            tools: Array.from(renderEl.querySelectorAll('.graph-render-save'))
                .filter((b) => seen(b)).map((b) => text(b)),
            toolsSeen: seen(renderEl.querySelector('.graph-render-tools')),
            sizeSeen: seen(renderEl.querySelector('.graph-render-size')),
        } : null,
        file: fileEl ? {
            wrote: text(fileEl.querySelector('.graph-file-wrote')),
            wroteSeen: seen(fileEl.querySelector('.graph-file-wrote')),
            reveal: text(fileEl.querySelector('.graph-file-reveal')),
            revealSeen: seen(fileEl.querySelector('.graph-file-reveal')),
        } : null,
        toolbar: {
            tidy: text(q('#lolcomputer .graph-tidy')),
            tidySeen: seen(q('#lolcomputer .graph-tidy')),
            exportBtn: text(q('#lolcomputer .graph-export')),
            exportSeen: seen(q('#lolcomputer .graph-export')),
            importBtn: text(q('#lolcomputer .graph-import')),
            importSeen: seen(q('#lolcomputer .graph-import')),
            expanded: (q('#lolcomputer .graph-export') || { getAttribute: () => null }).getAttribute('aria-expanded'),
        },
        popover: {
            seen: seen(q('#lolcomputer .graph-export-menu')),
            rect: rect(q('#lolcomputer .graph-export-menu')),
            values: text(q('#lolcomputer .graph-export-values')),
            note: text(q('#lolcomputer .graph-export-note')),
            save: text(q('#lolcomputer .graph-export-save')),
        },
        wires: Array.from(document.querySelectorAll('#lolcomputer .graph-wires path')).map((p) => (p.getAttribute('d') || '').slice(0, 20)),
        docScrollX: document.documentElement.scrollWidth,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        formRect: rect(q('#chat-form')),
    };
};

/** The frozen layout every Computer picture still has to honour. */
function checkFrame(/** @type {any} */ h, /** @type {any} */ m, /** @type {string} */ theme) {
    h.eq(m.theme, theme, 'the <html> class did not switch');
    h.assert(m.canvasRect && m.canvasRect.h > 200, 'the canvas is only ' + (m.canvasRect && m.canvasRect.h) + ' px tall');
    h.eq(m.parts.length, 4, 'four parts should be painted (' + m.parts.length + ')');
    for (const p of m.parts) {
        h.eq(p.transform, 'none', p.type + ' carries a transform — only .graph-layer may (perf contract)');
        h.assert(p.rect.w > 60 && p.rect.h > 30, p.type + ' collapsed to ' + p.rect.w + 'x' + p.rect.h);
        h.assert(p.spill <= 2, p.type + ' spills ' + p.spill + ' px out of its own frame');
    }
    h.eq(m.wires.length, 3, 'three wires should be drawn (' + JSON.stringify(m.wires) + ')');
    h.assert(m.docScrollX <= m.viewportW, 'the page scrolls sideways (' + m.docScrollX + ' > ' + m.viewportW + ')');
    h.assert(m.formRect.y + m.formRect.h <= m.viewportH + 1, 'the composer is not inside the viewport');
    for (const key of ['tidy', 'exportBtn', 'importBtn']) {
        h.assert(m.toolbar[key].length > 0, 'the toolbar control "' + key + '" has no label');
    }
    h.assert(m.toolbar.tidySeen && m.toolbar.exportSeen && m.toolbar.importSeen,
        'a C3 toolbar control is not visible: ' + JSON.stringify(m.toolbar));
}

/** The three new parts, as a reader sees them after one run. */
function checkParts(/** @type {any} */ h, /** @type {any} */ m) {
    h.assert(m.code, 'no Code part was painted');
    h.assert(m.code.editorValue.includes('split'), 'the editor does not show the code that ran: ' + m.code.editorValue.slice(0, 40));
    h.assert(m.code.editorRect.h > 40, 'the code editor is only ' + m.code.editorRect.h + ' px tall: ' + JSON.stringify(m.code.chain));
    h.assert(/3 lines/.test(m.code.value), 'Code shows no computed answer, got "' + m.code.value + '"');
    h.eq(m.code.lineChip, false, 'the error-line chip is showing on a part that succeeded');

    h.assert(m.render, 'no Render part was painted');
    h.assert(m.render.hasImage, 'Render shows no picture at all');
    h.assert(m.render.imgSrc.startsWith('data:image/'), 'the tile is not an image: "' + m.render.imgSrc + '"');
    h.assert(m.render.imgRect.w > 40 && m.render.imgRect.h > 30,
        'the picture is ' + m.render.imgRect.w + 'x' + m.render.imgRect.h + ' px — nothing is readable there');
    h.assert(m.render.toolsSeen, 'the save buttons are not visible under a picture');
    // A markdown snapshot is a PNG and nothing else — "save as SVG" is offered only when the
    // picture WAS an SVG, because that is the only time the exported bytes are the source.
    h.eq(m.render.tools.length, 1, 'a PNG snapshot should offer exactly one save: ' + JSON.stringify(m.render.tools));
    h.assert(/png/i.test(m.render.tools[0]), 'and it should say PNG, got "' + m.render.tools[0] + '"');
    h.assert(m.render.sizeSeen, 'the width/height fields are not visible');

    h.assert(m.file, 'no File part was painted');
    h.assert(m.file.wroteSeen, 'the File part does not say where it wrote');
    h.assert(m.file.wrote.includes('out/open-day.md'), 'and it does not name the path: "' + m.file.wrote + '"');
    h.assert(!/[A-Za-z]:\\/.test(m.file.wrote), 'the part shows an absolute Windows path: "' + m.file.wrote + '"');
    h.assert(m.file.revealSeen && m.file.reveal.length > 0, 'Reveal is not offered on a file that was written');
}

/** The export popover: the one checkbox, what it warns about, and the one button out of it. */
function checkPopover(/** @type {any} */ h, /** @type {any} */ m) {
    h.eq(m.toolbar.expanded, 'true', 'the export button does not report itself expanded');
    h.assert(m.popover.seen, 'the export popover is not visible');
    h.assert(m.popover.rect.h > 40 && m.popover.rect.w > 140,
        'the popover collapsed to ' + m.popover.rect.w + 'x' + m.popover.rect.h);
    h.assert(m.popover.rect.x >= 0 && m.popover.rect.x + m.popover.rect.w <= m.viewportW + 1,
        'the popover hangs off the window: ' + JSON.stringify(m.popover.rect));
    h.assert(m.popover.values.length > 0, 'the popover has no label on its one choice');
    h.assert(m.popover.note.length > 0, 'nothing says what including the values costs');
    h.assert(m.popover.save.length > 0, 'the popover has no save button');
}

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
    const shot = await h.screenshot(name);
    h.assert(!!shot, name + ': no screenshot was produced');
    const size = fs.statSync(shot).size;
    h.assert(size > 4000, name + ': the screenshot is only ' + size + ' bytes — the window painted nothing');
    h.note('screenshot ' + path.basename(shot) + ' (' + size + ' bytes)');
}

/** Both pictures in one theme: the three parts after a run, then the export popover. */
async function shootTheme(/** @type {any} */ h, /** @type {string} */ theme) {
    await buildScene(h);
    await h.eval((cls) => { document.documentElement.className = cls; return true; }, theme);
    const zoom = await settle(h, 'split', 320);

    const parts = await h.eval(inspect);
    checkFrame(h, parts, theme);
    checkParts(h, parts);
    h.note(theme + ' parts: zoom ' + Math.round(zoom * 100) + '% · code "' + parts.code.value
        + '" · picture ' + parts.render.imgRect.w + 'x' + parts.render.imgRect.h
        + ' · file "' + parts.file.wrote + '"');
    await shoot(h, 'c3-shots-' + theme + '-parts');

    // The export popover, over the same canvas.
    await h.click('#lolcomputer .graph-export');
    await h.waitFor(() => {
        const el = /** @type {any} */ (document.querySelector('#lolcomputer .graph-export-menu'));
        return el && !el.hidden ? true : null;
    }, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 120));

    const open = await h.eval(inspect);
    checkFrame(h, open, theme);
    checkPopover(h, open);
    h.note(theme + ' export: "' + open.popover.values + '" · "' + open.popover.note + '" · button "' + open.popover.save + '"');
    await shoot(h, 'c3-shots-' + theme + '-export');
}

export default [
    {
        name: 'c3-shots-dark',
        needsMock: true,
        needsProjects: 'real',
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: (/** @type {any} */ h) => shootTheme(h, 'dark'),
    },
    {
        name: 'c3-shots-light',
        needsMock: true,
        needsProjects: 'real',
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
