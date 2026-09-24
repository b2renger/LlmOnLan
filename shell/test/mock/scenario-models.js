// The scenario models (plan §2.3 "Scenario models (P0)").
//
// Every model is a behaviour, not a weight: the client is the thing under test, so each
// id reproduces exactly one farm behaviour the real stack can produce. Pacing is the
// legacy mock's: 5 deltas per 15 ms tick ~= 330 deltas/s, ABOVE the real farm's measured
// 154.8 tok/s, so the render path is genuinely stressed (state.streamRate overrides it).
//
// A model handler owns the response from writeHead to end; it must clear its timers on
// res.on('close') (the client aborting) — the driver only marks the log entry.
'use strict';

const fs = require('fs');
const path = require('path');
const { seatsFullBody, upstreamDownBody, SEATS_FULL_HEADERS } = require('./seats-body');

const FIXTURE_MD = path.join(__dirname, '..', 'chat', 'fixtures', 'md');
const PERF_NAMES = ['mixed', 'list-500', 'table-300', 'paragraph-20k', 'nested-fence', 'reasoning-40k'];

/** Static ids advertised by /v1/models (the perf family is expanded from PERF_NAMES). */
const STATIC_MODEL_IDS = [
    'assistant', 'gemma4:12b',
    'mock-echo', 'mock-md', 'mock-xss', 'mock-think-tags',
    'mock-429', 'mock-502', 'mock-midstream-error', 'mock-reset',
    'mock-context-overflow', 'mock-length', 'mock-restart-on-prefill',
    'mock-slow', 'mock-usage-none',
    // S0 kickoff (studio plan 2.3): the ask spine's corpus.
    'mock-studio-json', 'mock-json-empty', 'mock-json-reasoning-only',
    'mock-vision-echo', 'mock-vision-refuse',
    // C2 kickoff (plan §2.6 BH-11): fan-out needs a model whose answer IDENTIFIES the item it was
    // asked about, so a scenario can assert 40 distinct generations rather than 40 calls.
    'mock-item',
    // K2 kickoff (COMPUTER_PLAN §11): the assembled prompt's own SHAPE, reported back. A
    // scenario can then assert that `## societal research` came before `## environmental
    // research` without a real model and without asserting on prose.
    'mock-headings',
    // K3 kickoff (COMPUTER_PLAN §11 K3): Condition's `mode:'model'` asks one cheap question and
    // reads a verdict back. A scenario needs that verdict to be CHOSEN, not guessed — so this
    // model answers from `state.verdicts`, a queue consumed in order whose last entry repeats.
    // Default ['maybe'], because §6.6's rule is that anything unreadable is maybe, never no.
    'mock-verdict',
    // K5 kickoff (addendum KE-10): the Write-… presets ask for CODE, and a local model wraps its
    // code in a markdown fence often enough that unwrapping it is the feature. This model answers
    // with a short sentence and then ONE fenced block of the kind the prompt asked for (svg / p5 /
    // three / html, read off the last user message), so a scenario proves the fence is stripped
    // and the picture is drawn, deterministically, with no real model.
    'mock-code',
    // K6 kickoff (LOLCHAT_PLAN 2.6 KF-10): one model per capability answer the client must be able
    // to TELL APART in /model_group/info. The pinned LiteLLM (1.97) never reports audio or PDF
    // input at all (KF-1(a)); these rows exist so the resolver's yes/no/unknown branches are
    // exercised, and every one of them ANSWERS like mock-echo.
    'mock-hears',        // supports_audio_input: true, supports_vision: false
    'mock-reads-pdf',    // supports_pdf_input: true,   supports_vision: true
    'mock-nocaps',       // a row with NO supports_* field at all: every verdict stays unknown
];
const MODEL_IDS = [...STATIC_MODEL_IDS, ...PERF_NAMES.map((n) => `mock-perf:${n}`)];

// Vision: the real farm advertises it per model group. gemma4:12b is the vision-native
// default; mock-echo claims vision so image tests have a model that accepts parts and
// reports what it got. `assistant` deliberately does NOT (plan §2.3), so the client's
// vision gate has something to gate.
const VISION_MODELS = new Set(['gemma4:12b', 'mock-echo', 'mock-vision-echo', 'mock-headings', 'mock-reads-pdf']);

function modelList() {
    return { object: 'list', data: MODEL_IDS.map((id) => ({ id, object: 'model', owned_by: 'mock' })) };
}
/**
 * GET /model_group/info. `state.modelGroupInfo` REPLACES the body outright (S0 kickoff), so a
 * scenario can make the farm advertise supports_vision:false without touching a POST.
 */
