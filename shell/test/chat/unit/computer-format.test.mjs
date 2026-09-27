// @ts-check
// K4-U3 in Node: the Preview family (COMPUTER_PLAN §6.5, §6.8; K4 addendum KD-6).
//
// What a unit test can prove about Preview, and what it cannot:
//   CAN — which mode `auto` resolves to and that it reads only the DECLARED facet, that markdown
//         and SVG never reach for the guest, what the guest is handed for html/three/p5, every
//         refusal sentence (including the frozen one, with the arriving kind in it), the size
//         clamp, what "Save…" would write, and that a drawing is RUNTIME state the box can be
//         asked for by id.
//   CANNOT — that no iframe was created (that is a count in a real browser: k4-preview.mjs), that
//         the markdown really lays out, or that a picture really comes back from a guest.
//
// The sandbox is faked by hand rather than booted: what is under test is the PART's half of the
// contract — what it sends, and what it does with each of the answers it can get back.

import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import {
  PREVIEW_MODES, FREE_MODES, SANDBOX_MODES, MAX_TILE_BYTES, MAX_SHOWN, MIN_SIZE, MAX_SIZE,
  PAGE_CSS, readSettings, modeFor, kindLabel, contentOf, svgDataUrl, sandboxMessage,
  shownOf, setShown, clearShown,
} from '../../../renderer/chat/graph/parts/preview.mjs';

const SPECS = specMap();
const NL = String.fromCharCode(10);
const PREVIEW = SPECS.get('preview');

/** Run `fn` with the unit runner's DOM shim installed as `globalThis.document`. */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
  }
}

/** A sandbox host as the parts see it, with every call recorded. */
function fakeSandbox(answers = {}) {
  const calls = { compute: [], run: [], snapshot: [] };
  return {
    calls,
    async compute(req) { calls.compute.push(req); return { ok: true, ms: 1, json: 'null', error: null }; },
    async run(req) {
      calls.run.push(req);
      const a = answers.run;
      const out = typeof a === 'function' ? a(req) : a;
      return out || { ok: true, ms: 1, error: null };
    },
    async snapshot(o) {
      calls.snapshot.push(o);
      const a = answers.snapshot;
      const out = typeof a === 'function' ? a(o) : a;
      return out === undefined ? { dataUrl: 'data:image/png;base64,AAAA', w: 320, h: 240 } : out;
    },
    mount() {}, state: () => 'ready', ready: async () => true, logs: () => [], errors: () => [],
    runs: () => calls.run.length, params() {}, stop() {}, hide() {}, destroy() {},
    on: () => () => {}, debug: () => ({}),
  };
}

let seq = 0;
const part = (settings, extra = {}) => ({
  id: `pv-${++seq}`, type: 'preview', x: 0, y: 0, w: 320, h: 260, settings, value: null,
  state: 'idle', error: null, stats: null, ...extra,
});

/** A RunInput. `ask` THROWS: Preview spends no generations, ever. */
function runInput(p, content, o = {}) {
  const sandbox = o.sandbox === null ? null : (o.sandbox || fakeSandbox());
  return {
    input: {
      part: p,
      inputs: { content },
      labels: { content: content.map(() => '') },
      app: o.app || { now: () => 1000 },
      ask: () => { throw new Error('Preview asked the farm — a window spends no generations'); },
      signal: new AbortController().signal,
      thread: null,
      cache: true,
      item: o.item || null,
      sandbox: o.sandbox === null ? null : async () => sandbox,
    },
    sandbox,
  };
}

/** The message a run() threw. */
async function failureOf(input) {
  try {
    await PREVIEW.run(input);
  } catch (err) {
    return { message: String(err.message), reason: /** @type {any} */ (err).reason };
  }
  return null;
}

