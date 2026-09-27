// @ts-check
// Strings owned by P1-U2 (controller, composer, model picker). Namespace `composer` (plan §2.6 L).
//
// The VERBATIM v0.1.45 parity strings are NOT here: `core.stats`, `core.busyNote`,
// `core.busyPercent`, `core.busyFailNote`, `core.errorNote`, `core.alreadyRunning` and the four
// §3.10 picker placeholders (`core.noFarm`, `core.noModels`, `core.unreachable`,
// `core.passwordRefused`) live in strings/core.en.mjs and are REUSED from here, so a harness
// assertion reads the same text whether a fake or the real module produced it.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('composer', {
  // composer (ui/composer.mjs)
  preparing: 'Preparing…',
  removePart: 'Remove',
  partMenu: 'Options',

  // controller (app/controller.mjs) — local notes that never reach the farm
  keyMissingNote: 'Password needed — enter it on the farm card',
  noFarmNote: 'No farm yet — LOL Chat is still looking for one on the network.',
  toolCallsNote: "The model tried to use a tool; LOL Chat doesn't run tools.",
});
