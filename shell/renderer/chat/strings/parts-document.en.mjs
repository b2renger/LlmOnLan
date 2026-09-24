// @ts-check
// K6-U2's strings: the Document (PDF) box and the local file store (addendum KF-5, KF-8). Keys the
// kickoff resolves elsewhere are frozen BY NAME (`parts.docLabel`, `parts.docEmpty`,
// `parts.mediaTooBig`, `parts.mediaUnreadable`, `parts.mediaMissing`); K6-U2 owns the words.
// Every refusal says WHY and WHAT WOULD MAKE IT WORK (build rule 6).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  docLabel: 'Document',
  docEmpty: 'Drop a PDF here, or click to choose one.',
  docReplace: 'Replace',
  docRemove: 'Remove',
  docMeta: '{mb} MB',
  docMetaPages: '{mb} MB · {pages} pages read',
  docMetaPage: '{mb} MB · 1 page read',
  docNotAPdf: '{name} is not a PDF ({type}). A Document box holds a PDF; a picture goes in an Image box and a sound in a Sound box.',
  docKeeping: 'Keeping {name} on this computer…',
  docKept: 'Kept on this computer. The farm reads its text only when the graph runs, and only the text comes back.',
  docWaiting: 'Waiting while the farm reads another document…',
  docReading: 'Reading {name} on the farm… A long or scanned document can take a minute.',
  // What flows on: one marker per page, so a model can say "on page 3".
  docPageMark: '**Page {page}**',
  docCutPages: 'First {shown} of {total} pages. The rest was not passed on; split the PDF to use it.',
  docCutChars: 'The first {chars} characters, up to page {page} of {total}. The rest was not passed on; split the PDF to use it.',
  docMoreHere: 'This box shows the first {kb} KB. All of the text above the cut flows on.',
  docNoText: 'The farm read {name} but found no text in it. If it is a scan, ask whoever runs the farm whether its document reader has a vision model.',
  // A PDF dropped on a box while the farm reads no documents. The WHY (and who can change it) is
  // the "takes:" line right above it, so this names the file and what happened, without repeating it.
  docRefusedNoOcr: '{name} was not kept, and nothing was sent. Drop it again once the farm reads documents.',
  docNoFarm: 'No farm is connected, so {name} cannot be read. Connect to a farm that offers document reading and run again.',
  // One sentence per net/extract.mjs code (the `no-ocr` one is graph/takes.mjs's own sentence).
  docErrUnauthorized: 'The farm’s document reader refused the key this computer has for it. Reconnect to the farm (the key comes with it) and run again.',
  docErrUnsupported: 'The farm’s document reader cannot read {name}. Check that it really is a PDF.',
  docErrFarm: 'The farm’s document reader failed on {name} (HTTP {status}). Run again; if it keeps failing, whoever runs the farm can check Document OCR in its admin panel.',
  docErrAborted: 'Stopped while the farm was reading {name}. Nothing was kept; run again to read it.',
  docErrTimeout: 'The farm took more than {min} minutes to read {name}, so LOL gave up. Try a shorter PDF, or run again when the farm is less busy.',
  docErrNetwork: 'The farm’s document reader could not be reached to read {name}. Check the connection to the farm and run again.',
  // The shared file store (computer/media.mjs) speaks through these, for the Sound box too.
  mediaTooBig: '{name} is {mb} MB, over the {capMb} MB a box may keep. Try a smaller file.',
  mediaUnreadable: '{name} could not be read.',
  mediaEmpty: '{name} is empty, so there is nothing to keep.',
  mediaNotPdf: '{name} does not contain a PDF (a PDF starts with “%PDF”), so it was not kept.',
  mediaNoStore: 'This window cannot keep files on this computer right now, so {name} was not kept. Reload the Computer and try again.',
  mediaMissing: 'The file for this box is not on this computer any more. Drop it here again.',
});
