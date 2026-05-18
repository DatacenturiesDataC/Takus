// Takus — Upload Manager (extracted from app-shell.js)
// Handles cloud upload, local download, and format conversion (MP4/GIF).

import { convertToMP4, convertToGIF } from './ffmpeg-engine.js';
import { notifyEphemeral } from './notification-manager.js';
import { enqueue } from './offline-queue.js';
import { trackUpload, updateUploadProgress, markConverting, completeUpload, failUpload, retryUpload as trackRetry } from './upload-tracker.js';

/**
 * Download a blob to the local filesystem.
 * @param {Blob}   blob     The media blob
 * @param {string} filename The target filename
 */
export function downloadLocal(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Convert a media blob to MP4 and trigger download.
 * Shows a toast notification for conversion progress.
 * @param {Blob}   blob     The original WebM media blob
 * @param {string} filename The target filename (with .webm extension)
 */
export async function downloadMP4(blob, filename) {
  if (!blob) return;
  const trackId = filename.replace('.webm', '');
  markConverting(trackId, 'mp4');
  notifyEphemeral('Converting to MP4', 'This may take a moment depending on entry length.', 'info');
  try {
    const mp4Blob = await convertToMP4(blob);
    downloadLocal(mp4Blob, filename.replace('.webm', '.mp4'));
  } catch (e) {
    console.error('[Upload] MP4 conversion failed:', e);
    failUpload(trackId, e.message || 'MP4 conversion failed');
    notifyEphemeral('MP4 conversion failed', e.message || 'Check your connection and try again.', 'error');
  }
}

/**
 * Convert a media blob to GIF and trigger download.
 * Shows a toast notification for conversion progress.
 * @param {Blob}   blob     The original WebM media blob
 * @param {string} filename The target filename (with .webm extension)
 */
export async function downloadGIF(blob, filename) {
  if (!blob) return;
  const trackId = filename.replace('.webm', '');
  markConverting(trackId, 'gif');
  notifyEphemeral('Converting to GIF', 'This may take a moment depending on entry length.', 'info');
  try {
    const gifBlob = await convertToGIF(blob);
    downloadLocal(gifBlob, filename.replace('.webm', '.gif'));
  } catch (e) {
    console.error('[Upload] GIF conversion failed:', e);
    failUpload(trackId, e.message || 'GIF conversion failed');
    notifyEphemeral('GIF conversion failed', e.message || 'Check your connection and try again.', 'error');
  }
}

/**
 * Retry wrapper with exponential backoff.
 * Retries on network/transient errors only (not 4xx client errors).
 *
 * @param {Function} fn        Async function to retry
 * @param {object}   options
 * @param {number}   options.maxRetries  Default 3
 * @param {number}   options.baseMs      Initial delay (default 1000ms)
 * @param {Function} options.onRetry     Called with (attempt, error) before each retry
 * @returns {Promise}
 */
export async function withRetry(fn, options = {}) {
  const { maxRetries = 3, baseMs = 1000, onRetry } = options;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastError = e;

      // Don't retry client errors (4xx) — these won't succeed on retry
      if (e.status >= 400 && e.status < 500) throw e;

      if (attempt < maxRetries) {
        const delay = baseMs * Math.pow(2, attempt) + Math.random() * 500;
        if (onRetry) onRetry(attempt + 1, e);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Upload a blob with automatic retry on transient failure.
 *
 * @param {Function} uploadFn  The provider's upload function (blob, filename, onProgress) → result
 * @param {Blob}     blob
 * @param {string}   filename
 * @param {Function} onProgress
 * @returns {Promise<object>}  The upload result
 */
export async function retryableUpload(uploadFn, blob, filename, onProgress) {
  const trackId = filename.replace('.webm', '');
  trackUpload(trackId, filename, blob?.size || 0);
  return withRetry(
    (attempt) => {
      if (attempt > 0) {
        trackRetry(trackId, attempt);
        notifyEphemeral('Retrying upload', `Attempt ${attempt + 1} of 4…`, 'info');
      }
      return uploadFn(blob, filename, (loaded, total) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        updateUploadProgress(trackId, pct);
        onProgress?.(loaded, total);
      });
    },
    {
      maxRetries: 3,
      baseMs: 1000,
      onRetry: (attempt, error) => {
        console.warn(`[Upload] Attempt ${attempt} failed:`, error.message);
      },
    }
  );
}

/**
 * Upload a media blob to the cloud provider.
 * Extracted from AppShell._doUpload — handles the full upload lifecycle:
 * provider selection, vault sync, calendar integration, and link copy.
 *
 * @param {object} params
 * @param {Blob}     params.blob - Recording blob
 * @param {string}   params.filename - Target filename (e.g., 'rec_xxx.webm')
 * @param {object}   params.historyEntry - History entry to update with drive link
 * @param {object}   params.provider - Cloud provider instance (auth, storage, calendar)
 * @param {object}   [params.context] - Recording context
 * @param {string}   [params.context.contentType] - 'meeting', 'screen', etc.
 * @param {number}   [params.context.recordingStartTime] - Start timestamp for calendar matching
 * @param {object}   callbacks
 * @param {function} callbacks.onProgress - Called with (loaded, total) during upload
 * @param {function} [callbacks.onCalendarLinked] - Called with (event, attendees)
 * @returns {Promise<{ link: string, folderId?: string, calendarEvent?: object, participants?: Array }>}
 * @throws {Error} On upload failure or timeout
 */
export async function uploadToCloud({ blob, filename, historyEntry, provider, context = {} }, callbacks = {}) {
  if (!blob) throw new Error('No blob to upload');
  if (!provider) throw new Error('No cloud provider connected');

  const { saveEntry, saveVaultSync } = await import('./storage.js');
  const { getSettings } = await import('./settings-store.js');
  const { getConfig } = await import('./config.js');

  // 15-minute timeout for very large entries
  const deadline = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Upload timed out after 15 minutes. Check your connection and try again.')), 15 * 60 * 1000)
  );

  // Vault vs legacy upload
  const useVault = typeof provider.storage.uploadRecordingPackage === 'function';

  const result = await Promise.race([
    useVault
      ? provider.storage.uploadRecordingPackage(
          historyEntry?.id || filename.replace('.webm', ''),
          blob,
          historyEntry || { date: Date.now(), title: filename },
          callbacks.onProgress
        )
      : provider.storage.uploadResumable(blob, filename, callbacks.onProgress),
    deadline,
  ]);

  const output = { link: result.link, folderId: result.folderId || null };

  // Notify upload tracker of completion
  const trackId = historyEntry?.id || filename.replace('.webm', '');
  completeUpload(trackId, result.link);

  // Update history with drive link
  if (historyEntry) {
    historyEntry.driveLink = result.link;
    if (result.folderId) historyEntry.driveFolderId = result.folderId;
    await saveEntry(historyEntry).catch(() => {});

    // Track vault sync state
    if (useVault && result.folderId) {
      await saveVaultSync({
        id: historyEntry.id,
        driveFolderId: result.folderId,
        drivePackageUploaded: true,
        archiveStatus: 'active',
        pinned: false,
        legalHold: false,
        lastSyncDate: Date.now(),
      }).catch(() => {});
    }
  }

  // Calendar integration (meeting entries only)
  try {
    const cfg = getConfig();
    if (context.contentType === 'meeting' && cfg.calendar.enabled && provider.calendar) {
      const event = await provider.calendar.findMatchingEvent(context.recordingStartTime || Date.now());
      if (event) {
        await provider.calendar.addRecordingLink(event.id, result.link, filename);
        output.calendarEvent = {
          id: event.id,
          summary: event.summary,
          start: event.start,
          end: event.end,
          organizer: event.organizer || null,
        };
        if (event.attendees?.length) {
          output.participants = event.attendees;
        }
        // Persist to history
        if (historyEntry) {
          historyEntry.calendarEvent = output.calendarEvent;
          if (output.participants) historyEntry.participants = output.participants;
          await saveEntry(historyEntry).catch(() => {});
        }
        callbacks.onCalendarLinked?.(event, output.participants);
      }
    }
  } catch (e) {
    console.warn('[Upload] Calendar integration failed:', e);
  }

  // Auto-copy link to clipboard
  if (getSettings().autoCopyLink !== false) {
    try {
      await navigator.clipboard.writeText(result.link);
    } catch {}
  }

  return output;
}

// ── Offline Queue Integration (Phase 72) ──────────────────────────────────

/**
 * Upload with offline queue fallback.
 * If the upload fails after all retries, the operation is queued
 * and automatically retried when connectivity returns.
 *
 * @param {object} params - Same as uploadToCloud params
 * @param {object} callbacks - Same as uploadToCloud callbacks
 * @returns {Promise<object|string>} Upload result or queue operation ID
 */
export async function resilientUpload(params, callbacks = {}) {
  try {
    return await uploadToCloud(params, callbacks);
  } catch (e) {
    // Queue for later if it looks like a network issue
    const isNetworkError = !navigator.onLine ||
      e.message?.includes('timed out') ||
      e.message?.includes('network') ||
      e.message?.includes('Failed to fetch');

    if (isNetworkError && params.historyEntry?.id) {
      notifyEphemeral(
        'Upload queued',
        'Upload will automatically retry when connectivity returns.',
        'info',
      );

      const opId = await enqueue('cloud-upload', {
        contentId: params.historyEntry.id,
        filename: params.filename,
      }, { id: `upload-${params.historyEntry.id}` });

      return { queued: true, operationId: opId };
    }

    throw e; // Re-throw non-network errors
  }
}
