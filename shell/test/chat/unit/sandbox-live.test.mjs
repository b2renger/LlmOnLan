// K-9 / K-7 (docs/COMPUTER_LIVE_PLAN.md, builder L): the LIVE guest's bookkeeping in the sandbox
// host, the `release` message, the orbit math the runner inlines, and the Preview's pure pieces.
// The real guest, with real input, is proven in the browser (harness k11-live-*); what a unit test
// proves quickly is what the browser would prove slowly:
//
//   * the live frame is made by the SAME factory as the snapshot one (runner, sandbox attribute,
//     referrer policy, no delegated permission) and INSIDE the mount it was given;
//   * it boots as live, loads its libraries, runs the code, and its handle says so;
//   * ONE live guest: a second stops the first, whose owner hears why; hide() and destroy() end it;
//   * a live guest that stops answering is torn down and NOT rebuilt;
//   * the two guests never read each other's messages (and neither counts the other's as a drop);
//   * `lol.orbit`'s math: a drag turns, the wheel zooms, a pan moves the target, damping settles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSandbox } from '../../../renderer/chat/sandbox/host.mjs';
import { readMessage, KINDS, RELEASE_WHYS } from '../../../renderer/chat/sandbox/protocol.mjs';
import { liveFit, liveEndsChoice, LIVE_MODES } from '../../../renderer/chat/graph/parts/preview.mjs';
import { restoreProgram, VIEW_SETTINGS } from '../../../renderer/chat/graph/undo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, '..', '..', '..', 'renderer', 'chat', 'sandbox', 'runner.html');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const FAST = { boot: 200, run: 120, compute: 120, ping: 25, snapshot: 120, hideGrace: 60 };

/** A scripted world, as in sandbox-host.test.mjs, plus mounts of our own and frame styles. */
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
        attrs: {}, className: '', parentNode: null, sent: [], _src: '', style: {}, focused: 0,
        setAttribute(k, v) { frame.attrs[k] = v; },
        getAttribute(k) { return frame.attrs[k]; },
        addEventListener(type, fn) { if (type === 'load') setTimeout(fn, 0); },
        focus() { frame.focused++; },
        set src(v) { frame._src = v; },
        get src() { return frame._src; },
        contentWindow: {
          postMessage(msg) {
            frame.sent.push(msg);
            const out = reply(msg, frame);
            if (!out) return;
            setTimeout(() => { for (const m of out) win.deliver(m, frame.contentWindow); }, 0);
          },
        },
      };
      frames.push(frame);
      return frame;
    },
  };
  const mount = (name) => {
    const m = {
      name, children: [],
      appendChild(el) { m.children.push(el); el.parentNode = m; return el; },
      removeChild(el) {
        const i = m.children.indexOf(el);
        if (i >= 0) m.children.splice(i, 1);
        el.parentNode = null;
        return el;
      },
    };
    return m;
  };
  return { win, doc, mount, frames };
}

const politeGuest = (msg) => {
  const tok = msg.tok;
  if (msg.cmd === 'boot') return [{ v: 1, tok, kind: 'ready', ua: 'runner' }];
  if (msg.cmd === 'ping') return [{ v: 1, tok, kind: 'pong', seq: msg.seq }];
  if (msg.cmd === 'libs') return [{ v: 1, tok, kind: 'libsDone', results: (msg.libs || []).map((l) => ({ name: l.name, ok: true, error: null })) }];
  if (msg.cmd === 'run') return [{ v: 1, tok, kind: 'ran', id: msg.id, ok: true, ms: 2, error: null }];
  if (msg.cmd === 'snapshot') return [{ v: 1, tok, kind: 'frame', id: msg.id, dataUrl: 'data:image/png;base64,AAAA', w: 4, h: 3 }];
  if (msg.cmd === 'dispose') return [{ v: 1, tok, kind: 'bye' }];
  return null;
};

