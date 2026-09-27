// @ts-check
// Owner, 2026-09-27: "the code boxes are too intimidating — a model should be able to write them, and
// a model should write the Laya prompt". The Code box's `code` port, the Write code / Write a Laya
// question presets, and the Classify box's `question` port.
import assert from 'node:assert/strict';
import { code as CODE, arrivedCode } from '../../../renderer/chat/graph/parts/code.mjs';
import { classifyPart, questionOf, labelsFrom, itemsOf } from '../../../renderer/chat/graph/parts/classify.mjs';
import { creativePresets, presetOf, LAYA_QUESTION_SCHEMA } from '../../../renderer/chat/graph/parts/creative.mjs';
import { codeKindOf, codeSystem } from '../../../renderer/chat/graph/bind.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { templateById } from '../../../renderer/chat/computer/tutorial/registry.mjs';

/** A sandbox that answers with the program it was handed and the inputs it saw. */
const echoSandbox = () => ({
  async compute(/** @type {any} */ req) { return { ok: true, json: JSON.stringify({ ran: req.code, saw: Object.keys(req.inputs).sort() }) }; },
});
/** @param {any} settings @param {any} inputs */
const runCode = (settings, inputs) => CODE.run(/** @type {any} */ ({
  part: { id: 'c1', settings: { code: '', ...settings } }, inputs, sandbox: async () => echoSandbox(),
}));

