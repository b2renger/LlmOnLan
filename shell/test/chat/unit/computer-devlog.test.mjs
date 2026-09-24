// K7 (COMPUTER_PLAN addendum KG): the Computer's debug log, in Node.
//   - computer/devlog-format.mjs (PURE): what goes into a person's bug report — no secret, no
//     flood, always JSON; the edit diff; the request summary; the target description;
//   - computer/devlog.mjs: the flight recorder against a fake page and a fake door — the ring,
//     the backlog written first and flagged, typing summarised per field, a password never read,
//     the fetch wrapper observing without adding a request, the switch remembered;
//   - shell/src/main/debugLog.ts (compiled, when build/main exists): the file main writes — name,
//     header, size limit, retention, screenshots, and that nothing is accepted without a recording.
// The same paths a person takes run in the real app in chat-harness/scenarios/k7-recorder.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  scrub, clip, describeTarget, docDelta, summarizeRequest, keyOf, urlOf, fmtArgs, frameOf, isEditable, SECRET_KEY_RE,
} from '../../../renderer/chat/computer/devlog-format.mjs';
import { installDevlog, REC_KEY, RING_MAX } from '../../../renderer/chat/computer/devlog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, '..', '..', '..', 'build', 'main', 'debugLog.js');
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** A minimal element for describeTarget: tagName, attributes, parent, text. */
function el(tag, attrs = {}, parent = null, text = '') {
  return {
    tagName: tag.toUpperCase(), nodeType: 1, id: attrs.id || '', parentElement: parent, textContent: text,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
  };
}

/** A fake page: enough window/document for installDevlog, with handlers we can fire. */
function fakePage() {
  const handlers = { win: {}, doc: {} };
  const on = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };
  const comp = { classList: { contains: () => false } };
  const store = new Map();
  const fetched = [];
  const consoleSeen = [];
  const win = {
    addEventListener: on(handlers.win),
    document: {
      addEventListener: on(handlers.doc),
      getElementById: (id) => (id === 'lolcomputer' ? comp : null),
      documentElement: { className: 'dark' },
    },
    performance: { now: () => 1234.5 },
    navigator: { userAgent: 'fake', language: 'en' },
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    console: { error: (...a) => consoleSeen.push(['error', a]), warn: () => {}, info: () => {}, log: () => {} },
    fetch: (input, init) => {
      fetched.push([input, init]);
      if (String(input).endsWith('/ok')) return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' } });
      return Promise.resolve({ ok: false, status: 429, headers: { get: () => 'application/json' }, clone: () => ({ text: () => Promise.resolve('{"error":"busy"}') }) });
    },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
  };
  const fire = (bag, type, ev) => { for (const fn of handlers[bag][type] || []) fn(ev); };
  return { win, fire, store, fetched, consoleSeen };
}

/** A fake main-process door that keeps what it was sent. */
function fakeDoor() {
  const sent = { header: null, text: '', stops: 0, marks: 0 };
  return {
    sent,
    start: async (h) => { sent.header = h; return { ok: true, name: 'computer-test.jsonl', path: '/logs/computer-test.jsonl' }; },
    append: async (t) => { sent.text += t; return { ok: true, bytes: sent.text.length }; },
    stop: async () => { sent.stops++; return { ok: true, name: 'computer-test.jsonl' }; },
    mark: async () => { sent.marks++; return { ok: true, png: `computer-test-mark-${sent.marks}.png` }; },
    reveal: async () => ({ ok: true }),
    status: async () => ({ ok: true }),
  };
}

