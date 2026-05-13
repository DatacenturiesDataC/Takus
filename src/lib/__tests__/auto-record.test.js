// Takus — Auto-Recording Engine + Calendar Poller Unit Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evaluateAutoRecord, getDefaultConfig } from '../auto-record-engine.js';
import { deduplicateEvents } from '../calendar-poller.js';

// ─── evaluateAutoRecord ─────────────────────────────────────────────────────

describe('evaluateAutoRecord', () => {
  let config;
  const baseEvent = {
    id: 'evt1', title: 'Sprint Planning', start: new Date(), end: new Date(),
    status: 'confirmed', isAllDay: false, organizers: ['me@co.com'],
    attendees: ['a@co.com'], conferenceUrl: null, calendarId: 'cal1',
    provider: 'google', isPrivate: false, attendeeCount: 3,
  };

  beforeEach(() => {
    config = {
      ...getDefaultConfig(),
      autoRecordEnabled: true,
      monitoredCalendars: new Set(['cal1']),
      userEmails: ['me@co.com'],
    };
  });

  it('returns RECORD when all checks pass', () => {
    const { decision } = evaluateAutoRecord(baseEvent, config);
    expect(decision).toBe('RECORD');
  });

  it('returns SKIP when auto-record disabled', () => {
    config.autoRecordEnabled = false;
    const { decision } = evaluateAutoRecord(baseEvent, config);
    expect(decision).toBe('SKIP');
  });

  it('returns SKIP for unmonitored calendar', () => {
    const event = { ...baseEvent, calendarId: 'cal_other' };
    const { decision } = evaluateAutoRecord(event, config);
    expect(decision).toBe('SKIP');
  });

  it('returns SKIP for all-day events', () => {
    const event = { ...baseEvent, isAllDay: true };
    const { decision } = evaluateAutoRecord(event, config);
    expect(decision).toBe('SKIP');
  });

  it('returns SKIP for cancelled events', () => {
    const event = { ...baseEvent, status: 'cancelled' };
    expect(evaluateAutoRecord(event, config).decision).toBe('SKIP');
  });

  it('returns SKIP for free (show as available) events', () => {
    const event = { ...baseEvent, status: 'free' };
    expect(evaluateAutoRecord(event, config).decision).toBe('SKIP');
  });

  it('returns SKIP when user is not organizer', () => {
    const event = { ...baseEvent, organizers: ['someone@else.com'] };
    const { decision } = evaluateAutoRecord(event, config);
    expect(decision).toBe('SKIP');
  });

  it('handles multi-organizer: user is one of them', () => {
    const event = { ...baseEvent, organizers: ['boss@co.com', 'me@co.com'] };
    expect(evaluateAutoRecord(event, config).decision).toBe('RECORD');
  });

  it('organizer match is case-insensitive', () => {
    const event = { ...baseEvent, organizers: ['ME@CO.COM'] };
    expect(evaluateAutoRecord(event, config).decision).toBe('RECORD');
  });

  it('returns SKIP for excluded keywords', () => {
    config.exclusionKeywords = ['social', 'lunch'];
    const event = { ...baseEvent, title: 'Team Lunch & Learn' };
    expect(evaluateAutoRecord(event, config).decision).toBe('SKIP');
  });

  it('returns SKIP for suppressed events', () => {
    const state = { suppressionList: new Set(['evt1']) };
    expect(evaluateAutoRecord(baseEvent, config, state).decision).toBe('SKIP');
  });

  it('returns SKIP for private events when config disallows', () => {
    config.recordPrivateEvents = false;
    const event = { ...baseEvent, isPrivate: true };
    expect(evaluateAutoRecord(event, config).decision).toBe('SKIP');
  });

  it('records private events when allowed', () => {
    config.recordPrivateEvents = true;
    const event = { ...baseEvent, isPrivate: true };
    expect(evaluateAutoRecord(event, config).decision).toBe('RECORD');
  });

  it('returns SKIP for large meetings exceeding maxParticipants', () => {
    config.maxParticipants = 50;
    const event = { ...baseEvent, attendeeCount: 100 };
    expect(evaluateAutoRecord(event, config).decision).toBe('SKIP');
  });

  it('allows meetings under maxParticipants', () => {
    config.maxParticipants = 50;
    const event = { ...baseEvent, attendeeCount: 10 };
    expect(evaluateAutoRecord(event, config).decision).toBe('RECORD');
  });

  it('returns QUEUE when max concurrent recordings reached', () => {
    const state = { activeRecordingCount: 1 };
    expect(evaluateAutoRecord(baseEvent, config, state).decision).toBe('QUEUE');
  });

  it('includes reason string in result', () => {
    config.autoRecordEnabled = false;
    const { reason } = evaluateAutoRecord(baseEvent, config);
    expect(reason).toContain('disabled');
  });
});

// ─── deduplicateEvents ──────────────────────────────────────────────────────

describe('deduplicateEvents', () => {
  it('returns all unique events', () => {
    const events = [
      { id: '1', title: 'A', start: new Date('2025-01-01T10:00'), organizers: ['a@co.com'], conferenceUrl: null },
      { id: '2', title: 'B', start: new Date('2025-01-01T11:00'), organizers: ['b@co.com'], conferenceUrl: null },
    ];
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  it('deduplicates events matching 3+ criteria', () => {
    const events = [
      { id: 'same', title: 'Standup', start: new Date('2025-01-01T09:00'), organizers: ['a@co.com'], conferenceUrl: 'https://meet.google.com/abc' },
      { id: 'same', title: 'Standup', start: new Date('2025-01-01T09:00'), organizers: ['a@co.com'], conferenceUrl: 'https://meet.google.com/abc' },
    ];
    // Matches: id (1) + title+time (2) + organizer (3) + conference (4) = 4 matches
    expect(deduplicateEvents(events)).toHaveLength(1);
  });

  it('keeps events that only match 2 criteria', () => {
    const events = [
      { id: '1', title: 'Standup', start: new Date('2025-01-01T09:00'), organizers: ['a@co.com'], conferenceUrl: null },
      { id: '2', title: 'Standup', start: new Date('2025-01-01T09:00'), organizers: ['b@co.com'], conferenceUrl: null },
    ];
    // Matches: title+time only (1 criterion) — different organizer, different id, no conference
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  it('handles empty array', () => {
    expect(deduplicateEvents([])).toEqual([]);
  });
});
