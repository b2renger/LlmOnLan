// @ts-check
// Strings for the dialog chrome (ui/dialogs.mjs). Namespace: `dialogs`.
// Plan §2.6 L assigns P1-U4 the `sidebar.*` and `store.*` namespaces; the dialog chrome is the same
// unit's third surface and gets its own namespace rather than squatting in either of those two.
// Titles/bodies/confirm labels always come from the CALLER — only the generic chrome lives here.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('dialogs', {
  ok: 'OK',
  cancel: 'Cancel',
  close: 'Close',
});
