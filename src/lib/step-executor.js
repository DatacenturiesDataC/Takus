// Takus — Step Executor
// Registry-based step execution engine for autonomous task workflows.
// Maps step types to handler functions and orchestrates execution
// with dependency checking and consent gates.
//
// Architecture note: The step executor defines AI handlers (ai_transcribe,
// ai_summarize, etc.) for sub-step execution when a user clicks "Run" on a
// task step, and for the autonomy engine's background processing. The main
// recording pipeline (content-pipeline.js) calls AI functions directly for
// the primary recording flow. These are intentionally separate code paths —
// the pipeline is optimized for the single-recording happy path, while the
// step executor handles arbitrary step graphs with dependency resolution.

import { generateId } from './id.js';
import { MS_PER_DAY } from './utils.js';

// ── Limits ───────────────────────────────────────────────────────────────────

/** Maximum steps allowed per task to prevent unbounded growth */
export const MAX_STEPS_PER_TASK = 50;

/** Maximum automatic retries for a failed step before escalation */
export const MAX_STEP_RETRIES = 3;

/**
 * @typedef {object} Step
 * @property {string} step_id
 * @property {string} title
 * @property {string} type - Step type key (e.g. 'ai_transcribe', 'notify_user')
 * @property {string} assignee - 'takus' or a human identifier
 * @property {'pending'|'queued'|'executing'|'completed'|'failed'|'waiting_input'|'skipped'} status
 * @property {string[]} [dependsOn] - IDs of steps that must complete first
 * @property {object} [config] - Step-specific configuration
 * @property {*} [result] - Output from execution
 * @property {string} [error] - Error message if failed
 * @property {number} [retryCount] - Number of times this step has been retried
 * @property {number} [startedAt]
 * @property {number} [completedAt]
 */

/**
 * @typedef {function(Step, object): Promise<*>} StepHandler
 * A function that executes a step and returns a result.
 * The second argument is a context object with recording data, settings, etc.
 */

// ── Step Registry ────────────────────────────────────────────────────────────

/** @type {Map<string, StepHandler>} */
const _registry = new Map();

/** @type {Set<string>} Auto-approved step types (don't require user confirmation) */
const _autoApproved = new Set([
  'ai_transcribe',
  'ai_summarize',
  'ai_extract_tasks',
  'ai_analytics',
  'notify_user',
]);

/**
 * Register a step handler.
 *
 * @param {string} type - Step type key
 * @param {StepHandler} handler - Async function that executes the step
 * @param {object} [options]
 * @param {boolean} [options.autoApprove=false] - Whether this step runs without user consent
 */
export function registerStep(type, handler, options = {}) {
  _registry.set(type, handler);
  if (options.autoApprove) _autoApproved.add(type);
}

/**
 * Check if a step type is registered.
 *
 * @param {string} type
 * @returns {boolean}
 */
export function hasHandler(type) {
  return _registry.has(type);
}

/**
 * Get all registered step types.
 *
 * @returns {string[]}
 */
export function getRegisteredSteps() {
  return [..._registry.keys()];
}

// ── Cycle Detection ──────────────────────────────────────────────────────────

/**
 * Detect dependency cycles in a set of steps.
 * Uses iterative DFS with a visited/in-stack approach.
 *
 * @param {Step[]} steps
 * @returns {{ hasCycle: boolean, cycle?: string[] }}
 */
export function detectCycles(steps) {
  const adj = new Map();
  for (const s of steps) {
    adj.set(s.step_id, s.dependsOn || []);
  }

  const visited = new Set();
  const inStack = new Set();

  for (const s of steps) {
    if (visited.has(s.step_id)) continue;
    // Iterative DFS
    const stack = [{ id: s.step_id, entering: true }];
    while (stack.length > 0) {
      const { id, entering } = stack.pop();
      if (!entering) { inStack.delete(id); continue; }
      if (inStack.has(id)) {
        return { hasCycle: true, cycle: [...inStack, id] };
      }
      if (visited.has(id)) continue;
      visited.add(id);
      inStack.add(id);
      stack.push({ id, entering: false }); // will remove from inStack on backtrack
      for (const dep of (adj.get(id) || [])) {
        if (inStack.has(dep)) {
          return { hasCycle: true, cycle: [...inStack, dep] };
        }
        if (!visited.has(dep)) {
          stack.push({ id: dep, entering: true });
        }
      }
    }
  }
  return { hasCycle: false };
}

