// Presets (owner, 2026-10-27): "pre-configurations of models for the farm: a configuration for RAG, a configuration for
// LOL Vibe and a configuration for the LOL Computer". One preset at a time: before a session the operator picks one in the
// panel and the farm switches to it through its own controls (up.js makePresets). Pure: no I/O.
//
//   balanced  the farm as it ships (the default): the serving engine's own defaults and the shipped plugins
//   rag       Documents: the most people at 64k each among models good enough for documents (GATE_FLOOR), document
//             reading on (owner 2026-10-27: "more users")
//   vibe      LOL Vibe and its coding agent: the most people at 64k among models proven with the agent (AGENT_PROVEN),
//             document reading off
//   computer  the Computer: the most people at 32k with a model that sees pictures and does tools well, every plugin on
//
// The picks are worked out for THIS box (its GPU: systemInfo's detectHardware, the snapshot's host) from the capacity
// page's own data and code (capacity/scenarios.js recommend() over the spike's measurements and the estimator), never
// copied here, and only among what this farm can run: vLLM's list when vLLM is set up here, else Ollama's default model
// and llama.cpp's model. Document search is never switched: a laptop whose data folder adopted it fails every upload
// without it. Checked by test/run.js ("presets").

const E = require('./capacity/estimator');
const S = require('./capacity/scenarios');
const CATALOG = require('./capacity/catalog.json');
const MEASURED = require('./capacity/measured.json');
const { defaultConfig } = require('./config');
const { engineOf, defaultModelEntry } = require('./litellm');

E.init(CATALOG, MEASURED);

// The farm's plugins a preset switches, in the panel's words. `embed` (document search) is deliberately absent.
const PLUGINS = ['websearch', 'ocr', 'tts', 'classify', 'stt', 'bus'];
const PLUGIN_LABEL = {
    websearch: 'Web search', ocr: 'Document reading (OCR)', tts: 'Voice (Kokoro)', classify: 'Classify (Laya)',
    stt: 'Speech to text', bus: 'Message bus',
};
// What a first start of each costs (the plugin installs itself then: registry.js ensure*). ponytail: rough figures from
// the plugins' own headers; the bar's own progress is the truth.
const FIRST_START = {
    websearch: 'a first start installs it: about a minute', ocr: 'a first start installs it: a few minutes',
    tts: 'a first start installs it: several GB, about 10 minutes', classify: 'a first start installs it: about 1.7 GB, a few minutes',
    stt: 'a first start installs it and downloads its model: a few minutes',
};
const ENGINE = { ollama: 'Ollama', llamacpp: 'llama.cpp', vllm: 'vLLM', external: 'the external server' };
// How long nobody can chat while each engine (re)starts. vLLM's is the panel's own figure (Access: "about 2 minutes").
const RESTART = {
    vllm: 'about 2 minutes during which nobody can chat',
    llamacpp: 'about a minute during which nobody can chat',
    ollama: 'about a minute: Ollama loads the model to measure the context it holds',
};

const SHIPPED = defaultConfig();
const all = (on) => Object.fromEntries(PLUGINS.map((k) => [k, on]));

