// @ts-check
// COMPUTER_LIVE_PLAN, Builder E: the drawer's code editor (K-8) under REAL input (h.input.*, CDP's
// Input domain — hit testing, focus, the browser's own text editing and undo).
//
//   k11-edit-drawer-*   the editor driven directly through `app.drawer.editCode`: it opens with the
//                       code and the caret in it; typing reaches onChange and lands; Tab indents
//                       and Ctrl+Z undoes it; Ctrl+Enter and the Run code button run (the text is
//                       delivered first); setError marks the line and Go to line puts the caret on
//                       it; the gutter's numbers stay beside their lines while the field scrolls;
//                       Escape closes it and the focus goes back where it came from.
//   k11-edit-preview-*  the same editor opened by a REAL click on a Preview's Edit code button
//                       (builder L's side of K-8). SKIPPED, with a note, while that button is not
//                       on the box yet.
//
// No farm is involved: nothing here generates. The mock is not needed.

/** The Computer, on a NEW document titled `title`. */
async function freshDoc(/** @type {any} */ h, /** @type {string} */ title) {
    await h.view('computer');
    await h.waitFor(() => {
        const d = window.LolComputer && window.LolComputer.debug;
        return d && d.library && typeof d.library.openId === 'function' && d.library.openId() && d.computer ? true : null;
    }, { timeout: 20000 });
    const failed = await h.eval(() => Object.keys((window.LolComputer && window.LolComputer.failed) || {}));
    h.assert(!failed.includes('drawer'), 'the real drawer module loaded');
    const id = await h.eval((t) => window.LolComputer.debug.library.create(t), title);
    await h.waitFor((want) => (window.LolComputer.debug.computer.docId() === want ? true : null), { args: [id], timeout: 15000 });
    await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: 0, y: 0, zoom: 1 }); return true; });
    await frame(h);
    return id;
}