export default (test) => {
  test('Read the news, reshaped: website + topics → a model writes Laya\'s question → Laya → second opinion; the two Code boxes are folded', () => {
    const tpl = /** @type {any} */ (templateById('read-the-news'));
    const doc = tpl.doc;
    const part = (/** @type {string} */ id) => doc.parts.find((/** @type {any} */ p) => p.id === id);
    assert.equal(presetOf(part('n_write')), 'write-laya', 'the template\'s schema is the preset\'s, byte for byte');
    assert.ok(doc.wires.some((/** @type {any} */ w) => w.from === 'n_write' && w.to === 'n_laya' && w.port === 'question'));
    assert.ok(doc.wires.some((/** @type {any} */ w) => w.from === 'n_src' && w.to === 'n_laya' && w.port === 'items'), 'Laya reads the website directly');
    assert.ok(doc.wires.some((/** @type {any} */ w) => w.from === 'n_laya' && w.to === 'n_label'), 'the second opinion reads Classify\'s answers directly');
    assert.ok(doc.wires.some((/** @type {any} */ w) => w.from === 'n_cats' && w.to === 'n_laya' && w.port === 'options'), 'the person\'s topics are Laya\'s options, exactly');
    const codes = doc.parts.filter((/** @type {any} */ p) => p.type === 'code');
    assert.deepEqual(codes.map((/** @type {any} */ p) => [p.id, p.settings.folded === true, !!String(p.settings.about).trim()]), [['n_count', true, true], ['n_draw', true, true]]);
    assert.equal(tpl.generations, doc.parts.filter((/** @type {any} */ p) => p.type === 'ask').length);
  });

  test('Read the news, Count: from the website\'s hits, Laya\'s sure labels, then the model\'s — every story once', async () => {
    const tpl = /** @type {any} */ (templateById('read-the-news'));
    const part = (/** @type {string} */ id) => tpl.doc.parts.find((/** @type {any} */ p) => p.id === id);
    const page = part('n_src').value.data;
    const n = page.hits.length;
    const laya = (/** @type {any} */ (await classifyPart.run(/** @type {any} */ ({
      part: { id: 'k2', settings: { question: 'Topic?', options: 'ai\nscience', threshold: 0.6 } },
      inputs: { items: [valueOf('json', page)] }, app: { farm: { get: () => ({}) } },
    })))).data;
    const model = { labels: [{ id: 1, topic: 'AI', sure: true }, { id: 2, topic: 'gardening', sure: true }, { id: 3, topic: 'science', sure: false }] };
    const count = new Function('inputs', part('n_count').settings.code);
    const out = count({ in: [page, laya, model, part('n_cats').settings.text] });
    assert.equal(out.total, n);
    assert.equal(out.byTopic.reduce((/** @type {number} */ s, /** @type {any} */ r) => s + r.stories, 0), n, 'every story counted once');
    assert.deepEqual(out.labelledBy, { laya: 0, model: 3 }, 'no Laya: the model labelled what it labelled');
    assert.equal(out.byTopic.find((/** @type {any} */ r) => r.topic === 'ai').points, Number(page.hits[0].points), 'points come from the data');
    assert.deepEqual(out.unsure.slice(0, 2).map((/** @type {any} */ u) => u.why), ['not one of your topics: gardening', 'neither Laya nor the model was sure (science)']);
  });

  test('Code: a program on the `code` port runs, unfenced; the guest never sees it as data', async () => {
    const out = /** @type {any} */ (await runCode({ code: 'return 1;' }, {
      in: [valueOf('json', { hits: [] })],
      code: [valueOf('text', 'Here is the code:\n```javascript\nreturn inputs.in.length;\n```\nEnjoy.')],
    }));
    assert.equal(out.data.ran, 'return inputs.in.length;');
    assert.deepEqual(out.data.saw, ['in', 'item'], 'the value ports and the fan-out position, never `code`');
  });

  test('Code: nothing on `code` runs the box\'s own code; LOCKED keeps it even when a program arrives', async () => {
    assert.equal((/** @type {any} */ (await runCode({ code: 'return 2;' }, { in: [] }))).data.ran, 'return 2;');
    const locked = /** @type {any} */ (await runCode({ code: 'return 3;', locked: true }, { in: [], code: [valueOf('text', 'return 4;')] }));
    assert.equal(locked.data.ran, 'return 3;');
    await assert.rejects(runCode({ code: '' }, { in: [], code: [valueOf('text', '   ')] }), /sent no code/);
  });

  test('Code: arrivedCode is null with nothing on the port, and never fans (the port takes a list whole)', () => {
    assert.equal(arrivedCode([]), null);
    assert.equal(arrivedCode([valueOf('text', 'return 5;')]), 'return 5;');
    assert.ok(CODE.inputs.every((/** @type {any} */ p) => p.accepts.includes('list')));
    assert.deepEqual(Object.keys(CODE.defaults()).sort(), ['about', 'code', 'folded', 'locked']);
  });

  test('Write code: an Instruction that answers in `js`, with the Code box\'s rules in its system message', () => {
    const p = /** @type {any} */ (creativePresets().find((x) => x.id === 'write-code'));
    assert.equal(codeKindOf(p.settings), 'js');
    assert.match(codeSystem('js'), /inputs\.in is an ARRAY/);
    assert.equal(presetOf({ type: 'ask', settings: { ...p.settings, instruction: 'anything else' } }), 'write-code', 'titled by its code kind, whatever the words');
  });

  test('Write a Laya question: a JSON answer {question, options}, matched by its schema', () => {
    const p = /** @type {any} */ (creativePresets().find((x) => x.id === 'write-laya'));
    assert.equal(p.settings.shape, 'json');
    assert.deepEqual(JSON.parse(LAYA_QUESTION_SCHEMA).required, ['question', 'options']);
    assert.equal(presetOf({ type: 'ask', settings: { ...p.settings, instruction: 'reworded' } }), 'write-laya');
  });

  test('Classify: the `question` port — text is the question; an object brings the options too', () => {
    assert.deepEqual(questionOf('  What is it about? '), { question: 'What is it about?', options: null });
    assert.deepEqual(questionOf({ question: 'Topic?', options: ['AI', 'science', 'ai'] }), { question: 'Topic?', options: ['ai', 'science'] });
    assert.deepEqual(questionOf({ instructions: 'Topic?', options: { a: 'first', b: 'second' } }), { question: 'Topic?', options: ['a', 'b'] });
    assert.deepEqual(questionOf([1, 2]), { question: '', options: null });
    assert.ok(classifyPart.inputs.some((/** @type {any} */ p) => p.name === 'question'));
  });

  test('Classify: the wired question is what is asked; `check` carries the text of the unsure items only', async () => {
    const out = /** @type {any} */ (await classifyPart.run(/** @type {any} */ ({
      part: { id: 'k1', settings: { question: 'own?', options: 'x\ny', threshold: 0.6 } },
      inputs: {
        items: [valueOf('json', { hits: [{ title: 'A new chip' }, { title: 'A comet' }] })],
        question: [valueOf('json', { question: 'Which topic?', options: ['hardware', 'science', 'other'] })],
      },
      app: { farm: { get: () => ({}) } },   // no Laya on this farm: nothing is sent
    })));
    assert.equal(out.data.by, 'none');
    assert.deepEqual(out.data.check, [{ id: 1, text: 'A new chip' }, { id: 2, text: 'A comet' }], 'no Laya: every item is to check');
    const rows = itemsOf(['short', { title: 'x'.repeat(400) }, 'sure one']);
    const v = labelsFrom(rows, [{ choice: 'a', confidence: 0.2 }, { choice: 'a', confidence: 0.3 }, { choice: 'b', confidence: 0.9 }], 0.6, 5);
    assert.deepEqual(v.check.map((/** @type {any} */ c) => c.id), [1, 2], 'a sure item is never handed on to re-read');
    assert.equal(v.check[1].text.length, 300, 'capped');
    assert.ok(v.labels.every((/** @type {any} */ l) => !('text' in l)));
  });
};
