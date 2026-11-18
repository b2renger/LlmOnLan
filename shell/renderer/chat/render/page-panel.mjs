// @ts-check
// render/page-panel.mjs - the Page panel beside the chat (VIBE_PAGE_PLAN, owner 2026-11-18: "see the result and the
// code side by side, and edit the code with live reload"). A workbench panel (ui/workbench.mjs: one live panel at a
// time, idle when hidden, its width the reader's). A page's "Open beside the chat" (render/code.mjs) calls
// `app.page.open(target)` with the answer's blocks; the panel shows:
//   - the editor (computer/code-editor.mjs, the Computer's own), one per block, behind tabs;
//   - the page, running in the chat's one page sandbox (render/page-run.mjs: no network, nothing from disk);
//   - errors (each with its block and line: a click shows the line) and the console.
// Each run is a FRESH live guest: a page's top-level `let` cannot be declared twice in one frame, and a restart
// cannot change the CSS (both measured 2026-11-18). Edits are kept on the answer's record (page-run.mjs).

import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { createCodeEditor } from '../computer/code-editor.mjs';
import { pageOf, blockOf, pageBlocks, withEdits } from './page.mjs';
import { pageSandbox, readEdits, writeEdits } from './page-run.mjs';
import { blockName, PAGE_BASE_CSS } from './code.mjs';
import '../strings/render.en.mjs';

/** How long the page waits after the editor heard the typing (itself 250 ms after the last key) before it runs. */
export const RUN_PAUSE_MS = 450;
/** How long the edits wait before they are written. */
const SAVE_MS = 600;
/** The most console lines kept on screen; the guest caps what it sends per run too (sandbox/protocol.mjs). */
const MAX_LINES = 200;

/**
 * @typedef {{threadId: string, msgId: string, fences: {lang: string, code: string}[], pageIndex: number}} PageTarget
 */

/** @param {any} app */
export function install(app) {
  /** The page each thread had open beside it, for this launch. @type {Map<string, PageTarget>} */
  const targets = new Map();
  /** @type {any} */ let live = null;

  app.registry.add(SLOTS.WORKBENCH_PANELS, {
    id: 'page',
    order: 20,
    label: t('render.pagePanel'),
    icon: 'M4 5h16v14H4zM4 9h16M10 9v10',
    defaultWidth: 'split',
    available: () => true,
    create: (/** @type {HTMLElement} */ host) => {
      live = createPanel(host, app, (id) => targets.get(id) || null);
      return live;
    },
  });

  app.page = {
    /** Show this answer's page beside the chat. @param {PageTarget} target */
    open(target) {
      if (!target || !Array.isArray(target.fences)) return;
      targets.set(String(target.threadId || ''), target);
      if (app.work && typeof app.work.request === 'function') app.work.request('page');
      if (live && typeof live.load === 'function') live.load(target);
    },
    /** For the harness. */
    debug: () => (live && live.debug ? live.debug() : null),
  };
}

/**
 * @param {HTMLElement} host @param {any} app @param {(threadId: string) => PageTarget|null} targetOf
 */
