// @ts-check
import fs from 'node:fs';
import path from 'node:path';

// The P0 landing's LOOK-AT-IT scenario (integrator-owned).
//
// P0 ships no feature UI, but it does ship the skeleton (§3.5) and its grid (css/base.css), and a
// broken grid would be inherited by every later unit. This scenario asserts the geometry that a
// screenshot review would otherwise have to catch by eye — sidebar on the left at its declared
// width, composer pinned to the bottom, messages taking the slack, nothing overflowing the
// viewport, the empty-state visible — in BOTH themes, and writes the two screenshots the landing
// step 3 looks at:
//   node shell/test/chat-harness/run.js --only p0-skeleton-dark,p0-skeleton-light
// Since the P1 landing a hidden window paints too (run.js keeps a CDP screencast open as a frame
// consumer), the images no longer need `--show`; the tolerant branch in shoot() below stays as
// the safety net for an environment where that frame pump is unavailable.
/**
 * Take the landing screenshot. A missing or tiny PNG is a FAILURE under `--show` — without this the
 * scenario passed identically whether or not an image was ever written, and the landing's "both PNGs
 * written and looked at" claim rested on nothing. A hidden run tolerates a null (see above), which
 * is why P1 has its own `p1-shots-{dark,light}` that demands the image unconditionally.
 */
async function shoot(h, name) {
    const shot = await h.screenshot(name);
    if (!h.show) {
        h.assert(shot === null || fs.statSync(shot).size > 1000, `${name}: a screenshot was written but is empty`);
        return;
    }
    h.assert(!!shot, `${name}: --show was given but no screenshot was produced`);
    const size = fs.statSync(shot).size;
    h.assert(size > 1000, `${name}: the screenshot is only ${size} bytes`);
    h.note(`screenshot ${path.basename(shot)} (${size} bytes)`);
}

/** Measure the skeleton in the current theme. Runs in the page. */
const measure = () => {
    const out = {};
    const one = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
            bg: cs.backgroundColor, color: cs.color, display: cs.display,
        };
    };
    for (const [key, sel] of Object.entries({
        chat: '#lolchat', side: '#lolchat .chat-side', newBtn: '#chat-new', list: '#chat-threads',
        main: '#lolchat .chat-main', topline: '#lolchat .chat-topline', model: '#chat-model',
        messages: '#chat-messages', empty: '#chat-empty', form: '#chat-form', input: '#chat-input',
        send: '#chat-send', stop: '#chat-stop', live: '#lolchat .chat-live',
    })) out[key] = one(sel);
    out.viewport = { w: window.innerWidth, h: window.innerHeight };
    out.theme = document.documentElement.className;
    out.docScroll = { x: document.documentElement.scrollWidth, y: document.documentElement.scrollHeight };
    out.fallback = !!document.querySelector('#lolchat .chat-fallback');
    out.emptyText = (document.querySelector('#chat-empty') || {}).textContent || '';
    out.sendText = (document.querySelector('#chat-send') || {}).textContent || '';
    return out;
};

