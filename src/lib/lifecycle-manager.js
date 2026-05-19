
// Provides lifecycle hooks for the WordPress-model app ecosystem.
// Apps can register for pause/resume/beforeUnload events.
//
// Lifecycle events:
//   activate   → App is loaded and connected to platform services
//   pause      → Tab loses focus / app goes to background
//   resume     → Tab regains focus / app comes to foreground
//   beforeSave → About to persist state (opportunity to flush caches)
//   deactivate → App is being unloaded
//
// Mission: Goal preservation — apps must be able to persist state cleanly.

/** @typedef {'activate'|'pause'|'resume'|'beforeSave'|'deactivate'} LifecycleEvent */

/** @type {Map<string, Map<string, function[]>>} appId → event → handlers */
const _hooks = new Map();
let _visibilityHandler = null;
let _beforeUnloadHandler = null;
let _paused = false;
let _initialized = false;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a lifecycle hook for an app.
 *
 * @param {string} appId - App identifier
 * @param {LifecycleEvent} event - Lifecycle event name
 * @param {function(): void|Promise<void>} handler - Event handler
 * @returns {function} Unsubscribe function
 */
export function onLifecycle(appId, event, handler) {
  if (!_hooks.has(appId)) _hooks.set(appId, new Map());
  const appHooks = _hooks.get(appId);
  if (!appHooks.has(event)) appHooks.set(event, []);
  appHooks.get(event).push(handler);

  return () => {
    const handlers = appHooks.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    }
  };
}

/**
 * Emit a lifecycle event for a specific app.
 * @param {string} appId
 * @param {LifecycleEvent} event
 */
export async function emitLifecycle(appId, event) {
  const appHooks = _hooks.get(appId);
  if (!appHooks) return;
  const handlers = appHooks.get(event);
  if (!handlers) return;

  for (const handler of handlers) {
    try { await handler(); } catch (e) {
      console.warn(`[Lifecycle] ${appId}.${event} handler failed:`, e.message);
    }
  }
}

/**
 * Emit a lifecycle event for ALL registered apps.
 * @param {LifecycleEvent} event
 */
export async function emitLifecycleAll(event) {
  const promises = [];
  for (const [appId] of _hooks) {
    promises.push(emitLifecycle(appId, event));
  }
  await Promise.allSettled(promises);
}

/**
 * Get all apps that have registered lifecycle hooks.
 * @returns {string[]} App IDs
 */
export function getRegisteredApps() {
  return [..._hooks.keys()];
}

/**
 * Remove all hooks for an app (called during deactivation).
 * @param {string} appId
 */
export function clearAppHooks(appId) {
  _hooks.delete(appId);
}

/**
 * Whether the platform is currently paused (tab not visible).
 * @returns {boolean}
 */
export function isPaused() {
  return _paused;
}

/**
 * Initialize platform-level lifecycle monitoring.
 * Sets up visibility change and beforeunload listeners.
 * Call once during platform startup.
 */
export function initLifecycleMonitor() {
  if (_initialized) return;
  _initialized = true;

  // Tab visibility changes → pause/resume
  if (typeof document !== 'undefined') {
    _visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        _paused = true;
        emitLifecycleAll('pause').catch(() => {});
      } else {
        _paused = false;
        emitLifecycleAll('resume').catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', _visibilityHandler);
  }

  // Before page unload → beforeSave + deactivate
  if (typeof window !== 'undefined') {
    _beforeUnloadHandler = () => {
      // Can't await async in beforeunload, but we fire synchronously
      for (const [appId] of _hooks) {
        const appHooks = _hooks.get(appId);
        const saveHandlers = appHooks?.get('beforeSave') || [];
        for (const h of saveHandlers) {
          try { h(); } catch (e) { console.warn('[Lifecycle] Hook error:', e); }
        }
      }
    };
    window.addEventListener('beforeunload', _beforeUnloadHandler);
  }
}

/**
 * Teardown lifecycle monitoring (for testing).
 */
export function destroyLifecycleMonitor() {
  if (_visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', _visibilityHandler);
    _visibilityHandler = null;
  }
  if (_beforeUnloadHandler && typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', _beforeUnloadHandler);
    _beforeUnloadHandler = null;
  }
  _hooks.clear();
  _paused = false;
  _initialized = false;
}
