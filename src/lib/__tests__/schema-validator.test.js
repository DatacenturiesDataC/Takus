// Takus — Schema Validator Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateRecording, validateContact, validateRecordings, validateWikiEntry, validateEdge } from '../schema-validator.js';

// Suppress expected console.warn from schema validation
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('validateRecording', () => {
  it('returns null for null/undefined input', () => {
    expect(validateRecording(null)).toBeNull();
    expect(validateRecording(undefined)).toBeNull();
    expect(validateRecording('string')).toBeNull();
  });

  it('returns null for record without id', () => {
    expect(validateRecording({})).toBeNull();
    expect(validateRecording({ id: 123 })).toBeNull();
  });

  it('returns valid record with minimal input', () => {
    const result = validateRecording({ id: 'abc123' });
    expect(result).not.toBeNull();
    expect(result.id).toBe('abc123');
    expect(result.title).toBe('Untitled Recording');
    expect(result.duration).toBe(0);
    expect(result.size).toBe(0);
    expect(result.type).toBe('screen');
    expect(typeof result.date).toBe('number');
  });

  it('preserves valid fields', () => {
    const input = {
      id: 'rec-1',
      title: 'My Meeting',
      date: 1700000000000,
      duration: 120,
      size: 1024,
      type: 'meeting',
      aiSummary: '# Summary',
    };
    const result = validateRecording(input);
    expect(result.title).toBe('My Meeting');
    expect(result.date).toBe(1700000000000);
    expect(result.duration).toBe(120);
    expect(result.type).toBe('meeting');
    expect(result.aiSummary).toBe('# Summary');
  });

  it('coerces invalid type to screen', () => {
    const result = validateRecording({ id: 'r1', type: 'invalid' });
    expect(result.type).toBe('screen');
  });

  it('defaults state to active for records without state', () => {
    const result = validateRecording({ id: 'r1' });
    expect(result.state).toBe('active');
  });

  it('accepts all valid states', () => {
    for (const state of ['raw', 'processing', 'active', 'condensed', 'archived']) {
      const result = validateRecording({ id: 'r1', state });
      expect(result.state).toBe(state);
    }
  });

  it('coerces invalid state to active', () => {
    const result = validateRecording({ id: 'r1', state: 'bogus' });
    expect(result.state).toBe('active');
  });

  it('accepts all valid types', () => {
    for (const type of ['meeting', 'screen', 'presentation', 'update']) {
      const result = validateRecording({ id: 'r1', type });
      expect(result.type).toBe(type);
    }
  });

  it('coerces non-string title to string', () => {
    const result = validateRecording({ id: 'r1', title: 42 });
    expect(result.title).toBe('42');
  });

  it('defaults NaN duration to 0', () => {
    const result = validateRecording({ id: 'r1', duration: NaN });
    expect(result.duration).toBe(0);
  });

  it('defaults Infinity size to 0', () => {
    const result = validateRecording({ id: 'r1', size: Infinity });
    expect(result.size).toBe(0);
  });

  it('auto-repairs tasks structure', () => {
    const result = validateRecording({ id: 'r1', tasks: { takusTasks: 'bad' } });
    expect(Array.isArray(result.tasks.takusTasks)).toBe(true);
    expect(Array.isArray(result.tasks.meTasks)).toBe(true);
  });

  it('normalizes task status from legacy done boolean', () => {
    const result = validateRecording({
      id: 'r1',
      tasks: {
        takusTasks: [
          { title: 'Done task', done: true },
          { title: 'Pending task' },
          { title: 'Already status', status: 'ignored' },
        ],
        meTasks: [],
      },
    });
    expect(result.tasks.takusTasks[0].status).toBe('done');
    expect(result.tasks.takusTasks[1].status).toBe('pending');
    expect(result.tasks.takusTasks[2].status).toBe('ignored');
  });

  it('normalizes step status from legacy done boolean', () => {
    const result = validateRecording({
      id: 'r1',
      tasks: {
        takusTasks: [{
          title: 'Task with steps',
          status: 'pending',
          steps: [
            { text: 'Done step', done: true },
            { text: 'Pending step', done: false },
            { text: 'Has status', status: 'completed' },
          ],
        }],
        meTasks: [],
      },
    });
    const steps = result.tasks.takusTasks[0].steps;
    expect(steps[0].status).toBe('completed');
    expect(steps[1].status).toBe('pending');
    expect(steps[2].status).toBe('completed');
  });

  it('coerces pinned to boolean', () => {
    const result = validateRecording({ id: 'r1', pinned: 1 });
    expect(result.pinned).toBe(true);
  });

  it('coerces non-array participants to empty array', () => {
    const result = validateRecording({ id: 'r1', participants: 'bad' });
    expect(result.participants).toEqual([]);
  });

  it('coerces non-string optional fields to strings', () => {
    const result = validateRecording({ id: 'r1', device: 123, notes: true });
    expect(result.device).toBe('123');
    expect(result.notes).toBe('true');
  });
});

