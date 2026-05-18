// Takus — Inbound Adapter Framework (Knowledge OS)
//
// Provides the contract and registry for connectors that pull external
// knowledge INTO the Takus knowledge graph. All inbound adapters
// produce NormalizedContent objects, which flow through the unified
// inbox and intelligence pipeline.
//
// Architecture:
//   External Source → Adapter.poll() → NormalizedContent → ingestContent() → Pipeline
//
// Phase C: Bidirectional Integration Framework

import { generateId } from './id.js';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * @typedef {object} NormalizedContent
 * Universal shape for all inbound knowledge. Every adapter must produce this.
 *
 * @property {string}   title       Human-readable title
 * @property {string}   content     Full text content
 * @property {string}   type        Content type (email, note, document, chat, bookmark)
 * @property {string}   source      Adapter ID (e.g., 'slack', 'email', 'web-clipper')
 * @property {string}   sourceKey   Deduplication key (e.g., 'slack:C123:1234567890.123')
 * @property {object}   metadata    Source-specific metadata (channel, sender, URL, etc.)
 * @property {string[]} tags        Auto-applied tags
 * @property {number}   timestamp   Original creation timestamp (ms)
 */

// ── InboundAdapter Base Class ──────────────────────────────────────────────

/**
 * Base class for all inbound adapters.
 * Subclasses must implement: connect(), disconnect(), poll(), normalize().
 */
export class InboundAdapter {
  /**
   * @param {object} manifest
   * @param {string} manifest.id   — Unique adapter ID (e.g., 'slack', 'email')
   * @param {string} manifest.name — Human-readable name
   * @param {string} manifest.icon — Emoji or SVG icon
   * @param {string} manifest.description — Short description
   */
  constructor({ id, name, icon, description }) {
    if (!id || !name) throw new Error('InboundAdapter requires id and name');
    this.id = id;
    this.name = name;
    this.icon = icon || '📥';
    this.description = description || '';
    this._connected = false;
    this._config = null;
  }

  /** Whether the adapter is currently connected and ready to poll. */
  get connected() { return this._connected; }

  /**
   * Connect the adapter with user-provided configuration.
   * Must validate credentials and set _connected = true on success.
   * @param {object} config — Adapter-specific configuration
   * @returns {Promise<void>}
   */
  async connect(config) {
    this._config = config;
    this._connected = true;
  }

  /**
   * Disconnect the adapter and clean up resources.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._connected = false;
    this._config = null;
  }

  /**
   * Poll the external source for new items.
   * Returns raw items from the source — these will be normalized before ingestion.
   * @returns {Promise<object[]>} Raw items from the external source
   */
  async poll() {
    return [];
  }

  /**
   * Normalize a raw external item into a NormalizedContent object.
   * @param {object} rawItem — Raw item from the external source
   * @returns {NormalizedContent}
   */
  normalize(rawItem) {
    return {
      title: rawItem.title || 'Untitled',
      content: rawItem.content || rawItem.text || '',
      type: 'document',
      source: this.id,
      sourceKey: `${this.id}:${rawItem.id || generateId('src')}`,
      metadata: {},
      tags: [],
      timestamp: rawItem.timestamp || Date.now(),
    };
  }
}

// ── Adapter Registry ───────────────────────────────────────────────────────

/** @type {Map<string, InboundAdapter>} */
const _adapters = new Map();

/** @type {Map<string, number>} Polling interval IDs */
const _pollingIntervals = new Map();

/** @type {Set<string>} Seen source keys for deduplication */
const _seenKeys = new Set();

/** @type {boolean} Whether we've loaded persisted keys from storage */
let _keysLoaded = false;

/**
 * Load persisted deduplication keys from IndexedDB.
 * Lazy-loaded on first poll to avoid blocking startup.
 */
async function _loadSeenKeys() {
  if (_keysLoaded) return;
  try {
    const { getSetting } = await import('./storage.js');
    const stored = await getSetting('inbound_seen_keys');
    if (Array.isArray(stored)) {
      for (const key of stored) _seenKeys.add(key);
    }
  } catch { /* storage unavailable — start fresh */ }
  _keysLoaded = true;
}

/**
 * Persist deduplication keys to IndexedDB.
 * Keeps only the most recent 5,000 keys to bound storage.
 */
async function _persistSeenKeys() {
  try {
    const { saveSetting } = await import('./storage.js');
    const keys = [..._seenKeys];
    // Keep only the last 5000 keys
    const trimmed = keys.length > 5000 ? keys.slice(keys.length - 5000) : keys;
    await saveSetting('inbound_seen_keys', trimmed);
  } catch { /* best effort */ }
}

