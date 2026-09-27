// Block + inline markdown core (P0-U3). Plan section 3.8 and P0-U3 acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlocks, createStreamParser, splitCells } from '../../../renderer/chat/render/md-block.mjs';
import { parseInline, createInlineStream, mergeText, CAP } from '../../../renderer/chat/render/md-inline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', 'fixtures', 'md');
const read = (p) => fs.readFileSync(path.join(FIX, p), 'utf8').replace(/\r\n/g, '\n');

/** The gfm-cases fixture: "@@@ name" separates the cases. */
function gfmCases() {
  const parts = read('gfm-cases.md').split(/^@@@ (.+)$/m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    let body = parts[i + 1];
    if (body.startsWith('\n')) body = body.slice(1);
    out.push([parts[i].trim(), body]);
  }
  return out;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random document from a grammar that covers every block type. */
function randomDoc(rnd) {
  const word = () => ['farm', 'seat', 'model', 'context', 'slot', 'gguf', 'token', 'beacon'][Math.floor(rnd() * 8)];
  const words = (n) => Array.from({ length: n }, word).join(' ');
  const inline = () => {
    const pick = rnd();
    if (pick < 0.15) return '**' + words(2) + '**';
    if (pick < 0.3) return '`' + words(2) + '`';
    if (pick < 0.4) return '*' + word() + '*';
    if (pick < 0.5) return '[' + word() + '](https://example.com/' + Math.floor(rnd() * 99) + ')';
    if (pick < 0.55) return '~~' + word() + '~~';
    if (pick < 0.6) return '[' + (1 + Math.floor(rnd() * 12)) + ']';
    return words(1 + Math.floor(rnd() * 6));
  };
  const line = (n) => Array.from({ length: 1 + Math.floor(rnd() * n) }, inline).join(' ');
  const out = [];
  const blocks = 2 + Math.floor(rnd() * 7);
  for (let i = 0; i < blocks; i++) {
    const kind = Math.floor(rnd() * 14);
    if (kind === 0) out.push('#'.repeat(1 + Math.floor(rnd() * 6)) + ' ' + line(3));
    else if (kind === 1) out.push(line(6), rnd() < 0.5 ? line(6) : '');
    else if (kind === 2) {
      out.push('```' + (rnd() < 0.5 ? 'js' : ''));
      for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) out.push(rnd() < 0.2 ? '' : 'let x' + k + ' = ' + k + ';');
      if (rnd() < 0.9) out.push('```');
    } else if (kind === 3) {
      const ord = rnd() < 0.5;
      for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) out.push((ord ? k + 1 + '.' : '-') + ' ' + line(3));
    } else if (kind === 4) {
      out.push('- ' + line(2));
      out.push('  ```py');
      out.push('  a = 1');
      if (rnd() < 0.5) out.push('');
      out.push('  b = 2');
      out.push('  ```');
      out.push('- ' + line(2));
    } else if (kind === 5) {
      out.push('| a | b |', '|---|---|');
      for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) out.push('| ' + line(1) + ' | ' + line(1) + ' |');
    } else if (kind === 6) {
      out.push('> ' + line(3));
      if (rnd() < 0.5) out.push('> > ' + line(2));
    } else if (kind === 7) out.push(rnd() < 0.5 ? '---' : '***');
    else if (kind === 8) {
      out.push('- [ ] ' + line(2));
      out.push('- [x] ' + line(2));
    } else if (kind === 9) {
      out.push('- outer ' + line(1));
      out.push('  - inner ' + line(1));
      out.push('- outer2');
    } else if (kind === 11) {             // a quote holding a list and a fence
      out.push('> ' + line(2));
      out.push('> - ' + line(1));
      out.push('> - ' + line(1));
      out.push('> ```');
      out.push('> code(' + i + ')');
      out.push('> ```');
    } else if (kind === 12) {             // a table whose header row follows prose with no blank
      out.push(line(5));
      out.push('| a | b |', '|--:|:--|', '| ' + line(1) + ' | ' + line(1) + ' |');
    } else if (kind === 13) {             // deep indentation and a stray marker
      out.push('1. ' + line(2));
      out.push('   continued at the content column');
      out.push('   - ' + line(1));
      out.push('2. ' + line(2));
    } else out.push(line(40));            // a long unwrapped paragraph line
    // most blocks are separated by a blank line, but not all: a block that starts right under
    // another one is where container closing goes wrong.
    if (rnd() < 0.8) out.push('');
  }
  return out.join('\n') + (rnd() < 0.5 ? '\n' : '');
}

