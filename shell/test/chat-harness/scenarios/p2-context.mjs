// @ts-check
// P2-U2 in the real browser against the real mock farm: the context budget end to end — the meter,
// the send-cost gate, visible trimming with pinning, and the calibration a reply leaves behind.
//
// The unit tests (ctx/tokens, ctx/budget) prove the arithmetic. Only these scenarios can prove the
// parts that are not arithmetic: that the gate really stops the first submit and lets the second
// through, that the label survives the composer's own "Preparing…" restore (plan §2.6 AF), that the
// trim really removes messages from the WIRE body and marks the rows `.chat-outside` (§2.6 AN), and
// that `usage.prompt_tokens` really reaches the estimator.
//
// Every scenario first asserts that the P2-U2 module is REAL: while a unit has not landed, main.mjs
// records the failure in LolChat.failed and simply installs nothing, and a green run against an
// absent feature would mean nothing.

const COMPLETIONS = '/v1/chat/completions';

/** The default mock farm, with the context window this scenario wants. */
const farmWith = (/** @type {number} */ contextPerSlot) => ({
    backend: { engine: 'llama.cpp', alias: 'assistant', contextLength: contextPerSlot, contextPerSlot, slots: 1 },
});

/** Fail loudly when this unit's feature did not load (or threw in install). */
const requireReal = async (/** @type {any} */ h) => {
    await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
    await h.eval(() => {
        const failed = (window.LolChat && window.LolChat.failed) || {};
        if (failed.context) throw new Error(`P2-U2 needs the REAL app/context.mjs: ${failed.context.error}`);
        const app = window.LolChat.app;
        if (!app.context) throw new Error('app/context.mjs loaded but installed nothing (app.context is missing)');
        // The gate and the trim are registry items: if they are not there, nothing below can pass.
        const ids = app.registry.list(app.SLOTS.REQUEST_TRANSFORMS).map((/** @type {any} */ i) => i.id);
        if (!ids.includes('budget-trim')) throw new Error(`no budget-trim transform, only: ${ids.join(', ')}`);
        const gates = app.registry.list(app.SLOTS.BEFORE_SEND).map((/** @type {any} */ i) => i.id);
        if (!gates.includes('cost-gate')) throw new Error(`no cost-gate, only: ${gates.join(', ')}`);
        return true;
    });
};

/** Wait until the farm reached the page AND the picker filled itself from /v1/models. */
const waitForModels = (/** @type {any} */ h) => h.waitFor(() => {
    const select = document.getElementById('chat-model');
    return !!(window.__lolFarm && select && select.options.length > 1) || null;
});

/** Wait until the caps the chat is using really carry `tokens` as the budget. */
const waitBudget = (/** @type {any} */ h, /** @type {number} */ tokens) => h.waitFor((want) => {
    const caps = window.LolChat.app.farm.get();
    return caps && caps.budget && caps.budget.tokens === want ? true : null;
}, { args: [tokens] });

/** Set the gate threshold the way the Context settings section does. */
const setThreshold = (/** @type {any} */ h, /** @type {number} */ n) =>
    h.eval((v) => { window.LolChat.app.context.setThreshold(v); return window.LolChat.app.context.threshold(); }, n);

/** Type `chars` characters into the composer WITHOUT sending, and let the preview settle. */
const typeLong = async (/** @type {any} */ h, /** @type {number} */ chars, /** @type {string} */ marker = 'A') => {
    await h.eval((n, ch) => {
        const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('chat-input'));
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        const text = ch.repeat(n);
        if (setter && setter.set) setter.set.call(input, text); else input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input.value.length;
    }, chars, marker);
    await h.sleep(400);                          // the 250 ms preview debounce, plus its await
};

/** Submit whatever is in the composer, into the CURRENT thread (h.submit always starts a new one). */
const submitHere = (/** @type {any} */ h) => h.eval(() => {
    /** @type {HTMLFormElement} */ (document.getElementById('chat-form')).requestSubmit();
    return true;
});

