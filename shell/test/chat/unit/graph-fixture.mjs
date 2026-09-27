// Shared fixtures for the C1-U1 engine tests (graph-{values,topo,model,undo,serialize}.test.mjs).
// NOT a test file: chat-unit.js only runs *.test.mjs.
//
// The specs here stand in for graph/parts/* (C1-U3's): the engine only ever reads `inputs`,
// `output`, `defaults`, `size` and `thinks`, so a plain object is a faithful part type.

/** @returns {Map<string, any>} */
export function specs(extra = {}) {
  const base = {
    note: {
      type: 'note', label: 'Note', inputs: [], output: 'text',
      size: { w: 200, h: 100 }, defaults: () => ({ text: '' }),
    },
    ask: {
      type: 'ask', label: 'Ask', thinks: true, output: 'text',
      inputs: [{ name: 'in', label: 'Context', accepts: ['any'], many: true }],
      defaults: () => ({ prompt: '', shape: 'text' }),
    },
    collect: {
      type: 'collect', label: 'Collect', output: 'text',
      inputs: [{ name: 'items', label: 'Items', accepts: ['list'], many: false }],
      defaults: () => ({ mode: 'bullets' }),
    },
    // A deterministic list source: the only way to build a list-typed wire without the runner.
    lister: {
      type: 'lister', label: 'Lister', inputs: [], output: 'list', defaults: () => ({}),
    },
    // Accepts images only — the fixture for the 'type' wire refusal.
    looker: {
      type: 'looker', label: 'Looker', output: 'text',
      inputs: [{ name: 'image', label: 'Image', accepts: ['image'] }],
      defaults: () => ({}),
    },
    // No output: the fixture for the 'no-output' refusal.
    sink: {
      type: 'sink', label: 'Sink', output: null,
      inputs: [{ name: 'in', label: 'In', accepts: ['any'] }],
      defaults: () => ({}),
    },
  };
  return new Map(Object.entries({ ...base, ...extra }));
}

/** A deterministic id minter, so every test reads `p1`, `p2`, `w1`… */
export function ids(prefix = 'n') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** A clock that only moves when a test moves it. */
export function clock(start = 1000) {
  let t = start;
  const now = () => t;
  now.tick = (ms = 1) => { t += ms; return t; };
  return now;
}

/** Build a doc from a terse description: parts as `[id?]type`, wires as 'a>b' / 'a>b:port'.
 * @returns {{doc: any, id: (label: string) => string}} */
export function build(model, { types = [], wires = [], state = {}, specs: map = specs(), now = clock() } = {}) {
  const newId = ids('p');
  let doc = model.createDoc({ id: 'g1', threadId: 't1', now });
  /** @type {Record<string, string>} */ const byLabel = {};
  for (const entry of types) {
    const [label, type] = entry.includes(':') ? entry.split(':') : [entry, 'note'];
    const { doc: next, part } = model.addPart(doc, { type, x: 0, y: 0 }, { specs: map, newId, now });
    doc = next;
    byLabel[label] = part.id;
  }
  const wireId = ids('w');
  for (const w of wires) {
    const [from, rest] = w.split('>');
    const [to, port] = rest.includes(':') ? rest.split(':') : [rest, defaultPort(map, byLabel, types, to0(rest))];
    const res = model.addWire(doc, { from: byLabel[from], to: byLabel[to], port: port || 'in' },
      { specs: map, newId: wireId, now });
    if (!res.ok) throw new Error(`fixture wire ${w} refused: ${res.reason}`);
    doc = res.doc;
  }
  for (const [label, s] of Object.entries(state)) {
    doc = model.patchPart(doc, byLabel[label], { state: s }, { now });
  }
  return { doc, id: (label) => byLabel[label] };
}

function to0(rest) { return rest.includes(':') ? rest.split(':')[0] : rest; }

function defaultPort(map, byLabel, types, toLabel) {
  const entry = types.find((t) => t.split(':')[0] === toLabel) || '';
  const type = entry.includes(':') ? entry.split(':')[1] : 'note';
  const spec = map.get(type);
  return spec && spec.inputs && spec.inputs[0] ? spec.inputs[0].name : 'in';
}
