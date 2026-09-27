// @ts-check
// The App object every component/feature receives. NOT pure (reads document visibility once).
//
// Contract (plan §3.1 step 4 / §3.2, frozen at P0 kickoff):
//   createApp({root, els}) → App with:
//     root, els, bus, registry, EV, SLOTS, t, flags, now, rng, newId,
//     state = {threadId:null, visible, pageVisible, storeMode:'pending'},
//     repo/farm/gov/dialogs/view/sidebar/composer/picker/controller = null (main.mjs fills them),
//     modules = {} (loaded module namespaces by loader key).
//   Core keeps two state fields in sync from the bus, so no component has to:
//     state.storeMode ← EV.STORE_MODE (payload: the mode string)
//     state.threadId  ← EV.THREAD_SELECTED ({threadId})
//   state.visible / state.pageVisible are written by main.mjs (MutationObserver + visibilitychange),
//   which then emits EV.VISIBLE.

import { EV, createBus } from './events.mjs';
import { SLOTS, createRegistry } from './registry.mjs';
import { t } from './i18n.mjs';
import { flags, now, rng } from './env.mjs';
import { newId } from './ids.mjs';

/**
 * @param {{root: HTMLElement, els: import('./types.mjs').Els}} opts
 * @returns {import('./types.mjs').App}
 */
export function createApp({ root, els }) {
  const bus = createBus();
  const registry = createRegistry();
  const visible = !!root && !root.classList.contains('hidden');
  const pageVisible = typeof flags.forcePageVisible === 'boolean'
    ? flags.forcePageVisible
    : (typeof document !== 'undefined' ? document.visibilityState === 'visible' : true);

  /** @type {import('./types.mjs').App} */
  const app = {
    root,
    els,
    bus,
    registry,
    EV,
    SLOTS,
    t,
    flags,
    now,
    rng,
    newId: () => newId({ now, rng }),
    state: { threadId: null, visible, pageVisible, storeMode: 'pending' },
    repo: null,
    farm: null,
    gov: null,
    dialogs: null,
    view: null,
    sidebar: null,
    composer: null,
    picker: null,
    controller: null,
    modules: {},
  };

  bus.on(EV.STORE_MODE, (mode) => {
    if (typeof mode === 'string') app.state.storeMode = /** @type {any} */ (mode);
  });
  bus.on(EV.THREAD_SELECTED, (p) => {
    app.state.threadId = p && typeof p.threadId === 'string' ? p.threadId : null;
  });

  return app;
}
