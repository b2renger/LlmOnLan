// @ts-check
// K4-U4 in the real browser: the warmed-up look (COMPUTER_PLAN §9) and the three annotation parts
// (§6.7), measured before they are photographed.
//
// THE ACCEPTANCE THIS UNIT OWES, verbatim from §11 K4-U3 revision 2:
//   · `chat-lint` still reports 0 colour literals                        (a gate, not a scenario)
//   · the FOUR kind hues are measurably distinct in BOTH themes and all FIVE kinds carry their
//     glyph — colour PLUS glyph, because tokens.css makes `--blue` grey in both themes, so a
//     five-hue assertion would fail honestly
//   · sticky / section / title never enter a run set and never appear in the plan
//   · the shots scenario MEASURES before it photographs (nothing spills its frame, ports excepted)
//
// The kind gate is also what GUARDS css/computer-look.css's kind map. The canvas writes no
// `data-kind` on a port (graph/canvas.mjs is integrator-owned this phase), so the sheet mirrors
// the catalogue — and `kinds()` below re-derives the same expectation from the LIVE specs, so the
// day a part's `output` or `accepts[0]` changes and the sheet does not, this fails loudly instead
// of quietly painting the wrong colour.

import fs from 'node:fs';
import path from 'node:path';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The five kinds §9 names, in the order its table names them. */
const KINDS = ['text', 'list', 'json', 'image', 'file'];
/** The four that must be told apart by HUE (`file` is a desaturated rose off `--danger`). */
const HUED = ['text', 'list', 'json', 'image'];
/** Two colours count as distinct when one channel differs by this much. Chosen well under the
 *  smallest real gap in either theme (78 in dark, amber↔danger in light is larger still). */
const MIN_CHANNEL_GAP = 24;

const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host'].filter((k) => failed[k]);
    if (missing.length) throw new Error('k4-shots needs the REAL modules, but the loader dropped: ' + missing.join(', '));
    return true;
});

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key) =>
    h.eval((k) => window.LolComputer.app.t(k), key);

/** The Computer, shown, with a document open and an empty mock log. */
async function open(/** @type {any} */ h) {
    await h.fresh();
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();
    return true;
}

/** One animation frame, twice — the canvas paints on its own rAF. */
const settle = (/** @type {any} */ h) => h.eval(() => new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
}));

/** @param {any} h @param {string} theme */
async function wear(h, theme) {
    await h.eval((t) => { document.documentElement.className = t; return true; }, theme);
    await settle(h);
}

/** Write a whole document in one apply — the same door k3-canvas and perf-graph build with. */
const buildDoc = (/** @type {any} */ h, /** @type {any} */ plan) => h.eval((p) => {
    const dbg = window.LolComputer.debug.computer;
    const session = dbg.session();
    const app = session.app;
    const base = session.doc();
    /** @type {Record<string, string>} */ const ids = {};
    const parts = p.parts.map((/** @type {any} */ row) => {
        const spec = session.specs.get(row.type);
        if (!spec) throw new Error('no spec for ' + row.type);
        const size = spec.size || { w: 220, h: 120 };
        const id = app.newId();
        ids[row.name] = id;
        return {
            id,
            type: row.type,
            x: row.x,
            y: row.y,
            w: row.w || size.w,
            h: row.h || size.h,
            settings: Object.assign(typeof spec.defaults === 'function' ? spec.defaults() : {}, row.settings || {}),
            value: null,
            state: 'idle',
            error: null,
            stats: null,
        };
    });
    const wires = (p.wires || []).map((/** @type {any} */ w) => {
        /** @type {any} */ const wire = { id: app.newId(), from: ids[w.from], to: ids[w.to], port: w.port };
        if (w.label) wire.label = w.label;
        return wire;
    });
    session.apply({ ...base, parts, wires, rev: (base.rev || 1) + 1 }, { label: 'k4-shots' });
    return ids;
}, plan);

/** One of EVERY loadable part type, laid out on a grid, so every port in the catalogue is painted
 *  at once. `specMap()` is what `session.specs` holds, legacy rows included. */
