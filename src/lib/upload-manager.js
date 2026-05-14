// Takus — Upload Manager (extracted from app-shell.js)
// Handles cloud upload, local download, and format conversion (MP4/GIF).

import { convertToMP4, convertToGIF } from './ffmpeg-engine.js';
import { notifyEphemeral } from './notification-manager.js';

/**
 * Download a blob to the local filesystem.
 * @param {Blob}   blob     The recording blob
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
 * Convert a recording blob to MP4 and trigger download.
 * Shows a toast notification for conversion progress.
 * @param {Blob}   blob     The original WebM recording blob
 * @param {string} filename The target filename (with .webm extension)
 */
export async function downloadMP4(blob, filename) {
  if (!blob) return;
  notifyEphemeral('Converting to MP4', 'This may take a moment depending on recording length.', 'info');
  try {
    const mp4Blob = await convertToMP4(blob);
    downloadLocal(mp4Blob, filename.replace('.webm', '.mp4'));
  } catch (e) {
    console.error('[Upload] MP4 conversion failed:', e);
    notifyEphemeral('MP4 conversion failed', e.message || 'Check your connection and try again.', 'error');
  }
}

/**
 * Convert a recording blob to GIF and trigger download.
 * Shows a toast notification for conversion progress.
 * @param {Blob}   blob     The original WebM recording blob
 * @param {string} filename The target filename (with .webm extension)
 */
export async function downloadGIF(blob, filename) {
  if (!blob) return;
  notifyEphemeral('Converting to GIF', 'This may take a moment depending on recording length.', 'info');
  try {
    const gifBlob = await convertToGIF(blob);
    downloadLocal(gifBlob, filename.replace('.webm', '.gif'));
  } catch (e) {
    console.error('[Upload] GIF conversion failed:', e);
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
  return withRetry(
    (attempt) => {
      if (attempt > 0) {
        notifyEphemeral('Retrying upload', `Attempt ${attempt + 1} of 4…`, 'info');
      }
      return uploadFn(blob, filename, onProgress);
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

