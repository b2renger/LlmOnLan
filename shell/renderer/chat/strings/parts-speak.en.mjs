// @ts-check
// The Speak box (docs/ECOSYSTEM_PLAN.md v2 §3.3). One file per unit, same namespace: see
// strings/parts-text.en.mjs for why.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  speakLabel: 'Speak',
  speakIn: 'text',
  speakVoice: 'Voice',
  speakVoiceHint: 'Who says it: this computer’s voice works offline and sends nothing; the farm’s voice sends the text to the farm to be spoken.',
  speakVoiceAuto: 'Automatic (the farm’s voice if it has one, else this computer’s)',
  speakVoiceFarm: 'The farm’s voice (Kokoro)',
  speakVoiceLocal: 'This computer’s voice',
  speakHint: 'Says what arrives, out loud. This computer’s own voice works offline and sends nothing; the farm’s voice sends the text to the farm to be spoken.',
  speakAgain: '▶ Say it again',
  speakSaid: 'Said with {voice}: {text}',
  speakWithFarm: 'the farm’s voice',
  speakWithLocal: 'this computer’s voice',
  speakEmpty: 'Nothing to say: wire some text into this box.',
  speakNoVoice: 'This computer has no voice to speak with, and the farm offers none.',
  speakNoFarmVoice: 'The farm offers no voice right now: its operator turns on Voice (TTS) in the farm panel (Plugins). Or pick this computer’s voice.',
  speakTooLong: 'That is too much text to say at once ({n} characters; the most is {max}).',
  speakErr: 'The farm’s voice did not answer ({message}).',
});
