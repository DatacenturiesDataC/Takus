
// Observable upload progress tracker.
// Tracks all active and recent uploads with status, progress, and timing.

/**
 * @typedef {object} UploadEntry
 * @property {string} id — Entry ID
 * @property {string} filename
 * @property {'queued'|'uploading'|'converting'|'done'|'error'} status
 * @property {number} progress — 0-100
 * @property {number} startedAt
 * @property {number} [completedAt]
 * @property {string} [error]
 * @property {string} [link] — Cloud link on completion
 * @property {number} [size] — File size in bytes
 * @property {number} [attempt] — Current retry attempt
 */

/** @type {Map<string, UploadEntry>} */
const _uploads = new Map();

/** @type {Set<function>} */
const _listeners = new Set();

/**
 * Subscribe to upload state changes.
 * @param {function(UploadEntry): void} fn
 * @returns {function} Unsubscribe
 */
export function onUploadChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _notify(entry) {
  for (const fn of _listeners) {
    try { fn(entry); } catch (e) { console.warn('[UploadTracker] Listener error:', e); }
  }
}

/**
 * Start tracking an upload.
 * @param {string} id
 * @param {string} filename
 * @param {number} [size]
 * @returns {UploadEntry}
 */
export function trackUpload(id, filename, size = 0) {
  const entry = {
    id,
    filename,
    status: 'queued',
    progress: 0,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    link: null,
    size,
    attempt: 0,
  };
  _uploads.set(id, entry);
  _notify(entry);
  return entry;
}

/**
 * Update upload progress.
 * @param {string} id
 * @param {number} progress — 0-100
 * @param {object} [extra] — Additional fields to update
 */
export function updateUploadProgress(id, progress, extra = {}) {
  const entry = _uploads.get(id);
  if (!entry) return;
  entry.status = 'uploading';
  entry.progress = Math.min(100, Math.max(0, progress));
  Object.assign(entry, extra);
  _notify(entry);
}

/**
 * Mark an upload as converting (MP4/GIF).
 * @param {string} id
 * @param {string} [format='mp4']
 */
export function markConverting(id, format = 'mp4') {
  const entry = _uploads.get(id);
  if (!entry) return;
  entry.status = 'converting';
  entry.convertFormat = format;
  _notify(entry);
}

/**
 * Mark an upload as completed.
 * @param {string} id
 * @param {string} [link]
 */
export function completeUpload(id, link = null) {
  const entry = _uploads.get(id);
  if (!entry) return;
  entry.status = 'done';
  entry.progress = 100;
  entry.completedAt = Date.now();
  entry.link = link;
  _notify(entry);
}

/**
 * Mark an upload as failed.
 * @param {string} id
 * @param {string} error
 */
export function failUpload(id, error) {
  const entry = _uploads.get(id);
  if (!entry) return;
  entry.status = 'error';
  entry.error = error;
  entry.completedAt = Date.now();
  _notify(entry);
}

/**
 * Record a retry attempt.
 * @param {string} id
 * @param {number} attempt
 */
export function retryUpload(id, attempt) {
  const entry = _uploads.get(id);
  if (!entry) return;
  entry.status = 'uploading';
  entry.attempt = attempt;
  entry.progress = 0;
  entry.error = null;
  _notify(entry);
}

/**
 * Get all active uploads (queued or uploading).
 * @returns {UploadEntry[]}
 */
export function getActiveUploads() {
  return [..._uploads.values()].filter(e => e.status === 'queued' || e.status === 'uploading' || e.status === 'converting');
}

/**
 * Get all uploads (active + recent completed/failed).
 * @param {number} [limit=20]
 * @returns {UploadEntry[]}
 */
export function getAllUploads(limit = 20) {
  return [..._uploads.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

/**
 * Clear completed uploads from the tracker.
 */
export function clearCompleted() {
  for (const [id, entry] of _uploads) {
    if (entry.status === 'done' || entry.status === 'error') {
      _uploads.delete(id);
    }
  }
}

/**
 * Get upload statistics.
 * @returns {{active: number, completed: number, failed: number, totalBytes: number}}
 */
export function getUploadStats() {
  let active = 0, completed = 0, failed = 0, totalBytes = 0;
  for (const entry of _uploads.values()) {
    if (entry.status === 'uploading' || entry.status === 'queued' || entry.status === 'converting') active++;
    else if (entry.status === 'done') { completed++; totalBytes += entry.size || 0; }
    else if (entry.status === 'error') failed++;
  }
  return { active, completed, failed, totalBytes };
}
