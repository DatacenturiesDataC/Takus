// Takus — Activity Timeline Tests (Phase 54)
import { describe, it, expect, vi } from 'vitest';

vi.mock('../storage.js', () => ({
  getEntries: vi.fn(() => Promise.resolve([
    {
      id: 'entry_1', title: 'Sprint Planning', date: Date.now() - 86400000,
      type: 'meeting',
    },
    {
      id: 'entry_2', title: 'Bug Triage', date: Date.now() - 172800000,
      type: 'screen',
    },
    {
      id: 'doc_1', title: 'Architecture RFC', date: Date.now() - 50000000,
      type: 'document',
    },
    {
      id: 'eml_1', title: 'Client Feedback', date: Date.now() - 60000000,
      type: 'email',
    },
  ])),
}));

vi.mock('../graph/task-store.js', () => ({
  getAllTasks: vi.fn(() => Promise.resolve([
    { id: 't1', title: 'Build search', action: 'TAKUS_TASK', status: 'done', createdAt: Date.now() - 86000000, completedAt: Date.now() - 80000000, _contentId: 'entry_1' },
    { id: 't2', title: 'REST over GraphQL', action: 'LOG_DECISION', status: 'done', output: 'REST over GraphQL', createdAt: Date.now() - 85000000, _contentId: 'entry_1' },
    { id: 'm1', title: 'Review PR', action: 'ME_TASK', status: 'pending', createdAt: Date.now() - 84000000, _contentId: 'entry_1' },
    { id: 't3', title: 'Fix leak', action: 'CREATE_BUG_REPORT', status: 'ignored', createdAt: Date.now() - 170000000, completedAt: Date.now() - 160000000, _contentId: 'entry_2' },
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

    it('includes entry events for both media and documents', async () => {
      const events = await getTimeline();
      const entries = events.filter(e => e.type === 'entry');
      expect(entries.length).toBe(4); // 2 media + 2 documents
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
      const entries = await getTimeline({ type: 'entry' });
      expect(entries.every(e => e.type === 'entry')).toBe(true);
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

    it('uses tl_entry_ prefix for entry event IDs', async () => {
      const events = await getTimeline({ type: 'entry' });
      for (const e of events) {
        expect(e.id).toMatch(/^tl_entry_/);
      }
    });

    it('assigns correct icons for document types', async () => {
      const events = await getTimeline({ type: 'entry' });
      const doc = events.find(e => e.id.includes('doc_1'));
      const email = events.find(e => e.id.includes('eml_1'));
      expect(doc.icon).toBe('📄');
      expect(email.icon).toBe('📧');
    });

    it('assigns correct icons for media types', async () => {
      const events = await getTimeline({ type: 'entry' });
      const meeting = events.find(e => e.id.includes('entry_1'));
      const screen = events.find(e => e.id.includes('entry_2'));
      expect(meeting.icon).toBe('🎤');
      expect(screen.icon).toBe('🖥️');
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
      expect(typeof summary.entries).toBe('number');
      expect(typeof summary.tasksCreated).toBe('number');
      expect(typeof summary.tasksDone).toBe('number');
      expect(typeof summary.decisions).toBe('number');
    });

    it('counts entries correctly (media + documents)', async () => {
      const summary = await getActivitySummary(30);
      expect(summary.entries).toBe(4);
    });
  });
});

