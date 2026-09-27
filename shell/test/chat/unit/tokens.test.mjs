// ctx/tokens.mjs (P2-U2): the local token estimator and its calibration.
//
// These assertions are the honesty contract of the meter and the cost gate: a CJK paste must not be
// counted like English (it is ~3x more tokens), an image must cost something, and one odd reply must
// never be able to move the ratio to a value that would let the next send overflow silently.
import assert from 'node:assert/strict';
import {
  estimateText, estimateMessage, estimateRequest, breakdown, calibrate, promptChars, systemTextOf,
  imageCount, DEFAULT_RATIO, MIN_RATIO, MAX_RATIO, PER_MESSAGE_TOKENS, IMAGE_TOKENS,
} from '../../../renderer/chat/ctx/tokens.mjs';

/** A RequestDraft.messages entry. */
const entry = (role, text, extra = {}) => ({
  msgId: extra.msgId === undefined ? `m-${role}-${text.slice(0, 4)}` : extra.msgId,
  role,
  pinned: !!extra.pinned,
  blocks: text === null ? (extra.blocks || []) : [{ type: 'text', text, tag: role === 'user' ? 'user' : 'assistant' }],
});

const req = (messages, extra = {}) => ({
  model: extra.model || 'assistant',
  system: extra.system === undefined ? null : extra.system,
  systemAppend: extra.systemAppend || [],
  messages,
  params: extra.params || {},
  meta: { engine: null, budget: null, estimate: 0, trimmedIds: [], newTurnEstimate: 0, allowances: extra.allowances || [] },
});