describe('validateContact', () => {
  it('returns null for null/undefined', () => {
    expect(validateContact(null)).toBeNull();
    expect(validateContact(undefined)).toBeNull();
  });

  it('returns null for missing id', () => {
    expect(validateContact({ name: 'Test' })).toBeNull();
  });

  it('returns valid contact with minimal input', () => {
    const result = validateContact({ id: 'c1' });
    expect(result.id).toBe('c1');
    expect(result.name).toBe('');
    expect(result.email).toBe('');
    expect(result.closenessScore).toBe(0);
    expect(result.isManualClose).toBe(false);
  });

  it('preserves valid fields', () => {
    const input = {
      id: 'c1',
      name: 'Alice',
      email: 'alice@example.com',
      closenessScore: 75,
      isManualClose: true,
    };
    const result = validateContact(input);
    expect(result.name).toBe('Alice');
    expect(result.email).toBe('alice@example.com');
    expect(result.closenessScore).toBe(75);
    expect(result.isManualClose).toBe(true);
  });

  it('clamps closenessScore to 0-100', () => {
    expect(validateContact({ id: 'c1', closenessScore: -10 }).closenessScore).toBe(0);
    expect(validateContact({ id: 'c1', closenessScore: 150 }).closenessScore).toBe(100);
  });

  it('defaults NaN closenessScore to 0', () => {
    expect(validateContact({ id: 'c1', closenessScore: NaN }).closenessScore).toBe(0);
  });

  it('coerces non-string name', () => {
    expect(validateContact({ id: 'c1', name: 42 }).name).toBe('42');
  });
});

describe('validateRecordings', () => {
  it('returns empty array for non-array input', () => {
    expect(validateRecordings(null)).toEqual([]);
    expect(validateRecordings('bad')).toEqual([]);
  });

  it('filters out invalid records', () => {
    const records = [
      { id: 'r1', title: 'Good' },
      null,
      { title: 'No ID' },
      { id: 'r2', title: 'Also Good' },
    ];
    const result = validateRecordings(records);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('r1');
    expect(result[1].id).toBe('r2');
  });

  it('auto-repairs valid records in batch', () => {
    const records = [{ id: 'r1', type: 'invalid', duration: NaN }];
    const result = validateRecordings(records);
    expect(result[0].type).toBe('screen');
    expect(result[0].duration).toBe(0);
  });
});

describe('validateWikiEntry', () => {
  it('returns null for invalid input', () => {
    expect(validateWikiEntry(null)).toBeNull();
    expect(validateWikiEntry({})).toBeNull();
    expect(validateWikiEntry({ id: 123 })).toBeNull();
  });

  it('returns valid entry with minimal input', () => {
    const result = validateWikiEntry({ id: 'w1' });
    expect(result).not.toBeNull();
    expect(result.query).toBe('');
    expect(result.answer).toBe('');
    expect(Array.isArray(result.sources)).toBe(true);
    expect(typeof result.date).toBe('number');
  });

  it('coerces non-string fields', () => {
    const result = validateWikiEntry({ id: 'w2', query: 123, answer: true });
    expect(result.query).toBe('123');
    expect(result.answer).toBe('true');
  });

  it('defaults sources to empty array', () => {
    const result = validateWikiEntry({ id: 'w3', sources: 'bad' });
    expect(result.sources).toEqual([]);
  });
});

describe('validateEdge', () => {
  const validEdge = {
    id: 'recording:r1→SIMILAR_TO→recording:r2',
    sourceType: 'recording', sourceId: 'r1',
    targetType: 'recording', targetId: 'r2',
    edgeType: 'SIMILAR_TO', metadata: { score: 0.9 },
    createdAt: 1000,
  };

  it('returns null for invalid input', () => {
    expect(validateEdge(null)).toBeNull();
    expect(validateEdge({})).toBeNull();
    expect(validateEdge({ id: 'x' })).toBeNull(); // missing fields
  });

  it('returns valid edge', () => {
    const result = validateEdge(validEdge);
    expect(result).toEqual(validEdge);
  });

  it('defaults metadata to empty object', () => {
    const result = validateEdge({ ...validEdge, metadata: null });
    expect(result.metadata).toEqual({});
  });

  it('defaults createdAt to now', () => {
    const before = Date.now();
    const result = validateEdge({ ...validEdge, createdAt: 'bad' });
    expect(result.createdAt).toBeGreaterThanOrEqual(before);
  });
});
