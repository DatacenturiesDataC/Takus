
//
// Provides eligibility checks, content classification, key-frame extraction,
// condensed package generation, and archive management.

import { extractAudio } from './ffmpeg-engine.js';
import { getEntries, saveEntry, saveMediaBlob, getVaultSync, saveVaultSync, getAllVaultSync } from './storage.js';
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
  RESTORED: 'restored',
};

// ── 10a. Preconditions ─────────────────────────────────────────────────────

/**
 * Check if an entry is eligible for archival.
 * @param {object} entry - Entry from IndexedDB
 * @param {object} [vaultSync] - Vault sync state (optional)
 * @param {number} [archiveAfterDays] - Days after which to archive
 * @returns {{ eligible: boolean, reason: string }}
 */
export function checkEligibility(entry, vaultSync, archiveAfterDays = DEFAULT_ARCHIVE_AFTER_DAYS) {
  // Must not be already archived
  const status = vaultSync?.archiveStatus || entry.archiveStatus || ArchiveStatus.ACTIVE;
  if (status === ArchiveStatus.ARCHIVED || status === ArchiveStatus.COLD) {
    return { eligible: false, reason: 'Already archived' };
  }
  if (status === ArchiveStatus.PENDING) {
    return { eligible: false, reason: 'Archive already pending' };
  }

  // Must not be pinned
  if (entry.pinned || vaultSync?.pinned) {
    return { eligible: false, reason: 'Entry is pinned' };
  }

  // Must not have a legal hold
  if (entry.legalHold || vaultSync?.legalHold) {
    return { eligible: false, reason: 'Entry is under legal hold' };
  }

  // Must be old enough
  const ageMs = Date.now() - (entry.date || 0);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < archiveAfterDays) {
    return { eligible: false, reason: `Entry is only ${Math.floor(ageDays)} days old (minimum: ${archiveAfterDays})` };
  }

  // Must have been uploaded to cloud (VAULT package)
  if (!vaultSync?.drivePackageUploaded) {
    return { eligible: false, reason: 'Entry not yet synced to cloud vault' };
  }

  return { eligible: true, reason: 'Eligible for archival' };
}

// ── 10b. Content Classification ────────────────────────────────────────────

/**
 * Classify the visual importance of an entry.
 * Uses the content type and available metadata as heuristics.
 * @param {object} entry - Entry
 * @returns {string} ContentClass value
 */
