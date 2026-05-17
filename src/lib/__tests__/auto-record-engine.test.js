// Tests for auto-record-engine.js — decision logic
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

vi.mock('../events.js', () => ({
  AUTO_RECORD_PENDING: 'auto-record-pending',
}));

import {
  evaluateAutoRecord,
  getDefaultConfig,
  scheduleRecording,
  cancelSchedule,
  cancelAllSchedules,
  getScheduledCount,
  updateStopTimer,
} from '../auto-record-engine.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides = {}) {
  return {
    id: 'evt-1',
    calendarId: 'cal-1',
    title: 'Sprint Planning',
    isAllDay: false,
    status: 'confirmed',
    isPrivate: false,
    organizers: ['user@test.com'],
    attendeeCount: 3,
    start: new Date(Date.now() + 600_000).toISOString(),
    end: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return {
    autoRecordEnabled: true,
    monitoredCalendars: new Set(['cal-1']),
    exclusionKeywords: ['lunch', 'social'],
    maxConcurrent: 1,
    bufferBeforeMin: 1,
    bufferAfterMin: 2,
    recordPrivateEvents: false,
    maxParticipants: 0,
    preNotify: true,
    userEmails: ['user@test.com'],
    ...overrides,
  };
}

// ── evaluateAutoRecord ───────────────────────────────────────────────────────

describe('evaluateAutoRecord', () => {
  it('returns RECORD when all checks pass', () => {
    const result = evaluateAutoRecord(makeEvent(), makeConfig());
    expect(result.decision).toBe('RECORD');
    expect(result.reason).toBe('All checks passed');
  });

  it('SKIPs when auto-recording is disabled', () => {
    const result = evaluateAutoRecord(makeEvent(), makeConfig({ autoRecordEnabled: false }));
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('disabled');
  });

  it('SKIPs when calendar is not monitored', () => {
    const result = evaluateAutoRecord(makeEvent({ calendarId: 'other-cal' }), makeConfig());
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('not monitored');
  });

  it('SKIPs all-day events', () => {
    const result = evaluateAutoRecord(makeEvent({ isAllDay: true }), makeConfig());
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('All-day');
  });

  it('SKIPs cancelled events', () => {
    const result = evaluateAutoRecord(makeEvent({ status: 'cancelled' }), makeConfig());
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('cancelled');
  });

  it('SKIPs free events', () => {
    const result = evaluateAutoRecord(makeEvent({ status: 'free' }), makeConfig());
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('free');
  });

  it('SKIPs when user is not the organizer', () => {
    const result = evaluateAutoRecord(
      makeEvent({ organizers: ['other@test.com'] }),
      makeConfig(),
    );
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('not the organizer');
  });

  it('SKIPs when no organizers at all', () => {
    const result = evaluateAutoRecord(
      makeEvent({ organizers: [] }),
      makeConfig(),
    );
    expect(result.decision).toBe('SKIP');
  });

  it('SKIPs when title matches exclusion keyword (case-insensitive)', () => {
    const result = evaluateAutoRecord(
      makeEvent({ title: 'Team LUNCH Break' }),
      makeConfig(),
    );
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('exclusion keyword');
  });

  it('SKIPs when event is in suppression list', () => {
    const result = evaluateAutoRecord(
      makeEvent(),
      makeConfig(),
      { activeRecordingCount: 0, suppressionList: new Set(['evt-1']) },
    );
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('suppressed');
  });

  it('SKIPs private events when recordPrivateEvents is false', () => {
    const result = evaluateAutoRecord(
      makeEvent({ isPrivate: true }),
      makeConfig({ recordPrivateEvents: false }),
    );
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('Private');
  });

  it('RECORDs private events when recordPrivateEvents is true', () => {
    const result = evaluateAutoRecord(
      makeEvent({ isPrivate: true }),
      makeConfig({ recordPrivateEvents: true }),
    );
    expect(result.decision).toBe('RECORD');
  });

  it('SKIPs when attendee count exceeds maxParticipants', () => {
    const result = evaluateAutoRecord(
      makeEvent({ attendeeCount: 50 }),
      makeConfig({ maxParticipants: 10 }),
    );
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toContain('Too many participants');
  });

  it('allows any attendee count when maxParticipants is 0', () => {
    const result = evaluateAutoRecord(
      makeEvent({ attendeeCount: 999 }),
      makeConfig({ maxParticipants: 0 }),
    );
    expect(result.decision).toBe('RECORD');
  });

  it('QUEUEs when max concurrent entries reached', () => {
    const result = evaluateAutoRecord(
      makeEvent(),
      makeConfig({ maxConcurrent: 1 }),
      { activeRecordingCount: 1, suppressionList: new Set() },
    );
    expect(result.decision).toBe('QUEUE');
    expect(result.reason).toContain('concurrent');
  });

  it('RECORDs when concurrent count is below max', () => {
    const result = evaluateAutoRecord(
      makeEvent(),
      makeConfig({ maxConcurrent: 2 }),
      { activeRecordingCount: 1, suppressionList: new Set() },
    );
    expect(result.decision).toBe('RECORD');
  });

  it('handles organizer match case-insensitively', () => {
    const result = evaluateAutoRecord(
      makeEvent({ organizers: ['USER@Test.COM'] }),
      makeConfig({ userEmails: ['user@test.com'] }),
    );
    expect(result.decision).toBe('RECORD');
  });
});