const placeEveryType = (/** @type {any} */ h) => h.eval(() => {
    const dbg = window.LolComputer.debug.computer;
    const session = dbg.session();
    const app = session.app;
    const base = session.doc();
    const types = Array.from(session.specs.keys()).sort();
    const parts = types.map((/** @type {any} */ type, /** @type {number} */ i) => {
        const spec = session.specs.get(type);
        const size = spec.size || { w: 220, h: 120 };
        return {
            id: app.newId(),
            type,
            x: 60 + (i % 5) * 320,
            y: 60 + Math.floor(i / 5) * 280,
            w: size.w,
            h: size.h,
            settings: typeof spec.defaults === 'function' ? spec.defaults() : {},
            value: null,
            state: 'idle',
            error: null,
            stats: null,
        };
    });
    session.apply({ ...base, parts, wires: [], rev: (base.rev || 1) + 1 }, { label: 'k4-kinds' });
    return types;
});

/** Every port on the canvas: the kind the CATALOGUE says it is, beside the colour and glyph the
 *  SHEET gave it. The expectation is re-derived from the live spec on purpose — see the header. */
const kinds = (/** @type {any} */ h) => h.eval(() => {
    const session = window.LolComputer.debug.computer.session();
    // Chromium serialises a color-mix(in oklab, …) as `oklab(…)`, not as `rgb()`, so two tints
    // compared as text would look identical on the wrong scale. One 1×1 canvas resolves every
    // computed colour to the sRGB bytes a person actually sees.
    const probe = /** @type {any} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
    const toRgb = (/** @type {string} */ v) => {
        probe.fillStyle = '#000';
        probe.fillStyle = v;
        probe.fillRect(0, 0, 1, 1);
        const d = probe.getImageData(0, 0, 1, 1).data;
        return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
    };
    /** @type {any[]} */ const out = [];
    for (const el of Array.from(document.querySelectorAll('#lolcomputer .graph-part'))) {
        const node = /** @type {any} */ (el);
        const type = node.getAttribute('data-type');
        const spec = session.specs.get(type);
        if (!spec) continue;
        for (const p of Array.from(node.querySelectorAll('.graph-port'))) {
            const port = /** @type {any} */ (p);
            const dir = port.getAttribute('data-dir');
            const name = port.getAttribute('data-port');
            let want;
            if (dir === 'out') {
                want = spec.output || 'any';
            } else {
                const decl = (spec.inputs || []).find((/** @type {any} */ x) => x.name === name);
                const accepts = decl && Array.isArray(decl.accepts) ? decl.accepts : [];
                want = accepts.length ? accepts[0] : 'any';
            }
            out.push({
                type,
                dir,
                port: name,
                want,
                bg: toRgb(getComputedStyle(port).backgroundColor),
                glyph: getComputedStyle(port, '::after').content,
                w: Math.round(port.getBoundingClientRect().width),
                h: Math.round(port.getBoundingClientRect().height),
            });
        }
    }
    return out;
});

/** A computed colour → [r,g,b] on 0..255. Chromium serialises a plain token as `rgb(r, g, b)` but
 *  a `color-mix(in oklab, …)` as `color(srgb 0.42 0.31 0.29)` — 0..1 floats — so a parser that
 *  read only the first form would compare a tinted sticky against a scale 255 times too small and
 *  call every tint identical. Anything unreadable throws: a colour we cannot read is a colour we
 *  cannot claim is distinct. */
function rgb(/** @type {string} */ s) {
    const text = String(s);
    const m = text.match(/-?[\d.]+/g);
    if (!m || m.length < 3) throw new Error('unreadable colour: ' + text);
    const scale = /^color\(/.test(text.trim()) ? 255 : 1;
    return [Number(m[0]) * scale, Number(m[1]) * scale, Number(m[2]) * scale];
}

/** The largest per-channel difference between two colours. */
function gap(/** @type {string} */ a, /** @type {string} */ b) {
    const x = rgb(a);
    const y = rgb(b);
    return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2]));
}

