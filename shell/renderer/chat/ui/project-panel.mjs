// @ts-check
// The Project panel — LOL Vibe's IDE (docs/IDE_PLAN.md §3.3), the first tenant of the workbench. A thread bound to a
// project (thread.studio.projectId) is answered by the coding agent in that folder (app/controller.mjs →
// projects/agent.mjs); the chat's own composer is the prompt. This panel shows the folder: its files, the page
// running (Preview, served by main on 127.0.0.1 only), a file's code (edit, Save), and what the agent's last reply
// changed. Nothing here talks to the farm.
//
// Hidden means idle (workbench rule 3): hide() takes the Preview frame out of the page, so a running sketch stops.
import { SLOTS } from '../core/registry.mjs';
import { EV } from '../core/events.mjs';
import { t } from '../core/i18n.mjs';
import { getDoor, onInstall } from '../projects/agent.mjs';
import { profileFor, pickEditor } from '../projects/models.mjs';
import { tabEdit, newlineEdit, applyEdit } from '../computer/code-edit.mjs';
import '../strings/project.en.mjs';

/** Files the Code tab opens as text (the projects API's text extensions). */
const TEXT_RE = /\.(html?|m?js|css|json|md|txt|svg|csv|ya?ml|ini|glsl|frag|vert|ino|h|hpp|c|cpp)$/i;
const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock';
// A same-file literal map, so lint rule 5 can see every key a person reads.
const TAB_LABEL = { preview: 'project.tabPreview', code: 'project.tabCode', changes: 'project.tabChanges' };

/** @param {any} app */
export function install(app) {
  app.registry.add(SLOTS.WORKBENCH_PANELS, {
    id: 'project',
    order: 10,
    label: t('project.label'),
    icon: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
    defaultWidth: 'split',
    available: () => true,
    create: (/** @type {HTMLElement} */ host, /** @type {any} */ a) => createPanel(host, a || app),
  });
}

/**
 * @param {HTMLElement} host @param {any} app
 */
