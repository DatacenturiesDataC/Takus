// Takus — Task Store Tests
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock storage at module level before imports
vi.mock('../storage.js', () => {
  const entries = [];
  const nodes = new Map();
  const edges = [];

  return {
    getEntries: vi.fn(() => Promise.resolve([...entries])),
    saveEntry: vi.fn((rec) => {
      const idx = entries.findIndex(r => r.id === rec.id);
      if (idx >= 0) entries[idx] = rec;
      else entries.push(rec);
      return Promise.resolve();
    }),
    saveNode: vi.fn((node) => { nodes.set(node.id, { ...node }); return Promise.resolve(); }),
    getNode: vi.fn((id) => Promise.resolve(nodes.get(id) ? { ...nodes.get(id) } : null)),
    getNodesByType: vi.fn((type) => {
      const result = [];
      for (const n of nodes.values()) { if (n.type === type) result.push({ ...n }); }
      return Promise.resolve(result);
    }),
    deleteNode: vi.fn((id) => { nodes.delete(id); return Promise.resolve(); }),
    removeEdgesForNode: vi.fn(() => Promise.resolve()),
    addEdge: vi.fn((edge) => { edges.push(edge); return Promise.resolve(); }),
    getSetting: vi.fn(() => Promise.resolve(null)),
    saveSetting: vi.fn(() => Promise.resolve()),

    // Expose internals for test reset
    _testRecordings: entries,
    _testNodes: nodes,
    _testEdges: edges,
  };
});

vi.mock('../ai-engine.js', () => ({
  normalizeTask: vi.fn((t) => {
    if (!t.status) t.status = 'pending';
    if (!t.id) t.id = `task_${Math.random().toString(36).slice(2)}`;
  }),
}));

vi.mock('../task-helpers.js', () => ({
  getTaskStatus: vi.fn((t) => t.status || 'pending'),
  isTaskPending: vi.fn((t) => (t.status || 'pending') === 'pending'),
  getTaskTitle: vi.fn((t, fallback = 'Task') => t.title || t.note || fallback),
}));

vi.mock('../task-priority.js', () => ({
  computeTaskPriority: vi.fn(() => 50),
  getPriorityTier: vi.fn(() => 'medium'),
}));

import {
  getAllTasks, getTasksByRecording, getTask, getTaskCounts,
  createTask, updateTask, deleteTaskNode,
  computeTaskAnalytics,
} from '../graph/task-store.js';

import { _testRecordings, _testNodes, _testEdges, addEdge } from '../storage.js';

