// ctx/budget.mjs (P2-U2): the trusted window, the reply reserve, the trim plan and the cost gate.
//
// What these assertions protect:
//   - the live farm advertises 1,048,576 tokens per slot (DISCUSS D-F1) and LOL Chat must not
//     believe it, or the meter reads 4 % while llama-server refuses the request;
//   - a pinned message is never trimmed away, and neither is the turn being sent;
//   - the request-only `extraTurns` of §2.6 AC (msgId null) are never dropped and never leak into
//     keptIds/droppedIds, which are STORE ids the view marks `.chat-outside`;
//   - the gate blocks what cannot fit and only ASKS about what is merely expensive.
import assert from 'node:assert/strict';
import {
  trustedBudget, reserveFor, planTrim, gateVerdict,
  DEFAULT_BUDGET, MAX_BUDGET, MIN_BUDGET, DEFAULT_RESERVE, DEFAULT_GATE_THRESHOLD,
} from '../../../renderer/chat/ctx/budget.mjs';

/** A request message entry whose estimate is exactly `tokens` under the test estimator below. */
const m = (msgId, role, tokens, extra = {}) => ({
  msgId,
  role,
  pinned: !!extra.pinned,
  blocks: [{ type: 'text', text: 'x'.repeat(tokens), tag: role === 'user' ? 'user' : 'assistant' }],
});

/** One character = one token, so every number in these tests is readable. */
const estimate = (entry) => {
  let n = 0;
  for (const b of (entry && entry.blocks) || []) if (b && typeof b.text === 'string') n += b.text.length;
  return n;
};

const req = (messages, extra = {}) => ({
  model: 'assistant',
  system: extra.system === undefined ? null : extra.system,
  systemAppend: extra.systemAppend || [],
  messages,
  params: extra.params || {},
  meta: { allowances: extra.allowances || [] },
});

/** Ten turns of 100 tokens each: u0/a0 … u9/a9. */
const tenTurns = () => {
  const out = [];
  for (let i = 0; i < 10; i++) {
    out.push(m(`u${i}`, 'user', 100));
    out.push(m(`a${i}`, 'assistant', 100));
  }
  out.push(m('u10', 'user', 100));                 // the message being sent
  return out;
};

