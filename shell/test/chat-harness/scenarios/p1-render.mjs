// @ts-check
// P1-U3 in a real browser: render/thread-view.mjs + render/stream-dom.mjs + render/code.mjs.
//
// The unit tests (chat/unit/streamdom.test.mjs) already prove the DIFF equals the one-shot render
// on the DOM shim. Only these scenarios can prove the parts a shim cannot: that a real Chromium
// parses the produced tree the way we think it does (the XSS corpus really is inert), that a real
// anchor click reaches the main process's window-open handler, that a real `details` element keeps
// its `open` state and a real Selection survives a farm refresh, that the SVG preview's data: URL
// is allowed by the production CSP, and that the stick-to-bottom IntersectionObserver behaves.
//
// The stream arrives through whichever controller the loader gave us (real once P1-U2 lands, the
// fake before that): both drive `view.beginStream(id).paint(content, reasoning)`, which is the
// contract this unit is written against. The VIEW, though, must be the real one — a faked view
// would make every assertion below meaningless, so each scenario says so out loud.

/** Fail loudly if the loader faked a module this scenario is actually testing. */
const requireReal = (/** @type {any} */ h, /** @type {string[]} */ keys) =>
  h.eval((ks) => {
    const failed = (window.LolChat && window.LolChat.failed) || {};
    const missing = ks.filter((k) => failed[k]);
    if (missing.length) {
      throw new Error(`P1-U3 needs the REAL modules, but the loader faked: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    return true;
  }, keys);

/** Pick a model the way a user does (the picker owns the <select>, fake or real). */
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
  await h.waitFor((want) => (/** @type {any} */ (document.getElementById('chat-model')).value === want ? true : null), { args: [id] });
};

/** Send a message on `model` and wait for the finished assistant row. */
const streamOne = async (/** @type {any} */ h, /** @type {string} */ model, /** @type {string} */ text) => {
  await pickModel(h, model);
  await h.submit(text || 'render this');
  return h.waitReply({ timeout: 45000 });
};

export default [
  // -------------------------------------------------------------------------------- p1-markdown
  {
    name: 'p1-markdown',
    needsMock: true,
    timeoutMs: 90000,
    // The whole restricted grammar, streamed in 1-12 char chunks by mock-md, must land in the DOM
    // EXACTLY as the one-shot renderer would have produced it — the same equality the unit test
    // proves on the shim, now re-proved against a real Chromium and the real code chrome.
    run: async (h) => {
      await requireReal(h, ['view']);
      const clipboard = await h.spy.clipboard();

      // A fresh chat shows the empty state and nothing else (view.showPath with an empty path).
      const before = await h.eval(() => ({
        emptyHidden: document.getElementById('chat-empty').classList.contains('hidden'),
        rows: document.querySelectorAll('.chat-msg').length,
      }));
      h.eq(before.rows, 0, 'a fresh chat has no rows');
      h.eq(before.emptyHidden, false, 'so the empty state is what you see');

      const reply = await streamOne(h, 'mock-md', 'stream the markdown fixture');
      h.assert(reply.text.includes('Streaming fixture'), 'the fixture arrived');

      const cmp = await h.eval(async () => {
        const app = window.LolChat.app;
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const row = rows[rows.length - 1];
        const id = row.getAttribute('data-id');
        const path = await app.repo.getPath(app.state.threadId);
        const msg = path.find((m) => m.id === id);
        const oneShot = app.view.debug.renderOneShot(msg.content);
        const body = row.querySelector('.chat-body');
        return {
          content: msg.content.length,
          streamed: body.innerHTML,
          oneShot: oneShot.innerHTML,
          same: body.innerHTML === oneShot.innerHTML,
          headings: body.querySelectorAll('h1,h2,h3,h4').length,
          lists: body.querySelectorAll('ul,ol').length,
          items: body.querySelectorAll('li').length,
          tasks: body.querySelectorAll('input.chat-task').length,
          tables: body.querySelectorAll('table.chat-table').length,
          tableCells: body.querySelectorAll('tbody tr td').length,
          quotes: body.querySelectorAll('blockquote').length,
          rules: body.querySelectorAll('hr').length,
          fences: body.querySelectorAll('figure.chat-codeblock').length,
          heads: body.querySelectorAll('figure.chat-codeblock .chat-code-head').length,
          langs: Array.prototype.map.call(body.querySelectorAll('.chat-code-lang'), (e) => e.textContent),
          copyButtons: body.querySelectorAll('.chat-code-copy').length,
          closed: Array.prototype.map.call(body.querySelectorAll('figure.chat-codeblock'), (f) => f.getAttribute('data-closed')),
          nestedFence: body.querySelectorAll('li figure.chat-codeblock').length,
        };
      });

      if (!cmp.same) {
        // Show WHERE they diverge — an equality failure on a 3 kB string is otherwise unreadable.
        let i = 0;
        while (i < cmp.streamed.length && cmp.streamed[i] === cmp.oneShot[i]) i++;
        throw new Error(`the streamed body differs from renderOneShot at char ${i}:\n  streamed: …${cmp.streamed.slice(Math.max(0, i - 60), i + 90)}\n  one-shot: …${cmp.oneShot.slice(Math.max(0, i - 60), i + 90)}`);
      }

      h.assert(cmp.headings >= 4, `every heading level rendered (${cmp.headings})`);
      h.assert(cmp.lists >= 3, `bullet, nested and ordered lists (${cmp.lists})`);
      h.assert(cmp.tasks === 2, `both task checkboxes (${cmp.tasks})`);
      h.eq(cmp.tables, 1, 'the table rendered as a table');
      h.eq(cmp.tableCells, 6, 'with all six body cells');
      h.assert(cmp.quotes >= 2, `the blockquote and its nested quote (${cmp.quotes})`);
      h.eq(cmp.rules, 1, 'the thematic break');
      h.eq(cmp.fences, 4, 'four fenced blocks: two python, one svg, and one js INSIDE a list item');
      h.eq(cmp.heads, cmp.fences, 'every closed fence got its chrome header');
      h.eq(cmp.copyButtons, cmp.fences, 'and its Copy button');
      h.eq(cmp.langs.slice().sort(), ['js', 'python', 'python', 'svg'], 'the language labels are read off the info string');
      h.assert(cmp.nestedFence === 1, 'the fence in a list item stayed in its <li>');
      h.assert(cmp.closed.every((c) => c === '1'), 'every fence is closed at the end of the stream');

      // Copy must hand the clipboard the EXACT code, not the rendered text of the whole figure.
      const want = await h.eval(() => {
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const fig = rows[rows.length - 1].querySelector('figure.chat-codeblock');
        return fig.querySelector('pre code').textContent;
      });
      await h.eval(() => {
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        rows[rows.length - 1].querySelector('.chat-code-copy').click();
        return true;
      });
      const copied = await h.waitFor(() => (window.__spyClipboard && window.__spyClipboard.length ? window.__spyClipboard : null));
      h.eq(copied.length, 1, 'exactly one clipboard write');
      h.eq(copied[0], want, 'the clipboard got the fence content verbatim');
      h.assert(want.includes('import bpy'), 'and that content is the python snippet');
      await clipboard.clear();

      // The row's own MESSAGE_ACTION, the accessibility state, and the one announcement §3.4 asks
      // for. All three are things a reader depends on and no unit test can see.
      const finished = await h.eval(() => {
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const row = rows[rows.length - 1];
        const btn = row.querySelector('.chat-actions .chat-action[data-action="copy-message"]');
        if (!btn) throw new Error('the "Copy message" action is not on the row');
        btn.click();
        return {
          label: btn.getAttribute('aria-label'),
          busy: row.getAttribute('aria-busy'),
          status: row.getAttribute('data-status'),
          live: document.querySelector('.chat-live').textContent,
          statsHidden: row.querySelector('.chat-stats').classList.contains('hidden'),
        };
      });
      h.eq(finished.label, 'Copy message', 'the action names itself for a screen reader');
      h.eq(finished.busy, null, 'aria-busy is cleared once the reply lands');
      h.eq(finished.status, 'done', 'and the row reports itself done');
      h.eq(finished.live, 'Reply finished', 'the live region announced the end exactly once');
      h.eq(finished.statsHidden, false, 'the stats row is shown for a finished reply');
      const msgCopy = await h.waitFor(() => (window.__spyClipboard && window.__spyClipboard.length ? window.__spyClipboard : null));
      h.eq(msgCopy.length, 1, 'one clipboard write for the message copy');
      h.assert(msgCopy[0].length === cmp.content, `the whole message was copied (${msgCopy[0].length} of ${cmp.content} chars)`);
      await clipboard.clear();

      // css/thread.css and css/markdown.css are @imported by chat.css; a sheet that failed to load
      // or whose selectors never match is invisible to every assertion above, so check one rule
      // out of each that only this unit's files can produce.
      const styled = await h.eval(() => {
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const row = rows[rows.length - 1];
        const fig = row.querySelector('figure.chat-codeblock');
        const det = row.querySelector('details.chat-reasoning');
        return {
          emptyHidden: document.getElementById('chat-empty').classList.contains('hidden'),
          figureRadius: getComputedStyle(fig).borderTopLeftRadius,
          headDisplay: getComputedStyle(fig.querySelector('.chat-code-head')).display,
          reasoningWrap: det ? getComputedStyle(det.querySelector('.chat-reasoning-body')).whiteSpace : null,
          rowVisibility: getComputedStyle(row).contentVisibility,
          tableCollapse: getComputedStyle(row.querySelector('table.chat-table')).borderCollapse,
        };
      });
      h.eq(styled.emptyHidden, true, 'the empty state went away once a message arrived');
      h.assert(styled.figureRadius !== '0px', `markdown.css is applied (figure radius ${styled.figureRadius})`);
      h.eq(styled.headDisplay, 'flex', 'the code header bar is laid out by markdown.css');
      h.eq(styled.tableCollapse, 'collapse', 'and so is the table');
      h.eq(styled.rowVisibility, 'auto', 'thread.css gives every row content-visibility:auto (the 500-row budget)');
      if (styled.reasoningWrap !== null) h.eq(styled.reasoningWrap, 'pre-wrap', 'reasoning keeps its own line breaks');

      h.note(`${cmp.content} chars · ${cmp.fences} fences · ${cmp.items} list items · streamed DOM === one-shot DOM`);
    },
  },

  // ------------------------------------------------------------------------------------- p1-xss
  {
    name: 'p1-xss',
    needsMock: true,
    timeoutMs: 90000,
    // The corpus, streamed into a REAL document. The shim cannot execute anything, so only this
    // run can prove the corpus is inert: no script ran, no element outside the allow list exists,
    // no event-handler attribute survived, and nothing tried to open a window.
    run: async (h) => {
      await requireReal(h, ['view']);
      const opensBefore = h.windowOpens().length;
      const reply = await streamOne(h, 'mock-xss', 'stream the xss corpus');
      h.assert(reply.text.includes('XSS corpus'), 'the corpus arrived');

      const audit = await h.eval(() => {
        const ALLOWED_TAGS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
          'PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'STRONG', 'EM', 'DEL', 'A',
          'HR', 'BR', 'INPUT', 'SUP', 'SUB', 'KBD', 'DETAILS', 'SUMMARY', 'IMG', 'SPAN', 'FIGURE',
          'FIGCAPTION', 'BUTTON'];
        // The code chrome (render/code.mjs) adds its own nodes around a fence; they are OURS, not
        // the model's, so they are listed explicitly rather than silently tolerated.
        const CHROME_TAGS = ['DIV'];
        const ALLOWED_ATTRS = ['href', 'target', 'rel', 'type', 'checked', 'disabled', 'align',
          'start', 'class', 'src'];
        const CHROME_ATTRS = ['aria-pressed', 'aria-label', 'aria-hidden', 'title', 'hidden'];
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const body = rows[rows.length - 1].querySelector('.chat-body');
        const all = Array.prototype.slice.call(body.querySelectorAll('*'));
        const badTags = [];
        const badAttrs = [];
        const handlers = [];
        for (const el of all) {
          if (!ALLOWED_TAGS.includes(el.tagName) && !CHROME_TAGS.includes(el.tagName)) badTags.push(el.tagName);
          for (const a of Array.prototype.slice.call(el.attributes)) {
            if (/^on/i.test(a.name)) handlers.push(`${el.tagName}[${a.name}]`);
            else if (!ALLOWED_ATTRS.includes(a.name) && !CHROME_ATTRS.includes(a.name) && !a.name.startsWith('data-')) {
              badAttrs.push(`${el.tagName}[${a.name}]`);
            }
          }
        }
        const anchors = Array.prototype.slice.call(body.querySelectorAll('a'));
        return {
          nodes: all.length,
          badTags, badAttrs, handlers,
          pwned: typeof window.__pwned,
          scripts: body.querySelectorAll('script').length + document.querySelectorAll('#lolchat script').length,
          iframes: body.querySelectorAll('iframe').length,
          anchors: anchors.length,
          hrefs: anchors.map((a) => a.getAttribute('href')),
          rels: anchors.map((a) => a.getAttribute('rel')),
          targets: anchors.map((a) => a.getAttribute('target')),
          imgs: Array.prototype.map.call(body.querySelectorAll('img'), (i) => (i.getAttribute('src') || '').slice(0, 24)),
          escaped: body.textContent.includes('<script>window.__pwned = 1</script>'),
        };
      });

      h.assert(audit.nodes > 60, `the corpus produced a real tree (${audit.nodes} elements)`);
      h.eq(audit.badTags, [], 'every element is inside ALLOWED_TAGS (plus our own chrome div)');
      h.eq(audit.badAttrs, [], 'every attribute is inside ALLOWED_ATTRS');
      h.eq(audit.handlers, [], 'no event-handler attribute survived');
      h.eq(audit.pwned, 'undefined', 'nothing in the corpus executed');
      h.eq(audit.scripts, 0, 'no script element exists');
      h.eq(audit.iframes, 0, 'no iframe element exists');
      h.assert(audit.escaped, 'the raw HTML is escaped TEXT, not markup');
      h.assert(audit.anchors >= 3, `the safe links survived (${audit.anchors})`);
      for (const href of audit.hrefs) h.assert(/^https?:\/\//i.test(href), `anchor with a non-http href: ${href}`);
      for (const rel of audit.rels) h.assert(rel.includes('noopener') && rel.includes('noreferrer'), `rel is ${rel}`);
      for (const tgt of audit.targets) h.eq(tgt, '_blank', 'links open out of the app, never in it');
      // The corpus's only svg fence carries onload AND a foreignObject: dom.mjs refuses to draw it.
      h.eq(audit.imgs, [], 'the hostile svg fence produced no <img>');

      h.eq(h.windowOpens().length, opensBefore, 'nothing in the corpus tried to open a window');
      h.note(`${audit.nodes} elements, ${audit.anchors} anchors, 0 handlers, __pwned ${audit.pwned}`);
    },
  },

  // ----------------------------------------------------------------------------------- p1-links
  {
    name: 'p1-links',
    needsMock: true,
    timeoutMs: 90000,
    // A link in a model's answer must leave the app, and only http(s) may be a link at all
    // (plan §1.2 / DISCUSS D-C8: the main process drops every other scheme, so rendering one as an
    // anchor would produce a dead click).
    run: async (h) => {
      await requireReal(h, ['view']);
      const before = h.windowOpens().length;
      await streamOne(h, 'mock-md', 'stream the markdown fixture');

      const links = await h.eval(() => {
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const body = rows[rows.length - 1].querySelector('.chat-body');
        const anchors = Array.prototype.slice.call(body.querySelectorAll('a'));
        return {
          hrefs: anchors.map((a) => a.getAttribute('href')),
          text: body.textContent,
        };
      });
      h.assert(links.hrefs.includes('https://example.com/docs'), `the https link became an anchor: ${JSON.stringify(links.hrefs)}`);
      h.assert(!links.hrefs.some((x) => /^mailto:/i.test(x)), 'no mailto anchor');
      h.assert(links.text.includes('mailto:someone@example.com'), 'the mail address is still there, as plain text');

      await h.eval(() => {
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const a = rows[rows.length - 1].querySelector('.chat-body a[href="https://example.com/docs"]');
        if (!a) throw new Error('the https link is not in the DOM');
        a.click();
        return true;
      });

      // The main process writes window-opens.json; give it a beat to land.
      let opened = h.windowOpens().slice(before);
      for (let i = 0; i < 30 && !opened.length; i++) { await h.sleep(100); opened = h.windowOpens().slice(before); }
      h.eq(opened.length, 1, 'exactly one window-open request');
      h.eq(opened[0].url, 'https://example.com/docs', 'and it carried the link');
      h.eq(opened[0].action, 'external', 'recorded as "would open externally"');
      h.eq(await h.eval(() => location.href.indexOf('page.html') >= 0), true, 'the chat itself did not navigate');
      h.note(`${links.hrefs.length} anchors, mailto stayed text, click → ${opened[0].action}`);
    },
  },

  // ----------------------------------------------------------------------------- p1-svg-preview
  {
    name: 'p1-svg-preview',
    needsMock: true,
    timeoutMs: 90000,
    // The svg fence of stream.md: Code is the default tab, Preview swaps in an <img> built from a
    // data: URL we encode ourselves. Under the production CSP (`img-src 'self' data:`), so a
    // policy change that broke it would fail here rather than in a user's window.
    run: async (h) => {
      await requireReal(h, ['view', 'code']);
      await streamOne(h, 'mock-md', 'stream the markdown fixture');

      const before = await h.eval(() => {
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const fig = rows[rows.length - 1].querySelector('figure.chat-codeblock[data-lang="svg"]');
        if (!fig) throw new Error('no svg fence in the answer');
        fig.setAttribute('data-probe', 'svg');
        const tabs = Array.prototype.map.call(fig.querySelectorAll('.chat-code-tab'), (b) => b.textContent);
        const pane = fig.querySelector('.chat-svg-preview');
        return {
          tabs,
          paneHidden: pane ? pane.hidden : null,
          preHidden: fig.querySelector('pre').hidden,
          imgs: fig.querySelectorAll('img').length,
          codeVisible: fig.querySelector('pre code').textContent.indexOf('<svg') >= 0,
        };
      });
      h.eq(before.tabs, ['Preview', 'Code'], 'both tabs are offered');
      h.eq(before.paneHidden, true, 'the preview starts hidden');
      h.eq(before.preHidden, false, 'and the code is what you see first');
      h.assert(before.codeVisible, 'the fence text is the svg source');

      const after = await h.eval(() => {
        const fig = document.querySelector('figure.chat-codeblock[data-probe="svg"]');
        const tab = Array.prototype.find.call(fig.querySelectorAll('.chat-code-tab'), (b) => b.dataset.tab === 'preview');
        tab.click();
        const img = fig.querySelector('.chat-svg-preview img');
        return {
          paneHidden: fig.querySelector('.chat-svg-preview').hidden,
          preHidden: fig.querySelector('pre').hidden,
          src: img ? img.getAttribute('src').slice(0, 40) : null,
          pressed: tab.getAttribute('aria-pressed'),
        };
      });
      h.eq(after.paneHidden, false, 'Preview shows the pane');
      h.eq(after.preHidden, true, 'and hides the code');
      h.eq(after.pressed, 'true', 'the tab reports itself pressed');
      h.assert(after.src && after.src.startsWith('data:image/svg+xml'), `the image is a self-encoded data URL: ${after.src}`);

      // The real proof that the CSP allowed it: the browser actually decoded the picture.
      const drawn = await h.waitFor(() => {
        const img = /** @type {any} */ (document.querySelector('figure[data-probe="svg"] .chat-svg-preview img'));
        if (!img) return null;
        return img.complete ? { w: img.naturalWidth, h: img.naturalHeight } : null;
      }, { timeout: 10000 });
      h.assert(drawn.w > 0 && drawn.h > 0, `the svg really rendered (${drawn.w}x${drawn.h})`);

      const back = await h.eval(() => {
        const fig = document.querySelector('figure.chat-codeblock[data-probe="svg"]');
        Array.prototype.find.call(fig.querySelectorAll('.chat-code-tab'), (b) => b.dataset.tab === 'code').click();
        return { paneHidden: fig.querySelector('.chat-svg-preview').hidden, preHidden: fig.querySelector('pre').hidden };
      });
      h.eq(back.paneHidden, true, 'Code hides the preview again');
      h.eq(back.preHidden, false, 'and brings the source back');
      h.note(`svg preview ${drawn.w}x${drawn.h}, tabs round-trip`);
    },
  },

  // ------------------------------------------------------------------------------- p1-reasoning
  {
    name: 'p1-reasoning',
    needsMock: false,
    timeoutMs: 90000,
    // The reasoning block's whole lifecycle, driven through `view.beginStream()` directly rather
    // than through a model. That is deliberate: a show:false BrowserWindow produces no compositor
    // frames and MEASURED on Electron 42.5.1 that drops requestAnimationFrame to ~1 Hz as soon as
    // the page mutates the DOM, so a real stream's "thinking" phase is over before the first frame
    // runs and the live state is simply unobservable here (it IS observable under --show, and in
    // production, where rAF is 60 Hz). Feeding the view one paint per step sidesteps the cadence
    // entirely and still exercises the exact code path the controller drives.
    run: async (h) => {
      await requireReal(h, ['view']);

      const start = await h.eval(() => {
        const app = window.LolChat.app;
        const th = app.repo.createThread();                       // SYNC (plan 3.4)
        const msg = app.repo.appendMessage(th.id, { role: 'assistant', status: 'streaming' });
        app.view.upsert(msg);
        window.__rs = { msg, stream: app.view.beginStream(msg.id) };
        window.__rs.stream.paint('', 'weighing the options');
        return { id: msg.id };
      });
      h.assert(start.id, 'the row exists');

      // --- thinking: the block opens itself and the summary counts up
      const thinking = await h.waitFor(() => {
        const det = /** @type {any} */ (document.querySelector('.chat-msg.assistant details.chat-reasoning'));
        if (!det) return null;
        const text = det.querySelector('summary').textContent;
        return /^Thinking… \d+s$/.test(text) ? { text, open: det.open } : null;
      }, { timeout: 20000 });
      h.eq(thinking.open, true, 'the block opens itself while the model thinks');

      // --- one text node, grown with appendData, and never markdown
      const grown = await h.eval(async () => {
        const body = document.querySelector('.chat-reasoning-body');
        body.firstChild.__node = 'first';                         // an expando the renderer never writes
        const raw = '# not a heading\n\n**not bold** and ```not a fence```\n<script>x</script>';
        window.__rs.stream.paint('', 'weighing the options' + raw);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return {
          childNodes: body.childNodes.length,
          elements: body.querySelectorAll('*').length,
          identity: body.firstChild.__node || null,
          text: body.textContent,
          raw,
        };
      });
      h.eq(grown.childNodes, 1, 'the reasoning body is ONE node');
      h.eq(grown.elements, 0, 'reasoning is plain text: no markdown was parsed');
      h.eq(grown.identity, 'first', 'and that node was grown with appendData, not replaced');
      h.assert(grown.text.endsWith(grown.raw), 'the markdown is there verbatim, as text');

      // --- the answer starts: the block folds away on its own
      await h.eval(() => {
        window.__rs.stream.paint('Here is the answer.', document.querySelector('.chat-reasoning-body').textContent);
        return true;
      });
      const settled = await h.waitFor(() => {
        const det = /** @type {any} */ (document.querySelector('.chat-msg.assistant details.chat-reasoning'));
        const text = det.querySelector('summary').textContent;
        return /^Thought for \d+s$/.test(text)
          ? { text, open: det.open, body: det.parentNode.querySelector('.chat-body').textContent }
          : null;
      }, { timeout: 20000 });
      h.eq(settled.open, false, 'it auto-collapses once the answer starts');
      h.eq(settled.body, 'Here is the answer.', 'and the answer itself rendered');

      // --- end(): the settled summary, the stats row and the announcement
      const ended = await h.eval(() => {
        const app = window.LolChat.app;
        const m = window.__rs.msg;
        m.status = 'done';
        m.content = 'Here is the answer.';
        m.reasoning = document.querySelector('.chat-reasoning-body').textContent;
        m.reasoningMs = 4200;
        m.stats = { completionTokens: 12, ttftMs: 30, tokPerSec: 190.2, text: '12 tok · 190.2 tok/s · first token 0.03s' };
        window.__rs.stream.end(m);
        const row = app.view.rowOf(m.id);
        return {
          summary: row.querySelector('details.chat-reasoning summary').textContent,
          status: row.getAttribute('data-status'),
          busy: row.getAttribute('aria-busy'),
          stats: row.querySelector('.chat-stats').textContent,
          live: document.querySelector('.chat-live').textContent,
        };
      });
      h.eq(ended.summary, 'Thought for 4s', 'end() reports the reasoningMs the message carries');
      h.eq(ended.status, 'done');
      h.eq(ended.busy, null, 'aria-busy is cleared');
      h.eq(ended.stats, '12 tok · 190.2 tok/s · first token 0.03s', 'the stats line is rendered verbatim');
      h.eq(ended.live, 'Reply finished', 'and the end was announced');

      // --- a block the READER opened is never folded away underneath them
      const kept = await h.eval(async () => {
        const app = window.LolChat.app;
        const th = app.repo.createThread();
        const msg = app.repo.appendMessage(th.id, { role: 'assistant', status: 'streaming' });
        app.view.upsert(msg);
        const stream = app.view.beginStream(msg.id);
        stream.paint('', 'thinking hard');
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const row = app.view.rowOf(msg.id);
        const det = row.querySelector('details.chat-reasoning');
        det.querySelector('summary').click();          // the reader closes it ...
        det.querySelector('summary').click();          // ... and opens it again: a deliberate choice
        const openedByUser = det.open;
        stream.paint('The answer begins.', 'thinking hard');
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { openedByUser, stillOpen: det.open, summary: det.querySelector('summary').textContent };
      });
      h.eq(kept.openedByUser, true, 'the reader really had it open');
      h.eq(kept.stillOpen, true, 'and the answer starting did NOT fold it away');
      h.assert(/^Thought for \d+s$/.test(kept.summary), `the summary still settled: ${JSON.stringify(kept.summary)}`);

      h.note('thinking -> grown by appendData (1 text node, 0 elements) -> auto-collapse -> end(); a reader-opened block stays open');
    },
  },

  // ---------------------------------------------------------------------- p1-refresh-stability
  {
    name: 'p1-refresh-stability',
    needsMock: true,
    timeoutMs: 120000,
    // §3.8's hardest promise: the thread view NEVER subscribes to the farm, so the 4-second
    // discovery refresh (500 ms here, twelve times over) cannot move a scroll position, close an
    // open reasoning block, drop a text selection or replace a row node. This is the scenario that
    // would catch a well-meaning `showPath()` on FARM_CHANGE.
    run: async (h) => {
      await requireReal(h, ['view']);
      await h.fresh({ refreshMs: 500 });
      await requireReal(h, ['view']);
      // `assistant` streams 100 reasoning deltas and 1000 content deltas: long enough to scroll.
      const reply = await streamOne(h, 'assistant', 'give me something long to look at');
      h.assert(reply.reasoning, 'the reply has a reasoning block to open');

      const set = await h.eval(() => {
        const list = /** @type {any} */ (document.getElementById('chat-messages'));
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const row = rows[rows.length - 1];
        row.__identity = 'kept';                       // an expando no renderer code ever writes
        const det = /** @type {any} */ (row.querySelector('details.chat-reasoning'));
        if (!det) throw new Error('no reasoning block');
        if (!det.open) det.querySelector('summary').click();   // a USER opening it (userToggled)
        // scroll to the middle and select a run of text inside the answer
        list.scrollTop = Math.floor((list.scrollHeight - list.clientHeight) / 2);
        const body = row.querySelector('.chat-body');
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        const node = walker.nextNode();
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, Math.min(40, node.length));
        const sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return {
          scrollTop: list.scrollTop,
          scrollable: list.scrollHeight - list.clientHeight,
          open: det.open,
          summary: det.querySelector('summary').textContent,
          selection: String(sel),
          rows: document.querySelectorAll('.chat-msg').length,
        };
      });
      h.assert(set.scrollable > 200, `the thread is really scrollable (${set.scrollable} px)`);
      h.assert(set.scrollTop > 20, `and we are in the middle of it (${set.scrollTop})`);
      h.eq(set.open, true, 'the reasoning block is open');
      h.assert(/^Thought for \d+s$/.test(set.summary), `the settled summary reports the thinking time: ${JSON.stringify(set.summary)}`);
      h.assert(set.selection.length > 5, `there is a selection to lose (${JSON.stringify(set.selection)})`);

      // 6 s of farm churn: capacity, busy and usage all moving, twelve refreshes at 500 ms.
      const until = Date.now() + 6000;
      let n = 0;
      while (Date.now() < until) {
        n++;
        await h.setFarm({
          capacity: { slots: 2, clients: 1 + (n % 3), seatsUsed: n % 3, seatIdleSec: 900 },
          usage: { gpuUtil: (n * 7) % 100 },
          busy: n % 2 ? { label: 'Switching model', percent: (n * 11) % 100 } : null,
        });
        await h.sleep(450);
      }
      h.assert(n >= 8, `the farm really churned (${n} updates)`);

      const after = await h.eval(() => {
        const list = /** @type {any} */ (document.getElementById('chat-messages'));
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const row = rows[rows.length - 1];
        const det = /** @type {any} */ (row.querySelector('details.chat-reasoning'));
        return {
          scrollTop: list.scrollTop,
          open: det ? det.open : null,
          summary: det ? det.querySelector('summary').textContent : null,
          selection: String(document.getSelection()),
          identity: row.__identity || null,
          rows: document.querySelectorAll('.chat-msg').length,
        };
      });
      h.assert(Math.abs(after.scrollTop - set.scrollTop) <= 2,
        `the scroll position moved by ${after.scrollTop - set.scrollTop} px (±2 allowed)`);
      h.eq(after.open, true, 'the reasoning block is still open');
      h.eq(after.summary, set.summary, 'and its summary did not restart counting');
      h.eq(after.selection, set.selection, 'the selection is unchanged');
      h.eq(after.identity, 'kept', 'the row node was never replaced');
      h.eq(after.rows, set.rows, 'and no row appeared or vanished');
      h.note(`${n} farm updates over 6 s: scrollTop ${set.scrollTop}→${after.scrollTop}, details open, selection kept, node identity kept`);
    },
  },

  // ---------------------------------------------------------------------------- p1-stick-bottom
  {
    name: 'p1-stick-bottom',
    needsMock: true,
    timeoutMs: 120000,
    // Stick-to-bottom, the three states of §3.8: stuck (the view follows the stream), released (a
    // wheel-up while reading stops the chase and raises "Jump to latest"), and re-stuck (the pill
    // puts you back at the bottom and the stream resumes pulling the view down).
    run: async (h) => {
      await requireReal(h, ['view']);
      // ~165 deltas/s instead of ~400: the reply overflows the box after a couple of seconds and
      // then keeps running for several more, so there is a live stream to read over.
      await h.mock.state({ streamRate: { tickMs: 30, perTick: 5 } });
      await pickModel(h, 'assistant');
      await h.submit('stream slowly enough to read');

      // --- stuck: the view follows the stream on its own
      const stuck = await h.waitFor(() => {
        const list = /** @type {any} */ (document.getElementById('chat-messages'));
        const row = document.querySelector('.chat-msg.assistant[data-status="streaming"]');
        if (!row) return null;
        const body = row.querySelector('.chat-body');
        const scrollable = list.scrollHeight - list.clientHeight;
        // Wait for the answer to OVERFLOW the box: below that there is nothing to stick to.
        // `<= 200`, not `< 200`: `contain-intrinsic-size: auto 200px` makes EXACTLY 200 px a
        // plateau the poll lands on, and the assertion below asks for more than 200 (P2 landing).
        if (!body || scrollable <= 200) return null;
        return {
          stuckNow: window.LolChat.app.view.isStuck(),
          gap: scrollable - list.scrollTop,
          scrollable,
          chars: body.textContent.length,
        };
      }, { timeout: 45000 });
      h.eq(stuck.stuckNow, true, 'the view starts stuck to the bottom');
      h.assert(stuck.scrollable > 200, `the stream already overflows the box (${stuck.scrollable} px)`);
      h.assert(stuck.gap <= 4, `and the view is pinned to the end of it (gap ${stuck.gap} px)`);

      // --- released: a wheel up is the reader saying "wait, I am reading"
      const released = await h.eval(() => {
        const list = /** @type {any} */ (document.getElementById('chat-messages'));
        list.dispatchEvent(new WheelEvent('wheel', { deltaY: -160, bubbles: true, cancelable: true }));
        list.scrollTop = 0;                       // the scroll a real wheel would have produced
        return { stuckNow: window.LolChat.app.view.isStuck(), scrollTop: list.scrollTop };
      });
      h.eq(released.stuckNow, false, 'wheel-up releases the view');

      const pill = await h.waitFor(() => {
        const j = /** @type {any} */ (document.querySelector('.chat-jump'));
        if (!j || j.classList.contains('hidden')) return null;
        const list = /** @type {any} */ (document.getElementById('chat-messages'));
        return { visible: true, scrollTop: list.scrollTop, gap: list.scrollHeight - list.clientHeight - list.scrollTop };
      }, { timeout: 15000 });
      h.assert(pill.gap > 20, `the view really stayed where the reader left it (${pill.gap} px from the end)`);

      // It must STAY put while the stream keeps growing underneath.
      const before = pill.scrollTop;
      await h.sleep(900);
      const held = await h.eval(() => {
        const list = /** @type {any} */ (document.getElementById('chat-messages'));
        return { scrollTop: list.scrollTop, stuckNow: window.LolChat.app.view.isStuck(), streaming: !!document.querySelector('.chat-msg[data-status="streaming"]') };
      });
      h.eq(held.stuckNow, false, 'still released');
      h.eq(held.scrollTop, before, 'and the stream did not drag the view down');
      h.assert(held.streaming, 'the stream is genuinely still running');

      // --- re-stuck: the pill puts the reader back at the end
      await h.click('.chat-jump');
      const back = await h.waitFor(() => {
        const list = /** @type {any} */ (document.getElementById('chat-messages'));
        const j = /** @type {any} */ (document.querySelector('.chat-jump'));
        const gap = list.scrollHeight - list.clientHeight - list.scrollTop;
        if (gap > 4) return null;
        return { gap, stuckNow: window.LolChat.app.view.isStuck(), hidden: j.classList.contains('hidden') };
      }, { timeout: 10000 });
      h.eq(back.stuckNow, true, 'the pill re-sticks the view');
      h.assert(back.gap <= 4, `and scrolls it to the bottom (gap ${back.gap} px)`);
      await h.waitFor(() => (document.querySelector('.chat-jump').classList.contains('hidden') ? true : null), { timeout: 10000 });

      // --- the THIRD unstick of §3.8: PageUp with the focus where it really is (the composer).
      // The listener used to sit on #chat-messages, which has no tabindex and is never the active
      // element, so this path did nothing at all.
      const byKey = await h.eval(() => {
        /** @type {any} */ (document.getElementById('chat-input')).focus();
        const list = /** @type {any} */ (document.getElementById('chat-messages'));
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true }));
        list.scrollTop = Math.max(0, list.scrollTop - 400);     // the scroll the key would produce
        return { stuckNow: window.LolChat.app.view.isStuck(), focus: document.activeElement.id, scrollTop: list.scrollTop };
      });
      h.eq(byKey.focus, 'chat-input', 'focus is in the composer, as it is after every generate');
      h.eq(byKey.stuckNow, false, 'PageUp from the composer releases the view too');
      // The claim is "it stays released WHILE THE STREAM RUNS ON", so every sample has to carry
      // proof the stream was still running — thread-view.mjs legitimately re-sticks once the last
      // row settles at the bottom, and a single read after a fixed sleep raced that. Sample the
      // whole window instead of reading its end: strictly stronger, and not a coin toss.
      let afterKey = null;
      for (let i = 0; i < 7; i += 1) {
        await h.sleep(100);
        const s = await h.eval(() => {
          const list = /** @type {any} */ (document.getElementById('chat-messages'));
          const j = /** @type {any} */ (document.querySelector('.chat-jump'));
          return {
            scrollTop: list.scrollTop,
            stuckNow: window.LolChat.app.view.isStuck(),
            pill: !j.classList.contains('hidden'),
            streaming: !!document.querySelector('.chat-msg[data-status="streaming"]'),
          };
        });
        if (!s.streaming) break;               // the stream ended; the claim no longer applies
        afterKey = s;
        h.eq(s.stuckNow, false, 'and it stays released while the stream runs on');
        h.eq(s.scrollTop, byKey.scrollTop, 'the stream did not drag the view back down');
      }
      h.assert(afterKey, 'the stream was still running after the key released the view');
      h.assert(afterKey.pill, 'the jump pill is offered again after the key released the view');

      // Leave the box tidy: stop the stream rather than letting the next fresh() cut the socket.
      await h.click('#chat-stop');
      await h.waitFor(() => (document.querySelector('.chat-msg[data-status="streaming"]') ? null : true), { timeout: 20000 });
      h.note(`stuck → wheel-up released (gap ${pill.gap} px, held ${held.scrollTop}) → jump re-stuck (gap ${back.gap} px)`);
    },
    allowConsoleErrors: [/Failed to load resource/, /net::ERR_(ABORTED|FAILED|CONNECTION_RESET)/],
  },
    {
        // REGRESSION (P1 fix round): `.chat-stats` is a PRESENCE signal, not a class toggle, and a
        // user turn is painted exactly once.
        //
        // shell/test/e2e.js is frozen byte-identical (§2.5) and reads "the reply finished" as
        // `!!last.querySelector('.chat-stats')`, then parses that node's text. A row that carries
        // an always-present empty `.chat-stats` therefore broke every e2e run one second into the
        // stream ("stats line malformed:"), deterministically — and no gate saw it, because the
        // harness's own waitReply also requires non-empty TEXT. This scenario asserts e2e.js's
        // weaker contract from inside the harness, where it can actually run.
        name: 'p1-stats-presence',
        needsMock: true,
        timeoutMs: 60000,
        run: async (h) => {
            await h.submit('hello there');

            // While it streams there must be NO .chat-stats node at all (e2e.js's poll runs at 1 Hz).
            const during = await h.waitFor(() => {
                const row = [...document.querySelectorAll('.chat-msg.assistant')].pop();
                if (!row || row.getAttribute('data-status') !== 'streaming') return null;
                return { stats: !!row.querySelector('.chat-stats'), note: !!row.querySelector('.chat-msg-note') };
            }, { timeout: 20000 });
            h.eq(during.stats, false, 'a streaming row must not carry a .chat-stats node (e2e.js reads existence)');
            h.eq(during.note, false, 'nor an empty .chat-msg-note');

            const reply = await h.waitReply();
            h.assert(/tok\/s/.test(reply.stats), `the finished row has real stats: ${JSON.stringify(reply.stats)}`);

            // The e2e.js predicate, verbatim: presence alone must imply a parsable stats line.
            const e2e = await h.eval(() => {
                const rows = [...document.querySelectorAll('.chat-msg.assistant')];
                const last = rows[rows.length - 1];
                const stats = last.querySelector('.chat-stats');
                return { done: !!stats, stats: stats ? stats.textContent : null };
            });
            h.eq(e2e.done, true, 'e2e.js sees the stats node');
            h.assert(/tok\/s/.test(e2e.stats || ''), `e2e.js would parse it: ${JSON.stringify(e2e.stats)}`);

            // ...and the user turn is on screen ONCE (parts are the user surface, §3.5; painting
            // `content` into `.chat-body` as well printed every message twice).
            const user = await h.eval(() => {
                const row = [...document.querySelectorAll('.chat-msg.user')].pop();
                return {
                    text: (row.innerText || row.textContent || ''),
                    parts: (row.querySelector('.chat-msg-parts') || { textContent: '' }).textContent.trim(),
                    body: (row.querySelector('.chat-body') || { textContent: '' }).textContent.trim(),
                };
            });
            h.eq(user.parts, 'hello there', 'the user text is in .chat-msg-parts');
            h.eq(user.body, '', 'and NOT a second time in .chat-body');
            h.eq(user.text.split('hello there').length - 1, 1, `the sentence appears exactly once: ${JSON.stringify(user.text)}`);
            h.note(`streaming row has no .chat-stats; finished row reads "${reply.stats}"; the user turn is painted once`);
        },
    },

    {
        // REGRESSION (P1 fix round): switching threads while a reply streams used to freeze it.
        //
        // showPath() removed and FORGOT every row not in the new path, but the stream handle
        // beginStream() returned closes over that row object: it went on painting a detached node,
        // and coming back rebuilt a fresh row from the store's checkpoint — 'streaming' forever,
        // no stats, nothing to refresh it. v0.1.45 re-rendered the active thread from the model in
        // its finally block and never had this.
        name: 'p1-switch-midstream',
        needsMock: true,
        timeoutMs: 120000,
        run: async (h) => {
            // thread A: a finished chat to come back to
            await h.submit('the first chat');
            await h.waitReply();
            const a = await h.eval(() => window.LolChat.app.state.threadId);

            // thread B: a long stream on mock-slow (3 s TTFT, then 20 tok/s)
            await h.eval((v) => {
                const nb = document.getElementById('chat-new');
                if (nb) nb.click();
                const sel = /** @type {any} */ (document.getElementById('chat-model'));
                sel.value = 'mock-slow';
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                const input = /** @type {any} */ (document.getElementById('chat-input'));
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
                if (setter && setter.set) setter.set.call(input, v); else input.value = v;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                /** @type {any} */ (document.getElementById('chat-form')).requestSubmit();
                return true;
            }, 'stream for a while please');
            const b = await h.eval(() => window.LolChat.app.state.threadId);
            h.assert(b && b !== a, 'the slow reply is in its own thread');

            const first = await h.waitFor(() => {
                const row = document.querySelector('.chat-msg[data-status="streaming"]');
                const body = row && row.querySelector('.chat-body');
                return body && body.textContent.length > 20 ? body.textContent.length : null;
            }, { timeout: 30000 });

            // --- walk away mid-stream
            await h.eval((id) => { /** @type {any} */ (document.querySelector(`.chat-thread[data-id="${id}"]`)).click(); return true; }, a);
            await h.waitFor((id) => (window.LolChat.app.state.threadId === id ? true : null), { args: [a], timeout: 15000 });
            // THREAD_SELECTED is emitted before showPath has read the path, so wait for the DOM.
            const away = await h.waitFor(() => {
                const text = [...document.querySelectorAll('.chat-msg')].map((m) => m.textContent).join(' | ');
                return text.includes('the first chat') ? text : null;
            }, { timeout: 15000 });
            h.assert(!away.includes('stream for a while please'), 'and the slow thread is off screen');
            await h.sleep(1200);

            // --- and come back: the SAME reply must still be growing, not a frozen checkpoint
            await h.eval((id) => { /** @type {any} */ (document.querySelector(`.chat-thread[data-id="${id}"]`)).click(); return true; }, b);
            await h.waitFor((id) => (window.LolChat.app.state.threadId === id ? true : null), { args: [b], timeout: 15000 });
            const grew = await h.waitFor((was) => {
                const row = document.querySelector('.chat-msg[data-status="streaming"]');
                const body = row && row.querySelector('.chat-body');
                return body && body.textContent.length > was + 10 ? body.textContent.length : null;
            }, { args: [first], timeout: 30000 });
            h.assert(grew > first, `the reply kept painting across the switch (${first} → ${grew} chars)`);

            // --- and it finishes properly, with stats
            await h.click('#chat-stop');
            const done = await h.waitFor(() => {
                const row = [...document.querySelectorAll('.chat-msg.assistant')].pop();
                const st = row && row.getAttribute('data-status');
                if (!row || st === 'streaming') return null;
                const stats = row.querySelector('.chat-stats');
                return { status: st, stats: stats ? stats.textContent : null, rows: document.querySelectorAll('.chat-msg').length };
            }, { timeout: 30000 });
            h.assert(done.status === 'aborted' || done.status === 'done', `the row settled (${done.status}), it did not stay 'streaming'`);
            h.assert(done.stats && /tok\/s/.test(done.stats), `and it carries stats: ${JSON.stringify(done.stats)}`);
            h.eq(done.rows, 2, 'exactly the user turn and its reply are on screen');
            h.note(`switched away mid-stream and back: ${first} → ${grew} chars, settled ${done.status} with "${done.stats}"`);
        },
        allowConsoleErrors: [/Failed to load resource/, /net::ERR_(ABORTED|FAILED|CONNECTION_RESET)/],
    },

    {
        // REGRESSION (P1 fix round): a model chosen with NO thread selected must not be written
        // onto the next thread the reader happens to open.
        //
        // §3.10 says the held pick "rides on the draft and is applied to the thread created by that
        // send". The picker used to apply it on the next THREAD_SELECTED of any kind, and a cold
        // boot with history selects nothing — so one click in the sidebar pinned an OLD chat to a
        // model it never used (`modelSource:'user'`, which rule 1 then honours forever).
        name: 'p1-held-pick',
        needsMock: true,
        timeoutMs: 90000,
        run: async (h) => {
            await h.submit('an old conversation');
            await h.waitReply();
            const old = await h.eval(() => window.LolChat.app.state.threadId);
            const before = await h.eval((id) => window.LolChat.app.repo.getThread(id).then((th) => ({ model: th.model || null, source: th.modelSource || null })), old);

            // deselect everything, then pick a model with no thread open
            await h.eval(() => window.LolChat.app.controller.selectThread(null));
            await h.waitFor(() => (window.LolChat.app.state.threadId === null ? true : null), { timeout: 10000 });
            await h.eval(() => {
                const sel = /** @type {any} */ (document.getElementById('chat-model'));
                sel.value = 'mock-usage-none';
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return sel.value;
            });

            // open the OLD chat: it must come back untouched
            await h.eval((id) => { /** @type {any} */ (document.querySelector(`.chat-thread[data-id="${id}"]`)).click(); return true; }, old);
            await h.waitFor((id) => (window.LolChat.app.state.threadId === id ? true : null), { args: [old], timeout: 15000 });
            await h.sleep(400);
            const after = await h.eval((id) => window.LolChat.app.repo.getThread(id).then((th) => ({ model: th.model || null, source: th.modelSource || null })), old);
            h.eq(after.source, before.source, 'opening an old chat did not pin it to the held pick');
            h.eq(after.model, before.model, 'and did not rewrite its model');

            // The other half (fix round 2): the record was clean, but the PICKER still showed the
            // held pick for that thread and `composer.getDraft()` sent it — the turn went to a
            // model the thread record knew nothing about. The pick only rides on the DRAFT.
            h.eq(await h.eval(() => document.getElementById('chat-model').value), 'assistant',
                'the reopened thread shows the farm default, not the held pick');
            const since = Date.now();
            await h.submit('a second turn in the old chat');
            await h.waitReply();
            const posts = (await h.mock.log({ path: '/v1/chat/completions', since })).filter((e) => e.method === 'POST');
            h.eq(posts.length, 1, 'one completion for that turn');
            h.eq(posts[0].model, 'assistant', 'and it went to the farm default, not the held pick');

            // a NEW chat, though, is exactly what a held pick IS about (pick again: opening a
            // stored chat ended the draft the first one belonged to)
            await h.eval(() => window.LolChat.app.controller.selectThread(null));
            await h.waitFor(() => (window.LolChat.app.state.threadId === null ? true : null), { timeout: 10000 });
            await h.eval(() => {
                const sel = /** @type {any} */ (document.getElementById('chat-model'));
                sel.value = 'mock-usage-none';
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return sel.value;
            });
            await h.eval(() => { /** @type {any} */ (document.getElementById('chat-new')).click(); return true; });
            await h.sleep(400);
            const fresh = await h.eval(() => window.LolChat.app.repo.getThread(window.LolChat.app.state.threadId).then((th) => ({ id: th.id, model: th.model || null, source: th.modelSource || null })));
            h.assert(fresh.id !== old, 'a brand new thread');
            h.eq(fresh.model, 'mock-usage-none', 'the held pick landed on the thread the send creates');
            h.eq(fresh.source, 'user', 'and it counts as the reader’s own choice');
            h.note(`held pick left ${old} at ${JSON.stringify(after)} and landed on the new thread instead`);
        },
    },
];
