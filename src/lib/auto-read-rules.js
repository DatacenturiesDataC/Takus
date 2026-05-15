// Takus — Auto-Read Rules Engine
//
// Evaluates whether a new recording should be auto-processed (skipping the inbox)
// based on user-defined rules. Rules are stored as JSON in settings.
//
// Rule format:
// { field: 'type'|'source'|'title', operator: 'equals'|'contains', value: string, enabled: boolean }

import { getSettings, saveAndCache } from './settings-store.js';

// ── Rule Schema ────────────────────────────────────────────────────────────

/**
 * @typedef {object} AutoReadRule
 * @property {string} id - Unique rule ID
 * @property {'type'|'source'|'title'|'participant'} field - Field to match against
 * @property {'equals'|'contains'|'startsWith'} operator - Match operator
 * @property {string} value - Value to match
 * @property {boolean} enabled - Whether the rule is active
 * @property {string} [label] - Human-readable description
 */

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Get all configured Auto-Read rules.
 * @returns {AutoReadRule[]}
 */
export function getAutoReadRules() {
  const raw = getSettings().autoReadRules || '[]';
  try {
    const rules = JSON.parse(raw);
    return Array.isArray(rules) ? rules : [];
  } catch {
    return [];
  }
}

/**
 * Save the Auto-Read rules array to settings.
 * @param {AutoReadRule[]} rules
 */
export function saveAutoReadRules(rules) {
  saveAndCache('autoReadRules', JSON.stringify(rules));
}

/**
 * Add a new Auto-Read rule.
 * @param {Partial<AutoReadRule>} rule
 * @returns {AutoReadRule} The created rule with generated ID
 */
export function addAutoReadRule(rule) {
  const rules = getAutoReadRules();
  const newRule = {
    id: `ar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    field: rule.field || 'type',
    operator: rule.operator || 'equals',
    value: rule.value || '',
    enabled: rule.enabled !== false,
    label: rule.label || '',
  };
  rules.push(newRule);
  saveAutoReadRules(rules);
  return newRule;
}

/**
 * Remove an Auto-Read rule by ID.
 * @param {string} ruleId
 */
export function removeAutoReadRule(ruleId) {
  const rules = getAutoReadRules().filter(r => r.id !== ruleId);
  saveAutoReadRules(rules);
}

/**
 * Toggle an Auto-Read rule's enabled state.
 * @param {string} ruleId
 */
export function toggleAutoReadRule(ruleId) {
  const rules = getAutoReadRules();
  const rule = rules.find(r => r.id === ruleId);
  if (rule) {
    rule.enabled = !rule.enabled;
    saveAutoReadRules(rules);
  }
}

/**
 * Evaluate whether a recording matches any active Auto-Read rule.
 * If a match is found, the recording should skip the inbox and be processed immediately.
 *
 * @param {object} recording - Recording entry (or metadata)
 * @returns {{ shouldProcess: boolean, matchedRule?: AutoReadRule }}
 */
export function shouldAutoProcess(recording) {
  const rules = getAutoReadRules().filter(r => r.enabled);
  if (!rules.length) return { shouldProcess: false };

  for (const rule of rules) {
    const fieldValue = _getFieldValue(recording, rule.field);
    if (fieldValue === null) continue;

    const matched = _matchValue(fieldValue, rule.operator, rule.value);
    if (matched) {
      return { shouldProcess: true, matchedRule: rule };
    }
  }

  return { shouldProcess: false };
}

// ── Default Rule Presets ───────────────────────────────────────────────────

/**
 * Get suggested Auto-Read rule presets that the user can enable.
 * @returns {Array<Partial<AutoReadRule> & { description: string }>}
 */
export function getAutoReadPresets() {
  return [
    {
      field: 'type', operator: 'equals', value: 'meeting',
      label: 'Auto-process meetings',
      description: 'Process all meeting recordings immediately (transcribe + summarize)',
    },
    {
      field: 'type', operator: 'equals', value: 'update',
      label: 'Auto-process updates',
      description: 'Process status update recordings immediately',
    },
    {
      field: 'title', operator: 'contains', value: 'standup',
      label: 'Auto-process standups',
      description: 'Process recordings with "standup" in the title',
    },
    {
      field: 'source', operator: 'equals', value: 'auto-record',
      label: 'Auto-process calendar recordings',
      description: 'Process recordings triggered by the auto-record engine',
    },
  ];
}

// ── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Extract the value of a field from a recording for rule matching.
 */
function _getFieldValue(recording, field) {
  switch (field) {
    case 'type':
      return (recording.type || 'screen').toLowerCase();
    case 'source':
      return (recording.source || recording.sourceType || '').toLowerCase();
    case 'title':
      return (recording.title || '').toLowerCase();
    case 'participant': {
      // Concatenate all participant emails/names for matching
      const parts = recording.participants || [];
      return parts.map(p => typeof p === 'string' ? p : (p.email || p.name || '')).join(' ').toLowerCase();
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
