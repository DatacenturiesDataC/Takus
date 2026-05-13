// Takus — Schema Validator Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateRecording, validateContact, validateRecordings } from '../schema-validator.js';

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
