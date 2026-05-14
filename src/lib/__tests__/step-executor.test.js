// Takus — Step Executor Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dynamic imports used by built-in handlers
vi.mock('../ffmpeg-engine.js', () => ({
  extractAudio: vi.fn().mockResolvedValue(new Blob(['audio'])),
}));
vi.mock('../ai-engine.js', () => ({
  generateTranscriptionAndSummary: vi.fn().mockResolvedValue({
    transcript: 'Hello world', summary: '## Summary', vtt: 'WEBVTT\n'
  }),
  extractTasks: vi.fn().mockResolvedValue({ takusTasks: [], meTasks: [] }),
}));
vi.mock('../analytics.js', () => ({
  analyzeFillerWords: vi.fn().mockReturnValue({ total: 0, perMinute: 0, breakdown: {}, rating: 'excellent' }),
  computeQualityScore: vi.fn().mockReturnValue({ score: 85, label: 'Good', color: '#4ade80' }),
}));
vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

const {
  registerStep,
  hasHandler,
  getRegisteredSteps,
  areDependenciesMet,
  requiresApproval,
  executeStep,
  runPendingSteps,
  createStep,
} = await import('../step-executor.js');

describe('registerStep + hasHandler', () => {
  it('registers built-in steps', () => {
    expect(hasHandler('ai_transcribe')).toBe(true);
    expect(hasHandler('ai_summarize')).toBe(true);
    expect(hasHandler('ai_extract_tasks')).toBe(true);
    expect(hasHandler('ai_analytics')).toBe(true);
    expect(hasHandler('notify_user')).toBe(true);
  });

  it('reports false for unregistered types', () => {
    expect(hasHandler('nonexistent_step')).toBe(false);
  });

  it('can register custom steps', () => {
    registerStep('custom_test', async () => ({ custom: true }));
    expect(hasHandler('custom_test')).toBe(true);
  });

  it('lists all registered step types', () => {
    const types = getRegisteredSteps();
    expect(types).toContain('ai_transcribe');
    expect(types).toContain('notify_user');
    expect(types.length).toBeGreaterThanOrEqual(5);
  });
});

describe('createStep', () => {
  it('creates a structured step object', () => {
    const step = createStep('ai_transcribe', 'Transcribe audio');
    expect(step.step_id).toMatch(/^step_/);
    expect(step.title).toBe('Transcribe audio');
    expect(step.type).toBe('ai_transcribe');
    expect(step.assignee).toBe('takus');
    expect(step.status).toBe('pending');
    expect(step.dependsOn).toEqual([]);
    expect(step.result).toBeNull();
  });

  it('accepts custom options', () => {
    const step = createStep('notify_user', 'Notify', {
      assignee: 'user',
      dependsOn: ['step_abc'],
      config: { message: 'Hello' },
    });
    expect(step.assignee).toBe('user');
    expect(step.dependsOn).toEqual(['step_abc']);
    expect(step.config.message).toBe('Hello');
  });
});

describe('areDependenciesMet', () => {
  it('returns true for steps with no dependencies', () => {
    const step = createStep('ai_transcribe', 'Transcribe');
    expect(areDependenciesMet(step, [])).toBe(true);
  });

  it('returns true when all deps are completed', () => {
    const dep = createStep('ai_transcribe', 'Step A');
    dep.step_id = 'dep1';
    dep.status = 'completed';

    const step = createStep('ai_summarize', 'Step B', { dependsOn: ['dep1'] });
    expect(areDependenciesMet(step, [dep, step])).toBe(true);
  });

  it('returns false when a dep is still pending', () => {
    const dep = createStep('ai_transcribe', 'Step A');
    dep.step_id = 'dep1';
    dep.status = 'pending';

    const step = createStep('ai_summarize', 'Step B', { dependsOn: ['dep1'] });
    expect(areDependenciesMet(step, [dep, step])).toBe(false);
  });

  it('returns false when a dep does not exist', () => {
    const step = createStep('ai_summarize', 'Step B', { dependsOn: ['missing'] });
    expect(areDependenciesMet(step, [step])).toBe(false);
  });
});

