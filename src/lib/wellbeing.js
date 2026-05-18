// Takus — Well-being Service (Phase 39 + Phase 59)
// Monitors work patterns and provides gentle, non-intrusive nudges
// aligned with human well-being — not productivity optimization.
//
// Mission: Goal Preservation in accordance with Human Well-being
//
// Principles:
//   - Gentle nudges, never urgency theater
//   - One-and-done reminders (no nagging)
//   - Goal overload awareness
//   - Task load awareness (Phase 59)
//   - Meeting fatigue detection (Phase 59)
//   - Respects user sovereignty — all suggestions are dismissible
//
// This is a pure service — no UI rendering. It emits events
// that the shell or apps can choose to surface.

import { MS_PER_HOUR, MS_PER_DAY } from './utils.js';

// ── Configuration ────────────────────────────────────────────────────────────

const SESSION_KEY = 'wellbeing_session';
const BREAK_THRESHOLD_MS = 2 * MS_PER_HOUR;   // 2 hours
const BREAK_COOLDOWN_MS = MS_PER_HOUR;         // Don't re-suggest for 1 hour after dismissal
const MAX_ACTIVE_GOALS_DEFAULT = 7;
const STAGNATION_THRESHOLD_DAYS = 7;
const MAX_PENDING_TASKS_DEFAULT = 15;           // Phase 59: task overload threshold
const MEETING_FATIGUE_THRESHOLD = 3;            // Phase 59: meetings in a 4-hour window
const MEETING_FATIGUE_WINDOW_MS = 4 * MS_PER_HOUR;

// ── State ────────────────────────────────────────────────────────────────────

let _sessionStart = null;
let _lastBreakSuggestion = 0;
let _listeners = [];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start tracking a work session.
 * Called once when Takus opens.
 */
export function startSession() {
  _sessionStart = Date.now();
  // Persist so we survive page reloads
  try {
    sessionStorage.setItem(SESSION_KEY, String(_sessionStart));
  } catch {}
}

/**
 * Get the current session duration in milliseconds.
 * Returns 0 if no session is active.
 * @returns {number}
 */
export function getSessionDuration() {
  if (!_sessionStart) {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) _sessionStart = Number(stored);
    } catch {}
  }
  if (!_sessionStart) return 0;
  return Date.now() - _sessionStart;
}

/**
 * Get a break suggestion, or null if none is warranted.
 * Rules:
 *   - Session > 2 hours → suggest a break
 *   - Only suggest once per cooldown period (no nagging)
 *   - Never use urgent/red styling — always calm and dismissible
 *
 * @returns {{ message: string, sessionMinutes: number } | null}
 */
export function getBreakSuggestion() {
  const duration = getSessionDuration();
  if (duration < BREAK_THRESHOLD_MS) return null;

  // Don't re-suggest within cooldown
  if (Date.now() - _lastBreakSuggestion < BREAK_COOLDOWN_MS) return null;

  const minutes = Math.floor(duration / 60000);
  _lastBreakSuggestion = Date.now();

  return {
    message: `You've been working for ${minutes} minutes. Consider taking a short break 🌿`,
    sessionMinutes: minutes,
  };
}

/**
 * Acknowledge a break (reset session timer).
 * Called when user takes a break or dismisses the suggestion.
 */
export function acknowledgeBreak() {
  _sessionStart = Date.now();
  try {
    sessionStorage.setItem(SESSION_KEY, String(_sessionStart));
  } catch {}
}

/**
 * Get goal health summary.
 * Returns overload signals and stagnation warnings.
 *
 * @param {Array} goals - Goal nodes from the graph store
 * @param {object} [options]
 * @param {number} [options.maxActive] - Max active goals before nudge (default 7)
 * @param {number} [options.stagnationDays] - Days without progress to flag (default 7)
 * @returns {{ activeCount: number, atRiskCount: number, overloaded: boolean, stagnant: boolean, suggestion: string|null }}
 */
