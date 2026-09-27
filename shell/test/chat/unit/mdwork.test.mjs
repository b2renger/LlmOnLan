// Streaming work counters for the block parser (P0-U3 acceptance, plan section 3.8).
//
// The budget is what keeps the streaming renderer O(new text): if the parser re-scans its open
// block on every frame, a 20k-char answer is quadratic and the paint budget in perf-render cannot
// be met no matter how good the DOM diff is.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlocks, createStreamParser } from '../../../renderer/chat/render/md-block.mjs';
import { createInlineStream, parseInline, mergeText } from '../../../renderer/chat/render/md-inline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERF = path.join(HERE, '..', 'fixtures', 'md', 'perf');
const EXPECTED = ['mixed', 'list-500', 'table-300', 'paragraph-20k', 'nested-fence', 'reasoning-40k'];

const CHUNK = 4;
const PER_FEED_SLACK = 2100;
const TOTAL_RATIO = 3;
// The 3x TOTAL is CHUNKING-DEPENDENT: the partial-line overlay re-scans the open line on every
// feed, so a long table row costs O(row^2) and the total ratio climbs as the chunks get smaller
// (table-300.md measures 1.43x at 8 chars, 1.80x at 4, 2.54x at 2, 4.02x at 1). The mock streams
// mock-md in 1-12-char chunks, so P1's render gate must use THIS number, not the 4-char one.
// The chunking-INDEPENDENT invariant — the one that actually bounds a frame — is the per-feed
// `scanned <= newChars + PER_FEED_SLACK` below, which holds at every chunk size (worst single
// feed measured: 60 chars of scan for 1 new char).
const FINE_CHUNK = 1;
const FINE_TOTAL_RATIO = 4.5;

function fixtures() {
  return fs.readdirSync(PERF).filter((f) => f.endsWith('.md')).sort()
    .map((f) => [f.replace(/\.md$/, ''), fs.readFileSync(path.join(PERF, f), 'utf8').replace(/\r\n/g, '\n')]);
}

