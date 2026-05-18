// Takus — Approval Center (Phase 53)
// Surfaces tasks that require user approval before Takus can execute them.
// This is the governance layer — users review, approve, or reject
// proposed autonomous actions before they take effect.
//
// Architecture: The approval queue is derived from the task graph —
// tasks with status 'waiting_input' or steps that requiresApproval().

import { getAllTasks } from './graph/task-store.js';
import { requiresApproval } from './step-executor.js';
import { getTaskTitle } from './task-helpers.js';

/**
 * @typedef {object} ApprovalItem
 * @property {string} id — Unique approval ID
 * @property {string} taskId — Parent task ID
 * @property {string} contentId — Source entry
 * @property {string} title — Human-readable summary of what needs approval
 * @property {string} description — Details about the proposed action
 * @property {string} type — 'step_execution' | 'task_creation' | 'integration_action'
 * @property {string} assignee — Who assigned ('takus' or a human name)
 * @property {number} createdAt
 * @property {'pending'|'approved'|'rejected'} status
 * @property {object} [payload] — Step/action data
 */

/**
 * Get all items awaiting user approval.
 * Scans tasks for steps with 'waiting_input' status.
 *
 * @returns {Promise<ApprovalItem[]>}
 */
export async function getApprovalQueue() {
  const tasks = await getAllTasks().catch(() => []);
  const queue = [];

  for (const task of tasks) {
    if (task.status !== 'pending') continue;

    // Check for steps that need approval
    const steps = task.steps || [];
    for (const step of steps) {
      if (step.status === 'waiting_input' && requiresApproval(step)) {
        queue.push({
          id: `approval_${task.id}_${step.step_id}`,
          taskId: task.id,
          contentId: task.contentId || task.sourceId || null,
          title: step.title || `Execute: ${step.type}`,
          description: _describeStep(step, task),
          type: 'step_execution',
          assignee: step.assignee || 'takus',
          createdAt: task.createdAt || Date.now(),
          status: 'pending',
          payload: { stepId: step.step_id, stepType: step.type, config: step.config },
        });
      }
    }

    // Check for tasks that have integration actions needing consent
    if (task.integrations?.length > 0 && task.status === 'pending') {
      for (const integration of task.integrations) {
        if (integration.status === 'pending' && integration.requiresApproval !== false) {
          queue.push({
            id: `approval_${task.id}_int_${integration.provider}`,
            taskId: task.id,
            contentId: task.contentId || task.sourceId || null,
            title: `Send to ${integration.provider}: ${getTaskTitle(task, 'Untitled')}`,
            description: `Route task "${getTaskTitle(task)}" to ${integration.provider}`,
            type: 'integration_action',
            assignee: 'takus',
            createdAt: task.createdAt || Date.now(),
            status: 'pending',
            payload: { provider: integration.provider, integration },
          });
        }
      }
    }
  }

  // Sort newest first
  queue.sort((a, b) => b.createdAt - a.createdAt);
  return queue;
}

/**
 * Get the approval queue count (for badge).
 * @returns {Promise<number>}
 */
export async function getApprovalCount() {
  const queue = await getApprovalQueue();
  return queue.length;
}

/**
 * Approve an item — execute the pending step.
 *
 * @param {ApprovalItem} item
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function approveItem(item) {
  if (item.type === 'step_execution') {
    const { updateTask } = await import('./graph/task-store.js');
    const tasks = await getAllTasks();
    const task = tasks.find(t => t.id === item.taskId);
    if (!task) return { success: false, error: 'Task not found' };

    const step = (task.steps || []).find(s => s.step_id === item.payload?.stepId);
    if (!step) return { success: false, error: 'Step not found' };

    // Execute the step
    const { executeStep } = await import('./step-executor.js');
    const result = await executeStep(step, {});
    if (result.success) {
      await updateTask(item.taskId, { steps: task.steps });
      return { success: true };
    }
    return { success: false, error: result.error };
  }

  if (item.type === 'integration_action') {
    // Mark integration as approved
    const { updateTask } = await import('./graph/task-store.js');
    const tasks = await getAllTasks();
    const task = tasks.find(t => t.id === item.taskId);
    if (!task) return { success: false, error: 'Task not found' };

    const integration = (task.integrations || []).find(
      i => i.provider === item.payload?.provider
    );
    if (integration) {
      integration.status = 'approved';
      integration.approvedAt = Date.now();
      await updateTask(item.taskId, { integrations: task.integrations });
    }
    return { success: true };
  }

  return { success: false, error: `Unknown approval type: ${item.type}` };
}

/**
 * Reject an item — skip/cancel the pending step.
 *
 * @param {ApprovalItem} item
 * @param {string} [reason]
 * @returns {Promise<{success: boolean}>}
 */
export async function rejectItem(item, reason = '') {
  const { updateTask } = await import('./graph/task-store.js');
  const tasks = await getAllTasks();
  const task = tasks.find(t => t.id === item.taskId);
  if (!task) return { success: false };

  if (item.type === 'step_execution') {
    const step = (task.steps || []).find(s => s.step_id === item.payload?.stepId);
    if (step) {
      step.status = 'skipped';
      step.error = reason || 'Rejected by user';
      step.completedAt = Date.now();
      await updateTask(item.taskId, { steps: task.steps });
    }
  }

  if (item.type === 'integration_action') {
    const integration = (task.integrations || []).find(
      i => i.provider === item.payload?.provider
    );
    if (integration) {
      integration.status = 'rejected';
      integration.rejectedReason = reason;
      await updateTask(item.taskId, { integrations: task.integrations });
    }
  }

  return { success: true };
}

// ── Private ──────────────────────────────────────────────────────────────────

function _describeStep(step, task) {
  const typeDescriptions = {
    ai_transcribe: 'Transcribe the entry using AI',
    ai_summarize: 'Generate an AI summary of the transcript',
    ai_extract_tasks: 'Extract action items and decisions',
    ai_analytics: 'Compute quality metrics and filler word analysis',
    notify_user: 'Send a notification to the user',
  };
  const desc = typeDescriptions[step.type] || `Execute step: ${step.type}`;
  return `${desc} for task "${getTaskTitle(task, 'Untitled')}"`;
}
