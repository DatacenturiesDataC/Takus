// Takus — Activity Timeline (Phase 54)
// Unified chronological view of all platform events.
// Aggregates recordings, tasks, decisions, and system events
// into a single timeline for observability and auditability.

import { getRecordings } from './storage.js';

/**
 * @typedef {object} TimelineEvent
 * @property {string} id
 * @property {string} type — 'recording' | 'task_created' | 'task_done' | 'task_ignored' | 'decision' | 'goal_update' | 'export' | 'system'
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} icon
 * @property {number} timestamp
 * @property {string} [sourceId] — Recording or entity ID
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

  // 1. Recordings → timeline events
  const recordings = await getRecordings().catch(() => []);
  for (const r of recordings) {
    if (r.date < since) continue;

    // Recording created
    events.push({
      id: `tl_rec_${r.id}`,
      type: 'recording',
      title: r.title || 'Untitled Recording',
      subtitle: `${r.type || 'screen'} recording`,
      icon: _typeIcon(r.type),
      timestamp: r.date,
      sourceId: r.id,
    });

    // Tasks created from this recording
    for (const t of r.tasks?.takusTasks || []) {
      const ts = t.createdAt || r.date;
      if (ts < since) continue;

      if (t.action === 'LOG_DECISION') {
        events.push({
          id: `tl_dec_${t.id}`,
          type: 'decision',
          title: t.payload?.decision || t.title,
          subtitle: `Decision from "${r.title || 'Untitled'}"`,
          icon: '⚖️',
          timestamp: ts,
          sourceId: r.id,
          metadata: { owner: t.payload?.owner },
        });
      } else {
        const status = t.status || 'pending';
        events.push({
          id: `tl_task_${t.id}`,
          type: status === 'done' ? 'task_done' : status === 'ignored' ? 'task_ignored' : 'task_created',
          title: t.title || t.note || 'Untitled task',
          subtitle: `${_actionLabel(t.action)} from "${r.title || 'Untitled'}"`,
          icon: status === 'done' ? '✅' : status === 'ignored' ? '⏭️' : '📌',
          timestamp: t.completedAt || t.createdAt || r.date,
          sourceId: r.id,
        });
      }
    }

    for (const t of r.tasks?.meTasks || []) {
      const ts = t.createdAt || r.date;
      if (ts < since) continue;

      const status = t.status || 'pending';
      events.push({
        id: `tl_me_${t.id}`,
        type: status === 'done' ? 'task_done' : status === 'ignored' ? 'task_ignored' : 'task_created',
        title: t.title || t.note || 'Untitled task',
        subtitle: `Personal task from "${r.title || 'Untitled'}"`,
        icon: status === 'done' ? '✅' : status === 'ignored' ? '⏭️' : '📋',
        timestamp: t.completedAt || t.createdAt || r.date,
        sourceId: r.id,
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
 * @returns {Promise<{recordings: number, tasksCreated: number, tasksDone: number, decisions: number}>}
 */
export async function getActivitySummary(daysBack = 7) {
  const since = Date.now() - daysBack * 86_400_000;
  const events = await getTimeline({ since, limit: 500 });

  return {
    recordings: events.filter(e => e.type === 'recording').length,
    tasksCreated: events.filter(e => e.type === 'task_created').length,
    tasksDone: events.filter(e => e.type === 'task_done').length,
    decisions: events.filter(e => e.type === 'decision').length,
  };
}

// ── Private ──────────────────────────────────────────────────────────────────

function _typeIcon(recordingType) {
  const icons = {
    meeting: '🎤', screen: '🖥️', voice_note: '🎙️',
    dictation: '📝', interview: '🎯',
  };
  return icons[recordingType] || '📹';
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
