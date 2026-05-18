// Takus — Microsoft Calendar Tests
// Tests event scoring, normalization, and error handling.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MicrosoftAuth
vi.mock('../microsoft-auth.js', () => ({
  MicrosoftAuth: {
    getInstance: vi.fn(() => ({
      ensureValidToken: vi.fn().mockResolvedValue('test-token'),
    })),
  },
}));

vi.mock('../utils.js', () => ({
  MS_PER_HOUR: 3_600_000,
}));

import { MicrosoftCalendar } from '../microsoft-calendar.js';

describe('MicrosoftCalendar', () => {
  let cal;

  beforeEach(() => {
    cal = new MicrosoftCalendar();
    vi.restoreAllMocks();
  });

  it('instantiates with an auth reference', () => {
    expect(cal.auth).toBeDefined();
    expect(cal.auth.ensureValidToken).toBeDefined();
  });

  it('findMatchingEvent returns null on fetch error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await cal.findMatchingEvent(Date.now());
    expect(result).toBeNull();
  });

  it('findMatchingEvent returns null on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const result = await cal.findMatchingEvent(Date.now());
    expect(result).toBeNull();
  });

  it('findMatchingEvent returns null when no events', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: [] }),
    });
    const result = await cal.findMatchingEvent(Date.now());
    expect(result).toBeNull();
  });

  it('findMatchingEvent normalizes to provider-neutral shape', async () => {
    const now = Date.now();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        value: [{
          id: 'ms-ev1',
          subject: 'Product Review',
          start: { dateTime: new Date(now).toISOString() },
          end: { dateTime: new Date(now + 1800000).toISOString() },
          organizer: { emailAddress: { name: 'Carol', address: 'carol@outlook.com' } },
          attendees: [
            { emailAddress: { name: 'Dave', address: 'dave@outlook.com' }, type: 'required' },
            { emailAddress: { name: 'Room 1', address: 'room@outlook.com' }, type: 'resource' },
          ],
        }],
      }),
    });

    const result = await cal.findMatchingEvent(now);
    expect(result).toBeTruthy();
    expect(result.id).toBe('ms-ev1');
    expect(result.summary).toBe('Product Review');
    expect(result.organizer).toBe('Carol');
    // Resource attendees should be filtered out
    expect(result.attendees).toHaveLength(1);
    expect(result.attendees[0].email).toBe('dave@outlook.com');
  });

  it('scores events with Teams links higher', async () => {
    const now = Date.now();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        value: [
          {
            id: 'no-teams',
            subject: 'Lunch',
            start: { dateTime: new Date(now).toISOString() },
            end: { dateTime: new Date(now + 1800000).toISOString() },
            attendees: [],
          },
          {
            id: 'with-teams',
            subject: 'Sync',
            start: { dateTime: new Date(now).toISOString() },
            end: { dateTime: new Date(now + 1800000).toISOString() },
            onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' },
            attendees: [],
          },
        ],
      }),
    });

    const result = await cal.findMatchingEvent(now);
    expect(result.id).toBe('with-teams');
  });
});
