// Takus — App Manager
// Central orchestrator for app lifecycle, discovery, settings, and hooks.
// Analogous to WordPress's plugin activation/deactivation system.
//
// Responsibilities:
//   1. Register and validate app manifests
//   2. Manage activation/deactivation with dependency resolution
//   3. Provide namespaced per-app settings
//   4. Expose platform services to apps
//   5. Emit lifecycle events for UI and autonomy engine

import { validateAppManifest } from './app-interface.js';
import { getSetting, saveSetting } from './storage.js';
import { emitLifecycle, clearAppHooks, initLifecycleMonitor } from './lifecycle-manager.js';
import { APPS_CHANGED } from './events.js';

// ── Constants ──────────────────────────────────────────────────────────────

const ACTIVE_APPS_KEY = 'takus_active_apps';
const APP_SETTINGS_PREFIX = 'app:';

// ── State ──────────────────────────────────────────────────────────────────

/** @type {Map<string, import('./app-interface.js').TakusApp>} */
const _registry = new Map();

/** @type {Set<string>} */
const _activeIds = new Set();

/** @type {Set<string>} Guard against concurrent activateApp calls for the same appId */
const _activating = new Set();

/** @type {Map<string, object>} Cached per-app settings */
const _settingsCache = new Map();

/** @type {Set<function>} */
const _listeners = new Set();

/** @type {object|null} Platform services injected into apps */


// ── Registration ───────────────────────────────────────────────────────────

/**
 * Register an app with the platform.
 * Does NOT activate it — just makes it available.
 *
 * @param {import('./app-interface.js').TakusApp} app
 * @throws {Error} If manifest is invalid or ID is already registered
 */
export function registerApp(app) {
  const validated = validateAppManifest(app);
  if (_registry.has(validated.id)) {
    console.warn(`[AppManager] App "${validated.id}" already registered, replacing.`);
  }
  _registry.set(validated.id, validated);
}

/**
 * Register multiple apps at once.
 * @param {import('./app-interface.js').TakusApp[]} apps
 */
export function registerApps(apps) {
  for (const app of apps) registerApp(app);
}

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * Get an app by ID.
 * @param {string} appId
 * @returns {import('./app-interface.js').TakusApp|null}
 */
export function getApp(appId) {
  return _registry.get(appId) || null;
}

/**
 * Get all registered apps.
 * @returns {import('./app-interface.js').TakusApp[]}
 */
export function getAllApps() {
  return [..._registry.values()];
}

/**
 * Get all currently active apps.
 * @returns {import('./app-interface.js').TakusApp[]}
 */
export function getActiveApps() {
  return [..._registry.values()].filter(app => _activeIds.has(app.id));
}

/**
 * Check if an app is currently active.
 * @param {string} appId
 * @returns {boolean}
 */