function createPanel(host, app, targetOf) {
  const doc = host.ownerDocument || document;
  /** @param {string} tag @param {string} [cls] @param {string} [text] */
  const make = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  /** @param {string} label @param {string} cls @param {() => void} fn @param {string} [tip] */
  const button = (label, cls, fn, tip) => {
    const b = /** @type {HTMLButtonElement} */ (make('button', `chat-pagep-btn ${cls}`, label));
    b.type = 'button';
    if (tip) b.title = tip;
    b.addEventListener('click', (e) => { e.preventDefault(); fn(); });
    return b;
  };

  const root = make('section', 'chat-pagep');
  const empty = make('p', 'chat-pagep-empty', t('render.pagePanelEmpty'));
  const body = make('div', 'chat-pagep-body');

  const bar = make('div', 'chat-pagep-bar');
  const title = make('h3', 'chat-pagep-title', t('render.pagePanelTitle'));
  const autoLabel = make('label', 'chat-pagep-auto');
  const auto = /** @type {HTMLInputElement} */ (make('input'));
  auto.type = 'checkbox';
  auto.checked = true;
  autoLabel.title = t('render.pageAutoTip');
  autoLabel.append(auto, doc.createTextNode(` ${t('render.pageAuto')}`));
  const reset = button(t('render.pageReset'), 'chat-pagep-reset', () => { void resetEdits(); }, t('render.pageResetTip'));
  reset.hidden = true;
  bar.append(title, autoLabel, reset);

  const tabs = make('div', 'chat-pagep-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', t('render.pageBlocksLabel'));
  const split = make('div', 'chat-pagep-split');
  const editors = make('div', 'chat-pagep-editors');
  const result = make('div', 'chat-pagep-result');
  result.setAttribute('aria-label', t('render.pageResult'));
  const note = make('p', 'chat-pagep-note');
  note.hidden = true;
  const stage = make('div', 'chat-pagep-stage');
  result.append(note, stage);
  split.append(editors, result);

  const strip = make('div', 'chat-pagep-strip');
  const errHead = make('h4', 'chat-pagep-strip-head', t('render.pageProblems'));
  const errList = make('ul', 'chat-pagep-errors');
  const logHead = make('h4', 'chat-pagep-strip-head', t('render.pageConsole'));
  const logList = make('ul', 'chat-pagep-console');
  strip.append(errHead, errList, logHead, logList);

  body.append(bar, tabs, split, strip);
  root.append(empty, body);
  host.replaceChildren(root);

  // ---- state -----------------------------------------------------------------------------------
  /** @type {PageTarget|null} */ let target = null;
  /** @type {Record<string, string>} */ let edits = {};
  /** @type {{fence: number, kind: 'html'|'css'|'js', n: number, of: number}[]} */ let blocks = [];
  /** @type {Map<number, {ed: import('../computer/code-editor.mjs').CodeEditor, tab: HTMLButtonElement}>} */
  const eds = new Map();
  let shownFence = -1;
  let visible = false;
  let gone = false;
  /** @type {any} */ let handle = null;
  /** @type {any} */ let runTimer = 0;
  /** @type {any} */ let saveTimer = 0;
  /** @type {any[]} */ let errors = [];
  let lines = 0;
  let runs = 0;
  /** @type {any} */ let sources = {};

  const say = (/** @type {string} */ text) => { note.textContent = text; note.hidden = !text; };

  function stopPage() {
    if (runTimer) { clearTimeout(runTimer); runTimer = 0; }
    if (handle) { const h = handle; handle = null; try { h.stop(); } catch { /* gone */ } }
    stage.replaceChildren();
  }

  /** The code of every block as the person has it now. */
  const current = () => (target ? withEdits(target.fences, edits) : []);

  function paintEmpty() {
    empty.hidden = !!target;
    body.hidden = !target;
  }

  /** @param {number} fence */
  function showBlock(fence) {
    shownFence = fence;
    for (const [f, x] of eds) {
      const on = f === fence;
      x.ed.el.hidden = !on;
      x.tab.setAttribute('aria-selected', String(on));
      x.tab.tabIndex = on ? 0 : -1;
      if (on) x.ed.refresh();
    }
  }

  /** The editors, one per block, from the target and the saved edits. */
  function build() {
    for (const x of eds.values()) x.ed.end();
    eds.clear();
    editors.replaceChildren();
    tabs.replaceChildren();
    if (!target) return;
    blocks = pageBlocks(target.fences);
    const code = current();
    for (const b of blocks) {
      const name = blockName(b);
      const tab = /** @type {HTMLButtonElement} */ (make('button', 'chat-pagep-tab', name));
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', (e) => { e.preventDefault(); showBlock(b.fence); });
      const ed = createCodeEditor({
        partId: `page-${b.fence}`, mode: b.kind, source: code[b.fence].code,
        heading: name, label: t('render.pageCodeOf', { block: name }),
        runLabel: t('render.pageRun'), runHint: t('render.pageRunHint'),
        hint: auto.checked ? t('render.pageEditHint') : t('render.pageEditHintManual'),
        onChange: (text) => changed(b.fence, text),
        onRun: () => run(),
      });
      ed.el.classList.add('chat-pagep-editor');
      ed.el.hidden = true;
      editors.appendChild(ed.el);
      tabs.appendChild(tab);
      eds.set(b.fence, { ed, tab });
    }
    const first = blocks.find((b) => b.kind === 'js') || blocks[0];
    showBlock(first ? first.fence : -1);
  }

  /** @param {number} fence @param {string} text */
  function changed(fence, text) {
    if (!target) return;
    if (text === String(target.fences[fence].code || '')) delete edits[String(fence)];
    else edits[String(fence)] = text;
    reset.hidden = !Object.keys(edits).length;
    if (saveTimer) clearTimeout(saveTimer);
    const tgt = target;
    const snapshot = { ...edits };
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      writeEdits(app, tgt.threadId, tgt.msgId, snapshot).catch((err) => console.warn('[lolchat] page edits not saved', err));
    }, SAVE_MS);
    if (auto.checked) {
      if (runTimer) clearTimeout(runTimer);
      runTimer = setTimeout(() => { runTimer = 0; void run(); }, RUN_PAUSE_MS);
    }
  }

  async function resetEdits() {
    if (!target || !Object.keys(edits).length) return;
    const ok = app.dialogs && typeof app.dialogs.confirm === 'function'
      ? await app.dialogs.confirm({ title: t('render.pageResetTitle'), body: t('render.pageResetBody'), ok: t('render.pageResetOk'), danger: true })
      : true;
    if (!ok || !target) return;
    edits = {};
    reset.hidden = true;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    await writeEdits(app, target.threadId, target.msgId, null).catch((err) => console.warn('[lolchat] page edits not cleared', err));
    for (const [f, x] of eds) x.ed.setSource(String(target.fences[f].code || ''));
    void run();
  }

  // ---- errors and the console ---------------------------------------------------------------------
  function paintErrors() {
    errList.replaceChildren();
    if (!errors.length) errList.appendChild(make('li', 'chat-pagep-none', t('render.pageNoProblems')));
    for (const err of errors) {
      const li = make('li', 'chat-pagep-error');
      const at = blockOf(err, sources);
      const b = at ? blocks.find((x) => x.fence === at.fence) : null;
      if (at && b) {
        const go = button(t('render.pageErrAt', { block: blockName(b), line: at.line }), 'chat-pagep-goto', () => {
          showBlock(at.fence);
          const x = eds.get(at.fence);
          if (x) x.ed.gotoLine(at.line);
        }, t('render.pageErrGoTip'));
        li.append(go, doc.createTextNode(' '));
      }
      li.appendChild(make('span', 'chat-pagep-error-text', String(err.message || '')));
      errList.appendChild(li);
    }
    // Each editor marks the first error in its block.
    for (const [f, x] of eds) {
      const mine = errors.map((e) => ({ e, at: blockOf(e, sources) })).find((p) => p.at && p.at.fence === f);
      x.ed.setError(mine ? { line: mine.at ? mine.at.line : 0, message: String(mine.e.message || '') } : null);
      x.tab.classList.toggle('has-error', !!mine);
    }
  }

  /** @param {{level: string, text: string}} log */
  function addLine(log) {
    if (lines === 0) logList.replaceChildren();
    lines++;
    if (lines > MAX_LINES) {
      if (lines === MAX_LINES + 1) logList.appendChild(make('li', 'chat-pagep-none', t('render.pageMore', { n: '…' })));
      return;
    }
    const li = make('li', `chat-pagep-line is-${String(log.level || 'log')}`, String(log.text || ''));
    logList.appendChild(li);
  }

  function clearStrip() {
    errors = [];
    lines = 0;
    logList.replaceChildren(make('li', 'chat-pagep-none', t('render.pageNoConsole')));
    paintErrors();
  }

  // ---- running ---------------------------------------------------------------------------------
  async function run() {
    if (!target || !visible || gone) return;
    for (const x of eds.values()) x.ed.flush();
    stopPage();
    clearStrip();
    const fences = current();
    const page = pageOf(fences[target.pageIndex] ? fences[target.pageIndex].code : '', fences, { pageIndex: target.pageIndex });
    sources = page.sources;
    say(page.remote.length ? t('render.pageNoInternet', { hosts: page.remote.join(', ') }) : '');
    const mine = ++runs;
    const sandbox = await pageSandbox();
    // The box is laid out by the next frame (the panel may have just been made). The frame then FILLS it
    // (css/page-panel.css), so a panel dragged wider lays the page out again by itself: the size given here only has
    // to match, or the guest waits for its frame to reach it (runner.html whenSized, ≤ 750 ms).
    await new Promise((r) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r(null)); else r(null); });
    if (mine !== runs || !visible || gone) return;
    const w = Math.max(160, Math.min(4000, Math.floor(stage.clientWidth || 480)));
    const hgt = Math.max(120, Math.min(4000, Math.floor(stage.clientHeight || 420)));
    const h = handle = sandbox.live({
      mount: stage, mode: 'html', code: page.html, css: PAGE_BASE_CSS + page.css, libs: page.libs,
      size: { w, h: hgt }, page: true,
    });
    h.on((/** @type {any} */ ev) => {
      if (h !== handle) return;
      if (ev.type === 'error' && ev.error) { errors.push(ev.error); paintErrors(); }
      if (ev.type === 'log' && ev.log) addLine(ev.log);
      if (ev.type === 'state' && ev.state === 'stalled') say(t('render.pageStalled'));
      if (ev.type === 'stopped' && ev.why === 'replaced') { handle = null; say(t('render.pageReplaced')); }
    });
    const out = await h.ready;
    if (h === handle && out && !out.ok && out.error && out.error.message) { errors.push(out.error); paintErrors(); }
  }

  auto.addEventListener('change', () => {
    for (const x of eds.values()) {
      const hint = x.ed.el.querySelector('.comp-code-hint');
      if (hint) hint.textContent = auto.checked ? t('render.pageEditHint') : t('render.pageEditHintManual');
    }
    if (!auto.checked && runTimer) { clearTimeout(runTimer); runTimer = 0; }
  });

  /** Show this answer's page. @param {PageTarget|null} next */
  async function load(next) {
    stopPage();
    target = next;
    edits = {};
    paintEmpty();
    if (!target) { build(); return; }
    const saved = await readEdits(app, target.threadId, target.msgId);
    if (target !== next) return;
    edits = saved || {};
    reset.hidden = !Object.keys(edits).length;
    build();
    clearStrip();
    void run();
  }

  paintEmpty();

  return {
    load,
    /** @param {{thread: any}} ctx */
    show(ctx) {
      visible = true;
      const id = ctx && ctx.thread ? String(ctx.thread.id) : '';
      const want = targetOf(id);
      if (want !== target) void load(want);
      else { if (shownFence >= 0) showBlock(shownFence); void run(); }
    },
    hide() {
      visible = false;
      for (const x of eds.values()) x.ed.flush();
      stopPage();
    },
    destroy() {
      gone = true;
      visible = false;
      stopPage();
      for (const x of eds.values()) x.ed.end();          // their last typing reaches `changed` first
      if (runTimer) { clearTimeout(runTimer); runTimer = 0; }
      if (saveTimer && target) {
        clearTimeout(saveTimer);
        saveTimer = 0;
        writeEdits(app, target.threadId, target.msgId, { ...edits }).catch(() => { /* written on the next change */ });
      }
    },
    /** @param {{thread: any}} ctx */
    onThread(ctx) {
      const id = ctx && ctx.thread ? String(ctx.thread.id) : '';
      const want = targetOf(id);
      if (want !== target) void load(want);
    },
    debug: () => ({
      target: target ? { msgId: target.msgId, pageIndex: target.pageIndex } : null,
      blocks: blocks.map((b) => ({ fence: b.fence, kind: b.kind, name: blockName(b) })),
      shown: shownFence, edits: { ...edits }, errors: errors.map((e) => ({ message: e.message, at: blockOf(e, sources) })),
      lines, runs, running: !!handle, state: handle ? handle.state() : null, auto: auto.checked,
    }),
  };
}
