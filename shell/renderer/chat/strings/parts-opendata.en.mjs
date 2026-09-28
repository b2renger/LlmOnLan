// @ts-check
// The Open data box (data.gouv.fr). One file per unit, same namespace: see strings/parts-text.en.mjs for why.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  openDataLabel: 'Open data',
  openDataLink: 'Dataset link',
  openDataPlaceholder: 'https://www.data.gouv.fr/datasets/…',
  openDataHint: 'Paste the link of a data.gouv.fr dataset (or of one of its files), copied from the browser. Each run reads its description, what data.gouv.fr counted in each column of the whole file (missing values, lowest, highest, average, most common values), and a sample of its rows; offline, the box keeps the last copy it read.',
  openDataRows: 'Rows to read',
  openDataRowsHint: 'How many rows to hand on as a sample (1 to {max}). The column counts cover the whole file whatever this says.',
  openDataStatus: '{title} · {total} rows · {columns} columns · {read} read as a sample',
  openDataNoLink: 'Paste the link of a data.gouv.fr dataset first.',
  openDataNotALink: 'That is not a data.gouv.fr link. Open the dataset on www.data.gouv.fr and copy the address from the browser.',
  openDataNoDataset: 'data.gouv.fr has no dataset at that link (deleted, private, or a typo).',
  openDataNoFile: 'data.gouv.fr has no file at that link (deleted, or a typo).',
  openDataNoTable: 'None of this dataset’s files is a table data.gouv.fr can read (its files: {formats}). The box reads CSV and Excel files that data.gouv.fr has turned into tables.',
  openDataNotTable: 'data.gouv.fr has not turned “{file}” into a table (it does so for CSV and Excel files up to a size). Try another file of the dataset.',
  openDataBadAnswer: 'data.gouv.fr answered something that is not data. Try again in a moment.',
  openDataStopped: 'Stopped.',
});