export default (test) => {
  test('the six perf fixtures are committed', () => {
    const names = fixtures().map(([n]) => n);
    for (const want of EXPECTED) assert.ok(names.includes(want), `missing perf fixture ${want}.md`);
    for (const [name, text] of fixtures()) assert.ok(text.length > 5000, `${name} is too small to measure`);
  });

  test('4-char chunks: total scanned <= 3x length, and every feed <= newChars + 2100', () => {
    const report = [];
    for (const [name, text] of fixtures()) {
      const p = createStreamParser();
      let prev = 0;
      let worst = 0;
      let worstAt = -1;
      for (let i = 0; i < text.length; i += CHUNK) {
        const cut = Math.min(text.length, i + CHUNK);
        const before = p.debug.scanned;
        p.feed(text.slice(0, cut));
        const scanned = p.debug.scanned - before;
        const newChars = cut - prev;
        prev = cut;
        if (scanned - newChars > worst) { worst = scanned - newChars; worstAt = cut; }
        assert.ok(scanned <= newChars + PER_FEED_SLACK,
          `${name}: one feed scanned ${scanned} for ${newChars} new chars at offset ${cut}`);
      }
      const blocks = p.end(text);
      assert.deepEqual(blocks, parseBlocks(text), `${name}: the stream disagrees with parseBlocks`);
      const ratio = p.debug.scanned / text.length;
      assert.ok(ratio <= TOTAL_RATIO,
        `${name}: scanned ${p.debug.scanned} for ${text.length} chars (${ratio.toFixed(2)}x)`);
      report.push(`${name} ${ratio.toFixed(2)}x worst-feed-overhead ${worst}@${worstAt}`);
    }
    assert.ok(report.length >= EXPECTED.length, report.join(' | '));
  }, { timeoutMs: 60000 });

  test('1-char chunks: the per-feed bound still holds, and the total stays under 4.5x', () => {
    // The finest streaming a farm can produce (one character per delta). Nothing here may regress
    // into re-scanning the whole block per feed; the numbers in the header are the measured ones.
    const report = [];
    for (const [name, text] of fixtures()) {
      const p = createStreamParser();
      let prev = 0;
      let worst = 0;
      for (let i = 0; i < text.length; i += FINE_CHUNK) {
        const cut = Math.min(text.length, i + FINE_CHUNK);
        const before = p.debug.scanned;
        p.feed(text.slice(0, cut));
        const scanned = p.debug.scanned - before;
        const newChars = cut - prev;
        prev = cut;
        if (scanned - newChars > worst) worst = scanned - newChars;
        assert.ok(scanned <= newChars + PER_FEED_SLACK,
          `${name}: one feed scanned ${scanned} for ${newChars} new char at offset ${cut}`);
      }
      assert.deepEqual(p.end(text), parseBlocks(text), `${name}: the stream disagrees with parseBlocks`);
      const ratio = p.debug.scanned / text.length;
      assert.ok(ratio <= FINE_TOTAL_RATIO,
        `${name}: scanned ${p.debug.scanned} for ${text.length} chars (${ratio.toFixed(2)}x at 1-char chunks)`);
      report.push(`${name} ${ratio.toFixed(2)}x worst-feed-overhead ${worst}`);
    }
    assert.ok(report.length >= EXPECTED.length, report.join(' | '));
  }, { timeoutMs: 120000 });

  test('the budget holds for a single 20k-char line too', () => {
    // A model that never wraps its prose is the worst case for a line-incremental parser.
    const text = 'x'.repeat(20000) + '\n';
    const p = createStreamParser();
    let prev = 0;
    for (let i = 0; i < text.length; i += CHUNK) {
      const cut = Math.min(text.length, i + CHUNK);
      const before = p.debug.scanned;
      p.feed(text.slice(0, cut));
      const scanned = p.debug.scanned - before;
      assert.ok(scanned <= (cut - prev) + PER_FEED_SLACK, `feed at ${cut} scanned ${scanned}`);
      prev = cut;
    }
    assert.ok(p.debug.scanned <= text.length * TOTAL_RATIO, `scanned ${p.debug.scanned}`);
    assert.deepEqual(p.end(text), [{ type: 'paragraph', text: 'x'.repeat(20000) }]);
  });

  test('an ambiguous run stays bounded, for EVERY delimiter (20k-char lines)', () => {
    // hr, table-delimiter AND fence candidacy are each capped at HR_LIMIT, so a line that is one
    // long run resolves to a paragraph in both parsers instead of being re-counted per feed.
    // Only '-' was covered before; the fence characters were uncapped and cost 2,500x the line.
    const report = [];
    for (const ch of ['-', '_', '*', '`', '~']) {
      const text = ch.repeat(20000) + '\n';
      for (const chunk of [CHUNK, FINE_CHUNK]) {
        const p = createStreamParser();
        let prev = 0;
        let worst = 0;
        for (let i = 0; i < text.length; i += chunk) {
          const cut = Math.min(text.length, i + chunk);
          const before = p.debug.scanned;
          p.feed(text.slice(0, cut));
          const over = (p.debug.scanned - before) - (cut - prev);
          if (over > worst) worst = over;
          assert.ok(over <= PER_FEED_SLACK, `${ch} at chunk ${chunk}: feed at ${cut} scanned ${over} extra`);
          prev = cut;
        }
        const blocks = p.end(text);
        assert.deepEqual(blocks, parseBlocks(text), `${ch}: the stream disagrees with parseBlocks`);
        assert.equal(blocks[0].type, 'paragraph', `${ch}: a 20k run must be a paragraph, not a block opener`);
        const limit = chunk === CHUNK ? TOTAL_RATIO : FINE_TOTAL_RATIO;
        const ratio = p.debug.scanned / text.length;
        assert.ok(ratio <= limit, `${ch} at chunk ${chunk}: scanned ${ratio.toFixed(2)}x`);
        report.push(`${ch}@${chunk} ${ratio.toFixed(2)}x/${worst}`);
      }
    }
    assert.equal(report.length, 10, report.join(' '));
  }, { timeoutMs: 60000 });

  test('a 20k-char table cell is split once, not once per feed', () => {
    // debug.scanned used to under-report this shape by ~80x: the open-row branch re-ran
    // indexOf + splitCells over the WHOLE partial row on every feed while billing at most
    // HR_LIMIT for it, so the gate certified a bound the code did not have (1,013 ms of real work
    // reported as 20 characters). The splitter is resumable now and bills what it inspects.
    const text = '| a | b |\n|---|---|\n| ' + 'y'.repeat(20000) + ' | z |\n';
    for (const chunk of [CHUNK, FINE_CHUNK]) {
      const p = createStreamParser();
      let prev = 0;
      const started = Date.now();
      for (let i = 0; i < text.length; i += chunk) {
        const cut = Math.min(text.length, i + chunk);
        const before = p.debug.scanned;
        p.feed(text.slice(0, cut));
        const over = (p.debug.scanned - before) - (cut - prev);
        assert.ok(over <= PER_FEED_SLACK, `chunk ${chunk}: feed at ${cut} scanned ${over} extra`);
        prev = cut;
      }
      const blocks = p.end(text);
      assert.deepEqual(blocks, parseBlocks(text), `chunk ${chunk}: the stream disagrees with parseBlocks`);
      const table = blocks.find((b) => b.type === 'table');
      assert.ok(table && table.rows.length === 1, 'the long row is there');
      assert.deepEqual(table.rows[0], ['y'.repeat(20000), 'z'], 'and its cells are the trimmed ones');
      const ratio = p.debug.scanned / text.length;
      const limit = chunk === CHUNK ? TOTAL_RATIO : FINE_TOTAL_RATIO;
      assert.ok(ratio <= limit, `chunk ${chunk}: scanned ${ratio.toFixed(2)}x`);
      assert.ok(Date.now() - started < 4000, `chunk ${chunk}: took ${Date.now() - started} ms of wall clock`);
    }
  }, { timeoutMs: 60000 });

  test('a delimiter run does not melt the inline stream', () => {
    // A stuck model emitting one character forever is a real failure mode, and it used to reach
    // createInlineStream as O(n^3): the ` and * / _ / ~ run counters were uncapped, so every
    // position of a run re-counted the run and every feed re-tokenised from safeEnd.
    // Measured on the pre-fix code: '`'.repeat(3000) at 1-char chunks took 9,273 ms and 5,000 took
    // 42,666 ms. debug.scanned CANNOT see this (it counts the window, not the work inside it), so
    // the ceiling here is wall clock - deliberately two orders of magnitude above what it costs now.
    const N = 4000;
    for (const ch of ['`', '*', '_', '~']) {
      const text = ch.repeat(N);
      for (const chunk of [FINE_CHUNK, CHUNK]) {
        const st = createInlineStream({ citations: true });
        const started = Date.now();
        let last = null;
        for (let i = chunk; ; i += chunk) {
          const cut = Math.min(i, N);
          last = st.feed(text.slice(0, cut));
          if (cut >= N) break;
        }
        const ms = Date.now() - started;
        assert.ok(ms < 2000, `${ch} at chunk ${chunk}: ${ms} ms for ${N} characters`);
        assert.deepEqual(mergeText(last.committed.concat(last.open)),
          mergeText(parseInline(text, { citations: true })),
          `${ch} at chunk ${chunk}: the stream disagrees with parseInline`);
        if (ch !== '`') {
          // A run of emphasis markers resolves into nodes, so safeEnd DOES advance and the work
          // stays linear. A backtick run cannot commit (the run itself may still grow), so it
          // stays quadratic with a tiny constant - the wall clock above is its only bound.
          assert.ok(last.safeEnd > N - 100, `${ch}: safeEnd stuck at ${last.safeEnd}`);
          assert.ok(st.debug.scanned <= N * 6, `${ch} at chunk ${chunk}: scanned ${st.debug.scanned}`);
        }
      }
    }
  }, { timeoutMs: 60000 });

  test('the inline stream commits the long paragraph instead of re-parsing it', () => {
    const [, text] = fixtures().find(([n]) => n === 'paragraph-20k');
    const para = text.split('\n\n')[0];
    const st = createInlineStream({ citations: true });
    let last = null;
    for (let i = 0; i < para.length; i += CHUNK) last = st.feed(para.slice(0, Math.min(para.length, i + CHUNK)));
    assert.ok(last.safeEnd > para.length - 200, `safeEnd ${last.safeEnd} of ${para.length}`);
    assert.ok(last.open.length <= 4, 'the re-parsed tail stays tiny');
    assert.deepEqual(mergeText(last.committed.concat(last.open)), parseInline(para, { citations: true }));
  });
};
