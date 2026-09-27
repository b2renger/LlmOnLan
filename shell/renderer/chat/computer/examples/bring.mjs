// @ts-check
// Box examples — the "Bring in" group (computer/examples/index.mjs says how an example becomes a graph).

const view = { mode: 'markdown' };

export const BRING = [
  {
    key: 'note',
    title: 'Text',
    what: 'Holds words you type — a question, a list, a paragraph — and hands them on. An arrow coming in fills it with what arrived; lock it and your own words stay.',
    inputs: [['in (optional)', 'text, JSON or a list: shown in the box and handed on']],
    output: 'Text: exactly what the box shows.',
    howto: [
      'Name the arrow out of it (click the arrow, type topic). In an Instruction with "Fill in {names} with their values" ticked, {topic} is replaced by the text.',
      'Several lines → Split (lines): the next box runs once per line.',
      'Lock it when a run must not replace what you typed.',
    ],
    parts: [
      { id: 'e_text', type: 'note', x: 0, y: 0, w: 320, h: 200, settings: { text: '# A shopping list\n- apples\n- bread\n- a lot of tea', locked: false } },
      { id: 'e_view', type: 'preview', x: 380, y: 0, w: 340, h: 300, settings: view },
    ],
    wires: [{ from: 'e_text', to: 'e_view', port: 'content' }],
  },
  {
    key: 'image',
    title: 'Image',
    needsFarm: 'one, for the Instruction that looks at the picture (a model that can see, like gemma4).',
    what: 'Holds a picture you drop, paste or choose. Wired into an Instruction, the picture goes with the request, so a model that can see describes, reads or judges it.',
    inputs: [['file (optional)', 'a picture from another box: it is passed on']],
    output: 'A picture (downscaled on the way in).',
    howto: [
      'Drop a picture on the box, or paste one onto the canvas: it becomes an Image box.',
      'Wire it into an Instruction: "What is in this picture?"',
      'The picture leaves this computer only inside that Instruction\'s request to the farm.',
    ],
    parts: [
      { id: 'e_img', type: 'image', x: 0, y: 0, w: 320, h: 260, settings: {} },
      { id: 'e_ask', type: 'ask', x: 380, y: 0, w: 340, h: 300, settings: { instruction: 'Describe the picture in three short sentences: what it shows, where, and the mood.' } },
    ],
    wires: [{ from: 'e_img', to: 'e_ask', port: 'in' }],
  },
  {
    key: 'document',
    title: 'Document (PDF)',
    needsFarm: 'one with document OCR (on by default), to read the PDF; and a model for the Instruction.',
    what: 'Holds a PDF. On a run, its bytes go to the farm\'s OCR for the TEXT only, and the text flows on. Nothing is sent when you drop it.',
    inputs: [],
    output: 'Text (markdown) of the document; a long one is cut, and the text says where.',
    howto: [
      'Drop a PDF on the box.',
      'Wire it into an Instruction: "Summarise the document in five bullet points."',
      'The text is kept with the file, so the same PDF is read only once.',
    ],
    parts: [
      { id: 'e_doc', type: 'document', x: 0, y: 0, w: 320, h: 220, settings: {} },
      { id: 'e_ask', type: 'ask', x: 380, y: 0, w: 340, h: 300, settings: { instruction: 'Summarise the document in five bullet points.' } },
    ],
    wires: [{ from: 'e_doc', to: 'e_ask', port: 'in', label: 'document' }],
  },
  {
    key: 'audio',
    title: 'Sound',
    needsFarm: 'one with speech to text, for Listen (the farm\'s operator turns it on); and a model for the Instruction.',
    what: 'Holds a recording and plays it. With Listen on, a run sends it to the farm\'s speech to text and the WORDS flow on; with Listen off, only its name and length do.',
    inputs: [],
    output: 'Text: what was said (Listen on), or the file\'s name and length.',
    howto: [
      'Drop a WAV, MP3, M4A or OGG on the box; ▶ Play to hear it.',
      'Turn on Listen, then wire it into an Instruction: "Answer the question asked in the recording."',
      'A graph someone hands you always opens with Listen off: only you decide that a recording leaves.',
    ],
    parts: [
      { id: 'e_snd', type: 'audio', x: 0, y: 0, w: 320, h: 220, settings: {} },
      { id: 'e_ask', type: 'ask', x: 380, y: 0, w: 340, h: 300, settings: { instruction: 'Answer the question asked in the recording, in two sentences.' } },
    ],
    wires: [{ from: 'e_snd', to: 'e_ask', port: 'in', label: 'recording' }],
  },
  {
    key: 'file',
    title: 'File',
    what: 'Writes what arrives to a file in this graph\'s own project folder, e.g. out/list.md. A second run overwrites it. Nothing leaves this computer.',
    inputs: [['in', 'text, JSON, a list or a picture: the file\'s content (a file arriving is written as its path)']],
    output: 'A file (its path in the project).',
    howto: [
      'Type the path: out/notes.md for text, out/picture.png for a picture.',
      'The folder is <your data folder>/LOL Studio Projects/<this graph\'s name and a short code>, made at the first write.',
      'End a graph with it to keep the result outside the Computer.',
    ],
    parts: [
      { id: 'e_text', type: 'note', x: 0, y: 0, w: 320, h: 200, settings: { text: '# Shopping\n- apples\n- bread', locked: false } },
      { id: 'e_file', type: 'file', x: 380, y: 0, w: 320, h: 160, settings: { path: 'out/shopping.md' } },
    ],
    wires: [{ from: 'e_text', to: 'e_file', port: 'in' }],
  },
  {
    key: 'fetch',
    title: 'Fetch',
    what: 'Reads ONE web address you type (http or https) and hands on what came back: JSON as data, anything else as text. It keeps its last copy, so the graph still runs offline.',
    inputs: [],
    output: 'JSON (an API) or text (a page, a CSV), at most 1 MB.',
    howto: [
      'Paste the address of open data: a JSON API works best.',
      'Wire it into a Code box to pick what you need (inputs.in[0] is the data), or into Classify to label every item.',
      'Never this computer, a link-local address or the farm\'s own ports: the box says why.',
    ],
    parts: [
      {
        id: 'e_src', type: 'fetch', x: 0, y: 0, w: 340, h: 130,
        settings: { url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=5&attributesToRetrieve=title,points' },
        value: { kind: 'json', data: { hits: [{ title: 'A story from the front page', points: 120 }, { title: 'Another one', points: 42 }] } },
      },
      {
        id: 'e_code', type: 'code', x: 400, y: 0, w: 340, h: 220,
        settings: {
          code: 'const page = inputs.in[0] || {};\nreturn (page.hits || []).map((h) => "- " + h.title + " (" + h.points + " points)").join("\\n");',
          about: 'Lists each story with its points.', folded: false,
        },
      },
      { id: 'e_view', type: 'preview', x: 400, y: 280, w: 340, h: 260, settings: view },
    ],
    wires: [{ from: 'e_src', to: 'e_code', port: 'in' }, { from: 'e_code', to: 'e_view', port: 'content' }],
  },
  {
    key: 'opendata',
    title: 'Open data',
    what: 'Reads a dataset of data.gouv.fr, the French government\'s open data, from a link you paste: its description, the counts data.gouv.fr made over the WHOLE file (for every column: how many values, the most common ones, the smallest and largest), and a sample of its rows. It keeps its last copy, so the graph still runs offline.',
    inputs: [],
    output: 'JSON: { dataset: {title, organization, licence, page…}, total, columns: [{name, distinct, missing, tops: [{value, count}]…}], rows: [{column: value…}] }.',
    howto: [
      'On www.data.gouv.fr, open a dataset (or one of its files) and copy the address from the browser. The box reads CSV and Excel files that data.gouv.fr turned into tables.',
      'For whole-file numbers use columns (data.gouv.fr counted them); rows is only a sample — "Rows to read", up to 1000.',
      'The "Analyse a dataset" template on the Learn shelf turns it into a report, a chart and answers to your own question.',
    ],
    parts: [
      {
        id: 'e_src', type: 'opendata', x: 0, y: 0, w: 340, h: 180,
        settings: { link: 'https://www.data.gouv.fr/datasets/liste-des-festivals-en-france', rows: 200 },
        value: {
          kind: 'json',
          data: {
            source: 'data.gouv.fr',
            dataset: { title: 'Liste des festivals en France', organization: 'Ministère de la Culture', licence: 'lov2', updated: '2026-09-17', page: 'https://www.data.gouv.fr/datasets/liste-des-festivals-en-france', description: '' },
            file: { id: '47ac11c2-8a00-46a7-9fa8-9b802643f975', title: 'festivals-global-festivals', format: 'csv' },
            total: 7283,
            read: 2,
            columns: [
              { name: 'Nom du festival', format: 'string', distinct: 7171, missing: 0 },
              { name: 'Discipline dominante', format: 'string', distinct: 6, missing: 0, tops: [{ value: 'Musique', count: 3229 }, { value: 'Spectacle vivant', count: 1634 }, { value: 'Livre, littérature', count: 892 }, { value: 'Cinéma, audiovisuel', count: 684 }, { value: 'Pluridisciplinaire', count: 462 }, { value: 'Arts visuels, arts numériques', count: 382 }] },
            ],
            rows: [
              { 'Nom du festival': 'Des Planches et des Vaches', 'Discipline dominante': 'Livre, littérature' },
              { 'Nom du festival': 'Festival celte en Gevaudan', 'Discipline dominante': 'Musique' },
            ],
          },
        },
      },
      {
        id: 'e_code', type: 'code', x: 400, y: 0, w: 340, h: 220,
        settings: {
          code: 'const d = inputs.in[0] || { columns: [] };\nconst col = d.columns.find((c) => c.tops) || { tops: [] };\nreturn "## " + col.name + " (all " + d.total + " rows)\\n" + col.tops.map((t) => "- " + t.value + ": " + t.count).join("\\n");',
          about: 'Lists the most common values of the first column that has them, counted over the whole file.', folded: false,
        },
      },
      { id: 'e_view', type: 'preview', x: 400, y: 280, w: 340, h: 260, settings: view },
    ],
    wires: [{ from: 'e_src', to: 'e_code', port: 'in' }, { from: 'e_code', to: 'e_view', port: 'content' }],
  },
  {
    key: 'receive',
    title: 'Receive',
    what: 'Hands on what a board (an Arduino, an ESP32) says over the USB cable: one line per message. A line that is JSON, like {"light": 512}, flows on as data. Nothing leaves this computer.',
    inputs: [],
    output: 'The latest line (text, or data when it is JSON), or a list of every new line since the last run.',
    howto: [
      'Put docs/examples/arduino/lol_serial on the board (it sends {"light": …} every half second), plug it in, press "Choose the board…" and pick it.',
      'Wire it into a Code box: inputs.in[0].light is the reading. The box shows the last line live.',
      'Close the Arduino Serial Monitor first: only one program can hold the board. The Send box talks back to it ("Send by: USB serial").',
    ],
    parts: [
      { id: 'e_recv', type: 'receive', x: 0, y: 0, w: 320, h: 200, settings: { transport: 'serial', take: 'latest' } },
      {
        id: 'e_code', type: 'code', x: 380, y: 0, w: 340, h: 200,
        settings: { code: 'const r = inputs.in[0] || {};\nreturn "Light: " + (r.light ?? "?");', about: 'Reads the light level from the board\'s line.', folded: false },
      },
      { id: 'e_view', type: 'preview', x: 380, y: 260, w: 340, h: 200, settings: view },
    ],
    wires: [{ from: 'e_recv', to: 'e_code', port: 'in' }, { from: 'e_code', to: 'e_view', port: 'content' }],
  },
];