// Documents' quality floor: this score or more on EVERY run of the spike's 28-item check (10 code, 7 exact answers, 11
// tool round-trips; thinking on and off, on each box it ran on: catalog.json spike_quality). Qwen3.6 (26–28), Nemotron 3.5
// Lightning (25–27) and Qwen3.8 27B (26–28) pass; Gemma 4 12B (22 with thinking on, which ran away) and a model never run
// on it do not. So a weak model is never picked for its head count alone.
const GATE_FLOOR = 25;
function gateWorst(m) {
    const sq = m.spike_quality; if (!sq) return null;
    const runs = [sq.pro6000_think_on_off, sq.spark_think_on_off].join(' ').match(/\d+(?=\/28)/g) || [];
    return runs.length ? Math.min(...runs.map(Number)) : null;
}
// LOL Vibe's models: proven with the IDE's own coding agent (dsh as LOL Vibe runs it: the profile patch, the fence, the
// syntax check) on the five tasks of docs/spike/ide. The estimator has no agent data, so this list is the proof, by
// catalog id. Qwen3.6: 11/15 (docs/spike/RESULTS.md, "The coding agent: five tasks, Flint vs Qwen3.6", 2026-10-23, on
// the farm's vLLM). Qwen3.8 and Nemotron passed only the P5-0 spike's single edit task (docs/research/p5-spike, 3/3 each on
// Ollama), never the five. Flint (8/10 given 32k replies, 9/15 at 8k) is not here: the farm serves it on llama.cpp only, a
// few people at once, and vLLM's support is in no release yet; it joins once one serves it and HUMAN_TESTS J12–J13
// measured it on the whole GPU.
const AGENT_PROVEN = { 'qwen3.6-35b-a3b': '11/15 on its five tasks, on vLLM' };
const PROVEN_NAMES = Object.keys(AGENT_PROVEN).map((id) => S.modelName(CATALOG.models.find((m) => m.id === id))).join(', ');
const provenOf = (served) => { const c = S.matchModel(CATALOG, served || ''); return (c && AGENT_PROVEN[c.id]) || null; };

// The four presets. `card` = the capacity page's scenario card whose use and head count it is picked for
// (scenarios.js SCENARIOS); `context` overrides that use's own where the preset needs more; `need` adds to its needs;
// `prefer: 'people'` ranks the pairs that cover the head count by people first (scenarios.js byModel); `pool` keeps
// only the catalog models it accepts.
const PRESETS = [
    {
        id: 'balanced', label: 'Balanced', card: 'class',
        what: 'The farm as it ships: chat, documents and a bit of everything. The default.',
        plugins: Object.fromEntries(PLUGINS.map((k) => [k, !!SHIPPED[k].enabled])),
    },
    {
        id: 'rag', label: 'Documents', card: 'rag', context: 65536, prefer: 'people', pool: (m) => gateWorst(m) >= GATE_FLOOR,
        what: 'Questions about documents in Open WebUI (RAG) for the most people: whole documents in the prompt, scanned pages read, documents searched.',
        plugins: { ...all(false), websearch: true, ocr: true },
    },
    {
        id: 'vibe', label: 'LOL Vibe', card: 'xr', context: 65536, budget: 'farm_no_ocr', prefer: 'people', pool: (m) => !!AGENT_PROVEN[m.id],
        what: 'Chat and the IDE\'s coding agent in LOL Vibe for the most people: a model proven with the agent, 64k each, long replies.',
        plugins: { ...all(false), websearch: true },
    },
    {
        id: 'computer', label: 'Computer', card: 'workshop', need: { vision: true, tools: true, good: true },
        what: 'The Computer\'s boxes: pictures, documents, voice, Classify and boards, for the most people at once.',
        plugins: all(true),
    },
];
const IDS = PRESETS.map((p) => p.id);

const fmtK = (t) => (t >= 1048576 ? `${+(t / 1048576).toFixed(1)}M` : `${Math.round(t / 1024)}k`);
const ctxText = (c) => (c === 'auto' ? 'Automatic' : c == null ? '—' : fmtK(c));
const peopleText = (n) => (n === 'auto' ? 'Automatic' : n == null ? '—' : String(n));
const memText = (g) => (g === 'auto' ? 'Automatic' : g == null ? '—' : `${g} GB`);
const r1 = (n) => Math.round(n * 10) / 10;

// The scenario a preset is picked for: its card's use and head count, with the preset's context, budget and needs.
function scenarioOf(p) {
    const c = S.SCENARIOS.find((x) => x.id === p.card);
    const sc = S.card(c);
    if (p.context) { sc.est = { ...sc.est, context: p.context }; sc.need = { ...sc.need, minContext: p.context }; }
    if (p.budget) sc.est = { ...sc.est, budget: p.budget };
    if (p.need) sc.need = { ...sc.need, ...p.need };
    if (p.prefer) sc.prefer = p.prefer;
    sc.title = c.title;
    return sc;
}

