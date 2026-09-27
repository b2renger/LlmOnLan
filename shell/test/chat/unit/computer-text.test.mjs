// @ts-check
// K4-U1 in Node: the Text part (COMPUTER_PLAN §6.2 revision 2, kickoff addendum KD-4).
//
// What is asserted here is the behaviour the owner asked for and the two guarantees that make it
// safe to use: an arriving value LANDS in the box and passes on, a locked box and a box being
// typed into keep the person's words, and the content becomes nodes through `render/dom.mjs` and
// through nothing else. The whole-chain version — a real Instruction, a real farm answer, the
// real canvas — is `chat-harness/scenarios/k4-text.mjs`.

import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { valueOf, listOf, isValue } from '../../../renderer/chat/graph/values.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import {
  adopt, bodyOf, dismiss, forget, isEditing, isLocked, MAX_RENDER_CHARS, ownText, refusalOf,
  shown, textPart, shouldAutoLock, wasAutoLocked, copyText,
} from '../../../renderer/chat/graph/parts/text.mjs';

const SPECS = specMap();

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

/** One run of the Text part. @param {any} part @param {any[]} [arrivals] */
const run = (part, arrivals) => textPart.run(/** @type {any} */ ({
  part, inputs: { in: arrivals || [] }, labels: { in: [] },
  app: null, ask: null, signal: null, thread: null, cache: true,
}));

/** A box, rendered, with the handles a test needs. `app` stands in for the Computer (a test that
 * needs the open document — who is wired in — hands one). @param {any} doc @param {any} part
 * @param {any} [app] */
function box(doc, part, app) {
  const host = doc.createElement('div');
  /** @type {any[]} */ const patches = [];
  /** @type {string[]} */ const commits = [];
  let live = { ...part };
  /** @type {any} */ let inst = null;
  let inUpdate = false;
  const ctx = {
    app: app || {},
    get part() { return live; },
    update(/** @type {any} */ patch) {
      patches.push(patch);
      live = { ...live, settings: { ...live.settings, ...patch } };
      // FAITHFUL, and this is the point of the double: the real PartCtx.update() applies the patch
      // to the document (graph/canvas.mjs), the session fires, and the canvas hands the edited part
      // straight back to `box.inst.update(part)` on the SAME turn. A double that stops at the patch
      // can never see a repaint bug — which is how "typing hides the textarea after the first
      // keystroke" passed every unit test there was.
      if (inst && !inUpdate) {
        inUpdate = true;
        try { inst.update(live); } finally { inUpdate = false; }
      }
    },
    commit(/** @type {any} */ label) { commits.push(String(label)); },
    open() {},
  };
  inst = textPart.render(host, live, /** @type {any} */ (ctx));
  const pick = (/** @type {string} */ sel) => host.querySelector(sel);
  return {
    host, patches, commits, inst,
    get live() { return live; },
    /** @param {any} next */
    update(next) { live = next; inst.update(next); },
    area: () => pick('textarea'),
    body: () => pick('.graph-text-body'),
    from: () => pick('.graph-text-from'),
    clear: () => pick('.graph-text-clear'),
    lock: () => pick('.graph-text-lock'),
    edit: () => pick('.graph-text-edit'),
    copy: () => pick('.graph-text-copy'),
    notice: () => pick('.graph-text-notice'),
  };
}

/** An app whose open document has these wires. @param {any[]} wires */
const appWith = (wires) => ({ host: { session: { doc: () => ({ parts: [], wires }) } } });

