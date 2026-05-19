
// Centralized keyboard shortcut management. Extracted from AppShell
// to enable apps to register their own shortcuts.
//
// Architecture: WordPress-model — apps declare shortcuts, platform manages binding.

import { getSetting, saveSetting } from './storage.js';

const SETTINGS_KEY = 'takus_shortcuts';

/** @type {Map<string, {key: string, label: string, handler: function, appId: string}>} */
const _registry = new Map();
let _globalHandler = null;
let _shortcuts = { record: 'r', pause: ' ', stop: 's' };

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load saved shortcuts from storage.
 * @returns {Promise<object>}
 */
export async function loadShortcuts() {
  try {
    const stored = await getSetting(SETTINGS_KEY);
    if (stored) _shortcuts = { ..._shortcuts, ...stored };
  } catch {}
  return { ..._shortcuts };
}

/**
 * Get current shortcut mappings.
 * @returns {object}
 */
export function getShortcuts() {
  return { ..._shortcuts };
}

/**
 * Update a shortcut key binding.
 * @param {string} action - Action name (e.g., 'record', 'pause')
 * @param {string} key - Key to bind
 * @returns {Promise<void>}
 */
export async function setShortcut(action, key) {
  _shortcuts[action] = key;
  await saveSetting(SETTINGS_KEY, _shortcuts);
}

/**
 * Register a keyboard shortcut for an app.
 * Apps register shortcuts during activation.
 *
 * @param {string} id - Unique shortcut ID (e.g., 'recorder:record')
 * @param {object} config
 * @param {string} config.key - Key to listen for (e.g., 'r', ' ', 'Escape')
 * @param {string} config.label - Human-readable label (e.g., 'Start Capture')
 * @param {function} config.handler - Callback when shortcut fires
 * @param {string} [config.appId] - Owning app ID
 * @param {boolean} [config.metaKey] - Requires Cmd/Ctrl
 */
export function registerShortcut(id, config) {
  _registry.set(id, {
    key: config.key,
    label: config.label,
    handler: config.handler,
    appId: config.appId || 'platform',
    metaKey: config.metaKey || false,
  });
  _rebindGlobal();
}

/**
 * Unregister a shortcut.
 * @param {string} id
 */
export function unregisterShortcut(id) {
  _registry.delete(id);
  _rebindGlobal();
}

/**
 * Get all registered shortcuts (for help overlay / settings).
 * @returns {Array<{id: string, key: string, label: string, appId: string}>}
 */
export function getAllShortcuts() {
  return [..._registry.entries()].map(([id, config]) => ({
    id,
    key: config.key,
    label: config.label,
    appId: config.appId,
    metaKey: config.metaKey,
  }));
}

/**
 * Check if a key event matches any registered shortcut.
 * Does NOT call the handler — just checks.
 *
 * @param {KeyboardEvent} event
 * @returns {{ id: string, config: object } | null}
 */
export function matchShortcut(event) {
  // Don't fire shortcuts when typing in inputs
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
  if (event.target?.isContentEditable) return null;

  for (const [id, config] of _registry) {
    const metaMatch = config.metaKey ? (event.metaKey || event.ctrlKey) : true;
    if (event.key === config.key && metaMatch) {
      return { id, config };
    }
  }
  return null;
}

/**
 * Enable global keyboard listener.
 * Called once by AppShell on startup.
 */
export function enableGlobalShortcuts() {
  _rebindGlobal();
}

/**
 * Disable global keyboard listener.
 */
export function disableGlobalShortcuts() {
  if (_globalHandler) {
    document.removeEventListener('keydown', _globalHandler);
    _globalHandler = null;
  }
}

// ── Internal ────────────────────────────────────────────────────────────────

function _rebindGlobal() {
  if (_globalHandler) {
    document.removeEventListener('keydown', _globalHandler);
  }

  _globalHandler = (event) => {
    const match = matchShortcut(event);
    if (match) {
      event.preventDefault();
      try { match.config.handler(event); } catch (e) { console.warn('[Shortcuts] Handler error:', e); }
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', _globalHandler);
  }
}
