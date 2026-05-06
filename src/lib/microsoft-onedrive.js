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
            description: `Takus recording — ${new Date().toLocaleString()}`,
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
   * Syncs settings to OneDrive app folder.
   */
  async syncSettings(settingsObject) {
    const token = await this.auth.ensureValidToken();
    const content = JSON.stringify(settingsObject);

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

    if (!resp.ok) throw new Error(`OneDrive settings sync failed (HTTP ${resp.status})`);
  }

  /**
   * Fetches settings from OneDrive app folder.
   */
  async fetchSettings() {
    const token = await this.auth.ensureValidToken();

    const resp = await fetch(
      `${GRAPH_BASE}/me/drive/special/approot:/takus_config.json:/content`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!resp.ok) return null;
    return await resp.json();
  }
}
