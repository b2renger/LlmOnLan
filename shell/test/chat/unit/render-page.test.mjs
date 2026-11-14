// @ts-check
// render/page.mjs: one web page from the code blocks of one LOL Vibe answer (owner, 2026-11-14).
import assert from 'node:assert/strict';
import { isPage, pageOf } from '../../../renderer/chat/render/page.mjs';

export default (test) => {
  test('isPage: html and htm blocks, and an untagged block that starts like a page; nothing else', () => {
    assert.equal(isPage({ lang: 'html', code: '<p>hi</p>' }), true);
    assert.equal(isPage({ lang: 'HTM', code: '' }), true);
    assert.equal(isPage({ lang: '', code: '  <!DOCTYPE html>\n<html>' }), true);
    assert.equal(isPage({ lang: '', code: '<html lang="en">' }), true);
    assert.equal(isPage({ lang: '', code: '<div>not a page</div>' }), false);
    assert.equal(isPage({ lang: 'xml', code: '<!doctype html>' }), false, 'a tagged block is what its tag says');
    assert.equal(isPage({ lang: 'css', code: 'body{}' }), false);
  });

  test('pageOf: the answer\'s CSS becomes the style and its JavaScript inline scripts, in order, after the page', () => {
    const html = '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><button id="b">Go</button><script src="script.js"></script></body></html>';
    const fences = [
      { lang: 'html', code: html },
      { lang: 'css', code: 'button { color: red; }' },
      { lang: 'javascript', code: 'document.getElementById("b").onclick = () => {};' },
      { lang: 'js', code: 'console.log("</script>");' },
      { lang: 'python', code: 'print(1)' },
    ];
    const page = pageOf(html, fences);
    assert.equal(page.css, 'button { color: red; }');
    assert.ok(page.html.startsWith(html), 'the page itself, untouched');
    const tail = page.html.slice(html.length);
    assert.ok(tail.indexOf('onclick') < tail.indexOf('console.log'), 'the answer\'s order');
    assert.ok(tail.includes('console.log("<\\/script>")'), 'a "</script" inside a script cannot end it early');
    assert.ok(!tail.includes('print(1)'), 'only CSS and JavaScript join the page');
    assert.deepEqual(page.libs, []);
    assert.deepEqual(page.remote, [], 'a file next to the page is not the web');
  });

  test('pageOf: p5, three and d3 from a CDN become the sandbox\'s own copies; anything else is named as unreachable', () => {
    const html = [
      '<script src="https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js"></script>',
      '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
      '<script src="https://d3js.org/d3.v7.min.js"></script>',
      '<script src="https://cdn.tailwindcss.com"></script>',
      '<script type="module">import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";</script>',
      '<script>function setup(){ createCanvas(100, 100); }</script>',
    ].join('\n');
    const page = pageOf(html, [{ lang: 'html', code: html }]);
    assert.deepEqual(page.libs, ['p5', 'three', 'd3']);
    assert.deepEqual(page.remote, ['cdn.tailwindcss.com', 'unpkg.com']);
    assert.ok(/new p5\(\)/.test(page.html.slice(html.length)), 'p5\'s global mode is started once setup() exists');
    const own = pageOf('<script src="https://cdn.jsdelivr.net/npm/p5@1/lib/p5.js"></script><script>new p5((s) => {});</script>', []);
    assert.ok(!/new p5\(\);/.test(own.html), 'a page that starts p5 itself is left to do so');
  });
};
