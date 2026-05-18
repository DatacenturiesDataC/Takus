// Takus — Inbox Service
//
// Unified intake queue for the Knowledge OS. All incoming knowledge items
// (entries, documents, emails, etc.) flow through the inbox before
// being processed by the intelligence pipeline.
//
// The Inbox is a platform service — apps produce items, Auto-Runs evaluate
// them, and the intelligence pipeline processes them.
//
// Phase 31: First-class inbox with app-contributed items.
//
// Item lifecycle:
//   App produces → Inbox receives → Auto-Run evaluates → Process or Hold
//     ┌─ Match    → Auto-process (skip inbox)
//     └─ No match → Hold in inbox (state: 'inbox')
//
// Inbox items are stored as graph nodes with state: 'inbox' or 'processing'.

import { evaluateAutoRuns } from './auto-runs.js';
import { generateId } from './id.js';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * @typedef {object} InboxItem
 * @property {string} id - Unique item ID
 * @property {string} appId - Contributing app ID (e.g., 'recorder', 'drive')
 * @property {string} type - Item type (e.g., 'entry', 'document', 'email')
 * @property {string} title - Human-readable title
 * @property {'inbox'|'processing'|'processed'|'error'} state - Current state
 * @property {number} createdAt - Timestamp (ms)
 * @property {object} [metadata] - App-specific metadata
 * @property {string} [matchedRuleId] - ID of the Auto-Run rule that matched (if auto-processed)
 */

// ── Event Bus ──────────────────────────────────────────────────────────────

/** @type {Set<function>} */
const _listeners = new Set();

/**
 * Subscribe to inbox events.
 * @param {function(string, InboxItem): void} fn - Callback (event, item)
 * @returns {function} Unsubscribe function
 */
export function onInboxEvent(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _emit(event, item) {
  for (const fn of _listeners) {
    try { fn(event, item); } catch { /* listener errors don't break inbox */ }
  }
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Submit an item to the inbox.
 * Evaluates Auto-Run rules to determine if the item should be
 * auto-processed or held in the inbox for manual review.
 *
 * @param {Partial<InboxItem>} item - Item to submit
 * @returns {{ action: 'auto-process'|'hold', item: InboxItem, matchedRule?: object }}
 */
export function submitToInbox(item) {
  const inboxItem = {
    id: item.id || generateId('inbox'),
    appId: item.appId || 'unknown',
    type: item.type || 'unknown',
    title: item.title || 'Untitled',
    state: 'inbox',
    createdAt: item.createdAt || Date.now(),
    metadata: item.metadata || {},
    matchedRuleId: null,
  };

  // Evaluate Auto-Run rules
  const { shouldProcess, matchedRule } = evaluateAutoRuns(inboxItem);

  if (shouldProcess) {
    inboxItem.state = 'processing';
    inboxItem.matchedRuleId = matchedRule?.id || null;
    _emit('inbox:auto-processed', inboxItem);
    return { action: 'auto-process', item: inboxItem, matchedRule };
  }

  // No rule matched — hold in inbox
  _emit('inbox:received', inboxItem);
  return { action: 'hold', item: inboxItem };
}

/**
 * Mark an inbox item as "processing" (manually approved).
 * @param {InboxItem} item
 * @returns {InboxItem}
 */
export function processInboxItem(item) {
  item.state = 'processing';
  _emit('inbox:processing', item);
  return item;
}

/**
 * Mark an inbox item as "processed" (completed).
 * @param {InboxItem} item
 * @returns {InboxItem}
 */
export function completeInboxItem(item) {
  item.state = 'processed';
  _emit('inbox:completed', item);
  return item;
}

/**
 * Mark an inbox item as "error".
 * @param {InboxItem} item
 * @param {string} [errorMessage]
 * @returns {InboxItem}
 */
export function failInboxItem(item, errorMessage) {
  item.state = 'error';
  item.metadata = { ...item.metadata, error: errorMessage };
  _emit('inbox:error', item);
  return item;
}

/**
 * Get all apps that can produce inbox items.
 * Uses AppManager to find apps with canProduceInboxItems: true.
 *
 * @returns {Promise<import('./app-interface.js').TakusApp[]>}
 */
export async function getInboxProducers() {
  try {
    const { getActiveApps } = await import('./app-manager.js');
    return getActiveApps().filter(app => app.canProduceInboxItems === true);
  } catch {
    return [];
  }
}

/**
 * Get all inbox items (entries with state: 'raw').
 * This is the canonical query — all inbox UI should use this,
 * not query storage directly.
 *
 * Content-agnostic: queries all entries regardless of type.
 *
 * @returns {Promise<object[]>} Sorted by date descending (newest first)
 */
export async function getInboxItems() {
  try {
    const { getEntries } = await import('./storage.js');
    const entries = await getEntries();
    return entries
      .filter(e => e.state === 'raw')
      .sort((a, b) => (b.date || 0) - (a.date || 0));
  } catch {
    return [];
  }
}

/**
 * Get the inbox item count (badge number).
 * Lightweight — returns count only, no full item fetch.
 *
 * @returns {Promise<number>}
 */
export async function getInboxCount() {
  const items = await getInboxItems();
  return items.length;
}

/**
 * Dismiss an inbox item without processing.
 * Transitions state from 'raw' to 'dismissed'.
 *
 * @param {string} itemId
 * @returns {Promise<void>}
 */
export async function dismissInboxItem(itemId) {
  try {
    const { getEntries, saveEntry } = await import('./storage.js');
    const entries = await getEntries();
    const item = entries.find(e => e.id === itemId);
    if (item && item.state === 'raw') {
      item.state = 'dismissed';
      item.dismissedAt = Date.now();
      await saveEntry(item);
      _emit('inbox:dismissed', item);
    }
  } catch (err) {
    console.warn('[Inbox] Dismiss failed:', err.message);
  }
}

