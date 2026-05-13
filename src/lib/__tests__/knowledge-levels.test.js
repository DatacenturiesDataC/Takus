// Takus — Closeness Score + Knowledge Level Unit Tests
import { describe, it, expect } from 'vitest';
import { computeClosenessScore, isCloseContact, aggregateSignals, recomputeAllScores } from '../closeness-score.js';
import { assignKnowledgeLevel, resolveAllLevels, sortByRelevance, getKnowledgeLevelInfo } from '../knowledge-level.js';

// ─── Closeness Score ────────────────────────────────────────────────────────

describe('aggregateSignals', () => {
  it('counts interaction types', () => {
    const interactions = [
      { contactId: 'c1', type: 'meeting', timestamp: Date.now() },
      { contactId: 'c1', type: 'meeting', timestamp: Date.now() },
      { contactId: 'c1', type: 'direct_message', timestamp: Date.now() },
      { contactId: 'c1', type: 'mention', timestamp: Date.now() },
      { contactId: 'c2', type: 'meeting', timestamp: Date.now() }, // different contact
    ];
    const s = aggregateSignals('c1', interactions);
    expect(s.meetings).toBe(2);
    expect(s.directMessages).toBe(1);
    expect(s.mentions).toBe(1);
    expect(s.sharedTasks).toBe(0);
  });

  it('filters by date window', () => {
    const old = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago
    const interactions = [
      { contactId: 'c1', type: 'meeting', timestamp: old },
      { contactId: 'c1', type: 'meeting', timestamp: Date.now() },
    ];
    const s = aggregateSignals('c1', interactions, 30);
    expect(s.meetings).toBe(1); // only the recent one
  });

  it('returns zeros for empty interactions', () => {
    const s = aggregateSignals('c1', []);
    expect(s.directMessages).toBe(0);
    expect(s.meetings).toBe(0);
    expect(s.lastInteractionTime).toBeNull();
  });
});

describe('computeClosenessScore', () => {
  it('returns 0 for no interactions', () => {
    const score = computeClosenessScore({ id: 'c1', isManualClose: false }, []);
    expect(score).toBe(0);
  });

  it('manual close contributes 10 points', () => {
    const manualScore = computeClosenessScore({ id: 'c1', isManualClose: true }, []);
    expect(manualScore).toBe(10);
  });

  it('scores increase with meetings', () => {
    const meetings = Array.from({ length: 5 }, (_, i) => ({
      contactId: 'c1', type: 'meeting', timestamp: Date.now() - i * 1000,
    }));
    const score = computeClosenessScore({ id: 'c1', isManualClose: false }, meetings);
    expect(score).toBeGreaterThan(15); // 5 meetings = high meetScore
  });

  it('is clamped to 100', () => {
    const many = [];
    for (let i = 0; i < 100; i++) {
      many.push({ contactId: 'c1', type: 'direct_message', timestamp: Date.now() });
      many.push({ contactId: 'c1', type: 'meeting', timestamp: Date.now() });
      many.push({ contactId: 'c1', type: 'shared_task', timestamp: Date.now() });
    }
    const score = computeClosenessScore({ id: 'c1', isManualClose: true, role: 'manager' }, many, { userOrg: 'Acme' });
    expect(score).toBeLessThanOrEqual(100);
  });

  it('applies recency booster', () => {
    const recentInteraction = [{ contactId: 'c1', type: 'meeting', timestamp: Date.now() - 1000 }];
    const oldInteraction = [{ contactId: 'c1', type: 'meeting', timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 }];
    const recent = computeClosenessScore({ id: 'c1', isManualClose: false }, recentInteraction);
    const old = computeClosenessScore({ id: 'c1', isManualClose: false }, oldInteraction);
    expect(recent).toBeGreaterThan(old);
  });
});

describe('isCloseContact', () => {
  it('returns true for score >= 65', () => { expect(isCloseContact(65)).toBe(true); });
  it('returns false for score < 65', () => { expect(isCloseContact(64)).toBe(false); });
  it('uses custom threshold', () => { expect(isCloseContact(50, 50)).toBe(true); });
});

