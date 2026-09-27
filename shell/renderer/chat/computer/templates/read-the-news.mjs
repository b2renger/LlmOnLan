// @ts-check
// Template — Read the news (docs/ECOSYSTEM_PLAN.md v2, P1a: the owner's first goal). DATA only.
//
// A website → a model writes Laya's question → Laya labels every story → the model gives a second
// opinion on the ones Laya was unsure of → the code counts → the model chooses the chart → the code
// draws it. The division of labour IS the lesson (plan §3.6): no model ever writes a number. Models
// write QUESTIONS and WORDS (Laya's question from the reader's topics, labels, how to chart); every
// count and every bar is computed by the two Code boxes, folded behind a line of plain words
// (owner, 2026-09-27: "the code boxes are too intimidating — the website and the keywords in separate
// boxes, into a model that writes the Laya prompt, then Laya").
//
// The Fetch box ships with a copy of the Hacker News front page (taken 2026-09-27), so the
// template runs offline and on the mock farm; a run refreshes it from the web when there is one.
// With no Laya on the farm, Classify passes every story on as unsure and the model labels them all —
// the template runs either way.
//
// 3 generations: Laya's question, the second opinion, the chart. Classify is not a generation (one
// forward pass per story on the farm's CPU).

const SNAPSHOT = {
 "hits": [
  {
   "objectID": "49863864",
   "title": "Unsealed Briefs in Authors’ Case v. Microsoft/OpenAI",
   "url": "https://authorsguild.org/news/ag-v-openai-top-execs-knew-mass-book-piracy-was-illegal/",
   "author": "papergirl",
   "points": 535,
   "num_comments": 470,
   "created_at": "2026-09-27T06:19:33Z"
  },
  {
   "objectID": "49842764",
   "title": "PipePipe: NewPipe hard fork implementing SponsorBlock",
   "url": "https://github.com/InfinityLoop1308/PipePipe",
   "author": "Qision",
   "points": 464,
   "num_comments": 249,
   "created_at": "2026-09-25T10:55:40Z"
  },
  {
   "objectID": "49844657",
   "title": "Does Georgism work? Five years later",
   "url": "https://www.astralcodexten.com/p/does-georgism-work-five-years-later",
   "author": "silveraxe93",
   "points": 454,
   "num_comments": 347,
   "created_at": "2026-09-25T13:48:38Z"
  },
  {
   "objectID": "49854693",
   "title": "Fifteen years later, the Apple Cards origin story",
   "url": "https://lexontech.org/fifteen-years-later-the-apple-cards-origin-story",
   "author": "ksec",
   "points": 419,
   "num_comments": 110,
   "created_at": "2026-09-26T09:13:41Z"
  },
  {
   "objectID": "49844663",
   "title": "ASML says it sold 'absolutely nothing' in Europe in 2026",
   "url": "https://www.tomshardware.com/tech-industry/semiconductors/asml-says-its-sells-absolutely-nothing-in-europe-calls-on-eu-to-help-create-demand",
   "author": "MC995",
   "points": 364,
   "num_comments": 779,
   "created_at": "2026-09-25T13:49:06Z"
  },
  {
   "objectID": "49858513",
   "title": "Show HN: Reladraw – A diagram language where you decide where to place things",
   "url": "https://github.com/reladraw/reladraw",
   "author": "jpwalsh234",
   "points": 359,
   "num_comments": 95,
   "created_at": "2026-09-26T17:10:40Z"
  },
  {
   "objectID": "49856988",
   "title": "Go Concurrency Distilled",
   "url": "https://antonz.org/go-concurrency-distilled/",
   "author": "chmaynard",
   "points": 308,
   "num_comments": 134,
   "created_at": "2026-09-26T14:34:49Z"
  },
  {
   "objectID": "49859112",
   "title": "DeepSeek Elastic Compute (DSec)",
   "url": "https://arxiv.org/abs/2609.22978",
   "author": "shenli3514",
   "points": 299,
   "num_comments": 94,
   "created_at": "2026-09-26T18:22:41Z"
  },
  {
   "objectID": "49836579",
   "title": "How I changed teaching after AI managed to do all my homework assignments",
   "url": "https://thelastsoftwareengineer.substack.com/p/how-i-changed-teaching-after-ai-managed",
   "author": "azhenley",
   "points": 263,
   "num_comments": 248,
   "created_at": "2026-09-24T20:51:50Z"
  },
  {
   "objectID": "49854219",
   "title": "Flip Fluid on Flip Dots",
   "url": "https://mitxela.com/projects/flipflip",
   "author": "blutack",
   "points": 256,
   "num_comments": 16,
   "created_at": "2026-09-26T07:50:24Z"
  },
  {
   "objectID": "49832768",
   "title": "A searchable library of forgotten public-domain film clips from 1915 onward",
   "url": "https://www.movingimagearchive.com/",
   "author": "momentmaker",
   "points": 196,
   "num_comments": 26,
   "created_at": "2026-09-24T16:11:42Z"
  },
  {
   "objectID": "49867038",
   "title": "10 Tells of a Slop UI",
   "url": "https://hereticpleb.vercel.app/blog/10-tells-of-slop",
   "author": "theanonymousone",
   "points": 144,
   "num_comments": 109,
   "created_at": "2026-09-27T14:41:26Z"
  },
  {
   "objectID": "49853137",
   "title": "An agent used DNS to reach an external chatbot",
   "url": "https://alignment.openai.com/misalignment-reports/an-agent-used-dns-to-reach-an-external-chatbot/",
   "author": "apsec112",
   "points": 138,
   "num_comments": 141,
   "created_at": "2026-09-26T04:14:11Z"
  },
  {
   "objectID": "49867067",
   "title": "\"They had no concept of a duty of care to their users.\"",
   "url": "https://unsung.aresluna.org/they-had-no-concept-of-a-duty-of-care-to-their-users/",
   "author": "jandeboevrie",
   "points": 118,
   "num_comments": 77,
   "created_at": "2026-09-27T14:45:07Z"
  },
  {
   "objectID": "49839438",
   "title": "Biology might not be quantum, but its math is quantumlike",
   "url": "https://www.quantamagazine.org/biology-might-not-be-quantum-but-its-math-is-quantumlike-20260923/",
   "author": "pseudolus",
   "points": 104,
   "num_comments": 41,
   "created_at": "2026-09-25T02:11:07Z"
  },
  {
   "objectID": "49852905",
   "title": "Promising discoveries about the potential for life on one of Saturn’s icy moons",
   "url": "https://www.fu-berlin.de/en/presse/informationen/fup/2026/fup_26_116-enceladus-cassini-mikroben-science-postberg/index.html",
   "author": "geox",
   "points": 87,
   "num_comments": 49,
   "created_at": "2026-09-26T03:23:31Z"
  },
  {
   "objectID": "49865343",
   "title": "\"As a Language Model\": Chat Template Switches LLM Self-Referential Voice",
   "url": "https://arxiv.org/abs/2609.25021",
   "author": "yu3zhou4",
   "points": 82,
   "num_comments": 88,
   "created_at": "2026-09-27T10:26:25Z"
  },
  {
   "objectID": "49863600",
   "title": "The internet discovers TLA+. Now what?",
   "url": "https://reasonable.io/blog/tla-tutorial/",
   "author": "matt_d",
   "points": 78,
   "num_comments": 39,
   "created_at": "2026-09-27T05:26:15Z"
  },
  {
   "objectID": "49849723",
   "title": "Finally, A True Blue Rose Exists",
   "url": "https://www.sciencenews.org/article/true-blue-rose-pigment-copigment",
   "author": "bookofjoe",
   "points": 62,
   "num_comments": 25,
   "created_at": "2026-09-25T20:44:38Z"
  },
  {
   "objectID": "49850991",
   "title": "Exploding variance of means of exponentials: least-squares to the rescue",
   "url": "https://francisbach.com/spectral_log_density_estimation/",
   "author": "matt_d",
   "points": 55,
   "num_comments": 0,
   "created_at": "2026-09-25T22:48:52Z"
  },
  {
   "objectID": "49866951",
   "title": "In an $80 Motel Room, a Discovery to Shed Light on the Origins of Life",
   "url": "https://www.nytimes.com/2026/09/26/science/motel-science-discovery.html",
   "author": "danso",
   "points": 48,
   "num_comments": 18,
   "created_at": "2026-09-27T14:30:55Z"
  },
  {
   "objectID": "49866515",
   "title": "Replacing the old battery on rechargeable bike lights",
   "url": "https://jvns.ca/blog/2026/09/27/replacing-the-old-battery-on-rechargeable-bike-lights/",
   "author": "surprisetalk",
   "points": 48,
   "num_comments": 15,
   "created_at": "2026-09-27T13:30:11Z"
  },
  {
   "objectID": "49856885",
   "title": "Fakecloud: Local AWS cloud emulator for integration tests",
   "url": "https://fakecloud.dev/",
   "author": "theanonymousone",
   "points": 39,
   "num_comments": 15,
   "created_at": "2026-09-26T14:25:16Z"
  },
  {
   "objectID": "49864743",
   "title": "Rusty thoughts on \"Parse, don't validate\"",
   "url": "https://eli.thegreenplace.net/2026/rusty-thoughts-on-parse-dont-validate/",
   "author": "ingve",
   "points": 34,
   "num_comments": 11,
   "created_at": "2026-09-27T08:59:59Z"
  },
  {
   "objectID": "49824144",
   "title": "Show HN: A CC0 museum of retro 3D tricks you can paste into a page",
   "url": "https://3d-retro.com/",
   "author": "SouthWestAtlas",
   "points": 23,
   "num_comments": 4,
   "created_at": "2026-09-23T23:33:39Z"
  },
  {
   "objectID": "49849409",
   "title": "Writing Efficient C++ Code",
   "url": "https://asawicki.info/articles/writing_efficient_cpp_code.php",
   "author": "ibobev",
   "points": 21,
   "num_comments": 3,
   "created_at": "2026-09-25T20:20:27Z"
  },
  {
   "objectID": "49866534",
   "title": "Ten Lines of Code That Changed My World",
   "url": "https://pixelambacht.nl/2026/ten-lines-of-code/",
   "author": "dimonomid",
   "points": 15,
   "num_comments": 2,
   "created_at": "2026-09-27T13:33:03Z"
  },
  {
   "objectID": "49858285",
   "title": "Font where each token is equal-width",
   "url": "https://twitter.com/amplifiedamp/status/2103535129503383700",
   "author": "ampdot",
   "points": 11,
   "num_comments": 3,
   "created_at": "2026-09-26T16:49:22Z"
  },
  {
   "objectID": "49867486",
   "title": "The Normalization of Inexplicable Failures",
   "url": "https://www.ihatethefuture.com/2026/09/the-normalization-of-inexplicable.html",
   "author": "pxx",
   "points": 10,
   "num_comments": 1,
   "created_at": "2026-09-27T15:26:40Z"
  },
  {
   "objectID": "49867553",
   "title": "postmarketOS Rebrand: Nura",
   "url": "https://nura.eco/blog/2026/09/27/nura-rename/",
   "author": "HotGarbage",
   "points": 8,
   "num_comments": 0,
   "created_at": "2026-09-27T15:31:15Z"
  }
 ],
 "nbHits": 30,
 "_snapshot": "Hacker News front page via hn.algolia.com, taken 2026-09-27 (the offline copy this template ships with)"
};

