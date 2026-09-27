// @ts-check
// The Record switch (COMPUTER_PLAN addendum KG): the debug log's three buttons, at the right-hand
// end of the run bar.
//
//   … 100%  ?   [● Record log]              ← off
//   … 100%  ?   [● Recording · 214 events] [⚑ Mark bug] [folder]    ← on
//
// The recorder itself is computer/devlog.mjs, installed before anything else loads; this file only
// draws its switch. On a shell with no debug-log door (an older binary, or the harness without the
// compiled main output) the whole group is HIDDEN — a missing door is a hidden button, never a dead
// one.
//
// Feature contract (computer/main.mjs's loader, `recorder` row, AFTER `runbar`):
//   install(app) -> void, publishing app.recorder = {el, debug: {status(), events()}}

import { t } from '../core/i18n.mjs';
import { devlog } from './devlog.mjs';
import '../strings/computer.en.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A Lucide-style folder icon, built node by node (no markup strings in the chat tree). */
function folderIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '14'], ['height', '14'], ['fill', 'none'], ['stroke', 'currentColor'],
    ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z');
  svg.appendChild(path);
  return svg;
}

/** @param {string} cls */
function button(cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  return b;
}

/** @param {any} app */
export function install(app) {
  const rec = devlog();
  const bar = app && app.els && app.els.runbar;
  if (!rec || !bar) return;

  const group = document.createElement('div');
  group.className = 'comp-rec';

  const toggle = button('comp-rec-toggle');
  const dot = document.createElement('span');
  dot.className = 'comp-rec-dot';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'comp-rec-label';
  toggle.append(dot, label);

  const markBtn = button('comp-rec-mark');
  markBtn.textContent = `⚑ ${t('computer.recMark')}`;
  markBtn.title = t('computer.recMarkHint');

  const folderBtn = button('comp-rec-folder');
  folderBtn.appendChild(folderIcon());
  folderBtn.setAttribute('aria-label', t('computer.recFolder'));
  folderBtn.title = t('computer.recFolderHint');

  group.append(toggle, markBtn, folderBtn);
  bar.appendChild(group);

  const toast = (/** @type {string} */ text, /** @type {string} */ kind = 'info') => {
    if (app.dialogs && typeof app.dialogs.toast === 'function') app.dialogs.toast(text, { kind });
  };

  let busy = false;
  let wasRecording = false;

  /** @param {any} s */
  function paint(s) {
    group.classList.toggle('hidden', !s.available);
    const on = !!s.recording;
    toggle.classList.toggle('is-on', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    toggle.disabled = busy || !!s.starting;
    label.textContent = s.starting ? t('computer.recStarting') : (on ? t('computer.recOn', { n: s.events }) : t('computer.recOff'));
    toggle.title = on ? t('computer.recOnHint', { name: s.name || '' }) : t('computer.recOffHint');
    markBtn.classList.toggle('hidden', !on);
    folderBtn.classList.toggle('hidden', !on && !s.lastStop);
    // A recording that stopped by itself (the size limit) says so once.
    if (wasRecording && !on && s.lastStop && s.lastStop.why === 'full') toast(t('computer.recFull', { name: s.lastStop.name }), 'error');
    wasRecording = on;
  }

  toggle.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    paint(rec.status());
    try {
      if (rec.status().recording) {
        // The toast says what HAPPENED: a stop main refused, or lines that never reached the file,
        // are not "saved".
        const res = await rec.stop('switch');
        if (res && res.ok === false) toast(t('computer.recStopFailed', { message: res.message || '?' }), 'error');
        else if (res && res.failures) toast(t('computer.recSavedPartial', { name: res.name, n: res.failures }), 'error');
        else if (res && res.name) toast(t('computer.recSaved', { name: res.name }));
      } else {
        const res = await rec.start('switch');
        if (res && res.ok) toast(t('computer.recStarted', { name: res.name }));
        else toast(t('computer.recFailed', { message: (res && res.message) || '?' }), 'error');
      }
    } finally {
      busy = false;
      paint(rec.status());
    }
  });

  markBtn.addEventListener('click', async () => {
    if (markBtn.disabled || !rec.status().recording) return;
    markBtn.disabled = true;
    try {
      // The screenshot and the state FIRST, so they show the bug and not the question about it.
      const taken = await rec.shot();
      /** @type {string|null} */ let note = '';
      if (app.dialogs && typeof app.dialogs.prompt === 'function') {
        note = await app.dialogs.prompt({
          title: t('computer.recMarkTitle'),
          body: t('computer.recMarkBody'),
          placeholder: t('computer.recMarkPlaceholder'),
          ok: t('computer.recMarkOk'),
          value: '',
        });
      }
      // Cancel means "no marker after all": one short line explains the screenshot on disk.
      if (note === null) {
        await rec.mark({ cancelled: true, png: taken && taken.png });
        return;
      }
      const res = await rec.mark({ note, png: taken && taken.png, snap: taken && taken.snap });
      if (res && res.ok) toast(t('computer.recMarked', { i: res.i }));
      else if (res) toast(t('computer.recMarkFailed'), 'error');
    } finally {
      markBtn.disabled = false;
    }
  });

  folderBtn.addEventListener('click', () => { void rec.reveal(); });

  rec.on(paint);
  paint(rec.status());

  /** @type {any} */ (app).recorder = {
    el: group,
    debug: { status: () => rec.status(), events: () => rec.events() },
  };
}
