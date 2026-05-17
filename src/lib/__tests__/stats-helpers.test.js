// Takus — Stats Helpers Unit Tests
import { describe, it, expect } from 'vitest';
import { statCell, qualColor, sparkline, fillerBar, decisionRow, detectConflicts, typePieDonut, computeStreak, busiestWeek } from '../../components/insights-cards/stats-helpers.js';

describe('statCell', () => {
  it('renders a stat cell with icon, value, and label', () => {
    const html = statCell('<svg>icon</svg>', 42, 'Recordings');
    expect(html).toContain('42');
    expect(html).toContain('Recordings');
    expect(html).toContain('<svg>icon</svg>');
  });

  it('escapes special characters in value', () => {
    const html = statCell('', '<script>', 'Label');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('qualColor', () => {
  it('returns success color for high scores', () => {
    expect(qualColor(85)).toContain('success');
  });

  it('returns amber for medium scores', () => {
    expect(qualColor(55)).toContain('f59e0b');
  });

  it('returns red for low scores', () => {
    expect(qualColor(30)).toContain('ef4444');
  });
});

describe('sparkline', () => {
  it('returns empty string for fewer than 2 scores', () => {
    expect(sparkline([80])).toBe('');
  });

  it('returns SVG for 2+ scores', () => {
    const html = sparkline([70, 80, 90]);
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
  });
});

describe('fillerBar', () => {
  it('renders a bar with label and count', () => {
    const html = fillerBar('um', 15, 20, 0);
    expect(html).toContain('um');
    expect(html).toContain('15');
  });
});

describe('decisionRow', () => {
  it('renders a decision with task title and recording title', () => {
    const task = { title: 'Switch to React', action: 'LOG_DECISION', payload: { decision: 'Switch to React' } };
    const recording = { id: 'rec_1', title: 'Sprint Review', date: Date.now() };
    const html = decisionRow(task, recording, false);
    expect(html).toContain('Switch to React');
    expect(html).toContain('Sprint Review');
  });

  it('shows conflict indicator when hasConflict is true', () => {
    const task = { title: 'A', action: 'LOG_DECISION', payload: { decision: 'A decision' } };
    const html = decisionRow(task, { id: 'r1', title: 'B', date: Date.now() }, true);
    expect(html).toContain('conflict');
  });
});

describe('detectConflicts', () => {
  it('returns empty set when no conflicts', () => {
    const decisions = [
      { task: { title: 'alpha beta gamma delta', payload: { decision: 'alpha beta gamma delta' } }, recording: { id: 'r1', date: 1000 } },
      { task: { title: 'epsilon zeta theta iota', payload: { decision: 'epsilon zeta theta iota' } }, recording: { id: 'r2', date: 2000 } },
    ];
    const conflicts = detectConflicts(decisions);
    expect(conflicts.size).toBe(0);
  });

  it('detects overlapping multi-word decisions as conflicts', () => {
    const decisions = [
      { task: { title: 'migrate frontend react framework typescript', payload: { decision: 'migrate frontend react framework typescript' } }, recording: { id: 'r1', date: 1000 } },
      { task: { title: 'migrate frontend react components typescript', payload: { decision: 'migrate frontend react components typescript' } }, recording: { id: 'r2', date: 2000 } },
    ];
    const conflicts = detectConflicts(decisions);
    expect(conflicts.size).toBeGreaterThan(0);
  });
});

describe('typePieDonut', () => {
  it('returns SVG donut chart for 2+ types', () => {
    const html = typePieDonut({ meeting: 5, screen: 3 }, 8);
    expect(html).toContain('<svg');
  });

  it('returns empty for single type', () => {
    const html = typePieDonut({ meeting: 5 }, 5);
    expect(html).toBe('');
  });

  it('returns empty for no data', () => {
    const html = typePieDonut({}, 0);
    expect(html).toBe('');
  });
});

describe('computeStreak', () => {
  it('returns 0 for empty date counts', () => {
    const result = computeStreak({}, new Date('2026-01-15'));
    expect(result.current).toBe(0);
  });

  it('counts consecutive days', () => {
    const counts = {
      '2026-01-15': 3,
      '2026-01-14': 2,
      '2026-01-13': 1,
    };
    const result = computeStreak(counts, new Date('2026-01-15'));
    expect(result.current).toBe(3);
    expect(result.total).toBe(3);
  });

  it('stops at gap', () => {
    const counts = {
      '2026-01-15': 1,
      '2026-01-13': 1,
    };
    const result = computeStreak(counts, new Date('2026-01-15'));
    expect(result.current).toBe(1);
  });
});

describe('busiestWeek', () => {
  it('returns empty string for insufficient data', () => {
    expect(busiestWeek({})).toBe('');
    expect(busiestWeek({ '2026-01-15': 1, '2026-01-16': 1 })).toBe('');
  });

  it('finds the week with most recordings', () => {
    const counts = {};
    // Fill 5 days in a single week
    for (let d = 12; d <= 16; d++) {
      counts[`2026-01-${d}`] = 5;
    }
    const result = busiestWeek(counts);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('25');  // Total: 5×5 = 25
  });
});
