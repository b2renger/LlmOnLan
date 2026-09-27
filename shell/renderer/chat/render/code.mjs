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
 *
 * Wrap is one preference for the whole chat, persisted in kv `ui:wrap` (§3.4 repo.kvGet/kvSet), so
 * a reader who wants long lines wrapped says so once.
 */

import { domFactory } from './dom.mjs';
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

      const copyBtn = button(t('render.copyCode'), 'chat-code-copy', async (b) => {
        const ok = await copyText(info.code);
        if (!ok) return;
        b.textContent = t('render.copied');
        setTimeout(() => { b.textContent = t('render.copyCode'); }, 1200);
      });

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

      const pane = document.createElement('div');
      pane.className = 'chat-svg-preview';
      pane.hidden = true;
      pane.appendChild(img);
      fig.appendChild(pane);

      const pre = fig.querySelector('pre');
      const tabs = document.createElement('span');
      tabs.className = 'chat-code-tabs';
      /** @type {HTMLElement[]} */ const all = [];
      const show = (preview) => {
        pane.hidden = !preview;
        if (pre) pre.hidden = preview;
        for (const b of all) b.setAttribute('aria-pressed', String(b.dataset.tab === (preview ? 'preview' : 'code')));
      };
      const previewBtn = button(t('render.tabPreview'), 'chat-code-tab', () => show(true));
      previewBtn.dataset.tab = 'preview';
      const codeBtn = button(t('render.tabCode'), 'chat-code-tab', () => show(false));
      codeBtn.dataset.tab = 'code';
      all.push(previewBtn, codeBtn);
      tabs.append(previewBtn, codeBtn);

      const head = fig.querySelector('.chat-code-tools') || fig.querySelector('.chat-code-head');
      if (head) head.insertBefore(tabs, head.firstChild);
      else fig.insertBefore(tabs, fig.firstChild);
      show(false);                            // Code is the default view, in both render paths
    },
  });
}
