// @ts-check
// Shared types for LOL Chat. JSDoc only — nothing compiles this; it DOCUMENTS the contract
// (plan §3.3 / §3.4, frozen at P0 kickoff; later changes are contract changes noted in DEVLOG).
// PURE: its only runtime exports are TYPES_VERSION and API_KEYS (frozen key lists).

// ---------------------------------------------------------------------------------------------
// Farm
// ---------------------------------------------------------------------------------------------

/** What app.js publishes as `window.__lolFarm` (every field after apiKey is optional; P1 kickoff
 *  adds them additively inside publishFarm()).
 * @typedef {{ name, openaiBaseUrl, defaultModel, busy, apiKey,
 *   id?, requiresKey?, healthy?, stale?, lastSeen?, host?, httpPort?,
 *   models?: {id, underlying, default}[],
 *   backend?: {engine, alias, contextLength, contextPerSlot, slots} | null,
 *   capacity?: {slots, clients, seatsUsed, seatIdleSec, busy?, queued?} | null,
 *   perf?: object|null, usage?: {gpuUtil}|null, searxngUrl?, ttsUrl?, ttsVoice?, ttsModel?,
 *   extract?: {url, key}|null }} FarmBridge
 */

/** Normalised farm capabilities (net/farm.mjs capsFromBridge). `present:false` = no farm.
 * @typedef {{ present, id, name, baseUrl, proxyRoot, apiKey, requiresKey, keyMissing, healthy, stale, lastSeen,
 *   defaultModel, models: {id, underlying, default}[], engine: 'ollama'|'llama.cpp'|'external'|null,
 *   budget: {tokens, advertised, source: 'advertised'|'default'},
 *   seats: {used, slots, clients, idleSec}|null, busy: {label, percent}|null, perf, gpuUtil,
 *   search: {url}|null, tts: {url, voice, model}|null, ocr: {url, key}|null }} FarmCaps
 */

// ---------------------------------------------------------------------------------------------
// Records (IndexedDB `lol-chat` v1, plan §3.7)
// ---------------------------------------------------------------------------------------------

/** @typedef {{ id, title, titleSource: 'auto'|'user', createdAt, updatedAt, headId, pinned, ephemeral,
 *   recipeId, systemOverride, params: Params|null, model: string|null, modelSource: 'user'|null,
 *   farmId, draft, imported?: boolean, legacyId?: string, legacyHash?: string,
 *   studio?: StudioState }} Thread
 */

/** @typedef {{type:'text', text} | {type:'image', attId} | {type:'doc', attId, pages: [number, number][]|null}
 *   | {type:'search', query, results: {n, title, url, snippet}[], error?}
 *   | {type:'blender', kind: 'scene'|'viewport', attId}} Part
 */

/** @typedef {{ id, threadId, parentId: string|null, role: 'user'|'assistant', createdAt, updatedAt,
 *   parts: Part[], content: string, reasoning: string|null, reasoningMs: number|null, sawToolCalls: boolean,
 *   model, underlying, farmName, farmId, params: Params|null, recipeId, vars?: object,
 *   stats: {promptTokens, completionTokens, ttftMs, tokPerSec, finishReason, text}|null,
 *   status: 'streaming'|'done'|'aborted'|'error'|'interrupted'|'waiting'|'local',
 *   error: {kind, code, message, retryAfter}|null, pinned: boolean, structuredState?: object }} Message
 */

/** @typedef {{ id, threadId, name, mime, size, sha256, blob: Blob|null, width?, height?, thumbDataUrl?,
 *   text?, pages?: {page, text}[], extractEngine?: 'local'|'farm-ocr'|'blender', status: 'ready'|'extracting'|'error', error? }} Attachment
 */

/** @typedef {{ temperature?, top_p?, max_tokens?, seed?, stop?: string[] }} Params */

/** @typedef {{ lolrecipe: 1, id, name, trigger, description?, system?, template?, vars?, params?,
 *   output?: {render: 'markdown'|'cards'|'table', schema?}, builtin?: boolean, imported?: boolean, updatedAt? }} Recipe
 *   (added at P4 kickoff; the `recipes` store exists from v1)
 */

// ---------------------------------------------------------------------------------------------
// Send pipeline (plan §3.6)
// ---------------------------------------------------------------------------------------------

/** @typedef {{ text, parts: Part[], model, recipeId?, vars?, params?, flags?: {search?: boolean} }} Draft */

/** @typedef {{ model, system: string|null, systemAppend: string[],
 *   messages: {msgId, role: 'user'|'assistant', pinned,
 *              blocks: ({type:'text', text, tag: 'user'|'doc'|'search'|'scene'|'assistant'|'continue'} | {type:'image', attId, dataUrl?})[] }[],
 *   paramLayers: {recipe: Params, thread: Params, call: Params}, params: Params,
 *   responseFormat: object|null, mode: 'new'|'continue',
 *   meta: {engine, budget, estimate, trimmedIds: string[], newTurnEstimate, allowances: {id, tokens}[]} }} RequestDraft
 */

/** @typedef {{ app: App, thread: Thread, draft: Draft|null, attachments: (id: string) => Promise<Attachment|null>, caps: FarmCaps, preview: boolean }} TransformCtx */

/** @typedef {{ status: 'done'|'aborted'|'error', abortedBy: 'user'|'observer'|null, content, reasoning, reasoningMs,
 *   usage, finishReason, ttftMs, durationMs, tokPerSec, error: ClassifiedError|null }} GenerationResult
 */

/** @typedef {{ kind: 'seats_full'|'upstream_down'|'auth'|'key_missing'|'context_overflow'|'vision_unsupported'|'stream_error'|'network'|'aborted'|'http',
 *   status, code, message, farmMessage, retryAfter }} ClassifiedError
 */

// Markdown shapes (Block, Inline) are NOT duplicated here: they are JSDoc in their own modules,
// render/md-block.mjs and render/md-inline.mjs, which are their single source of truth.
//
// ---------------------------------------------------------------------------------------------
// Components (plan §3.4). Factories are called by main.mjs ONLY; see main.mjs COMPONENTS.
// ---------------------------------------------------------------------------------------------

/** state/repo.mjs — `openRepoSync(opts) -> Repo`. The extra options after timeoutMs are the P0
 *  kickoff's precision of §3.4 (main.mjs passes them; all optional so Node tests can omit them):
 * @typedef {{ idbName?: string, forceMemory?: boolean, timeoutMs?: number,
 *   idbOpenDelayMs?: number,              // flags.idbOpenDelayMs (delay before indexedDB.open)
 *   bus?: import('./events.mjs').Bus|null, // emits STORE_MODE / STORE_ERROR / THREADS_CHANGED
 *   now?: () => number,                    // core/env now
 *   newId?: () => string,                  // core/ids newId bound to env now/rng
 *   indexedDB?: IDBFactory|null,           // default globalThis.indexedDB (tests inject a fake)
 *   // TEST-ONLY seams (P0 landing; main.mjs never passes them):
 *   openPersistent?: (o: any) => any,      // the persistent-backend factory — Node tests pass a memory
 *                                          //   backend, or a scripted slow/failing `ready` to drive
 *                                          //   the pending → memory → idb path without a fake IDB
 *   setTimeout?: (fn: Function, ms: number) => any,   // injected clock: the checkpoint throttle
 *   clearTimeout?: (h: any) => void,                  //   and the open timeout use these
 * }} RepoOptions
 */

