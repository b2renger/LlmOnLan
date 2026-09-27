// @ts-check
// The P2 landing's LOOK: the surfaces this phase added, photographed in both themes and checked by
// machine first (integrator-owned, written at the P2 landing; the P1 equivalent is p1-shots.mjs).
//
// What has to be IN the picture: the farm strip under the topline (P2-U1), the thread header with
// its title and System prompt control (P2-U3), the context meter in the composer row (P2-U2), the
// sidebar's date groups with a pinned chat above them (P2-U4), and the per-message action row that
// carries regenerate / edit / fork / delete (P2-U3).
//
// The assertions are the part that survives: a screenshot nobody looks at proves nothing, but
// "the strip is one line", "the meter is inside the composer row" and "nothing scrolls sideways"
// are checkable every run.

import fs from 'node:fs';
import path from 'node:path';

const requireReal = (/** @type {any} */ h) => h.eval(() => {
  const failed = (window.LolChat && window.LolChat.failed) || {};
  const want = ['view', 'controller', 'composer', 'sidebar', 'picker', 'strip', 'context', 'threadHeader', 'messageActions', 'settings'];
  const missing = want.filter((k) => failed[k]);
  if (missing.length) throw new Error('p2-shots needs the REAL modules, but the loader faked or dropped: ' + missing.join(', '));
  return true;
});

const pickModel = async (/** @type {any} */ h, /** @type {string} */ id) => {
  await h.waitFor((want) => {
    const s = /** @type {any} */ (document.getElementById('chat-model'));
    return s && Array.prototype.some.call(s.options, (o) => o.value === want) ? true : null;
  }, { args: [id], timeout: 20000 });
  await h.eval((want) => {
    const s = /** @type {any} */ (document.getElementById('chat-model'));
    s.value = want;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return s.value;
  }, id);
};

const waitSettled = (/** @type {any} */ h, /** @type {number} */ rows) => h.waitFor((want) => {
  const all = document.querySelectorAll('.chat-msg');
  if (all.length !== want) return null;
  const last = all[all.length - 1];
  if (last.getAttribute('data-status') !== 'done') return null;
  const stats = last.querySelector('.chat-stats');
  return stats && stats.textContent.trim() ? true : null;
}, { args: [rows], timeout: 45000 });

/** A chat worth photographing: two conversations, one of them pinned, and a draft in the composer. */
async function buildScene(/** @type {any} */ h) {
  await h.fresh();
  await requireReal(h);
  await h.waitFor(() => (window.__lolFarm ? true : null));

  // A first conversation, pinned, so the sidebar shows the Pinned group above the date groups.
  await pickModel(h, 'mock-echo');
  await h.submit('What can you do?');
  await waitSettled(h, 2);
  await h.eval(async () => {
    const app = window.LolChat.app;
    await app.repo.updateThread(app.state.threadId, { pinned: true });
    app.sidebar.render();
    return true;
  });

  // A second one with a reply worth reading, and a system prompt so the header shows its chip.
  await pickModel(h, 'mock-md');
  await h.submit('Show me the whole formatting range.');
  await waitSettled(h, 2);
  await h.eval(async () => {
    const app = window.LolChat.app;
    const id = app.state.threadId;
    await app.repo.updateThread(id, { systemOverride: 'You are a Blender assistant. Answer in French.' });
    // Re-select through the controller rather than emitting the event by hand: the listeners are
    // async (drafts reads the thread back before restoring it), so a hand-fired event lands AFTER
    // the typing below and silently wipes the draft out of the picture.
    await app.controller.selectThread(id);
    return true;
  });
  await h.waitFor(() => {
    const b = document.querySelector('#lolchat .chat-header-system');
    return b && /on/.test(b.textContent || '') ? true : null;
  }, { timeout: 8000 });

  // A draft in the composer, so the meter shows a real number rather than an empty estimate.
  await h.type('#chat-input', 'And now a follow-up question about bevels and their weights.');
  await h.waitFor(() => {
    const m = document.querySelector('#lolchat .chat-meter');
    return m && /\d/.test(m.textContent || '') ? true : null;
  }, { timeout: 8000 });

  // Hover state is not photographable, so make one row's actions permanent for the picture.
  await h.eval(() => {
    const rows = document.querySelectorAll('.chat-msg.assistant');
    const row = rows[rows.length - 1];
    const foot = row && row.querySelector('.chat-msg-foot');
    if (foot) /** @type {any} */ (foot).style.opacity = '1';
    if (row) row.scrollIntoView({ block: 'center' });
    return !!foot;
  });
  await new Promise((r) => setTimeout(r, 300));
}

