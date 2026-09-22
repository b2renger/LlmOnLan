// @ts-check
// The Computer's run bar (COMPUTER_PLAN §8.3, §11 K1-U3): the strip above the canvas that says
// what the last run did and lets you start or stop the next one.
//
//   [ Run all ] [ Stop ]   3 parts · 1 generation   1 / 50   100%   ?
//
// K1 lands exactly the controls §11 names — Run all, Stop, the two counts, the cap meter, the zoom
// readout and the `?`. K3-U3 extends this file (and css/computer-runbar.css) with the plan-range
// preview and the waits counter; K5 lights the `?` up.
//
// The numbers are READ, never kept: the parts/generations counts come off the runner's own report
// and the zoom off the canvas's view. A run bar with its own idea of what ran is a run bar that
// will one day disagree with the canvas, and the canvas is the thing people believe.
//
// Feature contract (computer/main.mjs's loader, `runbar` row):
//   install(app) -> void, publishing app.runbar = {render(), setRunning(state)}
// It renders into app.els.runbar and nothing else. Run all and Stop go through the HOST's own run
// door, so pressing them walks the shipped path and not a second implementation (§0.4/BG-3).

import { t } from '../core/i18n.mjs';
import { KV_KEYS } from '../core/types.mjs';
import { DEFAULT_MAX_ITEMS } from '../graph/runner.mjs';
import '../strings/computer.en.mjs';

/** The share of the cap past which the meter warns (§8.3: "turning amber past 80 %"). */
export const CAP_AMBER = 0.8;

/**
 * What the meter reads and whether it is warning. PURE, so the threshold is testable without a
 * canvas. @param {number} spent @param {number} cap
 * @returns {{text: string, amber: boolean}}
 */
export function capMeter(spent, cap) {
  const s = Math.max(0, Math.floor(Number(spent) || 0));
  const c = Math.max(1, Math.floor(Number(cap) || DEFAULT_MAX_ITEMS));
  return { text: `${s} / ${c}`, amber: s / c >= CAP_AMBER };
}

/** `{n} parts`, in the reader's own grammar. @param {number} n @returns {string} */
export function partsLabel(n) {
  // chat-lint rule 5: literal keys, never a key built from the count.
  return Number(n) === 1 ? t('computer.runPartsOne') : t('computer.runParts', { n: Number(n) || 0 });
}

/** `{n} generations`. @param {number} n @returns {string} */
export function generationsLabel(n) {
  return Number(n) === 1 ? t('computer.runGenerationsOne') : t('computer.runGenerations', { n: Number(n) || 0 });
}

/** @param {string} cls @param {string} text @param {HTMLElement} [parent] */
function chip(cls, text, parent) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