function modelGroupInfo(store) {
    const override = store && store.state && store.state.modelGroupInfo;
    if (override) return override;
    return {
        data: MODEL_IDS.map((id) => {
            if (id === 'mock-nocaps') return { model_group: id };
            const row = { model_group: id, supports_vision: VISION_MODELS.has(id) };
            if (id === 'mock-hears') row.supports_audio_input = true;
            if (id === 'mock-reads-pdf') row.supports_pdf_input = true;
            return row;
        }),
    };
}

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': '*',
    'Access-Control-Allow-Headers': '*',
};

/** Deterministic PRNG (the same mulberry32 the renderer's core/env.mjs uses). */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The text of a message whose content is a string or an OpenAI content-part array. */
function textOf(msg) {
    if (!msg) return '';
    const c = msg.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    return '';
}
function partsOf(msg) {
    const c = msg && msg.content;
    return Array.isArray(c) ? c : [];
}

/** prompt_tokens per plan §2.3: a deterministic, non-3.6 ratio so calibration is testable. */
function promptTokens(body) {
    try { return Math.ceil(JSON.stringify((body && body.messages) || []).length / 3); } catch { return 0; }
}

function sse(res, extraHeaders) {
    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        ...CORS,
        ...(extraHeaders || {}),
    });
    return {
        send(o) { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); },
        raw(s) { if (!res.writableEnded) res.write(s); },
        done() { if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); } },
        end() { if (!res.writableEnded) res.end(); },
    };
}

const now = () => Math.floor(Date.now() / 1000);

/** One OpenAI chunk. `delta` is {content} | {reasoning_content} | {}. */
function chunk(model, delta, finish) {
    return {
        id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: now(), model,
        choices: [{ index: 0, delta: delta || {}, finish_reason: finish === undefined ? null : finish }],
    };
}

/** LiteLLM sends usage in a choices-empty chunk; the legacy mock did the same. */
function usageChunk(model, completionTokens, body) {
    const p = promptTokens(body);
    return {
        id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: now(), model,
        choices: [],
        usage: { completion_tokens: completionTokens, prompt_tokens: p, total_tokens: completionTokens + p },
    };
}

/**
 * Drive next() at ~330 deltas/s until it returns null, then call onDone().
 * Windows timer resolution is ~15 ms, hence a burst per tick rather than one delta per tick.
 * Returns a stop() the caller can use for its own teardown.
 */
function pace(res, store, next, onDone, opts = {}) {
    // state.askDelayMs (S0 kickoff) delays the FIRST delta of every paced stream, for the queue
    // and cancellation scenarios. It is a one-shot lead-in, not a slower rate.
    const lead = Number(store && store.state && store.state.askDelayMs) || 0;
    if (lead > 0 && !opts.__delayed) {
        let inner = () => {};
        const t = setTimeout(() => {
            if (res.writableEnded || res.destroyed) return;
            inner = pace(res, store, next, onDone, { ...opts, __delayed: true });
        }, lead);
        const stopAll = () => { clearTimeout(t); inner(); };
        res.on('close', stopAll);
        return stopAll;
    }
    // An explicit state.streamRate (POST /mock/state) WINS over a model's own opts — that is
    // what the header comment promises and what lets a test drain a 40k-char fixture quickly.
    const rate = (store && store.state && store.state.streamRate) || {};
    const tickMs = rate.tickMs || opts.tickMs || 15;
    const perTick = rate.perTick || opts.perTick || 5;
    let timer = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    timer = setInterval(() => {
        for (let i = 0; i < perTick; i++) {
            if (res.writableEnded || res.destroyed) return stop();
            const v = next();
            if (v === null || v === undefined) { stop(); return onDone(); }
        }
    }, tickMs);
    // 'close' on the RESPONSE is the client-went-away signal ('close' on the request fires
    // on request completion in modern Node and would kill the stream before the first delta).
    res.on('close', stop);
    return stop;
}

/** Read a fixture, or warn once and return a stand-in (P0-U3 lands fixtures/md/**). */
function fixture(relPath, store, fallback) {
    const file = path.join(FIXTURE_MD, relPath);
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        store.warn(`fixture missing: ${path.relative(path.join(__dirname, '..'), file)} — streaming a built-in stand-in (P0-U3 lands the md fixtures)`);
        return fallback;
    }
}

const STANDIN_MD = [
    '# Mock stand-in',
    '',
    'The markdown fixture is not on disk yet, so this short document is streamed instead.',
    '',
    '```js',
    "console.log('hello');",
    '```',
    '',
    '- one',
    '- two',
    '',
].join('\n');

