// @ts-check
// K6-U1's strings: what a box can take, and why not (addendum KF-3). The KEYS are frozen by the
// kickoff (graph/takes.mjs `WHY_KEY` names each `why*` one); K6-U1 owns the words. Every refusal
// says WHY and WHAT WOULD MAKE IT WORK (build rule 6), and none of them claims a model can or
// cannot do something the farm did not say (build rule 7): a "no" about seeing is always "the farm
// does not list X as able to see" — the farm's declaration — never "X cannot see".
import { registerStrings } from '../core/i18n.mjs';

registerStrings('takes', {
  theModel: 'the model',
  // The short line on the box: "takes: PDF ✓".
  label: 'takes: {kind} {mark}',
  // The same line in words, for a screen reader and a hover: "takes a PDF: yes".
  labelAria: 'Takes {kind}: {state}',
  kindImage: 'picture',
  kindPdf: 'PDF',
  kindAudio: 'sound',
  kindText: 'text',
  markYes: '✓',
  markNo: '✗',
  markUnknown: '?',
  markUnwired: '–',
  stateYes: 'yes',
  stateNo: 'no',
  stateUnknown: 'not known',
  stateUnwired: 'not wired to anything yet',
  // One sentence per `why` code (graph/takes.mjs WHY).
  whyNoFarm: 'No farm is connected, so nobody can say yet what this can be used for. Connect to a farm and this line updates.',
  whyOcr: 'The farm reads this PDF’s text when a run needs it. Only the text comes back, and it stays on this computer.',
  whyNoOcr: 'This farm does not offer document reading right now (its Document OCR service is off or down), so the PDF stays here and nothing is sent. Whoever runs the farm can turn Document OCR on in its admin panel.',
  whyUnwired: 'Nothing uses this yet. Wire it into an Instruction.',
  whyVision: '{model} can look at pictures, as far as the farm says.',
  whyNoVision: 'The farm does not list {model} as able to see, so that Instruction refuses the picture before sending anything. Pick a model that can see in the Instruction.',
  whyVisionUnknown: 'The farm does not say whether {model} can see. The picture will be sent, and the farm’s answer will tell.',
  whyEngineNoAudio: 'This farm runs its models through Ollama, which has no way to pass sound on, so the sound is not sent. Its name and length go along as text.',
  whyNoAudio: 'The farm says {model} cannot listen, so the sound is not sent. Its name and length go along as text.',
  whyAudioUnreported: 'The farm does not say {model} can listen, so the sound is not sent. Its name and length go along as text.',
  whyAudioUnverified: '{model} says it can listen, but LOL has not yet verified that this farm can carry sound to it, so the sound is not sent. Its name and length go along as text.',
  // The Instruction's own line: what its model can take (graph/takes-view.mjs modelCapsLine).
  modelLine: '{model}: pictures {vision} · sound {audio} · PDF directly {pdf}',
});
