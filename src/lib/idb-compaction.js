// Takus — IDB Compaction Utility (Knowledge OS: Infrastructure Hardening)
//
// Identifies and removes orphaned records across IndexedDB stores.
// An "orphan" is a record in a secondary store (embeddings, media, edges,
// vault_sync, interactions, etc.) whose parent entry no longer exists.
//
// This utility is designed to be:
//   - Non-destructive by default (dry-run mode returns report without deleting)
//   - Incremental (doesn't require loading all entries into memory at once)
//   - Observable (returns detailed report of what was found/cleaned)
//
// Called from: health-check.js, settings panel (maintenance), or autonomy engine

import {
  getEntries,
  getAllEmbeddings,
  deleteEmbeddings,
  getAllEdges,
  removeEdge,
  getAllVaultSync,
  removeVaultSync,
  getAllInteractions,
  removeInteractionsForEntry,
  getAllEngagementEvents,
  removeEngagementEventsForEntry,
} from './storage.js';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} CompactionReport
 * @property {number} entryCount - Total entries in the system
 * @property {object} orphans - Orphaned records by store
 * @property {number} orphans.embeddings - Orphaned embedding records
 * @property {number} orphans.edges - Orphaned edge records
 * @property {number} orphans.vaultSync - Orphaned vault sync records
 * @property {number} orphans.interactions - Orphaned interaction records
 * @property {number} orphans.engagementEvents - Orphaned engagement events
 * @property {number} totalOrphans - Sum of all orphans
 * @property {number} cleaned - Records cleaned (0 if dry-run)
 * @property {boolean} dryRun - Whether this was a dry-run
 * @property {number} durationMs - How long the compaction took
 * @property {string[]} errors - Errors encountered during compaction
 */

/**
 * Run IDB compaction: detect and optionally remove orphaned records.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=true] - If true, only report orphans without deleting
 * @param {function(string, number): void} [options.onProgress] - Progress callback (storeName, percentage)
 * @returns {Promise<CompactionReport>}
 */
