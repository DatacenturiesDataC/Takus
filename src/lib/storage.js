// Takus — IndexedDB Storage (zero dependencies)

const DB_NAME = 'takus';
const DB_VERSION = 4;

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
      if (cursor) { results.push(cursor.value); cursor.continue(); }
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
    const t = db.transaction(['recordings', 'recovery', 'blobs', 'embeddings', 'wiki'], 'readwrite');
    t.objectStore('recordings').clear();
    t.objectStore('recovery').clear();
    t.objectStore('blobs').clear();
    t.objectStore('embeddings').clear();
    t.objectStore('wiki').clear();
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
      if (cursor) { results.push(cursor.value); cursor.continue(); }
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
    req.onerror = () => reject(req.error);
  });
}