const COUNT = `// Every number in the chart is counted HERE, from the website's data. Laya and the model only chose
// labels: Laya's when it was sure, the model's for the rest.
// Another website has another shape: wire "＋ → Think → Write code" into this box's code port and say
// in words what to count.
const page = inputs.in.find((v) => v && Array.isArray(v.hits)) || { hits: [] };
const laya = inputs.in.find((v) => v && Array.isArray(v.labels) && 'by' in v) || { labels: [] };
const model = inputs.in.find((v) => v && Array.isArray(v.labels) && !('by' in v)) || { labels: [] };
const catText = inputs.in.find((v) => typeof v === 'string') || '';
const cats = catText.split(/[\\n,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
if (!cats.includes('other')) cats.push('other');
// Story n is the website's n-th story: the same order Classify numbered them in.
const stories = page.hits.map((h, i) => ({
  id: i + 1,
  title: String(h.title || ''),
  points: Number(h.points) || 0,
  comments: Number(h.num_comments) || 0,
}));
const fromLaya = new Map(laya.labels.filter((l) => l.sure).map((l) => [Number(l.id), l]));
const fromModel = new Map(model.labels.map((l) => [Number(l.id), l]));
const rows = new Map(cats.map((c) => [c, { topic: c, stories: 0, points: 0, comments: 0 }]));
const unsure = [];
const by = { laya: 0, model: 0 };
for (const s of stories) {
  const l = fromLaya.get(s.id);
  const m = fromModel.get(s.id);
  let topic = l ? String(l.label || '').toLowerCase() : m ? String(m.topic || '').trim().toLowerCase() : '';
  if (l) by.laya += 1; else if (m) by.model += 1;
  if (!rows.has(topic)) {
    unsure.push({ id: s.id, title: s.title, why: topic ? 'not one of your topics: ' + topic : 'no label' });
    topic = 'other';
  } else if (!l && m && m.sure === false) {
    unsure.push({ id: s.id, title: s.title, why: 'neither Laya nor the model was sure (' + topic + ')' });
  }
  const r = rows.get(topic);
  r.stories += 1; r.points += s.points; r.comments += s.comments;
}
return {
  source: 'Hacker News front page',
  total: stories.length,
  labelledBy: by,
  byTopic: [...rows.values()].filter((r) => r.stories > 0),
  unsure,
};`;