// This box in the capacity page's list: only an exact match (the GPU's name and memory). A card the list does not know
// gets no vLLM pick: the estimate would be another card's.
function boxOf(host) {
    const m = S.matchHardware(CATALOG, host);
    if (!m || !m.exact) return null;
    return CATALOG.hardware.find((h) => h.id === m.id) || null;
}

// The vLLM list's entry for a catalog model: one downloaded first (the one vLLM is set to serve, then the others), else
// one the farm can download (a repo).
function entryFor(library, catalogId, current) {
    const of = library.filter((e) => e.catalog === catalogId);
    return of.find((e) => e.downloaded && e.id === current) || of.find((e) => e.downloaded) || of.find((e) => e.repo) || null;
}

// The best vLLM pair on this box for one scenario, restricted to the models of the list that `keep` accepts (a catalog
// model → true). → {entry, pair} | {why}. A pair the estimator would put on llama.cpp (a GGUF) or a card for one person
// is no vLLM pick.
function vllmPair(sc, hw, box, keep = () => true) {
    const lib = box.vllm.library || [];
    const ids = new Set(lib.map((e) => e.catalog).filter(Boolean));
    const models = CATALOG.models.filter((m) => ids.has(m.id) && keep(m) && entryFor(lib, m.id, box.vllm.current));
    if (!models.length) return { why: 'no model of the vLLM list meets what it needs' };
    const rec = S.recommend(E, { ...CATALOG, hardware: [hw], models }, sc, { hwId: hw.id });
    const p = rec.thisFarm;
    if (!p || p.none || !p.r || !p.r.fits) return { why: 'no model of the vLLM list fits this GPU for it' };
    if (p.llama || p.one) return { why: 'the capacity page counts this card for one person at a time' };
    return { entry: entryFor(lib, p.model.id, box.vllm.current), pair: p };
}

const peopleOf = (r) => (r.people.low === r.people.high ? `${r.people.mid}` : `${r.people.mid} (${r.people.low}–${r.people.high})`);

