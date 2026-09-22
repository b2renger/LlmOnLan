// @ts-check
// The shared spine (COMPUTER_PLAN §2.3). Integrator-owned; units NEVER edit this file.
//
// Two surfaces, two Apps, ONE spine. `core/app.mjs` createApp({root, els}) is surface-agnostic and
// the Computer builds its own App whose root is #lolcomputer — it has to, because app/ask.mjs
// refuses with `busy` when app.state.visible is false and state.visible is derived from the root's
// `hidden` class. One shared App would make every Computer model call fail the moment the chat is
// hidden, which it always is.
//
// Exactly three instances are shared:
//   repo  one IndexedDB connection to `lol-chat`. Two would fight the journal and the migration.
//   farm  one snapshot model, one __lolFarm bridge, one capability cache.
//   gov   MANDATORY. Two governors each allow one background call → two in flight → the seat
//         etiquette collapses.
// Everything else — bus, registry, root, els, dialogs, the `ask` install — is per surface.
//
// THE BUS MIRROR (three events, not one). net/farm.mjs and net/governor.mjs emit on the bus of the
// App they were CONSTRUCTED with. Mirroring only GOV_CHANGE would leave the Computer's farm chip,
// its plan preview and (via caps) its vision verdict frozen at boot. So GOV_CHANGE, FARM_CHANGE
// and FARM_TICK are all mirrored onto the bus that did not construct them.
//
// CAPS IS INSTALLED EXACTLY ONCE. app/caps.mjs calls app.farm.setCapResolver(...) on the SHARED
// farm, so a second install overwrites the first's resolver and doubles the /model_group/info GET.
// app/ask.mjs reads vision through app.farm.cap(underlying,'vision') — the shared farm's resolver —
// so one install serves both surfaces. When the chat is alive it has already installed caps from
// its own loader row; only a Computer that boots WITHOUT a chat installs it here.
//
// window.__lolSpine is the promise this module publishes: {repo, farm, gov, owner, mirror}.

import { EV } from '../core/events.mjs';
import { installDropGuard } from '../ui/layout.mjs';

/** The three events a surface must see even though another surface's App emitted them. */
export const MIRRORED = Object.freeze([EV.GOV_CHANGE, EV.FARM_CHANGE, EV.FARM_TICK]);

/** How long the Computer waits for the chat's spine before building its own. */
const SPINE_TIMEOUT_MS = 8000;
const SPINE_POLL_MS = 25;

/** @type {Promise<any>|null} */ let spinePromise = null;

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** The chat's App, if chat/main.mjs got far enough to publish one. @returns {any} */
function chatApp() {
  const g = /** @type {any} */ (window).LolChat;
  return g && g.app ? g.app : null;
}

/** True once the chat has constructed all three shared instances. */
function chatSpineReady() {
  const a = chatApp();
  return !!(a && a.repo && a.farm && a.gov);
}

/**
 * Re-emit `MIRRORED` events from `src` onto `dst`, with a re-entrancy guard so a future
 * two-way mirror can never loop. Returns the uninstall.
 * @param {any} src @param {any} dst @returns {() => void}
 */
export function mirrorBus(src, dst) {
  if (!src || !dst || src === dst) return () => {};
  let inside = false;
  /** @type {(() => void)[]} */ const offs = [];
  for (const ev of MIRRORED) {
    const off = src.on(ev, (/** @type {any} */ payload) => {
      if (inside) return;
      inside = true;
      try { dst.emit(ev, payload); } finally { inside = false; }
    });
    if (typeof off === 'function') offs.push(off);
  }
  return () => { for (const off of offs) off(); };
}

/**
 * The spine, built once per window.
 *
 * Load order: chat/main.mjs is the earlier <script type="module">, so in the shipped page it is
 * already running. We wait for it to publish repo/farm/gov, then adopt them. If the chat failed
 * entirely — or this page never loaded it — we construct the spine ourselves from the SAME
 * factories against the Computer's own App: the Computer must not die because the chat did.
 *
 * @param {any} computerApp the App whose root is #lolcomputer
 * @returns {Promise<{repo: any, farm: any, gov: any, owner: 'chat'|'computer', mirror: (() => void)}>}
 */
export function spine(computerApp) {
  if (spinePromise) return spinePromise;
  spinePromise = build(computerApp);
  /** @type {any} */ (window).__lolSpine = spinePromise;
  return spinePromise;
}

/** @param {any} computerApp */
async function build(computerApp) {
  // installDropGuard is idempotent per document, and the chat installs it too — this call is the
  // one that matters when the Computer boots alone. A stray file drop must never navigate the
  // window on either surface.
  installDropGuard(document);

  const deadline = Date.now() + SPINE_TIMEOUT_MS;
  while (!chatSpineReady() && Date.now() < deadline) {
    // The chat is only worth waiting for if it is actually loading. Once LolChat.ready is true and
    // the three instances are still not all there, waiting longer cannot help.
    const g = /** @type {any} */ (window).LolChat;
    if (g && g.ready) break;
    await sleep(SPINE_POLL_MS);
  }

  if (chatSpineReady()) {
    const host = chatApp();
    return {
      repo: host.repo,
      farm: host.farm,
      gov: host.gov,
      owner: /** @type {'chat'} */ ('chat'),
      // farm and gov were constructed with the chat's App, so they emit there. Mirror onto ours.
      mirror: mirrorBus(host.bus, computerApp.bus),
    };
  }

  // No chat. Build the spine against the Computer's own App — its bus is then the one farm and gov
  // emit on, so there is nothing to mirror — and install caps here, because nobody else did.
  const [repoMod, farmMod, govMod] = await Promise.all([
    import('../state/repo.mjs'),
    import('../net/farm.mjs'),
    import('../net/governor.mjs'),
  ]);
  computerApp.repo = repoMod.openRepoSync({
    idbName: 'lol-chat',
    forceMemory: !!computerApp.flags.forceMemoryStore,
    timeoutMs: 3000,
    idbOpenDelayMs: Number(computerApp.flags.idbOpenDelayMs) || 0,
    bus: computerApp.bus,
    now: computerApp.now,
    newId: computerApp.newId,
  });
  computerApp.farm = farmMod.createFarmModel(computerApp);
  computerApp.gov = govMod.createGovernor(computerApp);
  try {
    const caps = await import('../app/caps.mjs');
    caps.install(computerApp);
  } catch (err) {
    console.warn('[lolcomputer] capability probe not installed', err);
  }
  return {
    repo: computerApp.repo,
    farm: computerApp.farm,
    gov: computerApp.gov,
    owner: /** @type {'computer'} */ ('computer'),
    mirror: () => {},
  };
}
