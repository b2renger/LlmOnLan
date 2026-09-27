// @ts-check
// The P1 perf group (P1-U3). Six markdown shapes, each streamed end to end through the real
// composer → controller → thread-view → stream-dom path, three times, with the MEDIAN judged
// (`perf: true`; run.js does the repetition and the median, plan §2.6 G).
//
// What it is defending. LOL Chat's renderer is a DIFF: a committed block is built once, the open
// block is patched. The cheapest way to break that is to make it a rebuild — and a rebuild still
// LOOKS right, so only a timing gate catches it. Each fixture attacks the diff from a different
// side: `mixed` has a 3,000-line fence, `list-500` grows one list forever, `table-300` appends
// rows, `paragraph-20k` re-scans one enormous inline run, `nested-fence` nests fences in list
// items, and `reasoning-40k` pours 40 kB through the plain-text reasoning node.
//
// THE THREE GATES (plan §4 P1-U3):
//   tok/s > 150          the answer is rendered at least as fast as a real farm can produce it;
//   paintStats().p95 < 4 ms   a single paint stays inside a 60 Hz frame budget with room to spare;
//   long-animation-frame entries over 100 ms ≤ 2   nothing janks the window for a tenth of a second.
//
// TWO MEASUREMENT DECISIONS, both deliberate:
//
// 1. The mock is sped up (`state.streamRate`, §2.6 G) from ~400 deltas/s to ~4,800. At the mock's
//    own pace a 36 kB fixture takes 20 s, three runs of six fixtures take six minutes, and — worse —
//    the renderer is never actually pushed: 400 tok/s would pass the gate while doing nothing hard.
//    The boost makes the run ~90 s AND makes the measurement mean something.
//
// 2. `reasoning-40k` is judged on RENDER throughput, not on the stats line. The mock's usage chunk
//    for that model reports the ANSWER's two tokens (the 40 kB are `reasoning_content`, which no
//    OpenAI-compatible usage field counts), so its `.chat-stats` honestly reads "2 tok". The
//    fixture's deltas are 3-6 characters each, so `chars / 4.5` is its token count; every scenario
//    reports both numbers and the judge uses the one that is real for that fixture.

const CHARS_PER_DELTA = 4.5;          // the mock chunks every fixture into 3-6 character deltas
const STREAM_RATE = { tickMs: 5, perTick: 24 };     // ~4,800 deltas/s (the mock's own pace is ~400)

/** Fail loudly if the loader faked the view — a fake view would make every number here a lie. */
const requireRealView = (/** @type {any} */ h) => h.eval(() => {
  const failed = (window.LolChat && window.LolChat.failed) || {};
  if (failed.view) throw new Error(`perf needs the REAL render/thread-view.mjs (loader: ${failed.view.error})`);
  if (!window.LolChat.app.view.debug || !window.LolChat.app.view.debug.paintStats) {
    throw new Error('the view has no debug.paintStats(): nothing to measure');
  }
  return true;
});

/**
 * Stream one fixture and return a flat object of numbers (run.js medians every numeric key).
 * Everything that has to be timed happens INSIDE the page: a CDP round trip is 1-3 ms, which is
 * the same order as the thing being measured.
 */
