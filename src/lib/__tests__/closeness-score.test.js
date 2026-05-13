// Takus — Closeness Score Tests
import { describe, it, expect } from 'vitest';
import { aggregateSignals, computeClosenessScore, isCloseContact, recomputeAllScores } from '../closeness-score.js';

describe('aggregateSignals', () => {
  const now = Date.now();

  it('counts interaction types correctly', () => {
    const interactions = [
      { contactId: 'c1', type: 'direct_message', timestamp: now - 1000 },
      { contactId: 'c1', type: 'direct_message', timestamp: now - 2000 },
      { contactId: 'c1', type: 'meeting', timestamp: now - 3000 },
      { contactId: 'c1', type: 'shared_task', timestamp: now - 4000 },
      { contactId: 'c1', type: 'mention', timestamp: now - 5000 },
    ];
    const signals = aggregateSignals('c1', interactions);
    expect(signals.directMessages).toBe(2);
    expect(signals.meetings).toBe(1);
    expect(signals.sharedTasks).toBe(1);
    expect(signals.mentions).toBe(1);
  });

  it('filters by contactId', () => {
    const interactions = [
      { contactId: 'c1', type: 'meeting', timestamp: now },
      { contactId: 'c2', type: 'meeting', timestamp: now },
    ];
    const signals = aggregateSignals('c1', interactions);
    expect(signals.meetings).toBe(1);
  });

  it('respects daysBack window', () => {
    const interactions = [
      { contactId: 'c1', type: 'meeting', timestamp: now - 1000 },
      { contactId: 'c1', type: 'meeting', timestamp: now - 40 * 24 * 60 * 60 * 1000 }, // 40 days ago
    ];
    const signals = aggregateSignals('c1', interactions, 30);
    expect(signals.meetings).toBe(1); // Only the recent one
  });

  it('tracks lastInteractionTime', () => {
    const interactions = [
      { contactId: 'c1', type: 'meeting', timestamp: now - 5000 },
      { contactId: 'c1', type: 'meeting', timestamp: now - 1000 },
    ];
    const signals = aggregateSignals('c1', interactions);
    expect(signals.lastInteractionTime).toBe(now - 1000);
  });

  it('returns zeros for no interactions', () => {
    const signals = aggregateSignals('c1', []);
    expect(signals.directMessages).toBe(0);
    expect(signals.meetings).toBe(0);
    expect(signals.lastInteractionTime).toBeNull();
  });
});

describe('computeClosenessScore', () => {
  const now = Date.now();

  it('returns 0 for no interactions', () => {
    const score = computeClosenessScore({ id: 'c1' }, []);
    expect(score).toBe(0);
  });

  it('returns higher score for more interactions', () => {
    const fewInteractions = [
      { contactId: 'c1', type: 'meeting', timestamp: now },
    ];
    const manyInteractions = [
      ...Array.from({ length: 5 }, (_, i) => ({ contactId: 'c1', type: 'meeting', timestamp: now - i * 1000 })),
      ...Array.from({ length: 20 }, (_, i) => ({ contactId: 'c1', type: 'direct_message', timestamp: now - i * 1000 })),
    ];
    const lowScore = computeClosenessScore({ id: 'c1' }, fewInteractions);
    const highScore = computeClosenessScore({ id: 'c1' }, manyInteractions);
    expect(highScore).toBeGreaterThan(lowScore);
  });

  it('scores 0–100 range', () => {
    const interactions = Array.from({ length: 100 }, (_, i) => ({
      contactId: 'c1', type: 'direct_message', timestamp: now - i * 1000,
    }));
    const score = computeClosenessScore({ id: 'c1' }, interactions);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('boosts for isManualClose', () => {
    const interactions = [{ contactId: 'c1', type: 'meeting', timestamp: now }];
    const normal = computeClosenessScore({ id: 'c1' }, interactions);
    const manual = computeClosenessScore({ id: 'c1', isManualClose: true }, interactions);
    expect(manual).toBeGreaterThan(normal);
  });

  it('boosts for same org', () => {
    const interactions = [{ contactId: 'c1', type: 'meeting', timestamp: now }];
    const noOrg = computeClosenessScore({ id: 'c1' }, interactions);
    const sameOrg = computeClosenessScore({ id: 'c1', org: 'acme' }, interactions, { userOrg: 'acme' });
    expect(sameOrg).toBeGreaterThan(noOrg);
  });

  it('boosts for manager/report role', () => {
    const interactions = [{ contactId: 'c1', type: 'meeting', timestamp: now }];
    const noRole = computeClosenessScore({ id: 'c1' }, interactions);
    const manager = computeClosenessScore({ id: 'c1', role: 'manager' }, interactions);
    expect(manager).toBeGreaterThan(noRole);
  });

  it('boosts for recent interaction (< 48h)', () => {
    const recentInteractions = [
      { contactId: 'c1', type: 'meeting', timestamp: now - 1000 },
    ];
    const oldInteractions = [
      { contactId: 'c1', type: 'meeting', timestamp: now - 3 * 24 * 60 * 60 * 1000 },
    ];
    const recent = computeClosenessScore({ id: 'c1' }, recentInteractions);
    const old = computeClosenessScore({ id: 'c1' }, oldInteractions);
    expect(recent).toBeGreaterThan(old);
  });
});

describe('isCloseContact', () => {
  it('returns true at threshold', () => {
    expect(isCloseContact(65)).toBe(true);
  });

  it('returns false below threshold', () => {
    expect(isCloseContact(64)).toBe(false);
  });

  it('supports custom threshold', () => {
    expect(isCloseContact(50, 50)).toBe(true);
    expect(isCloseContact(49, 50)).toBe(false);
  });
});

describe('recomputeAllScores', () => {
  it('recomputes scores for all contacts', () => {
    const now = Date.now();
    const contacts = [
      { id: 'c1', closenessScore: 0 },
      { id: 'c2', closenessScore: 50 },
    ];
    const interactions = [
      { contactId: 'c1', type: 'meeting', timestamp: now },
    ];
    const results = recomputeAllScores(contacts, interactions);
    expect(results).toHaveLength(2);
    expect(results[0].contactId).toBe('c1');
    expect(results[0].newScore).toBeGreaterThan(0);
    expect(results[0].changed).toBe(true);
    expect(results[1].contactId).toBe('c2');
    expect(results[1].newScore).toBe(0);
    expect(results[1].changed).toBe(true);
  });
});
