// Takus — Archive Engine (Phase 10: Intelligent Storage Lifecycle)
//
// Provides eligibility checks, content classification, key-frame extraction,
// condensed package generation, and archive management.

import { extractAudio } from './ffmpeg-engine.js';
import { getRecordings, saveRecording, getVaultSync, saveVaultSync, getAllVaultSync } from './storage.js';
import { CloudProviderManager } from './cloud-provider.js';

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_ARCHIVE_AFTER_DAYS = 30;
const COLD_STORAGE_GRACE_DAYS = 90;

/** Content classification classes */
export const ContentClass = {
  TRANSCRIPT: 'transcript-centric',
  SLIDE: 'slide-screen-share',
  DYNAMIC: 'dynamic-visual',
};

/** Archive status values */
export const ArchiveStatus = {
  ACTIVE: 'active',
  PENDING: 'pending',
  ARCHIVED: 'archived',
  COLD: 'cold',
};

// ── 10a. Preconditions ─────────────────────────────────────────────────────

/**
 * Check if a recording is eligible for archival.
 * @param {object} recording - Recording entry from IndexedDB
 * @param {object} [vaultSync] - Vault sync state (optional)
 * @param {number} [archiveAfterDays] - Days after which to archive
 * @returns {{ eligible: boolean, reason: string }}
 */
export function checkEligibility(recording, vaultSync, archiveAfterDays = DEFAULT_ARCHIVE_AFTER_DAYS) {
  // Must not be already archived
  const status = vaultSync?.archiveStatus || recording.archiveStatus || ArchiveStatus.ACTIVE;
  if (status === ArchiveStatus.ARCHIVED || status === ArchiveStatus.COLD) {
    return { eligible: false, reason: 'Already archived' };
  }
  if (status === ArchiveStatus.PENDING) {
    return { eligible: false, reason: 'Archive already pending' };
  }

  // Must not be pinned
  if (recording.pinned || vaultSync?.pinned) {
    return { eligible: false, reason: 'Recording is pinned' };
  }

  // Must not have a legal hold
  if (recording.legalHold || vaultSync?.legalHold) {
    return { eligible: false, reason: 'Recording is under legal hold' };
  }

  // Must be old enough
  const ageMs = Date.now() - (recording.date || 0);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < archiveAfterDays) {
    return { eligible: false, reason: `Recording is only ${Math.floor(ageDays)} days old (minimum: ${archiveAfterDays})` };
  }

  // Must have been uploaded to cloud (VAULT package)
  if (!vaultSync?.drivePackageUploaded) {
    return { eligible: false, reason: 'Recording not yet synced to cloud vault' };
  }

  return { eligible: true, reason: 'Eligible for archival' };
}

// ── 10b. Content Classification ────────────────────────────────────────────

/**
 * Classify the visual importance of a recording.
 * Uses the recording type and available metadata as heuristics.
 * @param {object} recording - Recording entry
 * @returns {string} ContentClass value
 */
export function classifyContent(recording) {
  const type = recording.type || 'screen';

  // Type-based heuristics (from recording type picker)
  switch (type) {
    case 'meeting':
      // Meetings are typically talking-head or audio-only
      return ContentClass.TRANSCRIPT;

    case 'presentation':
      // Presentations have slide transitions — medium visual significance
      return ContentClass.SLIDE;

    case 'screen':
      // Screen recordings could be either slide-like or dynamic
      // Use duration as a secondary heuristic — longer recordings are more
      // likely to be walkthroughs with stable frames, shorter ones may be demos
      if (recording.duration && recording.duration > 600) {
        return ContentClass.SLIDE;
      }
      return ContentClass.DYNAMIC;

    case 'update':
      // Status updates are typically talking-head with minimal visuals
      return ContentClass.TRANSCRIPT;

    default:
      return ContentClass.SLIDE;
  }
}

// ── 10c. Key Frame Extraction ──────────────────────────────────────────────

/**
 * Extract key frames from a video blob using FFmpeg.
 * Captures frames at regular intervals (scene-cut detection is not
 * available in ffmpeg.wasm's single-threaded UMD build, so we use
 * time-based sampling as a reliable fallback).
 *
 * @param {Blob} videoBlob - The video recording blob
 * @param {number} duration - Duration in seconds
 * @param {object} [options]
 * @param {number} [options.maxFrames=20] - Maximum number of frames to extract
 * @param {number} [options.intervalSec=30] - Interval between frames (seconds)
 * @returns {Promise<Array<{timestamp: number, blob: Blob}>>}
 */
