// Takus — Activity Timeline Tests (Phase 54)
import { describe, it, expect, vi } from 'vitest';

vi.mock('../storage.js', () => ({
  getRecordings: vi.fn(() => Promise.resolve([
    {
      id: 'rec_1', title: 'Sprint Planning', date: Date.now() - 86400000,
      type: 'meeting',
      tasks: {
        takusTasks: [
          { id: 't1', title: 'Build search', action: 'TAKUS_TASK', status: 'done', createdAt: Date.now() - 86000000, completedAt: Date.now() - 80000000 },
          { id: 't2', title: 'Use REST API', action: 'LOG_DECISION', status: 'done', createdAt: Date.now() - 85000000, payload: { decision: 'REST over GraphQL', owner: 'Alice' } },
        ],
        meTasks: [
          { id: 'm1', title: 'Review PR', status: 'pending', createdAt: Date.now() - 84000000 },
        ],
      },
    },
    {
      id: 'rec_2', title: 'Bug Triage', date: Date.now() - 172800000,
      type: 'screen',
      tasks: {
        takusTasks: [{ id: 't3', title: 'Fix leak', action: 'CREATE_BUG_REPORT', status: 'ignored', createdAt: Date.now() - 170000000, completedAt: Date.now() - 160000000 }],
        meTasks: [],
      },
    },
  ])),
}));

import { getTimeline, getTimelineGrouped, getActivitySummary } from '../activity-timeline.js';

describe('Activity Timeline', () => {
  describe('getTimeline', () => {
    it('returns events sorted by timestamp descending', async () => {
      const events = await getTimeline();
      for (let i = 1; i < events.length; i++) {
        expect(events[i - 1].timestamp).toBeGreaterThanOrEqual(events[i].timestamp);
      }
    });

    it('includes recording events', async () => {
      const events = await getTimeline();
      const recordings = events.filter(e => e.type === 'recording');
      expect(recordings.length).toBe(2);
    });

    it('includes task events', async () => {
      const events = await getTimeline();
      const tasks = events.filter(e => e.type.startsWith('task_'));
      expect(tasks.length).toBeGreaterThanOrEqual(2);
    });

    it('includes decision events', async () => {
      const events = await getTimeline();
      const decisions = events.filter(e => e.type === 'decision');
      expect(decisions.length).toBe(1);
      expect(decisions[0].title).toContain('REST');
    });

    it('includes done and ignored task types', async () => {
      const events = await getTimeline();
      expect(events.some(e => e.type === 'task_done')).toBe(true);
      expect(events.some(e => e.type === 'task_ignored')).toBe(true);
    });

    it('filters by event type', async () => {
      const recordings = await getTimeline({ type: 'recording' });
      expect(recordings.every(e => e.type === 'recording')).toBe(true);
    });

    it('respects limit', async () => {
      const events = await getTimeline({ limit: 2 });
      expect(events.length).toBeLessThanOrEqual(2);
    });

    it('each event has required fields', async () => {
      const events = await getTimeline();
      for (const e of events) {
        expect(e.id).toBeTruthy();
        expect(e.type).toBeTruthy();
        expect(e.title).toBeTruthy();
        expect(e.icon).toBeTruthy();
        expect(typeof e.timestamp).toBe('number');
      }
    });
  });

  describe('getTimelineGrouped', () => {
    it('groups events by day', async () => {
      const groups = await getTimelineGrouped();
      expect(groups.length).toBeGreaterThanOrEqual(1);
      for (const g of groups) {
        expect(g.date).toBeTruthy();
        expect(g.events).toBeInstanceOf(Array);
        expect(g.events.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getActivitySummary', () => {
    it('returns activity counts', async () => {
      const summary = await getActivitySummary(30);
      expect(typeof summary.recordings).toBe('number');
      expect(typeof summary.tasksCreated).toBe('number');
      expect(typeof summary.tasksDone).toBe('number');
      expect(typeof summary.decisions).toBe('number');
    });

    it('counts recordings correctly', async () => {
      const summary = await getActivitySummary(30);
      expect(summary.recordings).toBe(2);
    });
  });
});
