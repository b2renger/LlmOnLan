// @ts-check
// C3-U2 in Node: the three sandbox-backed parts (plan §2.6 BJ-8/BJ-9/BJ-10, spec §3/§7).
//
// What a unit test can prove about these three, and what it cannot:
//   CAN — the marshalling in both directions (a GraphValue becomes plain data, a returned value
//         becomes a GraphValue by the frozen rule), the failure sentences (a line number, a
//         sanitised message with no path in it), the SVG sanitiser, which door File writes
//         through, and that Code never reaches for the farm (the fake `ask` here THROWS).
//   CANNOT — that the guest is really contained, that a `..` is refused by the main process, and
//         that a picture really comes back from an iframe. Those are the harness's (c3-parts.mjs
//         and C3-U1's c3-sandbox.mjs), against the real thing.
//
// The sandbox is faked by hand rather than booted: what is under test is the PART's half of the
// contract — what it sends, and what it does with each of the answers it can get back.

import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { createRegistry, SLOTS } from '../../../renderer/chat/core/registry.mjs';
import {
  DEFAULT_CODE, marshalInputs, hasListInput, coerceResult, sanitizeErrorText, errorLine,
  codeFailure, errorHint, setErrorHint,
} from '../../../renderer/chat/graph/parts/code.mjs';
import {
  RENDER_MODES, markdownToHtml, sanitizeSvg, svgDataUrl, svgSize, readSettings, escapeHtml,
  MAX_TILE_BYTES,
} from '../../../renderer/chat/graph/parts/render.mjs';
import {
  DEFAULT_PATH, threadProject, payloadFor, extOf, isBinaryPath,
} from '../../../renderer/chat/graph/parts/file.mjs';

const SPECS = specMap();
const CODE = SPECS.get('code');
const RENDER = SPECS.get('render');
const FILE = SPECS.get('file');

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

/** A sandbox host as the parts see it (core/types.mjs SandboxHost), with every call recorded. */
function fakeSandbox(answers = {}) {
  const calls = { compute: [], run: [], snapshot: [] };
  const host = {
    calls,
    async compute(req) {
      calls.compute.push(req);
      const a = answers.compute;
      const out = typeof a === 'function' ? a(req) : a;
      return out || { ok: true, ms: 1, json: JSON.stringify('ok'), error: null };
    },
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
      return out === undefined ? { dataUrl: 'data:image/png;base64,AAAA', w: 640, h: 480 } : out;
    },
    mount() {}, state: () => 'ready', ready: async () => true, logs: () => [], errors: () => [],
    runs: () => calls.compute.length + calls.run.length, params() {}, stop() {}, hide() {},
    destroy() {}, on: () => () => {}, debug: () => ({}),
  };
  return host;
}

/** A RunInput. `ask` THROWS: a C3 part that reaches for the farm fails this suite (BJ-14). */
function runInput(part, inputs, o = {}) {
  const sandbox = o.sandbox === null ? null : (o.sandbox || fakeSandbox());
  return {
    input: {
      part,
      inputs,
      app: o.app || {},
      ask: () => { throw new Error('a C3 part asked the farm — these parts spend no generations'); },
      signal: new AbortController().signal,
      thread: o.thread === undefined ? { id: 'th1', title: 'A thread' } : o.thread,
      cache: true,
      item: o.item || null,
      sandbox: o.sandbox === null ? null : async () => sandbox,
    },
    sandbox,
  };
}

const part = (type, settings, extra = {}) => ({
  id: `p-${type}`, type, x: 0, y: 0, w: 260, h: 180, settings, value: null, state: 'idle',
  error: null, stats: null, ...extra,
});

/** The message a run() threw. */
async function failureOf(spec, input) {
  try {
    await spec.run(input);
  } catch (err) {
    return { message: String(err.message), reason: /** @type {any} */ (err).reason };
  }
  return null;
}