/**
 * Register an inbound adapter.
 * @param {InboundAdapter} adapter
 */
export function registerAdapter(adapter) {
  if (!(adapter instanceof InboundAdapter)) {
    throw new Error('Must be an InboundAdapter instance');
  }
  if (_adapters.has(adapter.id)) {
    console.warn(`[InboundAdapter] Replacing existing adapter: ${adapter.id}`);
  }
  _adapters.set(adapter.id, adapter);
}

/**
 * Unregister an inbound adapter and stop its polling.
 * @param {string} adapterId
 */
export function unregisterAdapter(adapterId) {
  stopPolling(adapterId);
  _adapters.delete(adapterId);
}

/**
 * Get a registered adapter by ID.
 * @param {string} id
 * @returns {InboundAdapter|undefined}
 */
export function getAdapter(id) {
  return _adapters.get(id);
}

/**
 * Get all registered adapters.
 * @returns {InboundAdapter[]}
 */
export function getAllAdapters() {
  return [..._adapters.values()];
}

/**
 * Ingest all new items from an adapter.
 * Polls → normalizes → deduplicates → feeds into the content pipeline.
 *
 * @param {string} adapterId — Adapter to poll
 * @returns {Promise<{ ingested: number, skipped: number, errors: string[] }>}
 */
export async function ingestFromAdapter(adapterId) {
  const adapter = _adapters.get(adapterId);
  if (!adapter) throw new Error(`Unknown adapter: ${adapterId}`);
  if (!adapter.connected) throw new Error(`Adapter not connected: ${adapterId}`);

  await _loadSeenKeys();

  const stats = { ingested: 0, skipped: 0, errors: [] };

  let rawItems;
  try {
    rawItems = await adapter.poll();
  } catch (e) {
    stats.errors.push(`Poll failed: ${e.message}`);
    return stats;
  }

  if (!rawItems?.length) return stats;

  // Lazy import to avoid circular dependency
  const { ingestContent } = await import('./content-pipeline.js');

  for (const rawItem of rawItems) {
    try {
      const normalized = adapter.normalize(rawItem);

      // Deduplication check
      if (_seenKeys.has(normalized.sourceKey)) {
        stats.skipped++;
        continue;
      }

      await ingestContent(normalized);
      _seenKeys.add(normalized.sourceKey);
      stats.ingested++;
    } catch (e) {
      stats.errors.push(`Item ${rawItem.id || 'unknown'}: ${e.message}`);
    }
  }

  // Persist updated keys
  if (stats.ingested > 0) {
    _persistSeenKeys().catch(() => {});
  }

  return stats;
}

/**
 * Start periodic polling for an adapter.
 * @param {string} adapterId
 * @param {number} intervalMs — Polling interval in milliseconds (default: 5 minutes)
 */
export function startPolling(adapterId, intervalMs = 5 * 60 * 1000) {
  stopPolling(adapterId); // Clear any existing interval

  const adapter = _adapters.get(adapterId);
  if (!adapter) throw new Error(`Unknown adapter: ${adapterId}`);

  const id = setInterval(async () => {
    if (!adapter.connected) return;
    try {
      const result = await ingestFromAdapter(adapterId);
      if (result.ingested > 0) {
        const { notifyEphemeral } = await import('./notification-manager.js');
        notifyEphemeral(
          `${adapter.name}: ${result.ingested} new item${result.ingested > 1 ? 's' : ''}`,
          'Knowledge imported successfully',
          'info'
        );
      }
    } catch (e) {
      console.warn(`[InboundAdapter] Polling ${adapterId} failed:`, e.message);
    }
  }, intervalMs);

  _pollingIntervals.set(adapterId, id);
}

/**
 * Stop periodic polling for an adapter.
 * @param {string} adapterId
 */
export function stopPolling(adapterId) {
  const id = _pollingIntervals.get(adapterId);
  if (id != null) {
    clearInterval(id);
    _pollingIntervals.delete(adapterId);
  }
}

/**
 * Check if an adapter is currently polling.
 * @param {string} adapterId
 * @returns {boolean}
 */
export function isPolling(adapterId) {
  return _pollingIntervals.has(adapterId);
}

/**
 * Reset deduplication state.
 * Useful for testing or when a user wants to re-import everything.
 */
export function resetSeenKeys() {
  _seenKeys.clear();
  _keysLoaded = false;
}
