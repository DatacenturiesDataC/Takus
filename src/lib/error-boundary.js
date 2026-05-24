// Takus — Global Error Boundary
// Catches unhandled errors and promise rejections, displays a user-friendly toast,
// and logs them for debugging. Prevents the app from silently breaking.

import { notifyEphemeral } from './notification-manager.js';
import { recordError } from './feedback-engine.js';

/** Known non-critical errors that should be silently swallowed */
const SUPPRESSED_PATTERNS = [
  'ResizeObserver loop',        // Benign browser warning
  'Non-Error promise rejection', // Often from browser extensions
  'Script error',               // Cross-origin scripts (no access)
  'ChunkLoadError',             // Lazy-loaded chunk network failure (retry handles it)
];

let _lastToastTime = 0;
const TOAST_DEBOUNCE_MS = 5000;

/** Track recently-shown error messages to deduplicate by content */
const _recentMessages = new Map();

/**
 * Install the global error boundary.
 * Call once during app initialization.
 */
export function installErrorBoundary() {
  // Uncaught errors
  window.addEventListener('error', (event) => {
    const msg = event.message || String(event.error);
    if (SUPPRESSED_PATTERNS.some(p => msg.includes(p))) return;

    console.error('[ErrorBoundary] Uncaught error:', event.error || msg);
    recordError(msg);
    _showDedupedToast(msg);
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason?.message || String(reason);
    if (SUPPRESSED_PATTERNS.some(p => msg.includes(p))) return;

    console.error('[ErrorBoundary] Unhandled rejection:', reason);
    recordError(msg);

    // Prevent the default browser console error for known recoverable cases
    // This must run regardless of toast rate-limiting.
    if (msg.includes('AbortError') || msg.includes('NotAllowedError')) {
      event.preventDefault();
    }

    _showDedupedToast(msg);
  });
}

/** Alias matching the naming convention requested by integrators */
export const initErrorBoundary = installErrorBoundary;

/**
 * Show a toast for the error, deduplicating by message content.
 * Same message within the cooldown window is silently dropped.
 */
function _showDedupedToast(msg) {
  const now = Date.now();
  // Global time-based rate-limit
  if (now - _lastToastTime < TOAST_DEBOUNCE_MS) return;
  // Per-message dedup: skip if the same message was shown within the cooldown
  const lastShown = _recentMessages.get(msg);
  if (lastShown && now - lastShown < TOAST_DEBOUNCE_MS) return;

  _lastToastTime = now;
  _recentMessages.set(msg, now);
  // Prevent unbounded growth — prune old entries
  if (_recentMessages.size > 50) {
    for (const [key, ts] of _recentMessages) {
      if (now - ts > TOAST_DEBOUNCE_MS) _recentMessages.delete(key);
    }
  }
  notifyEphemeral('Something went wrong', 'Your data is safe. ' + _friendlyMessage(msg), 'error');
}

/**
 * Reset internal state for testing only.
 * @internal
 */
export function _resetForTesting() {
  _lastToastTime = 0;
  _recentMessages.clear();
}

/**
 * Convert a raw error message to a user-friendly string.
 * Strips stack traces, internal paths, and overly technical language.
 */
function _friendlyMessage(msg) {
  if (!msg) return 'Please try again.';

  // Truncate to a reasonable display length
  const clean = msg.split('\n')[0].trim();
  if (clean.length > 120) return clean.slice(0, 117) + '…';
  return clean;
}