/** The whole kind gate, run once per theme. */
function checkKinds(/** @type {any} */ h, /** @type {any[]} */ ports, /** @type {string} */ theme) {
    h.assert(ports.length >= 20, `${theme}: only ${ports.length} ports were painted — that is not the catalogue`);

    // 1. One colour and one glyph PER KIND: the sheet's map and the catalogue agree everywhere.
    // Every mismatch at once, never the first one: a builder who changed a spec wants the whole
    // list of rows to fix in css/computer-look.css, not one round trip per port.
    /** @type {Record<string, {bg: string, glyph: string, where: string}>} */ const seen = {};
    /** @type {string[]} */ const drift = [];
    for (const p of ports) {
        const where = `${p.type}.${p.port}`;
        const had = seen[p.want];
        if (!had) { seen[p.want] = { bg: p.bg, glyph: p.glyph, where }; continue; }
        if (p.bg !== had.bg || p.glyph !== had.glyph) {
            drift.push(`${where} is "${p.want}" and is painted ${p.bg} ${p.glyph}, `
                + `but ${had.where} (also "${p.want}") is ${had.bg} ${had.glyph}`);
        }
    }
    h.eq(drift.length, 0, `${theme}: the sheet's kind map has drifted from the catalogue — `
        + `${drift.length} port(s): ${drift.join(' · ')}`);

    // 2. All five kinds are on the canvas, and every one of them CARRIES ITS GLYPH.
    for (const kind of KINDS) {
        h.assert(seen[kind], `${theme}: no "${kind}" port was painted — the catalogue no longer has one, `
            + `or the map lost it. Kinds seen: ${Object.keys(seen).join(', ')}`);
        const glyph = String(seen[kind].glyph || '');
        h.assert(glyph && glyph !== 'none' && glyph !== '""',
            `${theme}: the "${kind}" port carries no glyph (content: ${glyph})`);
    }
    const glyphs = KINDS.map((k) => seen[k].glyph);
    h.eq(new Set(glyphs).size, KINDS.length,
        `${theme}: the five glyphs are not five different marks: ${glyphs.join(' ')}`);

    // 3. The FOUR hues are measurably distinct — the revision-2 gate, and the reason there are
    //    four of them and not five.
    for (let i = 0; i < HUED.length; i += 1) {
        for (let j = i + 1; j < HUED.length; j += 1) {
            const d = gap(seen[HUED[i]].bg, seen[HUED[j]].bg);
            h.assert(d >= MIN_CHANNEL_GAP, `${theme}: "${HUED[i]}" (${seen[HUED[i]].bg}) and "${HUED[j]}" `
                + `(${seen[HUED[j]].bg}) differ by only ${d} on their widest channel, under the ${MIN_CHANNEL_GAP} `
                + 'this gate asks for');
        }
    }
    // `file` is the fifth: off `--danger` on purpose, so it is NOT held to the hue gate — but it
    // must still not be the same paint as `image`, or the glyph would be carrying all of it.
    h.assert(seen.file.bg !== seen.image.bg,
        `${theme}: "file" and "image" are the same colour (${seen.file.bg})`);

    // 4. §9's chunky dot: 10 px of colour inside a 2 px ring, 14 px of box.
    for (const p of ports) {
        h.assert(p.w >= 12 && p.h >= 12, `${theme}: a port on ${p.type} is only ${p.w}x${p.h} px`);
    }

    h.note(`${theme}: ` + KINDS.map((k) => `${k} ${seen[k].bg} ${seen[k].glyph}`).join(' · '));
}

/** What the look scene measures before anybody looks at it. */
const inspect = () => {
    const q = (/** @type {string} */ s) => document.querySelector(s);
    // See `kinds()` for why a canvas resolves the colour: a sticky tint is a color-mix(in oklab).
    const probe = /** @type {any} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
    const toRgb = (/** @type {string} */ v) => {
        probe.fillStyle = '#000';
        probe.fillStyle = v;
        probe.fillRect(0, 0, 1, 1);
        const d = probe.getImageData(0, 0, 1, 1).data;
        return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
    };
    const rect = (/** @type {any} */ el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
        theme: document.documentElement.className,
        canvasRect: rect(q('#lolcomputer .graph-canvas')),
        gridStep: getComputedStyle(/** @type {any} */ (q('#lolcomputer .graph'))).getPropertyValue('--graph-grid').trim(),
        parts: Array.from(document.querySelectorAll('#lolcomputer .graph-part')).map((el) => {
            const node = /** @type {any} */ (el);
            const cs = getComputedStyle(node);
            const head = node.querySelector('.graph-part-head');
            const body = node.querySelector('.graph-part-body');
            const card = node.getBoundingClientRect();
            /** @param {any} child */
            const spills = (child) => {
                if (!child) return 0;
                const r = child.getBoundingClientRect();
                return Math.round(Math.max(
                    card.left - r.left, r.right - card.right,
                    card.top - r.top, r.bottom - card.bottom,
                    0,
                ));
            };
            return {
                id: node.getAttribute('data-id'),
                type: node.getAttribute('data-type'),
                state: node.getAttribute('data-state'),
                rect: rect(node),
                radius: cs.borderTopLeftRadius,
                bg: toRgb(cs.backgroundColor),
                // A Sticky's tint is painted by its BODY, which reaches up under the title bar —
                // see css/computer-look.css for why it is not the card.
                tintBg: body ? toRgb(getComputedStyle(body).backgroundColor) : '',
                focused: document.activeElement === node,
                handle: head ? getComputedStyle(head, '::before').content : '',
                titleCase: head && head.querySelector('.graph-part-title')
                    ? getComputedStyle(head.querySelector('.graph-part-title')).textTransform : '',
                plays: node.querySelectorAll('.graph-part-play').length,
                playShown: !!head && Array.from(node.querySelectorAll('.graph-part-play'))
                    .some((b) => getComputedStyle(/** @type {any} */ (b)).display !== 'none'),
                ports: node.querySelectorAll('.graph-port').length,
                spill: Math.max(spills(head), spills(body)),
                titleFont: node.querySelector('.graph-title-text')
                    ? getComputedStyle(node.querySelector('.graph-title-text')).fontSize : '',
                text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
            };
        }),
        docScrollX: document.documentElement.scrollWidth,
        viewportW: window.innerWidth,
    };
};

