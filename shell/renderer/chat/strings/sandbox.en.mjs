// @ts-check
// Strings for the sandbox host. One namespace per unit (§2.6 L): `sandbox.*` belongs to C3-U1.
// Part labels live in `parts.*` (C3-U2); the canvas's own words in `graph.*` (C3-U3).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('sandbox', {
  frameTitle: 'Sandboxed preview',
  // K-9: the live guest's frame, as a screen reader names it when it takes the focus.
  liveTitle: 'Live sketch — Escape hands the keyboard back to the canvas',

  // failures the host reports to whoever called it. Each names what happened and what it means —
  // never "an error occurred" (§1.2: a silent or vague failure is the bug).
  errTimeout: 'The sandbox did not answer in time — the code may be looping.',
  errNoFrame: 'The sandbox is not running.',
  errGone: 'The sandbox was restarted while this was running.',
  errDisabled: 'The sandbox could not start, so nothing was run.',
  errNotBuilt: 'This part of the sandbox is not built yet.',
  errBoot: 'The sandbox did not answer while starting up — the preview is off.',
  errAborted: 'The run was stopped before the sandbox answered.',
  errResultJson: 'The result cannot be turned into JSON — return text, a number, an array or a plain object.',
  errResultBig: 'The result is too large to carry on a wire.',

  // the restart ladder (studio plan §3.7.4)
  stalled: 'The sketch stopped responding — the preview was restarted.',
  disabled: 'The preview is off until you press Run again.',
  dropped: 'The preview sent something the app could not read, so it was restarted.',
  libMissing: 'This build does not ship {name}.',
  libFailed: '{name} could not be loaded, so a sketch that needs it will not run.',
  libUsingProject: "Using this project's {name}.",
});