/** Split text into chunks of min..max chars with a seeded PRNG. */
function seededChunks(text, min, max, seed) {
    const rnd = mulberry32(seed);
    const out = [];
    let i = 0;
    while (i < text.length) {
        const n = min + Math.floor(rnd() * (max - min + 1));
        out.push(text.slice(i, i + n));
        i += n;
    }
    return out;
}

/** Stream an array of content strings, then (optionally) a finish chunk, usage and [DONE]. */
function streamContent(model, res, store, body, chunks, opts = {}) {
    const out = sse(res);
    let i = 0;
    const next = () => {
        if (i >= chunks.length) return null;
        out.send(chunk(model, { content: chunks[i++] }));
        return true;
    };
    pace(res, store, next, () => {
        if (opts.finish !== undefined) out.send(chunk(model, {}, opts.finish));
        if (opts.usage !== false) out.send(usageChunk(model, chunks.length, body));
        out.done();
    }, opts);
}

// ---------------------------------------------------------------------------------------------
// the models
// ---------------------------------------------------------------------------------------------

/** assistant / gemma4:12b — the legacy stream: 100 reasoning + 1000 content + usage + [DONE]. */
function legacyStream(model, res, store, body) {
    const out = sse(res);
    const R = 100, C = 1000;
    let i = 0;
    const next = () => {
        if (i < R) { out.send(chunk(model, { reasoning_content: `think${i} ` })); i++; return true; }
        if (i < R + C) { out.send(chunk(model, { content: `tok${i - R} ` })); i++; return true; }
        return null;
    };
    pace(res, store, next, () => {
        // finish_reason rides the usage chunk so the delta counts stay exactly 100 and 1000.
        const u = usageChunk(model, C, body);
        u.choices = [{ index: 0, delta: {}, finish_reason: 'stop' }];
        out.send(u);
        out.done();
    });
}

/**
 * mock-echo — a summary of the request as `key: value` lines (one per line, parseable).
 * The keys are documented in shell/test/chat/README.md; add keys at the END, never rename.
 */
function echoLines(body) {
    const messages = Array.isArray(body && body.messages) ? body.messages : [];
    const partTypes = [];
    const textLengths = [];
    const systemTexts = [];
    let imageCount = 0;
    let hasReasoningField = false;
    let allText = '';
    for (const m of messages) {
        for (const p of partsOf(m)) {
            const ty = p && p.type ? String(p.type) : 'unknown';
            partTypes.push(ty);
            if (ty === 'image_url') imageCount++;
        }
        const txt = textOf(m);
        textLengths.push(txt.length);
        allText += `\n${txt}`;
        if (m && (m.reasoning !== undefined || m.reasoning_content !== undefined)) hasReasoningField = true;
        if (m && m.role === 'system') systemTexts.push(txt);
    }
    const SKIP = new Set(['messages', 'model', 'stream', 'stream_options', 'response_format']);
    const paramKeys = Object.keys(body || {}).filter((k) => !SKIP.has(k)).sort();
    const params = paramKeys.map((k) => `${k}=${JSON.stringify(body[k])}`).join('; ');
    const last = messages[messages.length - 1];
    const DOC = '<' + '<document';
    const SCENE = '<' + '<blender-scene';
    return [
        `model: ${body && body.model}`,
        `messageCount: ${messages.length}`,
        `roles: ${messages.map((m) => (m && m.role) || '?').join(',')}`,
        `lastRole: ${(last && last.role) || ''}`,
        `partTypes: ${partTypes.join(',')}`,
        `imageCount: ${imageCount}`,
        `textLengths: ${textLengths.join(',')}`,
        `systemText: ${JSON.stringify(systemTexts.join('\n\n'))}`,
        `paramKeys: ${paramKeys.join(',')}`,
        `params: ${params}`,
        `responseFormat: ${JSON.stringify((body && body.response_format) || null)}`,
        `stream: ${!!(body && body.stream)}`,
        `hasReasoningField: ${hasReasoningField}`,
        `markerDocument: ${allText.includes(DOC)}`,
        `markerWebSearch: ${allText.includes('Web search results')}`,
        `markerBlenderScene: ${allText.includes(SCENE)}`,
    ];
}

/**
 * mock-code (K5 kickoff, addendum KE-10) — prose, then ONE fenced code block of the kind the last
 * user message asks for. The kind is the FIRST of svg / three / p5 / html the prompt mentions
 * (case-insensitive; `three.js` counts as three, `p5.js` as p5); none → svg. `state.codeReply`
 * (a string) replaces the whole answer when a scenario needs a specific one — a broken sketch, an
 * unfenced answer, two fences.
 */