export function isActive(appId) {
  return _activeIds.has(appId);
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * Activate an app.
 * Resolves dependencies (activates required apps first).
 * Calls the app's activate() with platform services.
 *
 * @param {string} appId
 * @returns {Promise<void>}
 * @throws {Error} If app not found, dependency missing, or activation fails
 */
export async function activateApp(appId, _depChain = new Set()) {
  const app = _registry.get(appId);
  if (!app) throw new Error(`App not found: ${appId}`);
  if (_activeIds.has(appId)) return; // Already active
  if (_activating.has(appId)) return; // Concurrent activation in progress
  _activating.add(appId);

  try {
    // Resolve dependencies first
    if (app.requires?.length) {
      for (const depId of app.requires) {
        if (_depChain.has(depId)) {
          throw new Error(`Circular dependency detected: ${[..._depChain, depId].join(' → ')}`);
        }
        if (!_registry.has(depId)) {
          throw new Error(`App "${appId}" requires "${depId}" which is not registered`);
        }
        if (!_activeIds.has(depId)) {
          const childChain = new Set(_depChain);
          childChain.add(appId);
          await activateApp(depId, childChain); // Recursive activation
        }
      }
    }

    // Load per-app settings
    await _loadAppSettings(appId, app);

    // Activate with platform services
    const services = _getPlatformServices(appId);
    try {
      await app.activate(services);
    } catch (err) {
      console.error(`[AppManager] Activation failed for "${appId}":`, err);
      throw err;
    }

    // Register app's step types with the task engine
    const stepTypes = app.getStepTypes();
    if (stepTypes.length > 0) {
      try {
        const { registerStep } = await import('./step-executor.js');
        for (const st of stepTypes) {
          registerStep(st.type, st.handler, { autoApprove: st.autoApprove || false });
        }
      } catch (err) {
        console.warn(`[AppManager] Step registration failed for "${appId}":`, err.message);
      }
    }

    _activeIds.add(appId);
    await _persistActiveApps();
    _emit('app:activated', { appId, app });

    try {
      window.dispatchEvent(new CustomEvent(APPS_CHANGED, { detail: { appId, active: true } }));
    } catch { /* non-critical */ }

    // Emit lifecycle activation event
    emitLifecycle(appId, 'activate').catch(() => {});
  } finally {
    _activating.delete(appId);
  }
}

/**
 * Deactivate an app.
 * Core apps cannot be deactivated. Checks for dependents first.
 *
 * @param {string} appId
 * @returns {Promise<void>}
 */
export async function deactivateApp(appId) {
  const app = _registry.get(appId);
  if (!app) return;
  if (!_activeIds.has(appId)) return;

  // Core apps cannot be deactivated
  if (app.category === 'core') {
    throw new Error(`Core app "${appId}" cannot be deactivated`);
  }

  // Check if any active app depends on this one
  for (const [otherId, otherApp] of _registry) {
    if (_activeIds.has(otherId) && otherApp.requires?.includes(appId)) {
      throw new Error(`Cannot deactivate "${appId}" — required by active app "${otherId}"`);
    }
  }

  try {
    await app.deactivate();
  } catch (err) {
    console.warn(`[AppManager] Deactivation error for "${appId}":`, err.message);
  }

  // Emit lifecycle deactivation and clean up hooks
  await emitLifecycle(appId, 'deactivate').catch(() => {});
  clearAppHooks(appId);

  _activeIds.delete(appId);
  await _persistActiveApps();
  _emit('app:deactivated', { appId });

  try {
    window.dispatchEvent(new CustomEvent(APPS_CHANGED, { detail: { appId, active: false } }));
  } catch { /* non-critical */ }
}

/**
 * Initialize the app manager.
 * Loads the list of previously active apps and activates them.
 * Should be called once during app startup, after all apps are registered.
 *
 * @returns {Promise<void>}
 */
export async function initAppManager() {
  // Load persisted active app list
  const savedIds = await _loadActiveAppIds();

  // If no saved state (fresh install), activate all registered apps.
  // Otherwise use the saved list, then auto-activate any newly registered
  // apps that weren't in the persisted set (covers app additions across updates).
  const idsToActivate = savedIds.length > 0
    ? savedIds
    : [..._registry.keys()];

  // Activate in order (respecting dependencies via recursive activation)
  for (const appId of idsToActivate) {
    if (_registry.has(appId)) {
      try {
        await activateApp(appId);
      } catch (err) {
        console.warn(`[AppManager] Failed to activate "${appId}" on init:`, err.message);
      }
    }
  }

  // Auto-activate newly registered apps not in saved state
  if (savedIds.length > 0) {
    for (const appId of _registry.keys()) {
      if (!_activeIds.has(appId)) {
        try {
          await activateApp(appId);
        } catch (err) {
          console.warn(`[AppManager] Failed to auto-activate new app "${appId}":`, err.message);
        }
      }
    }
  }

  // Start platform lifecycle monitoring (visibility/unload)
  initLifecycleMonitor();

  // Start inbound polling if any active app implements pollInbound()
  const hasPollable = getActiveApps().some(app => typeof app.pollInbound === 'function');
  if (hasPollable) {
    import('./inbound-poller.js').then(({ startPolling }) => {
      startPolling();
    }).catch(err => {
      console.warn('[AppManager] Inbound poller init failed:', err.message);
    });
  }

  _emit('manager:ready', { activeCount: _activeIds.size, totalCount: _registry.size });
}

// ── App Settings ───────────────────────────────────────────────────────────

/**
 * Get a setting value for an app.
 * Falls back to the app's default if not explicitly set.
 *
 * @param {string} appId
 * @param {string} key
 * @returns {*}
 */
export function getAppSetting(appId, key) {
  const cached = _settingsCache.get(appId);
  if (cached && key in cached) return cached[key];

  // Fall back to default
  const app = _registry.get(appId);
  if (app) {
    const defaults = app.getDefaultSettings();
    return defaults[key] ?? null;
  }
  return null;
}

/**
 * Get all settings for an app (merged with defaults).
 *
 * @param {string} appId
 * @returns {object}
 */
export function getAppSettings(appId) {
  const app = _registry.get(appId);
  const defaults = app ? app.getDefaultSettings() : {};
  const cached = _settingsCache.get(appId) || {};
  return { ...defaults, ...cached };
}

/**
 * Set a setting value for an app.
 * Persists to IDB under the namespaced key.
 *
 * @param {string} appId
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function setAppSetting(appId, key, value) {
  if (!_settingsCache.has(appId)) _settingsCache.set(appId, {});
  _settingsCache.get(appId)[key] = value;

  // Persist entire app settings object
  const allSettings = _settingsCache.get(appId);
  await saveSetting(`${APP_SETTINGS_PREFIX}${appId}`, allSettings);
  _emit('app:settings_changed', { appId, key, value });
}

/**
 * Reset all settings for an app back to defaults.
 *
 * @param {string} appId
 * @returns {Promise<void>}
 */
export async function resetAppSettings(appId) {
  _settingsCache.delete(appId);
  await saveSetting(`${APP_SETTINGS_PREFIX}${appId}`, null);
  _emit('app:settings_reset', { appId });
}

// ── Events ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to app manager events.
 *
 * Events:
 *   - 'app:activated'       { appId, app }
 *   - 'app:deactivated'     { appId }
 *   - 'app:settings_changed' { appId, key, value }
 *   - 'app:settings_reset'  { appId }
 *   - 'manager:ready'       { activeCount, totalCount }
 *
 * @param {function(string, object): void} fn
 * @returns {function} Unsubscribe function
 */
export function onAppEvent(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// ── Nav Items ──────────────────────────────────────────────────────────────

/**
 * Get nav items from all active apps, sorted by order.
 * Used by the app shell to render the tab bar dynamically.
 *
 * @returns {Array<AppNavItem & { appId: string }>}
 */
export function getNavItems() {
  const items = [];
  for (const app of getActiveApps()) {
    const nav = app.getNavItem();
    if (nav) {
      items.push({ ...nav, appId: app.id });
    }
  }
  return items.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

/**
 * Get quick actions from all active apps, sorted with primary actions first.
 * Used by the app shell to render the Quick Actions bar.
 *
 * @returns {Array<import('./app-interface.js').QuickAction & { appId: string }>}
 */
export function getQuickActions() {
  const actions = [];
  for (const app of getActiveApps()) {
    if (typeof app.getQuickActions !== 'function') continue;
    const appActions = app.getQuickActions();
    if (Array.isArray(appActions)) {
      // Limit to 2 actions per app
      for (const action of appActions.slice(0, 2)) {
        actions.push({ ...action, appId: app.id });
      }
    }
  }
  // Primary actions first, then by order
  return actions.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return (a.order ?? 50) - (b.order ?? 50);
  });
}

/**
 * Get Auto-Run presets from all active apps.
 * Used by the settings panel to show app-contributed "Suggested rules".
 * Each preset is tagged with the contributing app's metadata.
 *
 * @returns {Array<import('./app-interface.js').AutoRunPreset & { appId: string, appIcon: string, appName: string }>}
 */
export function getAutoRunPresets() {
  const presets = [];
  for (const app of getActiveApps()) {
    if (typeof app.getAutoRunPresets !== 'function') continue;
    const appPresets = app.getAutoRunPresets();
    if (Array.isArray(appPresets)) {
      for (const preset of appPresets) {
        presets.push({ ...preset, appId: app.id, appIcon: app.icon, appName: app.name });
      }
    }
  }
  return presets;
}

/**
 * Get active apps that contribute a config panel to the home screen.
 * Each returned app implements renderConfigPanel(container, callbacks).
 *
 * @returns {import('./app-interface.js').TakusApp[]}
 */
export function getConfigPanelApps() {
  return getActiveApps().filter(app => typeof app.renderConfigPanel === 'function');
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Build platform services object for an app.
 * Each app gets a scoped view of the platform.
 */
function _getPlatformServices(appId) {
  return {
    appId,
    graph: {
      saveNode: async (node) => {
        const { saveNode } = await import('./storage.js');
        return saveNode(node);
      },
      getNode: async (id) => {
        const { getNode } = await import('./storage.js');
        return getNode(id);
      },
      getNodesByType: async (type) => {
        const { getNodesByType } = await import('./storage.js');
        return getNodesByType(type);
      },
      addEdge: async (edge) => {
        const { addEdge } = await import('./storage.js');
        return addEdge(edge);
      },
      getEdges: async (sourceType, sourceId) => {
        const { getEdgesForNode } = await import('./storage.js');
        return getEdgesForNode(sourceType, sourceId);
      },
    },
    tasks: {
      createStep: async (type, label) => {
        const { createStep } = await import('./step-executor.js');
        return createStep(type, label);
      },
      executeStep: async (step, ctx) => {
        const { executeStep } = await import('./step-executor.js');
        return executeStep(step, ctx);
      },
    },
    settings: {
      get: (key) => getAppSetting(appId, key),
      getAll: () => getAppSettings(appId),
      set: (key, value) => setAppSetting(appId, key, value),
      reset: () => resetAppSettings(appId),
    },
    notifications: {
      toast: async (title, message, type) => {
        const { notifyEphemeral } = await import('./notification-manager.js');
        notifyEphemeral(title, message, type);
      },
    },
    events: {
      emit: (type, data) => _emit(`${appId}:${type}`, data),
      on: (fn) => onAppEvent((type, data) => {
        if (type.startsWith(`${appId}:`)) fn(type.slice(appId.length + 1), data);
      }),
    },
  };
}

async function _loadAppSettings(appId, app) {
  try {
    const saved = await getSetting(`${APP_SETTINGS_PREFIX}${appId}`);
    if (saved && typeof saved === 'object') {
      _settingsCache.set(appId, saved);
    } else {
      // Initialize with defaults
      _settingsCache.set(appId, { ...app.getDefaultSettings() });
    }
  } catch { /* non-critical */
    _settingsCache.set(appId, { ...app.getDefaultSettings() });
  }
}

async function _loadActiveAppIds() {
  try {
    const saved = await getSetting(ACTIVE_APPS_KEY);
    return Array.isArray(saved) ? saved : [];
  } catch { /* non-critical */
    return [];
  }
}

async function _persistActiveApps() {
  try {
    await saveSetting(ACTIVE_APPS_KEY, [..._activeIds]);
  } catch { /* non-critical */
    // Best-effort — apps will re-activate on next load
  }
}

function _emit(type, data = {}) {
  for (const fn of _listeners) {
    try { fn(type, data); } catch (err) { console.error('[AppManager] Listener error:', err); }
  }
  // Also dispatch as a DOM event for components that listen on window
  try {
    window.dispatchEvent(new CustomEvent(`takus:${type}`, { detail: data }));
  } catch { /* non-critical */ }
}

// ── Test Helpers ────────────────────────────────────────────────────────────

/** @internal Reset all state — for testing only */
export function _resetForTest() {
  _registry.clear();
  _activeIds.clear();
  _settingsCache.clear();
  _listeners.clear();

}
