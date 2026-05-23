
// Takus — Task Store (Knowledge OS: Graph Foundation)
// Tasks are first-class graph nodes in the `nodes` store.
// All task operations go through the graph — no embedded storage.

import { generateId } from '../id.js';
import { saveNode, getNode, getNodesByType, deleteNode, addEdge, removeEdgesForNode, updateNode } from '../storage.js';
import { getTaskStatus, getTaskTitle } from '../task-helpers.js';

import { MS_PER_HOUR, MS_PER_DAY, MS_PER_WEEK } from '../utils.js';

// ── Normalized Task Shape ──────────────────────────────────────────────────

/**
 * @typedef {object} UnifiedTask
 * @property {string} id
 * @property {string} title
 * @property {'pending'|'done'|'ignored'} status
 * @property {'takus'|'me'} assignee
 * @property {string} action - Action type (e.g. CREATE_BUG_REPORT, DRAFT_EMAIL)
 * @property {string|null} objective
 * @property {string|null} output
 * @property {string|null} ignoredReason
 * @property {string|null} contextTimestamp
 * @property {string|null} deadline
 * @property {Array} steps
 * @property {number} priority - Computed priority score
 * @property {string} priorityTier
 * @property {string|null} priorityOverride
 * @property {number} createdAt
 * @property {number|null} doneAt
 * @property {number|null} ignoredAt
 * @property {object} source - { id, title, date, type } of the source entry
 * @property {string} _storageType - 'embedded' or 'node' (internal)
 * @property {string} _contentId - Source entry ID (internal)
 */

// ── Read Operations ────────────────────────────────────────────────────────

/**
 * Get all tasks from the graph nodes store.
 * @returns {Promise<UnifiedTask[]>}
 */
export async function getAllTasks() {
  return _getStandaloneTasks();
}

/**
 * Get all tasks for a specific content entry.
 * @param {string} contentId
 * @returns {Promise<UnifiedTask[]>}
 */
export async function getTasksByContent(contentId) {
  const all = await getAllTasks();
  return all.filter(t => t._contentId === contentId);
}
/**
 * Get a single task by ID.
 * @param {string} taskId
 * @returns {Promise<UnifiedTask|null>}
 */
export async function getTask(taskId) {
  // Check standalone nodes first (faster lookup)
  const node = await getNode(taskId);
  if (node && node.type === 'task') {
    return _normalizeNode(node);
  }

  // Fall back to embedded search
  const all = await getAllTasks();
  return all.find(t => t.id === taskId) || null;
}

/**
 * Get task counts by status.
 * @returns {Promise<{pending: number, done: number, ignored: number, total: number}>}
 */
export async function getTaskCounts() {
  const all = await getAllTasks();
  return {
    pending: all.filter(t => t.status === 'pending').length,
    done: all.filter(t => t.status === 'done').length,
    ignored: all.filter(t => t.status === 'ignored').length,
    total: all.length,
  };
}

// ── Write Operations ───────────────────────────────────────────────────────

/**
 * Create a new standalone task as a graph node.
 * Optionally links it to a source entry via a DERIVED_FROM edge.
 *
 * @param {object} taskData - { title, assignee, action, objective, steps, ... }
 * @param {string} [contentId] - Source entry to link from
 * @returns {Promise<UnifiedTask>}
 */
export async function createTask(taskData, contentId = null) {
  const id = taskData.id || generateId('task');
  const now = Date.now();

  const node = {
    id,
    type: 'task',
    state: 'active',
    appId: 'tasks',
    properties: {
      title: taskData.title || 'Untitled Task',
      status: taskData.status || 'pending',
      assignee: taskData.assignee || 'me',
      action: taskData.action || 'TAKUS_TASK',
      objective: taskData.objective || null,
      output: taskData.output || null,
      ignoredReason: taskData.ignoredReason || null,
      contextTimestamp: taskData.contextTimestamp || null,
      deadline: taskData.deadline || null,
      urgency: taskData.urgency || 'normal',
      steps: taskData.steps || [],
      sequence: taskData.sequence || null,
      integrations: taskData.integrations || [],
      priorityOverride: taskData.priorityOverride || null,
      note: taskData.note || null,
      doneAt: null,
      ignoredAt: null,
      sourceContentId: contentId,
    },
    createdAt: now,
    updatedAt: now,
  };

  await saveNode(node);

  // Link to source entry via edge
  if (contentId) {
    await addEdge({
      sourceType: 'task',
      sourceId: id,
      targetType: 'entry',
      targetId: contentId,
      edgeType: 'DERIVED_FROM',
      metadata: { createdAt: now },
    }).catch(e => console.warn('[TaskStore] DERIVED_FROM edge failed:', e.message));
  }

  return _normalizeNode(node);
}

/**
 * Update an existing task.
 * Works with both embedded and standalone tasks.
 *
 * @param {string} taskId
 * @param {object} updates - Partial task fields to merge
 * @returns {Promise<boolean>} Whether the update succeeded
 */