function checkLook(/** @type {any} */ h, /** @type {any} */ m, /** @type {string} */ theme) {
    h.eq(m.theme, theme, 'the <html> class did not switch');
    h.assert(m.canvasRect && m.canvasRect.h > 200, 'the canvas is only ' + (m.canvasRect && m.canvasRect.h) + ' px tall');
    h.eq(m.gridStep, '24px', `§9 asks for a 24 px grid, the canvas has "${m.gridStep}"`);
    h.eq(m.parts.length, 8, 'eight boxes are in the frame: ' + JSON.stringify(m.parts.map((/** @type {any} */ p) => p.type)));

    const byType = (/** @type {string} */ t) => m.parts.filter((/** @type {any} */ p) => p.type === t);
    const work = m.parts.filter((/** @type {any} */ p) => !['sticky', 'section', 'title'].includes(p.type));

    // NOTHING SPILLS ITS FRAME — ports excepted, which is why only the head and the body are
    // measured: the port dots and their kind glyphs straddle the card edge by design (§9).
    for (const p of m.parts) {
        h.eq(p.spill, 0, `${p.type} spills ${p.spill} px out of its own card`);
        h.assert(p.rect.w > 60 && p.rect.h > 40, `a ${p.type} box collapsed to ${p.rect.w}x${p.rect.h}`);
    }

    // §9's part card: 14 px radius, the type name in caps, its own ▶.
    for (const p of work) {
        h.eq(p.radius, '14px', `a ${p.type} card has a ${p.radius} radius, §9 asks for 14px`);
        h.eq(p.titleCase, 'uppercase', `a ${p.type} card's type name is not in §9's caps`);
        h.eq(p.playShown, true, `a ${p.type} card lost its ▶`);
    }

    // The drag handle appears on the card you have REACHED, and on no other — which is what keeps
    // five hundred of them off a big canvas. The scene focuses one card before it is photographed.
    const focused = m.parts.filter((/** @type {any} */ p) => p.focused);
    h.eq(focused.length, 1, 'the scene should have exactly one card focused when it is measured');
    h.assert(focused[0].handle && focused[0].handle !== 'none' && focused[0].handle !== '""',
        `the focused ${focused[0].type} card shows no drag handle (content: ${focused[0].handle})`);
    for (const p of m.parts.filter((/** @type {any} */ x) => !x.focused)) {
        h.eq(p.handle, 'none', `an untouched ${p.type} card is drawing a handle (${p.handle}) — that is `
            + 'five hundred pseudo-elements on a big canvas');
    }

    // §6.7: the annotation parts are not run chrome. No ports, no ▶ a reader could press.
    for (const p of m.parts.filter((/** @type {any} */ x) => ['sticky', 'section', 'title'].includes(x.type))) {
        h.eq(p.ports, 0, `a ${p.type} has ${p.ports} ports — an annotation part has none`);
        h.eq(p.playShown, false, `a ${p.type} shows a ▶, which can do nothing on a part that never runs`);
    }

    // The five tints are real: two stickies with different tints are different paint, in BOTH
    // themes. This is also the only assertion that proves the tint path resolves at all.
    const stickies = byType('sticky');
    h.eq(stickies.length, 2, 'the scene should carry two stickies');
    h.assert(gap(stickies[0].tintBg, stickies[1].tintBg) >= 4,
        `${theme}: the two sticky tints differ by only ${gap(stickies[0].tintBg, stickies[1].tintBg)} `
        + `(${stickies[0].tintBg} vs ${stickies[1].tintBg}) — invisible`);

    // A Title at size L is visibly a heading, not a line of body text.
    const titleFont = parseFloat(byType('title')[0].titleFont);
    h.assert(titleFont >= 30, `the Title at size "l" is only ${titleFont}px`);

    h.assert(m.docScrollX <= m.viewportW, `the page scrolls sideways (${m.docScrollX} > ${m.viewportW})`);
}

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
    const shot = await h.screenshot(name);
    h.assert(!!shot, name + ': no screenshot was produced');
    const size = fs.statSync(shot).size;
    h.assert(size > 4000, name + ': the screenshot is only ' + size + ' bytes — the window painted nothing');
    h.note('screenshot ' + path.basename(shot) + ' (' + size + ' bytes)');
}

