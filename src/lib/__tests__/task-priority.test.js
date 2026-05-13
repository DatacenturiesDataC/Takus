// Takus — Task Priority Tests
import { describe, it, expect } from 'vitest';
import { computeTaskPriority, prioritizeTasks, getPriorityTier, parseDeadline } from '../task-priority.js';

// ── parseDeadline ─────────────────────────────────────────────────────────────

describe('parseDeadline', () => {
  const ref = new Date('2026-05-13T10:00:00Z');

  it('parses ISO dates', () => {
    const ts = parseDeadline('2026-05-15', ref);
    expect(ts).toBeGreaterThan(0);
    expect(new Date(ts).getDate()).toBe(15);
  });

  it('parses "today"', () => {
    const ts = parseDeadline('today', ref);
    expect(ts).toBeGreaterThan(0);
    expect(new Date(ts).getDate()).toBe(ref.getDate());
  });

  it('parses "tomorrow"', () => {
    const ts = parseDeadline('tomorrow', ref);
    expect(new Date(ts).getDate()).toBe(14);
  });

  it('parses "end of week"', () => {
    const ts = parseDeadline('end of week', ref);
    expect(ts).toBeGreaterThan(ref.getTime());
  });

  it('parses "by Friday"', () => {
    const ts = parseDeadline('by Friday', ref);
    expect(ts).toBeGreaterThan(ref.getTime());
    expect(new Date(ts).getDay()).toBe(5); // Friday
  });

  it('returns null for garbage', () => {
    expect(parseDeadline('asap')).toBeNull();
    expect(parseDeadline('')).toBeNull();
    expect(parseDeadline(null)).toBeNull();
  });
});

// ── computeTaskPriority ───────────────────────────────────────────────────────

describe('computeTaskPriority', () => {
  const baseRecording = { id: 'r1', date: new Date(Date.now() - 3 * 86400000).toISOString() };

  it('returns 0 for done tasks', () => {
    const score = computeTaskPriority({ text: 'x', status: 'done' }, baseRecording);
    expect(score).toBe(0);
  });

  it('returns 0 for ignored tasks', () => {
    const score = computeTaskPriority({ text: 'x', status: 'ignored' }, baseRecording);
    expect(score).toBe(0);
  });

  it('scores overdue tasks higher than future tasks', () => {
    const overdueTask = {
      text: 'past due', status: 'pending',
      deadline: Date.now() - 86400000, // yesterday
    };
    const futureTask = {
      text: 'next week', status: 'pending',
      payload: { deadline: '2030-12-31' },
    };
    const overdueScore = computeTaskPriority(overdueTask, baseRecording);
    const futureScore = computeTaskPriority(futureTask, baseRecording);
    expect(overdueScore).toBeGreaterThan(futureScore);
  });

  it('scores JIRA actions higher than PERSONAL', () => {
    const jira = { text: 'a', action: 'JIRA', status: 'pending' };
    const personal = { text: 'b', action: 'PERSONAL', status: 'pending' };
    const jiraScore = computeTaskPriority(jira, baseRecording);
    const personalScore = computeTaskPriority(personal, baseRecording);
    expect(jiraScore).toBeGreaterThan(personalScore);
  });

  it('scores older tasks higher (age decay)', () => {
    const oldRec = { id: 'old', date: new Date(Date.now() - 10 * 86400000).toISOString() };
    const newRec = { id: 'new', date: new Date().toISOString() };
    const task = { text: 't', status: 'pending' };
    const oldScore = computeTaskPriority(task, oldRec);
    const newScore = computeTaskPriority(task, newRec);
    expect(oldScore).toBeGreaterThan(newScore);
  });

  it('scores between 0 and 100', () => {
    const score = computeTaskPriority(
      { text: 'test', status: 'pending', action: 'JIRA', deadline: Date.now() - 1000 },
      baseRecording,
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── prioritizeTasks ───────────────────────────────────────────────────────────

describe('prioritizeTasks', () => {
  it('returns sorted array of pending tasks', () => {
    const recordings = [
      {
        id: 'r1', date: new Date(Date.now() - 86400000).toISOString(),
        tasks: {
          takusTasks: [
            { text: 'urgent', action: 'JIRA', status: 'pending', deadline: Date.now() - 1000 },
            { text: 'low', action: 'PERSONAL', status: 'pending' },
            { text: 'done', action: 'JIRA', status: 'done' },
          ],
          meTasks: [],
        },
      },
    ];
    const result = prioritizeTasks(recordings);
    expect(result).toHaveLength(2); // skips done task
    expect(result[0].task.text).toBe('urgent');
    expect(result[0].priority).toBeGreaterThan(result[1].priority);
  });

  it('returns empty array for no recordings', () => {
    expect(prioritizeTasks([])).toEqual([]);
  });
});

// ── getPriorityTier ───────────────────────────────────────────────────────────

describe('getPriorityTier', () => {
  it('returns critical for 75+', () => expect(getPriorityTier(80)).toBe('critical'));
  it('returns high for 50-74', () => expect(getPriorityTier(60)).toBe('high'));
  it('returns medium for 25-49', () => expect(getPriorityTier(30)).toBe('medium'));
  it('returns low for <25', () => expect(getPriorityTier(10)).toBe('low'));
});
