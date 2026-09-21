// @ts-check
// The store banner (plan §3.7 store modes, §4 P1-U4) — a FEATURE: it exports install(app), which
// main.mjs calls after every component exists.
//
// What it says, and only that:
//   mode 'memory'       → "History isn't being saved yet …"   (the IndexedDB open missed the 3 s
//                          timeout; the repo is still waiting and everything typed is journalled)
//   mode 'memory-final' → "History can't be saved on this machine …"
//   mode 'pending'/'idb'→ nothing (the banner node is removed again on a late attach)
//
// Ownership (plan §2.6 J): els.banner is SHARED. main.mjs owns `.chat-banner-loader`, this feature
// owns exactly one `.chat-banner-store` child, and neither ever clears the other — no
// replaceChildren(), no textContent='' on els.banner. So a broken store banner cannot hide the
// loader's "part failed to load" alert, and vice versa. This feature does NOT re-implement that
// alert; main.mjs already renders it.
//
// A feature never sees a bus event emitted during component construction (plan §2.6 I), and
// `flags.forceMemoryStore` makes the repo emit STORE_MODE 'memory-final' while it is being built —
// before any install() runs. So install() READS the current mode as well as subscribing.

import { EV } from '../core/events.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/store.en.mjs';

const CLASS = 'chat-banner-store';

/** @param {any} app */
export function install(app) {
  const banner = app.els && app.els.banner;
  if (!banner) return;

  /** @param {string} mode */
  function render(mode) {
    const existing = /** @type {HTMLElement|null} */ (banner.querySelector(`.${CLASS}`));
    if (mode !== 'memory' && mode !== 'memory-final') {
      if (existing) existing.remove();          // ONLY our own node
      return;
    }
    const text = mode === 'memory' ? t('store.memory') : t('store.memoryFinal');
    const node = existing || document.createElement('div');
    if (!existing) {
      node.className = CLASS;
      banner.appendChild(node);
    }
    node.setAttribute('data-mode', mode);
    node.setAttribute('role', mode === 'memory-final' ? 'alert' : 'status');
    if (node.textContent !== text) node.textContent = text;
  }

  const currentMode = () => {
    const repo = app.repo;
    if (repo && typeof repo.mode === 'string') return repo.mode;
    return app.state && app.state.storeMode ? app.state.storeMode : 'pending';
  };

  render(currentMode());
  app.bus.on(EV.STORE_MODE, (/** @type {any} */ mode) => render(typeof mode === 'string' ? mode : currentMode()));
}