export function getGoalHealth(goals = [], options = {}) {
  const maxActive = options.maxActive || MAX_ACTIVE_GOALS_DEFAULT;
  const stagnationMs = (options.stagnationDays || STAGNATION_THRESHOLD_DAYS) * MS_PER_DAY;
  const now = Date.now();

  const openGoals = goals.filter(g => {
    const state = g.properties?.state || g.state;
    return state === 'active' || state === 'at-risk' || state === 'aspiration';
  });

  const activeGoals = goals.filter(g => (g.properties?.state || g.state) === 'active');
  const atRiskGoals = goals.filter(g => (g.properties?.state || g.state) === 'at-risk');

  const overloaded = activeGoals.length > maxActive;

  // Check if ALL goals have been stagnant (no movement at all)
  const allStagnant = openGoals.length > 0 && openGoals.every(g => {
    const lastMention = g.properties?.lastMentionedAt || g.createdAt || 0;
    return now - lastMention > stagnationMs;
  });

  let suggestion = null;
  if (overloaded) {
    suggestion = `You have ${activeGoals.length} active goals. Consider focusing on 3–5 to make meaningful progress.`;
  } else if (allStagnant && openGoals.length > 0) {
    suggestion = `Your goals haven't seen activity in ${options.stagnationDays || STAGNATION_THRESHOLD_DAYS}+ days. Want to review them?`;
  }

  return {
    activeCount: activeGoals.length,
    atRiskCount: atRiskGoals.length,
    overloaded,
    stagnant: allStagnant,
    suggestion,
  };
}

// ── Phase 59: Task Load Awareness ────────────────────────────────────────────

/**
 * Check task load and return a well-being assessment.
 * This is NOT about productivity — it's about preventing cognitive overload.
 *
 * @param {Array} tasks - Task objects with status field
 * @param {object} [options]
 * @param {number} [options.maxPending] - Threshold for pending task overload (default 15)
 * @returns {{ pendingCount: number, overdueCount: number, overloaded: boolean, suggestion: string|null }}
 */
export function getTaskLoadHealth(tasks = [], options = {}) {
  const maxPending = options.maxPending || MAX_PENDING_TASKS_DEFAULT;

  const pending = tasks.filter(t => t.status === 'pending');
  const overdue = tasks.filter(t => {
    if (t.status !== 'pending') return false;
    return t.dueDate && t.dueDate < Date.now();
  });

  const overloaded = pending.length > maxPending;

  let suggestion = null;
  if (overloaded) {
    suggestion = `You have ${pending.length} pending tasks. Consider triaging — what can you delegate, defer, or drop?`;
  } else if (overdue.length > 3) {
    suggestion = `${overdue.length} tasks are overdue. It's okay to re-scope — adjust deadlines or mark as not needed.`;
  }

  return {
    pendingCount: pending.length,
    overdueCount: overdue.length,
    overloaded,
    suggestion,
  };
}

// ── Phase 59: Meeting Fatigue Detection ──────────────────────────────────────

/**
 * Detect meeting fatigue from entry patterns.
 * Flags when too many meetings happen within a window.
 *
 * @param {Array} entries - Entry objects with date and type fields
 * @param {object} [options]
 * @param {number} [options.threshold] - Max meetings in a window before nudge (default 3)
 * @param {number} [options.windowMs] - Time window in ms (default 4 hours)
 * @returns {{ recentMeetings: number, fatigued: boolean, suggestion: string|null }}
 */
export function getMeetingFatigue(entries = [], options = {}) {
  const threshold = options.threshold || MEETING_FATIGUE_THRESHOLD;
  const windowMs = options.windowMs || MEETING_FATIGUE_WINDOW_MS;
  const now = Date.now();

  const recentMeetings = entries.filter(r => {
    if (r.type !== 'meeting') return false;
    const ts = typeof r.date === 'number' ? r.date : new Date(r.date).getTime();
    return now - ts < windowMs;
  });

  const fatigued = recentMeetings.length >= threshold;

  let suggestion = null;
  if (fatigued) {
    suggestion = `${recentMeetings.length} meetings in the last ${Math.round(windowMs / MS_PER_HOUR)} hours. Consider blocking focus time 🧘`;
  }

  return {
    recentMeetings: recentMeetings.length,
    fatigued,
    suggestion,
  };
}

// ── Phase 59: Focus Time Estimation ──────────────────────────────────────────

/**
 * Estimate available focus time based on session and meeting patterns.
 * Helps users understand how much deep work time they have.
 *
 * @param {object} params
 * @param {number} params.sessionDuration - Current session duration in ms
 * @param {number} params.meetingCount - Meetings today
 * @param {number} params.pendingTasks - Pending tasks
 * @returns {{ focusScore: number, level: string, suggestion: string }}
 */
