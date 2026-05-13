// Takus — Task Helpers Tests
import { describe, it, expect } from 'vitest';
import {
  getTaskStatus, isTaskPending, isTaskDone, isTaskIgnored,
  isStepDone, getStepDoneCount, getStepTotalCount, areAllStepsDone,
} from '../task-helpers.js';

describe('getTaskStatus', () => {
  it('returns task.status when present', () => {
    expect(getTaskStatus({ status: 'done' })).toBe('done');
    expect(getTaskStatus({ status: 'pending' })).toBe('pending');
    expect(getTaskStatus({ status: 'ignored' })).toBe('ignored');
  });

  it('falls back to legacy task.done boolean', () => {
    expect(getTaskStatus({ done: true })).toBe('done');
    expect(getTaskStatus({ done: false })).toBe('pending');
    expect(getTaskStatus({})).toBe('pending');
  });

  it('prefers status over done when both present', () => {
    expect(getTaskStatus({ status: 'ignored', done: true })).toBe('ignored');
  });
});

describe('isTaskPending / isTaskDone / isTaskIgnored', () => {
  it('correctly identifies pending tasks', () => {
    expect(isTaskPending({ status: 'pending' })).toBe(true);
    expect(isTaskPending({ status: 'done' })).toBe(false);
    expect(isTaskPending({})).toBe(true); // no status = pending
  });

  it('correctly identifies done tasks', () => {
    expect(isTaskDone({ status: 'done' })).toBe(true);
    expect(isTaskDone({ done: true })).toBe(true);
    expect(isTaskDone({ status: 'pending' })).toBe(false);
  });

  it('correctly identifies ignored tasks', () => {
    expect(isTaskIgnored({ status: 'ignored' })).toBe(true);
    expect(isTaskIgnored({ status: 'done' })).toBe(false);
  });
});

describe('isStepDone', () => {
  it('handles legacy done boolean', () => {
    expect(isStepDone({ text: 'a', done: true })).toBe(true);
    expect(isStepDone({ text: 'a', done: false })).toBe(false);
  });

  it('handles modern status field', () => {
    expect(isStepDone({ text: 'a', status: 'completed' })).toBe(true);
    expect(isStepDone({ text: 'a', status: 'pending' })).toBe(false);
  });

  it('handles both fields present', () => {
    expect(isStepDone({ text: 'a', done: false, status: 'completed' })).toBe(true);
    expect(isStepDone({ text: 'a', done: true, status: 'pending' })).toBe(true); // done = true wins
  });

  it('handles empty/missing fields', () => {
    expect(isStepDone({})).toBe(false);
    expect(isStepDone({ text: 'a' })).toBe(false);
  });
});

describe('getStepDoneCount', () => {
  it('counts completed steps', () => {
    const task = {
      steps: [
        { text: 'a', done: true },
        { text: 'b', done: false },
        { text: 'c', status: 'completed' },
      ],
    };
    expect(getStepDoneCount(task)).toBe(2);
  });

  it('returns 0 for tasks without steps', () => {
    expect(getStepDoneCount({})).toBe(0);
    expect(getStepDoneCount({ steps: [] })).toBe(0);
  });
});

describe('getStepTotalCount', () => {
  it('returns step count', () => {
    expect(getStepTotalCount({ steps: [{ text: 'a' }, { text: 'b' }] })).toBe(2);
  });

  it('returns 0 for tasks without steps', () => {
    expect(getStepTotalCount({})).toBe(0);
  });
});

describe('areAllStepsDone', () => {
  it('returns true when all steps are done', () => {
    const task = { steps: [{ text: 'a', done: true }, { text: 'b', status: 'completed' }] };
    expect(areAllStepsDone(task)).toBe(true);
  });

  it('returns false when some steps are incomplete', () => {
    const task = { steps: [{ text: 'a', done: true }, { text: 'b', done: false }] };
    expect(areAllStepsDone(task)).toBe(false);
  });

  it('returns false for tasks with no steps', () => {
    expect(areAllStepsDone({})).toBe(false);
    expect(areAllStepsDone({ steps: [] })).toBe(false);
  });
});
