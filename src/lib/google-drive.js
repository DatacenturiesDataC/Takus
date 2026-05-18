// Takus — Google Drive (resumable uploads + folder management)
import { GoogleAuth } from './google-auth.js';
import { getConfig } from './config.js';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

// Drive's query language requires single quotes inside string literals to be escaped with a backslash.
function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Marker error for HTTP responses that should not be retried (auth/permission/
 * non-existent session). Raising this signals the retry loop to bail immediately.
 */
class FatalUploadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FatalUploadError';
    this.fatal = true;
  }
}

/**
 * Extracts a human-readable error message from various error shapes
 * (gapi errors, fetch errors, standard Error objects).
 */
function extractErrorMessage(err) {
  if (!err) return 'Unknown error';
  // gapi-style error: { result: { error: { message: '...' } } }
  if (err?.result?.error?.message) return err.result.error.message;
  // gapi-style: { error: { message: '...' } }
  if (err?.error?.message) return err.error.message;
  // gapi-style short form: { error: 'access_denied' }
  if (typeof err?.error === 'string') return err.error;
  // Standard Error
  if (err?.message) return err.message;
  // String fallback
  if (typeof err === 'string') return err;
  return String(err);
}

export class GoogleDrive {
  constructor() {
    this.auth = GoogleAuth.getInstance();
    /** @type {Map<string, string>} Caches folder-path → id for the session */
    this._folderCache = new Map();
  }

  async ensureFolder(folderName) {
    try {
      await this.auth.loadAPI('drive', 'v3');
    } catch (loadErr) {
      throw new Error(`Drive API load failed: ${extractErrorMessage(loadErr)}`);
    }

    const safeName = escapeDriveQuery(folderName);
    const q = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    let resp;
    try {
      resp = await window.gapi.client.drive.files.list({ q, spaces: 'drive', fields: 'files(id,name)' });
    } catch (listErr) {
      throw new Error(`Drive folder lookup failed: ${extractErrorMessage(listErr)}`);
    }

    if (resp.result.files.length > 0) return resp.result.files[0].id;

    try {
      const create = await window.gapi.client.drive.files.create({
        resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id',
      });
      return create.result.id;
    } catch (createErr) {
      throw new Error(`Drive folder creation failed: ${extractErrorMessage(createErr)}`);
    }
  }

  // ── Phase 9: VAULT — Structured folder management ────────────────────────

