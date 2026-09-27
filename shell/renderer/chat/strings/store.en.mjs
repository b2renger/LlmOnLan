// @ts-check
// Strings for the store banner (ui/store-banner.mjs). Namespace: `store` (plan §2.6 L).
// The two texts are the ones plan §3.7 names for the memory store modes.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('store', {
  memory: "History isn't being saved yet — the local database is still opening. Anything you write now is kept and written as soon as it does.",
  memoryFinal: "History can't be saved on this machine — this chat disappears when you quit.",
});