// One preset's picks for this box. `box` (up.js gathers it; the tests build it):
//   host     {gpu, vramGb}
//   vllm     {supported, checked, installed, current, library: [{id, label, catalog, repo, sizeGb, downloaded}]}
//   llamacpp {available, model, id, label, sizeGb, downloaded}
//   ollama   {model, installed (true | false | null = unknown)}
//   plugins  {websearch: {installed}, …}: installed false = its first start installs it
// → {id, label, what, engine, model, modelLabel, context, people, memory, plugins, reasons, needs, people estimate}
function pickFor(id, box) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return null;
    const sc = scenarioOf(p);
    const hw = boxOf(box.host);
    const out = { id: p.id, label: p.label, what: p.what, card: sc.title, headCount: sc.people, plugins: { ...p.plugins }, reasons: [], needs: [], estimate: null };
    const vllmUp = !!(box.vllm && box.vllm.supported && box.vllm.installed);

    // vLLM, where it is set up and this GPU is one the capacity page knows for a group.
    let v = null;
    if (vllmUp && hw) {
        if (p.id === 'balanced') {
            // The shipped vLLM: its default model and context, when the list has it and it fits this GPU.
            const def = SHIPPED.vllm.model;
            const cat = ((box.vllm.library || []).find((e) => e.id === def) || {}).catalog;
            v = cat ? vllmPair(scenarioOf({ ...p, context: SHIPPED.vllm.contextLength }), hw, box, (m) => m.id === cat) : { why: 'its default model is not in the vLLM list' };
            if (v.entry) v.context = SHIPPED.vllm.contextLength;
        }
        if (!v || !v.entry) v = vllmPair(sc, hw, box, p.pool);
        if (v.entry && !v.context) v.context = sc.est.context;
    }
    if (v && v.entry) {
        const e = v.entry; const r = v.pair.r;
        Object.assign(out, { engine: 'vllm', model: e.id, modelLabel: e.label, context: v.context, people: 'auto', memory: 'auto' });
        out.estimate = { mid: r.people.mid, low: r.people.low, high: r.people.high, confidence: r.confidence, covers: !!v.pair.covers };
        out.reasons.push(`${e.label} on vLLM, for ${sc.people} people at once (the capacity page's "${sc.title}"): ${v.pair.reason}`);
        out.reasons.push(...poolReasons(p, v.pair, sc));
        out.reasons.push(contextReason(p, v.context, 'vllm'));
        out.reasons.push('People at once and GPU memory for conversations: Automatic (what was measured on this card, never more than its memory holds).');
        if (!e.downloaded) out.needs.push({ kind: 'vllm', id: e.id, label: e.label, gb: e.sizeGb ?? null, text: `Download ${e.label}${e.sizeGb ? ` (${Math.round(e.sizeGb)} GB)` : ''} in the vLLM list first.` });
    } else {
        // Ollama and llama.cpp. People at once stay each engine's default (no group was measured on these cards), the
        // context Automatic (the most the card holds). LOL Vibe: a model proven with the coding agent first (llama.cpp's,
        // then Ollama's); with neither, llama.cpp's model where llama.cpp runs, as before the agent rule, and it says so.
        const lc = box.llamacpp || {}; const ol = box.ollama || {};
        const llama = p.id === 'vibe' && !!lc.available && (!!provenOf(lc.label) || !provenOf(ol.model));
        const engine = llama ? 'llamacpp' : 'ollama';
        const ctx = SHIPPED[engine].contextLength;
        Object.assign(out, {
            engine, model: llama ? lc.model : ol.model, modelLabel: llama ? lc.label : ol.model,
            context: ctx, people: llama ? SHIPPED.llamacpp.parallel : SHIPPED.ollama.numParallel, memory: null,
        });
        const cat = S.matchModel(CATALOG, out.modelLabel || '');
        const proof = p.id === 'vibe' ? provenOf(out.modelLabel) : null;
        if (proof) out.reasons.push(`${out.modelLabel} on ${ENGINE[engine]}: proven with the IDE's coding agent (${proof}).`);
        else if (llama) {
            const unmet = cat ? S.unmet(cat, sc.need) : null;
            out.reasons.push(`${lc.label} on llama.cpp, the speed pick on one card${!cat ? '' : unmet ? ` (${unmet})` : ': the model has a strong agentic-coding score (measured at full size; a small quant loses some)'}.`);
        } else {
            out.reasons.push(`${ol.model} on Ollama: ${p.id === 'vibe' ? 'llama.cpp cannot run on this computer, so the coding model is Ollama\'s' : 'one model for chat and for reading scanned pages and pictures'}.`);
            if ((p.id === 'computer' || p.id === 'rag') && cat && !cat.vision) out.reasons.push(`${ol.model} does not read images: make a model that does the default in the Ollama section.`);
        }
        if (p.id === 'vibe' && !proof) out.reasons.push(`No model proven with the IDE's coding agent is available here: so far only ${PROVEN_NAMES} is (${Object.values(AGENT_PROVEN).join('; ')}).`);
        out.reasons.push(`Context: Automatic, the most this card holds${p.context ? ` (the aim is ${fmtK(p.context)} each)` : ''}.`);
        out.reasons.push(`People at once: ${out.people}, ${ENGINE[engine]}'s default.`);
        if (vllmUp && !hw) out.reasons.push('vLLM is set up, but the capacity page does not know this GPU, so the presets keep to Ollama and llama.cpp. vLLM stays one click away in its section.');
        else if (vllmUp && v && v.why) out.reasons.push(`Not vLLM: ${v.why}.`);
        else if (!vllmUp && hw && box.vllm && box.vllm.supported) {
            const could = vllmPair(sc, hw, { ...box, vllm: { ...box.vllm, library: (box.vllm.library || []).map((e) => ({ ...e, downloaded: true })) } }, p.pool);
            if (could.entry) out.reasons.push(`${box.vllm.checked ? 'vLLM is not set up on this computer' : 'vLLM has not been checked on this computer yet'}: with it, this GPU would serve about ${peopleOf(could.pair.r)} people with ${could.entry.label} (the vLLM section ${box.vllm.checked ? 'installs it' : 'checks it'}).`);
        }
        if (llama && !lc.downloaded) out.needs.push({ kind: 'llamacpp', id: lc.id || null, url: lc.id ? null : lc.model, label: lc.label, gb: lc.sizeGb ?? null, text: `Download ${lc.label}${lc.sizeGb ? ` (${Math.round(lc.sizeGb)} GB)` : ''} for llama.cpp first.` });
        if (!llama && ol.installed === false) out.needs.push({ kind: 'ollama', id: ol.model, label: ol.model, gb: null, text: `Download ${ol.model} in the Ollama section first.` });
    }
    out.reasons.push(pluginReason(p, out.engine));
    return out;
}

