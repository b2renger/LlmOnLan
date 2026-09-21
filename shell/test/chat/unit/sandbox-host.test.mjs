// sandbox/host.mjs (C3-U1): the renderer side of the opaque-origin iframe, against a scripted
// guest. The real guest is proven in the browser (harness c3-sandbox-*); what a unit test can prove
// — and what a browser test would prove slowly and flakily — is the HOST's bookkeeping:
//
//   * it never says "ready" before the guest said `ready`;
//   * a message from another window, with another token or of another version is DROPPED, and ten
//     in a row tear the frame down (that is the whole defence: a sandboxed frame has no origin to
//     check, so source + nonce + this counter are it);
//   * a run that never answers becomes a rebuild, not a hang — and three rebuilds inside the window
//     stop the ladder instead of looping forever;
//   * libraries are replayed into a rebuilt frame (a blank frame has nothing loaded);
//   * hide() keeps the frame through its grace period and drops it after; destroy() ends everything.
//
// The fakes here are deliberately dumb: a document that makes an object with a contentWindow, a
// window that delivers message events, and a guest whose replies each test writes itself.
import assert from 'node:assert/strict';

import { createSandbox } from '../../../renderer/chat/sandbox/host.mjs';
import { API_KEYS } from '../../../renderer/chat/core/types.mjs';
import { MAX_DROPPED } from '../../../renderer/chat/sandbox/protocol.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Fast timeouts: the ladder and the grace period are what we are testing, not how long they are. */
const FAST = { boot: 200, run: 120, compute: 120, ping: 25, snapshot: 120, hideGrace: 60 };

/**
 * A scripted world: a fake document/window/mount and a guest whose behaviour is one function.
 * `reply(msg)` returns an array of guest messages to deliver, or null to stay silent.
 */
function world(reply) {
  const win = {
    handlers: new Set(),
    addEventListener(type, fn) { if (type === 'message') win.handlers.add(fn); },
    removeEventListener(type, fn) { win.handlers.delete(fn); },
    deliver(data, source) { for (const fn of Array.from(win.handlers)) fn({ data, source }); },
  };
  const frames = [];
  const doc = {
    createElement() {
      const frame = {
        attrs: {}, className: '', parentNode: null, loaded: false, sent: [], _src: '',
        setAttribute(k, v) { frame.attrs[k] = v; },
        getAttribute(k) { return frame.attrs[k]; },
        addEventListener(type, fn) { if (type === 'load') setTimeout(fn, 0); },
        set src(v) { frame._src = v; },
        get src() { return frame._src; },
        contentWindow: {
          postMessage(msg) {
            frame.sent.push(msg);
            const out = reply(msg, frame);
            if (!out) return;
            setTimeout(() => {
              for (const m of out) win.deliver(m, frame.contentWindow);
            }, 0);
          },
        },
      };
      frames.push(frame);
      return frame;
    },
  };
  const mount = {
    children: [],
    appendChild(el) { mount.children.push(el); el.parentNode = mount; return el; },
    removeChild(el) {
      const i = mount.children.indexOf(el);
      if (i >= 0) mount.children.splice(i, 1);
      el.parentNode = null;
      return el;
    },
  };
  return { win, doc, mount, frames };
}

/** The guest every test starts from: it boots, pongs, and answers what it is asked. */
const politeGuest = (msg) => {
  const tok = msg.tok;
  if (msg.cmd === 'boot') return [{ v: 1, tok, kind: 'ready', ua: 'runner' }];
  if (msg.cmd === 'ping') return [{ v: 1, tok, kind: 'pong', seq: msg.seq }];
  if (msg.cmd === 'libs') {
    return [{ v: 1, tok, kind: 'libsDone', results: (msg.libs || []).map((l) => ({ name: l.name, ok: true, error: null })) }];
  }
  if (msg.cmd === 'compute') {
    return [{ v: 1, tok, kind: 'computed', id: msg.id, ok: true, ms: 1, json: JSON.stringify(msg.inputs || {}), error: null }];
  }
  if (msg.cmd === 'run') return [{ v: 1, tok, kind: 'ran', id: msg.id, ok: true, ms: 2, error: null }];
  if (msg.cmd === 'snapshot') return [{ v: 1, tok, kind: 'frame', id: msg.id, dataUrl: 'data:image/png;base64,AAAA', w: 4, h: 3 }];
  if (msg.cmd === 'dispose') return [{ v: 1, tok, kind: 'bye' }];
  return null;
};

const boot = (reply = politeGuest, extra = {}) => {
  const w = world(reply);
  const sb = createSandbox({ doc: w.doc, win: w.win, timeouts: FAST, ...extra });
  sb.mount(w.mount);
  return { ...w, sb };
};

