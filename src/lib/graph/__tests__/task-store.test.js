// Takus — Task Store Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage module
vi.mock('../../storage.js', () => ({
  saveNode: vi.fn(async () => {}),
  getNode: vi.fn(async () => null),
  getNodesByType: vi.fn(async () => []),
  deleteNode: vi.fn(async () => {}),
  addEdge: vi.fn(async () => 'edge_123'),
  removeEdgesForNode: vi.fn(async () => {}),
  updateNode: vi.fn(async (id, updater) => {
    // Simulate the read-modify-write pattern
    const node = updateNode._nodeForTest;
    if (!node) return null;
    return updater(node);
  }),
}));

vi.mock('../../id.js', () => ({
  generateId: vi.fn((prefix) => `${prefix}_test_abc`),
}));

vi.mock('../../task-helpers.js', () => ({
  getTaskStatus: vi.fn((t) => t.status || 'pending'),
  getTaskTitle: vi.fn((t) => t.title || 'Task'),
}));

vi.mock('../../utils.js', () => ({
  MS_PER_HOUR: 3600000,
  MS_PER_DAY: 86400000,
  MS_PER_WEEK: 604800000,
}));

import {
  getAllTasks,
  getTasksByContent,
  getTask,
  getTaskCounts,
  createTask,
  updateTask,
  deleteTaskNode,
  computeTaskAnalytics,
} from '../task-store.js';

import {
  saveNode,
  getNode,
  getNodesByType,
  deleteNode,
  addEdge,
  removeEdgesForNode,
  updateNode,
} from '../../storage.js';

