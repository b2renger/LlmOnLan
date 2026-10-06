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

// unseedWebSearch() and seedDateLine() run a script inside the Open WebUI webview. Run those same
// scripts against a fake Open WebUI whose settings write follows the real server's rule for `ui`:
// 0.11.4 patches it field by field (a null removes the key, models/users.py
// update_user_settings_by_id), 0.10.x replaces it whole. `ui: null` is a profile that never saved a
// setting: the real server reads it as `null`. `on` is what OWUI's chat reads:
// (settings.webSearch ?? false) === 'always'. `slow` answers each request on a later turn, as over
// HTTP, so two scripts can interleave; `onRead` is called as a settings read arrives.
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
function appFunction(name) {
    const start = APP_JS.indexOf(`async function ${name}(`);
    const end = APP_JS.indexOf('\n}\n', start);
    assert.ok(start > 0 && end > start, `${name} moved — update the extraction anchors`);
    return APP_JS.slice(start, end + 2);
}

function fakeOwui(version, ui, { token = 't', readFails = false, readNotJson = false, writeOk = true, slow = false } = {}) {
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const owui = { ui: clone(ui), writes: 0, onRead: null };
    const fetch = async (url, opts = {}) => {
        if (url === '/api/v1/users/user/settings' && !opts.method && owui.onRead) owui.onRead();
        if (slow) await new Promise(setImmediate);
        if (url === '/api/v1/auths/' && !opts.method) return { ok: true };
        if (url === '/api/v1/users/user/settings' && !opts.method) {
            if (readFails) return { ok: false, json: async () => ({ detail: 'Unauthorized' }) };
            if (readNotJson) return { ok: true, json: async () => { throw new SyntaxError("Unexpected token '<'"); } };
            return { ok: true, json: async () => (owui.ui === null ? null : { ui: clone(owui.ui) }) };
        }
        if (url === '/api/v1/users/user/settings/update' && opts.method === 'POST') {
            owui.writes++;
            if (!writeOk) return { ok: false };
            const sent = JSON.parse(opts.body).ui;
            if (version === '0.10') owui.ui = sent;
            else for (const [k, v] of Object.entries(sent)) { owui.ui = owui.ui || {}; if (v === null) delete owui.ui[k]; else owui.ui[k] = v; }
            return { ok: true };
        }
        throw new Error(`unexpected request ${opts.method || 'GET'} ${url}`);
    };
    const window = { localStorage: token ? { token } : {} };
    owui.page = { executeJavaScript: (code) => new Function('window', 'fetch', `return ${code}`)(window, fetch) };
    const extract = (name) => new Function('els', `${appFunction(name)}; return ${name};`)({ webview: owui.page });
    owui.run = extract('unseedWebSearch');
    owui.seedDate = extract('seedDateLine');
    owui.on = () => ((owui.ui || {}).webSearch ?? false) === 'always';
    return owui;
}

