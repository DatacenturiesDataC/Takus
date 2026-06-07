
// Resilient operation queue that retries when connectivity returns.
// Operations are persisted to IndexedDB so they survive page refreshes.
//
// Mission: Adaptive AI with goal preservation — data must never be silently lost.
// If an operation fails due to network issues, it is queued and retried
// automatically when connectivity returns.

import { getSetting, saveSetting } from './storage.js';
import { generateId } from './id.js';

const QUEUE_KEY = 'takus_offline_queue';
const MAX_RETRIES = 5;
const RETRY_DELAYS = [1000, 5000, 15000, 60000, 300000]; // Progressive backoff

/** @type {Array<QueuedOperation>} */
let _queue = [];
let _processing = false;
let _listeners = [];
let _handlers = new Map();
let _onlineListener = null;
let _retryTimeout = null;

/**
 * @typedef {object} QueuedOperation
 * @property {string} id        Unique operation ID
 * @property {string} type      Operation type (e.g., 'upload', 'sync', 'api-call')
 * @property {object} payload   Serializable payload for the handler
 * @property {number} retries   Number of retries attempted
 * @property {number} createdAt Timestamp
 * @property {number} nextRetry Timestamp of next retry attempt
 * @property {'queued'|'processing'|'failed'} status
 * @property {string|null} lastError  Last error message
 */

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a handler for an operation type.
 * @param {string} type - Operation type
 * @param {function(object): Promise<void>} handler - Async handler receiving payload
 */
export function registerQueueHandler(type, handler) {
  _handlers.set(type, handler);
}

/**
 * Enqueue an operation for execution.
 * If online, executes immediately. If offline, queues for later.
 *
 * @param {string} type - Operation type (must have a registered handler)
 * @param {object} payload - Serializable data for the handler
 * @param {object} [options]
 * @param {string} [options.id] - Custom operation ID (for deduplication)
 * @returns {Promise<string>} Operation ID
 */
export async function enqueue(type, payload, options = {}) {
  const id = options.id || generateId('op');

  // Deduplicate by ID
  if (_queue.find(op => op.id === id)) return id;

  const op = {
    id,
    type,
    payload,
    retries: 0,
    createdAt: Date.now(),
    nextRetry: Date.now(),
    status: 'queued',
    lastError: null,
  };

  _queue.push(op);
  await _persist();
  _emit('enqueued', op);

  // Try immediate execution if online
  if (navigator.onLine !== false) {
    _processQueue();
  }

  return id;
}

/**
 * Get all queued operations.
 * @returns {Array<QueuedOperation>}
 */
export function getQueue() {
  return [..._queue];
}

/**
 * Get queue statistics.
 * @returns {{ total: number, queued: number, processing: number, failed: number }}
 */
export function getQueueStats() {
  return {
    total: _queue.length,
    queued: _queue.filter(op => op.status === 'queued').length,
    processing: _queue.filter(op => op.status === 'processing').length,
    failed: _queue.filter(op => op.status === 'failed').length,
  };
}

/**
 * Remove a failed operation from the queue.
 * @param {string} id
 */
export async function removeFromQueue(id) {
  _queue = _queue.filter(op => op.id !== id);
  await _persist();
  _emit('removed', { id });
}

/**
 * Retry a specific failed operation.
 * @param {string} id
 */
export async function retryOperation(id) {
  const op = _queue.find(o => o.id === id);
  if (!op) return;
  op.status = 'queued';
  op.retries = 0;
  op.nextRetry = Date.now();
  op.lastError = null;
  await _persist();
  _processQueue();
}

/**
 * Subscribe to queue events.
 * @param {function(string, object): void} fn
 * @returns {function} Unsubscribe
 */
export function onQueueEvent(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

/**
 * Initialize the offline queue — load persisted operations and start monitoring.
 * Call once during app startup.
 */
export async function initOfflineQueue() {
  try {
    const stored = await getSetting(QUEUE_KEY);
    if (Array.isArray(stored)) {
      _queue = stored;
      // Reset any stale 'processing' to 'queued' — page may have crashed mid-operation
      for (const op of _queue) {
        if (op.status === 'processing') op.status = 'queued';
      }
    }
  } catch (e) { console.warn('[OfflineQueue] Queue initialization failed:', e.message); }

  // Listen for connectivity changes
  if (typeof window !== 'undefined') {
    if (_onlineListener) window.removeEventListener('online', _onlineListener);
    _onlineListener = () => _processQueue();
    window.addEventListener('online', _onlineListener);
  }

  // Process any pending operations
  if (navigator.onLine !== false && _queue.length) {
    _processQueue();
  }
}

/**
 * Clear the entire queue.
 */
export async function clearQueue() {
  _queue = [];
  _processing = false;
  if (_retryTimeout) {
    clearTimeout(_retryTimeout);
    _retryTimeout = null;
  }
  await _persist();
}

// ── Internal ────────────────────────────────────────────────────────────────

async function _processQueue() {
  if (_processing) return;
  _processing = true;

  try {
    const now = Date.now();
    const ready = _queue.filter(op => op.status === 'queued' && op.nextRetry <= now);

    for (const op of ready) {
      const handler = _handlers.get(op.type);
      if (!handler) {
        // Skip — handler may not be registered yet (race during boot).
        // Leave as 'queued' so it retries on the next cycle.
        console.debug(`[OfflineQueue] No handler for "${op.type}" — will retry later`);
        continue;
      }

      op.status = 'processing';
      _emit('processing', op);

      try {
        await handler(op.payload);
        // Success — remove from queue
        _queue = _queue.filter(o => o.id !== op.id);
        _emit('completed', op);
      } catch (err) {
        op.retries++;
        if (op.retries >= MAX_RETRIES) {
          op.status = 'failed';
          op.lastError = err.message || 'Unknown error';
          _emit('failed', op);
        } else {
          op.status = 'queued';
          op.nextRetry = now + (RETRY_DELAYS[op.retries - 1] || 300000);
          op.lastError = err.message || 'Unknown error';
          _emit('retrying', op);
        }
      }
    }
  } finally {
    _processing = false;
    await _persist();
    _scheduleNextProcess();
  }
}

function _scheduleNextProcess() {
  if (_retryTimeout) {
    clearTimeout(_retryTimeout);
    _retryTimeout = null;
  }

  const queuedOps = _queue.filter(op => op.status === 'queued');
  if (queuedOps.length === 0) return;

  const now = Date.now();
  const nextTime = Math.min(...queuedOps.map(op => op.nextRetry));
  const delay = Math.max(0, nextTime - now);

  if (delay < 2147483647) {
    _retryTimeout = setTimeout(() => {
      _retryTimeout = null;
      _processQueue();
    }, delay);
  }
}

async function _persist() {
  try {
    // Only persist serializable data
    const serializable = _queue.map(({ id, type, payload, retries, createdAt, nextRetry, status, lastError }) =>
      ({ id, type, payload, retries, createdAt, nextRetry, status, lastError }));
    await saveSetting(QUEUE_KEY, serializable);
  } catch (e) { console.warn('[OfflineQueue] Queue persist failed:', e.message); }
}

function _emit(event, data) {
  for (const fn of _listeners) {
    try { fn(event, data); } catch (e) { console.warn('[OfflineQueue] Listener error:', e); }
  }
}
