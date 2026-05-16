// Takus — Task Helpers
// Centralized task and sub-step status utilities.
// Single source of truth for status resolution, eliminating
// scattered inline checks and legacy `task.done` fallbacks.

/**
 * Resolve the canonical status of a task.
 * Handles both the modern `task.status` field and the legacy `task.done` boolean.
 *
 * @param {object} task
 * @returns {'pending'|'done'|'ignored'}
 */
export function getTaskStatus(task) {
  if (task.status) return task.status;
  return task.done ? 'done' : 'pending';
}

/**
 * Resolve the canonical display title of a task.
 * Handles the modern `task.title` field, the deprecated `task.text`,
 * and the legacy `task.note` with a sensible fallback.
 *
 * @param {object} task
 * @param {string} [fallback='Task']
 * @returns {string}
 */
export function getTaskTitle(task, fallback = 'Task') {
  return task.title || task.text || task.note || fallback;
}

/**
 * Check if a task is pending.
 * @param {object} task
 * @returns {boolean}
 */
export function isTaskPending(task) {
  return getTaskStatus(task) === 'pending';
}

/**
 * Check if a task is done.
 * @param {object} task
 * @returns {boolean}
 */
export function isTaskDone(task) {
  return getTaskStatus(task) === 'done';
}

/**
 * Check if a task is ignored.
 * @param {object} task
 * @returns {boolean}
 */
export function isTaskIgnored(task) {
  return getTaskStatus(task) === 'ignored';
}

/**
 * Check if a sub-step is complete.
 * Handles both the legacy `step.done` boolean and the modern `step.status` field.
 *
 * @param {object} step
 * @returns {boolean}
 */
export function isStepDone(step) {
  return step.done === true || step.status === 'completed';
}

/**
 * Count completed sub-steps in a task.
 *
 * @param {object} task
 * @returns {number}
 */
export function getStepDoneCount(task) {
  if (!task.steps?.length) return 0;
  return task.steps.filter(isStepDone).length;
}

/**
 * Get total step count for a task.
 *
 * @param {object} task
 * @returns {number}
 */
export function getStepTotalCount(task) {
  return task.steps?.length || 0;
}

/**
 * Check if all sub-steps in a task are complete.
 *
 * @param {object} task
 * @returns {boolean}
 */
export function areAllStepsDone(task) {
  const total = getStepTotalCount(task);
  return total > 0 && getStepDoneCount(task) === total;
}
