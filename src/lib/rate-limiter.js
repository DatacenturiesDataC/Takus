
// Protects AI and external API calls from accidental abuse.
// Per-key sliding window with configurable limits.
//
// Design: Non-blocking. Returns { allowed, retryAfter } so callers
// can queue, skip, or show a user message — never silently drops.

/**
 * @typedef {object} RateLimitConfig
 * @property {number} maxRequests   Max requests in the window
 * @property {number} windowMs     Window duration in milliseconds
 */

/** @type {Map<string, number[]>} key → timestamp array */
const _windows = new Map();

/** @type {Map<string, RateLimitConfig>} */
const _configs = new Map();

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Configure a rate limit for a key.
 *
 * @param {string} key - Identifier (e.g., 'ai-engine', 'google-drive', 'openai')
 * @param {RateLimitConfig} config
 */
export function configureLimit(key, config) {
  _configs.set(key, { maxRequests: config.maxRequests, windowMs: config.windowMs });
}

/**
 * Check if a request is allowed under the rate limit.
 * Does NOT consume a slot — use `consume()` for that.
 *
 * @param {string} key
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
export function check(key) {
  const config = _configs.get(key);
  if (!config) return { allowed: true, remaining: Infinity, retryAfter: 0 };

  const now = Date.now();
  const timestamps = _prune(key, now, config.windowMs);
  const remaining = Math.max(0, config.maxRequests - timestamps.length);

  if (remaining > 0) {
    return { allowed: true, remaining, retryAfter: 0 };
  }

  // Calculate when the oldest entry expires
  const oldest = timestamps[0] || now;
  const retryAfter = Math.max(0, oldest + config.windowMs - now);
  return { allowed: false, remaining: 0, retryAfter };
}

/**
 * Consume a rate limit slot. Returns the same shape as check().
 * If not allowed, does NOT consume.
 *
 * @param {string} key
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
export function consume(key) {
  const result = check(key);
  if (!result.allowed) return result;

  const timestamps = _windows.get(key) || [];
  timestamps.push(Date.now());
  _windows.set(key, timestamps);

  return {
    allowed: true,
    remaining: result.remaining - 1,
    retryAfter: 0,
  };
}

/**
 * Wait until a slot is available, then consume it.
 * Useful for queue-based processing.
 *
 * @param {string} key
 * @param {number} [timeout=30000] - Max wait time in ms
 * @returns {Promise<{ allowed: boolean, waited: number }>}
 */
export async function waitAndConsume(key, timeout = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = consume(key);
    if (result.allowed) {
      return { allowed: true, waited: Date.now() - start };
    }

    // Wait for the retry period (capped at remaining timeout)
    const waitTime = Math.min(result.retryAfter, timeout - (Date.now() - start));
    if (waitTime <= 0) break;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  return { allowed: false, waited: Date.now() - start };
}

/**
 * Get current usage for a key.
 *
 * @param {string} key
 * @returns {{ used: number, limit: number, remaining: number, windowMs: number }}
 */
export function getUsage(key) {
  const config = _configs.get(key);
  if (!config) return { used: 0, limit: 0, remaining: 0, windowMs: 0 };

  const timestamps = _prune(key, Date.now(), config.windowMs);
  return {
    used: timestamps.length,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - timestamps.length),
    windowMs: config.windowMs,
  };
}

/**
 * Reset rate limit state for a key.
 * @param {string} key
 */
export function resetLimit(key) {
  _windows.delete(key);
}

/**
 * Reset all rate limit state.
 */
export function resetAllLimits() {
  _windows.clear();
  _configs.clear();
}

/**
 * Remove a rate limit configuration.
 * @param {string} key
 */
export function removeLimit(key) {
  _configs.delete(key);
  _windows.delete(key);
}

/**
 * Get all configured limits.
 * @returns {Array<{ key: string, config: RateLimitConfig }>}
 */
export function getAllLimits() {
  return [..._configs.entries()].map(([key, config]) => ({ key, ...config }));
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Prune expired timestamps from the window.
 * @returns {number[]} Active timestamps
 */
function _prune(key, now, windowMs) {
  const timestamps = _windows.get(key) || [];
  const cutoff = now - windowMs;
  const active = timestamps.filter(ts => ts > cutoff);
  _windows.set(key, active);
  return active;
}
