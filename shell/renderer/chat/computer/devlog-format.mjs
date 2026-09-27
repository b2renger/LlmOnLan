// @ts-check
// What the Computer's debug log WRITES (COMPUTER_PLAN addendum KG). PURE — no DOM, no network,
// no globals — so what goes into a person's bug report is pinned in Node
// (test/chat/unit/computer-devlog.test.mjs).
//
// Three promises this file keeps, whatever it is handed:
//   - no secret: a field named like a key, a token or a password is written as "[redacted]", and so
//     is a "Bearer …" string. The farm password lives in `caps.apiKey`, the OCR key in `ocr.key`;
//   - no flood: strings are clipped, data: URIs become their size, arrays and depth are bounded,
//     and every snapshot has a node budget;
//   - always JSON: cycles, functions, Maps, Errors and odd numbers come out as plain values.

/** Field names whose VALUE is never written. Exact names, not substrings: `max_tokens` stays. */
export const SECRET_KEY_RE = /^(?:authorization|cookie|set-cookie|password|passwd|secret|client_?secret|token|access_?token|refresh_?token|bearer|key|api_?key|apikey|x-api-key|master_?key|farm_?key)$/i;

const BEARER_RE = /^\s*bearer\s+\S+/i;
const DATA_URI_RE = /^data:([a-z0-9.+/-]*)[;,]/i;

/** @param {unknown} s @param {number} [n] */
export function clip(s, n = 2000) {
  const str = typeof s === 'string' ? s : String(s);
  return str.length <= n ? str : `${str.slice(0, n)}…(+${str.length - n})`;
}

/** A data: URI as its type and size, never its bytes. @param {string} s */
function dataUriNote(s) {
  const m = DATA_URI_RE.exec(s);
  const kb = Math.round((s.length * 3) / 4 / 1024);
  return `[${m && m[1] ? m[1] : 'data'} ${kb} KB]`;
}

