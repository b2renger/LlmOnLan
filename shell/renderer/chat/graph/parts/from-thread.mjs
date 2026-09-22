// @ts-check
// From thread (C2) — the bridge INTO the graph (spec §3, plan §2.6 BH-1): the current answer, the
// last question, or one chosen message, as a value on the canvas.
//
// It reads the conversation through `app.repo.getPath()` and NOTHING else: no DOM scraping, no
// thread-view internals (§2.6 AE gives that subtree to the view), no farm call. `getPath()` is the
// same door the controller reads, so the part always sees the branch the reader is actually on —
// a message on an abandoned branch is not "the last answer", and this part must not disagree with
// the transcript in front of them.
//
// WHERE IT REFUSES rather than inventing (§1.2):
//   - no conversation at all               parts.errNoThread
//   - nothing of that kind in the thread   parts.errNoMessage
//   - the answer is still streaming        parts.errStillWriting — half an answer looks exactly
//                                          like a whole one once it is a value on the canvas
//   - the message carries no text          parts.errEmptyMessage
// Images are deliberately NOT pulled here: P3's attachment intake has not landed, so `Look` and
// image values are deferred out of C2 (BH-10). This part answers `text`.
//
// LEGACY AT K1 (COMPUTER_PLAN §3.2, §11 K1-U3). The Computer is its own surface now and has no
// conversation to read, so this part is out of `partSpecs()`'s palette — you cannot place a new
// one — and stays in `specMap()` only so a MIGRATED graph that already contains one opens instead
// of tripping `part:unknown-type`. It therefore has to explain itself on the canvas: a `legacy`
// badge with the one sentence that says what to do about it. The refusal in run() is unchanged
// (`parts.errNoThread`) — it was already the right sentence, and the chat panel still has threads
// until the K1 landing deletes it.

import { valueOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { pickerRow, setPicked, partFail } from './common.mjs';
import '../../strings/computer.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const SOURCES = ['lastAnswer', 'lastQuestion', 'message'];

/** How much of a message the chooser shows in one option. */
const OPTION_CHARS = 60;

/** @param {any} settings @returns {string} */
export function sourceOf(settings) {
  const source = String((settings && settings.source) || 'lastAnswer');
  return SOURCES.includes(source) ? source : 'lastAnswer';
}

/**
 * Pick the message this part means out of a thread path — PURE, and what the unit test asserts.
 * `lastAnswer` / `lastQuestion` scan from the END, which is what "the current answer" means on a
 * branch; `message` is an explicit id and never falls back to a neighbour (a silently substituted
 * message is the wrong answer with a confident face).
 * @param {any[]} path @param {{source?: string, messageId?: string}} settings @returns {any|null}
 */
export function pick(path, settings) {
  const rows = Array.isArray(path) ? path : [];
  const source = sourceOf(settings);
  if (source === 'message') {
    const id = String((settings && settings.messageId) || '');
    return (id && rows.find((m) => m && m.id === id)) || null;
  }
  const role = source === 'lastQuestion' ? 'user' : 'assistant';
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i] && rows[i].role === role) return rows[i];
  return null;
}

/**
 * The text of a message: `content` when it has one, otherwise the text parts joined. PURE.
 * A message whose only parts are attachments has no text, which is a refusal, not ''.
 * @param {any} msg @returns {string}
 */