// ── Execution Engine ─────────────────────────────────────────────────────────

/**
 * Check whether a step's dependencies are all satisfied.
 * Returns 'met' if all deps completed, 'blocked' if deps are pending/executing,
 * or 'failed' if any dependency permanently failed or was skipped.
 *
 * @param {Step} step
 * @param {Step[]} allSteps - All steps in the same task
 * @returns {'met'|'blocked'|'failed'}
 */
export function getDependencyStatus(step, allSteps) {
  if (!step.dependsOn?.length) return 'met';
  for (const depId of step.dependsOn) {
    const dep = allSteps.find(s => s.step_id === depId);
    if (!dep) return 'failed'; // Missing dependency = permanent failure
    if (dep.status === 'failed' || dep.status === 'skipped') return 'failed';
    if (dep.status !== 'completed') return 'blocked';
  }
  return 'met';
}

/**
 * Check whether a step's dependencies are all satisfied (legacy API).
 *
 * @param {Step} step
 * @param {Step[]} allSteps - All steps in the same task
 * @returns {boolean}
 */
export function areDependenciesMet(step, allSteps) {
  return getDependencyStatus(step, allSteps) === 'met';
}

/**
 * Check if a step requires user approval before execution.
 *
 * @param {Step} step
 * @returns {boolean}
 */
export function requiresApproval(step) {
  if (step.assignee !== 'takus') return true; // human steps always need approval
  return !_autoApproved.has(step.type);
}

/**
 * Execute a single step.
 *
 * @param {Step} step - Step to execute (mutated in place)
 * @param {object} context - Execution context (recording, settings, etc.)
 * @returns {Promise<{success: boolean, result?: *, error?: string}>}
 */
export async function executeStep(step, context = {}) {
  const handler = _registry.get(step.type);
  if (!handler) {
    step.status = 'failed';
    step.error = `No handler registered for step type: ${step.type}`;
    return { success: false, error: step.error };
  }

  step.status = 'executing';
  step.startedAt = Date.now();

  try {
    const result = await handler(step, context);
    step.status = 'completed';
    step.result = result;
    step.completedAt = Date.now();
    return { success: true, result };
  } catch (err) {
    step.status = 'failed';
    step.error = err.message || 'Unknown error';
    step.completedAt = Date.now();
    return { success: false, error: step.error };
  }
}

/**
 * Run all pending, eligible steps in a task.
 * Skips steps that are waiting for dependencies or user approval.
 *
 * @param {Step[]} steps - All steps in the task (mutated in place)
 * @param {object} context - Execution context
 * @param {object} [options]
 * @param {function(Step, string): void} [options.onStepUpdate] - Called when a step changes status
 * @returns {Promise<{executed: number, skipped: number, failed: number}>}
 */
export async function runPendingSteps(steps, context = {}, options = {}) {
  const { onStepUpdate } = options;
  let executed = 0, skipped = 0, failed = 0;

  for (const step of steps) {
    // Skip already-processed steps
    if (step.status === 'completed' || step.status === 'failed' || step.status === 'skipped') {
      continue;
    }

    // Skip human-assigned steps
    if (step.assignee !== 'takus') {
      skipped++;
      continue;
    }

    // Check dependencies — auto-skip if a dependency permanently failed
    const depStatus = getDependencyStatus(step, steps);
    if (depStatus === 'failed') {
      step.status = 'skipped';
      step.error = 'Skipped: a dependency failed or was skipped';
      step.completedAt = Date.now();
      onStepUpdate?.(step, 'skipped');
      skipped++;
      continue;
    }
    if (depStatus === 'blocked') {
      step.status = 'pending';
      skipped++;
      continue;
    }

    // Check approval
    if (requiresApproval(step)) {
      step.status = 'waiting_input';
      onStepUpdate?.(step, 'waiting_input');
      skipped++;
      continue;
    }

    // Execute
    const result = await executeStep(step, context);
    onStepUpdate?.(step, step.status);

    if (result.success) {
      executed++;
    } else {
      failed++;
    }
  }

  return { executed, skipped, failed };
}