export default function (test) {
  // ---- the contract the catalogue makes -------------------------------------------------------

  test('Text is the catalogue row for `note`, with one input and a text output', () => {
    const spec = SPECS.get('note');
    assert.equal(spec, textPart, 'graph/parts/index.mjs serves the Text part for type `note`');
    assert.equal(spec.type, 'note', 'the TYPE ID is still note: no migration, no alias table');
    assert.equal(spec.label, t('parts.textLabel'));
    assert.equal(spec.thinks, false, 'a Text box never spends a generation');
    assert.equal(spec.quiet, true, 'it draws its own value, so the canvas foot strip stands down');
    assert.equal(spec.output, 'text');
    assert.deepEqual(spec.inputs.map((/** @type {any} */ p) => p.name), ['in']);
    assert.equal(spec.inputs[0].many, true, 'several wires may land in one box');
    assert.deepEqual(spec.inputs[0].accepts, ['text', 'json', 'list'],
      'a list is ACCEPTED, so forty items are one report and not forty runs');
    assert.deepEqual(spec.defaults(), { text: '', locked: false });
  });

  // ---- nothing wired in: exactly what C1 shipped ----------------------------------------------

  test('with nothing wired in it answers its own text and never touches the farm', async () => {
    const value = await run({ id: 'a', settings: { text: 'Paris' } });
    assert.deepEqual(value, { kind: 'text', data: 'Paris' },
      'the literal C1 shipped, byte for byte — a Text box stays free to use as a comment');
    assert.equal(refusalOf('a'), '', 'nothing was refused, because nothing arrived');
  });

  // ---- the owner's requirement: an answer lands in the box and passes on -----------------------

  test('an arriving value is adopted as the box\'s value and passed on downstream', async () => {
    const part = { id: 'b', settings: { text: '' } };
    const out = await run(part, [valueOf('text', '# Report\n\n- one\n- two')]);
    assert.equal(out.kind, 'text');
    assert.equal(out.data, '# Report\n\n- one\n- two', 'what arrived is what leaves');
    // Rule 1: the run produced a VALUE. It did not write the program.
    assert.equal(ownText(part.settings), '', 'settings.text is changed by typing and nothing else');
    assert.deepEqual(bodyOf({ ...part, value: out }), { text: '# Report\n\n- one\n- two', from: 'input' });
  });

  test('one text arrival passes through VERBATIM, facets and all', () => {
    const code = valueOf('text', 'let x = 1', { format: 'code', lang: 'js' });
    assert.equal(adopt([code]), code, 'the same object: a Code part\'s fence survives the box');
  });

  test('json, a list and several wires all become honest text', () => {
    assert.equal(adopt([valueOf('json', { a: 1 })]).data, '{\n  "a": 1\n}');
    assert.equal(adopt([listOf([valueOf('text', 'one'), valueOf('text', 'two')])]).data, 'one\ntwo');
    assert.equal(adopt([valueOf('text', 'first'), valueOf('text', 'second')]).data, 'first\n\nsecond',
      'two wires are two reports, separated so one markdown never runs into the next');
    assert.ok(isValue(adopt([])), 'nothing usable is still a value, never a null');
  });

  // ---- the lock: "keep what I typed" -----------------------------------------------------------

  test('a locked box refuses an arrival, says so quietly, and still passes its own text on', async () => {
    const part = { id: 'c', settings: { text: 'my notes', locked: true } };
    assert.equal(isLocked(part.settings), true);
    const out = await run(part, [valueOf('text', 'the model wrote over it')]);
    assert.deepEqual(out, { kind: 'text', data: 'my notes' },
      'a locked box is a constant in a loop, not a hole in it');
    assert.equal(refusalOf('c'), 'locked');
    forget('c');
  });

  test('a box whose source editor is open keeps the person\'s words — stronger than the lock', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'd', type: 'note', settings: { text: 'half a th', locked: false }, value: null });
      assert.equal(b.inst.edit(), true, 'K-2: the canvas opens the editor (double-click, Enter, F2)');
      assert.equal(isEditing('d'), true, 'the box declares it is being typed into');

      const out = await run(b.live, [valueOf('text', 'an answer that must not land')]);
      assert.deepEqual(out, { kind: 'text', data: 'half a th' });
      assert.equal(refusalOf('d'), 'unsaved');

      // …and the arrival does not paint over the open editor either.
      b.update({ ...b.live, state: 'done', value: valueOf('text', 'an answer that must not land') });
      assert.equal(b.area().hidden, false, 'the textarea is still what the person is looking at');
      assert.equal(b.area().value, 'half a th', 'and it still holds their words');
      b.inst.destroy();
      assert.equal(isEditing('d'), false, 'a destroyed box remembers nothing');
    });
  });

  // ---- typing, committing, and the old C1 gesture ----------------------------------------------

  test('the textarea reports typing live and commits once on change', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'e', type: 'note', settings: { text: '' }, value: null });
      const area = b.area();
      assert.equal(area.hidden, false, 'an EMPTY box is a textarea: you can type without clicking');
      area.value = 'hello';
      area.dispatchEvent({ type: 'input' });
      area.dispatchEvent({ type: 'change' });
      assert.deepEqual(b.patches, [{ text: 'hello' }], 'one live patch, and it carries only `text`');
      assert.equal(b.commits.length, 1, 'one history entry per edit, not per keystroke');
      b.inst.destroy();
    });
  });

  test('typing into a FRESH box keeps the textarea under the caret, keystroke after keystroke', async () => {
    await withDom(async (doc) => {
      // The headline path of the whole phase: place a Text box, type. No click on the body first —
      // an empty box IS the textarea. Each keystroke goes through ctx.update -> the document -> the
      // canvas -> inst.update(part), which is what the double above now reproduces.
      const b = box(doc, { id: 'e2', type: 'note', settings: { text: '' }, value: null });
      const area = b.area();
      assert.equal(area.hidden, false, 'a fresh box shows its textarea');

      area.value = 'h';
      area.dispatchEvent({ type: 'input' });
      assert.equal(b.area().hidden, false, 'the field the caret is in did not vanish on keystroke 1');
      assert.equal(b.body().hidden, true, 'and the rendered body did not take its place');
      assert.equal(isEditing('e2'), true, 'typing takes the editing lock, so a run keeps these words');

      area.value = 'he';
      area.dispatchEvent({ type: 'input' });
      area.value = 'hel';
      area.dispatchEvent({ type: 'input' });
      assert.equal(b.area().hidden, false, 'and it is still there three keystrokes in');
      assert.equal(b.area().value, 'hel', 'holding every character that was typed');
      assert.deepEqual(b.patches, [{ text: 'h' }, { text: 'he' }, { text: 'hel' }]);
      assert.equal(b.commits.length, 0, 'nothing is committed until the edit ends');

      area.dispatchEvent({ type: 'change' });
      assert.equal(ownText(b.live.settings), 'hel');
      assert.equal(isEditing('e2'), false, 'and the lock is released when the edit ends');
      b.inst.destroy();
    });
  });

  test('focus alone takes the editing lock, so a run cannot land on an open field', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'e3', type: 'note', settings: { text: '' }, value: null });
      assert.equal(isEditing('e3'), false);
      b.area().dispatchEvent({ type: 'focus' });
      assert.equal(isEditing('e3'), true, 'tabbing into the field is editing it');
      assert.equal(b.area().hidden, false);
      b.inst.destroy();
    });
  });

  // ---- the rendering, through the one safe path -------------------------------------------------

  test('a very long arrival is rendered down to a ceiling, and says so', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'g2', type: 'note', settings: { text: '' }, value: null });
      const line = ['a paragraph of report text that keeps going', '', ''].join('\n');
      const huge = line.repeat(Math.ceil((MAX_RENDER_CHARS * 3) / line.length));
      assert.ok(huge.length > MAX_RENDER_CHARS * 2);
      b.update({ ...b.live, state: 'done', value: valueOf('text', huge) });
      const body = b.body();
      assert.equal(body.hidden, false);
      const html = doc.serialize(body);
      // The ceiling is on what is BUILT: a megabyte of markdown is ~0.4 s of main-thread work.
      assert.ok(html.length < huge.length, 'the whole megabyte was not turned into nodes');
      const said = body.querySelector('.graph-text-notice');
      assert.ok(said, 'and the box says what it is showing');
      assert.equal(said.textContent, t('parts.textTruncated', { kb: Math.round(MAX_RENDER_CHARS / 1024) }));
      // Rule 1 stands: the VALUE is untouched, so downstream still gets every byte.
      assert.equal(b.live.value.data.length, huge.length, 'the value on the wire is the whole text');
      b.inst.destroy();
    });
  });

  test('a received value renders as markdown — headings, lists, tables, code, and no HTML', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'f', type: 'note', settings: { text: '' }, value: null });
      const md = [
        '# Forestry',
        '',
        'A **bold** claim and `code`.',
        '',
        '- one',
        '- two',
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '```js',
        'let x = 1;',
        '```',
        '',
        '<img src=x onerror="boom()">',
      ].join('\n');
      b.update({ ...b.live, state: 'done', value: valueOf('text', md) });

      const body = b.body();
      assert.equal(body.hidden, false, 'the value shows rendered, not as source');
      assert.equal(b.area().hidden, true);
      const html = doc.serialize(body);
      assert.ok(html.indexOf('<h1>Forestry</h1>') >= 0, html);
      assert.ok(html.indexOf('<strong>bold</strong>') >= 0, html);
      assert.ok(html.indexOf('<li>one</li>') >= 0, html);
      assert.ok(html.indexOf('<table') >= 0 && html.indexOf('<td>1</td>') >= 0, html);
      assert.ok(html.indexOf('language-js') >= 0, html);
      // The one that matters: model text never becomes HTML by any other route.
      assert.ok(html.indexOf('&lt;img src=x onerror=') >= 0, 'an injected tag stayed text, escaped: ' + html);
      assert.equal(body.querySelectorAll('img').length, 0, 'and it never became an element');
      assert.equal(body.querySelectorAll('[onerror]').length, 0, 'nor an event handler');
      b.inst.destroy();
    });
  });

  test('the box says where its content came from, and ↺ Clear gives the typed text back', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'g', type: 'note', settings: { text: 'my own words' }, value: null });
      assert.equal(b.from().hidden, true, 'nothing arrived, so nothing is claimed');
      assert.equal(b.clear().hidden, true);

      const answer = valueOf('text', 'what the model said');
      b.update({ ...b.live, state: 'done', value: answer });
      assert.equal(b.from().textContent, t('parts.textFromInput'));
      assert.equal(b.clear().hidden, false, 'and there is a way back');
      assert.equal(b.body().textContent.indexOf('what the model said') >= 0, true);

      b.clear().dispatchEvent({ type: 'click', target: b.clear() });
      assert.deepEqual(shown(b.live), { text: 'my own words', from: 'own' });
      assert.equal(b.area().value, 'my own words', 'the typed text is back, and editable');
      assert.equal(b.clear().hidden, true);

      // A re-run makes a NEW value object, so the dismissal never outlives what it dismissed.
      b.update({ ...b.live, value: valueOf('text', 'a second answer') });
      assert.equal(shown(b.live).from, 'input');
      b.inst.destroy();
    });
  });

  test('a value that IS the person\'s own words is never labelled "from input"', () => {
    const part = { id: 'h', settings: { text: 'Paris' }, value: valueOf('text', 'Paris') };
    assert.deepEqual(bodyOf(part), { text: 'Paris', from: 'own' },
      'a locked box, or one with nothing wired in, does not lie about where its words came from');
  });

  test('the lock control writes the setting and enters undo', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'i', type: 'note', settings: { text: 'x', locked: false }, value: null });
      assert.equal(b.lock().getAttribute('aria-pressed'), 'false');
      b.lock().dispatchEvent({ type: 'click', target: b.lock() });
      assert.deepEqual(b.patches, [{ locked: true }]);
      assert.equal(b.commits.length, 1, 'a lock is a program edit, so it is undoable');
      assert.equal(b.lock().getAttribute('aria-pressed'), 'true');
      assert.equal(b.from().textContent, t('parts.textLocked'));
      b.inst.destroy();
    });
  });

  test('the quiet line names which guard kept the words, and never an error', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'j', type: 'note', settings: { text: 'mine', locked: true }, value: null });
      await run(b.live, [valueOf('text', 'refused')]);
      b.update({ ...b.live, state: 'done', value: valueOf('text', 'mine') });
      assert.equal(b.notice().hidden, false);
      assert.equal(b.notice().textContent, t('parts.textRefused'));
      assert.equal(b.live.error, undefined, 'nothing went wrong: a refusal is not a failure');
      b.inst.destroy();
    });
  });

  test('render()/destroy() leaves the host exactly as it found it', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'k', type: 'note', settings: { text: 'bye' }, value: null });
      assert.ok(b.host.childNodes.length > 0);
      b.inst.destroy();
      assert.equal(b.host.childNodes.length, 0);
    });
  });

  test('dismiss/forget are keyed per box and leak nothing between them', () => {
    const v = valueOf('text', 'shared');
    dismiss('x1', v);
    assert.deepEqual(shown({ id: 'x1', settings: { text: 'own' }, value: v }), { text: 'own', from: 'own' });
    assert.deepEqual(shown({ id: 'x2', settings: { text: 'own' }, value: v }), { text: 'shared', from: 'input' });
    forget('x1');
    assert.deepEqual(shown({ id: 'x1', settings: { text: 'own' }, value: v }), { text: 'shared', from: 'input' });
  });

  // ---- critic R1 A6/A7 (Package C): editing a box that holds text, and copying its words --------

  test('A6: edit() (K-2) opens the source seeded from what the box SHOWS, and says it did', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'r1', type: 'note', settings: { text: 'typed long ago' }, value: null });
      assert.equal(b.area().hidden, true, 'a filled box shows its rendered words');
      assert.equal(typeof b.inst.edit, 'function', 'the instance offers the K-2 door');
      assert.equal(b.inst.edit(), true);
      assert.equal(b.area().hidden, false, 'the source is up');
      assert.equal(b.body().hidden, true);
      assert.equal(b.area().value, 'typed long ago', 'seeded from the words shown');
      assert.equal(b.from().textContent, t('parts.textEditing'));
      b.inst.destroy();

      // A box that shows an ARRIVAL seeds the editor with the arrival — what the person saw.
      const c = box(doc, { id: 'r2', type: 'note', settings: { text: 'mine' }, value: valueOf('text', 'the model wrote this') });
      c.inst.edit();
      assert.equal(c.area().value, 'the model wrote this');
      c.area().value = 'the model wrote this!';
      assert.equal(c.inst.edit(), true, 'asking twice is harmless');
      assert.equal(c.area().value, 'the model wrote this!', 'and does not re-seed over the edit');
      c.inst.destroy();
    });
  });

  test('A6: a single click selects (no editor); a double-click on the words edits; a link stays a link', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'r3', type: 'note', settings: { text: 'words' }, value: null });
      b.body().dispatchEvent({ type: 'click', target: b.body() });
      assert.equal(b.area().hidden, true, 'one click only selects the box (the canvas does that)');
      assert.equal(isEditing('r3'), false);
      const link = { closest: (/** @type {string} */ sel) => (sel === 'a' ? {} : null) };
      b.body().dispatchEvent({ type: 'dblclick', target: link });
      assert.equal(b.area().hidden, true, 'a double-click on a link does not open the editor');
      b.body().dispatchEvent({ type: 'dblclick', target: b.body() });
      assert.equal(b.area().hidden, false, 'a double-click on the words does');
      b.inst.destroy();
    });
  });

  test('A6: ✎ Edit opens the editor; ✎ and Copy belong to a box that is showing text', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'r4', type: 'note', settings: { text: 'words' }, value: null });
      assert.equal(b.edit().hidden, false);
      assert.equal(b.edit().textContent, t('parts.textEdit'));
      assert.equal(b.edit().tagName, 'button', 'a real button: it works whatever the canvas does with a press');
      assert.equal(b.copy().hidden, false);
      b.edit().dispatchEvent({ type: 'click', target: b.edit(), preventDefault() {}, stopPropagation() {} });
      assert.equal(b.area().hidden, false, '✎ opened the source');
      assert.equal(b.edit().hidden, true, 'nothing to open while it is open');
      assert.equal(b.copy().hidden, true, 'the field copies itself while it is up');
      b.inst.destroy();
      const e = box(doc, { id: 'r5', type: 'note', settings: { text: '' }, value: null });
      assert.equal(e.edit().hidden, true, 'an empty box is its own editor');
      assert.equal(e.copy().hidden, true, 'and has nothing to copy');
      e.inst.destroy();
    });
  });

  test('A7: the rendered words are a selectable zone (K-1)', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'r6', type: 'note', settings: { text: 'select me' }, value: null });
      assert.equal(b.body().getAttribute('data-selectable'), 'text');
      b.inst.destroy();
    });
  });

  test('A7: Copy puts the WHOLE text on the clipboard — not the rendered-down head of a long one', async () => {
    const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    /** @type {string[]} */ const wrote = [];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, value: { clipboard: { writeText: async (/** @type {string} */ s) => { wrote.push(s); } } },
    });
    try {
      await withDom(async (doc) => {
        const long = `# Long\n\n${'word '.repeat(Math.ceil(MAX_RENDER_CHARS / 5) + 100)}`;
        const b = box(doc, { id: 'r7', type: 'note', settings: { text: 'mine' }, value: valueOf('text', long) });
        b.copy().dispatchEvent({ type: 'click', target: b.copy(), preventDefault() {}, stopPropagation() {} });
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(wrote.length, 1);
        assert.equal(wrote[0], long, 'every character of what the box holds');
        assert.equal(b.copy().textContent, t('parts.textCopied'), 'and the button says so');
        b.inst.destroy();
      });
      assert.equal(await copyText('x'), true);
    } finally {
      if (had) Object.defineProperty(globalThis, 'navigator', had);
      else delete (/** @type {any} */ (globalThis)).navigator;
    }
  });

  test('A6: shouldAutoLock is exactly "wired in and not locked" — unknown never locks', () => {
    assert.equal(shouldAutoLock({ wired: true, locked: false }), true);
    assert.equal(shouldAutoLock({ wired: true, locked: true }), false);
    assert.equal(shouldAutoLock({ wired: false, locked: false }), false);
    assert.equal(shouldAutoLock({ wired: null, locked: false }), false);
  });

  test('A6: the first keystroke on a WIRED box locks it, in the same patch as the text', async () => {
    await withDom(async (doc) => {
      const app = appWith([{ id: 'w1', from: 'ins', to: 'r8', port: 'in' }]);
      const b = box(doc, { id: 'r8', type: 'note', settings: { text: '', locked: false }, value: valueOf('text', 'an answer') }, app);
      b.inst.edit();
      b.area().value = 'an answer, edited';
      b.area().dispatchEvent({ type: 'input' });
      assert.deepEqual(b.patches, [{ text: 'an answer, edited', locked: true }],
        'ONE patch: one undo entry takes back the words and the lock together');
      assert.equal(wasAutoLocked('r8'), true);
      b.area().value = 'an answer, edited twice';
      b.area().dispatchEvent({ type: 'input' });
      assert.deepEqual(b.patches[1], { text: 'an answer, edited twice' }, 'the lock is set once');
      b.area().dispatchEvent({ type: 'blur' });
      assert.equal(b.notice().hidden, false, 'the box says why it is locked');
      assert.equal(b.notice().textContent, t('parts.textAutoLocked'));

      // …and the next run keeps the edit instead of re-adopting the arrival.
      const out = await run(b.live, [valueOf('text', 'a NEW answer')]);
      assert.deepEqual(out, { kind: 'text', data: 'an answer, edited twice' });

      // Unlocking by hand answers the line: it goes.
      b.lock().dispatchEvent({ type: 'click', target: b.lock() });
      assert.equal(wasAutoLocked('r8'), false);
      assert.notEqual(b.notice().textContent, t('parts.textAutoLocked'));
      b.inst.destroy();
    });
  });

  test('A6: typing into an UNWIRED box never locks it', async () => {
    await withDom(async (doc) => {
      const b = box(doc, { id: 'r9', type: 'note', settings: { text: '' }, value: null }, appWith([]));
      b.area().dispatchEvent({ type: 'focus' });
      b.area().value = 'a note';
      b.area().dispatchEvent({ type: 'input' });
      assert.deepEqual(b.patches, [{ text: 'a note' }]);
      assert.equal(wasAutoLocked('r9'), false);
      b.inst.destroy();
    });
  });
}
