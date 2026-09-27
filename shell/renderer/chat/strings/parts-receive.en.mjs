// @ts-check
// The Receive box and the shared "Board" row (P3a-2, USB serial). One file per unit, same namespace
// pattern: see strings/parts-text.en.mjs for why.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  receiveLabel: 'Receive',
  receiveHint: 'Hands on what a board says over USB: one line per message. A line that is JSON (like {"light": 512}) flows on as data.',
  receiveTake: 'Hand on',
  receiveTake_latest: 'the latest line',
  receiveTake_new: 'every new line since the last run',
  receiveListening: 'Listening to {name}…',
  receiveLast: 'Last line: {line}',
  receiveNothing: 'Nothing from the board yet. Is it plugged in, and sending lines at {baud} baud?',
  receiveNothingNew: 'No new line from the board since the last run.',
  receiveNoBoard: 'Choose the board first.',
  boardChoose: 'Choose the board…',
  boardChooseHint: 'Lists the boards plugged in over USB; you pick one.',
  boardBaud: 'Speed (baud)',
  boardIs: 'Board: {name}',
  boardNone: 'No board chosen',
  boardErrNoSerial: 'USB serial is not available in this window.',
  boardErrNone: 'No board found. Plug it in with a data cable (some cables only charge), then try again.',
  boardErrCancelled: 'No board chosen.',
  boardErrNotFound: 'The board is not plugged in (or was unplugged).',
  boardErrBusy: 'The board is busy: close the Arduino Serial Monitor, or any other program using it.',
  boardErrLost: 'The board stopped answering (unplugged?).',
});
