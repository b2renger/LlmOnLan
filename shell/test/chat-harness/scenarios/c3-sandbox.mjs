// @ts-check
// C3-U1 in the real browser: the sandbox surface itself (studio plan §3.7, docs/LOLCHAT_COMPUTER_SPEC
// §8 step 4). These are the LOAD-BEARING SECURITY ASSERTIONS of the release — everything else in the
// Computer assumes them. A unit test cannot make any of them: they are facts about Chromium's
// enforcement of an opaque origin and of the runner's own CSP, so they have to be measured in a real
// window, under the real shipping renderer CSP, with the real iframe.
//
// What each scenario proves:
//   c3-sandbox-isolation  the guest cannot reach the network (not even the mock farm on loopback),
//                         the disk, storage, the parent DOM or the preload — every probe blocked,
//                         and the mock's own request log stays empty.
//   c3-sandbox-hang       `while (true) {}` does not stall the client: the host keeps painting,
//                         the watchdog reports the stall honestly, and the sandbox comes back.
//   c3-sandbox-navigate   the guest cannot navigate itself or open a window; the main-process veto
//                         records the attempt and the frame is still our runner afterwards.
//   c3-sandbox-lifecycle  one iframe, ever; hide() keeps it through its grace then drops it;
//                         destroy() leaves nothing behind.
//   c3-sandbox-errors     console output and thrown errors come back with LINE NUMBERS and with
//                         every file:/blob: path scrubbed, rate-limited so a loop cannot flood.
//   c3-sandbox-libs       the vendored three.js / p5.js / matter.js really evaluate in the guest,
//                         a p5 sketch paints, and a snapshot comes back as a PNG.
//
// The sandbox is driven DIRECTLY here (the scenario imports sandbox/host.mjs in the page) rather
// than through the Computer's parts: this unit ships the surface, and the parts that use it are
// other units' scenarios.

/** Open a sandbox in the page and keep it at window.__c3. */
const open = (/** @type {any} */ h, /** @type {object} */ opts) => h.eval(async (o) => {
    const mod = await import('../../renderer/chat/sandbox/host.mjs');
    const mount = document.createElement('div');
    mount.className = 'sandbox-mount';
    document.body.appendChild(mount);
    const sb = mod.createSandbox(o || {});
    sb.mount(mount);
    /** @type {any[]} */ const events = [];
    sb.on((ev) => events.push(ev));
    /** @type {any} */ (window).__c3 = { sb, mount, events, mod };
    const ok = await sb.ready();
    return { ok, state: sb.state(), iframes: document.querySelectorAll('iframe').length };
}, opts || {});

/** Tear it down, whatever happened. */
const close = (/** @type {any} */ h) => h.eval(() => {
    const c3 = /** @type {any} */ (window).__c3;
    if (!c3) return false;
    try { c3.sb.destroy(); } catch (e) { /* already gone */ }
    try { c3.mount.remove(); } catch (e) { /* already gone */ }
    delete (/** @type {any} */ (window).__c3);
    return true;
});

/** One `compute` in the live guest. */
const compute = (/** @type {any} */ h, /** @type {string} */ code, /** @type {object} */ inputs, /** @type {object} */ req) =>
    h.eval((c, i, r) => /** @type {any} */ (window).__c3.sb.compute({ code: c, inputs: i, ...(r || {}) }), code, inputs || {}, req || {});

/** Compute, but allow for the guest having just been torn down: a call that lands on a dying
 * frame is reported as a stall (correctly), and the sandbox is usable again on the next one. This
 * is exactly what a human pressing Run twice sees, so the test asks the same way. */
const computeWhenBack = async (/** @type {any} */ h, /** @type {string} */ code, tries = 3) => {
    let out = { ok: false, error: { message: 'never ran' } };
    for (let i = 0; i < tries; i++) {
        out = await compute(h, code, {});
        if (out.ok) return { out, attempts: i + 1 };
        await h.eval(() => new Promise((r) => setTimeout(r, 400)));
    }
    return { out, attempts: tries };
};

/** What the host has emitted so far. */
const events = (/** @type {any} */ h) => h.eval(() => /** @type {any} */ (window).__c3.events.map((e) => ({ type: e.type, state: e.state, text: e.text, why: e.why })));