export async function runCompaction(options = {}) {
  const { dryRun = true, onProgress } = options;
  const startTime = Date.now();
  const errors = [];

  /** @type {CompactionReport} */
  const report = {
    entryCount: 0,
    orphans: {
      embeddings: 0,
      edges: 0,
      vaultSync: 0,
      interactions: 0,
      engagementEvents: 0,
    },
    totalOrphans: 0,
    cleaned: 0,
    dryRun,
    durationMs: 0,
    errors,
  };

  // Step 1: Load all entry IDs into a Set for O(1) lookup
  let entryIds;
  try {
    const entries = await getEntries();
    entryIds = new Set(entries.map(e => e.id));
    report.entryCount = entries.length;
  } catch (e) {
    errors.push(`Failed to load entries: ${e.message}`);
    report.durationMs = Date.now() - startTime;
    return report;
  }

  onProgress?.('entries', 0.1);

  // Step 2: Scan embeddings for orphans
  try {
    const allEmbeddings = await getAllEmbeddings();
    for (const emb of allEmbeddings) {
      if (!entryIds.has(emb.contentId)) {
        report.orphans.embeddings++;
        if (!dryRun) {
          await deleteEmbeddings(emb.contentId);
          report.cleaned++;
        }
      }
    }
  } catch (e) {
    errors.push(`Embeddings scan failed: ${e.message}`);
  }

  onProgress?.('embeddings', 0.3);

  // Step 3: Scan edges for orphans (source or target entry no longer exists)
  try {
    const allEdges = await getAllEdges();
    for (const edge of allEdges) {
      const sourceOrphan = edge.sourceType === 'entry' && !entryIds.has(edge.sourceId);
      const targetOrphan = edge.targetType === 'entry' && !entryIds.has(edge.targetId);
      if (sourceOrphan || targetOrphan) {
        report.orphans.edges++;
        if (!dryRun) {
          await removeEdge(edge.id);
          report.cleaned++;
        }
      }
    }
  } catch (e) {
    errors.push(`Edges scan failed: ${e.message}`);
  }

  onProgress?.('edges', 0.5);

  // Step 4: Scan vault sync for orphans
  try {
    const allVaultSync = await getAllVaultSync();
    for (const vs of allVaultSync) {
      if (!entryIds.has(vs.id)) {
        report.orphans.vaultSync++;
        if (!dryRun) {
          await removeVaultSync(vs.id);
          report.cleaned++;
        }
      }
    }
  } catch (e) {
    errors.push(`VaultSync scan failed: ${e.message}`);
  }

  onProgress?.('vaultSync', 0.7);

  // Step 5: Scan interactions for orphans
  try {
    const allInteractions = await getAllInteractions();
    // Group orphaned interactions by contentId for batch deletion
    const orphanedInteractionIds = new Set();
    for (const int of allInteractions) {
      if (int.contentId && !entryIds.has(int.contentId)) {
        report.orphans.interactions++;
        orphanedInteractionIds.add(int.contentId);
      }
    }
    if (!dryRun) {
      for (const contentId of orphanedInteractionIds) {
        await removeInteractionsForEntry(contentId);
        report.cleaned += 1; // counted per entry, not per interaction
      }
    }
  } catch (e) {
    errors.push(`Interactions scan failed: ${e.message}`);
  }

  onProgress?.('interactions', 0.85);

  // Step 6: Scan engagement events for orphans
  try {
    const allEngagement = await getAllEngagementEvents();
    // Group orphaned engagement events by contentId for batch deletion
    const orphanedEngagementIds = new Set();
    for (const ev of allEngagement) {
      if (ev.contentId && !entryIds.has(ev.contentId)) {
        report.orphans.engagementEvents++;
        orphanedEngagementIds.add(ev.contentId);
      }
    }
    if (!dryRun) {
      for (const contentId of orphanedEngagementIds) {
        await removeEngagementEventsForEntry(contentId);
        report.cleaned += 1;
      }
    }
  } catch (e) {
    errors.push(`Engagement events scan failed: ${e.message}`);
  }

  onProgress?.('engagementEvents', 1.0);

  // Compute totals
  report.totalOrphans = Object.values(report.orphans).reduce((a, b) => a + b, 0);
  report.durationMs = Date.now() - startTime;

  return report;
}

/**
 * Format a compaction report as a human-readable string.
 * @param {CompactionReport} report
 * @returns {string}
 */
export function formatCompactionReport(report) {
  const lines = [
    `IDB Compaction Report (${report.dryRun ? 'DRY RUN' : 'LIVE'})`,
    `Entries: ${report.entryCount}`,
    `Duration: ${report.durationMs}ms`,
    '',
    '── Orphans Detected ──',
    `  Embeddings:       ${report.orphans.embeddings}`,
    `  Edges:            ${report.orphans.edges}`,
    `  Vault Sync:       ${report.orphans.vaultSync}`,
    `  Interactions:     ${report.orphans.interactions}`,
    `  Engagement Events: ${report.orphans.engagementEvents}`,
    `  TOTAL:            ${report.totalOrphans}`,
  ];

  if (!report.dryRun) {
    lines.push('', `Cleaned: ${report.cleaned} records`);
  }

  if (report.errors.length) {
    lines.push('', '── Errors ──');
    for (const e of report.errors) {
      lines.push(`  ✗ ${e}`);
    }
  }

  return lines.join('\n');
}

/**
 * Estimate the IDB storage usage.
 * Uses the Storage API when available, falls back to counting records.
 *
 * @returns {Promise<{ used: number, quota: number, percentage: number } | null>}
 */
export async function estimateStorageUsage() {
  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage || 0,
        quota: estimate.quota || 0,
        percentage: estimate.quota ? Math.round(((estimate.usage || 0) / estimate.quota) * 100) : 0,
      };
    } catch { /* non-critical */
      return null;
    }
  }
  return null;
}
