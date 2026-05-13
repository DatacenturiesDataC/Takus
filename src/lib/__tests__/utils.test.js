// Takus — Utility & Embeddings Unit Tests
import { describe, it, expect } from 'vitest';
import { esc, renderMarkdown, parseVTT, fmtTimestamp, shortDate, longDate, shortTime } from '../utils.js';

describe('esc()', () => {
  it('escapes HTML special characters', () => {
    expect(esc('<script>alert("xss")</script>')).toContain('&lt;script&gt;');
  });
  it('escapes ampersands', () => { expect(esc('A & B')).toBe('A &amp; B'); });
  it('handles null/undefined', () => { expect(esc(null)).toBe(''); expect(esc(undefined)).toBe(''); });
  it('converts numbers', () => { expect(esc(42)).toBe('42'); });
  it('preserves safe text', () => { expect(esc('Hello')).toBe('Hello'); });
});

describe('renderMarkdown()', () => {
  it('returns empty for null', () => { expect(renderMarkdown(null)).toBe(''); });
  it('renders headings', () => { expect(renderMarkdown('## Summary')).toContain('Summary'); });
  it('renders unordered lists', () => { const r = renderMarkdown('- A\n- B'); expect(r).toContain('<ul'); expect(r).toContain('<li>'); });
  it('renders bold', () => { expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>'); });
  it('renders inline code', () => { expect(renderMarkdown('`code`')).toContain('<code'); });
  it('renders tables', () => { const r = renderMarkdown('| H1 | H2 |\n|---|---|\n| C1 | C2 |'); expect(r).toContain('<table'); });
  it('escapes XSS in content', () => { expect(renderMarkdown('- <script>')).not.toContain('<script>'); });
});

describe('parseVTT()', () => {
  it('returns empty for null', () => { expect(parseVTT(null)).toEqual([]); });
  it('parses basic VTT', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nHello';
    const s = parseVTT(vtt);
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual({ start: 1, end: 5, text: 'Hello' });
  });
  it('handles HH:MM:SS', () => {
    const vtt = 'WEBVTT\n\n01:30:00.000 --> 01:30:30.000\nLong';
    expect(parseVTT(vtt)[0].start).toBe(5400);
  });
});

describe('fmtTimestamp()', () => {
  it('formats seconds to M:SS', () => {
    expect(fmtTimestamp(65)).toBe('1:05');
    expect(fmtTimestamp(0)).toBe('0:00');
    expect(fmtTimestamp(3661)).toBe('61:01');
  });
  it('handles null/undefined/negative', () => {
    expect(fmtTimestamp(null)).toBe('0:00');
    expect(fmtTimestamp(undefined)).toBe('0:00');
    expect(fmtTimestamp(-5)).toBe('0:00');
  });
});

describe('shortDate()', () => {
  it('formats a timestamp to short date', () => {
    const result = shortDate(new Date(2026, 0, 15)); // Jan 15 2026
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
  });
  it('handles invalid input', () => {
    expect(shortDate('not a date')).toBe('');
  });
});

describe('longDate()', () => {
  it('formats a timestamp to long date', () => {
    const result = longDate(new Date(2026, 0, 15)); // January 15, 2026
    expect(result).toMatch(/January/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/2026/);
  });
  it('handles invalid input', () => {
    expect(longDate('not a date')).toBe('');
  });
});

describe('shortTime()', () => {
  it('formats a date to time string', () => {
    const result = shortTime(new Date(2026, 0, 15, 14, 5));
    // Should contain hour and minute in some locale format
    expect(result).toMatch(/14:05|2:05/);
  });
  it('handles invalid input', () => {
    expect(shortTime('not a date')).toBe('');
  });
});
