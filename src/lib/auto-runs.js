// Takus — Auto-Runs Engine
//
// Evaluates whether a new item should be auto-processed (skipping the inbox)
// based on user-defined automation rules. Rules are stored as JSON in settings.
//
// Renamed from "Auto-Read Rules" in Phase 25 — "Auto-Runs" is platform-agnostic;
// any app can contribute automation rules, not just the Recorder.
//
// Rule format:
// { field: 'type'|'source'|'title'|'participant'|'tag', operator: 'equals'|'contains'|'startsWith',
//   value: string, enabled: boolean, appId?: string }

import { getSettings, saveAndCache } from './settings-store.js';
import { generateId } from './id.js';

// ── Rule Schema ────────────────────────────────────────────────────────────

/**
 * @typedef {object} AutoRunRule
 * @property {string} id - Unique rule ID
 * @property {'type'|'source'|'title'|'participant'|'tag'} field - Field to match against
 * @property {'equals'|'contains'|'startsWith'} operator - Match operator
 * @property {string} value - Value to match
 * @property {boolean} enabled - Whether the rule is active
 * @property {string} [label] - Human-readable description
 * @property {string} [appId] - Contributing app ID (for traceability)
 */

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Get all configured Auto-Run rules.
 * Reads from the `autoRuns` settings key, with backward compatibility
 * for the legacy `autoReadRules` key.
 * @returns {AutoRunRule[]}
 */
export function getAutoRuns() {
  const settings = getSettings();
  // Prefer new key, fall back to legacy key for backward compatibility
  const raw = settings.autoRuns || settings.autoReadRules || '[]';
  try {
    const rules = JSON.parse(raw);
    return Array.isArray(rules) ? rules : [];
  } catch {
    return [];
  }
}

/**
 * Save the Auto-Run rules array to settings.
 * @param {AutoRunRule[]} rules
 */
export function saveAutoRuns(rules) {
  saveAndCache('autoRuns', JSON.stringify(rules));
}

/**
 * Add a new Auto-Run rule.
 * @param {Partial<AutoRunRule>} rule
 * @returns {AutoRunRule} The created rule with generated ID
 */
export function addAutoRun(rule) {
  const rules = getAutoRuns();
  const newRule = {
    id: generateId('ar'),
    field: rule.field || 'type',
    operator: rule.operator || 'equals',
    value: rule.value || '',
    enabled: rule.enabled !== false,
    label: rule.label || '',
    appId: rule.appId || '',
  };
  rules.push(newRule);
  saveAutoRuns(rules);
  return newRule;
}

/**
 * Remove an Auto-Run rule by ID.
 * @param {string} ruleId
 */
export function removeAutoRun(ruleId) {
  const rules = getAutoRuns().filter(r => r.id !== ruleId);
  saveAutoRuns(rules);
}

/**
 * Toggle an Auto-Run rule's enabled state.
 * @param {string} ruleId
 */
export function toggleAutoRun(ruleId) {
  const rules = getAutoRuns();
  const rule = rules.find(r => r.id === ruleId);
  if (rule) {
    rule.enabled = !rule.enabled;
    saveAutoRuns(rules);
  }
}

/**
 * Evaluate whether an item matches any active Auto-Run rule.
 * If a match is found, the item should skip the inbox and be processed immediately.
 *
 * @param {object} item - Entry, document, or any node metadata
 * @returns {{ shouldProcess: boolean, matchedRule?: AutoRunRule }}
 */
export function evaluateAutoRuns(item) {
  const rules = getAutoRuns().filter(r => r.enabled);
  if (!rules.length) return { shouldProcess: false };

  for (const rule of rules) {
    let matched = false;

    if (rule.field === 'tag') {
      // Tags are matched individually — any tag matching is sufficient
      const tags = (item.tags || []).map(t => t.toLowerCase());
      const val = rule.value.toLowerCase();
      matched = tags.some(tag => _matchValue(tag, rule.operator, val));
    } else {
      const fieldValue = _getFieldValue(item, rule.field);
      if (fieldValue === null) continue;
      matched = _matchValue(fieldValue, rule.operator, rule.value);
    }

    if (matched) {
      return { shouldProcess: true, matchedRule: rule };
    }
  }

  return { shouldProcess: false };
}
// ── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Extract the value of a field from an item for rule matching.
 */
function _getFieldValue(item, field) {
  switch (field) {
    case 'type':
      return (item.type || '').toLowerCase();
    case 'source':
      return (item.source || item.sourceType || '').toLowerCase();
    case 'title':
      return (item.title || '').toLowerCase();
    case 'participant': {
      // Concatenate all participant emails/names for matching
      const parts = item.participants || [];
      return parts.map(p => typeof p === 'string' ? p : (p.email || p.name || '')).join(' ').toLowerCase();
    }
    case 'tag': {
      // Concatenate all tags for matching
      const tags = item.tags || [];
      return tags.join(' ').toLowerCase();
    }
    default:
      return null;
  }
}

/**
 * Check if a field value matches a rule's operator and value.
 */
function _matchValue(fieldValue, operator, ruleValue) {
  const val = ruleValue.toLowerCase();
  switch (operator) {
    case 'equals':
      return fieldValue === val;
    case 'contains':
      return fieldValue.includes(val);
    case 'startsWith':
      return fieldValue.startsWith(val);
    default:
      return false;
  }
}
