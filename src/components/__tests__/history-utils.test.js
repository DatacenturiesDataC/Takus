// Takus — History Utils Tests (Phase 71)
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/icons.js', () => ({
  icons: new Proxy({}, {
    get: () => (size) => `<svg size="${size}"></svg>`,
  }),
}));

vi.mock('../../lib/analytics.js', () => ({
  extractTLDW: vi.fn((summary) => {
    if (!summary) return [];
    return ['Point 1', 'Point 2'];
  }),
}));

vi.mock('../../lib/embeddings.js', () => ({
  cosineSimilarity: vi.fn((a, b) => {
    if (!a || !b) return 0;
    return 0.85;
  }),
}));

vi.mock('../../lib/knowledge-level.js', () => ({
  getKnowledgeLevelInfo: vi.fn((level) => ({
    label: 'Competent',
    color: '#22c55e',
    description: 'Good knowledge level',
  })),
}));

vi.mock('../type-picker.js', () => ({
  typeLabel: vi.fn((type) => type.charAt(0).toUpperCase() + type.slice(1)),
  typeAccent: vi.fn(() => '#6366f1'),
}));

import {
  cloudLabel,
  highlight,
  timeAgo,
  secToTimestamp,
  sortFn,
  filterByDate,
  computeRelated,
  meanEmb,
} from '../history-utils.js';

