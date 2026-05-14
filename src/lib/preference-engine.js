// Takus — Preference Engine (Knowledge OS: Adaptive Intelligence)
// Records user behavior signals and aggregates them into preferences
// that adjust AI prompts, task scoring weights, and system behavior.
//
// This is the "reinforcement learning" layer for a browser-first PWA:
// instead of gradient-based training, we collect behavioral signals
// and use them to parameterize prompts and scoring functions.
//
// Pure computation + IDB persistence. No network calls.

import { getSetting, saveSetting } from './storage.js';

// ── Signal Types ────────────────────────────────────────────────────────────

/**
 * @typedef {'TASK_ACCEPTED'|'TASK_IGNORED'|'TASK_EDITED'|'SUMMARY_EDITED'|'SEARCH_CLICKED'|'SEARCH_REFINED'|'PRIORITY_OVERRIDE'} SignalType
 */

/**
 * @typedef {object} Signal
 * @property {SignalType} type
 * @property {number}     timestamp
 * @property {object}     metadata   Type-specific data
 */

const STORAGE_KEY = 'preference_signals';
const MAX_SIGNALS = 500;
const MIN_SIGNALS_FOR_ADAPTATION = 10;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a user behavior signal.
 *
 * @param {SignalType} type
 * @param {object}     metadata  Signal-specific data
 * @returns {Promise<void>}
 */
export async function recordSignal(type, metadata = {}) {
  const signals = await _loadSignals();
  signals.unshift({
    type,
    timestamp: Date.now(),
    metadata,
  });

  // LRU cap: keep only the most recent MAX_SIGNALS
  if (signals.length > MAX_SIGNALS) {
    signals.length = MAX_SIGNALS;
  }

  await saveSetting(STORAGE_KEY, signals);
}

/**
 * Get all recorded signals, optionally filtered by type.
 *
 * @param {SignalType} [type]  Filter by signal type
 * @returns {Promise<Signal[]>}
 */
export async function getSignals(type) {
  const signals = await _loadSignals();
  if (!type) return signals;
  return signals.filter(s => s.type === type);
}

/**
 * Get aggregated prompt preferences based on accumulated signals.
 * Used by ai-engine.js to adapt prompt construction.
 *
 * @param {string} [recordingType]  Optional recording type filter ('meeting', 'screen', etc.)
 * @returns {Promise<PromptPreferences>}
 */
export async function getPromptPreferences(recordingType) {
  const signals = await _loadSignals();

  // Count task feedback signals
  const taskAccepted = signals.filter(s => s.type === 'TASK_ACCEPTED');
  const taskIgnored = signals.filter(s => s.type === 'TASK_IGNORED');
  const summaryEdited = signals.filter(s => s.type === 'SUMMARY_EDITED');

  // Determine summary style preference
  // If user frequently edits summaries → they want more detail
  const recentEdits = summaryEdited.filter(s =>
    !recordingType || s.metadata.recordingType === recordingType
  );
  const summaryStyle = recentEdits.length >= 3 ? 'detailed' : 'concise';

  // Determine which task actions the user prefers vs ignores
  const actionCounts = {};
  const ignoredActions = {};

  for (const s of taskAccepted) {
    const action = s.metadata.action || 'UNKNOWN';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  }
  for (const s of taskIgnored) {
    const action = s.metadata.action || 'UNKNOWN';
    ignoredActions[action] = (ignoredActions[action] || 0) + 1;
  }

  // Actions ignored more than accepted → deprioritize
  const deprioritized = Object.keys(ignoredActions).filter(action =>
    (ignoredActions[action] || 0) > (actionCounts[action] || 0)
  );

  // Top preferred actions (accepted more than ignored)
  const preferred = Object.entries(actionCounts)
    .filter(([action]) => !deprioritized.includes(action))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([action]) => action);

  return {
    summaryStyle,
    taskFocus: preferred,
    ignoredActions: deprioritized,
    totalSignals: signals.length,
    hasEnoughData: signals.length >= MIN_SIGNALS_FOR_ADAPTATION,
  };
}

/**
 * @typedef {object} PromptPreferences
 * @property {'detailed'|'concise'} summaryStyle
 * @property {string[]}             taskFocus       Top preferred task actions
 * @property {string[]}             ignoredActions  Consistently ignored task actions
 * @property {number}               totalSignals
 * @property {boolean}              hasEnoughData   True when ≥ MIN_SIGNALS signals exist
 */

/**
 * Get scoring weight adjustments based on user behavior.
 * Used by task-priority.js to blend user preferences with defaults.
 *
 * @returns {Promise<ScoringAdjustments>}
 */
export async function getScoringAdjustments() {
  const signals = await _loadSignals();

  const overrides = signals.filter(s => s.type === 'PRIORITY_OVERRIDE');
  const accepted = signals.filter(s => s.type === 'TASK_ACCEPTED');

  if (overrides.length + accepted.length < MIN_SIGNALS_FOR_ADAPTATION) {
    return _defaultWeights();
  }

  // Analyze which factors correlate with user acceptance
  let deadlineSignal = 0;
  let closenessSignal = 0;
  let ageSignal = 0;
  let routingSignal = 0;

  for (const s of accepted) {
    const m = s.metadata;
    if (m.hadDeadline) deadlineSignal++;
    if (m.closenessScore > 65) closenessSignal++;
    if (m.ageHours > 48) ageSignal++;
    if (m.wasRouted) routingSignal++;
  }

  const total = accepted.length || 1;

  // Normalize to weights that sum to ~1.0
  const raw = {
    deadline: deadlineSignal / total,
    closeness: closenessSignal / total,
    age: ageSignal / total,
    routing: routingSignal / total,
  };

  const sum = raw.deadline + raw.closeness + raw.age + raw.routing || 1;

  return {
    deadlineWeight: raw.deadline / sum,
    closenessWeight: raw.closeness / sum,
    ageWeight: raw.age / sum,
    routingWeight: raw.routing / sum,
    hasEnoughData: true,
  };
}

/**
 * @typedef {object} ScoringAdjustments
 * @property {number}  deadlineWeight   0–1
 * @property {number}  closenessWeight  0–1
 * @property {number}  ageWeight        0–1
 * @property {number}  routingWeight    0–1
 * @property {boolean} hasEnoughData
 */

/**
 * Clear all preference signals (useful for testing / reset).
 * @returns {Promise<void>}
 */
export async function clearSignals() {
  await saveSetting(STORAGE_KEY, []);
}

// ── Internal ────────────────────────────────────────────────────────────────

function _defaultWeights() {
  return {
    deadlineWeight: 0.35,
    closenessWeight: 0.25,
    ageWeight: 0.20,
    routingWeight: 0.20,
    hasEnoughData: false,
  };
}

async function _loadSignals() {
  try {
    const raw = await getSetting(STORAGE_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
