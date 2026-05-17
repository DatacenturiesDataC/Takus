// Takus — Analytics Unit Tests
import { describe, it, expect } from 'vitest';
import {
  analyzeFillerWords,
  computeQualityScore,
  extractTLDW,
  parseChapters,
  isUrgentUpdate,
  computeTaskMetrics,
} from '../analytics.js';

describe('analyzeFillerWords', () => {
  it('returns zeros for empty transcript', () => {
    const result = analyzeFillerWords('', 60000);
    expect(result.total).toBe(0);
    expect(result.perMinute).toBe(0);
    expect(result.breakdown).toHaveLength(0);
    expect(result.rating).toBe('excellent');
  });

  it('returns zeros for null transcript', () => {
    const result = analyzeFillerWords(null);
    expect(result.total).toBe(0);
    expect(result.rating).toBe('excellent');
  });

  it('counts filler words correctly', () => {
    const transcript = 'Um, you know, like, basically I think um that like the thing is basically done';
    const result = analyzeFillerWords(transcript, 60000);
    expect(result.total).toBeGreaterThan(0);
    expect(result.breakdown.length).toBeGreaterThan(0);
    // Should find 'um' (2), 'you know' (1), 'like' (2), 'basically' (2)
    const umEntry = result.breakdown.find(b => b.label === 'um');
    expect(umEntry?.count).toBe(2);
  });

  it('rates based on per-minute density', () => {
    // 1 filler in 1 minute = excellent
    const low = analyzeFillerWords('um', 60000);
    expect(low.rating).toBe('excellent');

    // Many fillers in short time = needs_work
    const many = analyzeFillerWords(
      'um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um',
      60000
    );
    expect(many.rating).toBe('needs_work');
  });

  it('limits breakdown to top 5', () => {
    const result = analyzeFillerWords(
      'um uh like you know basically actually literally right? so I mean kind of sort of',
      60000
    );
    expect(result.breakdown.length).toBeLessThanOrEqual(5);
  });
});

