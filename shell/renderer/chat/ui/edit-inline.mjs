// @ts-check
// The inline editor for a message you already sent (P2-U3). A LEAF (plan §2.6 AB): no loader row —
// ui/message-actions.mjs and ui/shortcuts.mjs import it directly.
//
// It never rewrites anything thread-view owns (plan §2.6 AE): the editor is ONE extra child
// appended to the row, and `data-editing` on the row hides the parts/body/foot through css/tree.css
// while it is open. Closing removes the child and the attribute, so the next `upsert` finds the row
// exactly as it left it. An ATTRIBUTE, not a class, on purpose: thread-view's fill() reassigns
// `row.node.className` wholesale, so a class would silently fall off under a background repaint and
// the reader would see the message twice.
//
//   openEdit(app, msg) → {close} | null      one editor at a time; opening a second closes the first
//   closeEdit()                              close whatever is open (Escape, a thread switch)
//   isEditing() → boolean
//
// The editor lives on a row thread-view owns, and ANY repaint that drops that row (a thread switch,
// a regenerate, a delete, a sibling switch) takes the textarea with it. `isEditing()` therefore
// asks the DOM whether the row is still connected instead of trusting its own handle: it used to
// stay true for the rest of the session once a repaint detached the node, which permanently
// disabled the ArrowUp "edit your last message" shortcut (P2 review). ui/message-actions.mjs also
// closes the editor on EV.THREAD_SELECTED, so switching chats never leaves a half-typed edit in a
// detached node.
//
// Save & send hands the text to app.branching.editUser(), which writes a USER SIBLING and generates
// its reply — the version you are editing stays in the tree, one ◀ away.

import { t } from '../core/i18n.mjs';
import '../strings/tree.en.mjs';
import '../strings/dialogs.en.mjs';

/** @type {{row: any, node: any, close: () => void}|null} */
let open = null;

/** @param {any} msg the text a user message is carrying right now */
function textOf(msg) {
  if (!msg) return '';
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  const text = parts.find((/** @type {any} */ p) => p && p.type === 'text');
  if (text && typeof text.text === 'string') return text.text;
  return String(msg.content || '');
}

export function isEditing() {
  // Self-healing: a row the view rebuilt is no longer in the document, and the editor went with it.
  if (open && open.row && open.row.isConnected === false) open = null;
  return !!open;
}

export function closeEdit() {
  if (open) open.close();
}

/**
 * @param {any} app
 * @param {any} msg the USER message being rewritten
 * @returns {{close: () => void}|null}
 */
export function openEdit(app, msg) {
  if (!app || !msg || msg.role !== 'user') return null;
  const row = app.view && typeof app.view.rowOf === 'function' ? app.view.rowOf(msg.id) : null;
  if (!row) return null;
  closeEdit();

  const wrap = document.createElement('div');
  wrap.className = 'chat-edit';

  const input = document.createElement('textarea');
  input.className = 'chat-edit-input';
  input.value = textOf(msg);
  input.setAttribute('aria-label', t('tree.editLabel'));
  input.rows = 3;

  const controls = document.createElement('div');
  controls.className = 'chat-edit-row';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn-accent';
  save.textContent = t('tree.editSave');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-ghost';
  cancel.textContent = t('tree.editCancel');
  const hint = document.createElement('span');
  hint.className = 'chat-edit-hint';
  hint.textContent = t('tree.editHint');
  controls.append(save, cancel, hint);
  wrap.append(input, controls);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    open = null;
    wrap.remove();
    row.removeAttribute('data-editing');
  };

  const submit = () => {
    const text = String(input.value || '');
    if (!text.trim()) return;
    close();
    if (app.branching && typeof app.branching.editUser === 'function') {
      void Promise.resolve(app.branching.editUser(msg, text))
        .catch((err) => console.warn('[lolchat] edit failed', err));
    }
  };

  save.addEventListener('click', submit);
  cancel.addEventListener('click', () => close());
  input.addEventListener('keydown', (/** @type {any} */ e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      // The document-level shortcuts must not ALSO see this key (they would read an "empty
      // composer" and start a second edit); the guard is deliberate, and ui/layout.mjs is the only
      // module chat-lint forbids it in.
      e.stopPropagation();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  row.setAttribute('data-editing', 'user');
  row.appendChild(wrap);
  open = { row, node: wrap, close };
  try {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  } catch (err) { void err; }
  return { close };
}
