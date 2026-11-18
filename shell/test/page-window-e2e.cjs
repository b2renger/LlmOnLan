// test/page-window-e2e.cjs - VIBE_PAGE_PLAN step 2 in the REAL app (main process, preload, both windows), driven over
// CDP: a dev client on a profile of its own (a temp --user-data-dir, so its data folder is there too, never a person's),
// its own CDP port, nothing sent to any farm (the answer is written into the store). It opens a page Side by side, pops
// it out, checks the window (the error's block and line, the page as wide as its box, no WebRTC in the guest, the window
// cannot be navigated away), types a fix there, checks the edit on the answer's record in the main window, closes the
// window and checks the page came back beside the chat. It stops the Electron it started.
//
//   npm run build && node test/page-window-e2e.cjs            (from shell/; ELECTRON_RUN_AS_NODE must be unset)
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const SHELL = path.join(__dirname, '..');
const SCRATCH = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lol-page-window-'));
const { connect, getJson, sleep } = require(path.join(SHELL, 'test', 'chat-harness', 'cdp.js'));
const PORT = 9351;

const HTML = '<!DOCTYPE html>\n<html><body>\n<h1 id="t">Hello</h1>\n<button id="b">Go</button>\n</body></html>';
const JS = "const b = document.getElementById('b');\nconsole.log('ready ' + innerWidth + ' rtc ' + typeof RTCPeerConnection + ' ' + typeof webkitRTCPeerConnection);\nnope();";
const ANSWER = `Here is a small page.\n\n\`\`\`html\n${HTML}\n\`\`\`\n\n\`\`\`css\nh1 { color: rgb(200, 0, 0); }\n\`\`\`\n\n\`\`\`js\n${JS}\n\`\`\`\n`;

