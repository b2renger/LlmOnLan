// @ts-check
// The Computer as an MCP server (owner, 2026-09-27; plan §8c): the page side of the tools, through the
// same door main's MCP server calls (window.LolComputer.debug.mcp = computer/mcp-tools.mjs runTool).
// (The protocol and the HTTP layer are unit-tested in shell-main; Open WebUI 0.11.4 driving them for real
// was checked on the rig, 2026-09-27.)
//   1. A model can list the box types, make a graph, add boxes, connect them and run it — no farm needed.
//   2. The one rule: while a person has the outputs armed, a run is refused.

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

            // The one rule: a person's armed outputs are never driven by a model.
            await h.eval(() => window.lol.io.arm(true));
            const refused = await tool(h, 'run_graph');
            await h.eval(() => window.lol.io.arm(false));
            h.eq(refused.isError, true, 'armed outputs: the run is refused');
            h.assert(/only a person may run/.test(refused.text), refused.text);
        },
    },
];
