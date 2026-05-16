// Takus — Settings Store
// In-memory settings cache and persistence layer.
// Extracted from settings-panel.js to eliminate lib → component dependency.

import { CLOUD_CONNECTED } from './events.js';
import { saveSetting, getSetting } from './storage.js';
import { CloudProviderManager } from './cloud-provider.js';

// ── In-memory settings cache ──────────────────────────────────────────────────
// Populated by initSettings() on app start; updated by every saveSetting call.
const _cache = {
  videoQuality: '720p', audioQuality: 'medium',
  watermarkText: '', autoCopyLink: true,
  aiProvider: 'openai', openaiKey: '', geminiKey: '',
  shortcutRecord: 'r', shortcutPause: ' ', shortcutStop: 's',
  desktopNotifications: false,
  autoRuns: '[]', // JSON-serialized Auto-Run rules (renamed from autoReadRules in Phase 25)
};

// Keys that are safe to sync to cloud (no secrets)
const SYNCABLE_KEYS = [
  'videoQuality', 'audioQuality', 'watermarkText', 'autoCopyLink',
  'aiProvider', 'desktopNotifications',
  'shortcutRecord', 'shortcutPause', 'shortcutStop',
  'autoRuns',
];

export async function initSettings() {
  const keys = ['videoQuality','audioQuality','watermarkText','autoCopyLink',
                 'aiProvider','openaiKey','geminiKey',
                 'shortcutRecord','shortcutPause','shortcutStop',
                 'desktopNotifications','autoRuns'];
  const vals = await Promise.all(keys.map(k => getSetting(k)));
  keys.forEach((k, i) => { if (vals[i] != null) _cache[k] = vals[i]; });

  // Backward compat: migrate legacy autoReadRules → autoRuns
  if (!_cache.autoRuns || _cache.autoRuns === '[]') {
    const legacy = await getSetting('autoReadRules');
    if (legacy && legacy !== '[]') {
      _cache.autoRuns = legacy;
      saveSetting('autoRuns', legacy); // Persist under new key
    }
  }

  // Listen for cloud connection events to restore synced settings
  window.addEventListener(CLOUD_CONNECTED, () => {
    restoreSettingsFromCloud().catch(() => {});
  });
}

/**
 * Save a setting to IDB and update the in-memory cache.
 * Triggers debounced cloud sync for syncable keys.
 * @param {string} key
 * @param {*} value
 * @param {Function} [onSaved] - Optional callback after save (e.g. UI confirmation)
 */
export function saveAndCache(key, value, onSaved) {
  _cache[key] = value;
  saveSetting(key, value);
  // Auto-sync syncable settings to cloud (debounced, fire-and-forget)
  if (SYNCABLE_KEYS.includes(key)) _debouncedCloudSync();
  if (onSaved) onSaved();
}

// ── Auto cloud sync (debounced) ───────────────────────────────────────────────
let _syncTimer = null;
function _debouncedCloudSync() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(_syncSettingsToCloud, 2000);
}

async function _syncSettingsToCloud() {
  try {
    const cpm = CloudProviderManager.getInstance();
    const provider = cpm.getProvider();
    if (!provider?.auth?.isConnected || typeof provider.storage.syncSettings !== 'function') return;
    const payload = {};
    for (const k of SYNCABLE_KEYS) payload[k] = _cache[k];
    await provider.storage.syncSettings(payload);
  } catch {
    // Non-critical — local settings are always the source of truth
  }
}

/**
 * Restore settings from cloud. Called by CloudProviderManager on connect.
 * Cloud wins for syncable preferences; API keys are never overwritten.
 */
export async function restoreSettingsFromCloud() {
  try {
    const cpm = CloudProviderManager.getInstance();
    const provider = cpm.getProvider();
    if (!provider?.auth?.isConnected || typeof provider.storage.fetchSettings !== 'function') return false;
    const remote = await provider.storage.fetchSettings();
    if (!remote) return false;
    let restored = 0;
    for (const k of SYNCABLE_KEYS) {
      if (remote[k] != null && remote[k] !== _cache[k]) {
        _cache[k] = remote[k];
        await saveSetting(k, remote[k]);
        restored++;
      }
    }
    return restored > 0;
  } catch {
    return false;
  }
}

/**
 * Get the current settings snapshot (synchronous, from cache).
 * @returns {{ videoQuality: string, audioQuality: string, watermarkText: string, autoCopyLink: boolean, aiProvider: string, openaiKey: string, geminiKey: string, desktopNotifications: boolean }}
 */
export function getSettings() {
  return {
    videoQuality: _cache.videoQuality || '720p',
    audioQuality: _cache.audioQuality || 'medium',
    watermarkText: _cache.watermarkText || '',
    autoCopyLink: _cache.autoCopyLink !== false,
    aiProvider: _cache.aiProvider || 'openai',
    openaiKey: _cache.openaiKey || '',
    geminiKey: _cache.geminiKey || '',
    desktopNotifications: _cache.desktopNotifications === true,
    shortcutRecord: _cache.shortcutRecord || 'r',
    shortcutPause: _cache.shortcutPause || ' ',
    shortcutStop: _cache.shortcutStop || 's',
    autoRuns: _cache.autoRuns || '[]',
    autoReadRules: _cache.autoRuns || '[]', // Legacy alias for backward compat
  };
}

/**
 * Get the current keyboard shortcut mappings.
 * @returns {Promise<{ record: string, pause: string, stop: string }>}
 */
export async function getShortcuts() {
  return {
    record: _cache.shortcutRecord || 'r',
    pause:  _cache.shortcutPause  || ' ',
    stop:   _cache.shortcutStop   || 's',
  };
}

/**
 * Read a single setting — from the in-memory cache if it's a known cached key,
 * otherwise falls back to IDB. This is the preferred entry point for modules
 * that need a single setting value without importing the full getSettings() snapshot.
 *
 * @param {string} key
 * @returns {Promise<*>}
 */
export async function getSettingCached(key) {
  if (key in _cache) return _cache[key];
  // Unknown key — fall through to IDB
  return getSetting(key);
}
