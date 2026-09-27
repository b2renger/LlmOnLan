// @ts-check
// K4-U2's strings: image intake and the Image part (COMPUTER_PLAN §6.4). One file per K4 unit;
// see strings/parts-text.en.mjs for why.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  imageLabel: 'Image',
  imageHint: 'Drop, paste or choose a picture. Wire it into an Instruction to ask about it.',
  imageEmpty: 'Drop a picture here, paste one, or click to choose.',
  imageChoose: 'Choose a picture…',
  imageReplace: 'Replace',
  imageRemove: 'Remove',
  imageAria: '{name}, {w} by {h} pixels',
  imageSize: '{w}×{h} · {kb} KB',
  imageUnnamed: 'pasted image',
  // The refusals, in the words of the person who hit them (§8.4).
  // Critic S1-12: three checks, three sentences. One string used to serve all three, so a 40 MB
  // PNG read "40 MB once resized, over the 32 MB a box may carry": it was never resized.
  imageTooBigFile: 'That picture is {mb} MB, over the {capMb} MB the Computer will open. Try a smaller file.',
  imageTooManyPixels: 'That picture is {mp} megapixels, over the {capMp} megapixels the Computer will open. Try a smaller image, or crop it first.',
  imageTooBig: 'Even resized, that picture is {mb} MB, over the {capMb} MB a box may carry. Try a smaller image, or crop it first.',
  imageNotAnImage: 'That file is not a picture ({type}). Drop a PNG, JPEG, WebP or GIF.',
  imageUnreadable: 'That picture could not be read.',
  imageWorking: 'Reading the picture…',
  // K4-U2. An unknown MIME type still has to read as a sentence, so `imageNotAnImage` never says
  // "not a picture ()".
  imageTypeUnknown: 'no file type',
  // What an ARRIVING value does (§6.4 + §6.2 revision 2: the arrival becomes the VALUE, and the
  // picture the person chose stays in `settings` untouched).
  imageFromInput: 'From the wire',
  imageDropped: 'Dropped {name}.',
  imagePasted: 'Pasted {name}.',
  imageNoBox: 'Open a graph before pasting a picture.',
  // The wire refusals. Each names the port, what arrived, and what to do instead (§8.4).
  imageOnePicture: '{n} pictures arrived at this box, and an Image holds one. Wire one in, or add a second Image box.',
  imageWrongKind: 'A {kind} arrived at this box, and an Image holds a picture. Wire an Image in, or a file that is one.',
  imageFileUnreadable: '“{path}” could not be read from this graph’s folder.',
  imageFileNotAPicture: '“{path}” is not a picture ({type}). An Image box shows PNG, JPEG, WebP or GIF.',
  imageFileTooBig: '“{path}” is {mb} MB, over the {capMb} MB a box may carry. Resize it, or wire the Image box straight to the picture.',
  imageNoProject: 'That file value names no project folder, so there is nothing to read.',
});