/**
 * Create a structured step object.
 *
 * @param {string} type
 * @param {string} title
 * @param {object} [options]
 * @returns {Step}
 */
export function createStep(type, title, options = {}) {
  return {
    step_id: generateId('step'),
    title,
    type,
    assignee: options.assignee || 'takus',
    status: 'pending',
    dependsOn: options.dependsOn || [],
    config: options.config || {},
    result: null,
    error: null,
    retryCount: 0,
    startedAt: null,
    completedAt: null,
  };
}

/**
 * Validate a list of steps before adding to a task.
 * Checks: step count cap, dependency cycle detection.
 *
 * @param {Step[]} existingSteps - Already existing steps in the task
 * @param {Step[]} newSteps - Steps being added
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateSteps(existingSteps, newSteps) {
  const total = existingSteps.length + newSteps.length;
  if (total > MAX_STEPS_PER_TASK) {
    return { valid: false, error: `Step limit exceeded: ${total}/${MAX_STEPS_PER_TASK}` };
  }
  const allSteps = [...existingSteps, ...newSteps];
  const { hasCycle, cycle } = detectCycles(allSteps);
  if (hasCycle) {
    return { valid: false, error: `Dependency cycle detected: ${cycle?.join(' → ')}` };
  }
  return { valid: true };
}

// ── Checkpointed Execution ───────────────────────────────────────────────────

/**
 * Run steps with IDB checkpointing for crash resilience.
 * After each step executes, the step array is persisted to IDB.
 * On completion, the checkpoint is deleted.
 *
 * @param {string} taskKey - Checkpoint key, e.g. `{contentId}:{taskIndex}`
 * @param {string} contentId
 * @param {number} taskIndex
 * @param {Step[]} steps - Steps to execute (mutated in place)
 * @param {object} context - Execution context
 * @param {object} [options]
 * @param {function(Step, string): void} [options.onStepUpdate]
 * @returns {Promise<{executed: number, skipped: number, failed: number}>}
 */
export async function runWithCheckpoint(taskKey, contentId, taskIndex, steps, context = {}, options = {}) {
  const { saveStepCheckpoint, deleteStepCheckpoint } = await import('./storage.js');

  // Save initial checkpoint
  await saveStepCheckpoint({
    taskKey,
    contentId,
    taskIndex,
    steps: steps.map(s => ({ ...s })),
  }).catch(() => {}); // Don't block on checkpoint failure

  const originalOnUpdate = options.onStepUpdate;

  const result = await runPendingSteps(steps, context, {
    ...options,
    onStepUpdate: async (step, status) => {
      originalOnUpdate?.(step, status);
      // Checkpoint after each step state change
      await saveStepCheckpoint({
        taskKey,
        contentId,
        taskIndex,
        steps: steps.map(s => ({ ...s })),
      }).catch(() => {});
    },
  });

  // All steps processed — clean up checkpoint
  const allDone = steps.every(s =>
    s.status === 'completed' || s.status === 'failed' || s.status === 'skipped'
  );
  if (allDone) {
    await deleteStepCheckpoint(taskKey).catch(() => {});
  }

  return result;
}

/**
 * Resume interrupted step executions from IDB checkpoints.
 * Called on app startup to recover from tab crashes.
 *
 * @param {object} context - Execution context (must include apiKey, etc.)
 * @param {object} [options]
 * @param {function(Step, string): void} [options.onStepUpdate]
 * @returns {Promise<{resumed: number, completed: number, errors: number}>}
 */
