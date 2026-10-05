// Dependency-free unit tests for the renderer's pure helpers. Separate from
// e2e.js because that drives a real Electron app over CDP (and cannot run on a
// machine already running the client — single-instance lock), while these are
// the string-and-arithmetic decisions that actually get read by users, and they
// should be checkable in a second on any machine.
//
// Run: npm run test:unit

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// The helpers live in the renderer (no module system there), so extract them by
// name. If this throws, the anchors moved — fix them rather than deleting the test.
function rendererHelpers() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
    const start = src.indexOf('function readCapacity');
    const end = src.indexOf('// ---- sidecar → webview + overlay ----');
    assert.ok(start > 0 && end > start, 'renderer capacity helpers moved — update the extraction anchors');
    const ctx = {};
    new Function('ctx', src.slice(start, end) + '; ctx.out = { readCapacity, capacityPill, capacityText, capacityTip, pillState };')(ctx);
    return ctx.out;
}

test('capacity: free SEATS lead, because they decide whether the next message is answered', () => {
    const { readCapacity, capacityPill, capacityText } = rendererHelpers();
    const c = readCapacity({ capacity: { slots: 2, seatsUsed: 1, clients: 3, seatIdleSec: 900 } });
    assert.equal(c.seatsKnown, true);
    assert.equal(c.free, 1);
    assert.equal(c.full, false);
    assert.equal(capacityPill(c), ' · 1/2 free');
    // 3 people connected but only 1 holding a seat: the card must show BOTH, or
    // "1 of 2 seats free" looks wrong to someone who knows 3 people are on it.
    assert.deepEqual(capacityText(c), ['1 of 2 seats free', '3 connected']);
});

test('capacity: a full farm says when a seat frees, not just that it is full', () => {
    const { readCapacity, capacityPill, capacityText } = rendererHelpers();
    const c = readCapacity({ capacity: { slots: 2, seatsUsed: 2, clients: 2, seatIdleSec: 900 } });
    assert.equal(c.full, true, 'drives the amber styling');
    assert.equal(capacityPill(c), ' · 0/2 free');
    // Without the "frees after" clause a busy farm reads as permanently shut.
    assert.match(capacityText(c)[0], /all 2 seats busy — one frees after 15 min idle/);
    // Presence equal to seats adds nothing — don't repeat it.
    assert.equal(capacityText(c).length, 1);
});

test('capacity: queued generations surface when the engine reports them', () => {
    const { readCapacity, capacityText } = rendererHelpers();
    const c = readCapacity({ capacity: { slots: 2, seatsUsed: 2, clients: 4, seatIdleSec: 900, queued: 2 } });
    assert.ok(capacityText(c).includes('2 waiting'));
});

test('capacity: the pill names the engine\'s queue, the one reason an Open WebUI user\'s first word is slow', () => {
    const { readCapacity, capacityPill, capacityTip } = rendererHelpers();
    // Seats free, but the engine queues past what the card serves (plan §13, decision 2).
    const c = readCapacity({ capacity: { slots: 50, seatsUsed: 31, clients: 31, seatIdleSec: 900, busy: 24, queued: 12 } });
    assert.equal(c.full, false, 'free seats: the next message is let in…');
    assert.equal(c.queued, 12, '…and waits at the engine, which is what turns the pill amber');
    assert.equal(capacityPill(c), ' · 19/50 free · 12 waiting');
    assert.equal(capacityTip(c), '12 messages are queued at the model. A new one waits its turn, so the first word of its reply may be slow.');
    assert.match(capacityTip(readCapacity({ capacity: { slots: 4, seatsUsed: 4, queued: 1, mine: true } })), /^1 message is queued at the model\. A new one waits its turn/);
    // No queue now, or a farm too old to say (no `queued`): exactly the old pill, and no tooltip of its own.
    for (const cap of [{ slots: 2, seatsUsed: 1, queued: 0 }, { slots: 2, seatsUsed: 1, queued: null }, { slots: 2, seatsUsed: 1 }]) {
        const q = readCapacity({ capacity: cap });
        assert.equal(q.queued, null);
        assert.equal(capacityPill(q), ' · 1/2 free');
        assert.equal(capacityTip(q), '');
    }
});

