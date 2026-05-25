// Tests — Greeting Intelligence Engine

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage before importing
vi.mock('../storage.js', () => ({
  getEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../daily-digest.js', () => ({
  computeStreak: vi.fn().mockReturnValue(0),
  generateDailyDigest: vi.fn().mockResolvedValue({
    overdueTasks: [], todayTasks: [], upcomingMeetings: [],
    goalProgress: { atRisk: [] },
    wellbeing: { focusLevel: 'moderate', taskLoad: { overloaded: false } },
  }),
}));

vi.mock('../calendar-poller.js', () => ({
  getLatestEvents: vi.fn().mockReturnValue([]),
}));

vi.mock('../../apps/passport/index.js', () => ({
  getPassport: vi.fn().mockReturnValue(null),
  getDisplayName: vi.fn().mockReturnValue(''),
}));

import { getGreetingContext, isBirthdayToday, _testExports } from '../greeting-engine.js';
import { getEntries } from '../storage.js';
import { computeStreak, generateDailyDigest } from '../daily-digest.js';
import { getLatestEvents } from '../calendar-poller.js';
import { getPassport, getDisplayName } from '../../apps/passport/index.js';

const { _buildGreeting, _pickSuggestion, _formatMeetingTime } = _testExports;

describe('greeting-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEntries.mockResolvedValue([]);
    computeStreak.mockReturnValue(0);
    getPassport.mockReturnValue(null);
    getDisplayName.mockReturnValue('');
  });

  // ── isBirthdayToday ──────────────────────────────────────────────────

  describe('isBirthdayToday', () => {
    const today = new Date();
    const todayMM = String(today.getMonth() + 1).padStart(2, '0');
    const todayDD = String(today.getDate()).padStart(2, '0');
    const todayM = String(today.getMonth() + 1);
    const todayD = String(today.getDate());
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const todayMonthName = months[today.getMonth()];

    it('returns true for MM-DD format', () => {
      expect(isBirthdayToday(`${todayMM}-${todayDD}`)).toBe(true);
    });

    it('returns true for YYYY-MM-DD format', () => {
      expect(isBirthdayToday(`1990-${todayMM}-${todayDD}`)).toBe(true);
    });

    it('returns true for M/D format', () => {
      expect(isBirthdayToday(`${todayM}/${todayD}`)).toBe(true);
    });

    it('returns true for "Month Day" format', () => {
      expect(isBirthdayToday(`${todayMonthName} ${todayD}`)).toBe(true);
    });

    it('returns false for a different date', () => {
      // Use a date that's definitely not today
      const otherMonth = today.getMonth() === 0 ? '02' : '01';
      expect(isBirthdayToday(`${otherMonth}-15`)).toBe(false);
    });

    it('returns false for null/undefined/empty', () => {
      expect(isBirthdayToday(null)).toBe(false);
      expect(isBirthdayToday(undefined)).toBe(false);
      expect(isBirthdayToday('')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(isBirthdayToday(12345)).toBe(false);
    });

    it('handles whitespace', () => {
      expect(isBirthdayToday(`  ${todayMM}-${todayDD}  `)).toBe(true);
    });
  });

  // ── _buildGreeting ───────────────────────────────────────────────────

  describe('_buildGreeting', () => {
    it('professional tone — morning with name', () => {
      expect(_buildGreeting('morning', 'Hamza', 'professional', false)).toBe('Good morning, Hamza.');
    });

    it('professional tone — returning', () => {
      expect(_buildGreeting('morning', 'Hamza', 'professional', true)).toBe('Welcome back, Hamza.');
    });

    it('casual tone — morning with name', () => {
      expect(_buildGreeting('morning', 'Hamza', 'casual', false)).toBe('Hey Hamza! 👋');
    });

    it('casual tone — returning without name', () => {
      expect(_buildGreeting('afternoon', '', 'casual', true)).toBe('Welcome back! 👋');
    });

    it('academic tone — evening with name', () => {
      expect(_buildGreeting('evening', 'Dr. Smith', 'academic', false)).toBe('Good evening, Dr. Smith.');
    });

    it('concise tone — morning with name', () => {
      expect(_buildGreeting('morning', 'Hamza', 'concise', false)).toBe('Morning, Hamza.');
    });

    it('concise tone — afternoon without name', () => {
      expect(_buildGreeting('afternoon', '', 'concise', false)).toBe('Afternoon.');
    });

    it('concise tone — evening returning', () => {
      expect(_buildGreeting('evening', 'Hamza', 'concise', true)).toBe('Welcome back, Hamza.');
    });

    it('unknown tone falls back to professional', () => {
      expect(_buildGreeting('morning', 'Hamza', 'unknown_tone', false)).toBe('Good morning, Hamza.');
    });

    it('works without name', () => {
      expect(_buildGreeting('morning', '', 'professional', false)).toBe('Good morning.');
    });

    it('casual returning with name', () => {
      expect(_buildGreeting('morning', 'Hamza', 'casual', true)).toBe('Welcome back, Hamza! 👋');
    });

    it('academic returning', () => {
      expect(_buildGreeting('morning', 'Hamza', 'academic', true)).toBe('Welcome back, Hamza.');
    });
  });

  // ── _pickSuggestion ──────────────────────────────────────────────────

  describe('_pickSuggestion', () => {
    const baseCtx = {
      isBirthday: false,
      isOverloaded: false,
      overdueTasks: 0,
      isStreakRecord: false,
      streak: 0,
      isReturning: false,
      isFirstSession: false,
      atRiskGoals: 0,
      todayTasks: 0,
      upcomingMeetings: [],
    };

    it('birthday has highest priority', () => {
      const s = _pickSuggestion({ ...baseCtx, isBirthday: true, overdueTasks: 5 });
      expect(s).toContain('Happy birthday');
    });

    it('overloaded with overdue tasks is second priority', () => {
      const s = _pickSuggestion({ ...baseCtx, isOverloaded: true, overdueTasks: 3 });
      expect(s).toContain('3 overdue tasks');
    });

    it('streak record is third priority', () => {
      const s = _pickSuggestion({ ...baseCtx, isStreakRecord: true, streak: 10 });
      expect(s).toContain('10-day streak');
      expect(s).toContain('personal best');
    });

    it('returning user is fourth priority', () => {
      const s = _pickSuggestion({ ...baseCtx, isReturning: true });
      expect(s).toContain('Welcome back');
    });

    it('returning + first session does not show welcome back', () => {
      const s = _pickSuggestion({ ...baseCtx, isReturning: true, isFirstSession: true });
      // isFirstSession takes precedence over isReturning when both true
      // Actually the code checks isFirstSession exclusion on isReturning
      expect(s).not.toContain('Welcome back');
    });

    it('at-risk goals detected', () => {
      const s = _pickSuggestion({ ...baseCtx, atRiskGoals: 2 });
      expect(s).toContain('2 goals');
      expect(s).toContain('attention');
    });

    it('overdue tasks (non-overloaded)', () => {
      const s = _pickSuggestion({ ...baseCtx, overdueTasks: 1 });
      expect(s).toContain('1 overdue task');
    });

    it('first session', () => {
      const s = _pickSuggestion({ ...baseCtx, isFirstSession: true });
      expect(s).toContain('Welcome to Takus');
    });

    it('active streak > 2', () => {
      const s = _pickSuggestion({ ...baseCtx, streak: 5 });
      expect(s).toContain('5-day streak');
    });

    it('today tasks', () => {
      const s = _pickSuggestion({ ...baseCtx, todayTasks: 3 });
      expect(s).toContain('3 tasks due today');
    });

    it('upcoming meeting', () => {
      const s = _pickSuggestion({ ...baseCtx, upcomingMeetings: [{ title: 'Standup', start: Date.now() + 3600000, hasPreviousContext: false }] });
      expect(s).toContain('Standup');
    });

    it('upcoming meeting with previous context', () => {
      const s = _pickSuggestion({ ...baseCtx, upcomingMeetings: [{ title: 'Review', start: Date.now() + 3600000, hasPreviousContext: true }] });
      expect(s).toContain('discussed this before');
    });

    it('all clear fallback', () => {
      const s = _pickSuggestion(baseCtx);
      expect(s).toContain('All clear');
    });

    it('singular overdue task grammar', () => {
      const s = _pickSuggestion({ ...baseCtx, isOverloaded: true, overdueTasks: 1 });
      expect(s).toContain('1 overdue task.');
      expect(s).not.toContain('tasks.');
    });

    it('singular at-risk goal grammar', () => {
      const s = _pickSuggestion({ ...baseCtx, atRiskGoals: 1 });
      expect(s).toContain('1 goal needs');
    });
  });

  // ── _formatMeetingTime ───────────────────────────────────────────────

  describe('_formatMeetingTime', () => {
    it('formats a valid timestamp', () => {
      const d = new Date();
      d.setHours(14, 30, 0, 0);
      const result = _formatMeetingTime(d.getTime());
      expect(result).toMatch(/2:30\s*PM/i);
    });

    it('returns "soon" for invalid input', () => {
      expect(_formatMeetingTime('not-a-date')).toBe('soon');
    });
  });

  // ── getGreetingContext (integration) ──────────────────────────────────

  describe('getGreetingContext', () => {
    it('returns a complete context object', async () => {
      const ctx = await getGreetingContext();

      expect(ctx).toHaveProperty('name');
      expect(ctx).toHaveProperty('avatar');
      expect(ctx).toHaveProperty('tone');
      expect(ctx).toHaveProperty('timeOfDay');
      expect(ctx).toHaveProperty('greeting');
      expect(ctx).toHaveProperty('dateStr');
      expect(ctx).toHaveProperty('streak');
      expect(ctx).toHaveProperty('isStreakRecord');
      expect(ctx).toHaveProperty('overdueTasks');
      expect(ctx).toHaveProperty('todayTasks');
      expect(ctx).toHaveProperty('upcomingMeetings');
      expect(ctx).toHaveProperty('atRiskGoals');
      expect(ctx).toHaveProperty('focusLevel');
      expect(ctx).toHaveProperty('isOverloaded');
      expect(ctx).toHaveProperty('totalEntries');
      expect(ctx).toHaveProperty('aiProcessedPct');
      expect(ctx).toHaveProperty('weekEntries');
      expect(ctx).toHaveProperty('isBirthday');
      expect(ctx).toHaveProperty('isFirstSession');
      expect(ctx).toHaveProperty('isReturning');
      expect(ctx).toHaveProperty('suggestion');
    });

    it('detects first session when no entries', async () => {
      getEntries.mockResolvedValue([]);
      const ctx = await getGreetingContext();
      expect(ctx.isFirstSession).toBe(true);
      expect(ctx.totalEntries).toBe(0);
    });

    it('detects returning user (> 24h gap)', async () => {
      const oldEntry = { id: '1', date: Date.now() - 2 * 86400000, title: 'Old' };
      getEntries.mockResolvedValue([oldEntry]);
      computeStreak.mockReturnValue(0);
      const ctx = await getGreetingContext();
      expect(ctx.isReturning).toBe(true);
    });

    it('uses passport data when available', async () => {
      getPassport.mockReturnValue({ avatar: '🎯', preferredTone: 'casual', birthday: '' });
      getDisplayName.mockReturnValue('Hamza');
      const ctx = await getGreetingContext();
      expect(ctx.name).toBe('Hamza');
      expect(ctx.avatar).toBe('🎯');
      expect(ctx.tone).toBe('casual');
    });

    it('timeOfDay is a valid segment', async () => {
      const ctx = await getGreetingContext();
      expect(['morning', 'afternoon', 'evening']).toContain(ctx.timeOfDay);
    });

    it('greeting is a non-empty string', async () => {
      const ctx = await getGreetingContext();
      expect(typeof ctx.greeting).toBe('string');
      expect(ctx.greeting.length).toBeGreaterThan(0);
    });

    it('suggestion is a non-empty string', async () => {
      const ctx = await getGreetingContext();
      expect(typeof ctx.suggestion).toBe('string');
      expect(ctx.suggestion.length).toBeGreaterThan(0);
    });

    it('survives storage failure', async () => {
      getEntries.mockRejectedValue(new Error('IDB dead'));
      const ctx = await getGreetingContext();
      expect(ctx.totalEntries).toBe(0);
      expect(ctx.isFirstSession).toBe(true);
    });
  });
});
