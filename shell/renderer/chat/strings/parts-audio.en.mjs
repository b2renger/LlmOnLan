// @ts-check
// K6-U3's strings: the Sound box (addendum KF-6). Keys the kickoff resolves elsewhere are frozen BY
// NAME (`parts.audioLabel`, `parts.audioEmpty`, `parts.audioValue`); K6-U3 owns the words. Every
// refusal says WHY and WHAT WOULD MAKE IT WORK (build rule 6); none of them claims a model can or
// cannot listen — that is the "takes:" line's job, from what the farm said (build rule 7).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  audioLabel: 'Sound',
  audioEmpty: 'Drop a sound file here, or click to choose one.',
  // What flows on, as TEXT, because no verified path carries the sound itself (addendum KF-1).
  audioValue: 'Sound file “{name}” ({duration}, {mb} MB). The sound itself was not sent: {why}',
  audioUnnamed: 'sound',
  // The player.
  audioPlay: '▶ Play',
  audioStop: '■ Stop',
  audioPlayAria: 'Play {name}',
  audioStopAria: 'Stop playing {name}',
  audioTime: '{at} / {duration} · {mb} MB',
  audioReplace: 'Replace',
  audioRemove: 'Remove',
  audioReading: 'Reading the sound…',
  audioLoading: 'Getting the sound ready…',
  // Refusals, at intake (a drop on the box, the picker, or a drop on the canvas).
  audioTooBig: '“{name}” is {mb} MB, over the {capMb} MB a Sound box keeps. Try a shorter or more compressed file (an .mp3 or .ogg).',
  audioTooLong: '“{name}” lasts {duration}, longer than the {cap} a Sound box keeps. Cut it shorter and drop it again.',
  // Said from the file's headers or a decoded start, BEFORE the whole file is decoded.
  audioTooLongAbout: '“{name}” lasts about {duration}, longer than the {cap} a Sound box keeps. Cut it shorter and drop it again.',
  audioLengthUnknown: 'This computer cannot tell how long “{name}” is without decoding all of it, which could use a lot of memory, so it was not kept. Save it as WAV, MP3, OGG, FLAC or M4A and drop it again.',
  audioUndecodable: 'This computer cannot play “{name}”: it is not a sound file it knows how to read. WAV, MP3, OGG, FLAC and M4A files work.',
  audioEmptyFile: '“{name}” is empty. Drop a file that has sound in it.',
  audioNotSound: '“{name}” is not a sound file, so this box cannot hold it. Drop it on an empty part of the canvas instead, and the Computer makes the right box for it.',
  audioNoStore: 'This build of the Computer cannot keep files, so the sound was not kept.',
  audioNoPlayer: 'This window cannot play sound.',
});
