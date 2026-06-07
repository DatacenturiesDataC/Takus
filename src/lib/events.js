
// Takus — Custom Event Names
// Single-source-of-truth for all custom DOM events dispatched across the app.
// Import these constants instead of using raw strings to prevent typo-driven bugs.

/** Navigate to the entry detail view for a specific entry. */
export const OPEN_ENTRY = 'takus:open-entry';
/** Filter the history panel to a specific date. */
export const DATE_FILTER = 'takus:datefilter';

/** Fired after a vault sync round-trip completes. */
export const VAULT_SYNC_COMPLETE = 'takus:vault-sync-complete';

/** Fired when a cloud provider connection is established. */
export const CLOUD_CONNECTED = 'takus:cloud-connected';

/** Fired when an auto-capture is pending user confirmation (detail: { event }). */
export const AUTO_RECORD_PENDING = 'takus:auto-record-pending';

/** Fired by the notification manager to render a toast (detail: { notification }). */
export const NOTIFY = 'takus:notify';

/** Trigger a new recording session (dispatched by RecorderApp quick action). */
export const START_RECORDING = 'takus:start-recording';

/** Trigger document ingestion from a file picker (dispatched by DriveApp quick action). */
export const FILE_SELECTED = 'takus:file-selected';

/** Fired when an IndexedDB storage operation fails (e.g. quota exceeded or database blocked). */
export const STORAGE_ERROR = 'takus:storage-error';

/** Navigate to a specific tab/panel (detail: { tab }). */
export const NAVIGATE = 'takus:navigate';

/** Toggle sidebar visibility (dispatched by sidebar, listened by app-shell). */
export const SIDEBAR_TOGGLE = 'takus:sidebar-toggle';

/** Fired when an app is activated or deactivated (detail: { appId, active }). */
export const APPS_CHANGED = 'takus:apps-changed';
