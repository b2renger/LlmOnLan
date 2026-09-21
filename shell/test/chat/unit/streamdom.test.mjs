// render/stream-dom.mjs — the streaming DOM diff (P1-U3). Runs on the chat-unit DOM shim, which is
// the whole point of the injected H: the diff is provable in Node, without Electron.
//
// The three things this file proves (plan §4 P1-U3 acceptance):
//   1. for every perf/*.md and stream.md, chunked randomly, the FINAL DOM equals
//      renderBlocks(parseBlocks(text)) — serialised, byte for byte;
//   2. a COMMITTED block's node is created once and is the same object for the rest of the stream
//      (checked with an expando on the shim node, which no renderer code ever touches);
//   3. the open fence's <code> text node is the same object across feeds (appendData, not rebuild).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlocks, createStreamParser } from '../../../renderer/chat/render/md-block.mjs';
import { domFactory, renderBlocks } from '../../../renderer/chat/render/dom.mjs';
import { createStreamRenderer } from '../../../renderer/chat/render/stream-dom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', 'fixtures', 'md');
const read = (p) => fs.readFileSync(path.join(FIX, p), 'utf8').replace(/\r\n/g, '\n');

const doc = () => /** @type {any} */ (globalThis).__chatTestDom;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The one-shot render of `text`, serialised. */
function oneShot(text, opts) {
  const d = doc();
  const H = domFactory(d);
  const host = d.createElement('div');
  host.appendChild(renderBlocks(parseBlocks(text), H, opts));
  return d.serialize(host);
}

/**
 * Stream `text` in `next()`-sized pieces through the parser + renderer.
 * @param {string} text
 * @param {() => number} next chunk size
 * @param {{opts?: any, onFeed?: (info: any) => void}} [o]
 */
function streamInto(text, next, o = {}) {
  const d = doc();
  const H = domFactory(d);
  const host = d.createElement('div');
  const parser = createStreamParser();
  const r = createStreamRenderer(H, host, o.opts || {});
  let at = 0;
  while (at < text.length) {
    at = Math.min(text.length, at + Math.max(1, next()));
    const state = parser.feed(text.slice(0, at));
    r.update(state);
    if (o.onFeed) o.onFeed({ host, state, renderer: r, at });
  }
  const swapped = r.finish(parser.end(text));
  return { host, renderer: r, doc: d, swapped, serialize: () => d.serialize(host) };
}

const FIXTURES = [
  'stream.md',
  'perf/mixed.md',
  'perf/list-500.md',
  'perf/table-300.md',
  'perf/paragraph-20k.md',
  'perf/nested-fence.md',
  'perf/reasoning-40k.md',
];

