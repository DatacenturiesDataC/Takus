// Takus — Daily Digest Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage
vi.mock('../storage.js', () => ({
  getRecordings: vi.fn(async () => []),
  getContacts: vi.fn(async () => []),
  getAllInteractions: vi.fn(async () => []),
}));

import { generateDailyDigest, computeStreak } from '../daily-digest.js';
import { getRecordings } from '../storage.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── computeStreak ─────────────────────────────────────────────────────────────

describe('computeStreak', () => {
  it('returns 0 for no recordings', () => {
    expect(computeStreak([])).toBe(0);
  });

  it('returns 1 for a recording today', () => {
    const now = Date.now();
    const recordings = [{ date: new Date(now).toISOString() }];
    expect(computeStreak(recordings, now)).toBe(1);
  });

  it('counts consecutive days', () => {
    const now = new Date('2026-05-13T12:00:00Z').getTime();
    const recordings = [
      { date: '2026-05-13T10:00:00Z' },
      { date: '2026-05-12T10:00:00Z' },
      { date: '2026-05-11T10:00:00Z' },
      // gap on May 10
      { date: '2026-05-09T10:00:00Z' },
    ];
    expect(computeStreak(recordings, now)).toBe(3);
  });

  it('starts from yesterday if no recording today', () => {
    const now = new Date('2026-05-13T12:00:00Z').getTime();
    const recordings = [
      { date: '2026-05-12T10:00:00Z' },
      { date: '2026-05-11T10:00:00Z' },
    ];
    expect(computeStreak(recordings, now)).toBe(2);
  });

  it('handles multiple recordings on the same day', () => {
    const now = new Date('2026-05-13T12:00:00Z').getTime();
    const recordings = [
      { date: '2026-05-13T09:00:00Z' },
      { date: '2026-05-13T14:00:00Z' },
      { date: '2026-05-12T10:00:00Z' },
    ];
    expect(computeStreak(recordings, now)).toBe(2);
  });
});

// ── generateDailyDigest ───────────────────────────────────────────────────────

describe('generateDailyDigest', () => {
  it('returns minimal digest with no data', async () => {
    getRecordings.mockResolvedValue([]);

    const result = await generateDailyDigest([]);
    expect(result.upcomingMeetings).toEqual([]);
    expect(result.overdueTasks).toEqual([]);
    expect(result.todayTasks).toEqual([]);
    expect(result.weekStats.recordings).toBe(0);
    expect(result.streak).toBe(0);
    expect(result.generatedAt).toBeGreaterThan(0);
  });

  it('filters upcoming meetings within lookAhead window', async () => {
    getRecordings.mockResolvedValue([]);

    const events = [
      { title: 'Soon', start: new Date(Date.now() + 30 * 60000), end: new Date(Date.now() + 60 * 60000), status: 'confirmed' },
      { title: 'Far', start: new Date(Date.now() + 24 * 3600000), end: new Date(Date.now() + 25 * 3600000), status: 'confirmed' },
      { title: 'AllDay', start: new Date(), end: new Date(), isAllDay: true },
      { title: 'Cancelled', start: new Date(Date.now() + 60 * 60000), end: new Date(Date.now() + 90 * 60000), status: 'cancelled' },
    ];
    const result = await generateDailyDigest(events);
    expect(result.upcomingMeetings).toHaveLength(1);
    expect(result.upcomingMeetings[0].title).toBe('Soon');
  });

  it('computes week stats from recent recordings', async () => {
    const now = Date.now();
    getRecordings.mockResolvedValue([
      { id: 'r1', date: new Date(now - 86400000).toISOString(), duration: 60000, size: 1024 },
      { id: 'r2', date: new Date(now - 2 * 86400000).toISOString(), duration: 120000, size: 2048, aiSummary: 'yes' },
      { id: 'old', date: new Date(now - 30 * 86400000).toISOString(), duration: 60000, size: 512 },
    ]);

    const result = await generateDailyDigest([]);
    expect(result.weekStats.recordings).toBe(2);
    expect(result.weekStats.totalDuration).toBe(180000);
    expect(result.weekStats.withAI).toBe(1);
  });

  it('identifies overdue tasks', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    getRecordings.mockResolvedValue([
      {
        id: 'r1', title: 'Sprint', date: new Date(Date.now() - 3 * 86400000).toISOString(),
        tasks: {
          takusTasks: [
            { title: 'Overdue', status: 'pending', payload: { deadline: yesterday } },
            { title: 'Done', status: 'done', payload: { deadline: yesterday } },
          ],
          meTasks: [],
        },
      },
    ]);

    const result = await generateDailyDigest([]);
    expect(result.overdueTasks.length).toBeGreaterThanOrEqual(1);
    expect(result.overdueTasks[0].text).toBe('Overdue');
  });

  it('includes wellbeing assessment in digest', async () => {
    getRecordings.mockResolvedValue([]);
    const result = await generateDailyDigest([]);
    expect(result.wellbeing).toHaveProperty('focusScore');
    expect(result.wellbeing).toHaveProperty('focusLevel');
    expect(result.wellbeing).toHaveProperty('taskLoad');
    expect(result.wellbeing).toHaveProperty('meetingFatigue');
    expect(result.wellbeing).toHaveProperty('suggestions');
    expect(Array.isArray(result.wellbeing.suggestions)).toBe(true);
  });

  it('uses pre-loaded recordings when provided', async () => {
    const recordings = [{ id: '1', date: Date.now(), duration: 60, size: 1000 }];
    await generateDailyDigest([], { recordings });
    expect(getRecordings).not.toHaveBeenCalled();
  });

  it('handles storage errors gracefully', async () => {
    getRecordings.mockRejectedValueOnce(new Error('IDB corrupted'));
    const result = await generateDailyDigest([]);
    expect(result.streak).toBe(0);
    expect(result.weekStats.recordings).toBe(0);
    expect(result.generatedAt).toBeGreaterThan(0);
  });

  it('includes goalProgress in digest', async () => {
    getRecordings.mockResolvedValue([]);
    const result = await generateDailyDigest([]);
    expect(result.goalProgress).toHaveProperty('recentlyMentioned');
    expect(result.goalProgress).toHaveProperty('atRisk');
    expect(result.goalProgress).toHaveProperty('totalOpen');
  });
});
