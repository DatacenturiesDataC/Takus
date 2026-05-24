// Takus — Task Priority Scoring (Knowledge OS: Intelligence Layer)
// Deterministic priority scoring for AI-extracted tasks.
// No network calls — pure computation over local data.

import { computeClosenessScore } from './closeness-score.js';
import { getTaskStatus } from './task-helpers.js';
import { getScoringAdjustments } from './preference-engine.js';

// ── Action weights ────────────────────────────────────────────────────────────
// Higher weight = more friction to complete → deserves higher priority visibility.
const ACTION_WEIGHTS = {
  JIRA:         90,
  GITHUB_ISSUE: 85,
  LINEAR:       85,
  NOTION:       75,
  SLACK_DM:     60,
  SLACK_CHANNEL:55,
  EMAIL:        50,
  GOOGLE_DOC:   40,
  PERSONAL:     20,
};

/**
 * Compute a 0–100 priority score for a single task.
 *
 * Formula:
 *   priority = deadlineUrgency(0.35) + requesterCloseness(0.25)
 *            + taskAge(0.20)         + actionWeight(0.20)
 *
 * @param {object} task           Task object with { title, action, status, payload?, doneAt? }
 * @param {object} entry      The entry this task was extracted from { date }
 * @param {Array}  contacts       All contacts from storage
 * @param {Array}  interactions   All interactions from storage
 * @returns {number} Priority score 0–100
 */
export async function computeTaskPriority(task, entry, contacts = [], interactions = []) {
  // Skip completed tasks
  const status = getTaskStatus(task);
  if (status === 'done' || status === 'ignored') return 0;

  const now = Date.now();

  // ── Deadline urgency (35%) ────────────────────────────────────────────────
  const deadlineScore = _computeDeadlineScore(task, now);

  // ── Requester closeness (25%) ─────────────────────────────────────────────
  const closenessScore = _computeRequesterCloseness(task, contacts, interactions);

  // ── Task age (20%) — older pending tasks score higher ─────────────────────
  const ageScore = _computeAgeScore(entry, now);

  // ── Action weight (20%) ───────────────────────────────────────────────────
  const action = (task.action || 'PERSONAL').toUpperCase();
  const actionScore = (ACTION_WEIGHTS[action] ?? ACTION_WEIGHTS.PERSONAL);

  // Weighted sum — use default weights, blended with user preferences if available
  const w = await _getBlendedWeights();
  const priority = Math.round(
    deadlineScore   * w.deadline +
    closenessScore  * w.closeness +
    ageScore        * w.age +
    actionScore     * w.routing
  );

  return Math.min(100, Math.max(0, priority));
}

// Cached weights — refresh at most once per 60s to avoid hammering IDB
let _cachedWeights = null;
let _weightsCacheTime = 0;
const WEIGHTS_CACHE_TTL = 60_000;

async function _getBlendedWeights() {
  const now = Date.now();
  if (_cachedWeights && now - _weightsCacheTime < WEIGHTS_CACHE_TTL) return _cachedWeights;

  const DEFAULTS = { deadline: 0.35, closeness: 0.25, age: 0.20, routing: 0.20 };
  try {
    const adj = await getScoringAdjustments();
    if (!adj.hasEnoughData) {
      _cachedWeights = DEFAULTS;
    } else {
      // Blend: 70% defaults + 30% user preferences
      _cachedWeights = {
        deadline:  0.7 * DEFAULTS.deadline  + 0.3 * adj.deadlineWeight,
        closeness: 0.7 * DEFAULTS.closeness + 0.3 * adj.closenessWeight,
        age:       0.7 * DEFAULTS.age       + 0.3 * adj.ageWeight,
        routing:   0.7 * DEFAULTS.routing   + 0.3 * adj.routingWeight,
      };
    }
  } catch { /* non-critical */
    _cachedWeights = DEFAULTS;
  }
  _weightsCacheTime = now;
  return _cachedWeights;
}

/**
 * Batch-prioritize tasks from the graph store.
 * Returns a flat array of { task, priority } sorted by priority descending.
 *
 * @param {Array} tasks         Pre-loaded tasks from task-store
 * @param {Array} contacts      All contacts
 * @param {Array} interactions  All interactions
 * @returns {Array<{ task: object, priority: number }>}
 */
