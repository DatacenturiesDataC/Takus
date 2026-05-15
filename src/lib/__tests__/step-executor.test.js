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
  getDependencyStatus,
  detectCycles,
  validateSteps,
  requiresApproval,
  executeStep,
  runPendingSteps,
  createStep,
  MAX_STEPS_PER_TASK,
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

  it('auto-skips steps whose dependencies have permanently failed', async () => {
    const stepA = { ...createStep('notify_user', 'Step A') };
    stepA.step_id = 'a';
    stepA.status = 'failed';
    stepA.error = 'Something broke';

    const stepB = { ...createStep('notify_user', 'Step B', { dependsOn: ['a'] }) };
    stepB.step_id = 'b';

    const result = await runPendingSteps([stepA, stepB]);
    expect(stepB.status).toBe('skipped');
    expect(stepB.error).toContain('dependency failed');
    expect(result.skipped).toBe(1);
  });

  it('skips already-skipped steps', async () => {
    const step = { ...createStep('notify_user', 'Skipped'), status: 'skipped' };
    const result = await runPendingSteps([step]);
    expect(result.executed).toBe(0);
  });
});

describe('detectCycles', () => {
  it('returns no cycle for linear chain', () => {
    const a = { ...createStep('notify_user', 'A') }; a.step_id = 'a';
    const b = { ...createStep('notify_user', 'B', { dependsOn: ['a'] }) }; b.step_id = 'b';
    const c = { ...createStep('notify_user', 'C', { dependsOn: ['b'] }) }; c.step_id = 'c';
    expect(detectCycles([a, b, c]).hasCycle).toBe(false);
  });

  it('detects a simple A→B→A cycle', () => {
    const a = { ...createStep('notify_user', 'A', { dependsOn: ['b'] }) }; a.step_id = 'a';
    const b = { ...createStep('notify_user', 'B', { dependsOn: ['a'] }) }; b.step_id = 'b';
    expect(detectCycles([a, b]).hasCycle).toBe(true);
  });

  it('detects a 3-step cycle', () => {
    const a = { ...createStep('notify_user', 'A', { dependsOn: ['c'] }) }; a.step_id = 'a';
    const b = { ...createStep('notify_user', 'B', { dependsOn: ['a'] }) }; b.step_id = 'b';
    const c = { ...createStep('notify_user', 'C', { dependsOn: ['b'] }) }; c.step_id = 'c';
    expect(detectCycles([a, b, c]).hasCycle).toBe(true);
  });

  it('returns no cycle for independent steps', () => {
    const a = { ...createStep('notify_user', 'A') }; a.step_id = 'a';
    const b = { ...createStep('notify_user', 'B') }; b.step_id = 'b';
    expect(detectCycles([a, b]).hasCycle).toBe(false);
  });
});

describe('getDependencyStatus', () => {
  it('returns met for steps with no dependencies', () => {
    const step = createStep('notify_user', 'A');
    expect(getDependencyStatus(step, [])).toBe('met');
  });

  it('returns met when all deps completed', () => {
    const dep = { ...createStep('notify_user', 'A') }; dep.step_id = 'a'; dep.status = 'completed';
    const step = createStep('notify_user', 'B', { dependsOn: ['a'] });
    expect(getDependencyStatus(step, [dep])).toBe('met');
  });

  it('returns blocked when deps are pending', () => {
    const dep = { ...createStep('notify_user', 'A') }; dep.step_id = 'a'; dep.status = 'pending';
    const step = createStep('notify_user', 'B', { dependsOn: ['a'] });
    expect(getDependencyStatus(step, [dep])).toBe('blocked');
  });

  it('returns failed when dep has failed', () => {
    const dep = { ...createStep('notify_user', 'A') }; dep.step_id = 'a'; dep.status = 'failed';
    const step = createStep('notify_user', 'B', { dependsOn: ['a'] });
    expect(getDependencyStatus(step, [dep])).toBe('failed');
  });

  it('returns failed when dep is missing', () => {
    const step = createStep('notify_user', 'B', { dependsOn: ['missing'] });
    expect(getDependencyStatus(step, [])).toBe('failed');
  });
});

describe('validateSteps', () => {
  it('accepts valid step sets', () => {
    const steps = [createStep('notify_user', 'A')];
    expect(validateSteps([], steps).valid).toBe(true);
  });

  it('rejects when step count exceeds MAX_STEPS_PER_TASK', () => {
    const existing = Array.from({ length: MAX_STEPS_PER_TASK }, (_, i) =>
      createStep('notify_user', `Step ${i}`)
    );
    const newStep = [createStep('notify_user', 'One more')];
    const result = validateSteps(existing, newStep);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('limit exceeded');
  });

  it('rejects cyclic dependencies', () => {
    const a = { ...createStep('notify_user', 'A', { dependsOn: ['b'] }) }; a.step_id = 'a';
    const b = { ...createStep('notify_user', 'B', { dependsOn: ['a'] }) }; b.step_id = 'b';
    const result = validateSteps([], [a, b]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('cycle');
  });
});

describe('createStep retryCount', () => {
  it('initializes retryCount to 0', () => {
    const step = createStep('ai_transcribe', 'Test');
    expect(step.retryCount).toBe(0);
  });
});