const CODE_REPLIES = {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#bfe3f2"/><circle cx="320" cy="70" r="36" fill="#f2b134"/><path d="M0 230 Q100 150 200 220 T400 210 V300 H0 Z" fill="#5b8c5a"/></svg>',
    p5: 'function setup() {\n  createCanvas(400, 300);\n  noLoop();\n}\n\nfunction draw() {\n  background(30, 30, 40);\n  fill(240, 180, 60);\n  circle(200, 150, 120);\n}',
    three: 'const renderer = new THREE.WebGLRenderer({ canvas: lol.canvas, preserveDrawingBuffer: true });\nrenderer.setSize(lol.size.w, lol.size.h, false);\nconst scene = new THREE.Scene();\nconst camera = new THREE.PerspectiveCamera(50, lol.size.w / lol.size.h, 0.1, 100);\ncamera.position.z = 4;\nconst mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.35, 16, 48), new THREE.MeshNormalMaterial());\nscene.add(mesh);\nrenderer.render(scene, camera);',
    html: '<h1>An exhibition</h1>\n<p>Three rooms about the sea.</p>\n<ul><li>Tides</li><li>Wrecks</li><li>Light</li></ul>',
};
const CODE_FENCE_LANG = { svg: 'svg', p5: 'javascript', three: 'javascript', html: 'html' };

function codeReply(body, store) {
    if (store && store.state && typeof store.state.codeReply === 'string') return store.state.codeReply;
    const messages = Array.isArray(body && body.messages) ? body.messages : [];
    // Critic R1 A8: a Write-… Instruction now says WHAT to draw in its instruction ("A slow,
    // colourful spiral that turns.") and HOW in the system message ("You write ONE p5.js sketch…").
    // The system message names the kind first, so it is read first; the prompt is the fallback
    // for an ordinary Instruction that asks for code in its own words.
    const system = messages.filter((m) => m && m.role === 'system').map(textOf).join('\n');
    const said = /You write ONE (?:still )?(p5\.js|three\.js|SVG|small web page)/i.exec(system);
    if (said) {
        const k = said[1].toLowerCase();
        const kind = k.startsWith('p5') ? 'p5' : k.startsWith('three') ? 'three' : k === 'svg' ? 'svg' : 'html';
        return `Here is the code you asked for:\n\n\`\`\`${CODE_FENCE_LANG[kind]}\n${CODE_REPLIES[kind]}\n\`\`\`\n\nChange the numbers to make it your own.`;
    }
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
    const prompt = textOf(lastUser).toLowerCase();
    const at = (re) => { const m = re.exec(prompt); return m ? m.index : Infinity; };
    const where = { svg: at(/\bsvg\b/), three: at(/\bthree(\.js)?\b/), p5: at(/\bp5(\.js)?\b/), html: at(/\bhtml\b/) };
    const kind = Object.keys(where).sort((a, b) => where[a] - where[b]).find((k) => where[k] !== Infinity) || 'svg';
    return `Here is the code you asked for:\n\n\`\`\`${CODE_FENCE_LANG[kind]}\n${CODE_REPLIES[kind]}\n\`\`\`\n\nChange the numbers to make it your own.`;
}

/**
 * mock-headings — the markdown HEADINGS of the last user message, in order, one per line, then
 * three summary lines. K2 (COMPUTER_PLAN §5.3): the assembled prompt's structure IS the contract
 * between an arrow's label and what the model reads, so a scenario asserts the structure rather
 * than a sentence a model happened to produce.
 *
 *   heading: ## societal research
 *   heading: ### 1
 *   images: 0
 *   systemChars: 213
 *   promptChars: 1840
 *
 * Keys are added at the END, never renamed — the same rule mock-echo's line list follows.
 */