const sendLabel = (/** @type {any} */ h) => h.eval(() => {
    const send = /** @type {HTMLButtonElement} */ (document.getElementById('chat-send'));
    return { text: (send.textContent || '').trim(), armed: send.classList.contains('armed'), hidden: send.classList.contains('hidden') };
});

const meterState = (/** @type {any} */ h) => h.eval(() => {
    const el = /** @type {HTMLElement|null} */ (document.querySelector('#lolchat .chat-meter'));
    if (!el) return null;
    const fill = /** @type {HTMLElement|null} */ (el.querySelector('.chat-meter-fill'));
    return {
        hidden: el.hidden,
        text: (el.querySelector('.chat-meter-text') || { textContent: '' }).textContent,
        src: (el.querySelector('.chat-meter-src') || { textContent: '' }).textContent,
        over: el.classList.contains('is-over'),
        warn: el.classList.contains('is-warn'),
        width: fill ? fill.style.width : null,
        title: el.title,
    };
});

const completionsSince = async (/** @type {any} */ h, /** @type {number} */ since) =>
    (await h.mock.log({ path: COMPLETIONS, since })).filter((/** @type {any} */ e) => e.method === 'POST');

/** Pick a model the way a user does. */
const pickModel = async (/** @type {any} */ h, /** @type {string} */ id) => {
    await h.eval((want) => {
        const select = /** @type {HTMLSelectElement} */ (document.getElementById('chat-model'));
        select.value = want;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return select.value;
    }, id);
    await h.waitFor((want) => (document.getElementById('chat-model').value === want ? true : null), { args: [id] });
};

/** Wait until there are at least `n` assistant rows and the last one has stopped moving. */
const waitSettled = (/** @type {any} */ h, n = 1, timeout = 30000) => h.waitFor((want) => {
    const rows = document.querySelectorAll('.chat-msg.assistant');
    if (rows.length < want) return null;
    const status = rows[rows.length - 1].getAttribute('data-status');
    return status && status !== 'streaming' ? status : null;
}, { timeout, args: [n] });

