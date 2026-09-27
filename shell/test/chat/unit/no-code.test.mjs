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

/** A sandbox that answers with the program it was handed and the inputs it saw. */
const echoSandbox = () => ({
  async compute(/** @type {any} */ req) { return { ok: true, json: JSON.stringify({ ran: req.code, saw: Object.keys(req.inputs).sort() }) }; },
});
/** @param {any} settings @param {any} inputs */
const runCode = (settings, inputs) => CODE.run(/** @type {any} */ ({
  part: { id: 'c1', settings: { code: '', ...settings } }, inputs, sandbox: async () => echoSandbox(),
}));

export default (test) => {
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

  test('Classify: the wired question and options are what is asked; the output carries each item\'s text', async () => {
    const out = /** @type {any} */ (await classifyPart.run(/** @type {any} */ ({
      part: { id: 'k1', settings: { question: 'own?', options: 'x\ny', threshold: 0.6 } },
      inputs: {
        items: [valueOf('json', { hits: [{ title: 'A new chip' }, { title: 'A comet' }] })],
        question: [valueOf('json', { question: 'Which topic?', options: ['hardware', 'science', 'other'] })],
      },
      app: { farm: { get: () => ({}) } },   // no Laya on this farm: nothing is sent
    })));
    assert.equal(out.data.by, 'none');
    assert.deepEqual(out.data.labels.map((/** @type {any} */ l) => l.text), ['A new chip', 'A comet']);
    const rows = itemsOf(['short', { title: 'x'.repeat(400) }]);
    assert.equal(labelsFrom(rows, null, 0.6, 0).labels[1].text.length, 300, 'capped');
  });
};
