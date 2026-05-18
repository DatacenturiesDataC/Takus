// Takus — Runtime Schema Validator (Knowledge OS)
// Validates IndexedDB records on read to guard against corruption or unexpected shapes.

import { CONTENT_TYPES, getCategory } from './content-types.js';

// Derived from the canonical CONTENT_TYPES registry
const ALL_CONTENT_TYPES = new Set(CONTENT_TYPES.map(t => t.id));

/**
 * Validate and auto-repair a content entry (entry, document, email, etc.).
 * Returns a clean object with all required fields guaranteed.
 * Logs warnings for unexpected shapes but never throws.
 *
 * @param {object} record  Raw record from IndexedDB
 * @returns {object}  Validated record with defaults filled
 */
export function validateEntry(record) {
  if (!record || typeof record !== 'object') {
    console.warn('[Schema] Invalid entry record:', record);
    return null;
  }

  const r = { ...record };

  // Required fields with defaults
  if (!r.id || typeof r.id !== 'string') { console.warn('[Schema] Entry missing id'); return null; }
  if (typeof r.title !== 'string') r.title = r.title ? String(r.title) : 'Untitled';
  if (typeof r.date !== 'number' || !isFinite(r.date)) r.date = Date.now();
  if (typeof r.duration !== 'number' || !isFinite(r.duration)) r.duration = 0;
  if (typeof r.size !== 'number' || !isFinite(r.size)) r.size = 0;

  if (!ALL_CONTENT_TYPES.has(r.type)) r.type = 'document';

  // Content lifecycle state — defaults to 'active' for existing records
  const validStates = ['raw', 'processing', 'active', 'condensed', 'archived', 'dismissed'];
  if (!validStates.includes(r.state)) r.state = 'active';

  // Optional string fields — coerce nullish to null
  for (const key of ['device', 'aiProvider', 'aiSummary', 'textContent', 'aiVtt', 'aiDocLink', 'driveLink', 'driveFolderId', 'notes']) {
    if (r[key] !== undefined && r[key] !== null && typeof r[key] !== 'string') {
      r[key] = String(r[key]);
    }
  }

  // Tasks are stored as graph nodes — remove any stale embedded tasks field
  delete r.tasks;

  // Analytics structure validation
  if (r.analytics && typeof r.analytics !== 'object') r.analytics = null;

  // Boolean fields
  if (r.pinned !== undefined && typeof r.pinned !== 'boolean') r.pinned = !!r.pinned;

  // Array fields
  if (r.participants && !Array.isArray(r.participants)) r.participants = [];
  if (r.tags && !Array.isArray(r.tags)) r.tags = [];

  // Inbound adapter fields — coerce to expected types
  if (r.source !== undefined && r.source !== null && typeof r.source !== 'string') {
    r.source = String(r.source);
  }
  if (r.sourceKey !== undefined && r.sourceKey !== null && typeof r.sourceKey !== 'string') {
    r.sourceKey = String(r.sourceKey);
  }
  if (r.sourceMetadata !== undefined && r.sourceMetadata !== null && typeof r.sourceMetadata !== 'object') {
    r.sourceMetadata = {};
  }

  return r;
}


/**
 * Validate a contact record.
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
 * Batch-validate an array of entries, filtering out invalid entries.
 * @param {Array} records
 * @returns {Array}
 */
export function validateEntries(records) {
  if (!Array.isArray(records)) return [];
  return records.map(validateEntry).filter(Boolean);
}

/**
 * Validate a wiki entry record.
 * @param {object} record
 * @returns {object|null}
 */
export function validateWikiEntry(record) {
  if (!record || typeof record !== 'object') return null;

  const w = { ...record };

  if (!w.id || typeof w.id !== 'string') return null;
  if (typeof w.date !== 'number' || !isFinite(w.date)) w.date = Date.now();
  if (typeof w.query !== 'string') w.query = w.query ? String(w.query) : '';
  if (typeof w.answer !== 'string') w.answer = w.answer ? String(w.answer) : '';
  if (!Array.isArray(w.sources)) w.sources = [];

  return w;
}

/**
 * Validate a knowledge graph edge record.
 * @param {object} record
 * @returns {object|null}
 */
export function validateEdge(record) {
  if (!record || typeof record !== 'object') return null;

  const e = { ...record };

  if (!e.id || typeof e.id !== 'string') return null;
  if (typeof e.sourceType !== 'string' || !e.sourceType) return null;
  if (typeof e.sourceId !== 'string' || !e.sourceId) return null;
  if (typeof e.targetType !== 'string' || !e.targetType) return null;
  if (typeof e.targetId !== 'string' || !e.targetId) return null;
  if (typeof e.edgeType !== 'string' || !e.edgeType) return null;
  if (typeof e.metadata !== 'object' || e.metadata === null) e.metadata = {};
  if (typeof e.createdAt !== 'number') e.createdAt = Date.now();

  return e;
}

/**
 * Validate a graph node record.
 * Ensures required fields exist and properties is an object.
 * @param {object} record
 * @returns {object|null}
 */
export function validateNode(record) {
  if (!record || typeof record !== 'object') return null;

  const n = { ...record };

  if (!n.id || typeof n.id !== 'string') return null;
  if (!n.type || typeof n.type !== 'string') return null;
  if (typeof n.properties !== 'object' || n.properties === null) n.properties = {};
  if (typeof n.createdAt !== 'number') n.createdAt = Date.now();
  if (typeof n.updatedAt !== 'number') n.updatedAt = n.createdAt;
  if (typeof n.state !== 'string') n.state = 'active';
  if (typeof n.appId !== 'string') n.appId = 'unknown';

  return n;
}
