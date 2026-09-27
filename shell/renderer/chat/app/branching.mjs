// @ts-check
// The conversation TREE (P2-U3): regenerate, edit-and-resend, branch switching, fork and delete.
//
// A thread is a tree (state/tree.mjs); the reader always looks at ONE root→head path. Every action
// here is "write a new node, then move `thread.headId`" — nothing is ever overwritten, so the older
// answer stays one ◀ click away and survives a reload (the head is persisted on the thread record).
//
// Contract (plan §4 P2-U3, §2.6 AA):
//   install(app) → app.branching = {regenerate, editUser, switchSibling, fork, deleteSubtree}
//                  (the key list is API_KEYS.branching in core/types.mjs)
//   It also registers the SLOTS.SIBLINGS provider the controller asks for on every refreshView, and
//   listens to EV.BRANCH_SWITCH (emitted by the ◀ ▶ buttons thread-view renders).
//
// The three planners are PURE (no DOM, no store, no clock of their own) and exported for the unit
// tests: they take the thread's messages and answer WHAT to write; install() does the writing.
//
// Order of operations, and why (the view is the reason): regenerate moves the head to the parent
// FIRST, refreshes, and only then generates. The controller appends the new sibling to the path it
// is showing, so without the move the reader would watch the new answer stream UNDER the old one
// until the post-stream refresh dropped it.

import { EV } from '../core/events.mjs';
import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { indexNodes, pathTo, siblingsOf, deepestLatest } from '../state/tree.mjs';
import '../strings/tree.en.mjs';
import '../strings/dialogs.en.mjs';
import '../strings/core.en.mjs';

/** Message statuses that are the chat's own note rather than an answer — never copied as history. */
const NOTE_STATUS = new Set(['local', 'waiting']);

/** @param {any} v */
function copyValue(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(copyValue);
  /** @type {any} */
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = copyValue(x);
  return out;
}

/**
 * Regenerating `messageId` means: another child of its parent.
 * PURE.
 * @param {any[]} messages every message of the thread
 * @param {string} messageId the assistant message the reader asked to redo
 * @returns {{ok: boolean, reason?: string, threadId?: string, parentId?: string|null, siblingCount?: number}}
 */
export function planRegenerate(messages, messageId) {
  const index = indexNodes(messages || []);
  const msg = index.byId.get(messageId);
  if (!msg) return { ok: false, reason: 'unknown-message' };
  if (msg.role !== 'assistant') return { ok: false, reason: 'not-assistant' };
  const parentId = msg.parentId && index.byId.has(msg.parentId) ? msg.parentId : null;
  return {
    ok: true,
    threadId: msg.threadId,
    parentId,
    siblingCount: siblingsOf(index, messageId).count,
  };
}

/**
 * Editing a user message means: a SIBLING user message with the same parent, the parts copied and
 * the text replaced. The assistant answer is then generated as its child.
 * PURE.
 * @param {any[]} messages @param {string} messageId @param {string} text
 * @returns {{ok: boolean, reason?: string, threadId?: string, parentId?: string|null, message?: any, siblingCount?: number}}
 */
export function planEdit(messages, messageId, text) {
  const index = indexNodes(messages || []);
  const msg = index.byId.get(messageId);
  if (!msg) return { ok: false, reason: 'unknown-message' };
  if (msg.role !== 'user') return { ok: false, reason: 'not-user' };
  const next = String(text == null ? '' : text);
  if (!next.trim()) return { ok: false, reason: 'empty' };

  // Parts are copied so an image/document the reader attached survives the edit; only the FIRST
  // text part carries the message text (composer.getDraft puts it first), so that is the one the
  // new wording replaces. A message with no text part gets one, in front.
  const parts = Array.isArray(msg.parts) ? msg.parts.map(copyValue) : [];
  const at = parts.findIndex((p) => p && p.type === 'text');
  if (at >= 0) parts[at] = { ...parts[at], text: next };
  else parts.unshift({ type: 'text', text: next });

  return {
    ok: true,
    threadId: msg.threadId,
    parentId: msg.parentId || null,
    siblingCount: siblingsOf(index, messageId).count,
    message: {
      role: 'user',
      parentId: msg.parentId || null,
      content: next,
      parts,
      recipeId: msg.recipeId || null,
      status: 'done',
      ...(msg.vars ? { vars: copyValue(msg.vars) } : {}),
    },
  };
}

