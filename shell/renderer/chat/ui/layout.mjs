// @ts-check
// The skeleton DOM of LOL Chat (plan §3.5) — built synchronously before any module import — plus
// the document drop guard and the inline icon helper.
//
// Contract (plan §3.2 / §3.5, frozen at P0 kickoff):
//   buildLayout(root) → Els      replaces root's children (the fallback <p>) with the skeleton.
//                                Every D-4 id/class is present. Keys: see core/types.mjs Els.
//                                `.chat-jump` (els.jump) lives INSIDE #chat-messages and starts
//                                hidden; the thread view must keep it as the LAST child of
//                                els.messages (insert rows before it, never replaceChildren() the
//                                list without re-appending it).
//   els.work/workRail/workHead/workBody (S0 kickoff, studio plan §3.5.1) are built EMPTY and
//                                hidden; ui/workbench.mjs owns all four and is the only module that
//                                may write into them.
//   installDropGuard(doc) → off  preventDefault() on document dragover/drop so a stray file drop
//                                never navigates the window. It must NEVER stop the event from
//                                propagating (lint rule 7) — #lolchat intake still receives drops.
//                                Idempotent per document.
//   icon(pathD, {size=16, label}) → SVGSVGElement
//                                pathD: one SVG path `d` string or an array of them (24×24 viewBox,
//                                Lucide style: stroke currentColor, width 2, round caps, no fill).
//                                label → role="img" + aria-label; no label → aria-hidden="true".

import { t } from '../core/i18n.mjs';
import '../strings/core.en.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {{cls?: string, id?: string, attrs?: Record<string, string>, text?: string}} [o]
 * @param {Node[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
function h(tag, o = {}, children = []) {
  const el = document.createElement(tag);
  if (o.cls) el.className = o.cls;
  if (o.id) el.id = o.id;
  if (o.attrs) for (const [k, v] of Object.entries(o.attrs)) el.setAttribute(k, v);
  if (o.text != null) el.textContent = o.text;
  for (const c of children) el.appendChild(c);
  return el;
}

/**
 * @param {HTMLElement} root  the #lolchat section
 * @returns {import('../core/types.mjs').Els}
 */
export function buildLayout(root) {
  const newBtn = h('button', { cls: 'btn-accent chat-new', id: 'chat-new', attrs: { type: 'button' }, text: t('core.newChat') });
  const sideHead = h('div', { cls: 'chat-side-head' }, [newBtn]);
  const sideTools = h('div', { cls: 'chat-side-tools' });
  const list = h('div', { cls: 'chat-threads', id: 'chat-threads', attrs: { role: 'list', 'aria-label': t('core.threadsLabel') } });
  const sideFoot = h('div', { cls: 'chat-side-foot' });
  const side = h('aside', { cls: 'chat-side' }, [sideHead, sideTools, list, sideFoot]);

  const banner = h('div', { cls: 'chat-banner' });
  const header = h('div', { cls: 'chat-thread-header' });
  const model = h('select', { cls: 'chat-model', id: 'chat-model', attrs: { title: t('core.modelTitle'), 'aria-label': t('core.modelTitle') } });
  const topline = h('div', { cls: 'chat-topline' }, [header, model]);
  const strip = h('div', { cls: 'chat-strip' });

  const jump = h('button', { cls: 'chat-jump hidden', attrs: { type: 'button' }, text: t('core.jumpLatest') });
  const messages = h('div', { cls: 'chat-messages', id: 'chat-messages', attrs: { role: 'log', 'aria-label': t('core.messagesLabel') } }, [jump]);

  const empty = h('div', { cls: 'chat-empty', id: 'chat-empty' }, [
    h('p', { text: t('core.emptyTitle') }),
    h('p', { cls: 'detail', text: t('core.emptyDetail') }),
  ]);

  const above = h('div', { cls: 'chat-composer-above' });
  const tray = h('div', { cls: 'chat-composer-tray' });
  const tools = h('div', { cls: 'chat-composer-tools' });
  const input = h('textarea', {
    id: 'chat-input',
    attrs: { rows: '1', placeholder: t('core.inputPlaceholder'), 'aria-label': t('core.inputLabel'), spellcheck: 'false' },
  });
  const meter = h('div', { cls: 'chat-composer-meter' });
  const send = h('button', { cls: 'btn-accent', id: 'chat-send', attrs: { type: 'submit' }, text: t('core.send') });
  const stop = h('button', { cls: 'btn-ghost hidden', id: 'chat-stop', attrs: { type: 'button' }, text: t('core.stop') });
  const row = h('div', { cls: 'chat-composer-row' }, [tools, input, meter, send, stop]);
  const form = h('form', { cls: 'chat-form', id: 'chat-form', attrs: { autocomplete: 'off' } }, [above, tray, row]);

  const main = h('div', { cls: 'chat-main' }, [banner, topline, strip, messages, empty, form]);

  // The workbench column (studio plan §3.5.1, S0 kickoff). It starts hidden and EMPTY: only
  // ui/workbench.mjs ever touches these four nodes (§2.6 AE). `--chat-work-w` is 0px until the
  // workbench sets a width state, so the grid is visually two columns exactly as before.
  const workRail = h('div', { cls: 'chat-work-rail' });
  const workHead = h('div', { cls: 'chat-work-head' });
  const workBody = h('div', { cls: 'chat-work-body' });
  const work = h('div', { cls: 'chat-work hidden' }, [workRail, workHead, workBody]);

  const live = h('div', { cls: 'chat-live visually-hidden', attrs: { 'aria-live': 'polite' } });

  root.replaceChildren(side, main, work, live);

  return {
    root, side, sideHead, newBtn, sideTools, list, sideFoot, main, banner, topline, header, model,
    strip, messages, jump, empty, form, above, tray, tools, input, meter, send, stop, live,
    work, workRail, workHead, workBody,
  };
}

/** @type {WeakMap<Document, () => void>} */
const guards = new WeakMap();

/**
 * @param {Document} doc
 * @returns {() => void} uninstall
 */
export function installDropGuard(doc) {
  const existing = guards.get(doc);
  if (existing) return existing;
  /** @param {Event} e */
  const prevent = (e) => { e.preventDefault(); };
  doc.addEventListener('dragover', prevent);
  doc.addEventListener('drop', prevent);
  const off = () => {
    doc.removeEventListener('dragover', prevent);
    doc.removeEventListener('drop', prevent);
    guards.delete(doc);
  };
  guards.set(doc, off);
  return off;
}

/**
 * @param {string | string[]} pathD
 * @param {{size?: number, label?: string}} [opts]
 * @returns {SVGSVGElement}
 */
export function icon(pathD, { size = 16, label } = {}) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, 'svg'));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'chat-icon');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const d of Array.isArray(pathD) ? pathD : [pathD]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}
