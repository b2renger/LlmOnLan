// Unicast discovery fallback — GET /lol/self → the snapshot JSON.
//
// On managed/school Wi-Fi, client isolation drops broadcast + multicast between
// clients (so the UDP beacon never arrives) even though unicast HTTP works fine.
// The shell's subnet sweep / "add by address" probes THIS endpoint to find the
// farm. Mirrors ComfyQ's GET /federation/self. Built-in http, no framework.

const http = require('http');

function startSelfServer({ httpPort, getSnapshot, host = '0.0.0.0' }) {
    const server = http.createServer((req, res) => {
        const pathOnly = (req.url || '').split('?')[0];
        if (req.method === 'GET' && (pathOnly === '/lol/self' || pathOnly === '/lol/self/')) {
            let body;
            try { body = JSON.stringify(getSnapshot()); }
            catch { res.writeHead(500); return res.end('{"error":"snapshot"}'); }
            res.writeHead(200, {
                'content-type': 'application/json',
                // Allow an Electron/browser client to fetch this cross-origin.
                'access-control-allow-origin': '*',
                'cache-control': 'no-store',
            });
            return res.end(body);
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
    });

    server.on('error', (e) => {
        console.warn(`[self] HTTP server error on :${httpPort} — ${e.message} (unicast discovery fallback disabled)`);
    });
    server.listen(httpPort, host);
    return server;
}

module.exports = { startSelfServer };