export async function updateTask(taskId, updates) {
  const result = await updateNode(taskId, (node) => {
    if (!node || node.type !== 'task') return null;

    Object.assign(node.properties, updates);

    if (updates.status === 'done') node.properties.doneAt = Date.now();
    if (updates.status === 'ignored') node.properties.ignoredAt = Date.now();
    if (updates.status === 'pending') {
      node.properties.doneAt = null;
      node.properties.ignoredAt = null;
      node.properties.output = null;
      node.properties.ignoredReason = null;
    }

    return node;
  });

  return !!result;
}

/**
 * Delete a standalone task node.
 * Embedded tasks can only be removed by editing their parent entry.
 *
 * @param {string} taskId
 * @returns {Promise<boolean>}
 */
export async function deleteTaskNode(taskId) {
  const node = await getNode(taskId);
  if (node && node.type === 'task') {
    await Promise.all([
      deleteNode(taskId),
      removeEdgesForNode('task', taskId).catch(() => {}),
    ]);
    return true;
  }
  return false;
}

// ── Internal: Standalone Nodes ─────────────────────────────────────────────

async function _getStandaloneTasks() {
  const nodes = await getNodesByType('task').catch(() => []);
  return nodes.map(_normalizeNode);
}

function _normalizeNode(node) {
  const p = node.properties || {};
  return {
    id: node.id,
    title: p.title || '',
    status: p.status || 'pending',
    assignee: p.assignee || 'me',
    action: p.action || 'TAKUS_TASK',
    objective: p.objective || null,
    output: p.output || null,
    ignoredReason: p.ignoredReason || null,
    contextTimestamp: p.contextTimestamp || null,
    deadline: p.deadline || null,
    urgency: p.urgency || 'normal',
    steps: p.steps || [],
    sequence: p.sequence || null,
    integrations: p.integrations || [],
    priority: 0,
    priorityTier: 'low',
    priorityOverride: p.priorityOverride || null,
    createdAt: node.createdAt || Date.now(),
    doneAt: p.doneAt || null,
    ignoredAt: p.ignoredAt || null,
    source: p.sourceContentId
      ? { id: p.sourceContentId, title: '', date: node.createdAt, type: p.sourceType || 'screen' }
      : null,
    _storageType: 'node',
    _contentId: p.sourceContentId || null,
  };
}

// ── Task Analytics ──────────────────────────────────────────────

/**
 * Compute task analytics — platform utility.
 * Pure computation, no side effects.
 *
 * @returns {Promise<object>} Task analytics summary
 */
export async function computeTaskAnalytics() {
  try {
    const tasks = await getAllTasks();
    const now = Date.now();

    const pending = tasks.filter(t => t.status === 'pending');
    const done = tasks.filter(t => t.status === 'done');
    const ignored = tasks.filter(t => t.status === 'ignored');
    const total = tasks.length || 1;

    // Completion rate (done / non-ignored)
    const nonIgnored = total - ignored.length || 1;
    const completionPct = Math.round((done.length / nonIgnored) * 100);

    // Average resolution time (for done tasks with timestamps)
    const doneWithTimes = done.filter(t => t.doneAt && t.createdAt);
    const avgResolutionMs = doneWithTimes.length > 0
      ? doneWithTimes.reduce((sum, t) => sum + (t.doneAt - t.createdAt), 0) / doneWithTimes.length
      : 0;
    const avgResolutionHours = Math.round(avgResolutionMs / MS_PER_HOUR);

    // Velocity: tasks completed in the last 7 days
    const recentDone = done.filter(t => t.doneAt && (now - t.doneAt) < MS_PER_WEEK);
    const velocity = recentDone.length;

    // Overdue: pending tasks older than 7 days
    const overdue = pending.filter(t => t.createdAt && (now - t.createdAt) > MS_PER_WEEK);

    // Top action types (for pending tasks)
    const actionCounts = {};
    for (const t of pending) {
      const a = t.action || 'ME_TASK';
      actionCounts[a] = (actionCounts[a] || 0) + 1;
    }
    const topActions = Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([action, count]) => ({ action, count }));

    // Oldest pending task age in days
    const oldestPendingDays = pending.length > 0
      ? Math.round(Math.max(...pending.map(t => (now - (t.createdAt || now)) / MS_PER_DAY)))
      : 0;

    return {
      total: tasks.length,
      pending: pending.length,
      done: done.length,
      ignored: ignored.length,
      completionPct,
      avgResolutionHours,
      velocity,
      overdueCount: overdue.length,
      oldestPendingDays,
      topActions,
    };
  } catch (e) {
    console.warn('[TaskStore] Analytics computation failed:', e.message);
    return { total: 0, pending: 0, done: 0, ignored: 0, completionPct: 0, avgResolutionHours: 0, velocity: 0, overdueCount: 0, oldestPendingDays: 0, topActions: [] };
  }
}