// ---- the probe the guest runs -----------------------------------------------------------------
// One string, so what the sandbox is asked to do is readable in one place. Every reach answers
// "blocked:<reason>" or "allowed:<what came back>" — a probe that throws nothing and returns
// nothing would otherwise read as a pass.
const REACH_PROBE = `
const out = {};
const sync = (k, fn) => { try { out[k] = 'allowed:' + String(fn()).slice(0, 60); } catch (e) { out[k] = 'blocked:' + (e && e.name ? e.name : String(e)); } };
const later = (k, p) => p.then((v) => { out[k] = 'allowed:' + String(v).slice(0, 60); }, (e) => { out[k] = 'blocked:' + (e && e.name ? e.name : String(e)); });
const race = (p, label) => Promise.race([p, new Promise((res) => setTimeout(() => res(label), 1500))]);
const url = 'http://127.0.0.1:' + inputs.port + '/mock/health';
const file = inputs.file;

sync('localStorage', () => { localStorage.setItem('lol', '1'); return localStorage.getItem('lol'); });
sync('sessionStorage', () => { sessionStorage.setItem('lol', '1'); return sessionStorage.getItem('lol'); });
sync('indexedDB', () => indexedDB.open('lol'));
sync('cookie', () => { document.cookie = 'lol=1'; return document.cookie || '(empty)'; });
sync('parentDom', () => parent.document.title);
sync('parentLol', () => parent.lol.projects.root);
sync('topLocation', () => top.location.href);
sync('ownLol', () => { if (typeof window.lol === 'undefined') throw new Error('absent'); return 'present'; });

const waits = [
  later('fetchFarm', race(fetch(url).then((r) => 'status ' + r.status), 'blocked:timeout')),
  later('fetchFile', race(fetch(file).then((r) => r.text()).then((t) => t.slice(0, 20)), 'blocked:timeout')),
  later('xhr', new Promise((res, rej) => {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', url);
      x.onload = () => res('status ' + x.status);
      x.onerror = () => rej(new Error('XhrBlocked'));
      x.send();
      setTimeout(() => rej(new Error('XhrTimeout')), 1500);
    } catch (e) { rej(e); }
  })),
  later('imgFromDisk', new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res('loaded ' + img.width);
    img.onerror = () => rej(new Error('ImgBlocked'));
    img.src = file;
    setTimeout(() => rej(new Error('ImgTimeout')), 1500);
  })),
  later('websocket', new Promise((res, rej) => {
    // Chromium does not throw here; the CSP verdict arrives as the socket failing to open, and
    // "it never opened" is the property that matters — no byte leaves the guest.
    let w = null;
    try { w = new WebSocket('ws://127.0.0.1:' + inputs.port); } catch (e) { rej(e); return; }
    w.onopen = () => res('open');
    w.onerror = () => rej(new Error('SocketBlocked'));
    w.onclose = () => rej(new Error('SocketClosed'));
    setTimeout(() => rej(new Error('SocketNeverOpened')), 1500);
  })),
  later('scriptFromDisk', new Promise((res, rej) => {
    const s = document.createElement('script');
    s.onload = () => res('ran');
    s.onerror = () => rej(new Error('ScriptBlocked'));
    s.src = file;
    document.head.appendChild(s);
    setTimeout(() => rej(new Error('ScriptTimeout')), 1500);
  })),
];
return Promise.all(waits).then(() => out);
`;

const NAV_PROBE = `
const out = {};
const sync = (k, fn) => { try { out[k] = 'allowed:' + String(fn()).slice(0, 60); } catch (e) { out[k] = 'blocked:' + (e && e.name ? e.name : String(e)); } };
sync('assign', () => { location.href = 'https://example.com/'; return 'assigned'; });
sync('topNav', () => { top.location.href = 'https://example.com/'; return 'assigned'; });
sync('open', () => { const w = window.open('https://example.com/'); return w ? 'opened' : 'null'; });
sync('iframe', () => { const f = document.createElement('iframe'); f.src = 'https://example.com/'; document.body.appendChild(f); return 'appended'; });
sync('form', () => { const f = document.createElement('form'); f.action = 'https://example.com/'; f.method = 'POST'; document.body.appendChild(f); f.submit(); return 'submitted'; });
// Returned SYNCHRONOUSLY: a navigation that did commit would take this document (and this answer)
// with it, and then the only evidence left would be the host's watchdog and the main process.
return out;
`;

