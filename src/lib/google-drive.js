// Takus — Google Drive (resumable uploads + folder management)
import { GoogleAuth } from './google-auth.js';
import { getConfig } from './config.js';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

// Drive's query language requires single quotes inside string literals to be escaped with a backslash.
function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
      description: `Takus recording — ${new Date().toLocaleString()}`,
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
            // Token expired mid-upload — refresh and retry
            await this.auth.connect();
            await new Promise(r => setTimeout(r, 1500));
            retries++;
            continue;
          } else if (resp.status === 403) {
            let errText = '';
            try { errText = await resp.text(); } catch {}
            throw new Error(`Upload forbidden (403): ${errText || 'Insufficient permissions. Check your Google Drive API scopes.'}`);
          } else if (resp.status === 404) {
            throw new Error('Upload session expired. Please retry.');
          } else {
            let errText = '';
            try { errText = await resp.text(); } catch {}
            throw new Error(`Upload chunk failed (HTTP ${resp.status}): ${errText || 'Unknown server error'}`);
          }

          if (onProgress) onProgress(offset, blob.size);
          break; // Success — exit retry loop
        } catch (err) {
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
   * Syncs local configuration to Google Drive appDataFolder
   */
  async syncSettings(settingsObject) {
    await this.auth.loadAPI('drive', 'v3');
    
    // Check if config file exists
    const q = "name='takus_config.json' and spaces='appDataFolder'";
    const resp = await window.gapi.client.drive.files.list({ q, spaces: 'appDataFolder', fields: 'files(id)' });
    
    const fileMetadata = {
      name: 'takus_config.json',
      parents: ['appDataFolder']
    };
    
    const fileContent = JSON.stringify(settingsObject);
    const file = new Blob([fileContent], { type: 'application/json' });
    
    const token = await this.auth.ensureValidToken();
    
    if (resp.result.files.length > 0) {
      // Update existing
      const fileId = resp.result.files[0].id;
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: file
      });
    } else {
      // Create new
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }));
      form.append('file', file);
      
      await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form
      });
    }
  }

  /**
   * Fetches configuration from Google Drive appDataFolder
   */
  async fetchSettings() {
    await this.auth.loadAPI('drive', 'v3');
    const q = "name='takus_config.json' and spaces='appDataFolder'";
    const resp = await window.gapi.client.drive.files.list({ q, spaces: 'appDataFolder', fields: 'files(id)' });
    
    if (resp.result.files.length === 0) return null;
    
    const fileId = resp.result.files[0].id;
    const token = await this.auth.ensureValidToken();
    
    const fileResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!fileResp.ok) return null;
    return await fileResp.json();
  }
}