export async function prioritizeTasks(tasks, contacts = [], interactions = []) {
  const scored = [];

  for (const task of tasks) {
    const status = task.status || 'pending';
    if (status === 'done' || status === 'ignored') continue;

    const priority = await computeTaskPriority(task, { date: task.createdAt }, contacts, interactions);
    scored.push({ task, priority });
  }

  scored.sort((a, b) => b.priority - a.priority);
  return scored;
}

/**
 * Return a priority tier label for display.
 * @param {number} score  Priority score 0–100
 * @returns {'critical'|'high'|'medium'|'low'}
 */
export function getPriorityTier(score) {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Parse a free-text deadline into a timestamp, if possible.
 * Handles: "today", "tomorrow", "by Friday", "2026-05-15", "end of week", "next Monday".
 * Returns null if unparseable.
 */
export function parseDeadline(text, referenceDate = new Date()) {
  if (!text || typeof text !== 'string') return null;

  const lower = text.toLowerCase().trim();
  const ref = new Date(referenceDate);
  ref.setHours(23, 59, 59, 999); // end of day

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(lower)) {
    const d = new Date(lower);
    if (!isNaN(d.getTime())) return d.getTime();
  }

  // Relative keywords
  if (lower === 'today' || lower === 'eod' || lower === 'end of day') {
    return ref.getTime();
  }
  if (lower === 'tomorrow') {
    ref.setDate(ref.getDate() + 1);
    return ref.getTime();
  }
  if (lower === 'end of week' || lower === 'eow') {
    const daysToFri = (5 - ref.getDay() + 7) % 7;
    ref.setDate(ref.getDate() + daysToFri);
    return ref.getTime();
  }
  if (lower === 'next week') {
    ref.setDate(ref.getDate() + 7);
    return ref.getTime();
  }

  // "by <day>" pattern
  const dayMatch = lower.match(/(?:by|before|until)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (dayMatch) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = dayNames.indexOf(dayMatch[1]);
    if (targetDay >= 0) {
      let daysAhead = (targetDay - ref.getDay() + 7) % 7;
      if (daysAhead === 0) daysAhead = 7; // "by Friday" on a Friday means next Friday
      ref.setDate(ref.getDate() + daysAhead);
      return ref.getTime();
    }
  }

  return null;
}

function _computeDeadlineScore(task, now) {
  let deadline = null;

  // Try structured deadline first
  if (task.deadline && typeof task.deadline === 'number') {
    deadline = task.deadline;
  } else if (task.payload?.deadline) {
    deadline = parseDeadline(task.payload.deadline);
  }

  if (!deadline) return 30; // No deadline → moderate baseline

  const hoursRemaining = (deadline - now) / (1000 * 60 * 60);

  if (hoursRemaining < 0)  return 100; // Overdue
  if (hoursRemaining < 24) return 90;  // Due today
  if (hoursRemaining < 48) return 70;  // Due tomorrow
  if (hoursRemaining < 168) return 40; // Due this week
  return 10;                            // Due later
}

function _computeRequesterCloseness(task, contacts, interactions) {
  // Try to find the requester in contacts
  const assignee = task.assignee || task.payload?.assignee;
  if (!assignee || contacts.length === 0) return 30; // Unknown → moderate

  const contact = contacts.find(c =>
    c.name?.toLowerCase() === assignee.toLowerCase() ||
    c.email?.toLowerCase() === assignee.toLowerCase()
  );

  if (!contact) return 20; // Not in contacts

  const contactInteractions = interactions.filter(i => i.contactId === contact.id);
  return computeClosenessScore(contact, contactInteractions);
}

function _computeAgeScore(entry, now) {
  if (!entry?.date) return 30;

  const ageHours = (now - new Date(entry.date).getTime()) / (1000 * 60 * 60);

  if (ageHours > 168) return 80; // >1 week old
  if (ageHours > 72)  return 60; // >3 days
  if (ageHours > 24)  return 40; // >1 day
  return 20;                      // Fresh
}
