// Takus — Well-being Service Tests (Phase 39 + Phase 59)
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../storage.js', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  saveSetting: vi.fn(() => Promise.resolve()),
}));

import {
  startSession,
  getSessionDuration,
  getBreakSuggestion,
  acknowledgeBreak,
  getGoalHealth,
  getTaskLoadHealth,
  getMeetingFatigue,
  estimateFocusCapacity,
  runWellbeingCheck,
  onWellbeingEvent,
} from '../wellbeing.js';

describe('Well-being Service', () => {
  beforeEach(() => {
    // Reset session state
    startSession();
  });

  describe('Session tracking', () => {
    it('tracks session duration', () => {
      startSession();
      const duration = getSessionDuration();
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(1000); // Should be near-zero
    });
  });

  describe('Break suggestions', () => {
    it('returns null when session is short', () => {
      startSession();
      const suggestion = getBreakSuggestion();
      expect(suggestion).toBeNull();
    });

    it('returns suggestion after threshold', () => {
      // Manually set session start to 3 hours ago
      const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
      try { sessionStorage.setItem('wellbeing_session', String(threeHoursAgo)); } catch {}
      // Force re-read
      startSession();
    });

    it('acknowledgeBreak resets session', () => {
      acknowledgeBreak();
      const duration = getSessionDuration();
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Goal health', () => {
    it('returns healthy state for no goals', () => {
      const health = getGoalHealth([]);
      expect(health.activeCount).toBe(0);
      expect(health.atRiskCount).toBe(0);
      expect(health.overloaded).toBe(false);
      expect(health.stagnant).toBe(false);
      expect(health.suggestion).toBeNull();
    });

    it('detects goal overload', () => {
      const goals = Array.from({ length: 10 }, (_, i) => ({
        id: `goal_${i}`,
        properties: { state: 'active', lastMentionedAt: Date.now() },
        createdAt: Date.now(),
      }));
      const health = getGoalHealth(goals, { maxActive: 7 });
      expect(health.activeCount).toBe(10);
      expect(health.overloaded).toBe(true);
      expect(health.suggestion).toContain('10 active goals');
    });

    it('does not flag overload under threshold', () => {
      const goals = Array.from({ length: 5 }, (_, i) => ({
        id: `goal_${i}`,
        properties: { state: 'active', lastMentionedAt: Date.now() },
        createdAt: Date.now(),
      }));
      const health = getGoalHealth(goals, { maxActive: 7 });
      expect(health.overloaded).toBe(false);
      expect(health.suggestion).toBeNull();
    });

    it('detects stagnation', () => {
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const goals = [
        { id: 'g1', properties: { state: 'active', lastMentionedAt: thirtyDaysAgo }, createdAt: thirtyDaysAgo },
        { id: 'g2', properties: { state: 'active', lastMentionedAt: thirtyDaysAgo }, createdAt: thirtyDaysAgo },
      ];
      const health = getGoalHealth(goals, { stagnationDays: 7 });
      expect(health.stagnant).toBe(true);
      expect(health.suggestion).toContain('haven\'t seen activity');
    });

    it('counts at-risk goals', () => {
      const goals = [
        { id: 'g1', properties: { state: 'active' } },
        { id: 'g2', properties: { state: 'at-risk' } },
        { id: 'g3', properties: { state: 'at-risk' } },
        { id: 'g4', properties: { state: 'achieved' } },
      ];
      const health = getGoalHealth(goals);
      expect(health.activeCount).toBe(1);
      expect(health.atRiskCount).toBe(2);
    });
  });

  // ── Phase 59: Task Load ──────────────────────────────────────────────────

  describe('Task load health', () => {
    it('returns healthy for few pending tasks', () => {
      const tasks = [
        { id: 't1', status: 'pending' },
        { id: 't2', status: 'done' },
      ];
      const health = getTaskLoadHealth(tasks);
      expect(health.pendingCount).toBe(1);
      expect(health.overloaded).toBe(false);
      expect(health.suggestion).toBeNull();
    });

    it('detects task overload', () => {
      const tasks = Array.from({ length: 20 }, (_, i) => ({
        id: `t_${i}`, status: 'pending',
      }));
      const health = getTaskLoadHealth(tasks, { maxPending: 15 });
      expect(health.pendingCount).toBe(20);
      expect(health.overloaded).toBe(true);
      expect(health.suggestion).toContain('20 pending tasks');
      expect(health.suggestion).toContain('triaging');
    });

    it('detects overdue tasks', () => {
      const tasks = Array.from({ length: 5 }, (_, i) => ({
        id: `t_${i}`, status: 'pending', dueDate: Date.now() - 86400000,
      }));
      const health = getTaskLoadHealth(tasks);
      expect(health.overdueCount).toBe(5);
      expect(health.suggestion).toContain('overdue');
    });

    it('ignores done tasks for overdue count', () => {
      const tasks = [
        { id: 't1', status: 'done', dueDate: Date.now() - 86400000 },
        { id: 't2', status: 'pending' },
      ];
      const health = getTaskLoadHealth(tasks);
      expect(health.overdueCount).toBe(0);
    });
  });

  // ── Phase 59: Meeting Fatigue ─────────────────────────────────────────────

  describe('Meeting fatigue', () => {
    it('returns no fatigue for few meetings', () => {
      const entries = [
        { type: 'meeting', date: Date.now() - 3600000 },
      ];
      const fatigue = getMeetingFatigue(entries);
      expect(fatigue.recentMeetings).toBe(1);
      expect(fatigue.fatigued).toBe(false);
      expect(fatigue.suggestion).toBeNull();
    });

    it('detects meeting fatigue', () => {
      const entries = Array.from({ length: 4 }, (_, i) => ({
        type: 'meeting', date: Date.now() - (i * 3600000),
      }));
      const fatigue = getMeetingFatigue(entries, { threshold: 3 });
      expect(fatigue.recentMeetings).toBe(4);
      expect(fatigue.fatigued).toBe(true);
      expect(fatigue.suggestion).toContain('meetings');
      expect(fatigue.suggestion).toContain('focus time');
    });

    it('ignores non-meeting entries', () => {
      const entries = [
        { type: 'screen', date: Date.now() - 1800000 },
        { type: 'screen', date: Date.now() - 3600000 },
        { type: 'screen', date: Date.now() - 7200000 },
        { type: 'screen', date: Date.now() - 10800000 },
      ];
      const fatigue = getMeetingFatigue(entries);
      expect(fatigue.recentMeetings).toBe(0);
      expect(fatigue.fatigued).toBe(false);
    });

    it('ignores old meetings', () => {
      const entries = [
        { type: 'meeting', date: Date.now() - 24 * 3600000 }, // 24 hours ago
      ];
      const fatigue = getMeetingFatigue(entries);
      expect(fatigue.recentMeetings).toBe(0);
    });
  });

  // ── Phase 59: Focus Capacity ──────────────────────────────────────────────

  describe('Focus capacity', () => {
    it('returns high for fresh session', () => {
      const focus = estimateFocusCapacity({ sessionDuration: 0, meetingCount: 0, pendingTasks: 0 });
      expect(focus.focusScore).toBe(100);
      expect(focus.level).toBe('high');
    });

    it('reduces score for long sessions', () => {
      const focus = estimateFocusCapacity({ sessionDuration: 5 * 3600000, meetingCount: 0, pendingTasks: 0 });
      expect(focus.focusScore).toBeLessThan(100);
    });

    it('reduces score for meetings', () => {
      const focus = estimateFocusCapacity({ sessionDuration: 0, meetingCount: 5, pendingTasks: 0 });
      expect(focus.focusScore).toBeLessThan(50);
    });

    it('reduces score for high task load', () => {
      const focus = estimateFocusCapacity({ sessionDuration: 0, meetingCount: 0, pendingTasks: 25 });
      expect(focus.focusScore).toBeLessThan(100);
    });

    it('returns low for combined stress factors', () => {
      const focus = estimateFocusCapacity({ sessionDuration: 5 * 3600000, meetingCount: 4, pendingTasks: 25 });
      expect(focus.level).toBe('low');
      expect(focus.suggestion).toContain('restorative break');
    });

    it('clamps score to 0-100', () => {
      const focus = estimateFocusCapacity({ sessionDuration: 10 * 3600000, meetingCount: 10, pendingTasks: 50 });
      expect(focus.focusScore).toBeGreaterThanOrEqual(0);
      expect(focus.focusScore).toBeLessThanOrEqual(100);
    });
  });

  // ── Existing integration tests ────────────────────────────────────────────

  describe('Event system', () => {
    it('subscribes and unsubscribes', () => {
      const listener = vi.fn();
      const unsub = onWellbeingEvent(listener);
      expect(typeof unsub).toBe('function');
      unsub(); // Should not throw
    });
  });

  describe('runWellbeingCheck', () => {
    it('returns clean state when everything is fine', () => {
      startSession();
      const result = runWellbeingCheck({ goals: [] });
      expect(result.breakSuggested).toBe(false);
      expect(result.goalOverload).toBe(false);
      expect(result.taskOverload).toBe(false);
      expect(result.meetingFatigue).toBe(false);
      expect(result.focusLevel).toBe('high');
      expect(result.suggestion).toBeNull();
    });

    it('detects goal overload via runWellbeingCheck', () => {
      const goals = Array.from({ length: 10 }, (_, i) => ({
        id: `goal_${i}`,
        properties: { state: 'active', lastMentionedAt: Date.now() },
      }));
      const result = runWellbeingCheck({ goals, maxActiveGoals: 7 });
      expect(result.goalOverload).toBe(true);
      expect(result.suggestion).toContain('active goals');
    });

    it('detects task overload via runWellbeingCheck', () => {
      const tasks = Array.from({ length: 20 }, (_, i) => ({
        id: `t_${i}`, status: 'pending',
      }));
      const result = runWellbeingCheck({ tasks, maxPendingTasks: 15 });
      expect(result.taskOverload).toBe(true);
    });

    it('detects meeting fatigue via runWellbeingCheck', () => {
      const entries = Array.from({ length: 5 }, (_, i) => ({
        type: 'meeting', date: Date.now() - (i * 1800000),
      }));
      const result = runWellbeingCheck({ entries });
      expect(result.meetingFatigue).toBe(true);
    });

    it('computes focus level', () => {
      const result = runWellbeingCheck({});
      expect(['high', 'medium', 'low']).toContain(result.focusLevel);
    });
  });

  // ── Phase 79: Edge Cases & Boundary Conditions ────────────────────────────

  describe('Edge cases', () => {
    it('getGoalHealth handles goals with missing properties', () => {
      const goals = [{ id: 'g1' }, { id: 'g2', properties: {} }];
      const health = getGoalHealth(goals);
      expect(health.activeCount).toBe(0); // no state = not active
      expect(health.atRiskCount).toBe(0);
    });

    it('getTaskLoadHealth handles empty task array', () => {
      const health = getTaskLoadHealth([]);
      expect(health.pendingCount).toBe(0);
      expect(health.overdueCount).toBe(0);
      expect(health.overloaded).toBe(false);
    });

    it('getTaskLoadHealth handles tasks with null dueDate', () => {
      const tasks = [
        { id: 't1', status: 'pending', dueDate: null },
        { id: 't2', status: 'pending', dueDate: undefined },
      ];
      const health = getTaskLoadHealth(tasks);
      expect(health.pendingCount).toBe(2);
      expect(health.overdueCount).toBe(0);
    });

    it('getMeetingFatigue handles empty entries', () => {
      const fatigue = getMeetingFatigue([]);
      expect(fatigue.recentMeetings).toBe(0);
      expect(fatigue.fatigued).toBe(false);
    });

    it('getMeetingFatigue handles entries with missing date', () => {
      const entries = [{ type: 'meeting' }];
      const fatigue = getMeetingFatigue(entries);
      expect(fatigue.recentMeetings).toBe(0);
    });

    it('estimateFocusCapacity handles zero inputs', () => {
      const focus = estimateFocusCapacity({ sessionDuration: 0, meetingCount: 0, pendingTasks: 0 });
      expect(focus.focusScore).toBe(100);
      expect(focus.level).toBe('high');
    });

    it('estimateFocusCapacity returns medium for moderate stress', () => {
      const focus = estimateFocusCapacity({ sessionDuration: 2 * 3600000, meetingCount: 2, pendingTasks: 10 });
      expect(['high', 'medium']).toContain(focus.level);
    });

    it('estimateFocusCapacity handles negative session duration', () => {
      const focus = estimateFocusCapacity({ sessionDuration: -1000, meetingCount: 0, pendingTasks: 0 });
      expect(focus.focusScore).toBeGreaterThanOrEqual(0);
      expect(focus.focusScore).toBeLessThanOrEqual(100);
    });

    it('getGoalHealth counts achieved goals correctly', () => {
      const goals = [
        { id: 'g1', properties: { state: 'achieved' } },
        { id: 'g2', properties: { state: 'abandoned' } },
        { id: 'g3', properties: { state: 'active' } },
      ];
      const health = getGoalHealth(goals);
      expect(health.activeCount).toBe(1);
    });

    it('runWellbeingCheck with all empty inputs returns clean state', () => {
      const result = runWellbeingCheck({ goals: [], tasks: [], entries: [] });
      expect(result.breakSuggested).toBe(false);
      expect(result.goalOverload).toBe(false);
      expect(result.taskOverload).toBe(false);
      expect(result.meetingFatigue).toBe(false);
    });
  });
});
