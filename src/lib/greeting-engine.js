// Takus — Greeting Intelligence Engine
// Composes all available platform intelligence into a contextual greeting payload.
// Pure data module — gathers from Passport, Daily Digest, Wellbeing, and Storage.

import { getEntries } from './storage.js';
import { computeStreak } from './daily-digest.js';
import { getLatestEvents } from './calendar-poller.js';
import { MS_PER_DAY } from './utils.js';

/**
 * @typedef {object} GreetingContext
 * @property {string}  name             User's display name
 * @property {string}  avatar           Emoji avatar (default 🧠)
 * @property {string}  tone             'professional' | 'casual' | 'academic' | 'concise'
 * @property {string}  timeOfDay        'morning' | 'afternoon' | 'evening'
 * @property {string}  greeting         Tone-adapted greeting text
 * @property {string}  dateStr          Formatted date
 * @property {number}  streak           Consecutive days with entries
 * @property {boolean} isStreakRecord   New personal best (streak > previous max)?
 * @property {number}  overdueTasks     Count of overdue tasks
 * @property {number}  todayTasks       Count of tasks due today
 * @property {Array}   upcomingMeetings Next 2 meetings with context
 * @property {number}  atRiskGoals      Count of at-risk goals
 * @property {string}  focusLevel       'deep' | 'moderate' | 'light' | 'exhausted'
 * @property {boolean} isOverloaded     Task load overloaded?
 * @property {number}  totalEntries     Total entry count
 * @property {number}  aiProcessedPct   Percent of entries with AI summaries
 * @property {number}  weekEntries      Entries this week
 * @property {boolean} isBirthday       Today is user's birthday
 * @property {boolean} isFirstSession   No entries exist yet
 * @property {boolean} isReturning      More than 24h since last entry
 * @property {string}  suggestion       Contextual suggestion (1 string)
 */

/**
 * Resolve the time-of-day segment.
 * @returns {'morning'|'afternoon'|'evening'}
 */
function _getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

/**
 * Generate a tone-adapted greeting string.
 * @param {string} timeOfDay
 * @param {string} name
 * @param {string} tone
 * @param {boolean} isReturning
 * @returns {string}
 */
function _buildGreeting(timeOfDay, name, tone, isReturning) {
  const timeGreetings = {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
  };

  const base = timeGreetings[timeOfDay];
  const nameStr = name || '';

  switch (tone) {
    case 'casual':
      if (isReturning) return nameStr ? `Welcome back, ${nameStr}! 👋` : 'Welcome back! 👋';
      return nameStr ? `Hey ${nameStr}! 👋` : `Hey there! 👋`;
    case 'academic':
      if (isReturning) return nameStr ? `Welcome back, ${nameStr}.` : 'Welcome back.';
      return nameStr ? `${base}, ${nameStr}.` : `${base}.`;
    case 'concise': {
      if (isReturning) return nameStr ? `Welcome back, ${nameStr}.` : 'Welcome back.';
      const short = base.replace('Good ', '');
      const cap = short.charAt(0).toUpperCase() + short.slice(1);
      return nameStr ? `${cap}, ${nameStr}.` : `${cap}.`;
    }
    case 'professional':
    default:
      if (isReturning) return nameStr ? `Welcome back, ${nameStr}.` : 'Welcome back.';
      return nameStr ? `${base}, ${nameStr}.` : `${base}.`;
  }
}

/**
 * Check if today matches a birthday string.
 * Supports formats: "MM-DD", "YYYY-MM-DD", "Month Day", "M/D"
 * @param {string} birthdayStr
 * @returns {boolean}
 */