/** @typedef {{
 *   mode: 'pending'|'idb'|'memory'|'memory-final', ready: Promise<void>,
 *   listThreads(): Promise<Thread[]>,
 *   getThread(id: string): Promise<Thread|null>,
 *   // createThread and appendMessage return the LIVE record the repo wrote, NOT a copy: the
 *   // controller mutates it while streaming and hands the same object to checkpoint/finalize
 *   // (every backend write snapshots it). Reads (getThread/getMessages/getPath) return copies.
 *   // core/fakes.mjs' repo clones instead — a visible difference when coding against the fake.
 *   createThread(init?: Partial<Thread>): Thread,
 *   updateThread(id: string, patch: Partial<Thread>, opts?: {silent?: boolean}): Promise<Thread|null>,
 *   deleteThread(id: string): Promise<void>,
 *   getMessages(threadId: string): Promise<Message[]>,
 *   getPath(threadId: string, headId?: string|null): Promise<Message[]>,
 *   appendMessage(threadId: string, partial: Partial<Message>): Message,
 *   putMessage(msg: Message): Promise<void>,
 *   checkpoint(msg: Message): void,
 *   finalize(msg: Message): Promise<void>,
 *   deleteSubtree(messageId: string): Promise<{removed: string[], headId: string|null}>,
 *   scanMessages(visitor: (m: Message) => boolean|void): Promise<void>,
 *   putAttachment(att: Attachment): Promise<string>,
 *   getAttachment(id: string): Promise<Attachment|null>,
 *   listAttachments(threadId: string): Promise<Attachment[]>,
 *   deleteAttachment(id: string): Promise<void>,
 *   listRecipes(): Promise<Recipe[]>, putRecipe(r: Recipe): Promise<void>, deleteRecipe(id: string): Promise<void>,
 *   findLegacy(legacyId: string, legacyHash: string): Promise<Thread|null>,
 *   kvGet(key: string, fallback?: any): Promise<any>, kvSet(key: string, value: any): Promise<void>,
 *   recoverInterrupted(): Promise<number>,
 *   flush(): Promise<void>, estimate(): Promise<{usage: number, quota: number}|null>,
 *   runTx(stores: string[], mode: 'readonly'|'readwrite', fn: (tx: any) => any): Promise<any>,
 *   debug: {journalLength(): number, persistentIds(): string[]},
 * }} Repo
 */

/** net/farm.mjs — createFarmModel(app)
 * @typedef {{ update(bridge: FarmBridge|null): void, get(): FarmCaps, headers(): Record<string, string>,
 *   fetchModels(opts?: {force?: boolean}): Promise<{ids: string[], state: 'ok'|'no-farm'|'no-models'|'unreachable'|'auth'}>,
 *   modelInfo(id: string): any, setCapResolver(fn: Function): void, cap(underlying: string, name: string): 'yes'|'no'|'unknown' }} FarmModel
 */

/** net/governor.mjs — createGovernor(app)
 * @typedef {{ canStart(kind: string): boolean, acquire(kind: string, opts?: {holder?: string, abort?: Function}): (() => void)|null,
 *   hold(holder: string, opts?: {note?: string}): void, holdNote(): string|null, release(holder: string): void,
 *   state(): {foreground: 'idle'|'streaming'|'held', holder: string|null}, onChange(fn: Function): () => void }} Governor
 */

/** app/controller.mjs — createController(app)
 * @typedef {{ newThread(init?: Partial<Thread>): Thread, selectThread(id: string|null): Promise<void>|void,
 *   current(): {thread: Thread|null, path: Message[]},
 *   send(draft: Draft): Promise<void>,
 *   generate(opts: {threadId: string, parentId: string|null, into?: Message, mode?: 'new'|'continue', model?: string,
 *     params?: Params, recipeId?: string, extraBlocks?: RequestBlock[], extraTurns?: ExtraTurn[],
 *     holder?: string, noImages?: boolean}): Promise<GenerationResult|null>,
 *   preview(opts?: {draft?: Draft, threadId?: string, parentId?: string|null, mode?: 'new'|'continue'}): Promise<RequestDraft>,
 *   stop(): void, isStreaming(): boolean, abortThread(threadId: string|null): Promise<boolean>,
 *   refreshView(): Promise<void>|void }} Controller
 */

/** One wire turn appended to a request but never stored (P2 kickoff, §2.6 AC). `extraBlocks` can
 *  only grow the LAST message of the path; an extra TURN is its own message, which is what the
 *  continue fallback's trailing user block has to be. It reaches the wire with `msgId: null`, and
 *  budget-trim never drops a message whose msgId is null.
 * @typedef {{ role?: 'user'|'assistant', blocks: RequestBlock[] }} ExtraTurn
 */

/** A block inside RequestDraft.messages[].blocks.
 * @typedef {{type: 'text', text: string, tag: 'user'|'doc'|'search'|'scene'|'assistant'|'continue'}
 *   | {type: 'image', attId: string, dataUrl?: string}} RequestBlock
 */

/** render/thread-view.mjs — createThreadView(app, els.messages)
 * @typedef {{ showPath(thread: Thread|null, path: Message[], opts?: {siblings?: Map<string, {position: number, count: number}>}): void,
 *   upsert(msg: Message): void, remove(ids: string[]): void,
 *   beginStream(msgId: string): {paint(content: string, reasoning: string|null): void, setStatus(status: string): void, end(msg: Message): void},
 *   scrollToMessage(id: string, opts?: {flash?: boolean}): void, isStuck(): boolean, setOutsideContext(ids: Set<string>): void,
 *   rowOf(id: string): HTMLElement|null,
 *   debug: {paintStats(): {count: number, p50: number, p95: number, max: number}, renderOneShot(markdown: string): HTMLElement} }} ThreadView
 */

/** ui/composer.mjs — createComposer(app, els)
 * @typedef {{ getDraft(): Draft, setText(s: string): void, insertText(s: string): void, clear(): void, focus(): void,
 *   addPart(part: Part, opts: {label: string, thumbDataUrl?: string, status?: string}): string,
 *   updatePart(key: string, patch: object): void, removePart(key: string): void,
 *   setBusy(state: any): void, setSendState(s: {label: string, disabled?: boolean, armed?: boolean}): void, isLocked(): boolean,
 *   region(name: 'above'|'tray'|'tools'|'meter'): HTMLElement, on(ev: 'input'|'submit', fn: Function): () => void }} Composer
 */

/** ui/model-picker.mjs — createModelPicker(app, els.model)
 * @typedef {{ value(): string, set(id: string, opts?: {byUser?: boolean}): void, refresh(opts?: {force?: boolean}): Promise<void>|void }} ModelPicker
 */

/** ui/sidebar.mjs — createSidebar(app, els.list)
 * @typedef {{ render(opts?: {rescan?: boolean}): void, highlight(threadId: string|null): void }} Sidebar
 *   `render()` repaints from the thread list; `render({rescan:true})` ALSO re-cursors the message
 *   store for the per-thread dots (P1 fix round, DISCUSS D-M10.2 — main.mjs asks for it once, after
 *   recoverInterrupted). A caller that passes nothing costs nothing.
 */

/** ui/dialogs.mjs — createDialogs(app)
 * @typedef {{ confirm(o: {title: string, body?: string, ok?: string, danger?: boolean}): Promise<boolean>,
 *   prompt(o: {title: string, value?: string, placeholder?: string}): Promise<string|null>,
 *   popover(anchorEl: HTMLElement, build: (el: HTMLElement) => void): {close(): void},
 *   toast(text: string, opts?: {kind?: 'info'|'warn'|'error'}): void }} Dialogs
 */

