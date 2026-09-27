// @ts-check
// The Computer as an MCP server (owner, 2026-09-27; plan §8c): the page side of the tools, through the
// same door main's MCP server calls (window.LolComputer.debug.mcp = computer/mcp-tools.mjs runTool).
// (The protocol and the HTTP layer are unit-tested in shell-main; Open WebUI 0.11.4 driving them for real
// was checked on the rig, 2026-09-27.)
//   1. A model can list the box types, make a graph, add boxes, connect them and run it — no farm needed.
//   2. The one rule: while a person has the outputs armed, every tool that changes or runs a graph is refused
//      (reading still works); and what only a person may choose — where a box reads, an agent's hosts, Listen —
//      is dropped from a model's settings, and the model is told.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}
const tool = (/** @type {any} */ h, /** @type {string} */ name, /** @type {any} */ args) => h.eval((n, a) => window.LolComputer.debug.mcp(n, a), name, args || {});
const json = (/** @type {any} */ out) => JSON.parse(out.text);

export default [
    {
        name: 'k19-mcp-tools-build-and-run-a-graph-and-never-run-armed-outputs',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const types = json(await tool(h, 'list_box_types'));
            h.assert(types.length >= 38 && types.some((/** @type {any} */ t) => t.type === 'code' && /JavaScript/.test(t.what)), 'the box types carry the ? words');

            const made = json(await tool(h, 'new_graph', { title: 'Built by a model' }));
            h.assert(made.id, `a new graph: ${JSON.stringify(made)}`);
            const note = json(await tool(h, 'add_box', { type: 'note', settings: { text: 'three, two, one' } }));
            const code = json(await tool(h, 'add_box', { type: 'code', settings: { code: 'return String(inputs.in[0]).split(",").length;' } }));
            const view = json(await tool(h, 'add_box', { type: 'markdown' }));
            h.eq(view.type, 'preview', 'a preset key places its box with the preset\'s settings');
            h.eq(json(await tool(h, 'connect_boxes', { from: note.id, to: code.id })).port, 'in', 'the port defaults to the first input');
            h.eq(json(await tool(h, 'connect_boxes', { from: code.id, to: view.id })).port, 'content');
            const bad = await tool(h, 'connect_boxes', { from: note.id, to: 'nope' });
            h.eq(bad.isError, true, 'a wrong id is a sentence the model reads, not a crash');

            const ran = json(await tool(h, 'run_graph'));
            const byId = (/** @type {string} */ id) => ran.boxes.find((/** @type {any} */ b) => b.id === id);
            h.eq(byId(code.id).state, 'done', `the graph ran: ${JSON.stringify(byId(code.id))}`);
            h.eq(byId(code.id).value, '3', 'and the model reads the values back');
            const listed = json(await tool(h, 'list_graphs'));
            h.assert(listed.some((/** @type {any} */ g) => g.title === 'Built by a model' && g.boxes === 3), `the library shows it: ${JSON.stringify(listed)}`);

            // The one rule: while a person has the outputs armed, no tool changes or runs a graph (critic B1:
            // an edit under arming would retarget a live Send box the person never saw in the arming list).
            await h.eval(() => window.lol.io.arm(true));
            /** @type {Array<[string, any]>} */ const writes = [
                ['run_graph', {}], ['set_box', { id: code.id, settings: { code: 'return 1;' } }], ['add_box', { type: 'send' }],
                ['connect_boxes', { from: note.id, to: view.id }], ['new_graph', { title: 'x' }], ['open_graph', { id: made.id }],
            ];
            const refused = [];
            for (const [name, args] of writes) refused.push([name, await tool(h, name, args)]);
            const reads = [await tool(h, 'read_graph'), await tool(h, 'list_graphs'), await tool(h, 'list_box_types')];
            await h.eval(() => window.lol.io.arm(false));
            for (const [name, out] of refused) {
                h.eq(out.isError, true, `armed outputs: ${name} is refused`);
                h.assert(/outputs are armed/.test(out.text), out.text);
            }
            h.assert(reads.every((r) => !r.isError), 'reading still works while armed');
            h.eq(json(await tool(h, 'read_graph')).boxes.find((/** @type {any} */ b) => b.id === code.id).settings.code, 'return String(inputs.in[0]).split(",").length;', 'nothing changed under arming');

            // What only a person may choose stays theirs (critic S1): where a box reads, a USB board, Listen.
            const fetchBox = json(await tool(h, 'add_box', { type: 'fetch', settings: { url: 'http://192.168.1.1/admin' } }));
            h.eq(fetchBox.left_for_a_person, ['url'], 'a model cannot type the address a Fetch box reads');
            const agent = json(await tool(h, 'add_box', { type: 'agent', settings: { task: 'hi', hosts: 'evil.example' } }));
            const agentSet = json(await tool(h, 'set_box', { id: agent.id, settings: { hosts: 'evil.example', maxSteps: 3 } }));
            h.eq([agentSet.left_for_a_person, agentSet.settings.hosts, agentSet.settings.maxSteps, agentSet.settings.task], [['hosts'], '', 3, 'hi'], 'the rest of the settings still apply');
            const sound = json(await tool(h, 'add_box', { type: 'audio', settings: { listen: true } }));
            h.eq(sound.left_for_a_person, ['listen'], 'nor switch a microphone recording to the farm on');
        },
    },
];
