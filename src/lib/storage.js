// Takus — IndexedDB Storage (Knowledge OS)

import { validateEntry, validateContact, validateWikiEntry, validateEdge, validateNode } from './schema-validator.js';

const DB_NAME = 'takus';
const DB_VERSION = 9;

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
        const store = db.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('recovery', { keyPath: 'id' });
      }
      // v2 — local blob storage
      if (e.oldVersion < 2) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
      // v3 — transcript embeddings + living wiki entries
      if (e.oldVersion < 3) {
        db.createObjectStore('embeddings', { keyPath: 'contentId' });
        const wiki = db.createObjectStore('wiki', { keyPath: 'id' });
        wiki.createIndex('date', 'date', { unique: false });
      }
      // v4 — VAULT sync tracking
      if (e.oldVersion < 4) {
        db.createObjectStore('vaultSync', { keyPath: 'id' });
      }
      // v5 — Knowledge Source Levels (L0–L4)
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
      // v6 — Lightweight knowledge graph edges
      if (e.oldVersion < 6) {
        const edges = db.createObjectStore('edges', { keyPath: 'id' });
        edges.createIndex('sourceKey', ['sourceType', 'sourceId'], { unique: false });
        edges.createIndex('targetKey', ['targetType', 'targetId'], { unique: false });
        edges.createIndex('edgeType', 'edgeType', { unique: false });
      }
      // v7 — Step execution checkpoints
      if (e.oldVersion < 7) {
        const checkpoints = db.createObjectStore('step_checkpoints', { keyPath: 'taskKey' });
        checkpoints.createIndex('contentId', 'contentId', { unique: false });
        checkpoints.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      // v8 — Unified node store (App Platform: Graph Foundation)
      if (e.oldVersion < 8) {
        const nodes = db.createObjectStore('nodes', { keyPath: 'id' });
        nodes.createIndex('type', 'type', { unique: false });
        nodes.createIndex('state', 'state', { unique: false });
        nodes.createIndex('appId', 'appId', { unique: false });
        nodes.createIndex('createdAt', 'createdAt', { unique: false });
        nodes.createIndex('type_state', ['type', 'state'], { unique: false });
      }
      // v9 — Knowledge OS: Content-agnostic store names
      // No production data exists, so we recreate stores with correct names.
      if (e.oldVersion < 9) {
        // Drop legacy stores
        if (db.objectStoreNames.contains('entries')) db.deleteObjectStore('entries');
        if (db.objectStoreNames.contains('blobs')) db.deleteObjectStore('blobs');
        if (db.objectStoreNames.contains('embeddings')) db.deleteObjectStore('embeddings');
        if (db.objectStoreNames.contains('step_checkpoints')) db.deleteObjectStore('step_checkpoints');

        // Recreate with content-agnostic names
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('date', 'date', { unique: false });

        db.createObjectStore('media', { keyPath: 'id' });

        db.createObjectStore('embeddings', { keyPath: 'contentId' });

        const checkpoints = db.createObjectStore('step_checkpoints', { keyPath: 'taskKey' });
        checkpoints.createIndex('contentId', 'contentId', { unique: false });
        checkpoints.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      // If the connection drops (e.g. quota exceeded, user clears storage),
      // invalidate the cache so the next operation reconnects.
      _db.onclose = () => { _db = null; };
      // If another tab upgrades the DB (new deploy), close this connection
      // so the upgrade can proceed and this tab reconnects on next operation.
      _db.onversionchange = () => { _db.close(); _db = null; };
      // Request persistent storage so the browser won't evict entries
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

// --- Content Entries (entries, documents, emails, notes, etc.) ---
export async function saveEntry(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('entries', 'readwrite');
    t.objectStore('entries').put(entry);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getEntries() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('entries', 'readonly');
    const req = t.objectStore('entries').index('date').openCursor(null, 'prev');
    const results = [];
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const validated = validateEntry(cursor.value);
        if (validated) results.push(validated);
        cursor.continue();
      }
      else resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Fetch a single entry by ID. Returns null if not found. */
export async function getEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('entries', 'readonly');
    const req = t.objectStore('entries').get(id);
    req.onsuccess = () => {
      const entry = req.result;
      resolve(entry ? validateEntry(entry) : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('entries', 'readwrite');
    t.objectStore('entries').delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function clearAllEntries() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const storeNames = [
      'entries', 'recovery', 'media', 'embeddings', 'wiki',
      'edges', 'step_checkpoints', 'vaultSync',
      // v5+ stores — contacts, interactions, content levels, engagement
      'contacts', 'interactions', 'content_items', 'engagement_events',
      // v8 — unified graph nodes (goals, tasks, etc.)
      'nodes',
    ];
    const t = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) t.objectStore(name).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// --- Local Blob Storage (media playback offline) ---

export async function saveMediaBlob(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('media', 'readwrite');
    t.objectStore('media').put({ id, blob, savedAt: Date.now() });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getMediaBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('media', 'readonly');
    const req = t.objectStore('media').get(id);
    req.onsuccess = () => resolve(req.result?.blob ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteMediaBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('media', 'readwrite');
    t.objectStore('media').delete(id);
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

/**
 * Read a setting directly from IDB.
 *
 * Use this for:
 *   - Keys NOT managed by settings-store.js (device IDs, feature flags, preference signals)
 *   - First-time reads before settings-store cache is populated (app initialization)
 *
 * For cached settings (videoQuality, audioQuality, aiProvider, etc.),
 * prefer `getSettings()` or `getSettingCached(key)` from settings-store.js
 * which return synchronously from the hot cache.
 */
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

export async function saveEmbeddings(contentId, chunks) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('embeddings', 'readwrite');
    t.objectStore('embeddings').put({ contentId, chunks });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Get embeddings for a single entry. Not consumed at runtime — getAllEmbeddings() is used instead. Kept for future per-entry lookup. */
export async function getEmbeddings(contentId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('embeddings', 'readonly');
    const req = t.objectStore('embeddings').get(contentId);
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

export async function deleteEmbeddings(contentId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('embeddings', 'readwrite');
    t.objectStore('embeddings').delete(contentId);
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
 * Save or update vault sync status for a entry.
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
 * Get vault sync status for a entry by ID.
 * @param {string} id - Entry ID
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

/** Save an interaction to IDB. Called by entry-pipeline for PARTICIPATED_IN events. */
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

// --- Cascade Deletion Helpers ---
// Used by single-entry deletion to clean up associated data.

/**
 * Remove all interactions linked to an entry.
 * @param {string} entryId
 */
export async function removeInteractionsForEntry(entryId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('interactions', 'readwrite');
    const store = t.objectStore('interactions');
    const req = store.getAll();
    req.onsuccess = () => {
      for (const r of (req.result || [])) {
        if (r.contentId === entryId) store.delete(r.id);
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Remove all content items linked to an entry.
 * @param {string} entryId
 */
export async function removeContentItemsForEntry(entryId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('content_items', 'readwrite');
    const store = t.objectStore('content_items');
    const req = store.getAll();
    req.onsuccess = () => {
      for (const r of (req.result || [])) {
        if (r.sourceId === entryId) store.delete(r.id);
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Remove vault sync entry for an entry.
 * @param {string} entryId
 */
export async function removeVaultSync(entryId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('vaultSync', 'readwrite');
    t.objectStore('vaultSync').delete(entryId);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// --- Phase 16: Engagement Events ---

/** Save an engagement event to IDB. Written by entry-detail (VIEW/PLAY), consumed by closeness-worker. */
export async function saveEngagementEvent(event) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('engagement_events', 'readwrite');
    t.objectStore('engagement_events').put(event);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Get engagement events for a content item. */
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
 * @param {string} edge.sourceType - e.g. 'entry', 'contact', 'task'
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
 * Used when deleting a entry, contact, etc.
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

/**
 * Get all edges in the graph store.
 * @returns {Promise<Array>}
 */
export async function getAllEdges() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('edges', 'readonly');
    const req = t.objectStore('edges').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(t.error);
  });
}

// ── Step Checkpoints (Phase 2: Crash-Resistant Workflows) ────────────────────

/**
 * Save a step execution checkpoint.
 * Key format: `{contentId}:{taskIndex}` to allow per-task checkpointing.
 *
 * @param {object} checkpoint
 * @param {string} checkpoint.taskKey - `{contentId}:{taskIndex}`
 * @param {string} checkpoint.contentId
 * @param {number} checkpoint.taskIndex
 * @param {object[]} checkpoint.steps - Full step array with execution state
 * @param {object} [checkpoint.context] - Execution context snapshot (apiKey excluded)
 * @param {number} [checkpoint.updatedAt]
 */
export async function saveStepCheckpoint(checkpoint) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const record = { ...checkpoint, updatedAt: Date.now() };
    const t = db.transaction('step_checkpoints', 'readwrite');
    t.objectStore('step_checkpoints').put(record);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Get a step checkpoint by task key.
 * @param {string} taskKey - `{contentId}:{taskIndex}`
 * @returns {Promise<object|null>}
 */
export async function getStepCheckpoint(taskKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('step_checkpoints', 'readonly');
    const req = t.objectStore('step_checkpoints').get(taskKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(t.error);
  });
}

/**
 * Get all step checkpoints for an entry.
 * @param {string} contentId
 * @returns {Promise<object[]>}
 */
export async function getCheckpointsForEntry(contentId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('step_checkpoints', 'readonly');
    const idx = t.objectStore('step_checkpoints').index('contentId');
    const req = idx.getAll(contentId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(t.error);
  });
}

/**
 * Delete a step checkpoint after task completion.
 * @param {string} taskKey
 */
export async function deleteStepCheckpoint(taskKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('step_checkpoints', 'readwrite');
    t.objectStore('step_checkpoints').delete(taskKey);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Get all pending step checkpoints (for resuming after crash).
 * Returns checkpoints sorted by most recent first.
 * @returns {Promise<object[]>}
 */
export async function getAllPendingCheckpoints() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('step_checkpoints', 'readonly');
    const req = t.objectStore('step_checkpoints').getAll();
    req.onsuccess = () => {
      const results = (req.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(results);
    };
    req.onerror = () => reject(t.error);
  });
}

// --- Unified Node Store (App Platform: Graph Foundation) -----------------

/**
 * Save a node to the unified graph store.
 * @param {object} node - Node object with at least { id, type }
 * @returns {Promise<void>}
 */
export async function saveNode(node) {
  if (!node?.id) throw new Error('Node must have an id');
  node.updatedAt = Date.now();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('nodes', 'readwrite');
    t.objectStore('nodes').put(node);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Get a single node by ID.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getNode(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('nodes', 'readonly');
    const req = t.objectStore('nodes').get(id);
    req.onsuccess = () => resolve(req.result ? validateNode(req.result) : null);
    req.onerror = () => reject(t.error);
  });
}

/**
 * Get all nodes of a specific type.
 * @param {string} type - Node type key (e.g. 'entry', 'person')
 * @returns {Promise<object[]>}
 */
export async function getNodesByType(type) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('nodes', 'readonly');
    const idx = t.objectStore('nodes').index('type');
    const req = idx.getAll(type);
    req.onsuccess = () => resolve((req.result || []).map(validateNode).filter(Boolean));
    req.onerror = () => reject(t.error);
  });
}

/**
 * Delete a node by ID.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteNode(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('nodes', 'readwrite');
    t.objectStore('nodes').delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Get all nodes across all types.
 * @returns {Promise<object[]>}
 */
export async function getAllNodes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('nodes', 'readonly');
    const req = t.objectStore('nodes').getAll();
    req.onsuccess = () => resolve((req.result || []).map(validateNode).filter(Boolean));
    req.onerror = () => reject(t.error);
  });
}

// ── Batch Read Utility ───────────────────────────────────────────────────────

/**
 * Read from multiple IDB object stores in a single readonly transaction.
 * Reduces IDB overhead by batching sequential reads that would otherwise
 * each open their own transaction.
 *
 * @param {string[]} storeNames - Array of object store names to read from
 * @returns {Promise<Record<string, any[]>>} Object mapping store name → all records
 *
 * @example
 * const { entries, contacts, settings } = await batchRead(['entries', 'contacts', 'settings']);
 */
export async function batchRead(storeNames) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, 'readonly');
    const results = {};
    let remaining = storeNames.length;

    for (const name of storeNames) {
      const req = t.objectStore(name).getAll();
      req.onsuccess = () => {
        results[name] = req.result || [];
        remaining--;
        if (remaining === 0) resolve(results);
      };
    }

    t.onerror = () => reject(t.error);
  });
}