const measure = (/** @type {any} */ h, /** @type {string} */ model) => h.eval(async (id, CHARS_PER_DELTA) => {
  // Long animation frames, WITH their start time. `buffered: true` used to replay frames the page
  // produced before this measurement (boot, the previous fixture's teardown): five of six fixtures
  // reported one ~1,000 ms LoAF that two probes showed the render path never produced, which left
  // the gate only one slot of real budget while reporting somebody else's jank. Entries are
  // filtered to the generation window below.
  /** @type {{start: number, duration: number}[]} */ const loaf = [];
  let loafSupported = 0;
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) loaf.push({ start: e.startTime, duration: e.duration });
    });
    po.observe({ type: 'long-animation-frame' });
    loafSupported = 1;
  } catch (err) {
    void err;                       // recorded as loafSupported:0 and asserted by the judge
  }

  const app = window.LolChat.app;
  const select = /** @type {any} */ (document.getElementById('chat-model'));
  if (!Array.prototype.some.call(select.options, (o) => o.value === id)) {
    throw new Error(`the picker never offered ${id}: ${Array.prototype.map.call(select.options, (o) => o.value).join(',')}`);
  }
  select.value = id;
  select.dispatchEvent(new Event('change', { bubbles: true }));

  const input = /** @type {any} */ (document.getElementById('chat-input'));
  const form = /** @type {any} */ (document.getElementById('chat-form'));
  const newBtn = document.getElementById('chat-new');
  if (newBtn) newBtn.click();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (setter && setter.set) setter.set.call(input, 'render this as fast as you can'); else input.value = 'render this as fast as you can';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  const t0 = performance.now();
  form.requestSubmit();

  let tStart = 0;
  let tEnd = 0;
  let status = '';
  await new Promise((resolve, reject) => {
    const step = () => {
      const rows = document.querySelectorAll('.chat-msg.assistant');
      const row = rows[rows.length - 1];
      if (row) {
        const st = row.getAttribute('data-status');
        if (st === 'streaming') { if (!tStart) tStart = performance.now(); }
        else if (tStart) { tEnd = performance.now(); status = st; return resolve(undefined); }
      }
      if (performance.now() - t0 > 120000) return reject(new Error('the stream never finished'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  if (status !== 'done') throw new Error(`the stream ended as "${status}", not done`);

  const rows = document.querySelectorAll('.chat-msg.assistant');
  const row = rows[rows.length - 1];
  const body = row.querySelector('.chat-body');
  const reasoning = row.querySelector('.chat-reasoning-body');
  const chars = (body ? body.textContent.length : 0) + (reasoning ? reasoning.textContent.length : 0);
  const statsText = (row.querySelector('.chat-stats') || { textContent: '' }).textContent.trim();
  const tokens = Number((/^(\d+) tok\b/.exec(statsText) || [0, 0])[1]);
  const statsTokPerSec = Number((/·\s*([\d.]+) tok\/s/.exec(statsText) || [0, 0])[1]);
  const ttftMs = Number((/first token ([\d.]+)s/.exec(statsText) || [0, 0])[1]) * 1000;
  const paint = app.view.debug.paintStats();
  // Only the frames of THIS generation, from requestSubmit to the last paint — by OVERLAP, not by
  // start: `t0` is read in the same task that calls requestSubmit(), so the long-animation-frame
  // entry covering the submit itself (user row + assistant placeholder + first paint) always
  // starts before t0 and a `start >= t0` filter dropped the most expensive frame by construction.
  const window_ = loaf.filter((e) => e.start + e.duration >= t0 && e.start <= tEnd);
  // The generation window: from the row appearing to the last paint, minus the wait for token 1.
  const genMs = Math.max(1, (tEnd - tStart) - ttftMs);

  return {
    chars,
    tokens,
    statsTokPerSec,
    renderTokPerSec: (chars / CHARS_PER_DELTA) / (genMs / 1000),
    ttftMs,
    genMs,
    totalMs: tEnd - tStart,
    p50: paint.p50,
    p95: paint.p95,
    paintMax: paint.max,
    paints: paint.count,
    loafSupported,
    loafEntries: window_.length,
    loafOver100: window_.filter((e) => e.duration > 100).length,
    loafMax: window_.length ? Math.max.apply(null, window_.map((e) => e.duration)) : 0,
    blocks: body ? body.childElementCount : 0,
  };
}, model, CHARS_PER_DELTA);

/**
 * @param {string} name the mock-perf fixture
 * @param {{useStats?: boolean, minChars: number, note: string}} o
 */
function fixture(name, o) {
  return {
    name: `perf-render-${name}`,
    perf: true,
    needsMock: true,
    timeoutMs: 180000,
    run: async (h) => {
      // A show:false BrowserWindow has no on-screen surface of its own, so Chromium used to produce
      // no compositor frames for it and requestAnimationFrame fell back to its ~1 Hz idle timer as
      // soon as the page mutated the DOM: 6 paints for a 6-second stream against 96 under --show,
      // i.e. one enormous catch-up paint instead of the frame-by-frame diff this group measures.
      // Since the P1 landing run.js keeps a tiny CDP screencast open, which gives the window a frame
      // CONSUMER and puts the compositor back on the display cadence (61 rAF/s hidden, measured), and
      // this group no longer refuses to run without --show. The real guard is the measured one
      // below: `paints >= 20` fails loudly if a future Electron throttles the window again, instead
      // of reporting a comfortable lie.
      await requireRealView(h);
      await h.mock.state({ streamRate: STREAM_RATE });
      await h.waitFor(() => {
        const s = /** @type {any} */ (document.getElementById('chat-model'));
        return s && s.options.length > 1 ? true : null;
      }, { timeout: 20000 });
      const m = await measure(h, `mock-perf:${name}`);
      h.assert(m.chars >= o.minChars, `${name}: only ${m.chars} characters arrived (want ≥ ${o.minChars}) — the fixture did not stream in full`);
      h.assert(m.paints >= 20, `${name}: only ${m.paints} paints for ${Math.round(m.totalMs)} ms of stream — the renderer never got frames, so nothing here is a measurement`);
      h.note(`${name}: ${m.chars} chars in ${Math.round(m.totalMs)} ms · ${m.statsTokPerSec.toFixed(0)} stats tok/s · ${m.renderTokPerSec.toFixed(0)} render tok/s · p50 ${m.p50.toFixed(2)} ms · p95 ${m.p95.toFixed(2)} ms · ${m.loafOver100} LoAF>100ms (max ${Math.round(m.loafMax)})`);
      return m;
    },
    /** @param {any} med @param {any} h */
    judge: (med, h) => {
      const rate = o.useStats === false ? med.renderTokPerSec : med.statsTokPerSec;
      const which = o.useStats === false ? 'render' : 'stats';
      h.assert(rate > 150, `${name}: ${which} throughput is ${rate.toFixed(1)} tok/s, the parity bar is 150`);
      h.assert(med.p95 < 4, `${name}: paint p95 is ${med.p95.toFixed(2)} ms, the budget is 4 ms`);
      h.eq(med.loafSupported, 1, `${name}: long-animation-frame is not observable here, so the jank gate would be vacuous`);
      h.assert(med.loafOver100 <= 2, `${name}: ${med.loafOver100} long animation frames over 100 ms (at most 2 allowed; longest ${Math.round(med.loafMax)} ms)`);
      h.note(`${name} MEDIAN: ${med.statsTokPerSec.toFixed(0)} stats tok/s · ${med.renderTokPerSec.toFixed(0)} render tok/s · p95 ${med.p95.toFixed(2)} ms · p50 ${med.p50.toFixed(2)} ms · ${med.loafOver100} LoAF>100ms · ${o.note}`);
    },
  };
}

export default [
  // 10k deltas including a 3,000-line fence: the appendData path, at length.
  fixture('mixed', { minChars: 10000, note: 'a 3,000-line fence must grow one text node' }),
  // 500 list items: only the LAST <li> may ever be re-rendered.
  fixture('list-500', { minChars: 30000, note: '500 items, one new <li> per line' }),
  // 300 table rows: each completed row appends one <tr>, the partial row is the only rebuild.
  // `chars` counts RENDERED text, and a table's pipes and delimiter row never reach the DOM, so
  // 16 kB of fixture is ~12 kB of cells. That is why this floor is lower than the file size.
  fixture('table-300', { minChars: 11500, note: '300 rows, one <tr> per line' }),
  // One 20k-character paragraph: the inline stream must commit up to the last safe point.
  fixture('paragraph-20k', { minChars: 18000, note: 'one paragraph, inline commit up to the safe point' }),
  // Fences inside list items inside quotes: the recursive reconcile.
  fixture('nested-fence', { minChars: 8000, note: 'fences nested in list items' }),
  // 40 kB of reasoning: plain text, one text node, appendData — and NO markdown parsing at all.
  fixture('reasoning-40k', {
    minChars: 38000,
    useStats: false,
    note: 'stats say "2 tok" (the answer); the 40 kB are reasoning_content, judged on render throughput',
  }),
];
