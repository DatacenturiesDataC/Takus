// Takus — AI Engine Unit Tests (non-network parts)
import { describe, it, expect } from 'vitest';
import { normalizeTask } from '../ai-engine.js';

describe('normalizeTask()', () => {
  it('returns already-normalized tasks unchanged', () => {
    const task = { id: 't1', status: 'pending', output: null, ignoredReason: null, dependsOn: null, sequence: null, integrations: [], steps: [], objective: null, doneAt: null, ignoredAt: null };
    const result = normalizeTask(task);
    expect(result).toEqual(task);
  });

  it('defaults missing status to pending', () => {
    const task = { id: 't1' };
    const result = normalizeTask(task);
    expect(result.status).toBe('pending');
  });

  it('fills missing fields with defaults', () => {
    const task = { id: 't1', status: 'pending' };
    const result = normalizeTask(task);
    expect(result.output).toBeNull();
    expect(result.ignoredReason).toBeNull();
    expect(result.dependsOn).toBeNull();
    expect(result.sequence).toBeNull();
    expect(result.integrations).toEqual([]);
    expect(result.doneAt).toBeNull();
    expect(result.ignoredAt).toBeNull();
  });

  it('fills missing steps and objective', () => {
    const task = { id: 't1', status: 'pending' };
    const result = normalizeTask(task);
    expect(result.steps).toEqual([]);
    expect(result.objective).toBeNull();
  });

  it('normalizes string steps to {text, status} objects', () => {
    const task = { id: 't1', status: 'pending', steps: ['Do A', 'Do B'] };
    const result = normalizeTask(task);
    expect(result.steps).toEqual([
      { text: 'Do A', status: 'pending' },
      { text: 'Do B', status: 'pending' },
    ]);
  });

  it('preserves already-normalized steps', () => {
    const task = { id: 't1', status: 'pending', steps: [{ text: 'X', status: 'completed' }], objective: 'Ship' };
    const result = normalizeTask(task);
    expect(result.steps).toEqual([{ text: 'X', status: 'completed' }]);
    expect(result.objective).toBe('Ship');
  });

  it('is idempotent — double-call produces same result', () => {
    const task = { id: 't1', status: 'done' };
    const first = normalizeTask(task);
    const second = normalizeTask(first);
    expect(second.status).toBe('done');
    expect(second.steps).toEqual([]);
  });
});

// ── Goal Extraction Defenses ──────────────────────────────────────────

describe('extractGoals edge cases', () => {
  it('returns empty for null text', async () => {
    const { extractGoals } = await import('../ai-engine.js');
    const result = await extractGoals(null, [], 'key', 'openai');
    expect(result).toEqual({ goals: [] });
  });

  it('returns empty for very short text', async () => {
    const { extractGoals } = await import('../ai-engine.js');
    const result = await extractGoals('short', [], 'key', 'openai');
    expect(result).toEqual({ goals: [] });
  });
});