test('capacity: on a full farm the tooltip says a computer holding no seat is refused, not queued (and stays true for one that holds a seat on a farm too old to say)', () => {
    const { readCapacity, capacityTip } = rendererHelpers();
    const full = { slots: 50, seatsUsed: 50, seatIdleSec: 900, queued: 12 };
    const out = readCapacity({ capacity: full });
    assert.equal(out.mine, false, 'no `mine` (the beacon, an older farm) reads as no seat');
    assert.equal(capacityTip(out), 'Every seat is taken: a computer without one has its new message refused until one frees (about 15 min after its holder\'s last reply). 12 messages are queued at the model.');
    assert.equal(capacityTip(readCapacity({ capacity: { slots: 2, seatsUsed: 2, seatIdleSec: 600 } })),
        'Every seat is taken: a computer without one has its new message refused until one frees (about 10 min after its holder\'s last reply).');
    // This computer holds one of the seats: its next message is let in, then waits at the engine like any other.
    const mine = readCapacity({ capacity: { ...full, mine: true } });
    assert.equal(mine.mine, true);
    assert.equal(capacityTip(mine), '12 messages are queued at the model. A new one waits its turn, so the first word of its reply may be slow.');
    assert.equal(capacityTip(readCapacity({ capacity: { slots: 2, seatsUsed: 2, mine: true } })), '', 'a seat of its own and no queue: nothing to add');
});

test('pill: amber for a queue or a full farm, green otherwise; the tooltip gives way to an admin job, silence or a broken server', () => {
    const { readCapacity, pillState } = rendererHelpers();
    const farm = (cap, extra = {}) => ({ name: 'Studio', capacity: cap, ...extra });
    const state = (f) => pillState(readCapacity(f), f);
    const queued = state(farm({ slots: 50, seatsUsed: 31, queued: 12 }));
    assert.equal(queued.cls, 'busy', 'a queue at the engine turns the pill amber');
    assert.equal(queued.text, 'Studio · 19/50 free · 12 waiting');
    assert.match(queued.tip, /^12 messages are queued at the model\./);
    for (const q of [0, null]) {
        const s = state(farm({ slots: 50, seatsUsed: 31, queued: q }));
        assert.deepEqual(s, { cls: 'ready', text: 'Studio · 19/50 free', tip: '' }, `queued ${q}: green, no tooltip of its own`);
    }
    assert.equal(state(farm({ slots: 2, seatsUsed: 2 })).cls, 'busy', 'no free seat: amber');
    const cap = { slots: 2, seatsUsed: 2, seatIdleSec: 900, queued: 3 };
    assert.deepEqual(state(farm(cap, { busy: { label: 'Switching model' } })), { cls: 'busy', text: 'Studio · Switching model…', tip: '' });
    assert.deepEqual(state(farm(cap, { _stale: true })), { cls: 'busy', text: 'Studio · not responding…', tip: '' });
    assert.deepEqual(state(farm(cap, { healthy: false })), { cls: 'error', text: 'Studio · problem on the server', tip: '' });
});

test('capacity: farms older than the seat gate keep the old advisory wording', () => {
    const { readCapacity, capacityPill, capacityText } = rendererHelpers();
    // Pre-farm-v0.0.36: no seatsUsed. Those farms really do queue past `slots`,
    // so claiming "seats free" would be a promise the farm does not make.
    const c = readCapacity({ capacity: { slots: 2, clients: 1 } });
    assert.equal(c.seatsKnown, false);
    assert.equal(capacityPill(c), ' · 1/2');
    assert.deepEqual(capacityText(c), ['1 of 2 slots in use']);
    // Older still: no capacity block at all → GPU% is the only signal left.
    const ancient = readCapacity({ usage: { clients: 2, gpuUtil: 87 } });
    assert.equal(capacityPill(ancient), ' · 87% GPU');
    assert.deepEqual(capacityText(ancient), ['2 connected']);
    // And a farm reporting nothing must render nothing, not "undefined".
    const empty = readCapacity({});
    assert.equal(capacityPill(empty), '');
    assert.deepEqual(capacityText(empty), []);
});

test('capacity: singular/plural reads correctly on a one-seat farm', () => {
    const { readCapacity, capacityText } = rendererHelpers();
    const free = readCapacity({ capacity: { slots: 1, seatsUsed: 0, clients: 1, seatIdleSec: 600 } });
    assert.equal(capacityText(free)[0], '1 of 1 seat free');
    const full = readCapacity({ capacity: { slots: 1, seatsUsed: 1, clients: 1, seatIdleSec: 600 } });
    assert.match(capacityText(full)[0], /^all 1 seat busy — one frees after 10 min idle/);
});

(async () => {
    for (const { name, fn } of tests) {
        try { await fn(); console.log(`  ok  ${name}`); passed++; }
        catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
    }
    console.log(`\n${passed} passed`);
})();
