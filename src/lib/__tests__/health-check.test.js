// Takus — Health Check Tests (Phase 47)
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../storage.js', () => ({
  getEntries: vi.fn(() => Promise.resolve([
    { id: 'entry_1', title: 'Meeting', textContent: 'hello' },
    { id: 'entry_2', title: '', textContent: '', pipelineRun: { status: 'failed' } },
  ])),
  getNodesByType: vi.fn((type) => {
    if (type === 'goal') return Promise.resolve([{ id: 'g1' }]);
    if (type === 'task') return Promise.resolve([{ id: 't1' }, { id: 't2' }]);
    if (type === 'person') return Promise.resolve([{ id: 'p1' }]);
    return Promise.resolve([]);
  }),
  getEdgesByType: vi.fn(() => Promise.resolve([])),
  getNode: vi.fn(() => Promise.resolve(null)),
  saveNode: vi.fn(() => Promise.resolve()),
  deleteNode: vi.fn(() => Promise.resolve()),
  addEdge: vi.fn(() => Promise.resolve()),
  saveEntry: vi.fn(() => Promise.resolve()),
  getSetting: vi.fn(() => Promise.resolve(null)),
  saveSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('../graph/task-store.js', () => ({
  getTaskCounts: vi.fn(() => Promise.resolve({ pending: 3, done: 5, ignored: 1, total: 9 })),
  computeTaskAnalytics: vi.fn(() => Promise.resolve({
    total: 9, pending: 3, done: 5, ignored: 1,
    completionPct: 63, avgResolutionHours: 12, velocity: 3,
    overdueCount: 1, oldestPendingDays: 10, topActions: [],
  })),
}));

vi.mock('../../apps/goals/index.js', () => ({
  computeGoalAnalytics: vi.fn(() => ({
    total: 3, achieved: 1, inProgress: 1, aspiration: 1,
    achievedPct: 33, avgAgeDays: 14, mostActive: 'Learn TypeScript',
  })),
}));

vi.mock('../inbox.js', () => ({
  getInboxCount: vi.fn(() => Promise.resolve(2)),
}));

import { runHealthCheck, formatHealthReport } from '../health-check.js';

describe('Health Check', () => {
  it('returns a structured report', async () => {
    const report = await runHealthCheck();

    expect(report.status).toBeTruthy();
    expect(report.timestamp).toBeTypeOf('number');
    expect(report.checks).toBeInstanceOf(Array);
    expect(report.checks.length).toBeGreaterThanOrEqual(4);
    expect(report.metrics).toBeTypeOf('object');
  });

  it('detects warnings for failed pipelines and orphaned entries', async () => {
    const report = await runHealthCheck();

    // Should have warnings for orphaned and failed pipeline entries
    expect(report.warnings.length).toBeGreaterThanOrEqual(1);
    expect(report.warnings.some(w => w.includes('failed pipeline'))).toBe(true);
  });

  it('computes metrics across all services', async () => {
    const report = await runHealthCheck();

    expect(report.metrics.entries).toBe(2);
    expect(report.metrics.totalNodes).toBe(4); // 1 goal + 2 tasks + 1 person
    expect(report.metrics.tasksTotal).toBe(9);
    expect(report.metrics.inboxCount).toBe(2);
  });

  it('all checks pass as ok', async () => {
    const report = await runHealthCheck();

    for (const check of report.checks) {
      expect(check.status).toBe('ok');
      expect(check.detail).toBeTruthy();
    }
  });

  it('formatHealthReport produces readable output', async () => {
    const report = await runHealthCheck();
    const formatted = formatHealthReport(report);

    expect(formatted).toContain('Platform Health:');
    expect(formatted).toContain('── Services ──');
    expect(formatted).toContain('── Metrics ──');
    expect(formatted).toContain('entries:');
  });
});
