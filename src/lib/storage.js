// Takus — IndexedDB Storage

import { validateRecording, validateContact, validateWikiEntry, validateEdge } from './schema-validator.js';

const DB_NAME = 'takus';
const DB_VERSION = 6;

let _db = null;
let _persistRequested = false;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // v1 stores — created on fresh install or left as-is on upgrade
      if (e.oldVersion < 1) {
        const store = db.createObjectStore('recordings', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('recovery', { keyPath: 'id' });
      }
      // v2 — local blob storage for re-watching recordings offline
      if (e.oldVersion < 2) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
      // v3 — transcript embeddings (Phase 2: Ask) + living wiki entries
      if (e.oldVersion < 3) {
        db.createObjectStore('embeddings', { keyPath: 'recordingId' });
        const wiki = db.createObjectStore('wiki', { keyPath: 'id' });
        wiki.createIndex('date', 'date', { unique: false });
      }
      // v4 — Phase 9: VAULT sync tracking
      if (e.oldVersion < 4) {
        db.createObjectStore('vaultSync', { keyPath: 'id' });
      }
      // v5 — Phase 16: Knowledge Source Levels (L0–L4)
      if (e.oldVersion < 5) {
        const contacts = db.createObjectStore('contacts', { keyPath: 'id' });
        contacts.createIndex('email', 'email', { unique: false });
        contacts.createIndex('closenessScore', 'closenessScore', { unique: false });

        const interactions = db.createObjectStore('interactions', { keyPath: 'id', autoIncrement: true });
        interactions.createIndex('contactId', 'contactId', { unique: false });
        interactions.createIndex('timestamp', 'timestamp', { unique: false });

        const contentItems = db.createObjectStore('content_items', { keyPath: 'id' });
        contentItems.createIndex('knowledgeLevel', 'knowledgeLevel', { unique: false });
        contentItems.createIndex('ownerId', 'ownerId', { unique: false });

        const engagements = db.createObjectStore('engagement_events', { keyPath: 'id', autoIncrement: true });
        engagements.createIndex('contentId', 'contentId', { unique: false });
        engagements.createIndex('contactId', 'contactId', { unique: false });
      }
      // v6 — Phase D: Lightweight knowledge graph edges
      if (e.oldVersion < 6) {
        const edges = db.createObjectStore('edges', { keyPath: 'id' });
        edges.createIndex('sourceKey', ['sourceType', 'sourceId'], { unique: false });
        edges.createIndex('targetKey', ['targetType', 'targetId'], { unique: false });
        edges.createIndex('edgeType', 'edgeType', { unique: false });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      // If the connection drops (e.g. quota exceeded, user clears storage),
      // invalidate the cache so the next operation reconnects.
      _db.onclose = () => { _db = null; };
      // Request persistent storage so the browser won't evict recordings
      // under storage pressure. Best-effort — silently ignored if denied.
      if (navigator.storage?.persist && !_persistRequested) {
        _persistRequested = true;
        navigator.storage.persist().catch(() => {});
      }
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

// --- Recordings History ---
export async function saveRecording(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('recordings', 'readwrite');
    t.objectStore('recordings').put(record);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getRecordings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('recordings', 'readonly');
    const req = t.objectStore('recordings').index('date').openCursor(null, 'prev');
    const results = [];
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const validated = validateRecording(cursor.value);
        if (validated) results.push(validated);
        cursor.continue();
      }
      else resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecording(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('recordings', 'readwrite');
    t.objectStore('recordings').delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function clearAllRecordings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['recordings', 'recovery', 'blobs', 'embeddings', 'wiki', 'edges'], 'readwrite');
    t.objectStore('recordings').clear();
    t.objectStore('recovery').clear();
    t.objectStore('blobs').clear();
    t.objectStore('embeddings').clear();
    t.objectStore('wiki').clear();
    t.objectStore('edges').clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// --- Local Blob Storage (re-watch recordings offline) ---

export async function saveRecordingBlob(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('blobs', 'readwrite');
    t.objectStore('blobs').put({ id, blob, savedAt: Date.now() });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getRecordingBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('blobs', 'readonly');
    const req = t.objectStore('blobs').get(id);
    req.onsuccess = () => resolve(req.result?.blob ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecordingBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('blobs', 'readwrite');
    t.objectStore('blobs').delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// --- Settings Persistence ---
export async function saveSetting(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('settings', 'readwrite');
    t.objectStore('settings').put({ key, value });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getSetting(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('settings', 'readonly');
    const req = t.objectStore('settings').get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

// --- Crash Recovery ---
export async function saveRecoveryChunk(id, chunks) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('recovery', 'readwrite');
    t.objectStore('recovery').put({ id, chunks, updatedAt: Date.now() });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getRecoveryData(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('recovery', 'readonly');
    const req = t.objectStore('recovery').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearRecoveryData(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('recovery', 'readwrite');
    t.objectStore('recovery').delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// --- Embeddings (Phase 2: Ask) ---

export async function saveEmbeddings(recordingId, chunks) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('embeddings', 'readwrite');
    t.objectStore('embeddings').put({ recordingId, chunks });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** @planned Not used at runtime — only getAllEmbeddings() is consumed. Kept for future per-recording lookup. */
export async function getEmbeddings(recordingId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('embeddings', 'readonly');
    const req = t.objectStore('embeddings').get(recordingId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllEmbeddings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('embeddings', 'readonly');
    const req = t.objectStore('embeddings').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteEmbeddings(recordingId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('embeddings', 'readwrite');
    t.objectStore('embeddings').delete(recordingId);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// --- Living Wiki (Phase 2: Ask) ---

export async function saveWikiEntry(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('wiki', 'readwrite');
    t.objectStore('wiki').put(entry);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getWikiEntries() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('wiki', 'readonly');
    const req = t.objectStore('wiki').index('date').openCursor(null, 'prev');
    const results = [];
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const validated = validateWikiEntry(cursor.value);
        if (validated) results.push(validated);
        cursor.continue();
      }
      else resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteWikiEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('wiki', 'readwrite');
    t.objectStore('wiki').delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// --- Phase 9: VAULT Sync ---

/**
 * Save or update vault sync status for a recording.
 * @param {{ id: string, driveFolderId?: string, drivePackageUploaded?: boolean, archiveStatus?: string, pinned?: boolean, legalHold?: boolean, lastSyncDate?: number }} record
 */
export async function saveVaultSync(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('vaultSync', 'readwrite');
    t.objectStore('vaultSync').put(record);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Get vault sync status for a recording by ID.
 * @param {string} id - Recording ID
 * @returns {Promise<object|undefined>}
 */
export async function getVaultSync(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('vaultSync', 'readonly');
    const req = t.objectStore('vaultSync').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all vault sync entries (for sync/diff on init).
 * @returns {Promise<Array>}
 */
export async function getAllVaultSync() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('vaultSync', 'readonly');
    const req = t.objectStore('vaultSync').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(t.error);
  });
}

// --- Phase 16: Contacts ---

/** Save or update a contact. */
export async function saveContact(contact) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('contacts', 'readwrite');
    t.objectStore('contacts').put(contact);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Get all contacts. */
export async function getContacts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('contacts', 'readonly');
    const req = t.objectStore('contacts').getAll();
    req.onsuccess = () => resolve((req.result || []).map(validateContact).filter(Boolean));
    req.onerror = () => reject(t.error);
  });
}

/** Get a single contact by ID. */
export async function getContact(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('contacts', 'readonly');
    const req = t.objectStore('contacts').get(id);
    req.onsuccess = () => resolve(req.result ? validateContact(req.result) : null);
    req.onerror = () => reject(t.error);
  });
}

/** Delete a contact by ID. */
export async function deleteContact(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('contacts', 'readwrite');
    t.objectStore('contacts').delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// --- Phase 16: Interactions ---

/** Save an interaction to IDB. Called by recording-pipeline for PARTICIPATED_IN events. */
export async function saveInteraction(interaction) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('interactions', 'readwrite');
    t.objectStore('interactions').put(interaction);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Get all interactions for a contact. */
export async function getInteractionsForContact(contactId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('interactions', 'readonly');
    const idx = t.objectStore('interactions').index('contactId');
    const req = idx.getAll(contactId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(t.error);
  });
}

/** Get all interactions. */
export async function getAllInteractions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('interactions', 'readonly');
    const req = t.objectStore('interactions').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(t.error);
  });
}

// --- Phase 16: Engagement Events ---

/** @planned IDB store exists but no UI flow writes engagement events yet. */
export async function saveEngagementEvent(event) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('engagement_events', 'readwrite');
    t.objectStore('engagement_events').put(event);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** @planned No engagement events are saved yet — see saveEngagementEvent. */
export async function getEngagementsByContent(contentId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('engagement_events', 'readonly');
    const idx = t.objectStore('engagement_events').index('contentId');
    const req = idx.getAll(contentId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(t.error);
  });
}

// --- Phase 16: Content Items ---

/** Save or update a content item with knowledge level. */
export async function saveContentItem(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('content_items', 'readwrite');
    t.objectStore('content_items').put(item);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Get all content items. */
export async function getContentItems() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('content_items', 'readonly');
    const req = t.objectStore('content_items').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(t.error);
  });
}