  /**
   * Ensure a single subfolder exists within a parent folder.
   * @param {string} parentId - Parent folder ID ('root' for Drive root)
   * @param {string} folderName - Name of the subfolder
   * @returns {Promise<string>} Folder ID
   */
  async ensureFolderInParent(parentId, folderName) {
    await this.auth.loadAPI('drive', 'v3');

    const safeName = escapeDriveQuery(folderName);
    const parentFilter = parentId === 'root'
      ? "'root' in parents and "
      : `'${escapeDriveQuery(parentId)}' in parents and `;
    const q = `${parentFilter}name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const resp = await window.gapi.client.drive.files.list({
      q, spaces: 'drive', fields: 'files(id,name)',
    });

    if (resp.result.files.length > 0) return resp.result.files[0].id;

    const create = await window.gapi.client.drive.files.create({
      resource: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId === 'root' ? [] : [parentId],
      },
      fields: 'id',
    });
    return create.result.id;
  }

  /**
   * Ensure a deeply-nested folder path exists, creating intermediaries.
   * Uses session-level caching to avoid redundant lookups.
   * @param {string} path - Slash-separated path, e.g. 'Takus/entries/2026-05/abc123'
   * @returns {Promise<string>} Leaf folder ID
   */
  async ensureFolderPath(path) {
    if (this._folderCache.has(path)) return this._folderCache.get(path);

    const segments = path.split('/').filter(Boolean);
    let parentId = 'root';
    let builtPath = '';

    for (const segment of segments) {
      builtPath = builtPath ? `${builtPath}/${segment}` : segment;
      if (this._folderCache.has(builtPath)) {
        parentId = this._folderCache.get(builtPath);
        continue;
      }
      parentId = await this.ensureFolderInParent(parentId, segment);
      this._folderCache.set(builtPath, parentId);
    }
    return parentId;
  }

  /**
   * Upload a small file (< 5 MB) using multipart upload.
   * Used for metadata.json, summary.md, transcript.vtt.
   * @param {string} parentId - Target folder ID
   * @param {string} filename - File name
   * @param {string|Blob} content - File content
   * @param {string} mimeType - MIME type
   * @returns {Promise<{fileId: string}>}
   */
  async uploadSmallFile(parentId, filename, content, mimeType = 'application/json') {
    const token = await this.auth.ensureValidToken();
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });

    const metadata = {
      name: filename,
      parents: [parentId],
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Small file upload failed (HTTP ${resp.status}): ${errText}`);
    }

    const result = await resp.json();
    return { fileId: result.id };
  }

  /**
   * Upsert a small file: update if it exists in the folder, create if not.
   * Prevents duplicate files when re-uploading AI artefacts.
   */
  async upsertSmallFile(parentId, filename, content, mimeType = 'application/json') {
    const token = await this.auth.ensureValidToken();

    // Check if file already exists
    await this.auth.loadAPI('drive', 'v3');
    const safeParent = escapeDriveQuery(parentId);
    const safeName = escapeDriveQuery(filename);
    const q = `'${safeParent}' in parents and name='${safeName}' and trashed=false`;
    const existing = await window.gapi.client.drive.files.list({
      q, spaces: 'drive', fields: 'files(id)',
    });

    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });

    if (existing.result.files?.length > 0) {
      // Update existing file
      const fileId = existing.result.files[0].id;
      const resp = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mimeType,
        },
        body: blob,
      });
      if (!resp.ok) throw new Error(`File update failed (HTTP ${resp.status})`);
      return { fileId };
    }

    // Create new file
    return this.uploadSmallFile(parentId, filename, content, mimeType);
  }

  /**
   * List files in a folder path.
   * @param {string} folderId - Folder ID to list
   * @returns {Promise<Array<{id, name, mimeType}>>}
   */
  async listFolderContents(folderId) {
    await this.auth.loadAPI('drive', 'v3');
    const safeFolderId = escapeDriveQuery(folderId);
    const q = `'${safeFolderId}' in parents and trashed=false`;
    const resp = await window.gapi.client.drive.files.list({
      q, spaces: 'drive', fields: 'files(id,name,mimeType)',
    });
    return resp.result.files || [];
  }

  /**
   * Download a small text file's content by ID.
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async downloadFileContent(fileId) {
    const token = await this.auth.ensureValidToken();
    const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`File download failed (HTTP ${resp.status})`);
    return await resp.text();
  }

  /**
   * Phase 9 VAULT: Upload a full entry package to a structured folder.
   * Layout: Takus/entries/YYYY-MM/{recording_id}/
   *   ├── original.webm
   *   ├── transcript.vtt   (if available)
   *   ├── summary.md       (if available)
   *   └── metadata.json
   *
   * @param {string} contentId - Unique entry ID
   * @param {Blob} blob - Recording blob
   * @param {object} historyEntry - Full history entry from IndexedDB
   * @param {Function} onProgress - (loaded, total) => void
   * @returns {Promise<{fileId: string, link: string, folderId: string}>}
   */
  async uploadRecordingPackage(contentId, blob, historyEntry, onProgress) {
    const dateStr = new Date(historyEntry.date).toISOString().slice(0, 7); // YYYY-MM
    const folderPath = `Takus/entries/${dateStr}/${contentId}`;

    // 1. Create the folder hierarchy
    const folderId = await this.ensureFolderPath(folderPath);

    // 2. Upload the video file (resumable, same as legacy)
    const result = await this._uploadToFolder(folderId, blob, 'original.webm', onProgress);

    // 3. Upload companion artefacts (non-blocking — failures logged but don't block)
    const artefactErrors = [];

    // metadata.json
    try {
      const metadata = {
        id: contentId,
        title: historyEntry.title || 'Untitled',
        date: historyEntry.date,
        duration: historyEntry.duration || 0,
        size: blob.size,
        type: historyEntry.type || 'screen',
        aiProvider: historyEntry.aiProvider || null,
        participants: historyEntry.participants || [],
        archiveStatus: 'active',
        version: 1,
      };
      await this.uploadSmallFile(folderId, 'metadata.json', JSON.stringify(metadata, null, 2), 'application/json');
    } catch (e) {
      artefactErrors.push(`metadata.json: ${e.message}`);
    }

    // transcript.vtt
    if (historyEntry.aiVtt) {
      try {
        await this.uploadSmallFile(folderId, 'transcript.vtt', historyEntry.aiVtt, 'text/vtt');
      } catch (e) {
        artefactErrors.push(`transcript.vtt: ${e.message}`);
      }
    }

    // summary.md
    if (historyEntry.aiSummary) {
      try {
        await this.uploadSmallFile(folderId, 'summary.md', historyEntry.aiSummary, 'text/markdown');
      } catch (e) {
        artefactErrors.push(`summary.md: ${e.message}`);
      }
    }

    if (artefactErrors.length) {
      console.warn('[Vault] Some artefacts failed to upload:', artefactErrors);
    }

    return {
      fileId: result.fileId,
      link: result.link,
      folderId,
    };
  }

  /**
   * Internal: resumable upload of a blob into a specific folder.
   * (Factored from uploadResumable to support both legacy and VAULT paths.)
   */
  async _uploadToFolder(folderId, blob, filename, onProgress) {
    let token = await this.auth.ensureValidToken();

    const metadata = {
      name: filename,
      parents: [folderId],
      description: `Takus entry — ${new Date().toLocaleString()}`,
    };

    // Initiate resumable session
    const initResp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': blob.type || 'video/webm',
        'X-Upload-Content-Length': blob.size,
      },
      body: JSON.stringify(metadata),
    });

    if (!initResp.ok) {
      let errBody = '';
      try { errBody = await initResp.text(); } catch {}
      let detail = errBody;
      try { detail = JSON.parse(errBody)?.error?.message || errBody; } catch {}
      throw new Error(`Upload init failed (HTTP ${initResp.status}): ${detail}`);
    }

    const sessionUri = initResp.headers.get('Location');
    if (!sessionUri) throw new Error('No session URI returned from Google Drive');

    // Upload in chunks
    let offset = 0;
    let fileId = null;

    while (offset < blob.size) {
      const end = Math.min(offset + CHUNK_SIZE, blob.size);
      const chunk = blob.slice(offset, end);

      let retries = 0;
      const maxRetries = 3;

      while (retries <= maxRetries) {
        try {
          const currentToken = await this.auth.ensureValidToken();
          const resp = await fetch(sessionUri, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${currentToken}`,
              'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}`,
            },
            body: chunk,
          });

          if (resp.status === 200 || resp.status === 201) {
            const result = await resp.json();
            fileId = result.id;
            offset = blob.size;
          } else if (resp.status === 308) {
            const range = resp.headers.get('Range');
            offset = range ? parseInt(range.split('-')[1], 10) + 1 : end;
          } else if (resp.status === 401) {
            await this.auth.ensureValidToken();
            retries++;
            continue;
          } else if (resp.status === 403) {
            let errText = '';
            try { errText = await resp.text(); } catch {}
            throw new FatalUploadError(`Upload forbidden (403): ${errText || 'Insufficient permissions.'}`);
          } else if (resp.status === 404 || resp.status === 410) {
            throw new FatalUploadError('Upload session expired. Please retry.');
          } else if (resp.status >= 400 && resp.status < 500) {
            let errText = '';
            try { errText = await resp.text(); } catch {}
            throw new FatalUploadError(`Upload chunk failed (HTTP ${resp.status}): ${errText || 'Client error'}`);
          } else {
            let errText = '';
            try { errText = await resp.text(); } catch {}
            throw new Error(`Upload chunk failed (HTTP ${resp.status}): ${errText || 'Unknown server error'}`);
          }

          if (onProgress) onProgress(offset, blob.size);
          break;
        } catch (err) {
          if (err && err.fatal) throw err;
          retries++;
          if (retries > maxRetries) throw err;
          await new Promise(r => setTimeout(r, 1000 * retries));
        }
      }
    }

    if (!fileId) throw new Error('Upload completed but no file ID returned');
    return { fileId, link: `https://drive.google.com/file/d/${fileId}/view` };
  }

  /**
   * Resumable upload with progress.
   * @param {Blob} blob - file data
   * @param {string} filename
   * @param {Function} onProgress - (loaded, total) => void
   * @returns {Promise<{fileId, link}>}
   */
  async uploadResumable(blob, filename, onProgress) {
    let token;
    try {
      token = await this.auth.ensureValidToken();
    } catch (tokenErr) {
      throw new Error(`Authentication failed: ${extractErrorMessage(tokenErr)}. Please reconnect Google Drive.`);
    }

    const cfg = getConfig();

    let folderId;
    try {
      folderId = await this.ensureFolder(cfg.drive.folderName);
    } catch (folderErr) {
      throw new Error(`Folder setup failed: ${extractErrorMessage(folderErr)}`);
    }

    const metadata = {
      name: filename,
      parents: folderId ? [folderId] : [],
      description: `Takus entry — ${new Date().toLocaleString()}`,
    };

    // Step 1: Initiate resumable session
    let initResp;
    try {
      initResp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': blob.type || 'video/webm',
          'X-Upload-Content-Length': blob.size,
        },
        body: JSON.stringify(metadata),
      });
    } catch (fetchErr) {
      throw new Error(`Network error starting upload: ${extractErrorMessage(fetchErr)}`);
    }

    if (!initResp.ok) {
      let errBody = '';
      try { errBody = await initResp.text(); } catch {}
      // Try to parse JSON error
      let detail = errBody;
      try {
        const parsed = JSON.parse(errBody);
        detail = parsed?.error?.message || errBody;
      } catch {}
      throw new Error(`Upload init failed (HTTP ${initResp.status}): ${detail}`);
    }

    const sessionUri = initResp.headers.get('Location');
    if (!sessionUri) throw new Error('No session URI returned from Google Drive');

    // Step 2: Upload in chunks
    let offset = 0;
    let fileId = null;

    while (offset < blob.size) {
      const end = Math.min(offset + CHUNK_SIZE, blob.size);
      const chunk = blob.slice(offset, end);
      const isLast = end === blob.size;

      let retries = 0;
      const maxRetries = 3;

      while (retries <= maxRetries) {
        try {
          // Refresh token if needed before each chunk
          const currentToken = await this.auth.ensureValidToken();

          const resp = await fetch(sessionUri, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${currentToken}`,
              'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}`,
            },
            body: chunk,
          });

          if (resp.status === 200 || resp.status === 201) {
            // Upload complete
            const result = await resp.json();
            fileId = result.id;
            offset = blob.size;
          } else if (resp.status === 308) {
            // Resume Incomplete — next chunk
            const range = resp.headers.get('Range');
            if (range) {
              offset = parseInt(range.split('-')[1], 10) + 1;
            } else {
              offset = end;
            }
          } else if (resp.status === 401) {
            // Token expired mid-upload — refresh using the promise-based method
            try {
              await this.auth.ensureValidToken();
            } catch (refreshErr) {
              throw new Error(`Token expired during upload: ${extractErrorMessage(refreshErr)}`);
            }
            retries++;
            continue;
          } else if (resp.status === 403) {
            let errText = '';
            try { errText = await resp.text(); } catch {}
            throw new FatalUploadError(`Upload forbidden (403): ${errText || 'Insufficient permissions. Check your Google Drive API scopes.'}`);
          } else if (resp.status === 404 || resp.status === 410) {
            throw new FatalUploadError('Upload session expired. Please retry.');
          } else if (resp.status >= 400 && resp.status < 500) {
            // Other client errors: most likely permanent (400 bad request, 405, etc.).
            // Don't burn retries on them.
            let errText = '';
            try { errText = await resp.text(); } catch {}
            throw new FatalUploadError(`Upload chunk failed (HTTP ${resp.status}): ${errText || 'Client error'}`);
          } else {
            // 5xx and unexpected — retryable
            let errText = '';
            try { errText = await resp.text(); } catch {}
            throw new Error(`Upload chunk failed (HTTP ${resp.status}): ${errText || 'Unknown server error'}`);
          }

          if (onProgress) onProgress(offset, blob.size);
          break; // Success — exit retry loop
        } catch (err) {
          // Fatal errors (auth, expired session, 4xx) skip retries entirely.
          if (err && err.fatal) throw err;
          retries++;
          if (retries > maxRetries) throw err;
          await new Promise(r => setTimeout(r, 1000 * retries)); // Exponential backoff
        }
      }
    }

    if (!fileId) throw new Error('Upload completed but no file ID returned');

    // Set sharing permissions if configured
    if (cfg.drive.makePublic) {
      try {
        await this.auth.loadAPI('drive', 'v3');
        await window.gapi.client.drive.permissions.create({
          fileId,
          resource: { role: 'reader', type: 'anyone' },
        });
      } catch (e) {
        console.warn('[Drive] Could not set sharing:', e);
      }
    }

    return {
      fileId,
      link: `https://drive.google.com/file/d/${fileId}/view`,
    };
  }

  /**
   * Syncs local configuration to Google Drive.
   * Phase 9b: Dual-write to both the visible Takus/settings/ folder
   * and the legacy appDataFolder for backward compatibility.
   */
  async syncSettings(settingsObject) {
    await this.auth.loadAPI('drive', 'v3');
    const fileContent = JSON.stringify(settingsObject);
    const file = new Blob([fileContent], { type: 'application/json' });
    const token = await this.auth.ensureValidToken();

    // 1. Write to visible Takus/settings/preferences.json (Phase 9)
    try {
      const settingsFolderId = await this.ensureFolderPath('Takus/settings');
      // Check if preferences.json already exists in the folder
      const files = await this.listFolderContents(settingsFolderId);
      const existing = files.find(f => f.name === 'preferences.json');

      if (existing) {
        // Update existing
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: file,
        });
      } else {
        // Create new
        await this.uploadSmallFile(settingsFolderId, 'preferences.json', fileContent, 'application/json');
      }
    } catch (e) {
      console.warn('[Vault] Settings sync to Takus/settings/ failed:', e.message);
    }

    // 2. Legacy: write to appDataFolder (backward compat)
    try {
      const q = "name='takus_config.json'";
      const resp = await window.gapi.client.drive.files.list({ q, spaces: 'appDataFolder', fields: 'files(id)' });

      const fileMetadata = { name: 'takus_config.json', parents: ['appDataFolder'] };

      if (resp.result.files.length > 0) {
        const fileId = resp.result.files[0].id;
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: file,
        });
      } else {
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }));
        form.append('file', file);
        await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
      }
    } catch (e) {
      console.warn('[Vault] Legacy settings sync failed:', e.message);
    }
  }

  /**
   * Fetches configuration from Google Drive.
   * Phase 9b: Tries visible path first, falls back to legacy appDataFolder.
   */
  async fetchSettings() {
    const token = await this.auth.ensureValidToken();

    // 1. Try Takus/settings/preferences.json (Phase 9)
    try {
      const content = await this.downloadFileContent(
        await this._resolveFileInPath('Takus/settings', 'preferences.json')
      );
      if (content) return JSON.parse(content);
    } catch {
      // Folder or file doesn't exist yet — fall through to legacy
    }

    // 2. Legacy: appDataFolder
    try {
      await this.auth.loadAPI('drive', 'v3');
      const q = "name='takus_config.json'";
      const resp = await window.gapi.client.drive.files.list({ q, spaces: 'appDataFolder', fields: 'files(id)' });

      if (resp.result.files.length === 0) return null;

      const fileId = resp.result.files[0].id;
      const fileResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!fileResp.ok) return null;
      return await fileResp.json();
    } catch {
      return null;
    }
  }

  /**
   * Internal: resolve a file ID within a folder path.
   * @param {string} folderPath - e.g. 'Takus/settings'
   * @param {string} filename - e.g. 'preferences.json'
   * @returns {Promise<string>} File ID
   */
  async _resolveFileInPath(folderPath, filename) {
    const folderId = await this.ensureFolderPath(folderPath);
    const files = await this.listFolderContents(folderId);
    const match = files.find(f => f.name === filename);
    if (!match) throw new Error(`File ${filename} not found in ${folderPath}`);
    return match.id;
  }
}