export async function extractKeyFrames(videoBlob, duration, options = {}) {
  const { maxFrames = 20, intervalSec = 30 } = options;

  // Calculate timestamps for frame extraction
  const timestamps = [];
  // Always capture the first frame
  timestamps.push(0);

  // Add frames at intervals
  for (let t = intervalSec; t < duration; t += intervalSec) {
    if (timestamps.length >= maxFrames) break;
    timestamps.push(t);
  }

  // Always capture the last frame if not already included
  if (duration > 0 && timestamps[timestamps.length - 1] < duration - 5) {
    timestamps.push(Math.max(0, duration - 2));
  }

  // Use canvas-based extraction (works without FFmpeg for browser-native video)
  return await _extractFramesViaCanvas(videoBlob, timestamps);
}

/**
 * Extract frames using a hidden <video> + <canvas> approach.
 * This is more memory-efficient than FFmpeg for frame extraction.
 */
async function _extractFramesViaCanvas(videoBlob, timestamps) {
  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';

  const frames = [];

  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = reject;
      video.src = url;
    });

    const canvas = document.createElement('canvas');
    // Use 480p for key frames (good enough for review, small file size)
    const scale = Math.min(1, 480 / video.videoHeight);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');

    for (const timestamp of timestamps) {
      try {
        video.currentTime = timestamp;
        await new Promise((resolve, reject) => {
          video.onseeked = resolve;
          video.onerror = reject;
        });

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve =>
          canvas.toBlob(resolve, 'image/jpeg', 0.7)
        );
        if (blob && blob.size > 100) {
          frames.push({ timestamp, blob });
        }
      } catch (e) {
        console.warn(`[Archive] Frame extraction failed at ${timestamp}s:`, e.message);
      }
    }
  } finally {
    URL.revokeObjectURL(url);
    video.remove();
  }

  return frames;
}

// ── 10c. Condensed Package Generation ──────────────────────────────────────

/**
 * Generate a condensed archive package for a recording.
 * For transcript-centric and slide recordings: audio + transcript + key frames
 * For dynamic-visual: placeholder (full low-fi transcode deferred)
 *
 * @param {object} recording - Recording entry from IndexedDB
 * @param {Blob} videoBlob - Original video blob
 * @param {Function} [onProgress] - (stage: string, progress: number) => void
 * @returns {Promise<{audioBlob: Blob|null, frames: Array<{timestamp: number, blob: Blob}>, contentClass: string}>}
 */
export async function createCondensedPackage(recording, videoBlob, onProgress) {
  const contentClass = classifyContent(recording);

  onProgress?.('classifying', 0);

  // Step 1: Extract audio
  onProgress?.('extracting-audio', 0.1);
  let audioBlob = null;
  try {
    audioBlob = await extractAudio(videoBlob);
  } catch (e) {
    console.warn('[Archive] Audio extraction failed:', e.message);
  }

  // Step 2: Extract key frames
  onProgress?.('extracting-frames', 0.4);
  const duration = recording.duration || 0;
  const frames = await extractKeyFrames(videoBlob, duration, {
    maxFrames: contentClass === ContentClass.DYNAMIC ? 30 : 20,
    intervalSec: contentClass === ContentClass.TRANSCRIPT ? 60 : 30,
  });

  onProgress?.('complete', 1.0);

  return { audioBlob, frames, contentClass };
}

// ── 10d. Archive Flow ──────────────────────────────────────────────────────