describe('recomputeAllScores', () => {
  it('returns changed flag correctly', () => {
    const contacts = [
      { id: 'c1', closenessScore: 0, isManualClose: false },
      { id: 'c2', closenessScore: 10, isManualClose: true },
    ];
    const results = recomputeAllScores(contacts, []);
    expect(results).toHaveLength(2);
    expect(results[0].changed).toBe(false); // 0 → 0
    expect(results[1].changed).toBe(false); // 10 → 10 (manual)
  });
});

// ─── Knowledge Level ────────────────────────────────────────────────────────

describe('assignKnowledgeLevel', () => {
  it('returns L0 for user-owned content', () => {
    const item = { ownerId: 'me', participants: [], contactId: null };
    expect(assignKnowledgeLevel(item, 'me', new Map())).toBe('L0');
  });

  it('returns L1 when user is participant', () => {
    const item = { ownerId: 'other', participants: ['me'], contactId: 'other' };
    expect(assignKnowledgeLevel(item, 'me', new Map())).toBe('L1');
  });

  it('returns L2 for content from a contact', () => {
    const contactMap = new Map([['c1', { id: 'c1', closenessScore: 30 }]]);
    const item = { ownerId: 'c1', participants: [], contactId: 'c1' };
    expect(assignKnowledgeLevel(item, 'me', contactMap)).toBe('L2');
  });

  it('returns L3 for close contact with engagement', () => {
    const contactMap = new Map([['c1', { id: 'c1', closenessScore: 70 }]]);
    const engaged = new Set(['item1']);
    const item = { id: 'item1', ownerId: 'c1', participants: [], contactId: 'c1' };
    expect(assignKnowledgeLevel(item, 'me', contactMap, engaged)).toBe('L3');
  });

  it('returns L2 not L3 if close but no engagement', () => {
    const contactMap = new Map([['c1', { id: 'c1', closenessScore: 70 }]]);
    const item = { id: 'item1', ownerId: 'c1', participants: [], contactId: 'c1' };
    expect(assignKnowledgeLevel(item, 'me', contactMap)).toBe('L2');
  });

  it('returns L4 for unknown author', () => {
    const item = { ownerId: 'stranger', participants: [], contactId: null };
    expect(assignKnowledgeLevel(item, 'me', new Map())).toBe('L4');
  });

  it('L0 wins over L1 (user is both owner and participant)', () => {
    const item = { ownerId: 'me', participants: ['me'], contactId: null };
    expect(assignKnowledgeLevel(item, 'me', new Map())).toBe('L0');
  });
});

describe('sortByRelevance', () => {
  it('sorts L0 before L1 before L3 before L2 before L4', () => {
    const items = [
      { knowledgeLevel: 'L4', date: 1 },
      { knowledgeLevel: 'L0', date: 1 },
      { knowledgeLevel: 'L2', date: 1 },
      { knowledgeLevel: 'L3', date: 1 },
      { knowledgeLevel: 'L1', date: 1 },
    ];
    const sorted = sortByRelevance(items);
    expect(sorted.map(i => i.knowledgeLevel)).toEqual(['L0', 'L1', 'L3', 'L2', 'L4']);
  });

  it('sorts by recency within same level', () => {
    const items = [
      { knowledgeLevel: 'L0', date: 100 },
      { knowledgeLevel: 'L0', date: 200 },
    ];
    const sorted = sortByRelevance(items);
    expect(sorted[0].date).toBe(200);
  });
});

describe('getKnowledgeLevelInfo', () => {
  it('returns info for all levels', () => {
    for (const level of ['L0', 'L1', 'L2', 'L3', 'L4']) {
      const info = getKnowledgeLevelInfo(level);
      expect(info.label).toBeTruthy();
      expect(info.description).toBeTruthy();
      expect(info.color).toBeTruthy();
    }
  });

  it('falls back to L4 for unknown level', () => {
    expect(getKnowledgeLevelInfo('L9')).toEqual(getKnowledgeLevelInfo('L4'));
  });
});
