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
    new Function('ctx', src.slice(start, end) + '; ctx.out = { readCapacity, capacityPill, capacityText };')(ctx);
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