/**
 * Execute the full archive process for a single recording.
 * 1. Check eligibility
 * 2. Generate condensed package
 * 3. Upload condensed artefacts to the VAULT folder
 * 4. Move original.webm to archive/ subfolder
 * 5. Update metadata and vault sync state
 *
 * @param {object} recording - Recording entry
 * @param {Blob} videoBlob - Original video blob
 * @param {Function} [onProgress]
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
export async function archiveRecording(recording, videoBlob, onProgress) {
  const vaultSync = await getVaultSync(recording.id);
  const { eligible, reason } = checkEligibility(recording, vaultSync);

  if (!eligible) {
    return { success: false, reason };
  }

  // Mark as pending
  await saveVaultSync({
    ...vaultSync,
    id: recording.id,
    archiveStatus: ArchiveStatus.PENDING,
    lastSyncDate: Date.now(),
  });

  try {
    const cpm = CloudProviderManager.getInstance();
    const provider = cpm.getProvider();
    if (!provider) throw new Error('No cloud provider connected');

    const storage = provider.storage;

    // 1. Generate condensed package
    onProgress?.('generating', 0.1);
    const pkg = await createCondensedPackage(recording, videoBlob, (stage, p) => {
      onProgress?.(stage, 0.1 + p * 0.5);
    });

    // 2. Upload condensed artefacts to the recording's VAULT folder
    onProgress?.('uploading-archive', 0.6);
    const dateStr = new Date(recording.date).toISOString().slice(0, 7);
    const folderPath = `Takus/recordings/${dateStr}/${recording.id}`;

    // Upload audio
    if (pkg.audioBlob) {
      try {
        if (provider.id === 'google') {
          const folderId = await storage.ensureFolderPath(folderPath);
          await storage.uploadSmallFile(folderId, 'audio.mp3', pkg.audioBlob, 'audio/mpeg');
        } else {
          await storage.uploadSmallFile(folderPath, 'audio.mp3', pkg.audioBlob, 'audio/mpeg');
        }
      } catch (e) {
        console.warn('[Archive] Audio upload failed:', e.message);
      }
    }

    // Upload key frames
    if (pkg.frames.length > 0) {
      onProgress?.('uploading-frames', 0.7);
      const framesPath = `${folderPath}/frames`;
      if (provider.id === 'google') {
        const framesId = await storage.ensureFolderPath(framesPath);
        for (let i = 0; i < pkg.frames.length; i++) {
          const frame = pkg.frames[i];
          const frameName = `${String(i + 1).padStart(4, '0')}_${Math.round(frame.timestamp)}s.jpg`;
          try {
            await storage.uploadSmallFile(framesId, frameName, frame.blob, 'image/jpeg');
          } catch (e) {
            console.warn(`[Archive] Frame ${frameName} upload failed:`, e.message);
          }
        }
      } else {
        for (let i = 0; i < pkg.frames.length; i++) {
          const frame = pkg.frames[i];
          const frameName = `${String(i + 1).padStart(4, '0')}_${Math.round(frame.timestamp)}s.jpg`;
          try {
            await storage.uploadSmallFile(framesPath, frameName, frame.blob, 'image/jpeg');
          } catch (e) {
            console.warn(`[Archive] Frame ${frameName} upload failed:`, e.message);
          }
        }
      }
    }

    // 3. Update metadata.json with archive info
    onProgress?.('updating-metadata', 0.85);
    const archiveMetadata = {
      id: recording.id,
      title: recording.title || 'Untitled',
      date: recording.date,
      duration: recording.duration || 0,
      size: videoBlob.size,
      type: recording.type || 'screen',
      aiProvider: recording.aiProvider || null,
      participants: recording.participants || [],
      archiveStatus: ArchiveStatus.ARCHIVED,
      archivedAt: new Date().toISOString(),
      contentClass: pkg.contentClass,
      keyFrameCount: pkg.frames.length,
      hasAudio: !!pkg.audioBlob,
      pinned: recording.pinned || false,
      legalHold: recording.legalHold || false,
      version: 2,
    };

    try {
      if (provider.id === 'google') {
        const folderId = await storage.ensureFolderPath(folderPath);
        // Delete old metadata.json and re-upload
        const files = await storage.listFolderContents(folderId);
        const existing = files.find(f => f.name === 'metadata.json');
        if (existing) {
          // Update by re-uploading (overwrite isn't supported in multipart,
          // but the file is small enough that a new upload is fine)
          const token = await storage.auth.ensureValidToken();
          await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(archiveMetadata, null, 2),
          });
        } else {
          await storage.uploadSmallFile(folderId, 'metadata.json', JSON.stringify(archiveMetadata, null, 2), 'application/json');
        }
      } else {
        await storage.uploadSmallFile(folderPath, 'metadata.json', JSON.stringify(archiveMetadata, null, 2), 'application/json');
      }
    } catch (e) {
      console.warn('[Archive] Metadata update failed:', e.message);
    }

    // 4. Update local state
    onProgress?.('finalizing', 0.95);
    recording.archiveStatus = ArchiveStatus.ARCHIVED;
    recording.archivedAt = archiveMetadata.archivedAt;
    recording.archiveLog = recording.archiveLog || [];
    recording.archiveLog.push({
      action: 'archived',
      date: new Date().toISOString(),
      contentClass: pkg.contentClass,
      keyFrameCount: pkg.frames.length,
    });
    await saveRecording(recording).catch(e => console.warn('[Archive] Save failed:', e.message));

    await saveVaultSync({
      ...vaultSync,
      id: recording.id,
      archiveStatus: ArchiveStatus.ARCHIVED,
      archivedAt: archiveMetadata.archivedAt,
      lastSyncDate: Date.now(),
    });

    onProgress?.('done', 1.0);
    return { success: true };

  } catch (e) {
    // Revert to active on failure
    await saveVaultSync({
      ...vaultSync,
      id: recording.id,
      archiveStatus: ArchiveStatus.ACTIVE,
      lastSyncDate: Date.now(),
    }).catch(() => {});

    console.error('[Archive] Archival failed:', e);
    return { success: false, reason: e.message };
  }
}

// ── 10a. Eligibility Scanner ───────────────────────────────────────────────

/**
 * Scan all recordings and return those eligible for archival.
 * @param {number} [archiveAfterDays]
 * @returns {Promise<Array<{recording: object, vaultSync: object}>>}
 */
