// Takus — Blind Spot Detector (Knowledge OS: Confirmation Bias Countermeasure)
// Analyzes user behavior patterns to surface things they may be ignoring.
// Pure computation — no side effects, no network calls.

/**
 * @typedef {object} BlindSpot
 * @property {'ignored_category'|'single_source'|'stale_contact'|'recency_bias'} type
 * @property {string}  message     Human-readable description
 * @property {'info'|'warning'} severity
 * @property {object}  [data]      Supporting data for UI rendering
 */

import { isTaskPending } from './task-helpers.js';
import { MS_PER_DAY, MS_PER_WEEK } from './utils.js';

/**
 * Detect blind spots in the user's knowledge work patterns.
 *
 * @param {Array}  entries     All entries from IDB
 * @param {Array}  signals        Preference signals from preference-engine
 * @param {Array}  [contacts]     Contact list (for stale contact detection)
 * @returns {BlindSpot[]}
 */
export function detectBlindSpots(entries = [], signals = [], contacts = []) {
  const spots = [];

  spots.push(..._detectIgnoredCategories(signals));
  spots.push(..._detectSingleSource(entries));
  spots.push(..._detectStaleContacts(contacts, entries));
  spots.push(..._detectRecencyBias(entries, signals));

  return spots;
}

// ── Detectors ───────────────────────────────────────────────────────────────

/**
 * Detect task action categories that the user consistently ignores.
 * Signals confirmation bias: user only acts on familiar task types.
 */
function _detectIgnoredCategories(signals) {
  const spots = [];
  const accepted = {};
  const ignored = {};

  for (const s of signals) {
    if (s.type === 'TASK_ACCEPTED') {
      const action = s.metadata?.action || 'UNKNOWN';
      accepted[action] = (accepted[action] || 0) + 1;
    }
    if (s.type === 'TASK_IGNORED') {
      const action = s.metadata?.action || 'UNKNOWN';
      ignored[action] = (ignored[action] || 0) + 1;
    }
  }

  for (const [action, count] of Object.entries(ignored)) {
    const acceptedCount = accepted[action] || 0;
    // Only flag if ignored at least 3 times and more than accepted
    if (count >= 3 && count > acceptedCount) {
      const labels = {
        'FOLLOW_UP': 'follow-up tasks',
        'LOG_DECISION': 'decision logging',
        'CREATE_BUG_REPORT': 'bug reports',
        'DRAFT_SHARE_MESSAGE': 'sharing messages',
        'UPDATE_TICKET': 'ticket updates',
        'DRAFT_SLACK_MESSAGE': 'Slack messages',
        'CREATE_CALENDAR_EVENT': 'calendar events',
      };
      const label = labels[action] || action.toLowerCase().replace(/_/g, ' ');
      spots.push({
        type: 'ignored_category',
        message: `You've ignored ${count} ${label}. These may contain important commitments worth reviewing.`,
        severity: count >= 5 ? 'warning' : 'info',
        data: { action, ignoredCount: count, acceptedCount },
      });
    }
  }

  return spots;
}

/**
 * Detect if the user's recent activity is concentrated on very few entries.
 * Signals tunnel vision: knowledge is drawn from a narrow base.
 */
function _detectSingleSource(entries) {
  const spots = [];
  if (entries.length < 5) return spots;

  // Check if 80%+ of AI-processed entries are from the same type
  const withAI = entries.filter(r => r.aiSummary);
  if (withAI.length < 5) return spots;

  const typeCounts = {};
  for (const r of withAI) {
    const t = r.type || 'screen';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  const total = withAI.length;
  for (const [type, count] of Object.entries(typeCounts)) {
    const ratio = count / total;
    if (ratio >= 0.8 && total >= 5) {
      spots.push({
        type: 'single_source',
        message: `${Math.round(ratio * 100)}% of your entries are "${type}" type. Consider capturing different formats for broader knowledge coverage.`,
        severity: 'info',
        data: { dominantType: type, ratio, total },
      });
    }
  }

  return spots;
}

/**
 * Detect high-closeness contacts with no recent interaction.
 * Signals relationship neglect: important connections going cold.
 */
function _detectStaleContacts(contacts, entries) {
  const spots = [];
  if (!contacts.length) return spots;

  const now = Date.now();
  const STALE_THRESHOLD_MS = 30 * MS_PER_DAY; // 30 days

  // Build a set of emails from recent entries
  const recentEmails = new Set();
  for (const r of entries) {
    if (!r.date || now - new Date(r.date).getTime() > STALE_THRESHOLD_MS) continue;
    const attendees = r.calendarEvent?.attendees || [];
    for (const e of attendees) recentEmails.add(e.toLowerCase());
  }

  // Find high-closeness contacts not seen recently
  const closeContacts = contacts.filter(c =>
    c.closenessScore >= 65 && c.email && !recentEmails.has(c.email.toLowerCase())
  );

  if (closeContacts.length > 0) {
    const names = closeContacts.slice(0, 3).map(c => c.name || c.email);
    spots.push({
      type: 'stale_contact',
      message: `${closeContacts.length} close contact${closeContacts.length > 1 ? 's haven\'t' : ' hasn\'t'} appeared in entries for 30+ days: ${names.join(', ')}${closeContacts.length > 3 ? '...' : ''}.`,
      severity: 'warning',
      data: { contacts: closeContacts.map(c => ({ name: c.name, email: c.email, score: c.closenessScore })) },
    });
  }

  return spots;
}

/**
 * Detect if the user only reviews/acts on very recent tasks.
 * Signals recency bias: older commitments are being forgotten.
 */
function _detectRecencyBias(entries, signals) {
  const spots = [];

  // Check tasks across entries
  const allTasks = [];
  for (const r of entries) {
    const tasks = r.tasks || { takusTasks: [], meTasks: [] }; // legacy compat
    for (const list of [tasks.takusTasks || [], tasks.meTasks || []]) {
      for (const task of list) {
        allTasks.push({ ...task, entryDate: r.date });
      }
    }
  }

  if (allTasks.length < 5) return spots;

  // Find pending tasks older than 7 days
  const now = Date.now();
  const WEEK_MS = MS_PER_WEEK;
  const oldPending = allTasks.filter(t =>
    isTaskPending(t) &&
    t.entryDate &&
    now - new Date(t.entryDate).getTime() > WEEK_MS
  );

  const recentPending = allTasks.filter(t =>
    isTaskPending(t) &&
    t.entryDate &&
    now - new Date(t.entryDate).getTime() <= WEEK_MS
  );

  // If there are significantly more old pending than recent, flag it
  if (oldPending.length >= 3 && oldPending.length > recentPending.length) {
    spots.push({
      type: 'recency_bias',
      message: `You have ${oldPending.length} pending tasks older than 7 days. Recent tasks may be getting attention while older commitments are forgotten.`,
      severity: oldPending.length >= 5 ? 'warning' : 'info',
      data: { oldCount: oldPending.length, recentCount: recentPending.length },
    });
  }

  return spots;
}
