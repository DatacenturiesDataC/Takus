// Takus — ID Generator
// Single-source-of-truth for entity ID creation across the codebase.

/**
 * Generate a unique ID with a given prefix.
 * Format: `{prefix}_{timestamp}_{random6}`
 *
 * @param {string} prefix — e.g. 'rec', 'contact', 'step', 'wiki'
 * @returns {string}
 */
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
