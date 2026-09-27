// @ts-check
// "Your long answer is ready" (plan §4 P2-U1). A FEATURE: install(app).
//
// A farm reply can take minutes. The honest behaviour is to let the reader go and do something
// else — which only works if the chat tells them when it is done. The rules are deliberately
// narrow, because a notification for something you are already looking at is spam:
//   - only when the window does NOT have focus AT THE MOMENT THE ANSWER LANDS;
//   - only when the answer actually took a while (flags.notifyAfterMs, 8 s in the app);
//   - only when the reader has not turned it off (kv `pref:notify`, §3.7, default on);
//   - only for a finished answer: 'done' or a 'aborted' (the reader stopped it themselves and may
//     well be elsewhere) — NEVER for an error, which needs the screen, not a toast.
//
// Mechanics that look odd and are not (plan §2.6 AJ): `window.Notification` and
// `document.hasFocus()` are read AT FIRE TIME, never captured at install, because the harness
// installs its spy after mount. `Notification.requestPermission()` is never called — on a real
// desktop it can block behind an OS prompt, and an unpermitted construction simply throws, which
// the try/catch swallows.

import { t } from '../core/i18n.mjs';
import { SLOTS } from '../core/registry.mjs';
import { KV_KEYS } from '../core/types.mjs';
import '../strings/etiquette.en.mjs';

/** Default "long enough to have walked away" (flags.notifyAfterMs overrides). */
export const DEFAULT_NOTIFY_AFTER_MS = 8000;
/** The notification body is a teaser, not the answer. */
export const BODY_CHARS = 80;

/**
 * PURE. Should this finished generation raise a desktop notification?
 * @param {{status: string, durationMs: number|null, focused: boolean, enabled: boolean, afterMs: number}} o
 */
export function shouldNotify(o) {
  if (o.status !== 'done' && o.status !== 'aborted') return false;
  if (o.focused) return false;
  if (!o.enabled) return false;
  return Number(o.durationMs) > Number(o.afterMs);
}

/** @param {string} text @returns {string} */
export function teaser(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > BODY_CHARS ? `${flat.slice(0, BODY_CHARS)}…` : flat;
}

/** @param {any} app */
export function install(app) {
  const flags = app.flags || {};
  const afterMs = Number.isFinite(Number(flags.notifyAfterMs)) ? Number(flags.notifyAfterMs) : DEFAULT_NOTIFY_AFTER_MS;

  /** kv `pref:notify`: absent means ON. */
  async function enabled() {
    if (!app.repo || typeof app.repo.kvGet !== 'function') return true;
    try {
      const v = await app.repo.kvGet(KV_KEYS.prefNotify, true);
      return v !== false;
    } catch {
      return true;
    }
  }

  app.registry.add(SLOTS.STREAM_OBSERVERS, {
    id: 'notify',
    order: 600,
    /** @param {any} msg @param {any} result */
    async onDone(msg, result) {
      if (!msg || !result) return;
      // Read the globals NOW, not at install (§2.6 AJ).
      const focused = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? !!document.hasFocus()
        : true;
      const facts = {
        status: String(result.status),
        durationMs: result.durationMs == null ? null : Number(result.durationMs),
        focused,
        afterMs,
      };
      // The cheap half first: onDone is AWAITED inside every generation's finalize, so the kv read
      // must not sit on the path of the 99 % of replies that will never notify.
      if (!shouldNotify({ ...facts, enabled: true })) return;
      if (!shouldNotify({ ...facts, enabled: await enabled() })) return;

      const Ctor = /** @type {any} */ (window).Notification;
      if (typeof Ctor !== 'function') return;

      let title = null;
      try {
        const thread = app.repo && msg.threadId ? await app.repo.getThread(msg.threadId) : null;
        title = thread && thread.title ? String(thread.title) : null;
      } catch { title = null; }

      try {
        const n = new Ctor(title || t('etiquette.notifyFallbackTitle'), { body: teaser(msg.content) });
        n.onclick = () => {
          try { window.focus(); } catch { /* the OS decides; best effort (DISCUSS D-C7) */ }
          try { if (app.controller && msg.threadId) app.controller.selectThread(msg.threadId); } catch { /* gone */ }
          try { n.close(); } catch { /* already closed */ }
        };
      } catch (err) {
        // No permission, or no notification service on this desktop: not a chat failure.
        console.warn('[lolchat] notification refused', err);
      }
    },
  });

  // ---- the settings toggle (the section is rendered by P2-U4's ui/settings.mjs) -----------------
  app.registry.add(SLOTS.SETTINGS_SECTIONS, {
    id: 'notifications',
    // 320: P2-U2's Context section also asked for 300, and two items on the same order leave the
    // reading order to the registry's tie-break. Spread at the P2 landing.
    order: 320,
    title: t('etiquette.notifyTitle'),
    /** @param {HTMLElement} el */
    render(el) {
      const label = document.createElement('label');
      label.className = 'chat-setting-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      const text = document.createElement('span');
      text.textContent = t('etiquette.notifyToggle');
      label.append(box, text);
      const hint = document.createElement('p');
      hint.className = 'chat-setting-hint';
      hint.textContent = t('etiquette.notifyHint');
      el.append(label, hint);
      void enabled().then((on) => { box.checked = on; });
      box.addEventListener('change', () => {
        if (app.repo && typeof app.repo.kvSet === 'function') {
          Promise.resolve(app.repo.kvSet(KV_KEYS.prefNotify, box.checked))
            .catch((err) => console.warn('[lolchat] could not save the notification preference', err));
        }
      });
    },
  });
}
