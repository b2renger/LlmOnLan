// @ts-check
// The tutorial (COMPUTER_PLAN §10; addendum KE-4..KE-7) — K5-U3. A loader `feature` (row
// `tutorial`): `install(app)` publishes `app.tutorial` (API_KEYS.tutorial), fills the sidebar's
// Learn shelf (`els.shelves`) and drives the step rail (`els.rail`).
//
//   the shelf     "Learn" in the library sidebar: every lesson (with its progress, its length and
//                 whether it needs the farm) and every template, one click each. The visible door.
//   open(id)      forks the lesson into the library ON FIRST OPEN (KE-5 says why not first edit),
//                 keeping its AUTHORED part ids; later opens reopen that fork where it was left.
//   the rail      one step at a time, docked bottom-left, foldable to a pill: the steps done as a
//                 row of ticks, `Show me` (or `Put it back` when the box it points at was deleted),
//                 `Got it` for a manual step, Reset lesson, and — never a dead end (§10.2) — the
//                 offer of the lesson's saved answer when a box it has one for fails.
//   checkpoints   check.mjs `advance()` on every session edit and every run event. No polling, no
//                 model call. Progress in kv `computer:tutorial`.
//   explain()     the run bar's `?`: a short card in the same dock, with the doors to learn more.
//
// FROZEN: `install(app)`, the API_KEYS.tutorial keys and their meanings (KE-6), and the DOM probes
// the harness clicks (KE-6): `.comp-learn`, `.comp-lesson[data-lesson]`,
// `.comp-template[data-template]`, `.comp-rail-step`, `.comp-rail-text`, `.comp-rail-show`,
// `.comp-rail-got`, `.comp-rail-reset`, `.comp-rail-demo`, `.comp-rail-next`.
// Added here (not frozen, the unit's own): `.comp-rail-collapse`, `.comp-rail-pill`,
// `.comp-rail-ticks`, `.comp-rail-farm`, `.comp-rail-demo-note`, `.comp-rail-templates`,
// `.comp-rail-explain` with `.comp-explain-{tour,learn,close}`.

import { t } from '../../core/i18n.mjs';
import { KV_KEYS } from '../../core/types.mjs';
import { EV } from '../../core/events.mjs';
import { specMap } from '../../graph/parts/index.mjs';
import { normaliseDoc, addWire } from '../../graph/model.mjs';
import { presetOf } from '../../graph/parts/creative.mjs';
import { LESSONS, TEMPLATES, lessonById, templateById } from './registry.mjs';
import { advance, tickManual, freshProgress } from './check.mjs';
import '../../strings/tutorial.en.mjs';

/** @typedef {import('../../core/types.mjs').Lesson} Lesson */

/** @param {string} tag @param {string} cls @param {string} [text] @returns {HTMLElement} */
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** @param {string} cls @param {string} text @param {() => void} onClick @param {string} [hint] */
function button(cls, text, onClick, hint) {
  const b = /** @type {HTMLButtonElement} */ (h('button', cls, text));
  b.type = 'button';
  if (hint) b.title = hint;
  b.addEventListener('click', (ev) => { ev.preventDefault(); onClick(); });
  return b;
}

/** A deep copy of plain data (a lesson's demo value), so the module's own object is never shared
 * with the document that stores it. @param {any} v */