export default (test) => {
  // ------------------------------------------------------------------------------- declarations

  test('Preview declares a window, not a source: one content port, no output, and quiet', () => {
    assert.ok(PREVIEW, 'preview is in the catalogue');
    assert.equal(PREVIEW.type, 'preview');
    assert.equal(PREVIEW.output, null, 'a window publishes nothing — §6.5');
    assert.equal(PREVIEW.quiet, true, 'it draws its own value, so the canvas strip would say it twice');
    assert.equal(PREVIEW.thinks, false, 'it spends no generation');
    assert.equal(PREVIEW.inputs.length, 1);
    assert.equal(PREVIEW.inputs[0].name, 'content');
    assert.deepEqual(PREVIEW.inputs[0].accepts, ['text', 'json'], 'KD-6 freezes the port');
    assert.deepEqual([...PREVIEW_MODES], ['auto', 'markdown', 'svg', 'html', 'three', 'p5']);
    assert.deepEqual([...FREE_MODES], ['markdown', 'svg'], 'the two that cost nothing');
    assert.deepEqual([...SANDBOX_MODES], ['html', 'three', 'p5'], 'the three that need the guest');
    // `render` is out of the palette but still LOADABLE, so a C3 graph opens (KD-6).
    assert.ok(SPECS.get('render'), 'the legacy Render still loads');
  });

  test('the settings clamp: an unknown mode is `auto`, a silly size is a real one', () => {
    assert.deepEqual(readSettings(null), { mode: 'auto', w: 320, h: 240, live: false });
    assert.deepEqual(readSettings({ mode: 'nope', w: 9, h: 99999 }), { mode: 'auto', w: MIN_SIZE, h: MAX_SIZE, live: false });
    assert.equal(readSettings({ mode: 'three' }).mode, 'three');
    assert.equal(readSettings({ live: true }).live, true);
  });

  // ------------------------------------------------------------------------- `auto`, never sniffed

  test('`auto` reads the DECLARED facet and never sniffs the bytes', () => {
    assert.equal(modeFor('auto', valueOf('text', 'hello')), 'markdown', 'undeclared prose reads as markdown');
    assert.equal(modeFor('auto', valueOf('text', '# hi', { format: 'markdown' })), 'markdown');
    assert.equal(modeFor('auto', valueOf('text', '<svg/>', { format: 'svg' })), 'svg');
    assert.equal(modeFor('auto', valueOf('text', '<h1>x</h1>', { format: 'html' })), 'html');
    assert.equal(modeFor('auto', null), 'markdown', 'nothing declared, nothing guessed');
    // THE RULE §6.5 exists for: a report that QUOTES an SVG is still a report.
    const quoting = valueOf('text', 'Here is the logo:\n\n<svg width="10"></svg>\n', { format: 'markdown' });
    assert.equal(modeFor('auto', quoting), 'markdown', 'the bytes start with <svg somewhere — and are ignored');
    const undeclared = valueOf('text', '<svg width="10"></svg>');
    assert.equal(modeFor('auto', undeclared), 'markdown', 'an undeclared SVG is NOT sniffed into svg mode');
    // A Code part's output format is its picker's answer, and a picked mode always wins.
    assert.equal(modeFor('svg', undeclared), 'svg', 'the picker beats the facet');
    assert.equal(modeFor('p5', valueOf('text', 'x', { format: 'markdown' })), 'p5');
    assert.equal(modeFor('rubbish', valueOf('text', 'x', { format: 'svg' })), 'svg', 'an unknown setting falls back to auto');
  });

  test('several wires into one port is a join, and the facet is the first arrival’s', () => {
    const joined = contentOf([valueOf('text', 'one', { format: 'markdown' }), valueOf('json', { a: 1 })]);
    assert.equal(joined.text, 'one\n\n{\n  "a": 1\n}', 'separated by a blank line: a paragraph break in markdown');
    assert.equal(joined.value.format, 'markdown');
    assert.deepEqual(contentOf([]), { text: '', value: null });
    assert.deepEqual(contentOf(/** @type {any} */ ([null, 'not a value'])), { text: '', value: null });
  });

  // ------------------------------------------------------------------------ the two free modes

  test('markdown is drawn here: no guest, no snapshot, and the source survives for the export', async () => {
    const p = part({ mode: 'markdown' });
    const { input, sandbox } = runInput(p, [valueOf('text', '# Hello'), valueOf('json', { a: 1 })]);
    assert.equal(await PREVIEW.run(input), null, 'a window returns no value — §6.5, BH-6');
    assert.equal(sandbox.calls.run.length, 0, 'markdown NEVER reaches for the guest');
    assert.equal(sandbox.calls.snapshot.length, 0);
    const shot = shownOf(p.id);
    assert.equal(shot.mode, 'markdown');
    assert.ok(shot.text.includes('# Hello'), 'the markdown is kept as text, not as HTML');
    assert.ok(shot.text.includes('"a": 1'), 'both wires are in it, in order');
    assert.equal(shot.at, 1000, 'stamped from app.now(), so a repaint can tell one run from the next');
  });

  test('an SVG is sanitised, kept as bytes, and never rasterised', async () => {
    const p = part({ mode: 'svg' });
    const source = '<svg width="20" height="10"><script>x()</script><rect width="5" height="5"/></svg>';
    const { input, sandbox } = runInput(p, [valueOf('text', source)]);
    await PREVIEW.run(input);
    assert.equal(sandbox.calls.run.length, 0, 'a vector picture needs no guest — and no rasterising');
    const shot = shownOf(p.id);
    assert.equal(shot.mode, 'svg');
    assert.ok(!/<script/.test(shot.svg), 'what is shown AND exported is the sanitised document');
    assert.ok(/<rect/.test(shot.svg), 'and it is still the drawing');
    assert.ok(Array.isArray(shot.removed) && shot.removed.length > 0, 'and it says what it took out');
    assert.ok(svgDataUrl(shot.svg).startsWith('data:image/svg+xml;charset=utf-8,'), 'encoded by us, never fetched');
  });

  test('`auto` on a declared SVG takes the free path, with no guest', async () => {
    const p = part({ mode: 'auto' });
    const { input, sandbox } = runInput(p, [valueOf('text', '<svg width="8" height="8"/>', { format: 'svg' })]);
    await PREVIEW.run(input);
    assert.equal(shownOf(p.id).mode, 'svg');
    assert.equal(sandbox.calls.run.length, 0);
  });

  // ----------------------------------------------------------------- the three guest-drawn modes

  test('an HTML page goes to the guest as it is — that IS the mode — and comes back as a picture', async () => {
    const p = part({ mode: 'html', w: 800, h: 600 });
    const page = '<h1>x</h1><script>1</script>';
    const { input, sandbox } = runInput(p, [valueOf('text', page)]);
    await PREVIEW.run(input);
    assert.equal(sandbox.calls.run.length, 1, 'one draw');
    assert.equal(sandbox.calls.run[0].kind, 'dom');
    assert.equal(sandbox.calls.run[0].html, page, 'the sandbox is the containment, not an edit of the page');
    assert.equal(sandbox.calls.run[0].css, PAGE_CSS);
    assert.equal(sandbox.calls.snapshot[0].maxPx, 800, 'the snapshot is size-bounded by the box');
    const shot = shownOf(p.id);
    assert.equal(shot.mode, 'html');
    assert.equal(shot.dataUrl, 'data:image/png;base64,AAAA');
    assert.equal(shot.source, page, 'what it was drawn from survives for a re-run');
  });

  test('three.js and p5.js are handed to the guest as CODE, under their own kind', async () => {
    for (const mode of ['three', 'p5']) {
      const p = part({ mode, w: 2048, h: 64 });
      const sketch = ['api.log(1)', 'api.log(2)'].join(NL);
      const { input, sandbox } = runInput(p, [valueOf('text', sketch)]);
      await PREVIEW.run(input);
      assert.equal(sandbox.calls.run[0].kind, mode, `${mode} asks the guest for its own libraries`);
      // K5-U1 (addendum KE-3): the sketch is SHAPED for the guest (graph/unfence.mjs
      // shapeForGuest) — p5 global mode handed to `window`, a three.js renderer pointed at the
      // guest's canvas — and the one invariant that matters to its author holds: every line of
      // what they wrote is at the SAME line number in what the guest runs, so an error's line is
      // the line they see. (The old assertion "three.js is untouched" is superseded by that.)
      const ran = sandbox.calls.run[0].code.split(NL);
      assert.ok(ran[0].endsWith('api.log(1)'), `${mode}: line 1 is still the sketch's line 1`);
      assert.equal(ran[1], 'api.log(2)', `${mode}: line 2 is still the sketch's line 2`);
      if (mode === 'p5') assert.ok(/window\.draw = typeof draw === 'function'/.test(sandbox.calls.run[0].code), 'then p5 global mode is handed to window');
      else assert.ok(/preserveDrawingBuffer: true/.test(ran[0]), 'three.js keeps its drawing buffer so the picture can be taken');
      assert.equal(sandbox.calls.run[0].html, undefined, 'a sketch is code, not a page');
      assert.equal(sandbox.calls.snapshot[0].maxPx, 1024, 'and the snapshot is capped at the protocol ceiling');
      assert.equal(shownOf(p.id).mode, mode);
    }
  });

  // ----------------------------------------------------------------------------- every refusal

  test('the frozen refusal names the port, what arrived, and an action that EXISTS', async () => {
    const p = part({ mode: 'markdown' });
    const { input } = runInput(p, [valueOf('image', { dataUrl: 'data:image/png;base64,AA' })]);
    const fail = await failureOf(input);
    assert.equal(fail.reason, 'invalid');
    assert.equal(fail.message, t('parts.previewRefused', { got: t('parts.previewKindImage') }));
    assert.ok(fail.message.includes('`content`'), 'it names the port');
    assert.ok(fail.message.includes('an image'), 'it names what arrived');
    assert.ok(/Image box/.test(fail.message) && /Instruction/.test(fail.message),
      'and the two actions it names are two parts that exist');
    assert.equal(shownOf(p.id), null, 'a refused run draws nothing');

    const withFile = runInput(part({ mode: 'markdown' }), [valueOf('file', { path: 'a.txt' })]);
    assert.equal((await failureOf(withFile.input)).message, t('parts.previewRefused', { got: t('parts.previewKindFile') }));
    const withList = runInput(part({ mode: 'markdown' }), [listOf([valueOf('text', 'a')])]);
    assert.equal((await failureOf(withList.input)).message, t('parts.previewRefused', { got: t('parts.previewKindList') }));
    assert.equal(kindLabel('nonesuch'), 'nonesuch', 'an unknown kind is still spelled, never dropped');
  });

  test('Preview fails visibly: nothing wired, not an SVG, no guest, no picture, too big', async () => {
    const empty = runInput(part({ mode: 'markdown' }), []);
    const emptyFail = await failureOf(empty.input);
    assert.equal(emptyFail.message, t('parts.previewEmpty'));
    assert.equal(emptyFail.reason, 'empty');
    assert.equal((await failureOf(runInput(part({ mode: 'markdown' }), [valueOf('text', '   ')]).input)).reason,
      'empty', 'whitespace is nothing wired in, not a blank report');

    const notSvg = runInput(part({ mode: 'svg' }), [valueOf('text', 'Paris')]);
    assert.equal((await failureOf(notSvg.input)).message, t('parts.previewNotSvg'));

    const noGuest = runInput(part({ mode: 'three' }), [valueOf('text', 'x')], { sandbox: null });
    assert.equal((await failureOf(noGuest.input)).message, t('sandbox.errDisabled'));

    const blind = runInput(part({ mode: 'html' }), [valueOf('text', 'x')], { sandbox: fakeSandbox({ snapshot: null }) });
    assert.equal((await failureOf(blind.input)).message, t('parts.previewNoPicture'));

    const huge = runInput(part({ mode: 'html' }), [valueOf('text', 'x')], {
      sandbox: fakeSandbox({
        snapshot: () => ({ dataUrl: `data:image/png;base64,${'A'.repeat(MAX_TILE_BYTES)}`, w: 10, h: 10 }),
      }),
    });
    assert.equal((await failureOf(huge.input)).message, t('parts.previewTooBig'));

    const hugeSvg = runInput(part({ mode: 'svg' }), [valueOf('text', `<svg>${'a'.repeat(MAX_TILE_BYTES)}</svg>`)]);
    assert.equal((await failureOf(hugeSvg.input)).message, t('parts.previewTooBig'));
  });

  test('a sketch that threw is reported with the LINE, which is the one thing its author needs', async () => {
    const twelve = [...Array.from({ length: 11 }, (_, i) => `// line ${i + 1}`), 'boom()'].join(NL);
    const withLine = runInput(part({ mode: 'p5' }), [valueOf('text', twelve)], {
      sandbox: fakeSandbox({ run: () => ({ ok: false, ms: 0, error: { message: 'boom is not a function', line: 12, col: 3 } }) }),
    });
    const fail = await failureOf(withLine.input);
    assert.equal(fail.message, t('parts.previewError', { message: 'boom is not a function', line: 12 }));
    assert.ok(fail.message.includes('12'), 'the line is in the sentence a reader sees');

    const noLine = runInput(part({ mode: 'three' }), [valueOf('text', 'x')], {
      sandbox: fakeSandbox({ run: () => ({ ok: false, ms: 0, error: { message: 'the guest gave up' } }) }),
    });
    assert.equal((await failureOf(noLine.input)).message, 'the guest gave up', 'no line, no invented one');
    assert.equal(sandboxMessage({ message: 'x', line: 0 }), 'x', 'line 0 is no line');
    assert.equal(sandboxMessage({ message: 'x', line: 40 }, 'one line'), 'x',
      'a line past the end of the code came from a library frame, and is dropped rather than misleading');
    assert.equal(sandboxMessage(null), t('sandbox.errNotBuilt'), 'and a silent guest still gets a sentence');
  });

  // ------------------------------------------------------- what a run leaves behind, and its bound

  test('a drawing is RUNTIME state: kept by id, forgotten on request, and bounded', () => {
    clearShown('bounded-x');
    setShown('bounded-x', { mode: 'markdown', source: 'x', text: 'x', at: 1 });
    assert.equal(shownOf('bounded-x').text, 'x');
    clearShown('bounded-x');
    assert.equal(shownOf('bounded-x'), null, 'a box that goes away leaves nothing behind');

    for (let i = 0; i < MAX_SHOWN + 5; i++) {
      setShown(`bound-${i}`, { mode: 'markdown', source: 's', text: 's', at: i });
    }
    assert.equal(shownOf('bound-0'), null, 'the oldest drawing is evicted, not accumulated');
    assert.ok(shownOf(`bound-${MAX_SHOWN + 4}`), 'and the newest is still there');
    for (let i = 0; i < MAX_SHOWN + 5; i++) clearShown(`bound-${i}`);
  });

  // ------------------------------------------------------------------------------------- the box

  test('the box draws markdown as NODES, and a picture as an <img> of bytes we encoded', async () => {
    await withDom(async (doc) => {
      const p = part({ mode: 'markdown' });
      const { input } = runInput(p, [valueOf('text', '# Title\n\n- one\n- two')]);
      await PREVIEW.run(input);

      const host = doc.createElement('div');
      const patches = [];
      const view = PREVIEW.render(host, p, {
        app: {}, part: p, open: () => {},
        update: (patch) => patches.push(patch), commit: () => {},
      });
      const body = host.querySelector('.graph-preview-body');
      assert.ok(body, 'the window has a body');
      assert.ok(body.querySelector('h1'), 'a heading became a real element');
      assert.ok(body.querySelector('li'), 'and the list became list items');
      assert.equal(body.querySelector('img'), null, 'markdown is nodes, not a picture');
      assert.ok(!host.querySelector('.graph-preview-save').hidden, 'and it can be saved');
      assert.equal(host.querySelector('.graph-preview-size').hidden, true, 'markdown reflows: no drawing size');

      // The same box, now showing a snapshot.
      const q = part({ mode: 'html' });
      const shot = runInput(q, [valueOf('text', '<b>x</b>')]);
      await PREVIEW.run(shot.input);
      const host2 = doc.createElement('div');
      const view2 = PREVIEW.render(host2, q, { app: {}, part: q, open: () => {}, update: () => {}, commit: () => {} });
      const img = host2.querySelector('.graph-preview-tile');
      assert.ok(img, 'the guest-drawn modes show a tile');
      assert.equal(img.getAttribute('src'), 'data:image/png;base64,AAAA');
      assert.equal(host2.querySelector('.graph-preview-size').hidden, false, 'and those DO have a drawing size');
      assert.equal(host2.querySelector('.graph-preview-note').textContent, t('parts.previewSnapshot'),
        'the box says what a picture is, so nothing on it lies');

      // An unrun box says so rather than showing an empty frame.
      const fresh = part({ mode: 'auto' });
      const host3 = doc.createElement('div');
      const view3 = PREVIEW.render(host3, fresh, { app: {}, part: fresh, open: () => {}, update: () => {}, commit: () => {} });
      assert.equal(host3.querySelector('.graph-preview-note').textContent, t('parts.previewEmpty'));
      assert.equal(host3.querySelector('.graph-preview-save').hidden, true, 'nothing drawn, nothing to save');

      view.destroy();
      view2.destroy();
      view3.destroy();
      assert.equal(shownOf(p.id), null, 'a box that is torn down forgets its drawing');
      assert.equal(patches.length, 0, 'drawing a box edits nothing');
    });
  });

  test('picking a mode is a settings edit — the program, which is what survives a reload', async () => {
    await withDom(async (doc) => {
      const p = part({ mode: 'auto' });
      const patches = [];
      const commits = [];
      const view = PREVIEW.render(doc.createElement('div'), p, {
        app: {}, part: p, open: () => {},
        update: (patch) => patches.push(patch), commit: (label) => commits.push(label),
      });
      // K5 kickoff (addendum KE-3): the box's own `source` and its `locked` join the stored shape.
      assert.deepEqual(PREVIEW.defaults(), { mode: 'auto', w: 320, h: 240, live: false, source: '', locked: false },
        'the stored shape KD-6 froze, plus KE-3');
      view.destroy();
      assert.deepEqual(patches, [], 'and nothing is written until the reader picks');
      assert.deepEqual(commits, []);
    });
  });
};