export default (test) => {
  // ---- devlog-format.mjs -----------------------------------------------------------------------

  test('scrub never writes a secret: the farm key, the OCR key, a password field, a Bearer string', () => {
    const caps = { name: 'farm', apiKey: 'sk-farm-password', ocr: { url: 'http://x', key: 'ocr-secret' }, max_tokens: 99, maxTokens: 5 };
    const out = scrub({ caps, headers: { Authorization: 'Bearer abc.def' }, note: 'Bearer xyz', password: 'hunter2' });
    const text = JSON.stringify(out);
    for (const secret of ['sk-farm-password', 'ocr-secret', 'abc.def', 'xyz', 'hunter2']) assert.ok(!text.includes(secret), `leaked ${secret}: ${text}`);
    assert.equal(out.caps.apiKey, '[redacted]');
    assert.equal(out.caps.ocr.key, '[redacted]');
    assert.equal(out.caps.max_tokens, 99, 'max_tokens is not a token: exact names, not substrings');
    assert.equal(out.caps.maxTokens, 5);
    assert.ok(SECRET_KEY_RE.test('apiKey') && !SECRET_KEY_RE.test('tokens'));
  });

  test('scrub bounds everything: long strings, data URIs, cycles, depth, arrays, the node budget', () => {
    const cyc = { a: 1 }; cyc.self = cyc;
    const out = scrub({
      long: 'x'.repeat(5000), img: `data:image/png;base64,${'A'.repeat(40000)}`, cyc,
      deep: { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } },
      list: Array.from({ length: 300 }, (_, i) => i), fn: () => 1, err: new Error('boom'), nan: NaN,
    }, { max: 100 });
    assert.ok(out.long.length < 130 && out.long.includes('…(+4900)'));
    assert.match(out.img, /^\[image\/png \d+ KB\]$/);
    assert.equal(out.cyc.self, '[circular]');
    assert.equal(JSON.stringify(out.deep).includes('"i":1'), false, 'depth is bounded');
    assert.equal(out.list.length, 201);
    assert.equal(out.list[200], '[+100 more]');
    assert.equal(out.fn, '[fn]');
    assert.equal(out.err.message, 'boom');
    assert.equal(out.nan, 'NaN');
    const big = scrub({ parts: Array.from({ length: 2000 }, (_, i) => ({ id: `p${i}`, x: i })) }, { nodes: 500, items: 5000 });
    assert.ok(JSON.stringify(big).length < 20000, 'a node budget bounds a huge document');
    assert.equal(clip('abc', 10), 'abc');
  });

  test('describeTarget names the element, the box around it, the part, the wire, the label', () => {
    const comp = el('section', { id: 'lolcomputer' });
    comp.id = 'lolcomputer';
    const part = el('div', { class: 'graph-part', 'data-id': 'p7', 'data-type': 'instruction' }, comp);
    const head = el('div', { class: 'graph-part-head' }, part);
    const btn = el('button', { class: 'graph-play', 'aria-label': 'Run this box' }, head);
    const icon = el('svg', { class: 'icon' }, btn);
    const d = describeTarget(icon);
    assert.equal(d.part, 'p7');
    assert.equal(d.ptype, 'instruction');
    assert.equal(d.in, 'lolcomputer');
    assert.equal(d.label, 'Run this box', 'a click on the icon names the button it is in');
    assert.equal(d.sel, 'svg.icon < button.graph-play < div.graph-part-head', 'the two nearest meaningful boxes');
    const wire = el('path', { class: 'graph-wire', 'data-wire': 'w3' }, comp);
    assert.equal(describeTarget(wire).wire, 'w3');
    const input = el('input', { type: 'password', name: 'k' }, comp);
    assert.equal(describeTarget(input).field.type, 'password');
    assert.equal(isEditable(input), true);
    assert.equal(isEditable(el('input', { type: 'checkbox' })), false);
    assert.equal(describeTarget(null), null);
  });

  test('keyOf and urlOf: chords read like a person would say them; URLs lose query and credentials', () => {
    assert.equal(keyOf({ key: 'z', ctrlKey: true }), 'Ctrl+z');
    assert.equal(keyOf({ key: 'Z', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Z');
    assert.equal(keyOf({ key: 'Z', shiftKey: true }), 'Z');
    assert.equal(keyOf({ key: ' ' }), 'Space');
    assert.equal(keyOf({ key: 'Tab', shiftKey: true }), 'Shift+Tab');
    assert.equal(urlOf('http://user:pw@10.0.0.2:4000/v1/chat/completions?key=abc#x'), 'http://10.0.0.2:4000/v1/chat/completions');
  });

  test('summarizeRequest: model, roles, clipped text, picture sizes — never a header but the file name', () => {
    const body = JSON.stringify({
      model: 'gemma4:12b', stream: true, max_tokens: 800,
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: [{ type: 'text', text: 'What is in this picture?' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(8000)}` } }] },
      ],
    });
    const s = summarizeRequest('http://farm:4000/v1/chat/completions', { method: 'POST', body, headers: { authorization: 'Bearer sk-1', 'content-type': 'application/json' } });
    assert.equal(s.method, 'POST');
    assert.equal(s.model, 'gemma4:12b');
    assert.equal(s.stream, true);
    assert.equal(s.max_tokens, 800);
    assert.equal(s.msgs.length, 2);
    assert.equal(s.msgs[1].images, 1);
    assert.ok(s.msgs[1].imageKB >= 5);
    assert.equal(JSON.stringify(s).includes('sk-1'), false);
    assert.equal(JSON.stringify(s).includes('AAAA'), false, 'no image bytes');
    const put = summarizeRequest('http://farm:41997/process', { method: 'PUT', body: new Uint8Array(1234), headers: { 'X-Filename': 'report.pdf', Authorization: 'Bearer k' } });
    assert.equal(put.file, 'report.pdf');
    assert.equal(put.bytes, 1234);
    assert.equal(summarizeRequest('http://farm/v1/models').method, 'GET');
  });

  test('docDelta says what an edit changed: parts, moves, settings (with values), wires, labels, title', () => {
    const a = { id: 'd', title: 'T', parts: [{ id: 'p1', type: 'note', x: 0, y: 0, settings: { text: 'hi' } }, { id: 'p2', type: 'instruction', x: 10, y: 10, settings: { prompt: 'a' } }], wires: [{ id: 'w1', from: 'p1', to: 'p2', port: 'in', label: '' }] };
    const b = {
      id: 'd', title: 'T2',
      parts: [{ ...a.parts[0], x: 40 }, { ...a.parts[1], settings: { prompt: 'rewrite it', apiKey: 'x' } }, { id: 'p3', type: 'preview', x: 5, y: 5, settings: {} }],
      wires: [{ ...a.wires[0], label: 'topic' }, { id: 'w2', from: 'p2', to: 'p3', port: 'in' }],
    };
    const d = docDelta(a, b);
    assert.equal(d.title, 'T2');
    assert.deepEqual(d.added, [{ id: 'p3', type: 'preview', x: 5, y: 5 }]);
    assert.deepEqual(d.moved, [{ id: 'p1', x: 40, y: 0 }]);
    assert.equal(d.settings[0].changed.prompt, 'rewrite it');
    assert.equal(d.settings[0].changed.apiKey, '[redacted]');
    assert.deepEqual(d.relabeled, [{ id: 'w1', label: 'topic' }]);
    assert.equal(d.wiresAdded[0].id, 'w2');
    const back = docDelta(b, a);
    assert.deepEqual(back.removed, [{ id: 'p3', type: 'preview' }]);
    assert.equal(back.wiresRemoved[0].id, 'w2');
    assert.deepEqual(docDelta(a, { ...b, id: 'other' }), { opened: 'other' });
  });

  test('fmtArgs and frameOf: console arguments as one line; a long frame as its three slowest scripts', () => {
    const line = fmtArgs(['[lolcomputer] boom', new Error('bad thing'), { apiKey: 'k', n: 1 }]);
    assert.match(line, /boom Error: bad thing/);
    assert.match(line, /"apiKey":"\[redacted\]"/);
    const f = frameOf({
      duration: 142.4, blockingDuration: 92,
      scripts: [
        { sourceURL: 'file:///x/graph/runner.mjs', sourceFunctionName: 'step', duration: 90, invoker: 'Promise.then', sourceCharPosition: 1200 },
        { sourceURL: 'file:///x/graph/canvas.mjs', sourceFunctionName: 'paint', duration: 30 },
        { sourceURL: 'file:///x/a.mjs', duration: 1 }, { sourceURL: 'file:///x/b.mjs', duration: 2 },
      ],
    });
    assert.equal(f.dur, 142);
    assert.equal(f.blocking, 92);
    assert.equal(f.scripts.length, 3);
    assert.equal(f.scripts[0].src, 'graph/runner.mjs');
    assert.equal(f.scripts[0].fn, 'step');
  });

  // ---- devlog.mjs --------------------------------------------------------------------------------

  test('the flight recorder: the ring, the backlog first and flagged, typing summarised, a password never read, fetch observed, the switch remembered', async () => {
    const page = fakePage();
    const door = fakeDoor();
    const rec = installDevlog({ window: page.win, door, storage: page.win.localStorage });
    assert.ok(rec, 'installed');
    assert.equal(installDevlog({ window: page.win, door }), rec, 'one recorder per page');

    // Before the switch: a click and an uncaught error land in memory only.
    const comp = el('section', { id: 'lolcomputer' });
    comp.id = 'lolcomputer';
    const runAll = el('button', { class: 'comp-run-all' }, comp, 'Run all');
    page.fire('doc', 'click', { target: runAll, clientX: 10, clientY: 20, button: 0 });
    page.fire('win', 'error', { message: 'x is not a function', filename: 'file:///a/b/graph/runner.mjs', lineno: 3, colno: 9, error: new TypeError('x is not a function'), target: page.win });
    page.win.console.error('[lolcomputer] something broke', new Error('why'));
    assert.equal(page.consoleSeen.length, 1, 'the real console still hears it');
    assert.equal(door.sent.header, null, 'nothing written before the switch');
    const kinds = rec.events().map((e) => e.k);
    assert.ok(kinds.includes('ui.click') && kinds.includes('err.uncaught') && kinds.includes('con.error'), kinds.join(','));

    // The switch: header, then the backlog flagged pre, then live events.
    const res = await rec.start('switch');
    assert.equal(res.ok, true);
    assert.equal(page.store.get(REC_KEY), '1', 'the switch is remembered');
    const header = JSON.parse(door.sent.header);
    assert.equal(header.k, 'log.start');
    assert.match(header.readme, /One JSON object per line/);

    // Typing into a field: no line per keystroke, ONE ui.edit with the value; a password: hidden.
    const field = el('textarea', { class: 'graph-prompt' }, comp);
    field.value = 'summarise the attached';
    for (let i = 0; i < 5; i++) page.fire('doc', 'keydown', { key: 'a', target: field });
    for (let i = 0; i < 5; i++) page.fire('doc', 'input', { target: field });
    page.fire('doc', 'focusout', { target: field });
    const pw = el('input', { type: 'password' }, comp);
    pw.value = 'hunter2';
    page.fire('doc', 'input', { target: pw });
    page.fire('doc', 'focusout', { target: pw });
    page.fire('doc', 'keydown', { key: 'z', ctrlKey: true, target: runAll });

    // A request: observed, summarised, its failing body read from a CLONE; no extra request made.
    await page.win.fetch('http://farm:4000/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }), headers: { authorization: 'Bearer sk-9' } });
    assert.equal(page.fetched.length, 1, 'the wrapper adds no request of its own');
    await tick(20);

    // Review fixes (K7 landing):
    // an AltGr character in a password field is typing, and a password's keys are never written;
    page.fire('doc', 'keydown', { key: '@', ctrlKey: true, altKey: true, getModifierState: (m) => m === 'AltGraph', target: pw });
    page.fire('doc', 'keydown', { key: '#', ctrlKey: true, altKey: true, target: pw });
    // a burst of the same request (a fan-out) is written BURST_MAX times, then counted;
    for (let i = 0; i < 30; i++) await page.win.fetch('http://farm:4000/v1/ok', { method: 'POST', body: JSON.stringify({ model: 'fan', messages: [] }) });
    // an event too big for one line is shrunk, and keeps the fields a reader needs;
    const huge = { parts: Array.from({ length: 3000 }, (_, i) => ({ id: `p${i}`, value: 'x'.repeat(3000) })) };
    rec.log('mark', { i: 9, note: 'keep me', png: 'shot.png', doc: huge });
    await tick(20);
    // and two stops at once are one stop.
    await Promise.all([rec.stop('switch'), rec.stop('switch')]);
    assert.equal(page.store.get(REC_KEY), '0');
    assert.equal(door.sent.stops, 1);
    const lines = door.sent.text.trim().split('\n').map((l) => JSON.parse(l));
    const pre = lines.filter((l) => l.pre === 1).map((l) => l.k);
    assert.deepEqual(pre.slice(0, 3), ['ui.click', 'err.uncaught', 'con.error'], 'the backlog comes first, flagged');
    assert.equal(lines.find((l) => l.k === 'err.uncaught').where, 'b/graph/runner.mjs:3:9');
    const keys = lines.filter((l) => l.k === 'ui.key');
    assert.equal(keys.length, 1, 'printable keys in a field are not logged one by one');
    assert.equal(keys[0].combo, 'Ctrl+z');
    const edits = lines.filter((l) => l.k === 'ui.edit');
    assert.equal(edits.length, 2);
    assert.equal(edits[0].value, 'summarise the attached');
    assert.equal(edits[0].inputs, 5);
    assert.equal(edits[1].value, '[hidden]');
    assert.ok(!door.sent.text.includes('hunter2') && !door.sent.text.includes('sk-9'), 'no secret in the file');
    const req = lines.find((l) => l.k === 'http.req');
    // B5 (critic R1): no Computer run was executing, so this is someone else's request (LOL Chat's):
    // method, URL and size only — its body is not parsed and none of its text is kept.
    assert.equal(req.method, 'POST');
    assert.ok(req.bytes > 0);
    assert.equal(req.msgs, undefined, 'no message text from a request the Computer did not make');
    assert.equal(req.model, undefined);
    assert.equal(summarizeRequest('http://f/v1/chat/completions', { method: 'POST', body: '{"model":"m","messages":[]}' }, { deep: false }).model, undefined);
    assert.equal(lines.find((l) => l.k === 'http.res').status, 429);
    assert.equal(lines.find((l) => l.k === 'http.body').text, '{"error":"busy"}');
    assert.equal(lines[lines.length - 1].k, 'log.stop');
    assert.equal(lines.filter((l) => l.k === 'log.stop').length, 1, 'two stops at once write one log.stop');
    assert.equal(door.sent.stops, 1, '…and close the file once');
    assert.ok(!lines.some((l) => l.k === 'ui.key' && l.target && l.target.field && l.target.field.type === 'password'), 'no key of a password field is written');
    const burst = lines.filter((l) => l.k === 'http.req' && /\/ok$/.test(l.url));
    assert.equal(burst.length, 20, 'a burst of one request is written 20 times, then counted');
    const big = lines.find((l) => l.k === 'mark' && l.i === 9);
    assert.ok(big, 'the oversized mark is still in the file');
    assert.equal(big.note, 'keep me');
    assert.equal(big.png, 'shot.png');
    assert.ok(JSON.stringify(big).length < 600 * 1024, 'and fits one append');
    assert.ok(RING_MAX >= 1000);
  });

  // ---- shell/src/main/debugLog.ts (compiled) -----------------------------------------------------

  test('main writes the file: named by the clock, header then facts, refuses without a recording, stops at its size limit, keeps 15, saves screenshots', async () => {
    if (!fs.existsSync(BUILD)) { console.log('   (skipped: no build/main/debugLog.js — run `npm run build` in shell/)'); return; }
    const require = createRequire(import.meta.url);
    const { createDebugLog, stampOf, KEEP, FILE_MAX } = require(BUILD);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-devlog-'));
    try {
      const shown = [];
      let clock = new Date(2026, 8, 24, 21, 15, 3);
      const log = createDebugLog({
        dir, now: () => clock, facts: () => ({ app: '0.0.0' }),
        capture: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        shellApi: { showItemInFolder: (p) => shown.push(p), openPath: async () => '' },
      });
      assert.equal(stampOf(clock), '2026-09-24_21-15-03');
      assert.equal((await log.append('x')).code, 'E_NONE', 'nothing is accepted without a recording');
      assert.equal((await log.start('')).code, 'E_ARGS');
      const s = await log.start('{"k":"log.start"}');
      assert.equal(s.ok, true);
      assert.equal(s.name, 'computer-2026-09-24_21-15-03.jsonl');
      assert.equal((await log.append('{"k":"ui.click"}')).ok, true);
      const m = await log.mark();
      assert.equal(m.png, 'computer-2026-09-24_21-15-03-mark-1.png');
      assert.ok(fs.existsSync(path.join(dir, m.png)));
      const body = fs.readFileSync(s.path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.deepEqual(body.map((l) => l.k), ['log.start', 'log.main', 'ui.click']);
      assert.equal(body[1].app, '0.0.0');

      // The size limit: one "full" line, then E_FULL for good.
      const chunk = 'y'.repeat(2 * 1024 * 1024 - 16);
      let last = null;
      for (let i = 0; i < Math.ceil(FILE_MAX / chunk.length) + 1; i++) { last = await log.append(chunk); if (!last.ok) break; }
      assert.equal(last.code, 'E_FULL');
      assert.equal((await log.append('z')).code, 'E_FULL');
      assert.ok(fs.statSync(s.path).size <= FILE_MAX + 1024);
      const stopped = await log.stop();
      assert.equal(stopped.name, s.name);
      assert.equal((await log.append('z')).code, 'E_NONE');
      await log.reveal();
      assert.equal(shown[shown.length - 1], s.path, 'reveal selects the last recording');

      // Retention: KEEP recordings (and only their screenshots) survive.
      for (let i = 1; i <= KEEP + 2; i++) {
        clock = new Date(2026, 8, 25, 1, 0, i);
        await log.start('{"k":"log.start"}');
        await log.stop();
      }
      const left = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
      assert.equal(left.length, KEEP + 1, 'KEEP plain recordings, plus the one holding a marked bug');
      assert.ok(left.includes(s.name), 'a recording with a marked bug outlives the plain ones');
      assert.ok(fs.existsSync(path.join(dir, m.png)), 'with its screenshot');

      // Many recordings in ONE second: -2 … -12 are ordered by number, so the NEWEST survive.
      clock = new Date(2026, 8, 25, 2, 0, 0);
      const same = [];
      for (let i = 0; i < KEEP + 2; i++) { same.push((await log.start('{"k":"log.start"}')).name); await log.stop(); }
      assert.equal(same[1], 'computer-2026-09-25_02-00-00-2.jsonl');
      const after = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
      assert.ok(!after.includes(same[0]) && !after.includes(same[1]), 'the two OLDEST of that second went (a text sort would drop -10 first)');
      assert.ok(same.slice(2).every((n) => after.includes(n)), 'every newer one survived');

      // The footer counts against the size limit; the header has its own small one.
      assert.equal((await log.start('x'.repeat(70 * 1024))).code, 'E_ARGS', 'a 70 KB header is refused');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
};