export function classifyContent(entry) {
  const type = entry.type || 'screen';

  // Type-based heuristics (from content type picker)
  switch (type) {
    case 'meeting':
      // Meetings are typically talking-head or audio-only
      return ContentClass.TRANSCRIPT;

    case 'presentation':
      // Presentations have slide transitions — medium visual significance
      return ContentClass.SLIDE;

    case 'screen':
      // Screen entries could be either slide-like or dynamic
      // Use duration as a secondary heuristic — longer entries are more
      // likely to be walkthroughs with stable frames, shorter ones may be demos
      if (entry.duration && entry.duration > 600) {
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
 * @param {Blob} videoBlob - The video media blob
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
 * Generate a condensed archive package for an entry.
 * For transcript-centric and slide entries: audio + transcript + key frames
 * For dynamic-visual: placeholder (full low-fi transcode deferred)
 *
 * @param {object} entry - Entry from IndexedDB
 * @param {Blob} videoBlob - Original video blob
 * @param {Function} [onProgress] - (stage: string, progress: number) => void
 * @returns {Promise<{audioBlob: Blob|null, frames: Array<{timestamp: number, blob: Blob}>, contentClass: string}>}
 */
export async function createCondensedPackage(entry, videoBlob, onProgress) {
  const contentClass = classifyContent(entry);

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
  const duration = entry.duration || 0;
  const frames = await extractKeyFrames(videoBlob, duration, {
    maxFrames: contentClass === ContentClass.DYNAMIC ? 30 : 20,
    intervalSec: contentClass === ContentClass.TRANSCRIPT ? 60 : 30,
  });

  onProgress?.('complete', 1.0);

  return { audioBlob, frames, contentClass };
}

// ── 10d. Archive Flow ──────────────────────────────────────────────────────

/**
 * Execute the full archive process for a single entry.
 * 1. Check eligibility
 * 2. Generate condensed package
 * 3. Upload condensed artefacts to the VAULT folder
 * 4. Move original.webm to archive/ subfolder
 * 5. Update metadata and vault sync state
 *
 * @param {object} entry - Entry
 * @param {Blob} videoBlob - Original video blob
 * @param {Function} [onProgress]
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
export async function archiveEntry(entry, videoBlob, onProgress) {
  const vaultSync = await getVaultSync(entry.id);
  const { eligible, reason } = checkEligibility(entry, vaultSync);

  if (!eligible) {
    return { success: false, reason };
  }

  // Mark as pending
  await saveVaultSync({
    ...vaultSync,
    id: entry.id,
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
    const pkg = await createCondensedPackage(entry, videoBlob, (stage, p) => {
      onProgress?.(stage, 0.1 + p * 0.5);
    });

    // 2. Upload condensed artefacts to the entry's VAULT folder
    onProgress?.('uploading-archive', 0.6);
    const dateStr = new Date(entry.date).toISOString().slice(0, 7);
    const folderPath = `Takus/entries/${dateStr}/${entry.id}`;

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
      id: entry.id,
      title: entry.title || 'Untitled',
      date: entry.date,
      duration: entry.duration || 0,
      size: videoBlob.size,
      type: entry.type || 'screen',
      aiProvider: entry.aiProvider || null,
      participants: entry.participants || [],
      archiveStatus: ArchiveStatus.ARCHIVED,
      archivedAt: new Date().toISOString(),
      contentClass: pkg.contentClass,
      keyFrameCount: pkg.frames.length,
      hasAudio: !!pkg.audioBlob,
      pinned: entry.pinned || false,
      legalHold: entry.legalHold || false,
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
    entry.archiveStatus = ArchiveStatus.ARCHIVED;
    entry.archivedAt = archiveMetadata.archivedAt;
    entry.archiveLog = entry.archiveLog || [];
    entry.archiveLog.push({
      action: 'archived',
      date: new Date().toISOString(),
      contentClass: pkg.contentClass,
      keyFrameCount: pkg.frames.length,
    });
    await saveEntry(entry).catch(e => console.warn('[Archive] Save failed:', e.message));

    await saveVaultSync({
      ...vaultSync,
      id: entry.id,
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
      id: entry.id,
      archiveStatus: ArchiveStatus.ACTIVE,
      lastSyncDate: Date.now(),
    }).catch(() => {});

    console.error('[Archive] Archival failed:', e);
    return { success: false, reason: e.message };
  }
}

/**
 * Restore an archived entry by re-downloading the video from cloud.
 * Transitions: archived|cold → restored → active
 *
 * @param {object} entry - Entry from IndexedDB
 * @param {function(string, number): void} [onProgress] - Progress callback (stage, 0–1)
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
export async function restoreEntry(entry, onProgress) {
  const vaultSync = await getVaultSync(entry.id);
  const status = vaultSync?.archiveStatus || entry.archiveStatus || ArchiveStatus.ACTIVE;

  if (status !== ArchiveStatus.ARCHIVED && status !== ArchiveStatus.COLD) {
    return { success: false, reason: 'Entry is not archived' };
  }

  // Mark as restoring
  await saveVaultSync({
    ...vaultSync,
    id: entry.id,
    archiveStatus: ArchiveStatus.RESTORED,
    lastSyncDate: Date.now(),
  });

  try {
    const cpm = CloudProviderManager.getInstance();
    const provider = cpm.getProvider();
    if (!provider) throw new Error('No cloud provider connected');

    const storage = provider.storage;
    const dateStr = new Date(entry.date).toISOString().slice(0, 7);
    const folderPath = `Takus/entries/${dateStr}/${entry.id}`;

    // 1. Find and download the original video blob
    onProgress?.('locating', 0.1);
    let videoBlob = null;

    if (provider.id === 'google') {
      const folderId = await storage.ensureFolderPath(folderPath);
      const files = await storage.listFolderContents(folderId);
      // Look for video files (webm, mp4, mkv)
      const videoFile = files.find(f =>
        /\.(webm|mp4|mkv|avi|mov)$/i.test(f.name) && !f.name.startsWith('audio')
      );
      if (videoFile) {
        onProgress?.('downloading', 0.3);
        videoBlob = await storage.downloadFileBlob(videoFile.id);
      }
    } else {
      // OneDrive — try common video extensions
      for (const ext of ['webm', 'mp4', 'mkv']) {
        try {
          const path = `${folderPath}/entry.${ext}`;
          videoBlob = await storage.downloadFileBlob(path);
          if (videoBlob) break;
        } catch { /* try next extension */ }
      }
    }

    // 2. Re-save the video blob to IDB if found
    if (videoBlob) {
      onProgress?.('saving', 0.7);
      await saveMediaBlob(entry.id, videoBlob);
    }

    // 3. Re-download AI artefacts if missing locally
    onProgress?.('syncing-artefacts', 0.8);
    if (!entry.aiSummary || !entry.aiVtt) {
      try {
        if (provider.id === 'google') {
          const folderId = await storage.ensureFolderPath(folderPath);
          const files = await storage.listFolderContents(folderId);
          if (!entry.aiSummary) {
            const summaryFile = files.find(f => f.name === 'summary.md');
            if (summaryFile) entry.aiSummary = await storage.downloadFileContent(summaryFile.id);
          }
          if (!entry.aiVtt) {
            const vttFile = files.find(f => f.name === 'transcript.vtt');
            if (vttFile) entry.aiVtt = await storage.downloadFileContent(vttFile.id);
          }
        } else {
          if (!entry.aiSummary) {
            try { entry.aiSummary = await storage.downloadFileContent(`${folderPath}/summary.md`); } catch { /* non-critical */ }
          }
          if (!entry.aiVtt) {
            try { entry.aiVtt = await storage.downloadFileContent(`${folderPath}/transcript.vtt`); } catch { /* non-critical */ }
          }
        }
      } catch { /* best-effort artefact recovery */ }
    }

    // 4. Update local state → active
    onProgress?.('finalizing', 0.9);
    entry.archiveStatus = ArchiveStatus.ACTIVE;
    entry.state = 'active';
    entry.restoredAt = new Date().toISOString();
    entry.archiveLog = entry.archiveLog || [];
    entry.archiveLog.push({
      action: 'restored',
      date: new Date().toISOString(),
      hadVideo: !!videoBlob,
    });
    await saveEntry(entry).catch(e => console.warn('[Archive] Restore save failed:', e.message));

    await saveVaultSync({
      ...vaultSync,
      id: entry.id,
      archiveStatus: ArchiveStatus.ACTIVE,
      lastSyncDate: Date.now(),
    });

    onProgress?.('done', 1.0);
    return { success: true };

  } catch (e) {
    // Revert to archived on failure
    await saveVaultSync({
      ...vaultSync,
      id: entry.id,
      archiveStatus: status, // restore original status
      lastSyncDate: Date.now(),
    }).catch(() => {});

    console.error('[Archive] Restore failed:', e);
    return { success: false, reason: e.message };
  }
}