export default (test) => {
  // ---- trustedBudget ------------------------------------------------------------------------

  test('the advertised window is believed up to 262,144 tokens and no further', () => {
    assert.equal(trustedBudget({ budget: { tokens: 16384, advertised: 16384, source: 'advertised' } }), 16384);
    // The live farm's claim.
    assert.equal(trustedBudget({ backend: { contextPerSlot: 1048576 } }), MAX_BUDGET);
    assert.equal(trustedBudget(262144), MAX_BUDGET);
  });

  test('no advertised window is a careful default, not "unlimited"', () => {
    assert.equal(trustedBudget(null), DEFAULT_BUDGET);
    assert.equal(trustedBudget({}), DEFAULT_BUDGET);
    assert.equal(trustedBudget({ budget: { tokens: null } }), DEFAULT_BUDGET);
    assert.equal(trustedBudget({ backend: { contextPerSlot: 0 } }), DEFAULT_BUDGET);
    assert.equal(trustedBudget({ backend: { contextPerSlot: -5 } }), DEFAULT_BUDGET);
    assert.equal(trustedBudget('16384'), DEFAULT_BUDGET, 'a string is not a window');
  });

  test('an absurdly small window is clamped up, so the meter cannot read 400 %', () => {
    assert.equal(trustedBudget({ backend: { contextPerSlot: 8 } }), MIN_BUDGET);
  });

  // ---- reserveFor ---------------------------------------------------------------------------

  test('the reserve is the RESOLVED max_tokens, else 4096', () => {
    assert.equal(reserveFor({ max_tokens: 2048 }), 2048);
    assert.equal(reserveFor({ max_tokens: 30000 }), 30000);
    assert.equal(reserveFor({}), DEFAULT_RESERVE);
    assert.equal(reserveFor(null), DEFAULT_RESERVE);
    assert.equal(reserveFor({ max_tokens: 0 }), DEFAULT_RESERVE);
    assert.equal(reserveFor({ max_tokens: '900' }), DEFAULT_RESERVE, 'a string is not a token count');
  });

  test('planTrim reserves what reserveFor resolved (transform order 250 runs before 800)', () => {
    const messages = tenTurns();
    const generous = planTrim(req(messages), { budget: 4000, reserve: reserveFor({ max_tokens: 100 }), estimate });
    const greedy = planTrim(req(messages), { budget: 4000, reserve: reserveFor({ max_tokens: 3000 }), estimate });
    assert.ok(greedy.droppedIds.length > generous.droppedIds.length,
      `a bigger max_tokens trims more history: ${greedy.droppedIds.length} vs ${generous.droppedIds.length}`);
    assert.equal(greedy.reserve, 3000);
  });

  // ---- planTrim -----------------------------------------------------------------------------

  test('everything fits: nothing is dropped', () => {
    const plan = planTrim(req(tenTurns()), { budget: 32768, reserve: 4096, estimate });
    assert.deepEqual(plan.droppedIds, []);
    assert.equal(plan.keptIds.length, 21);
    assert.equal(plan.total, 2100);
    assert.equal(plan.over, false);
  });

  test('whole oldest turns go first, and the message being sent always stays', () => {
    // 2100 tokens of history, 1000 spendable → the oldest turns go until it fits.
    const plan = planTrim(req(tenTurns()), { budget: 1400, reserve: 400, estimate });
    assert.ok(plan.total <= 1000, `trimmed to ${plan.total}`);
    assert.ok(plan.droppedIds.includes('u0') && plan.droppedIds.includes('a0'), 'the oldest turn went');
    assert.ok(plan.keptIds.includes('u10'), 'the message being sent is never trimmed');
    assert.ok(plan.keptIds.includes('u9') && plan.keptIds.includes('a9'), 'the newest exchange survives');
    // Whole turns: a user is never kept without its assistant, nor the other way round.
    for (let i = 0; i < 10; i++) {
      assert.equal(plan.droppedIds.includes(`u${i}`), plan.droppedIds.includes(`a${i}`), `turn ${i} went as a whole`);
    }
    // Oldest first: no gap in the dropped prefix.
    const kept = plan.keptIds.filter((id) => id !== 'u10');
    const firstKept = Number(kept[0].slice(1));
    for (const id of plan.droppedIds) assert.ok(Number(id.slice(1)) < firstKept, `${id} is older than u${firstKept}`);
  });

  test('a pinned message survives its turn being trimmed', () => {
    const messages = tenTurns();
    messages[2].pinned = true;                       // u1, deep in the history
    const plan = planTrim(req(messages), { budget: 1400, reserve: 400, estimate });
    assert.ok(plan.keptIds.includes('u1'), 'the pin held');
    assert.ok(plan.droppedIds.includes('a1'), 'the rest of its turn still went');
    assert.ok(plan.droppedIds.includes('u0'));
  });

  test('the system prompt and the allowances are counted and are never droppable', () => {
    const plan = planTrim(req(tenTurns(), {
      system: 'x'.repeat(300),
      systemAppend: ['y'.repeat(200)],
      allowances: [{ id: 'search', tokens: 700 }],
    }), { budget: 2000, reserve: 400, estimate });
    assert.equal(plan.system, 300 + 2 + 200, 'system + the blank line + systemAppend');
    assert.equal(plan.allowances, 700);
    assert.ok(plan.total >= plan.system + plan.allowances);
    assert.ok(plan.droppedIds.length > 0, 'history went instead');
  });

  test('a request-only extra turn (msgId null) is never dropped and never listed', () => {
    const messages = [
      ...tenTurns(),
      m('a10', 'assistant', 100),                    // the continue prefill
      { msgId: null, role: 'user', pinned: false, blocks: [{ type: 'text', text: 'x'.repeat(50) }] },
    ];
    const plan = planTrim(req(messages), { budget: 900, reserve: 200, estimate });
    assert.ok(!plan.keptIds.includes(null) && !plan.droppedIds.includes(null));
    assert.equal(plan.keptIds.length + plan.droppedIds.length, 22, 'only STORE ids are listed');
    assert.ok(plan.total >= 50, 'but its tokens are still counted');
    // The continue pair is the new turn: both survive.
    assert.ok(plan.keptIds.includes('u10') && plan.keptIds.includes('a10'));
  });

  test('`over` when the last turn alone cannot fit', () => {
    const plan = planTrim(req([m('u1', 'user', 9000)]), { budget: 8192, reserve: 4096, estimate });
    assert.equal(plan.over, true);
    assert.deepEqual(plan.droppedIds, [], 'there was nothing it was allowed to drop');
    assert.equal(plan.total, 9000);
    // The same turn on a farm with room is not over.
    assert.equal(planTrim(req([m('u1', 'user', 9000)]), { budget: 32768, reserve: 4096, estimate }).over, false);
  });

  test('`over` counts the reserve: a prompt that fits but leaves no room for the reply is over', () => {
    const plan = planTrim(req([m('u1', 'user', 5000)]), { budget: 8192, reserve: 4096, estimate });
    assert.equal(plan.over, true, '5000 + 4096 > 8192');
    assert.equal(plan.total, 5000);
  });

  test('planTrim survives a request with nothing in it', () => {
    const plan = planTrim({}, {});
    assert.deepEqual(plan.keptIds, []);
    assert.deepEqual(plan.droppedIds, []);
    assert.equal(plan.total, 0);
    assert.equal(plan.over, false);
    assert.equal(plan.reserve, DEFAULT_RESERVE);
    assert.equal(plan.budget, DEFAULT_BUDGET);
  });

  // ---- gateVerdict --------------------------------------------------------------------------

  test('a small send goes straight out', () => {
    const v = gateVerdict({ total: 900, newTurn: 200, budget: 16384, reserve: 4096 });
    assert.equal(v.kind, 'ok');
    assert.equal(v.seconds, null, 'nothing to show, so no time is invented');
  });

  test('above the threshold Send asks first, with seconds when the rate is known', () => {
    const asks = gateVerdict({ total: 20000, newTurn: 20000, budget: 262144, reserve: 4096 });
    assert.equal(asks.kind, 'confirm');
    assert.equal(asks.seconds, null, 'no rate yet: tokens only');
    const timed = gateVerdict({ total: 20000, newTurn: 20000, budget: 262144, reserve: 4096, promptTokSec: 500 });
    assert.equal(timed.kind, 'confirm');
    assert.equal(timed.seconds, 40);
    // Exactly at the threshold counts as expensive.
    assert.equal(gateVerdict({ total: DEFAULT_GATE_THRESHOLD, budget: 262144 }).kind, 'confirm');
    assert.equal(gateVerdict({ total: DEFAULT_GATE_THRESHOLD - 1, budget: 262144 }).kind, 'ok');
  });

  test('the threshold is a setting, and a nonsense one falls back to the default', () => {
    assert.equal(gateVerdict({ total: 3000, budget: 262144, threshold: 2000 }).kind, 'confirm');
    assert.equal(gateVerdict({ total: 3000, budget: 262144, threshold: 40000 }).kind, 'ok');
    assert.equal(gateVerdict({ total: 20000, budget: 262144, threshold: 0 }).kind, 'confirm');
    assert.equal(gateVerdict({ total: 20000, budget: 262144, threshold: /** @type {any} */('lots') }).kind, 'confirm');
  });

  test('what cannot fit is BLOCKED, not merely expensive', () => {
    const v = gateVerdict({ total: 55000, newTurn: 55000, budget: 8192, reserve: 4096, promptTokSec: 500 });
    assert.equal(v.kind, 'block');
    assert.equal(v.seconds, 110, 'the popover still says what it would have cost');
    // The reserve is part of "fits": 5,000 tokens of prompt on an 8,192 farm leaves no reply room.
    assert.equal(gateVerdict({ total: 5000, budget: 8192, reserve: 4096 }).kind, 'block');
    assert.equal(gateVerdict({ total: 5000, budget: 8192, reserve: 1000 }).kind, 'ok');
  });

  test('the new turn alone can trigger the gate even when the trimmed total is small', () => {
    // planTrim already dropped the history, so `total` is modest — but the turn itself is huge.
    assert.equal(gateVerdict({ total: 18000, newTurn: 18000, budget: 262144 }).kind, 'confirm');
    assert.equal(gateVerdict({ total: 500, newTurn: 18000, budget: 262144 }).kind, 'confirm');
  });

  test('with no budget at all the gate can still ask, but never blocks', () => {
    assert.equal(gateVerdict({ total: 99999, newTurn: 99999, budget: 0 }).kind, 'confirm');
    assert.equal(gateVerdict({}).kind, 'ok');
  });
};