const inspect = () => {
  const q = (/** @type {string} */ s) => document.querySelector(s);
  const cs = (/** @type {any} */ el) => (el ? getComputedStyle(el) : null);
  const rect = (/** @type {any} */ el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const strip = q('#lolchat .chat-strip');
  const meter = q('#lolchat .chat-meter');
  const header = q('#lolchat .chat-thread-header');
  return {
    theme: document.documentElement.className,
    bg: cs(q('#lolchat')).backgroundColor,
    stripText: strip ? strip.textContent.trim() : '',
    stripRect: rect(strip),
    stripColor: strip ? cs(strip).color : null,
    meterText: meter ? meter.textContent.trim() : '',
    meterRect: rect(meter),
    headerText: header ? header.textContent.trim() : '',
    headerRect: rect(header),
    groups: Array.prototype.map.call(document.querySelectorAll('#lolchat .chat-thread-group'), (g) => g.textContent.trim()),
    actions: document.querySelectorAll('.chat-msg.assistant .chat-msg-foot .chat-actions .chat-action').length,
    threads: document.querySelectorAll('#chat-threads .chat-thread').length,
    draft: /** @type {any} */ (q('#chat-input')).value,
    formRect: rect(q('#chat-form')),
    messagesRect: rect(q('#chat-messages')),
    docScrollX: document.documentElement.scrollWidth,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
  };
};

function check(/** @type {any} */ h, /** @type {any} */ m, /** @type {string} */ theme) {
  h.eq(m.theme, theme, 'the <html> class did not switch');
  // The strip: one ellipsised line, never a block that eats the conversation.
  h.assert(m.stripRect && m.stripRect.h > 0 && m.stripRect.h <= 34, `the farm strip is not one line (${JSON.stringify(m.stripRect)})`);
  h.assert(/seats/.test(m.stripText), `the strip does not read like a farm line: "${m.stripText}"`);
  h.assert(m.stripColor !== m.bg, 'the strip text is the page colour');
  // The meter: inside the composer row, with a number in it.
  h.assert(m.meterRect && m.meterRect.w > 40, `the meter did not render (${JSON.stringify(m.meterRect)})`);
  h.assert(/\d/.test(m.meterText), `the meter shows no estimate: "${m.meterText}"`);
  h.assert(m.draft.startsWith('And now a follow-up'), `the composer lost the draft the meter is measuring: "${m.draft}"`);
  h.assert(m.meterRect.y >= m.formRect.y - 1 && m.meterRect.y + m.meterRect.h <= m.formRect.y + m.formRect.h + 1,
    `the meter escaped the composer row (${JSON.stringify(m.meterRect)} vs ${JSON.stringify(m.formRect)})`);
  // The header: title + the System prompt control, on one line above the conversation.
  h.assert(m.headerRect && m.headerRect.h > 0 && m.headerRect.h <= 48, `the thread header is not a single row (${JSON.stringify(m.headerRect)})`);
  h.assert(/System/i.test(m.headerText), `the header has no system-prompt control: "${m.headerText}"`);
  // The sidebar: a Pinned group above the date groups.
  h.assert(m.groups.length >= 2, `the sidebar is not grouped (${JSON.stringify(m.groups)})`);
  h.eq(m.groups[0], 'Pinned', `the pinned chat is not first (${JSON.stringify(m.groups)})`);
  h.eq(m.threads, 2, `both chats should be listed (got ${m.threads})`);
  // The message actions.
  h.assert(m.actions >= 4, `the reply row shows only ${m.actions} actions`);
  // And the frozen layout still holds with all of it on screen.
  h.assert(m.docScrollX <= m.viewportW, `the page scrolls sideways (${m.docScrollX} > ${m.viewportW})`);
  h.assert(m.messagesRect.h > 200, `the message area collapsed to ${m.messagesRect.h} px`);
  h.assert(m.formRect.y + m.formRect.h <= m.viewportH + 1, 'the composer is not inside the viewport');
}

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
  const shot = await h.screenshot(name);
  h.assert(!!shot, `${name}: no screenshot was produced`);
  const size = fs.statSync(shot).size;
  h.assert(size > 4000, `${name}: the screenshot is only ${size} bytes — the window painted nothing`);
  h.note(`screenshot ${path.basename(shot)} (${size} bytes)`);
}

