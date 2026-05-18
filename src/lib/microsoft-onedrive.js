// Takus — Microsoft OneDrive (resumable uploads via Graph API)
// Mirrors GoogleDrive interface for the provider abstraction.

import { MicrosoftAuth } from './microsoft-auth.js';
import { getConfig } from './config.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const CHUNK_SIZE = 5 * 327_680; // 5 × 320 KiB = 1,638,400 bytes (must be 320 KiB multiple)

export class MicrosoftOneDrive {
  constructor() {
    this.auth = MicrosoftAuth.getInstance();
  }

  /**
   * Ensure a folder exists in OneDrive root.
   * @returns {string} Folder ID
   */
  async ensureFolder(folderName) {
    const token = await this.auth.ensureValidToken();

    // Check if folder exists
    const checkResp = await fetch(
      `${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(folderName)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (checkResp.ok) {
      const data = await checkResp.json();
      return data.id;
    }
    if (checkResp.status !== 404) {
      throw new Error(`OneDrive folder check failed (HTTP ${checkResp.status})`);
    }

    // Create folder
    const createResp = await fetch(`${GRAPH_BASE}/me/drive/root/children`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    });

    if (createResp.status === 409) {
      // Conflict — folder already exists (race condition), re-fetch
      const refetch = await fetch(
        `${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(folderName)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (refetch.ok) return (await refetch.json()).id;
    }

    if (!createResp.ok) {
      throw new Error(`OneDrive folder creation failed (HTTP ${createResp.status})`);
    }

    const folder = await createResp.json();
    return folder.id;
  }

  // ── Phase 9: VAULT — Structured folder management ────────────────────────

  /**
   * Ensure a deeply-nested folder path exists, creating intermediaries.
   * OneDrive Graph API supports path-based operations natively.
   * @param {string} path - Slash-separated path, e.g. 'Takus/entries/2026-05/abc123'
   * @returns {Promise<string>} Leaf folder ID
   */
  async ensureFolderPath(path) {
    const token = await this.auth.ensureValidToken();
    const segments = path.split('/').filter(Boolean);
    let currentPath = '';

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const encodedPath = currentPath.split('/').map(encodeURIComponent).join('/');

      // Check if folder exists
      const checkResp = await fetch(
        `${GRAPH_BASE}/me/drive/root:/${encodedPath}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (checkResp.ok) continue; // Folder exists

      if (checkResp.status === 404) {
        // Create folder in parent
        const parentPath = segments.slice(0, segments.indexOf(segment));
        const parentUrl = parentPath.length
          ? `${GRAPH_BASE}/me/drive/root:/${parentPath.map(encodeURIComponent).join('/')}:/children`
          : `${GRAPH_BASE}/me/drive/root/children`;

        const createResp = await fetch(parentUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: segment,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail',
          }),
        });

        // 409 = already exists (race condition) — safe to continue
        if (!createResp.ok && createResp.status !== 409) {
          const errText = await createResp.text().catch(() => '');
          throw new Error(`OneDrive folder creation failed (HTTP ${createResp.status}): ${errText}`);
        }
      } else {
        throw new Error(`OneDrive folder check failed (HTTP ${checkResp.status})`);
      }
    }

    // Return ID of the leaf folder
    const encodedFull = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const leafResp = await fetch(
      `${GRAPH_BASE}/me/drive/root:/${encodedFull}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!leafResp.ok) throw new Error('OneDrive: failed to resolve leaf folder ID');
    const leaf = await leafResp.json();
    return leaf.id;
  }

  /**
   * Upload a small file (< 4 MB) using simple PUT.
   * @param {string} parentPath - Drive path of the parent folder
   * @param {string} filename
   * @param {string|Blob} content
   * @param {string} mimeType
   * @returns {Promise<{fileId: string}>}
   */
  async uploadSmallFile(parentPath, filename, content, mimeType = 'application/json') {
    const token = await this.auth.ensureValidToken();
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const encodedPath = parentPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');

    const resp = await fetch(
      `${GRAPH_BASE}/me/drive/root:/${encodedPath}/${encodeURIComponent(filename)}:/content`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mimeType,
        },
        body: blob,
      }
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`OneDrive small file upload failed (HTTP ${resp.status}): ${errText}`);
    }

    const result = await resp.json();
    return { fileId: result.id };
  }

  /**
   * Upsert a small file by folder ID (not path).
   * Used by _syncAIArtefactsToCloud where we only have the folder ID.
   * PUT is naturally idempotent on OneDrive.
   */
  async upsertSmallFile(folderId, filename, content, mimeType = 'application/json') {
    const token = await this.auth.ensureValidToken();
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });

    const resp = await fetch(
      `${GRAPH_BASE}/me/drive/items/${folderId}:/${encodeURIComponent(filename)}:/content`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mimeType,
        },
        body: blob,
      }
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`OneDrive file upsert failed (HTTP ${resp.status}): ${errText}`);
    }

    const result = await resp.json();
    return { fileId: result.id };
  }

  /**
   * List files in a folder by path.
   * @param {string} folderPath - Drive path
   * @returns {Promise<Array<{id, name, file?, folder?}>>}
   */
  async listFolderContents(folderPath) {
    const token = await this.auth.ensureValidToken();
    const encodedPath = folderPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');

    const resp = await fetch(
      `${GRAPH_BASE}/me/drive/root:/${encodedPath}:/children?$select=id,name,file,folder`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!resp.ok) {
      if (resp.status === 404) return [];
      throw new Error(`OneDrive folder listing failed (HTTP ${resp.status})`);
    }

    const data = await resp.json();
    return data.value || [];
  }

  /**
   * Download a small text file's content by path.
   * @param {string} filePath - Full drive path
   * @returns {Promise<string>}
   */
  async downloadFileContent(filePath) {
    const token = await this.auth.ensureValidToken();
    const encodedPath = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');

    const resp = await fetch(
      `${GRAPH_BASE}/me/drive/root:/${encodedPath}:/content`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) throw new Error(`OneDrive file download failed (HTTP ${resp.status})`);
    return await resp.text();
  }

  /**
   * Phase 9 VAULT: Upload a full entry package to a structured folder.
   * Layout: Takus/entries/YYYY-MM/{entry_id}/
   *
   * @param {string} contentId
   * @param {Blob} blob
   * @param {object} entry
   * @param {Function} onProgress
   * @returns {Promise<{fileId: string, link: string, folderId: string}>}
   */
  async uploadContentPackage(contentId, blob, entry, onProgress) {
    const dateStr = new Date(entry.date).toISOString().slice(0, 7);
    const folderPath = `Takus/entries/${dateStr}/${contentId}`;

    // 1. Create the folder hierarchy
    const folderId = await this.ensureFolderPath(folderPath);

    // 2. Upload the video file (resumable)
    const result = await this._uploadToFolderPath(folderPath, blob, 'original.webm', onProgress);

    // 3. Upload companion artefacts (non-blocking)
    const artefactErrors = [];

    try {
      const metadata = {
        id: contentId,
        title: entry.title || 'Untitled',
        date: entry.date,
        duration: entry.duration || 0,
        size: blob.size,
        type: entry.type || 'screen',
        aiProvider: entry.aiProvider || null,
        participants: entry.participants || [],
        archiveStatus: 'active',
        version: 1,
      };
      await this.uploadSmallFile(folderPath, 'metadata.json', JSON.stringify(metadata, null, 2), 'application/json');
    } catch (e) {
      artefactErrors.push(`metadata.json: ${e.message}`);
    }

    if (entry.aiVtt) {
      try {
        await this.uploadSmallFile(folderPath, 'transcript.vtt', entry.aiVtt, 'text/vtt');
      } catch (e) {
        artefactErrors.push(`transcript.vtt: ${e.message}`);
      }
    }

    if (entry.aiSummary) {
      try {
        await this.uploadSmallFile(folderPath, 'summary.md', entry.aiSummary, 'text/markdown');
      } catch (e) {
        artefactErrors.push(`summary.md: ${e.message}`);
      }
    }

    if (artefactErrors.length) {
      console.warn('[Vault] Some artefacts failed to upload:', artefactErrors);
    }

    return { fileId: result.fileId, link: result.link, folderId };
  }

  /**
   * Internal: resumable upload of a blob into a folder by path.
   */
  async _uploadToFolderPath(folderPath, blob, filename, onProgress) {
    const token = await this.auth.ensureValidToken();
    const encodedPath = folderPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');

    // Create upload session
    const sessionResp = await fetch(
      `${GRAPH_BASE}/me/drive/root:/${encodedPath}/${encodeURIComponent(filename)}:/createUploadSession`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item: {
            '@microsoft.graph.conflictBehavior': 'rename',
            name: filename,
            description: `Takus entry — ${new Date().toLocaleString()}`,
          },
        }),
      }
    );

    if (!sessionResp.ok) {
      const errText = await sessionResp.text().catch(() => '');
      throw new Error(`OneDrive upload session failed (HTTP ${sessionResp.status}): ${errText}`);
    }

    const session = await sessionResp.json();
    const uploadUrl = session.uploadUrl;

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
          const resp = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': String(end - offset),
              'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}`,
            },
            body: chunk,
          });

          if (resp.status === 200 || resp.status === 201) {
            const result = await resp.json();
            fileId = result.id;
            offset = blob.size;
          } else if (resp.status === 202) {
            const progress = await resp.json();
            const ranges = progress.nextExpectedRanges?.[0];
            offset = ranges ? parseInt(ranges.split('-')[0], 10) : end;
          } else if (resp.status === 401) {
            await this.auth.ensureValidToken();
            retries++;
            continue;
          } else if (resp.status === 404 || resp.status === 409) {
            throw new Error('OneDrive upload session expired or conflict. Please retry.');
          } else {
            const errText = await resp.text().catch(() => '');
            throw new Error(`OneDrive upload chunk failed (HTTP ${resp.status}): ${errText}`);
          }

          if (onProgress) onProgress(offset, blob.size);
          break;
        } catch (err) {
          retries++;
          if (retries > maxRetries) throw err;
          await new Promise(r => setTimeout(r, 1000 * retries));
        }
      }
    }

    if (!fileId) throw new Error('OneDrive upload completed but no file ID returned');

    // Create sharing link
    let link = '';
    try {
      const currentToken = await this.auth.ensureValidToken();
      const shareResp = await fetch(`${GRAPH_BASE}/me/drive/items/${fileId}/createLink`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'view', scope: 'anonymous' }),
      });
      if (shareResp.ok) {
        const shareData = await shareResp.json();
        link = shareData.link?.webUrl || `https://onedrive.live.com/?id=${fileId}`;
      } else {
        link = `https://onedrive.live.com/?id=${fileId}`;
      }
    } catch {
      link = `https://onedrive.live.com/?id=${fileId}`;
    }

    return { fileId, link };
  }

  /**
   * Resumable upload with progress via Graph upload session.
   * @param {Blob} blob - File data
   * @param {string} filename
   * @param {Function} onProgress - (loaded, total) => void
   * @returns {Promise<{fileId: string, link: string}>}
   */
  async uploadResumable(blob, filename, onProgress) {
    const token = await this.auth.ensureValidToken();
    const cfg = getConfig();

    // Ensure destination folder
    let folderId;
    try {
      folderId = await this.ensureFolder(cfg.drive.folderName);
    } catch (e) {
      throw new Error(`OneDrive folder setup failed: ${e.message}`);
    }

    // Create upload session
    const sessionResp = await fetch(
      `${GRAPH_BASE}/me/drive/items/${folderId}:/${encodeURIComponent(filename)}:/createUploadSession`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item: {
            '@microsoft.graph.conflictBehavior': 'rename',
            name: filename,
            description: `Takus entry — ${new Date().toLocaleString()}`,
          },
        }),
      }
    );

    if (!sessionResp.ok) {
      const errText = await sessionResp.text().catch(() => '');
      throw new Error(`OneDrive upload session failed (HTTP ${sessionResp.status}): ${errText}`);
    }

    const session = await sessionResp.json();
    const uploadUrl = session.uploadUrl;

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
          const resp = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': String(end - offset),
              'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}`,
            },
            body: chunk,
          });

          if (resp.status === 200 || resp.status === 201) {
            // Upload complete
            const result = await resp.json();
            fileId = result.id;
            offset = blob.size;
          } else if (resp.status === 202) {
            // Accepted — more chunks needed
            const progress = await resp.json();
            const ranges = progress.nextExpectedRanges?.[0];
            if (ranges) {
              offset = parseInt(ranges.split('-')[0], 10);
            } else {
              offset = end;
            }
          } else if (resp.status === 401) {
            await this.auth.ensureValidToken();
            retries++;
            continue;
          } else if (resp.status === 404 || resp.status === 409) {
            throw new Error('OneDrive upload session expired or conflict. Please retry.');
          } else {
            const errText = await resp.text().catch(() => '');
            throw new Error(`OneDrive upload chunk failed (HTTP ${resp.status}): ${errText}`);
          }

          if (onProgress) onProgress(offset, blob.size);
          break;
        } catch (err) {
          retries++;
          if (retries > maxRetries) throw err;
          await new Promise(r => setTimeout(r, 1000 * retries));
        }
      }
    }

    if (!fileId) throw new Error('OneDrive upload completed but no file ID returned');

    // Create sharing link
    let link = '';
    try {
      const currentToken = await this.auth.ensureValidToken();
      const shareResp = await fetch(`${GRAPH_BASE}/me/drive/items/${fileId}/createLink`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'view', scope: 'anonymous' }),
      });
      if (shareResp.ok) {
        const shareData = await shareResp.json();
        link = shareData.link?.webUrl || `https://onedrive.live.com/?id=${fileId}`;
      } else {
        // Sharing may be restricted by org policy — fall back to direct link
        link = `https://onedrive.live.com/?id=${fileId}`;
      }
    } catch {
      link = `https://onedrive.live.com/?id=${fileId}`;
    }

    return { fileId, link };
  }

  /**
   * Syncs settings to OneDrive.
   * Phase 9b: Dual-write to both visible Takus/settings/ path
   * and legacy approot for backward compatibility.
   */
  async syncSettings(settingsObject) {
    const token = await this.auth.ensureValidToken();
    const content = JSON.stringify(settingsObject);

    // 1. Write to visible Takus/settings/preferences.json (Phase 9)
    try {
      await this.uploadSmallFile('Takus/settings', 'preferences.json', content, 'application/json');
    } catch (e) {
      console.warn('[Vault] OneDrive settings sync to Takus/settings/ failed:', e.message);
    }

    // 2. Legacy: write to approot
    try {
      const resp = await fetch(
        `${GRAPH_BASE}/me/drive/special/approot:/takus_config.json:/content`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: content,
        }
      );
      if (!resp.ok) console.warn(`[Vault] Legacy settings sync failed (HTTP ${resp.status})`);
    } catch (e) {
      console.warn('[Vault] Legacy settings sync failed:', e.message);
    }
  }

  /**
   * Fetches settings from OneDrive.
   * Phase 9b: Tries visible path first, falls back to legacy approot.
   */
  async fetchSettings() {
    const token = await this.auth.ensureValidToken();

    // 1. Try Takus/settings/preferences.json (Phase 9)
    try {
      const content = await this.downloadFileContent('Takus/settings/preferences.json');
      if (content) return JSON.parse(content);
    } catch {
      // Folder or file doesn't exist yet — fall through to legacy
    }

    // 2. Legacy: approot
    try {
      const resp = await fetch(
        `${GRAPH_BASE}/me/drive/special/approot:/takus_config.json:/content`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }
}