async function evalIn(c, fn, ...args) {
  const r = await c.send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
async function until(c, fn, ms, ...args) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await evalIn(c, fn, ...args); if (last) return last; } catch (e) { last = String(e.message); }
    await sleep(200);
  }
  throw new Error('timed out; last: ' + JSON.stringify(last));
}

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const ud = path.join(SCRATCH, 'ud');
  fs.mkdirSync(ud, { recursive: true });
  const exe = path.join(SHELL, 'node_modules', 'electron', 'dist', 'electron.exe');
  const child = spawn(exe, [SHELL, `--user-data-dir=${ud}`, `--remote-debugging-port=${PORT}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(SCRATCH, 'electron.log'));
  child.stdout.pipe(log); child.stderr.pipe(log);
  const out = {};
  try {
    const main = await connect({ port: PORT, match: /renderer\/index\.html/ });
    await until(main, () => !!(window.LolChat && window.LolChat.ready && window.LolChat.app && window.LolChat.app.page), 30000);
    await evalIn(main, () => { document.getElementById('view-chat').click(); return true; });
    out.door = await evalIn(main, () => typeof window.lol.pageWindowOpen);
    const ids = await evalIn(main, async (answer) => {
      const app = window.LolChat.app;
      const th = app.repo.createThread({ title: 'A page' });
      app.repo.appendMessage(th.id, { role: 'user', content: 'a page', parts: [{ type: 'text', text: 'a page' }], status: 'done' });
      const msg = app.repo.appendMessage(th.id, { role: 'assistant', content: answer, parts: [{ type: 'text', text: answer }], status: 'done' });
      await app.repo.flush();
      await app.controller.selectThread(th.id);
      return { threadId: th.id, msgId: msg.id };
    }, ANSWER);
    await until(main, () => !!document.querySelector('.chat-page-beside'), 10000);
    await evalIn(main, () => { document.querySelector('.chat-page-beside').click(); return true; });
    const side = await until(main, () => { const d = window.LolChat.app.page.debug(); return d && d.errors.length ? d : null; }, 20000);
    out.sideError = side.errors[0];
    out.popOutShown = await evalIn(main, () => !document.querySelector('.chat-pagep-popout').hidden);
    await evalIn(main, () => { document.querySelector('.chat-pagep-popout').click(); return true; });
    out.sideAway = await until(main, () => { const d = window.LolChat.app.page.debug(); return d && d.popped && !d.running ? { popped: d.popped, running: d.running } : null; }, 10000);

    // The page window: a second page target.
    const pw = await connect({ port: PORT, match: /renderer\/page-window\.html/ });
    const first = await until(pw, () => { const d = window.__lolPage && window.__lolPage.debug(); return d && d.errors.length && d.lines ? d : null; }, 20000);
    out.windowError = first.errors[0];
    out.windowBlocks = first.blocks.map((b) => b.name);
    out.windowWidth = await evalIn(pw, () => ({ log: document.querySelector('.chat-pagep-console').textContent, box: document.querySelector('.chat-pagep-stage').clientWidth, door: typeof window.lol, popOut: !document.querySelector('.chat-pagep-popout') || document.querySelector('.chat-pagep-popout').hidden }));
    out.windowRtc = await evalIn(pw, () => typeof RTCPeerConnection);
    await evalIn(pw, () => { document.querySelector('.chat-pagep-goto').click(); return true; });
    await pw.send('Input.insertText', { text: "console.log('fixed in the window');" });
    const fixed = await until(pw, () => { const d = window.__lolPage.debug(); return d.runs > 1 && !d.errors.length && /fixed in the window/.test(document.querySelector('.chat-pagep-console').textContent) ? d : null; }, 20000);
    out.windowFixed = { runs: fixed.runs, edits: fixed.edits };
    await pw.send('Page.captureScreenshot', { format: 'png' }).then((r) => out.windowShot = r.data.length);
    // The edit reached the main window's store (through main).
    out.stored = await until(main, async (msgId, threadId) => {
      const stored = (await window.LolChat.app.repo.getMessages(threadId)).find((m) => m.id === msgId);
      const chip = document.querySelector('.chat-page-edited');
      return stored && stored.pageEdits && /fixed in the window/.test(stored.pageEdits.blocks['2'] || '') ? { blocks: stored.pageEdits.blocks, chip: chip && !chip.hidden } : null;
    }, 10000, ids.msgId, ids.threadId);
    // The guest cannot navigate the window away (the frame rule): try from the page itself.
    out.navigateBlocked = await evalIn(pw, async () => {
      try { window.location.href = 'https://example.com/'; } catch (e) { return 'threw ' + e.message; }
      await new Promise((r) => setTimeout(r, 800));
      return location.href;
    });
    // Type, and close the window AT ONCE (inside the editor's 250 ms and the save's 600 ms): the typing is not lost.
    await evalIn(pw, () => { const a = document.querySelector('.chat-pagep-editor:not([hidden]) textarea'); a.focus(); a.setSelectionRange(a.value.length, a.value.length); return true; });
    await pw.send('Input.insertText', { text: ' // typed just before closing' });
    const list = await getJson(`http://127.0.0.1:${PORT}/json`);
    const t = list.find((x) => /page-window\.html/.test(x.url));
    await main.send('Target.closeTarget', { targetId: t.id }).catch(() => getJson(`http://127.0.0.1:${PORT}/json/close/${t.id}`));
    // Closed: the side column brings the page back, with every edit made in the window.
    out.back = await until(main, () => { const d = window.LolChat.app.page.debug(); return d && !d.popped && d.runs >= 1 && !d.errors.length && /just before closing/.test(d.edits['2'] || '') ? { popped: d.popped, edits: d.edits } : null; }, 15000);
    out.lastStored = await until(main, async (msgId, threadId) => {
      const stored = (await window.LolChat.app.repo.getMessages(threadId)).find((m) => m.id === msgId);
      return stored && stored.pageEdits && /just before closing/.test(stored.pageEdits.blocks['2'] || '') ? true : null;
    }, 5000, ids.msgId, ids.threadId);
    await main.send('Page.captureScreenshot', { format: 'png' }).then((r) => out.mainShot = r.data.length);

    // A page main will not carry (a block's language over 32 characters): Pop out answers no, the panel runs it here.
    out.refusedDirect = await evalIn(main, () => window.lol.pageWindowOpen({ threadId: 'x1', msgId: 'y1', fences: [], pageIndex: 0 }));
    await evalIn(main, (threadId) => { window.LolChat.app.page.open({ threadId, msgId: 'zz1', fences: [{ lang: 'html', code: '<p>hi</p>' }, { lang: 'j'.repeat(40), code: '' }], pageIndex: 0 }); return true; }, ids.threadId);
    await until(main, () => { const d = window.LolChat.app.page.debug(); return d && d.target && d.target.msgId === 'zz1' && d.runs >= 1; }, 10000);
    await evalIn(main, () => { document.querySelector('.chat-pagep-popout').click(); return true; });
    out.refused = await until(main, () => {
      const d = window.LolChat.app.page.debug();
      const note = document.querySelector('.chat-pagep-note');
      return d && !d.popped && d.running && note && !note.hidden && /could not open/.test(note.textContent) ? { popped: d.popped, note: note.textContent } : null;
    }, 10000);
    out.noWindow = !(await getJson(`http://127.0.0.1:${PORT}/json`)).some((x) => /page-window\.html/.test(x.url));

    // p5 from a CDN, in the window: the sandbox's own copy loads there too (its CSP: connect-src 'self').
    const p5ids = await evalIn(main, async () => {
      const app = window.LolChat.app;
      const html = '<!DOCTYPE html>\n<html><head><script src="https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js"></script></head><body></body></html>';
      const js = "function setup() {\n  createCanvas(200, 120);\n  background(200, 0, 0);\n  console.log('p5 ' + typeof p5 + ' ' + width);\n}";
      const answer = 'A sketch.\n\n```html\n' + html + '\n```\n\n```js\n' + js + '\n```\n';
      const th = app.repo.createThread({ title: 'A sketch' });
      app.repo.appendMessage(th.id, { role: 'user', content: 'a sketch', parts: [{ type: 'text', text: 'a sketch' }], status: 'done' });
      const msg = app.repo.appendMessage(th.id, { role: 'assistant', content: answer, parts: [{ type: 'text', text: answer }], status: 'done' });
      await app.repo.flush();
      await app.controller.selectThread(th.id);
      return { threadId: th.id, msgId: msg.id };
    });
    await until(main, (msgId) => !!document.querySelector(`.chat-msg[data-id="${msgId}"] .chat-page-beside`), 10000, p5ids.msgId);
    await evalIn(main, (msgId) => { document.querySelector(`.chat-msg[data-id="${msgId}"] .chat-page-beside`).click(); return true; }, p5ids.msgId);
    await until(main, () => { const d = window.LolChat.app.page.debug(); return d && d.lines ? d : null; }, 20000);
    await evalIn(main, () => { document.querySelector('.chat-pagep-popout').click(); return true; });
    const pw2 = await connect({ port: PORT, match: /renderer\/page-window\.html/ });
    out.p5 = await until(pw2, () => {
      const d = window.__lolPage && window.__lolPage.debug();
      const log = document.querySelector('.chat-pagep-console').textContent || '';
      return d && /p5 function 200/.test(log) ? { log, errors: d.errors.length, note: document.querySelector('.chat-pagep-note').textContent } : null;
    }, 20000);

    out.ok = !!(out.sideError && out.windowError && out.windowError.at && out.windowError.at.line === 3 && out.stored && out.stored.chip
      && out.back && !out.back.popped && out.lastStored && /rtc undefined undefined/.test(out.windowWidth.log) && /page-window\.html$/.test(out.navigateBlocked)
      && out.refusedDirect && out.refusedDirect.ok === false && out.refused && out.noWindow && out.p5 && out.p5.errors === 0);
  } catch (e) {
    out.error = String(e && e.stack || e);
  } finally {
    console.log(JSON.stringify(out, null, 1));
    try { child.kill(); } catch { /* gone */ }
    await sleep(1500);
    try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* Electron may still hold a file a moment */ }
    process.exit(out.ok ? 0 : 1);
  }
})();
