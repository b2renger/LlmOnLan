// @ts-check
// P4, the Agent box, in the real page against the mock farm (`mock-agent` answers the scripted step the
// prompt asks for: state.agentSteps[k-1]).
//   1. run_code in the REAL sandbox over a labelled input, then answer: the answer shows the step and the
//      number the code computed; one generation per step; the run bar quotes the range.
//   2. fetch through the REAL io.js: an allowed host (answered by a loopback fixture through h.io.map) is
//      read; a host nobody listed is refused before any request, and the model is told so.
import http from 'node:http';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}

/** Wait until the box settles. */
async function settle(/** @type {any} */ h, /** @type {string} */ id) {
    return h.waitFor((pid) => {
        const C = window.LolComputer.debug.computer;
        const p = C.doc().parts.find((x) => x.id === pid);
        return !C.running() && p && (p.state === 'done' || p.state === 'error') ? { state: p.state, error: p.error, value: p.value } : null;
    }, { timeout: 60000, args: [id] });
}

export default [
    {
        name: 'k22-agent-runs-code-in-the-sandbox-then-answers-showing-its-steps',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.mock.state({ agentSteps: [
                { tool: 'run_code', why: 'average and largest', code: 'const r = JSON.parse(inputs.readings); return { avg: r.reduce((a, b) => a + b, 0) / r.length, max: Math.max(...r) };', answer: '' },
                { tool: 'answer', why: 'done', code: '', answer: 'The average is about 14.7; the largest is 30.' },
            ] });
            await open(h);
            const nums = await h.computer.place('note', 40, 60);
            await h.computer.set(nums, { text: '[12, 7, 30, 5, 18, 22, 9]' });
            const agent = await h.computer.place('agent', 420, 60);
            await h.computer.set(agent, { task: 'Average and largest of the readings?', model: 'mock-agent', maxSteps: 3 });
            await h.computer.wire(nums, agent, 'in');
            await h.eval((from, into) => {
                const C = window.LolComputer.debug.computer;
                const w = C.doc().wires.find((x) => x.from === from && x.to === into);
                return C.label(w.id, 'readings');
            }, nums, agent);
            const gens = await h.eval(() => (document.querySelector('#lolcomputer .comp-run-gens') || {}).textContent || '');
            h.assert(/1\D{1,3}3/.test(gens), `the run bar quotes one to three generations: ${gens}`);
            const before = (await h.mock.log({ path: '/v1/chat/completions' })).length;
            await h.computer.runFrom(agent);
            const r = await settle(h, agent);
            h.eq(r.state, 'done', `the agent answered: ${r.error}`);
            const text = String(r.value.data);
            h.assert(/^The average is about 14\.7; the largest is 30\./.test(text), text);
            h.assert(/1\. \*\*run_code\*\* — average and largest\n {3}→ \{"avg":14\.714285714285714,"max":30\}/.test(text), `the step, with the number the SANDBOX computed: ${text}`);
            const after = (await h.mock.log({ path: '/v1/chat/completions' })).length;
            h.eq(after - before, 2, 'one generation per step');
            const face = await h.eval((id) => (document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-fetch-status`) || {}).textContent || '', agent);
            h.assert(/Answered after 2 steps/.test(face), `the face says how it went: ${face}`);
        },
    },
    {
        name: 'k22-agent-fetches-only-a-listed-host-through-io-and-is-told-when-a-host-is-not-listed',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            // Somewhere the agent must never reach, even through an open redirect on its allowed host (critic S3).
            /** @type {string[]} */ const leaked = [];
            const elsewhere = http.createServer((req, res) => { leaked.push(String(req.url)); res.end('{}'); });
            await new Promise((r) => elsewhere.listen(0, '127.0.0.1', () => r(null)));
            const elsewherePort = /** @type {any} */ (elsewhere.address()).port;
            /** @type {string[]} */ const asked = [];
            const server = http.createServer((req, res) => {
                asked.push(String(req.url));
                if (req.url === '/jump') {
                    res.writeHead(302, { location: `http://127.0.0.1:${elsewherePort}/leak?data=secret` });
                    res.end();
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ data: [{ region: 'A', visitors: 120 }, { region: 'B', visitors: 80 }, { region: 'A', visitors: 30 }] }));
            });
            await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
            const port = /** @type {any} */ (server.address()).port;
            try {
                await h.fresh();
                h.io.map({ 'https://open.example.org/': `http://127.0.0.1:${port}/` });
                await h.mock.state({ agentSteps: [
                    { tool: 'fetch', why: 'somewhere else first', code: '', url: 'https://other.example.org/x.json', answer: '' },
                    { tool: 'fetch', why: 'through a redirect', code: '', url: 'https://open.example.org/jump', answer: '' },
                    { tool: 'fetch', why: 'the rows', code: '', url: 'https://open.example.org/visits.json', answer: '' },
                    { tool: 'run_code', why: 'sum per region', code: 'const out = {}; for (const r of results[2].data) out[r.region] = (out[r.region] || 0) + r.visitors; return out;', url: '', answer: '' },
                    { tool: 'answer', why: 'done', code: '', url: '', answer: 'Region A has the most visitors.' },
                ] });
                await open(h);
                const agent = await h.computer.place('agent', 60, 60);
                await h.computer.set(agent, { task: 'Which region has the most visitors?', model: 'mock-agent', hosts: 'open.example.org', maxSteps: 6 });
                await h.computer.runFrom(agent);
                const r = await settle(h, agent);
                h.eq(r.state, 'done', `the agent answered: ${r.error}`);
                h.eq(asked, ['/jump', '/visits.json'], 'only the listed host was asked');
                h.eq(leaked, [], 'the redirect off the listed host was refused before any request');
                const text = String(r.value.data);
                h.assert(/1\. \*\*fetch https:\/\/other\.example\.org\/x\.json\*\*[^\n]*\n {3}→ error: not an allowed host; you may only fetch from: open\.example\.org/.test(text), `the refusal is a step the model saw: ${text}`);
                h.assert(/2\. \*\*fetch https:\/\/open\.example\.org\/jump\*\*[^\n]*\n {3}→ error: That leads to 127\.0\.0\.1:\d+, which is not one of the hosts/.test(text), `the redirect's refusal too: ${text}`);
                h.assert(/4\. \*\*run_code\*\* — sum per region\n {3}→ \{"A":150,"B":80\}/.test(text), `the sums come from the code: ${text}`);
            } finally {
                h.io.map(null);
                server.close();
                elsewhere.close();
            }
        },
    },
];