/** The scene §9 is photographed with: a named region, a heading, two notes for the reader, and a
 *  three-part chain that has actually run, so the wires, the ports and the states are all real. */
async function buildScene(/** @type {any} */ h) {
    await open(h);
    const ids = await buildDoc(h, {
        parts: [
            { name: 'head', type: 'title', x: 30, y: 10, settings: { text: 'Reading week', size: 'l' } },
            { name: 'zone', type: 'section', x: 20, y: 110, w: 300, h: 300, settings: { text: 'Research' } },
            { name: 'brief', type: 'note', x: 50, y: 170, settings: { text: 'A museum wants a quiet hour.' } },
            { name: 'draft', type: 'ask', x: 360, y: 170, settings: { instruction: 'Draft the announcement.', model: 'mock-echo' } },
            { name: 'gather', type: 'collect', x: 700, y: 170, settings: {} },
            { name: 'shots', type: 'code', x: 30, y: 470, settings: {} },
            { name: 'why', type: 'sticky', x: 560, y: 470, settings: { text: 'Two sentences, warm.', colour: 'yellow' } },
            { name: 'todo', type: 'sticky', x: 780, y: 470, settings: { text: 'Ask the front desk first.', colour: 'green' } },
        ],
        wires: [
            { from: 'brief', to: 'draft', port: 'in', label: 'brief' },
            { from: 'draft', to: 'gather', port: 'items' },
        ],
    });
    await settle(h);
    return ids;
}

/** REACH for one card, so the picture carries §9's drag handle and its focus ring. */
async function reach(/** @type {any} */ h, /** @type {string} */ id) {
    await h.eval((want) => {
        const el = /** @type {any} */ (document.querySelector(`#lolcomputer .graph-part[data-id="${want}"]`));
        if (!el) throw new Error('no card for ' + want);
        el.focus();
        return true;
    }, id);
    await settle(h);
}

