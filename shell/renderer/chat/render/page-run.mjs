// @ts-check
// render/page-run.mjs - what LOL Vibe's page Preview (render/code.mjs) and the Page panel beside the chat
// (render/page-panel.mjs) share (VIBE_PAGE_PLAN, owner 2026-11-18):
//   - ONE sandbox for both, so one page runs at a time: a second `live()` stops the first (its owner hears
//     `{type:'stopped', why:'replaced'}`). Loaded on first use: importing sandbox/host.mjs statically from the chat's
//     render path broke the Computer's live scenarios in the harness (DEVLOG 2026-11-14).
//   - the answer's blocks, read from its message on screen;
//   - a person's edits of the page, kept on the answer's own record (`message.pageEdits`), on this computer only:
//     deleted with the thread, the answer's text never changed.

/** @type {Promise<any>|null} */ let sandbox = null;

/** The chat's page sandbox, made on first use. @returns {Promise<any>} */
export function pageSandbox() {
  if (!sandbox) sandbox = import('../sandbox/host.mjs').then((m) => m.createSandbox({ doc: document }));
  return sandbox;
}

/** The code blocks of the message this element is in, in order, as the person sees them.
 * @param {Element} el a code block (figure) or anything inside the message
 * @returns {{msg: Element, msgId: string, figs: Element[], fences: {lang: string, code: string}[]}} */
export function fencesOf(el) {
  const msg = el.closest('.chat-msg') || el.parentElement || el;
  const figs = Array.from(msg.querySelectorAll('figure.chat-codeblock'));
  const fences = figs.map((f) => ({
    lang: f.getAttribute('data-lang') || '',
    code: String((f.querySelector('pre') || {}).textContent || ''),
  }));
  return { msg, msgId: msg.getAttribute('data-id') || '', figs, fences };
}

/** The message record the chat holds (the view's own object when the thread is on screen, so a later pin or rename
 * writes the edits back too), else the store's. @param {any} app @param {string} threadId @param {string} msgId */
async function messageOf(app, threadId, msgId) {
  try {
    const cur = app.controller && typeof app.controller.current === 'function' ? app.controller.current() : null;
    const held = cur && Array.isArray(cur.path) ? cur.path.find((/** @type {any} */ m) => m && m.id === msgId) : null;
    if (held) return held;
  } catch { /* no controller: the store */ }
  if (!app.repo || !threadId) return null;
  const all = await app.repo.getMessages(threadId);
  return (all || []).find((/** @type {any} */ m) => m && m.id === msgId) || null;
}

/** A person's edits of this answer's page (`{[fence index]: code}`), or null. @param {any} app
 * @param {string} threadId @param {string} msgId @returns {Promise<Record<string, string>|null>} */
export async function readEdits(app, threadId, msgId) {
  try {
    const m = await messageOf(app, threadId, msgId);
    const blocks = m && m.pageEdits && m.pageEdits.blocks;
    return blocks && typeof blocks === 'object' && Object.keys(blocks).length ? { ...blocks } : null;
  } catch { return null; }
}

/** Keep (or with null, drop) a person's edits on the answer's record. @param {any} app @param {string} threadId
 * @param {string} msgId @param {Record<string, string>|null} edits @returns {Promise<boolean>} written */
export async function writeEdits(app, threadId, msgId, edits) {
  const m = await messageOf(app, threadId, msgId);
  if (!m || !app.repo) return false;
  const has = !!(edits && Object.keys(edits).length);
  if (has) m.pageEdits = { blocks: { ...edits }, updatedAt: typeof app.now === 'function' ? app.now() : Date.now() };
  else delete m.pageEdits;
  await app.repo.putMessage({ ...m });
  // The message's own page block says whether it runs the person's version.
  const node = document.querySelector(`.chat-msg[data-id="${CSS.escape(msgId)}"]`);
  if (node) for (const chip of Array.from(node.querySelectorAll('.chat-page-edited'))) /** @type {HTMLElement} */ (chip).hidden = !has;
  return true;
}