for (const version of ['0.11', '0.10']) {
    test(`web search (OWUI ${version}): a fresh profile is left at Open WebUI's default, off, and never written`, async () => {
        for (const ui of [{}, { theme: 'dark' }, { webSearch: 'always', theme: 'dark' }]) {
            const owui = fakeOwui(version, ui);
            assert.equal(await owui.run(), 'already');
            assert.equal(owui.writes, 0, 'nothing LOL seeded: no write, even when the person chose always');
            assert.deepEqual(owui.ui, ui);
        }
    });

    test(`web search (OWUI ${version}): a profile LOL switched on is switched off once, the rest of its settings kept`, async () => {
        const owui = fakeOwui(version, { webSearch: 'always', lolWebSearchSeeded: true, theme: 'dark', tools: ['direct_server:0'] });
        assert.equal(owui.on(), true);
        assert.equal(await owui.run(), 'set', 'wrote: the caller reloads the webview');
        assert.equal(owui.on(), false);
        assert.equal(owui.ui.lolWebSearchUnseeded, true);
        assert.equal(owui.ui.theme, 'dark');
        assert.deepEqual(owui.ui.tools, ['direct_server:0']);
        assert.equal(await owui.run(), 'already', 'the second run does nothing');
        assert.equal(owui.writes, 1);
        // The person turns it back on in Open WebUI's settings: the marker keeps us out.
        owui.ui.webSearch = 'always';
        assert.equal(await owui.run(), 'already');
        assert.equal(owui.on(), true);
    });

    test(`web search (OWUI ${version}): a profile LOL seeded that the person turned off keeps their choice`, async () => {
        // OWUI's own Interface toggle stores off as null on 0.10; 0.11 removes the key instead.
        const offByPerson = version === '0.10' ? { webSearch: null, lolWebSearchSeeded: true } : { lolWebSearchSeeded: true };
        for (const ui of [offByPerson, { lolWebSearchSeeded: true, theme: 'light' }]) {
            const owui = fakeOwui(version, ui);
            assert.equal(await owui.run(), 'set', 'only the marker is written');
            assert.equal(owui.on(), false);
            assert.equal(owui.ui.lolWebSearchUnseeded, true);
            assert.deepEqual({ ...owui.ui, lolWebSearchUnseeded: undefined }, { ...ui, lolWebSearchUnseeded: undefined });
            // Later they pick 'always' themselves: never switched back.
            owui.ui.webSearch = 'always';
            assert.equal(await owui.run(), 'already');
            assert.equal(owui.on(), true);
            assert.equal(owui.writes, 1);
        }
    });
}

test('web search: no token, a failed read or a refused write changes nothing and reloads nothing', async () => {
    const seeded = { webSearch: 'always', lolWebSearchSeeded: true, theme: 'dark' };
    const noToken = fakeOwui('0.10', seeded, { token: null });
    assert.equal(await noToken.run(), 'na');
    // A failed read must not write: on 0.10 our `ui` would replace the person's whole settings.
    const readFails = fakeOwui('0.10', seeded, { readFails: true });
    assert.equal(await readFails.run(), 'already');
    const writeRefused = fakeOwui('0.11', seeded, { writeOk: false });
    assert.equal(await writeRefused.run(), 'na', 'not "set": no reload, and the next session tries again');
    for (const o of [noToken, readFails, writeRefused]) assert.deepEqual(o.ui, seeded);
    assert.equal(noToken.writes + readFails.writes, 0);
});

// The date line goes into the person's own system prompt (Settings ▸ General ▸ System Prompt).
// Emptying it there removes the key on both versions: 0.11 sends `system: null`, 0.10 `undefined`,
// which JSON drops before the whole `ui` is replaced.
const DATE_LINE = 'Today is {{CURRENT_WEEKDAY}} {{CURRENT_DATE}}.';