describe('Task Store', () => {
  beforeEach(() => {
    _testRecordings.length = 0;
    _testNodes.clear();
    _testEdges.length = 0;
  });

  describe('getAllTasks', () => {
    it('returns empty array when no data exists', async () => {
      const tasks = await getAllTasks();
      expect(tasks).toEqual([]);
    });

    it('returns tasks from graph nodes', async () => {
      _testNodes.set('task_1', {
        id: 'task_1', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'Node task', status: 'pending', assignee: 'takus', sourceRecordingId: 'rec_1' },
        createdAt: 1000, updatedAt: 1000,
      });
      _testNodes.set('task_2', {
        id: 'task_2', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'Another task', status: 'done', assignee: 'me', sourceRecordingId: 'rec_1' },
        createdAt: 2000, updatedAt: 2000,
      });

      const tasks = await getAllTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0]._storageType).toBe('node');
    });

    it('returns standalone node tasks', async () => {
      _testNodes.set('task_1', {
        id: 'task_1', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'Standalone', status: 'pending', assignee: 'me' },
        createdAt: 2000, updatedAt: 2000,
      });

      const tasks = await getAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task_1');
      expect(tasks[0]._storageType).toBe('node');
    });
  });

  describe('getTasksByRecording', () => {
    it('filters by entry ID', async () => {
      _testNodes.set('t1', {
        id: 't1', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'X', status: 'pending', assignee: 'takus', sourceRecordingId: 'rec_1' },
        createdAt: 1000, updatedAt: 1000,
      });
      _testNodes.set('t2', {
        id: 't2', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'Y', status: 'pending', assignee: 'takus', sourceRecordingId: 'rec_2' },
        createdAt: 2000, updatedAt: 2000,
      });

      const tasks = await getTasksByRecording('rec_1');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('t1');
    });
  });

  describe('getTask', () => {
    it('finds standalone node by ID', async () => {
      _testNodes.set('task_x', {
        id: 'task_x', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'Found it', status: 'pending' },
        createdAt: 1000, updatedAt: 1000,
      });

      const task = await getTask('task_x');
      expect(task).toBeTruthy();
      expect(task.title).toBe('Found it');
    });

    it('returns null for missing task', async () => {
      expect(await getTask('nonexistent')).toBeNull();
    });
  });

  describe('getTaskCounts', () => {
    it('counts by status', async () => {
      _testNodes.set('t1', {
        id: 't1', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'A', status: 'pending', assignee: 'takus' },
        createdAt: 1000, updatedAt: 1000,
      });
      _testNodes.set('t2', {
        id: 't2', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'B', status: 'done', assignee: 'takus' },
        createdAt: 1000, updatedAt: 1000,
      });
      _testNodes.set('t3', {
        id: 't3', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'C', status: 'ignored', assignee: 'me' },
        createdAt: 1000, updatedAt: 1000,
      });

      const counts = await getTaskCounts();
      expect(counts.pending).toBe(1);
      expect(counts.done).toBe(1);
      expect(counts.ignored).toBe(1);
      expect(counts.total).toBe(3);
    });
  });

  describe('createTask', () => {
    it('creates a node with correct structure', async () => {
      const task = await createTask({ title: 'New task', assignee: 'me' });

      expect(task.id).toBeTruthy();
      expect(task.title).toBe('New task');
      expect(task.status).toBe('pending');
      expect(task._storageType).toBe('node');

      // Verify node was saved
      expect(_testNodes.has(task.id)).toBe(true);
    });

    it('creates a DERIVED_FROM edge when entry ID is provided', async () => {
      const task = await createTask({ title: 'Linked task' }, 'rec_123');

      expect(addEdge).toHaveBeenCalled();
      const edge = _testEdges[_testEdges.length - 1];
      expect(edge.sourceType).toBe('task');
      expect(edge.sourceId).toBe(task.id);
      expect(edge.targetType).toBe('entry');
      expect(edge.targetId).toBe('rec_123');
      expect(edge.edgeType).toBe('DERIVED_FROM');
    });

    it('preserves custom ID', async () => {
      const task = await createTask({ id: 'custom_id', title: 'Custom' });
      expect(task.id).toBe('custom_id');
    });
  });

  describe('updateTask', () => {
    it('updates standalone node', async () => {
      _testNodes.set('task_u1', {
        id: 'task_u1', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'Original', status: 'pending' },
        createdAt: 1000, updatedAt: 1000,
      });

      const result = await updateTask('task_u1', { status: 'done', output: 'Completed' });
      expect(result).toBe(true);

      const updated = _testNodes.get('task_u1');
      expect(updated.properties.status).toBe('done');
      expect(updated.properties.output).toBe('Completed');
      expect(updated.properties.doneAt).toBeTypeOf('number');
    });

    it('returns false for missing task', async () => {
      expect(await updateTask('ghost', { status: 'done' })).toBe(false);
    });
  });

  describe('deleteTaskNode', () => {
    it('deletes standalone node', async () => {
      _testNodes.set('task_d1', { id: 'task_d1', type: 'task', state: 'active', appId: 'tasks', properties: {} });

      const result = await deleteTaskNode('task_d1');
      expect(result).toBe(true);
      expect(_testNodes.has('task_d1')).toBe(false);
    });

    it('returns false for embedded tasks', async () => {
      expect(await deleteTaskNode('nonexistent')).toBe(false);
    });
  });



  // ── Task Analytics (Phase 47) ──────────────────────────────────────────

  describe('computeTaskAnalytics', () => {
    it('returns zeros on empty store', async () => {
      const analytics = await computeTaskAnalytics();
      expect(analytics.total).toBe(0);
      expect(analytics.pending).toBe(0);
      expect(analytics.completionPct).toBe(0);
      expect(analytics.velocity).toBe(0);
      expect(analytics.overdueCount).toBe(0);
      expect(analytics.topActions).toEqual([]);
    });

    it('computes completion rate and status counts', async () => {
      _testNodes.set('t1', {
        id: 't1', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'A', status: 'pending', assignee: 'takus', action: 'CREATE_BUG_REPORT' },
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      _testNodes.set('t2', {
        id: 't2', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'B', status: 'done', doneAt: Date.now(), assignee: 'takus', action: 'DRAFT_EMAIL' },
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      _testNodes.set('t3', {
        id: 't3', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'C', status: 'ignored', assignee: 'me' },
        createdAt: Date.now(), updatedAt: Date.now(),
      });

      const analytics = await computeTaskAnalytics();
      expect(analytics.total).toBe(3);
      expect(analytics.pending).toBe(1);
      expect(analytics.done).toBe(1);
      expect(analytics.ignored).toBe(1);
      expect(analytics.completionPct).toBe(50); // 1 done / 2 non-ignored = 50%
      expect(analytics.topActions).toEqual([{ action: 'CREATE_BUG_REPORT', count: 1 }]);
    });

    it('detects overdue tasks (older than 7 days)', async () => {
      const WEEK = 7 * 86400000;
      _testNodes.set('old_1', {
        id: 'old_1', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'Stale', status: 'pending', assignee: 'me' },
        createdAt: Date.now() - WEEK - 1000, updatedAt: Date.now(),
      });

      const analytics = await computeTaskAnalytics();
      expect(analytics.overdueCount).toBe(1);
      expect(analytics.oldestPendingDays).toBeGreaterThanOrEqual(7);
    });

    it('tracks velocity (recent completions)', async () => {
      const now = Date.now();
      const threeDaysAgo = now - 3 * 86400000;
      _testNodes.set('vel_1', {
        id: 'vel_1', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'Recent done', status: 'done', doneAt: now - 86400000, assignee: 'me' },
        createdAt: threeDaysAgo, updatedAt: now,
      });
      _testNodes.set('vel_2', {
        id: 'vel_2', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'Also recent', status: 'done', doneAt: now - 2 * 86400000, assignee: 'me' },
        createdAt: threeDaysAgo, updatedAt: now,
      });

      const analytics = await computeTaskAnalytics();
      expect(analytics.velocity).toBe(2);
    });
  });
});