/** Get all engagement events (for batch recomputation). */
export async function getAllEngagementEvents() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('engagement_events', 'readonly');
    const req = t.objectStore('engagement_events').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(t.error);
  });
}

// ── Edges (Phase D: Lightweight Knowledge Graph) ─────────────────────────────

/**
 * Add an edge between two nodes in the knowledge graph.
 *
 * @param {object} edge
 * @param {string} edge.sourceType - e.g. 'recording', 'contact', 'task'
 * @param {string} edge.sourceId
 * @param {string} edge.targetType
 * @param {string} edge.targetId
 * @param {string} edge.edgeType - e.g. 'PARTICIPATED_IN', 'SIMILAR_TO', 'ASSIGNED_TO'
 * @param {object} [edge.metadata] - Optional edge metadata (score, context, etc.)
 * @returns {Promise<string>} The edge ID
 */
export async function addEdge(edge) {
  const id = `${edge.sourceType}:${edge.sourceId}→${edge.edgeType}→${edge.targetType}:${edge.targetId}`;
  const record = {
    id,
    sourceType: edge.sourceType,
    sourceId: edge.sourceId,
    targetType: edge.targetType,
    targetId: edge.targetId,
    edgeType: edge.edgeType,
    metadata: edge.metadata || {},
    createdAt: Date.now(),
  };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('edges', 'readwrite');
    t.objectStore('edges').put(record);
    t.oncomplete = () => resolve(id);
    t.onerror = () => reject(t.error);
  });
}