export default (test) => {
  // ------------------------------------------------------------------------------- Code: marshal

  test('the guest is handed plain data, one ordered array per port, and the fan-out position', () => {
    const inputs = {
      in: [valueOf('text', 'Paris'), valueOf('json', { n: 2 }), listOf([valueOf('text', 'a'), valueOf('text', 'b')])],
      other: [],
    };
    const plain = marshalInputs(inputs, { i: 2, n: 5 });
    assert.deepEqual(plain.in, ['Paris', { n: 2 }, ['a', 'b']], 'every kind arrives as the plain thing it is');
    assert.deepEqual(plain.other, [], 'a port with nothing wired is an empty ARRAY, never undefined');
    assert.deepEqual(plain.item, { i: 2, n: 5 }, 'and the item position rides along');
    assert.equal(marshalInputs(inputs, null).item, null, 'outside a fan-out there is no item');
    assert.deepEqual(marshalInputs(/** @type {any} */ (null), null), { item: null }, 'no inputs at all is still an object');
  });

  test('an image and a file reach the guest as data, not as our envelope', () => {
    const plain = marshalInputs({
      pic: [valueOf('image', { dataUrl: 'data:image/png;base64,AA', name: 'shot.png' })],
      doc: [valueOf('file', { path: 'out/names.md', project: 'p-1', size: 12 })],
    }, null);
    assert.deepEqual(plain.pic, [{ dataUrl: 'data:image/png;base64,AA', name: 'shot.png' }]);
    assert.deepEqual(plain.doc, [{ path: 'out/names.md' }], 'a file is its path — never the project id');
  });

  test('a list at the input is seen, because it is the thing worth saying when the code throws', () => {
    assert.equal(hasListInput({ in: [listOf([valueOf('text', 'a')])] }), true);
    assert.equal(hasListInput({ in: [valueOf('text', 'a')] }), false);
    assert.equal(hasListInput(/** @type {any} */ (null)), false);
  });

  // ------------------------------------------------------------------------- Code: result coercion

  test('every fromPlain rule, through the JSON the guest really posts', () => {
    const value = (x) => {
      const out = coerceResult(JSON.stringify(x));
      return out.ok ? out.value : null;
    };
    assert.deepEqual(value('two'), { kind: 'text', data: 'two' }, 'a string is text');
    assert.deepEqual(value(7), { kind: 'json', data: 7 }, 'a number is json — it wires into Code again');
    assert.deepEqual(value(false), { kind: 'json', data: false });
    assert.deepEqual(value({ a: 1 }), { kind: 'json', data: { a: 1 } });
    const list = value(['a', 'b']);
    assert.equal(list.kind, 'list', 'an array is a list, so it can fan out');
    assert.deepEqual(list.data, [{ kind: 'text', data: 'a' }, { kind: 'text', data: 'b' }]);
  });

  test('nothing is a FAILURE, not a value — and a broken protocol says something else', () => {
    assert.deepEqual(coerceResult(JSON.stringify(null)), { ok: false, why: 'empty' });
    assert.deepEqual(coerceResult('null'), { ok: false, why: 'empty' });
    assert.deepEqual(coerceResult(null), { ok: false, why: 'empty' }, 'a guest that sent no json at all');
    assert.deepEqual(coerceResult(''), { ok: false, why: 'empty' }, 'undefined never survives JSON.stringify');
    assert.deepEqual(coerceResult('{oops'), { ok: false, why: 'json' }, 'not JSON = the host and guest disagree');
    // NaN cannot cross as JSON at all: it stringifies to null, which is already a failure above.
    assert.equal(JSON.stringify(Number.NaN), 'null');
  });

  // --------------------------------------------------------------------------- Code: the failure

  test('an error sentence never carries a path or a URL off the reader machine', () => {
    const dirty = 'ReferenceError at file:///C:/Users/someone/app/renderer/chat/sandbox/runner.html:12:3';
    const clean = sanitizeErrorText(dirty);
    assert.ok(!/file:/.test(clean), `no file: URL survives: ${clean}`);
    assert.ok(!/Users/.test(clean), `no path survives: ${clean}`);
    assert.ok(clean.startsWith('ReferenceError'), 'what it WAS still reads: ' + clean);
    assert.ok(!/C:\\/.test(sanitizeErrorText('failed at C:\\Users\\me\\graph.js line 2')), 'a Windows path too');
    assert.equal(sanitizeErrorText(null), '');
  });

  test('the line number is the READER line, whatever preamble the engine wrote', () => {
    const code = 'const a = 1;\nconst b = a.nope();\nreturn b;';
    assert.deepEqual(errorLine({ line: 2, col: 11 }, code), { line: 2, col: 11 }, 'a line that exists is taken as it is');
    const two = 'const a = 1;\nreturn a.nope();';
    assert.deepEqual(errorLine({ line: 5, col: 0, stack: '' }, two), { line: 2, col: 0 }, '5 - 3 is the only line two lines of code can have');
    assert.deepEqual(errorLine({ stack: 'at eval (eval at run:4:9)' }, two), { line: 2, col: 0 }, 'read off a stack when there is no line');
    assert.equal(errorLine({ line: 99 }, code), null, 'a line that cannot exist is not a line');
    assert.equal(errorLine(null, code), null);
  });

  test('a failure names the line, and says the list arrived whole when one did', () => {
    const code = 'return inputs.in.toUpperCase();';
    const plain = codeFailure({ message: 'TypeError: not a function', line: 1, col: 8 }, code, false);
    assert.equal(plain.message, t('parts.errCodeLine', { line: 1, message: 'TypeError: not a function' }));
    assert.deepEqual(plain.hint, { line: 1, col: 8 });

    const listy = codeFailure({ message: 'TypeError: not a function', line: 1 }, code, true);
    assert.ok(listy.message.includes(t('parts.errCodeList')), 'the documented behaviour is explained, not hidden');
    assert.ok(listy.message.startsWith(plain.message), 'and it is added to the sentence, never instead of it');

    const nowhere = codeFailure({ message: '', line: 0 }, code, false);
    assert.equal(nowhere.hint, null);
    assert.equal(nowhere.message, t('sandbox.errNotBuilt'), 'a guest that said nothing still gets a sentence');
  });

  // ------------------------------------------------------------------------------- Code: running

  test('Code computes in the sandbox and spends no generation', async () => {
    const p = part('code', { code: 'return inputs.in.length;' });
    const { input, sandbox } = runInput(p, { in: [valueOf('text', 'a'), valueOf('text', 'b')] },
      { sandbox: fakeSandbox({ compute: () => ({ ok: true, ms: 3, json: '2', error: null }) }) });
    const value = await CODE.run(input);
    assert.deepEqual(value, { kind: 'json', data: 2 });
    assert.equal(sandbox.calls.compute.length, 1, 'exactly one round-trip to the guest');
    assert.equal(sandbox.calls.compute[0].code, 'return inputs.in.length;', 'the reader code, unedited');
    assert.deepEqual(sandbox.calls.compute[0].inputs.in, ['a', 'b']);
    assert.ok(sandbox.calls.compute[0].timeoutMs > 0, 'with a timeout, so a loop cannot hold the run');
  });

  test('a list arrives WHOLE — Code declines to fan, on purpose', async () => {
    const p = part('code', { code: 'return inputs.in[0].length;' });
    const items = listOf([valueOf('text', 'a'), valueOf('text', 'b'), valueOf('text', 'c')]);
    const { input, sandbox } = runInput(p, { in: [items] });
    await CODE.run(input);
    assert.deepEqual(sandbox.calls.compute[0].inputs.in, [['a', 'b', 'c']],
      'one call, carrying the whole list as one array — not three calls');
    const port = CODE.inputs[0];
    assert.ok(port.accepts.includes('list'), 'the port ACCEPTS list, which is what stops the runner fanning it');
  });

  test('a thrown error inside the guest becomes the part sentence, with the line and no path', async () => {
    const code = 'const rows = inputs.in;\nreturn rows.nope();';
    const p = part('code', { code });
    const { input } = runInput(p, { in: [valueOf('text', 'a')] }, {
      sandbox: fakeSandbox({
        compute: () => ({
          ok: false,
          ms: 1,
          json: null,
          error: {
            message: 'TypeError: rows.nope is not a function',
            stack: 'at run (file:///C:/app/renderer/chat/sandbox/runner.html:4:9)',
            line: 4,
            col: 9,
          },
        }),
      }),
    });
    const fail = await failureOf(CODE, input);
    assert.ok(fail, 'it failed');
    assert.ok(!/file:/.test(fail.message), `no file: path in what the reader sees: ${fail.message}`);
    assert.ok(fail.message.includes('rows.nope is not a function'), fail.message);
    assert.ok(fail.message.startsWith(t('parts.errCodeLine', { line: 2, message: '' }).slice(0, 7)),
      `it names a line: ${fail.message}`);
    assert.deepEqual(errorHint(p.id), { line: 2, col: 9 }, 'and the editor can point at it');
    setErrorHint(p.id, null);
  });

  test('a run that returns nothing fails visibly, and clears the editor hint', async () => {
    const p = part('code', { code: 'const x = 1;' });
    setErrorHint(p.id, { line: 9, col: 0 });
    const { input } = runInput(p, { in: [] }, {
      sandbox: fakeSandbox({ compute: () => ({ ok: true, ms: 1, json: 'null', error: null }) }),
    });
    const fail = await failureOf(CODE, input);
    assert.equal(fail.message, t('parts.errCodeNoValue'));
    assert.equal(errorHint(p.id), null, 'the code RAN, so the stale line chip goes');
  });

  test('a result that is not JSON, empty code, and no sandbox each have their own sentence', async () => {
    const p = part('code', { code: 'return 1;' });
    const bad = runInput(p, { in: [] }, { sandbox: fakeSandbox({ compute: () => ({ ok: true, ms: 1, json: '<html>', error: null }) }) });
    assert.equal((await failureOf(CODE, bad.input)).message, t('sandbox.errResultJson'));

    const blank = runInput(part('code', { code: '   ' }), { in: [] });
    const blankFail = await failureOf(CODE, blank.input);
    assert.equal(blankFail.message, t('parts.errCodeEmpty'));
    assert.equal(blankFail.reason, 'empty');

    const none = runInput(p, { in: [] }, { sandbox: null });
    assert.equal((await failureOf(CODE, none.input)).message, t('sandbox.errDisabled'));
  });

  test('the default code runs over the default port without throwing on an empty port', () => {
    assert.ok(DEFAULT_CODE.includes('inputs.in'), 'the starting body reads the port by name');
    const body = new Function('inputs', DEFAULT_CODE);
    assert.equal(body({ in: ['a', 'b'] }), 'a\nb');
    assert.equal(body({ in: [] }), '', 'nothing wired is not a crash');
  });

  // The bridge from a chat fence to a Code part went out at the K1 landing with the panel that
  // placed its parts (COMPUTER_PLAN §3.2). `looksLikeJs`, `codeFromFence`, `firstJsFence` and
  // `installCodeBridge` are deleted from graph/parts/code.mjs, so the four tests that covered them
  // are deleted here. The Code PART itself is unchanged and every other test in this file stands.

  test('the editor points at the failing line and forgets it when the part succeeds', async () => {
    await withDom(async () => {
      const p = part('code', { code: 'const a = 1;\na.nope();' }, { state: 'error', error: 'boom' });
      setErrorHint(p.id, { line: 2, col: 3 });
      const host = document.createElement('div');
      /** @type {any} */ const ctx = { update() {}, commit() {}, open() {}, app: {}, part: p };
      const view = CODE.render(host, p, ctx);
      const chip = host.querySelector('.graph-code-line');
      assert.ok(chip, 'a chip exists');
      assert.equal(chip.hidden, false);
      assert.equal(chip.textContent, t('parts.codeLineChip', { line: 2 }));

      view.update({ ...p, state: 'done' });
      assert.equal(chip.hidden, true, 'a part that ran is not still pointing at a line');
      setErrorHint(p.id, null);
      view.destroy();
    });
  });

  // ------------------------------------------------------------------------------------- Render

  test('markdown becomes an escaped HTML body, and a script in the text stays text', () => {
    const html = markdownToHtml('# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n');
    assert.ok(html.includes('<h1>Title</h1>'), html);
    assert.ok(html.includes('<strong>bold</strong>'));
    assert.ok(html.includes('<li>one</li>'));
    const nasty = markdownToHtml('<script>alert(1)</script>\n');
    assert.ok(!/<script/i.test(nasty), `the model cannot open a tag: ${nasty}`);
    assert.ok(nasty.includes('&lt;script&gt;'));
    assert.equal(escapeHtml('a & "b" <c>'), 'a &amp; &quot;b&quot; &lt;c&gt;');
  });

  test('a markdown link only survives when it is a scheme the guest could ever use', () => {
    assert.ok(markdownToHtml('[go](https://example.com)').includes('<a href="https://example.com">go</a>'));
    const js = markdownToHtml('[go](javascript:alert(1))');
    assert.ok(!/javascript:/i.test(js), js);
    assert.ok(js.includes('go'), 'the words stay, the link goes');
    assert.ok(markdownToHtml('![x](https://example.com/a.png)').indexOf('<img') < 0, 'no network images');
    assert.ok(markdownToHtml('![x](data:image/png;base64,AA)').includes('<img'), 'an inline picture is fine');
  });

  test('the SVG sanitiser removes what can execute or phone home, and says so', () => {
    const dirty = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">',
      '<script>fetch("http://10.0.0.1/x")</script>',
      '<rect width="10" height="10" onload="alert(1)" fill="red"/>',
      '<image href="https://example.com/a.png"/>',
      '<image href="data:image/png;base64,AA"/>',
      '<use href="#star"/>',
      '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">hi</body></foreignObject>',
      '</svg>',
    ].join('');
    const clean = sanitizeSvg(dirty);
    assert.equal(clean.ok, true);
    assert.ok(!/<script/i.test(clean.svg), clean.svg);
    assert.ok(!/onload/i.test(clean.svg), 'no handler survives');
    assert.ok(!/foreignObject/i.test(clean.svg));
    assert.ok(!/example\.com/.test(clean.svg), 'no external reference survives');
    assert.ok(clean.svg.includes('data:image/png;base64,AA'), 'an inline picture is kept');
    assert.ok(clean.svg.includes('href="#star"'), 'a same-document reference is kept');
    assert.deepEqual(clean.removed.sort(), ['foreignObject', 'handler', 'reference', 'script'].sort());
    assert.equal(sanitizeSvg('not an svg').ok, false, 'and text that is not an SVG is refused, not patched');
    assert.equal(sanitizeSvg('<svg width="1" height="1"></svg>').removed.length, 0, 'a clean SVG loses nothing');
  });

  test('an obfuscated scheme cannot survive the allow-list', () => {
    const clean = sanitizeSvg('<svg><a href="java\tscript:alert(1)"><text>x</text></a></svg>');
    assert.ok(!/script:/i.test(clean.svg), clean.svg);
  });

  test('the picture keeps its own size, and the mode list is the frozen three', () => {
    assert.deepEqual([...RENDER_MODES], ['markdown', 'svg', 'html']);
    assert.deepEqual(svgSize('<svg width="320" height="200">', { w: 1, h: 1 }), { w: 320, h: 200 });
    assert.deepEqual(svgSize('<svg viewBox="0 0 64 32">', { w: 1, h: 1 }), { w: 64, h: 32 });
    assert.deepEqual(svgSize('<svg>', { w: 640, h: 480 }), { w: 640, h: 480 }, 'and falls back to the part size');
    assert.ok(svgDataUrl('<svg/>').startsWith('data:image/svg+xml;charset=utf-8,'), 'encoded by us, never fetched');
    assert.deepEqual(readSettings({ mode: 'nope', width: 9, height: 99999 }), { mode: 'markdown', width: 64, height: 2048 });
  });

  test('Render draws an SVG without the sandbox at all, and the source survives for the export', async () => {
    const p = part('render', { mode: 'svg' });
    const source = '<svg width="20" height="10"><script>x()</script><rect width="5" height="5"/></svg>';
    const { input, sandbox } = runInput(p, { in: [valueOf('text', source)] });
    const value = await RENDER.run(input);
    assert.equal(value.kind, 'image');
    assert.equal(sandbox.calls.run.length, 0, 'a vector picture needs no guest — and no rasterising');
    assert.equal(value.data.mode, 'svg');
    assert.deepEqual([value.data.w, value.data.h], [20, 10]);
    assert.ok(!/<script/.test(value.data.source), 'the SOURCE that gets exported is the sanitised one');
    assert.ok(value.data.dataUrl.startsWith('data:image/svg+xml'), value.data.dataUrl.slice(0, 40));
  });

  test('Render lays out markdown in the sandbox and keeps what it was drawn from', async () => {
    const p = part('render', { mode: 'markdown', width: 800, height: 600 });
    const { input, sandbox } = runInput(p, { in: [valueOf('text', '# Hello'), valueOf('json', { a: 1 })] });
    const value = await RENDER.run(input);
    assert.equal(sandbox.calls.run.length, 1, 'one draw');
    assert.equal(sandbox.calls.run[0].kind, 'dom');
    assert.ok(sandbox.calls.run[0].html.includes('<h1>Hello</h1>'), 'the guest was handed HTML we built');
    assert.deepEqual(sandbox.calls.snapshot[0], { maxPx: 800 }, 'the snapshot is size-bounded');
    assert.equal(value.kind, 'image');
    assert.equal(value.data.mode, 'markdown');
    assert.ok(value.data.source.includes('# Hello'), 'the source survives for a re-export');
    assert.ok(value.data.source.includes('"a": 1'), 'both wires are in it, in order');
    assert.equal(value.data.dataUrl, 'data:image/png;base64,AAAA');
  });

  test('an HTML page goes to the guest as it is — that IS the mode', async () => {
    const p = part('render', { mode: 'html' });
    const page = '<h1>x</h1><script>1</script>';
    const { input, sandbox } = runInput(p, { in: [valueOf('text', page)] });
    await RENDER.run(input);
    assert.equal(sandbox.calls.run[0].html, page, 'the sandbox is the containment, not an edit of the page');
  });

  test('Render fails visibly: nothing wired, not an SVG, no picture, too big', async () => {
    const empty = runInput(part('render', { mode: 'markdown' }), { in: [] });
    const emptyFail = await failureOf(RENDER, empty.input);
    assert.equal(emptyFail.message, t('parts.errRenderEmpty'));
    assert.equal(emptyFail.reason, 'empty');

    const notSvg = runInput(part('render', { mode: 'svg' }), { in: [valueOf('text', 'Paris')] });
    assert.equal((await failureOf(RENDER, notSvg.input)).message, t('parts.errRenderNotSvg'));

    const blind = runInput(part('render', { mode: 'markdown' }), { in: [valueOf('text', 'x')] },
      { sandbox: fakeSandbox({ snapshot: null }) });
    assert.equal((await failureOf(RENDER, blind.input)).message, t('parts.errRenderNoPicture'));

    const huge = runInput(part('render', { mode: 'markdown' }), { in: [valueOf('text', 'x')] }, {
      sandbox: fakeSandbox({
        snapshot: () => ({ dataUrl: `data:image/png;base64,${'A'.repeat(MAX_TILE_BYTES)}`, w: 10, h: 10 }),
      }),
    });
    assert.equal((await failureOf(RENDER, huge.input)).message, t('parts.errRenderTooBig'));

    const broke = runInput(part('render', { mode: 'markdown' }), { in: [valueOf('text', 'x')] }, {
      sandbox: fakeSandbox({ run: () => ({ ok: false, ms: 0, error: { message: 'the guest gave up' } }) }),
    });
    assert.equal((await failureOf(RENDER, broke.input)).message, 'the guest gave up', 'the guest sentence is passed through');
  });

  // --------------------------------------------------------------------------------------- File

  test('which door a value goes through is decided by the value and the extension', () => {
    const png = valueOf('image', { dataUrl: 'data:image/png;base64,QUJD', source: '', mode: 'markdown' });
    assert.deepEqual(payloadFor([png], 'out/shot.png'), { ok: true, binary: true, data: 'QUJD' });
    assert.deepEqual(payloadFor([png], 'out/shot.md'), { ok: false, why: 'image-ext' },
      'base64 written into a .md is not a file anybody can open');
    assert.deepEqual(payloadFor([valueOf('text', 'hi')], 'out/a.png'), { ok: false, why: 'binary' });
    assert.deepEqual(payloadFor([valueOf('text', 'hi'), valueOf('json', { a: 1 })], 'out/a.md').data, 'hi\n{\n  "a": 1\n}');
    assert.deepEqual(payloadFor([], 'out/a.md'), { ok: false, why: 'empty' });

    const vector = valueOf('image', { dataUrl: svgDataUrl('<svg width="2" height="2"/>'), source: '<svg/>', mode: 'svg' });
    const out = payloadFor([vector], 'out/drawing.svg');
    assert.equal(out.ok && out.binary, false, 'a vector picture is TEXT');
    assert.equal(out.ok && out.data, '<svg width="2" height="2"/>', 'and it is the SVG itself, not base64');
  });

  test('the extension rules the renderer uses to pick a door', () => {
    assert.equal(extOf('out/a/b.MD'), '.md');
    assert.equal(extOf('out/noext'), '');
    assert.equal(isBinaryPath('a/b.png'), true);
    assert.equal(isBinaryPath('a/b.md'), false);
  });

  test('one project per thread: made once, found again, remade only when it is really gone', async () => {
    /** @type {any[]} */ const created = [];
    const refs = new Map();
    let meta = { ok: true };
    const app = {
      now: () => 5,
      projects: {
        create: async (m) => { created.push(m); return { ok: true, project: { id: `proj-${created.length}` } }; },
        meta: async () => meta,
      },
      repo: {
        listProjectRefs: async (threadId) => [...refs.values()].filter((r) => r.threadId === threadId),
        putProjectRef: async (r) => { refs.set(r.id, r); },
      },
    };
    const thread = { id: 'th1', title: 'Names' };
    const first = await threadProject(app, thread);
    assert.equal(first.ok, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].name, 'Names', 'the folder is named after the conversation');

    const again = await threadProject(app, thread);
    assert.equal(again.id, first.id, 'the second run writes into the SAME folder');
    assert.equal(created.length, 1, 'and creates nothing');

    meta = { ok: false, code: 'E_MISSING' };
    const remade = await threadProject(app, thread);
    assert.equal(created.length, 2, 'a folder deleted by hand means a new one, not a dead write');
    assert.notEqual(remade.id, first.id);

    assert.equal((await threadProject(app, null)).message, t('parts.errFileNoThread'));
    assert.equal((await threadProject({ repo: app.repo }, thread)).message, t('parts.errFileNoProjects'));
  });

  test('File writes the path the reader typed, and a second run overwrites rather than multiplying', async () => {
    /** @type {any[]} */ const writes = [];
    const files = new Map();
    const app = {
      now: () => 5,
      projects: {
        create: async () => ({ ok: true, project: { id: 'proj-1' } }),
        meta: async () => ({ ok: true }),
        write: async (id, rel, text) => {
          writes.push({ id, rel, text });
          files.set(rel, text);
          return { ok: true, size: text.length };
        },
        writeBinary: async (id, rel, b64) => { writes.push({ id, rel, b64 }); files.set(rel, b64); return { ok: true, size: 3 }; },
      },
      repo: { listProjectRefs: async () => [], putProjectRef: async () => {} },
    };
    const p = part('file', { path: 'out/names.md' });
    const one = runInput(p, { in: [valueOf('text', 'Paris')] }, { app });
    const value = await FILE.run(one.input);
    assert.deepEqual(value, { kind: 'file', data: { path: 'out/names.md', project: 'proj-1', size: 5 } });
    assert.equal(writes[0].rel, 'out/names.md', 'the path crosses EXACTLY as typed');

    app.repo.listProjectRefs = async () => [{ id: 'proj-1', threadId: 'th1' }];
    const two = runInput(part('file', { path: 'out/names.md' }), { in: [valueOf('text', 'Rome')] }, { app });
    await FILE.run(two.input);
    assert.equal(files.size, 1, 'one part, one path, ONE file');
    assert.equal(files.get('out/names.md'), 'Rome');
  });

  test('File does not rewrite an escape attempt — it lets the main process refuse it', async () => {
    /** @type {any[]} */ const seen = [];
    const app = {
      now: () => 5,
      projects: {
        create: async () => ({ ok: true, project: { id: 'proj-1' } }),
        meta: async () => ({ ok: true }),
        write: async (id, rel) => { seen.push(rel); return { ok: false, code: 'E_PATH', message: 'that path leaves the project' }; },
      },
      repo: { listProjectRefs: async () => [], putProjectRef: async () => {} },
    };
    const p = part('file', { path: '../../escaped.md' });
    const { input } = runInput(p, { in: [valueOf('text', 'x')] }, { app });
    const fail = await failureOf(FILE, input);
    assert.deepEqual(seen, ['../../escaped.md'], 'the renderer is not the boundary and does not pretend to be');
    assert.ok(fail.message.includes('that path leaves the project'), fail.message);
  });

  test('File refuses what it cannot write, before it makes a folder', async () => {
    /** @type {any[]} */ const created = [];
    const app = {
      now: () => 5,
      projects: { create: async () => { created.push(1); return { ok: true, project: { id: 'p1' } }; }, meta: async () => ({ ok: true }), write: async () => ({ ok: true, size: 0 }) },
      repo: { listProjectRefs: async () => [], putProjectRef: async () => {} },
    };
    const empty = runInput(part('file', { path: DEFAULT_PATH }), { in: [] }, { app });
    assert.equal((await failureOf(FILE, empty.input)).message, t('parts.errFileEmpty'));
    const noPath = runInput(part('file', { path: '  ' }), { in: [valueOf('text', 'x')] }, { app });
    assert.equal((await failureOf(FILE, noPath.input)).message, t('parts.errFileNoPath'));
    assert.equal(created.length, 0, 'a refusal never leaves an empty folder behind');
  });

  test('File shows the path it wrote and reveals that project, and nothing before it has run', async () => {
    await withDom(async () => {
      /** @type {any[]} */ const revealed = [];
      const p = part('file', { path: 'out/names.md' });
      const host = document.createElement('div');
      /** @type {any} */ const ctx = {
        update() {}, commit() {}, open() {}, part: p,
        app: { projects: { reveal: async (id) => { revealed.push(id); return { ok: true }; } }, dialogs: { toast() {} } },
      };
      const view = FILE.render(host, p, ctx);
      const line = host.querySelector('.graph-file-wrote');
      const button = host.querySelector('.graph-file-reveal');
      assert.equal(line.hidden, true, 'nothing is claimed before the part has run');
      assert.equal(button.hidden, true);

      view.update({ ...p, state: 'done', value: valueOf('file', { path: 'out/names.md', project: 'proj-1', size: 5 }) });
      assert.equal(line.hidden, false);
      assert.equal(line.textContent, t('parts.fileWrote', { path: 'out/names.md' }));
      assert.equal(button.hidden, false);
      button.dispatchEvent({ type: 'click', preventDefault() {} });
      await Promise.resolve();
      assert.deepEqual(revealed, ['proj-1'], 'Reveal opens THIS thread folder');
      view.destroy();
    });
  });

  // ------------------------------------------------------------------------------- the catalogue

  test('the three parts think about nothing and fan about nothing', () => {
    for (const spec of [CODE, RENDER, FILE]) {
      assert.equal(spec.thinks, false, `${spec.type} spends no generation`);
      for (const port of spec.inputs) {
        assert.ok(port.accepts.includes('list'),
          `${spec.type}.${port.name} takes a list WHOLE — that is how it declines to fan (BJ-9)`);
      }
    }
    assert.equal(CODE.output, 'json');
    assert.equal(RENDER.output, 'image');
    assert.equal(FILE.output, 'file');
    assert.equal(FILE.defaults().path, DEFAULT_PATH);
  });
};
