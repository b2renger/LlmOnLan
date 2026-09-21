// @ts-check
import fs from 'node:fs';
import path from 'node:path';

// The P1 landing's LOOK-AT-IT scenario (integrator-owned), the sibling of `p0-skeleton-{dark,light}`.
//
// P0 could only photograph an empty skeleton. P1 is the cut-over: index.html now loads
// chat/main.mjs, styles.css no longer carries a single LOL Chat rule, and everything on screen comes
// from chat/css/{base,composer,sidebar,dialogs,thread,markdown}.css. A stylesheet that fails to load,
// a token that resolves to nothing, a code header that collapses, a light theme that keeps painting
// dark text — none of that shows up in a behavioural assertion, so this scenario builds a chat with
// real content in it (two threads; reasoning, markdown, a fenced code block with its chrome, a stats
// line) and writes the two PNGs the landing looks at.
//
// It also asserts what a reviewer would otherwise have to eyeball: the page does not scroll
// sideways, the code chrome is laid out, both themes really differ, nothing collapses.
// `h.screenshot()` works in a hidden window since the P1 landing (run.js keeps a tiny CDP screencast
// running so the compositor produces frames), so a null here is a real failure, not the old
// "rerun with --show".

/** Fail loudly if the loader faked a module these pictures are supposed to show. */
const requireReal = (/** @type {any} */ h, /** @type {string[]} */ keys) =>
  h.eval((ks) => {
    const failed = (window.LolChat && window.LolChat.failed) || {};
    const missing = ks.filter((k) => failed[k]);
    if (missing.length) throw new Error('p1-shots needs the REAL modules, but the loader faked: ' + missing.join(', '));
    return true;
  }, keys);

const pickModel = async (/** @type {any} */ h, /** @type {string} */ id) => {
  await h.waitFor((want) => {
    const s = /** @type {any} */ (document.getElementById('chat-model'));
    return s && Array.prototype.some.call(s.options, (o) => o.value === want) ? true : null;
  }, { args: [id], timeout: 20000 });
  await h.eval((want) => {
    const s = /** @type {any} */ (document.getElementById('chat-model'));
    s.value = want;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return s.value;
  }, id);
};

/** Send into the CURRENT thread (§2.6 P: h.submit always starts a new one). */
const sendHere = (/** @type {any} */ h, /** @type {string} */ text) => h.eval((v) => {
  const input = /** @type {any} */ (document.getElementById('chat-input'));
  const form = /** @type {any} */ (document.getElementById('chat-form'));
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (setter && setter.set) setter.set.call(input, v); else input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  form.requestSubmit();
  return true;
}, text);

/**
 * Wait until the open thread holds `rows` messages and the last one is finished.
 * `h.waitReply()` alone is not enough for a second send into the SAME thread: it returns as soon as
 * the LAST assistant row carries stats, and for a beat after requestSubmit() that is still the
 * PREVIOUS reply — the scenario then photographs a half-streamed answer.
 */
const waitSettled = (/** @type {any} */ h, /** @type {number} */ rows) => h.waitFor((want) => {
  const all = document.querySelectorAll('.chat-msg');
  if (all.length !== want) return null;
  const last = all[all.length - 1];
  if (last.getAttribute('data-status') !== 'done') return null;
  const stats = last.querySelector('.chat-stats');
  return stats && stats.textContent.trim() ? true : null;
}, { args: [rows], timeout: 45000 });

