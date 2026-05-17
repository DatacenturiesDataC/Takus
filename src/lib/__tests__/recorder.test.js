// Takus — Recorder Utility Tests
// Tests pure formatting and filename functions from recorder.js.
import { describe, it, expect, vi } from 'vitest';

// Mock browser APIs that recorder.js Recorder class needs at import time
vi.mock('../storage.js', () => ({
  getEntries: vi.fn(() => Promise.resolve([])),
  saveEntry: vi.fn(() => Promise.resolve()),
  saveEntryBlob: vi.fn(() => Promise.resolve()),
  getSetting: vi.fn(() => Promise.resolve(null)),
  saveSetting: vi.fn(() => Promise.resolve()),
}));

import { formatDuration, formatSize, generateFilename } from '../recorder.js';

// ── formatDuration ──────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('formats zero', () => {
    expect(formatDuration(0)).toBe('00:00:00');
  });

  it('formats null/undefined/negative', () => {
    expect(formatDuration(null)).toBe('00:00:00');
    expect(formatDuration(undefined)).toBe('00:00:00');
    expect(formatDuration(-5000)).toBe('00:00:00');
  });

  it('formats seconds only', () => {
    expect(formatDuration(5000)).toBe('00:00:05');
    expect(formatDuration(59000)).toBe('00:00:59');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('00:01:30');
    expect(formatDuration(3599000)).toBe('00:59:59');
  });

  it('formats hours', () => {
    expect(formatDuration(3600000)).toBe('01:00:00');
    expect(formatDuration(3661000)).toBe('01:01:01');
    expect(formatDuration(36000000)).toBe('10:00:00');
  });

  it('handles fractional milliseconds by flooring', () => {
    expect(formatDuration(1500)).toBe('00:00:01');
    expect(formatDuration(999)).toBe('00:00:00');
  });
});

// ── formatSize ──────────────────────────────────────────────────────────────

describe('formatSize', () => {
  it('formats zero and negative', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(-100)).toBe('0 B');
    expect(formatSize(null)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatSize(1)).toBe('1 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(102400)).toBe('100 KB');
  });

  it('formats megabytes', () => {
    expect(formatSize(1048576)).toBe('1 MB');
    expect(formatSize(10485760)).toBe('10 MB');
    expect(formatSize(52428800)).toBe('50 MB');
  });

  it('formats gigabytes', () => {
    expect(formatSize(1073741824)).toBe('1 GB');
    expect(formatSize(2147483648)).toBe('2 GB');
  });

  it('caps at GB for very large values', () => {
    const tb = 1024 * 1073741824;
    const result = formatSize(tb);
    expect(result).toContain('GB');
  });
});

// ── generateFilename ────────────────────────────────────────────────────────

describe('generateFilename', () => {
  it('replaces {title} with sanitized title', () => {
    const result = generateFilename('{title}', 'Sprint Planning');
    expect(result).toBe('Sprint Planning');
  });

  it('strips filesystem-illegal characters from title', () => {
    const result = generateFilename('{title}', 'Meeting: Q1/Q2 <Review>');
    expect(result).toBe('Meeting Q1Q2 Review');
  });

  it('uses "Recording" as default when title is empty', () => {
    const result = generateFilename('{title}', '');
    expect(result).toBe('Recording');
  });

  it('uses "Recording" as default when title is null', () => {
    const result = generateFilename('{title}', null);
    expect(result).toBe('Recording');
  });

  it('replaces {date} with YYYY-MM-DD format', () => {
    const result = generateFilename('{date}', 'Test');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('replaces {time} with HH-MM format', () => {
    const result = generateFilename('{time}', 'Test');
    expect(result).toMatch(/^\d{2}-\d{2}$/);
  });

  it('replaces {timestamp} with ISO-like format', () => {
    const result = generateFilename('{timestamp}', 'Test');
    // ISO timestamp with colons and dots replaced by dashes
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result).not.toContain(':');
    expect(result).not.toContain('.');
  });

  it('handles combined pattern', () => {
    const result = generateFilename('{title} - {date}', 'Meeting');
    expect(result).toMatch(/^Meeting - \d{4}-\d{2}-\d{2}$/);
  });

  it('handles pattern with no placeholders', () => {
    const result = generateFilename('fixed-name', 'Ignored');
    expect(result).toBe('fixed-name');
  });
});
