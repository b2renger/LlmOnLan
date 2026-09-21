// LOL Chat unit-test runner (dependency-free, Node >= 22). Plan §2.1.
//
//   node shell/test/chat-unit.js            # every shell/test/chat/unit/*.test.mjs
//   node shell/test/chat-unit.js md sse     # only files whose name contains "md" or "sse"
//
// Test file shape:
//   import assert from 'node:assert/strict';
//   export default (test) => { test('name', async () => { ... }); };
// The default export may be async (it is awaited before its tests run). `test.skip(name, fn)`
// records a skipped test. Tests run sequentially, each with a 10 s timeout (override per test with
// test(name, fn, {timeoutMs})). Output: `ok   <file>: <name>` / `FAIL <file>: <name>: <message>`,
// then `N passed, M failed[, K skipped]`. Exit code 1 on any failure, any file that fails to import,
// or a filter that matches no file.
//
// globalThis.__chatTestDom: a tiny DOM shim so render/dom.mjs (and other H-factory code) runs in
// Node. It is a document-like object: createElement, createElementNS, createTextNode,
// createDocumentFragment, plus serialize(node) and createDocument() (a fresh, independent shim).
// Nodes support: nodeType, nodeName/tagName (lowercase for HTML), parentNode, childNodes, children,
// firstChild, lastChild, nextSibling, previousSibling, appendChild, append, prepend, insertBefore,
// removeChild, replaceChild, replaceChildren, remove, textContent (get/set), setAttribute,
// getAttribute, hasAttribute, removeAttribute, attributes (array of {name, value}), id, className,
// classList (add/remove/contains/toggle), dataset (read via data-* attributes), querySelector /
// querySelectorAll / getElementsByTagName with simple selectors (tag, .class, #id, [attr],
// [attr=value], compound like `a.cls[href]`, and descendant chains separated by spaces).
// Text nodes: data, nodeValue, textContent, length, appendData(s), splitText is NOT provided.
// serialize(node): HTML-like markup with escaped text and attribute values (children in order), for
// structural assertions — it is not a spec-compliant serializer.

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// ---------------------------------------------------------------------------------------------
// DOM shim
// ---------------------------------------------------------------------------------------------