/** @param {string} cls @param {string} label @param {(() => void)} onClick */
function button(cls, label, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = cls;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

/** @param {any} app */
export function install(app) {
  const root = app && app.els ? app.els.runbar : null;
  if (!root) {
    app.runbar = { render: () => {}, setRunning: () => {} };
    return;
  }

  const host = () => app.host || null;
  const runner = () => {
    const h = host();
    return h && h.runner ? h.runner : null;
  };
  const canvas = () => {
    const h = host();
    return h && h.canvas ? h.canvas : null;
  };

  /**
   * The one door a run goes through. `host.start()` is the shipped one — it clears the cap banner,
   * re-arms a disabled sandbox and announces the outcome — and the debug door is the same
   * function under its frozen name. `runner.run()` is the floor: a host that has neither still
   * runs, it just says less. @returns {(opts?: any) => Promise<any>}
   */
  function runDoor() {
    const h = host();
    if (h && typeof h.start === 'function') return (o) => h.start(o || {});
    if (h && h.debug && typeof h.debug.run === 'function') return (o) => h.debug.run(o || {});
    const r = runner();
    if (r && typeof r.run === 'function') return (o) => r.run(o || {});
    return async () => null;
  }

  /** The generation cap for the NEXT run, as the runner will read it. */
  let cap = DEFAULT_MAX_ITEMS;

  // ---- the bar ---------------------------------------------------------------------------------
  const runBtn = button('comp-run-all', t('computer.runAll'), () => { runAll(); });
  const stopBtn = button('comp-run-stop', t('computer.runStop'), () => {
    const r = runner();
    if (r && typeof r.stop === 'function') r.stop();
  });
  stopBtn.classList.add('hidden');

  const counts = document.createElement('div');
  counts.className = 'comp-run-counts';
  const partsChip = chip('comp-run-parts', partsLabel(0), counts);
  const gensChip = chip('comp-run-gens', generationsLabel(0), counts);
  const capChip = chip('comp-run-cap', capMeter(0, cap).text, counts);

  const zoomBtn = button('comp-run-zoom', t('computer.runZoom', { percent: 100 }), () => {
    const c = canvas();
    if (c && typeof c.fit === 'function') c.fit();
    paint();
  });

  const helpBtn = document.createElement('button');
  helpBtn.type = 'button';
  helpBtn.className = 'comp-run-help';
  helpBtn.textContent = '?';
  helpBtn.setAttribute('aria-label', t('computer.runHelp'));
  helpBtn.title = t('computer.runHelp');
  // K5 owns the `?` card (§8.5). Until the tutorial exists there is nothing honest to show, and a
  // button that answers a question with silence is worse than one that says it cannot yet.
  helpBtn.disabled = true;
  helpBtn.addEventListener('click', () => {
    const tut = /** @type {any} */ (app).tutorial;
    if (tut && typeof tut.explain === 'function') tut.explain();
  });

  const status = document.createElement('p');
  status.className = 'comp-run-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  // Order matters: the status line reads left-to-right after the counts it explains, and the zoom
  // readout carries `margin-left:auto`, so everything after it is pinned to the right edge.
  root.replaceChildren(runBtn, stopBtn, counts, status, zoomBtn, helpBtn);

  // ---- painting --------------------------------------------------------------------------------
  /** The last finished run, when the runner remembers one. */
  function report() {
    const r = runner();
    return r && typeof r.report === 'function' ? r.report() : null;
  }

  function paint() {
    const r = runner();
    const running = !!(r && typeof r.running === 'function' && r.running());
    runBtn.classList.toggle('hidden', running);
    stopBtn.classList.toggle('hidden', !running);
    runBtn.disabled = !r;

    // Before the first run the bar counts what is ON the canvas; afterwards it reports what the
    // run actually did — which is the number a reader wants when six of nine boxes were cached.
    const last = report();
    const h = host();
    const doc = h && h.session && typeof h.session.doc === 'function' ? h.session.doc() : null;
    const parts = last ? Number(last.ran) || 0 : (doc && Array.isArray(doc.parts) ? doc.parts.length : 0);
    const gens = last ? Number(last.generations) || 0 : 0;
    partsChip.textContent = partsLabel(parts);
    gensChip.textContent = generationsLabel(gens);

    const meter = capMeter(gens, cap);
    capChip.textContent = meter.text;
    capChip.dataset.amber = meter.amber ? 'true' : 'false';

    const c = canvas();
    const view = c && typeof c.view === 'function' ? c.view() : null;
    const percent = Math.round((view && Number(view.zoom) ? view.zoom : 1) * 100);
    zoomBtn.textContent = t('computer.runZoom', { percent });

    helpBtn.disabled = !(/** @type {any} */ (app).tutorial);
  }

  /** @param {string} text */
  function say(text) { status.textContent = text; }

  async function runAll() {
    const r = runner();
    if (r && typeof r.running === 'function' && r.running()) return null;
    say('');
    const out = await runDoor()();
    paint();
    // The one sentence this bar owns: a Run that found every box up to date looks exactly like a
    // Run that did nothing, and the reader deserves to be told which it was (§1.2).
    if (out && !out.cancelled && !out.busy && !out.cycle && !out.ran && !(out.errors && out.errors.length)) {
      say(t('computer.runNothing'));
    }
    return out;
  }

  // ---- what makes it repaint -------------------------------------------------------------------
  const offs = [];
  const r0 = runner();
  if (r0 && typeof r0.on === 'function') offs.push(r0.on(() => paint()));
  const h0 = host();
  if (h0 && h0.session && typeof h0.session.on === 'function') offs.push(h0.session.on(() => paint()));

  // The cap lives in kv (the runner reads the same key), so the meter's denominator is the one the
  // next run will really enforce.
  const repo = app && app.repo;
  if (repo && typeof repo.kvGet === 'function') {
    Promise.resolve(repo.kvGet(KV_KEYS.prefComputeMaxItems, DEFAULT_MAX_ITEMS))
      .then((stored) => { if (Number(stored) > 0) { cap = Math.floor(Number(stored)); paint(); } })
      .catch(() => { /* the default is the runner's own default */ });
  }

  paint();

  app.runbar = {
    render: () => paint(),
    /** The host may tell the bar directly; it still reads the runner for everything else. */
    setRunning: () => paint(),
    runAll,
    say,
    destroy() { for (const off of offs) { try { off(); } catch (err) { void err; } } },
  };
}
