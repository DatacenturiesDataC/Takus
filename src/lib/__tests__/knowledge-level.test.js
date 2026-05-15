// Takus — Knowledge Level Tests
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/closeness-score.js', () => ({
  isCloseContact: (score) => score >= 65,
}));

import {
  assignKnowledgeLevel,
  resolveAllLevels,
  getKnowledgeLevelInfo,
  sortByRelevance,
} from '../knowledge-level.js';

describe('knowledge-level', () => {
  const ME = 'user-1';
  const contactMap = new Map([
    ['c-close', { id: 'c-close', closenessScore: 80 }],
    ['c-distant', { id: 'c-distant', closenessScore: 30 }],
  ]);

  describe('assignKnowledgeLevel', () => {
    it('assigns L0 for owned content', () => {
      const item = { id: 'i1', ownerId: ME };
      expect(assignKnowledgeLevel(item, ME, contactMap)).toBe('L0');
    });

    it('assigns L1 when user is a participant', () => {
      const item = { id: 'i2', ownerId: 'other', participants: [ME, 'other'] };
      expect(assignKnowledgeLevel(item, ME, contactMap)).toBe('L1');
    });

    it('assigns L2 for content from a non-close contact', () => {
      const item = { id: 'i3', ownerId: 'other', contactId: 'c-distant' };
      expect(assignKnowledgeLevel(item, ME, contactMap)).toBe('L2');
    });

    it('assigns L3 for content from a close contact with engagement', () => {
      const engaged = new Set(['i4']);
      const item = { id: 'i4', ownerId: 'other', contactId: 'c-close' };
      expect(assignKnowledgeLevel(item, ME, contactMap, engaged)).toBe('L3');
    });

    it('assigns L2 (not L3) for close contact WITHOUT engagement', () => {
      const item = { id: 'i5', ownerId: 'other', contactId: 'c-close' };
      expect(assignKnowledgeLevel(item, ME, contactMap)).toBe('L2');
    });

    it('assigns L4 for unassociated content', () => {
      const item = { id: 'i6', ownerId: 'unknown' };
      expect(assignKnowledgeLevel(item, ME, contactMap)).toBe('L4');
    });

    it('L0 takes priority over L1 (owner + participant)', () => {
      const item = { id: 'i7', ownerId: ME, participants: [ME] };
      expect(assignKnowledgeLevel(item, ME, contactMap)).toBe('L0');
    });

    it('L1 takes priority over L2 (participant + contact)', () => {
      const item = { id: 'i8', ownerId: 'other', participants: [ME], contactId: 'c-distant' };
      expect(assignKnowledgeLevel(item, ME, contactMap)).toBe('L1');
    });
  });

  describe('resolveAllLevels', () => {
    it('resolves levels for all items', () => {
      const items = [
        { id: 'a', ownerId: ME, knowledgeLevel: 'L4' },
        { id: 'b', ownerId: 'other', knowledgeLevel: 'L4' },
      ];
      const result = resolveAllLevels(items, ME, contactMap);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'a', oldLevel: 'L4', newLevel: 'L0', changed: true });
      expect(result[1]).toEqual({ id: 'b', oldLevel: 'L4', newLevel: 'L4', changed: false });
    });

    it('defaults oldLevel to L4 when not set', () => {
      const items = [{ id: 'c', ownerId: ME }];
      const result = resolveAllLevels(items, ME, contactMap);
      expect(result[0].oldLevel).toBe('L4');
    });
  });

  describe('getKnowledgeLevelInfo', () => {
    it('returns correct label for each level', () => {
      expect(getKnowledgeLevelInfo('L0').label).toBe('Owned');
      expect(getKnowledgeLevelInfo('L1').label).toBe('Involved');
      expect(getKnowledgeLevelInfo('L2').label).toBe('Contact');
      expect(getKnowledgeLevelInfo('L3').label).toBe('Surfaced');
      expect(getKnowledgeLevelInfo('L4').label).toBe('Public');
    });

    it('returns L4 info for unknown levels', () => {
      expect(getKnowledgeLevelInfo('L99')).toEqual(getKnowledgeLevelInfo('L4'));
    });
  });

  describe('sortByRelevance', () => {
    it('sorts L0 before L4', () => {
      const items = [
        { id: 'a', knowledgeLevel: 'L4', date: 100 },
        { id: 'b', knowledgeLevel: 'L0', date: 50 },
      ];
      const sorted = sortByRelevance(items);
      expect(sorted[0].id).toBe('b');
      expect(sorted[1].id).toBe('a');
    });

    it('sorts L3 before L2 (surfaced > contact)', () => {
      const items = [
        { id: 'a', knowledgeLevel: 'L2' },
        { id: 'b', knowledgeLevel: 'L3' },
      ];
      const sorted = sortByRelevance(items);
      expect(sorted[0].id).toBe('b');
    });

    it('sorts by date (newest first) within same level', () => {
      const items = [
        { id: 'a', knowledgeLevel: 'L1', date: 100 },
        { id: 'b', knowledgeLevel: 'L1', date: 200 },
      ];
      const sorted = sortByRelevance(items);
      expect(sorted[0].id).toBe('b');
    });

    it('does not mutate the original array', () => {
      const items = [
        { id: 'a', knowledgeLevel: 'L4' },
        { id: 'b', knowledgeLevel: 'L0' },
      ];
      const sorted = sortByRelevance(items);
      expect(items[0].id).toBe('a'); // original unchanged
      expect(sorted[0].id).toBe('b');
    });
  });
});
