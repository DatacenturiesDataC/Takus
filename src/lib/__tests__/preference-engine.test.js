// Takus — Preference Engine Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../storage.js', () => {
  let _store = {};
  return {
    getSetting: vi.fn(async (key) => _store[key] ?? null),
    saveSetting: vi.fn(async (key, val) => { _store[key] = val; }),
    _reset: () => { _store = {}; },
  };
});

import {
  recordSignal,
  getSignals,
  getPromptPreferences,
  getScoringAdjustments,
  clearSignals,
} from '../preference-engine.js';
import { _reset } from '../storage.js';

beforeEach(() => {
  vi.clearAllMocks();
  _reset();
});

// ── recordSignal + getSignals ───────────────────────────────────────────────

describe('recordSignal', () => {
  it('records a signal and retrieves it', async () => {
    await recordSignal('TASK_ACCEPTED', { action: 'CREATE_BUG_REPORT' });
    const all = await getSignals();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('TASK_ACCEPTED');
    expect(all[0].metadata.action).toBe('CREATE_BUG_REPORT');
    expect(all[0].timestamp).toBeGreaterThan(0);
  });

  it('orders newest first', async () => {
    await recordSignal('TASK_ACCEPTED', { id: 'first' });
    await recordSignal('TASK_IGNORED', { id: 'second' });
    const all = await getSignals();
    expect(all[0].metadata.id).toBe('second');
    expect(all[1].metadata.id).toBe('first');
  });

  it('filters by type', async () => {
    await recordSignal('TASK_ACCEPTED', {});
    await recordSignal('TASK_IGNORED', {});
    await recordSignal('TASK_ACCEPTED', {});
    const accepted = await getSignals('TASK_ACCEPTED');
    expect(accepted).toHaveLength(2);
  });

  it('caps at MAX_SIGNALS (500)', async () => {
    // Record 510 signals
    for (let i = 0; i < 510; i++) {
      await recordSignal('SEARCH_CLICKED', { i });
    }
    const all = await getSignals();
    expect(all.length).toBeLessThanOrEqual(500);
    // Most recent should be last recorded
    expect(all[0].metadata.i).toBe(509);
  });
});

describe('clearSignals', () => {
  it('removes all signals', async () => {
    await recordSignal('TASK_ACCEPTED', {});
    await clearSignals();
    const all = await getSignals();
    expect(all).toHaveLength(0);
  });
});

// ── getPromptPreferences ────────────────────────────────────────────────────

describe('getPromptPreferences', () => {
  it('returns concise style with no data', async () => {
    const prefs = await getPromptPreferences();
    expect(prefs.summaryStyle).toBe('concise');
    expect(prefs.taskFocus).toEqual([]);
    expect(prefs.ignoredActions).toEqual([]);
    expect(prefs.hasEnoughData).toBe(false);
  });

  it('switches to detailed when summaries are frequently edited', async () => {
    for (let i = 0; i < 4; i++) {
      await recordSignal('SUMMARY_EDITED', { recordingType: 'meeting' });
    }
    const prefs = await getPromptPreferences('meeting');
    expect(prefs.summaryStyle).toBe('detailed');
  });

  it('identifies ignored actions', async () => {
    // Accept bug reports, but ignore follow-ups
    await recordSignal('TASK_ACCEPTED', { action: 'CREATE_BUG_REPORT' });
    await recordSignal('TASK_ACCEPTED', { action: 'CREATE_BUG_REPORT' });
    await recordSignal('TASK_IGNORED', { action: 'FOLLOW_UP' });
    await recordSignal('TASK_IGNORED', { action: 'FOLLOW_UP' });
    await recordSignal('TASK_IGNORED', { action: 'FOLLOW_UP' });

    const prefs = await getPromptPreferences();
    expect(prefs.ignoredActions).toContain('FOLLOW_UP');
    expect(prefs.taskFocus).toContain('CREATE_BUG_REPORT');
  });

  it('hasEnoughData is true after 10+ signals', async () => {
    for (let i = 0; i < 12; i++) {
      await recordSignal('TASK_ACCEPTED', { action: 'LOG_DECISION' });
    }
    const prefs = await getPromptPreferences();
    expect(prefs.hasEnoughData).toBe(true);
  });
});

// ── getScoringAdjustments ───────────────────────────────────────────────────

describe('getScoringAdjustments', () => {
  it('returns default weights with insufficient data', async () => {
    const adj = await getScoringAdjustments();
    expect(adj.deadlineWeight).toBeCloseTo(0.35);
    expect(adj.closenessWeight).toBeCloseTo(0.25);
    expect(adj.hasEnoughData).toBe(false);
  });

  it('adjusts weights based on accepted task patterns', async () => {
    // User accepts tasks that have deadlines and are from close contacts
    for (let i = 0; i < 15; i++) {
      await recordSignal('TASK_ACCEPTED', {
        hadDeadline: true,
        closenessScore: 80,
        ageHours: 10,
        wasRouted: false,
      });
    }
    const adj = await getScoringAdjustments();
    expect(adj.hasEnoughData).toBe(true);
    // Deadline and closeness should dominate since all accepted tasks had them
    expect(adj.deadlineWeight).toBeGreaterThan(adj.routingWeight);
    expect(adj.closenessWeight).toBeGreaterThan(adj.routingWeight);
  });

  it('weights sum to approximately 1.0', async () => {
    for (let i = 0; i < 12; i++) {
      await recordSignal('TASK_ACCEPTED', {
        hadDeadline: i % 2 === 0,
        closenessScore: i % 3 === 0 ? 80 : 30,
        ageHours: i * 5,
        wasRouted: i % 4 === 0,
      });
    }
    const adj = await getScoringAdjustments();
    const sum = adj.deadlineWeight + adj.closenessWeight + adj.ageWeight + adj.routingWeight;
    expect(sum).toBeCloseTo(1.0, 1);
  });
});
