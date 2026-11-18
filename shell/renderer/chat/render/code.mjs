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
import { isPage, pageOf, blockOf, pageBlocks, withEdits } from './page.mjs';
import { pageSandbox, fencesOf, readEdits } from './page-run.mjs';
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
  // blocks (render/page.mjs). The sandbox's walls hold: no network, nothing from disk. One page runs at a time: this
  // Preview, another one, or the Page panel beside the chat (render/page-panel.mjs, VIBE_PAGE_PLAN) share it.
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
      const threadId = () => String((app.state && app.state.threadId) || '');
      /** @type {() => void} */ let showCode = () => {};
      const start = async () => {
        if (stopRunning && stopRunning !== showCode) stopRunning();   // the other page goes back to its code
        stopRunning = showCode;
        stop();
        const { msgId, figs, fences: model } = fencesOf(fig);
        const pageIndex = figs.indexOf(fig);
        if (pageIndex >= 0) model[pageIndex].code = info.code;
        // A person's edits from the Page panel run here too (the block says "edited").
        const fences = withEdits(model, await readEdits(app, threadId(), msgId));
        const page = pageOf(pageIndex >= 0 ? fences[pageIndex].code : info.code, fences, { pageIndex });
        say(page.remote.length ? t('render.pageNoInternet', { hosts: page.remote.join(', ') }) : '');
        const sandbox = await pageSandbox();
        if (stopRunning !== showCode) return;                         // Code was pressed while it loaded
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
        const blocks = pageBlocks(fences);
        /** @param {any} err */
        const fault = (err) => {
          const at = blockOf(err, page.sources);
          const b = at ? blocks.find((x) => x.fence === at.fence) : null;
          const message = String((err && err.message) || '');
          say(at && b ? t('render.pageErrorAt', { block: blockName(b), line: at.line, message }) : t('render.pageError', { message }));
        };
        h.on((/** @type {any} */ ev) => {
          if (h !== handle) return;
          if (ev.type === 'error' && ev.error) fault(ev.error);
          if (ev.type === 'state' && ev.state === 'stalled') say(t('render.pageStopped'));
          // The Page panel (or another sandbox user) took the guest: back to the code, nothing left running here.
          if (ev.type === 'stopped' && ev.why === 'replaced' && stopRunning === showCode) { handle = null; showCode(); }
        });
        const out = await h.ready;
        if (h === handle && out && !out.ok) fault(out.error);
      };
      showCode = addTabs(fig, pane, {
        previewTip: t('render.pageTabTip'), codeTip: t('render.pageCodeTip'),
        onPreview: () => { void start(); },
        onCode: () => { stop(); if (stopRunning === showCode) stopRunning = null; },
      });

      // Beside the chat (VIBE_PAGE_PLAN): the page and its code side by side, edited live. Only when the panel is in.
      const tools = fig.querySelector('.chat-code-tools');
      const edited = document.createElement('span');
      edited.className = 'chat-page-edited';
      edited.textContent = t('render.pageEdited');
      edited.title = t('render.pageEditedTip');
      edited.hidden = true;
      if (tools) tools.insertBefore(edited, tools.firstChild);
      const { msgId } = fencesOf(fig);
      if (msgId) void readEdits(app, threadId(), msgId).then((e) => { edited.hidden = !e; });
      if (tools && app.page && typeof app.page.open === 'function') {
        const beside = button(t('render.pageBeside'), 'chat-page-beside', () => {
          if (stopRunning === showCode) showCode();                   // the panel takes the one guest
          const f = fencesOf(fig);
          const pageIndex = f.figs.indexOf(fig);
          if (pageIndex >= 0) f.fences[pageIndex].code = info.code;
          app.page.open({ threadId: threadId(), msgId: f.msgId, fences: f.fences, pageIndex });
        });
        beside.title = t('render.pageBesideTip');
        tools.insertBefore(beside, edited.nextSibling);
      }
    },
  });
}

/** A block of a page, as a person reads its name: "JavaScript", or "JavaScript 2" when there are two.
 * @param {{kind: 'html'|'css'|'js', n: number, of: number}} b @returns {string} */
export function blockName(b) {
  const kind = b.kind === 'html' ? t('render.pageBlockHtml') : b.kind === 'css' ? t('render.pageBlockCss') : t('render.pageBlockJs');
  return b.of > 1 ? t('render.pageBlockN', { kind, n: b.n }) : kind;
}

/** What a page without its own colours is drawn on: a page, not the chat's dark ground. Its own CSS comes after. */
export const PAGE_BASE_CSS ='body{background:#fff;color:#111;font-family:system-ui,sans-serif;}\n';

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