export default [
    {
        name: 'p2-cost-gate',
        needsMock: true,
        // F26: a big prompt is the cost that makes everyone else on the farm wait, so Send says what
        // it costs and asks; a prompt that cannot fit the window at all is refused outright.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await h.setFarm(farmWith(8192));
            await waitBudget(h, 8192);
            await setThreshold(h, 2000);

            // ---- expensive but possible: ~3.4k tokens on an 8,192-token farm -------------------
            let since = Date.now();
            await typeLong(h, 12000);
            await submitHere(h);
            await h.waitFor(() => {
                const send = document.getElementById('chat-send');
                return (send.textContent || '').includes('tokens') ? send.textContent : null;
            });
            const armedLabel = await sendLabel(h);
            h.assert(armedLabel.text.includes('tokens'), `the Send label says the cost: "${armedLabel.text}"`);
            h.assert(armedLabel.armed, 'and the button is visibly armed');
            h.eq((await completionsSince(h, since)).length, 0, 'the first submit sent NOTHING');
            h.eq(await h.eval(() => document.getElementById('chat-input').value.length), 12000, 'the draft is kept');

            // ---- the second click, same text, inside 10 s ---------------------------------------
            await submitHere(h);
            await waitSettled(h);
            const posts = await completionsSince(h, since);
            h.eq(posts.length, 1, 'exactly one completion for the second submit');
            await h.waitFor(() => {
                const send = document.getElementById('chat-send');
                return !send.classList.contains('armed') && !(send.textContent || '').includes('tokens') ? send.textContent : null;
            });
            h.note(`armed label: ${armedLabel.text}`);

            // ---- too long to fit at all ---------------------------------------------------------
            since = Date.now();
            await typeLong(h, 200000, 'B');
            await submitHere(h);
            await h.waitFor(() => {
                const send = document.getElementById('chat-send');
                return (send.textContent || '').length && !(send.textContent || '').includes('tokens')
                    && send.textContent !== 'Send' ? send.textContent : null;
            });
            const blocked = await sendLabel(h);
            h.assert(!blocked.armed, 'a blocked send is not armed: a second click must not force it');
            h.eq((await completionsSince(h, since)).length, 0, 'blocked: nothing on the wire');
            // A refusal has to SAY why: the meter's breakdown opens itself.
            const popped = await h.waitFor(() => {
                const box = document.querySelector('.chat-popover .chat-meter-break');
                return box ? (box.textContent || '') : null;
            });
            h.assert(popped.length > 20, 'the breakdown popover opened on the refusal');
            await h.eval(() => {
                const p2 = document.querySelector('.chat-popover');
                if (p2 && p2.hidePopover) p2.hidePopover();
                return true;
            });
            await submitHere(h);                       // clicking again changes nothing
            await h.sleep(600);
            h.eq((await completionsSince(h, since)).length, 0, 'still nothing after a second click');
            const meter = await meterState(h);
            h.assert(meter && meter.over, `the meter is in its over state: ${JSON.stringify(meter)}`);

            // ---- and shortening the message takes the refusal back off the button ---------------
            await typeLong(h, 120, 'D');
            await h.waitFor(() => (document.getElementById('chat-send').textContent === 'Send' ? true : null));
            const recovered = await meterState(h);
            h.assert(!recovered.over, 'the meter left its over state too');
            h.note(`blocked label: ${blocked.text} · meter ${meter.text}`);
        },
    },

    {
        name: 'p2-cost-gate-disarm',
        needsMock: true,
        // The armed state belongs to ONE draft: editing the text has to disarm it, or a second click
        // would send something the user never saw the price of.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await h.setFarm(farmWith(8192));
            await waitBudget(h, 8192);
            await setThreshold(h, 2000);

            const since = Date.now();
            await typeLong(h, 12000);
            await submitHere(h);
            await h.waitFor(() => ((document.getElementById('chat-send').textContent || '').includes('tokens') ? true : null));
            h.assert(await h.eval(() => window.LolChat.app.context.isArmed()), 'armed after the first submit');

            // Edit the draft: same size, different text.
            await typeLong(h, 12500, 'C');
            await h.waitFor(() => (window.LolChat.app.context.isArmed() ? null : true));
            const afterEdit = await sendLabel(h);
            h.eq(afterEdit.text, 'Send', 'the label went back to the resting one');
            h.assert(!afterEdit.armed, 'and the button is no longer armed');

            await submitHere(h);
            await h.waitFor(() => ((document.getElementById('chat-send').textContent || '').includes('tokens') ? true : null));
            h.assert(await h.eval(() => window.LolChat.app.context.isArmed()), 'the edited draft arms again');
            h.eq((await completionsSince(h, since)).length, 0, 'two first-submits, zero completions');
        },
    },

    {
        name: 'p2-trim',
        needsMock: true,
        // F27: on a small farm the oldest turns are dropped from the REQUEST (visibly, in the
        // thread), the newest exchange and the message being sent always survive, and a pinned old
        // message is carried along whatever else goes.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await h.setFarm(farmWith(12288));
            await waitBudget(h, 12288);

            // A 12-turn thread, seeded through the repo (24 messages is a long conversation, not a
            // scenario that spends two minutes sending them one by one).
            const seeded = await h.eval(async (turns, size) => {
                const app = window.LolChat.app;
                const thread = app.repo.createThread({ title: 'a long conversation' });
                const ids = [];
                for (let i = 0; i < turns; i++) {
                    const q = `Q${i} ${'q'.repeat(size)}`;
                    const a = `A${i} ${'a'.repeat(size)}`;
                    const um = app.repo.appendMessage(thread.id, {
                        role: 'user', content: q, parts: [{ type: 'text', text: q }], status: 'done',
                        pinned: i === 1,
                    });
                    const am = app.repo.appendMessage(thread.id, { role: 'assistant', content: a, status: 'done' });
                    ids.push(um.id, am.id);
                }
                await app.repo.flush();
                return { threadId: thread.id, ids };
            }, 12, 2000);

            await h.eval((id) => window.LolChat.app.controller.selectThread(id), seeded.threadId);
            await h.waitFor((id) => (window.LolChat.app.state.threadId === id ? true : null), { args: [seeded.threadId] });

            // The recompute runs on THREAD_SELECTED: the trimmed rows dim themselves.
            const outside = await h.waitFor(() => {
                const rows = document.querySelectorAll('.chat-msg.chat-outside');
                return rows.length ? rows.length : null;
            });
            h.assert(outside > 0, `${outside} rows are marked .chat-outside`);
            h.assert(outside < 24, 'but not all of them');

            const meterBefore = await meterState(h);
            h.assert(meterBefore && !meterBefore.hidden, 'the meter is showing');

            // ---- the pin action brings a trimmed message back, and unpinning lets it go again ----
            const outsideId = await h.eval(() => {
                const row = document.querySelector('.chat-msg.chat-outside[data-id]');
                return row ? row.getAttribute('data-id') : null;
            });
            h.assert(outsideId, 'there is a dimmed row to pin');
            const clickAction = (/** @type {string} */ id, /** @type {string} */ act) => h.eval((rowId, action) => {
                const btn = document.querySelector(`.chat-msg[data-id="${rowId}"] .chat-action[data-action="${action}"]`);
                if (!btn) {
                    const have = [...document.querySelectorAll(`.chat-msg[data-id="${rowId}"] .chat-action`)]
                        .map((b) => b.getAttribute('data-action')).join(', ');
                    throw new Error(`no "${action}" action on ${rowId}; it has: ${have || 'none'}`);
                }
                btn.click();
                return true;
            }, id, act);
            await clickAction(outsideId, 'pin');
            await h.waitFor((id) => {
                const row = document.querySelector(`.chat-msg[data-id="${id}"]`);
                if (!row || row.classList.contains('chat-outside')) return null;
                return row.querySelector('.chat-action[data-action="unpin"]') ? true : null;
            }, { args: [outsideId] });
            await clickAction(outsideId, 'unpin');
            await h.waitFor((id) => {
                const row = document.querySelector(`.chat-msg[data-id="${id}"]`);
                return row && row.classList.contains('chat-outside') ? true : null;
            }, { args: [outsideId] });

            await pickModel(h, 'mock-echo');
            const since = Date.now();
            await h.eval(() => {
                const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('chat-input'));
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
                if (setter && setter.set) setter.set.call(input, 'LASTQUESTION'); else input.value = 'LASTQUESTION';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                /** @type {HTMLFormElement} */ (document.getElementById('chat-form')).requestSubmit();
                return true;
            });
            await waitSettled(h, 13);

            const posts = await completionsSince(h, since);
            h.eq(posts.length, 1, 'one completion');
            const body = await h.mock.lastBody();
            const wire = body.messages.map((/** @type {any} */ m) => (typeof m.content === 'string' ? m.content : ''));
            h.assert(wire.length < 25, `the wire carries fewer messages than the path: ${wire.length} of 25`);
            h.assert(wire.some((/** @type {string} */ c) => c.startsWith('LASTQUESTION')), 'the message being sent is there');
            h.assert(wire.some((/** @type {string} */ c) => c.startsWith('Q11')), 'the newest exchange survived');
            h.assert(wire.some((/** @type {string} */ c) => c.startsWith('Q1 ')), 'the PINNED old message is still in the request');
            h.assert(!wire.some((/** @type {string} */ c) => c.startsWith('Q0 ')), 'the oldest, unpinned turn went');
            h.assert(!wire.some((/** @type {string} */ c) => c.startsWith('A1 ')), 'the pin keeps the message, not its whole turn');

            // mock-echo reports what it received, so the reply itself is the second witness.
            const reply = await h.eval(() => {
                const rows = document.querySelectorAll('.chat-msg.assistant');
                return (rows[rows.length - 1].textContent || '');
            });
            const count = /messageCount:\s*(\d+)/.exec(reply);
            h.assert(count && Number(count[1]) === wire.length, `the echo agrees: ${count && count[1]} vs ${wire.length}`);
            h.note(`${wire.length} of 25 messages sent · ${outside} rows outside the context`);
        },
    },

    {
        name: 'p2-calibrate',
        needsMock: true,
        // F24: the estimator starts at 3.6 chars/token and learns from `usage.prompt_tokens`. The kv
        // key is per UNDERLYING model, spelled exactly as §2.6 AL froze it.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);

            const before = await h.eval(() => window.LolChat.app.repo.kvGet('tokRatio:Qwen3.8-27B-UD-Q2_K_XL', null));
            h.eq(before, null, 'nothing is calibrated before the first reply');

            await h.submit('how much VRAM does the box have?');
            await h.waitReply();
            await waitSettled(h);

            const ratio = await h.waitFor(() => window.LolChat.app.repo.kvGet('tokRatio:Qwen3.8-27B-UD-Q2_K_XL', null));
            h.assert(typeof ratio === 'number', `kv tokRatio:Qwen3.8-27B-UD-Q2_K_XL is a number: ${ratio}`);
            h.assert(ratio !== 3.6, 'and it moved off the seed ratio');
            h.assert(ratio >= 1.5 && ratio <= 6, `it stayed inside the clamp: ${ratio}`);
            // The gate's "seconds" needs prompt tokens per second; one reply is enough to seed it.
            const rate = await h.eval(() => window.LolChat.app.repo.kvGet('promptTokSec:mockfarm0001', null));
            h.assert(typeof rate === 'number' && rate > 0, `kv promptTokSec:mockfarm0001 = ${rate}`);
            h.note(`ratio ${Number(ratio).toFixed(2)} · ${Math.round(rate)} prompt tok/s`);
        },
    },

    {
        name: 'p2-meter',
        needsMock: true,
        // F25: the meter is the farm-honest picture — the advertised window, labelled as advertised,
        // and no meter at all when there is no farm to spend it on.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await waitBudget(h, 16384);

            const shown = await h.waitFor(() => {
                const el = /** @type {HTMLElement|null} */ (document.querySelector('#lolchat .chat-meter'));
                if (!el || el.hidden) return null;
                const text = (el.querySelector('.chat-meter-text') || { textContent: '' }).textContent;
                return text && text.includes('/') ? text : null;
            });
            h.assert(/~\d/.test(shown) && shown.includes('16.4k'), `the meter reads the advertised window: "${shown}"`);
            const state = await meterState(h);
            h.eq(state.src, 'advertised', 'and says the number is the farm\'s claim');
            h.assert(!state.over && !state.warn, 'an empty composer is not a warning');

            // The breakdown popover opens and names the pieces.
            const popover = await h.eval(() => {
                const el = /** @type {HTMLElement} */ (document.querySelector('#lolchat .chat-meter'));
                el.click();
                const box = document.querySelector('.chat-popover .chat-meter-break');
                return box ? { text: box.textContent || '', rows: box.querySelectorAll('.chat-meter-row').length } : null;
            });
            h.assert(popover && popover.rows >= 2, `the popover lists the breakdown: ${JSON.stringify(popover && popover.rows)}`);
            h.assert(popover.text.includes('Window'), 'including the window it is measured against');
            await h.eval(() => {
                const p = document.querySelector('.chat-popover');
                if (p && p.hidePopover) p.hidePopover();
                return true;
            });

            // Look at it: the meter sits in the composer row and reads as one line (§2.6 W — two of
            // the P1 landing's real bugs were invisible to every assertion and obvious in a picture).
            const shot = await h.screenshot('p2-meter');
            if (shot) h.note(`screenshot ${shot}`);

            // A farm with no advertised window: the meter still works, the "advertised" tag goes.
            await h.setFarm({ backend: null });
            await waitBudget(h, 32768);
            await h.waitFor(() => {
                const el = /** @type {HTMLElement|null} */ (document.querySelector('#lolchat .chat-meter'));
                const src = el && el.querySelector('.chat-meter-src');
                return el && !el.hidden && src && !src.textContent ? true : null;
            });

            // No farm at all: no meter (plan §4 P2-U2 — "hidden without a farm").
            await h.setFarm(null);
            await h.waitFor(() => {
                const el = /** @type {HTMLElement|null} */ (document.querySelector('#lolchat .chat-meter'));
                return el && el.hidden ? true : null;
            });
        },
    },
];