function createDocument() {
  const ELEMENT_NODE = 1, TEXT_NODE = 3, DOCUMENT_FRAGMENT_NODE = 11;

  class Node {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.parentNode = null;
      this.childNodes = [];
      this.ownerDocument = doc;
    }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get nextSibling() {
      if (!this.parentNode) return null;
      const s = this.parentNode.childNodes; return s[s.indexOf(this) + 1] || null;
    }
    get previousSibling() {
      if (!this.parentNode) return null;
      const s = this.parentNode.childNodes; const i = s.indexOf(this); return i > 0 ? s[i - 1] : null;
    }
    get isConnected() { return false; }
    _adopt(child) {
      if (!(child instanceof Node)) throw new TypeError('DOM shim: argument is not a Node');
      let p = this;
      while (p) { if (p === child) throw new Error('DOM shim: HierarchyRequestError (cycle)'); p = p.parentNode; }
      if (child.parentNode) child.parentNode.removeChild(child);
    }
    appendChild(child) {
      if (child.nodeType === DOCUMENT_FRAGMENT_NODE) { for (const c of child.childNodes.slice()) this.appendChild(c); return child; }
      this._adopt(child);
      this.childNodes.push(child); child.parentNode = this; return child;
    }
    insertBefore(child, ref) {
      if (ref == null) return this.appendChild(child);
      if (child.nodeType === DOCUMENT_FRAGMENT_NODE) { for (const c of child.childNodes.slice()) this.insertBefore(c, ref); return child; }
      this._adopt(child);
      const i = this.childNodes.indexOf(ref);
      if (i < 0) throw new Error('DOM shim: NotFoundError (ref is not a child)');
      this.childNodes.splice(i, 0, child); child.parentNode = this; return child;
    }
    removeChild(child) {
      const i = this.childNodes.indexOf(child);
      if (i < 0) throw new Error('DOM shim: NotFoundError (not a child)');
      this.childNodes.splice(i, 1); child.parentNode = null; return child;
    }
    replaceChild(next, old) { this.insertBefore(next, old); return this.removeChild(old); }
    append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? doc.createTextNode(n) : n); }
    prepend(...nodes) { const ref = this.firstChild; for (const n of nodes) this.insertBefore(typeof n === 'string' ? doc.createTextNode(n) : n, ref); }
    replaceChildren(...nodes) { for (const c of this.childNodes.slice()) this.removeChild(c); this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { this.replaceChildren(); const s = v == null ? '' : String(v); if (s) this.appendChild(doc.createTextNode(s)); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  }

  class Text extends Node {
    constructor(data) { super(TEXT_NODE); this.data = String(data); }
    get nodeName() { return '#text'; }
    get nodeValue() { return this.data; }
    set nodeValue(v) { this.data = String(v); }
    get length() { return this.data.length; }
    get textContent() { return this.data; }
    set textContent(v) { this.data = v == null ? '' : String(v); }
    appendData(s) { this.data += String(s); }
    appendChild() { throw new Error('DOM shim: Text nodes have no children'); }
  }

  class Fragment extends Node {
    constructor() { super(DOCUMENT_FRAGMENT_NODE); }
    get nodeName() { return '#document-fragment'; }
    get children() { return this.childNodes.filter((c) => c.nodeType === ELEMENT_NODE); }
    querySelectorAll(sel) { return queryAll(this, sel); }
    querySelector(sel) { return queryAll(this, sel)[0] || null; }
  }

  class Element extends Node {
    constructor(tag, ns) {
      super(ELEMENT_NODE);
      this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
      this.localName = ns && ns !== 'http://www.w3.org/1999/xhtml' ? String(tag) : String(tag).toLowerCase();
      this._attrs = new Map();
      this.style = {};
      this._listeners = new Map();
    }
    get tagName() { return this.localName; }
    get nodeName() { return this.localName; }
    get children() { return this.childNodes.filter((c) => c.nodeType === ELEMENT_NODE); }
    _an(name) { return this.namespaceURI === 'http://www.w3.org/1999/xhtml' ? String(name).toLowerCase() : String(name); }
    setAttribute(name, value) { this._attrs.set(this._an(name), String(value)); }
    getAttribute(name) { const v = this._attrs.get(this._an(name)); return v === undefined ? null : v; }
    hasAttribute(name) { return this._attrs.has(this._an(name)); }
    removeAttribute(name) { this._attrs.delete(this._an(name)); }
    get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get classList() {
      const el = this;
      const read = () => el.className.split(/\s+/).filter(Boolean);
      const write = (arr) => el.setAttribute('class', [...new Set(arr)].join(' '));
      return {
        add: (...c) => write([...read(), ...c]),
        remove: (...c) => write(read().filter((x) => !c.includes(x))),
        contains: (c) => read().includes(c),
        toggle: (c, force) => {
          const has = read().includes(c);
          const on = force === undefined ? !has : !!force;
          if (on && !has) write([...read(), c]); else if (!on && has) write(read().filter((x) => x !== c));
          return on;
        },
        get length() { return read().length; },
        toString: () => el.className,
      };
    }
    get dataset() {
      const out = {};
      for (const [k, v] of this._attrs) if (k.startsWith('data-')) out[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
      return out;
    }
    addEventListener(type, fn) { const s = this._listeners.get(type) || new Set(); s.add(fn); this._listeners.set(type, s); }
    removeEventListener(type, fn) { const s = this._listeners.get(type); if (s) s.delete(fn); }
    dispatchEvent(ev) { for (const fn of this._listeners.get(ev.type) || []) fn(ev); return true; }
    querySelectorAll(sel) { return queryAll(this, sel); }
    querySelector(sel) { return queryAll(this, sel)[0] || null; }
    getElementsByTagName(tag) { return queryAll(this, String(tag)); }
  }

  function descendants(root) {
    const out = [];
    const walk = (n) => { for (const c of n.childNodes) if (c.nodeType === ELEMENT_NODE) { out.push(c); walk(c); } };
    walk(root);
    return out;
  }

  function parseCompound(s) {
    const m = { tag: null, id: null, classes: [], attrs: [] };
    const re = /^([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
    let pos = 0, x;
    while ((x = re.exec(s)) && x.index === pos) {
      if (x[1]) m.tag = x[1] === '*' ? null : x[1].toLowerCase();
      else if (x[2]) m.id = x[2];
      else if (x[3]) m.classes.push(x[3]);
      else if (x[4]) m.attrs.push({ name: x[4].toLowerCase(), value: x[5] ?? x[6] ?? x[7] });
      pos = re.lastIndex;
    }
    if (pos !== s.length) throw new Error(`DOM shim: unsupported selector "${s}"`);
    return m;
  }

  function matches(el, m) {
    if (m.tag && el.localName.toLowerCase() !== m.tag) return false;
    if (m.id && el.id !== m.id) return false;
    for (const c of m.classes) if (!el.classList.contains(c)) return false;
    for (const a of m.attrs) {
      if (!el.hasAttribute(a.name)) return false;
      if (a.value !== undefined && el.getAttribute(a.name) !== a.value) return false;
    }
    return true;
  }

  function queryAll(root, selector) {
    const results = new Set();
    for (const group of String(selector).split(',').map((g) => g.trim()).filter(Boolean)) {
      const chain = group.split(/\s+/).map(parseCompound);
      for (const el of descendants(root)) {
        if (!matches(el, chain[chain.length - 1])) continue;
        let i = chain.length - 2, p = el.parentNode;
        while (i >= 0 && p && p !== root.parentNode) {
          if (p.nodeType === ELEMENT_NODE && matches(p, chain[i])) i--;
          if (p === root) break;
          p = p.parentNode;
        }
        if (i < 0) results.add(el);
      }
    }
    // document order
    return descendants(root).filter((e) => results.has(e));
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
  const VOID = new Set(['br', 'hr', 'img', 'input']);

  function serialize(node) {
    if (!node) return '';
    if (node.nodeType === TEXT_NODE) return esc(node.data);
    if (node.nodeType === DOCUMENT_FRAGMENT_NODE) return node.childNodes.map(serialize).join('');
    const attrs = node.attributes.map((a) => ` ${a.name}="${escAttr(a.value)}"`).join('');
    if (VOID.has(node.localName)) return `<${node.localName}${attrs}>`;
    return `<${node.localName}${attrs}>${node.childNodes.map(serialize).join('')}</${node.localName}>`;
  }

  const doc = {
    nodeType: 9,
    createElement: (tag) => new Element(tag),
    createElementNS: (ns, tag) => new Element(tag, ns),
    createTextNode: (data) => new Text(data),
    createDocumentFragment: () => new Fragment(),
    serialize,
    createDocument,
    ELEMENT_NODE, TEXT_NODE, DOCUMENT_FRAGMENT_NODE,
    Node, Text, Element, DocumentFragment: Fragment,
  };
  return doc;
}

globalThis.__chatTestDom = createDocument();

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

const UNIT_DIR = path.join(__dirname, 'chat', 'unit');
const DEFAULT_TIMEOUT = 10_000;

function withTimeout(promise, ms, name) {
  let timer;
  const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

async function main() {
  const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let files = [];
  try {
    files = fs.readdirSync(UNIT_DIR).filter((f) => f.endsWith('.test.mjs')).sort();
  } catch {
    files = [];
  }
  if (filters.length) files = files.filter((f) => filters.some((flt) => f.includes(flt)));
  if (!files.length) {
    console.log(filters.length ? `no test files match: ${filters.join(' ')}` : `no test files in ${UNIT_DIR}`);
    return 1;
  }

  let passed = 0, failed = 0, skipped = 0;
  for (const file of files) {
    const label = file.replace(/\.test\.mjs$/, '');
    const tests = [];
    const test = (name, fn, opts = {}) => tests.push({ name, fn, timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT });
    test.skip = (name) => tests.push({ name, skip: true });
    try {
      const mod = await import(pathToFileURL(path.join(UNIT_DIR, file)).href);
      if (typeof mod.default !== 'function') throw new Error('default export must be a function (test) => {…}');
      await mod.default(test);
    } catch (err) {
      failed++;
      console.log(`FAIL ${label}: (load) ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
      continue;
    }
    for (const tc of tests) {
      if (tc.skip) { skipped++; console.log(`skip ${label}: ${tc.name}`); continue; }
      try {
        await withTimeout(Promise.resolve().then(() => tc.fn()), tc.timeoutMs, tc.name);
        passed++;
        console.log(`ok   ${label}: ${tc.name}`);
      } catch (err) {
        failed++;
        const msg = err && err.message ? err.message.split('\n').slice(0, 6).join(' | ') : String(err);
        console.log(`FAIL ${label}: ${tc.name}: ${msg}`);
      }
    }
  }
  console.log(`${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