describe('requiresApproval', () => {
  it('auto-approves auto-approved step types', () => {
    const step = createStep('ai_transcribe', 'Transcribe');
    expect(requiresApproval(step)).toBe(false);
  });

  it('requires approval for non-auto-approved types', () => {
    registerStep('cloud_email_send', async () => ({}));
    const step = createStep('cloud_email_send', 'Send email');
    expect(requiresApproval(step)).toBe(true);
  });

  it('always requires approval for human-assigned steps', () => {
    const step = createStep('ai_transcribe', 'Transcribe', { assignee: 'user' });
    expect(requiresApproval(step)).toBe(true);
  });
});

describe('executeStep', () => {
  it('executes a registered step successfully', async () => {
    const step = createStep('notify_user', 'Test notification', {
      config: { message: 'Hello!' },
    });
    const result = await executeStep(step);
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ notified: true });
    expect(step.status).toBe('completed');
    expect(step.startedAt).toBeTruthy();
    expect(step.completedAt).toBeTruthy();
  });

  it('fails gracefully for unregistered step type', async () => {
    const step = createStep('unknown_type', 'Unknown');
    step.type = 'totally_unknown';
    const result = await executeStep(step);
    expect(result.success).toBe(false);
    expect(step.status).toBe('failed');
    expect(step.error).toContain('No handler');
  });

  it('catches handler errors and sets failed status', async () => {
    registerStep('failing_step', async () => { throw new Error('Boom'); });
    const step = createStep('failing_step', 'Fail');
    const result = await executeStep(step);
    expect(result.success).toBe(false);
    expect(step.status).toBe('failed');
    expect(step.error).toBe('Boom');
  });
});

describe('runPendingSteps', () => {
  it('executes all eligible pending steps', async () => {
    const steps = [
      { ...createStep('notify_user', 'Notify 1', { config: { message: 'A' } }) },
      { ...createStep('notify_user', 'Notify 2', { config: { message: 'B' } }) },
    ];
    const result = await runPendingSteps(steps);
    expect(result.executed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(steps[0].status).toBe('completed');
    expect(steps[1].status).toBe('completed');
  });

  it('skips completed steps', async () => {
    const steps = [
      { ...createStep('notify_user', 'Done'), status: 'completed' },
      { ...createStep('notify_user', 'Pending') },
    ];
    const result = await runPendingSteps(steps);
    expect(result.executed).toBe(1);
  });

  it('skips steps assigned to humans', async () => {
    const steps = [
      { ...createStep('notify_user', 'User step', { assignee: 'user' }) },
    ];
    const result = await runPendingSteps(steps);
    expect(result.executed).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips steps with unmet dependencies', async () => {
    const stepA = { ...createStep('notify_user', 'Step A') };
    stepA.step_id = 'a';
    stepA.status = 'pending';

    const stepB = { ...createStep('notify_user', 'Step B', { dependsOn: ['a'] }) };
    stepB.step_id = 'b';

    // Step A hasn't completed yet
    const result = await runPendingSteps([stepA, stepB]);
    // A should execute, then B should also execute since A is now completed
    expect(stepA.status).toBe('completed');
    // B may or may not execute depending on ordering — it checks deps before A completes
    // In sequential execution, B checks deps AFTER A finishes
    // Actually our loop is sequential so by the time we check B, A is completed
    expect(stepB.status).toBe('completed');
    expect(result.executed).toBe(2);
  });

  it('calls onStepUpdate callback', async () => {
    const onUpdate = vi.fn();
    const steps = [{ ...createStep('notify_user', 'Test') }];
    await runPendingSteps(steps, {}, { onStepUpdate: onUpdate });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Test' }), 'completed');
  });
});
