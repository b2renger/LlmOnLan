// @ts-check
/**
 * render/code.mjs - the code chrome (P1-U3). A loader FEATURE: it exports `install(app)` only, and
 * the chat works without it (a fence still renders, it just has no header bar).
 *
 * It registers two CODE_DECORATORS. render/thread-view.mjs calls them through the stream
 * renderer's onBlockReady hook - when a fence CLOSES mid-stream and again for every fence when the
 * message is final - and it, not this file, guarantees a decorator runs at most once per node
 * (the `data-deco` list on the figure). The streaming TAIL is never decorated (plan §3.8).
 *
 *   code-chrome (order 100)  every fence: a header bar with the language, Copy and Wrap.
 *   code-svg    (order 200)  a FINISHED svg fence (or an xml one whose code starts with "<svg"):
 *                            Preview / Code tabs. The image is built by render/dom.mjs `svgImg`,
 *                            the single place in LOL Chat that may create an <img>, from a data:
 *                            URL it encodes itself - the picture never touches the network.
 *   code-page   (order 210)  a FINISHED web page (html, htm, or an untagged block that starts like one): Preview
 *                            runs it, with the answer's CSS and JavaScript blocks, in the sandbox's live guest
 *                            (render/page.mjs; no network, nothing from disk).
 *
 * Wrap is one preference for the whole chat, persisted in kv `ui:wrap` (§3.4 repo.kvGet/kvSet), so
 * a reader who wants long lines wrapped says so once.
 */

import { domFactory } from './dom.mjs';
import { isPage, pageOf } from './page.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/render.en.mjs';

const WRAP_KEY = 'ui:wrap';

/** Copy text, preferring the async clipboard and falling back to a hidden textarea. */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    void err;                       // fall through to the textarea
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (err) {
    void err;
    return false;
  }
}

/** A chrome button (never part of the model's text, so plain createElement is right here). */
function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chat-code-btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(b);
  });
  return b;
}

/** @param {import('../core/types.mjs').App} app */
export function install(app) {
  let wrap = false;
  const messages = app.els && app.els.messages;

  const applyWrap = () => {
    if (!messages) return;
    for (const fig of messages.querySelectorAll('figure.chat-codeblock')) {
      fig.setAttribute('data-wrap', wrap ? '1' : '0');
    }
    for (const b of messages.querySelectorAll('.chat-code-wrap')) {
      b.textContent = wrap ? t('render.wrapOff') : t('render.wrapOn');
      /** @type {HTMLElement} */ (b).title = wrap ? t('render.wrapOffTip') : t('render.wrapOnTip');
      b.setAttribute('aria-pressed', wrap ? 'true' : 'false');
    }
  };

  if (app.repo && typeof app.repo.kvGet === 'function') {
    Promise.resolve(app.repo.kvGet(WRAP_KEY, false)).then((v) => {
      wrap = !!v;
      applyWrap();
    }).catch(() => { /* the store is the chat's, not the chrome's, problem */ });
  }

  app.registry.add(app.SLOTS.CODE_DECORATORS, {
    id: 'code-chrome',
    order: 100,
    match: () => true,
    /** @param {HTMLElement} fig @param {{lang: string, code: string}} info */
    decorate(fig, info) {
      const head = document.createElement('figcaption');
      head.className = 'chat-code-head';

      const lang = document.createElement('span');
      lang.className = 'chat-code-lang';
      lang.textContent = info.lang || t('render.codePlain');

      const tools = document.createElement('span');
      tools.className = 'chat-code-tools';

      const wrapBtn = button(wrap ? t('render.wrapOff') : t('render.wrapOn'), 'chat-code-wrap', () => {
        wrap = !wrap;
        applyWrap();
        if (app.repo && typeof app.repo.kvSet === 'function') {
          Promise.resolve(app.repo.kvSet(WRAP_KEY, wrap)).catch(() => { /* memory store */ });
        }
      });
      wrapBtn.setAttribute('aria-pressed', wrap ? 'true' : 'false');
      wrapBtn.title = wrap ? t('render.wrapOffTip') : t('render.wrapOnTip');

      const copyBtn = button(t('render.copyCode'), 'chat-code-copy', async (b) => {
        const ok = await copyText(info.code);
        if (!ok) return;
        b.textContent = t('render.copied');
        setTimeout(() => { b.textContent = t('render.copyCode'); }, 1200);
      });
      copyBtn.title = t('render.copyCodeTip');

      tools.append(wrapBtn, copyBtn);
      head.append(lang, tools);
      fig.insertBefore(head, fig.firstChild);
      fig.setAttribute('data-wrap', wrap ? '1' : '0');
    },
  });

  app.registry.add(app.SLOTS.CODE_DECORATORS, {
    id: 'code-svg',
    order: 200,
    /** @param {{lang: string, code: string, final: boolean}} info */
    match: (info) => !!info.final && (
      info.lang === 'svg' || (info.lang === 'xml' && String(info.code).trim().toLowerCase().startsWith('<svg'))
    ),
    /** @param {HTMLElement} fig @param {{lang: string, code: string}} info */
    decorate(fig, info) {
      const H = domFactory(document);
      const img = H.svgImg(info.code);
      if (!img) return;                       // not an SVG we are willing to draw
      img.alt = t('render.svgAlt');           // the drawing is otherwise nameless to a screen reader

      const pane = document.createElement('div');
      pane.className = 'chat-svg-preview';
      pane.hidden = true;
      pane.appendChild(img);
      fig.appendChild(pane);

      addTabs(fig, pane, { previewTip: t('render.tabPreviewTip'), codeTip: t('render.tabCodeTip') });
    },
  });

  // A web page in an answer (owner, 2026-11-14: LOL Vibe "should be rewarding right away"): Preview runs it here, in
  // the chat's OWN sandbox (never the Computer's: one live guest per sandbox), with the answer's CSS and JavaScript
  // blocks (render/page.mjs). The sandbox's walls hold: no network, nothing from disk. One page runs at a time.
  /** @type {any} */ let sandbox = null;
  /** @type {null | (() => void)} */ let stopRunning = null;
  app.registry.add(app.SLOTS.CODE_DECORATORS, {
    id: 'code-page',
    order: 210,
    /** @param {{lang: string, code: string, final: boolean}} info */
    match: (info) => !!info.final && isPage(info),
    /** @param {HTMLElement} fig @param {{lang: string, code: string}} info */
    decorate(fig, info) {
      const pane = document.createElement('div');
      pane.className = 'chat-page-preview';
      pane.hidden = true;
      const note = document.createElement('p');
      note.className = 'chat-page-note';
      note.hidden = true;
      const stage = document.createElement('div');
      stage.className = 'chat-page-stage';
      pane.append(note, stage);
      fig.appendChild(pane);
      /** @type {any} */ let handle = null;
      const say = (/** @type {string} */ text) => { note.textContent = text; note.hidden = !text; };
      const stop = () => {
        if (handle) { try { handle.stop(); } catch { /* gone */ } }
        handle = null;
        stage.replaceChildren();
      };
      /** @type {() => void} */ let showCode = () => {};
      const start = async () => {
        if (stopRunning && stopRunning !== showCode) stopRunning();   // the other page goes back to its code
        stopRunning = showCode;
        stop();
        const msg = fig.closest('.chat-msg') || fig.parentElement || fig;
        const fences = Array.from(msg.querySelectorAll('figure.chat-codeblock')).map((f) => ({
          lang: f.getAttribute('data-lang') || '',
          code: f === fig ? info.code : String((f.querySelector('pre') || {}).textContent || ''),
        }));
        const page = pageOf(info.code, fences);
        say(page.remote.length ? t('render.pageNoInternet', { hosts: page.remote.join(', ') }) : '');
        if (!sandbox) sandbox = (await import('../sandbox/host.mjs')).createSandbox({ doc: document });
        // The pane's width as shown (Preview has just shown it); 640 when the chat is out of sight and nothing is laid out.
        // ponytail: the size is taken once; a window resized later keeps it (the pane scrolls). Press Preview again to refit.
        // ponytail: this page keeps running while the person is in the Computer (its own guest, its own process);
        // Code or another page's Preview stops it; leaving the thread takes the frame away, and the guest's
        // watchdog then ends it (no answer to its ping).
        const w = Math.max(240, Math.min(1200, Math.floor(pane.clientWidth || fig.clientWidth || 640)));
        const h = handle = sandbox.live({
          mount: stage, mode: 'html', code: page.html, css: PAGE_BASE_CSS + page.css, libs: page.libs,
          size: { w, h: 420 }, page: true,
        });
        h.on((/** @type {any} */ ev) => {
          if (h !== handle) return;
          if (ev.type === 'error' && ev.error) say(t('render.pageError', { message: String(ev.error.message || '') }));
          if (ev.type === 'state' && ev.state === 'stalled') say(t('render.pageStopped'));
        });
        const out = await h.ready;
        if (h === handle && out && !out.ok) say(t('render.pageError', { message: String((out.error && out.error.message) || '') }));
      };
      showCode = addTabs(fig, pane, {
        previewTip: t('render.pageTabTip'), codeTip: t('render.pageCodeTip'),
        onPreview: () => { void start(); },
        onCode: () => { stop(); if (stopRunning === showCode) stopRunning = null; },
      });
    },
  });
}

