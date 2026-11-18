// @ts-check
// chat/page-window.mjs - the page's own window (VIBE_PAGE_PLAN step 2, owner 2026-11-18: "detachable"). The same Page
// panel as beside the chat (render/page-panel.mjs createPanel), in a window a person can drag to another screen or a
// projector. It keeps no data: the page arrives from the main window (preload `onPageWindow`, type 'load'), and each
// edit goes back to it (`pageWindowEdits`), which writes it on the answer's record. Its sandbox is its own, made in
// this window by the same module (sandbox/host.mjs), so its walls are the same: opaque origin, no network, no disk.

import { createPanel } from './render/page-panel.mjs';
import { createDialogs } from './ui/dialogs.mjs';
import { t } from './core/i18n.mjs';
import './strings/render.en.mjs';

const door = /** @type {any} */ (window).lol;
const root = /** @type {HTMLElement} */ (document.getElementById('lolchat'));
document.title = t('render.pageWindowTitle');

/** The theme the person chose (app.js does the same for the main window). @param {string} theme */
function applyTheme(theme) {
  const light = theme === 'light' || (theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.classList.toggle('light', !!light);
  document.documentElement.classList.toggle('dark', !light);
}
if (door && typeof door.getSettings === 'function') void door.getSettings().then((/** @type {any} */ s) => applyTheme(String((s && s.theme) || 'dark'))).catch(() => {});

const app = { root, now: () => Date.now(), dialogs: /** @type {any} */ (null) };
app.dialogs = createDialogs(app);

/** @type {any} */ let target = null;
/** @type {Record<string, string>|null} */ let edits = null;
const panel = createPanel(root, app, () => target, {
  readEdits: async () => (edits ? { ...edits } : null),
  writeEdits: async (tg, e) => {
    edits = e ? { ...e } : null;
    if (door && typeof door.pageWindowEdits === 'function') door.pageWindowEdits({ threadId: tg.threadId, msgId: tg.msgId, edits });
  },
});

// Until a page arrives, the panel's empty line says what it waits for (beside the chat it says how to start one).
const empty = root.querySelector('.chat-pagep-empty');
if (empty) empty.textContent = t('render.pageWindowWaiting');

if (door && typeof door.onPageWindow === 'function') {
  door.onPageWindow((/** @type {any} */ ev) => {
    if (!ev || ev.type !== 'load' || !ev.target || !Array.isArray(ev.target.fences)) return;
    const { edits: arrived, ...rest } = ev.target;
    target = rest;
    edits = arrived && typeof arrived === 'object' && Object.keys(arrived).length ? { ...arrived } : null;
    panel.show({ thread: { id: String(target.threadId || '') } });
  });
}
// Ready for a page: main sends it once this is heard (the first one, and each later Pop out).
if (door && typeof door.pageWindowReady === 'function') door.pageWindowReady();
/** For a test driving this window over CDP. */
/** @type {any} */ (window).__lolPage = { debug: () => panel.debug() };