export function isBirthdayToday(birthdayStr) {
  if (!birthdayStr || typeof birthdayStr !== 'string') return false;

  const today = new Date();
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();

  const trimmed = birthdayStr.trim();

  // MM-DD or YYYY-MM-DD
  const dashMatch = trimmed.match(/(?:\d{4}-)?(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])$/);
  if (dashMatch) {
    return parseInt(dashMatch[1]) === todayMonth && parseInt(dashMatch[2]) === todayDay;
  }

  // M/D or MM/DD
  const slashMatch = trimmed.match(/^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])$/);
  if (slashMatch) {
    return parseInt(slashMatch[1]) === todayMonth && parseInt(slashMatch[2]) === todayDay;
  }

  // "Month Day" — e.g., "January 15"
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const textMatch = trimmed.toLowerCase().match(/^([a-z]+)\s+(\d{1,2})/);
  if (textMatch) {
    const mIdx = months.indexOf(textMatch[1]);
    if (mIdx >= 0) {
      return (mIdx + 1) === todayMonth && parseInt(textMatch[2]) === todayDay;
    }
  }

  return false;
}

/**
 * Determine the highest-priority contextual suggestion.
 * @param {object} ctx - Partial greeting context
 * @returns {string} A single suggestion string
 */
function _pickSuggestion(ctx) {
  // 1. Birthday
  if (ctx.isBirthday) {
    return '🎂 Happy birthday! Takus has been working for you.';
  }

  // 2. Overloaded with tasks
  if (ctx.isOverloaded && ctx.overdueTasks > 0) {
    return `⚠️ You have ${ctx.overdueTasks} overdue task${ctx.overdueTasks !== 1 ? 's' : ''}. Let's focus on the top priority.`;
  }

  // 3. Streak record
  if (ctx.isStreakRecord && ctx.streak > 1) {
    return `🔥 ${ctx.streak}-day streak — new personal best!`;
  }

  // 4. Returning after absence
  if (ctx.isReturning && !ctx.isFirstSession) {
    return '👋 Welcome back! Here\'s what matters right now.';
  }

  // 5. At-risk goals
  if (ctx.atRiskGoals > 0) {
    return `🎯 ${ctx.atRiskGoals} goal${ctx.atRiskGoals !== 1 ? 's' : ''} need${ctx.atRiskGoals === 1 ? 's' : ''} attention — progress has stalled.`;
  }

  // 6. Overdue tasks (non-overloaded)
  if (ctx.overdueTasks > 0) {
    return `📋 ${ctx.overdueTasks} overdue task${ctx.overdueTasks !== 1 ? 's' : ''} waiting for you.`;
  }

  // 7. First session
  if (ctx.isFirstSession) {
    return '🚀 Welcome to Takus! Start by capturing your first piece of knowledge.';
  }

  // 8. Active streak
  if (ctx.streak > 2) {
    return `🔥 ${ctx.streak}-day streak! Keep the momentum going.`;
  }

  // 9. Today tasks
  if (ctx.todayTasks > 0) {
    return `📋 ${ctx.todayTasks} task${ctx.todayTasks !== 1 ? 's' : ''} due today.`;
  }

  // 10. Upcoming meeting with context
  if (ctx.upcomingMeetings?.length > 0) {
    const next = ctx.upcomingMeetings[0];
    const timeStr = _formatMeetingTime(next.start);
    const ctxStr = next.hasPreviousContext ? ' — you\'ve discussed this before' : '';
    return `📅 Next: ${next.title || 'Meeting'} at ${timeStr}${ctxStr}.`;
  }

  // 11. All clear
  return '✨ All clear — great time to capture new knowledge.';
}

/**
 * Format a meeting time for display.
 * @param {string|number} start
 * @returns {string}
 */
function _formatMeetingTime(start) {
  try {
    const d = new Date(start);
    if (isNaN(d.getTime())) return 'soon';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return 'soon';
  }
}

/**
 * Get the full greeting context by gathering intelligence from all platform sources.
 * All data fetching is best-effort — failures return safe defaults.
 *
 * @returns {Promise<GreetingContext>}
 */