/** What a page without its own colours is drawn on: a page, not the chat's dark ground. Its own CSS comes after. */
const PAGE_BASE_CSS = 'body{background:#fff;color:#111;font-family:system-ui,sans-serif;}\n';

/**
 * The Preview / Code tabs of a code block that can be shown (an SVG drawn, a web page run). Code is the default view.
 * @param {HTMLElement} fig @param {HTMLElement} pane
 * @param {{previewTip: string, codeTip: string, onPreview?: () => void, onCode?: () => void}} o
 * @returns {() => void} back to Code, as a click on Code does
 */
function addTabs(fig, pane, o) {
  const pre = fig.querySelector('pre');
  const tabs = document.createElement('span');
  tabs.className = 'chat-code-tabs';
  /** @type {HTMLElement[]} */ const all = [];
  const show = (/** @type {boolean} */ preview) => {
    pane.hidden = !preview;
    if (pre) pre.hidden = preview;
    for (const b of all) b.setAttribute('aria-pressed', String(b.dataset.tab === (preview ? 'preview' : 'code')));
  };
  const previewBtn = button(t('render.tabPreview'), 'chat-code-tab', () => { show(true); if (o.onPreview) o.onPreview(); });
  previewBtn.dataset.tab = 'preview';
  previewBtn.title = o.previewTip;
  const back = () => { show(false); if (o.onCode) o.onCode(); };
  const codeBtn = button(t('render.tabCode'), 'chat-code-tab', back);
  codeBtn.dataset.tab = 'code';
  codeBtn.title = o.codeTip;
  all.push(previewBtn, codeBtn);
  tabs.append(previewBtn, codeBtn);

  const head = fig.querySelector('.chat-code-tools') || fig.querySelector('.chat-code-head');
  if (head) head.insertBefore(tabs, head.firstChild);
  else fig.insertBefore(tabs, fig.firstChild);
  show(false);                            // Code is the default view, in both render paths
  return back;
}