export async function resumeCheckpoints(context = {}, options = {}) {
  const { getAllPendingCheckpoints, deleteStepCheckpoint } = await import('./storage.js');
  let resumed = 0, completed = 0, errors = 0;

  let checkpoints;
  try {
    checkpoints = await getAllPendingCheckpoints();
  } catch {
    return { resumed: 0, completed: 0, errors: 0 };
  }

  for (const cp of checkpoints) {
    // Skip stale checkpoints (older than 24h)
    if (Date.now() - (cp.updatedAt || 0) > MS_PER_DAY) {
      await deleteStepCheckpoint(cp.taskKey).catch(() => {});
      continue;
    }

    try {
      resumed++;
      const result = await runPendingSteps(cp.steps, context, options);
      const allDone = cp.steps.every(s =>
        s.status === 'completed' || s.status === 'failed' || s.status === 'skipped'
      );
      if (allDone) {
        completed++;
        await deleteStepCheckpoint(cp.taskKey).catch(() => {});
      }
    } catch {
      errors++;
    }
  }

  return { resumed, completed, errors };
}

// ── Built-in Step Handlers ───────────────────────────────────────────────────

/**
 * Notify the user with a toast message.
 * Auto-approved — runs without user confirmation.
 */
registerStep('notify_user', async (step) => {
  const { notifyEphemeral } = await import('./notification-manager.js');
  const msg = step.config?.message || step.title;
  const type = step.config?.toastType || 'info';
  notifyEphemeral('Task Step', msg, type);
  return { notified: true };
}, { autoApprove: true });

/**
 * AI transcription step — wraps the existing pipeline.
 * Auto-approved — runs automatically after recording.
 */
registerStep('ai_transcribe', async (step, context) => {
  const { extractAudio } = await import('./ffmpeg-engine.js');
  const { generateTranscriptionAndSummary } = await import('./ai-engine.js');

  if (!context.blob) throw new Error('No recording blob in context');
  if (!context.apiKey) throw new Error('No AI API key configured');

  const audioBlob = await extractAudio(context.blob);
  const { transcript, vtt } = await generateTranscriptionAndSummary(
    audioBlob, context.apiKey, context.contentType || 'screen', context.aiProvider || 'openai'
  );

  return { transcript, vtt };
}, { autoApprove: true });

/**
 * AI summarization step.
 * Auto-approved — runs automatically.
 */
registerStep('ai_summarize', async (step, context) => {
  const { generateTranscriptionAndSummary } = await import('./ai-engine.js');

  if (!context.transcript) throw new Error('No transcript available for summarization');
  // The current AI engine combines transcription + summary in one call.
  // This step is typically a no-op if transcript+summary were already generated together.
  return { summary: context.summary || '(summary generated with transcript)' };
}, { autoApprove: true });

/**
 * AI task extraction step.
 * Auto-approved — extracts action items from transcript.
 */
registerStep('ai_extract_tasks', async (step, context) => {
  const { extractTasks } = await import('./ai-engine.js');

  if (!context.transcript) throw new Error('No transcript available for task extraction');
  if (!context.apiKey) throw new Error('No AI API key configured');

  const result = await extractTasks(
    context.transcript,
    context.observerLog || {},
    context.contentType || 'screen',
    context.apiKey,
    context.aiProvider || 'openai'
  );

  return result;
}, { autoApprove: true });

/**
 * Analytics computation step.
 * Auto-approved — pure local computation.
 */
registerStep('ai_analytics', async (step, context) => {
  const { analyzeFillerWords, computeQualityScore } = await import('./analytics.js');

  if (!context.transcript) throw new Error('No transcript for analytics');

  const fillerWords = analyzeFillerWords(context.transcript, context.duration || 0);
  const score = computeQualityScore({
    aiTranscript: context.transcript,
    aiSummary: context.summary,
    tasks: context.tasks,
    duration: context.duration,
  });

  return { fillerWords, score };
}, { autoApprove: true });
