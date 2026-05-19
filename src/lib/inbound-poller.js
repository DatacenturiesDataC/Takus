// Takus — Inbound Poller (Core Infrastructure)
// Polls active apps for new inbound items (calendar events, emails, messages, etc.)
// Respects visibility state, network status, and battery to conserve resources.
//
// Architecture:
//   - Each app can implement `pollInbound()` → returns InboundItem[]
//   - The poller runs on a configurable interval (default: 5 min)
//   - New items are processed through the content pipeline as entries
//   - Deduplication via source-scoped IDs prevents duplicate entries
//
// This transforms Takus from "push-only" (user records → Takus processes)
// into a "pull + push" platform where connected apps bring data IN.

import { saveEntry, getEntries } from './storage.js';
import { generateId } from './id.js';

/**
 * @typedef {object} InboundItem
 * @property {string} sourceId       - Unique ID within the source app (for dedup)
 * @property {string} sourceApp      - App ID that produced this item
 * @property {string} title          - Human-readable title
 * @property {string} [textContent]  - Text body (email body, message text, event description)
 * @property {string} [type]         - Content type (email, event, message, issue, etc.)
 * @property {number} [date]         - Timestamp (ms) — defaults to Date.now()
 * @property {object} [metadata]     - App-specific metadata (attendees, labels, priority, etc.)
 * @property {string[]} [tags]       - Auto-generated tags
 * @property {boolean} [autoProcess] - Whether to auto-run AI processing (default: false)
 */

// ── State ──────────────────────────────────────────────────────────────────

let _intervalId = null;
let _isPolling = false;
let _lastPollAt = 0;
let _pollCount = 0;
const _listeners = new Set();

/** Default polling interval: 5 minutes */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Minimum interval to prevent API abuse: 1 minute */
const MIN_INTERVAL_MS = 60 * 1000;

/** Track seen source IDs for deduplication across polls */
const _seenSourceIds = new Set();

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Start the inbound polling loop.
 * Automatically pauses when the tab is hidden or the device goes offline.
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=300000] - Polling interval in milliseconds
 * @returns {void}
 */
export function startPolling(opts = {}) {
  if (_intervalId) return; // Already running

  const interval = Math.max(opts.intervalMs || DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);

  // Run once immediately (after a short delay to let the app settle)
  setTimeout(() => _pollIfReady(), 3000);

  // Then schedule recurring polls
  _intervalId = setInterval(() => _pollIfReady(), interval);

  // Pause/resume on visibility change
  document.addEventListener('visibilitychange', _onVisibilityChange);

  // Pause/resume on network status
  window.addEventListener('online', _onOnline);
  window.addEventListener('offline', _onOffline);

  _emit('poller:started', { interval });
}

/**
 * Stop the inbound polling loop.
 */
export function stopPolling() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  document.removeEventListener('visibilitychange', _onVisibilityChange);
  window.removeEventListener('online', _onOnline);
  window.removeEventListener('offline', _onOffline);
  _emit('poller:stopped', {});
}

/**
 * Manually trigger a poll (e.g. from a "Refresh" button).
 * @returns {Promise<InboundItem[]>} Items discovered
 */
export async function pollNow() {
  return _runPoll();
}

/**
 * Get polling status.
 * @returns {{ running: boolean, lastPollAt: number, pollCount: number, isPolling: boolean }}
 */
export function getPollerStatus() {
  return {
    running: !!_intervalId,
    lastPollAt: _lastPollAt,
    pollCount: _pollCount,
    isPolling: _isPolling,
  };
}

/**
 * Subscribe to poller events.
 * Events: 'poller:started', 'poller:stopped', 'poller:poll_complete', 'poller:new_items', 'poller:error'
 *
 * @param {function(string, object): void} fn
 * @returns {function} Unsubscribe function
 */