const DRAW = `// Draws the chart from the COUNTS. The model's spec only picks the measure, the order,
// one topic to highlight, and the words. Every bar and every number comes from the data.
const counts = inputs.in.find((v) => v && Array.isArray(v.byTopic)) || { byTopic: [], unsure: [], total: 0 };
const spec = inputs.in.find((v) => v && typeof v.measure === 'string') || {};
const measure = ['stories', 'points', 'comments'].includes(spec.measure) ? spec.measure : 'stories';
const rows = counts.byTopic.slice();
if (spec.sort === 'alphabetical') rows.sort((a, b) => a.topic.localeCompare(b.topic));
else if (spec.sort === 'smallest first') rows.sort((a, b) => a[measure] - b[measure]);
else rows.sort((a, b) => b[measure] - a[measure]);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// The model's WORDS never carry a number onto the chart (a miscount would sit under "counts by the
// code"): any digit it writes becomes an ellipsis. The numbers on this chart are the bars' own.
const words = (s) => String(s || '').replace(/[0-9][0-9.,%]*/g, '…');
const wrap = (text, n) => {
  const out = []; let line = '';
  for (const w of String(text).split(/\\s+/)) {
    if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
};
const W = 760, left = 170, barW = 440, rowH = 30, top = 104;
const max = Math.max(1, ...rows.map((r) => r[measure]));
const hi = String(spec.highlight || '').trim().toLowerCase();
const insight = wrap(words(spec.insight), 92).slice(0, 3);
const unsure = (counts.unsure || []).slice(0, 6);
let y = top;
const bars = rows.map((r) => {
  const w = Math.round((r[measure] / max) * barW);
  const fill = r.topic === hi ? '#f59e0b' : '#71717a';
  const g = '<text x="' + (left - 12) + '" y="' + (y + 19) + '" text-anchor="end" font-size="14" fill="#18181b">' + esc(r.topic) + '</text>'
    + '<rect x="' + left + '" y="' + (y + 5) + '" width="' + w + '" height="20" rx="4" fill="' + fill + '"/>'
    + '<text x="' + (left + w + 8) + '" y="' + (y + 20) + '" font-size="13" fill="#52525b">' + r[measure] + '</text>';
  y += rowH;
  return g;
}).join('');
y += 20;
const text = (x, size, fill, s, weight) => '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '"'
  + (weight ? ' font-weight="' + weight + '"' : '') + '>' + esc(s) + '</text>';
let tail = '';
for (const line of insight) { y += 18; tail += text(24, 14, '#18181b', line); }
if (unsure.length) {
  y += 26; tail += text(24, 13, '#b45309', 'Check these (' + (counts.unsure || []).length + '):', 600);
  for (const u of unsure) { y += 16; tail += text(36, 12, '#52525b', '#' + u.id + ' ' + u.title.slice(0, 80) + ' — ' + words(u.why)); }
}
const lb = counts.labelledBy || {};
y += 28; tail += text(24, 11, '#a1a1aa', (counts.source || 'Source') + ' · ' + counts.total + ' stories · labels: ' + (lb.laya || 0) + ' by Laya, ' + (lb.model || 0) + ' by the model · counts by the code');
const H = y + 16;
return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Inter, system-ui, sans-serif">'
  + '<rect width="' + W + '" height="' + H + '" fill="#fafafa"/>'
  + '<text x="24" y="40" font-size="22" font-weight="700" fill="#18181b">' + esc(words(spec.title) || 'What the front page talks about') + '</text>'
  + '<text x="24" y="66" font-size="14" fill="#52525b">' + esc(words(spec.subtitle) || ('By ' + measure)) + '</text>'
  + '<text x="24" y="90" font-size="12" fill="#a1a1aa">' + esc(measure) + ' per topic</text>'
  + bars + tail + '</svg>';`;