export function messageText(msg) {
  if (!msg) return '';
  const content = typeof msg.content === 'string' ? msg.content : '';
  if (content.trim()) return content;
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  return parts
    .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

/** One line for the chooser: who said it, then the beginning of what they said. PURE.
 * @param {any} msg @returns {string} */
export function optionLabel(msg) {
  const who = msg && msg.role === 'user' ? t('parts.fromThreadWhoYou') : t('parts.fromThreadWhoAssistant');
  const body = messageText(msg).replace(/\s+/g, ' ').trim();
  const short = body.length > OPTION_CHARS ? `${body.slice(0, OPTION_CHARS)}…` : body;
  return t('parts.fromThreadOption', { who, text: short });
}

/** @type {PartSpec} */
export const fromThread = /** @type {any} */ ({
  type: 'from-thread',
  order: 110,
  label: t('parts.fromThreadLabel'),
  thinks: false,
  size: { w: 250, h: 160 },
  inputs: [],
  output: 'text',
  defaults: () => ({ source: 'lastAnswer', messageId: '' }),

  render(host, part, ctx) {
    let dead = false;
    // chat-lint rule 5: literal t() keys, never a key built from the source id (§2.6 BH-12).
    const options = [
      { value: 'lastAnswer', label: t('parts.fromThreadSource_lastAnswer') },
      { value: 'lastQuestion', label: t('parts.fromThreadSource_lastQuestion') },
      { value: 'message', label: t('parts.fromThreadSource_message') },
    ];
    const source = pickerRow(t('parts.fromThreadSource'), options, sourceOf(part.settings), (v) => {
      ctx.update({ source: v });
      ctx.commit(t('parts.fromThreadLabel'));
      paint({ source: v });
      if (v === 'message') load();
    });

    const chooser = pickerRow(t('parts.fromThreadMessage'), [], String(part.settings.messageId || ''), (v) => {
      ctx.update({ messageId: v });
      ctx.commit(t('parts.fromThreadMessage'));
    });
    const select = /** @type {any} */ (chooser.querySelector('select'));
    // The conversation grows while the panel is open. Reload on FOCUS rather than on a timer:
    // rule 13 bans setInterval outright, and a list nobody is looking at does not need to be right.
    select.addEventListener('focus', () => load());

    const hint = document.createElement('p');
    hint.className = 'graph-part-note';
    hint.textContent = t('parts.fromThreadHint');

    // The legacy strip (K1-U3). `.graph-part-error` is the already-styled "this cannot run, here
    // is why" strip — which is exactly what this is, permanently, on the standalone surface.
    const legacy = document.createElement('p');
    legacy.className = 'graph-part-error graph-part-legacy';
    const tag = document.createElement('strong');
    tag.textContent = t('computer.legacyBadge');
    const why = document.createElement('span');
    why.textContent = ` ${t('computer.legacyNoThread')}`;
    legacy.append(tag, why);

    host.replaceChildren(legacy, source, chooser, hint);

    /** Fill the chooser from the thread the reader is actually on. */
    async function load() {
      const app = ctx.app;
      const repo = app && app.repo;
      const threadId = app && app.state ? app.state.threadId : null;
      if (!repo || typeof repo.getPath !== 'function' || !threadId) return;
      /** @type {any[]} */ let path = [];
      try { path = await repo.getPath(threadId); } catch (err) { void err; return; }
      if (dead) return;
      const picked = String((ctx.part && ctx.part.settings && ctx.part.settings.messageId) || '');
      select.replaceChildren();
      if (!path.length) {
        const none = document.createElement('option');
        none.value = '';
        none.textContent = t('parts.fromThreadNoMessages');
        select.appendChild(none);
      }
      for (const msg of path) {
        const opt = document.createElement('option');
        opt.value = String(msg.id);
        opt.textContent = optionLabel(msg);
        select.appendChild(opt);
      }
      setPicked(select, picked);
    }

    /** The chooser exists only for the source that uses one. @param {any} s */
    function paint(s) { chooser.hidden = sourceOf(s) !== 'message'; }
    paint(part.settings);
    if (sourceOf(part.settings) === 'message') load();

    return {
      update(next) {
        const ss = /** @type {any} */ (source.querySelector('select'));
        if (ss && document.activeElement !== ss) ss.value = sourceOf(next.settings);
        if (document.activeElement !== select) setPicked(select, String(next.settings.messageId || ''));
        paint(next.settings);
      },
      destroy() { dead = true; host.replaceChildren(); },
    };
  },

  async run(input) {
    const thread = input.thread;
    const repo = input.app && input.app.repo;
    if (!thread || !repo || typeof repo.getPath !== 'function') throw partFail(t('parts.errNoThread'), 'invalid');
    const path = await repo.getPath(thread.id);
    const msg = pick(path, input.part.settings || {});
    if (!msg) throw partFail(t('parts.errNoMessage'), 'empty');
    if (msg.status === 'streaming') throw partFail(t('parts.errStillWriting'), 'empty');
    const text = messageText(msg);
    if (!text.trim()) throw partFail(t('parts.errEmptyMessage'), 'empty');
    return valueOf('text', text);
  },
});
