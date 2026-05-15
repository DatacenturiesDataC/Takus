// Takus — Custom Event Names
// Single-source-of-truth for all custom DOM events dispatched across the app.
// Import these constants instead of using raw strings to prevent typo-driven bugs.

/** Navigate to the recording detail view for a specific recording. */
export const OPEN_RECORDING = 'takus:open-recording';

/** Filter the history panel to a specific date. */
export const DATE_FILTER = 'takus:datefilter';

/** Fired after a vault sync round-trip completes. */
export const VAULT_SYNC_COMPLETE = 'takus:vault-sync-complete';

/** Fired when a cloud provider connection is established. */
export const CLOUD_CONNECTED = 'takus:cloud-connected';

/** Fired when an auto-recording is pending user confirmation (detail: { event }). */
export const AUTO_RECORD_PENDING = 'takus:auto-record-pending';

/** Fired by the notification manager to render a toast (detail: { notification }). */
export const NOTIFY = 'takus:notify';