export async function getGreetingContext() {
  const now = Date.now();
  const timeOfDay = _getTimeOfDay();

  // ── Passport (sync, cached) ──────────────────────────────────────────
  let name = '';
  let avatar = '🧠';
  let tone = 'professional';
  let birthdayStr = '';

  try {
    const { getPassport, getDisplayName } = await import('../apps/passport/index.js');
    const passport = getPassport();
    name = getDisplayName() || '';
    avatar = passport?.avatar || '🧠';
    tone = passport?.preferredTone || 'professional';
    birthdayStr = passport?.birthday || '';
  } catch {
    // Passport not loaded yet — use localStorage fallback
    try { name = localStorage.getItem('takus_user_name') || ''; } catch { /* private browsing */ }
  }

  // ── Entries + Streak ─────────────────────────────────────────────────
  let entries = [];
  try { entries = await getEntries(); } catch { /* empty */ }

  const totalEntries = entries.length;
  const isFirstSession = totalEntries === 0;

  // This week's entries
  const weekEntries = entries.filter(e => e.date && (now - e.date) < 7 * MS_PER_DAY).length;

  // AI processed %
  const aiProcessed = entries.filter(e => e.aiSummary).length;
  const aiProcessedPct = totalEntries > 0 ? Math.round((aiProcessed / totalEntries) * 100) : 0;

  // Streak
  const streak = computeStreak(entries, now);

  // Streak record check — compare with stored max
  let isStreakRecord = false;
  try {
    const storedMax = parseInt(localStorage.getItem('takus_streak_max') || '0', 10);
    if (streak > storedMax && streak > 1) {
      isStreakRecord = true;
      localStorage.setItem('takus_streak_max', String(streak));
    }
  } catch { /* private browsing */ }

  // Returning user check (> 24h since last entry)
  let isReturning = false;
  if (entries.length > 0) {
    const latestDate = entries.reduce((max, e) => { const v = e.date || 0; return v > max ? v : max; }, -Infinity);
    isReturning = latestDate > 0 && (now - latestDate) > MS_PER_DAY;
  }

  // ── Daily Digest (tasks, meetings, goals, wellbeing) ─────────────────
  let overdueTasks = 0;
  let todayTasks = 0;
  let upcomingMeetings = [];
  let atRiskGoals = 0;
  let focusLevel = 'moderate';
  let isOverloaded = false;

  try {
    const { generateDailyDigest } = await import('./daily-digest.js');
    const calendarEvents = getLatestEvents();
    const digest = await generateDailyDigest(calendarEvents, { entries });

    overdueTasks = digest.overdueTasks?.length || 0;
    todayTasks = digest.todayTasks?.length || 0;
    upcomingMeetings = (digest.upcomingMeetings || []).slice(0, 2);
    atRiskGoals = digest.goalProgress?.atRisk?.length || 0;
    focusLevel = digest.wellbeing?.focusLevel || 'moderate';
    isOverloaded = digest.wellbeing?.taskLoad?.overloaded || false;
  } catch (e) {
    console.warn('[GreetingEngine] Digest failed:', e.message);
  }

  // ── Birthday ─────────────────────────────────────────────────────────
  const isBirthday = isBirthdayToday(birthdayStr);

  // ── Build context ────────────────────────────────────────────────────
  const ctx = {
    name,
    avatar,
    tone,
    timeOfDay,
    greeting: '', // set below
    dateStr: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    streak,
    isStreakRecord,
    overdueTasks,
    todayTasks,
    upcomingMeetings,
    atRiskGoals,
    focusLevel,
    isOverloaded,
    totalEntries,
    aiProcessedPct,
    weekEntries,
    isBirthday,
    isFirstSession,
    isReturning,
    suggestion: '',
  };

  ctx.greeting = _buildGreeting(timeOfDay, name, tone, isReturning);
  ctx.suggestion = _pickSuggestion(ctx);

  return ctx;
}

// Export internals for testing
export const _testExports = { _getTimeOfDay, _buildGreeting, _pickSuggestion, _formatMeetingTime };