/** The same answer shape as the "Write a Laya question" preset (graph/parts/creative.mjs
 * LAYA_QUESTION_SCHEMA, byte for byte — a unit test holds them together), so the box is titled as one. */
const LAYA_QUESTION_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
  },
  required: ['question', 'options'],
}, null, 2);

export default {
  id: 'read-the-news',
  title: 'Read the news',
  subtitle: 'A website and your topics: a model writes Laya’s question, Laya labels every story, code counts, and the chart answers your question — no code to write.',
  needsFarm: 'one',
  generations: 3,
  doc: {
    lolgraph: 2,
    title: 'Read the news',
    view: { x: 16, y: 8, zoom: 0.45 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 820, h: 100, settings: { text: 'Read the news', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 130, w: 1500, h: 80, settings: { text: 'Change the topics or the question, press Run: a model writes Laya’s question, Laya labels every story, the model checks the unsure ones and chooses the chart; the code counts and draws.', size: 's' } },
      {
        id: 'n_how', type: 'sticky', x: 40, y: 240, w: 320, h: 600,
        settings: {
          colour: 'yellow',
          text: 'How it works\n\n1. Website: Fetch reads the Hacker News front page (a copy ships with the template, so it also works offline).\n2. Write a Laya question: a model reads the website and your topics, and writes the ONE question Laya asks about every story. Your topics are its answers, exactly as you wrote them.\n3. Laya (Classify), the farm’s fast decision model, answers it for each story, with a confidence.\n4. Second opinion: the model looks again at the stories Laya was not sure of.\n5. Count (code, folded): every number is counted from the data — never by a model.\n6. Choose the chart: the model reads your question and the counts, and picks the measure, the order, a highlight and the words.\n7. Draw (code, folded) draws it.\n\nAnother website? Its data has another shape: add ＋ Think → Write code, say what to count, and wire it into Count’s code port.',
        },
      },
      { id: 'n_src', type: 'fetch', x: 400, y: 240, w: 340, h: 130, settings: { url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30&attributesToRetrieve=title,url,points,num_comments' }, value: { kind: 'json', data: SNAPSHOT } },
      { id: 'n_cats', type: 'note', x: 400, y: 400, w: 340, h: 200, settings: { text: 'ai\nsoftware\nhardware\nscience\nbusiness\npolitics\nculture\nother', locked: false } },
      { id: 'n_q', type: 'note', x: 400, y: 630, w: 340, h: 170, settings: { text: 'Which topics get the most attention on the front page today? Is AI dominating the conversation?', locked: false } },
      {
        id: 'n_write', type: 'ask', x: 800, y: 240, w: 340, h: 300,
        settings: {
          instruction: 'Look at the website and the topics. Write the question Laya will answer for every story on the website, one story at a time. Laya reads only a story’s title, so the question must be answerable from a title alone, in under 15 words. The options are the topics, written exactly as given in lowercase, plus other if it is missing.',
          shape: 'json',
          schema: LAYA_QUESTION_SCHEMA,
        },
      },
      {
        id: 'n_laya', type: 'classify', x: 800, y: 580, w: 340, h: 230,
        settings: { question: 'What is this story mainly about?', options: '', threshold: 0.6 },
      },
      {
        id: 'n_label', type: 'ask', x: 1200, y: 240, w: 340, h: 300,
        settings: {
          instruction: 'Laya’s answers list under check the stories Laya was not sure of, with their text. For each of those stories, pick exactly ONE of the topics — written exactly as given, or other when nothing fits — and say whether you are sure. Do not change, count or rank anything.',
          shape: 'json',
          schema: JSON.stringify({
            type: 'object',
            properties: {
              labels: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'integer' }, topic: { type: 'string' }, sure: { type: 'boolean' } },
                  required: ['id', 'topic', 'sure'],
                },
              },
            },
            required: ['labels'],
          }, null, 2),
        },
      },
      {
        id: 'n_count', type: 'code', x: 1200, y: 580, w: 340, h: 120,
        settings: { code: COUNT, about: 'Counts the stories, points and comments per topic — from the data, never from a model.', folded: true },
      },
      {
        id: 'n_spec', type: 'ask', x: 1600, y: 240, w: 340, h: 330,
        settings: {
          instruction: 'Read your question and the counts, then choose how to chart them so the chart answers your question. Pick the measure (stories, points or comments), the sort order, one topic to highlight (or none), a short title, a subtitle, and an insight: one or two sentences that answer your question in words. Never write a number anywhere — the chart draws the numbers itself.',
          shape: 'json',
          schema: JSON.stringify({
            type: 'object',
            properties: {
              title: { type: 'string' },
              subtitle: { type: 'string' },
              measure: { type: 'string', enum: ['stories', 'points', 'comments'] },
              sort: { type: 'string', enum: ['largest first', 'smallest first', 'alphabetical'] },
              highlight: { type: 'string' },
              insight: { type: 'string' },
            },
            required: ['title', 'subtitle', 'measure', 'sort', 'highlight', 'insight'],
          }, null, 2),
        },
      },
      {
        id: 'n_draw', type: 'code', x: 1600, y: 610, w: 340, h: 120,
        settings: { code: DRAW, about: 'Draws the bar chart from the counts, the way the model chose.', folded: true },
      },
      { id: 'n_view', type: 'preview', x: 1200, y: 780, w: 740, h: 440, settings: { mode: 'svg' } },
    ],
    wires: [
      { from: 'n_src', to: 'n_write', port: 'in', label: 'website' },
      { from: 'n_cats', to: 'n_write', port: 'in', label: 'topics' },
      { from: 'n_src', to: 'n_laya', port: 'items' },
      { from: 'n_write', to: 'n_laya', port: 'question' },
      { from: 'n_cats', to: 'n_laya', port: 'options' },
      { from: 'n_laya', to: 'n_label', port: 'in', label: 'answers' },
      { from: 'n_cats', to: 'n_label', port: 'in', label: 'topics' },
      { from: 'n_src', to: 'n_count', port: 'in' },
      { from: 'n_laya', to: 'n_count', port: 'in' },
      { from: 'n_label', to: 'n_count', port: 'in' },
      { from: 'n_cats', to: 'n_count', port: 'in' },
      { from: 'n_count', to: 'n_spec', port: 'in', label: 'counts' },
      { from: 'n_q', to: 'n_spec', port: 'in', label: 'your question' },
      { from: 'n_count', to: 'n_draw', port: 'in' },
      { from: 'n_spec', to: 'n_draw', port: 'in' },
      { from: 'n_draw', to: 'n_view', port: 'content' },
    ],
  },
};