export default (test) => {
  test('the DOM shim is available', () => {
    assert.ok(doc(), 'chat-unit.js provides globalThis.__chatTestDom');
  });

  // --------------------------------------------------------------- 1. the final DOM is the truth
  for (const name of FIXTURES) {
    test(`${name}: the streamed DOM equals renderBlocks(parseBlocks(text))`, () => {
      const text = read(name);
      const want = oneShot(text, {});
      for (const seed of [1, 7, 4242]) {
        const rnd = mulberry32(seed);
        // 1..12 chars per feed, the shape the mock streams markdown in
        const got = streamInto(text, () => 1 + Math.floor(rnd() * 12));
        assert.equal(got.serialize(), want, `${name}: seed ${seed} diverged from the one-shot render`);
      }
      // …and the degenerate chunkings: one character at a time, and the whole text at once
      assert.equal(streamInto(text, () => 1).serialize(), want, `${name}: 1-char chunks diverged`);
      assert.equal(streamInto(text, () => text.length).serialize(), want, `${name}: one-shot feed diverged`);
    }, { timeoutMs: 60000 });
  }

  test('citations resolve identically in both paths', () => {
    const text = read('stream.md');
    const cites = { 2: { url: 'https://example.com/two', title: 'Two' } };
    const opts = { citations: (n) => cites[n] || null };
    const want = oneShot(text, opts);
    const rnd = mulberry32(99);
    const got = streamInto(text, () => 1 + Math.floor(rnd() * 9), { opts });
    assert.equal(got.serialize(), want);
    assert.ok(want.includes('https://example.com/two'), 'the resolved citation really made it into the DOM');
  });

  // --------------------------------------------------- 2. committed nodes keep their identity
  test('a committed block node is created once and never replaced', () => {
    for (const name of ['stream.md', 'perf/mixed.md', 'perf/table-300.md']) {
      const text = read(name);
      const rnd = mulberry32(5);
      /** @type {any[]} */ const seen = [];
      let committedAtLastFeed = 0;
      let checks = 0;
      streamInto(text, () => 1 + Math.floor(rnd() * 6), {
        onFeed: ({ host, state }) => {
          const nodes = host.childNodes;
          for (let i = 0; i < committedAtLastFeed; i++) {
            assert.equal(nodes[i], seen[i], `${name}: committed block ${i} was replaced mid-stream`);
            checks++;
          }
          for (let i = 0; i < nodes.length; i++) seen[i] = nodes[i];
          committedAtLastFeed = state.committed.length;
        },
      });
      assert.ok(checks > 50, `${name}: the identity check barely ran (${checks})`);
    }
  });

  test('an expando survives on every committed node (no silent rebuild)', () => {
    const text = read('perf/mixed.md');
    const rnd = mulberry32(11);
    let stamped = 0;
    const out = streamInto(text, () => 2 + Math.floor(rnd() * 5), {
      onFeed: ({ host, state }) => {
        for (let i = 0; i < state.committed.length; i++) {
          const n = host.childNodes[i];
          if (n && n.__streamMark === undefined) { n.__streamMark = ++stamped; }
        }
      },
    });
    assert.ok(stamped > 10, `only ${stamped} blocks were ever committed`);
    let kept = 0;
    for (const n of out.host.childNodes) if (n.__streamMark !== undefined) kept++;
    // finish() may legitimately re-render the LAST block (the one the final partial line lands in);
    // everything before it must still carry its mark.
    assert.ok(kept >= stamped - 1, `${kept} of ${stamped} marked nodes survived to the end`);
  });

  // ------------------------------------------------------- 3. the open fence grows one text node
  test('the open fence text node is the same object across feeds, and grows', () => {
    const text = [
      'before',
      '',
      '```js',
      ...Array.from({ length: 40 }, (_, i) => `const line${i} = ${i};`),
      '```',
      '',
      'after',
      '',
    ].join('\n');
    // The <figure> IS legitimately replaced while the info string is still arriving ("```j" is a
    // different language from "```js"), so tracking starts at the first fence that has CONTENT —
    // from there on the block is settled and the text node must never be rebuilt.
    /** @type {any} */ let node = null;
    let feeds = 0;
    /** @type {number[]} */ const lengths = [];
    const out = streamInto(text, () => 3, {
      onFeed: ({ host }) => {
        const code = host.querySelector('figure.chat-codeblock code');
        const t = code && code.firstChild;
        if (!t || !t.length) return;
        if (node === null) { node = t; node.__fenceMark = 'first'; return; }
        assert.equal(t, node, 'the open fence text node was replaced');
        feeds++;
        lengths.push(t.length);
      },
    });
    assert.ok(feeds > 100, `the fence was only observed ${feeds} times`);
    for (let i = 1; i < lengths.length; i++) {
      assert.ok(lengths[i] >= lengths[i - 1], 'the fence text shrank mid-stream');
    }
    const finalText = out.host.querySelector('figure.chat-codeblock code').firstChild;
    assert.equal(finalText.__fenceMark, 'first', 'finish() rebuilt a fence that had not changed');
    assert.ok(finalText.data.includes('const line39 = 39;'), 'the whole fence is there');
  });

  // --------------------------------------------------------------------- the block-ready callback
  test('onBlockReady fires for closed fences only, and once per node before finish', () => {
    const text = read('stream.md');
    const d = doc();
    const H = domFactory(d);
    const host = d.createElement('div');
    const parser = createStreamParser();
    /** @type {any[]} */ const calls = [];
    const r = createStreamRenderer(H, host, {
      onBlockReady: (node, block, info) => calls.push({ node, lang: block.lang, closed: block.closed, final: info.final }),
    });
    for (let at = 0; at < text.length; at += 7) {
      r.update(parser.feed(text.slice(0, Math.min(text.length, at + 7))));
    }
    const duringStream = calls.slice();
    assert.ok(duringStream.length >= 3, `only ${duringStream.length} fences closed during the stream`);
    for (const c of duringStream) {
      assert.equal(c.final, false);
      assert.equal(c.closed, true, 'an OPEN fence was announced as ready');
    }
    const seen = new Set(duringStream.map((c) => c.node));
    assert.equal(seen.size, duringStream.length, 'the same fence was announced twice while streaming');

    r.finish(parser.end(text));
    const atFinish = calls.slice(duringStream.length);
    assert.ok(atFinish.length >= duringStream.length, 'finish() did not re-offer every code block');
    for (const c of atFinish) assert.equal(c.final, true);
    const langs = atFinish.map((c) => c.lang).sort();
    assert.deepEqual(langs, ['js', 'python', 'python', 'svg'], 'the fences of stream.md, by language');
  });

  // ------------------------------------------------------------------------------ finish() swaps
  test('finish() reports a swap only when the one-shot parse differs', () => {
    const d = doc();
    const H = domFactory(d);
    // text ending on a newline: the last line is already applied, so finish() changes nothing
    const settled = 'one\n\ntwo\n';
    {
      const host = d.createElement('div');
      const p = createStreamParser();
      const r = createStreamRenderer(H, host, {});
      r.update(p.feed(settled));
      assert.equal(r.finish(p.end(settled)), false, 'finish() swapped a DOM that was already right');
      assert.equal(d.serialize(host), oneShot(settled, {}));
    }
    // text whose last line is still partial when the stream ends, and which the final applyLine
    // turns into something else entirely (a table): finish() MUST swap
    const turns = 'a | b\n--- | ---\n1 | 2';
    {
      const host = d.createElement('div');
      const p = createStreamParser();
      const r = createStreamRenderer(H, host, {});
      r.update(p.feed(turns));
      assert.equal(r.finish(p.end(turns)), true, 'finish() left a stale DOM in place');
      assert.equal(d.serialize(host), oneShot(turns, {}));
    }
  });

  test('replaceAll() resyncs from blocks', () => {
    const d = doc();
    const H = domFactory(d);
    const host = d.createElement('div');
    const r = createStreamRenderer(H, host, {});
    const p = createStreamParser();
    r.update(p.feed('half a thought'));
    r.replaceAll(parseBlocks('# other\n\nbody\n'));
    assert.equal(d.serialize(host), oneShot('# other\n\nbody\n', {}));
  });

  // ------------------------------------------------------------------------------- work per feed
  test('per-feed DOM work stays bounded (no quadratic rebuild)', () => {
    const text = read('perf/paragraph-20k.md');
    const d = doc();
    const H = domFactory(d);
    const host = d.createElement('div');
    const parser = createStreamParser();
    let created = 0;
    // Count every element the renderer creates by wrapping the factory's document.
    const counting = Object.create(d);
    counting.createElement = (tag) => { created++; return d.createElement(tag); };
    counting.createTextNode = (s) => { created++; return d.createTextNode(s); };
    counting.createDocumentFragment = () => d.createDocumentFragment();
    const H2 = domFactory(counting);
    void H;
    const r = createStreamRenderer(H2, host, {});
    let feeds = 0;
    for (let at = 0; at < text.length; at += 5) {
      r.update(parser.feed(text.slice(0, Math.min(text.length, at + 5))));
      feeds++;
    }
    r.finish(parser.end(text));
    // A rebuild-every-frame renderer would create O(text) nodes per feed. The diff creates a
    // bounded tail: well under 10 nodes per feed on a 20k-character paragraph.
    assert.ok(created < feeds * 10, `${created} nodes for ${feeds} feeds is not a diff`);
    assert.equal(d.serialize(host), oneShot(text, {}));
  }, { timeoutMs: 30000 });
};