import { generateId } from '../../id.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTaskNode(overrides = {}) {
  const now = Date.now();
  return {
    id: overrides.id || 'task_1',
    type: 'task',
    state: 'active',
    appId: 'tasks',
    properties: {
      title: 'Test Task',
      status: 'pending',
      assignee: 'me',
      action: 'TAKUS_TASK',
      objective: null,
      output: null,
      ignoredReason: null,
      contextTimestamp: null,
      deadline: null,
      urgency: 'normal',
      steps: [],
      sequence: null,
      integrations: [],
      priorityOverride: null,
      note: null,
      doneAt: null,
      ignoredAt: null,
      sourceContentId: null,
      ...overrides.properties,
    },
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

describe('Task Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getAllTasks ────────────────────────────────────────────────────────────

  describe('getAllTasks', () => {
    it('returns normalized tasks from graph nodes', async () => {
      const node = makeTaskNode({ id: 'task_1', properties: { title: 'My Task' } });
      getNodesByType.mockResolvedValue([node]);

      const tasks = await getAllTasks();
      expect(getNodesByType).toHaveBeenCalledWith('task');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task_1');
      expect(tasks[0].title).toBe('My Task');
      expect(tasks[0]._storageType).toBe('node');
    });

    it('returns empty array when no tasks exist', async () => {
      getNodesByType.mockResolvedValue([]);
      const tasks = await getAllTasks();
      expect(tasks).toEqual([]);
    });

    it('gracefully handles getNodesByType failure', async () => {
      getNodesByType.mockRejectedValue(new Error('IDB error'));
      const tasks = await getAllTasks();
      expect(tasks).toEqual([]);
    });
  });

  // ── getTasksByContent ─────────────────────────────────────────────────────

  describe('getTasksByContent', () => {
    it('filters tasks by contentId', async () => {
      getNodesByType.mockResolvedValue([
        makeTaskNode({ id: 'task_a', properties: { sourceContentId: 'entry_1' } }),
        makeTaskNode({ id: 'task_b', properties: { sourceContentId: 'entry_2' } }),
        makeTaskNode({ id: 'task_c', properties: { sourceContentId: 'entry_1' } }),
      ]);

      const tasks = await getTasksByContent('entry_1');
      expect(tasks).toHaveLength(2);
      expect(tasks.map(t => t.id)).toEqual(['task_a', 'task_c']);
    });

    it('returns empty array when no tasks match contentId', async () => {
      getNodesByType.mockResolvedValue([
        makeTaskNode({ id: 'task_a', properties: { sourceContentId: 'entry_1' } }),
      ]);

      const tasks = await getTasksByContent('entry_999');
      expect(tasks).toEqual([]);
    });
  });

  // ── getTask ───────────────────────────────────────────────────────────────

  describe('getTask', () => {
    it('returns task from direct node lookup', async () => {
      const node = makeTaskNode({ id: 'task_fast' });
      getNode.mockResolvedValue(node);

      const task = await getTask('task_fast');
      expect(getNode).toHaveBeenCalledWith('task_fast');
      expect(task).not.toBeNull();
      expect(task.id).toBe('task_fast');
    });

    it('ignores non-task nodes from direct lookup', async () => {
      getNode.mockResolvedValue({ id: 'entry_1', type: 'entry' });
      getNodesByType.mockResolvedValue([]);

      const task = await getTask('entry_1');
      expect(task).toBeNull();
    });

    it('returns null when task not found anywhere', async () => {
      getNode.mockResolvedValue(null);
      getNodesByType.mockResolvedValue([]);

      const task = await getTask('nonexistent');
      expect(task).toBeNull();
    });

    it('falls back to full scan when direct lookup misses', async () => {
      getNode.mockResolvedValue(null);
      getNodesByType.mockResolvedValue([
        makeTaskNode({ id: 'task_found' }),
      ]);

      const task = await getTask('task_found');
      expect(task).not.toBeNull();
      expect(task.id).toBe('task_found');
    });
  });

  // ── getTaskCounts ─────────────────────────────────────────────────────────

  describe('getTaskCounts', () => {
    it('returns correct counts for each status', async () => {
      getNodesByType.mockResolvedValue([
        makeTaskNode({ id: 't1', properties: { status: 'pending' } }),
        makeTaskNode({ id: 't2', properties: { status: 'pending' } }),
        makeTaskNode({ id: 't3', properties: { status: 'done' } }),
        makeTaskNode({ id: 't4', properties: { status: 'ignored' } }),
      ]);

      const counts = await getTaskCounts();
      expect(counts).toEqual({
        pending: 2,
        done: 1,
        ignored: 1,
        total: 4,
      });
    });

    it('returns zeros when no tasks exist', async () => {
      getNodesByType.mockResolvedValue([]);

      const counts = await getTaskCounts();
      expect(counts).toEqual({
        pending: 0,
        done: 0,
        ignored: 0,
        total: 0,
      });
    });
  });

  // ── createTask ────────────────────────────────────────────────────────────

  describe('createTask', () => {
    it('creates a standalone task node with defaults', async () => {
      const task = await createTask({ title: 'Build feature' });

      expect(saveNode).toHaveBeenCalledTimes(1);
      const savedNode = saveNode.mock.calls[0][0];
      expect(savedNode.type).toBe('task');
      expect(savedNode.state).toBe('active');
      expect(savedNode.appId).toBe('tasks');
      expect(savedNode.properties.title).toBe('Build feature');
      expect(savedNode.properties.status).toBe('pending');
      expect(savedNode.properties.assignee).toBe('me');
      expect(savedNode.properties.action).toBe('TAKUS_TASK');

      // Returns normalized task
      expect(task.id).toBe('task_test_abc');
      expect(task.title).toBe('Build feature');
      expect(task._storageType).toBe('node');
    });

    it('uses provided task data over defaults', async () => {
      const task = await createTask({
        title: 'Custom Task',
        status: 'done',
        assignee: 'takus',
        action: 'DRAFT_EMAIL',
        objective: 'Send newsletter',
        urgency: 'high',
        steps: [{ label: 'Step 1' }],
      });

      const savedNode = saveNode.mock.calls[0][0];
      expect(savedNode.properties.title).toBe('Custom Task');
      expect(savedNode.properties.status).toBe('done');
      expect(savedNode.properties.assignee).toBe('takus');
      expect(savedNode.properties.action).toBe('DRAFT_EMAIL');
      expect(savedNode.properties.objective).toBe('Send newsletter');
      expect(savedNode.properties.urgency).toBe('high');
      expect(savedNode.properties.steps).toEqual([{ label: 'Step 1' }]);
    });

    it('uses provided ID instead of generating one', async () => {
      const task = await createTask({ id: 'custom_id_123', title: 'Test' });

      const savedNode = saveNode.mock.calls[0][0];
      expect(savedNode.id).toBe('custom_id_123');
      expect(task.id).toBe('custom_id_123');
    });

    it('creates DERIVED_FROM edge when contentId is provided', async () => {
      await createTask({ title: 'Linked task' }, 'entry_abc');

      expect(addEdge).toHaveBeenCalledTimes(1);
      const edge = addEdge.mock.calls[0][0];
      expect(edge.sourceType).toBe('task');
      expect(edge.targetType).toBe('entry');
      expect(edge.targetId).toBe('entry_abc');
      expect(edge.edgeType).toBe('DERIVED_FROM');
    });

    it('does not create edge when no contentId', async () => {
      await createTask({ title: 'Solo task' });
      expect(addEdge).not.toHaveBeenCalled();
    });

    it('gracefully handles edge creation failure', async () => {
      addEdge.mockRejectedValue(new Error('Edge store error'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const task = await createTask({ title: 'Resilient' }, 'entry_fail');
      // Task creation itself should succeed
      expect(task.title).toBe('Resilient');
      expect(saveNode).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('sets sourceContentId in properties', async () => {
      await createTask({ title: 'Linked' }, 'entry_xyz');

      const savedNode = saveNode.mock.calls[0][0];
      expect(savedNode.properties.sourceContentId).toBe('entry_xyz');
    });

    it('defaults title to "Untitled Task"', async () => {
      const task = await createTask({});
      expect(task.title).toBe('Untitled Task');
    });
  });

  // ── updateTask ────────────────────────────────────────────────────────────

  describe('updateTask', () => {
    it('updates task properties via updateNode', async () => {
      const existingNode = makeTaskNode({ id: 'task_upd' });
      updateNode.mockImplementation(async (id, updater) => updater(existingNode));

      const result = await updateTask('task_upd', { title: 'Updated Title' });

      expect(updateNode).toHaveBeenCalledWith('task_upd', expect.any(Function));
      expect(result).toBe(true);
    });

    it('returns false when node is null', async () => {
      updateNode.mockImplementation(async (id, updater) => updater(null));

      const result = await updateTask('missing_task', { title: 'nope' });
      expect(result).toBe(false);
    });

    it('returns false when node is not a task type', async () => {
      updateNode.mockImplementation(async (id, updater) =>
        updater({ id: 'entry_1', type: 'entry', properties: {} })
      );

      const result = await updateTask('entry_1', { title: 'wrong type' });
      expect(result).toBe(false);
    });

    it('sets doneAt when status changes to done', async () => {
      const node = makeTaskNode({ id: 'task_done' });
      let capturedNode;
      updateNode.mockImplementation(async (id, updater) => {
        capturedNode = updater(node);
        return capturedNode;
      });

      await updateTask('task_done', { status: 'done' });
      expect(capturedNode.properties.doneAt).toBeTypeOf('number');
      expect(capturedNode.properties.doneAt).toBeGreaterThan(0);
    });

    it('sets ignoredAt when status changes to ignored', async () => {
      const node = makeTaskNode({ id: 'task_ign' });
      let capturedNode;
      updateNode.mockImplementation(async (id, updater) => {
        capturedNode = updater(node);
        return capturedNode;
      });

      await updateTask('task_ign', { status: 'ignored' });
      expect(capturedNode.properties.ignoredAt).toBeTypeOf('number');
    });

    it('clears timestamps and output when reverting to pending', async () => {
      const node = makeTaskNode({
        id: 'task_revert',
        properties: {
          status: 'done',
          doneAt: Date.now(),
          output: 'some output',
          ignoredReason: 'no longer needed',
        },
      });
      let capturedNode;
      updateNode.mockImplementation(async (id, updater) => {
        capturedNode = updater(node);
        return capturedNode;
      });

      await updateTask('task_revert', { status: 'pending' });
      expect(capturedNode.properties.doneAt).toBeNull();
      expect(capturedNode.properties.ignoredAt).toBeNull();
      expect(capturedNode.properties.output).toBeNull();
      expect(capturedNode.properties.ignoredReason).toBeNull();
    });
  });

  // ── deleteTaskNode ────────────────────────────────────────────────────────

  describe('deleteTaskNode', () => {
    it('deletes a task node and its edges', async () => {
      getNode.mockResolvedValue(makeTaskNode({ id: 'task_del' }));

      const result = await deleteTaskNode('task_del');
      expect(result).toBe(true);
      expect(deleteNode).toHaveBeenCalledWith('task_del');
      expect(removeEdgesForNode).toHaveBeenCalledWith('task', 'task_del');
    });

    it('returns false when node does not exist', async () => {
      getNode.mockResolvedValue(null);

      const result = await deleteTaskNode('nonexistent');
      expect(result).toBe(false);
      expect(deleteNode).not.toHaveBeenCalled();
    });

    it('returns false when node is not a task', async () => {
      getNode.mockResolvedValue({ id: 'entry_1', type: 'entry' });

      const result = await deleteTaskNode('entry_1');
      expect(result).toBe(false);
      expect(deleteNode).not.toHaveBeenCalled();
    });

    it('tolerates edge removal failure', async () => {
      getNode.mockResolvedValue(makeTaskNode({ id: 'task_edge_fail' }));
      removeEdgesForNode.mockRejectedValue(new Error('edge error'));

      // Should not throw — edge removal has .catch(() => {})
      const result = await deleteTaskNode('task_edge_fail');
      expect(result).toBe(true);
      expect(deleteNode).toHaveBeenCalledWith('task_edge_fail');
    });
  });

  // ── Normalization ─────────────────────────────────────────────────────────

  describe('normalization (_normalizeNode)', () => {
    it('normalizes a full task node into UnifiedTask shape', async () => {
      const now = Date.now();
      const node = makeTaskNode({
        id: 'task_norm',
        createdAt: now,
        properties: {
          title: 'Normalized',
          status: 'done',
          assignee: 'takus',
          action: 'DRAFT_EMAIL',
          objective: 'Write email',
          output: 'Email sent',
          deadline: '2026-06-01',
          urgency: 'high',
          steps: [{ label: 'Draft' }],
          doneAt: now + 1000,
          sourceContentId: 'entry_src',
        },
      });
      getNodesByType.mockResolvedValue([node]);

      const [task] = await getAllTasks();
      expect(task.id).toBe('task_norm');
      expect(task.title).toBe('Normalized');
      expect(task.status).toBe('done');
      expect(task.assignee).toBe('takus');
      expect(task.action).toBe('DRAFT_EMAIL');
      expect(task.objective).toBe('Write email');
      expect(task.output).toBe('Email sent');
      expect(task.deadline).toBe('2026-06-01');
      expect(task.urgency).toBe('high');
      expect(task.steps).toEqual([{ label: 'Draft' }]);
      expect(task.priority).toBe(0);
      expect(task.priorityTier).toBe('low');
      expect(task.doneAt).toBe(now + 1000);
      expect(task.createdAt).toBe(now);
      expect(task._storageType).toBe('node');
      expect(task._contentId).toBe('entry_src');
      expect(task.source).toEqual({
        id: 'entry_src',
        title: '',
        date: now,
        type: 'screen',
      });
    });

    it('handles missing properties gracefully', async () => {
      const node = { id: 'task_bare', type: 'task', createdAt: 1000 };
      getNodesByType.mockResolvedValue([node]);

      const [task] = await getAllTasks();
      expect(task.title).toBe('');
      expect(task.status).toBe('pending');
      expect(task.assignee).toBe('me');
      expect(task.action).toBe('TAKUS_TASK');
      expect(task.objective).toBeNull();
      expect(task.steps).toEqual([]);
      expect(task.source).toBeNull();
      expect(task._contentId).toBeNull();
    });
  });

  // ── computeTaskAnalytics ──────────────────────────────────────────────────

  describe('computeTaskAnalytics', () => {
    it('computes correct analytics for mixed tasks', async () => {
      const now = Date.now();
      const MS_PER_HOUR = 3600000;
      const MS_PER_DAY = 86400000;
      const MS_PER_WEEK = 604800000;

      getNodesByType.mockResolvedValue([
        // 2 pending tasks — one recent, one overdue
        makeTaskNode({ id: 't1', createdAt: now - MS_PER_DAY, properties: { status: 'pending', action: 'DRAFT_EMAIL' } }),
        makeTaskNode({ id: 't2', createdAt: now - (MS_PER_WEEK + MS_PER_DAY), properties: { status: 'pending', action: 'DRAFT_EMAIL' } }),
        // 1 done task completed recently with resolution time
        makeTaskNode({
          id: 't3',
          createdAt: now - 2 * MS_PER_HOUR,
          properties: { status: 'done', doneAt: now - MS_PER_HOUR, action: 'CREATE_BUG_REPORT' },
        }),
        // 1 ignored task
        makeTaskNode({ id: 't4', properties: { status: 'ignored', action: 'ME_TASK' } }),
      ]);

      const analytics = await computeTaskAnalytics();
      expect(analytics.total).toBe(4);
      expect(analytics.pending).toBe(2);
      expect(analytics.done).toBe(1);
      expect(analytics.ignored).toBe(1);
      expect(analytics.overdueCount).toBe(1);  // t2 is older than 7 days
      expect(analytics.velocity).toBe(1);       // t3 done within last week
      expect(analytics.avgResolutionHours).toBe(1); // 1 hour resolution
      expect(analytics.topActions).toEqual([
        { action: 'DRAFT_EMAIL', count: 2 },
      ]);
      // completionPct = done / (total - ignored) = 1/3 ≈ 33%
      expect(analytics.completionPct).toBe(33);
    });

    it('returns zero analytics when no tasks exist', async () => {
      getNodesByType.mockResolvedValue([]);

      const analytics = await computeTaskAnalytics();
      expect(analytics.total).toBe(0);
      expect(analytics.pending).toBe(0);
      expect(analytics.done).toBe(0);
      expect(analytics.completionPct).toBe(0);
      expect(analytics.velocity).toBe(0);
      expect(analytics.overdueCount).toBe(0);
      expect(analytics.topActions).toEqual([]);
    });

    it('returns fallback on exception', async () => {
      getNodesByType.mockRejectedValue(new Error('DB crashed'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const analytics = await computeTaskAnalytics();
      expect(analytics.total).toBe(0);
      expect(analytics.pending).toBe(0);

      warnSpy.mockRestore();
    });

    it('handles all-done tasks with 100% completion', async () => {
      const now = Date.now();
      getNodesByType.mockResolvedValue([
        makeTaskNode({ id: 't1', createdAt: now - 1000, properties: { status: 'done', doneAt: now } }),
        makeTaskNode({ id: 't2', createdAt: now - 2000, properties: { status: 'done', doneAt: now } }),
      ]);

      const analytics = await computeTaskAnalytics();
      expect(analytics.completionPct).toBe(100);
      expect(analytics.pending).toBe(0);
    });

    it('limits topActions to 3 entries', async () => {
      const now = Date.now();
      getNodesByType.mockResolvedValue([
        makeTaskNode({ id: 't1', properties: { status: 'pending', action: 'A' } }),
        makeTaskNode({ id: 't2', properties: { status: 'pending', action: 'B' } }),
        makeTaskNode({ id: 't3', properties: { status: 'pending', action: 'C' } }),
        makeTaskNode({ id: 't4', properties: { status: 'pending', action: 'D' } }),
        makeTaskNode({ id: 't5', properties: { status: 'pending', action: 'A' } }),
      ]);

      const analytics = await computeTaskAnalytics();
      expect(analytics.topActions).toHaveLength(3);
      expect(analytics.topActions[0].action).toBe('A');
      expect(analytics.topActions[0].count).toBe(2);
    });
  });
});