export default [
    {
        // The kind gate, both themes, against the LIVE catalogue.
        name: 'k4-shots-kinds',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const types = await placeEveryType(h);
            await settle(h);
            h.assert(types.length >= 20, `only ${types.length} part types are loadable`);

            await wear(h, 'dark');
            checkKinds(h, await kinds(h), 'dark');

            await wear(h, 'light');
            checkKinds(h, await kinds(h), 'light');

            await wear(h, 'dark');
        },
    },

    {
        // §6.7: the three annotation parts never enter a run set and never cost anything.
        name: 'k4-shots-annotations-never-run',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const ids = await buildDoc(h, {
                parts: [
                    { name: 'brief', type: 'note', x: 40, y: 40, settings: { text: 'one' } },
                    { name: 'gather', type: 'collect', x: 320, y: 40, settings: {} },
                    { name: 'note1', type: 'sticky', x: 40, y: 260, settings: { text: 'a note for the reader' } },
                    { name: 'zone', type: 'section', x: 320, y: 260, settings: { text: 'Research' } },
                    { name: 'head', type: 'title', x: 820, y: 40, settings: { text: 'Reading week' } },
                ],
                wires: [{ from: 'brief', to: 'gather', port: 'items' }],
            });
            await settle(h);

            const report = await h.computer.run({});
            h.eq(report.ran, 2, `the run touched ${report.ran} parts — the three annotation parts must not be `
                + 'in the active set (§6.7, and topo.mjs activeSet() is the one place that decides it)');
            h.eq((report.errors || []).length, 0, 'an annotation part made the run fail: '
                + JSON.stringify(report.errors || []));

            const seen = await h.computer.states();
            const state = (/** @type {string} */ name) =>
                (seen.parts.find((/** @type {any} */ p) => p.id === ids[name]) || {}).state;
            h.eq(state('brief'), 'done', 'the Text box did not run');
            h.eq(state('gather'), 'done', 'the Collect did not run');
            for (const name of ['note1', 'zone', 'head']) {
                h.eq(state(name), 'idle', `${name} came out of a run as "${state(name)}" — an inert part is never `
                    + 'queued, never run and never done');
            }

            // And nothing they hold ever becomes a value: `quiet` + `output: null` means there is
            // no chip to open and nothing to carry into an export.
            const doc = await h.computer.doc();
            for (const name of ['note1', 'zone', 'head']) {
                const part = doc.parts.find((/** @type {any} */ p) => p.id === ids[name]);
                h.eq(part.value, null, `${name} produced a value`);
            }

            // The tint is a real, undoable edit — the one piece of state a Sticky has.
            await h.eval((id) => {
                const el = document.querySelector(`#lolcomputer .graph-sticky-tint[data-part="${id}"][data-tint="rose"]`);
                if (!el) throw new Error('no rose swatch on the sticky');
                /** @type {any} */ (el).click();
                return true;
            }, ids.note1);
            await settle(h);
            const tinted = await h.computer.doc();
            h.eq((tinted.parts.find((/** @type {any} */ p) => p.id === ids.note1) || {}).settings.colour, 'rose',
                'pressing a swatch did not change the tint');
            await h.computer.undo();
            const back = await h.computer.doc();
            h.eq((back.parts.find((/** @type {any} */ p) => p.id === ids.note1) || {}).settings.colour, 'yellow',
                'the tint change did not enter undo history');

            // The Title's three sizes are the same shape of edit.
            await h.eval((id) => {
                const el = document.querySelector(`#lolcomputer .graph-title-size[data-part="${id}"][data-size="l"]`);
                if (!el) throw new Error('no size control on the title');
                /** @type {any} */ (el).click();
                return true;
            }, ids.head);
            await settle(h);
            const sized = await h.computer.doc();
            h.eq((sized.parts.find((/** @type {any} */ p) => p.id === ids.head) || {}).settings.size, 'l',
                'pressing a size did not change the Title');

            // Their labels are the words §6.7 uses, resolved by the page and not retyped here.
            const dom = await h.eval(() => Array.from(document.querySelectorAll('#lolcomputer .graph-part'))
                .filter((el) => ['sticky', 'section', 'title'].includes(el.getAttribute('data-type') || ''))
                .map((el) => ({
                    type: el.getAttribute('data-type'),
                    label: ((el.querySelector('.graph-part-title') || {}).textContent || '').trim(),
                })));
            h.eq(dom.length, 3, 'the three annotation parts are not all on the canvas');
            h.eq((dom.find((/** @type {any} */ d) => d.type === 'sticky') || {}).label, await str(h, 'parts.stickyLabel'));
            h.eq((dom.find((/** @type {any} */ d) => d.type === 'section') || {}).label, await str(h, 'parts.sectionLabel'));
            h.eq((dom.find((/** @type {any} */ d) => d.type === 'title') || {}).label, await str(h, 'parts.titleLabel'));
        },
    },

    {
        name: 'k4-shots-dark',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            const ids = await buildScene(h);
            await h.computer.run({});
            await reach(h, ids.brief);
            await wear(h, 'dark');
            const m = await h.eval(inspect);
            checkLook(h, m, 'dark');
            h.note('dark: ' + JSON.stringify(m.parts.map((/** @type {any} */ p) => p.type + ':' + p.state)));
            await shoot(h, 'k4-shots-dark');
        },
    },

    {
        name: 'k4-shots-light',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            const ids = await buildScene(h);
            await h.computer.run({});
            await reach(h, ids.brief);
            try {
                await wear(h, 'light');
                const m = await h.eval(inspect);
                checkLook(h, m, 'light');
                h.note('light: ' + JSON.stringify(m.parts.map((/** @type {any} */ p) => p.type + ':' + p.state)));
                await shoot(h, 'k4-shots-light');
            } finally {
                await wear(h, 'dark');
            }
        },
    },
];
