// Tests for calendar-poller.js — deduplication logic
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  deduplicateEvents,
  startPolling,
  stopPolling,
  isPolling,
  onEvents,
} from '../calendar-poller.js';

// ── Test Helpers ─────────────────────────────────────────────────────────────

function makeEvent(overrides = {}) {
  return {
    id: 'evt-1',
    title: 'Sprint Planning',
    start: new Date('2026-05-14T10:00:00Z'),
    end: new Date('2026-05-14T11:00:00Z'),
    status: 'confirmed',
    isAllDay: false,
    organizers: ['alice@example.com'],
    attendees: ['alice@example.com', 'bob@example.com'],
    conferenceUrl: 'https://meet.google.com/abc-defg-hij',
    calendarId: 'cal-1',
    provider: 'google',
    isPrivate: false,
    attendeeCount: 2,
    ...overrides,
  };
}

// ── deduplicateEvents ────────────────────────────────────────────────────────

describe('deduplicateEvents', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateEvents([])).toEqual([]);
  });

  it('returns single event unchanged', () => {
    const events = [makeEvent()];
    expect(deduplicateEvents(events)).toHaveLength(1);
  });

  it('keeps distinct events', () => {
    const events = [
      makeEvent({ id: 'e1', title: 'Meeting A', organizers: ['alice@example.com'] }),
      makeEvent({ id: 'e2', title: 'Meeting B', organizers: ['bob@example.com'], conferenceUrl: 'https://zoom.us/j/999' }),
    ];
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  it('removes duplicate with 3+ matching criteria', () => {
    // Same id + same organizer + same conferenceUrl + same title/time = 4 matches
    const events = [
      makeEvent({ id: 'e1', provider: 'google' }),
      makeEvent({ id: 'e1', provider: 'microsoft' }), // same event from different provider
    ];
    expect(deduplicateEvents(events)).toHaveLength(1);
  });

  it('deduplicates by organizer + title+time + conferenceUrl (3 matches)', () => {
    const events = [
      makeEvent({ id: 'google-e1' }),
      makeEvent({ id: 'outlook-e1' }), // different ID but same org + title + conf
    ];
    const result = deduplicateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('google-e1'); // first one wins
  });

  it('keeps events with only 2 matching criteria', () => {
    const events = [
      makeEvent({ id: 'e1', organizers: ['alice@example.com'], conferenceUrl: 'https://meet.google.com/abc' }),
      makeEvent({ id: 'e2', organizers: ['alice@example.com'], conferenceUrl: 'https://meet.google.com/abc', title: 'Different Meeting' }),
    ];
    // Matches: organizer (1) + conferenceUrl (1) = 2 < 3 threshold
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  it('handles organizer matching case-insensitively', () => {
    const events = [
      makeEvent({ id: 'e1', organizers: ['Alice@Example.COM'] }),
      makeEvent({ id: 'e1', organizers: ['alice@example.com'] }),
    ];
    // Same ID + same organizer (case-insensitive) + same title/time + same conf = 4 matches
    expect(deduplicateEvents(events)).toHaveLength(1);
  });

  it('title+time match requires time within 1 minute', () => {
    const events = [
      makeEvent({
        id: 'e1',
        title: 'Standup',
        start: new Date('2026-05-14T10:00:00Z'),
        organizers: ['x@x.com'],
        conferenceUrl: null,
      }),
      makeEvent({
        id: 'e2',
        title: 'Standup',
        start: new Date('2026-05-14T10:00:30Z'), // 30 seconds later = within 1 min
        organizers: ['x@x.com'],
        conferenceUrl: null,
      }),
    ];
    // organizer match (1) + title+time match (1) = only 2, not enough for 3
    // But both have null conferenceUrl — that does NOT count as a match (explicit check in source)
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  it('does not match title+time when > 1 minute apart', () => {
    const events = [
      makeEvent({
        id: 'e1',
        title: 'Standup',
        start: new Date('2026-05-14T10:00:00Z'),
        conferenceUrl: 'https://meet.google.com/abc',
      }),
      makeEvent({
        id: 'e2',
        title: 'Standup',
        start: new Date('2026-05-14T10:05:00Z'), // 5 minutes later
        conferenceUrl: 'https://meet.google.com/abc',
      }),
    ];
    // conferenceUrl match (1) + organizer match (1) = 2, title match fails (too far apart)
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  it('handles events with missing fields gracefully', () => {
    const events = [
      makeEvent({ id: null, organizers: [], conferenceUrl: null }),
      makeEvent({ id: null, organizers: [], conferenceUrl: null }),
    ];
    // No matching criteria should trigger — both kept
    expect(deduplicateEvents(events)).toHaveLength(2);
  });
});

// ── Polling lifecycle ────────────────────────────────────────────────────────

describe('polling lifecycle', () => {
  beforeEach(() => { stopPolling(); vi.useFakeTimers(); });
  afterEach(() => { stopPolling(); vi.useRealTimers(); });

  it('isPolling returns false initially', () => {
    expect(isPolling()).toBe(false);
  });

  it('starts and stops polling', () => {
    const fetchFn = vi.fn(async () => []);
    startPolling(fetchFn, [{ calendarId: 'c1', provider: 'google' }], { intervalMs: 1000 });
    expect(isPolling()).toBe(true);

    stopPolling();
    expect(isPolling()).toBe(false);
  });

  it('calls fetchFn immediately on start', async () => {
    const fetchFn = vi.fn(async () => []);
    startPolling(fetchFn, [{ calendarId: 'c1', provider: 'google' }], { intervalMs: 60_000 });

    // Let the microtask queue flush
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('c1', 'google', 24);
  });

  it('emits events to listeners', async () => {
    const events = [makeEvent()];
    const fetchFn = vi.fn(async () => events);
    const listener = vi.fn();

    onEvents(listener);
    startPolling(fetchFn, [{ calendarId: 'c1', provider: 'google' }], { intervalMs: 60_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledWith(events);
  });

  it('unsubscribe removes listener', async () => {
    const fetchFn = vi.fn(async () => [makeEvent()]);
    const listener = vi.fn();
    const unsub = onEvents(listener);

    unsub();
    startPolling(fetchFn, [{ calendarId: 'c1', provider: 'google' }], { intervalMs: 60_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();
  });
});
