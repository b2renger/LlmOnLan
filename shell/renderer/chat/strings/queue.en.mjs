// @ts-check
// Strings for the batch queue chip (S0-U3, studio plan §3.5.4). Namespace: `queue`.
//
// The chip is the only thing a reader sees while a panel runs a batch, so its words carry the whole
// state: what is running, how far it got, and — when `pref:queueMax` cut the batch short — that some
// items never ran at all. `dialogs.cancel` is REUSED for the button (§2.6 L), never redefined.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('queue', {
  // The running batch. `label` is whatever the panel called its run ("Naming 4 sketches").
  running: '{label} — {i}/{n}',
  // No label: a batch is still a batch.
  runningBare: 'Working — {i}/{n}',
  // pref:queueMax cut the batch. Never silent: the reader is told how many items were left out.
  truncated: '{count} not run (batch limit)',
  cancelled: 'Stopped',
  // 5 FARM_TICK retries and the farm was busy every time.
  stalled: 'The farm stayed busy — stopped',
  cancelTitle: 'Stop this batch',
});
