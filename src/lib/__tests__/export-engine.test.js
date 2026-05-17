// Takus — Data Export Tests (Phase 51)
import { describe, it, expect, vi } from 'vitest';

vi.mock('../storage.js', () => ({
  getEntries: vi.fn(() => Promise.resolve([
    {
      id: 'rec_1', title: 'Sprint Planning', date: Date.now() - 86400000,
      type: 'meeting', aiTranscript: 'We discussed features.',
      aiSummary: 'Sprint planning summary.',
      tasks: {
        takusTasks: [
          { id: 't1', title: 'Build search', action: 'TAKUS_TASK', status: 'done', output: 'Shipped' },
          { id: 't2', title: 'Use REST API', action: 'LOG_DECISION', status: 'done', payload: { decision: 'Use REST over GraphQL', owner: 'Alice' } },
        ],
        meTasks: [{ id: 'm1', title: 'Review PR', status: 'pending' }],
      },
    },
    {
      id: 'rec_2', title: 'Bug Triage', date: Date.now(),
      type: 'screen', aiTranscript: 'Memory leak found.',
      aiSummary: 'Bug triage session.',
      tasks: { takusTasks: [], meTasks: [] },
    },
  ])),
  getNodesByType: vi.fn((type) => {
    if (type === 'goal') return Promise.resolve([
      { id: 'g1', properties: { title: 'Ship v1.0', description: 'First release', state: 'active' }, createdAt: Date.now(), updatedAt: Date.now() },
    ]);
    return Promise.resolve([]);
  }),
  saveNode: vi.fn(() => Promise.resolve()),
  getNode: vi.fn(() => Promise.resolve(null)),
  deleteNode: vi.fn(() => Promise.resolve()),
  addEdge: vi.fn(() => Promise.resolve()),
  saveEntry: vi.fn(() => Promise.resolve()),
  getSetting: vi.fn(() => Promise.resolve(null)),
  saveSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('../graph/task-store.js', () => ({
  getAllTasks: vi.fn(() => Promise.resolve([
    { id: 't1', title: 'Build search', status: 'done', assignee: 'takus', output: 'Shipped' },
    { id: 'm1', title: 'Review PR', status: 'pending', assignee: 'me' },
  ])),
  computeTaskAnalytics: vi.fn(() => Promise.resolve({
    total: 2, pending: 1, done: 1, ignored: 0,
    completionPct: 50, velocity: 1, overdueCount: 0,
  })),
}));

import { exportData, exportMarkdown } from '../export-engine.js';

describe('Data Export Engine', () => {
  describe('exportData', () => {
    it('returns a versioned bundle with all sections', async () => {
      const bundle = await exportData();

      expect(bundle.version).toBe(1);
      expect(bundle.platform).toBe('takus');
      expect(bundle.exportedAt).toBeTruthy();
      expect(bundle.summary).toBeTruthy();
      expect(bundle.entries).toBeInstanceOf(Array);
      expect(bundle.tasks).toBeInstanceOf(Array);
      expect(bundle.goals).toBeInstanceOf(Array);
      expect(bundle.decisions).toBeInstanceOf(Array);
    });

    it('includes correct counts in summary', async () => {
      const bundle = await exportData();

      expect(bundle.summary.entries).toBe(2);
      expect(bundle.summary.tasks).toBe(2);
      expect(bundle.summary.goals).toBe(1);
      expect(bundle.summary.decisions).toBe(1);
    });

    it('extracts decisions from entries', async () => {
      const bundle = await exportData();

      expect(bundle.decisions).toHaveLength(1);
      expect(bundle.decisions[0].decision).toBe('Use REST over GraphQL');
      expect(bundle.decisions[0].owner).toBe('Alice');
      expect(bundle.decisions[0].contentId).toBe('rec_1');
    });

    it('strips internal state from tasks', async () => {
      const bundle = await exportData();

      for (const task of bundle.tasks) {
        expect(task._source).toBeUndefined();
        expect(task._recRef).toBeUndefined();
        expect(task._priority).toBeUndefined();
      }
    });

    it('maps goal properties correctly', async () => {
      const bundle = await exportData();

      expect(bundle.goals).toHaveLength(1);
      expect(bundle.goals[0].title).toBe('Ship v1.0');
      expect(bundle.goals[0].state).toBe('active');
    });

    it('excludes transcripts when option is false', async () => {
      const bundle = await exportData({ includeTranscripts: false });

      for (const rec of bundle.entries) {
        expect(rec.aiTranscript).toBeUndefined();
        expect(rec.aiVtt).toBeUndefined();
      }
    });

    it('excludes tasks when option is false', async () => {
      const bundle = await exportData({ includeTasks: false });
      expect(bundle.tasks).toEqual([]);
    });

    it('excludes goals when option is false', async () => {
      const bundle = await exportData({ includeGoals: false });
      expect(bundle.goals).toEqual([]);
    });

    it('includes analytics snapshot', async () => {
      const bundle = await exportData();
      expect(bundle.analytics).toBeTruthy();
      expect(bundle.analytics.total).toBe(2);
      expect(bundle.analytics.velocity).toBe(1);
    });
  });

  describe('exportMarkdown', () => {
    it('generates readable markdown', async () => {
      const md = await exportMarkdown();

      expect(md).toContain('# Takus Export');
      expect(md).toContain('## Summary');
      expect(md).toContain('## Goals');
      expect(md).toContain('## Decisions');
      expect(md).toContain('## Tasks');
      expect(md).toContain('## Recordings');
    });

    it('includes goal details', async () => {
      const md = await exportMarkdown();
      expect(md).toContain('Ship v1.0');
      expect(md).toContain('active');
    });

    it('includes decision text', async () => {
      const md = await exportMarkdown();
      expect(md).toContain('Use REST over GraphQL');
      expect(md).toContain('Alice');
    });

    it('includes task statuses', async () => {
      const md = await exportMarkdown();
      expect(md).toContain('- [x]'); // done tasks
      expect(md).toContain('- [ ]'); // pending tasks
    });

    it('includes recording summaries', async () => {
      const md = await exportMarkdown();
      expect(md).toContain('Sprint Planning');
      expect(md).toContain('Sprint planning summary.');
    });

    it('includes recording count in summary', async () => {
      const md = await exportMarkdown();
      expect(md).toContain('2'); // 2 entries
    });
  });

  // ── Phase 81: Edge Cases ──────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('exportData includes correct task analytics fields', async () => {
      const bundle = await exportData();
      expect(bundle.analytics).toHaveProperty('completionPct');
      expect(bundle.analytics).toHaveProperty('overdueCount');
    });

    it('exportData with all excludes returns minimal bundle', async () => {
      const bundle = await exportData({
        includeTranscripts: false,
        includeTasks: false,
        includeGoals: false,
      });
      expect(bundle.tasks).toEqual([]);
      expect(bundle.goals).toEqual([]);
      expect(bundle.entries).toBeInstanceOf(Array);
      expect(bundle.version).toBe(1);
    });

    it('exportMarkdown generates valid heading hierarchy', async () => {
      const md = await exportMarkdown();
      const lines = md.split('\n');
      const h1Count = lines.filter(l => l.startsWith('# ') && !l.startsWith('## ')).length;
      expect(h1Count).toBe(1); // Single H1
    });

    it('exportData entries have sanitized fields', async () => {
      const bundle = await exportData();
      for (const rec of bundle.entries) {
        expect(rec).toHaveProperty('id');
        expect(rec).toHaveProperty('title');
        expect(rec).toHaveProperty('type');
      }
    });
  });
});