/** Build the chat the screenshots show. Each scenario starts from `fresh`, so it is self-contained. */
async function buildScene(/** @type {any} */ h) {
  await h.fresh();
  await requireReal(h, ['view', 'controller', 'composer', 'sidebar', 'picker']);

  // Thread 1 — a short exchange, so the sidebar has a second row above the active one.
  await pickModel(h, 'mock-echo');
  await h.submit('What can you do?');
  await waitSettled(h, 2);

  // Thread 2 — reasoning first, then the markdown fixture in the SAME thread, so one picture carries
  // a settled reasoning block, prose, a list, a table and a fenced block with its chrome.
  await pickModel(h, 'mock-think-tags');
  await h.submit('Plan a small thing, thinking out loud first.');
  await waitSettled(h, 2);
  await pickModel(h, 'mock-md');
  await sendHere(h, 'Now show me the whole formatting range.');
  await waitSettled(h, 4);

  // Scroll the code block into view: a photograph of blank prose proves nothing about the chrome.
  await h.eval(() => {
    const pre = document.querySelector('#chat-messages pre');
    if (pre) pre.scrollIntoView({ block: 'center' });
    return !!pre;
  });
  await new Promise((r) => setTimeout(r, 300));
}

/** Everything a reviewer would check by eye, checked by machine. Runs in the page. */
const inspect = () => {
  const q = (s) => document.querySelector(s);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const fig = q('#chat-messages figure.chat-codeblock');
  const pre = fig ? fig.querySelector('pre') : null;
  const header = q('#chat-messages .chat-code-head');
  const stats = Array.prototype.slice.call(document.querySelectorAll('.chat-stats')).pop();
  const root = q('#lolchat');
  return {
    theme: document.documentElement.className,
    bg: cs(root).backgroundColor,
    text: cs(root).color,
    sideBg: cs(q('#lolchat .chat-side')).backgroundColor,
    threads: document.querySelectorAll('#chat-threads .chat-thread').length,
    active: document.querySelectorAll('#chat-threads .chat-thread.active').length,
    rows: document.querySelectorAll('.chat-msg').length,
    reasoning: document.querySelectorAll('details.chat-reasoning').length,
    fences: document.querySelectorAll('#chat-messages pre').length,
    tables: document.querySelectorAll('#chat-messages table').length,
    codeBg: cs(fig) ? cs(fig).backgroundColor : null,
    noteBg: cs(q('#chat-messages .chat-msg-note')) ? cs(q('#chat-messages .chat-msg-note')).backgroundColor : null,
    userBg: cs(q('#chat-messages .chat-msg.user')) ? cs(q('#chat-messages .chat-msg.user')).backgroundColor : null,
    codeRadius: cs(fig) ? cs(fig).borderTopLeftRadius : null,
    codeText: pre ? pre.textContent.trim().slice(0, 24) : '',
    headerTag: header ? header.tagName.toLowerCase() : null,
    headerDisplay: cs(header) ? cs(header).display : null,
    headerText: header ? header.textContent.trim().slice(0, 40) : '',
    stats: stats ? stats.textContent.trim() : '',
    docScrollX: document.documentElement.scrollWidth,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    messages: rect(q('#chat-messages')),
    form: rect(q('#chat-form')),
    side: rect(q('#lolchat .chat-side')),
  };
};