function createPanel(host, app) {
  const doc = host.ownerDocument || document;
  const door = getDoor();
  /** @param {string} tag @param {string} [cls] @param {string} [text] */
  const make = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  /** @param {string} label @param {string} cls @param {() => void} fn */
  const button = (label, cls, fn) => {
    const b = /** @type {HTMLButtonElement} */ (make('button', `chat-proj-btn ${cls}`, label));
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };

  /** @type {any} */ let thread = null;
  let projectId = '';
  let projectName = '';
  /** @type {Array<{path: string, size: number, mtime: number}>} */ let files = [];
  let tab = 'preview';
  let openFile = '';
  let openMtime = 0;
  let serveUrl = '';
  let reloads = 0;
  let visible = false;
  let epoch = 0;

  const root = make('div', 'chat-proj');
  host.replaceChildren(root);

  // ---- the agent not installed yet: one button, a person's click (it downloads from GitHub) -----------------
  const installRow = make('div', 'chat-proj-install');
  const installNote = make('span', 'chat-proj-note', t('project.notInstalled'));
  installNote.setAttribute('role', 'status');
  const installBtn = button(t('project.install'), 'chat-proj-create chat-proj-install-btn', () => { void install(); });
  installRow.append(installNote, installBtn);
  installRow.hidden = true;
  root.append(installRow);

  async function checkInstalled() {
    if (!door) return;
    const s = await door.status();
    installRow.hidden = !(s && s.ok && !s.installed);
  }

  async function install() {
    if (!door) return;
    installBtn.disabled = true;
    const r = await door.install();
    installBtn.disabled = false;
    if (r && r.ok) { installNote.textContent = t('project.installed'); await checkInstalled(); return; }
    installNote.textContent = String((r && r.message) || '');
  }

  const offInstall = onInstall((/** @type {any} */ p) => {
    if (!p) return;
    installNote.textContent = p.phase === 'download' ? t('project.installing', { percent: p.percent != null ? p.percent : 0 })
      : p.phase === 'extract' ? t('project.unpacking') : p.phase === 'check' ? t('project.installCheck') : installNote.textContent;
  });

  // ---- the unbound state: pick or make a project ----------------------------------------------------
  const empty = make('div', 'chat-proj-empty');
  const emptyTitle = make('h3', 'chat-proj-title', t('project.emptyTitle'));
  const emptyBody = make('p', 'chat-proj-note', t('project.emptyBody'));
  const form = /** @type {HTMLFormElement} */ (make('form', 'chat-proj-new'));
  const nameIn = /** @type {HTMLInputElement} */ (make('input', 'chat-proj-name-in'));
  nameIn.type = 'text';
  nameIn.maxLength = 48;
  nameIn.placeholder = t('project.newPlaceholder');
  nameIn.setAttribute('aria-label', t('project.newPlaceholder'));
  const createBtn = /** @type {HTMLButtonElement} */ (make('button', 'chat-proj-btn chat-proj-create', t('project.create')));
  createBtn.type = 'submit';
  form.append(nameIn, createBtn);
  const list = make('ul', 'chat-proj-list');
  const status = make('p', 'chat-proj-note chat-proj-status');
  status.setAttribute('role', 'status');
  empty.append(emptyTitle, emptyBody, form, list, status);

  // ---- the bound state -----------------------------------------------------------------------------
  const main = make('div', 'chat-proj-main');
  const bar = make('div', 'chat-proj-bar');
  const nameEl = make('span', 'chat-proj-name');
  const other = button(t('project.other'), 'chat-proj-other', () => { void bind(''); });
  const folder = button(t('project.folder'), 'chat-proj-folder', () => { if (projectId && app.projects) void app.projects.reveal(projectId); });
  const browser = /** @type {HTMLAnchorElement} */ (make('a', 'chat-proj-btn chat-proj-browser', t('project.browser')));
  browser.target = '_blank';
  browser.rel = 'noopener';
  bar.append(nameEl, other, folder, browser);
  const model = make('p', 'chat-proj-note chat-proj-model');
  const cols = make('div', 'chat-proj-cols');
  const fileList = make('ul', 'chat-proj-files');
  fileList.setAttribute('aria-label', t('project.files'));
  const view = make('div', 'chat-proj-view');
  const tabs = make('div', 'chat-proj-tabs');
  tabs.setAttribute('role', 'tablist');
  /** @type {Record<string, HTMLButtonElement>} */ const tabBtn = {};
  for (const id of /** @type {Array<'preview'|'code'|'changes'>} */ (['preview', 'code', 'changes'])) {
    const b = button(t(TAB_LABEL[id]), `chat-proj-tab chat-proj-tab-${id}`, () => { tab = id; paintTabs(); if (id === 'preview') mountFrame(); });
    b.setAttribute('role', 'tab');
    tabBtn[id] = b;
    tabs.append(b);
  }
  // Preview
  const panePreview = make('div', 'chat-proj-pane chat-proj-pane-preview');
  const previewNote = make('p', 'chat-proj-note');
  const reload = button(t('project.reload'), 'chat-proj-reload', () => { reloads += 1; mountFrame(true); });
  /** @type {HTMLIFrameElement|null} */ let frame = null;
  panePreview.append(reload, previewNote);
  // Code
  const paneCode = make('div', 'chat-proj-pane chat-proj-pane-code');
  const codeHead = make('div', 'chat-proj-code-head');
  const codeName = make('span', 'chat-proj-code-name');
  const save = button(t('project.save'), 'chat-proj-save', () => { void saveFile(); });
  const codeNote = make('span', 'chat-proj-note chat-proj-code-note');
  codeNote.setAttribute('role', 'status');
  codeHead.append(codeName, save, codeNote);
  const area = /** @type {HTMLTextAreaElement} */ (make('textarea', 'chat-proj-code'));
  area.spellcheck = false;
  area.setAttribute('wrap', 'off');
  area.setAttribute('aria-label', t('project.tabCode'));
  paneCode.append(codeHead, area);
  // Changes
  const paneChanges = make('div', 'chat-proj-pane chat-proj-pane-changes');
  view.append(tabs, panePreview, paneCode, paneChanges);
  cols.append(fileList, view);
  main.append(bar, model, cols);
  root.append(empty, main);

  // ---- behaviour -----------------------------------------------------------------------------------

  const caps = () => (app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null);
  /** The model the next message goes to: the picker's, as the composer sends it. */
  const onScreen = () => (app.picker && typeof app.picker.value === 'function' && app.picker.value())
    || (thread && thread.modelSource === 'user' && thread.model) || (caps() && caps().defaultModel) || '';

  /** A project chat starts on a model that is good at edits when the farm serves one (never over a person's pick). */
  async function preferGoodModel() {
    const c = caps();
    if (!app.picker || typeof app.picker.set !== 'function' || !c || !app.state.threadId) return;
    const current = onScreen();
    const row = app.repo ? await app.repo.getThread(app.state.threadId) : null;
    const chosen = !!(row && row.modelSource === 'user' && row.model === current);
    const next = pickEditor(current, c.models || [], chosen);
    if (next && next !== current) app.picker.set(next, { byUser: true });
  }

  function paintModel() {
    const shown = onScreen();
    // Judge the model behind a farm alias ("assistant" on llama.cpp), named as the farm names it.
    const info = shown && app.farm && typeof app.farm.modelInfo === 'function' ? app.farm.modelInfo(shown) : null;
    const m = (info && info.underlying) || shown;
    const p = profileFor(m);
    model.textContent = !m ? '' : p.edits === 'good' ? t('project.modelGood', { model: m })
      : p.edits === 'weak' ? t('project.modelWeak', { model: m }) : t('project.modelUnknown', { model: m });
    model.classList.toggle('is-warn', p.edits === 'weak');
  }

  function paintTabs() {
    for (const [id, b] of Object.entries(tabBtn)) {
      b.setAttribute('aria-selected', id === tab ? 'true' : 'false');
      b.classList.toggle('is-on', id === tab);
    }
    panePreview.hidden = tab !== 'preview';
    paneCode.hidden = tab !== 'code';
    paneChanges.hidden = tab !== 'changes';
    if (tab !== 'preview') unmountFrame();
  }

  /** The page to show: the open .html file, else index.html. */
  const pagePath = () => (/\.html?$/i.test(openFile) ? openFile : 'index.html');

  function unmountFrame() {
    if (frame) { frame.remove(); frame = null; }
  }

  /** @param {boolean} [again] */
  function mountFrame(again) {
    if (!visible || tab !== 'preview' || !projectId) { unmountFrame(); return; }
    const page = pagePath();
    const has = files.some((f) => f.path === page);
    previewNote.textContent = !door ? t('project.noApp') : has ? '' : t('project.noIndex', { page });
    if (!door || !serveUrl || !has) { unmountFrame(); return; }
    const src = `${serveUrl}${page.split('/').map(encodeURIComponent).join('/')}?r=${reloads}`;
    if (frame && frame.getAttribute('src') === src && !again) return;
    unmountFrame();
    frame = /** @type {HTMLIFrameElement} */ (make('iframe', 'chat-proj-frame'));
    frame.setAttribute('sandbox', FRAME_SANDBOX);
    frame.title = t('project.tabPreview');
    frame.src = src;
    panePreview.append(frame);
  }

  function paintFiles() {
    const rows = files.map((f) => {
      const li = make('li', 'chat-proj-file-row');
      const b = button(f.path, 'chat-proj-file', () => { void openInCode(f.path); });
      b.classList.toggle('is-open', f.path === openFile);
      li.append(b);
      return li;
    });
    fileList.replaceChildren(...(rows.length ? rows : [make('li', 'chat-proj-note', t('project.noFiles'))]));
  }

  /** The newest agent reply on this thread's path that changed something. */
  function lastChanges() {
    const cur = app.controller && typeof app.controller.current === 'function' ? app.controller.current() : null;
    const path = cur && cur.thread && thread && cur.thread.id === thread.id ? cur.path : [];
    for (let i = path.length - 1; i >= 0; i--) {
      const m = path[i];
      if (m && m.role === 'assistant' && (Array.isArray(m.changes) || Array.isArray(m.created))) return m;
    }
    return null;
  }

  function paintChanges() {
    const m = lastChanges();
    const out = [];
    for (const p of (m && m.created) || []) out.push(make('p', 'chat-proj-change-new', t('project.newFile', { path: p })));
    for (const c of (m && m.changes) || []) {
      const box = make('div', 'chat-proj-change');
      box.append(make('p', 'chat-proj-change-path', c.path));
      const pre = make('pre', 'chat-proj-diff');
      for (const line of String(c.oldText || '').split('\n')) pre.append(make('span', 'chat-proj-del', `- ${line}\n`));
      for (const line of String(c.newText || '').split('\n')) pre.append(make('span', 'chat-proj-add', `+ ${line}\n`));
      box.append(pre);
      out.push(box);
    }
    paneChanges.replaceChildren(...(out.length ? out : [make('p', 'chat-proj-note', t('project.noChanges'))]));
  }

  async function refreshFiles() {
    if (!projectId || !app.projects) return;
    const mine = epoch;
    const r = await app.projects.listFiles(projectId);
    if (mine !== epoch) return;
    files = r && r.ok ? r.files.slice().sort((a, b) => a.path.localeCompare(b.path)) : [];
    paintFiles();
  }

  /** @param {string} rel */
  async function openInCode(rel) {
    openFile = rel;
    paintFiles();
    if (!TEXT_RE.test(rel)) { codeName.textContent = rel; area.value = ''; area.disabled = true; codeNote.textContent = t('project.binary'); tab = 'preview'; paintTabs(); mountFrame(); return; }
    const mine = epoch;
    const r = await app.projects.read(projectId, rel);
    if (mine !== epoch) return;
    codeName.textContent = rel;
    area.disabled = !(r && r.ok);
    area.value = r && r.ok ? r.text : '';
    openMtime = r && r.ok ? r.mtime : 0;
    codeNote.textContent = r && r.ok ? '' : String((r && r.message) || '');
    tab = 'code';
    paintTabs();
  }

  async function saveFile() {
    if (!projectId || !openFile || area.disabled) return;
    const r = await app.projects.write(projectId, openFile, area.value, openMtime ? { ifMtime: openMtime } : undefined);
    if (r && r.ok) { openMtime = r.mtime; codeNote.textContent = t('project.saved'); reloads += 1; void refreshFiles(); return; }
    codeNote.textContent = r && r.code === 'E_CONFLICT' ? t('project.conflict') : String((r && r.message) || '');
  }

  /** Tab indents, Enter keeps the indent, Ctrl+S saves — the Computer's editor rules (code-edit.mjs). */
  area.addEventListener('keydown', (/** @type {KeyboardEvent} */ ev) => {
    if (ev.isComposing) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); void saveFile(); return; }
    /** @type {any} */ let e = null;
    if (ev.key === 'Tab') e = tabEdit(area.value, area.selectionStart, area.selectionEnd, ev.shiftKey);
    else if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey && !ev.ctrlKey) e = newlineEdit(area.value, area.selectionStart, area.selectionEnd);
    else return;
    ev.preventDefault();
    if (!e) return;
    area.setSelectionRange(e.from, e.to);
    let done = false;
    try { done = doc.execCommand('insertText', false, e.insert); } catch { done = false; }
    if (!done) area.value = applyEdit(area.value, e);
    area.setSelectionRange(e.selStart, e.selEnd);
  });

  async function paintEmpty() {
    const mine = epoch;
    const r = app.projects ? await app.projects.list() : null;
    if (mine !== epoch) return;
    const rows = (r && r.ok ? r.projects : []).filter((p) => !p.hidden).sort((a, b) => b.updatedAt - a.updatedAt).map((p) => {
      const li = make('li', 'chat-proj-list-row');
      li.append(button(p.name, 'chat-proj-pick', () => { void bind(p.id); }));
      return li;
    });
    list.replaceChildren(...rows);
    const notes = [];
    if (app.projects && typeof app.projects.notice === 'function' && app.projects.notice()) notes.push(app.projects.notice());
    if (!door) notes.push(t('project.noApp'));
    status.textContent = notes.join(' ');
  }

  /** Bind this thread to a project ('' unbinds). A thread-less LOL Vibe gets a new thread first. @param {string} id */
  async function bind(id) {
    if (id && !app.state.threadId && app.controller) {
      app.controller.newThread();
      if (app.work) app.work.open('project');
    }
    if (app.work && typeof app.work.setStudio === 'function') app.work.setStudio({ projectId: id || null });
    if (id) await preferGoodModel();
  }

  form.addEventListener('submit', (/** @type {Event} */ ev) => {
    ev.preventDefault();
    const name = nameIn.value.trim();
    if (!name || !app.projects) return;
    createBtn.disabled = true;
    void app.projects.create({ name, kind: 'dom' }).then((/** @type {any} */ r) => {
      createBtn.disabled = false;
      if (r && r.ok) { nameIn.value = ''; void bind(r.project.id); } else status.textContent = String((r && r.message) || '');
    });
  });

  /** Everything the panel shows follows (thread, projectId). @param {any} ctx */
  async function load(ctx) {
    epoch += 1;
    const mine = epoch;
    thread = ctx && ctx.thread ? ctx.thread : thread;
    const id = (ctx && ctx.studio && ctx.studio.projectId) || (thread && thread.studio && thread.studio.projectId) || '';
    if (id !== projectId) { projectId = id; openFile = ''; files = []; serveUrl = ''; area.value = ''; codeName.textContent = ''; tab = 'preview'; }
    empty.hidden = !!projectId;
    main.hidden = !projectId;
    paintModel();
    void checkInstalled();
    if (!projectId) { unmountFrame(); await paintEmpty(); return; }
    const meta = app.projects ? await app.projects.meta(projectId) : null;
    if (mine !== epoch) return;
    projectName = meta && meta.ok ? meta.project.name : projectId;
    nameEl.textContent = projectName;
    if (door && !serveUrl) {
      const s = await door.serve(projectId);
      if (mine !== epoch) return;
      serveUrl = s && s.ok ? s.url : '';
    }
    browser.href = serveUrl || '#';
    browser.hidden = !serveUrl;
    await refreshFiles();
    if (mine !== epoch) return;
    paintTabs();
    paintChanges();
    mountFrame();
  }

  // A reply finished on this thread: the agent may have changed the folder.
  const onEnd = (/** @type {any} */ p) => {
    const m = p && p.message;
    if (!projectId || !m || !thread || m.threadId !== thread.id) return;
    reloads += 1;
    void refreshFiles().then(() => { paintChanges(); mountFrame(true); if (openFile && tab === 'code' && TEXT_RE.test(openFile)) void openInCode(openFile); });
  };
  const off = app.bus.on(EV.STREAM_END, onEnd);
  // The picker announces every change of the effective model on #chat-model (ui/model-picker.mjs announce()).
  const onModel = () => paintModel();
  doc.addEventListener('lolchat:model', onModel);

  return {
    show(/** @type {any} */ ctx) { visible = true; void load(ctx); },
    hide() { visible = false; unmountFrame(); },
    onThread(/** @type {any} */ ctx) { void load(ctx); },
    destroy() {
      visible = false;
      epoch += 1;
      unmountFrame();
      if (typeof off === 'function') off();
      offInstall();
      doc.removeEventListener('lolchat:model', onModel);
      host.replaceChildren();
    },
    debug: {
      state: () => ({ projectId, projectName, files: files.map((f) => f.path), tab, openFile, serveUrl, frame: frame ? frame.getAttribute('src') : null }),
    },
  };
}
