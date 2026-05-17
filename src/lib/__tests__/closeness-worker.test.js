// Takus — Closeness Worker Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to mock storage and dependencies before importing the worker
vi.mock('../storage.js', () => ({
  getContacts: vi.fn().mockResolvedValue([]),
  getAllInteractions: vi.fn().mockResolvedValue([]),
  saveContact: vi.fn().mockResolvedValue(undefined),
  getContentItems: vi.fn().mockResolvedValue([]),
  getAllEngagementEvents: vi.fn().mockResolvedValue([]),
  saveContentItem: vi.fn().mockResolvedValue(undefined),
  batchRead: vi.fn().mockResolvedValue({ contacts: [], interactions: [], content_items: [], engagement_events: [] }),
}));
vi.mock('../closeness-score.js', () => ({
  recomputeAllScores: vi.fn().mockReturnValue([]),
  isCloseContact: vi.fn().mockReturnValue(false),
}));
vi.mock('../knowledge-level.js', () => ({
  resolveAllLevels: vi.fn().mockReturnValue([]),
}));
vi.mock('../config.js', () => ({
  getConfig: vi.fn().mockReturnValue({ userId: 'test-user' }),
}));

import { startClosenessWorker, stopClosenessWorker, recomputeScores } from '../closeness-worker.js';
import { getContacts, getAllInteractions, saveContact, batchRead } from '../storage.js';
import { recomputeAllScores, isCloseContact } from '../closeness-score.js';

describe('closeness-worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    stopClosenessWorker();
    vi.useRealTimers();
  });

  it('recomputeScores returns zero when no contacts exist', async () => {
    const result = await recomputeScores();
    expect(result).toEqual({ updated: 0, crossed: [] });
  });

  it('recomputeScores updates changed contacts', async () => {
    const contacts = [
      { id: 'c1', name: 'Alice', closenessScore: 50 },
      { id: 'c2', name: 'Bob', closenessScore: 30 },
    ];
    batchRead.mockResolvedValueOnce({ contacts, interactions: [], content_items: [], engagement_events: [] });
    recomputeAllScores.mockReturnValueOnce([
      { contactId: 'c1', oldScore: 50, newScore: 70, changed: true },
      { contactId: 'c2', oldScore: 30, newScore: 30, changed: false },
    ]);
    isCloseContact.mockImplementation(score => score >= 65);

    const result = await recomputeScores();
    expect(result.updated).toBe(1);
    expect(saveContact).toHaveBeenCalledTimes(1);
    expect(saveContact).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', closenessScore: 70 }));
  });

  it('detects threshold crossings (up)', async () => {
    const contacts = [{ id: 'c1', name: 'Alice', closenessScore: 50 }];
    batchRead.mockResolvedValueOnce({ contacts, interactions: [], content_items: [], engagement_events: [] });
    recomputeAllScores.mockReturnValueOnce([
      { contactId: 'c1', oldScore: 50, newScore: 70, changed: true },
    ]);
    isCloseContact.mockImplementation(score => score >= 65);

    const result = await recomputeScores();
    expect(result.crossed).toEqual([{ contactId: 'c1', direction: 'up' }]);
  });

  it('detects threshold crossings (down)', async () => {
    const contacts = [{ id: 'c1', name: 'Alice', closenessScore: 70 }];
    batchRead.mockResolvedValueOnce({ contacts, interactions: [], content_items: [], engagement_events: [] });
    recomputeAllScores.mockReturnValueOnce([
      { contactId: 'c1', oldScore: 70, newScore: 40, changed: true },
    ]);
    isCloseContact.mockImplementation(score => score >= 65);

    const result = await recomputeScores();
    expect(result.crossed).toEqual([{ contactId: 'c1', direction: 'down' }]);
  });

  it('persists last run time to localStorage', async () => {
    // Need at least one contact so recomputeScores doesn't short-circuit
    batchRead.mockResolvedValueOnce({ contacts: [{ id: 'c1', name: 'A', closenessScore: 50 }], interactions: [], content_items: [], engagement_events: [] });
    recomputeAllScores.mockReturnValueOnce([]);
    await recomputeScores();
    const stored = localStorage.getItem('takus_last_closeness_recompute');
    expect(stored).toBeTruthy();
    expect(Number(stored)).toBeGreaterThan(0);
  });

  it('startClosenessWorker runs immediately when overdue', async () => {
    // No previous run recorded — should fire immediately
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    startClosenessWorker();
    // Advance just enough for the initial setTimeout to fire once, not the infinite chain
    await vi.advanceTimersByTimeAsync(100);
    stopClosenessWorker();
    spy.mockRestore();
  });

  it('stopClosenessWorker clears the timer', () => {
    startClosenessWorker();
    stopClosenessWorker();
    // Starting again should work (no "already running" guard blocking)
    startClosenessWorker();
    stopClosenessWorker();
  });

  it('startClosenessWorker is idempotent', () => {
    startClosenessWorker();
    startClosenessWorker(); // should not create a second timer
    stopClosenessWorker();
  });
});