export default (test) => {
  test('the host exposes exactly the frozen sandbox API, no more and no less', () => {
    const { sb } = boot();
    const keys = Object.keys(sb).sort();
    assert.deepEqual(keys, API_KEYS.sandbox.slice().sort());
    sb.destroy();
  });

  test('a fresh sandbox is idle, and the iframe it makes can do exactly one thing', async () => {
    const { sb, frames, mount } = boot();
    assert.equal(sb.state(), 'idle');
    assert.equal(mount.children.length, 0, 'no iframe until something asks for one');
    assert.equal(await sb.ready(), true);
    assert.equal(sb.state(), 'ready');
    const fr = frames[0];
    assert.equal(fr.attrs.sandbox, 'allow-scripts');
    assert.equal(fr.attrs.sandbox.includes('allow-same-origin'), false);
    assert.equal(fr.attrs.referrerpolicy, 'no-referrer');
    assert.equal(fr.attrs.allow, '', 'no permission is delegated to the guest');
    assert.equal(fr.src.endsWith('/sandbox/runner.html'), true, 'the runner is resolved from the module, not from location');
    assert.equal(mount.children.length, 1);
    sb.destroy();
  });

  test('two callers asking at once get ONE frame, and neither is told ready early', async () => {
    const { sb, frames } = boot();
    const [a, b] = await Promise.all([sb.ready(), sb.ready()]);
    assert.deepEqual([a, b], [true, true]);
    assert.equal(frames.length, 1, 'a concurrent boot must not build a second guest');
    sb.destroy();
  });

  test('a guest that never says ready leaves the sandbox disabled, with a reason', async () => {
    const notes = [];
    const { sb, mount } = boot((msg) => (msg.cmd === 'boot' ? null : politeGuest(msg)));
    sb.on((ev) => { if (ev.type === 'note') notes.push(ev.text); });
    assert.equal(await sb.ready(), false);
    assert.equal(sb.state(), 'disabled');
    assert.equal(mount.children.length, 0, 'the dead frame is removed, not left in the page');
    assert.equal(notes.length, 1);
    assert.match(notes[0], /sandbox/i);
    const out = await sb.compute({ code: 'return 1' });
    assert.equal(out.ok, false);
    assert.equal(typeof out.error.message, 'string');
    sb.destroy();
  });

  test('compute carries inputs there and a JSON string back', async () => {
    const { sb, frames } = boot();
    const out = await sb.compute({ code: 'return inputs', inputs: { a: 1, b: 'two' } });
    assert.equal(out.ok, true);
    assert.deepEqual(JSON.parse(out.json), { a: 1, b: 'two' });
    assert.equal(sb.runs(), 1);
    assert.equal(sb.state(), 'ready');
    const sent = frames[0].sent.find((m) => m.cmd === 'compute');
    assert.equal(sent.v, 1);
    assert.equal(typeof sent.tok, 'string');
    assert.equal(sent.tok.length, 32, 'every command carries the per-frame nonce');
    sb.destroy();
  });

  test('an abort stops the wait AND tells the guest to stop', async () => {
    const { sb, frames } = boot((msg) => (msg.cmd === 'compute' ? null : politeGuest(msg)));
    await sb.ready();
    const ac = new AbortController();
    const p = sb.compute({ code: 'while (true) {}', signal: ac.signal });
    await tick(10);
    ac.abort();
    const out = await p;
    assert.equal(out.ok, false);
    assert.equal(frames[0].sent.some((m) => m.cmd === 'stop'), true, 'the guest was told to drop the work');
    sb.destroy();
  });

  test('a message from elsewhere, with a stale token or of another version is dropped', async () => {
    const { sb, win, frames } = boot();
    await sb.ready();
    const dropped = [];
    sb.on((ev) => { if (ev.type === 'dropped') dropped.push(ev.why); });
    const good = frames[0].contentWindow;
    win.deliver({ v: 1, tok: 'not-the-nonce', kind: 'log', level: 'log', text: 'x' }, good);
    win.deliver({ v: 2, tok: 'x', kind: 'log', level: 'log', text: 'x' }, good);
    win.deliver({ v: 1, tok: 'x', kind: 'exfiltrate' }, good);
    assert.deepEqual(dropped, ['token', 'version', 'kind']);
    // Another window entirely is not even counted: it was never ours to drop.
    win.deliver({ v: 1, tok: 'x', kind: 'log', level: 'log', text: 'x' }, { other: true });
    assert.equal(dropped.length, 3);
    assert.equal(sb.logs().length, 0, 'not one of them reached the log');
    sb.destroy();
  });

  test('ten dropped messages in a row tear the frame down', async () => {
    const { sb, win, frames, mount } = boot();
    await sb.ready();
    const good = frames[0].contentWindow;
    for (let i = 0; i < MAX_DROPPED; i++) win.deliver({ v: 1, tok: 'wrong', kind: 'log', level: 'log', text: 'x' }, good);
    assert.equal(sb.state(), 'disabled');
    assert.equal(mount.children.length, 0);
    sb.destroy();
  });

  test('a run that never answers becomes a rebuild with a fresh nonce, not a hang', async () => {
    const notes = [];
    let answer = false;
    const { sb, frames } = boot((msg) => {
      if (msg.cmd === 'run' && !answer) return null;
      return politeGuest(msg);
    });
    sb.on((ev) => { if (ev.type === 'note') notes.push(ev.text); });
    const out = await sb.run({ kind: 'canvas', code: 'for(;;){}' });
    assert.equal(out.ok, false);
    assert.match(out.error.message, /time/i, 'the caller is told it timed out, not "an error occurred"');
    assert.equal(notes.some((n) => /restart/i.test(n)), true, 'the reader gets one row about the restart');
    assert.equal(frames.length, 2, 'the frame was rebuilt');
    assert.notEqual(frames[0].sent[0].tok, frames[1].sent[0].tok, 'the new frame got a NEW nonce');
    // The rebuilt frame is usable; the sketch is NOT re-run on its own.
    answer = true;
    assert.equal(frames[1].sent.some((m) => m.cmd === 'run'), false, 'an infinite loop is never replayed automatically');
    const again = await sb.run({ kind: 'canvas', code: 'ok' });
    assert.equal(again.ok, true);
    sb.destroy();
  });

  test('three rebuilds inside the window stop the ladder, and only an explicit re-arm restarts it', async () => {
    let deaf = true;
    const { sb, frames } = boot((msg) => {
      if (msg.cmd === 'compute' && deaf) return null;
      return politeGuest(msg);
    });
    const states = [];
    sb.on((ev) => { if (ev.type === 'state') states.push(ev.state); });
    for (let i = 0; i < 3; i++) await sb.compute({ code: 'for(;;){}' });
    assert.equal(sb.state(), 'disabled');
    assert.equal(sb.debug().blocked, true);
    const framesAfterLadder = frames.length;
    const refused = await sb.compute({ code: '1' });
    assert.equal(refused.ok, false);
    assert.equal(frames.length, framesAfterLadder, 'a blocked sandbox does not quietly build another frame');
    deaf = false;
    const rearmed = await sb.compute({ code: '1', rearm: true });
    assert.equal(rearmed.ok, true, 'the human asking again is what re-arms it');
    assert.equal(states.includes('stalled'), true);
    sb.destroy();
  });

  test('libraries are sent once, and replayed into a frame that had to be rebuilt', async () => {
    let deaf = false;
    const { sb, frames } = boot((msg) => {
      if (msg.cmd === 'run' && deaf) return null;
      return politeGuest(msg);
    }, { libSource: async (name) => (name === 'p5' ? `/* the project's own ${name} */` : null) });
    const notes = [];
    sb.on((ev) => { if (ev.type === 'note') notes.push(ev.text); });

    await sb.run({ kind: 'p5', code: 'sketch' });
    const first = frames[0].sent.filter((m) => m.cmd === 'libs');
    assert.equal(first.length, 1, 'p5 was sent because the kind needs it');
    assert.equal(first[0].libs[0].name, 'p5');
    assert.match(first[0].libs[0].source, /the project's own p5/, 'the project override beat the vendored build');
    assert.equal(notes.some((n) => /p5/.test(n)), true, 'and the reader is told which build ran');

    await sb.run({ kind: 'p5', code: 'again' });
    assert.equal(frames[0].sent.filter((m) => m.cmd === 'libs').length, 1, 'a second run does not resend the library');

    deaf = true;
    await sb.run({ kind: 'p5', code: 'for(;;){}' });
    assert.equal(frames.length, 2);
    assert.equal(frames[1].sent.filter((m) => m.cmd === 'libs').length, 1, 'the rebuilt frame got its libraries back');
    assert.deepEqual(sb.debug().libs.map((l) => l.name), ['p5']);
    sb.destroy();
  });

  test('a snapshot is a picture or an honest null — never a throw', async () => {
    const { sb } = boot();
    await sb.ready();
    const shot = await sb.snapshot({ maxPx: 256 });
    assert.equal(shot.dataUrl.startsWith('data:image/png;base64,'), true);
    assert.deepEqual([shot.w, shot.h], [4, 3]);

    // A guest that cannot photograph anything answers with a failed `ran` for that id.
    const bare = boot((msg) => (msg.cmd === 'snapshot'
      ? [{ v: 1, tok: msg.tok, kind: 'ran', id: msg.id, ok: false, ms: 0, error: { message: 'nothing to photograph' } }]
      : politeGuest(msg)));
    await bare.sb.ready();
    assert.equal(await bare.sb.snapshot({}), null);
    sb.destroy();
    bare.sb.destroy();
  });

  test('hide() keeps the frame through its grace period and then drops it', async () => {
    const { sb, mount, frames } = boot();
    await sb.ready();
    sb.hide();
    await tick(20);
    assert.equal(mount.children.length, 1, 'flipping away and back must not pay a rebuild');
    assert.equal(await sb.ready(), true);
    assert.equal(frames.length, 1, 'coming back inside the grace period reuses the same guest');
    sb.hide();
    await tick(FAST.hideGrace + 40);
    assert.equal(mount.children.length, 0, 'a panel left hidden does not keep a guest process alive');
    assert.equal(sb.state(), 'idle');
    sb.destroy();
  });

  test('destroy() says goodbye, removes the frame and stops answering', async () => {
    const { sb, mount, frames } = boot();
    await sb.ready();
    sb.destroy();
    assert.equal(mount.children.length, 0);
    assert.equal(frames[0].sent.some((m) => m.cmd === 'dispose'), true);
    const after = await sb.compute({ code: '1' });
    assert.equal(after.ok, false);
    assert.equal(frames.length, 1, 'a destroyed sandbox never builds another frame');
    assert.equal(sb.debug().framed, false);
  });

  test('stop() settles the request it stops: no stall, no note, no rebuild rung spent', async () => {
    // A guest that takes `run` and never answers — the shape a sketch that is still starting has.
    const silent = (msg) => (msg.cmd === 'run' ? null : politeGuest(msg));
    const { sb, frames } = boot(silent);
    await sb.ready();
    const notes = [];
    sb.on((ev) => { if (ev.type === 'note' || ev.type === 'gone') notes.push(ev.type); });
    const started = Date.now();
    const running = sb.run({ kind: 'dom', code: '', html: '<p>hi</p>' });
    await tick(10);
    sb.stop();
    const out = await running;
    assert.equal(out.ok, false);
    assert.equal(out.error.message, t('sandbox.errAborted'), 'the caller asked for this: an abort, not a timeout');
    assert.ok(Date.now() - started < FAST.run, 'and it settles AT the stop, not when the timer fires');
    await tick(FAST.run + 40);          // past the timer that used to fire
    assert.deepEqual(notes, [], 'no "the preview was restarted" for a stop the caller asked for');
    assert.equal(frames.length, 1, 'and no rebuild rung was spent');
    assert.equal(sb.debug().framed, true);
    sb.destroy();
  });

  test('hide() settles the same way, and a boot in flight is not one of the casualties', async () => {
    const silent = (msg) => (msg.cmd === 'compute' ? null : politeGuest(msg));
    const { sb, frames } = boot(silent);
    await sb.ready();
    const computing = sb.compute({ code: '1' });
    await tick(10);
    sb.hide();
    const out = await computing;
    assert.equal(out.ok, false);
    assert.equal(out.error.message, t('sandbox.errAborted'));
    await tick(FAST.hideGrace + 40);
    assert.equal(frames.length, 1, 'the grace period dropped the frame; it did not build another');
    assert.equal(sb.debug().framed, false);
    // and the frame comes back on demand, the way show() asks for it
    assert.equal(await sb.ready(), true);
    assert.equal(frames.length, 2);
    sb.destroy();
  });

  test('logs and errors from the guest are kept per run and handed over as data', async () => {
    const { sb, win, frames } = boot();
    await sb.ready();
    const seen = [];
    sb.on((ev) => { if (ev.type === 'log' || ev.type === 'error') seen.push(ev.type); });
    const src = frames[0].contentWindow;
    const tok = frames[0].sent[0].tok;
    win.deliver({ v: 1, tok, kind: 'log', level: 'warn', text: 'careful' }, src);
    win.deliver({ v: 1, tok, kind: 'error', phase: 'runtime', message: 'boom', stack: 'at sketch.js:3:1', line: 3, col: 1, n: 0 }, src);
    assert.deepEqual(seen, ['log', 'error']);
    assert.deepEqual(sb.logs(), [{ level: 'warn', text: 'careful' }]);
    assert.equal(sb.errors()[0].line, 3);
    await sb.compute({ code: '1' });
    assert.deepEqual(sb.logs(), [], 'a new run starts from a clean slate');
    assert.deepEqual(sb.errors(), []);
    sb.destroy();
  });
};
