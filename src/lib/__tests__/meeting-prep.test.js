// Takus — Meeting Prep Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage for pure unit testing
vi.mock('../storage.js', () => ({
  getContacts: vi.fn(async () => []),
  getEntries: vi.fn(async () => []),
  getAllInteractions: vi.fn(async () => []),
}));

import { generateMeetingPrep, shouldShowMeetingPrep } from '../meeting-prep.js';
import { getContacts, getEntries, getAllInteractions } from '../storage.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('shouldShowMeetingPrep', () => {
  it('returns true for events within 60 minutes', () => {
    const event = { start: new Date(Date.now() + 30 * 60 * 1000) };
    expect(shouldShowMeetingPrep(event)).toBe(true);
  });

  it('returns false for events >60 minutes away', () => {
    const event = { start: new Date(Date.now() + 120 * 60 * 1000) };
    expect(shouldShowMeetingPrep(event)).toBe(false);
  });

  it('returns false for past events', () => {
    const event = { start: new Date(Date.now() - 60 * 1000) };
    expect(shouldShowMeetingPrep(event)).toBe(false);
  });

  it('returns false for null event', () => {
    expect(shouldShowMeetingPrep(null)).toBe(false);
    expect(shouldShowMeetingPrep({})).toBe(false);
  });

  it('respects custom window', () => {
    const event = { start: new Date(Date.now() + 90 * 60 * 1000) };
    expect(shouldShowMeetingPrep(event, 60)).toBe(false);
    expect(shouldShowMeetingPrep(event, 120)).toBe(true);
  });
});

describe('generateMeetingPrep', () => {
  it('returns empty prep when no matching contacts', async () => {
    getContacts.mockResolvedValue([]);
    getEntries.mockResolvedValue([]);
    getAllInteractions.mockResolvedValue([]);

    const event = {
      title: 'Team Standup',
      start: new Date(Date.now() + 30 * 60000),
      end: new Date(Date.now() + 60 * 60000),
      attendees: ['alice@example.com'],
      organizers: [],
    };
    const result = await generateMeetingPrep(event);
    expect(result.attendees).toEqual([]);
    expect(result.previousMeetings).toEqual([]);
    expect(result.openTasks).toEqual([]);
    expect(result.preparedAt).toBeGreaterThan(0);
  });

  it('matches contacts by email', async () => {
    getContacts.mockResolvedValue([
      { id: 'c1', name: 'Alice', email: 'alice@example.com' },
      { id: 'c2', name: 'Bob', email: 'bob@other.com' },
    ]);
    getEntries.mockResolvedValue([]);
    getAllInteractions.mockResolvedValue([]);

    const event = {
      title: 'Review',
      start: new Date(Date.now() + 30 * 60000),
      end: new Date(Date.now() + 60 * 60000),
      attendees: ['alice@example.com'],
      organizers: [],
    };
    const result = await generateMeetingPrep(event);
    expect(result.attendees).toHaveLength(1);
    expect(result.attendees[0].name).toBe('Alice');
    expect(result.attendees[0].closenessScore).toBeGreaterThanOrEqual(0);
  });

  it('finds previous meetings with shared attendees', async () => {
    getContacts.mockResolvedValue([
      { id: 'c1', name: 'Alice', email: 'alice@example.com' },
    ]);
    getEntries.mockResolvedValue([
      {
        id: 'r1', title: 'Past Meeting', date: new Date(Date.now() - 86400000).toISOString(),
        calendarEvent: { attendees: ['alice@example.com'] },
      },
    ]);
    getAllInteractions.mockResolvedValue([]);

    const event = {
      title: 'Follow-up',
      start: new Date(Date.now() + 30 * 60000),
      end: new Date(Date.now() + 60 * 60000),
      attendees: ['alice@example.com'],
      organizers: [],
    };
    const result = await generateMeetingPrep(event);
    expect(result.previousMeetings).toHaveLength(1);
    expect(result.previousMeetings[0].title).toBe('Past Meeting');
  });

  it('collects open tasks from matched entries', async () => {
    getContacts.mockResolvedValue([
      { id: 'c1', name: 'Alice', email: 'alice@example.com' },
    ]);
    getEntries.mockResolvedValue([
      {
        id: 'r1', title: 'Sprint Planning', date: new Date(Date.now() - 86400000).toISOString(),
        calendarEvent: { attendees: ['alice@example.com'] },
        tasks: {
          takusTasks: [
            { title: 'Update docs', action: 'JIRA', status: 'pending', assignee: 'Alice' },
            { title: 'Done task', action: 'JIRA', status: 'done' },
          ],
          meTasks: [],
        },
      },
    ]);
    getAllInteractions.mockResolvedValue([]);

    const event = {
      title: 'Follow-up',
      start: new Date(Date.now() + 30 * 60000),
      end: new Date(Date.now() + 60 * 60000),
      attendees: ['alice@example.com'],
      organizers: [],
    };
    const result = await generateMeetingPrep(event);
    expect(result.openTasks).toHaveLength(1);
    expect(result.openTasks[0].text).toBe('Update docs');
  });
});
