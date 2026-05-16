// Takus — Daily Digest Generator (Knowledge OS: Intelligence Layer)
// Aggregates the user's current state into a structured "Today" summary.
// Pure computation — no side effects, no network calls.

import { getRecordings, getContacts, getNodesByType } from './storage.js';
import { computeTaskMetrics } from './analytics.js';
import { getTaskStatus, getTaskTitle } from './task-helpers.js';
import { getTaskLoadHealth, getMeetingFatigue, estimateFocusCapacity, getSessionDuration } from './wellbeing.js';
import { MS_PER_HOUR, MS_PER_DAY, MS_PER_WEEK } from './utils.js';

/**
 * @typedef {object} DailyDigest
 * @property {Array} upcomingMeetings   Meetings in the next 12 hours
 * @property {Array} overdueTasks       Pending tasks past their deadline
 * @property {Array} todayTasks         Tasks due today
 * @property {object} weekStats         This week's recording statistics
 * @property {number} streak            Consecutive days with recordings
 * @property {object} taskMetrics       Aggregate task completion metrics
 * @property {object} wellbeing         Wellbeing assessment (Phase 59)
 * @property {number} generatedAt       Timestamp
 */

/**
 * Generate a daily digest for the "Today" card.
 *
 * @param {Array}  calendarEvents  Upcoming NormalizedEvent[] (from calendar poller)
 * @param {object} options
 * @param {number}      options.lookAheadHours  Hours ahead to scan for meetings (default 12)
 * @param {Array|null}  options.recordings      Pre-loaded recordings to avoid duplicate DB read
 * @returns {Promise<DailyDigest>}
 */