const setup = (reply = politeGuest) => {
  const w = world(reply);
  const sb = createSandbox({ doc: w.doc, win: w.win, timeouts: FAST, libSource: async (name) => `/* ${name} */` });
  const snapMount = w.mount('snapshot');
  sb.mount(snapMount);
  return { ...w, sb, snapMount };
};

/** The orbit math, exactly as runner.html inlines it (between its ORBIT-MATH markers). */
function orbitMath() {
  const html = fs.readFileSync(RUNNER, 'utf8');
  const m = /\/\/ ORBIT-MATH BEGIN([\s\S]*?)\/\/ ORBIT-MATH END/.exec(html);
  assert.ok(m, 'runner.html has its ORBIT-MATH block');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[1]}\nreturn { orbitState, orbitSphere, orbitRotate, orbitPan, orbitZoom, orbitWheelFactor, orbitStep };`)();
}

/** A camera shaped like three's, as far as the orbit reads it. */
function camera(x, y, z) {
  return {
    position: { x, y, z }, fov: 50, looked: null,
    lookAt(a, b, c) { this.looked = [a, b, c]; },
  };
}
const target = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

export default (test) => {
  // ---- protocol --------------------------------------------------------------------------------

  test('`release` is a guest message with one known reason; anything else is coerced to it', () => {
    assert.ok(KINDS.includes('release'));
    assert.deepEqual(RELEASE_WHYS.slice(), ['escape']);
    const ok = readMessage({ v: 1, tok: 't', kind: 'release', why: 'escape' }, { tok: 't', sameSource: true });
    assert.equal(ok.ok, true);
    assert.equal(ok.msg.why, 'escape');
    const odd = readMessage({ v: 1, tok: 't', kind: 'release', why: '<script>' }, { tok: 't', sameSource: true });
    assert.equal(odd.msg.why, 'escape');
    assert.equal(readMessage({ v: 1, tok: 'x', kind: 'release' }, { tok: 't', sameSource: true }).ok, false, 'the nonce still rules');
  });

  // ---- the live guest --------------------------------------------------------------------------

  test('live() makes its frame with the snapshot guest\'s factory, INSIDE the given mount, and runs the code live', async () => {
    const { sb, frames, mount, snapMount } = setup();
    const box = mount('box');
    const h = sb.live({ mount: box, mode: 'three', code: 'lol.orbit(camera);', size: { w: 320, h: 240 }, inputs: { a: 1 } });
    assert.equal(h.state(), 'booting');
    assert.equal(sb.liveNow(), h, 'liveNow() is the handle');
    const out = await h.ready;
    assert.equal(out.ok, true);
    assert.equal(h.state(), 'running');
    assert.equal(box.children.length, 1, 'the live frame lives in the box');
    assert.equal(snapMount.children.length, 0, 'and the snapshot guest was not touched');
    const fr = frames[0];
    assert.equal(fr.attrs.sandbox, 'allow-scripts');
    assert.equal(fr.attrs.referrerpolicy, 'no-referrer');
    assert.equal(fr.attrs.allow, '');
    assert.equal(fr.src.endsWith('/sandbox/runner.html'), true);
    assert.match(fr.className, /\bsandbox-live-frame\b/);
    assert.deepEqual([fr.style.width, fr.style.height], ['320px', '240px'], 'the frame IS the box\'s W x H');
    const boot = fr.sent.find((m) => m.cmd === 'boot');
    assert.equal(boot.live, true, 'the guest is told it is live');
    const libs = fr.sent.find((m) => m.cmd === 'libs');
    assert.deepEqual(libs.libs.map((l) => l.name), ['three'], 'three.js is loaded before the first line');
    const run = fr.sent.find((m) => m.cmd === 'run');
    assert.equal(run.kind, 'three');
    assert.equal(run.code, 'lol.orbit(camera);');
    assert.deepEqual(run.params, { a: 1 });
    sb.destroy();
  });

  test('a web page goes live as markup on a dom run', async () => {
    const { sb, frames, mount } = setup();
    const h = sb.live({ mount: mount('box'), mode: 'html', code: '<button>hi</button>', css: 'p{}', size: { w: 100, h: 80 } });
    await h.ready;
    const run = frames[0].sent.find((m) => m.cmd === 'run');
    assert.deepEqual([run.kind, run.code, run.html, run.css], ['dom', '', '<button>hi</button>', 'p{}']);
    assert.equal(frames[0].sent.some((m) => m.cmd === 'libs'), false, 'a page needs no library');
    sb.destroy();
  });

  test('restart(code) runs the new code in the SAME frame, re-sized when asked', async () => {
    const { sb, frames, mount } = setup();
    const h = sb.live({ mount: mount('box'), mode: 'p5', code: 'one', size: { w: 100, h: 100 } });
    await h.ready;
    const out = await h.restart('two', { size: { w: 200, h: 50 } });
    assert.equal(out.ok, true);
    assert.equal(frames.length, 1, 'no second frame');
    const runs = frames[0].sent.filter((m) => m.cmd === 'run');
    assert.deepEqual(runs.map((r) => r.code), ['one', 'two']);
    assert.deepEqual(runs[1].size, { w: 200, h: 50 });
    assert.deepEqual([frames[0].style.width, frames[0].style.height], ['200px', '50px']);
    assert.equal(h.debug().runs, 2);
    sb.destroy();
  });

  test('ONE live guest: a second stops the first, whose owner hears it was replaced', async () => {
    const { sb, mount } = setup();
    const a = mount('a');
    const b = mount('b');
    const ha = sb.live({ mount: a, mode: 'p5', code: 'a', size: { w: 10, h: 10 } });
    const heard = [];
    ha.on((ev) => { if (ev.type === 'stopped') heard.push(ev.why); });
    await ha.ready;
    const hb = sb.live({ mount: b, mode: 'p5', code: 'b', size: { w: 10, h: 10 } });
    assert.deepEqual(heard, ['replaced']);
    assert.equal(ha.state(), 'stopped');
    assert.equal(a.children.length, 0, 'the first frame is gone');
    assert.equal(sb.liveNow(), hb);
    await hb.ready;
    assert.equal(b.children.length, 1);
    hb.stop();
    assert.equal(sb.liveNow(), null);
    assert.equal(b.children.length, 0);
    sb.destroy();
  });

  test('hide() stops the live guest at once (no grace period); destroy() too', async () => {
    const { sb, mount } = setup();
    const box = mount('box');
    const h = sb.live({ mount: box, mode: 'p5', code: 'x', size: { w: 10, h: 10 } });
    const heard = [];
    h.on((ev) => { if (ev.type === 'stopped') heard.push(ev.why); });
    await h.ready;
    sb.hide();
    assert.deepEqual(heard, ['hidden']);
    assert.equal(box.children.length, 0);
    const h2 = sb.live({ mount: box, mode: 'p5', code: 'y', size: { w: 10, h: 10 } });
    const heard2 = [];
    h2.on((ev) => { if (ev.type === 'stopped') heard2.push(ev.why); });
    await h2.ready;
    sb.destroy();
    assert.deepEqual(heard2, ['gone']);
    assert.equal(sb.liveNow(), null);
  });

  test('a live guest that stops answering is torn down and NOT rebuilt', async () => {
    let answer = true;
    const { sb, frames, mount } = setup((msg) => (msg.cmd === 'ping' && !answer ? null : politeGuest(msg)));
    const box = mount('box');
    const h = sb.live({ mount: box, mode: 'p5', code: 'x', size: { w: 10, h: 10 } });
    const heard = [];
    h.on((ev) => { if (ev.type === 'stopped') heard.push(ev.why); });
    await h.ready;
    answer = false;
    await tick(FAST.ping * 5);
    assert.deepEqual(heard, ['stalled']);
    assert.equal(h.state(), 'stalled');
    assert.equal(box.children.length, 0);
    await tick(FAST.ping * 4);
    assert.equal(frames.length, 1, 'no second frame: re-running would hang again');
    sb.destroy();
  });

  test('a run that never answers is a stall, and the frame goes', async () => {
    const { sb, mount } = setup((msg) => (msg.cmd === 'run' ? null : politeGuest(msg)));
    const box = mount('box');
    const h = sb.live({ mount: box, mode: 'p5', code: 'while(1){}', size: { w: 10, h: 10 } });
    const out = await h.ready;
    assert.equal(out.ok, false);
    assert.equal(out.timeout, true);
    assert.equal(h.state(), 'stalled');
    assert.equal(box.children.length, 0);
    sb.destroy();
  });

  test('the guests never read each other: a live frame\'s message is not a snapshot drop, and the reverse', async () => {
    const { sb, frames, mount, win } = setup();
    assert.equal(await sb.ready(), true);                 // the snapshot guest, frame 0
    const h = sb.live({ mount: mount('box'), mode: 'p5', code: 'x', size: { w: 10, h: 10 } });
    await h.ready;
    const snap = frames[0];
    const live = frames[1];
    const logsBefore = sb.logs().length;
    // a well-formed log from the LIVE frame, with the live token: only the live handle keeps it
    const liveTok = live.sent[0].tok;
    win.deliver({ v: 1, tok: liveTok, kind: 'log', level: 'log', text: 'from live' }, live.contentWindow);
    assert.deepEqual(h.logs().map((l) => l.text), ['from live']);
    assert.equal(sb.logs().length, logsBefore, 'the snapshot host did not take it');
    assert.equal(sb.debug().dropped, 0, 'and did not count it as a drop');
    // the snapshot frame's own message is not the live guest's
    const snapTok = snap.sent[0].tok;
    win.deliver({ v: 1, tok: snapTok, kind: 'log', level: 'log', text: 'from snapshot' }, snap.contentWindow);
    assert.deepEqual(h.logs().map((l) => l.text), ['from live']);
    // a live-frame message with the SNAPSHOT's token is refused by the live guest
    win.deliver({ v: 1, tok: snapTok, kind: 'log', level: 'log', text: 'forged' }, live.contentWindow);
    assert.deepEqual(h.logs().map((l) => l.text), ['from live']);
    sb.destroy();
  });

  test('Escape in the sketch reaches the owner as `release`; focus() focuses the frame', async () => {
    const { sb, frames, mount, win } = setup();
    const h = sb.live({ mount: mount('box'), mode: 'p5', code: 'x', size: { w: 10, h: 10 } });
    const heard = [];
    h.on((ev) => { if (ev.type === 'release' || ev.type === 'error') heard.push(ev.type); });
    await h.ready;
    const fr = frames[0];
    win.deliver({ v: 1, tok: fr.sent[0].tok, kind: 'release', why: 'escape' }, fr.contentWindow);
    win.deliver({ v: 1, tok: fr.sent[0].tok, kind: 'error', phase: 'runtime', message: 'boom', stack: '', line: 3, col: 1, n: 0 }, fr.contentWindow);
    assert.deepEqual(heard, ['release', 'error']);
    assert.equal(h.errors()[0].line, 3);
    h.focus();
    assert.equal(fr.focused, 1);
    const shot = await h.snapshot({ maxPx: 64 });
    assert.equal(shot.dataUrl.startsWith('data:image/png'), true, 'the snapshot door answers');
    sb.destroy();
  });

  test('a live guest with no mount ends at once and is not the live one', async () => {
    const { sb } = setup();
    const h = sb.live({ mount: null, mode: 'p5', code: 'x' });
    const out = await h.ready;
    assert.equal(out.ok, false);
    assert.equal(h.state(), 'stopped');
    assert.equal(sb.liveNow(), null);
    sb.destroy();
  });

  // ---- lol.orbit's math (runner.html, ORBIT-MATH) ------------------------------------------------

  test('orbit: the first step aims the camera at the target and moves nothing else', () => {
    const O = orbitMath();
    const cam = camera(0, 0, 5);
    const st = O.orbitState(target(), 0.15);
    assert.equal(O.orbitStep(st, cam, true), true);
    assert.deepEqual(cam.looked, [0, 0, 0]);
    assert.ok(near(cam.position.z, 5) && near(cam.position.x, 0) && near(cam.position.y, 0));
    assert.equal(O.orbitStep(st, cam, true), false, 'with no input, nothing moves');
  });

  test('orbit: a drag right turns the camera about the target, keeping its distance; damping settles', () => {
    const O = orbitMath();
    const cam = camera(0, 0, 5);
    const st = O.orbitState(target(), 0.2);
    O.orbitStep(st, cam, true);
    O.orbitRotate(st, 100, 0, 400);                    // a quarter of the height → a quarter turn
    let steps = 0;
    while (O.orbitStep(st, cam, true) && steps < 500) steps++;
    const r = Math.hypot(cam.position.x, cam.position.y, cam.position.z);
    assert.ok(near(r, 5, 1e-4), `the distance is kept: ${r}`);
    assert.ok(steps > 5, `damping spreads it over frames (${steps})`);
    assert.ok(near(cam.position.x, -5, 1e-3) && near(cam.position.z, 0, 1e-3), `a quarter turn left of +Z: ${JSON.stringify(cam.position)}`);
  });

  test('orbit: damping 0 applies input at once; a user update() in the same frame spends nothing', () => {
    const O = orbitMath();
    const cam = camera(0, 0, 5);
    const st = O.orbitState(target(), 0);
    O.orbitStep(st, cam, true);
    O.orbitRotate(st, 0, 50, 400);                     // drag down: look from above (OrbitControls' sense)
    assert.equal(O.orbitStep(st, cam, false), false, 'advance false spends no damping');
    assert.equal(O.orbitStep(st, cam, true), true);
    assert.ok(cam.position.y > 1, `the camera went up: ${cam.position.y}`);
    assert.equal(O.orbitStep(st, cam, true), false, 'all of it in one step');
  });

  test('orbit: the pole is never crossed', () => {
    const O = orbitMath();
    const cam = camera(0, 0, 5);
    const st = O.orbitState(target(), 0);
    O.orbitStep(st, cam, true);
    O.orbitRotate(st, 0, 4000, 400);
    O.orbitStep(st, cam, true);
    assert.ok(cam.position.y > 4.99 && cam.position.y <= 5, `clamped just short of the top: ${cam.position.y}`);
  });

  test('orbit: the wheel zooms (down = away), a pinch zooms harder, lines and pages count as pixels', () => {
    const O = orbitMath();
    assert.ok(O.orbitWheelFactor(100, 0, false) > 1);
    assert.ok(O.orbitWheelFactor(-100, 0, false) < 1);
    assert.ok(O.orbitWheelFactor(10, 0, true) > O.orbitWheelFactor(10, 0, false));
    assert.ok(near(O.orbitWheelFactor(1, 1, false), O.orbitWheelFactor(16, 0, false)));
    const cam = camera(0, 0, 5);
    const st = O.orbitState(target(), 0);
    O.orbitStep(st, cam, true);
    O.orbitZoom(st, 2);
    O.orbitStep(st, cam, true);
    assert.ok(near(cam.position.z, 10, 1e-9), `twice as far: ${cam.position.z}`);
    const ortho = { position: { x: 0, y: 0, z: 5 }, isOrthographicCamera: true, zoom: 1, top: 1, bottom: -1, updated: 0, lookAt() {}, updateProjectionMatrix() { this.updated++; } };
    const so = O.orbitState(target(), 0);
    O.orbitStep(so, ortho, true);
    O.orbitZoom(so, 2);
    O.orbitStep(so, ortho, true);
    assert.ok(near(ortho.zoom, 0.5) && ortho.updated === 1, 'an orthographic camera zooms by its zoom, not its distance');
  });

  test('orbit: a pan moves the target in the camera\'s plane, the content following the pointer', () => {
    const O = orbitMath();
    const cam = camera(0, 0, 5);
    const t0 = target();
    const st = O.orbitState(t0, 0);
    O.orbitStep(st, cam, true);
    O.orbitPan(st, cam, 40, 0, 400);                    // drag right
    O.orbitStep(st, cam, true);
    assert.ok(t0.x < 0 && near(t0.y, 0) && near(t0.z, 0), `the target went left: ${JSON.stringify(t0)}`);
    assert.ok(near(cam.position.x, t0.x) && near(cam.position.z, 5), 'the camera went with it');
    O.orbitPan(st, cam, 0, 40, 400);                    // drag down
    O.orbitStep(st, cam, true);
    assert.ok(t0.y > 0, `the target went up, so the scene moves down: ${t0.y}`);
  });

  // ---- the Preview's pure pieces ------------------------------------------------------------------

  test('liveFit: the frame is shown whole and centred, like the snapshot tile', () => {
    assert.deepEqual(liveFit(400, 300, 320, 240), { k: 1.25, x: 0, y: 0 });
    assert.deepEqual(liveFit(400, 120, 320, 240), { k: 0.5, x: 120, y: 0 });
    assert.deepEqual(liveFit(100, 400, 200, 100), { k: 0.5, x: 0, y: 175 });
    assert.deepEqual(liveFit(0, 0, 320, 240), { k: 1, x: 0, y: 0 }, 'no room measured yet: unscaled');
  });

  test('liveEndsChoice: a press, a takeover or a hang ends the choice; a pause does not', () => {
    for (const why of ['stopped', 'replaced', 'stalled', 'run-timeout', 'mode']) assert.equal(liveEndsChoice(why), true, why);
    for (const why of ['offscreen', 'page', 'hidden', 'gone', 'setting', 'switch']) assert.equal(liveEndsChoice(why), false, why);
    assert.deepEqual(LIVE_MODES.slice(), ['html', 'three', 'p5'], 'SVG and markdown have nothing to interact with');
  });

  test('L1-3: Undo and Redo keep the PRESENT’s Live choice (view state, like the zoom) and stale nothing for it', () => {
    assert.deepEqual(VIEW_SETTINGS.slice(), ['live']);
    const box = (id, x, live, extra = {}) => ({
      id, type: 'preview', x, y: 0, w: 380, h: 500, state: 'done', value: null,
      settings: { mode: 'p5', source: `// ${id}`, live }, ...extra,
    });
    // The snapshot is from before a move of A — and before B took Live over from A.
    const snap = { id: 'g', rev: 3, title: 't', view: { x: 0, y: 0, zoom: 1 }, parts: [box('a', 0, true), box('b', 400, false)], wires: [] };
    const now = { ...snap, rev: 9, parts: [box('a', 40, false), box('b', 400, true)] };
    const back = restoreProgram(now, snap, { now: () => 1 });
    const a = back.parts.find((p) => p.id === 'a');
    const b = back.parts.find((p) => p.id === 'b');
    assert.equal(a.x, 0, 'the move is taken back');
    assert.deepEqual([a.settings.live, b.settings.live], [false, true], 'the Live choice is the present’s: B stays live, A stays off');
    assert.deepEqual([a.state, b.state], ['done', 'done'], 'and a Live difference marks nothing stale');
    // An undone DELETE brings the box back as it was, Live choice included.
    const gone = { ...now, parts: [box('a', 40, false)] };
    const again = restoreProgram(gone, now, { now: () => 1 });
    assert.equal(again.parts.find((p) => p.id === 'b').settings.live, true, 'a box brought back keeps its own choice');
    // An import is the whole file coming back out.
    const file = restoreProgram(now, snap, { label: 'import', now: () => 1 });
    assert.equal(file.parts.find((p) => p.id === 'a').settings.live, true);
    // A real settings change still stales.
    const edited = { ...now, parts: [box('a', 40, false), { ...box('b', 400, true), settings: { mode: 'p5', source: '// edited', live: true } }] };
    const undone = restoreProgram(edited, now, { now: () => 1 });
    assert.equal(undone.parts.find((p) => p.id === 'b').state, 'stale', 'undoing a code edit still stales the box');
    assert.equal(undone.parts.find((p) => p.id === 'b').settings.live, true);
  });
};
