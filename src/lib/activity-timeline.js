// Takus — Activity Timeline (Phase 54)
// Unified chronological view of all platform events.
// Aggregates entries, tasks, decisions, and system events
// into a single timeline for observability and auditability.

import { getEntries } from './storage.js';
import { getAllTasks } from './graph/task-store.js';
import { MS_PER_DAY } from './utils.js';

/**
 * @typedef {object} TimelineEvent
 * @property {string} id
 * @property {string} type — 'entry' | 'task_created' | 'task_done' | 'task_ignored' | 'decision' | 'goal_update' | 'export' | 'system'
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} icon
 * @property {number} timestamp
 * @property {string} [sourceId] — Entry or entity ID
 * @property {object} [metadata]
 */

/**
 * Build a unified timeline from all platform data.
 *
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {number} [options.since] — Only events after this timestamp
 * @param {string} [options.type] — Filter by event type
 * @returns {Promise<TimelineEvent[]>}
 */
export async function getTimeline(options = {}) {
  const { limit = 50, since = 0, type } = options;
  const events = [];

  // 1. Entries → timeline events
  const entries = await getEntries().catch(() => []);
  for (const r of entries) {
    const recTs = typeof r.date === 'number' ? r.date : new Date(r.date).getTime();
    if (recTs < since) continue;

    // Entry created
    events.push({
      id: `tl_entry_${r.id}`,
      type: 'entry',
      title: r.title || 'Untitled',
      subtitle: `${r.type || 'screen'} entry`,
      icon: _typeIcon(r.type),
      timestamp: r.date,
      sourceId: r.id,
    });
  }

  // 2. Tasks from graph nodes → timeline events
  const allTasks = await getAllTasks().catch(() => []);
  for (const t of allTasks) {
    const ts = t.createdAt || 0;
    if (ts < since) continue;

    if (t.action === 'LOG_DECISION') {
      events.push({
        id: `tl_dec_${t.id}`,
        type: 'decision',
        title: t.output || t.title,
        subtitle: 'Decision',
        icon: '⚖️',
        timestamp: ts,
        sourceId: t._contentId,
      });
    } else {
      const status = t.status || 'pending';
      events.push({
        id: `tl_task_${t.id}`,
        type: status === 'done' ? 'task_done' : status === 'ignored' ? 'task_ignored' : 'task_created',
        title: t.title || 'Untitled task',
        subtitle: `${_actionLabel(t.action)}`,
        icon: status === 'done' ? '✅' : status === 'ignored' ? '⏭️' : '📌',
        timestamp: t.completedAt || ts,
        sourceId: t._contentId,
      });
    }
  }

  // Filter by type
  let filtered = type ? events.filter(e => e.type === type) : events;

  // Sort by timestamp descending (newest first)
  filtered.sort((a, b) => b.timestamp - a.timestamp);

  return filtered.slice(0, limit);
}

/**
 * Get timeline grouped by day.
 *
 * @param {object} [options] — Same as getTimeline
 * @returns {Promise<{date: string, events: TimelineEvent[]}[]>}
 */
export async function getTimelineGrouped(options = {}) {
  const events = await getTimeline({ ...options, limit: options.limit || 100 });
  const groups = {};

  for (const event of events) {
    const dateKey = new Date(event.timestamp).toLocaleDateString();
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(event);
  }

  return Object.entries(groups).map(([date, evts]) => ({ date, events: evts }));
}

/**
 * Get activity summary statistics.
 *
 * @param {number} [daysBack=7]
 * @returns {Promise<{entries: number, tasksCreated: number, tasksDone: number, decisions: number}>}
 */
export async function getActivitySummary(daysBack = 7) {
  const since = Date.now() - daysBack * MS_PER_DAY;
  const events = await getTimeline({ since, limit: 500 });

  return {
    entries: events.filter(e => e.type === 'entry').length,
    tasksCreated: events.filter(e => e.type === 'task_created').length,
    tasksDone: events.filter(e => e.type === 'task_done').length,
    decisions: events.filter(e => e.type === 'decision').length,
  };
}

// ── Private ──────────────────────────────────────────────────────────────────

function _typeIcon(contentType) {
  const icons = {
    meeting: '🎤', screen: '🖥️', voice_note: '🎙️',
    dictation: '📝', interview: '🎯', presentation: '📊',
    update: '📣',
    // Document types
    document: '📄', markdown: '📑', email: '📧',
    note: '🗒️', bookmark: '🔖', chat: '💬',
  };
  return icons[contentType] || '📥';
}

function _actionLabel(action) {
  const labels = {
    TAKUS_TASK: 'AI task', ME_TASK: 'User task',
    CREATE_TICKET: 'Ticket', CREATE_BUG_REPORT: 'Bug report',
    LOG_DECISION: 'Decision', SET_REMINDER: 'Reminder',
    SEND_FOLLOW_UP: 'Follow-up', ADD_TO_BACKLOG: 'Backlog',
  };
  return labels[action] || action || 'Task';
}
