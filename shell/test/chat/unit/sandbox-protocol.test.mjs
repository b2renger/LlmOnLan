// sandbox/protocol.mjs (C3-U1): the envelope both sides of the opaque-origin iframe speak.
//
// What these assertions protect: the sandbox has no origin to check (a sandboxed frame's
// `event.origin` is the literal string 'null'), so the ONLY things standing between the guest and
// the host are `event.source`, the per-frame nonce and this validator. Every branch below is a way
// a message could have been let in that should not have been — and every cap is a number the host
// applies BEFORE anything reaches the DOM or JSON.parse.
//
// It also asserts that the guest, which cannot import this module (`default-src 'none'` forbids
// even a same-directory script), still agrees with it: runner.html's inlined command list, kind
// list and CSP are compared to the frozen constants here, byte for byte.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROTOCOL_VERSION, CMDS, KINDS, RUN_KINDS, LIMITS, TIMEOUTS, MAX_DROPPED, MAX_REBUILDS,
  REBUILD_WINDOW_MS, RUNNER_CSP, SANDBOX_ATTR,
  clampText, mintToken, command, message, readMessage, readCommand,
} from '../../../renderer/chat/sandbox/protocol.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_DIR = path.join(HERE, '..', '..', '..', 'renderer', 'chat', 'sandbox');
const runnerHtml = () => fs.readFileSync(path.join(SANDBOX_DIR, 'runner.html'), 'utf8');

const ok = (tok, kind, extra) => ({ v: 1, tok, kind, ...extra });

