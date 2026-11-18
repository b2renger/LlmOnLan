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
    // Close the window: the side column brings the page back, with the window's edit.
    const list = await getJson(`http://127.0.0.1:${PORT}/json`);
    const t = list.find((x) => /page-window\.html/.test(x.url));
    await main.send('Target.closeTarget', { targetId: t.id }).catch(() => getJson(`http://127.0.0.1:${PORT}/json/close/${t.id}`));
    out.back = await until(main, () => { const d = window.LolChat.app.page.debug(); return d && !d.popped && d.runs >= 1 && !d.errors.length && d.edits['2'] ? { popped: d.popped, edits: d.edits } : null; }, 15000);
    await main.send('Page.captureScreenshot', { format: 'png' }).then((r) => out.mainShot = r.data.length);
    out.ok = !!(out.sideError && out.windowError && out.windowError.at && out.windowError.at.line === 3 && out.stored && out.stored.chip
      && out.back && !out.back.popped && /rtc undefined undefined/.test(out.windowWidth.log) && /page-window\.html$/.test(out.navigateBlocked));
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
