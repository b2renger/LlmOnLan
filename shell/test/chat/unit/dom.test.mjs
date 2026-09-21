// render/dom.mjs - the only path from model text to nodes (P0-U3). Runs on the chat-unit DOM shim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlocks } from '../../../renderer/chat/render/md-block.mjs';
import { parseInline } from '../../../renderer/chat/render/md-inline.mjs';
import {
  domFactory, renderBlocks, renderInline, safeHref, ALLOWED_TAGS, ALLOWED_ATTRS,
} from '../../../renderer/chat/render/dom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', 'fixtures', 'md');
const read = (p) => fs.readFileSync(path.join(FIX, p), 'utf8').replace(/\r\n/g, '\n');

/** The corpus, with its BIG-LINE marker expanded into a real 1 MB line. */
function corpus() {
  const raw = read('xss-corpus.md');
  return raw.replace(/^<!-- BIG-LINE:(\d+) -->.*$/m, (_m, n) => {
    const unit = '<script>alert(1)</script> ';
    return unit.repeat(Math.ceil(Number(n) / unit.length)).slice(0, Number(n));
  });
}

const doc = () => /** @type {any} */ (globalThis).__chatTestDom;
const els = (node) => node.querySelectorAll('*');

export default (test) => {
  test('the DOM shim is available', () => {
    assert.ok(doc(), 'chat-unit.js provides globalThis.__chatTestDom');
  });

  // ---------------------------------------------------------------------------------- XSS corpus
  test('the XSS corpus produces only allowed tags and no event handlers', () => {
    const H = domFactory(doc());
    const frag = renderBlocks(parseBlocks(corpus()), H, {});
    const all = els(frag);
    assert.ok(all.length > 30, 'the corpus renders a real tree');
    const allowed = new Set(ALLOWED_TAGS);
    for (const el of all) {
      assert.ok(allowed.has(el.tagName), `tag outside ALLOWED_TAGS: ${el.tagName}`);
      for (const a of el.attributes) {
        assert.ok(!/^on/i.test(a.name), `event handler attribute: ${a.name} on ${el.tagName}`);
        assert.ok(ALLOWED_ATTRS.includes(a.name) || a.name.startsWith('data-'),
          `attribute outside ALLOWED_ATTRS: ${a.name}`);
      }
    }
  });

  test('every anchor is an http(s) link opened safely, and nothing else is a link', () => {
    const H = domFactory(doc());
    const frag = renderBlocks(parseBlocks(corpus()), H, {});
    const anchors = frag.querySelectorAll('a');
    assert.ok(anchors.length >= 3, 'the safe links survive');
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      assert.ok(/^https?:\/\//i.test(href), `anchor with a non-http href: ${href}`);
      assert.equal(a.getAttribute('target'), '_blank');
      const rel = a.getAttribute('rel') || '';
      assert.ok(rel.includes('noopener') && rel.includes('noreferrer'), `rel is ${rel}`);
    }
    const hrefs = anchors.map((a) => a.getAttribute('href'));
    assert.ok(hrefs.includes('http://example.com/ok'));
    assert.ok(hrefs.some((h) => h.startsWith('https://example.com/ok')));
  });

  test('the mail link is plain text, and so is every other scheme', () => {
    const H = domFactory(doc());
    const frag = renderBlocks(parseBlocks(corpus()), H, {});
    const hrefs = frag.querySelectorAll('a').map((a) => (a.getAttribute('href') || '').toLowerCase());
    for (const bad of ['mail', 'javascript', 'data:', 'file:', 'vbscript', '//evil']) {
      assert.ok(!hrefs.some((h) => h.includes(bad)), `a ${bad} link became an anchor`);
    }
    const text = frag.textContent;
    assert.ok(text.includes('mail link'), 'its label still renders, as text');
    assert.ok(text.includes('script link'));
  });

  test('no img comes out of markdown - an image is a link chip', () => {
    const H = domFactory(doc());
    const frag = renderBlocks(parseBlocks(corpus()), H, {});
    assert.equal(frag.querySelectorAll('img').length, 0, 'markdown never yields an img');
    const chips = frag.querySelectorAll('a.chat-imgchip');
    assert.ok(chips.length >= 1, 'the safe image became a chip');
    assert.equal(chips[0].getAttribute('href'), 'https://example.com/evil.png');
    assert.ok(frag.textContent.includes('bad'), 'the dangerous image is its alt text');
  });

  test('raw HTML in the corpus stays text', () => {
    const H = domFactory(doc());
    const frag = renderBlocks(parseBlocks(corpus()), H, {});
    const markup = doc().serialize(frag);
    assert.ok(!/<script/i.test(markup), 'no script element');
    assert.ok(!/<iframe/i.test(markup), 'no iframe element');
    assert.ok(markup.includes('&lt;script&gt;'), 'it is escaped text instead');
  });

  test('a 1 MB line is just a long text node', () => {
    const text = corpus();
    assert.ok(text.length > 1000000, 'the BIG-LINE marker expanded');
    const H = domFactory(doc());
    const frag = renderBlocks(parseBlocks(text), H, {});
    assert.ok(frag.textContent.length > 1000000);
    assert.equal(frag.querySelectorAll('script').length, 0);
  });

  // ------------------------------------------------------------------------------------ safeHref
  test('safeHref accepts only http(s), after decoding and stripping', () => {
    assert.equal(safeHref('https://example.com/a?b=1'), 'https://example.com/a?b=1');
    assert.equal(safeHref('  http://example.com  '), 'http://example.com');
    assert.equal(safeHref('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM');
    for (const bad of [
      'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)',
      ' javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'vbscript:msgbox(1)',
      '&#106;avascript:alert(1)', '&#x6a;avascript&#x3a;alert(1)', 'java&#09;script:alert(1)',
      '//evil.example.com', '/relative', 'relative', '', 'mail' + 'to:a@b.c',
      // Double-encoded: one decode leaves '&#104;ttps://…', a RELATIVE url that would resolve
      // against the renderer's file:// origin, while the deeper probe looks like https. What is
      // validated and what is emitted must be the same string, so this is refused.
      '&amp;#104;ttps://evil.example/x', '&amp;#106;avascript:alert(1)',
    ]) {
      assert.equal(safeHref(bad), null, `safeHref accepted ${JSON.stringify(bad)}`);
    }
    assert.equal(safeHref(null), null);
    assert.equal(safeHref(undefined), null);
    // Whatever comes back is exactly what was validated: decoding it again changes nothing.
    for (const good of ['https://example.com/a?b=1&amp;c=2', '  http://example.com  ', 'https://x.example/#&amp;']) {
      const out = safeHref(good);
      assert.ok(out && /^https?:\/\//i.test(out));
      assert.equal(safeHref(out), out, 'safeHref must be idempotent on what it returns');
    }
  });

  test('an unsafe href renders as text, never as an anchor', () => {
    const H = domFactory(doc());
    const frag = renderInline(parseInline('[click](javascript:alert(1))'), H, {});
    assert.equal(frag.querySelectorAll('a').length, 0);
    assert.equal(frag.textContent, 'click');
  });

  // -------------------------------------------------------------------------------------- svgImg
  test('svgImg is the only source of an img, and it re-encodes the source', () => {
    const H = domFactory(doc());
    const img = H.svgImg('  <svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg> ');
    assert.ok(img);
    assert.equal(img.tagName, 'img');
    const src = img.getAttribute('src');
    assert.ok(src.startsWith('data:image/svg+xml;charset=utf-8,'));
    assert.ok(!src.includes('<'), 'the payload is percent-encoded');
    assert.equal(H.svgImg('<div>no</div>'), null);
    assert.equal(H.svgImg('<svg><foreignObject><body/></foreignObject></svg>'), null);
    assert.equal(H.svgImg('<svg>' + 'x'.repeat(210 * 1024) + '</svg>'), null);
    assert.equal(H.svgImg(''), null);
    assert.equal(H.svgImg(/** @type {any} */ (null)), null);
  });

  test('the factory refuses tags, attributes and a stray src', () => {
    const H = domFactory(doc());
    assert.throws(() => H.el('script'), /not allowed/);
    assert.throws(() => H.el('iframe'), /not allowed/);
    assert.throws(() => H.el('a', { onclick: 'x' }), /not allowed/);
    assert.throws(() => H.el('img', { src: 'https://example.com/x.png' }), /svgImg/);
    assert.ok(H.el('span', { 'data-id': 'x' }).getAttribute('data-id') === 'x');
  });

  // ------------------------------------------------------------------------------- block rendering
  test('blocks render to the expected structure', () => {
    const H = domFactory(doc());
    const md = [
      '# Title', '', 'text with `code`', '', '- [x] done', '- [ ] open', '- plain', '',
      '9) nine', '', '> quoted', '', '| a | b |', '|:--|--:|', '| 1 | 2 |', '',
      '```python', 'print(1)', '```', '', '---', '',
    ].join('\n');
    const frag = renderBlocks(parseBlocks(md), H, {});
    assert.equal(frag.querySelectorAll('h1').length, 1);
    assert.equal(frag.querySelector('h1').textContent, 'Title');
    assert.equal(frag.querySelectorAll('code.chat-code-inline').length, 1);

    const boxes = frag.querySelectorAll('input');
    assert.equal(boxes.length, 2);
    for (const b of boxes) {
      assert.equal(b.getAttribute('type'), 'checkbox');
      assert.ok(b.hasAttribute('disabled'), 'task checkboxes are disabled');
    }
    assert.ok(boxes[0].hasAttribute('checked'));
    assert.ok(!boxes[1].hasAttribute('checked'));

    const ol = frag.querySelector('ol');
    assert.equal(ol.getAttribute('start'), '9');
    assert.equal(frag.querySelectorAll('blockquote p').length, 1);

    const ths = frag.querySelectorAll('th');
    assert.equal(ths.length, 2);
    assert.equal(ths[0].getAttribute('align'), 'left');
    assert.equal(ths[1].getAttribute('align'), 'right');
    assert.equal(frag.querySelectorAll('tbody tr td').length, 2);

    const fig = frag.querySelector('figure.chat-codeblock');
    assert.equal(fig.getAttribute('data-lang'), 'python');
    assert.equal(fig.getAttribute('data-closed'), '1');
    const code = fig.querySelector('code');
    assert.equal(code.getAttribute('class'), 'language-python');
    assert.equal(code.textContent, 'print(1)');
    assert.equal(frag.querySelectorAll('hr').length, 1);
  });

  test('an open fence renders with data-closed 0 and a clean language class', () => {
    const H = domFactory(doc());
    const frag = renderBlocks(parseBlocks('```js"><img src=x>\nlet a = 1;'), H, {});
    const fig = frag.querySelector('figure.chat-codeblock');
    assert.equal(fig.getAttribute('data-closed'), '0');
    const cls = fig.querySelector('code').getAttribute('class');
    assert.ok(/^language-[a-z0-9+#.-]*$/i.test(cls), `language class is sanitised: ${cls}`);
    assert.equal(frag.querySelectorAll('img').length, 0);
  });

  // ------------------------------------------------------------------------------ inline rendering
  test('citations resolve through opts.citations, and out-of-range ones stay literal', () => {
    const H = domFactory(doc());
    const inlines = parseInline('see [2] and [9]', { citations: true });
    const frag = renderInline(inlines, H, {
      citations: (n) => (n === 2 ? { url: 'https://example.com/2', title: 'Result two' } : null),
    });
    const sup = frag.querySelectorAll('sup.chat-cite');
    assert.equal(sup.length, 1);
    const a = sup[0].querySelector('a');
    assert.equal(a.getAttribute('href'), 'https://example.com/2');
    assert.equal(a.getAttribute('data-title'), 'Result two');
    assert.equal(a.textContent, '2');
    assert.ok(frag.textContent.includes('[9]'), 'the unresolved citation is literal');
  });

  test('a citation whose resolver returns a bad url stays literal', () => {
    const H = domFactory(doc());
    const frag = renderInline(parseInline('[1]', { citations: true }), H, {
      citations: () => ({ url: 'javascript:alert(1)' }),
    });
    assert.equal(frag.querySelectorAll('a').length, 0);
    assert.equal(frag.textContent, '[1]');
  });

  test('inline spans render to their elements', () => {
    const H = domFactory(doc());
    const frag = renderInline(parseInline('**b** *i* ~~d~~ `c` a  \nb'), H, {});
    assert.equal(frag.querySelectorAll('strong').length, 1);
    assert.equal(frag.querySelectorAll('em').length, 1);
    assert.equal(frag.querySelectorAll('del').length, 1);
    assert.equal(frag.querySelectorAll('code').length, 1);
    assert.equal(frag.querySelectorAll('br').length, 1);
  });

  test('stream.md renders without a single disallowed node', () => {
    const H = domFactory(doc());
    const frag = renderBlocks(parseBlocks(read('stream.md')), H, {});
    const allowed = new Set(ALLOWED_TAGS);
    for (const el of els(frag)) assert.ok(allowed.has(el.tagName), el.tagName);
    const hrefs = frag.querySelectorAll('a').map((a) => a.getAttribute('href'));
    assert.ok(hrefs.includes('https://example.com/docs'));
    assert.ok(!hrefs.some((h) => h.startsWith('mail')), 'the mail address stays text');
  });
};