/**
 * Forking at `messageId` means: a NEW thread holding a copy of root→messageId, with fresh ids.
 * PURE — ids and the clock are injected, and the caller does the writing (and the attachment
 * copies: `attachmentIds` lists every attachment the copied parts point at).
 * @param {{thread: any, messages: any[], messageId: string, threadId: string,
 *          newId: () => string, now?: () => number, title?: string}} o
 * @returns {{ok: boolean, reason?: string, init?: any, messages?: any[], attachmentIds?: string[], idMap?: Record<string, string>}}
 */
export function planFork(o) {
  const opts = o || /** @type {any} */ ({});
  const { thread, messages, messageId, threadId, newId } = opts;
  if (!thread || typeof newId !== 'function' || !threadId) return { ok: false, reason: 'bad-args' };
  const index = indexNodes(messages || []);
  if (!index.byId.has(messageId)) return { ok: false, reason: 'unknown-message' };
  const ts = typeof opts.now === 'function' ? opts.now() : Date.now();

  const path = pathTo(index, messageId).filter((m) => !NOTE_STATUS.has(m.status));
  /** @type {Record<string, string>} */
  const idMap = {};
  /** @type {any[]} */
  const copies = [];
  /** @type {string[]} */
  const attachmentIds = [];
  for (const src of path) {
    const id = newId();
    const parts = Array.isArray(src.parts) ? src.parts.map(copyValue) : [];
    for (const p of parts) {
      if (p && typeof p.attId === 'string' && attachmentIds.indexOf(p.attId) < 0) attachmentIds.push(p.attId);
    }
    const copy = copyValue({ ...src, parts: [] });
    copy.id = id;
    copy.threadId = threadId;
    // The path is a chain, so "the previous copy" IS the nearest kept ancestor — which is what a
    // dropped note (a busy line) in the middle has to be re-linked to, or the fork would come out
    // as two unconnected roots.
    copy.parentId = (src.parentId && idMap[src.parentId])
      || (copies.length ? copies[copies.length - 1].id : null);
    copy.parts = parts;
    // A reply that was still streaming when the fork was taken is not "done" in the copy: it is
    // exactly what recoverInterrupted() would have called it.
    if (src.status === 'streaming') copy.status = 'interrupted';
    idMap[src.id] = id;
    copies.push(copy);
  }

  const title = opts.title == null ? String(thread.title || '') : String(opts.title);
  return {
    ok: true,
    idMap,
    attachmentIds,
    messages: copies,
    init: {
      id: threadId,
      title,
      titleSource: thread.titleSource === 'user' ? 'user' : 'auto',
      createdAt: ts,
      updatedAt: ts,
      pinned: false,
      ephemeral: !!thread.ephemeral,
      recipeId: thread.recipeId || null,
      systemOverride: thread.systemOverride == null ? null : thread.systemOverride,
      params: thread.params ? copyValue(thread.params) : null,
      model: thread.model || null,
      modelSource: thread.modelSource || null,
      farmId: thread.farmId || null,
      draft: null,
    },
  };
}