/** Noise the probes MAKE ON PURPOSE. A blocked load is the result under test, not a defect: the
 * renderer's own CSP reporting the refusal is exactly the evidence these scenarios are collecting.
 * Anything not matched here still fails the run. */
const BLOCKED_NOISE = [
    /Content Security Policy/i,
    /Failed to load resource/i,
    /net::ERR_/,
    /Refused to/i,
    /ERR_BLOCKED_BY_/,
];

export default [
    {
        name: 'c3-sandbox-isolation',
        allowConsoleErrors: BLOCKED_NOISE,
        needsMock: true,
        run: async (/** @type {any} */ h) => {
            const opened = await open(h, {});
            h.eq(opened.ok, true, 'the sandbox booted');
            h.eq(opened.iframes, 1, 'exactly one iframe in the page');

            const before = (await h.mock.log({})).length;
            const out = await compute(h, REACH_PROBE, { port: h.ports.services, file: 'file:///C:/Windows/win.ini' }, { timeoutMs: 8000 });
            h.assert(out.ok, `the probe itself failed to run: ${out.error && out.error.message}`);
            const reach = JSON.parse(out.json);
            h.note(`reach: ${Object.entries(reach).map(([k, v]) => `${k}=${v}`).join(' ')}`);

            for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'parentDom', 'parentLol', 'topLocation', 'ownLol', 'websocket', 'fetchFarm', 'fetchFile', 'xhr', 'imgFromDisk', 'scriptFromDisk']) {
                h.assert(String(reach[key] || '').startsWith('blocked:'), `the guest REACHED ${key}: ${reach[key]}`);
            }

            const after = await h.mock.log({});
            h.eq(after.length, before, 'the mock farm saw no request from the guest');
            await close(h);
        },
    },

    {
        name: 'c3-sandbox-hang',
        // The release gate (vision §9): a generated infinite loop must cost the user a message,
        // never the client. The opaque origin gives the guest its own process; the watchdog is what
        // turns "it is gone" into a sentence and a working sandbox again.
        run: async (/** @type {any} */ h) => {
            h.eq((await open(h, {})).ok, true);

            // Start measuring the host's own frame budget, then set the guest spinning.
            await h.eval(() => {
                const w = /** @type {any} */ (window);
                w.__c3gap = { max: 0, frames: 0, last: performance.now(), stop: false };
                const tick = () => {
                    const now = performance.now();
                    w.__c3gap.max = Math.max(w.__c3gap.max, now - w.__c3gap.last);
                    w.__c3gap.last = now;
                    w.__c3gap.frames++;
                    if (!w.__c3gap.stop) requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
                w.__c3hang = w.__c3.sb.run({ kind: 'canvas', code: 'for (;;) { Math.sqrt(9); }' });
                return true;
            });

            const out = await h.eval(() => /** @type {any} */ (window).__c3hang, { timeout: 20000 });
            const gap = await h.eval(() => {
                const w = /** @type {any} */ (window);
                w.__c3gap.stop = true;
                return { max: Math.round(w.__c3gap.max), frames: w.__c3gap.frames };
            });
            h.note(`host kept painting: ${gap.frames} frames, worst gap ${gap.max} ms while the guest looped`);

            h.eq(out.ok, false, 'the runaway sketch reported failure');
            h.assert(/time/i.test(out.error.message), `the reason names the timeout, got: ${out.error.message}`);
            h.assert(gap.frames > 20, `the host stopped painting (${gap.frames} frames) — the guest was NOT in its own process`);
            h.assert(gap.max < 1500, `the host froze for ${gap.max} ms while the guest looped`);

            const rows = await events(h);
            h.assert(rows.some((r) => r.type === 'state' && r.state === 'stalled'), 'the host went through the stalled state');
            h.assert(rows.some((r) => r.type === 'note' && /restart/i.test(r.text || '')), 'the reader gets one row saying the preview was restarted');

            // And it came back: the rebuilt guest computes normally.
            const back = await computeWhenBack(h, 'return 2 + 2;');
            h.assert(back.out.ok, `the sandbox never came back after the rebuild: ${back.out.error && back.out.error.message}`);
            h.eq(JSON.parse(back.out.json), 4, 'and it computes correctly again');
            h.note(`usable again after ${back.attempts} attempt(s); ${JSON.stringify(await h.eval(() => /** @type {any} */ (window).__c3.sb.debug()))}`);
            await close(h);
        },
    },

    {
        name: 'c3-sandbox-navigate',
        allowConsoleErrors: BLOCKED_NOISE,
        run: async (/** @type {any} */ h) => {
            h.eq((await open(h, {})).ok, true);
            const before = (await h.windowOpens()).length;

            const out = await compute(h, NAV_PROBE, {}, { timeoutMs: 8000 });
            /** @type {any} */ let nav = null;
            if (out.ok) {
                nav = JSON.parse(out.json);
                h.note(`nav: ${Object.entries(nav).map(([k, v]) => `${k}=${v}`).join(' ')}`);
                h.assert(String(nav.topNav).startsWith('blocked:'), `the guest reached top.location: ${nav.topNav}`);
                h.assert(nav.open === 'allowed:null' || String(nav.open).startsWith('blocked:'), `window.open gave the guest a window: ${nav.open}`);
            } else {
                // Also a pass, and the honest one: the guest tore ITSELF down trying, and the host
                // said so instead of hanging. What must never happen is a guest that navigates
                // somewhere else and keeps talking.
                h.note(`the guest did not survive its own navigation attempt: ${out.error && out.error.message}`);
                h.assert(/time|restart/i.test(String(out.error && out.error.message)), 'the caller was told what happened');
            }

            // Whatever it tried, what answers on the protocol afterwards is OUR runner — either the
            // same guest (nothing navigated) or a freshly booted one, never example.com.
            const alive = await computeWhenBack(h, 'return "still here";');
            h.assert(alive.out.ok, `the sandbox never came back: ${alive.out.error && alive.out.error.message}`);
            h.eq(JSON.parse(alive.out.json), 'still here', 'and what answers is our runner, speaking the protocol');
            h.note(`usable again after ${alive.attempts} attempt(s)`);

            // The app window itself never moved, and the main process opened nothing.
            h.eq(await h.eval(() => location.href.includes('page.html')), true, 'the app window stayed where it was');
            const fresh = (await h.windowOpens()).slice(before);
            for (const row of fresh) h.eq(row.action, 'dropped', `the main process let ${row.url} through`);
            h.note(`main process recorded ${fresh.length} attempt(s), all dropped; the frame's own CSP refuses the rest before the veto ever sees them`);
            await close(h);
        },
    },

    {
        name: 'c3-sandbox-lifecycle',
        run: async (/** @type {any} */ h) => {
            h.eq((await open(h, { timeouts: { hideGrace: 700 } })).ok, true);
            await compute(h, 'return 1;', {});

            // The frame has to be LAID OUT to rasterise, so .sandbox-mount parks it 20 000 px to
            // the left at a real size. That must not give the page a sideways scrollbar.
            const box = await h.eval(() => ({
                scrollW: document.documentElement.scrollWidth,
                clientW: document.documentElement.clientWidth,
                w: Math.round(document.querySelector('.sandbox-mount').getBoundingClientRect().width),
            }));
            h.assert(box.w > 0, 'the mount has no size, so nothing could ever be photographed');
            h.assert(box.scrollW <= box.clientW, `the off-screen mount made the page scroll sideways (${box.scrollW} > ${box.clientW})`);
            h.eq(await h.eval(() => document.querySelectorAll('iframe').length), 1, 'one iframe while it runs');

            // hide() suspends but keeps the frame through its grace, so flipping panels is free.
            await h.eval(() => { /** @type {any} */ (window).__c3.sb.hide(); return true; });
            h.eq(await h.eval(() => document.querySelectorAll('iframe').length), 1, 'still there during the grace period');
            h.eq(await h.eval(() => /** @type {any} */ (window).__c3.sb.ready()), true, 'coming back inside the grace reuses it');
            h.eq(await h.eval(() => document.querySelectorAll('iframe').length), 1, 'and did NOT build a second one');

            // Left hidden, the guest process goes away.
            await h.eval(() => { /** @type {any} */ (window).__c3.sb.hide(); return true; });
            await h.waitFor(() => (document.querySelectorAll('iframe').length === 0 ? true : null), { timeout: 5000 });
            h.eq(await h.eval(() => /** @type {any} */ (window).__c3.sb.state()), 'idle', 'a hidden sandbox ends up idle, not disabled');

            // destroy() leaves nothing: no frame, no mount content, and no further work accepted.
            await h.eval(async () => {
                const c3 = /** @type {any} */ (window).__c3;
                await c3.sb.ready();
                c3.sb.destroy();
                return true;
            });
            h.eq(await h.eval(() => document.querySelectorAll('iframe').length), 0, 'destroy() removed the iframe');
            const after = await compute(h, 'return 1;', {});
            h.eq(after.ok, false, 'a destroyed sandbox runs nothing');
            h.eq(await h.eval(() => /** @type {any} */ (window).__c3.sb.debug().framed), false);
            await close(h);
        },
    },

    {
        name: 'c3-sandbox-errors',
        allowConsoleErrors: BLOCKED_NOISE,
        run: async (/** @type {any} */ h) => {
            h.eq((await open(h, {})).ok, true);

            // A sketch that throws on its THIRD line reports line 3 — the free-repair loop (V3)
            // needs a real line number, not "somewhere in your code".
            const thrown = await h.eval(() => /** @type {any} */ (window).__c3.sb.run({
                kind: 'dom',
                code: 'const a = 1;\nconst b = 2;\nthrow new Error("kaboom");\n',
            }));
            h.eq(thrown.ok, false, 'the failing sketch reported failure');
            h.eq(thrown.error.message, 'kaboom');
            h.eq(thrown.error.line, 3, `the error names the line the human wrote it on (got ${thrown.error.line})`);
            h.assert(!/file:|blob:/.test(thrown.error.stack), `a path leaked into the stack: ${thrown.error.stack}`);

            // console output comes back as data, with the level, and rate-limited.
            const logged = await h.eval(async () => {
                const sb = /** @type {any} */ (window).__c3.sb;
                await sb.run({ kind: 'dom', code: 'console.log("hello", {a: 1}); console.warn("careful");' });
                await new Promise((r) => setTimeout(r, 120));
                return sb.logs();
            });
            h.eq(logged.length, 2, `two console calls, two rows (got ${logged.length})`);
            h.eq(logged[0].level, 'log');
            h.assert(/hello/.test(logged[0].text) && /a: 1/.test(logged[0].text), `the object was stringified in the guest: ${logged[0].text}`);
            h.eq(logged[1].level, 'warn');

            await h.eval(() => /** @type {any} */ (window).__c3.sb.run({ kind: 'dom', code: 'for (let i = 0; i < 400; i++) console.log("row " + i);' }));
            await h.waitFor(() => (/** @type {any} */ (window).__c3.sb.logs().length >= 200 ? true : null), { timeout: 5000 });
            await h.eval(() => new Promise((r) => setTimeout(r, 200)));
            const flood = await h.eval(() => /** @type {any} */ (window).__c3.sb.logs().length);
            h.eq(flood, 200, `400 console lines are capped at maxLogs, and the cap HOLDS (got ${flood})`);

            // An asynchronous failure still finds its way home, after `ran` already said ok — the
            // repair loop needs the throw from inside a timer as much as the one at set-up time.
            const late = await h.eval(() => /** @type {any} */ (window).__c3.sb.run({
                kind: 'dom', code: 'setTimeout(() => { throw new Error("late"); }, 10);',
            }));
            h.eq(late.ok, true, 'the sketch itself set up cleanly');
            const async = await h.waitFor(() => {
                const rows = /** @type {any} */ (window).__c3.sb.errors().map((e) => ({ phase: e.phase, message: e.message }));
                return rows.some((r) => /late/.test(r.message)) ? rows : null;
            }, { timeout: 8000 });
            h.eq(async[0].phase, 'runtime', 'and it is reported as what it was: a runtime error');
            await close(h);
        },
    },

    {
        name: 'c3-sandbox-libs',
        allowConsoleErrors: BLOCKED_NOISE,
        run: async (/** @type {any} */ h) => {
            h.eq((await open(h, {})).ok, true);

            // The three vendored builds really evaluate inside the guest and define their globals.
            const libs = await h.eval(async () => {
                const sb = /** @type {any} */ (window).__c3.sb;
                const out = await sb.run({
                    kind: 'dom',
                    libs: ['three', 'p5', 'matter'],
                    code: 'return null;',
                });
                const probe = await sb.compute({
                    code: 'return {three: typeof THREE, p5: typeof p5, matter: typeof Matter, rev: (typeof THREE === "object" && THREE.REVISION) || null};',
                });
                return { ok: out.ok, probe: probe.ok ? JSON.parse(probe.json) : null, debug: sb.debug().libs };
            }, { timeout: 30000 });
            h.eq(libs.ok, true, 'the sketch ran with the libraries loaded');
            h.eq(libs.probe.three, 'object', 'three.js defined THREE in the guest');
            h.eq(libs.probe.p5, 'function', 'p5.js defined p5 in the guest');
            h.eq(libs.probe.matter, 'object', 'matter.js defined Matter in the guest');
            h.note(`vendored: three r${libs.probe.rev}, p5 + matter loaded; host verdicts ${JSON.stringify(libs.debug)}`);
            for (const row of libs.debug) h.eq(row.ok, true, `${row.name} failed to evaluate: ${row.error}`);

            // A real p5 sketch paints, and the snapshot comes back as a PNG of bounded size.
            const shot = await h.eval(async () => {
                const sb = /** @type {any} */ (window).__c3.sb;
                const ran = await sb.run({
                    kind: 'p5',
                    libs: ['p5'],
                    code: 'return function (p) { p.setup = function () { p.createCanvas(200, 120); p.background(20); p.noStroke(); p.fill(200); p.rect(20, 20, 60, 40); p.noLoop(); }; };',
                });
                await new Promise((r) => setTimeout(r, 250));
                const png = await sb.snapshot({ maxPx: 128 });
                return { ok: ran.ok, error: ran.error, png: png ? { head: png.dataUrl.slice(0, 22), len: png.dataUrl.length, w: png.w, h: png.h } : null };
            }, { timeout: 30000 });
            h.eq(shot.ok, true, `the p5 sketch ran: ${shot.error && shot.error.message}`);
            h.assert(shot.png, 'the snapshot came back empty — nothing was painted');
            h.eq(shot.png.head, 'data:image/png;base64,');
            h.assert(shot.png.len > 500, `the PNG is suspiciously small (${shot.png.len} chars)`);
            h.assert(Math.max(shot.png.w, shot.png.h) <= 128, `the snapshot ignored maxPx (${shot.png.w}x${shot.png.h})`);
            h.note(`p5 snapshot ${shot.png.w}x${shot.png.h}, ${Math.round(shot.png.len / 1024)} KB of data URL`);

            // p5's OTHER shape: a global-mode sketch, which is what a model writes when it copies
            // an editor.p5js.org example. The guest instantiates p5 against its own root either way.
            const global = await h.eval(async () => {
                const sb = /** @type {any} */ (window).__c3.sb;
                const ran = await sb.run({
                    kind: 'p5',
                    libs: ['p5'],
                    code: 'window.setup = function () { createCanvas(90, 60); background(10); noLoop(); };',
                });
                await new Promise((r) => setTimeout(r, 250));
                const png = await sb.snapshot({ maxPx: 90 });
                return { ok: ran.ok, error: ran.error, painted: !!png, w: png && png.w, h: png && png.h };
            }, { timeout: 30000 });
            h.eq(global.ok, true, `a global-mode p5 sketch ran: ${global.error && global.error.message}`);
            h.assert(global.painted, 'a global-mode p5 sketch painted nothing');
            h.note(`global-mode p5 snapshot ${global.w}x${global.h}`);
            await close(h);
        },
    },
];