const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NL = String.fromCharCode(10);

export default (test) => {
  // -------------------------------------------------------------------- blocks: the golden cases
  test('gfm-cases.md parses to the expected block JSON', () => {
    const expected = JSON.parse(read('gfm-cases.expected.json'));
    const names = [];
    for (const [name, body] of gfmCases()) {
      names.push(name);
      assert.ok(name in expected, `no expected blocks for case "${name}"`);
      assert.deepEqual(parseBlocks(body), expected[name], `case "${name}"`);
    }
    assert.deepEqual(names.sort(), Object.keys(expected).sort(), 'cases and expectations line up');
    assert.ok(names.length >= 20, 'one case per grammar rule');
  });

  test('every gfm case streams to exactly what parseBlocks gives', () => {
    for (const [name, body] of gfmCases()) {
      const want = parseBlocks(body);
      for (const chunk of [1, 2, 3, 5, 17]) {
        const p = createStreamParser();
        for (let i = 0; i < body.length; i += chunk) p.feed(body.slice(0, Math.min(body.length, i + chunk)));
        assert.deepEqual(p.end(body), want, `case "${name}" at chunk ${chunk}`);
      }
    }
  });

  test('the restricted grammar rules, spelled out', () => {
    // a blank line ends every open block
    assert.equal(parseBlocks('- a\n\n- b').length, 2);
    assert.equal(parseBlocks('> a\n\nb').length, 2);
    // 1. / blank / 2. is two lists, the second starting at 2
    const two = parseBlocks('1. a\n\n2. b');
    assert.equal(two.length, 2);
    assert.equal(two[1].start, 2);
    // no setext headings
    assert.deepEqual(parseBlocks('text\n==='), [{ type: 'paragraph', text: 'text\n===' }]);
    // a fence in a list item keeps its blank lines, and the item
    const li = parseBlocks('- a\n  ```\n  x\n\n  y\n  ```\n- b');
    assert.equal(li[0].items.length, 2);
    assert.equal(li[0].items[0].blocks[1].code, 'x\n\ny');
    // a table needs its delimiter row
    assert.equal(parseBlocks('| a | b |\n| c | d |')[0].type, 'paragraph');
    assert.equal(parseBlocks('| a | b |\n|---|---|\n| 1 | 2 |')[0].type, 'table');
    // headings and hr are single-line blocks
    assert.deepEqual(parseBlocks('# h\ntext'), [
      { type: 'heading', level: 1, text: 'h' }, { type: 'paragraph', text: 'text' },
    ]);
    // raw HTML is text
    assert.equal(parseBlocks('<b>x</b>')[0].type, 'paragraph');
  });

  test('the header row only becomes a table when the delimiter row arrives', () => {
    const text = '| a | b |\n|---|---|\n| 1 | 2 |\n';
    const p = createStreamParser();
    p.feed('| a | b |\n');
    assert.equal(p.feed('| a | b |\n|-').open.type, 'paragraph', 'still a paragraph mid-delimiter');
    p.feed('| a | b |\n|---|---|\n');
    assert.equal(p.feed('| a | b |\n|---|---|\n').open.type, 'table');
    assert.deepEqual(p.end(text), parseBlocks(text));
  });

  test('an open fence grows its code text by appending only', () => {
    const text = '```js\nlet a = 1;\nlet b = 2;\n```\n';
    const p = createStreamParser();
    let prev = '';
    for (let i = 0; i < text.length; i++) {
      const { open } = p.feed(text.slice(0, i + 1));
      if (!open || open.type !== 'code') continue;
      assert.ok(open.code.startsWith(prev) || prev.startsWith(open.code),
        `code text jumped: ${JSON.stringify(prev)} -> ${JSON.stringify(open.code)}`);
      if (open.code.length >= prev.length) prev = open.code;
    }
    assert.deepEqual(p.end(text), parseBlocks(text));
  });

  test('splitCells drops the edge pipes and honours escapes', () => {
    assert.deepEqual(splitCells('| a | b |'), ['a', 'b']);
    assert.deepEqual(splitCells('a|b'), ['a', 'b']);
    assert.deepEqual(splitCells('| a \\| b | c |'), ['a | b', 'c']);
    assert.deepEqual(splitCells('|| b |'), ['', 'b']);
  });

  // ---------------------------------------------------------------------------------- block fuzz
  test('fuzz: 300 documents x 20 chunkings stream to parseBlocks, committed blocks never change', () => {
    const rnd = mulberry32(20260915);
    for (let d = 0; d < 300; d++) {
      const text = randomDoc(rnd);
      const want = parseBlocks(text);
      for (let c = 0; c < 20; c++) {
        const p = createStreamParser();
        let seen = [];
        let at = 0;
        while (at < text.length) {
          at = Math.min(text.length, at + 1 + Math.floor(rnd() * 12));
          const { committed } = p.feed(text.slice(0, at));
          // every block committed earlier is still deep-equal, in the same order
          for (let i = 0; i < seen.length; i++) {
            assert.ok(deep(seen[i], committed[i]),
              `doc ${d} chunking ${c}: committed block ${i} changed`);
          }
          seen = JSON.parse(JSON.stringify(committed));
        }
        const got = p.end(text);
        assert.ok(deep(got, want), `doc ${d} chunking ${c}: stream != parseBlocks\n${JSON.stringify(text)}`);
        for (let i = 0; i < seen.length; i++) {
          assert.ok(deep(seen[i], got[i]), `doc ${d} chunking ${c}: block ${i} changed at end()`);
        }
      }
    }
  }, { timeoutMs: 120000 });

  // -------------------------------------------------------------------------------------- inline
  test('inline: the supported constructs', () => {
    const one = (s, opts) => parseInline(s, opts);
    assert.deepEqual(one('a `b ** c` d'), [
      { type: 'text', text: 'a ' }, { type: 'code', text: 'b ** c' }, { type: 'text', text: ' d' },
    ]);
    assert.equal(one('**b**')[0].type, 'strong');
    assert.equal(one('__b__')[0].type, 'strong');
    assert.equal(one('*e*')[0].type, 'em');
    assert.equal(one('_e_')[0].type, 'em');
    assert.equal(one('~~d~~')[0].type, 'del');
    assert.deepEqual(one('snake_case_word'), [{ type: 'text', text: 'snake_case_word' }]);
    const link = one('[t](https://example.com/a)')[0];
    assert.equal(link.type, 'link');
    assert.equal(link.href, 'https://example.com/a');
    assert.equal(one('<https://example.com>')[0].type, 'link');
    assert.equal(one('see https://example.com/x, ok')[1].href, 'https://example.com/x');
    assert.deepEqual(one('a \\*b\\* c'), [{ type: 'text', text: 'a *b* c' }]);
    assert.equal(one('a  \nb')[1].type, 'break');
    assert.equal(one('a\\\nb')[1].type, 'break');
  });

  test('inline: [n] is a citation only with opts.citations', () => {
    assert.deepEqual(parseInline('see [2] here'), [{ type: 'text', text: 'see [2] here' }]);
    const cited = parseInline('see [2] here', { citations: true });
    assert.equal(cited[1].type, 'cite');
    assert.equal(cited[1].n, 2);
    // a link keeps winning over a citation
    assert.equal(parseInline('[2](https://example.com)', { citations: true })[0].type, 'link');
  });

  test('inline: unclosed or over-long spans stay literal', () => {
    assert.deepEqual(parseInline('a **b'), [{ type: 'text', text: 'a **b' }]);
    assert.deepEqual(parseInline('a `b'), [{ type: 'text', text: 'a `b' }]);
    const long = '**' + 'x'.repeat(CAP + 1) + '**';
    const got = parseInline(long);
    assert.equal(got.length, 1);
    assert.equal(got[0].type, 'text', 'a 2,001-char ** span is literal');
    const ok = '**' + 'x'.repeat(100) + '**';
    assert.equal(parseInline(ok)[0].type, 'strong');
  });

  test('inline: only http(s) becomes a link', () => {
    for (const bad of ['[t](javascript:alert(1))', '[t](mailto:a@b.c)', '[t](data:text/html,x)', '[t](file:///x)']) {
      const node = parseInline(bad)[0];
      // md-inline keeps the destination; render/dom.mjs is what refuses it (dom.test.mjs)
      assert.equal(node.type, 'link');
      assert.ok(!/^https?:/i.test(node.href), 'the bad scheme is preserved for dom.mjs to refuse');
    }
    assert.equal(parseInline('<mailto:a@b.c>')[0].type, 'text', 'a non-http autolink is text');
  });

  test('createInlineStream commits only what can never change', () => {
    const text = 'Some prose with **strong**, a `span`, https://example.com/x and a [link](https://e.co/1) end.';
    for (const chunk of [1, 2, 5, 13]) {
      const st = createInlineStream({ citations: true });
      let prev = [];
      let last = null;
      for (let i = 0; i < text.length; i += chunk) {
        last = st.feed(text.slice(0, Math.min(text.length, i + chunk)));
        for (let k = 0; k < prev.length; k++) {
          assert.ok(deep(prev[k], last.committed[k]), `committed inline ${k} changed at chunk ${chunk}`);
        }
        prev = JSON.parse(JSON.stringify(last.committed));
        assert.ok(last.safeEnd <= text.length);
      }
      assert.deepEqual(mergeText(last.committed.concat(last.open)), parseInline(text, { citations: true }),
        `the final stream != parseInline at chunk ${chunk}`);
    }
  });

  test('inline fuzz: 300 lines x 8 chunkings', () => {
    const rnd = mulberry32(777);
    const pieces = ['**bold**', '*em*', '`code`', '~~del~~', '[t](https://e.co/1)', 'https://e.co/2',
      '<https://e.co/3>', '[4]', 'plain words here', 'a**b', 'x `y', '\\*lit\\*', 'end.  ', 'snake_case'];
    for (let d = 0; d < 300; d++) {
      const n = 2 + Math.floor(rnd() * 10);
      const text = Array.from({ length: n }, () => pieces[Math.floor(rnd() * pieces.length)]).join(' ');
      const want = parseInline(text, { citations: true });
      for (let c = 0; c < 8; c++) {
        const st = createInlineStream({ citations: true });
        let prev = [];
        let last = null;
        let at = 0;
        while (at < text.length) {
          at = Math.min(text.length, at + 1 + Math.floor(rnd() * 7));
          last = st.feed(text.slice(0, at));
          for (let k = 0; k < prev.length; k++) {
            assert.ok(deep(prev[k], last.committed[k]), `doc ${d}: committed inline ${k} changed`);
          }
          prev = JSON.parse(JSON.stringify(last.committed));
        }
        assert.ok(deep(mergeText(last.committed.concat(last.open)), want),
          `doc ${d} chunking ${c}: ${JSON.stringify(text)}`);
      }
    }
  }, { timeoutMs: 60000 });

  test('adversarial inline fuzz: delimiter runs, half-written URLs and escapes', () => {
    // The friendly word-grammar above never produces a delimiter RUN, which is exactly the shape a
    // stuck model emits - and the shape that turned createInlineStream cubic (P0 fix round). It is
    // also what caught the two commit-point bugs this grammar is built around: a literal backtick
    // run that is still growing, and a span whose closer a LATER backtick can still steal.
    const ATOMS = ['*', '**', '_', '__', '~~', '`', '``', '```', '\\', '[', ']', '(', ')', '<', '>',
      '!', 'a', 'bb', '1', ' ', '  ', 'https://x.y/', 'h', 'ttps://', 'Tom&Jerry', '.', ',', ':', 'x'];
    const rnd = mulberry32(20260915);
    for (let d = 0; d < 1200; d++) {
      let text = '';
      const n = 2 + Math.floor(rnd() * 22);
      for (let k = 0; k < n; k++) {
        const atom = ATOMS[Math.floor(rnd() * ATOMS.length)];
        text += rnd() < 0.12 ? atom.repeat(1 + Math.floor(rnd() * 40)) : atom;
      }
      if (!text) continue;
      const want = mergeText(parseInline(text, { citations: true }));
      for (const chunk of [1, 3, 7]) {
        const st = createInlineStream({ citations: true });
        let prev = [];
        let last = null;
        for (let i = chunk; ; i += chunk) {
          const cut = Math.min(i, text.length);
          last = st.feed(text.slice(0, cut));
          for (let k = 0; k < prev.length; k++) {
            assert.ok(deep(prev[k], last.committed[k]),
              `doc ${d} chunk ${chunk}: committed inline ${k} changed in ${JSON.stringify(text)}`);
          }
          prev = JSON.parse(JSON.stringify(last.committed));
          if (cut >= text.length) break;
        }
        assert.ok(deep(mergeText(last.committed.concat(last.open)), want),
          `doc ${d} chunk ${chunk}: ${JSON.stringify(text)}`);
      }
    }
  }, { timeoutMs: 120000 });

  test('stream.md carries everything the later phases rely on', () => {
    const text = read('stream.md');
    const blocks = parseBlocks(text);
    const types = new Set(blocks.map((b) => b.type));
    for (const t of ['heading', 'paragraph', 'list', 'quote', 'table', 'code', 'hr']) {
      assert.ok(types.has(t), `stream.md is missing a ${t} block`);
    }
    const fences = [];
    const walk = (bs) => bs.forEach((b) => {
      if (b.type === 'code') fences.push(b);
      if (b.type === 'quote') walk(b.blocks);
      if (b.type === 'list') b.items.forEach((it) => walk(it.blocks));
    });
    walk(blocks);
    const langs = fences.map((f) => f.lang);
    assert.ok(langs.includes('svg'), 'an svg fence');
    assert.equal(langs.filter((l) => l === 'python').length, 2, 'two python fences');
    assert.ok(fences.some((f) => f.code.includes('import bpy')), 'a harmless bpy fence');
    assert.ok(fences.some((f) => f.code.includes("raise RuntimeError('boom')")), 'a failing fence');
    const inItem = blocks.some((b) => b.type === 'list'
      && b.items.some((it) => it.blocks.some((x) => x.type === 'code')));
    assert.ok(inItem, 'a fence inside a list item');
    assert.ok(text.includes('[2]') && text.includes('[9]'), 'citation markers');
    assert.ok(text.includes('https://example.com/docs'), 'an https link');
    assert.ok(/mailto:/.test(text), 'a mail link that must stay plain text');
    // and it streams identically
    const p = createStreamParser();
    for (let i = 0; i < text.length; i += 4) p.feed(text.slice(0, Math.min(text.length, i + 4)));
    assert.deepEqual(p.end(text), blocks);
  });

  test('the streaming API contract: open, newlyCommitted, end, and a shrinking feed', () => {
    const text = ['# H', '', 'para one', '', '- a', '- b', '', '```js', 'x', '```', '', 'last', ''].join(NL);
    const p = createStreamParser();
    const seenNew = [];
    for (let i = 0; i < text.length; i += 3) {
      const r = p.feed(text.slice(0, Math.min(text.length, i + 3)));
      for (const b of r.newlyCommitted) seenNew.push(b);
      if (r.open) assert.ok(!r.committed.includes(r.open), 'the open block is not also committed');
    }
    const blocks = p.end(text);
    // every committed block is announced exactly once, in document order, as the same object
    assert.ok(seenNew.length >= 4);
    for (let i = 0; i < seenNew.length; i++) assert.equal(seenNew[i], blocks[i], 'block ' + i + ' identity');
    assert.deepEqual(blocks, parseBlocks(text));
    assert.deepEqual(createStreamParser().end(), []);
    const q = createStreamParser();
    q.feed('abcdef');
    assert.throws(() => q.feed('abc'), /shrank/);
  });

  test('the open block is the outermost open block, and a partial new block waits for its newline', () => {
    const LIST = ['- one', '- two'].join(NL);
    const p = createStreamParser();
    p.feed(LIST);
    assert.equal(p.feed(LIST).open.type, 'list', 'inside a list the open block is the list');
    // a partial line that would START a different block is never previewed: committing the list
    // early could not be taken back, so the quote appears only once its line is complete.
    assert.equal(p.feed(LIST + NL + '> quoted').open.type, 'list');
    const full = LIST + NL + '> quoted' + NL;
    const r = p.feed(full);
    assert.equal(r.open.type, 'quote');
    assert.ok(r.committed.some((b) => b.type === 'list'), 'the list committed when the quote line landed');
    assert.deepEqual(p.end(full), parseBlocks(full));
  });

  test('edge cases: broken containers, mismatched tables, deep headings', () => {
    const cases = [
      [['- a', '  ```', '  code', 'not indented', '- b'], ['list', 'paragraph', 'list']],
      [['- a', '  ```', '  code'], ['list']],
      [['> - a', '> - b', '> text'], ['quote']],
      [['| a |', '|---|', 'no pipe here'], ['table', 'paragraph']],
      [['| a | b |', '|---|', '| 1 |'], ['paragraph']],
      [['#### h4', '####### seven'], ['heading', 'paragraph']],
      [['> quote', '```', 'code', '```'], ['quote', 'code']],
      [['***bold em***'], ['paragraph']],
      [['- a', '', '  b'], ['list', 'paragraph']],
    ];
    for (const [lines, types] of cases) {
      const text = lines.join(NL) + NL;
      const want = parseBlocks(text);
      assert.deepEqual(want.map((b) => b.type), types, JSON.stringify(text));
      for (const chunk of [1, 3, 1000]) {
        const p = createStreamParser();
        for (let i = 0; i < text.length; i += chunk) p.feed(text.slice(0, Math.min(text.length, i + chunk)));
        assert.deepEqual(p.end(text), want, JSON.stringify(text) + ' at chunk ' + chunk);
      }
    }
  });
};
