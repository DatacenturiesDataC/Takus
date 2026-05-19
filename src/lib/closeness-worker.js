// Takus — Closeness Score Background Worker
// Schedules periodic recomputation of closeness scores for all contacts.
// Runs every 24 hours (or on demand) to keep knowledge levels fresh.

import { getContacts, getAllInteractions, saveContact, getContentItems, getAllEngagementEvents, saveContentItem, batchRead } from './storage.js';
import { recomputeAllScores, isCloseContact } from './closeness-score.js';
import { resolveAllLevels } from './knowledge-level.js';
import { getConfig } from './config.js';
// Inlined to avoid TDZ in production Rollup builds (MS_PER_DAY cross-chunk evaluation order)
const RECOMPUTE_INTERVAL_MS = 86_400_000; // 24 hours
const STORAGE_KEY = 'takus_last_closeness_recompute';

/** @type {number|null} */
let _timerId = null;

/**
 * Start the closeness score recomputation scheduler.
 * Runs immediately if the last run was > 24 hours ago, then schedules the next.
 */
export function startClosenessWorker() {
  if (_timerId) return; // already running

  const lastRun = _getLastRunTime();
  const elapsed = Date.now() - lastRun;

  if (elapsed >= RECOMPUTE_INTERVAL_MS) {
    // Overdue — run now
    recomputeScores().catch(err => console.warn('[ClosenessWorker] Recompute failed:', err));
  }

  // Schedule next run
  const nextDelay = Math.max(0, RECOMPUTE_INTERVAL_MS - elapsed);
  _timerId = setTimeout(() => {
    _runAndReschedule();
  }, nextDelay);
}

/**
 * Stop the background scheduler.
 */
export function stopClosenessWorker() {
  if (_timerId) {
    clearTimeout(_timerId);
    _timerId = null;
  }
}

/**
 * Run a single recomputation cycle.
 * Can be called manually (e.g., from People panel "Refresh" button).
 *
 * @returns {Promise<{ updated: number, crossed: Array<{ contactId: string, direction: 'up'|'down' }> }>}
 */
export async function recomputeScores() {
  // Batch-read contacts + interactions in a single IDB transaction
  const batch = await batchRead(['contacts', 'interactions']);
  const contacts = (batch.contacts || []).filter(Boolean);
  if (!contacts.length) return { updated: 0, crossed: [] };

  const allInteractions = batch.interactions || [];
  const results = recomputeAllScores(contacts, allInteractions);

  const changed = results.filter(r => r.changed);
  const crossed = [];

  // Persist updated scores
  for (const result of changed) {
    const contact = contacts.find(c => c.id === result.contactId);
    if (!contact) continue;

    const wasClose = isCloseContact(result.oldScore);
    const isNowClose = isCloseContact(result.newScore);

    contact.closenessScore = result.newScore;
    await saveContact(contact);

    if (wasClose !== isNowClose) {
      crossed.push({
        contactId: result.contactId,
        direction: isNowClose ? 'up' : 'down',
      });
    }
  }

  // If any contacts crossed the threshold, re-evaluate knowledge levels
  if (crossed.length > 0) {
    try {
      const levelBatch = await batchRead(['content_items', 'engagement_events']);
      const contentItems = levelBatch.content_items || [];
      const engagementEvents = levelBatch.engagement_events || [];
      const config = getConfig();
      const currentUserId = config.userId || 'local-user';
      const contactMap = new Map(contacts.map(c => [c.id, c]));
      const engagedContentIds = new Set(engagementEvents.map(e => e.contentId));

      const levelResults = resolveAllLevels(contentItems, currentUserId, contactMap, engagedContentIds);
      for (const r of levelResults.filter(r => r.changed)) {
        const item = contentItems.find(i => i.id === r.id);
        if (item) {
          item.knowledgeLevel = r.newLevel;
          await saveContentItem(item);
        }
      }
    } catch (err) {
      console.warn('[ClosenessWorker] Knowledge level re-evaluation failed:', err);
    }
  }

  _setLastRunTime(Date.now());
  console.info(`[ClosenessWorker] Recomputed ${contacts.length} contacts, ${changed.length} updated, ${crossed.length} threshold crossings`);
  return { updated: changed.length, crossed };
}

// ── Internal ────────────────────────────────────────────────────────────────

function _runAndReschedule() {
  recomputeScores().catch(err => console.warn('[ClosenessWorker] Recompute failed:', err));
  _timerId = setTimeout(_runAndReschedule, RECOMPUTE_INTERVAL_MS);
}

function _getLastRunTime() {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch { /* non-critical */
    return 0;
  }
}

function _setLastRunTime(ts) {
  try {
    localStorage.setItem(STORAGE_KEY, String(ts));
  } catch { /* localStorage may be full or unavailable */ }
}