export function estimateFocusCapacity(params = {}) {
  const { sessionDuration = 0, meetingCount = 0, pendingTasks = 0 } = params;

  // Score from 0 (no focus capacity) to 100 (full capacity)
  let score = 100;

  // Long sessions reduce capacity
  const sessionHours = sessionDuration / MS_PER_HOUR;
  if (sessionHours > 4) score -= 30;
  else if (sessionHours > 2) score -= 15;

  // Meetings consume focus
  score -= meetingCount * 15;

  // High task load fragments attention
  if (pendingTasks > 20) score -= 25;
  else if (pendingTasks > 10) score -= 10;

  score = Math.max(0, Math.min(100, score));

  let level, suggestion;
  if (score >= 75) {
    level = 'high';
    suggestion = 'Good capacity for deep work. Consider tackling your most important task.';
  } else if (score >= 40) {
    level = 'medium';
    suggestion = 'Moderate capacity. Good time for collaborative or lighter tasks.';
  } else {
    level = 'low';
    suggestion = 'Low focus capacity. Consider wrapping up and taking a restorative break.';
  }

  return { focusScore: score, level, suggestion };
}

// ── Comprehensive Well-being Check ───────────────────────────────────────────

/**
 * Run a well-being check and emit any relevant events.
 * Designed to be called from the autonomy engine tick loop.
 *
 * @param {object} [options]
 * @param {Array}  [options.goals] - Goal nodes (if available)
 * @param {Array}  [options.tasks] - Task objects (Phase 59)
 * @param {Array}  [options.entries] - Entry objects (Phase 59)
 * @param {number} [options.maxActiveGoals] - Override for max active goals
 * @param {number} [options.maxPendingTasks] - Override for max pending tasks
 * @returns {{ breakSuggested: boolean, goalOverload: boolean, taskOverload: boolean, meetingFatigue: boolean, focusLevel: string, suggestion: string|null }}
 */
export function runWellbeingCheck(options = {}) {
  const result = {
    breakSuggested: false,
    goalOverload: false,
    taskOverload: false,
    meetingFatigue: false,
    focusLevel: 'high',
    suggestion: null,
  };

  // Break check
  const breakSuggestion = getBreakSuggestion();
  if (breakSuggestion) {
    result.breakSuggested = true;
    result.suggestion = breakSuggestion.message;
    _emit('wellbeing:break-suggestion', breakSuggestion);
  }

  // Goal health check
  if (options.goals?.length) {
    const health = getGoalHealth(options.goals, {
      maxActive: options.maxActiveGoals,
    });
    if (health.suggestion) {
      result.goalOverload = health.overloaded;
      if (!result.suggestion) result.suggestion = health.suggestion;
      _emit('wellbeing:goal-health', health);
    }
  }

  // Task load check (Phase 59)
  if (options.tasks?.length) {
    const taskHealth = getTaskLoadHealth(options.tasks, {
      maxPending: options.maxPendingTasks,
    });
    if (taskHealth.suggestion) {
      result.taskOverload = taskHealth.overloaded;
      if (!result.suggestion) result.suggestion = taskHealth.suggestion;
      _emit('wellbeing:task-load', taskHealth);
    }
  }

  // Meeting fatigue check (Phase 59)
  if (options.entries?.length) {
    const fatigue = getMeetingFatigue(options.entries);
    if (fatigue.suggestion) {
      result.meetingFatigue = fatigue.fatigued;
      if (!result.suggestion) result.suggestion = fatigue.suggestion;
      _emit('wellbeing:meeting-fatigue', fatigue);
    }
  }

  // Focus capacity
  const focus = estimateFocusCapacity({
    sessionDuration: getSessionDuration(),
    meetingCount: options.entries?.filter(r => r.type === 'meeting').length || 0,
    pendingTasks: options.tasks?.filter(t => t.status === 'pending').length || 0,
  });
  result.focusLevel = focus.level;

  return result;
}

/**
 * Subscribe to well-being events.
 * Events: 'wellbeing:break-suggestion', 'wellbeing:goal-health',
 *         'wellbeing:task-load', 'wellbeing:meeting-fatigue'
 *
 * @param {function(string, object): void} fn
 * @returns {function} Unsubscribe
 */
export function onWellbeingEvent(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

// ── Internal ────────────────────────────────────────────────────────────────

function _emit(type, data = {}) {
  for (const fn of _listeners) {
    try { fn(type, data); } catch {}
  }
}