export async function generateDailyDigest(calendarEvents = [], options = {}) {
  const lookAhead = (options.lookAheadHours || 12) * MS_PER_HOUR;
  const now = Date.now();

  let recordings, contacts;
  try {
    [recordings, contacts] = await Promise.all([
      options.recordings ? options.recordings : getRecordings(),
      getContacts(),
    ]);
  } catch (e) {
    console.warn('[DailyDigest] Failed to load data:', e.message);
    recordings = [];
    contacts = [];
  }

  // ── Upcoming meetings (next N hours) ──────────────────────────────────────
  const upcomingMeetings = calendarEvents
    .filter(ev => {
      if (ev.isAllDay || ev.status === 'cancelled') return false;
      const start = new Date(ev.start).getTime();
      return start > now && start <= now + lookAhead;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .map(ev => ({
      title: ev.title,
      start: ev.start,
      end: ev.end,
      attendeeCount: ev.attendeeCount || (ev.attendees?.length || 0),
      conferenceUrl: ev.conferenceUrl,
      hasPreviousContext: _hasPreviousRecordingsWith(ev, recordings),
    }));

  // ── Task analysis ─────────────────────────────────────────────────────────
  const { overdueTasks, todayTasks } = _categorizeTasks(recordings, now);
  const taskMetrics = computeTaskMetrics(recordings);

  // ── This week's stats ─────────────────────────────────────────────────────
  const weekStats = _computeWeekStats(recordings, now);

  // ── Recording streak ──────────────────────────────────────────────────────
  const streak = computeStreak(recordings, now);

  // ── Goal progress (platform-agnostic) ──────────────────────────────────────
  const goalProgress = await _getGoalProgress(now);

  // ── Wellbeing assessment (Phase 59) ────────────────────────────────────────
  const allTasks = _flattenTasks(recordings);
  const wellbeing = _computeWellbeing(goalProgress, allTasks, recordings);

  return {
    upcomingMeetings,
    overdueTasks,
    todayTasks,
    weekStats,
    streak,
    taskMetrics,
    goalProgress,
    wellbeing,
    generatedAt: now,
  };
}

/**
 * Compute consecutive-day recording streak ending at the reference date.
 * Exported for testability.
 *
 * @param {Array}  recordings  All recordings
 * @param {number} now         Reference timestamp
 * @returns {number}  Streak length in days
 */
export function computeStreak(recordings, now = Date.now()) {
  if (!recordings.length) return 0;

  // Get unique recording dates (YYYY-MM-DD)
  const dates = new Set();
  for (const r of recordings) {
    if (!r.date) continue;
    const d = new Date(r.date);
    dates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }

  if (dates.size === 0) return 0;

  // Walk backwards from today
  let streak = 0;
  const ref = new Date(now);

  // Check if today has a recording — if not, start from yesterday
  const todayKey = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(ref.getDate()).padStart(2, '0')}`;
  if (!dates.has(todayKey)) {
    ref.setDate(ref.getDate() - 1);
  }

  for (let i = 0; i < 365; i++) {
    const key = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(ref.getDate()).padStart(2, '0')}`;
    if (dates.has(key)) {
      streak++;
      ref.setDate(ref.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _hasPreviousRecordingsWith(calendarEvent, recordings) {
  const attendees = new Set(
    [...(calendarEvent.attendees || []), ...(calendarEvent.organizers || [])]
      .map(e => e.toLowerCase())
  );
  if (attendees.size === 0) return false;

  return recordings.some(r => {
    const recAttendees = [
      ...(r.calendarEvent?.attendees || []),
      ...(r.aiParticipants?.map(p => p.email).filter(Boolean) || []),
    ].map(e => e.toLowerCase());
    return recAttendees.some(e => attendees.has(e));
  });
}

function _categorizeTasks(recordings, now) {
  const overdueTasks = [];
  const todayTasks = [];
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  for (const rec of recordings) {
    const tasks = rec.tasks || {};
    for (const list of [tasks.takusTasks || [], tasks.meTasks || []]) {
      for (const task of list) {
        const status = getTaskStatus(task);
        if (status !== 'pending') continue;

        const deadlineStr = task.payload?.deadline || task.deadline;
        if (!deadlineStr) continue;

        // Try to parse deadline
        let deadline;
        if (typeof deadlineStr === 'number') {
          deadline = deadlineStr;
        } else if (typeof deadlineStr === 'string') {
          // Simple date detection
          const parsed = Date.parse(deadlineStr);
          if (!isNaN(parsed)) deadline = parsed;
        }

        if (!deadline) continue;

        const entry = {
          text: getTaskTitle(task),
          action: task.action || 'PERSONAL',
          assignee: task.assignee,
          deadline,
          recordingTitle: rec.title || 'Untitled',
          recordingId: rec.id,
        };

        if (deadline < todayStart.getTime()) {
          overdueTasks.push(entry);
        } else if (deadline <= todayEnd.getTime()) {
          todayTasks.push(entry);
        }
      }
    }
  }

  // Sort overdue by most overdue first
  overdueTasks.sort((a, b) => a.deadline - b.deadline);

  return { overdueTasks, todayTasks };
}

function _computeWeekStats(recordings, now) {
  const weekAgo = now - MS_PER_WEEK;

  const thisWeek = recordings.filter(r =>
    r.date && new Date(r.date).getTime() >= weekAgo
  );

  const totalDuration = thisWeek.reduce((sum, r) => sum + (r.duration || 0), 0);
  const totalSize = thisWeek.reduce((sum, r) => sum + (r.size || 0), 0);
  const withAI = thisWeek.filter(r => r.aiSummary).length;

  return {
    recordings: thisWeek.length,
    totalDuration,
    totalSize,
    withAI,
  };
}

/**
 * Get goal progress summary for the daily digest.
 * Shows recently mentioned goals and at-risk goals.
 * Platform-agnostic: goals from any source are included.
 */
async function _getGoalProgress(now) {
  try {
    const goals = await getNodesByType('goal');
    if (!goals.length) return { recentlyMentioned: [], atRisk: [], totalOpen: 0 };

    const dayMs = MS_PER_DAY;

    const openGoals = goals.filter(g => {
      const state = g.properties?.state || 'aspiration';
      return state === 'active' || state === 'at-risk' || state === 'aspiration';
    });

    // Goals mentioned in the last 24 hours
    const recentlyMentioned = openGoals
      .filter(g => g.properties?.lastMentionedAt && (now - g.properties.lastMentionedAt) < dayMs)
      .map(g => ({
        id: g.id,
        title: g.properties?.title || 'Untitled',
        state: g.properties?.state || 'aspiration',
        mentionCount: g.properties?.mentionCount || 0,
      }));

    // At-risk goals
    const atRisk = goals
      .filter(g => (g.properties?.state || 'aspiration') === 'at-risk')
      .map(g => ({
        id: g.id,
        title: g.properties?.title || 'Untitled',
        lastMentionedAt: g.properties?.lastMentionedAt || null,
      }));

    return {
      recentlyMentioned,
      atRisk,
      totalOpen: openGoals.length,
    };
  } catch {
    return { recentlyMentioned: [], atRisk: [], totalOpen: 0 };
  }
}

/**
 * Flatten embedded tasks from recordings into a simple array.
 * Used for wellbeing task-load checks.
 */
function _flattenTasks(recordings) {
  const tasks = [];
  for (const rec of recordings) {
    const t = rec.tasks || {};
    for (const list of [t.takusTasks || [], t.meTasks || []]) {
      for (const task of list) {
        tasks.push({
          id: task.id || `${rec.id}_${getTaskTitle(task, 'task').slice(0, 20)}`,
          status: getTaskStatus(task),
          text: getTaskTitle(task),
          dueDate: task.payload?.deadline ? Date.parse(task.payload.deadline) : null,
        });
      }
    }
  }
  return tasks;
}

/**
 * Compute wellbeing summary for the daily digest.
 * Gentle signals — not productivity metrics.
 *
 * @param {object} goalProgress - From _getGoalProgress
 * @param {Array} allTasks - Flattened tasks
 * @param {Array} recordings - All recordings
 * @returns {object}
 */
function _computeWellbeing(goalProgress, allTasks, recordings) {

  const taskHealth = getTaskLoadHealth(allTasks);
  const fatigue = getMeetingFatigue(recordings);
  const focus = estimateFocusCapacity({
    sessionDuration: getSessionDuration(),
    meetingCount: recordings.filter(r => r.type === 'meeting').length,
    pendingTasks: allTasks.filter(t => t.status === 'pending').length,
  });

  // Collect gentle suggestions (max 2 to avoid overwhelming)
  const suggestions = [];
  if (taskHealth.suggestion) suggestions.push(taskHealth.suggestion);
  if (fatigue.suggestion) suggestions.push(fatigue.suggestion);
  if (focus.level === 'low') suggestions.push(focus.suggestion);

  return {
    focusScore: focus.focusScore,
    focusLevel: focus.level,
    taskLoad: { pending: taskHealth.pendingCount, overdue: taskHealth.overdueCount, overloaded: taskHealth.overloaded },
    meetingFatigue: { recent: fatigue.recentMeetings, fatigued: fatigue.fatigued },
    suggestions: suggestions.slice(0, 2),
  };
}