describe('computeQualityScore', () => {
  it('returns baseline score for empty recording', () => {
    const result = computeQualityScore({ duration: 60000 });
    expect(result.score).toBe(50);
    expect(result.label).toBe('Fair');
  });

  it('adds points for AI summary', () => {
    const withSummary = computeQualityScore({ duration: 60000, aiSummary: '## Summary\nSome content' });
    const without = computeQualityScore({ duration: 60000 });
    expect(withSummary.score).toBeGreaterThan(without.score);
  });

  it('score is clamped between 0 and 100', () => {
    const result = computeQualityScore({
      duration: 60000,
      aiSummary: '## Summary\nWe decided and agreed and confirmed and resolved everything',
      tasks: { takusTasks: Array(5).fill({ id: 't' }), meTasks: Array(5).fill({ id: 'm' }) },
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('returns correct label and color for each tier', () => {
    expect(computeQualityScore({ duration: 60000, aiSummary: 'a'.repeat(500), tasks: { takusTasks: Array(5).fill({}), meTasks: Array(5).fill({}) } }).label).toMatch(/Excellent|Good/);
  });
});

describe('extractTLDW', () => {
  it('returns empty array for null input', () => {
    expect(extractTLDW(null)).toEqual([]);
    expect(extractTLDW('')).toEqual([]);
  });

  it('extracts up to 3 bullets', () => {
    const summary = `## Summary
- First bullet point about the meeting
- Second bullet point about decisions
- Third bullet point about action items
- Fourth bullet should not appear`;
    const result = extractTLDW(summary);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain('First bullet');
    expect(result[2]).toContain('Third bullet');
  });

  it('strips markdown bold', () => {
    const summary = '- **Bold text** in a bullet';
    const result = extractTLDW(summary);
    expect(result[0]).toBe('Bold text in a bullet');
  });

  it('falls back to non-heading lines', () => {
    const summary = `## Summary
This is a long sentence that serves as the summary of the meeting content and has enough length.`;
    const result = extractTLDW(summary);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('parseChapters', () => {
  it('returns empty for null/empty', () => {
    expect(parseChapters(null)).toEqual([]);
    expect(parseChapters('')).toEqual([]);
  });

  it('parses [~MM:SS] format', () => {
    const summary = `## Chapter List
1. [~00:02] Introduction
2. [~05:30] Deep dive into architecture
3. [~12:00] Q&A`;
    const chapters = parseChapters(summary);
    expect(chapters).toHaveLength(3);
    expect(chapters[0]).toEqual({ title: 'Introduction', seconds: 2 });
    expect(chapters[1]).toEqual({ title: 'Deep dive into architecture', seconds: 330 });
    expect(chapters[2].seconds).toBe(720);
  });

  it('parses (~MM:SS) suffix format', () => {
    const summary = `1. Introduction (~02:00)
2. Main Content (~10:30)`;
    const chapters = parseChapters(summary);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({ title: 'Introduction', seconds: 120 });
  });
});

describe('isUrgentUpdate', () => {
  it('returns false for non-update types', () => {
    expect(isUrgentUpdate({ type: 'meeting', aiSummary: 'P0 critical blocker' })).toBe(false);
    expect(isUrgentUpdate({ type: 'screen' })).toBe(false);
  });

  it('detects urgent keywords in summary', () => {
    expect(isUrgentUpdate({ type: 'update', aiSummary: 'We have a P0 issue blocking release' })).toBe(true);
    expect(isUrgentUpdate({ type: 'update', aiSummary: 'This is critical and needs escalation' })).toBe(true);
    expect(isUrgentUpdate({ type: 'update', aiSummary: 'Everything is fine, no blockers' })).toBe(false); // 'blockers' ≠ 'blocker' (word boundary)
  });

  it('detects high-urgency me-tasks', () => {
    expect(isUrgentUpdate({
      type: 'update',
      aiSummary: 'Normal update',
      tasks: { meTasks: [{ urgency: 'high', note: 'Fix prod' }] },
    })).toBe(true);
  });

  it('returns false for normal updates', () => {
    expect(isUrgentUpdate({
      type: 'update',
      aiSummary: 'Completed the feature. No issues. All tests pass.',
      tasks: { meTasks: [{ urgency: 'normal', note: 'Deploy' }] },
    })).toBe(false);
  });
});

describe('computeTaskMetrics', () => {
  it('returns zeros for empty entries', () => {
    const metrics = computeTaskMetrics([]);
    expect(metrics.total).toBe(0);
    expect(metrics.completionRate).toBe(0);
  });

  it('counts tasks by status', () => {
    const entries = [{
      tasks: {
        takusTasks: [
          { id: 't1', status: 'pending' },
          { id: 't2', status: 'done', doneAt: Date.now() },
        ],
        meTasks: [
          { id: 'm1', status: 'ignored', ignoredAt: Date.now() },
        ],
      },
      date: Date.now(),
    }];
    const metrics = computeTaskMetrics(entries);
    expect(metrics.total).toBe(3);
    expect(metrics.pending).toBe(1);
    expect(metrics.done).toBe(1);
    expect(metrics.ignored).toBe(1);
    expect(metrics.completionRate).toBe(67); // (1+1)/3 = 67%
  });

  it('handles tasks with missing status', () => {
    const entries = [{
      tasks: {
        takusTasks: [{ id: 't1', status: 'done' }],
        meTasks: [{ id: 'm1' }],
      },
      date: Date.now(),
    }];
    const metrics = computeTaskMetrics(entries);
    expect(metrics.done).toBe(1);
    expect(metrics.pending).toBe(1);
  });

  it('tracks step completion', () => {
    const entries = [{
      tasks: {
        takusTasks: [{
          id: 't1', status: 'pending',
          steps: [{ text: 'Step 1', status: 'completed' }, { text: 'Step 2', status: 'pending' }],
        }],
        meTasks: [],
      },
      date: Date.now(),
    }];
    const metrics = computeTaskMetrics(entries);
    expect(metrics.totalSteps).toBe(2);
    expect(metrics.doneSteps).toBe(1);
    expect(metrics.stepRate).toBe(50);
  });

  it('tracks objectives', () => {
    const entries = [{
      tasks: {
        takusTasks: [
          { id: 't1', status: 'done', objective: 'Ship v2.0' },
          { id: 't2', status: 'done', objective: 'Ship v2.0' },
        ],
        meTasks: [
          { id: 'm1', status: 'pending', objective: 'Fix bugs' },
        ],
      },
      date: Date.now(),
    }];
    const metrics = computeTaskMetrics(entries);
    expect(metrics.objectiveCount).toBe(2);
    expect(metrics.objectivesCompleted).toBe(1); // 'Ship v2.0' fully resolved
  });
});
