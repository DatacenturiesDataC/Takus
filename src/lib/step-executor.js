// Takus — Step Executor
// Registry-based step execution engine for autonomous task workflows.
// Maps step types to handler functions and orchestrates execution
// with dependency checking and consent gates.

import { generateId } from './id.js';

/**
 * @typedef {object} Step
 * @property {string} step_id
 * @property {string} title
 * @property {string} type - Step type key (e.g. 'ai_transcribe', 'notify_user')
 * @property {string} assignee - 'takus' or a human identifier
 * @property {'pending'|'queued'|'executing'|'completed'|'failed'|'waiting_input'} status
 * @property {string[]} [dependsOn] - IDs of steps that must complete first
 * @property {object} [config] - Step-specific configuration
 * @property {*} [result] - Output from execution
 * @property {string} [error] - Error message if failed
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

// ── Execution Engine ─────────────────────────────────────────────────────────

/**
 * Check whether a step's dependencies are all satisfied.
 *
 * @param {Step} step
 * @param {Step[]} allSteps - All steps in the same task
 * @returns {boolean}
 */
export function areDependenciesMet(step, allSteps) {
  if (!step.dependsOn?.length) return true;
  return step.dependsOn.every(depId => {
    const dep = allSteps.find(s => s.step_id === depId);
    return dep && dep.status === 'completed';
  });
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
    if (step.status === 'completed' || step.status === 'failed') {
      continue;
    }

    // Skip human-assigned steps
    if (step.assignee !== 'takus') {
      skipped++;
      continue;
    }

    // Check dependencies
    if (!areDependenciesMet(step, steps)) {
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
    startedAt: null,
    completedAt: null,
  };
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
    audioBlob, context.apiKey, context.recordingType || 'screen', context.aiProvider || 'openai'
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
    context.recordingType || 'screen',
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