function headingLines(body) {
    const messages = Array.isArray(body && body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
    const system = messages.filter((m) => m && m.role === 'system').map(textOf).join('\n\n');
    const prompt = textOf(lastUser);
    const images = messages.reduce((n, m) => n + partsOf(m).filter((p) => p && p.type === 'image_url').length, 0);
    // Headings only OUTSIDE a fenced block: a wired code value is fenced (§5.3), and a `#` comment
    // inside it is Python, not structure.
    const out = [];
    let fenced = false;
    for (const line of String(prompt).split('\n')) {
        if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
        if (fenced) continue;
        if (/^#{1,6} /.test(line)) out.push(`heading: ${line.trim()}`);
    }
    out.push(`images: ${images}`);
    out.push(`systemChars: ${system.length}`);
    out.push(`promptChars: ${String(prompt).length}`);
    return out;
}

/** mock-length — 200 tokens then finish_reason "length"; continues a trailing assistant. */
function lengthChunks(body) {
    const messages = Array.isArray(body && body.messages) ? body.messages : [];
    const last = messages[messages.length - 1];
    const N = 200;
    if (last && last.role === 'assistant') {
        const words = textOf(last).trim().split(/\s+/).filter(Boolean);
        const lastWord = words[words.length - 1] || '';
        const m = /^tok(\d+)$/.exec(lastWord);
        if (m) {
            const start = Number(m[1]) + 1;
            return Array.from({ length: N }, (_, i) => `tok${start + i} `);
        }
        return [`${lastWord}-continued `, ...Array.from({ length: N - 1 }, (_, i) => `tok${i + 1} `)];
    }
    return Array.from({ length: N }, (_, i) => `tok${i} `);
}

/** mock-restart-on-prefill — the badly-behaved model the "continue" UX exists for. */
function restartChunks(body) {
    const messages = Array.isArray(body && body.messages) ? body.messages : [];
    const last = messages[messages.length - 1];
    const asksToContinue = last && last.role === 'user'
        && textOf(last).includes('Continue exactly where you stopped');
    if (asksToContinue) {
        const prev = [...messages].reverse().find((m) => m && m.role === 'assistant');
        const words = textOf(prev).trim().split(/\s+/).filter(Boolean);
        const lastWord = words[words.length - 1] || '';
        const m = /^tok(\d+)$/.exec(lastWord);
        const start = m ? Number(m[1]) + 1 : 1;
        return ['(continuing) ', ...Array.from({ length: 199 }, (_, i) => `tok${start + i} `)];
    }
    // A trailing assistant is simply ignored: the model starts over.
    return ['Hello! ', ...Array.from({ length: 199 }, (_, i) => `tok${i} `)];
}

// ---------------------------------------------------------------------------------------------
// S0: the ask spine's models (studio plan 2.3)
// ---------------------------------------------------------------------------------------------

/**
 * A DETERMINISTIC instance of a JSON-Schema subset: strings "s1","s2"..., numbers 1, booleans
 * true, arrays of 3, enum takes its first value, `required` honoured, additionalProperties:false
 * respected. The same instance is produced whether the schema rode in `response_format` or was
 * rendered into the prompt, so prompt-and-parse can be compared byte for byte with schema mode.
 */
function instanceOf(schema, counter = { n: 0 }) {
    const sc = schema && typeof schema === 'object' ? schema : {};
    if (Array.isArray(sc.enum) && sc.enum.length) return sc.enum[0];
    const type = Array.isArray(sc.type) ? sc.type[0] : sc.type;
    if (type === 'array') return [0, 1, 2].map(() => instanceOf(sc.items || { type: 'string' }, counter));
    if (type === 'number' || type === 'integer') return 1;
    if (type === 'boolean') return true;
    if (type === 'null') return null;
    if (type === 'object' || sc.properties) {
        const props = sc.properties || {};
        const required = Array.isArray(sc.required) ? sc.required : null;
        const out = {};
        for (const [key, sub] of Object.entries(props)) {
            if (required && !required.includes(key)) continue;   // only what was asked for
            out[key] = instanceOf(sub, counter);
        }
        if (required) for (const key of required) if (!(key in out)) out[key] = instanceOf(props[key] || {}, counter);
        return out;
    }
    counter.n += 1;
    return `s${counter.n}`;
}

/** The schema the request carried, or null. */
function schemaOf(body) {
    const rf = body && body.response_format;
    if (rf && rf.type === 'json_schema') {
        const js = rf.json_schema || {};
        if (js.schema) return js.schema;
    }
    // BD-11: the instance must be the SAME whether the schema arrived in `response_format` or in
    // the prompt. In prompt mode (and after the proxy's structuredDrop) the schema is the single
    // JSON line the ask spine writes after app/json.mjs's promptFor() marker.
    return schemaFromPrompt(body);
}

const SCHEMA_MARKER = 'The answer must match this JSON Schema exactly:';

/** Pull the schema out of the prompt text the ask spine's promptFor() writes. */
function schemaFromPrompt(body) {
    const messages = (body && Array.isArray(body.messages)) ? body.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const c = messages[i] && messages[i].content;
        const text = typeof c === 'string'
            ? c
            : (Array.isArray(c) ? c.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n') : '');
        const at = text.indexOf(SCHEMA_MARKER);
        if (at < 0) continue;
        const line = text.slice(at + SCHEMA_MARKER.length).split('\n').find((l) => l.trim());
        if (!line) continue;
        try {
            const parsed = JSON.parse(line.trim());
            if (parsed && typeof parsed === 'object') return parsed;
        } catch { /* not the marker we wrote — fall through to the default shape */ }
    }
    return null;
}

/** The JSON text mock-studio-json answers with, for whatever schema it was (or was not) sent. */
function studioJsonText(body) {
    const schema = schemaOf(body) || { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };
    return JSON.stringify(instanceOf(schema), null, 2);
}

/** Split a string into small deltas (the ask spine must survive a JSON split mid-token). */
function jsonChunks(text) {
    const out = [];
    for (let i = 0; i < text.length; i += 7) out.push(text.slice(i, i + 7));
    return out;
}

/** mock-vision-echo: what arrived, as markdown `key: value` lines. */
function visionEchoLines(body) {
    const messages = Array.isArray(body && body.messages) ? body.messages : [];
    const images = [];
    for (const m of messages) {
        for (const p of partsOf(m)) {
            if (!p || p.type !== 'image_url') continue;
            const url = (p.image_url && p.image_url.url) || '';
            const m2 = /^data:([^;,]+)[;,]/.exec(String(url));
            const comma = String(url).indexOf(',');
            const b64 = comma >= 0 ? String(url).slice(comma + 1) : '';
            images.push({ mime: m2 ? m2[1] : 'unknown', bytes: Math.floor(b64.length * 0.75) });
        }
    }
    return [
        `images: ${images.length}`,
        `mimes: ${images.map((i) => i.mime).join(',')}`,
        `bytes: ${images.map((i) => i.bytes).join(',')}`,
        `detail: ${images.length ? 'present' : 'none'}`,
    ];
}

/**
 * Dispatch POST /v1/chat/completions to a model behaviour.
 * @returns {boolean} false when the id is unknown (the caller answers 404).
 */
function handleCompletion({ model, res, body, store }) {
    const id = String(model || '');

    // ---- state.failWhen (C2 kickoff, plan §2.6 BH-11) -----------------------------------
    // The per-ITEM failure fixture: any request whose last user text contains this string gets a
    // 502, whatever the model is. `mock-502` fails everything, which cannot express "one bad item
    // in forty" — the exact case the Computer's per-item errors exist for.
    const failWhen = store.state.failWhen ? String(store.state.failWhen) : '';
    if (failWhen) {
        const messages = Array.isArray(body && body.messages) ? body.messages : [];
        const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
        if (textOf(lastUser).includes(failWhen)) {
            res.writeHead(502, { 'content-type': 'application/json', ...CORS });
            res.end(JSON.stringify(upstreamDownBody()));
            return true;
        }
    }

    // ---- mock-item: the ITEM the request was about, echoed back --------------------------
    // K2 landing: the Instruction assembles COMPUTER_PLAN §5.3 — the inputs under `## ` headings
    // FIRST and the instruction LAST — so "the last line of the prompt" is now the instruction and
    // no longer identifies the item. When the prompt carries that shape, the item is the first
    // line under the first `## ` heading; any other caller still gets the last line.
    if (id === 'mock-item') {
        const messages = Array.isArray(body && body.messages) ? body.messages : [];
        const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
        const lines = String(textOf(lastUser)).split('\n').map((l) => l.trim()).filter(Boolean);
        const at = lines.findIndex((l) => l.startsWith('## '));
        const under = at >= 0 ? lines.slice(at + 1).find((l) => !l.startsWith('#')) : '';
        const item = under || (lines.length ? lines[lines.length - 1] : '');
        streamContent(id, res, store, body, ['item: ', item], { finish: 'stop' });
        return true;
    }

    // ---- non-streaming failures --------------------------------------------------------
    if (id === 'mock-429') {
        const cap = (store.state.capacity && store.state.capacity.slots) || 2;
        const idleSec = (store.state.capacity && store.state.capacity.seatIdleSec) || 900;
        res.writeHead(429, { ...SEATS_FULL_HEADERS, ...CORS });
        res.end(JSON.stringify(seatsFullBody({ cap, idleSec })));
        return true;
    }
    if (id === 'mock-502') {
        res.writeHead(502, { 'content-type': 'application/json', ...CORS });
        res.end(JSON.stringify(upstreamDownBody()));
        return true;
    }
    if (id === 'mock-context-overflow') {
        res.writeHead(400, { 'content-type': 'application/json', ...CORS });
        res.end(JSON.stringify({
            error: {
                message: "litellm.ContextWindowExceededError: ContextWindowExceededError: OpenAIException - This model's maximum context length is 16384 tokens. However, your messages resulted in 20481 tokens. Please reduce the length of the messages.",
                type: 'invalid_request_error',
                param: 'messages',
                code: '400',
            },
        }));
        return true;
    }

    // ---- vision refusal (P3 kickoff extends this with state.visionRefuseAll) -----------
    const hasImage = (Array.isArray(body && body.messages) ? body.messages : [])
        .some((m) => partsOf(m).some((p) => p && p.type === 'image_url'));
    if (hasImage && (store.state.visionRefuseAll || id === 'mock-vision-refuse')) {
        res.writeHead(400, { 'content-type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: { message: 'this model does not support image input' } }));
        return true;
    }

    // ---- streams -----------------------------------------------------------------------
    if (id === 'assistant' || id === 'gemma4:12b') { legacyStream(id, res, store, body); return true; }

    if (id === 'mock-headings') {
        const lines = headingLines(body);
        streamContent(id, res, store, body, lines.map((l, i) => (i === lines.length - 1 ? l : `${l}\n`)), { finish: 'stop' });
        return true;
    }

    if (id === 'mock-verdict') {
        const queue = Array.isArray(store.state.verdicts) && store.state.verdicts.length
            ? store.state.verdicts : ['maybe'];
        // Consumed in order; the LAST entry repeats for every further call, so a three-Condition
        // fan can be scripted with three entries and a loop with one.
        const at = Math.min(store.verdictAt || 0, queue.length - 1);
        store.verdictAt = (store.verdictAt || 0) + 1;
        const verdict = String(queue[at]);
        // A JSON object, so the SAME model serves `ask.json` (schema {verdict}) and a text-mode
        // read: `classify()` reads `{"verdict":"yes"}`'s first token as prose and would say maybe,
        // so a text-mode scenario asks for `mock-echo` instead and this one stays JSON-shaped.
        streamContent(id, res, store, body, jsonChunks(JSON.stringify({ verdict }, null, 2)), { finish: 'stop' });
        return true;
    }

    if (id === 'mock-code') {
        const lines = codeReply(body, store).split('\n');
        streamContent(id, res, store, body, lines.map((l, i) => (i === lines.length - 1 ? l : `${l}\n`)), { finish: 'stop' });
        return true;
    }

    if (id === 'mock-echo' || id === 'mock-hears' || id === 'mock-reads-pdf' || id === 'mock-nocaps') {
        const lines = echoLines(body);
        streamContent(id, res, store, body, lines.map((l, i) => (i === lines.length - 1 ? l : `${l}\n`)), { finish: 'stop' });
        return true;
    }

    if (id === 'mock-md' || id === 'mock-xss') {
        const text = fixture(id === 'mock-md' ? 'stream.md' : 'xss-corpus.md', store, STANDIN_MD);
        streamContent(id, res, store, body, seededChunks(text, 1, 12, store.state.fixtureSeed || 12345), { finish: 'stop' });
        return true;
    }

    if (id.startsWith('mock-perf:')) {
        const name = id.slice('mock-perf:'.length);
        const text = fixture(path.join('perf', `${name}.md`), store, STANDIN_MD);
        const seed = store.state.fixtureSeed || 12345;
        if (name === 'reasoning-40k') {
            // The whole fixture as reasoning, then a short answer.
            const out = sse(res);
            const think = seededChunks(text, 3, 6, seed);
            const answer = ['Done. ', 'That is the answer.'];
            let i = 0;
            const next = () => {
                if (i < think.length) { out.send(chunk(id, { reasoning_content: think[i++] })); return true; }
                if (i < think.length + answer.length) { out.send(chunk(id, { content: answer[i - think.length] })); i++; return true; }
                return null;
            };
            pace(res, store, next, () => { out.send(usageChunk(id, answer.length, body)); out.done(); }, { perTick: 6 });
            return true;
        }
        streamContent(id, res, store, body, seededChunks(text, 3, 6, seed), { finish: 'stop', perTick: 6 });
        return true;
    }

    if (id === 'mock-think-tags') {
        // The tags are split across chunk boundaries on purpose (net/delta must hold back).
        streamContent(id, res, store, body, [
            '<th', 'ink>', 'weighing ', 'the ', 'options ', 'care', 'fully', '</thi', 'nk>',
            'Here ', 'is ', 'the ', 'answer: ', '**42**.',
        ], { finish: 'stop' });
        return true;
    }

    if (id === 'mock-midstream-error') {
        const out = sse(res);
        let i = 0;
        const next = () => { if (i >= 50) return null; out.send(chunk(id, { content: `tok${i++} ` })); return true; };
        pace(res, store, next, () => {
            out.send({ error: { message: 'upstream exploded', type: 'api_error', code: 500 } });
            out.end();   // no [DONE]: the stream just stops
        });
        return true;
    }

    if (id === 'mock-reset') {
        const out = sse(res);
        let i = 0;
        const next = () => { if (i >= 50) return null; out.send(chunk(id, { content: `tok${i++} ` })); return true; };
        pace(res, store, next, () => { try { if (res.socket) res.socket.destroy(); } catch { /* already gone */ } });
        return true;
    }

    if (id === 'mock-length') {
        streamContent(id, res, store, body, lengthChunks(body), { finish: 'length' });
        return true;
    }
    if (id === 'mock-restart-on-prefill') {
        streamContent(id, res, store, body, restartChunks(body), { finish: 'stop' });
        return true;
    }

    if (id === 'mock-slow') {
        // 3 s TTFT, then 20 tok/s for 60 s.
        const out = sse(res);
        let stop = () => {};
        const t = setTimeout(() => {
            let i = 0;
            stop = pace(res, store, () => {
                if (i >= 1200) return null;
                out.send(chunk(id, { content: `tok${i++} ` }));
                return true;
            }, () => { out.send(usageChunk(id, 1200, body)); out.done(); }, { tickMs: 50, perTick: 1 });
        }, 3000);
        res.on('close', () => { clearTimeout(t); stop(); });
        return true;
    }

    // ---- S0: the ask spine ------------------------------------------------------------
    if (id === 'mock-studio-json') {
        const json = studioJsonText(body);
        // The FENCE decision keys off response_format ALONE: with the param honoured the body IS
        // the instance; without it (drop_params, or prompt mode) prose plus a fenced block, which
        // is what the client's fence extractor exercises. Only the SHAPE comes from schemaOf(),
        // which now reads the prompt too (BD-11).
        const rf0 = body && body.response_format;
        const structured = !!(rf0 && rf0.type === 'json_schema' && (rf0.json_schema || {}).schema);
        const text = structured ? json : 'Here is the result.\n\n' + '```json\n' + json + '\n```\n';
        streamContent(id, res, store, body, jsonChunks(text), { finish: 'stop' });
        return true;
    }

    if (id === 'mock-json-empty') {
        // Empty content AND empty reasoning: the "never a silent empty result" path.
        const out = sse(res);
        const send = () => { out.send(usageChunk(id, 0, body)); out.done(); };
        const delay = Number(store.state.askDelayMs) || 0;
        if (!delay) send();
        else { const t = setTimeout(send, delay); res.on('close', () => clearTimeout(t)); }
        return true;
    }

    if (id === 'mock-json-reasoning-only') {
        // The JSON arrives only as reasoning_content; content stays empty (the F8 trap).
        const out = sse(res);
        const chunks = jsonChunks(studioJsonText(body));
        let i = 0;
        const next = () => {
            if (i >= chunks.length) return null;
            out.send(chunk(id, { reasoning_content: chunks[i++] }));
            return true;
        };
        pace(res, store, next, () => { out.send(usageChunk(id, 0, body)); out.done(); });
        return true;
    }

    if (id === 'mock-vision-echo') {
        const lines = visionEchoLines(body);
        streamContent(id, res, store, body, lines.map((l, i) => (i === lines.length - 1 ? l : `${l}\n`)), { finish: 'stop' });
        return true;
    }
    if (id === 'mock-vision-refuse') {
        // With an image it already refused above; without one it is an ordinary short stream.
        streamContent(id, res, store, body, ['no images ', 'in this request.'], { finish: 'stop' });
        return true;
    }

    if (id === 'mock-usage-none') {
        streamContent(id, res, store, body, Array.from({ length: 100 }, (_, i) => `tok${i} `), { finish: 'stop', usage: false });
        return true;
    }

    return false;
}

module.exports = {
    MODEL_IDS, STATIC_MODEL_IDS, PERF_NAMES, VISION_MODELS,
    modelList, modelGroupInfo, handleCompletion, instanceOf, schemaOf, schemaFromPrompt, studioJsonText,
    promptTokens, textOf, partsOf, echoLines, lengthChunks, restartChunks,
    seededChunks, mulberry32, CORS, headingLines, codeReply,
};
