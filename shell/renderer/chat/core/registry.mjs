// @ts-check
// Extension slots. PURE.
//
// Contract (plan §3.2, frozen at P0 kickoff). Item shapes per slot are documented inline and in
// core/types.mjs. Registry semantics:
//   - add(slot, item) → unregister(). `slot` must be one of the SLOTS values (a typo throws).
//   - every item needs an identity: `item.id` (string), or `item.type` for PART_RENDERERS.
//     Adding a second item with the same identity to the same slot THROWS (it means a feature was
//     installed twice or two features collide — fix the id, don't swallow it).
//   - list(slot) → a NEW array sorted by (order ?? 500) ascending, then identity (string compare).
//     An unknown slot throws; an empty slot returns [].
//   - first(slot) → list(slot)[0] or null.
//   - unregister() is idempotent.
//   Items are stored by reference: mutating an item after add() changes what list() returns (but
//   not its sort position until the next add/remove).

export const SLOTS = Object.freeze({
  COMPOSER_ACTIONS: 'composer.actions',     // {id, order, render(app) -> HTMLElement, visible?(caps, app) -> boolean}
  CHIP_ACTIONS: 'composer.chipActions',     // {id, order, label, visible(part, app) -> boolean, run(part, key, app)}
  BEFORE_SEND: 'composer.beforeSend',       // {id, order, stage:'gate'|'enrich', run(draft, app, {fingerprint}) -> Promise<Draft|null>}
  REQUEST_TRANSFORMS: 'request.transforms', // {id, order, apply(req: RequestDraft, ctx: TransformCtx) -> void|Promise<void>}
  ERROR_HANDLERS: 'error.handlers',         // {id, order, handle(err, msg, app) -> Promise<boolean>}  true = handled
  STREAM_OBSERVERS: 'stream.observers',     // {id, onStart?(msg, app), onFirstChunk?({msg, text, mode, partial}, app) -> 'abort'|void, onDone?(msg, result, app)}
  CANCEL_HANDLERS: 'cancel.handlers',       // {id, order, active(app) -> boolean, cancel(app)}  used by controller.stop() when nothing streams
  MESSAGE_ACTIONS: 'message.actions',       // {id, order, icon, label, visible(msg, ctx) -> boolean, run(msg, app, anchorEl)}
  PART_RENDERERS: 'message.parts',          // {type, render(part, msg, app) -> Node}
  CODE_DECORATORS: 'code.decorators',       // {id, order, match({lang, code, msg, final}) -> boolean, decorate(figureEl, {lang, code, msg}, app)}
  ATTACH_SOURCES: 'attach.sources',         // {id, order, icon, label, visible(caps, app) -> boolean|Promise<boolean>, pick(app)}
  ATTACH_HANDLERS: 'attach.handlers',       // {id, order, accepts(file, caps) -> boolean, ingest(file, app)}
  REGENERATE_OPTIONS: 'regenerate.options', // {id, order, label, params?, recipeId?}
  SIBLINGS: 'thread.siblings',              // {id, provide(thread, path) -> Promise<Map<msgId, {position, count}>>}
  THREAD_MENU: 'sidebar.threadMenu',        // {id, order, label, visible(thread) -> boolean, run(thread, app)}
  NEW_MENU: 'sidebar.newMenu',              // {id, order, label, run(app)} — the sidebar shows a ⌄ next to #chat-new when non-empty
  THREAD_HEADER: 'thread.header',           // {id, order, render(app) -> HTMLElement}
  SETTINGS_SECTIONS: 'settings.sections',   // {id, order, title, render(el, app)}
  SHORTCUTS: 'shortcuts',                   // {id, keys, when?(e, app) -> boolean, run(e, app)}
  PALETTE: 'palette.commands',              // {id, label, keywords?, run(app)}
  CITATIONS: 'render.citations',
  // ---- Studio (S0 kickoff, studio plan 3.2). Inert until their host renders them (2.6 AD).
  WORKBENCH_PANELS: 'workbench.panels', // {id, order, icon, label, defaultWidth:'split'|'work', available(app) -> boolean|{no:string}, create(host, app) -> PanelInstance}
  PREVIEW_TEMPLATES: 'preview.templates', // {id, order, label, kind:'canvas'|'dom'|'three'|'p5'|'svg', libs, files() -> {path,text}[], brief, knobs?}
  DESIGN_SECTIONS: 'design.sections',    // {id, order, title, available(app) -> boolean|{no:string}, render(el, app) -> {refresh?, destroy?}}
  BOARD_PACKS: 'board.packs',            // {id, order, pack: BoardPack}  a pack is data, never code            // {id, resolve(n, msg, app) -> {url, title}|null}  first non-null wins
});

const KNOWN = new Set(Object.values(SLOTS));
const DEFAULT_ORDER = 500;

/** @param {any} item @returns {string} */
function identity(item) {
  if (item && typeof item.id === 'string' && item.id) return item.id;
  if (item && typeof item.type === 'string' && item.type) return item.type;
  return '';
}

/**
 * @typedef {{
 *   add(slot: string, item: any): () => void,
 *   list(slot: string): any[],
 *   first(slot: string): any,
 *   slots(): string[],
 * }} Registry
 */

/** @returns {Registry} */
export function createRegistry() {
  /** @type {Map<string, any[]>} */
  const items = new Map();
  /** @type {Map<string, any[]>} */
  const sorted = new Map();

  /** @param {string} slot */
  function check(slot) {
    if (!KNOWN.has(slot)) throw new Error(`registry: unknown slot "${slot}"`);
  }

  /** @param {string} slot @param {any} item */
  function add(slot, item) {
    check(slot);
    if (!item || typeof item !== 'object') throw new TypeError(`registry.add(${slot}): item must be an object`);
    const key = identity(item);
    if (!key) throw new Error(`registry.add(${slot}): item needs a string id${slot === SLOTS.PART_RENDERERS ? ' or type' : ''}`);
    const list = items.get(slot) || [];
    if (list.some((x) => identity(x) === key)) throw new Error(`registry.add(${slot}): duplicate id "${key}"`);
    list.push(item);
    items.set(slot, list);
    sorted.delete(slot);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const cur = items.get(slot);
      if (!cur) return;
      const i = cur.indexOf(item);
      if (i >= 0) cur.splice(i, 1);
      sorted.delete(slot);
    };
  }

  /** @param {string} slot */
  function list(slot) {
    check(slot);
    let s = sorted.get(slot);
    if (!s) {
      s = (items.get(slot) || []).slice().sort((a, b) => {
        const oa = typeof a.order === 'number' ? a.order : DEFAULT_ORDER;
        const ob = typeof b.order === 'number' ? b.order : DEFAULT_ORDER;
        if (oa !== ob) return oa - ob;
        const ia = identity(a), ib = identity(b);
        return ia < ib ? -1 : ia > ib ? 1 : 0;
      });
      sorted.set(slot, s);
    }
    return s.slice();
  }

  /** @param {string} slot */
  function first(slot) {
    const l = list(slot);
    return l.length ? l[0] : null;
  }

  function slots() {
    return [...KNOWN];
  }

  return { add, list, first, slots };
}
