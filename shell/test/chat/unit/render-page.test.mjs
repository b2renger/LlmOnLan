// @ts-check
// render/page.mjs: one web page from the code blocks of one LOL Vibe answer (owner, 2026-11-14).
import assert from 'node:assert/strict';
import { isPage, pageOf, blockOf } from '../../../renderer/chat/render/page.mjs';

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
    assert.ok(page.html.startsWith(html), 'the page itself, untouched (it has no inline script)');
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

  test('pageOf names every script it runs, and blockOf turns the guest\'s error into the block and its line', () => {
    const html = '<!doctype html>\n<html><body>\n<p>x</p>\n<script>\nvar a = 1;\nnope();\n</script>\n<script src="x.js"></script>\n<script type="module">\nimport x from "./x.js";\n</script>\n</body></html>';
    const fences = [
      { lang: 'markdown', code: 'notes' },
      { lang: 'html', code: html },
      { lang: 'css', code: 'p{}' },
      { lang: 'js', code: '// one\nnope2();' },
    ];
    const page = pageOf(html, fences);
    assert.deepEqual(Object.keys(page.sources).sort(), ['lol-b3.js', 'lol-h1.js'], 'the inline classic script and the JS block; not a src or a module');
    assert.equal(page.html.replace(/\n\/\/# sourceURL=lol-h1\.js\n/, '').startsWith(html), true, 'the page changes only by its scripts\' names');
    // The guest numbers each script's lines from the text after its opening tag (measured, VIBE_PAGE_PLAN).
    const inPage = page.html.split('<script>')[1].split('</script>')[0];
    const scriptLine = inPage.split('\n').findIndex((l) => l === 'nope();') + 1;
    assert.deepEqual(blockOf({ source: 'lol-h1.js', line: scriptLine, col: 1 }, page.sources), { fence: 1, line: 6, col: 1 }, 'line 6 of the page block');
    const js = page.html.slice(page.html.lastIndexOf('<script>') + '<script>'.length);
    const jsLine = js.split('\n').findIndex((l) => l === 'nope2();') + 1;
    assert.deepEqual(blockOf({ source: 'lol-b3.js', line: jsLine, col: 1 }, page.sources), { fence: 3, line: 2, col: 1 }, 'line 2 of the JS block');
    assert.equal(blockOf({ source: '', line: 4 }, page.sources), null, 'no name: the guest could not say');
    assert.equal(blockOf({ source: 'lol-b9.js', line: 4 }, page.sources), null, 'a name this page does not have');
    assert.equal(blockOf({ source: 'constructor', line: 4 }, page.sources), null, 'never a property of every object');
    assert.equal(blockOf(null, page.sources), null);
    assert.equal(pageOf(html, [], { pageIndex: 7 }).sources['lol-h1.js'].fence, 7, 'the caller can say which block is the page');
  });
};