const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** @param {any} app */
export function install(app) {
  const els = app.els;
  const specs = specMap();
  /** @type {Record<string, any>} */ let progress = {};
  /** The lesson whose fork is OPEN, derived from the session's doc id by `sync()`. `base` is the
   * shipped doc as the fork opened it — what `edited` compares against. */
  /** @type {{lesson: Lesson, docId: string, base: any}|null} */ let current = null;
  /** The last run that finished ON the open document. The runner's own `report()` is the last run
   * anywhere, and a lesson must not tick a `report` step on a run made in another graph. */
  /** @type {{docId: string, report: any}|null} */ let lastRun = null;
  let loaded = false;
  let collapsed = false;
  let explainOpen = false;
  let painted = '';
  let announced = '';
  /** Saves run one after another, so a slow write can never land after a newer one. */
  /** @type {Promise<any>} */ let saving = Promise.resolve();

  const repo = () => (app.repo && typeof app.repo.kvGet === 'function' ? app.repo : null);
  const session = () => (app.host && app.host.session) || null;
  const canvas = () => (app.host && app.host.canvas) || null;
  const runner = () => (app.host && app.host.runner) || null;
  const now = () => (typeof app.now === 'function' ? app.now() : Date.now());
  const toast = (/** @type {string} */ msg) => { if (app.dialogs && typeof app.dialogs.toast === 'function') app.dialogs.toast(msg); };
  const farmPresent = () => {
    try { return !!(app.farm && typeof app.farm.get === 'function' && app.farm.get() && app.farm.get().present); } catch { return false; }
  };

  async function load() {
    const r = repo();
    if (r) {
      try { await r.ready; } catch { /* the store speaks for itself */ }
      try {
        const v = await r.kvGet(KV_KEYS.computerTutorial);
        if (v && typeof v === 'object' && !Array.isArray(v)) progress = v;
      } catch { /* a fresh start */ }
    }
    loaded = true;
    sync();
  }
  function save() {
    const r = repo();
    if (!r || typeof r.kvSet !== 'function') return saving;
    const snapshot = copy(progress);
    saving = saving.then(() => r.kvSet(KV_KEYS.computerTutorial, snapshot)).catch((err) => {
      console.warn('[lolcomputer] saving tutorial progress failed', err);
    });
    return saving;
  }

  /** @param {string} id */
  async function openDoc(id) {
    if (app.library && typeof app.library.open === 'function') await app.library.open(id);
    else if (app.host && typeof app.host.open === 'function') await app.host.open(id);
  }

  /** @param {Lesson} lesson */
  const titleOf = (lesson) => (lesson.n ? t('tutorial.lessonTitle', { n: lesson.n, title: lesson.title }) : t('tutorial.tourTitle'));
  /** @param {Lesson} lesson */
  const rowTitleOf = (lesson) => (lesson.n ? t('tutorial.lessonRow', { n: lesson.n, title: lesson.title }) : t('tutorial.tourTitle'));

  /** The lesson's shipped doc, normalised as a fork with this id. NEVER `fromJson` (which mints
   * fresh ids): every check and `show` names the AUTHORED ids. @param {Lesson} lesson @param {string} id */
  const shipped = (lesson, id) => normaliseDoc({ ...lesson.doc, id, threadId: null, title: titleOf(lesson) }, { specs, now: app.now }).doc;

  /** @param {string} id */
  const progOf = (id) => ({ ...freshProgress(), ...(progress[id] || {}) });

  /** A part's name as its title bar says it (a preset's name, else the part's label). @param {any} part */
  function partName(part) {
    const spec = part ? specs.get(part.type) : null;
    if (!spec) return '';
    const own = typeof spec.titleOf === 'function' ? spec.titleOf(part) : null;
    return String(own || spec.label || part.type);
  }

  // ---- the shelf -------------------------------------------------------------------------------
  const shelf = els.shelves;
  shelf.classList.remove('hidden');
  shelf.replaceChildren();
  const learn = /** @type {HTMLButtonElement} */ (h('button', 'comp-learn'));
  learn.type = 'button';
  learn.title = t('tutorial.learnHint');
  learn.append(h('span', 'comp-learn-name', t('tutorial.learn')),
    h('span', 'comp-learn-count', t('tutorial.learnCount', { lessons: LESSONS.length, templates: TEMPLATES.length })));
  const body = h('div', 'comp-shelf-body');
  body.id = 'comp-learn-body';
  learn.setAttribute('aria-controls', body.id);
  learn.setAttribute('aria-expanded', 'true');
  const lessonsBox = h('div', 'comp-shelf');
  lessonsBox.dataset.shelf = 'lessons';
  const templatesBox = h('div', 'comp-shelf');
  templatesBox.dataset.shelf = 'templates';
  body.append(lessonsBox, templatesBox);
  shelf.append(learn, body);
  learn.addEventListener('click', () => {
    body.hidden = !body.hidden;
    learn.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
  });

  function paintShelf() {
    lessonsBox.replaceChildren(h('div', 'comp-shelf-head', t('tutorial.shelfLessons')));
    for (const l of LESSONS) {
      const p = progOf(l.id);
      const of = (l.steps || []).length;
      const done = !!p.doneAt;
      const started = !done && (p.ticks.length > 0 || !!p.forkedDocId);
      const b = /** @type {HTMLButtonElement} */ (h('button', 'comp-lesson'));
      b.type = 'button';
      b.dataset.lesson = l.id;
      b.dataset.state = done ? 'done' : started ? 'started' : 'new';
      if (done) b.dataset.done = 'true';
      if (current && current.lesson.id === l.id) b.setAttribute('aria-current', 'true');
      const ring = h('span', 'comp-lesson-ring');
      ring.setAttribute('aria-hidden', 'true');
      const pct = done ? 100 : of ? Math.round((Math.min(p.ticks.length, of) / of) * 100) : 0;
      ring.style.setProperty('--p', `${pct}%`);
      const where = done ? t('tutorial.progressDone')
        : started ? t('tutorial.progressSome', { done: Math.min(p.ticks.length, of), n: of })
          : t('tutorial.progressNew');
      // The chip sits on the meta line, under the title: the sidebar is narrow, and a lesson's
      // NAME is what a person scans for.
      const chip = h('span', 'comp-lesson-chip', l.needsFarm === 'no' ? t('tutorial.chipOffline') : t('tutorial.chipFarm'));
      chip.dataset.farm = l.needsFarm === 'no' ? 'no' : 'yes';
      const sub = h('span', 'comp-lesson-sub');
      sub.append(h('span', 'comp-lesson-meta', [t('tutorial.minutes', { n: l.minutes }), where].join(' · ')), chip);
      const main = h('span', 'comp-lesson-main');
      main.append(h('span', 'comp-lesson-title', rowTitleOf(l)), sub);
      b.append(ring, main);
      b.title = l.subtitle;
      b.addEventListener('click', () => { void open(l.id); });
      lessonsBox.appendChild(b);
    }
    templatesBox.replaceChildren(h('div', 'comp-shelf-head', t('tutorial.shelfTemplates')));
    for (const x of TEMPLATES) {
      const b = /** @type {HTMLButtonElement} */ (h('button', 'comp-template'));
      b.type = 'button';
      b.dataset.template = x.id;
      const glyph = h('span', 'comp-template-glyph', '▦');
      glyph.setAttribute('aria-hidden', 'true');
      const main = h('span', 'comp-lesson-main');
      const meta = [x.needsFarm === 'no' ? t('tutorial.chipOffline') : t('tutorial.chipFarm')];
      if (Number(x.generations) > 0) meta.push(t('tutorial.templateMeta', { n: x.generations }));
      main.append(h('span', 'comp-template-title', x.title), h('span', 'comp-lesson-meta', meta.join(' · ')));
      b.append(glyph, main);
      b.title = x.subtitle;
      b.addEventListener('click', () => { void openTemplate(x.id); });
      templatesBox.appendChild(b);
    }
  }

  // ---- the rail --------------------------------------------------------------------------------
  const rail = els.rail;
  rail.setAttribute('role', 'region');
  rail.setAttribute('aria-label', t('tutorial.learn'));
  const content = h('div', 'comp-rail-content');
  // One polite live region that survives every repaint: it says the NEW step once, not the rail.
  const say = h('div', 'comp-rail-say');
  say.setAttribute('aria-live', 'polite');
  rail.replaceChildren(content, say);

  /** A failed box this lesson has a recorded answer for — by part id, or `@preset` for a box the
   * learner added from the ＋ menu (KE-4). @param {any} doc */
  function demoCandidate(doc) {
    if (!current || !doc || !current.lesson.demo) return null;
    const demo = /** @type {Record<string, any>} */ (current.lesson.demo);
    for (const part of doc.parts) {
      if (part.state !== 'error') continue;
      const preset = presetOf(part);
      const key = demo[part.id] ? part.id : (preset && demo[`@${preset}`] ? `@${preset}` : '');
      if (key) return { partId: String(part.id), key, name: partName(part) };
    }
    return null;
  }

  /** Everything the rail shows, as data: the rail repaints only when THIS changes, so a pan, a
   * selection or a running box's progress never rebuilds the buttons under the pointer. */
  function viewModel() {
    const s = session();
    const doc = s ? s.doc() : null;
    /** @type {any} */ const vm = { explain: explainOpen, lesson: null };
    if (!current || !doc || !s || s.docId() !== current.docId) return vm;
    const lesson = current.lesson;
    const p = progOf(lesson.id);
    const steps = lesson.steps || [];
    const step = steps[p.step] || null;
    const show = step && step.show ? /** @type {any} */ (step.show) : null;
    const has = (/** @type {string} */ id) => doc.parts.some((/** @type {any} */ x) => x.id === id);
    const offer = demoCandidate(doc);
    vm.lesson = lesson.id;
    vm.i = Math.min(p.step, steps.length);
    vm.n = steps.length;
    vm.ticks = p.ticks.slice();
    vm.collapsed = collapsed && !explainOpen;
    vm.missing = !!show && ((show.partId && !has(show.partId)) || (show.wire && (!has(show.wire.from) || !has(show.wire.to))));
    vm.offer = offer ? [offer.partId, offer.name] : null;
    vm.demoCount = doc.parts.filter((/** @type {any} */ x) => x.demo === true).length;
    vm.farmAbsent = lesson.needsFarm !== 'no' && !farmPresent();
    return vm;
  }

  function paintRail() {
    const vm = viewModel();
    const key = JSON.stringify(vm);
    if (key === painted) return;
    painted = key;
    // Where the keyboard was: a repaint replaces the buttons, so focus goes to the same control in
    // the new rail (or the rail itself) rather than falling to <body>.
    const active = /** @type {any} */ (document.activeElement);
    const hadFocus = !!(active && rail.contains(active));
    const focusCls = hadFocus && active.className ? String(active.className).split(' ')[0] : '';

    if (!vm.lesson && !vm.explain) {
      rail.classList.add('hidden');
      delete rail.dataset.lesson;
      delete rail.dataset.collapsed;
      content.replaceChildren();
      return;
    }
    rail.classList.remove('hidden');
    if (vm.lesson) rail.dataset.lesson = vm.lesson; else delete rail.dataset.lesson;
    if (vm.collapsed) rail.dataset.collapsed = 'true'; else delete rail.dataset.collapsed;
    content.replaceChildren();

    if (vm.explain) content.appendChild(explainCard());
    if (vm.lesson && current) {
      if (vm.collapsed) content.appendChild(pill(vm));
      else content.appendChild(lessonCard(vm));
      announce(vm);
    }

    if (hadFocus) {
      const again = focusCls ? /** @type {HTMLElement|null} */ (content.querySelector(`.${focusCls}`)) : null;
      const first = /** @type {HTMLElement|null} */ (content.querySelector('button'));
      const target = again || first;
      if (target) target.focus();
    }
  }

  /** @param {any} vm */
  function announce(vm) {
    if (!current) return;
    const steps = current.lesson.steps || [];
    const words = vm.i >= vm.n ? t('tutorial.done')
      : `${t('tutorial.stepOf', { i: vm.i + 1, n: vm.n })}: ${steps[vm.i] ? steps[vm.i].text : ''}`;
    if (words === announced) return;
    announced = words;
    say.textContent = words;
  }

  /** The folded rail: one button that unfolds it. @param {any} vm */
  function pill(vm) {
    if (!current) return h('span', '');
    const title = titleOf(current.lesson);
    const words = vm.i >= vm.n ? t('tutorial.pillDone', { title }) : t('tutorial.pill', { i: vm.i + 1, n: vm.n, title });
    const b = button('comp-rail-pill', words, () => { collapsed = false; paintRail(); }, t('tutorial.expand'));
    b.setAttribute('aria-expanded', 'false');
    return b;
  }

  /** @param {any} vm */
  function lessonCard(vm) {
    const card = h('div', 'comp-rail-card');
    if (!current) return card;
    const lesson = current.lesson;
    const steps = lesson.steps || [];

    const head = h('div', 'comp-rail-head');
    head.appendChild(h('span', 'comp-rail-title', titleOf(lesson)));
    const fold = button('comp-rail-collapse', '–', () => { collapsed = true; paintRail(); }, t('tutorial.collapse'));
    fold.setAttribute('aria-label', t('tutorial.collapse'));
    fold.setAttribute('aria-expanded', 'true');
    head.appendChild(fold);
    card.appendChild(head);

    // Completed steps collapse into a row of ticks (§10.1 mechanism 2).
    const ticks = h('ol', 'comp-rail-ticks');
    ticks.setAttribute('aria-label', t('tutorial.ticks', { done: Math.min(vm.ticks.length, vm.n), n: vm.n }));
    steps.forEach((s, i) => {
      const dot = h('li', 'comp-rail-tick');
      dot.dataset.state = vm.ticks.indexOf(s.id) >= 0 ? 'done' : i === vm.i ? 'now' : 'todo';
      dot.title = s.text;
      ticks.appendChild(dot);
    });
    card.appendChild(ticks);

    if (vm.i >= vm.n) {
      card.appendChild(h('p', 'comp-rail-text', t('tutorial.done')));
      if (lesson.idea) card.appendChild(h('p', 'comp-rail-idea', t('tutorial.doneIdea', { idea: lesson.idea })));
      const nx = lesson.next ? lessonById(lesson.next) : null;
      const row = h('div', 'comp-rail-actions');
      if (nx) {
        const target = nx;
        row.appendChild(button('comp-rail-next', t('tutorial.next', { title: titleOf(target) }), () => { void open(target.id); }, target.subtitle));
      } else {
        card.appendChild(h('p', 'comp-rail-hint', t('tutorial.lastLesson')));
        row.appendChild(button('comp-rail-templates', t('tutorial.openTemplates'), () => showShelf('templates')));
      }
      card.appendChild(row);
    } else {
      const s = steps[vm.i];
      if (vm.i === 0 && !vm.ticks.length && lesson.subtitle) card.appendChild(h('p', 'comp-rail-sub', lesson.subtitle));
      card.appendChild(h('div', 'comp-rail-step', t('tutorial.stepOf', { i: vm.i + 1, n: vm.n })));
      card.appendChild(h('p', 'comp-rail-text', s.text));
      if (s.hint) card.appendChild(h('p', 'comp-rail-hint', s.hint));
      const row = h('div', 'comp-rail-actions');
      if (s.show) {
        const show = /** @type {any} */ (s.show);
        const label = vm.missing ? t('tutorial.putBack') : t('tutorial.showMe');
        const hint = vm.missing ? t('tutorial.putBackHint') : show.menu ? t('tutorial.showMenuHint') : t('tutorial.showMeHint');
        const b = button('comp-rail-show', label, () => showMe(show), hint);
        if (vm.missing) b.dataset.putBack = 'true';
        row.appendChild(b);
      }
      if (s.check && 'manual' in s.check) {
        const stepId = s.id;
        row.appendChild(button('comp-rail-got', t('tutorial.gotIt'), () => gotIt(stepId)));
      }
      if (row.childNodes.length) card.appendChild(row);
    }

    if (vm.farmAbsent && vm.i < vm.n) card.appendChild(h('p', 'comp-rail-farm', t('tutorial.farmAbsent')));

    if (vm.offer) {
      const [partId, name] = vm.offer;
      const offer = h('div', 'comp-rail-offer');
      offer.appendChild(h('p', 'comp-rail-demo-text', t('tutorial.demoOffer', { part: name })));
      const b = button('comp-rail-demo', t('tutorial.demoUse'), () => useDemo(partId));
      b.dataset.part = partId;
      offer.appendChild(b);
      card.appendChild(offer);
    }
    if (vm.demoCount) {
      card.appendChild(h('p', 'comp-rail-demo-note', vm.demoCount === 1 ? t('tutorial.demoNoteOne') : t('tutorial.demoNoteMany', { n: vm.demoCount })));
    }

    const foot = h('div', 'comp-rail-foot');
    foot.appendChild(button('comp-rail-reset', t('tutorial.reset'), () => { void resetLesson(lesson.id, { confirm: true }); }));
    card.appendChild(foot);
    return card;
  }

  /** The run bar's `?` (§8.5): what this is, in two sentences, and the doors to learn more. */
  function explainCard() {
    const card = h('div', 'comp-rail-explain');
    card.appendChild(h('div', 'comp-explain-title', t('tutorial.explainTitle')));
    card.appendChild(h('p', 'comp-explain-body', t('tutorial.explainBody')));
    if (current && current.lesson.idea) card.appendChild(h('p', 'comp-explain-body', t('tutorial.explainLesson', { idea: current.lesson.idea })));
    const row = h('div', 'comp-rail-actions');
    if (lessonById('l00-tour') && !(current && current.lesson.id === 'l00-tour')) {
      row.appendChild(button('comp-explain-tour', t('tutorial.explainTour'), () => { explainOpen = false; void open('l00-tour'); }));
    }
    row.appendChild(button('comp-explain-learn', t('tutorial.explainLearn'), () => { explainOpen = false; paintRail(); showShelf('lessons'); }));
    row.appendChild(button('comp-explain-close', t('tutorial.explainClose'), () => { explainOpen = false; paintRail(); }));
    card.appendChild(row);
    return card;
  }

  // ---- what the rail's buttons do ---------------------------------------------------------------

  /** @param {string} stepId */
  function gotIt(stepId) {
    if (!current) return;
    const id = current.lesson.id;
    progress[id] = tickManual(current.lesson, progress[id], stepId);
    void save();
    evaluateNow(true);
  }

  /** @param {string} partId */
  function useDemo(partId) {
    const s = session();
    if (!s || !current) return;
    const doc = s.doc();
    const offer = demoCandidate(doc);
    if (!offer || offer.partId !== partId) return;
    const value = copy(/** @type {any} */ (current.lesson.demo)[offer.key]);
    s.patchPart(partId, { value, state: 'done', error: null, demo: true });
    const p = progOf(current.lesson.id);
    p.demo = Array.from(new Set([...(p.demo || []), partId]));
    progress[current.lesson.id] = p;
    void save();
    evaluateNow(true);
  }

  /** Re-add an authored part that the learner deleted, at its authored place, with the authored
   * wires that touched it (where both ends still exist). ONE undo entry. §10.1 mechanism 4.
   * @param {string[]} ids */
  function putBack(ids) {
    const s = session();
    if (!s || !current) return false;
    const lesson = current.lesson;
    let doc = s.doc();
    const have = new Set(doc.parts.map((/** @type {any} */ x) => x.id));
    const raw = (lesson.doc.parts || []).filter((/** @type {any} */ x) => ids.indexOf(x.id) >= 0 && !have.has(x.id));
    if (!raw.length) return false;
    const fresh = normaliseDoc({ id: doc.id, parts: raw, wires: [] }, { specs, now: app.now }).doc.parts;
    doc = { ...doc, parts: [...doc.parts, ...fresh] };
    for (const p of fresh) have.add(p.id);
    for (const w of /** @type {any[]} */ (lesson.doc.wires || [])) {
      if (!(ids.indexOf(w.from) >= 0 || ids.indexOf(w.to) >= 0)) continue;
      if (!have.has(w.from) || !have.has(w.to)) continue;
      if (doc.wires.some((/** @type {any} */ x) => x.from === w.from && x.to === w.to)) continue;
      const out = addWire(doc, { from: w.from, to: w.to, port: w.port || '', label: w.label }, { specs, newId: app.newId, now: app.now });
      if (out.ok) doc = out.doc;
    }
    s.apply({ ...doc, rev: (Number(s.doc().rev) || 0) + 1, updatedAt: now() }, { label: 'put back' });
    return true;
  }

  /** @param {any} show */
  function showMe(show) {
    const c = canvas();
    const s = session();
    if (!c || !s || !current) return;
    explainOpen = false;
    if (show.menu) { c.openPalette({ highlight: String(show.menu) }); paintRail(); return; }
    const has = (/** @type {string} */ id) => s.doc().parts.some((/** @type {any} */ x) => x.id === id);
    if (show.partId) {
      if (!has(show.partId)) putBack([show.partId]);
      c.reveal(show.partId);
      paintRail();
      return;
    }
    if (show.wire) {
      const { from, to } = show.wire;
      const gone = [from, to].filter((id) => !has(id));
      if (gone.length) putBack(gone);
      if (!has(from) || !has(to)) { if (has(from)) c.reveal(from); else if (has(to)) c.reveal(to); return; }
      // Critic S1-6: when the arrow already EXISTS (lesson 3: "click its name me tag"), show the
      // ARROW — its tag centred, the wire selected and flashed — not the two boxes around it.
      const wired = s.doc().wires.some((/** @type {any} */ w) => w.from === from && w.to === to);
      if (wired && typeof (/** @type {any} */ (c).revealWire) === 'function') {
        /** @type {any} */ (c).revealWire(from, to);
        paintRail();
        return;
      }
      // Both ends flash, then the view settles on the middle of the pair with both selected.
      c.reveal(to);
      c.reveal(from);
      const doc = s.doc();
      const a = doc.parts.find((/** @type {any} */ x) => x.id === from);
      const b = doc.parts.find((/** @type {any} */ x) => x.id === to);
      const left = Math.min(a.x, b.x);
      const top = Math.min(a.y, b.y);
      const cx = (left + Math.max(a.x + a.w, b.x + b.w)) / 2;
      const cy = (top + Math.max(a.y + a.h, b.y + b.h)) / 2;
      const v = c.view();
      const r = c.canvas && typeof c.canvas.getBoundingClientRect === 'function' ? c.canvas.getBoundingClientRect() : null;
      if (r && r.width > 0) c.setView({ x: r.width / 2 - cx * v.zoom, y: r.height / 2 - cy * v.zoom, zoom: v.zoom });
      c.select([from, to], { say: false });
      paintRail();
    }
  }

  // ---- checkpoints ------------------------------------------------------------------------------

  /** @param {boolean} [force] repaint the shelf even when no tick moved */
  function evaluateNow(force) {
    if (!loaded) { paintRail(); return; }
    const s = session();
    let moved = false;
    if (current && s && s.docId() === current.docId) {
      const lesson = current.lesson;
      const before = JSON.stringify(progOf(lesson.id));
      const next = advance(lesson, progress[lesson.id], {
        doc: s.doc(),
        report: lastRun && lastRun.docId === current.docId ? lastRun.report : null,
        base: current.base,
        now: now(),
      });
      if (JSON.stringify(next) !== before) {
        progress[lesson.id] = next;
        moved = true;
        void save();
      }
    }
    if (moved || force) paintShelf();
    paintRail();
  }

  /** Which lesson (if any) the OPEN document is a fork of. */
  function sync() {
    const s = session();
    const docId = s && typeof s.docId === 'function' ? s.docId() : null;
    const id = docId ? Object.keys(progress).find((k) => progress[k] && progress[k].forkedDocId === docId && lessonById(k)) : null;
    const lesson = id ? lessonById(id) : null;
    const was = current ? `${current.lesson.id}:${current.docId}` : '';
    current = lesson && docId ? { lesson, docId, base: shipped(lesson, docId) } : null;
    if (`${current ? `${current.lesson.id}:${current.docId}` : ''}` !== was) { collapsed = false; announced = ''; }
    evaluateNow(true);
  }

  // ---- the API (KE-6) --------------------------------------------------------------------------

  /** One open per lesson at a time: a double-click on the shelf must not fork a lesson twice.
   * @type {Map<string, Promise<string|null>>} */
  const opening = new Map();

  /** @param {string} id @returns {Promise<string|null>} */
  function open(id) {
    const key = String(id);
    const going = opening.get(key);
    if (going) return going;
    const p = openOnce(key).finally(() => { opening.delete(key); });
    opening.set(key, p);
    return p;
  }

  /** @param {string} id @returns {Promise<string|null>} */
  async function openOnce(id) {
    const lesson = lessonById(id);
    if (!lesson) { toast(t('tutorial.notShipped')); return null; }
    await ready;
    const r = app.repo;
    if (!r || typeof r.putGraph !== 'function') return null;
    const before = progress[id] && typeof progress[id] === 'object' ? progress[id] : null;
    let docId = before && typeof before.forkedDocId === 'string' ? before.forkedDocId : null;
    if (docId && typeof r.getGraph === 'function') {
      let row = null;
      try { row = await r.getGraph(docId); } catch { row = null; }
      if (!row) docId = null;
    }
    if (!docId) {
      // Fork on first open (KE-5). A fork deleted from the library forks again, from the start —
      // but a lesson once finished keeps its tick on the shelf.
      docId = /** @type {string} */ (app.newId());
      await r.putGraph({ ...shipped(lesson, docId), threadId: null, folder: null });
      progress[id] = { ...freshProgress(), forkedDocId: docId, doneAt: before && before.doneAt ? before.doneAt : null };
      await save();
    }
    collapsed = false;
    explainOpen = false;
    const c = canvas();
    if (c && typeof c.paletteOpen === 'function' && c.paletteOpen()) c.closePalette();
    await openDoc(docId);
    sync();
    return docId;
  }

  /** A template opens as a NEW library document with fresh ids (KE-4). @param {string} id */
  async function openTemplate(id) {
    const tpl = templateById(id);
    if (!tpl) { toast(t('tutorial.notShipped')); return null; }
    if (!app.library || typeof app.library.importText !== 'function') return null;
    const out = await app.library.importText(JSON.stringify(tpl.doc), { name: tpl.title });
    if (!out || !out.ok) return null;
    toast(t('tutorial.templateOpened', { title: tpl.title }));
    return out.id;
  }

  /** Put a lesson's fork back the way it shipped: one undo entry on the open fork (so Undo brings
   * the learner's version back), and its progress from step 1. @param {string} [id]
   * @param {{confirm?: boolean}} [o] @returns {Promise<boolean>} */
  async function resetLesson(id, o = {}) {
    const lessonId = id || (current && current.lesson.id);
    const lesson = lessonId ? lessonById(lessonId) : null;
    if (!lesson) return false;
    if (o.confirm && app.dialogs && typeof app.dialogs.confirm === 'function') {
      const go = await app.dialogs.confirm({ title: t('tutorial.reset'), body: t('tutorial.resetAsk'), ok: t('tutorial.reset'), danger: true });
      if (!go) return false;
    }
    const p = progOf(lesson.id);
    const s = session();
    const run = runner();
    if (current && current.lesson.id === lesson.id && s && s.docId() === current.docId) {
      if (run && typeof run.running === 'function' && run.running()) run.stop();
      const cur = s.doc();
      const fresh = shipped(lesson, current.docId);
      s.apply({ ...fresh, title: cur.title || fresh.title, createdAt: cur.createdAt, rev: (Number(cur.rev) || 0) + 1, updatedAt: now() }, { label: 'reset lesson' });
      s.select([]);
      lastRun = null;
    } else if (p.forkedDocId && app.repo && typeof app.repo.getGraph === 'function') {
      let row = null;
      try { row = await app.repo.getGraph(p.forkedDocId); } catch { row = null; }
      if (row) {
        const fresh = shipped(lesson, p.forkedDocId);
        await app.repo.putGraph({ ...fresh, threadId: null, folder: row.folder == null ? null : row.folder, title: row.title || fresh.title });
      }
    }
    progress[lesson.id] = { ...freshProgress(), forkedDocId: p.forkedDocId || null };
    await save();
    toast(t('tutorial.resetDone'));
    evaluateNow(true);
    return true;
  }

  /** @param {'lessons'|'templates'} [which] */
  function showShelf(which) {
    body.hidden = false;
    learn.setAttribute('aria-expanded', 'true');
    const box = which === 'templates' ? templatesBox : lessonsBox;
    try { box.scrollIntoView({ block: 'nearest' }); } catch { /* not laid out */ }
    const first = /** @type {HTMLElement|null} */ (box.querySelector('button'));
    if (first) first.focus();
  }

  function explain() {
    explainOpen = true;
    collapsed = false;
    paintRail();
    const first = /** @type {HTMLElement|null} */ (content.querySelector('.comp-rail-explain button'));
    if (first) first.focus();
  }

  app.tutorial = {
    has: (/** @type {string} */ id) => !!lessonById(id),
    lessons: () => LESSONS.map((l) => {
      const p = progOf(l.id);
      return {
        id: l.id, n: l.n, title: l.title, subtitle: l.subtitle, minutes: l.minutes, needsFarm: l.needsFarm,
        progress: { step: Math.min(p.step, (l.steps || []).length), of: (l.steps || []).length, done: !!p.doneAt },
      };
    }),
    templates: () => TEMPLATES.map((x) => ({ id: x.id, title: x.title, subtitle: x.subtitle, needsFarm: x.needsFarm, generations: x.generations })),
    open,
    openTemplate,
    active: () => {
      if (!current) return null;
      const p = progOf(current.lesson.id);
      return { lessonId: current.lesson.id, docId: current.docId, step: p.step, of: (current.lesson.steps || []).length, ticks: p.ticks.slice() };
    },
    reset: (/** @type {string} */ id) => resetLesson(id, { confirm: false }),
    showShelf,
    explain,
    debug: () => ({
      loaded,
      progress: copy(progress),
      current: current ? current.lesson.id : null,
      rail: !rail.classList.contains('hidden'),
      collapsed: !!(current && collapsed),
      explain: explainOpen,
      report: !!(lastRun && current && lastRun.docId === current.docId),
    }),
  };

  paintShelf();
  const s0 = session();
  if (s0 && typeof s0.on === 'function') {
    s0.on((/** @type {any} */ ev) => {
      if (ev && ev.type === 'doc' && ev.loaded) { sync(); return; }
      // A selection or a pan changes nothing a checkpoint reads (KE-5 reads the doc and the report).
      if (ev && (ev.type === 'select' || ev.type === 'view')) return;
      evaluateNow();
    });
  }
  const r0 = runner();
  if (r0 && typeof r0.on === 'function') {
    r0.on((/** @type {any} */ ev) => {
      if (ev && ev.type === 'done' && ev.report) {
        const s = session();
        const docId = s && typeof s.docId === 'function' ? s.docId() : null;
        if (docId) lastRun = { docId, report: ev.report };
      }
      evaluateNow();
    });
  }
  if (app.bus && typeof app.bus.on === 'function') app.bus.on(EV.FARM_CHANGE, () => paintRail());
  const ready = load();
}