/** The guest's event bus, exactly as runner.html inlines it (between its VOICE-EVENTS markers). */
function voiceBus(onError) {
  const m = /\/\/ VOICE-EVENTS BEGIN([\s\S]*?)\/\/ VOICE-EVENTS END/.exec(runnerHtml());
  assert.ok(m, 'runner.html has its VOICE-EVENTS block');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[1]}\nreturn voiceBus;`)()(onError);
}

export default (test) => {
  test('the envelope builders refuse an unknown verb instead of sending a message nobody answers', () => {
    assert.deepEqual(command('ping', 'abc', { seq: 3 }), { v: 1, tok: 'abc', cmd: 'ping', seq: 3 });
    assert.deepEqual(message('pong', 'abc', { seq: 3 }), { v: 1, tok: 'abc', kind: 'pong', seq: 3 });
    assert.throws(() => command('runn', 'abc'), /unknown cmd/);
    assert.throws(() => message('rann', 'abc'), /unknown kind/);
    // A typo caught here is a bug; a typo sent is a host that waits out its whole timeout.
    assert.equal(CMDS.includes('compute'), true);
    assert.equal(KINDS.includes('computed'), true);
  });

  test('a nonce is 16 bytes of hex and is different every time', () => {
    const fixed = mintToken(() => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 255]);
    assert.equal(fixed, '000102030405060708090a0b0c0d0eff');
    assert.equal(fixed.length, 32);
    const a = mintToken();
    const b = mintToken();
    assert.equal(a.length, 32);
    assert.equal(/^[0-9a-f]{32}$/.test(a), true);
    assert.notEqual(a, b);
  });

  test('every way a guest message can be wrong is named, not merely rejected', () => {
    const t = 'tok1';
    assert.equal(readMessage(ok(t, 'pong', { seq: 1 }), { tok: t, sameSource: false }).why, 'source');
    assert.equal(readMessage('hello', { tok: t, sameSource: true }).why, 'shape');
    assert.equal(readMessage([1, 2], { tok: t, sameSource: true }).why, 'shape');
    assert.equal(readMessage({ v: 2, tok: t, kind: 'pong' }, { tok: t, sameSource: true }).why, 'version');
    assert.equal(readMessage({ v: 1, tok: t, kind: 'nope' }, { tok: t, sameSource: true }).why, 'kind');
    assert.equal(readMessage(ok('other', 'pong', {}), { tok: t, sameSource: true }).why, 'token');
    // The version is compared, never coerced: '1' is not 1.
    assert.equal(readMessage({ v: '1', tok: t, kind: 'pong' }, { tok: t, sameSource: true }).why, 'version');
  });

  test('text fields are clamped before the host ever sees them', () => {
    const t = 'tok';
    const huge = 'x'.repeat(LIMITS.textBytes * 3);
    const r = readMessage(ok(t, 'log', { level: 'warn', text: huge, n: 0 }), { tok: t, sameSource: true });
    assert.equal(r.ok, true);
    assert.equal(r.msg.text.length, LIMITS.textBytes + 1);      // + the ellipsis the clamp adds
    assert.equal(r.msg.level, 'warn');
    // an unknown level falls back rather than travelling as a class name
    assert.equal(readMessage(ok(t, 'log', { level: 'fatal', text: 'a' }), { tok: t, sameSource: true }).msg.level, 'log');
    assert.equal(clampText(null, 10), '');
    assert.equal(clampText('abcdef', 3), 'abc…');
    assert.equal(clampText(12345, 10), '12345');
  });

  test('an error keeps its line numbers and loses nothing else to coercion', () => {
    const t = 'tok';
    const r = readMessage(ok(t, 'error', {
      phase: 'runtime', message: 'boom', stack: 'at sketch.js:3:1', line: 3, col: 9, n: 0,
    }), { tok: t, sameSource: true });
    assert.equal(r.ok, true);
    assert.deepEqual(
      { phase: r.msg.phase, message: r.msg.message, line: r.msg.line, col: r.msg.col },
      { phase: 'runtime', message: 'boom', line: 3, col: 9 },
    );
    // a phase we never defined is not passed through as a label
    assert.equal(readMessage(ok(t, 'error', { phase: 'exfiltrate', message: 'x' }), { tok: t, sameSource: true }).msg.phase, 'runtime');
    // NaN/Infinity never reach a caller doing arithmetic on a line number
    const bad = readMessage(ok(t, 'error', { phase: 'run', message: 'x', line: 'seven', col: Infinity }), { tok: t, sameSource: true });
    assert.deepEqual([bad.msg.line, bad.msg.col], [0, 0]);
  });

  test('libsDone is capped at arrayMax rows and every row is coerced', () => {
    const t = 'tok';
    const rows = Array.from({ length: LIMITS.arrayMax + 30 }, (_, i) => ({ name: `lib${i}`, ok: i % 2 === 0, error: null }));
    const r = readMessage(ok(t, 'libsDone', { results: rows }), { tok: t, sameSource: true });
    assert.equal(r.msg.results.length, LIMITS.arrayMax);
    assert.deepEqual(r.msg.results[0], { name: 'lib0', ok: true, error: null });
    assert.equal(readMessage(ok(t, 'libsDone', { results: 'nope' }), { tok: t, sameSource: true }).msg.results.length, 0);
  });

  test('a computed value is refused by BYTE COUNT before anyone parses it', () => {
    const t = 'tok';
    const fits = JSON.stringify('y'.repeat(1000));
    const good = readMessage(ok(t, 'computed', { id: 'r1', ok: true, ms: 4, json: fits }), { tok: t, sameSource: true });
    assert.equal(good.ok, true);
    assert.equal(good.msg.json, fits);
    const over = 'z'.repeat(LIMITS.resultBytes + 1);
    assert.equal(readMessage(ok(t, 'computed', { id: 'r1', ok: true, json: over }), { tok: t, sameSource: true }).why, 'result-too-big');
    // a null result is legitimate (a sketch that returns nothing), and is NOT the string "null"
    assert.equal(readMessage(ok(t, 'computed', { id: 'r1', ok: true, json: null }), { tok: t, sameSource: true }).msg.json, null);
  });

  test('a frame must be a real image data: URL of a sane size', () => {
    const t = 'tok';
    const png = 'data:image/png;base64,AAAA';
    assert.equal(readMessage(ok(t, 'frame', { id: 'f1', dataUrl: png, w: 8, h: 4 }), { tok: t, sameSource: true }).msg.dataUrl, png);
    assert.equal(readMessage(ok(t, 'frame', { id: 'f1', dataUrl: 'javascript:alert(1)' }), { tok: t, sameSource: true }).why, 'data-url');
    assert.equal(readMessage(ok(t, 'frame', { id: 'f1', dataUrl: 'data:text/html;base64,AAAA' }), { tok: t, sameSource: true }).why, 'data-url');
    const huge = `data:image/png;base64,${'A'.repeat(LIMITS.dataUrlBytes)}`;
    assert.equal(readMessage(ok(t, 'frame', { id: 'f1', dataUrl: huge }), { tok: t, sameSource: true }).why, 'data-url-too-big');
  });

  test('the guest refuses everything until boot brings it a token', () => {
    assert.equal(readCommand({ v: 1, cmd: 'run', code: '' }, { tok: null, sameSource: true }).why, 'unbooted');
    assert.equal(readCommand({ v: 1, cmd: 'boot', tok: 'abc' }, { tok: null, sameSource: true }).ok, true);
    assert.equal(readCommand({ v: 1, cmd: 'run', tok: 'abc' }, { tok: 'abc', sameSource: true }).ok, true);
    assert.equal(readCommand({ v: 1, cmd: 'run', tok: 'zzz' }, { tok: 'abc', sameSource: true }).why, 'token');
    assert.equal(readCommand({ v: 1, cmd: 'run', tok: 'abc' }, { tok: 'abc', sameSource: false }).why, 'source');
    assert.equal(readCommand({ v: 1, cmd: 'eval', tok: 'abc' }, { tok: 'abc', sameSource: true }).why, 'cmd');
    assert.equal(readCommand({ v: 9, cmd: 'run', tok: 'abc' }, { tok: 'abc', sameSource: true }).why, 'version');
  });

  test('the limits and the ladder are the numbers the spec names', () => {
    assert.equal(PROTOCOL_VERSION, 1);
    assert.equal(MAX_DROPPED, 10);
    assert.equal(MAX_REBUILDS, 3);
    assert.equal(REBUILD_WINDOW_MS, 60000);
    assert.equal(TIMEOUTS.boot, 3000);
    assert.equal(TIMEOUTS.run, 5000);
    assert.equal(TIMEOUTS.ping, 1000);
    assert.equal(TIMEOUTS.hideGrace, 10000);
    assert.equal(LIMITS.maxLogs, 200);
    assert.equal(LIMITS.maxErrors, 20);
    assert.equal(SANDBOX_ATTR, 'allow-scripts');
    // The containment argument in one assertion: no 'self' anywhere, no network, no navigation.
    assert.equal(RUNNER_CSP.includes("'self'"), false);
    assert.equal(RUNNER_CSP.includes("connect-src 'none'"), true);
    assert.equal(RUNNER_CSP.includes("frame-src 'none'"), true);
    assert.equal(RUNNER_CSP.includes("default-src 'none'"), true);
  });

  test('the guest, which cannot import this module, still speaks exactly this protocol', () => {
    const html = runnerHtml();
    const list = (name) => {
      const m = new RegExp(`var ${name} = \\[([^\\]]*)\\]`).exec(html);
      assert.ok(m, `runner.html has no inlined ${name}`);
      return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    };
    assert.deepEqual(list('CMDS'), CMDS.slice(), 'the guest command list drifted from CMDS');
    assert.deepEqual(list('RUN_KINDS'), RUN_KINDS.slice(), 'the guest run-kind list drifted from RUN_KINDS');
    assert.equal(/var V = 1;/.test(html), true, 'the guest protocol version drifted from PROTOCOL_VERSION');
    assert.equal(html.includes(RUNNER_CSP), true, 'the runner CSP is not byte-identical to RUNNER_CSP');
    // The two things that would quietly undo the containment, asserted where a reader will see
    // them. Comments are stripped first: the file EXPLAINS why allow-same-origin is never added.
    const bare = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    assert.equal(bare.includes('allow-same-origin'), false);
    assert.equal(/<script\s+src=/i.test(html), false, 'the runner loads a script from disk');
  });

  // Converse (docs/COMPUTER_VOICE_PLAN.md K-V2): the guest's lol.on, exactly as runner.html inlines it.
  test('event: a conversation event reaches lol.on(type) and lol.on(\'*\'), in registration order', () => {
    assert.ok(CMDS.includes('event'));
    assert.deepEqual(command('event', 't', { ev: { type: 'turn', state: 'listening' } }), { v: 1, tok: 't', cmd: 'event', ev: { type: 'turn', state: 'listening' } });
    const errors = [];
    const bus = voiceBus((e) => errors.push(e));
    const order = [];
    bus.on('*', (e) => order.push(`*:${e.type}`));
    const off = bus.on('turn', (e) => order.push(`turn:${e.state}`));
    bus.on('user.level', (e) => order.push(`level:${e.level}`));
    assert.equal(bus.deliver({ type: 'turn', state: 'listening', t: 5 }), true);
    assert.equal(bus.deliver({ type: 'user.level', state: 'hearing', level: 0.5 }), true);
    off();
    bus.deliver({ type: 'turn', state: 'speaking' });
    assert.deepEqual(order, ['*:turn', 'turn:listening', '*:user.level', 'level:0.5', '*:turn']);
    assert.deepEqual(bus.voice, { state: 'speaking', last: { type: 'turn', state: 'speaking' } }, 'lol.voice is the conversation as last heard');
    assert.equal(errors.length, 0);
  });

  test('event: a throwing handler is a runtime error, never a dead guest; junk is refused; reset() clears handlers', () => {
    const errors = [];
    const bus = voiceBus((e) => errors.push(e));
    const heard = [];
    bus.on('*', () => { throw new Error('a sketch bug'); });
    bus.on('*', (e) => heard.push(e.type));
    bus.deliver({ type: 'start', state: 'listening' });
    assert.equal(errors.length, 1, 'reported');
    assert.equal(errors[0].message, 'a sketch bug');
    assert.deepEqual(heard, ['start'], 'the next handler still ran');
    for (const junk of [null, 'start', [1], { state: 'x' }, { type: '' }, { type: 'x'.repeat(65) }]) assert.equal(bus.deliver(junk), false, JSON.stringify(junk));
    assert.equal(bus.on('', () => {})(), undefined, 'a bad registration is a harmless off()');
    bus.reset();
    bus.deliver({ type: 'listening', state: 'listening' });
    assert.deepEqual(heard, ['start'], 'a re-run forgets the old sketch\'s handlers');
    assert.equal(bus.voice.state, 'listening', 'but lol.voice keeps following the conversation');
    // The guest hands lol.on and lol.voice to every sketch, and a live page reaches it as window.lol.
    const html = runnerHtml();
    assert.match(html, /on: voiceEvents\.on,/);
    assert.match(html, /voice: voiceEvents\.voice/);
    assert.match(html, /if \(cmd === 'event'\) \{ voiceEvents\.deliver\(msg\.ev\); return; \}/);
    assert.match(html, /if \(liveMode\) window\.lol = api;/);
    assert.match(html, /voiceEvents\.reset\(\);/);
  });
};