for (const version of ['0.11', '0.10']) {
    test(`date line (OWUI ${version}): an empty system prompt gets the date line once, the rest of the settings kept`, async () => {
        for (const ui of [null, {}, { system: '' }, { theme: 'dark', tools: ['direct_server:0'] }]) {
            const owui = fakeOwui(version, ui);
            assert.equal(await owui.seedDate(), 'set', 'wrote: the caller reloads the webview');
            assert.equal(owui.ui.system, DATE_LINE, 'the variables stay for Open WebUI to fill at each message');
            assert.equal(owui.ui.lolDateLineSeeded, true);
            assert.deepEqual({ ...owui.ui, system: undefined, lolDateLineSeeded: undefined }, { ...ui, system: undefined, lolDateLineSeeded: undefined });
            assert.equal(await owui.seedDate(), 'already', 'the second run does nothing');
            assert.equal(owui.writes, 1);
        }
    });

    test(`date line (OWUI ${version}): a system prompt the person wrote is never touched, even once they empty it`, async () => {
        const owui = fakeOwui(version, { system: 'Answer in French.', theme: 'dark' });
        assert.equal(await owui.seedDate(), 'set', 'only the marker is written');
        assert.deepEqual(owui.ui, { system: 'Answer in French.', theme: 'dark', lolDateLineSeeded: true });
        delete owui.ui.system; // the person empties it later
        assert.equal(await owui.seedDate(), 'already');
        assert.equal(owui.ui.system, undefined);
        assert.equal(owui.writes, 1);
    });

    test(`date line (OWUI ${version}): a person who empties or edits the date line keeps their choice`, async () => {
        const owui = fakeOwui(version, { theme: 'dark' });
        assert.equal(await owui.seedDate(), 'set');
        delete owui.ui.system;
        assert.equal(await owui.seedDate(), 'already', 'emptied: not seeded again');
        assert.equal(owui.ui.system, undefined);
        owui.ui.system = `${DATE_LINE} Keep answers short.`;
        assert.equal(await owui.seedDate(), 'already');
        assert.equal(owui.ui.system, `${DATE_LINE} Keep answers short.`);
        assert.equal(owui.writes, 1);
    });

    test(`date line (OWUI ${version}): a profile already seeded is not written`, async () => {
        const owui = fakeOwui(version, { lolDateLineSeeded: true, theme: 'dark' });
        assert.equal(await owui.seedDate(), 'already');
        assert.equal(owui.writes, 0);
        assert.equal(owui.ui.system, undefined);
    });

    test(`web search + date line (OWUI ${version}): one after the other, each keeps what the other wrote`, async () => {
        const owui = fakeOwui(version, { webSearch: 'always', lolWebSearchSeeded: true, theme: 'dark' });
        assert.equal(await owui.run(), 'set');
        assert.equal(await owui.seedDate(), 'set');
        assert.equal(owui.on(), false);
        assert.equal(owui.ui.lolWebSearchUnseeded, true);
        assert.equal(owui.ui.system, DATE_LINE);
        assert.equal(owui.ui.lolDateLineSeeded, true);
        assert.equal(owui.ui.theme, 'dark');
    });
}

test('date line: no token, a failed read, a read that is not JSON or a refused write changes nothing and reloads nothing', async () => {
    const fresh = { theme: 'dark' };
    const noToken = fakeOwui('0.10', fresh, { token: null });
    assert.equal(await noToken.seedDate(), 'na');
    // A failed read must not write: it would look like an empty prompt, and on 0.10 our `ui`
    // would replace the person's whole settings.
    const readFails = fakeOwui('0.10', fresh, { readFails: true });
    assert.equal(await readFails.seedDate(), 'na');
    const readNotJson = fakeOwui('0.10', fresh, { readNotJson: true });
    assert.equal(await readNotJson.seedDate(), 'na');
    const writeRefused = fakeOwui('0.11', fresh, { writeOk: false });
    assert.equal(await writeRefused.seedDate(), 'na', 'not "set": no reload, and the next session tries again');
    for (const o of [noToken, readFails, readNotJson, writeRefused]) assert.deepEqual(o.ui, fresh);
    assert.equal(noToken.writes + readFails.writes + readNotJson.writes, 0);
});

// ensureAuthenticated() runs those scripts on the webview's first authed load, and maybeSeedBlender()
// writes the Blender tool server, also on the Blender helper's 'ready' push. Slice them out of app.js
// with the state they share and run them on the fake Open WebUI's page; `fakes` replaces any of the
// functions by name. A reload only counts: the test runs the load after it (did-finish-load).
function fakeShell(owui, { blender = { url: 'http://127.0.0.1:8000', apiKey: 'k' }, fakes = {} } = {}) {
    const stateStart = APP_JS.indexOf('let webviewAuthed');
    const stateEnd = APP_JS.indexOf('\n', APP_JS.indexOf('let blenderSeeded'));
    assert.ok(stateStart > 0 && stateEnd > stateStart, 'the webview auth state moved — update the extraction anchors');
    const names = ['unseedWebSearch', 'seedDateLine', 'seedBlenderToolServer', 'maybeSeedBlender', 'ensureAuthenticated'].filter((n) => !fakes[n]);
    const sh = { reloads: 0, renders: 0 };
    const els = { webview: { ...owui.page, reload: () => { sh.reloads++; } } };
    const window = { lol: { getBlenderConnection: async () => blender } };
    const scope = new Function('els', 'window', 'renderSidecar', ...Object.keys(fakes),
        `${APP_JS.slice(stateStart, stateEnd)}\n${names.map(appFunction).join('\n')}\nreturn { ensureAuthenticated, maybeSeedBlender };`);
    return Object.assign(sh, scope(els, window, () => { sh.renders++; }, ...Object.values(fakes)));
}

