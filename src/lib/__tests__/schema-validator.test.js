// Takus — Schema Validator Tests (Phase 65)
// Tests data integrity validation for all record types.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  validateRecording,
  validateRecordings,
  validateContact,
  validateWikiEntry,
  validateEdge,
} from '../schema-validator.js';

describe('Schema Validator', () => {
  describe('validateRecording', () => {
    it('returns null for null/undefined input', () => {
      expect(validateRecording(null)).toBeNull();
      expect(validateRecording(undefined)).toBeNull();
      expect(validateRecording('string')).toBeNull();
    });

    it('returns null for missing id', () => {
      expect(validateRecording({ title: 'Test' })).toBeNull();
      expect(validateRecording({ id: 123 })).toBeNull();
    });

    it('validates a minimal recording', () => {
      const r = validateRecording({ id: 'rec_1' });
      expect(r).not.toBeNull();
      expect(r.id).toBe('rec_1');
      expect(r.title).toBe('Untitled Recording');
      expect(r.type).toBe('screen');
      expect(r.state).toBe('active');
      expect(r.duration).toBe(0);
      expect(r.size).toBe(0);
    });

    it('preserves valid fields', () => {
      const r = validateRecording({
        id: 'rec_2', title: 'Sprint Review', type: 'meeting',
        duration: 3600, size: 1024, date: 1000000,
      });
      expect(r.title).toBe('Sprint Review');
      expect(r.type).toBe('meeting');
      expect(r.duration).toBe(3600);
      expect(r.size).toBe(1024);
      expect(r.date).toBe(1000000);
    });

    it('coerces invalid type to screen', () => {
      const r = validateRecording({ id: 'r', type: 'invalid_type' });
      expect(r.type).toBe('screen');
    });

    it('coerces invalid state to active', () => {
      const r = validateRecording({ id: 'r', state: 'broken' });
      expect(r.state).toBe('active');
    });

    it('accepts valid states', () => {
      for (const state of ['raw', 'processing', 'active', 'condensed', 'archived']) {
        const r = validateRecording({ id: 'r', state });
        expect(r.state).toBe(state);
      }
    });

    it('coerces non-finite duration to 0', () => {
      expect(validateRecording({ id: 'r', duration: NaN }).duration).toBe(0);
      expect(validateRecording({ id: 'r', duration: Infinity }).duration).toBe(0);
    });

    it('coerces string fields', () => {
      const r = validateRecording({ id: 'r', aiSummary: 123 });
      expect(r.aiSummary).toBe('123');
    });

    it('normalizes tasks structure', () => {
      const r = validateRecording({
        id: 'r',
        tasks: {
          takusTasks: [{ text: 'Do thing', done: true }],
          meTasks: [{ text: 'My thing', done: false }],
        },
      });
      expect(r.tasks.takusTasks[0].status).toBe('done');
      expect(r.tasks.meTasks[0].status).toBe('pending');
    });

    it('normalizes step statuses within tasks', () => {
      const r = validateRecording({
        id: 'r',
        tasks: {
          takusTasks: [{
            text: 'With steps',
            status: 'pending',
            steps: [{ done: true }, { done: false }],
          }],
          meTasks: [],
        },
      });
      expect(r.tasks.takusTasks[0].steps[0].status).toBe('completed');
      expect(r.tasks.takusTasks[0].steps[1].status).toBe('pending');
    });

    it('defaults missing tasks arrays', () => {
      const r = validateRecording({ id: 'r', tasks: {} });
      expect(r.tasks.takusTasks).toEqual([]);
      expect(r.tasks.meTasks).toEqual([]);
    });

    it('normalizes pinned to boolean', () => {
      expect(validateRecording({ id: 'r', pinned: 1 }).pinned).toBe(true);
      expect(validateRecording({ id: 'r', pinned: 0 }).pinned).toBe(false);
    });

    it('normalizes non-array participants', () => {
      expect(validateRecording({ id: 'r', participants: 'invalid' }).participants).toEqual([]);
    });
  });

  describe('validateRecordings', () => {
    it('filters out invalid records', () => {
      const result = validateRecordings([
        { id: 'r1', title: 'Good' },
        null,
        { title: 'No ID' },
        { id: 'r2', title: 'Also good' },
      ]);
      expect(result).toHaveLength(2);
      expect(result.map(r => r.id)).toEqual(['r1', 'r2']);
    });

    it('returns empty for non-array', () => {
      expect(validateRecordings(null)).toEqual([]);
      expect(validateRecordings('string')).toEqual([]);
    });
  });

  describe('validateContact', () => {
    it('returns null for invalid input', () => {
      expect(validateContact(null)).toBeNull();
      expect(validateContact({ name: 'No ID' })).toBeNull();
    });

    it('validates a minimal contact', () => {
      const c = validateContact({ id: 'c_1' });
      expect(c.id).toBe('c_1');
      expect(c.name).toBe('');
      expect(c.email).toBe('');
      expect(c.closenessScore).toBe(0);
      expect(c.isManualClose).toBe(false);
    });

    it('clamps closeness score 0-100', () => {
      expect(validateContact({ id: 'c', closenessScore: -10 }).closenessScore).toBe(0);
      expect(validateContact({ id: 'c', closenessScore: 200 }).closenessScore).toBe(100);
      expect(validateContact({ id: 'c', closenessScore: 50 }).closenessScore).toBe(50);
    });

    it('coerces non-number closeness to 0', () => {
      expect(validateContact({ id: 'c', closenessScore: 'high' }).closenessScore).toBe(0);
    });
  });

  describe('validateWikiEntry', () => {
    it('returns null for invalid input', () => {
      expect(validateWikiEntry(null)).toBeNull();
      expect(validateWikiEntry({ query: 'No ID' })).toBeNull();
    });

    it('validates a minimal wiki entry', () => {
      const w = validateWikiEntry({ id: 'w_1' });
      expect(w.id).toBe('w_1');
      expect(w.query).toBe('');
      expect(w.answer).toBe('');
      expect(w.sources).toEqual([]);
    });

    it('preserves valid fields', () => {
      const w = validateWikiEntry({
        id: 'w_2', query: 'What is Takus?', answer: 'A platform',
        sources: ['rec_1'], date: 1000,
      });
      expect(w.query).toBe('What is Takus?');
      expect(w.sources).toEqual(['rec_1']);
    });
  });

  describe('validateEdge', () => {
    it('returns null for invalid input', () => {
      expect(validateEdge(null)).toBeNull();
      expect(validateEdge({})).toBeNull();
    });

    it('returns null for missing required fields', () => {
      expect(validateEdge({ id: 'e1', sourceId: 's1', targetType: 't', targetId: 't1', edgeType: 'LINKS' })).toBeNull();
    });

    it('validates a complete edge', () => {
      const e = validateEdge({
        id: 'e_1', sourceType: 'recording', sourceId: 'r_1',
        targetType: 'person', targetId: 'p_1', edgeType: 'MENTIONS',
      });
      expect(e).not.toBeNull();
      expect(e.id).toBe('e_1');
      expect(e.edgeType).toBe('MENTIONS');
      expect(e.metadata).toEqual({});
    });

    it('defaults metadata to empty object', () => {
      const e = validateEdge({
        id: 'e', sourceType: 'a', sourceId: 'a1',
        targetType: 'b', targetId: 'b1', edgeType: 'LINKS',
        metadata: null,
      });
      expect(e.metadata).toEqual({});
    });

    it('preserves valid metadata', () => {
      const e = validateEdge({
        id: 'e', sourceType: 'a', sourceId: 'a1',
        targetType: 'b', targetId: 'b1', edgeType: 'LINKS',
        metadata: { weight: 5 },
      });
      expect(e.metadata).toEqual({ weight: 5 });
    });
  });

  describe('validateNode', () => {
    // Import dynamically since it was just added
    let validateNode;
    beforeAll(async () => {
      const mod = await import('../schema-validator.js');
      validateNode = mod.validateNode;
    });

    it('returns null for invalid input', () => {
      expect(validateNode(null)).toBeNull();
      expect(validateNode(undefined)).toBeNull();
      expect(validateNode('string')).toBeNull();
    });

    it('returns null for missing id', () => {
      expect(validateNode({ type: 'goal' })).toBeNull();
      expect(validateNode({ id: 123, type: 'goal' })).toBeNull();
    });

    it('returns null for missing type', () => {
      expect(validateNode({ id: 'n_1' })).toBeNull();
      expect(validateNode({ id: 'n_1', type: 42 })).toBeNull();
    });

    it('validates a minimal node', () => {
      const n = validateNode({ id: 'n_1', type: 'goal' });
      expect(n).not.toBeNull();
      expect(n.id).toBe('n_1');
      expect(n.type).toBe('goal');
      expect(n.properties).toEqual({});
      expect(n.state).toBe('active');
      expect(n.appId).toBe('unknown');
      expect(typeof n.createdAt).toBe('number');
      expect(typeof n.updatedAt).toBe('number');
    });

    it('preserves valid fields', () => {
      const n = validateNode({
        id: 'n_2', type: 'task', state: 'completed', appId: 'tasks',
        properties: { title: 'Test Task' }, createdAt: 1000, updatedAt: 2000,
      });
      expect(n.state).toBe('completed');
      expect(n.appId).toBe('tasks');
      expect(n.properties.title).toBe('Test Task');
      expect(n.createdAt).toBe(1000);
      expect(n.updatedAt).toBe(2000);
    });

    it('defaults updatedAt to createdAt', () => {
      const n = validateNode({ id: 'n', type: 'goal', createdAt: 5000 });
      expect(n.updatedAt).toBe(5000);
    });

    it('coerces null properties to empty object', () => {
      const n = validateNode({ id: 'n', type: 'goal', properties: null });
      expect(n.properties).toEqual({});
    });

    it('does not mutate the original object', () => {
      const original = { id: 'n', type: 'goal' };
      const validated = validateNode(original);
      expect(original.state).toBeUndefined();
      expect(validated.state).toBe('active');
    });
  });
});