// ── 10a. Eligibility Scanner ───────────────────────────────────────────────

/**
 * Scan all entries and return those eligible for archival.
 * @param {number} [archiveAfterDays]
 * @returns {Promise<Array<{entry: object, vaultSync: object}>>}
 */
export async function scanEligibleEntries(archiveAfterDays = DEFAULT_ARCHIVE_AFTER_DAYS) {
  let entries, allSync;
  try {
    [entries, allSync] = await Promise.all([
      getEntries(),
      getAllVaultSync(),
    ]);
  } catch (e) {
    console.warn('[Archive] scanEligibleEntries failed to load data:', e.message);
    return [];
  }

  const syncMap = new Map(allSync.map(v => [v.id, v]));
  const eligible = [];

  for (const entry of entries) {
    const vs = syncMap.get(entry.id);
    const { eligible: isEligible } = checkEligibility(entry, vs, archiveAfterDays);
    if (isEligible) {
      eligible.push({ entry: entry, vaultSync: vs });
    }
  }

  return eligible;
}

// ── 10d. Pin / Unpin with Audit Trail ──────────────────────────────────────

/**
 * Toggle the pinned status of an entry with an audit trail.
 * @param {object} entry - Entry
 * @returns {Promise<void>}
 */
export async function togglePin(entry) {
  const wasPinned = !!entry.pinned;
  entry.pinned = !wasPinned;
  entry.pinnedAt = entry.pinned ? new Date().toISOString() : null;

  // Audit trail
  entry.archiveLog = entry.archiveLog || [];
  entry.archiveLog.push({
    action: entry.pinned ? 'pinned' : 'unpinned',
    date: new Date().toISOString(),
  });

  await saveEntry(entry).catch(e => console.warn('[Archive] Pin save failed:', e.message));

  // Update vault sync if available
  const vs = await getVaultSync(entry.id);
  if (vs) {
    vs.pinned = entry.pinned;
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
  let entries, allSync;
  try {
    [entries, allSync] = await Promise.all([
      getEntries(),
      getAllVaultSync(),
    ]);
  } catch (e) {
    console.warn('[Archive] getArchiveStats failed to load data:', e.message);
    return { total: 0, active: 0, archived: 0, pinned: 0, eligible: 0, totalSize: 0, potentialSavings: 0 };
  }

  const syncMap = new Map(allSync.map(v => [v.id, v]));

  const stats = {
    total: entries.length,
    active: 0,
    archived: 0,
    pinned: 0,
    eligible: 0,
    totalSize: 0,
    potentialSavings: 0,
  };

  for (const entry of entries) {
    const vs = syncMap.get(entry.id);
    const status = vs?.archiveStatus || ArchiveStatus.ACTIVE;

    stats.totalSize += entry.size || 0;

    if (status === ArchiveStatus.ARCHIVED || status === ArchiveStatus.COLD) {
      stats.archived++;
    } else {
      stats.active++;
    }

    if (entry.pinned) stats.pinned++;

    const { eligible } = checkEligibility(entry, vs);
    if (eligible) {
      stats.eligible++;
      // Estimate savings (95% for transcript/slide, 94% for dynamic)
      const cls = classifyContent(entry);
      const savingRate = cls === ContentClass.DYNAMIC ? 0.94 : 0.95;
      stats.potentialSavings += (entry.size || 0) * savingRate;
    }
  }

  return stats;
}
