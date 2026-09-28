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
import { diffLines, hunks } from '../projects/linediff.mjs';
import { servedFrame, createSandbox } from '../sandbox/host.mjs';
import { readNodeLink, graphProgram, MAX_NODES, MAX_LINKS } from '../sandbox/graph-view.mjs';
import '../strings/parts-preview.en.mjs';

/** graphify's output (graphify-out/graph.json), or any *graph.json: drawn, not served. */
const GRAPH_RE = /(^|\/)[^/]*graph\.json$/i;
import '../strings/project.en.mjs';

/** Files the Code tab opens as text (the projects API's text extensions). */
const TEXT_RE = /\.(html?|m?js|css|json|md|txt|svg|csv|ya?ml|ini|glsl|frag|vert|ino|h|hpp|c|cpp)$/i;
/** Pictures and sounds the Preview can show on its own (main serves them with their type; anything else would download). */
const MEDIA_RE = /\.(png|jpe?g|gif|webp|ico|wav|mp3|ogg)$/i;
// A same-file literal map, so lint rule 5 can see every key a person reads.
const TAB_LABEL = { preview: 'project.tabPreview', code: 'project.tabCode', changes: 'project.tabChanges', history: 'project.tabHistory' };
const TAB_TIP = { preview: 'project.tipTabPreview', code: 'project.tipTabCode', changes: 'project.tipTabChanges', history: 'project.tipTabHistory' };

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
  /** @param {string} label @param {string} cls @param {() => void} fn @param {string} [tip] what it does, where the label alone does not say */
  const button = (label, cls, fn, tip) => {
    const b = /** @type {HTMLButtonElement} */ (make('button', `chat-proj-btn ${cls}`, label));
    b.type = 'button';
    if (tip) b.title = tip;
    b.addEventListener('click', fn);
    return b;
  };
  const saveKeys = /Mac/i.test(String((doc.defaultView && doc.defaultView.navigator && doc.defaultView.navigator.platform) || '')) ? '⌘S' : 'Ctrl+S';

  /** @type {any} */ let thread = null;
  let projectId = '';
  let projectName = '';
  /** @type {Array<{path: string, size: number, mtime: number}>} */ let files = [];
  let tab = 'preview';
  let openFile = '';
  let openMtime = 0;
  /** What the Code tab last read or saved: an editor holding anything else holds a person's unsaved edit. */
  let openText = '';
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
  createBtn.title = t('project.tipCreate');
  form.append(nameIn, createBtn);
  const list = make('ul', 'chat-proj-list');
  const status = make('p', 'chat-proj-note chat-proj-status');
  status.setAttribute('role', 'status');
  empty.append(emptyTitle, emptyBody, form, list, status);

  // ---- the bound state -----------------------------------------------------------------------------
  const main = make('div', 'chat-proj-main');
  const bar = make('div', 'chat-proj-bar');
  const nameEl = make('span', 'chat-proj-name');
  const other = button(t('project.other'), 'chat-proj-other', () => { void bind(''); }, t('project.tipOther'));
  const folder = button(t('project.folder'), 'chat-proj-folder', () => { if (projectId && app.projects) void app.projects.reveal(projectId); }, t('project.tipFolder'));
  const browser = /** @type {HTMLAnchorElement} */ (make('a', 'chat-proj-btn chat-proj-browser', t('project.browser')));
  browser.target = '_blank';
  browser.rel = 'noopener';
  browser.title = t('project.tipBrowser');
  // Share on the LAN (owner, 2026-09-28): a person's toggle per project, off by default, forgotten at restart.
  /** @type {string[]} */ let lanUrls = [];
  const shareBtn = button(t('project.share'), 'chat-proj-share', () => { void toggleShare(); }, t('project.tipShare'));
  bar.append(nameEl, other, folder, browser, shareBtn);
  const shareNote = make('p', 'chat-proj-note chat-proj-share-note');
  shareNote.setAttribute('role', 'status');
  const model = make('p', 'chat-proj-note chat-proj-model');
  const cols = make('div', 'chat-proj-cols');
  const fileList = make('ul', 'chat-proj-files');
  fileList.setAttribute('aria-label', t('project.files'));
  const view = make('div', 'chat-proj-view');
  const tabs = make('div', 'chat-proj-tabs');
  tabs.setAttribute('role', 'tablist');
  /** @type {Record<string, HTMLButtonElement>} */ const tabBtn = {};
  for (const id of /** @type {Array<'preview'|'code'|'changes'|'history'>} */ (['preview', 'code', 'changes', 'history'])) {
    const b = button(t(TAB_LABEL[id]), `chat-proj-tab chat-proj-tab-${id}`, () => { tab = id; paintTabs(); if (id === 'preview') mountFrame(); }, t(TAB_TIP[id]));
    b.setAttribute('role', 'tab');
    tabBtn[id] = b;
    tabs.append(b);
  }
  // Preview
  const panePreview = make('div', 'chat-proj-pane chat-proj-pane-preview');
  const previewNote = make('p', 'chat-proj-note');
  const reload = button(t('project.reload'), 'chat-proj-reload', () => { reloads += 1; mountFrame(true); }, t('project.tipReload'));
  /** @type {HTMLIFrameElement|null} */ let frame = null;
  // The graph view's own sandbox (made on first use) and its live guest.
  const graphMount = make('div', 'chat-proj-graph');
  graphMount.hidden = true;
  /** @type {any} */ let sandbox = null;
  /** @type {any} */ let graphLive = null;
  panePreview.append(reload, previewNote, graphMount);
  // Code
  const paneCode = make('div', 'chat-proj-pane chat-proj-pane-code');
  const codeHead = make('div', 'chat-proj-code-head');
  const codeName = make('span', 'chat-proj-code-name');
  const save = button(t('project.save'), 'chat-proj-save', () => { void saveFile(); }, t('project.tipSave', { keys: saveKeys }));
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
  // History: every reply and Save is a commit (src/main/projectGit.ts); going back is a new commit.
  const paneHistory = make('div', 'chat-proj-pane chat-proj-pane-history');
  const commitList = make('ul', 'chat-proj-commits');
  const commitView = make('div', 'chat-proj-commit-view');
  paneHistory.append(commitList, commitView);

  // GitHub (or any git server over https): the address, a token (write-only: main keeps it, encrypted), Push, Pull.
  const gitBox = /** @type {HTMLDetailsElement} */ (make('details', 'chat-proj-git'));
  gitBox.append(make('summary', 'chat-proj-git-title', t('project.gitTitle')));
  const remoteIn = /** @type {HTMLInputElement} */ (make('input', 'chat-proj-name-in chat-proj-remote-in'));
  remoteIn.type = 'url';
  remoteIn.placeholder = t('project.remotePlaceholder');
  remoteIn.setAttribute('aria-label', t('project.remotePlaceholder'));
  const tokenIn = /** @type {HTMLInputElement} */ (make('input', 'chat-proj-name-in chat-proj-token-in'));
  tokenIn.type = 'password';
  tokenIn.autocomplete = 'off';
  tokenIn.placeholder = t('project.tokenPlaceholder');
  tokenIn.setAttribute('aria-label', t('project.tokenPlaceholder'));
  const gitNote = make('p', 'chat-proj-note chat-proj-git-note');
  gitNote.setAttribute('role', 'status');
  const tokenNote = make('p', 'chat-proj-note chat-proj-token-note');
  const gitRow = (/** @type {HTMLElement[]} */ ...els) => { const r = make('div', 'chat-proj-new'); r.append(...els); return r; };
  const gitAct = async (/** @type {() => Promise<any>} */ fn, /** @type {string} */ ok) => {
    gitNote.textContent = t('project.working');
    const r = await fn();
    gitNote.textContent = r && r.ok ? ok : String((r && r.message) || '');
    await loadRemote();
    if (r && r.ok) { reloads += 1; await refreshFiles(); picked = ''; await loadHistory(); mountFrame(true); void refreshOpen(); }
  };
  const remoteHost = () => { try { return new URL(remoteIn.value).host; } catch { return ''; } };
  gitBox.append(
    gitRow(remoteIn, button(t('project.saveRemote'), 'chat-proj-save-remote', () => { if (door) void gitAct(() => door.remote(projectId, remoteIn.value.trim()), t('project.remoteSaved')); }, t('project.tipSaveRemote'))),
    gitRow(tokenIn,
      button(t('project.saveToken'), 'chat-proj-save-token', () => { if (door && tokenIn.value) { const v = tokenIn.value; tokenIn.value = ''; void gitAct(() => door.token(projectId, v), t('project.tokenStored')); } }, t('project.tipSaveToken')),
      button(t('project.forgetToken'), 'chat-proj-forget-token', () => { if (door) void gitAct(() => door.token(projectId, null), t('project.tokenForgotten')); }, t('project.tipForgetToken'))),
    tokenNote,
    gitRow(
      button(t('project.push'), 'chat-proj-push', () => { if (door) void gitAct(() => door.push(projectId), t('project.pushed', { host: remoteHost() })); }, t('project.tipPush')),
      button(t('project.pull'), 'chat-proj-pull', () => { if (door) void gitAct(() => door.pull(projectId), t('project.pulled', { host: remoteHost() })); }, t('project.tipPull'))),
    gitNote,
  );
  paneHistory.prepend(gitBox);

  /** The remote and the token's state (never the token) for this project. */
  async function loadRemote() {
    if (!door || !projectId) return;
    const r = await door.remote(projectId);
    if (!(r && r.ok)) return;
    if (document.activeElement !== remoteIn) remoteIn.value = r.url || '';
    const h = remoteHost();
    tokenNote.textContent = !r.token.safe ? t('project.tokenUnsafe')
      : !r.url ? '' : r.token.saved ? t('project.tokenSaved', { host: h }) : t('project.tokenNone', { host: h });
  }
  /** @type {Array<{oid: string, message: string, author: string, time: number}>} */ let commits = [];
  let picked = '';
  view.append(tabs, panePreview, paneCode, paneChanges, paneHistory);
  cols.append(fileList, view);
  main.append(bar, shareNote, model, cols);
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

  function paintShare() {
    shareBtn.hidden = !door;
    shareBtn.textContent = lanUrls.length ? t('project.unshare') : t('project.share');
    shareBtn.title = lanUrls.length ? t('project.tipUnshare') : t('project.tipShare');
    shareBtn.setAttribute('aria-pressed', lanUrls.length ? 'true' : 'false');
    shareNote.textContent = lanUrls.length ? t('project.shared', { urls: lanUrls.join(' · ') }) : '';
  }

  async function toggleShare() {
    if (!door || !projectId) return;
    const on = !lanUrls.length;
    shareBtn.disabled = true;
    const r = await door.share(projectId, on);
    shareBtn.disabled = false;
    if (r && r.ok) {
      lanUrls = r.urls || [];
      paintShare();
      if (on && !lanUrls.length) shareNote.textContent = t('project.sharedNoLan');
      return;
    }
    shareNote.textContent = String((r && r.message) || '');
  }

  async function loadHistory() {
    if (!door || !projectId) return;
    void loadRemote();
    const mine = epoch;
    const r = await door.history(projectId);
    if (mine !== epoch) return;
    commits = r && r.ok ? r.commits : [];
    if (!commits.some((c) => c.oid === picked)) picked = commits.length ? commits[0].oid : '';
    paintHistory();
    if (picked) void showCommit(picked);
    else commitView.replaceChildren(make('p', 'chat-proj-note', r && !r.ok ? String(r.message || '') : t('project.noHistory')));
  }

  function paintHistory() {
    commitList.replaceChildren(...commits.map((c) => {
      const li = make('li', 'chat-proj-commit-row');
      const b = button(c.message, 'chat-proj-commit', () => { picked = c.oid; paintHistory(); void showCommit(c.oid); }, c.message);
      b.classList.toggle('is-open', c.oid === picked);
      li.append(b, make('span', 'chat-proj-note chat-proj-commit-time', new Date(c.time).toLocaleString()));
      return li;
    }));
  }

  /** One commit: going back to it (unless it is the newest), and what it changed, file by file. @param {string} oid */
  async function showCommit(oid) {
    if (!door) return;
    const mine = epoch;
    const r = await door.changes(projectId, oid);
    if (mine !== epoch || oid !== picked) return;
    /** @type {HTMLElement[]} */ const out = [];
    const at = commits.findIndex((c) => c.oid === oid);
    if (at > 0) out.push(button(t('project.goBack'), 'chat-proj-go-back', () => { void goBack(oid); }, t('project.tipGoBack')));
    else if (at === 0) out.push(make('p', 'chat-proj-note', t('project.latest')));
    if (r && !r.ok) out.push(make('p', 'chat-proj-note', String(r.message || '')));
    for (const f of (r && r.ok ? r.files : [])) {
      const box = make('div', 'chat-proj-change');
      box.append(make('p', 'chat-proj-change-path', f.path));
      if (f.binary) { box.append(make('p', 'chat-proj-note', t('project.binaryChanged'))); out.push(box); continue; }
      const pre = make('pre', 'chat-proj-diff');
      for (const l of hunks(diffLines(f.before, f.after))) {
        const cls = l.kind === '-' ? 'chat-proj-del' : l.kind === '+' ? 'chat-proj-add' : l.kind === '…' ? 'chat-proj-gap' : 'chat-proj-keep';
        pre.append(make('span', cls, l.kind === '…' ? '…\n' : `${l.kind} ${l.text}\n`));
      }
      box.append(pre);
      out.push(box);
    }
    commitView.replaceChildren(...out);
  }

  /** Make the files what they were at `oid` — a new commit, so it can be undone the same way. @param {string} oid */
  async function goBack(oid) {
    if (!door) return;
    const r = await door.restore(projectId, oid);
    if (!(r && r.ok)) { commitView.prepend(make('p', 'chat-proj-note', String((r && r.message) || ''))); return; }
    reloads += 1;
    await refreshFiles();
    picked = '';
    await loadHistory();
    void refreshOpen();
  }

  function paintTabs() {
    for (const [id, b] of Object.entries(tabBtn)) {
      b.setAttribute('aria-selected', id === tab ? 'true' : 'false');
      b.classList.toggle('is-on', id === tab);
    }
    panePreview.hidden = tab !== 'preview';
    paneCode.hidden = tab !== 'code';
    paneChanges.hidden = tab !== 'changes';
    paneHistory.hidden = tab !== 'history';
    if (tab !== 'preview') unmountFrame();
    if (tab === 'history') void loadHistory();
  }

  /** The page to show: the open .html file, or a picture or sound picked in the list, else index.html. */
  const pagePath = () => (/\.html?$/i.test(openFile) || MEDIA_RE.test(openFile) ? openFile : 'index.html');

  function unmountFrame() {
    if (frame) { frame.remove(); frame = null; }
    if (graphLive) { graphLive.stop(); graphLive = null; }
    graphMount.hidden = true;
  }

  /** A graph.json (graphify's node-link) opened from the file list: drawn by the Computer's viewer
   * (sandbox/graph-view.mjs) in this panel's OWN sandbox guest — drag, zoom, pan; never the served page. */
  async function mountGraph() {
    const mine = epoch;
    const r = app.projects ? await app.projects.read(projectId, openFile) : null;
    if (mine !== epoch || !visible || tab !== 'preview') return;
    let graph;
    try {
      graph = readNodeLink(r && r.ok ? r.text : '');
    } catch (err) {
      const e = /** @type {any} */ (err);
      const message = e.code === 'not-json' ? t('parts.previewGraphNotJson', { reason: String(e.message) }) : t('parts.previewGraphNoNodes');
      previewNote.textContent = e.line ? t('parts.previewError', { message, line: e.line }) : message;
      return;
    }
    if (!sandbox) { sandbox = createSandbox({ doc }); sandbox.mount(graphMount); }
    graphMount.hidden = false;
    const box = graphMount.getBoundingClientRect();
    const size = { w: Math.max(240, Math.round(box.width) || 480), h: Math.max(240, Math.round(box.height) || 360) };
    graphLive = sandbox.live({
      mount: graphMount, mode: 'dom', size, inputs: { width: size.w, height: size.h, mode: 'dom' },
      code: graphProgram(graph, {
        tooMany: t('parts.previewGraphTooMany', { nodes: graph.total.nodes, links: graph.total.links, maxNodes: MAX_NODES, maxLinks: MAX_LINKS }),
        empty: t('parts.previewGraphEmpty'),
      }),
    });
  }

  /** @param {boolean} [again] */
  function mountFrame(again) {
    if (!visible || tab !== 'preview' || !projectId) { unmountFrame(); return; }
    if (GRAPH_RE.test(openFile)) {
      if (graphLive && !again) return;
      unmountFrame();
      previewNote.textContent = '';
      void mountGraph();
      return;
    }
    const page = pagePath();
    const has = files.some((f) => f.path === page);
    previewNote.textContent = !door ? t('project.noApp') : has ? '' : t('project.noIndex', { page });
    if (!door || !serveUrl || !has) { unmountFrame(); return; }
    const src = `${serveUrl}${page.split('/').map(encodeURIComponent).join('/')}?r=${reloads}`;
    if (frame && frame.getAttribute('src') === src && !again) return;
    unmountFrame();
    frame = servedFrame(doc, src, t('project.tabPreview'));   // host.mjs: the one module that makes iframes
    frame.className = 'chat-proj-frame';
    panePreview.append(frame);
  }

  function paintFiles() {
    const rows = files.map((f) => {
      const li = make('li', 'chat-proj-file-row');
      const b = button(f.path, 'chat-proj-file', () => { void openInCode(f.path); }, f.path);
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
    if (!TEXT_RE.test(rel)) {
      // A picture or a sound is shown by the Preview; anything else (a font…) cannot be shown here at all.
      const media = MEDIA_RE.test(rel);
      codeName.textContent = rel; area.value = ''; openText = ''; area.disabled = true;
      codeNote.textContent = media ? t('project.binary') : t('project.binaryOther');
      tab = media ? 'preview' : 'code'; paintTabs(); mountFrame(); return;
    }
    const mine = epoch;
    const r = await app.projects.read(projectId, rel);
    if (mine !== epoch) return;
    codeName.textContent = rel;
    area.disabled = !(r && r.ok);
    area.value = r && r.ok ? r.text : '';
    openText = area.value;
    openMtime = r && r.ok ? r.mtime : 0;
    codeNote.textContent = r && r.ok ? '' : String((r && r.message) || '');
    // A graph (graphify's graph.json) opens as a drawing in the Preview; its text waits in Code.
    tab = GRAPH_RE.test(rel) ? 'preview' : 'code';
    paintTabs();
    if (tab === 'preview') mountFrame(true);
  }

  async function saveFile() {
    if (!projectId || !openFile || area.disabled) return;
    const text = area.value;
    const r = await app.projects.write(projectId, openFile, text, openMtime ? { ifMtime: openMtime } : undefined);
    if (r && r.ok) {
      openMtime = r.mtime; openText = text; codeNote.textContent = t('project.saved'); reloads += 1; void refreshFiles();
      if (door) void door.commit(projectId, openFile);   // a person's Save is a commit too
      return;
    }
    codeNote.textContent = r && r.code === 'E_CONFLICT' ? t('project.conflict') : String((r && r.message) || '');
  }

  /**
   * The open text file changed on disk (a reply, Go back, Pull): show the new text in the Code tab, whichever tab is
   * up — a Code tab left stale showed the old file and its Save was then refused. A person's unsaved edit is never
   * overwritten: the editor keeps it, and Save's mtime check says the file moved.
   */
  async function refreshOpen() {
    const rel = openFile;
    if (!projectId || !rel || !TEXT_RE.test(rel) || area.value !== openText) return;
    const mine = epoch;
    const r = await app.projects.read(projectId, rel);
    if (mine !== epoch || rel !== openFile || area.value !== openText || !(r && r.ok)) return;
    area.value = r.text;
    openText = r.text;
    openMtime = r.mtime;
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
      li.append(button(p.name, 'chat-proj-pick', () => { void bind(p.id); }, t('project.tipPick')));
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
    if (!name) { nameIn.focus(); return; }           // the button with no name did nothing at all: show where it goes
    if (!app.projects) return;
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
    if (id !== projectId) { projectId = id; openFile = ''; files = []; serveUrl = ''; area.value = ''; openText = ''; codeName.textContent = ''; tab = 'preview'; }
    empty.hidden = !!projectId;
    main.hidden = !projectId;
    paintModel();
    void checkInstalled();
    if (!projectId) { unmountFrame(); await paintEmpty(); return; }
    const meta = app.projects ? await app.projects.meta(projectId) : null;
    if (mine !== epoch) return;
    projectName = meta && meta.ok ? meta.project.name : projectId;
    nameEl.textContent = projectName;
    if (door) {
      // Asked every time: main answers from its cache, and says whether this project is shared on the LAN.
      const s = await door.serve(projectId);
      if (mine !== epoch) return;
      serveUrl = s && s.ok ? s.url : '';
      lanUrls = s && s.ok && Array.isArray(s.lan) ? s.lan : [];
    }
    paintShare();
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
    void refreshFiles().then(() => {
      paintChanges(); mountFrame(true);
      void refreshOpen();
      if (tab === 'history') { picked = ''; void loadHistory(); }
    });
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
      if (sandbox) { sandbox.destroy(); sandbox = null; }
      if (typeof off === 'function') off();
      offInstall();
      doc.removeEventListener('lolchat:model', onModel);
      host.replaceChildren();
    },
    debug: {
      state: () => ({ projectId, projectName, files: files.map((f) => f.path), tab, openFile, serveUrl, lan: lanUrls.slice(), history: commits.map((c) => c.message), frame: frame ? frame.getAttribute('src') : null, graph: graphLive ? graphLive.state() : null }),
    },
  };
}