// ── getDefaultConfig ─────────────────────────────────────────────────────────

describe('getDefaultConfig', () => {
  it('returns expected defaults', () => {
    const cfg = getDefaultConfig();
    expect(cfg.autoRecordEnabled).toBe(false);
    expect(cfg.monitoredCalendars).toBeInstanceOf(Set);
    expect(cfg.monitoredCalendars.size).toBe(0);
    expect(cfg.maxConcurrent).toBe(1);
    expect(cfg.bufferBeforeMin).toBe(1);
    expect(cfg.bufferAfterMin).toBe(2);
    expect(cfg.recordPrivateEvents).toBe(false);
    expect(cfg.maxParticipants).toBe(0);
    expect(cfg.preNotify).toBe(true);
    expect(cfg.userEmails).toEqual([]);
    expect(cfg.exclusionKeywords).toEqual([]);
  });
});

// ── Timer Management ─────────────────────────────────────────────────────────

describe('scheduleRecording / cancelSchedule', () => {
  beforeEach(() => { cancelAllSchedules(); vi.useFakeTimers(); });
  afterEach(() => { cancelAllSchedules(); vi.useRealTimers(); });

  it('increments scheduled count', () => {
    expect(getScheduledCount()).toBe(0);
    scheduleRecording(makeEvent(), makeConfig(), {});
    expect(getScheduledCount()).toBe(1);
  });

  it('cancels a schedule', () => {
    scheduleRecording(makeEvent(), makeConfig(), {});
    cancelSchedule('evt-1');
    expect(getScheduledCount()).toBe(0);
  });

  it('cancels all schedules', () => {
    scheduleRecording(makeEvent({ id: 'e1' }), makeConfig(), {});
    scheduleRecording(makeEvent({ id: 'e2' }), makeConfig(), {});
    expect(getScheduledCount()).toBe(2);
    cancelAllSchedules();
    expect(getScheduledCount()).toBe(0);
  });

  it('fires onPreNotify at the correct time', () => {
    const onPreNotify = vi.fn();
    const startMs = Date.now() + 120_000; // 2 min from now
    scheduleRecording(
      makeEvent({ start: new Date(startMs).toISOString() }),
      makeConfig({ bufferBeforeMin: 1, preNotify: true }),
      { onPreNotify },
    );
    // Pre-notify should fire at T-1min = 1 min from now (60s)
    vi.advanceTimersByTime(59_999);
    expect(onPreNotify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onPreNotify).toHaveBeenCalledTimes(1);
  });

  it('fires onAutoStop at event end + buffer', () => {
    const onAutoStop = vi.fn();
    const endMs = Date.now() + 60_000; // 1 min from now
    scheduleRecording(
      makeEvent({ end: new Date(endMs).toISOString() }),
      makeConfig({ bufferAfterMin: 2 }),
      { onAutoStop },
    );
    // Stop should fire at end + 2min = 3 min from now
    vi.advanceTimersByTime(179_999);
    expect(onAutoStop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
  });

  it('replaces existing schedule for same event ID', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    scheduleRecording(makeEvent(), makeConfig(), { onAutoStop: cb1 });
    scheduleRecording(makeEvent(), makeConfig(), { onAutoStop: cb2 });
    expect(getScheduledCount()).toBe(1);
  });
});

describe('updateStopTimer', () => {
  beforeEach(() => { cancelAllSchedules(); vi.useFakeTimers(); });
  afterEach(() => { cancelAllSchedules(); vi.useRealTimers(); });

  it('updates the stop timer to a new end time', () => {
    const stopCb = vi.fn();
    const now = Date.now();
    scheduleRecording(
      makeEvent({
        start: new Date(now + 10_000).toISOString(),
        end: new Date(now + 60_000).toISOString(),
      }),
      makeConfig({ bufferAfterMin: 1 }),
      { onAutoStop: stopCb },
    );

    // Extend the meeting end by 5 min → new stop at now + 360_000 + 1min buffer = now + 420_000
    const newCb = vi.fn();
    updateStopTimer('evt-1', new Date(now + 360_000), 1, newCb);

    // Advance past old stop time (60s + 1min buffer = 120s) → should NOT fire
    vi.advanceTimersByTime(121_000);
    expect(newCb).not.toHaveBeenCalled();

    // Advance to just before the new stop time (420s total)
    vi.advanceTimersByTime(298_000);
    expect(newCb).not.toHaveBeenCalled();

    // Cross the new stop time
    vi.advanceTimersByTime(2_000);
    expect(newCb).toHaveBeenCalledTimes(1);
  });

  it('does nothing for unknown event IDs', () => {
    updateStopTimer('unknown', new Date(Date.now() + 60_000), 0, vi.fn());
    // Should not throw
    expect(getScheduledCount()).toBe(0);
  });
});