/** The assertions that must hold in either theme. */
function checkLayout(h, m, theme) {
    h.assert(!m.fallback, 'the fallback <p> is still in #lolchat — buildLayout did not run');
    for (const key of ['chat', 'side', 'newBtn', 'list', 'main', 'topline', 'model', 'messages', 'empty', 'form', 'input', 'send', 'live']) {
        h.assert(m[key], `missing skeleton element: ${key}`);
    }
    h.assert(m.stop && m.stop.display === 'none', '#chat-stop must start hidden');
    h.assert(m.live.w <= 1 && m.live.h <= 1, '.chat-live must be visually hidden');

    // the grid: 240 px sidebar on the left, main column to its right, both full height
    h.eq(m.side.x, 0, `${theme}: sidebar is not at the left edge`);
    h.eq(m.side.w, 240, `${theme}: sidebar width`);
    h.eq(m.main.x, 240, `${theme}: main column does not start where the sidebar ends`);
    h.assert(Math.abs(m.side.h - m.viewport.h) <= 1, `${theme}: sidebar height ${m.side.h} != viewport ${m.viewport.h}`);
    h.assert(m.main.w + m.main.x <= m.viewport.w + 1, `${theme}: main column overflows the viewport`);

    // the column: topline on top, composer at the bottom, messages taking the slack
    h.assert(m.topline.y < m.messages.y, `${theme}: topline is not above the messages`);
    h.assert(Math.abs((m.form.y + m.form.h) - m.viewport.h) <= 1,
        `${theme}: composer bottom ${m.form.y + m.form.h} is not the viewport bottom ${m.viewport.h}`);
    h.assert(m.messages.y + m.messages.h <= m.form.y + 1, `${theme}: messages overlap the composer`);
    // The empty state sits over the MESSAGES box, not over a pair of hard-coded insets: it must
    // never reach into the composer or the topline, however tall either of them grows.
    h.assert(Math.abs(m.empty.y - m.messages.y) <= 1 && Math.abs(m.empty.h - m.messages.h) <= 1,
        `${theme}: #chat-empty ${JSON.stringify(m.empty)} does not track #chat-messages ${JSON.stringify(m.messages)}`);
    h.assert(m.empty.y + m.empty.h <= m.form.y + 1, `${theme}: the empty state crosses into the composer`);
    h.assert(m.empty.y >= m.topline.y + m.topline.h - 1, `${theme}: the empty state reaches into the topline`);
    h.assert(m.messages.h > 100, `${theme}: messages pane is only ${m.messages.h} px tall`);
    h.assert(m.input.h >= 30 && m.send.h >= 28, `${theme}: composer controls collapsed`);
    h.assert(m.send.x + m.send.w <= m.form.x + m.form.w + 1, `${theme}: send button overflows the composer`);

    // no page-level scrollbars: every pane scrolls on its own
    h.assert(m.docScroll.x <= m.viewport.w, `${theme}: the document scrolls horizontally (${m.docScroll.x} > ${m.viewport.w})`);
    h.assert(m.docScroll.y <= m.viewport.h + 1, `${theme}: the document scrolls vertically`);

    // strings, not keys (a missing i18n entry renders as "core.send")
    h.assert(!/^core\./.test(m.sendText.trim()), `${theme}: send button shows the raw key "${m.sendText}"`);
    h.assert(m.emptyText.trim().length > 10 && !/core\./.test(m.emptyText), `${theme}: empty state shows raw keys`);
}

/** Colours must actually come from the theme: the two themes cannot paint the same. */
function checkTheme(h, m, want) {
    h.eq(m.theme, want, 'the <html> class did not switch');
    h.assert(m.chat.bg && m.chat.bg !== 'rgba(0, 0, 0, 0)', 'the chat has no background colour');
    h.assert(m.side.bg !== m.chat.bg, 'the sidebar surface does not stand out from the background');
}

const setTheme = (name) => {
    document.documentElement.className = name;
    return document.documentElement.className;
};

export default [
    {
        name: 'p0-skeleton-dark',
        run: async (h) => {
            await h.eval(setTheme, 'dark');
            const m = await h.eval(measure);
            checkLayout(h, m, 'dark');
            checkTheme(h, m, 'dark');
            h.note(`dark: bg ${m.chat.bg}, side ${m.side.bg}, text ${m.chat.color}`);

            // …and it still holds when later phases make the chrome taller: a banner and a strip
            // above the messages, a composer grown to its 200 px textarea plus a tray.
            const grown = await h.eval(() => {
                const q = (s) => document.querySelector(s);
                q('#lolchat .chat-banner').textContent = 'a store banner, as P1-U4 writes it';
                q('#lolchat .chat-strip').textContent = 'a P2 strip';
                q('#lolchat .chat-composer-tray').textContent = 'a chip';
                q('#chat-input').style.height = '200px';
                return true;
            });
            h.assert(grown, 'could not grow the chrome');
            const tall = await h.eval(measure);
            h.assert(tall.form.h > m.form.h + 100, `the composer did not actually grow (${tall.form.h})`);
            checkLayout(h, tall, 'dark (tall chrome)');
            await h.eval(() => {
                const q = (s) => document.querySelector(s);
                q('#lolchat .chat-banner').textContent = '';
                q('#lolchat .chat-strip').textContent = '';
                q('#lolchat .chat-composer-tray').textContent = '';
                q('#chat-input').style.height = '';
            });

            await shoot(h, 'p0-skeleton-dark');
        },
    },
    {
        name: 'p0-skeleton-light',
        run: async (h) => {
            await h.eval(setTheme, 'light');
            try {
                const m = await h.eval(measure);
                checkLayout(h, m, 'light');
                checkTheme(h, m, 'light');
                h.assert(m.chat.color !== 'rgb(228, 228, 231)', 'light theme still paints the dark text colour');
                h.note(`light: bg ${m.chat.bg}, side ${m.side.bg}, text ${m.chat.color}`);
                await shoot(h, 'p0-skeleton-light');
            } finally {
                // leave the page as the harness found it, whatever happened
                await h.eval(setTheme, 'dark');
            }
        },
    },
];
