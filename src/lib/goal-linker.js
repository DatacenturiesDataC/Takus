
// Connects tasks to goals, enabling strategic progress tracking.
// When a task is completed, its parent goal's progress is updated.
//
// Uses the graph's CONTRIBUTES_TO edges to model the relationship.

import { getNodesByType, addEdge, getEdgesForNode } from './storage.js';
import { getAllTasks } from './graph/task-store.js';

/**
 * Link a task to a goal.
 *
 * @param {string} taskId
 * @param {string} goalId
 * @returns {Promise<void>}
 */
export async function linkTaskToGoal(taskId, goalId) {
  await addEdge({
    sourceType: 'task',
    sourceId: taskId,
    targetType: 'goal',
    targetId: goalId,
    edgeType: 'CONTRIBUTES_TO',
    metadata: { linkedAt: Date.now() },
  });
}

/**
 * Get all tasks linked to a goal.
 *
 * @param {string} goalId
 * @returns {Promise<{task: object, edge: object}[]>}
 */
export async function getTasksForGoal(goalId) {
  const tasks = await getAllTasks().catch(() => []);
  const edges = await getEdgesForNode('goal', goalId).catch(() => []);

  const linkedTaskIds = new Set(
    edges
      .filter(e => e.edgeType === 'CONTRIBUTES_TO' && e.targetId === goalId)
      .map(e => e.sourceId)
  );

  return tasks
    .filter(t => linkedTaskIds.has(t.id))
    .map(t => ({
      task: t,
      edge: edges.find(e => e.sourceId === t.id && e.targetId === goalId),
    }));
}

/**
 * Get all goals a task contributes to.
 *
 * @param {string} taskId
 * @returns {Promise<object[]>}
 */
export async function getGoalsForTask(taskId) {
  const edges = await getEdgesForNode('task', taskId).catch(() => []);
  const goalIds = edges
    .filter(e => e.edgeType === 'CONTRIBUTES_TO' && e.sourceId === taskId)
    .map(e => e.targetId);

  if (!goalIds.length) return [];

  const allGoals = await getNodesByType('goal').catch(() => []);
  return allGoals.filter(g => goalIds.includes(g.id));
}

/**
 * Compute goal progress based on linked tasks.
 *
 * @param {string} goalId
 * @returns {Promise<{total: number, done: number, pending: number, ignored: number, progressPct: number}>}
 */
export async function computeGoalProgress(goalId) {
  const linked = await getTasksForGoal(goalId);

  const result = { total: linked.length, done: 0, pending: 0, ignored: 0, progressPct: 0 };

  for (const { task } of linked) {
    if (task.status === 'done') result.done++;
    else if (task.status === 'ignored') result.ignored++;
    else result.pending++;
  }

  // Progress = done / (total - ignored)
  const effective = result.total - result.ignored;
  result.progressPct = effective > 0 ? Math.round((result.done / effective) * 100) : 0;

  return result;
}

/**
 * Auto-link tasks to goals by matching objective text.
 * Scans pending tasks for objective fields that match goal titles.
 *
 * @returns {Promise<{linked: number, taskIds: string[]}>}
 */
export async function autoLinkTasks() {
  const goals = await getNodesByType('goal').catch(() => []);
  const tasks = await getAllTasks().catch(() => []);

  if (!goals.length || !tasks.length) return { linked: 0, taskIds: [] };

  // Build lookup: normalized goal title → goal ID
  const goalLookup = new Map();
  for (const g of goals) {
    const title = (g.properties?.title || '').toLowerCase().trim();
    if (title.length >= 4) goalLookup.set(title, g.id);
  }

  const linked = [];

  for (const task of tasks) {
    if (task.status !== 'pending') continue;
    const objective = (task.objective || '').toLowerCase().trim();
    if (!objective || objective.length < 3) continue;

    // Check if any goal title matches the task's objective
    for (const [goalTitle, goalId] of goalLookup) {
      const escaped = goalTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('\\b' + escaped + '\\b', 'i');
        if (re.test(objective) || re.test(goalTitle)) {
        // Check not already linked
        const existing = await getEdgesForNode('task', task.id).catch(() => []);
        const alreadyLinked = existing.some(
          e => e.edgeType === 'CONTRIBUTES_TO' && e.targetId === goalId
        );
        if (!alreadyLinked) {
          await linkTaskToGoal(task.id, goalId);
          linked.push(task.id);
        }
        break; // One goal per task
      }
    }
  }

  return { linked: linked.length, taskIds: linked };
}

/**
 * Get a summary of all goals with their progress.
 *
 * @returns {Promise<Array<{id: string, title: string, state: string, progress: object}>>}
 */
export async function getGoalProgressSummary() {
  const goals = await getNodesByType('goal').catch(() => []);
  const results = [];

  for (const g of goals) {
    const progress = await computeGoalProgress(g.id);
    results.push({
      id: g.id,
      title: g.properties?.title || 'Untitled',
      state: g.properties?.state || 'aspiration',
      progress,
    });
  }

  return results;
}
