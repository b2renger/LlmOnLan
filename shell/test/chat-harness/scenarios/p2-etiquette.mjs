// @ts-check
// P2-U1 in the real browser against the real mock farm: farm etiquette.
//
// These scenarios exist because the unit tests cannot prove the two things that actually matter on
// a shared box: how many requests really leave the machine, and what the person in front of the
// screen sees while none are leaving. Every seat scenario therefore COUNTS completion POSTs in the
// mock's log — "exactly one" is the assertion, not "it eventually worked".
//
// All of them run with refreshMs 500 (the farm snapshot is the only clock — plan §3.9) and
// seatJitterMs 200, so a jittered resend resolves on the next tick instead of five seconds later.

const COMPLETIONS = '/v1/chat/completions';

/** The farm's own 429 sentence (shell/test/mock/seats-body.js ← farm/src/seats.js). */
const FARM_SEATS_FRAGMENT = 'seats on this server are in use';

/** Network noise the farm's own error paths make in the console (the 429 body, an aborted stream). */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when this unit's modules were replaced by fakes or skipped. */
const requireReal = (/** @type {any} */ h, /** @type {string[]} */ keys = ['seatWait', 'strip', 'notify', 'governor']) =>
    h.eval((want) => {
        const failed = (window.LolChat && window.LolChat.failed) || {};
        const missing = want.filter((k) => failed[k]);
        if (missing.length) {
            throw new Error(`P2-U1 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
        }
        return true;
    }, keys);

/** Wait until the farm reached the page AND the picker filled itself from /v1/models. */
const waitForModels = (/** @type {any} */ h) => h.waitFor(() => {
    const select = document.getElementById('chat-model');
    return !!(window.__lolFarm && select && select.options.length > 1) || null;
});

/** Wait until the CLIENT's caps agree with the seat count we just pushed into the mock. */
const waitForSeats = (/** @type {any} */ h, /** @type {number} */ used) => h.waitFor((want) => {
    const app = window.LolChat.app;
    const seats = app && app.farm ? app.farm.get().seats : null;
    return seats && seats.used === want ? seats : null;
}, { args: [used], timeout: 8000 });

/** How many completion POSTs the mock has seen, ever. */
const completions = async (/** @type {any} */ h) => (await h.mock.log({ path: COMPLETIONS })).length;

/** Send INTO the current thread (h.submit always starts a new one — plan §2.6 P). */
const sendHere = (/** @type {any} */ h, /** @type {string} */ text) => h.eval((v) => {
    const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('chat-input'));
    const form = /** @type {HTMLFormElement} */ (document.getElementById('chat-form'));
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(input, v); else input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    return true;
}, text);

const newChat = (/** @type {any} */ h) => h.eval(() => { document.getElementById('chat-new').click(); return true; });

const pickModel = async (/** @type {any} */ h, /** @type {string} */ id) => {
    await h.eval((want) => {
        const select = /** @type {HTMLSelectElement} */ (document.getElementById('chat-model'));
        select.value = want;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return select.value;
    }, id);
    await h.waitFor((want) => (document.getElementById('chat-model').value === want ? true : null), { args: [id] });
};

/** The last assistant row, as the reader sees it, plus the buttons that live on it. */
const lastRow = (/** @type {any} */ h) => h.eval(() => {
    const rows = document.querySelectorAll('.chat-msg.assistant');
    const row = rows[rows.length - 1];
    if (!row) return null;
    const note = row.querySelector('.chat-msg-note');
    return {
        id: row.getAttribute('data-id'),
        status: row.getAttribute('data-status'),
        note: note ? note.textContent.trim() : '',
        actions: [...row.querySelectorAll('.chat-actions button')].map((b) => b.getAttribute('data-action')),
        labels: [...row.querySelectorAll('.chat-actions button')].map((b) => b.getAttribute('aria-label')),
        stats: (row.querySelector('.chat-stats') || { textContent: '' }).textContent.trim(),
    };
});

/** Governor + the two composer buttons: the whole "can I send right now" surface. */
const sendSurface = (/** @type {any} */ h) => h.eval(() => {
    const send = /** @type {HTMLButtonElement} */ (document.getElementById('chat-send'));
    const stop = /** @type {HTMLButtonElement} */ (document.getElementById('chat-stop'));
    return {
        gov: window.LolChat.app.gov.state(),
        sendHidden: send.classList.contains('hidden'),
        sendDisabled: !!send.disabled,
        sendLabel: send.textContent,
        stopHidden: stop.classList.contains('hidden'),
    };
});

/** Wait for the waiting row, whatever order the note and the status land in. */
const waitForWaiting = (/** @type {any} */ h) => h.waitFor(() => {
    const row = document.querySelector('.chat-msg.assistant[data-status="waiting"]');
    if (!row) return null;
    const note = row.querySelector('.chat-msg-note');
    return note && note.textContent.trim() ? note.textContent.trim() : null;
}, { timeout: 20000 });

/** The strip, field by field. */
const strip = (/** @type {any} */ h) => h.eval(() => {
    const el = document.querySelector('#lolchat .chat-strip');
    if (!el) return null;
    /** @type {Record<string, string>} */ const byField = {};
    for (const f of el.querySelectorAll('.chat-strip-field')) byField[f.getAttribute('data-field')] = f.textContent;
    return { text: el.textContent, title: el.getAttribute('title'), fields: Object.keys(byField), byField };
});

export default [
    // ------------------------------------------------------------------------------------------
    {
        name: 'p2-seat-wait',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await h.fresh({ refreshMs: 500, flags: { seatJitterMs: 200 } });
            await requireReal(h);
            await waitForModels(h);

            // The farm fills up while the reader is typing.
            await h.mock.state({ capacity: { slots: 2, seatsUsed: 2 } });
            await waitForSeats(h, 2);

            const before = await completions(h);
            await h.submit('is anyone using the farm?');

            const note = await waitForWaiting(h);
            h.assert(note.includes(FARM_SEATS_FRAGMENT), `the farm's own sentence, verbatim: ${note}`);
            h.assert(note.includes('2/2 in use'), `plus what the client knows: ${note}`);

            const row = await lastRow(h);
            h.eq(row.actions.includes('seat-try-now'), true, 'Try now is on the row');
            h.eq(row.actions.includes('seat-cancel'), true, 'so is Cancel');
            h.eq(row.labels.includes('Try now'), true);

            const surface = await sendSurface(h);
            h.eq(surface.gov.foreground, 'held', 'the wait owns the foreground slot');
            h.eq(surface.gov.holder, row.id, 'held on the waiting MESSAGE, so its own resend may take it');
            // P2 review, major: a HOLD is not a running reply, and the composer used to treat the
            // two the same — Send was hidden, so the "Waiting for a seat…" label §4 P2-U1 asks for
            // was written to a button nobody could see, and the composer row looked exactly like a
            // streaming one. Send now stays on screen, disabled, wearing that label.
            h.assert(!surface.sendHidden, 'Send stays on screen to say what is happening…');
            h.assert(surface.sendDisabled, '…disabled, because pressing it would do nothing…');
            h.eq(surface.sendLabel, 'Waiting for a seat…', '…and it says so');
            h.assert(!surface.stopHidden, 'and Stop is there to give the wait up');

            // Enter while queued must not claim a reply is running: nothing is.
            await h.eval(() => {
                const input = document.getElementById('chat-input');
                input.value = 'let me jump the queue';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.getElementById('chat-form').requestSubmit();
                return true;
            });
            const toast = await h.waitFor(() => {
                const el = document.querySelector('.chat-toast');
                return el && el.textContent.trim() ? el.textContent.trim() : null;
            });
            h.note('the refusal says: ' + toast);
            h.assert(!/already running/i.test(toast), 'nothing is running, so it must not say so: ' + toast);
            h.assert(/seat/i.test(toast), 'it says what the hold IS: ' + toast);
            await h.eval(() => {
                const input = document.getElementById('chat-input');
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            });

            // The whole point: five seconds of a full farm cost exactly one request.
            await h.sleep(5000);
            h.eq(await completions(h) - before, 1, 'zero timer retries while the farm is full');
            const still = await lastRow(h);
            h.eq(still.status, 'waiting', 'and the row is still waiting, not errored');
            // P2 review, blocker: the note used to be recomposed from ITSELF on every snapshot, so
            // the seat sentence was appended once per farm publish (~10 times in these 5 s, ~225
            // over a real 15-minute wait) — with a store write each time. Byte-identical, or it is
            // growing again. `includes` cannot see this; only equality can.
            h.eq(still.note, note, `the note is unchanged after ten snapshots: ${still.note}`);
            h.eq(still.note.split('Waiting for a seat').length - 1, 1, 'exactly one seat sentence');

            // A seat frees. The snapshot says so; the jitter resolves on a tick; ONE request goes.
            await h.mock.state({ capacity: { seatsUsed: 1 } });
            const reply = await h.waitReply({ timeout: 15000 });
            h.eq(await completions(h) - before, 2, 'exactly one resend, not a storm');
            h.assert(/tok\/s/.test(reply.stats), `the answer really completed: ${reply.stats}`);

            const after = await sendSurface(h);
            h.eq(after.gov.foreground, 'idle', 'the slot came back');
            h.assert(!after.sendHidden && !after.sendDisabled, 'Send is usable again');
            h.eq((await lastRow(h)).note, '', 'the waiting note is gone with the answer');

            await h.sleep(1500);
            h.eq(await completions(h) - before, 2, 'and nothing keeps polling afterwards');
        },
    },

    // ------------------------------------------------------------------------------------------
    {
        // P2 review, blocker (§2.6 AU.4): a seat wait outlives a thread switch, and generate()'s
        // view writes were unguarded — when the seat freed, the answer to a question asked in ONE
        // chat streamed live into whatever chat the reader had moved to, including a brand-new
        // empty one. It only vanished when the reply ended and the post-stream refresh rebuilt the
        // path; on a real farm that is minutes of somebody else's conversation on screen.
        name: 'p2-seat-wait-elsewhere',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await h.fresh({ refreshMs: 500, flags: { seatJitterMs: 200 } });
            await requireReal(h);
            await waitForModels(h);

            // A SLOW model, so the resend really streams for a while: the defect is only visible
            // between beginStream() and the post-stream refreshView().
            await newChat(h);
            await pickModel(h, 'mock-slow');
            await h.mock.state({ capacity: { slots: 2, seatsUsed: 2 } });
            await waitForSeats(h, 2);

            const before = await completions(h);
            await sendHere(h, 'answer me in the first chat');
            await waitForWaiting(h);
            const threadA = await h.eval(() => window.LolChat.app.state.threadId);
            const waitingId = (await lastRow(h)).id;

            // The reader gives up looking at it and starts a new chat.
            await newChat(h);
            const threadB = await h.eval(() => window.LolChat.app.state.threadId);
            h.assert(threadB && threadB !== threadA, 'a different chat is open: ' + threadA + ' -> ' + threadB);
            h.eq(await h.eval(() => document.querySelectorAll('#chat-messages .chat-msg').length), 0, 'and it is empty');

            // The seat frees. The resend goes out — into A.
            await h.mock.state({ capacity: { seatsUsed: 0 } });
            const streaming = await h.waitFor(() => {
                const g = window.LolChat.app.gov.state();
                return g.foreground === 'streaming' ? g.holder : null;
            }, { timeout: 20000 });
            h.eq(streaming, waitingId, 'the wait turned into its own stream');

            // …and while it streams, the chat ON SCREEN stays empty. Sampled rather than snapshotted
            // once: the unguarded version painted the row at beginStream and left it there. The loop
            // runs until the answer really is arriving (mock-slow has a 3 s TTFT and then checkpoints
            // to the store), so the samples cover the whole window the defect lived in.
            let streamed = 0;
            for (let i = 0; i < 60 && !streamed; i++) {
                const seen = await h.eval(() => [...document.querySelectorAll('#chat-messages .chat-msg')]
                    .map((el) => el.getAttribute('data-id') + ':' + el.getAttribute('data-status')));
                h.eq(seen.length, 0, 'nothing from the other chat may appear here: ' + JSON.stringify(seen));
                streamed = await h.eval(async (id) => {
                    const rows = await window.LolChat.app.repo.getMessages(id);
                    const reply = rows.filter((m) => m.role === 'assistant').pop();
                    return reply ? (reply.content || '').length : 0;
                }, threadA);
                await h.sleep(200);
            }
            h.assert(streamed > 0, 'the answer really was arriving while we watched: ' + streamed + ' chars');
            h.eq(await completions(h) - before, 2, 'one refused send + one resend');

            // mock-slow runs for a minute; the point is proven, so stop it from where the reader is.
            await h.click('#chat-stop');
            await h.waitFor(() => (window.LolChat.app.gov.state().foreground === 'idle' ? true : null), { timeout: 20000 });
            h.eq(await h.eval(() => document.querySelectorAll('#chat-messages .chat-msg').length), 0,
                'the chat on screen was never touched, start to finish');

            // Back in A, the answer is on the very message that was waiting — and only there.
            await h.eval((id) => window.LolChat.app.controller.selectThread(id).then(() => true), threadA);
            const landed = await h.waitFor((want) => {
                const row = document.querySelector('.chat-msg[data-id="' + want + '"]');
                if (!row) return null;
                const status = row.getAttribute('data-status');
                return status && status !== 'streaming' ? status : null;
            }, { args: [waitingId], timeout: 20000 });
            h.note('the waiting message settled as: ' + landed);
            const record = await h.eval(async (id) => {
                const app = window.LolChat.app;
                const rows = await app.repo.getMessages(id);
                return rows.map((m) => ({ id: m.id, role: m.role, status: m.status, chars: (m.content || '').length }));
            }, threadA);
            h.note('thread A: ' + JSON.stringify(record));
            const replies = record.filter((m) => m.role === 'assistant');
            h.eq(replies.length, 1, 'exactly one reply, not one per repaint');
            h.eq(replies[0].id, waitingId, 'and it IS the message that was waiting');
            h.assert(replies[0].chars > 0, 'which really carries the text that streamed: ' + replies[0].chars + ' chars');

            const inB = await h.eval(async (id) => {
                const app = window.LolChat.app;
                return (await app.repo.getMessages(id)).length;
            }, threadB);
            h.eq(inB, 0, 'and the new chat is still empty in the STORE as well as on screen');
        },
    },

    // ------------------------------------------------------------------------------------------
    {
        // P2 review, major: a waiting row carried Fork and Delete beside Try now / Cancel. Deleting
        // it wedged the composer on a message that no longer existed, and the freed seat then
        // generated INTO the deleted row and wrote it back. Both halves are asserted here.
        name: 'p2-seat-wait-deleted',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await h.fresh({ refreshMs: 500, flags: { seatJitterMs: 200 } });
            await requireReal(h);
            await waitForModels(h);
            await h.mock.state({ capacity: { slots: 2, seatsUsed: 2 } });
            await waitForSeats(h, 2);

            const before = await completions(h);
            await h.submit('anyone free?');
            await waitForWaiting(h);

            // 1. The row offers ITS OWN two actions and nothing that would remove it under the wait.
            const row = await lastRow(h);
            h.note(`actions on the waiting row: ${JSON.stringify(row.actions)}`);
            h.eq(row.actions.includes('seat-try-now'), true, 'Try now');
            h.eq(row.actions.includes('seat-cancel'), true, 'Cancel');
            h.eq(row.actions.includes('delete'), false, 'but NOT Delete — cancel the wait first');
            h.eq(row.actions.includes('fork'), false, 'and not Fork either');

            // …and they are visible without hovering: this row's whole point is its two buttons.
            const opacity = await h.eval((id) => {
                const el = document.querySelector(`.chat-msg[data-id="${id}"] .chat-actions`);
                return el ? getComputedStyle(el).opacity : null;
            }, row.id);
            h.eq(opacity, '1', 'the waiting row never hides its way out');

            // 2. The reader deletes it anyway, through the store (a thread delete does the same).
            await h.eval((id) => window.LolChat.app.repo.deleteSubtree(id).then(() => true), row.id);
            await h.eval(() => { window.LolChat.app.view.remove([]); return true; });

            const freed = await h.waitFor(() => {
                const g = window.LolChat.app.gov.state();
                return g.foreground === 'idle' ? g : null;
            }, { timeout: 15000 });
            h.eq(freed.foreground, 'idle', 'the governor let go of a message that is gone');
            h.eq(await h.eval(() => window.LolChat.app.seatWait.state()), null, 'and so did the wait');
            const surface = await sendSurface(h);
            h.assert(!surface.sendHidden && !surface.sendDisabled, 'Send is usable again');

            // 3. A seat frees: nothing is sent, and the deleted row stays deleted.
            await h.mock.state({ capacity: { seatsUsed: 0 } });
            await h.sleep(3000);
            h.eq(await completions(h) - before, 1, 'a deleted turn is never re-sent');
            const left = await h.eval(() => {
                const app = window.LolChat.app;
                return app.repo.getMessages(app.state.threadId).then((m) => m.map((x) => `${x.role}:${x.status}`));
            });
            h.note(`messages left: ${JSON.stringify(left)}`);
            h.eq(left.length, 1, 'exactly the question, and no resurrected reply');
            h.eq(left[0].startsWith('user:'), true);
        },
    },

    // ------------------------------------------------------------------------------------------
    {
        name: 'p2-seat-wait-cancel',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await h.fresh({ refreshMs: 500, flags: { seatJitterMs: 200 } });
            await requireReal(h);
            await waitForModels(h);
            await h.mock.state({ capacity: { slots: 2, seatsUsed: 2 } });
            await waitForSeats(h, 2);

            const before = await completions(h);
            await h.submit('anyone free?');
            const note = await waitForWaiting(h);
            h.assert(note.includes(FARM_SEATS_FRAGMENT), note);

            await h.click('#chat-stop');
            await h.waitFor(() => (document.querySelector('.chat-msg.assistant[data-status="aborted"]') ? true : null));

            const row = await lastRow(h);
            h.assert(row.note, `the row still says something: ${JSON.stringify(row.note)}`);
            // The reason is KEPT on SCREEN as well as in the store (§4 P2-U1). thread-view's
            // fill() renders msg.error.message for 'aborted' when there is one, and falls back to
            // the generic abort sentence for an ordinary Stop (P2 landing, on P2-U1's request).
            const record = await h.eval(async () => {
                const app = window.LolChat.app;
                const path = await app.repo.getPath(app.state.threadId);
                for (let i = path.length - 1; i >= 0; i--) if (path[i].role === 'assistant') return path[i];
                return null;
            });
            h.assert(row.note.includes(FARM_SEATS_FRAGMENT), `the cancelled row still shows WHY: ${row.note}`);
            h.assert(row.note.includes('Stopped waiting'), row.note);
            h.eq(record.status, 'aborted');
            h.assert(record.error && record.error.message.includes(FARM_SEATS_FRAGMENT),
                `the reason is KEPT in the record: ${JSON.stringify(record.error)}`);
            h.assert(record.error.message.includes('Stopped waiting'), record.error.message);
            const surface = await sendSurface(h);
            h.eq(surface.gov.foreground, 'idle');
            h.assert(!surface.sendHidden, 'Send is back');

            // A seat frees — and a cancelled wait must stay cancelled.
            await h.mock.state({ capacity: { seatsUsed: 0 } });
            await h.sleep(3000);
            h.eq(await completions(h) - before, 1, 'a cancelled wait never wakes up');
        },
    },

    // ------------------------------------------------------------------------------------------
    {
        name: 'p2-seat-wait-hidden',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await h.fresh({ refreshMs: 500, flags: { seatJitterMs: 200 } });
            await requireReal(h);
            await waitForModels(h);
            await h.mock.state({ capacity: { slots: 2, seatsUsed: 2 } });
            await waitForSeats(h, 2);

            const before = await completions(h);
            await h.submit('waiting while the other surface is up');
            await waitForWaiting(h);

            // The reader switched to Open WebUI: #lolchat is hidden (main.mjs's MutationObserver).
            await h.eval(() => { document.getElementById('lolchat').classList.add('hidden'); return true; });
            await h.waitFor(() => (window.LolChat.app.state.visible === false ? true : null));

            await h.mock.state({ capacity: { seatsUsed: 0 } });
            await h.sleep(3000);
            h.eq(await completions(h) - before, 1, 'a hidden chat must not take a seat nobody is watching');

            await h.eval(() => { document.getElementById('lolchat').classList.remove('hidden'); return true; });
            await h.waitFor(() => (window.LolChat.app.state.visible === true ? true : null));
            await h.waitFor(async () => ((await 0, document.querySelector('.chat-msg.assistant[data-status="done"]')) ? true : null), { timeout: 15000 });
            h.eq(await completions(h) - before, 2, 'coming back takes the seat, exactly once');
        },
    },

    // ------------------------------------------------------------------------------------------
    {
        name: 'p2-seat-wait-minimised',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await h.fresh({ refreshMs: 500, flags: { seatJitterMs: 200 } });
            await requireReal(h);
            await waitForModels(h);
            await h.mock.state({ capacity: { slots: 2, seatsUsed: 2 } });
            await waitForSeats(h, 2);

            const before = await completions(h);
            await h.submit('waiting while minimised');
            await waitForWaiting(h);

            // §2.6 F: a show:false window still reports visibilityState 'visible', so the not-looked-at
            // path can only be reached by forcing it.
            await h.setPageVisible(false);
            await h.waitFor(() => (window.LolChat.app.state.pageVisible === false ? true : null));

            await h.mock.state({ capacity: { seatsUsed: 0 } });
            await h.sleep(3000);
            h.eq(await completions(h) - before, 1, 'a minimised window holds no seat for 15 minutes');

            await h.setPageVisible(true);
            await h.waitFor(() => (window.LolChat.app.state.pageVisible === true ? true : null));
            await h.waitFor(() => (document.querySelector('.chat-msg.assistant[data-status="done"]') ? true : null), { timeout: 15000 });
            h.eq(await completions(h) - before, 2, 'and un-minimising takes it, exactly once');
        },
    },

    // ------------------------------------------------------------------------------------------
    {
        name: 'p2-seat-wait-giveup',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await h.fresh({ refreshMs: 500, flags: { seatJitterMs: 200, seatGiveUpMs: 3000 } });
            await requireReal(h);
            await waitForModels(h);
            await h.mock.state({ capacity: { slots: 2, seatsUsed: 2 } });
            await waitForSeats(h, 2);

            const before = await completions(h);
            await h.submit('this farm is not going to free up');
            await waitForWaiting(h);

            // No capacity change at all: the give-up must come from the clock, on farm ticks.
            const note = await h.waitFor(() => {
                const row = document.querySelector('.chat-msg.assistant[data-status="error"]');
                if (!row) return null;
                const n = row.querySelector('.chat-msg-note');
                return n && n.textContent.trim() ? n.textContent.trim() : null;
            }, { timeout: 15000 });
            h.assert(/Gave up waiting for a seat/.test(note), `a readable give-up, not HTTP 429: ${note}`);

            const surface = await sendSurface(h);
            h.eq(surface.gov.foreground, 'idle', 'the slot is handed back');
            h.assert(!surface.sendHidden, 'Send is on screen');
            h.assert(!surface.sendDisabled, 'and enabled');
            h.eq(surface.sendLabel, 'Send', 'with its normal label');
            h.eq(await completions(h) - before, 1, 'giving up costs no extra request');

            const row = await lastRow(h);
            h.eq(row.actions.includes('seat-try-now'), false, 'the waiting buttons are gone with the wait');
        },
    },

    // ------------------------------------------------------------------------------------------
    {
        name: 'p2-strip',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await h.fresh({ refreshMs: 500 });
            await requireReal(h, ['strip']);
            await waitForModels(h);

            // The strip repaints on farm ticks, so the model field lands one tick after the picker
            // filled itself — wait for the LAST field to arrive, not the first.
            const first = await h.waitFor(() => {
                const el = document.querySelector('#lolchat .chat-strip');
                const has = el && el.querySelector('[data-field="model"]') && el.querySelector('[data-field="seats"]');
                return has ? el.textContent : null;
            });
            h.note(`strip: ${first}`);
            const s = await strip(h);
            h.eq(s.byField.engine, 'llama.cpp', 'the engine the farm is really running');
            h.eq(s.byField.seats, '1/2 seats');
            h.eq(s.byField.gpu, 'GPU 3%');
            h.eq(s.byField.tokSec, '48 tok/s');
            h.eq(s.byField.model, 'assistant (Qwen3.8-27B-UD-Q2_K_XL)', 'the alias AND what it really is');
            h.assert(s.title.split('\n').length >= 5, `the title carries every field: ${JSON.stringify(s.title)}`);

            // ONE line, and it must not eat the conversation: the strip sits between the topline and
            // the message list, so a strip that wraps — or that the flex column lets grow — would
            // push the list off the screen. (This is exactly how the P1 stick-to-bottom scenario
            // caught the first version of css/strip.css.)
            const geom = await h.eval(() => {
                const el = document.querySelector('#lolchat .chat-strip');
                const list = document.getElementById('chat-messages');
                const r = el.getBoundingClientRect();
                return {
                    stripHeight: Math.round(r.height),
                    listClient: list.clientHeight,
                    scrollWidth: el.scrollWidth,
                    clientWidth: el.clientWidth,
                };
            });
            h.note(`geometry: ${JSON.stringify(geom)}`);
            h.assert(geom.stripHeight > 0 && geom.stripHeight <= 32, `one line, not a paragraph: ${geom.stripHeight} px`);
            h.assert(geom.listClient > 200, `the message list keeps its height: ${geom.listClient} px`);

            // A farm that advertises no usage has NO GPU field — never "GPU —".
            await h.setFarm({ usage: null });
            await h.waitFor(() => (document.querySelector('#lolchat .chat-strip [data-field="gpu"]') ? null : true));
            const noGpu = await strip(h);
            h.eq(noGpu.fields.includes('gpu'), false);
            h.assert(!/[—–]|\s-\s/.test(noGpu.text), `never a dash for a missing value: ${noGpu.text}`);
            h.eq(noGpu.byField.seats, '1/2 seats', 'the fields that ARE known stay');

            // Discovery marked the farm stale.
            await h.setFarm({ _stale: true });
            await h.waitFor(() => {
                const f = document.querySelector('#lolchat .chat-strip [data-field="silent"]');
                return f ? f.textContent : null;
            });
            h.eq((await strip(h)).fields[0], 'silent', 'and it leads the line');
            await h.setFarm({ _stale: false });
            await h.waitFor(() => (document.querySelector('#lolchat .chat-strip [data-field="silent"]') ? null : true));

            // The other half of §3.9: no _stale flag, just a snapshot nobody refreshed.
            await h.pause(true);
            await h.setFarm({ _lastSeen: Date.now() - 20000 });
            const silent = await h.waitFor(() => {
                const f = document.querySelector('#lolchat .chat-strip [data-field="silent"]');
                return f ? f.textContent : null;
            });
            h.eq(silent, 'farm silent', 'an old lastSeen is "silent" too, evaluated on the tick');
            await h.setFarm({ _lastSeen: Date.now() });
            await h.pause(false);
            await h.waitFor(() => (document.querySelector('#lolchat .chat-strip [data-field="silent"]') ? null : true));

            // The model is the one CLIENT-side field on the strip, and it was bound only to the
            // farm's clock: after a deliberate model switch the strip disagreed with the picker
            // beside it for a whole publish interval — 4 s in production (P2 review). With the farm
            // paused there is no tick at all, so this only passes if the picker itself drives it.
            await h.pause(true);
            const wasModel = (await strip(h)).byField.model;
            const picked = await h.eval(() => {
                const sel = /** @type {HTMLSelectElement} */ (document.getElementById('chat-model'));
                const other = [...sel.options].map((o) => o.value).find((v) => v && v !== sel.value);
                sel.value = other;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return other;
            });
            const nowModel = (await strip(h)).byField.model;
            h.note(`model field: "${wasModel}" → "${nowModel}" (picked ${picked}) with the farm paused`);
            h.assert(nowModel !== wasModel, 'the strip followed the picker with no farm tick at all');
            h.eq(nowModel.indexOf(picked), 0, 'and it says the model that was actually picked');

            // P2 review, minor: the other half of the same field. A <select> filled PROGRAMMATICALLY
            // fires no 'change' — which is how the picker fills it at boot, when /v1/models lands and
            // whenever §3.10 re-applies a thread's pick — so the strip's most-read field was simply
            // missing for up to one publish interval (4 s in production) after every launch.
            const wasSet = (await strip(h)).byField.model;
            const set = await h.eval(() => {
                const sel = /** @type {HTMLSelectElement} */ (document.getElementById('chat-model'));
                const other = [...sel.options].map((o) => o.value).find((v) => v && v !== sel.value);
                window.LolChat.app.picker.set(other);
                return { want: other, value: sel.value };
            });
            h.eq(set.value, set.want, 'the picker really moved the select');
            const afterSet = (await strip(h)).byField.model;
            h.note('model field after a programmatic pick: "' + wasSet + '" -> "' + afterSet + '"');
            h.assert(afterSet !== wasSet, 'and the strip followed a pick nobody clicked');
            h.eq(afterSet.indexOf(set.want), 0, 'saying the model that was actually applied');
            await h.pause(false);
        },
    },

    // ------------------------------------------------------------------------------------------
    {
        name: 'p2-notify',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await h.fresh({ refreshMs: 500, flags: { notifyAfterMs: 500 } });
            await requireReal(h, ['notify']);
            await waitForModels(h);

            const notifications = await h.spy.notifications();
            // The spy replaces window.Notification AFTER mount, and hasFocus is stubbed the same
            // way: notify must read both AT FIRE TIME (§2.6 AJ).
            await h.eval(() => { document.hasFocus = () => false; return true; });

            await newChat(h);
            await pickModel(h, 'mock-slow');
            await sendHere(h, 'take your time');
            await h.waitFor(() => (document.querySelector('.chat-msg.assistant[data-status="streaming"]') ? true : null));

            await h.sleep(2000);                     // long enough to have walked away
            await h.click('#chat-stop');
            await h.waitFor(() => (document.querySelector('.chat-msg.assistant[data-status="aborted"]') ? true : null));

            const seen = await h.waitFor(async () => {
                const list = window.__spyNotifications || [];
                return list.length ? list : null;
            });
            h.eq(seen.length, 1, `exactly one notification: ${JSON.stringify(seen)}`);
            const thread = await h.eval(async () => {
                const app = window.LolChat.app;
                const t = await app.repo.getThread(app.state.threadId);
                return t ? t.title : null;
            });
            h.eq(seen[0].title, thread, 'titled with the conversation, so a stack of them is readable');
            h.eq(typeof seen[0].options.body, 'string', 'and carries a teaser body');

            // A chat with no title yet must not announce itself as "Notifications" — that key is the
            // SETTINGS SECTION heading, and sharing it made the desktop toast name the feature
            // instead of the conversation (P2 review).
            await notifications.clear();
            await h.eval(async () => {
                const app = window.LolChat.app;
                await app.repo.updateThread(app.state.threadId, { title: '' });
                return true;
            });
            await sendHere(h, 'and once more');
            await h.waitFor(() => (document.querySelector('.chat-msg.assistant[data-status="streaming"]') ? true : null));
            await h.sleep(1500);
            await h.click('#chat-stop');
            const untitled = await h.waitFor(async () => {
                const list = window.__spyNotifications || [];
                return list.length ? list : null;
            });
            h.note(`untitled-chat notification: ${JSON.stringify(untitled[0].title)}`);
            h.assert(untitled[0].title !== 'Notifications', 'never the settings-section heading');
            h.eq(untitled[0].title, 'LOL Chat — your reply is ready', 'its own fallback string');

            // The reader turns it off: the preference is honoured without a reload.
            await h.eval(async () => {
                await window.LolChat.app.repo.kvSet('pref:notify', false);
                return true;
            });
            await notifications.clear();
            await sendHere(h, 'again please');
            await h.waitFor(() => (document.querySelector('.chat-msg.assistant[data-status="streaming"]') ? true : null));
            await h.sleep(1500);
            await h.click('#chat-stop');
            await h.waitFor(() => (document.querySelectorAll('.chat-msg.assistant[data-status="aborted"]').length >= 2 ? true : null));
            h.eq((await notifications()).length, 0, 'pref:notify false means silence');
        },
    },
];
