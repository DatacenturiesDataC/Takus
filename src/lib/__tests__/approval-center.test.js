// Takus — Approval Center Tests (Phase 53)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTasks = [
  {
    id: 'task_1', title: 'Transcribe entry', status: 'pending',
    contentId: 'rec_1', createdAt: Date.now(),
    steps: [
      { step_id: 'step_1', type: 'ai_transcribe', status: 'completed', assignee: 'takus' },
      { step_id: 'step_2', type: 'custom_action', status: 'waiting_input', assignee: 'takus', title: 'Run custom analysis' },
    ],
    integrations: [],
  },
  {
    id: 'task_2', title: 'Review design', status: 'pending',
    contentId: 'rec_2', createdAt: Date.now() - 3600000,
    steps: [],
    integrations: [
      { provider: 'jira', status: 'pending', requiresApproval: true },
    ],
  },
  {
    id: 'task_3', title: 'Done task', status: 'done',
    steps: [{ step_id: 'step_x', type: 'custom', status: 'waiting_input', assignee: 'takus' }],
    integrations: [],
  },
];

vi.mock('../graph/task-store.js', () => ({
  getAllTasks: vi.fn(() => Promise.resolve(mockTasks.map(t => ({ ...t, steps: t.steps?.map(s => ({ ...s })), integrations: t.integrations?.map(i => ({ ...i })) })))),
  updateTask: vi.fn(() => Promise.resolve()),
}));

vi.mock('../step-executor.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    executeStep: vi.fn((step) => {
      step.status = 'completed';
      return Promise.resolve({ success: true, result: {} });
    }),
  };
});

import { getApprovalQueue, getApprovalCount, approveItem, rejectItem } from '../approval-center.js';

describe('Approval Center', () => {
  describe('getApprovalQueue', () => {
    it('returns items needing approval', async () => {
      const queue = await getApprovalQueue();
      expect(queue.length).toBeGreaterThanOrEqual(1);
    });

    it('includes step execution approvals', async () => {
      const queue = await getApprovalQueue();
      const stepApprovals = queue.filter(i => i.type === 'step_execution');
      expect(stepApprovals.length).toBeGreaterThanOrEqual(1);
      expect(stepApprovals[0].payload.stepType).toBe('custom_action');
    });

    it('includes integration approvals', async () => {
      const queue = await getApprovalQueue();
      const intApprovals = queue.filter(i => i.type === 'integration_action');
      expect(intApprovals.length).toBeGreaterThanOrEqual(1);
      expect(intApprovals[0].payload.provider).toBe('jira');
    });

    it('excludes done tasks', async () => {
      const queue = await getApprovalQueue();
      const fromDone = queue.filter(i => i.taskId === 'task_3');
      expect(fromDone).toHaveLength(0);
    });

    it('sorts newest first', async () => {
      const queue = await getApprovalQueue();
      for (let i = 1; i < queue.length; i++) {
        expect(queue[i - 1].createdAt).toBeGreaterThanOrEqual(queue[i].createdAt);
      }
    });
  });

  describe('getApprovalCount', () => {
    it('returns count matching queue length', async () => {
      const count = await getApprovalCount();
      const queue = await getApprovalQueue();
      expect(count).toBe(queue.length);
    });
  });

  describe('approveItem', () => {
    it('executes a step approval', async () => {
      const queue = await getApprovalQueue();
      const stepItem = queue.find(i => i.type === 'step_execution');
      if (stepItem) {
        const result = await approveItem(stepItem);
        expect(result.success).toBe(true);
      }
    });

    it('handles integration approval', async () => {
      const queue = await getApprovalQueue();
      const intItem = queue.find(i => i.type === 'integration_action');
      if (intItem) {
        const result = await approveItem(intItem);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('rejectItem', () => {
    it('rejects a step approval', async () => {
      const queue = await getApprovalQueue();
      const stepItem = queue.find(i => i.type === 'step_execution');
      if (stepItem) {
        const result = await rejectItem(stepItem, 'Not needed');
        expect(result.success).toBe(true);
      }
    });
  });
});
