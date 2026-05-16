// Takus — Task Helpers Tests
import { describe, it, expect } from 'vitest';
import {
  getTaskStatus, isTaskPending, isTaskDone, isTaskIgnored,
  isStepDone, getStepDoneCount, getStepTotalCount, areAllStepsDone,
  getTaskTitle,
} from '../task-helpers.js';

describe('getTaskStatus', () => {
  it('returns task.status when present', () => {
    expect(getTaskStatus({ status: 'done' })).toBe('done');
    expect(getTaskStatus({ status: 'pending' })).toBe('pending');
    expect(getTaskStatus({ status: 'ignored' })).toBe('ignored');
  });

  it('defaults to pending when status is missing', () => {
    expect(getTaskStatus({})).toBe('pending');
  });
});

describe('getTaskTitle', () => {
  it('returns task.title when present', () => {
    expect(getTaskTitle({ title: 'My Task' })).toBe('My Task');
  });

  it('falls back to task.note', () => {
    expect(getTaskTitle({ note: 'A note' })).toBe('A note');
  });

  it('returns fallback when no title or note', () => {
    expect(getTaskTitle({})).toBe('Task');
    expect(getTaskTitle({}, 'Untitled')).toBe('Untitled');
  });

  it('prefers title over note', () => {
    expect(getTaskTitle({ title: 'Title', note: 'Note' })).toBe('Title');
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
    expect(isTaskDone({ status: 'pending' })).toBe(false);
    expect(isTaskDone({})).toBe(false);
  });

  it('correctly identifies ignored tasks', () => {
    expect(isTaskIgnored({ status: 'ignored' })).toBe(true);
    expect(isTaskIgnored({ status: 'done' })).toBe(false);
  });
});

describe('isStepDone', () => {
  it('returns true for completed status', () => {
    expect(isStepDone({ text: 'a', status: 'completed' })).toBe(true);
  });

  it('returns false for pending status', () => {
    expect(isStepDone({ text: 'a', status: 'pending' })).toBe(false);
  });

  it('returns false for ignored status', () => {
    expect(isStepDone({ text: 'a', status: 'ignored' })).toBe(false);
  });

  it('returns false for missing status', () => {
    expect(isStepDone({})).toBe(false);
    expect(isStepDone({ text: 'a' })).toBe(false);
  });

  it('returns false for null or undefined', () => {
    expect(isStepDone(null)).toBe(false);
    expect(isStepDone(undefined)).toBe(false);
  });

  it('returns false for string steps', () => {
    expect(isStepDone('Do something')).toBe(false);
    expect(isStepDone('')).toBe(false);
  });
});

describe('getStepDoneCount', () => {
  it('counts completed steps', () => {
    const task = {
      steps: [
        { text: 'a', status: 'completed' },
        { text: 'b', status: 'pending' },
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
    const task = { steps: [{ text: 'a', status: 'completed' }, { text: 'b', status: 'completed' }] };
    expect(areAllStepsDone(task)).toBe(true);
  });

  it('returns false when some steps are incomplete', () => {
    const task = { steps: [{ text: 'a', status: 'completed' }, { text: 'b', status: 'pending' }] };
    expect(areAllStepsDone(task)).toBe(false);
  });

  it('returns false for tasks with no steps', () => {
    expect(areAllStepsDone({})).toBe(false);
    expect(areAllStepsDone({ steps: [] })).toBe(false);
  });
});