/**
 * Get all edges where the given node is the source.
 *
 * @param {string} sourceType
 * @param {string} sourceId
 * @returns {Promise<object[]>}
 */
export async function getEdgesFromNode(sourceType, sourceId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('edges', 'readonly');
    const idx = t.objectStore('edges').index('sourceKey');
    const req = idx.getAll([sourceType, sourceId]);
    req.onsuccess = () => resolve((req.result || []).map(validateEdge).filter(Boolean));
    req.onerror = () => reject(t.error);
  });
}

/**
 * Get all edges where the given node is the target.
 *
 * @param {string} targetType
 * @param {string} targetId
 * @returns {Promise<object[]>}
 */
export async function getEdgesToNode(targetType, targetId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('edges', 'readonly');
    const idx = t.objectStore('edges').index('targetKey');
    const req = idx.getAll([targetType, targetId]);
    req.onsuccess = () => resolve((req.result || []).map(validateEdge).filter(Boolean));
    req.onerror = () => reject(t.error);
  });
}

/**
 * Get ALL edges for a node (both as source and target).
 *
 * @param {string} nodeType
 * @param {string} nodeId
 * @returns {Promise<object[]>}
 */
export async function getEdgesForNode(nodeType, nodeId) {
  const [from, to] = await Promise.all([
    getEdgesFromNode(nodeType, nodeId),
    getEdgesToNode(nodeType, nodeId),
  ]);
  return [...from, ...to];
}

/**
 * Remove a specific edge by ID.
 *
 * @param {string} edgeId
 */
export async function removeEdge(edgeId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('edges', 'readwrite');
    t.objectStore('edges').delete(edgeId);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Remove all edges where the given node is either source or target.
 * Used when deleting a recording, contact, etc.
 *
 * @param {string} nodeType
 * @param {string} nodeId
 */
export async function removeEdgesForNode(nodeType, nodeId) {
  const edges = await getEdgesForNode(nodeType, nodeId);
  if (!edges.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('edges', 'readwrite');
    const store = t.objectStore('edges');
    for (const edge of edges) store.delete(edge.id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
