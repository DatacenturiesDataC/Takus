// Takus — Blind Spot Detector Tests
import { describe, it, expect } from 'vitest';
import { detectBlindSpots } from '../blind-spot-detector.js';

describe('detectBlindSpots', () => {
  it('returns empty array with no data', () => {
    expect(detectBlindSpots([], [], [])).toEqual([]);
  });

  // ── Ignored Categories ──────────────────────────────────────────────────

  describe('ignored_category', () => {
    it('detects consistently ignored task actions', () => {
      const signals = [
        ...Array(5).fill({ type: 'TASK_IGNORED', metadata: { action: 'FOLLOW_UP' } }),
        { type: 'TASK_ACCEPTED', metadata: { action: 'CREATE_BUG_REPORT' } },
      ];
      const spots = detectBlindSpots([], signals, []);
      const ignored = spots.filter(s => s.type === 'ignored_category');
      expect(ignored).toHaveLength(1);
      expect(ignored[0].message).toContain('follow-up tasks');
      expect(ignored[0].severity).toBe('warning');
    });

    it('does not flag if ignored < 3 times', () => {
      const signals = [
        { type: 'TASK_IGNORED', metadata: { action: 'FOLLOW_UP' } },
        { type: 'TASK_IGNORED', metadata: { action: 'FOLLOW_UP' } },
      ];
      const spots = detectBlindSpots([], signals, []);
      expect(spots.filter(s => s.type === 'ignored_category')).toHaveLength(0);
    });

    it('does not flag if accepted >= ignored', () => {
      const signals = [
        ...Array(3).fill({ type: 'TASK_IGNORED', metadata: { action: 'LOG_DECISION' } }),
        ...Array(3).fill({ type: 'TASK_ACCEPTED', metadata: { action: 'LOG_DECISION' } }),
      ];
      const spots = detectBlindSpots([], signals, []);
      expect(spots.filter(s => s.type === 'ignored_category')).toHaveLength(0);
    });
  });

  // ── Single Source ───────────────────────────────────────────────────────

  describe('single_source', () => {
    it('detects dominant entry type', () => {
      const entries = Array(10).fill(null).map((_, i) => ({
        id: `r-${i}`, type: 'meeting', aiSummary: 'yes', date: Date.now(),
      }));
      const spots = detectBlindSpots(entries, [], []);
      const single = spots.filter(s => s.type === 'single_source');
      expect(single).toHaveLength(1);
      expect(single[0].message).toContain('100%');
    });

    it('does not flag with diverse types', () => {
      const entries = [
        { id: '1', type: 'meeting', aiSummary: 'y' },
        { id: '2', type: 'screen', aiSummary: 'y' },
        { id: '3', type: 'meeting', aiSummary: 'y' },
        { id: '4', type: 'presentation', aiSummary: 'y' },
        { id: '5', type: 'update', aiSummary: 'y' },
      ];
      const spots = detectBlindSpots(entries, [], []);
      expect(spots.filter(s => s.type === 'single_source')).toHaveLength(0);
    });
  });

  // ── Stale Contacts ────────────────────────────────────────────────────

  describe('stale_contact', () => {
    it('detects close contacts not seen in 30+ days', () => {
      const contacts = [
        { name: 'Alice', email: 'alice@co.com', closenessScore: 80 },
        { name: 'Bob', email: 'bob@co.com', closenessScore: 40 },
      ];
      // No recent entries with Alice
      const entries = [];
      const spots = detectBlindSpots(entries, [], contacts);
      const stale = spots.filter(s => s.type === 'stale_contact');
      expect(stale).toHaveLength(1);
      expect(stale[0].message).toContain('Alice');
      expect(stale[0].severity).toBe('warning');
    });

    it('does not flag if contact appeared recently', () => {
      const contacts = [
        { name: 'Alice', email: 'alice@co.com', closenessScore: 80 },
      ];
      const entries = [{
        id: 'r1', date: new Date().toISOString(),
        calendarEvent: { attendees: ['alice@co.com'] },
      }];
      const spots = detectBlindSpots(entries, [], contacts);
      expect(spots.filter(s => s.type === 'stale_contact')).toHaveLength(0);
    });
  });

  // ── Recency Bias ──────────────────────────────────────────────────────

  describe('recency_bias', () => {
    it('detects old pending tasks being neglected', () => {
      const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const entries = [{
        id: 'r1', date: oldDate,
        tasks: {
          takusTasks: [
            { status: 'pending', title: 'Old task 1' },
            { status: 'pending', title: 'Old task 2' },
            { status: 'pending', title: 'Old task 3' },
            { status: 'pending', title: 'Old task 4' },
            { status: 'pending', title: 'Old task 5' },
          ],
          meTasks: [],
        },
      }];
      const spots = detectBlindSpots(entries, [], []);
      const bias = spots.filter(s => s.type === 'recency_bias');
      expect(bias).toHaveLength(1);
      expect(bias[0].message).toContain('5 pending tasks');
    });

    it('does not flag with few old tasks', () => {
      const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const entries = [{
        id: 'r1', date: oldDate,
        tasks: {
          takusTasks: [{ status: 'pending', title: 'One old task' }],
          meTasks: [],
        },
      }];
      const spots = detectBlindSpots(entries, [], []);
      expect(spots.filter(s => s.type === 'recency_bias')).toHaveLength(0);
    });
  });
});