// Why this model among the others, for the presets that pick the most people from a pool.
function poolReasons(p, pair, sc) {
    if (p.id === 'rag') {
        // Documents are asked out of step (the scenario's mode); a class that starts together gets fewer: said.
        const ev = E.estimate(pair.hw.id, pair.model.id, { ...sc.est, mode: 'every' });
        const together = ev.fits && ev.people.mid < pair.r.people.mid ? `; when everyone asks at the same moment, about ${peopleOf(ev)}, ${ev.confidence}` : '';
        return [`Picked for the most people at ${fmtK(sc.est.context)} among the models that scored ${GATE_FLOOR}/28 or more on every run of the spike's quality check${together}.`,
            ...(pair.model.vision ? [] : ['It does not read images: documents reach it as text, and scanned pages go through document reading (OCR), a model of its own.'])];
    }
    if (p.id === 'vibe') {
        return [`Picked for the most people among the models proven with the IDE's coding agent: ${AGENT_PROVEN[pair.model.id]}. `
            + 'Flint is not one yet: the farm serves it on llama.cpp only, a few people at once; it joins once a vLLM release serves it and it is measured here.'];
    }
    return [];
}

function contextReason(p, ctx, engine) {
    if (p.id === 'rag') return `${fmtK(ctx)} each: Open WebUI puts whole documents in the prompt from 24k each, and ${fmtK(ctx)} holds twice what 32k does.`;
    if (p.id === 'vibe') return `${fmtK(ctx)} each: the coding agent works over a 64k window, with room for long replies.`;
    if (p.id === 'computer') return `${fmtK(ctx)} each: the Computer's boxes send short asks, so more people fit.`;
    return `${fmtK(ctx)} each: ${ENGINE[engine]}'s default.`;
}
function pluginReason(p, engine) {
    if (p.id === 'vibe') return `Document reading off: ${engine === 'vllm' ? 'its 9 GB go to vLLM\'s conversations' : 'its vision model leaves the GPU'}. Web search on; voice, Classify, speech to text and the message bus off. Document search stays as it is.`;
    if (p.id === 'computer') return 'Every plugin on: the Image, Document, Sound, Converse, Speak, Classify, Receive and Send boxes use them. Document search stays as it is.';
    if (p.id === 'rag') return 'Document reading and web search on; voice, Classify, speech to text and the message bus off. Document search stays as it is.';
    return 'The plugins as the farm ships them: web search and document reading on, the others off. Document search stays as it is.';
}

const picksFor = (box) => IDS.map((id) => pickFor(id, box));

// What the farm is set to now, from the config FILE parsed (memory can hold a fallback's engine): the engine, its
// model, context, people at once and (vLLM) memory, and each plugin. The same shape as pickSettings.
function settingsOf(config) {
    const engine = engineOf(config);
    const s = { engine, model: null, context: null, people: null, memory: null, plugins: {} };
    if (engine === 'vllm') Object.assign(s, { model: config.vllm.model, context: config.vllm.contextLength, people: config.vllm.parallel, memory: config.vllm.kvCacheGib });
    else if (engine === 'llamacpp') Object.assign(s, { model: config.llamacpp.model, context: config.llamacpp.contextLength, people: config.llamacpp.parallel });
    else if (engine === 'ollama') {
        const d = defaultModelEntry(config);
        Object.assign(s, { model: d ? d.id : null, context: config.ollama.contextLength, people: config.ollama.numParallel });
    } else s.model = config.external.alias;
    for (const k of PLUGINS) s.plugins[k] = !!(config[k] && config[k].enabled);
    return s;
}
const pickSettings = (p) => ({ engine: p.engine, model: p.model, context: p.context, people: p.people, memory: p.memory ?? null, plugins: { ...p.plugins } });

