// @ts-check
// Harness self-checks (plan §2.2 "h0-selfcheck", §2.6 E/F). These test the HARNESS, not LOL Chat:
// if one of them is red, every other scenario in the suite is meaningless.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = path.join(HERE, '..');
const RENDERER_DIR = path.join(HARNESS_DIR, '..', '..', 'renderer');

/** The whole `<meta http-equiv="Content-Security-Policy" … >` element, verbatim. */
function cspMeta(file) {
    const src = fs.readFileSync(file, 'utf8');
    const m = src.match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?>/i);
    if (!m) throw new Error(`no CSP meta in ${file}`);
    return m[0];
}

export default [
    {
        name: 'h0-csp-identical',
        // The whole point of the harness is that the chat runs under the SHIPPING policy. A drifted
        // copy would let code pass here and fail in the real client.
        run: async (h) => {
            const page = cspMeta(path.join(HARNESS_DIR, 'page.html'));
            const index = cspMeta(path.join(RENDERER_DIR, 'index.html'));
            h.assert(page === index, `page.html CSP differs from index.html:\n  page : ${page}\n  index: ${index}`);
            h.note(`CSP: ${page.replace(/\s+/g, ' ').slice(0, 90)}…`);
            // And it is actually ENFORCED in the harness window, not just present as text.
            const enforced = await h.eval(() => {
                const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
                return meta ? meta.getAttribute('content') : null;
            });
            h.assert(enforced && enforced.includes("script-src 'self'"), 'the page did not keep the CSP meta');
        },
    },

    {
        name: 'h0-raf-runs',
        // backgroundThrottling:false + show:false must still give the stream renderer a real rAF
        // budget; a throttled hidden window would make every streaming scenario lie.
        run: async (h) => {
            const fps = await h.eval(() => new Promise((resolve) => {
                let frames = 0;
                const t0 = performance.now();
                const tick = () => {
                    frames++;
                    if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
                    else resolve(Math.round((frames * 1000) / (performance.now() - t0)));
                };
                requestAnimationFrame(tick);
            }));
            h.note(`rAF ≈ ${fps}/s in the hidden window`);
            h.assert(fps >= 30, `hidden window runs only ${fps} rAF callbacks per second (want >= 30)`);
        },
    },

    {
        name: 'h0-no-real-lol',
        // The harness preload must expose the real preload's SHAPE and nothing more: no shell IPC,
        // no store, no sidecar — so nothing under test can accidentally depend on them.
        // S0 landing: the real preload grew exactly ONE additive property, `projects` (the
        // scratch-projects carve-out, studio plan §3.8), so the allowed shape grew by exactly that
        // one key — and its method set is pinned here against shell/src/preload/index.ts, so a
        // sixteenth method added there without a review shows up as this scenario failing.
        // K7 landing (addendum KG): ONE more additive property, `debugLog` (the Computer's debug
        // log), pinned the same way — six methods, text in, nothing read back.
        run: async (h) => {
            const shape = await h.eval(() => ({
                keys: Object.keys(window.lol || {}),
                type: typeof (window.lol && window.lol.getBlenderConnection),
                projects: window.lol && window.lol.projects ? Object.keys(window.lol.projects) : null,
                debugLog: window.lol && window.lol.debugLog ? Object.keys(window.lol.debugLog) : null,
            }));
            h.eq(shape.keys, ['getBlenderConnection', 'projects', 'debugLog'], 'window.lol exposes more than the real preload');
            h.eq(shape.debugLog, ['start', 'append', 'stop', 'mark', 'reveal', 'status'], 'window.lol.debugLog is not the real preload method set');
            h.eq(shape.projects, [
                'root', 'list', 'create', 'meta', 'update', 'forget', 'listFiles', 'read', 'readBinary',
                'write', 'writeBinary', 'remove', 'reveal', 'open', 'path',
            ], 'window.lol.projects is not the real preload method set');
            h.eq(shape.type, 'function', 'getBlenderConnection is not callable');
            // With no blender.json written, the bridge answers null, exactly like the real client
            // when Blender is not configured.
            h.blender.set(null);
            const none = await h.eval(async () => await window.lol.getBlenderConnection());
            h.eq(none, null, 'getBlenderConnection should be null with no blender.json');
            h.blender.set({ url: 'http://127.0.0.1:4011/mcpo', apiKey: 'mock-mcpo-key' });
            const set = await h.eval(async () => await window.lol.getBlenderConnection());
            h.eq(set && set.apiKey, 'mock-mcpo-key', 'h.blender.set did not reach the page');
            h.blender.set(null);
        },
    },

    {
        name: 'h0-mock-no-beacon',
        needsMock: true,
        // The live-client hazard (plan §2.3): a beaconing mock could steal the owner's real client.
        run: async (h) => {
            const health = await h.mock.health();
            h.eq(health.beacon, false, 'the mock claims to be beaconing');
            h.assert(health.ok !== false, 'the mock reports itself unhealthy');
            h.note(`mock health: ${JSON.stringify(health)}`);
        },
    },

    {
        name: 'h0-ports',
        needsMock: true,
        // The snapshot must advertise the harness http port, never the live farm's 41997.
        run: async (h) => {
            const snap = await h.mock.self();
            h.eq(snap.httpPort, h.ports.self, 'the snapshot advertises the wrong httpPort');
            h.assert(snap.httpPort !== 41997, 'the snapshot advertises the LIVE farm port 41997');
            h.assert(snap.proxyPort !== 4000 && snap.proxyPort !== 4001, 'the snapshot advertises a live proxy port');
            const inPage = await h.waitFor(() => (window.__harness.state().snapshot || null));
            h.eq(inPage.httpPort, h.ports.self, 'the page received a snapshot with a different httpPort');
        },
    },

    {
        name: 'h0-bridge-extract',
        needsMock: true,
        // window.__lolFarm is built by the REAL publishFarm sliced out of app.js — not by a copy.
        run: async (h) => {
            const farm = await h.waitFor(() => window.__lolFarm || null);
            h.eq(farm.openaiBaseUrl, `http://127.0.0.1:${h.ports.proxy}/v1`, 'the extracted publishFarm built the wrong endpoint');
            h.assert(typeof farm.name === 'string' && farm.name.length > 0, 'the farm has no name');
            h.assert('defaultModel' in farm, 'publishFarm did not carry the advertised default');
            h.eq(farm.apiKey, null, 'the open farm should carry no key');

            // The keyed farm takes the other listener AND the key the mock demands.
            await h.reload({ farm: 'keyed' });
            const keyed = await h.waitFor(() => window.__lolFarm || null);
            h.eq(keyed.openaiBaseUrl, `http://127.0.0.1:${h.ports.keyed}/v1`, 'farm=keyed did not switch listeners');
            h.eq(keyed.apiKey, 'harness-pw', 'farm=keyed did not carry the key');

            // The fallback branch: no discovered farm, only a sidecar endpoint — and NO key, which
            // is the production hole this mode exists to reproduce.
            await h.reload({ farm: 'fallback-keyed' });
            const fb = await h.waitFor(() => window.__lolFarm || null);
            h.eq(fb.name, 'farm', 'the fallback branch should publish the anonymous farm');
            h.eq(fb.openaiBaseUrl, `http://127.0.0.1:${h.ports.keyed}/v1`, 'the fallback endpoint is wrong');
            h.assert(!fb.apiKey, 'the fallback branch must not invent a key');

            await h.reload({ farm: 'none' });
            const gone = await h.waitFor(() => (window.__lolFarm === null ? 'null' : false));
            h.eq(gone, 'null', 'farm=none should publish no farm at all');
        },
    },

    {
        name: 'h0-fresh-clears-open-idb',
        // h.fresh() must beat an OPEN IndexedDB connection: clearDataForOrigin blocks on one, which
        // is exactly the state the store leaves behind after a scenario.
        run: async (h) => {
            const wrote = await h.eval(() => new Promise((resolve, reject) => {
                const open = indexedDB.open('h0-probe', 1);
                open.onupgradeneeded = () => open.result.createObjectStore('rows', { keyPath: 'id' });
                open.onerror = () => reject(new Error('open failed'));
                open.onsuccess = () => {
                    const db = open.result;
                    window.__h0db = db;          // deliberately LEFT OPEN
                    const tx = db.transaction('rows', 'readwrite');
                    tx.objectStore('rows').put({ id: 'a', v: 'survivor' });
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => reject(new Error('write failed'));
                };
            }));
            h.assert(wrote === true, 'could not write the probe record');

            await h.fresh();

            const after = await h.eval(() => new Promise((resolve) => {
                const open = indexedDB.open('h0-probe');
                open.onerror = () => resolve({ error: 'open failed' });
                open.onsuccess = () => {
                    const db = open.result;
                    const names = Array.prototype.slice.call(db.objectStoreNames);
                    if (!names.includes('rows')) { db.close(); resolve({ stores: names, rows: null }); return; }
                    const tx = db.transaction('rows', 'readonly');
                    const all = tx.objectStore('rows').getAll();
                    all.onsuccess = () => { const rows = all.result; db.close(); resolve({ stores: names, rows }); };
                    all.onerror = () => { db.close(); resolve({ stores: names, rows: null }); };
                };
            }));
            h.note(`after fresh(): ${JSON.stringify(after)}`);
            h.assert(!after.rows || after.rows.length === 0, 'h.fresh() left IndexedDB data behind');
        },
    },

    {
        name: 'h0-loader',
        allowFailedModules: true,
        // §2.6 E: in P0 the table has no feature row, so the skipped component is `migrate`
        // (fake:null). The chat must still come up, and the composer must NOT be disabled.
        run: async (h) => {
            await h.reload({ flags: { skipModules: ['migrate'], allowFakes: true } });
            const state = await h.eval(async () => {
                const L = window.LolChat;
                const migration = await L.migration;
                const input = document.getElementById('chat-input');
                const send = document.getElementById('chat-send');
                return {
                    ready: L.ready,
                    version: L.version,
                    failed: L.failed,
                    banner: !!document.querySelector('.chat-banner-loader'),
                    inputDisabled: !!(input && input.disabled),
                    sendDisabled: !!(send && send.disabled),
                    migration,
                };
            });
            h.note(`LolChat.failed = ${JSON.stringify(state.failed)}`);
            h.assert(state.ready === true, 'a skipped module must not stop LolChat from becoming ready');
            h.assert(state.failed && state.failed.migrate, 'the skipped module is not recorded in LolChat.failed');
            h.eq(state.failed.migrate.faked, false, 'migrate has fake:null — it must be recorded as NOT faked');
            h.assert(/skip/i.test(state.failed.migrate.error), `the failure reason should name the skip: ${state.failed.migrate.error}`);
            h.assert(!state.banner, 'the production loader banner must not show while allowFakes is on');
            h.assert(!state.inputDisabled && !state.sendDisabled, 'the composer must stay usable when only migrate is missing');
            h.eq(state.migration.status, 'skipped', 'migration status');
            h.eq(state.migration.reason, 'no-migrate', 'migration reason');

            // A path (not just a key) is also honoured, and an unknown entry changes nothing.
            await h.reload({ flags: { skipModules: ['./state/migrate-v0.mjs', 'not-a-module'], allowFakes: true } });
            const byPath = await h.eval(() => ({ ready: window.LolChat.ready, keys: Object.keys(window.LolChat.failed) }));
            h.assert(byPath.ready === true, 'skipping by path broke the boot');
            h.assert(byPath.keys.includes('migrate'), 'flags.skipModules did not accept a module PATH');
        },
    },

    {
        name: 'h0-loader-production',
        allowFailedModules: true,
        // The branch a REAL user hits when a module fails to load in the shipped app: no fakes, so
        // main.mjs must raise the loader banner and lock the composer. h0-loader forces
        // allowFakes:true in both of its reloads, so this path had never once run.
        run: async (h) => {
            await h.reload({ flags: { skipModules: ['repo'], allowFakes: false } });
            const state = await h.eval(() => {
                const input = document.getElementById('chat-input');
                const send = document.getElementById('chat-send');
                const banner = document.querySelector('.chat-banner-loader');
                return {
                    ready: window.LolChat.ready,
                    failed: window.LolChat.failed,
                    fakes: window.LolChat.fakes,
                    bannerText: banner ? banner.textContent : null,
                    bannerRole: banner ? banner.getAttribute('role') : null,
                    inputDisabled: !!(input && input.disabled),
                    sendDisabled: !!(send && send.disabled),
                    repo: !!window.LolChat.app.repo,
                };
            });
            h.note(`production loader: ${JSON.stringify({ banner: state.bannerText, failed: Object.keys(state.failed) })}`);
            h.assert(state.ready === true, 'the shell must still finish booting so the banner can be seen');
            h.assert(!state.repo, 'the skipped repo must NOT have been replaced by a fake');
            h.eq(state.fakes, [], 'no fake may be built when allowFakes is off');
            h.assert(!!state.bannerText, 'the production loader banner is missing');
            h.eq(state.bannerRole, 'alert', 'the banner must announce itself to a screen reader');
            h.assert(/repo/.test(state.bannerText), `the banner must name the broken component: ${state.bannerText}`);
            h.assert(!/core\.loaderFailed|\{key\}/.test(state.bannerText),
                `the banner shows the raw string key instead of the rendered text: ${state.bannerText}`);
            h.assert(state.inputDisabled && state.sendDisabled, 'the composer must be locked when the chat cannot run');

            // …and the one row that is survivable must NOT raise it: `migrate` has fake:null and no
            // COMPONENTS entry, so the chat runs without it — it just does not import v1 history.
            // Mid-phase the table also carries rows whose unit has not landed; those DO fail (and,
            // being components, do raise the banner), so the assertion is on the banner's TEXT:
            // it must never name `migrate`. At a landing nothing else fails and the banner is gone.
            await h.reload({ flags: { skipModules: ['migrate'], allowFakes: false } });
            const survivable = await h.eval(async () => {
                const banner = document.querySelector('.chat-banner-loader');
                const failed = window.LolChat.failed;
                return {
                    ready: window.LolChat.ready,
                    bannerText: banner ? banner.textContent : null,
                    failedKeys: Object.keys(failed),
                    // a row whose file simply is not there yet, vs. a real failure
                    notLanded: Object.keys(failed).filter((k) => /dynamically imported module/i.test(failed[k].error)),
                    migration: await window.LolChat.migration,
                    repo: !!window.LolChat.app.repo,
                };
            });
            h.assert(survivable.ready === true, 'a missing migrate must not stop the boot');
            h.assert(survivable.repo, 'the real repo must be built here');
            if (survivable.notLanded.length) h.note(`not landed yet: ${survivable.notLanded.join(', ')}`);
            h.eq(survivable.failedKeys.filter((k) => !survivable.notLanded.includes(k)), ['migrate'],
                'only migrate (and rows whose unit has not landed) may have failed');
            h.assert(!/migrate/.test(survivable.bannerText || ''),
                `migrate is survivable: the production banner must not name it (${survivable.bannerText})`);
            h.eq(survivable.migration.reason, 'no-migrate', 'and the migration says why it did nothing');
        },
    },

    {
        name: 'h0-visibility',
        // §2.6 F: a show:false window still reports visibilityState 'visible'. Record the measured
        // value so a future Electron bump shows up in the run output instead of silently changing
        // which code path the seat-wait/notification scenarios take.
        run: async (h) => {
            const before = await h.eval(() => ({
                visibilityState: document.visibilityState,
                hidden: document.hidden,
                pageVisible: window.LolChat.app.state.pageVisible,
                visible: window.LolChat.app.state.visible,
            }));
            h.note(`hidden window: document.visibilityState=${before.visibilityState}, app.state.pageVisible=${before.pageVisible}`);
            h.assert(before.visible === true, '#lolchat has no .hidden class in the harness, so app.state.visible must be true');

            await h.setPageVisible(false);
            const off = await h.eval(() => window.LolChat.app.state.pageVisible);
            h.eq(off, false, 'h.setPageVisible(false) did not reach app.state.pageVisible');

            await h.setPageVisible(true);
            const on = await h.eval(() => window.LolChat.app.state.pageVisible);
            h.eq(on, true, 'h.setPageVisible(true) did not restore app.state.pageVisible');

            // The EV.VISIBLE event carries both halves (the seat-wait/notification rules read it).
            const seen = await h.eval(async () => {
                const app = window.LolChat.app;
                const out = [];
                const off2 = app.bus.on('ui:visible', (p) => out.push(p));
                window.__harness.setPageVisible(false);
                off2();
                return out;
            });
            h.assert(seen.length === 1, `expected exactly one ui:visible event, got ${seen.length}`);
            h.eq(seen[0].pageVisible, false, 'ui:visible carried the wrong pageVisible');
            await h.setPageVisible(true);
        },
    },

    {
        name: 'h0-window-open',
        // An https link must be recorded as "would open externally" and must NEVER navigate the
        // harness window (the shipping main process behaves the same way).
        run: async (h) => {
            const before = h.windowOpens().length;
            const href = await h.eval(() => {
                const a = document.createElement('a');
                a.href = 'https://example.com/h0-window-open';
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = 'external';
                document.body.appendChild(a);
                a.click();
                return location.href;
            });
            // The record is written by the main process; give the IPC a beat.
            let opens = [];
            for (let i = 0; i < 40; i++) {
                opens = h.windowOpens();
                if (opens.length > before) break;
                await h.sleep(100);
            }
            h.note(`windowOpens: ${JSON.stringify(opens.slice(-2))}`);
            const last = opens[opens.length - 1];
            h.assert(last && last.url === 'https://example.com/h0-window-open', 'the https link was not recorded');
            h.eq(last.action, 'external', 'an https link must be recorded as "would open externally"');

            const after = await h.eval(() => ({ href: location.href, ready: !!(window.LolChat && window.LolChat.ready) }));
            h.eq(after.href, href, 'the harness window navigated away');
            h.assert(after.ready === true, 'the chat did not survive the link click');
        },
    },
    {
        name: 'h0-input-helpers',
        // Not in the §2.2 list, but every later unit depends on these: if h.type/h.key/h.drop/
        // h.paste or the spies silently do nothing, a composer scenario would "pass" without ever
        // having typed anything. It doubles as the live check that ui/layout.mjs's document drop
        // guard preventDefaults WITHOUT stopping propagation (lint rule 7, observed for real).
        run: async (h) => {
            const typed = await h.type('#chat-input', 'hello harness');
            h.eq(typed, 'hello harness', 'h.type did not reach the textarea');

            // The IME guard case: a composing Enter must arrive with isComposing true and the
            // legacy keyCode 229, which the KeyboardEvent constructor does not always honour.
            const ime = await h.key('#chat-input', 'Enter', { isComposing: true, keyCode: 229 });
            h.eq(ime.isComposing, true, 'h.key did not produce isComposing');
            h.eq(ime.keyCode, 229, 'h.key did not produce keyCode 229');
            const plain = await h.key('#chat-input', 'Enter', { shift: true });
            h.eq(plain.isComposing, false, 'a plain Enter must not claim to be composing');

            // A file drop: the document guard preventDefaults it (so a stray drop never navigates
            // the window) but the event still bubbles all the way there from the composer.
            const file = { name: 'note.txt', mime: 'text/plain', base64: Buffer.from('hi').toString('base64') };
            const drop = await h.drop('#chat-input', [file]);
            h.eq(drop.files, 1, 'h.drop built no File');
            h.eq(drop.defaultPrevented, true, 'the document drop guard did not preventDefault a drop on #chat-input');
            const paste = await h.paste('#chat-input', [file]);
            h.eq(paste.files, 1, 'h.paste built no File');

            const clipboard = await h.spy.clipboard();
            await h.eval(async () => { await navigator.clipboard.writeText('copied text'); });
            h.eq(await clipboard(), ['copied text'], 'the clipboard spy recorded nothing');

            const notes = await h.spy.notifications();
            await h.eval(() => { const n = new Notification('done', { body: 'your reply is ready' }); n.close(); });
            const seen = await notes();
            h.eq(seen.length, 1, 'the notification spy recorded nothing');
            h.eq(seen[0].title, 'done', 'the notification spy lost the title');

            // Only a --show run can actually paint: a hidden window never produces a frame.
            const shot = await h.screenshot('h0-input-helpers');
            if (shot) {
                h.assert(fs.statSync(shot).size > 1000, 'the screenshot is empty');
                h.note(`screenshot ${path.basename(shot)} (${fs.statSync(shot).size} bytes)`);
            }

            await h.type('#chat-input', '');
        },
    },
    {
        name: 'h0-real-input',
        // K-6 (critic R1): h.input.* goes through Chromium's input pipeline (CDP Input), so the page
        // sees TRUSTED events with hit testing, focus and default actions — the ground truth for
        // pointer capture, text selection and editing bugs that el.click() cannot see.
        run: async (h) => {
            await h.eval(() => {
                const box = document.createElement('div');
                box.id = 'k6-probe';
                box.style.cssText = 'position:fixed;left:40px;top:40px;width:300px;height:160px;z-index:99999;background:#333;overflow:auto';
                const btn = document.createElement('button'); btn.id = 'k6-btn'; btn.textContent = 'press';
                const input = document.createElement('input'); input.id = 'k6-in';
                const tall = document.createElement('div'); tall.style.height = '600px'; tall.textContent = 'scroll me';
                box.append(btn, input, tall);
                document.body.appendChild(box);
                const seen = (window.__k6 = { click: 0, dbl: 0, trusted: true, moves: 0, wheel: null, keys: [] });
                const t = (e) => { if (!e.isTrusted) seen.trusted = false; };
                btn.addEventListener('click', (e) => { t(e); seen.click++; });
                btn.addEventListener('dblclick', (e) => { t(e); seen.dbl++; });
                box.addEventListener('pointermove', (e) => { if (e.buttons) seen.moves++; });
                box.addEventListener('wheel', (e) => { t(e); seen.wheel = { dy: e.deltaY, ctrl: e.ctrlKey }; });
                input.addEventListener('keydown', (e) => { t(e); seen.keys.push((e.ctrlKey ? 'Ctrl+' : '') + e.key); });
                return true;
            });
            try {
                await h.input.click('#k6-btn');
                await h.input.dblclick('#k6-btn');
                await h.input.drag({ x: 60, y: 150 }, { x: 250, y: 170 }, { steps: 6 });
                await h.input.wheel({ x: 150, y: 150, dy: 120 });
                await h.sleep(400);                          // wheel scrolling is animated on the compositor
                const scrolled = await h.eval(() => document.getElementById('k6-probe').scrollTop);
                await h.input.wheel({ x: 150, y: 150, dy: -10, ctrl: true });
                await h.input.click('#k6-in');
                await h.input.key('a');
                await h.input.type('bc');
                await h.input.key('a', { ctrl: true });
                const seen = await h.eval(() => ({ ...window.__k6, value: document.getElementById('k6-in').value, focus: document.activeElement && document.activeElement.id }));
                h.eq(seen.trusted, true, 'every event is trusted (isTrusted)');
                h.eq(seen.click, 3, 'one click + the two clicks of a double-click');
                h.eq(seen.dbl, 1, 'one dblclick');
                h.assert(seen.moves >= 6, 'a drag moves with the button held: ' + seen.moves);
                h.assert(scrolled > 0, 'a wheel scrolls what is under it (default action): ' + scrolled);
                h.eq(seen.wheel && seen.wheel.ctrl, true, 'a pinch arrives as wheel + ctrlKey');
                h.eq(seen.focus, 'k6-in', 'a real click focuses');
                h.eq(seen.value, 'abc', 'keys and typed text land in the focused field');
                h.assert(seen.keys.includes('Ctrl+a'), 'chords arrive with their modifier: ' + seen.keys.join(','));
            } finally {
                await h.eval(() => { const b = document.getElementById('k6-probe'); if (b) b.remove(); delete window.__k6; return true; });
            }
        },
    },
];