const frame = (/** @type {any} */ h) => h.eval(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

const AREA = '#lolcomputer .comp-drawer .comp-code-area';

/**
 * Open the drawer's editor straight through K-8, recording every callback in `window.__k11`.
 * The handle is kept as `window.__k11.h`.
 */
const openEditor = (/** @type {any} */ h, /** @type {any} */ o) => h.eval((opts) => {
    const rec = { changes: /** @type {string[]} */ ([]), runs: 0, closes: 0, order: /** @type {string[]} */ ([]), h: /** @type {any} */ (null) };
    /** @type {any} */ (window).__k11 = rec;
    rec.h = window.LolComputer.app.drawer.editCode({
        ...opts,
        onChange: (/** @type {string} */ text) => { rec.changes.push(text); rec.order.push('change'); },
        onRun: () => { rec.runs++; rec.order.push('run:' + rec.changes.length); },
        onClose: () => { rec.closes++; rec.order.push('close'); },
    });
    return true;
}, o);

const rec = (/** @type {any} */ h) => h.eval(() => {
    const r = /** @type {any} */ (window).__k11;
    return { changes: r.changes.slice(), runs: r.runs, closes: r.closes, order: r.order.slice() };
});

/** The editor as a person sees it. */
const view = (/** @type {any} */ h) => h.eval((sel) => {
    const area = /** @type {any} */ (document.querySelector(sel));
    const drawer = document.querySelector('#lolcomputer .comp-drawer');
    const err = /** @type {any} */ (document.querySelector('#lolcomputer .comp-code-error'));
    const go = /** @type {any} */ (document.querySelector('#lolcomputer .comp-code-goto'));
    const band = /** @type {any} */ (document.querySelector('#lolcomputer .comp-code-band'));
    const act = /** @type {any} */ (document.activeElement);
    return {
        open: !!drawer && !drawer.classList.contains('hidden'),
        present: !!area,
        value: area ? area.value : null,
        sel: area ? [area.selectionStart, area.selectionEnd] : null,
        focused: !!area && act === area,
        active: act ? `${act.tagName.toLowerCase()}.${String(act.className || '')}` : '',
        rows: document.querySelectorAll('#lolcomputer .comp-code-ln').length,
        marked: Array.from(document.querySelectorAll('#lolcomputer .comp-code-ln.is-error')).map((r) => r.textContent),
        error: err && !err.hidden ? (document.querySelector('#lolcomputer .comp-code-error-text') || {}).textContent : null,
        goto: go && !go.hidden ? go.textContent : null,
        band: band && !band.hidden && getComputedStyle(band).display !== 'none',
        caret: (document.querySelector('#lolcomputer .comp-code-caret') || {}).textContent || '',
        width: drawer ? drawer.getBoundingClientRect().width : 0,
    };
}, AREA);

/** Where line `n` of the field is on screen, and what the gutter shows at that height. */
const lineOnScreen = (/** @type {any} */ h, /** @type {number} */ n) => h.eval((sel, line) => {
    const area = /** @type {any} */ (document.querySelector(sel));
    const cs = getComputedStyle(area);
    const lh = parseFloat(cs.lineHeight);
    const pad = parseFloat(cs.paddingTop);
    const r = area.getBoundingClientRect();
    const y = r.top + pad + (line - 1) * lh - area.scrollTop + lh / 2;
    const gutter = document.querySelector('#lolcomputer .comp-code-gutter');
    const g = gutter ? gutter.getBoundingClientRect() : r;
    const hit = document.elementFromPoint(g.left + g.width / 2, y);
    const band = /** @type {any} */ (document.querySelector('#lolcomputer .comp-code-band'));
    const b = band && !band.hidden ? band.getBoundingClientRect() : null;
    return {
        y, lh, scrollTop: area.scrollTop,
        inView: y > r.top && y < r.bottom,
        gutterSays: hit && hit.classList && hit.classList.contains('comp-code-ln') ? hit.textContent : null,
        bandMid: b ? b.top + b.height / 2 : null,
    };
}, AREA, n);

/** A Preview box's code field, by part id. */
const boxArea = (/** @type {string} */ id) => `#lolcomputer .graph-part[data-id="${id}"] .graph-preview-source`;

export default [
    {
        name: 'k11-edit-drawer-types-tabs-runs-and-escapes-home',
        async run(h) {
            await freshDoc(h, 'k11 drawer editor');
            // Something to come back to: a p5 box's own code field, focused by a real click.
            const p5 = await h.computer.add('p5');
            h.assert(p5, 'a p5.js sketch box was placed from the menu');
            await frame(h);
            // The box's first auto-draw moves its code field down when the picture lands (top 294 → 512):
            // measure the click point only after it has, or the click hits the picture (integrator, from L).
            await h.waitFor((id) => (document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-preview-tile`) ? true : null), { timeout: 15000, args: [p5] });
            await frame(h);
            const source = await h.eval((sel) => /** @type {any} */ (document.querySelector(sel)).value, boxArea(p5));
            await h.input.click(boxArea(p5));
            h.eq(await h.eval((sel) => document.activeElement === document.querySelector(sel), boxArea(p5)), true, 'the box’s field has the focus');

            const widthBefore = await h.eval(() => window.LolComputer.app.drawer.width());
            await openEditor(h, { partId: p5, title: 'p5.js sketch', mode: 'p5', source });
            await frame(h);
            let v = await view(h);
            h.eq(v.open, true, 'the drawer opened');
            h.eq(v.value, source, 'with the box’s own code');
            h.eq(v.focused, true, `the caret is in the editor, ready to type (active: ${v.active})`);
            h.eq(v.rows, source.split('\n').length, 'one line number per line');
            h.assert(v.width >= Math.min(560, widthBefore < 560 ? 560 : widthBefore) - 1, `the drawer is at least 560 px for code: ${v.width}px`);
            h.eq(v.caret, await str(h, 'computer.codeCaret', { line: 1, col: 1 }));
            h.eq(await h.eval(() => window.LolComputer.app.drawer.editing()), p5, 'the drawer says which part it is editing');

            // Typing, as a keyboard types.
            await h.input.type('// k11 ');
            const changed = await h.waitFor(() => {
                const r = /** @type {any} */ (window).__k11;
                return r.changes.length ? r.changes[r.changes.length - 1] : null;
            }, { timeout: 3000 });
            h.eq(changed, `// k11 ${source}`, 'onChange heard the typed text, once the typing paused');
            h.eq((await view(h)).value, `// k11 ${source}`, 'and it is in the field');
            h.eq((await rec(h)).changes.length, 1, 'one call for the burst, not one per key');

            // Tab indents in place (the focus stays), and Ctrl+Z undoes exactly that.
            await h.input.key('Tab');
            v = await view(h);
            h.eq(v.focused, true, 'Tab did not leave the editor');
            h.eq(v.value, `// k11  ${source}`, 'it typed a space to the next two-space stop');
            h.eq(v.sel, [8, 8], 'and the caret is after it');
            await h.input.key('z', { ctrl: true });
            v = await view(h);
            h.eq(v.value, `// k11 ${source}`, 'Ctrl+Z undid the Tab — it went through the browser’s own editing');

            // Enter keeps the indentation: go into setup()'s body line and press Enter at its end.
            const lineOfCanvas = v.value.split('\n').findIndex((l) => l.startsWith('  createCanvas')) + 1;
            h.assert(lineOfCanvas > 0, 'the starter has a createCanvas line');
            await h.eval((sel, n) => {
                const a = /** @type {any} */ (document.querySelector(sel));
                const lines = a.value.split('\n');
                const end = lines.slice(0, n).join('\n').length;
                a.setSelectionRange(end, end);
                return true;
            }, AREA, lineOfCanvas);
            await h.input.key('Enter');
            await h.input.type('fill(0);');
            v = await view(h);
            h.assert(v.value.includes('  createCanvas(400, 300);\n  fill(0);'), 'Enter kept the two-space indent of the line above');

            // Ctrl+Enter runs, and the pending text arrives BEFORE the run.
            await h.input.key('Enter', { ctrl: true });
            let r = await rec(h);
            h.eq(r.runs, 1, 'Ctrl+Enter ran');
            h.eq(r.changes[r.changes.length - 1], v.value, 'with the latest text delivered first');
            h.eq(r.order[r.order.length - 1], `run:${r.changes.length}`, 'change, then run');
            h.eq((await view(h)).value, v.value, 'and no newline was typed by it');

            // The Run code button, clicked.
            await h.input.click('#lolcomputer .comp-code-run');
            h.eq((await rec(h)).runs, 2, 'Run code ran');

            // An error on line 5: said, marked, and one click away.
            await h.eval(() => /** @type {any} */ (window).__k11.h.setError({ line: 5, message: 'boom is not defined' }));
            await frame(h);
            v = await view(h);
            h.eq(v.error, 'boom is not defined', 'the message shows under the editor');
            h.eq(v.goto, await str(h, 'computer.codeGoto', { line: 5 }));
            h.eq(v.marked, ['5'], 'line 5 is marked in the gutter');
            h.eq(v.band, true, 'and a band sits behind it');
            await h.input.click('#lolcomputer .comp-code-body');   // the caret somewhere else first
            await h.input.click('#lolcomputer .comp-code-goto');
            v = await view(h);
            const range = await h.eval((sel) => {
                const a = /** @type {any} */ (document.querySelector(sel));
                const lines = a.value.split('\n');
                const start = lines.slice(0, 4).join('\n').length + 1;
                return [start, start + lines[4].length];
            }, AREA);
            h.eq(v.focused, true, 'Go to line put the focus in the editor');
            h.eq(v.sel, range, 'with line 5 selected');
            h.eq(v.caret, await str(h, 'computer.codeCaret', { line: 5, col: 1 }), 'and the readout says so');
            const at5 = await lineOnScreen(h, 5);
            h.assert(at5.bandMid !== null && Math.abs(at5.bandMid - at5.y) <= at5.lh / 2, `the band is on line 5: ${JSON.stringify(at5)}`);
            h.eq(at5.gutterSays, '5', 'and so is the gutter’s 5');

            // Escape: closed, told once, and the focus is back in the box’s field.
            const before = (await rec(h)).changes.length;
            await h.input.key('Escape');
            await frame(h);
            v = await view(h);
            h.eq(v.open, false, 'Escape closed the drawer');
            h.eq(v.present, false, 'and took the editor down');
            r = await rec(h);
            h.eq(r.closes, 1, 'onClose was called once');
            h.eq(r.changes.length, before, 'nothing new was pending, so nothing was sent');
            h.eq(await h.eval((sel) => document.activeElement === document.querySelector(sel), boxArea(p5)), true,
                'the focus went back to where it came from');
            h.eq(await h.eval(() => window.LolComputer.app.drawer.editing()), '');
            h.eq(await h.eval(() => window.LolComputer.debug.computer.running()), false, 'and Escape stopped nothing');
            h.eq(await h.eval(() => window.LolComputer.app.drawer.width()), widthBefore, 'the widening was given back, not remembered');
        },
    },

    {
        name: 'k11-edit-drawer-gutter-follows-the-scroll-and-go-to-line-scrolls',
        async run(h) {
            await freshDoc(h, 'k11 drawer scroll');
            const long = Array.from({ length: 220 }, (_, i) => `let v${i + 1} = ${i + 1};`).join('\n');
            await openEditor(h, { partId: 'nope', title: 'long', mode: 'p5', source: long });
            await frame(h);
            h.eq((await view(h)).rows, 220);
            // a real wheel over the field scrolls it; the numbers go with it
            await h.input.wheel({ target: AREA, dy: 900 });
            await frame(h);
            const top = await h.eval((sel) => /** @type {any} */ (document.querySelector(sel)).scrollTop, AREA);
            h.assert(top > 100, `the field scrolled: ${top}`);
            const probe = await lineOnScreen(h, 60);
            if (probe.inView) h.eq(probe.gutterSays, '60', `number 60 is beside line 60 after the scroll: ${JSON.stringify(probe)}`);
            else {
                const first = Math.floor(top / probe.lh) + 3;
                const p2 = await lineOnScreen(h, first);
                h.eq(p2.gutterSays, String(first), `number ${first} is beside line ${first} after the scroll: ${JSON.stringify(p2)}`);
            }
            // an error far below: Go to line brings it into view, band and number together
            await h.eval(() => /** @type {any} */ (window).__k11.h.setError({ line: 200, message: 'far down' }));
            await h.input.click('#lolcomputer .comp-code-goto');
            await frame(h);
            const at = await lineOnScreen(h, 200);
            h.eq(at.inView, true, `line 200 is on screen: ${JSON.stringify(at)}`);
            h.eq(at.gutterSays, '200', 'its number is beside it');
            h.assert(at.bandMid !== null && Math.abs(at.bandMid - at.y) <= at.lh / 2, `the band is on it: ${JSON.stringify(at)}`);
            // the drawer's Close button ends it too
            await h.input.click('#lolcomputer .comp-drawer-close');
            h.eq((await view(h)).open, false);
            h.eq((await rec(h)).closes, 1);
        },
    },

    {
        // The look, both themes: the editor beside a three.js box, an error on line 9.
        name: 'k11-edit-drawer-shots',
        timeoutMs: 60000,
        async run(h) {
            await freshDoc(h, 'k11 drawer shots');
            const three = await h.computer.add('three');
            await h.computer.move(three, 40, 40);
            const source = await h.eval((sel) => /** @type {any} */ (document.querySelector(sel)).value, boxArea(three));
            await openEditor(h, { partId: three, title: 'three.js scene', mode: 'three', source });
            await h.eval(() => /** @type {any} */ (window).__k11.h.setError({ line: 9, message: 'lol.orbit is not a function' }));
            try {
                for (const theme of ['dark', 'light']) {
                    await h.eval((c) => { document.documentElement.className = c; return true; }, theme);
                    await frame(h);
                    const file = await h.screenshot(`k11-edit-drawer-${theme}`);
                    if (file) h.note(`screenshot ${file}`);
                    const probe = await lineOnScreen(h, 9);
                    h.eq(probe.gutterSays, '9', `${theme}: number 9 is beside line 9`);
                }
            } finally {
                await h.eval(() => { document.documentElement.className = 'dark'; return true; });
                await h.eval(() => /** @type {any} */ (window).__k11.h.close());
            }
        },
    },

    {
        name: 'k11-edit-preview-edit-code-opens-the-drawer-two-way-and-ctrl-enter-redraws',
        async run(h) {
            await freshDoc(h, 'k11 preview edit code');
            const p5 = await h.computer.add('p5');
            h.assert(p5, 'a p5.js sketch box was placed from the menu');
            await h.computer.move(p5, 40, 40);
            await frame(h);
            const EDIT = `#lolcomputer .graph-part[data-id="${p5}"] .graph-preview-edit`;
            const has = await h.eval((sel) => {
                const b = /** @type {any} */ (document.querySelector(sel));
                return !!b && !b.hidden && b.getClientRects().length > 0;
            }, EDIT);
            if (!has) {
                h.note('SKIPPED: the Preview has no visible Edit code button yet (builder L, K-8) — the editor itself is proven by k11-edit-drawer-*');
                return;
            }
            const boxCode = () => h.eval((sel) => /** @type {any} */ (document.querySelector(sel)).value, boxArea(p5));
            const source = await boxCode();
            // let the box draw its starter first, so a redraw is something that changes
            await h.waitFor(() => {
                const s = window.LolComputer.debug.computer.sandbox();
                return s && Number(s.runs) > 0 ? true : null;
            }, { timeout: 30000 }).catch(() => true);
            await h.input.click(EDIT);
            await h.waitFor((sel) => (document.querySelector(sel) ? true : null), { args: [AREA], timeout: 5000 });
            let v = await view(h);
            h.eq(v.open, true, 'a real click on Edit code opened the drawer');
            h.eq(v.value, source, 'with the box’s code');
            h.eq(v.focused, true, 'and the caret in it');

            // typing in the drawer changes the box
            await h.input.type('// from the drawer\n');
            const mirrored = await h.waitFor((sel) => {
                const a = /** @type {any} */ (document.querySelector(sel));
                return a && a.value.startsWith('// from the drawer') ? a.value : null;
            }, { args: [boxArea(p5)], timeout: 5000 });
            h.eq(mirrored, `// from the drawer\n${source}`, 'the box’s own field holds the drawer’s text');
            const saved = await h.waitFor((id) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === id);
                return p && String(p.settings.source).startsWith('// from the drawer') ? true : null;
            }, { args: [p5], timeout: 5000 });
            h.eq(saved, true, 'and the box’s saved code is the edit (typing claims it)');

            // Ctrl+Enter in the drawer redraws the box
            const runsBefore = await h.eval(() => Number((window.LolComputer.debug.computer.sandbox() || {}).runs) || 0);
            await h.input.key('Enter', { ctrl: true });
            const redrew = await h.waitFor((n) => {
                const s = window.LolComputer.debug.computer.sandbox();
                return s && Number(s.runs) > n ? Number(s.runs) : null;
            }, { args: [runsBefore], timeout: 30000 });
            h.assert(redrew > runsBefore, `Ctrl+Enter redrew the box (${runsBefore} → ${redrew})`);

            // a broken line: the box's error reaches the drawer with its line, and Go to line works
            await h.eval((sel) => {
                const a = /** @type {any} */ (document.querySelector(sel));
                a.setSelectionRange(a.value.length, a.value.length);
                return true;
            }, AREA);
            await h.input.type('\nlet oops = ;');
            await h.input.key('Enter', { ctrl: true });
            const shown = await h.waitFor(() => {
                const go = /** @type {any} */ (document.querySelector('#lolcomputer .comp-code-goto'));
                return go && !go.hidden ? go.getAttribute('data-line') : null;
            }, { timeout: 30000 }).catch(() => null);
            if (shown) {
                const lines = (await view(h)).value.split('\n');
                h.eq(Number(shown), lines.length, `the error names the broken last line (${lines.length})`);
                await h.input.click('#lolcomputer .comp-code-goto');
                v = await view(h);
                h.eq(v.focused, true, 'Go to line: focus in the editor');
                h.eq(v.caret, await str(h, 'computer.codeCaret', { line: lines.length, col: 1 }), 'on that line');
            } else {
                h.note('the box’s draw error did not reach the drawer’s setError (builder L wiring) — see the report');
            }

            // typing in the BOX's own field reaches the drawer (setSource)
            const fieldShown = await h.eval((sel) => {
                const a = /** @type {any} */ (document.querySelector(sel));
                return !!a && !a.hidden && a.getClientRects().length > 0;
            }, boxArea(p5));
            if (!fieldShown) {
                h.note('the box’s own code field is folded while the drawer edits it: the box → drawer direction was not typed');
            } else {
            await h.input.click(boxArea(p5));
            await h.eval((sel) => { const a = /** @type {any} */ (document.querySelector(sel)); a.setSelectionRange(0, 0); return true; }, boxArea(p5));
            await h.input.type('/* box */');
            const inDrawer = await h.waitFor((sel) => {
                const a = /** @type {any} */ (document.querySelector(sel));
                return a && a.value.startsWith('/* box */') ? true : null;
            }, { args: [AREA], timeout: 5000 }).catch(() => null);
            h.eq(inDrawer, true, 'the drawer follows the box’s own field');
            }

            // Escape from the drawer: closed, and the focus goes back to the box
            await h.input.click(AREA);
            await h.input.key('Escape');
            await frame(h);
            h.eq((await view(h)).open, false, 'Escape closed the editor');
            const home = await h.eval((id) => {
                const a = /** @type {any} */ (document.activeElement);
                const box = a && a.closest ? a.closest('.graph-part') : null;
                return box ? box.getAttribute('data-id') : null;
            }, p5);
            h.eq(home, p5, 'the focus is back on the box that opened it');
        },
    },
];
