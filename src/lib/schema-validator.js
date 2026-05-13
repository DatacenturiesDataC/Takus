// Takus — Runtime Schema Validator (Phase 16)
// Validates IndexedDB records on read to guard against corruption or unexpected shapes.

/**
 * Validate and auto-repair a recording record.
 * Returns a clean object with all required fields guaranteed.
 * Logs warnings for unexpected shapes but never throws.
 *
 * @param {object} record  Raw record from IndexedDB
 * @returns {object}  Validated record with defaults filled
 */
export function validateRecording(record) {
  if (!record || typeof record !== 'object') {
    console.warn('[Schema] Invalid recording record:', record);
    return null;
  }

  const r = { ...record };

  // Required fields with defaults
  if (!r.id || typeof r.id !== 'string') { console.warn('[Schema] Recording missing id'); return null; }
  if (typeof r.title !== 'string') r.title = r.title ? String(r.title) : 'Untitled Recording';
  if (typeof r.date !== 'number' || !isFinite(r.date)) r.date = Date.now();
  if (typeof r.duration !== 'number' || !isFinite(r.duration)) r.duration = 0;
  if (typeof r.size !== 'number' || !isFinite(r.size)) r.size = 0;

  const validTypes = ['meeting', 'screen', 'presentation', 'update'];
  if (!validTypes.includes(r.type)) r.type = 'screen';

  // Optional string fields — coerce nullish to null
  for (const key of ['device', 'aiProvider', 'aiSummary', 'aiTranscript', 'aiVtt', 'aiDocLink', 'driveLink', 'driveFolderId', 'notes']) {
    if (r[key] !== undefined && r[key] !== null && typeof r[key] !== 'string') {
      r[key] = String(r[key]);
    }
  }

  // Tasks structure validation
  if (r.tasks && typeof r.tasks === 'object') {
    if (!Array.isArray(r.tasks.takusTasks)) r.tasks.takusTasks = [];
    if (!Array.isArray(r.tasks.meTasks)) r.tasks.meTasks = [];
  }

  // Analytics structure validation
  if (r.analytics && typeof r.analytics !== 'object') r.analytics = null;

  // Boolean fields
  if (r.pinned !== undefined && typeof r.pinned !== 'boolean') r.pinned = !!r.pinned;

  // Array fields
  if (r.participants && !Array.isArray(r.participants)) r.participants = [];

  return r;
}

/**
 * Validate a contact record for Phase 16 L0–L4.
 * @param {object} record
 * @returns {object|null}
 */
export function validateContact(record) {
  if (!record || typeof record !== 'object') return null;

  const c = { ...record };

  if (!c.id || typeof c.id !== 'string') return null;
  if (typeof c.name !== 'string') c.name = c.name ? String(c.name) : '';
  if (typeof c.email !== 'string') c.email = c.email ? String(c.email) : '';
  if (typeof c.closenessScore !== 'number' || !isFinite(c.closenessScore)) c.closenessScore = 0;
  if (c.closenessScore < 0) c.closenessScore = 0;
  if (c.closenessScore > 100) c.closenessScore = 100;
  if (typeof c.isManualClose !== 'boolean') c.isManualClose = false;
  if (typeof c.createdAt !== 'number') c.createdAt = Date.now();
  if (typeof c.updatedAt !== 'number') c.updatedAt = Date.now();

  return c;
}

/**
 * Batch-validate an array of recordings, filtering out invalid entries.
 * @param {Array} records
 * @returns {Array}
 */
export function validateRecordings(records) {
  if (!Array.isArray(records)) return [];
  return records.map(validateRecording).filter(Boolean);
}