describe('History Utils', () => {
  describe('cloudLabel', () => {
    it('returns null for missing/invalid links', () => {
      expect(cloudLabel(null)).toBeNull();
      expect(cloudLabel('')).toBeNull();
      expect(cloudLabel('http://example.com')).toBeNull();
    });

    it('detects Google Drive', () => {
      expect(cloudLabel('https://drive.google.com/file/abc')).toBe('Google Drive');
      expect(cloudLabel('https://docs.google.com/document/abc')).toBe('Google Drive');
    });

    it('detects OneDrive', () => {
      expect(cloudLabel('https://onedrive.live.com/abc')).toBe('OneDrive');
      expect(cloudLabel('https://sharepoint.com/abc')).toBe('OneDrive');
      expect(cloudLabel('https://1drv.ms/abc')).toBe('OneDrive');
    });

    it('returns Cloud for unknown HTTPS links', () => {
      expect(cloudLabel('https://example.com/file')).toBe('Cloud');
    });
  });

  describe('highlight', () => {
    it('returns escaped text with no query', () => {
      expect(highlight('Hello', '')).toBe('Hello');
    });

    it('highlights matching text', () => {
      const result = highlight('Hello world', 'world');
      expect(result).toContain('<mark');
      expect(result).toContain('world');
    });

    it('is case-insensitive', () => {
      const result = highlight('Hello World', 'hello');
      expect(result).toContain('<mark');
    });

    it('escapes HTML in text', () => {
      const result = highlight('<script>alert(1)</script>', '');
      expect(result).not.toContain('<script>');
    });
  });

  describe('timeAgo', () => {
    it('returns just now for recent dates', () => {
      expect(timeAgo(new Date())).toBe('just now');
    });

    it('returns minutes ago', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60000);
      expect(timeAgo(fiveMinAgo)).toBe('5m ago');
    });

    it('returns hours ago', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 3600000);
      expect(timeAgo(threeHoursAgo)).toBe('3h ago');
    });

    it('returns days ago', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
      expect(timeAgo(twoDaysAgo)).toBe('2d ago');
    });

    it('returns formatted date for old entries', () => {
      const oldDate = new Date(Date.now() - 30 * 86400000);
      const result = timeAgo(oldDate);
      // Should be a locale date string, not "Xd ago"
      expect(result).not.toContain('d ago');
    });
  });

  describe('secToTimestamp', () => {
    it('formats seconds under an hour', () => {
      expect(secToTimestamp(0)).toBe('00:00');
      expect(secToTimestamp(65)).toBe('01:05');
      expect(secToTimestamp(599)).toBe('09:59');
    });

    it('formats seconds over an hour', () => {
      expect(secToTimestamp(3661)).toBe('01:01:01');
      expect(secToTimestamp(7200)).toBe('02:00:00');
    });
  });

  describe('sortFn', () => {
    const recs = [
      { date: 1000, duration: 300, size: 500, analytics: { score: { score: 80 } } },
      { date: 2000, duration: 100, size: 800, analytics: { score: { score: 60 } } },
      { date: 1500, duration: 200, size: 200, analytics: { score: { score: 95 } } },
    ];

    it('sorts newest first by default', () => {
      const sorted = [...recs].sort(sortFn('newest'));
      expect(sorted[0].date).toBe(2000);
    });

    it('sorts oldest first', () => {
      const sorted = [...recs].sort(sortFn('oldest'));
      expect(sorted[0].date).toBe(1000);
    });

    it('sorts by duration descending', () => {
      const sorted = [...recs].sort(sortFn('duration'));
      expect(sorted[0].duration).toBe(300);
    });

    it('sorts by size descending', () => {
      const sorted = [...recs].sort(sortFn('size'));
      expect(sorted[0].size).toBe(800);
    });

    it('sorts by quality score descending', () => {
      const sorted = [...recs].sort(sortFn('quality'));
      expect(sorted[0].analytics.score.score).toBe(95);
    });
  });

  describe('filterByDate', () => {
    const now = Date.now();
    const recs = [
      { id: 'today', date: now },
      { id: 'yesterday', date: now - 86400000 },
      { id: 'last-week', date: now - 4 * 86400000 },
      { id: 'last-month', date: now - 20 * 86400000 },
      { id: 'old', date: now - 60 * 86400000 },
    ];

    it('filters for today', () => {
      const result = filterByDate(recs, 'today');
      expect(result.find(r => r.id === 'today')).toBeDefined();
      expect(result.find(r => r.id === 'old')).toBeUndefined();
    });

    it('filters for week', () => {
      const result = filterByDate(recs, 'week');
      expect(result.find(r => r.id === 'today')).toBeDefined();
      expect(result.find(r => r.id === 'last-week')).toBeDefined();
      expect(result.find(r => r.id === 'old')).toBeUndefined();
    });

    it('filters for month', () => {
      const result = filterByDate(recs, 'month');
      expect(result.find(r => r.id === 'today')).toBeDefined();
    });

    it('filters for specific date (YYYY-MM-DD)', () => {
      const d = new Date(now);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const result = filterByDate(recs, dateStr);
      expect(result.find(r => r.id === 'today')).toBeDefined();
    });

    it('returns all for unknown filter', () => {
      expect(filterByDate(recs, 'unknown')).toHaveLength(recs.length);
    });
  });

  describe('meanEmb', () => {
    it('returns null for empty chunks', () => {
      expect(meanEmb([])).toBeNull();
      expect(meanEmb([{ embedding: [] }])).toBeNull();
    });

    it('computes mean of single chunk', () => {
      const result = meanEmb([{ embedding: [1, 2, 3] }]);
      expect(result).toEqual([1, 2, 3]);
    });

    it('computes mean of multiple chunks', () => {
      const result = meanEmb([
        { embedding: [1, 0, 3] },
        { embedding: [3, 4, 1] },
      ]);
      expect(result).toEqual([2, 2, 2]);
    });
  });

  describe('computeRelated', () => {
    it('returns empty for missing source', () => {
      expect(computeRelated('r1', [], [])).toEqual([]);
    });

    it('returns empty for source with no chunks', () => {
      expect(computeRelated('r1', [{ recordingId: 'r1', chunks: [] }], [])).toEqual([]);
    });

    it('finds related recordings above threshold', () => {
      const emb = [
        { recordingId: 'r1', chunks: [{ embedding: [1, 0, 0] }] },
        { recordingId: 'r2', chunks: [{ embedding: [0.9, 0.1, 0] }] },
      ];
      const recs = [
        { id: 'r1', title: 'Source' },
        { id: 'r2', title: 'Similar' },
      ];
      const result = computeRelated('r1', emb, recs);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toBe('Similar');
    });
  });
});
