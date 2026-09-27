// @ts-check
// Template — Ask a dataset (ecosystem plan v2 P4, the Agent box). DATA only. An Open data box (the festivals copy
// "Analyse a dataset" ships, so it opens with data) and your question, wired into an Agent allowed ONE host:
// data.gouv.fr's tabular API, which groups, counts, sums and filters the WHOLE file on data.gouv.fr's side. The
// agent computes with code and answers with every step under its answer. Up to 8 generations (one per step).

import { SNAPSHOT } from './analyse-a-dataset.mjs';

const TASK = 'Answer the question (inputs["the question"]) about the dataset (inputs["the dataset"]). Its columns carry '
  + 'the counts data.gouv.fr made over the WHOLE file (distinct values, empty ones, the most common values with their '
  + 'counts, min and max); its rows are only a sample. When the columns are not enough, data.gouv.fr’s tabular API '
  + 'answers over the whole file: https://tabular-api.data.gouv.fr/api/resources/<the dataset’s file.id>/data/ with '
  + '?<column>__groupby&<column>__count (or __sum, __avg) to group, ?<column>__exact=<value> to filter, and page_size=50 '
  + '(column names exactly as in the columns, URL-encoded: a space is %20, never an underscore — for example '
  + '?Discipline%20dominante__exact=Musique). Compute with code; answer in the language of the question, '
  + 'with the numbers your steps found, and say whether they cover the whole file or the sample.';

export default {
  id: 'ask-a-dataset',
  title: 'Ask a dataset',
  subtitle: 'Your question about a data.gouv.fr dataset, answered by an Agent that asks data.gouv.fr over the whole file and computes with code — every step shown.',
  needsFarm: 'one',
  generations: 8,
  doc: {
    lolgraph: 2,
    title: 'Ask a dataset',
    view: { x: 16, y: 8, zoom: 0.5 },
    parts: [
      { id: 'q_title', type: 'title', x: 40, y: 24, w: 820, h: 100, settings: { text: 'Ask a dataset', size: 'l' } },
      {
        id: 'q_how', type: 'sticky', x: 40, y: 140, w: 320, h: 560,
        settings: {
          colour: 'yellow',
          text: 'How it works\n\n1. Open data: paste the link of a dataset from www.data.gouv.fr and press ▶ on that box (a copy of the festivals list ships with the template).\n2. Your question: anything the data can answer — "which 5 regions have the most music festivals?"\n3. Press ▶ on the Agent. Step by step it reads what data.gouv.fr counted, asks data.gouv.fr’s tabular API to group, count or sum the WHOLE file (the only web host it may read), computes with code, then answers.\n\nUnder the answer, "How it got there" lists every step and what came back, so you can check each number. At most 8 steps, one generation each.',
        },
      },
      { id: 'q_data', type: 'opendata', x: 400, y: 140, w: 340, h: 180, settings: { link: 'https://www.data.gouv.fr/datasets/liste-des-festivals-en-france', rows: 200 }, value: { kind: 'json', data: SNAPSHOT } },
      { id: 'q_question', type: 'note', x: 400, y: 360, w: 340, h: 170, settings: { text: 'Which 5 regions have the most music festivals, and how many each?', locked: false } },
      { id: 'q_agent', type: 'agent', x: 800, y: 140, w: 340, h: 460, settings: { task: TASK, hosts: 'tabular-api.data.gouv.fr', maxSteps: 8, model: '' } },
      { id: 'q_view', type: 'preview', x: 1200, y: 140, w: 600, h: 520, settings: { mode: 'markdown' } },
    ],
    wires: [
      { from: 'q_data', to: 'q_agent', port: 'in', label: 'the dataset' },
      { from: 'q_question', to: 'q_agent', port: 'in', label: 'the question' },
      { from: 'q_agent', to: 'q_view', port: 'content' },
    ],
  },
};
