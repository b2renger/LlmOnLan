// @ts-check
// P1-U2 in the real browser against the real mock farm: the controller, the composer and the model
// picker end to end. The unit tests prove the controller's logic in Node against a stubbed fetch;
// only these scenarios can prove the DOM half — the submit pipeline, IME Enter, the lock, the
// picker's farm-honest selection across threads and reloads, and the exact wire body.
//
// Every scenario first asserts that the P1-U2 modules are REAL: while a unit has not landed,
// main.mjs silently substitutes core/fakes.mjs, and a green run against a fake would mean nothing.

const COMPLETIONS = '/v1/chat/completions';

/** Network noise the farm's own error paths make in the console (4xx bodies, a killed socket). */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when this unit's modules were replaced by fakes. */
const requireReal = (/** @type {any} */ h, /** @type {string[]} */ keys = ['controller', 'composer', 'picker']) =>
    h.eval((want) => {
        const failed = (window.LolChat && window.LolChat.failed) || {};
        const missing = want.filter((k) => failed[k]);
        if (missing.length) {
            throw new Error(`P1-U2 needs the REAL modules, but the loader faked: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
        }
        return true;
    }, keys);

/** Wait until the farm reached the page AND the picker filled itself from /v1/models. */
const waitForModels = (/** @type {any} */ h) => h.waitFor(() => {
    const select = document.getElementById('chat-model');
    return !!(window.__lolFarm && select && select.options.length > 1) || null;
});

const modelState = (/** @type {any} */ h) => h.eval(() => {
    const select = /** @type {HTMLSelectElement} */ (document.getElementById('chat-model'));
    return {
        value: select.value,
        options: Array.prototype.map.call(select.options, (o) => o.value),
        labels: Array.prototype.map.call(select.options, (o) => o.textContent),
    };
});

/** Pick a model the way a user does: change the <select>, then let the picker settle. */
const pickModel = async (/** @type {any} */ h, /** @type {string} */ id) => {
    await h.eval((want) => {
        const select = /** @type {HTMLSelectElement} */ (document.getElementById('chat-model'));
        select.value = want;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return select.value;
    }, id);
    await h.waitFor((want) => (document.getElementById('chat-model').value === want ? true : null), { args: [id] });
};

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

/** The last assistant ROW as the user sees it. */
const lastRow = (/** @type {any} */ h) => h.eval(() => {
    const rows = document.querySelectorAll('.chat-msg.assistant');
    const row = rows[rows.length - 1];
    if (!row) return null;
    const stats = row.querySelector('.chat-stats');
    const note = row.querySelector('.chat-msg-note');
    const body = row.querySelector('.chat-body');
    return {
        id: row.getAttribute('data-id'),
        status: row.getAttribute('data-status'),
        text: body ? body.textContent : row.textContent,
        note: note ? note.textContent.trim() : '',
        stats: stats ? stats.textContent.trim() : '',
        reasoning: row.querySelector('details.chat-reasoning') ? row.querySelector('.chat-reasoning-body, details.chat-reasoning').textContent : null,
        all: row.textContent,
    };
});

/** The last assistant RECORD, straight out of the store (render-independent). */
const lastRecord = (/** @type {any} */ h) => h.eval(async () => {
    const app = window.LolChat.app;
    if (!app.state.threadId) return null;
    const path = await app.repo.getPath(app.state.threadId);
    for (let i = path.length - 1; i >= 0; i--) if (path[i].role === 'assistant') return path[i];
    return null;
});

/** Wait until the last assistant message has stopped moving. */
const waitSettled = (/** @type {any} */ h, opts = {}) => h.waitFor(() => {
    const rows = document.querySelectorAll('.chat-msg.assistant');
    const row = rows[rows.length - 1];
    if (!row) return null;
    const status = row.getAttribute('data-status');
    return status && status !== 'streaming' ? status : null;
}, { timeout: opts.timeout || 30000 });

/** The composer ignores a submit until the governor is idle again (Send is back, §3.6.1). */
const waitIdle = (/** @type {any} */ h) => h.waitFor(() => (
    !document.getElementById('chat-send').classList.contains('hidden')
    && window.LolChat.app.gov.state().foreground === 'idle' ? true : null));

/** Wait until the Nth assistant row exists, has settled, and the client is idle again. */
const waitReplyN = async (/** @type {any} */ h, /** @type {number} */ n, opts = {}) => {
    await h.waitFor((want) => {
        const rows = document.querySelectorAll('.chat-msg.assistant');
        if (rows.length < want) return null;
        const status = rows[want - 1].getAttribute('data-status');
        return status && status !== 'streaming' ? status : null;
    }, { args: [n], timeout: opts.timeout || 30000 });
    await waitIdle(h);
};

const completions = async (/** @type {any} */ h, since = 0) => (await h.mock.log({ path: COMPLETIONS, since })).filter((e) => e.method === 'POST');

export default [
    {
        name: 'p1-basic-stream',
        needsMock: true,
        // The e2e.js mirror: one send, a streamed reply with reasoning, and the parity stats line.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await h.submit('hello there');
            const reply = await h.waitReply();
            await waitIdle(h);

            h.assert(/^\d+ tok · \d+\.\d tok\/s · first token \d+\.\d\ds$/.test(reply.stats), `stats format: "${reply.stats}"`);
            const tokPerSec = parseFloat(reply.stats.split('·')[1]);
            h.assert(tokPerSec > 150, `the render path must keep up with the farm: ${tokPerSec} tok/s`);
            h.assert(/first token \d+\.\d\ds$/.test(reply.stats), 'two decimals on the first-token time (chat.js:293)');
            h.assert(reply.reasoning && reply.reasoning.includes('think0'), 'the reasoning block is shown');
            h.assert(reply.text.includes('tok0 ') && reply.text.includes('tok999'), 'the whole answer landed');

            const posts = await completions(h);
            h.eq(posts.length, 1, 'exactly one completion');
            h.eq(posts[0].model, 'assistant', 'the farm default was auto-selected');
            h.assert(posts[0].body.stream === true, 'streamed');

            const record = await lastRecord(h);
            h.eq(record.status, 'done');
            h.eq(record.model, 'assistant');
            h.eq(record.underlying, 'Qwen3.8-27B-UD-Q2_K_XL', 'the stamp carries what the farm really runs');
            h.eq(record.farmId, 'mockfarm0001');
            h.eq(record.stats.text, reply.stats);
            h.note(`${reply.stats} · ${record.content.length} chars`);
        },
    },

    {
        name: 'p1-models',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // §3.10: the catalog, the advertised default, and the four placeholders.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            const served = await modelState(h);
            h.assert(served.options.includes('assistant') && served.options.includes('gemma4:12b'), `catalog: ${served.options.slice(0, 4)}`);
            h.eq(served.value, 'assistant', 'the farm default is preselected');

            await h.setFarm(null);
            await h.waitFor(() => {
                const select = document.getElementById('chat-model');
                return select.options.length === 1 && select.options[0].textContent === 'no farm' ? true : null;
            });

            await h.setFarm({});                                   // the farm comes back
            await waitForModels(h);
            h.eq((await modelState(h)).value, 'assistant');

            await h.mock.state({ proxyDown: true });
            await h.eval(() => window.LolChat.app.picker.refresh({ force: true }));
            await h.waitFor(() => {
                const select = document.getElementById('chat-model');
                return select.options.length === 1 && select.options[0].textContent === 'unreachable' ? true : null;
            });

            await h.mock.state({ proxyDown: false });
            await h.publishFarm();                                  // the next farm tick retries
            await waitForModels(h);
            h.eq((await modelState(h)).value, 'assistant', 'the picker recovers on its own');
        },
    },

    {
        name: 'p1-model-memory',
        needsMock: true,
        // A pick belongs to ONE thread. A new thread always starts on what the farm advertises.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);

            await h.submit('thread A');                              // new thread, farm default
            await waitReplyN(h, 1);
            const threadA = await h.eval(() => window.LolChat.app.state.threadId);

            await pickModel(h, 'gemma4:12b');
            await sendHere(h, 'still thread A');
            await waitReplyN(h, 2);
            const posts = await completions(h);
            h.eq(posts.length, 2);
            h.eq(posts[1].model, 'gemma4:12b', 'the pick applies to the thread it was made in');

            await newChat(h);                                        // thread B
            await h.waitFor(() => (window.LolChat.app.state.threadId ? true : null));
            const threadB = await h.eval(() => window.LolChat.app.state.threadId);
            h.assert(threadB !== threadA, 'a second thread');
            await h.waitFor(() => (document.getElementById('chat-model').value === 'assistant' ? true : null));

            await h.reload({});                                      // same IndexedDB, new page
            await requireReal(h);
            await waitForModels(h);
            await h.eval((id) => window.LolChat.app.controller.selectThread(id), threadA);
            await h.waitFor(() => (document.getElementById('chat-model').value === 'gemma4:12b' ? true : null));
            await newChat(h);
            await h.waitFor(() => (document.getElementById('chat-model').value === 'assistant' ? true : null));

            // The farm changes its mind about the default: a new thread follows the farm.
            await h.setFarm({ models: [{ id: 'gemma4:12b', underlying: 'gemma4:12b', default: true }, { id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: false }] });
            await newChat(h);
            await h.waitFor(() => (document.getElementById('chat-model').value === 'gemma4:12b' ? true : null));
        },
    },

    {
        name: 'p1-new-thread-pick',
        needsMock: true,
        // The pick a user makes IMMEDIATELY after New chat must be the model that is asked.
        // Regression for a race found at the P1 landing: clicking New chat emits THREAD_SELECTED,
        // whose handler asynchronously re-applies the §3.10 rule; a pick made in the same beat wrote
        // {model, modelSource:'user'} to the store WITHOUT awaiting it, so the re-apply read a thread
        // still on the farm default and put the <select> back to it — while the thread record said
        // otherwise. The send then went to `assistant` instead of the picked model, and the picker
        // only healed on the next farm tick (up to 4 s later). Three rounds, because it was flaky.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);

            const rounds = ['mock-echo', 'mock-md', 'mock-echo'];
            for (let i = 0; i < rounds.length; i++) {
                const model = rounds[i];
                await newChat(h);
                // Not pickModel(): its "wait until the <select> shows it" loop would absorb the very
                // revert this scenario is about (it healed on the next farm tick, 4 s later, and the
                // run just looked slow). Set it the way the change event does, and move on.
                const chosen = await h.eval((want) => {
                    const select = /** @type {HTMLSelectElement} */ (document.getElementById('chat-model'));
                    select.value = want;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return select.value;
                }, model);
                h.eq(chosen, model, `round ${i}: the farm does not serve ${model}`);
                // The revert landed a few ms later, so a plain read right after pickModel could
                // still see the right value. Give the THREAD_SELECTED handler its turn first —
                // 400 ms is far more than it needs and far less than the 4 s farm tick that used
                // to heal the <select> — and only THEN look.
                await new Promise((r) => setTimeout(r, 400));
                const held = await h.eval(() => document.getElementById('chat-model').value);
                h.eq(held, model, `round ${i}: the picker reverted the choice on its own`);
                await sendHere(h, `round ${i} on ${model}`);
                await waitSettled(h);
                const posts = await completions(h);
                h.eq(posts.length, i + 1, 'one completion per round');
                h.eq(posts[i].model, model, `round ${i}: the farm was asked for "${posts[i].model}", not the picked "${model}"`);
                const shown = await h.eval(() => document.getElementById('chat-model').value);
                h.eq(shown, model, `round ${i}: the picker drifted off the user's choice`);
                const stamped = await lastRecord(h);
                h.eq(stamped.model, model, `round ${i}: the message was stamped with the wrong model`);
            }
        },
    },

    {
        name: 'p1-errors',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Every failure a farm can hand a client, read back as a sentence a colleague understands.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);

            // mock-429 left this loop at the P2 landing. A `seats_full` refusal is no longer an
            // error row: P2-U1 turns it into a WAITING row that holds the foreground slot until a
            // seat frees, the reader cancels, or the wait gives up (§4 P2-U1). The P1 intent —
            // the farm's own sentence, read back verbatim instead of "HTTP 429" — is asserted
            // here on the waiting row, and Stop then hands the client back to the loop below.
            await newChat(h);
            await pickModel(h, 'mock-429');
            await sendHere(h, 'please fail with mock-429');
            const seatsNote = await h.waitFor(() => {
                const rows = document.querySelectorAll('.chat-msg.assistant[data-status="waiting"]');
                const row = rows[rows.length - 1];
                const note = row && row.querySelector('.chat-msg-note');
                return note && note.textContent.trim().length > 20 ? note.textContent.trim() : null;
            }, { timeout: 20000 });
            h.assert(!/^HTTP \d+$/.test(seatsNote), `"${seatsNote}" is the old raw-status text`);
            h.assert(seatsNote.includes('seats on this server are in use'), seatsNote);
            h.assert(seatsNote.includes('ask around'), 'the farm sentence is quoted verbatim');
            const seatsRecord = await lastRecord(h);
            h.eq(seatsRecord.status, 'waiting', 'a full farm is waited on, not reported as an error');
            h.eq(seatsRecord.error.kind, 'seats_full');
            await h.click('#chat-stop');
            await waitIdle(h);

            /** @type {any} */
            const seen = {};
            for (const model of ['mock-502', 'mock-midstream-error', 'mock-reset', 'mock-context-overflow']) {
                await newChat(h);
                await pickModel(h, model);
                await sendHere(h, `please fail with ${model}`);
                await waitSettled(h);
                const row = await lastRow(h);
                const record = await lastRecord(h);
                seen[model] = { note: row.note, kind: record.error && record.error.kind, content: record.content, status: record.status };
                h.assert(row.note.length > 20, `${model}: the note must be a sentence, got "${row.note}"`);
                h.assert(!/^HTTP \d+$/.test(row.note.trim()), `${model}: "${row.note}" is the old raw-status text`);
            }

            h.eq(seen['mock-502'].kind, 'upstream_down');
            h.assert(seen['mock-502'].note.includes('The model server is not answering'), seen['mock-502'].note);

            h.eq(seen['mock-midstream-error'].kind, 'stream_error');
            h.assert(seen['mock-midstream-error'].content.startsWith('tok0 '), 'the partial survives a mid-stream error');
            h.assert(seen['mock-midstream-error'].content.includes('tok49'), 'all 50 tokens survive');

            h.eq(seen['mock-reset'].kind, 'network');
            h.eq(seen['mock-context-overflow'].kind, 'context_overflow');
            h.assert(/context/i.test(seen['mock-context-overflow'].note), seen['mock-context-overflow'].note);

            // A farm that went busy mid-stream explains itself instead of showing the raw error.
            // 1 delta per 60 ms: the 50 tokens take ~3 s, so the farm can go busy WHILE it streams.
            await h.mock.state({ streamRate: { tickMs: 60, perTick: 1 } });
            await newChat(h);
            await pickModel(h, 'mock-midstream-error');
            await sendHere(h, 'fail while switching');
            await h.waitFor(() => {
                const rows = document.querySelectorAll('.chat-msg.assistant');
                const last = rows[rows.length - 1];
                const body = last && last.querySelector('.chat-body');
                return body && body.textContent.includes('tok2') ? true : null;
            });
            await h.setFarm({ busy: { label: 'Switching model' } });
            await waitSettled(h);
            await h.mock.state({ streamRate: null });
            const busyNote = (await lastRow(h)).note;
            h.assert(busyNote.includes('⏳ The server is busy: Switching model. Try again in a moment.'), `busy note: "${busyNote}"`);
            h.assert(!busyNote.includes('upstream exploded'), 'the busy sentence replaces the raw one');
        },
    },

    {
        name: 'p1-busy-and-key',
        needsMock: true,
        // Two answers the client gives WITHOUT asking the farm anything.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);

            await h.setFarm({ busy: { label: 'Switching model', percent: 40 } });
            await h.submit('anyone home?');
            await waitSettled(h);
            const busy = await lastRow(h);
            h.eq(busy.status, 'local');
            // A 'local' message IS its note (plan §3.5: the note row carries busy/waiting/error
            // text); the markdown body stays empty, so read the note, not `.chat-body`.
            h.assert(busy.note.includes('40%'), `the percentage is shown: "${busy.note}"`);
            h.assert(busy.note.includes('⏳ The server is busy: Switching model'), busy.note);
            h.eq(busy.text, '', 'a client-written note is never markdown-rendered into the body');
            h.eq((await completions(h)).length, 0, 'a busy farm is never asked');

            await h.setFarm({ busy: null, requiresKey: true, _key: null, _hasKey: false });
            await h.submit('and now?');
            await waitSettled(h);
            const keyless = await lastRow(h);
            h.assert(keyless.note.includes('Password needed'), `key note: "${keyless.note}"`);
            h.eq((await completions(h)).length, 0, 'no password, no request');

            // A farm whose password we DO have: the Bearer rides on models and completions.
            const since = Date.now();
            await h.reload({ farm: 'keyed' });
            await requireReal(h);
            await waitForModels(h);
            await h.submit('hello keyed farm');
            await h.waitReply();
            await waitIdle(h);
            const log = await h.mock.log({ since });
            const models = log.filter((e) => e.path === '/v1/models');
            const posts = log.filter((e) => e.path === COMPLETIONS);
            h.assert(models.length >= 1 && models.every((e) => e.headers.authorization === 'Bearer harness-pw'), 'models carried the password');
            h.assert(posts.length === 1 && posts[0].headers.authorization === 'Bearer harness-pw', 'the completion carried the password');
            h.note(`${models.length} model fetches + ${posts.length} completion, all with the farm password`);
        },
    },

    {
        name: 'p1-key-rotation',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The farm's password changed under us: say so, and recover when it is right again.
        run: async (h) => {
            await h.reload({ farm: 'keyed' });
            await requireReal(h);
            await waitForModels(h);

            await h.setFarm({ _key: 'wrong' });
            for (let i = 0; i < 2; i++) {
                await h.publishFarm();
                await h.sleep(150);
            }
            await h.waitFor(() => {
                const select = document.getElementById('chat-model');
                return select.options.length === 1 && select.options[0].textContent === 'password refused' ? true : null;
            });

            await h.submit('let me in');
            await waitSettled(h);
            const record = await lastRecord(h);
            h.eq(record.error.kind, 'auth', `a wrong password is an auth note, not a network one (${record.error.message})`);

            await h.setFarm({ _key: 'harness-pw' });
            await h.publishFarm();
            await waitForModels(h);
            await h.submit('and now?');
            await h.waitReply();
            await waitIdle(h);
            const posts = await completions(h);
            h.eq(posts[posts.length - 1].headers.authorization, 'Bearer harness-pw', 'the new password is used at request time');
        },
    },

    {
        name: 'p1-fallback-branch',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // No discovered farm: the renderer falls back to the sidecar endpoint, which carries NO
        // password. The client must call that what it is (auth), not "the network is down".
        run: async (h) => {
            await h.reload({ farm: 'fallback-keyed' });
            await requireReal(h);
            await h.waitFor(() => (window.__lolFarm && window.__lolFarm.openaiBaseUrl ? true : null));
            await h.submit('hello?');
            await waitSettled(h);
            const record = await lastRecord(h);
            h.eq(record.error.kind, 'auth', `the fallback bridge must classify as auth (got ${record.error.kind}: ${record.error.message})`);
            h.eq(record.status, 'error');
            const row = await lastRow(h);
            h.assert(row.note.length > 10 && !/^HTTP/.test(row.note), `a readable note: "${row.note}"`);
        },
    },

    {
        name: 'p1-stop',
        needsMock: true,
        timeoutMs: 90000,
        // Stop means stop: the socket closes, the partial stays, the row says aborted.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);
            await pickModel(h, 'mock-slow');
            await sendHere(h, 'take your time');

            await h.waitFor(() => {
                const rows = document.querySelectorAll('.chat-msg.assistant');
                const last = rows[rows.length - 1];
                const body = last && last.querySelector('.chat-body');
                return body && body.textContent.includes('tok2') ? true : null;
            }, { timeout: 30000 });

            const stopVisible = await h.eval(() => ({
                stop: !document.getElementById('chat-stop').classList.contains('hidden'),
                send: !document.getElementById('chat-send').classList.contains('hidden'),
                inputEnabled: !document.getElementById('chat-input').disabled,
            }));
            h.assert(stopVisible.stop && !stopVisible.send, 'Stop replaces Send while a reply runs');
            h.assert(stopVisible.inputEnabled, 'the textarea stays enabled (it did not in v0.1.45)');

            await h.click('#chat-stop');
            const status = await waitSettled(h);
            h.eq(status, 'aborted');
            const record = await lastRecord(h);
            h.assert(record.content.startsWith('tok0 '), `the partial is kept: "${record.content.slice(0, 40)}"`);
            h.assert(record.content.length < 6000, 'it really stopped early');

            const posts = await completions(h);
            h.eq(posts.length, 1);
            h.assert(posts[0].closedEarly === true, 'the farm saw the client walk away (the seat frees)');
            const after = await h.eval(() => ({
                stop: !document.getElementById('chat-stop').classList.contains('hidden'),
                send: !document.getElementById('chat-send').classList.contains('hidden'),
            }));
            h.assert(after.send && !after.stop, 'Send is back');
        },
    },

    {
        name: 'p1-ime',
        needsMock: true,
        // Enter is a send only when it is not committing an IME candidate.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);

            await h.type('#chat-input', 'にほんご');
            const composing = await h.key('#chat-input', 'Enter', { isComposing: true });
            h.assert(composing.isComposing === true, 'the harness really dispatched a composing Enter');
            h.eq(composing.defaultPrevented, false, 'a composing Enter is left to the IME');

            await h.key('#chat-input', 'Enter', { keyCode: 229 });
            const shift = await h.key('#chat-input', 'Enter', { shift: true });
            h.eq(shift.defaultPrevented, false, 'Shift+Enter keeps the browser default (a newline)');

            await h.sleep(150);
            h.eq((await completions(h)).length, 0, 'none of the three sent anything');
            h.eq(await h.eval(() => document.getElementById('chat-input').value), 'にほんご', 'the draft is untouched');

            // The positive control: a plain Enter DOES send (otherwise this test proves nothing).
            const plain = await h.key('#chat-input', 'Enter', {});
            h.eq(plain.defaultPrevented, true, 'a plain Enter is handled by the composer');
            await h.waitReply();
            h.eq((await completions(h)).length, 1);
        },
    },

    {
        name: 'p1-double-submit',
        needsMock: true,
        // A slow gate (a confirm dialog, P2's cost gate) must not let three Enters become three
        // replies — the lock covers the WHOLE gate/enrich chain (§3.6.1).
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);

            await h.eval(() => {
                const app = window.LolChat.app;
                window.__gateRuns = 0;
                app.registry.add(app.SLOTS.BEFORE_SEND, {
                    id: 'test-slow-gate',
                    order: 100,
                    stage: 'gate',
                    run: (draft) => new Promise((resolve) => {
                        window.__gateRuns += 1;
                        setTimeout(() => resolve(draft), 1000);
                    }),
                });
                return true;
            });

            await h.type('#chat-input', 'one reply please');
            await h.key('#chat-input', 'Enter', {});
            await h.sleep(250);
            h.eq(await h.eval(() => window.LolChat.app.composer.isLocked()), true, 'the composer is locked for the whole chain');
            h.eq(await h.eval(() => document.getElementById('chat-send').textContent), 'Preparing…', 'after 150 ms the button says so');

            await h.key('#chat-input', 'Enter', {});
            await h.key('#chat-input', 'Enter', {});
            await h.waitReply();
            await h.sleep(300);

            h.eq(await h.eval(() => window.__gateRuns), 1, 'the gate ran once');
            h.eq((await completions(h)).length, 1, 'exactly one completion');
            h.eq(await h.eval(() => document.querySelectorAll('.chat-msg.user').length), 1, 'one user message');
            h.eq(await h.eval(() => document.getElementById('chat-send').textContent), 'Send', 'the label is restored');
        },
    },

    {
        name: 'p1-composer-parts',
        needsMock: true,
        // The part tray: what P3 (images, documents, scenes) and P4 build on. A chip carries its
        // label, an optional thumb and a remove x; the CHIP_ACTIONS menu opens from the label; and
        // every one of add/update/remove emits DRAFT_CHANGE with the CURRENT draft.
        run: async (h) => {
            await requireReal(h, ['composer']);
            await waitForModels(h);

            const added = await h.eval(() => {
                const app = window.LolChat.app;
                window.__drafts = [];
                window.__ran = [];
                window.__offDraft = app.bus.on(app.EV.DRAFT_CHANGE, (d) => window.__drafts.push({
                    text: d.text, parts: (d.parts || []).map((p) => `${p.type}:${p.label || ''}`),
                }));
                app.registry.add(app.SLOTS.CHIP_ACTIONS, {
                    id: 'test-chip-action',
                    order: 100,
                    label: 'Do the thing',
                    run: (part, key) => window.__ran.push(`${part.type}/${key}`),
                });
                const key = app.composer.addPart(
                    { type: 'image', attId: 'att-1', label: 'shot' },
                    { label: 'shot.png', thumbDataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', status: 'extracting' },
                );
                const tray = document.querySelector('.chat-composer-tray');
                const chip = tray.querySelector('.chat-chip');
                return {
                    key,
                    trayHidden: tray.classList.contains('hidden'),
                    chips: tray.querySelectorAll('.chat-chip').length,
                    cls: chip.className,
                    type: chip.dataset.type,
                    label: chip.querySelector('.chat-chip-label').textContent,
                    thumb: !!chip.querySelector('img.chat-chip-thumb'),
                    x: chip.querySelector('.chat-chip-x').textContent,
                    drafts: window.__drafts.length,
                    lastDraft: window.__drafts[window.__drafts.length - 1],
                };
            });
            h.eq(added.chips, 1, 'the part became one chip');
            h.eq(added.trayHidden, false, 'the tray shows as soon as it has a chip');
            h.eq(added.label, 'shot.png', 'the chip wears the label it was given');
            h.assert(added.thumb, 'the data: thumb is rendered');
            h.eq(added.x, '\u00d7', 'a remove x');
            h.eq(added.type, 'image', 'the chip records the part type');
            h.assert(added.cls.includes('is-extracting'), `the status rides on the chip: ${added.cls}`);
            h.eq(added.drafts, 1, 'addPart emitted exactly one DRAFT_CHANGE');
            h.eq(JSON.stringify(added.lastDraft.parts), JSON.stringify(['image:shot']), 'the draft carries the part');

            // The CHIP_ACTIONS menu opens from the label and runs the action with (part, key).
            const menu = await h.eval(() => {
                const chip = document.querySelector('.chat-chip');
                chip.querySelector('.chat-chip-label').click();
                const item = document.querySelector('.chat-popover .chat-menu-item');
                const label = item ? item.textContent : null;
                if (item) item.click();
                return { label, ran: window.__ran.slice() };
            });
            h.eq(menu.label, 'Do the thing', 'the CHIP_ACTIONS item is offered');
            h.eq(JSON.stringify(menu.ran), JSON.stringify([`image/${added.key}`]), 'the action ran with the part and its key');

            const updated = await h.eval((key) => {
                const app = window.LolChat.app;
                app.composer.updatePart(key, { label: 'shot.png (3 pages)', status: 'ready', part: { type: 'doc', attId: 'att-1', label: 'shot' } });
                const chip = document.querySelector('.chat-chip');
                return {
                    label: chip.querySelector('.chat-chip-label').textContent,
                    cls: chip.className,
                    type: chip.dataset.type,
                    drafts: window.__drafts.length,
                    lastDraft: window.__drafts[window.__drafts.length - 1],
                };
            }, added.key);
            h.eq(updated.label, 'shot.png (3 pages)', 'updatePart re-renders the chip');
            h.assert(updated.cls.includes('is-ready') && !updated.cls.includes('is-extracting'), updated.cls);
            h.eq(updated.type, 'doc', 'a replaced part replaces what the chip says it is');
            h.eq(updated.drafts, 2, 'updatePart emitted DRAFT_CHANGE');
            h.eq(JSON.stringify(updated.lastDraft.parts), JSON.stringify(['doc:shot']), 'the draft sees the new part');

            // The x removes the chip - and a removed part leaves the draft.
            const removed = await h.eval(() => {
                document.querySelector('.chat-chip-x').click();
                const tray = document.querySelector('.chat-composer-tray');
                return {
                    chips: tray.querySelectorAll('.chat-chip').length,
                    trayHidden: tray.classList.contains('hidden'),
                    drafts: window.__drafts.length,
                    parts: window.LolChat.app.composer.getDraft().parts.length,
                };
            });
            h.eq(removed.chips, 0, 'the x removed the chip');
            h.eq(removed.trayHidden, true, 'an empty tray hides again');
            h.eq(removed.drafts, 3, 'removePart emitted DRAFT_CHANGE');
            h.eq(removed.parts, 0, 'the draft is empty again');

            // A send clears the tray with the text (the draft is one object, not two).
            const afterSend = await h.eval(() => {
                const app = window.LolChat.app;
                app.composer.addPart({ type: 'image', attId: 'att-2' }, { label: 'second' });
                app.composer.setText('with an attachment');
                return { parts: app.composer.getDraft().parts.length, text: app.composer.getDraft().text };
            });
            h.eq(afterSend.parts, 1);
            h.eq(afterSend.text, 'with an attachment');
            await h.eval(() => { document.getElementById('chat-form').requestSubmit(); return true; });
            await h.waitReply();
            await waitIdle(h);
            const cleared = await h.eval(() => {
                const app = window.LolChat.app;
                if (window.__offDraft) window.__offDraft();
                return {
                    chips: document.querySelectorAll('.chat-chip').length,
                    text: document.getElementById('chat-input').value,
                    parts: app.composer.getDraft().parts.length,
                };
            });
            h.eq(cleared.chips, 0, 'the tray is empty after a send');
            h.eq(cleared.text, '', 'so is the textarea');
            h.eq(cleared.parts, 0);
            h.eq((await completions(h)).length, 1, 'one completion');
        },
    },

    {
        name: 'p1-request-shape',
        needsMock: true,
        // What actually goes on the wire (mock-echo reports the request back as text).
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);

            await sendHere(h, 'first turn, with reasoning');          // `assistant` streams reasoning
            await waitReplyN(h, 1);

            await pickModel(h, 'mock-echo');
            await sendHere(h, 'now echo the request');
            await waitReplyN(h, 2);

            const record = await lastRecord(h);
            const lines = String(record.content).split('\n');
            const field = (/** @type {string} */ name) => {
                const hit = lines.find((l) => l.startsWith(`${name}:`));
                return hit ? hit.slice(name.length + 1).trim() : null;
            };
            h.eq(field('model'), 'mock-echo');
            h.eq(field('hasReasoningField'), 'false', 'no message ever carries a reasoning field');
            h.eq(field('stream'), 'true');
            h.eq(field('roles'), 'user,assistant,user', 'the finished first turn is history');
            h.eq(field('lastRole'), 'user');
            h.eq(field('partTypes'), '', 'text-only messages send a string content, not parts');

            const body = await h.mock.lastBody();
            h.assert(body && typeof body === 'object', 'the mock kept the raw body');
            h.eq(body.stream, true);
            h.eq(JSON.stringify(body.stream_options), JSON.stringify({ include_usage: true }));
            h.assert(body.num_ctx === undefined, 'num_ctx is the FARM\'s business (chat-lint rule 2)');
            h.assert(body.options === undefined, 'no Ollama-shaped options block');
            h.assert(!JSON.stringify(body).includes('"reasoning"'), 'no reasoning on the wire');

            h.eq(record.model, 'mock-echo', 'the record is stamped with what answered it');
            h.assert('underlying' in record, 'the stamp always has the underlying field');
            h.eq(record.farmId, 'mockfarm0001');
            h.assert(record.stats && record.stats.completionTokens > 0, 'stats even for a short echo');
        },
    },
];
