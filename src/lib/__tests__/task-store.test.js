// Takus — Task Store Tests
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock storage at module level before imports
vi.mock('../storage.js', () => {
  const recordings = [];
  const nodes = new Map();
  const edges = [];

  return {
    getRecordings: vi.fn(() => Promise.resolve([...recordings])),
    saveRecording: vi.fn((rec) => {
      const idx = recordings.findIndex(r => r.id === rec.id);
      if (idx >= 0) recordings[idx] = rec;
      else recordings.push(rec);
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
    _testRecordings: recordings,
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
  createTask, updateTask, deleteTaskNode, promoteToNode,
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

    it('returns embedded tasks from recordings', async () => {
      _testRecordings.push({
        id: 'rec_1', title: 'Meeting', date: 1000, type: 'meeting',
        tasks: {
          takusTasks: [{ id: 'tt_1', title: 'File bug', action: 'CREATE_BUG_REPORT', status: 'pending' }],
          meTasks: [{ id: 'mt_1', title: 'Follow up', status: 'pending' }],
        },
      });

      const tasks = await getAllTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('tt_1');
      expect(tasks[0].assignee).toBe('takus');
      expect(tasks[0]._storageType).toBe('embedded');
      expect(tasks[1].id).toBe('mt_1');
      expect(tasks[1].assignee).toBe('me');
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

    it('deduplicates — standalone wins over embedded', async () => {
      _testRecordings.push({
        id: 'rec_1', title: 'Meeting', date: 1000, type: 'meeting',
        tasks: {
          takusTasks: [{ id: 'shared_id', title: 'Old embedded', status: 'pending' }],
          meTasks: [],
        },
      });
      _testNodes.set('shared_id', {
        id: 'shared_id', type: 'task', state: 'active', appId: 'tasks',
        properties: { title: 'New standalone', status: 'done', assignee: 'takus' },
        createdAt: 3000, updatedAt: 3000,
      });

      const tasks = await getAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('New standalone');
      expect(tasks[0].status).toBe('done');
      expect(tasks[0]._storageType).toBe('node');
    });
  });

  describe('getTasksByRecording', () => {
    it('filters by recording ID', async () => {
      _testRecordings.push(
        { id: 'rec_1', title: 'A', date: 1000, type: 'meeting', tasks: { takusTasks: [{ id: 't1', title: 'X', status: 'pending' }], meTasks: [] } },
        { id: 'rec_2', title: 'B', date: 2000, type: 'screen', tasks: { takusTasks: [{ id: 't2', title: 'Y', status: 'pending' }], meTasks: [] } },
      );

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

    it('falls back to embedded search', async () => {
      _testRecordings.push({
        id: 'rec_1', title: 'M', date: 1000, type: 'meeting',
        tasks: { takusTasks: [], meTasks: [{ id: 'emb_1', title: 'Embedded', status: 'pending' }] },
      });

      const task = await getTask('emb_1');
      expect(task).toBeTruthy();
      expect(task.title).toBe('Embedded');
    });

    it('returns null for missing task', async () => {
      expect(await getTask('nonexistent')).toBeNull();
    });
  });

  describe('getTaskCounts', () => {
    it('counts by status', async () => {
      _testRecordings.push({
        id: 'rec_1', title: 'M', date: 1000, type: 'meeting',
        tasks: {
          takusTasks: [
            { id: 't1', title: 'A', status: 'pending' },
            { id: 't2', title: 'B', status: 'done' },
          ],
          meTasks: [
            { id: 't3', title: 'C', status: 'ignored' },
          ],
        },
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

    it('creates a DERIVED_FROM edge when recording ID is provided', async () => {
      const task = await createTask({ title: 'Linked task' }, 'rec_123');

      expect(addEdge).toHaveBeenCalled();
      const edge = _testEdges[_testEdges.length - 1];
      expect(edge.sourceType).toBe('task');
      expect(edge.sourceId).toBe(task.id);
      expect(edge.targetType).toBe('recording');
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

    it('updates embedded task', async () => {
      _testRecordings.push({
        id: 'rec_1', title: 'M', date: 1000, type: 'meeting',
        tasks: { takusTasks: [{ id: 'emb_u1', title: 'Old', status: 'pending' }], meTasks: [] },
      });

      const result = await updateTask('emb_u1', { status: 'done' });
      expect(result).toBe(true);

      const task = _testRecordings[0].tasks.takusTasks[0];
      expect(task.status).toBe('done');
      expect(task.doneAt).toBeTypeOf('number');
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

  describe('promoteToNode', () => {
    it('creates a node from an embedded task preserving ID', async () => {
      const embedded = { id: 'emb_p1', title: 'Promoted', status: 'pending', action: 'DRAFT_EMAIL' };
      const result = await promoteToNode(embedded, 'rec_1');

      expect(result.id).toBe('emb_p1');
      expect(result._storageType).toBe('node');
      expect(_testNodes.has('emb_p1')).toBe(true);
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
      _testRecordings.push({
        id: 'rec_1', title: 'M', date: Date.now(), type: 'meeting',
        tasks: {
          takusTasks: [
            { id: 't1', title: 'A', status: 'pending', action: 'CREATE_BUG_REPORT' },
            { id: 't2', title: 'B', status: 'done', doneAt: Date.now(), action: 'DRAFT_EMAIL' },
          ],
          meTasks: [
            { id: 't3', title: 'C', status: 'ignored' },
          ],
        },
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
      _testRecordings.push({
        id: 'rec_1', title: 'Old', date: Date.now() - WEEK - 1000, type: 'screen',
        tasks: {
          takusTasks: [{ id: 'old_1', title: 'Stale', status: 'pending' }],
          meTasks: [],
        },
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