export default (test) => {
  test('plain text is chars / ratio, rounded up', () => {
    assert.equal(estimateText('', 3.6), 0);
    assert.equal(estimateText('a', 3.6), 1);                    // ceil(1/3.6)
    assert.equal(estimateText('x'.repeat(36), 3.6), 10);
    assert.equal(estimateText('x'.repeat(37), 3.6), 11);        // rounded UP, never down
    assert.equal(estimateText('x'.repeat(36), 4), 9);           // a calibrated ratio is honoured
  });

  test('CJK, kana and Hangul count one token per character', () => {
    // 10 ideographs: 10 tokens, not ceil(10/3.6) = 3.
    const han = '東京都渋谷区神南一丁目';
    assert.equal(estimateText(han, 3.6), han.length);
    assert.equal(estimateText('ひらがなカタカナ', 3.6), 8);
    assert.equal(estimateText('안녕하세요', 3.6), 5);
    // Mixed: the wide characters count 1 each, the Latin tail is divided.
    assert.equal(estimateText('東京 tokyo', 3.6), 2 + Math.ceil(' tokyo'.length / 3.6));
    // An astral ideograph is ONE character even though it is two UTF-16 units.
    const astral = String.fromCodePoint(0x20000);
    assert.equal(astral.length, 2);
    assert.equal(estimateText(astral, 3.6), 1);
  });

  test('a nonsense ratio falls back to the default instead of dividing by zero', () => {
    assert.equal(estimateText('x'.repeat(36), 0), 10);
    assert.equal(estimateText('x'.repeat(36), /** @type {any} */(null)), 10);
    assert.equal(estimateText(/** @type {any} */(null), 3.6), 0);
  });

  test('a message costs its blocks plus the role envelope, and 1,600 per image', () => {
    assert.equal(estimateMessage(entry('user', ''), 3.6), PER_MESSAGE_TOKENS);
    assert.equal(estimateMessage(entry('user', 'x'.repeat(36)), 3.6), PER_MESSAGE_TOKENS + 10);
    const withImage = { msgId: 'm1', role: 'user', pinned: false, blocks: [{ type: 'text', text: 'look' }, { type: 'image', attId: 'a1' }] };
    assert.equal(imageCount(withImage), 1);
    assert.equal(estimateMessage(withImage, 3.6), PER_MESSAGE_TOKENS + Math.ceil(4 / 3.6) + IMAGE_TOKENS);
    assert.equal(estimateMessage(null, 3.6), 0);
  });

  test('the system message is system + systemAppend, joined the way toOpenAIBody joins them', () => {
    const r = req([], { system: 'be brief', systemAppend: ['answer in JSON'] });
    assert.equal(systemTextOf(r), 'be brief\n\nanswer in JSON');
    const b = breakdown(r, 3.6);
    assert.equal(b.system, estimateText('be brief\n\nanswer in JSON', 3.6) + PER_MESSAGE_TOKENS);
    assert.equal(b.total, b.system);
    // No system at all costs nothing, envelope included.
    assert.equal(breakdown(req([]), 3.6).system, 0);
  });

  test('the breakdown splits system / pinned / history / this message, and allowances count', () => {
    const messages = [
      entry('user', 'x'.repeat(360), { msgId: 'u1', pinned: true }),
      entry('assistant', 'y'.repeat(360), { msgId: 'a1' }),
      entry('user', 'z'.repeat(360), { msgId: 'u2' }),
    ];
    const b = breakdown(req(messages, { system: 's', allowances: [{ id: 'search', tokens: 700 }] }), 3.6);
    assert.equal(b.pinned, PER_MESSAGE_TOKENS + 100, 'the pinned first turn');
    assert.equal(b.history, PER_MESSAGE_TOKENS + 100, 'the assistant in between');
    assert.equal(b.newTurn, PER_MESSAGE_TOKENS + 100, 'the LAST user turn is "this message"');
    assert.equal(b.allowances, 700);
    assert.equal(b.total, b.system + b.pinned + b.history + b.newTurn + b.allowances);
    assert.equal(estimateRequest(req(messages, { system: 's', allowances: [{ id: 'search', tokens: 700 }] }), 3.6), b.total);
    assert.deepEqual(b.perMessage.map((m) => m.msgId), ['u1', 'a1', 'u2']);
  });

  test('breakdown.images is a REPORT inside the turn rows, never a bucket on top of them', () => {
    // The contract ui/meter.mjs's popover depends on. estimateMessage already charges IMAGE_TOKENS,
    // so `total` = system + pinned + history + newTurn + allowances and NOT + images. The popover
    // used to print `allowances + images` as its Attachments row, which made the column sum to
    // roughly twice its own Total the moment a message carried an image (P2 review).
    const withImage = {
      msgId: 'u1', role: 'user', pinned: false,
      blocks: [{ type: 'text', text: 'what is this' }, { type: 'image', dataUrl: 'data:image/png;base64,AA' }],
    };
    const b = breakdown(req([withImage], { system: 'hi' }), 3.6);
    assert.equal(b.images, IMAGE_TOKENS, 'one image reported');
    assert.ok(b.newTurn > IMAGE_TOKENS, 'and already charged inside the turn it belongs to');
    assert.equal(b.total, b.system + b.pinned + b.history + b.newTurn + b.allowances,
      'total is the five rows the popover prints — images is not a sixth');
    assert.notEqual(b.total, b.system + b.pinned + b.history + b.newTurn + b.allowances + b.images);
  });

  test('in continue mode the trailing assistant counts with the new turn, not as history', () => {
    const messages = [
      entry('user', 'x'.repeat(36), { msgId: 'u1' }),
      entry('assistant', 'y'.repeat(36), { msgId: 'a1' }),
      entry('user', 'z'.repeat(36), { msgId: 'u2' }),
      entry('assistant', 'w'.repeat(36), { msgId: 'a2' }),        // the prefill being continued
      { msgId: null, role: 'user', pinned: false, blocks: [{ type: 'text', text: 'Continue exactly where you stopped.' }] },
    ];
    const b = breakdown(req(messages), 3.6);
    assert.equal(b.history, (PER_MESSAGE_TOKENS + 10) * 2, 'only the first turn is history');
    assert.ok(b.newTurn > (PER_MESSAGE_TOKENS + 10) * 2, 'u2 + the prefill + the request-only turn');
  });

  test('the ratio may be a function of the model, and a throwing one is survivable', () => {
    const r = req([entry('user', 'x'.repeat(36))], { model: 'gemma4:12b' });
    let asked = null;
    assert.equal(breakdown(r, (m) => { asked = m; return 4; }).ratio, 4);
    assert.equal(asked, 'gemma4:12b');
    assert.equal(breakdown(r, () => { throw new Error('no kv'); }).ratio, DEFAULT_RATIO);
  });

  test('promptChars counts what actually goes on the wire (system + every text block)', () => {
    const r = req([
      entry('user', 'hello'),
      { msgId: 'a1', role: 'assistant', pinned: false, blocks: [{ type: 'text', text: 'hi' }, { type: 'image', attId: 'x' }] },
    ], { system: 'sys' });
    assert.equal(promptChars(r), 'sys'.length + 'hello'.length + 'hi'.length);
    assert.equal(promptChars(null), 0);
  });

  test('calibration is an EMA towards what the farm counted', () => {
    // 3,600 chars really cost 1,200 tokens → observed ratio 3.
    const next = calibrate(3.6, 3600, 1200);
    assert.ok(Math.abs(next - (3.6 * 0.7 + 3 * 0.3)) < 1e-9, `got ${next}`);
    assert.ok(next < 3.6 && next > 3, 'it moves towards the sample without jumping to it');
    // Repeated samples converge.
    let r = DEFAULT_RATIO;
    for (let i = 0; i < 20; i++) r = calibrate(r, 3600, 1200);
    assert.ok(Math.abs(r - 3) < 0.01, `converged to ${r}`);
  });

  test('calibration is CLAMPED, so one weird reply cannot make the next send overflow', () => {
    let low = DEFAULT_RATIO;
    for (let i = 0; i < 100; i++) low = calibrate(low, 100, 1000);     // ratio 0.1
    assert.equal(low, MIN_RATIO);
    let high = DEFAULT_RATIO;
    for (let i = 0; i < 100; i++) high = calibrate(high, 100000, 100); // ratio 1000
    assert.equal(high, MAX_RATIO);
  });

  test('calibration ignores a useless sample and never returns NaN', () => {
    assert.equal(calibrate(3.6, 0, 1200), 3.6);
    assert.equal(calibrate(3.6, 3600, 0), 3.6);
    assert.equal(calibrate(null, 3600, 0), DEFAULT_RATIO);
    assert.equal(calibrate(/** @type {any} */('nonsense'), 3600, 1200), calibrate(DEFAULT_RATIO, 3600, 1200));
    assert.ok(Number.isFinite(calibrate(NaN, NaN, NaN)));
  });
};