/** @param {any} app */
export function install(app) {
  const repo = () => app.repo;
  const ctl = () => app.controller;

  /** @param {string} threadId */
  const messagesOf = (threadId) => (repo() ? repo().getMessages(threadId) : Promise.resolve([]));

  /** The thread a message belongs to (its own stamp wins; the open thread is the fallback). */
  const threadIdOf = (/** @type {any} */ msg) => (msg && msg.threadId) || app.state.threadId || null;

  /**
   * Is the foreground slot free RIGHT NOW?
   *
   * regenerate() and editUser() write BEFORE they generate (the head move / the new user turn is
   * what puts the branch point on screen), and generate() is where the governor was first asked.
   * On a busy slot — a running stream, or a seat wait, which HOLDS the slot — the write had already
   * landed when the controller refused: the reader's conversation collapsed to the branch point,
   * the thread record kept the moved head, and the only message was "A reply is already running."
   * (P2 review, blocker). So the refusal happens here, before anything is written. `canStart` is
   * false for both 'streaming' and 'held'.
   */
  const slotFree = () => !app.gov || app.gov.canStart('foreground');

  /** Say no the way the composer does, and write nothing. @returns {null} */
  function refuse() {
    const note = app.gov && typeof app.gov.holdNote === 'function' ? app.gov.holdNote() : null;
    if (app.dialogs) app.dialogs.toast(note || t('core.alreadyRunning'));
    return null;
  }

  /** Move the visible head and repaint. @param {string} threadId @param {string|null} headId */
  async function moveHead(threadId, headId) {
    if (!repo() || !threadId || !headId) return;
    await repo().updateThread(threadId, { headId });
    if (ctl()) await ctl().refreshView();
  }

  const api = {
    /**
     * Another answer to the same question: a new assistant sibling under the same parent. The
     * params ride the CALL layer, so "More creative" beats the thread's own temperature (§3.6.3).
     * @param {any} msg @param {{params?: any, recipeId?: string|null}} [opts]
     */
    async regenerate(msg, opts) {
      const o = opts || {};
      if (!repo() || !ctl() || !msg) return null;
      const threadId = threadIdOf(msg);
      if (!threadId) return null;
      if (!slotFree()) return refuse();
      const plan = planRegenerate(await messagesOf(threadId), msg.id);
      if (!plan.ok) return null;
      // Re-asked after the store read: the await above is long enough for a send to take the slot.
      if (!slotFree()) return refuse();
      // Show the branch point before the new answer starts streaming into it. With no parent at all
      // (an assistant root, which only a damaged store can produce) there is no head to move to:
      // the post-stream refresh still sorts the path out.
      if (plan.parentId) await moveHead(threadId, plan.parentId);
      return ctl().generate({
        threadId,
        parentId: plan.parentId,
        mode: 'new',
        params: o.params || null,
        recipeId: o.recipeId || null,
        holder: 'regenerate',
      });
    },

    /**
     * Send a different version of something the reader already sent: a user sibling, then a reply.
     * @param {any} msg @param {string} text
     */
    async editUser(msg, text) {
      if (!repo() || !ctl() || !msg) return null;
      const threadId = threadIdOf(msg);
      if (!threadId) return null;
      if (!slotFree()) return refuse();
      const plan = planEdit(await messagesOf(threadId), msg.id, text);
      if (!plan.ok) return null;
      if (!slotFree()) return refuse();
      // appendMessage moves the thread head onto the new user turn, so the refresh below already
      // shows the NEW branch; the old one is reachable through the ◀ ▶ control on that row.
      const user = repo().appendMessage(threadId, plan.message);
      await ctl().refreshView();
      return ctl().generate({ threadId, parentId: user.id, mode: 'new', holder: 'edit' });
    },

    /**
     * Walk the ◀ ▶ control: pick the neighbouring sibling and follow its newest leaf.
     * @param {string} messageId @param {-1|1} dir
     * @returns {Promise<string|null>} the new headId, or null when there is nowhere to go
     */
    async switchSibling(messageId, dir) {
      if (!repo()) return null;
      const threadId = app.state.threadId;
      if (!threadId) return null;
      const index = indexNodes(await messagesOf(threadId));
      const at = siblingsOf(index, messageId);
      if (at.count < 2) return null;
      const next = at.list[at.position - 1 + (dir < 0 ? -1 : 1)];
      if (!next) return null;
      const headId = deepestLatest(index, next.id) || next.id;
      await moveHead(threadId, headId);
      return headId;
    },

    /**
     * Copy root→msg into a NEW thread and open it. Attachment records are copied too (with the new
     * threadId), so deleting the original thread cannot empty the fork.
     * @param {any} msg
     */
    async fork(msg) {
      if (!repo() || !ctl() || !msg) return null;
      const threadId = threadIdOf(msg);
      if (!threadId) return null;
      const thread = await repo().getThread(threadId);
      if (!thread) return null;
      const newThreadId = app.newId();
      const plan = planFork({
        thread,
        messages: await messagesOf(threadId),
        messageId: msg.id,
        threadId: newThreadId,
        newId: () => app.newId(),
        now: app.now,
        title: t('tree.forkTitle', { title: thread.title || '' }),
      });
      if (!plan.ok) return null;

      // Attachments first: the copied parts must point at records that already exist.
      /** @type {Record<string, string>} */
      const attMap = {};
      for (const attId of plan.attachmentIds || []) {
        try {
          const att = await repo().getAttachment(attId);
          if (!att) continue;
          const copy = { ...att, id: app.newId(), threadId: newThreadId };
          attMap[attId] = await repo().putAttachment(copy);
        } catch (err) {
          console.warn('[lolchat] fork: attachment copy failed', err);
        }
      }
      for (const m of plan.messages || []) {
        for (const p of m.parts || []) {
          if (p && typeof p.attId === 'string' && attMap[p.attId]) p.attId = attMap[p.attId];
        }
      }

      const created = repo().createThread(plan.init);
      for (const m of plan.messages || []) repo().appendMessage(created.id, m);
      if (app.sidebar) app.sidebar.render();
      await ctl().selectThread(created.id);
      return created;
    },

    /**
     * Remove a message and everything under it, after asking. The repo repairs the head; the view
     * is rebuilt from the repaired path.
     * @param {any} msg @param {{confirm?: boolean}} [opts]
     */
    async deleteSubtree(msg, opts) {
      if (!repo() || !msg) return null;
      const threadId = threadIdOf(msg);
      if (!threadId) return null;
      const ask = !opts || opts.confirm !== false;
      if (ask && app.dialogs) {
        const yes = await app.dialogs.confirm({
          title: t('tree.deleteTitle'),
          body: t('tree.deleteBody'),
          ok: t('tree.deleteOk'),
          danger: true,
        });
        if (!yes) return null;
      }
      // A reply still streaming INTO this thread has to stop first, or its finalize would write the
      // row back in after the delete (the controller's own abortThread contract).
      if (ctl() && typeof ctl().abortThread === 'function' && ctl().isStreaming && ctl().isStreaming()) {
        try { await ctl().abortThread(threadId); } catch (err) { console.warn('[lolchat] abortThread threw', err); }
      }
      const result = await repo().deleteSubtree(msg.id);
      if (app.view && result && result.removed && result.removed.length) app.view.remove(result.removed);
      // repo.deleteSubtree repairs the head onto the deleted message's PARENT. When that parent
      // still has another child — exactly the case "delete one of two answers" — the reader wants
      // to land on the answer that survived, not on their own question with nothing under it.
      if (result && result.headId) {
        const index = indexNodes(await messagesOf(threadId));
        const deepest = deepestLatest(index, result.headId);
        if (deepest && deepest !== result.headId) {
          await repo().updateThread(threadId, { headId: deepest });
          result.headId = deepest;
        }
      }
      if (ctl()) await ctl().refreshView();
      if (app.sidebar) app.sidebar.render();
      return result;
    },
  };

  // The provider the controller asks for on every refreshView / post-stream repaint. Only messages
  // that actually HAVE a sibling are listed: thread-view draws the control on count > 1.
  app.registry.add(SLOTS.SIBLINGS, {
    id: 'tree',
    async provide(thread, path) {
      /** @type {Map<string, {position: number, count: number}>} */
      const map = new Map();
      if (!thread || !repo()) return map;
      const index = indexNodes(await messagesOf(thread.id));
      for (const m of path || []) {
        const at = siblingsOf(index, m.id);
        if (at.count > 1) map.set(m.id, { position: at.position, count: at.count });
      }
      return map;
    },
  });

  app.bus.on(EV.BRANCH_SWITCH, (/** @type {any} */ p) => {
    if (!p || typeof p.messageId !== 'string') return;
    void api.switchSibling(p.messageId, p.dir < 0 ? -1 : 1);
  });

  app.branching = api;
  return api;
}
