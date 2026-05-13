// Takus — AI Engine Unit Tests (non-network parts)
import { describe, it, expect } from 'vitest';
import { migrateTask } from '../ai-engine.js';

describe('migrateTask()', () => {
  it('returns already-migrated tasks unchanged', () => {
    const task = { id: 't1', status: 'pending', output: null, ignoredReason: null, dependsOn: null, sequence: null, integrations: [], steps: [], objective: null, doneAt: null, ignoredAt: null };
    const result = migrateTask(task);
    expect(result).toEqual(task);
  });

  it('migrates legacy done:true to status:done', () => {
    const task = { id: 't1', done: true };
    const result = migrateTask(task);
    expect(result.status).toBe('done');
    expect(result.doneAt).toBeTypeOf('number');
  });

  it('migrates legacy done:false to status:pending', () => {
    const task = { id: 't1', done: false };
    const result = migrateTask(task);
    expect(result.status).toBe('pending');
  });

  it('fills missing Phase 15 fields with defaults', () => {
    const task = { id: 't1', status: 'pending' };
    const result = migrateTask(task);
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
    const result = migrateTask(task);
    expect(result.steps).toEqual([]);
    expect(result.objective).toBeNull();
  });

  it('normalizes string steps to {text, done} objects', () => {
    const task = { id: 't1', status: 'pending', steps: ['Do A', 'Do B'] };
    const result = migrateTask(task);
    expect(result.steps).toEqual([
      { text: 'Do A', done: false },
      { text: 'Do B', done: false },
    ]);
  });

  it('preserves already-normalized steps', () => {
    const task = { id: 't1', status: 'pending', steps: [{ text: 'X', done: true }], objective: 'Ship' };
    const result = migrateTask(task);
    expect(result.steps).toEqual([{ text: 'X', done: true }]);
    expect(result.objective).toBe('Ship');
  });

  it('is idempotent — double-call produces same result', () => {
    const task = { id: 't1', done: true };
    const first = migrateTask(task);
    const second = migrateTask(first);
    expect(second.status).toBe('done');
    expect(second.steps).toEqual([]);
  });
});
