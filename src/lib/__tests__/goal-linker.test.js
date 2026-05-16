// Takus — Goal-Task Linker Tests (Phase 56)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGoals = [
  { id: 'g1', properties: { title: 'Ship v1.0', state: 'active' }, createdAt: Date.now() },
  { id: 'g2', properties: { title: 'Improve onboarding', state: 'at-risk' }, createdAt: Date.now() },
];

const mockTasks = [
  { id: 't1', title: 'Build search', status: 'done', objective: 'Ship v1.0' },
  { id: 't2', title: 'Fix login bug', status: 'done', objective: 'Ship v1.0' },
  { id: 't3', title: 'Design flow', status: 'pending', objective: 'Improve onboarding' },
  { id: 't4', title: 'Unrelated task', status: 'pending', objective: '' },
];

const mockEdges = [
  { sourceType: 'task', sourceId: 't1', targetType: 'goal', targetId: 'g1', edgeType: 'CONTRIBUTES_TO', metadata: {} },
  { sourceType: 'task', sourceId: 't2', targetType: 'goal', targetId: 'g1', edgeType: 'CONTRIBUTES_TO', metadata: {} },
  { sourceType: 'task', sourceId: 't3', targetType: 'goal', targetId: 'g2', edgeType: 'CONTRIBUTES_TO', metadata: {} },
];

vi.mock('../storage.js', () => ({
  getNodesByType: vi.fn(() => Promise.resolve([...mockGoals])),
  addEdge: vi.fn(() => Promise.resolve()),
  getEdgesForNode: vi.fn((nodeType, nodeId) => {
    const edges = mockEdges.filter(e =>
      (e.sourceType === nodeType && e.sourceId === nodeId) ||
      (e.targetType === nodeType && e.targetId === nodeId)
    );
    return Promise.resolve(edges);
  }),
  getRecordings: vi.fn(() => Promise.resolve([])),
  saveNode: vi.fn(() => Promise.resolve()),
  getNode: vi.fn(() => Promise.resolve(null)),
  deleteNode: vi.fn(() => Promise.resolve()),
  saveRecording: vi.fn(() => Promise.resolve()),
  getSetting: vi.fn(() => Promise.resolve(null)),
  saveSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('../graph/task-store.js', () => ({
  getAllTasks: vi.fn(() => Promise.resolve([...mockTasks])),
  computeTaskAnalytics: vi.fn(() => Promise.resolve({ total: 4, pending: 2, done: 2 })),
}));

import {
  linkTaskToGoal, getTasksForGoal, getGoalsForTask,
  computeGoalProgress, getGoalProgressSummary,
} from '../goal-linker.js';

describe('Goal-Task Linker', () => {
  describe('linkTaskToGoal', () => {
    it('creates a CONTRIBUTES_TO edge', async () => {
      const { addEdge } = await import('../storage.js');
      await linkTaskToGoal('t_new', 'g1');
      expect(addEdge).toHaveBeenCalledWith(expect.objectContaining({
        sourceType: 'task',
        sourceId: 't_new',
        targetType: 'goal',
        targetId: 'g1',
        edgeType: 'CONTRIBUTES_TO',
      }));
    });
  });

  describe('getTasksForGoal', () => {
    it('returns tasks linked to a goal', async () => {
      const results = await getTasksForGoal('g1');
      expect(results.length).toBe(2);
      expect(results.map(r => r.task.id).sort()).toEqual(['t1', 't2']);
    });

    it('includes edge data', async () => {
      const results = await getTasksForGoal('g1');
      expect(results[0].edge).toBeTruthy();
      expect(results[0].edge.edgeType).toBe('CONTRIBUTES_TO');
    });
  });

  describe('getGoalsForTask', () => {
    it('returns goals a task contributes to', async () => {
      const goals = await getGoalsForTask('t1');
      expect(goals.length).toBe(1);
      expect(goals[0].id).toBe('g1');
    });

    it('returns empty for unlinked task', async () => {
      const goals = await getGoalsForTask('t4');
      expect(goals).toEqual([]);
    });
  });

  describe('computeGoalProgress', () => {
    it('computes progress from linked tasks', async () => {
      const progress = await computeGoalProgress('g1');
      expect(progress.total).toBe(2);
      expect(progress.done).toBe(2);
      expect(progress.progressPct).toBe(100);
    });

    it('handles goal with pending tasks', async () => {
      const progress = await computeGoalProgress('g2');
      expect(progress.total).toBe(1);
      expect(progress.pending).toBe(1);
      expect(progress.progressPct).toBe(0);
    });
  });

  describe('getGoalProgressSummary', () => {
    it('returns all goals with progress', async () => {
      const summary = await getGoalProgressSummary();
      expect(summary.length).toBe(2);
      expect(summary[0].title).toBeTruthy();
      expect(summary[0].state).toBeTruthy();
      expect(summary[0].progress).toBeTruthy();
    });
  });
});