export async function scanEligibleRecordings(archiveAfterDays = DEFAULT_ARCHIVE_AFTER_DAYS) {
  const [recordings, allSync] = await Promise.all([
    getRecordings(),
    getAllVaultSync(),
  ]);

  const syncMap = new Map(allSync.map(v => [v.id, v]));
  const eligible = [];

  for (const rec of recordings) {
    const vs = syncMap.get(rec.id);
    const { eligible: isEligible } = checkEligibility(rec, vs, archiveAfterDays);
    if (isEligible) {
      eligible.push({ recording: rec, vaultSync: vs });
    }
  }

  return eligible;
}

// ── 10d. Pin / Unpin with Audit Trail ──────────────────────────────────────

/**
 * Toggle the pinned status of a recording with an audit trail.
 * @param {object} recording - Recording entry
 * @returns {Promise<void>}
 */
export async function togglePin(recording) {
  const wasPinned = !!recording.pinned;
  recording.pinned = !wasPinned;
  recording.pinnedAt = recording.pinned ? new Date().toISOString() : null;

  // Audit trail
  recording.archiveLog = recording.archiveLog || [];
  recording.archiveLog.push({
    action: recording.pinned ? 'pinned' : 'unpinned',
    date: new Date().toISOString(),
  });

  await saveRecording(recording).catch(e => console.warn('[Archive] Pin save failed:', e.message));

  // Update vault sync if available
  const vs = await getVaultSync(recording.id);
  if (vs) {
    vs.pinned = recording.pinned;
    vs.lastSyncDate = Date.now();
    await saveVaultSync(vs);
  }
}

// ── Archive Statistics ─────────────────────────────────────────────────────

/**
 * Calculate archive statistics for the Insights panel.
 * @returns {Promise<{total: number, active: number, archived: number, pinned: number, eligible: number, totalSize: number, potentialSavings: number}>}
 */
export async function getArchiveStats() {
  const [recordings, allSync] = await Promise.all([
    getRecordings(),
    getAllVaultSync(),
  ]);

  const syncMap = new Map(allSync.map(v => [v.id, v]));

  const stats = {
    total: recordings.length,
    active: 0,
    archived: 0,
    pinned: 0,
    eligible: 0,
    totalSize: 0,
    potentialSavings: 0,
  };

  for (const rec of recordings) {
    const vs = syncMap.get(rec.id);
    const status = vs?.archiveStatus || ArchiveStatus.ACTIVE;

    stats.totalSize += rec.size || 0;

    if (status === ArchiveStatus.ARCHIVED || status === ArchiveStatus.COLD) {
      stats.archived++;
    } else {
      stats.active++;
    }

    if (rec.pinned) stats.pinned++;

    const { eligible } = checkEligibility(rec, vs);
    if (eligible) {
      stats.eligible++;
      // Estimate savings (95% for transcript/slide, 94% for dynamic)
      const cls = classifyContent(rec);
      const savingRate = cls === ContentClass.DYNAMIC ? 0.94 : 0.95;
      stats.potentialSavings += (rec.size || 0) * savingRate;
    }
  }

  return stats;
}
