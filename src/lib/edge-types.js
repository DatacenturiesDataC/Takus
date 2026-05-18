// Takus — Edge Type Registry
// Centralized edge type definitions used across the knowledge graph UI.
// Single source of truth for icons, labels, and colors.

/**
 * @typedef {object} EdgeTypeConfig
 * @property {string} icon - Emoji icon for the edge type
 * @property {string} label - Human-readable label
 * @property {string} color - Hex color for charts/bars
 * @property {string} cssVar - CSS variable reference for themed contexts
 */

/** @type {Record<string, EdgeTypeConfig>} */
export const EDGE_TYPES = {
  PARTICIPATED_IN: { icon: '👤', label: 'Participants', color: '#8b5cf6', cssVar: 'var(--color-info)' },
  HAS_TASK:        { icon: '✅', label: 'Tasks',        color: '#10b981', cssVar: 'var(--color-success)' },
  SIMILAR_TO:      { icon: '🔗', label: 'Similar',      color: '#3b82f6', cssVar: 'var(--color-primary-light)' },
  MENTIONED_IN:    { icon: '💬', label: 'Mentioned',    color: '#f59e0b', cssVar: 'var(--color-warning)' },
  ASSIGNED_TO:     { icon: '🎯', label: 'Assigned',     color: '#ec4899', cssVar: 'var(--color-danger)' },
  DERIVED_FROM:    { icon: '📎', label: 'Derived',      color: '#6366f1', cssVar: 'var(--color-primary)' },
  NEXT_STEP:       { icon: '➡️', label: 'Next Step',    color: '#14b8a6', cssVar: 'var(--color-success)' },
  BLOCKS:          { icon: '🚫', label: 'Blocks',       color: '#ef4444', cssVar: 'var(--color-danger)' },
  MENTIONS:        { icon: '🔖', label: 'Mentions',     color: '#a855f7', cssVar: 'var(--color-info)' },
  // Goal Preservation edge types
  CONTRIBUTES_TO:  { icon: '🎯', label: 'Contributes To', color: '#8b5cf6', cssVar: 'var(--color-primary)' },
  SUPPORTS:        { icon: '🤝', label: 'Supports',       color: '#10b981', cssVar: 'var(--color-success)' },
  INVOLVES:        { icon: '👥', label: 'Involves',        color: '#f59e0b', cssVar: 'var(--color-warning)' },
};

/** Default config for unrecognized edge types */
const _DEFAULT = { icon: '·', label: 'Unknown', color: '#6b7280', cssVar: 'var(--color-text-muted)' };

/**
 * Get the display config for an edge type.
 * Returns a default config for unrecognized types.
 *
 * @param {string} type - Edge type key (e.g. 'PARTICIPATED_IN')
 * @returns {EdgeTypeConfig}
 */
export function getEdgeTypeConfig(type) {
  return EDGE_TYPES[type] || {
    ..._DEFAULT,
    label: type.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  };
}

/**
 * Get all registered edge type keys.
 * @returns {string[]}
 */
export function getEdgeTypeKeys() {
  return Object.keys(EDGE_TYPES);
}

/**
 * Register a custom edge type at runtime.
 * Used by apps to extend the knowledge graph with their own relationship types.
 *
 * @param {string} type - Edge type key (e.g. 'PRODUCED_BY')
 * @param {EdgeTypeConfig} config
 */
export function addEdgeType(type, config) {
  if (!type || !config) return;
  EDGE_TYPES[type] = {
    icon: config.icon || '·',
    label: config.label || type,
    color: config.color || '#6b7280',
    cssVar: config.cssVar || 'var(--color-text-muted)',
  };
}
