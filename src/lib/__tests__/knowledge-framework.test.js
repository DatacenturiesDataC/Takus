// Takus — Knowledge Framework Tests
import { describe, it, expect } from 'vitest';
import { classifyInsight, classifySummaryInsights, computeAssumptionRisk, buildReasoningChain } from '../knowledge-framework.js';

// ── classifyInsight ──────────────────────────────────────────────────────────

describe('classifyInsight', () => {
  it('classifies decisions from keywords', () => {
    const result = classifyInsight('We decided to use PostgreSQL for the backend');
    expect(result.type).toBe('decision');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies decisions from section context', () => {
    const result = classifyInsight('Use React for the frontend', 'Key Decisions');
    expect(result.type).toBe('decision');
    expect(result.confidence).toBeGreaterThanOrEqual(0.4);
  });

  it('classifies assumptions from keywords', () => {
    const result = classifyInsight('We assume the API will handle 1000 requests per second');
    expect(result.type).toBe('assumption');
  });

  it('classifies open questions from keywords', () => {
    const result = classifyInsight('Need to clarify the deployment timeline — TBD');
    expect(result.type).toBe('open_question');
  });

  it('classifies facts from keywords', () => {
    const result = classifyInsight('Data shows a 15% increase in conversion rate');
    expect(result.type).toBe('fact');
  });

  it('classifies reasoning from keywords', () => {
    const result = classifyInsight('Because the deadline is tight, therefore we need to reduce scope');
    expect(result.type).toBe('reasoning');
  });

  it('defaults to fact with low confidence for ambiguous text', () => {
    const result = classifyInsight('The meeting ended at 3pm');
    expect(result.type).toBe('fact');
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });

  it('handles empty/null input gracefully', () => {
    expect(classifyInsight('').confidence).toBe(0);
    expect(classifyInsight(null).confidence).toBe(0);
  });

  it('includes entry reference in evidence', () => {
    const result = classifyInsight('We decided to go ahead', '', { contentId: 'rec-123' });
    expect(result.evidence).toContain('entry:rec-123');
  });
});

// ── classifySummaryInsights ──────────────────────────────────────────────────

describe('classifySummaryInsights', () => {
  it('parses markdown sections and classifies bullet points', () => {
    const md = `## Key Decisions
- We agreed to launch on Monday
- Selected the blue design variant

## Dissent & Open Questions
- Unresolved: need to clarify budget constraints
`;
    const insights = classifySummaryInsights(md, 'rec-1');
    expect(insights.length).toBe(3);
    expect(insights.filter(i => i.type === 'decision').length).toBeGreaterThanOrEqual(1);
    expect(insights.filter(i => i.type === 'open_question').length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for empty summary', () => {
    expect(classifySummaryInsights('')).toEqual([]);
    expect(classifySummaryInsights(null)).toEqual([]);
  });
});

// ── computeAssumptionRisk ────────────────────────────────────────────────────

describe('computeAssumptionRisk', () => {
  it('returns low risk when no assumptions', () => {
    const result = computeAssumptionRisk([
      { type: 'fact', text: 'x', confidence: 0.8, evidence: [], source: '' },
    ]);
    expect(result.riskLevel).toBe('low');
    expect(result.score).toBe(0);
  });

  it('returns higher risk when assumptions outnumber facts', () => {
    const insights = [
      { type: 'assumption', text: 'a', confidence: 0.7, evidence: [], source: '' },
      { type: 'assumption', text: 'b', confidence: 0.7, evidence: [], source: '' },
      { type: 'fact', text: 'c', confidence: 0.8, evidence: [], source: '' },
    ];
    const result = computeAssumptionRisk(insights);
    expect(result.score).toBeGreaterThan(0);
    expect(['medium', 'high']).toContain(result.riskLevel);
  });

  it('includes summary details', () => {
    const result = computeAssumptionRisk([
      { type: 'assumption', text: 'a', confidence: 0.5, evidence: [], source: '' },
      { type: 'decision', text: 'b', confidence: 0.9, evidence: [], source: '' },
    ]);
    expect(result.details).toContain('1 assumption(s)');
    expect(result.details).toContain('1 decision(s)');
  });
});

// ── buildReasoningChain ──────────────────────────────────────────────────────

describe('buildReasoningChain', () => {
  it('links decisions to supporting facts', () => {
    const insights = [
      { type: 'decision', text: 'We chose PostgreSQL for the database layer', confidence: 0.9, evidence: [], source: '' },
      { type: 'fact', text: 'PostgreSQL supports JSON columns and full-text search in the database', confidence: 0.8, evidence: [], source: '' },
      { type: 'fact', text: 'Revenue grew 10% last quarter', confidence: 0.8, evidence: [], source: '' },
    ];
    const chains = buildReasoningChain(insights);
    expect(chains).toHaveLength(1);
    expect(chains[0].supportedBy.length).toBeGreaterThanOrEqual(1);
    expect(chains[0].gapCount).toBe(0);
  });

  it('flags decisions without supporting evidence', () => {
    const insights = [
      { type: 'decision', text: 'We chose Vue.js for the frontend framework', confidence: 0.9, evidence: [], source: '' },
      { type: 'fact', text: 'Revenue grew 10% last quarter', confidence: 0.8, evidence: [], source: '' },
    ];
    const chains = buildReasoningChain(insights);
    expect(chains[0].gapCount).toBe(1);
    expect(chains[0].supportedBy).toHaveLength(0);
  });

  it('returns empty array when no decisions', () => {
    const insights = [
      { type: 'fact', text: 'Some fact', confidence: 0.8, evidence: [], source: '' },
    ];
    expect(buildReasoningChain(insights)).toHaveLength(0);
  });
});