/** A bearer token anywhere in a string: a console line, an error message, a stack. */
const BEARER_ANY_RE = /\bBearer\s+[^\s"',;)}\]]+/gi;

/** @param {string} s @param {number} max */
function cleanString(s, max) {
  if (s.startsWith('data:')) return dataUriNote(s);
  if (BEARER_RE.test(s)) return 'Bearer [redacted]';
  const out = clip(s, max);
  return /bearer/i.test(out) ? out.replace(BEARER_ANY_RE, 'Bearer [redacted]') : out;
}

/**
 * A JSON-safe copy of `value`, bounded. `max` clips strings, `depth` bounds nesting, `nodes` is the
 * whole copy's budget (a 1000-part document still fits), `items` bounds any one array.
 * @param {any} value
 * @param {{max?: number, depth?: number, nodes?: number, items?: number}} [o]
 */
export function scrub(value, o = {}) {
  const max = o.max ?? 2000;
  const maxDepth = o.depth ?? 8;
  const items = o.items ?? 200;
  let budget = o.nodes ?? 5000;
  const seen = new WeakSet();

  /** @param {any} v @param {number} d @returns {any} */
  function walk(v, d) {
    if (budget-- <= 0) return '[…]';
    if (v === null || v === undefined) return v === null ? null : undefined;
    const ty = typeof v;
    if (ty === 'string') return cleanString(v, max);
    if (ty === 'number') return Number.isFinite(v) ? v : String(v);
    if (ty === 'boolean') return v;
    if (ty === 'bigint') return String(v);
    if (ty === 'function') return '[fn]';
    if (ty === 'symbol') return String(v);
    if (d >= maxDepth) return '[…]';
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    if (v instanceof Error || (typeof v.message === 'string' && typeof v.stack === 'string')) {
      return { name: String(v.name || 'Error'), message: clip(String(v.message), max), stack: clip(String(v.stack || ''), 3000) };
    }
    if (typeof Map !== 'undefined' && v instanceof Map) return walk(Array.from(v.entries()), d);
    if (typeof Set !== 'undefined' && v instanceof Set) return walk(Array.from(v.values()), d);
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return `[${v.byteLength} bytes]`;
    if (Array.isArray(v)) {
      const out = v.slice(0, items).map((x) => walk(x, d + 1));
      if (v.length > items) out.push(`[+${v.length - items} more]`);
      return out;
    }
    if (typeof v.nodeType === 'number' && typeof v.nodeName === 'string') return `[${String(v.nodeName).toLowerCase()}]`;
    /** @type {Record<string, any>} */
    const out = {};
    for (const k of Object.keys(v)) {
      if (SECRET_KEY_RE.test(k)) { out[k] = v[k] ? '[redacted]' : v[k]; continue; }
      const w = walk(v[k], d + 1);
      if (w !== undefined) out[k] = w;
    }
    return out;
  }
  return walk(value, 0);
}

const two = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** `21:15:03.123`, local time. @param {Date} d */
export function clockOf(d) {
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** The class list of an element, SVG included (whose `className` is not a string). @param {any} el */
function classesOf(el) {
  const raw = el && typeof el.getAttribute === 'function' ? el.getAttribute('class') : null;
  return typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : [];
}

/** @param {any} el @param {string} name */
const attr = (el, name) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(name) : null);

/** `button#id.a.b` — a short CSS-ish name for one element. @param {any} el */
export function selOf(el) {
  if (!el || typeof el.tagName !== 'string') return '?';
  const id = el.id ? `#${el.id}` : '';
  const cls = classesOf(el).slice(0, 3).map((c) => `.${c}`).join('');
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

const MEANINGFUL = /^(?:comp|graph|chat|tut|lesson|palette|preview|takes|sandbox|studio|viewseg|topbar)-?/;
const CLICKABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY', 'OPTION', 'LABEL']);
const CLICKABLE_ROLES = new Set(['button', 'menuitem', 'tab', 'option', 'switch', 'checkbox', 'link', 'radio']);

/** @param {any} el */
export function isEditable(el) {
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    const ty = String(attr(el, 'type') || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(ty);
  }
  return el.isContentEditable === true || attr(el, 'contenteditable') === 'true';
}

/** @param {any} el */
export function isSecretField(el) {
  return !!el && el.tagName === 'INPUT' && String(attr(el, 'type') || '').toLowerCase() === 'password';
}

/** @param {unknown} s */
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * What a person pointed at, in words a bug report can use: the element, the one or two meaningful
 * boxes around it, the part / wire / port it belongs to, and its label. Walks at most 14 parents.
 * @param {any} target
 */
export function describeTarget(target) {
  let el = target;
  if (el && el.nodeType === 3) el = el.parentElement;            // a text node
  if (!el || typeof el.tagName !== 'string') return null;
  /** @type {Record<string, any>} */
  const out = { sel: selOf(el) };
  /** @type {string[]} */ const crumbs = [];
  let cur = el;
  for (let depth = 0; cur && depth < 14; depth++) {
    const cls = classesOf(cur);
    if (!out.part && cls.includes('graph-part')) {
      out.part = attr(cur, 'data-id');
      out.ptype = attr(cur, 'data-type');
    }
    if (!out.wire && attr(cur, 'data-wire')) out.wire = attr(cur, 'data-wire');
    if (!out.port && attr(cur, 'data-port')) out.port = attr(cur, 'data-port');
    if (depth > 0 && crumbs.length < 2 && cls.some((c) => MEANINGFUL.test(c))) crumbs.push(selOf(cur));
    if (cur.id === 'lolcomputer' || cur.id === 'lolchat') { out.in = cur.id; break; }
    cur = cur.parentElement;
  }
  if (crumbs.length) out.sel += ` < ${crumbs.join(' < ')}`;
  const role = attr(el, 'role');
  if (role) out.role = role;
  // The label of the nearest clickable thing, so a click on the icon inside a button still names it.
  // What the person SAW comes first (aria-label, then the visible text); a tooltip only when there
  // is nothing else — a title is often a paragraph, and "Record log" is what they pressed.
  // `btn` stays null unless a clickable element really was found within four levels: a click on a
  // part's background must not be "labelled" with the text of the whole canvas. The text is read
  // only when nothing cheaper names the target, and only its first few hundred characters.
  /** @type {any} */ let btn = null;
  for (let cur2 = el, i = 0; cur2 && i < 4; i++, cur2 = cur2.parentElement) {
    if (CLICKABLE_TAGS.has(cur2.tagName) || CLICKABLE_ROLES.has(String(attr(cur2, 'role') || ''))) { btn = cur2; break; }
  }
  const textOf = (/** @type {any} */ n) => squash(String(n.textContent || '').slice(0, 400));
  const label = attr(el, 'aria-label')
    || (btn && (attr(btn, 'aria-label') || textOf(btn)))
    || attr(el, 'title') || (btn ? attr(btn, 'title') : null);
  if (label) out.label = clip(squash(label), 80);
  const pressed = btn ? attr(btn, 'aria-pressed') : null;
  if (pressed) out.pressed = pressed;
  if (btn && btn.disabled === true) out.disabled = true;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    out.field = { type: String(attr(el, 'type') || el.tagName.toLowerCase()), name: attr(el, 'name') || undefined, placeholder: attr(el, 'placeholder') ? clip(attr(el, 'placeholder'), 40) : undefined };
  }
  return out;
}

/** `Ctrl+Shift+Z`, `Space`, `ArrowLeft`. @param {{key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean}} e */
export function keyOf(e) {
  const k = e.key === ' ' ? 'Space' : String(e.key || '?');
  // Shift on a bare printable key is already in the key ('Z'); with another modifier it is not.
  const shift = e.shiftKey && (k.length > 1 || e.ctrlKey || e.metaKey || e.altKey);
  const mods = [e.ctrlKey && 'Ctrl', e.metaKey && 'Meta', e.altKey && 'Alt', shift && 'Shift'].filter(Boolean);
  return mods.length ? `${mods.join('+')}+${k}` : k;
}

/** `https://host:4000/v1/chat/completions` — no query string, no fragment, no credentials. @param {string} url */
export function urlOf(url) {
  const s = String(url || '');
  const m = /^([a-z][a-z0-9+.-]*:\/\/)(?:[^@/]*@)?([^/?#]*)([^?#]*)/i.exec(s);
  return m ? `${m[1]}${m[2]}${m[3]}` : clip(s.split(/[?#]/)[0], 200);
}

/** The text and pictures in one chat message's `content`. @param {any} content */
function contentOf(content) {
  if (typeof content === 'string') return { text: clip(content, 1500) };
  if (!Array.isArray(content)) return { text: '' };
  /** @type {string[]} */ const texts = [];
  let images = 0; let kb = 0; /** @type {string[]} */ const other = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') texts.push(String(part.text || ''));
    else if (part.type === 'image_url') {
      images++;
      const u = part.image_url && typeof part.image_url.url === 'string' ? part.image_url.url : '';
      kb += Math.round((u.length * 3) / 4 / 1024);
    } else other.push(String(part.type));
  }
  /** @type {Record<string, any>} */
  const out = { text: clip(texts.join('\n'), 1500) };
  if (images) { out.images = images; out.imageKB = kb; }
  if (other.length) out.parts = other;
  return out;
}

/**
 * One outgoing request, summarised: method, URL, size, and — for a chat request — the model and
 * each message's role and (clipped) text. NEVER a header except the file name the OCR PUT carries.
 * With `o.deep === false` (a request the Computer did not make: LOL Chat's) nothing is parsed and
 * no message text is kept — method, URL and size only.
 * @param {any} input a URL string, a URL or a Request
 * @param {any} [init]
 * @param {{deep?: boolean}} [o]
 */
export function summarizeRequest(input, init, o = {}) {
  const deep = o.deep !== false;
  const isReq = input && typeof input === 'object' && typeof input.url === 'string' && typeof input.method === 'string';
  const method = String((init && init.method) || (isReq ? input.method : 'GET')).toUpperCase();
  const url = urlOf(isReq ? input.url : String(input));
  /** @type {Record<string, any>} */
  const out = { method, url };
  const headers = init && init.headers;
  const fileName = headers && typeof headers === 'object' && !Array.isArray(headers)
    ? (typeof headers.get === 'function' ? headers.get('x-filename') : (headers['X-Filename'] || headers['x-filename']))
    : null;
  if (fileName) out.file = clip(String(fileName), 120);
  const body = init ? init.body : undefined;
  if (typeof body === 'string') {
    out.bytes = body.length;
    if (deep && body.length <= 4 * 1024 * 1024 && /^\s*[[{]/.test(body)) {
      try {
        const j = JSON.parse(body);
        if (j && typeof j === 'object' && Array.isArray(j.messages)) {
          out.model = j.model;
          if (j.stream !== undefined) out.stream = !!j.stream;
          for (const k of ['max_tokens', 'temperature', 'top_p', 'seed']) if (j[k] !== undefined) out[k] = j[k];
          if (j.response_format) out.response_format = scrub(j.response_format, { max: 200, nodes: 40 });
          out.msgs = j.messages.slice(0, 40).map((/** @type {any} */ m) => ({ role: m && m.role, ...contentOf(m && m.content) }));
          if (j.messages.length > 40) out.msgsMore = j.messages.length - 40;
        } else if (j && typeof j === 'object') {
          out.keys = Object.keys(j).slice(0, 20);
        }
      } catch { out.json = false; }
    }
  } else if (body && typeof body === 'object') {
    const n = typeof body.byteLength === 'number' ? body.byteLength : (typeof body.size === 'number' ? body.size : null);
    if (n != null) out.bytes = n;
  }
  return out;
}

/**
 * What one undoable edit changed, part by part and wire by wire. Settings values are written
 * (clipped), because "I changed the prompt and then…" is most bug reports.
 * @param {any} prev @param {any} next
 */
export function docDelta(prev, next) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!next) return out;
  if (!prev || prev.id !== next.id) {
    out.opened = next.id;
    return out;
  }
  if ((prev.title || '') !== (next.title || '')) out.title = clip(next.title || '', 120);
  const before = new Map((prev.parts || []).map((/** @type {any} */ p) => [p.id, p]));
  const after = new Map((next.parts || []).map((/** @type {any} */ p) => [p.id, p]));
  /** @type {any[]} */ const added = []; /** @type {any[]} */ const removed = [];
  /** @type {any[]} */ const moved = []; /** @type {any[]} */ const resized = []; /** @type {any[]} */ const settings = [];
  for (const [id, p] of after) {
    const q = before.get(id);
    if (!q) { added.push({ id, type: p.type, x: Math.round(p.x), y: Math.round(p.y) }); continue; }
    if (q === p) continue;
    if (q.x !== p.x || q.y !== p.y) moved.push({ id, x: Math.round(p.x), y: Math.round(p.y) });
    if (q.w !== p.w || q.h !== p.h) resized.push({ id, w: p.w, h: p.h });
    if (q.settings !== p.settings) {
      const a = q.settings || {}; const b = p.settings || {};
      /** @type {Record<string, any>} */ const changed = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[k] === b[k]) continue;
        let same = false;
        try { same = JSON.stringify(a[k]) === JSON.stringify(b[k]); } catch { same = false; }
        if (!same) changed[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : scrub(b[k], { max: 400, nodes: 60 });
      }
      if (Object.keys(changed).length) settings.push({ id, type: p.type, changed });
    }
  }
  for (const [id, q] of before) if (!after.has(id)) removed.push({ id, type: q.type });
  const wb = new Map((prev.wires || []).map((/** @type {any} */ w) => [w.id, w]));
  const wa = new Map((next.wires || []).map((/** @type {any} */ w) => [w.id, w]));
  /** @type {any[]} */ const wiresAdded = []; /** @type {any[]} */ const wiresRemoved = []; /** @type {any[]} */ const relabeled = [];
  for (const [id, w] of wa) {
    const q = wb.get(id);
    if (!q) wiresAdded.push({ id, from: w.from, to: w.to, port: w.port, label: w.label || undefined });
    else if ((q.label || '') !== (w.label || '')) relabeled.push({ id, label: w.label || '' });
  }
  for (const [id, w] of wb) if (!wa.has(id)) wiresRemoved.push({ id, from: w.from, to: w.to, port: w.port });
  if (added.length) out.added = added;
  if (removed.length) out.removed = removed;
  if (moved.length) out.moved = moved.length > 20 ? { n: moved.length, first: moved.slice(0, 20) } : moved;
  if (resized.length) out.resized = resized;
  if (settings.length) out.settings = settings;
  if (wiresAdded.length) out.wiresAdded = wiresAdded;
  if (wiresRemoved.length) out.wiresRemoved = wiresRemoved;
  if (relabeled.length) out.relabeled = relabeled;
  return out;
}

/** Console arguments as one line of text. @param {any[]} args */
export function fmtArgs(args) {
  const parts = (args || []).map((a) => {
    if (typeof a === 'string') return clip(a, 1500);
    if (a && (a instanceof Error || (typeof a.message === 'string' && typeof a.stack === 'string'))) {
      return `${a.name || 'Error'}: ${a.message}\n${clip(String(a.stack || ''), 2000)}`;
    }
    try { return clip(JSON.stringify(scrub(a, { max: 300, nodes: 80 })), 800); } catch { return String(a); }
  });
  return clip(parts.join(' '), 4000);
}

/**
 * A long animation frame, reduced to what a perf pass needs: how long, how much of it blocked,
 * and the three scripts that took longest (file, function, what invoked it).
 * @param {any} e a PerformanceLongAnimationFrameTiming (or a longtask entry)
 */
export function frameOf(e) {
  /** @type {Record<string, any>} */
  const out = { dur: Math.round(e.duration) };
  if (typeof e.blockingDuration === 'number') out.blocking = Math.round(e.blockingDuration);
  const scripts = Array.isArray(e.scripts) ? e.scripts.slice() : [];
  if (scripts.length) {
    scripts.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    out.scripts = scripts.slice(0, 3).map((s) => ({
      src: clip(String(s.sourceURL || '').split('/').slice(-2).join('/'), 80),
      fn: s.sourceFunctionName || undefined,
      at: typeof s.sourceCharPosition === 'number' && s.sourceCharPosition >= 0 ? s.sourceCharPosition : undefined,
      by: s.invoker ? clip(String(s.invoker), 80) : undefined,
      dur: Math.round(s.duration || 0),
    }));
  }
  return out;
}

/** The one-paragraph key a reader (or Claude) needs to read the file. */
export const README = 'One JSON object per line. k = kind, ts = local time, ms = ms since the page loaded, '
  + 'n = event number, pre = recorded in memory before the switch was turned on. Kinds: '
  + 'log.* (this file), ui.* (what the person did: click, key, edit, drag, wheel, drop, toast, dialog), '
  + 'doc.* (graph opened, edited, selected, panned), run.* (the runner: start, part states, end), '
  + 'http.* (farm requests and answers; no headers, no keys), err.* (uncaught errors, rejections, CSP), '
  + 'con.* (console), sbx.* (the sandbox guest), bus.* (farm, store, visibility), perf.frame (a frame over 100 ms), '
  + 'snap (the whole state), mark (a bug marked by hand: note, screenshot file, state). main.* lines come from the main process.';