export function onPollerEvent(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Check preconditions before polling.
 */
function _pollIfReady() {
  // Don't poll if tab is hidden (saves battery/API calls)
  if (document.hidden) return;

  // Don't poll if offline
  if (!navigator.onLine) return;

  // Don't double-poll
  if (_isPolling) return;

  _runPoll().catch(err => {
    console.warn('[InboundPoller] Poll error:', err.message);
    _emit('poller:error', { error: err.message });
  });
}

/**
 * Execute a single poll cycle across all active apps.
 * @returns {Promise<InboundItem[]>}
 */
async function _runPoll() {
  if (_isPolling) return [];
  _isPolling = true;

  try {
    // Lazy-import app manager to avoid circular dependency
    const { getActiveApps } = await import('./app-manager.js');
    const activeApps = getActiveApps();

    // Filter to apps that implement pollInbound
    const pollableApps = activeApps.filter(
      app => typeof app.pollInbound === 'function'
    );

    if (pollableApps.length === 0) {
      _lastPollAt = Date.now();
      _pollCount++;
      return [];
    }

    // Load existing entries for dedup (source IDs)
    const existingEntries = await getEntries().catch(() => []);
    const existingSourceIds = new Set(
      existingEntries
        .filter(e => e.sourceId && e.sourceApp)
        .map(e => `${e.sourceApp}:${e.sourceId}`)
    );

    // Merge with in-memory seen IDs
    for (const id of existingSourceIds) _seenSourceIds.add(id);

    // Poll all apps in parallel with individual error isolation
    const results = await Promise.allSettled(
      pollableApps.map(async (app) => {
        try {
          const items = await app.pollInbound();
          return Array.isArray(items) ? items.map(item => ({ ...item, sourceApp: app.id })) : [];
        } catch (err) {
          console.warn(`[InboundPoller] ${app.id}.pollInbound() failed:`, err.message);
          return [];
        }
      })
    );

    // Flatten all results
    const allItems = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Deduplicate: only keep items we haven't seen before
    const newItems = allItems.filter(item => {
      const key = `${item.sourceApp}:${item.sourceId}`;
      if (_seenSourceIds.has(key)) return false;
      _seenSourceIds.add(key);
      return true;
    });

    // Create entries for new items
    if (newItems.length > 0) {
      await _ingestItems(newItems);
      _emit('poller:new_items', {
        count: newItems.length,
        items: newItems.map(i => ({ title: i.title, sourceApp: i.sourceApp, type: i.type })),
      });
    }

    _lastPollAt = Date.now();
    _pollCount++;
    _emit('poller:poll_complete', {
      polledApps: pollableApps.length,
      newItems: newItems.length,
      totalItems: allItems.length,
    });

    return newItems;

  } finally {
    _isPolling = false;
  }
}

/**
 * Convert InboundItems into Takus entries and save to storage.
 * @param {InboundItem[]} items
 */
async function _ingestItems(items) {
  for (const item of items) {
    const entry = {
      id: generateId('entry'),
      title: item.title || 'Untitled',
      date: item.date || Date.now(),
      type: item.type || 'note',
      state: item.autoProcess ? 'raw' : 'active',
      textContent: item.textContent || '',
      sourceId: item.sourceId,
      sourceApp: item.sourceApp,
      tags: item.tags || [],
      metadata: item.metadata || {},
      duration: 0,
      size: item.textContent?.length || 0,
    };

    try {
      await saveEntry(entry);
    } catch (err) {
      console.warn(`[InboundPoller] Failed to save entry for ${item.sourceApp}:${item.sourceId}:`, err.message);
    }
  }

  // Notify the UI if available
  try {
    const { notifyEphemeral } = await import('./notification-manager.js');
    const appNames = [...new Set(items.map(i => i.sourceApp))];
    notifyEphemeral(
      `${items.length} new ${items.length === 1 ? 'item' : 'items'}`,
      `From ${appNames.join(', ')}`,
      'info'
    );
  } catch { /* notification system not loaded yet — ok */ }
}

// ── Lifecycle Handlers ─────────────────────────────────────────────────────

function _onVisibilityChange() {
  // When tab becomes visible again after being hidden, poll immediately
  if (!document.hidden && _intervalId) {
    const timeSinceLastPoll = Date.now() - _lastPollAt;
    if (timeSinceLastPoll > MIN_INTERVAL_MS) {
      _pollIfReady();
    }
  }
}

function _onOnline() {
  // Device came back online — poll immediately
  if (_intervalId) {
    _pollIfReady();
  }
}

function _onOffline() {
  // Nothing to do — _pollIfReady() checks navigator.onLine
}

function _emit(type, data) {
  for (const fn of _listeners) {
    try { fn(type, data); } catch (err) { console.error('[InboundPoller] Listener error:', err); }
  }
  // Also emit as DOM event for cross-component communication
  try {
    window.dispatchEvent(new CustomEvent(`takus:${type}`, { detail: data }));
  } catch { /* non-critical */ }
}