// ---------------------------------------------------------------------------------------------
// App, layout, loader
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Studio (S0 kickoff; studio plan §3.3, trimmed to what the Computer + benches actually use —
// the S1 map typedefs are NOT here, S1 having been replaced by docs/LOLCHAT_COMPUTER_SPEC.md).
// ---------------------------------------------------------------------------------------------

/** thread.studio — per-thread workbench state (pure merge/clamp lives in app/studio-state.mjs).
 * @typedef {{ panel: string|null, width: 'chat'|'split'|'work', graphId: string|null,
 *   projectId: string|null, boardId: string|null, updatedAt: number }} StudioState
 */

/** @typedef {{ autoApply: boolean, autoFix: boolean, editPolicy: 'auto'|'whole'|'anchored' }} ProjectSettings */

/** A scratch project. Authoritative on disk (project.json); mirrored in the `projects` store.
 * @typedef {{ id, name, kind: 'canvas'|'dom'|'three'|'p5'|'svg'|'board', createdAt, updatedAt,
 *   settings: ProjectSettings, hidden?: boolean }} ProjectMeta
 */

/** A `projects` row: the local mirror that ties a project to a thread. Files never live here.
 * @typedef {{ id, threadId: string|null, name, kind, createdAt, updatedAt }} ProjectRef */

/** One row of the `graphs` store (one graph per thread; the Computer panel owns the shape).
 * @typedef {{ id, threadId, title, createdAt, updatedAt, rev, parts: GraphPart[], wires: GraphWire[],
 *   settings: object, view: {x, y, zoom} }} GraphDoc
 */

// ---------------------------------------------------------------------------------------------
// The Computer panel (C1 kickoff; docs/LOLCHAT_COMPUTER_SPEC.md §2-§4, frozen in §2.6 BG).
// Nothing here is read by any pre-C1 module: the whole block is additive.
// ---------------------------------------------------------------------------------------------

/** A value travelling a wire. Typed but forgiving (spec §2): a mismatch is a visible error on the
 * part, never a silent coercion.
 *
 * K2 (COMPUTER_PLAN §6.8) adds two ADVISORY facets, and they are advisory in the strict sense:
 * `accepts()` never reads them, `isValue()` never requires them, and a value stored before K2
 * loads with both absent, meaning `format:'plain'`. They drive exactly three things — which
 * preview renders a value, how it is FENCED in an assembled prompt (§5.3), and what a Preview
 * part defaults to. Kinds stay at five; a sixth kind would be a sixth way to tell a beginner no.
 * @typedef {{ kind: 'text'|'image'|'list'|'json'|'file', data: any,
 *   format?: 'plain'|'markdown'|'code'|'svg'|'html'|'css'|'js', lang?: string }} GraphValue */

/** One part on the canvas. `settings` is the part type's own; `value`/`state`/`error`/`stats`/
 * `fanout` are RUNTIME fields, written only through the session's patchPart() and never undoable.
 * `fanout` is C2's per-item record (§2.6 BH-3): how many items a fanned run had, how many finished,
 * and the message of every item that failed — which is what makes "one bad item never kills the
 * run" visible rather than merely true.
 * @typedef {{ id, type, x, y, w, h, settings: object, value: GraphValue|null,
 *   state: 'idle'|'stale'|'queued'|'running'|'waiting'|'done'|'error', error: string|null,
 *   stats: {ms: number, tokens: number, calls?: number}|null,
 *   fanout?: {n: number, done: number, ok: number, failed: number,
 *     errors: {i: number, message: string}[]}|null,
 *   demo?: boolean }} GraphPart
 *
 * K5 kickoff (COMPUTER_PLAN §10.2, §7.6; addendum KE-7): `demo` says the part's VALUE is a
 * lesson's RECORDED answer, not a generation. Written only through `patchPart({value, demo:true})`
 * (a runtime door, never undoable); ANY later patch that writes `value` without saying `demo`
 * clears it, so a real generation can never inherit the badge. Kept by `normaliseDoc` only while
 * the part holds a value, exported with the value (serialize v4), and drawn by the canvas as the
 * permanent `demo answer — not generated` badge. */

/** One wire: a part's single output into ONE named input port of another. Several wires into the
 * same port are legal and arrive as an ordered list.
 *
 * K2 (COMPUTER_PLAN §5.1): `label` NAMES the arrival. It is a PROGRAM edit — undoable, `rev`-
 * bumping, it stales `to` and everything downstream, it is exported, and it is part of
 * `.lolgraph.json` v2. Default `''`, which means an unnamed input supplied positionally.
 * Matching is `key()` (casefolded, whitespace-collapsed); the prompt heading is `name()` (the
 * reader's own spelling). Labels and ports are different namespaces (rule 7): a wire always
 * targets a declared port, and the label distinguishes arrivals WITHIN it.
 * K3 (COMPUTER_PLAN §4.6): `back` DECLARES a loop. A wire that would close a cycle is no longer
 * refused — it is created with `back:true`, drawn dashed with a `↺`, and its target is a loop
 * head. `order()` runs on the graph with back edges REMOVED, which is what gives a loop its
 * unit delay and stops a loop head deadlocking. A cycle containing no gate part is still refused
 * (`loop-ungated`). Written by `addWire`, preserved by `normaliseDoc`, exported in v3.
 * @typedef {{ id, from: string, to: string, port: string, label?: string, back?: boolean }} GraphWire */

/** A part type. The catalogue (graph/parts/index.mjs) is the only place these are constructed.
 * `run()` throws an Error to fail the part; the message is what the canvas shows.
 *
 * K3 (COMPUTER_PLAN §4.2, §6.6) adds four optional DECLARATIONS, all defaulting to false/absent,
 * all read by the scheduler and by nothing else:
 *   `manual`     never placed in the active set by `mode:'all'` — an unpressed Button. The plan
 *                preview reports them (`2 buttons not pressed`); a ▶ on one runs it.
 *   `volatile`   never satisfied by a stored value: a `done` part is still dirty. `Dialog` with
 *                `askEveryRun:true` maps to it. (A spec flag, so `runSet` needs no part types.)
 *   `control`    this part may return the `{value, bar}` outcome and may park. Advisory: the
 *                runner accepts the shapes from anyone, but the canvas uses it to know which
 *                boxes draw an inline control and the loop gate check reads it (§4.6).
 *   `thinksFor`  a part that thinks only in some settings (Condition in `mode:'model'`). The run
 *                plan asks it before counting a generation, so the preview tells the truth for a
 *                free text-mode Condition instead of over-quoting the farm.
 * `output: 'any'` (K3) means "whatever came in, passed through": `wireRefusal` skips the kind
 * check on the way OUT of such a part, and the value the part actually returns still carries a
 * real kind. It is a SPEC declaration and never a GraphValue.kind.
 * K4 (COMPUTER_PLAN §6.5, §6.7) adds two more, both read in ONE place each, both defaulting to
 * false, so no part type is ever known by name outside the catalogue:
 *   `inert`      never placed in the active set by ANY mode, seeds included, never counted by the
 *                plan preview. The three annotation parts (Sticky, Section, Title) are what it is
 *                for: they are there for the reader, not for the run. Honoured in
 *                graph/topo.mjs `activeSet()`.
 *   `quiet`      the canvas does not draw the one-line value strip under this part's body. A part
 *                that SHOWS its own value (Text renders it as markdown, Preview draws it) would
 *                otherwise print the same text twice. Honoured in graph/canvas.mjs `syncBox()`.
 * K5 (COMPUTER_PLAN §6, addendum KE-2) adds ONE more, read in ONE place (graph/canvas.mjs, the box
 * title and `labelOf`):
 *   `titleOf`    the box's title for THIS part, or null for `label`. A Preview placed as the
 *                "p5.js sketch" preset is titled "p5.js sketch", not "Preview" — a person finds the
 *                box they picked by the name they picked it by. The catalogue's `presetTitle()`
 *                is the only implementation; a part never spells a preset's name itself.
 * K6 (addendum KF-4) adds three, so the capability resolver and the drop router never know a part
 * type by name either:
 *   `modelOf`    this part SENDS what arrives to a model; returns the served model it asks ('' =
 *                the farm default). Read ONLY by graph/takes.mjs `consumersOf()`. The Instruction
 *                declares it.
 *   `holds`      the kind of FILE this box holds ('image' | 'pdf' | 'audio' | 'text'). Read ONLY
 *                by graph/parts/index.mjs `holderOf(kind)`, which is how a dropped PDF finds the
 *                Document box.
 *   `adopt`      the settings a box is PLACED with for one dropped file: text → {text, name},
 *                image → the intake's {dataUrl, name, w, h}, pdf/audio → a MediaRef. Read ONLY by
 *                computer/drops.mjs. Every key it returns is a key of `defaults()`.
 * The K6 fix round adds two more, each read in ONE place:
 *   `passes`       what arrives goes on unchanged (Button, Condition, Confirm, Toggle, Timer,
 *                  Repeat). Read ONLY by graph/takes.mjs `consumersOf()`, which looks THROUGH such
 *                  a box for the model a picture or a sound is headed to.
 *   `onlyWhenUsed` a RUN-ALL leaves this part out while no wire is drawn from it; ▶ on its own face
 *                  still runs it. Read ONLY by graph/topo.mjs `activeSet()`. The Document box
 *                  declares it: reading a PDF nobody uses would send the file to the farm for nothing.
 * @typedef {{ type: string, label: string, order?: number, thinks?: boolean,
 *   titleOf?: (part: GraphPart) => string|null,
 *   modelOf?: (part: GraphPart) => string,
 *   holds?: 'image'|'pdf'|'audio'|'text',
 *   adopt?: (payload: object) => object,
 *   size?: {w: number, h: number},
 *   manual?: boolean, volatile?: boolean, control?: boolean, inert?: boolean, quiet?: boolean,
 *   passes?: boolean, onlyWhenUsed?: boolean,
 *   thinksFor?: (part: GraphPart) => boolean,
 *   inputs: {name: string, label: string, accepts: string[], many?: boolean, required?: boolean}[],
 *   output: 'text'|'image'|'list'|'json'|'file'|'any'|null,
 *   defaults(): object,
 *   render(host: HTMLElement, part: GraphPart, ctx: PartCtx): {update(part: GraphPart): void, destroy(): void, edit?(): boolean},
 *     // edit?() (critic R1, K-2): open the box for typing; the canvas calls it on a double-click in
 *     // the body and on Enter/F2 with one box selected. Answers whether an editor opened.
 *   run(input: RunInput): Promise<PartOutcome>,   // null ONLY when `output` is null (BH-6)
 *   settings?(host: HTMLElement, part: GraphPart, ctx: PartCtx): {update(part: GraphPart): void, destroy(): void}
 * }} PartSpec */

/** What a part's render()/settings() may do to the document. `update` patches settings (and marks
 * the part stale); `commit` closes one undo entry around the edits since the last commit.
 * K5 kickoff (addendum KE-3): `sandbox()` is the Computer's ONE guest (the same object `RunInput.sandbox`
 * hands a run), so a creative box can re-draw ITS OWN source on edit without a run, a generation or
 * a seat. It resolves null when the sandbox is disabled. It never races a run: KE-3's rule is that an
 * edit-draw waits while `ctx.app.host.runner.running()` is true.
 * @typedef {{ update(patch: object): void, commit(label: string): void, open(value: GraphValue): void,
 *   sandbox(): Promise<SandboxHost|null>,
 *   app: any, part: GraphPart }} PartCtx */

// ---------------------------------------------------------------------------------------------
// K5 kickoff (COMPUTER_PLAN §6, §10; addendum KE). The palette, the presets, the tutorial.
// Additive: nothing before K5 reads any of it.
// ---------------------------------------------------------------------------------------------

/** The five palette groups, in menu order (COMPUTER_PLAN §6's table). Frozen.
 * @typedef {'bring'|'think'|'show'|'control'|'annotate'} PaletteGroup */

/** A PRESET: a part type plus the settings that make it a named, first-class box (addendum KE-2).
 * `id` is globally unique across presets AND part types (a lesson says `preset:'svg'`, the menu
 * says `data-entry="svg"`). `match` is the subset of settings that IDENTIFIES a placed part as
 * this preset — `presetOf(part)` compares exactly those keys, so a person editing the source of a
 * "p5.js sketch" leaves it a p5.js sketch. `settings` is merged over `spec.defaults()` by addPart,
 * and every key in it MUST be a key of `defaults()` or export drops it (serialize.mjs
 * exportSettings).
 * @typedef {{ id: string, type: string, group: PaletteGroup, label: string, title: string,
 *   desc: string, glyph: string, keywords: string[], order: number,
 *   settings: object, match: object, size?: {w: number, h: number} }} PartPreset */

/** One row of the ＋ menu (graph/palette.mjs `buildPalette`). A plain part type has
 * `entry === type` and `preset === null`; a preset row has `entry === preset.id`.
 * @typedef {{ entry: string, type: string, preset: string|null, group: PaletteGroup,
 *   label: string, desc: string, glyph: string, keywords: string[], order: number,
 *   settings: object, size: {w: number, h: number}|null }} PaletteEntry */

/** A tutorial checkpoint (addendum KE-5). Pure data; `computer/tutorial/check.mjs` is the only
 * interpreter and chat-lint rule 15 the only validator. Counts compare through `Cmp`: a number
 * (==), or a string '>=3' '<=2' '>1' '<4' '==0'.
 * @typedef {number|string} Cmp
 * @typedef {{has: {id?: string, type?: string, preset?: string, setting?: string,
 *     nonEmpty?: boolean, equals?: any, count?: Cmp}}
 *   | {wire: {from?: string, to?: string, fromType?: string, toType?: string,
 *     fromPreset?: string, toPreset?: string, port?: string,
 *     label?: string, count?: Cmp}}
 *   | {ran: {partId?: string, type?: string, preset?: string,
 *     state?: 'done'|'error'|'stale'|'idle', demoOk?: boolean}}
 *   | {report: {generations?: Cmp, ran?: Cmp, errors?: Cmp, stopped?: 'capped'|'cancelled'|'yielded'}}
 *   | {edited: {partId: string, setting: string}}
 *   | {all: any[]} | {any: any[]}
 *   | {manual: true}} Check */

/** Where a step's `Show me` points (addendum KE-5).
 * @typedef {{partId: string} | {menu: string} | {wire: {from: string, to: string}}} Show */

/** @typedef {{ id: string, text: string, check: Check, show?: Show, hint?: string }} LessonStep */

/** A lesson module's default export (addendum KE-4). `doc` is a `.lolgraph.json` object — the
 * canvas's Export with values OFF — whose part ids are AUTHORED ('p_topic') and survive the fork.
 * @typedef {{ id: string, n: number, title: string, subtitle: string, idea: string,
 *   minutes: number, needsFarm: 'no'|'one'|'few',
 *   doc: {lolgraph: number, title?: string, parts: object[], wires: object[], view?: object},
 *   steps: LessonStep[], demo?: Record<string, GraphValue>, next?: string }} Lesson */

/** A template module's default export (addendum KE-4). Opened as a NEW library document with
 * fresh ids — a template has no steps, so nothing refers to its part ids.
 * @typedef {{ id: string, title: string, subtitle: string, needsFarm: 'no'|'one'|'few',
 *   generations: number,
 *   doc: {lolgraph: number, title?: string, parts: object[], wires: object[], view?: object} }} Template */

/** kv `computer:tutorial` (KV_KEYS.computerTutorial): progress per lesson id. `ticks` latch and
 * never un-tick; `step` is the index of the first unticked step; `demo` lists the part ids whose
 * value is a recorded answer; `marks` holds, per step id, the settings that step's `edited` checks
 * watch, as they were when the step became current.
 * @typedef {Record<string, {step: number, ticks: string[], forkedDocId: string|null,
 *   doneAt: number|null, demo: string[], marks?: Record<string, {parts: {id: string, settings: Record<string, string>}[]}>}>} TutorialProgress */

// ---------------------------------------------------------------------------------------------
// K6 kickoff (addendum KF): files a box can take — PDFs and sound — and what the farm and its
// models can do with them. Additive: nothing before K6 reads any of it.
// ---------------------------------------------------------------------------------------------

/** A capability verdict. `unknown` is its own state and is SHOWN as unknown: nothing about a model
 * is ever concluded from a field that is absent or defaulted (build rule 7).
 * @typedef {'yes'|'no'|'unknown'} Verdict */

/** The three model capabilities `app.farm.cap(model, name)` answers for (KF-2).
 * @typedef {'vision'|'audio'|'pdf'} CapName */

/** One served model's capabilities, as far as the farm has said (graph/takes.mjs `modelCaps`).
 * @typedef {{ model: string, vision: Verdict, audio: Verdict, pdf: Verdict }} ModelCaps */

/** A kind of FILE a box holds. `text` is a dropped .txt/.md/.csv/.json (it becomes a Text box).
 * @typedef {'image'|'pdf'|'audio'|'text'} MediaKind */

/** What the capability resolver may know about the farm, gathered ONCE by `farmViewOf(app)` so the
 * resolver itself stays pure. `cap` is `app.farm.cap`; `underlyingOf(alias)` the model behind a
 * served name; `models` the served names in catalogue order.
 * @typedef {{ present: boolean, engine: string|null, ocr: boolean, defaultModel: string|null,
 *   models: string[], cap: (model: string, name: CapName) => Verdict,
 *   underlyingOf: (alias: string) => string }} FarmView */

/** One consumer of a box's file: a part downstream that sends what arrives to a model.
 * @typedef {{ partId: string, model: string, state: 'yes'|'no'|'unknown' }} TakeConsumer */

/** Can THIS box pass the kind of file it holds to something that can use it, right now? (KF-3)
 * `state` is the box's answer — `unwired` when nothing downstream would use it yet. `why` is a
 * frozen code (KF-3's table), `reason` the visible sentence (null only when `state` is `yes` and
 * there is nothing worth saying), `model` the model the sentence is about.
 * @typedef {{ kind: MediaKind, state: 'yes'|'no'|'unknown'|'unwired', why: string,
 *   reason: string|null, model: string|null, consumers: TakeConsumer[] }} TakeVerdict */

/** A file the Computer keeps on THIS machine (computer/media.mjs). The bytes live in the
 * `attachments` store under `threadId: 'computer:media'`, deduplicated by sha256; a part holds
 * only this reference, in its settings, so a `.lolgraph.json` never carries the bytes.
 * @typedef {{ fileId: string, name: string, mime: string, size: number, sha256: string,
 *   durationSec?: number }} MediaRef */

/** What the runner hands a part's run(). `inputs` is keyed by port name, in wire order.
 * `item` is set ONLY while the part is running per item of a fan-out (C2, §2.6 BH-2): `i` is the
 * zero-based item index, `n` the item count. A part that varies its output per item (Ask under a
 * Repeat) reads it; every other part ignores it and behaves exactly as it does on one value.
 * `sandbox` (C3, §2.6 BJ) resolves the panel's ONE sandbox host, or null when this build has
 * none. `Code`/`Render` call it; every other part ignores it and never pays for an iframe.
 * `labels` (K2, COMPUTER_PLAN §5) is the wire LABEL of every arrival, keyed by port name and in
 * EXACTLY the order of `inputs[port]` — `labels.in[2]` names `inputs.in[2]`. It is how a part can
 * bind named parameters without being handed the document: the runner already walks the wires to
 * gather the values, so it hands over what it read there. A part written before K2 ignores it.
 * @typedef {{ part: GraphPart, inputs: Record<string, GraphValue[]>,
 *   labels: Record<string, string[]>, app: any, ask: any,
 *   signal: AbortSignal, thread: Thread|null, cache: boolean,
 *   item?: {i: number, n: number}|null,
 *   sandbox?: (() => Promise<SandboxHost|null>)|null,
 *   iteration?: number, run?: {id: string, mode: 'all'|'from'|'button'} }} RunInput */

// ---------------------------------------------------------------------------------------------
// K3 — one scheduler for push and pull: barriers, parks, loops and the run journal
// (COMPUTER_PLAN §4, §6.6, §7.3-§7.5). Frozen at the K3 kickoff. PURE shapes.
// ---------------------------------------------------------------------------------------------

/** What a part's `run()` may resolve to (§4.5). Three shapes, and only three:
 *   a GraphValue          the common case, unchanged since C1. Implies `bar:false`.
 *   null                  success for a part whose `output` is null, a failure for everyone else.
 *   {value, bar}          a CONTROL outcome: the value still flows (`gather()` reads it off the
 *                         doc), and `bar:true` refuses to ACTIVATE the downstream. Never conflate
 *                         the two — that separation is the whole of §4.5.
 *   {park, settle}        the part SUSPENDS: the runner marks it `waiting`, journals the wait,
 *                         and goes on serving other branches. `settle` resolves to one of the
 *                         three shapes above when the human, or the clock, answers.
 * @typedef {GraphValue|null|{value: GraphValue|null, bar?: boolean}
 *   |{park: ParkRequest, settle: Promise<GraphValue|null|{value: GraphValue|null, bar?: boolean}>}
 *   } PartOutcome */

/** What a parked part is waiting FOR, in the words the run bar and the journal both use.
 * `untilMs` is an absolute wall-clock deadline (a Timer, or a Confirm's `timeoutSec`); `question`
 * is what a Dialog or a Confirm is asking, so "2 questions waiting" can name them.
 * @typedef {{ kind: 'confirm'|'dialog'|'timer', partId: string, question?: string,
 *   untilMs?: number|null, since?: number }} ParkRequest */

/** One run, as `graph/journal.mjs` stores it under `computer:runs:<graphId>` (§7.3). `events` is
 * a ring of the last 200; the last 5 rows are kept per graph and older rows are pruned on write.
 * `status` is `running`/`waiting` while it is live, which is also the crash-resume record: a row
 * that comes back with `endedAt:null` is what puts the resume banner on screen (§7.5).
 * @typedef {{ id: string, startedAt: number, endedAt: number|null,
 *   mode: 'all'|'from'|'button', seeds: string[],
 *   status: 'running'|'waiting'|'done'|'stopped'|'error'|'capped'|'limited',
 *   cap: number, spent: number, tokens: number, model: string|null,
 *   iterations: Record<string, number>,
 *   waits: {partId: string, kind: string, since: number, question?: string}[],
 *   events: {t: number, partId: string|null,
 *     kind: 'start'|'done'|'error'|'bar'|'item'|'wait'|'resume'|'limit', by?: string}[],
 *   report: RunReport|null }} RunJournal */

/** Which ceiling stopped a run (§4.6). All four are STOPS, not errors: the run ends, the part
 * goes `stale`, and the report names the ceiling, the part and the number to raise it to.
 * @typedef {{ ceiling: 'maxIterations'|'maxGenerations'|'maxWallMs'|'maxActivations',
 *   partId: string|null, limit: number, reached: number, raiseTo: number }} RunLimit */

/** The four ceilings, as one run reads them (§4.6). Every one is raisable FOR THAT RUN through
 * `run({limits})`; none of them is silently raised by anything. */
export const RUN_LIMITS = Object.freeze({
  maxIterations: 8,        // activations of ONE part in one run; raisable to 100
  maxGenerations: 50,      // == DEFAULT_MAX_ITEMS, counted where generations are made
  maxWallMs: 600000,       // 10 minutes of wall clock, PARKED TIME INCLUDED
  maxActivations: 2000,    // total part executions in one run
});

// ---------------------------------------------------------------------------------------------
// K2 — arrow labels as named parameters (COMPUTER_PLAN §5, graph/bind.mjs). PURE shapes: nothing
// here knows a farm, a DOM node or a part type. Frozen at the K2 kickoff.
// ---------------------------------------------------------------------------------------------

/** One bound parameter: every arrival that shares a label, in wire order. `values.length > 1` is
 * a JOIN (rule 2), never a fan-out and never last-wins. `unlabelled:true` marks a positional
 * arrival, whose `name` is then `Input <n>`. `mentioned` is whether the instruction names it.
 * `pending` is set only by a PRE-RUN bind (the transcript's Sent tab): the wire exists, the
 * upstream part has not produced a value yet, and the placeholder is what the reader sees.
 * @typedef {{ name: string, key: string, mentioned: boolean, unlabelled: boolean,
 *   values: GraphValue[], pending: boolean, from: string[] }} BoundParam */

/** What `bindInputs()` answers. `unused` = labels the instruction never mentions (supplied last,
 * a grey chip, NOT an error, rule 4). `unwired` = names the instruction mentions with no arrow to
 * supply them (a warning chip, NOT an error, rule 5).
 * `prerun` marks the DOCUMENT door (`bindInputs`), the only one that may still see a list the
 * runner is going to fan out (§4.7).
 * @typedef {{ params: BoundParam[], unused: string[], unwired: string[],
 *   prerun?: boolean }} BindResult */

/** What `assemblePrompt()` answers — the body exactly as it goes on the wire. `images` are data
 * URLs, in parameter order; an image is NEVER in `prompt` (§5.3). `truncated` is null unless the
 * budget bit, and then it names what was cut so the badge can say it in numbers.
 * `blocks` are the `# Inputs` cards as they were BUILT — heading text, exact body, and the bound
 * parameter each came from — so a reader of the prompt never has to re-parse it to find its
 * structure, and `instruction` is the tail exactly as it goes out. `cut` is measured: the prompt
 * as it was minus the prompt as it is.
 * @typedef {{ system: string, prompt: string, images: string[], words: number,
 *   truncated: {cut: number, of: number, params: {name: string, omitted: number}[]}|null,
 *   blocks: {name: string, heading: string, body: string, param: BoundParam}[],
 *   instruction: string
 * }} AssembledPrompt */

/** Everything the Instruction part will send, assembled once and read twice — by `run()` and by
 * the transcript drawer, which is what makes "what you read is what will be sent" true rather
 * than merely claimed. `call` is the DECLARED request: `maxTokens: null` means the ask spine
 * decides (§3.4.1). `fallback` is true when the empty-instruction sentence was used.
 * `fan` is set when the runner will run this box once per item of a list still standing at its
 * port (§4.7): the assembly is then generation `index` of `n`.
 * @typedef {{ bind: BindResult, fan: {n: number, index: number}|null,
 *   assembled: AssembledPrompt, instruction: string,
 *   fallback: boolean, budget: {chars: number, tokens: number, assumed: boolean},
 *   call: {model: string|null, shape: 'text'|'list'|'json', schema: any,
 *     maxTokens: number|null, priority: 'background'|'foreground', task: string},
 *   error: string|null }} InstructionPlan */

/** The sandbox host (sandbox/host.mjs), frozen at the C3 kickoff and shared with the S2 bench.
 * `compute` is the deterministic path (a value comes back as JSON); `run` + `snapshot` are the
 * visual one (the guest paints, the host captures a PNG). Neither ever throws: a failure is an
 * `ok:false` with a sentence, because a part must be able to SHOW what went wrong.
 * @typedef {{
 *   mount(el: HTMLElement): void,
 *   state(): 'idle'|'booting'|'ready'|'running'|'stalled'|'disabled',
 *   ready(): Promise<boolean>,
 *   logs(): {level: string, text: string}[],
 *   errors(): any[],
 *   runs(): number,
 *   compute(req: {code: string, inputs?: object, timeoutMs?: number, signal?: AbortSignal}):
 *     Promise<{ok: boolean, ms: number, json: string|null, error: any}>,
 *   run(req: {code: string, kind: string, params?: object, html?: string, css?: string, libs?: string[]}):
 *     Promise<{ok: boolean, ms: number, error: any}>,
 *   snapshot(o?: {maxPx?: number}): Promise<{dataUrl: string, w: number, h: number}|null>,
 *   params(values: object): void,
 *   stop(): void, hide(): void, destroy(): void,
 *   on(fn: (ev: any) => void): () => void,
 *   debug(): object
 * }} SandboxHost */

/** graph/fanout.mjs (C2-U1, PURE): what one part's inputs mean for one run (§2.6 BH-2).
 * `single` = run once with `inputs`; `fan` = run `n` times with `inputsFor(i)`; `refuse` = two
 * ports fan at once, which the part reports as an error instead of guessing a pairing.
 * @typedef {{ kind: 'single' }
 *   | {kind: 'fan', port: string, n: number, inputsFor(i: number): Record<string, GraphValue[]>,
 *      saltFor(i: number): number|null}
 *   | {kind: 'refuse', reason: 'many'}} FanPlan */

/** What one Run returns (and what the canvas reports). `skipped` counts parts the run could not
 * reach — a part downstream of a failure included.
 * @typedef {{ ran: number, skipped: number, errors: {partId: string, message: string}[],
 *   cancelled: boolean, ms: number,
 *   yielded?: boolean, capped?: {cap: number, spent: number, stopped: number}|null,
 *   cycle?: boolean, busy?: boolean, generations?: number,
 *   mode?: 'all'|'from'|'button', seeds?: string[], journalId?: string|null,
 *   activations?: number, iterations?: Record<string, number>,
 *   barred?: string[], waited?: number, leftStale?: string[],
 *   limited?: RunLimit|null, merged?: number }} RunReport
 *
 * C1 landing, additive (all three set by graph/runner.mjs, all three read by graph/panel.mjs):
 *   yielded  the governor gave the seat back to the human mid-run. NOT an error and NOT a cancel:
 *            the part that was running is `stale` and the next Run picks it up (§3.5.4 etiquette).
 *   capped   the run stopped AT the generation cap (`pref:computeMaxItems`, default 50) with
 *            `stopped` parts still to run. C2 owns the cap's UI; C1 only reports it.
 *   cycle    defensive: order() refused the doc, so the run executed nothing.
 * The run OPTIONS gained `maxItems?: number` alongside `only`/`cache` — "raise the cap for this
 * run only", the door C2's button calls. */

/** The result of one app.ask call. `ok:false` ALWAYS carries an error — never a silent empty.
 * @typedef {{ ok: boolean, value: any, mode: 'schema'|'prompt'|'text', raw: string,
 *   usage: object|null, ms: number,
 *   error: {kind: 'busy'|'no_farm'|'no_vision'|'empty'|'invalid'|'aborted'|'farm', message: string}|null,
 *   cached?: boolean, errors?: string[] }} AskResult
 *
 * S0 landing, additive (both optional, both set by app/ask.mjs):
 *   cached  an in-memory hit on the input hash — no seat was taken. A Retry passes `cache:false`.
 *   errors  the validate() messages behind an `invalid` result, so a panel can say WHICH field
 *           was missing instead of "the model answered the wrong shape".
 */

/** app.ask.queue / app.queue.state() — the running batch, as the chip renders it.
 * `refused` = a second batch was asked for while one was running (one batch at a time, per window);
 * `stalled` = 5 EV.FARM_TICK retries exhausted, the farm stayed busy. Both are S0-landing additive.
 * `truncated` = items dropped because the batch was longer than `pref:queueMax` — 0 normally, and
 * never silent: a caller that fans out 10 nodes must be able to tell 10 done from 6 dropped.
 * @typedef {{ label: string, i: number, n: number, running: boolean, cancelled: boolean,
 *   truncated: number, refused?: boolean, stalled?: boolean }} QueueState */

/** @typedef {{ name, code: string, lang: string, from: 'model'|'user'|'template' }} Revision */
/** @typedef {{ id, label, type: 'number'|'color'|'boolean'|'select', value, min?, max?, step?, options? }} Knob */

/** A workbench panel instance (studio plan §3.5.2). The workbench owns els.workBody; a panel owns
 * only the element it is handed.
 * @typedef {{ show(ctx: {thread: Thread|null, studio: StudioState}): void, hide(): void,
 *   destroy(): void, onThread(ctx: {thread: Thread|null, studio: StudioState}): void,
 *   debug?: any }} PanelInstance
 */

/** ui/layout.mjs buildLayout(root) → Els (plan §3.5)
 * @typedef {{ root: HTMLElement, side: HTMLElement, sideHead: HTMLElement, newBtn: HTMLButtonElement,
 *   sideTools: HTMLElement, list: HTMLElement, sideFoot: HTMLElement, main: HTMLElement,
 *   banner: HTMLElement, topline: HTMLElement, header: HTMLElement, model: HTMLSelectElement,
 *   strip: HTMLElement, messages: HTMLElement, jump: HTMLButtonElement, empty: HTMLElement,
 *   form: HTMLFormElement, above: HTMLElement, tray: HTMLElement, tools: HTMLElement,
 *   input: HTMLTextAreaElement, meter: HTMLElement, send: HTMLButtonElement, stop: HTMLButtonElement,
 *   live: HTMLElement,
 *   work: HTMLElement, workRail: HTMLElement, workHead: HTMLElement, workBody: HTMLElement }} Els
 */

/** core/app.mjs createApp({root, els}) → App. Component fields start null; main.mjs fills them.
 * @typedef {{
 *   root: HTMLElement, els: Els,
 *   bus: import('./events.mjs').Bus, registry: import('./registry.mjs').Registry,
 *   EV: typeof import('./events.mjs').EV, SLOTS: typeof import('./registry.mjs').SLOTS,
 *   t: typeof import('./i18n.mjs').t,
 *   flags: import('./env.mjs').Flags, now: () => number, rng: () => number, newId: () => string,
 *   state: {threadId: string|null, visible: boolean, pageVisible: boolean, storeMode: 'pending'|'idb'|'memory'|'memory-final'},
 *   repo: Repo|null, farm: FarmModel|null, gov: Governor|null, dialogs: Dialogs|null, view: ThreadView|null,
 *   sidebar: Sidebar|null, composer: Composer|null, picker: ModelPicker|null, controller: Controller|null,
 *   modules: Record<string, any>,   // loaded module namespaces by loader key (features may read siblings)
 *   [feature: string]: any,         // features may attach their own API (e.g. app.branching)
 * }} App
 */

/** One loader table row (main.mjs MODULES).
 * @typedef {{ key: string, path: string, role: 'component'|'feature', fake: string|null, phase: string }} ModuleRow
 */

/** `window.LolChat.failed[key]`
 * @typedef {{ key: string, path: string, role: 'component'|'feature', error: string, faked: boolean }} LoadFailure
 */

/** `window.LolChat`
 * @typedef {{ ready: boolean, version: string, app: App|null, failed: Record<string, LoadFailure>,
 *   fakes: string[], migration: Promise<any>|null, debug: Record<string, any> }} LolChatGlobal
 */

/** state/migrate-v0.mjs — `migrateV1({repo, storage, now, bus?})`. `bus` is the P0 kickoff's precision
 *  of §3.4: when given, migrateV1 emits THREADS_CHANGED{reason:'migrate', ids} itself after importing
 *  (main.mjs passes app.bus and does NOT emit it). Node tests may omit it.
 * @typedef {{ repo: Repo, storage: {getItem(k: string): string|null, setItem(k: string, v: string): void, removeItem(k: string): void},
 *   now?: () => number, bus?: import('./events.mjs').Bus|null }} MigrateOptions
 */

// ---------------------------------------------------------------------------------------------
// P2 shapes (farm etiquette, context budget, tree, transfer) — added at the P2 kickoff
// ---------------------------------------------------------------------------------------------

/** app/seat-wait.mjs — the pure decision run on EVERY FARM_TICK and FARM_CHANGE (§4 P2-U1).
 *  'resend' send again now · 'schedule' arm a jittered resend · 'wait' do nothing (not looked at,
 *  any schedule dropped) · 'giveup' stop waiting, turn the note into an error · 'manual' only the
 *  Try now button can move it.
 * @typedef {{ caps: FarmCaps|null, visible: boolean, pageVisible: boolean, waitingSince: number,
 *   now: number, attempts: number, scheduledAt: number|null }} SeatDecisionInput
 * @typedef {'resend'|'schedule'|'wait'|'giveup'|'manual'} SeatDecision
 */

/** ctx/budget.mjs — planTrim()'s verdict. `keptIds`/`droppedIds` hold RequestDraft message ids;
 *  a message with `msgId === null` (an ExtraTurn) is never dropped and never listed.
 * @typedef {{ keptIds: string[], droppedIds: string[], total: number, over: boolean }} TrimPlan
 */

/** ctx/budget.mjs — gateVerdict(). 'confirm' = the second click sends; 'block' = it cannot fit.
 * @typedef {{ kind: 'ok'|'confirm'|'block', seconds: number|null }} GateVerdict
 */

/** app/branching.mjs — attached as `app.branching` by its install(app) (§4 P2-U3).
 * @typedef {{ regenerate(msg: Message, opts?: {params?: Params, recipeId?: string}): Promise<any>,
 *   editUser(msg: Message, text: string): Promise<any>,
 *   switchSibling(msgId: string, dir: -1|1): Promise<void>,
 *   fork(msg: Message): Promise<Thread|null>,
 *   deleteSubtree(msg: Message): Promise<boolean> }} Branching
 */

/** app/transfer-format.mjs — the export envelope. `lolchat` is the format version and is 1.
 * @typedef {{ lolchat: 1, exportedAt: number, app: string, threads: Thread[], messages: Message[],
 *   attachments: (Omit<Attachment, 'blob'> & {blob: undefined, blobBase64?: string})[] }} TransferBundle
 * @typedef {{ threads: Thread[], messages: Message[], attachments: Attachment[], errors: string[] }} ParsedImport
 */

// ---------------------------------------------------------------------------------------------
// kv keys (plan §3.7). The `kv` store is a flat string→JSON map shared by every unit, so the key
// SPELLINGS are contract, not convention: harness scenarios assert them literally (p2-calibrate
// reads `tokRatio:Qwen3.8-27B-UD-Q2_K_XL`). Build them with KV_KEYS rather than by hand.
//
//   schemaVersion            number   the record schema (1)                            P0-U4
//   v1RawHash                string   hash of the migrated localStorage blob           P0-U4
//   persistRequested         boolean  navigator.storage.persist() was called once      P0-U4
//   ui:lastThreadId          string   the thread to reselect at boot                   P1
//   ui:reasoningOpen         string[] the last 200 message ids with reasoning open      P1-U3
//   ui:wrap                  boolean  code blocks wrap                                 P1-U3
//   ui:search:<threadId>     string   an in-thread find box query                      P4
//   tokRatio:<underlying>    number   chars-per-token EMA, calibrated from usage       P2-U2
//   promptTokSec:<farmId>    number   prompt tokens/second EMA (the cost gate's 's')   P2-U2
//   pref:gateThreshold       number   tokens above which the gate asks (default 16000) P2-U2
//   pref:notify              boolean  desktop notification on a long finished reply    P2-U1
//   continueMode:<underlying> 'prefill'|'userTurn'  what Continue does on this model    P2-U3
//   cap:<farmId>:<underlying>:vision  'yes'|'no'   remembered vision verdict            P3-U1
//   structuredMode:<farmId>:<underlying> 'json'|'prompt'                                P4-U2
//   ttsFormat                string   the audio format Kokoro accepted                 P4-U4
//
// There is deliberately NO global last-model key (§3.10): a new thread always starts on the farm
// default.
/** @type {Readonly<Record<string, any>>} */
export const KV_KEYS = Object.freeze({
  schemaVersion: 'schemaVersion',
  v1RawHash: 'v1RawHash',
  persistRequested: 'persistRequested',
  lastThreadId: 'ui:lastThreadId',
  reasoningOpen: 'ui:reasoningOpen',
  wrap: 'ui:wrap',
  prefNotify: 'pref:notify',
  prefGateThreshold: 'pref:gateThreshold',
  ttsFormat: 'ttsFormat',
  /** @param {string} underlying */ tokRatio: (underlying) => `tokRatio:${underlying}`,
  /** @param {string} farmId */ promptTokSec: (farmId) => `promptTokSec:${farmId}`,
  /** @param {string} underlying */ continueMode: (underlying) => `continueMode:${underlying}`,
  /** @param {string} farmId @param {string} underlying */ vision: (farmId, underlying) => `cap:${farmId}:${underlying}:vision`,
  // K6 (addendum KF-2): the same row shape for any capability name; `vision(f, u)` === `cap(f, u, 'vision')`.
  /** @param {string} farmId @param {string} underlying @param {string} name */ cap: (farmId, underlying, name) => `cap:${farmId}:${underlying}:${name}`,
  /** @param {string} farmId @param {string} underlying */ structuredMode: (farmId, underlying) => `structuredMode:${farmId}:${underlying}`,
  /** @param {string} threadId */ threadSearch: (threadId) => `ui:search:${threadId}`,
  // Studio (S0 kickoff; studio plan §3.6.4). `pref:mapLayout` is NOT here — S1 was cancelled.
  workWidth: 'ui:workWidth',               // the split width, as a fraction string (S0-U1)
  workPanel: 'ui:workPanel',               // the last panel opened, for a brand-new thread (S0-U1)
  prefQueueMax: 'pref:queueMax',           // batch size cap, default 4 (S0-U3)
  prefComputeMaxItems: 'pref:computeMaxItems', // the Computer's generation cap, default 50 (C2)
  // K3 (COMPUTER_PLAN §7.3): the run journal, one row per graph, last 5 runs, pruned on write.
  /** @param {string} graphId */ computerRuns: (graphId) => `computer:runs:${graphId}`,
  /** @param {string} underlying */ editPolicy: (underlying) => `editPolicy:${underlying}`,
  /** @param {string} underlying */ anchorStats: (underlying) => `anchorStats:${underlying}`,
  // K5 (COMPUTER_PLAN §10.1): tutorial progress, one row for every lesson (TutorialProgress).
  computerTutorial: 'computer:tutorial',
});

export const TYPES_VERSION = 1;

/**
 * Runtime key lists of the §3.4 component APIs (the only runtime export of this file besides
 * TYPES_VERSION). core.test.mjs checks the fakes against them; unit tests of the real modules
 * should check their factories' return values against the same lists.
 */
export const API_KEYS = Object.freeze({
  repo: Object.freeze([
    'mode', 'ready', 'listThreads', 'getThread', 'createThread', 'updateThread', 'deleteThread',
    'getMessages', 'getPath', 'appendMessage', 'putMessage', 'checkpoint', 'finalize', 'deleteSubtree',
    'scanMessages', 'putAttachment', 'getAttachment', 'listAttachments', 'deleteAttachment',
    'listRecipes', 'putRecipe', 'deleteRecipe', 'findLegacy', 'kvGet', 'kvSet', 'recoverInterrupted',
    'flush', 'estimate', 'runTx', 'debug',
    // S0 kickoff (studio plan §3.6.2), with `maps` renamed `graphs` for the Computer panel.
    'listGraphs', 'getGraph', 'putGraph', 'deleteGraph',
    'listProjectRefs', 'getProjectRef', 'putProjectRef', 'deleteProjectRef',
  ]),
  repoDebug: Object.freeze(['journalLength', 'persistentIds']),
  farm: Object.freeze(['update', 'get', 'headers', 'fetchModels', 'modelInfo', 'setCapResolver', 'cap']),
  gov: Object.freeze(['canStart', 'acquire', 'hold', 'release', 'state', 'onChange']),
  controller: Object.freeze(['newThread', 'selectThread', 'current', 'send', 'generate', 'preview', 'stop', 'isStreaming', 'abortThread', 'refreshView']),
  view: Object.freeze(['showPath', 'upsert', 'remove', 'beginStream', 'scrollToMessage', 'isStuck', 'setOutsideContext', 'rowOf', 'debug']),
  composer: Object.freeze(['getDraft', 'setText', 'insertText', 'clear', 'focus', 'addPart', 'updatePart', 'removePart', 'setBusy', 'setSendState', 'isLocked', 'region', 'on']),
  picker: Object.freeze(['value', 'set', 'refresh']),
  sidebar: Object.freeze(['render', 'highlight']),
  dialogs: Object.freeze(['confirm', 'prompt', 'popover', 'toast']),
  // P2-U3 attaches this one to `app.branching` from its install(app); there is no fake for it
  // (features have fake:null), so the list is checked by branching.test.mjs, not by core.test.mjs.
  branching: Object.freeze(['regenerate', 'editUser', 'switchSibling', 'fork', 'deleteSubtree']),
  // S0 features, published on `app` by their own install() (§2.6 AQ). Checked by each unit's own
  // test, not by core.test.mjs: features have fake:null.
  work: Object.freeze(['open', 'close', 'current', 'width', 'panels', 'request', 'on']),
  ask: Object.freeze(['json', 'text', 'queue', 'mode', 'vision']),
  queue: Object.freeze(['state', 'cancel', 'on']),
  projects: Object.freeze([
    'kind', 'root', 'list', 'create', 'meta', 'update', 'forget', 'listFiles', 'read', 'readBinary',
    'write', 'writeBinary', 'remove', 'reveal', 'open', 'path',
  ]),
  // C1: the canvas/session debug door, frozen at C1 as the workbench panel's PanelInstance.debug
  // (§2.6 BG-9). The panel is gone (K1), but this list is still the door's SPINE: `computerDebug`
  // below is defined as exactly this plus what the standalone surface added.
  graphDebug: Object.freeze([
    'doc', 'state', 'session', 'place', 'remove', 'wire', 'unwire', 'select', 'move', 'setSettings',
    'run', 'stop', 'running', 'undo', 'redo', 'view', 'fit', 'save',
    // C3 (§2.6 BJ): tidy, the sharing story and the live sandbox's state. Added with their stub
    // bodies at the kickoff so the door and this list never disagree mid-phase.
    'tidy', 'exportText', 'importText', 'sandbox',
    // K2 (COMPUTER_PLAN §11): naming a wire, and reading the prompt a thinking part WOULD send
    // without sending it. Same rule as C3 — the key and its body land together at the kickoff.
    'label', 'preview',
    // K3 (COMPUTER_PLAN §11 K3): pressing ▶ on ONE box (push), the run journal, and what is
    // parked right now. Same rule again — key and body land together, at this kickoff.
    'runFrom', 'journal', 'waits',
  ]),
  // K1 (COMPUTER_PLAN §2.4/§8.2): the STANDALONE Computer's debug door, published at
  // window.LolComputer.debug.computer. It is `graphDebug` verbatim plus the two questions a
  // library document made askable — `docId()` (which document is open) and `open(id)` (open
  // another one). Frozen here, at the K1 landing, so the door and the harness cannot drift; a
  // later phase that adds a key adds it HERE in the same commit.
  computerDebug: Object.freeze([
    'doc', 'state', 'session', 'place', 'remove', 'wire', 'unwire', 'select', 'move', 'setSettings',
    'run', 'stop', 'running', 'undo', 'redo', 'view', 'fit', 'save',
    'tidy', 'exportText', 'importText', 'sandbox',
    'label', 'preview',
    'runFrom', 'journal', 'waits',
    'docId', 'open',
  ]),
  // K5 kickoff (addendum KE-6): `app.tutorial`, installed by computer/tutorial/rail.mjs. Checked
  // by the unit's own test (features have fake:null). `open(id)` is already called by
  // graph/canvas.mjs (the loop-ungated notice, guarded by `has(id)`) and `explain()` by
  // computer/runbar.mjs (the ? button).
  tutorial: Object.freeze([
    'has', 'lessons', 'templates', 'open', 'openTemplate', 'active', 'reset', 'showShelf',
    'explain', 'debug',
  ]),
  // K5 kickoff (addendum KE-2): the ＋ menu instance graph/palette-menu.mjs builds for the canvas.
  palette: Object.freeze(['el', 'open', 'close', 'isOpen', 'destroy']),
  // K5 kickoff (addendum KE-6): `app.welcome`, installed by computer/welcome.mjs.
  welcome: Object.freeze(['shown', 'refresh', 'debug']),
  // K6 kickoff (addendum KF-5): `app.media`, installed by computer/media.mjs — the ONE place a
  // Computer file's bytes are written, read, cached and swept.
  media: Object.freeze(['put', 'get', 'bytes', 'patch', 'sweep', 'debug']),
  // K6 kickoff (addendum KF-7): `app.drops`, installed by computer/drops.mjs — what a file dropped
  // on the canvas becomes.
  drops: Object.freeze(['route', 'hint', 'debug']),
  // C3: the sandbox host (sandbox/host.mjs). ONE per panel; the S2 vibecode bench uses the same
  // object, which is why the key list lives here and not with the Computer's own keys.
  sandbox: Object.freeze([
    'mount', 'state', 'ready', 'logs', 'errors', 'runs', 'compute', 'run', 'snapshot', 'params',
    'stop', 'hide', 'destroy', 'on', 'debug',
  ]),
});