export default [
  {
    // The surfaces a reader only ever sees when the farm is busy: the waiting row (its sentence and
    // its two buttons) and the settings popover that every later phase adds a section to.
    name: 'p2-shots-waiting',
    needsMock: true,
    timeoutMs: 60000,
    allowConsoleErrors: [/Failed to load resource/, /net::ERR_/],
    run: async (h) => {
      await h.fresh({ refreshMs: 500 });
      await requireReal(h);
      await h.waitFor(() => (window.__lolFarm ? true : null));
      await h.mock.state({ capacity: { slots: 2, seatsUsed: 2 } });
      await h.waitFor(() => {
        const caps = window.LolChat.app.farm.get();
        return caps && caps.seats && caps.seats.used === 2 ? true : null;
      }, { timeout: 10000 });

      await h.submit('anyone free?');
      const m = await h.waitFor(() => {
        const row = document.querySelector('.chat-msg.assistant[data-status="waiting"]');
        const note = row && row.querySelector('.chat-msg-note');
        if (!note || !note.textContent.trim()) return null;
        const labels = Array.prototype.map.call(row.querySelectorAll('.chat-msg-foot .chat-action'), (b) => b.textContent.trim());
        const send = document.getElementById('chat-send');
        return { note: note.textContent.trim(), labels, sendLabel: send.textContent.trim(), sendHidden: send.classList.contains('hidden') };
      }, { timeout: 20000 });

      h.assert(/seats/.test(m.note), `the waiting row says nothing useful: "${m.note}"`);
      h.assert(m.labels.includes('Try now') && m.labels.includes('Cancel'), `the waiting row is missing its buttons (${JSON.stringify(m.labels)})`);
      h.note(`waiting row: "${m.note}" · actions ${JSON.stringify(m.labels)} · Send "${m.sendLabel}" hidden=${m.sendHidden}`);
      await shoot(h, 'p2-shots-waiting');

      // The settings popover: the gear in the sidebar foot, with every registered section in it.
      await h.click('#lolchat .chat-side-foot button');
      const sections = await h.waitFor(() => {
        const pop = document.querySelector('.chat-popover, [popover]:not([hidden])');
        if (!pop || !pop.textContent.trim()) return null;
        return pop.textContent.replace(/\s+/g, ' ').trim().slice(0, 300);
      }, { timeout: 8000 });
      h.assert(/Storage/i.test(sections), `the settings popover has no Storage section: "${sections}"`);
      h.note(`settings popover: "${sections}"`);
      await shoot(h, 'p2-shots-settings');

      await h.click('#chat-stop');
    },
  },
  {
    name: 'p2-shots-dark',
    needsMock: true,
    timeoutMs: 120000,
    run: async (h) => {
      await buildScene(h);
      await h.eval(() => { document.documentElement.className = 'dark'; return true; });
      const m = await h.eval(inspect);
      check(h, m, 'dark');
      h.note(`dark strip: "${m.stripText}" · meter: "${m.meterText}" · groups: ${JSON.stringify(m.groups)}`);
      await shoot(h, 'p2-shots-dark');
    },
  },
  {
    name: 'p2-shots-light',
    needsMock: true,
    timeoutMs: 120000,
    run: async (h) => {
      await buildScene(h);
      try {
        await h.eval(() => { document.documentElement.className = 'light'; return true; });
        const m = await h.eval(inspect);
        check(h, m, 'light');
        h.note(`light strip: "${m.stripText}" · meter: "${m.meterText}" · groups: ${JSON.stringify(m.groups)}`);
        await shoot(h, 'p2-shots-light');
      } finally {
        await h.eval(() => { document.documentElement.className = 'dark'; return true; });
      }
    },
  },
];
