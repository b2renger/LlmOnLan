'use strict';
// Classic script, loaded BEFORE generated/app-bridge.js and before chat/main.mjs (plan §2.2.1).
//
// Two jobs:
//   1. set window.__lolChatTestFlags before the chat module boots;
//   2. stand in for the shell's discovery + sidecar state: poll the mock's /lol/self, turn the
//      snapshot into a MAIN-SHAPED farm object (exactly what discovery.ts + index.ts hand the
//      renderer) and drive the REAL publishFarm through window.__appBridge.
//
// Query string (written by run.js; every port is slot-aware, so nothing here is hard-coded):
//   ?farm=mock|keyed|fallback-keyed|none  &refreshMs=4000  &proxy=4009 &keyed=4010 &self=41987
//   &key=harness-pw  &flags=<url-encoded JSON>
//
// window.__harness = { setFarm(patch|null), pause(bool), setPageVisible(bool), publish(), state() }

(function () {
    var q = new URLSearchParams(location.search);
    var num = function (name, dflt) {
        var v = parseInt(q.get(name) || '', 10);
        return Number.isFinite(v) && v > 0 ? v : dflt;
    };

    var MODE = q.get('farm') || 'mock';
    var REFRESH_MS = num('refreshMs', 4000);
    var PORTS = { proxy: num('proxy', 4009), keyed: num('keyed', 4010), self: num('self', 41987) };
    var KEY = q.get('key') || 'harness-pw';

    var flags = { allowFakes: true, forcePageVisible: true };
    try {
        var raw = q.get('flags');
        if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                for (var k in parsed) if (Object.prototype.hasOwnProperty.call(parsed, k)) flags[k] = parsed[k];
            }
        }
    } catch (e) {
        console.error('[harness-bridge] bad flags JSON in the query string:', e && e.message);
    }
    window.__lolChatTestFlags = flags;

    // ---- state -------------------------------------------------------------------------------
    var lastSnapshot = null;
    var overlay = {};          // deep-merged onto every rebuilt farm object (h.setFarm)
    var removed = false;       // h.setFarm(null)
    var paused = false;
    var timer = null;
    var ticks = 0;

    function isPlain(v) { return v && typeof v === 'object' && !Array.isArray(v); }
    function deepMerge(base, patch) {
        var out = {};
        var key;
        for (key in base) if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key];
        for (key in patch) {
            if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
            var pv = patch[key];
            out[key] = isPlain(pv) && isPlain(out[key]) ? deepMerge(out[key], pv) : pv;
        }
        return out;
    }

    // discovery.ts:119 + index.ts:266-276: a snapshot becomes a farm record with the _-prefixed
    // fields the renderer reads (_host is where the datagram CAME FROM, never the snapshot's ips).
    function toFarm(snapshot) {
        var keyed = MODE === 'keyed';
        var farm = deepMerge(snapshot || {}, {
            proxyPort: keyed ? PORTS.keyed : PORTS.proxy,
            requiresKey: !!keyed,
            _source: 'beacon',
            _host: '127.0.0.1',
            _lastSeen: Date.now(),
            _stale: false,
            _hasKey: !!keyed,
            _key: keyed ? KEY : null,
        });
        return deepMerge(farm, overlay);
    }

    function endpointOf(farm) { return 'http://' + farm._host + ':' + farm.proxyPort + '/v1'; }

    // The HTML parser may run this script's first fetch callback BEFORE the next <script>
    // (generated/app-bridge.js) has executed. Retrying costs nothing and saves the page from
    // waiting a whole refresh interval for its farm.
    var retryTimer = null;
    var retries = 0;
    function schedulePublish() {
        if (retryTimer || retries++ > 200) return;
        retryTimer = setTimeout(function () { retryTimer = null; publish(); }, 10);
    }

    function publish() {
        if (!window.__appBridge) { schedulePublish(); return false; }   // app-bridge.js has not run yet
        var farmState = { farms: [] };
        var sidecarState = null;
        if (MODE === 'fallback-keyed') {
            // No discovered farm at all: the renderer falls back to whatever endpoint the sidecar
            // is pointed at — which carries NO key, the exact production hole this mode tests.
            sidecarState = { endpoint: 'http://127.0.0.1:' + PORTS.keyed + '/v1' };
        } else if (MODE !== 'none' && !removed && lastSnapshot) {
            var farm = toFarm(lastSnapshot);
            farmState = { farms: [farm] };
            sidecarState = { endpoint: endpointOf(farm) };
        }
        window.__appBridge.set(farmState, sidecarState);
        window.__appBridge.publishFarm();
        ticks++;
        return true;
    }

    function refresh() {
        return fetch('http://127.0.0.1:' + PORTS.self + '/lol/self', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (snap) {
                if (snap) lastSnapshot = snap;
                publish();
            })
            .catch(function () {
                // The mock may not be up yet (or is deliberately down) — keep the last snapshot and
                // still republish so caps/staleness overlays take effect.
                publish();
            });
    }

    function start() {
        if (timer || paused) return;
        timer = setInterval(refresh, REFRESH_MS);
    }
    function stop() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    window.__harness = {
        ports: PORTS,
        mode: MODE,
        setFarm: function (patch) {
            if (patch === null) { removed = true; } else { removed = false; overlay = deepMerge(overlay, patch || {}); }
            return publish();
        },
        pause: function (on) {
            paused = !!on;
            if (paused) stop(); else start();
            return paused;
        },
        setPageVisible: function (visible) {
            window.__lolChatTestFlags.forcePageVisible = !!visible;
            document.dispatchEvent(new Event('visibilitychange'));
            return !!visible;
        },
        publish: publish,
        refresh: refresh,
        state: function () {
            return {
                mode: MODE, ports: PORTS, refreshMs: REFRESH_MS, paused: paused, ticks: ticks,
                removed: removed, overlay: overlay, snapshot: lastSnapshot,
            };
        },
    };

    refresh();
    start();
}());