// What differs between two settings, in plain words, field by field. `label(model)` names a model.
function differences(from, to, label = (m) => m) {
    const out = [];
    const add = (field, text, extra = {}) => out.push({ field, text, ...extra });
    if (from.engine !== to.engine) add('engine', `Engine: ${ENGINE[from.engine]} → ${ENGINE[to.engine]}`, { restart: to.engine });
    else {
        if (from.model !== to.model) add('model', `Model: ${label(from.model)} → ${label(to.model)}`);
        if (from.context !== to.context) add('context', `Context per person: ${ctxText(from.context)} → ${ctxText(to.context)}`);
        if (from.people !== to.people) add('people', `People at once: ${peopleText(from.people)} → ${peopleText(to.people)}`);
        if (to.engine === 'vllm' && from.memory !== to.memory) add('memory', `GPU memory for conversations: ${memText(from.memory)} → ${memText(to.memory)}`);
    }
    for (const k of PLUGINS) {
        if (!!from.plugins[k] !== !!to.plugins[k]) add(`plugin:${k}`, `${PLUGIN_LABEL[k]}: ${from.plugins[k] ? 'on' : 'off'} → ${to.plugins[k] ? 'on' : 'off'}`, { plugin: k, on: !!to.plugins[k] });
    }
    return out;
}

// The dry run's list: what Apply changes, with what restarts and how long (`plugins` = box.plugins). With another
// engine, its settings come with the switch (one start, never two). Ollama's people at once apply only when the farm
// restarts (up.js setSlots): `ollamaPeople` = what the file says for it now.
function changesFor(cur, pick, { label = (m) => m, plugins = {}, ollamaPeople = null } = {}) {
    const to = pickSettings(pick);
    const list = differences(cur, to, label);
    const sw = list.find((c) => c.field === 'engine');
    if (sw) {
        sw.text += ` (${RESTART[to.engine]})`;
        list.splice(1, 0, ...[
            ['model', `Model: ${label(to.model)}`], ['context', `Context per person: ${ctxText(to.context)}`],
            ['people', `People at once: ${peopleText(to.people)}`],
            ...(to.engine === 'vllm' ? [['memory', `GPU memory for conversations: ${memText(to.memory)}`]] : []),
        ].map(([field, text]) => ({ field, text })));
    }
    for (const c of list) {
        if (c.plugin && c.on && plugins[c.plugin] && plugins[c.plugin].installed === false) c.text += ` (${FIRST_START[c.plugin]})`;
        if (c.field === 'people' && to.engine === 'ollama' && (sw ? ollamaPeople !== to.people : true)) c.text += ' (applies when the farm restarts)';
    }
    return list;
}

// The preset the card marks: the one recorded (`stored`, {id, applied}), else Balanced; `changed` = what the file now
// holds that differs from what that preset applied (an older file with none recorded: from what it picks now).
function statusOf(stored, cur, picks, label) {
    const id = stored && IDS.includes(stored.id) ? stored.id : 'balanced';
    const p = picks.find((x) => x.id === id);
    const applied = stored && stored.id === id && stored.applied ? stored.applied : (p ? pickSettings(p) : null);
    const changed = applied ? differences(applied, cur, label).map((c) => c.text) : [];
    return { id, label: (PRESETS.find((x) => x.id === id) || {}).label, recorded: !!(stored && stored.id === id), changed };
}

module.exports = { PRESETS, IDS, PLUGINS, PLUGIN_LABEL, ENGINE, RESTART, pickFor, picksFor, settingsOf, pickSettings, differences, changesFor, statusOf, boxOf, scenarioOf, fmtK };