/** The biggest per-channel distance between two `rgb(...)` strings (0 when either is missing). */
function step(/** @type {string|null} */ a, /** @type {string|null} */ b) {
    // `color-mix()` computes to `color(srgb r g b)` in Chromium: 0..1 floats, not 0..255.
    const nums = (/** @type {string|null} */ x) => {
        const str = String(x || '');
        const parts = (str.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        return /^color\(/.test(str) ? parts.map((n) => n * 255) : parts;
    };
    const p = nums(a);
    const q2 = nums(b);
    if (p.length < 3 || q2.length < 3) return 0;
    return Math.max(Math.abs(p[0] - q2[0]), Math.abs(p[1] - q2[1]), Math.abs(p[2] - q2[2]));
}

function check(/** @type {any} */ h, /** @type {any} */ m, /** @type {string} */ theme) {
  h.eq(m.theme, theme, 'the <html> class did not switch');
  h.eq(m.threads, 2, 'the sidebar should list both threads (got ' + m.threads + ')');
  h.eq(m.active, 1, 'exactly one thread row is the active one');
  h.eq(m.rows, 4, 'the open thread should show four message rows (got ' + m.rows + ')');
  h.assert(m.reasoning >= 1, 'no reasoning block in the picture');
  h.assert(m.fences >= 1, 'no fenced code block in the picture');
  h.assert(m.tables >= 1, 'no table in the picture');
  h.assert(m.headerDisplay === 'flex', 'the code header is not laid out (' + m.headerTag + ', display: ' + m.headerDisplay + ')');
  h.assert(m.codeBg && m.codeBg !== 'rgba(0, 0, 0, 0)', 'the code block has no surface colour — css/markdown.css did not apply');
  h.assert(m.codeRadius === '10px', 'the code block lost its 10 px radius (' + m.codeRadius + ')');
  h.assert(m.codeText.length > 3, 'the code block is empty');
  h.assert(/^\d+ tok · [\d.]+ tok\/s · first token \d+\.\d\ds$/.test(m.stats), 'the stats line is not the parity format: "' + m.stats + '"');
  h.assert(m.bg && m.bg !== 'rgba(0, 0, 0, 0)', 'the chat has no background — chat/chat.css did not load');
  h.assert(m.sideBg !== m.bg, 'the sidebar does not stand out from the background');
  // A PANEL has to read as a panel in BOTH themes: --surface is 15/255 from --bg in dark but only
  // 5/255 in light, so a fence, a note and the user bubble used to melt into the light page.
  h.assert(m.codeBg !== m.bg, 'the code block is the same colour as the page (' + m.codeBg + ')');
  h.assert(step(m.codeBg, m.bg) >= 8, 'the code block barely steps off the page: ' + m.codeBg + ' vs ' + m.bg);
  h.assert(step(m.userBg, m.bg) >= 8, 'the user bubble barely steps off the page: ' + m.userBg + ' vs ' + m.bg);
  h.assert(m.docScrollX <= m.viewportW, 'the page scrolls sideways (' + m.docScrollX + ' > ' + m.viewportW + ')');
  h.assert(m.side.x === 0 && m.side.h > 400, 'the sidebar is not a full-height left column');
  h.assert(m.messages.h > 200, 'the message area collapsed to ' + m.messages.h + ' px');
  h.assert(m.form.y + m.form.h <= m.viewportH + 1, 'the composer is not inside the viewport');
}

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
  const shot = await h.screenshot(name);
  h.assert(!!shot, name + ': no screenshot was produced — the CDP frame pump in run.js is what makes a hidden window paint');
  const size = fs.statSync(shot).size;
  h.assert(size > 4000, name + ': the screenshot is only ' + size + ' bytes — the window painted nothing');
  h.note('screenshot ' + path.basename(shot) + ' (' + size + ' bytes)');
}

export default [
  {
    name: 'p1-shots-dark',
    needsMock: true,
    timeoutMs: 120000,
    run: async (h) => {
      await buildScene(h);
      await h.eval(() => { document.documentElement.className = 'dark'; return true; });
      const m = await h.eval(inspect);
      check(h, m, 'dark');
      h.note('dark: bg ' + m.bg + ', side ' + m.sideBg + ', code ' + m.codeBg + ', "' + m.stats + '"');
      await shoot(h, 'p1-shots-dark');
    },
  },
  {
    name: 'p1-shots-light',
    needsMock: true,
    timeoutMs: 120000,
    run: async (h) => {
      await buildScene(h);
      try {
        await h.eval(() => { document.documentElement.className = 'light'; return true; });
        const m = await h.eval(inspect);
        check(h, m, 'light');
        h.assert(m.text !== 'rgb(228, 228, 231)', 'the light theme still paints the dark text colour');
        h.note('light: bg ' + m.bg + ', side ' + m.sideBg + ', code ' + m.codeBg + ', "' + m.stats + '"');
        await shoot(h, 'p1-shots-light');
      } finally {
        await h.eval(() => { document.documentElement.className = 'dark'; return true; });
      }
    },
  },
];