test('first authed load: web search, then the date line, then one reload if either wrote', async () => {
    for (const ws of ['set', 'already', 'na']) for (const dl of ['set', 'already', 'na']) {
        const calls = [];
        const fix = (name, res) => async () => { calls.push(`${name}…`); await new Promise(setImmediate); calls.push(`${name} ${res}`); return res; };
        const sh = fakeShell(fakeOwui('0.11', {}), { fakes: {
            unseedWebSearch: fix('web search', ws), seedDateLine: fix('date line', dl),
            maybeSeedBlender: async () => { calls.push('blender'); return false; },
        } });
        const wrote = ws === 'set' || dl === 'set';
        await sh.ensureAuthenticated();
        assert.deepEqual(calls, ['web search…', `web search ${ws}`, 'date line…', `date line ${dl}`, ...(wrote ? [] : ['blender'])], `${ws} + ${dl}`);
        // A reload keeps the overlay up until its own load: the page then has the new settings.
        assert.deepEqual([sh.reloads, sh.renders], wrote ? [1, 0] : [0, 1], `${ws} + ${dl}`);
        calls.length = 0;
        await sh.ensureAuthenticated(); // the next load: the fixes ran once this session
        assert.deepEqual(calls, ['blender']);
        assert.deepEqual([sh.reloads, sh.renders], wrote ? [1, 1] : [0, 2]);
    }
});

for (const version of ['0.11', '0.10']) {
    test(`first authed load (OWUI ${version}): the Blender helper ready during the fixes waits for them, and no write is lost`, async () => {
        const fixesWrite = { webSearch: 'always', lolWebSearchSeeded: true, theme: 'dark' };
        const fixesDone = { lolWebSearchSeeded: true, lolWebSearchUnseeded: true, system: 'Answer in French.', lolDateLineSeeded: true, theme: 'dark' };
        for (const ui of [fixesWrite, fixesDone]) {
            const owui = fakeOwui(version, ui, { slow: true });
            const sh = fakeShell(owui);
            let push;
            owui.onRead = () => { owui.onRead = null; push = sh.maybeSeedBlender(); }; // the 'ready' push lands mid-read
            await sh.ensureAuthenticated();
            assert.equal(await push, false, 'the push wrote nothing');
            for (let load = 0; load < 3 && !sh.renders; load++) await sh.ensureAuthenticated(); // each reload's load
            assert.equal(sh.renders, 1, 'the overlay lifts');
            assert.equal(owui.on(), false, 'web search stays off');
            assert.equal(owui.ui.lolWebSearchUnseeded, true);
            assert.equal(owui.ui.system, ui.system || DATE_LINE);
            assert.equal(owui.ui.lolDateLineSeeded, true);
            assert.deepEqual(owui.ui.toolServers.map((c) => c.info.id), ['lol-blender']);
            assert.deepEqual(owui.ui.tools, ['direct_server:0'], 'and selected');
            assert.equal(owui.ui.theme, 'dark');
            assert.equal(owui.writes, ui === fixesWrite ? 3 : 1, 'the fixes, then Blender');
        }
    });
}

(async () => {
    for (const { name, fn } of tests) {
        try { await fn(); console.log(`  ok  ${name}`); passed++; }
        catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
    }
    console.log(`\n${passed} passed`);
})();
