// Takus — IndexedDB Storage (zero dependencies)

const DB_NAME = 'takus';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('recordings')) {
        const store = db.createObjectStore('recordings', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('recovery')) {
        db.createObjectStore('recovery', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      // If the connection drops (e.g. quota exceeded, user clears storage),
      // invalidate the cache so the next operation reconnects.
      _db.onclose = () => { _db = null; };
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
    // Wipe both history and any in-progress recovery snapshot in one transaction
    // — otherwise "Clear all" leaves crash-recovery data intact and surprises
    // the user on next reload.
    const t = db.transaction(['recordings', 'recovery'], 'readwrite');
    t.objectStore('recordings').clear();
    t.objectStore('recovery').clear();
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
