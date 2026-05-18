// Takus — Google Calendar Tests
// Tests the event scoring and normalization logic.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock GoogleAuth
vi.mock('../google-auth.js', () => ({
  GoogleAuth: {
    getInstance: vi.fn(() => ({
      loadAPI: vi.fn().mockResolvedValue(),
    })),
  },
}));

vi.mock('../utils.js', () => ({
  MS_PER_HOUR: 3_600_000,
}));

import { GoogleCalendar } from '../google-calendar.js';

describe('GoogleCalendar', () => {
  let cal;

  beforeEach(() => {
    cal = new GoogleCalendar();
  });

  it('instantiates with an auth reference', () => {
    expect(cal.auth).toBeDefined();
    expect(cal.auth.loadAPI).toBeDefined();
  });

  it('findMatchingEvent returns null on API error', async () => {
    // Set up gapi to throw
    window.gapi = {
      client: {
        calendar: {
          events: {
            list: vi.fn().mockRejectedValue(new Error('API error')),
          },
        },
      },
    };

    const result = await cal.findMatchingEvent(Date.now());
    expect(result).toBeNull();
  });

  it('findMatchingEvent returns null when no events', async () => {
    window.gapi = {
      client: {
        calendar: {
          events: {
            list: vi.fn().mockResolvedValue({ result: { items: [] } }),
          },
        },
      },
    };

    const result = await cal.findMatchingEvent(Date.now());
    expect(result).toBeNull();
  });

  it('findMatchingEvent normalizes event into provider-neutral shape', async () => {
    const now = Date.now();
    window.gapi = {
      client: {
        calendar: {
          events: {
            list: vi.fn().mockResolvedValue({
              result: {
                items: [{
                  id: 'ev1',
                  summary: 'Team Standup',
                  start: { dateTime: new Date(now).toISOString() },
                  end: { dateTime: new Date(now + 1800000).toISOString() },
                  organizer: { displayName: 'Alice', email: 'alice@test.com' },
                  attendees: [
                    { email: 'bob@test.com', displayName: 'Bob' },
                    { email: 'me@test.com', self: true },
                  ],
                }],
              },
            }),
          },
        },
      },
    };

    const result = await cal.findMatchingEvent(now);
    expect(result).toBeTruthy();
    expect(result.id).toBe('ev1');
    expect(result.summary).toBe('Team Standup');
    expect(result.organizer).toBe('Alice');
    // Self attendee should be filtered out
    expect(result.attendees).toHaveLength(1);
    expect(result.attendees[0].email).toBe('bob@test.com');
  });

  it('scores events with conference links higher', async () => {
    const now = Date.now();
    window.gapi = {
      client: {
        calendar: {
          events: {
            list: vi.fn().mockResolvedValue({
              result: {
                items: [
                  {
                    id: 'no-meet',
                    summary: 'Lunch',
                    start: { dateTime: new Date(now).toISOString() },
                    end: { dateTime: new Date(now + 1800000).toISOString() },
                    attendees: [],
                  },
                  {
                    id: 'with-meet',
                    summary: 'Sync',
                    start: { dateTime: new Date(now).toISOString() },
                    end: { dateTime: new Date(now + 1800000).toISOString() },
                    conferenceData: { entryPoints: [{ uri: 'https://meet.google.com/abc' }] },
                    attendees: [],
                  },
                ],
              },
            }),
          },
        },
      },
    };

    const result = await cal.findMatchingEvent(now);
    // The event with Meet link + "Sync" keyword should win
    expect(result.id).toBe('with-meet');
  });
});
