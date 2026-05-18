// Takus — Knowledge Management Framework
// Classifies information extracted from entries into structured types
// (facts, decisions, assumptions, open questions, reasoning) and provides
// risk analysis for unverified assumptions.
//
// Pure-computation module — no IDB, no DOM, no side effects.

/**
 * @typedef {'fact'|'decision'|'assumption'|'open_question'|'reasoning'} InsightType
 */

/**
 * @typedef {object} ClassifiedInsight
 * @property {InsightType} type
 * @property {string} text         The insight text
 * @property {number} confidence   0–1 confidence in the classification
 * @property {string[]} evidence   Supporting evidence references
 * @property {string} source       Where this came from (e.g. 'summary', 'dissent', 'transcript')
 */

// ── Classification Rules ────────────────────────────────────────────────────

/** Keywords and patterns that indicate each insight type */
const PATTERNS = {
  decision: {
    keywords: ['decided', 'agreed', 'approved', 'committed', 'will do', 'go ahead', 'let\'s go with', 'selected', 'chosen', 'signed off'],
    sections: ['Key Decisions', 'Decision Ledger', 'Decisions'],
    weight: 0.85,
  },
  assumption: {
    keywords: ['assume', 'assuming', 'presumably', 'probably', 'likely', 'should be', 'i think', 'i believe', 'expected to', 'supposed to'],
    sections: ['Dissent', 'Open Questions', 'Assumptions'],
    weight: 0.70,
  },
  open_question: {
    keywords: ['unresolved', 'need to clarify', 'follow up', 'tbd', 'to be determined', 'open question', 'not addressed', 'deferred', 'parking lot'],
    sections: ['Dissent & Open Questions', 'Open Questions', 'Follow-ups'],
    weight: 0.80,
  },
  fact: {
    keywords: ['reported', 'measured', 'confirmed', 'verified', 'data shows', 'statistics', 'according to', 'completed', 'delivered'],
    sections: ['Summary', 'Key Points'],
    weight: 0.75,
  },
  reasoning: {
    keywords: ['because', 'therefore', 'since', 'given that', 'in order to', 'so that', 'as a result', 'leads to', 'implies'],
    sections: [],
    weight: 0.60,
  },
};

/**
 * Classify a text insight into a structured type.
 *
 * Uses heuristic rules based on keyword matching and section context.
 * No AI calls — fast, deterministic, and works offline.
 *
 * @param {string} text      The insight text to classify
 * @param {string} [source]  Source section (e.g. 'Key Decisions', 'Dissent & Open Questions')
 * @param {object} [context] Optional context: { contentId, participants }
 * @returns {ClassifiedInsight}
 */
export function classifyInsight(text, source = '', context = {}) {
  if (!text || typeof text !== 'string') {
    return { type: 'fact', text: text || '', confidence: 0, evidence: [], source };
  }

  const lower = text.toLowerCase().trim();
  const scores = {};

  for (const [type, config] of Object.entries(PATTERNS)) {
    let score = 0;

    // Keyword matching (partial scores accumulate)
    const keywordHits = config.keywords.filter(kw => lower.includes(kw));
    if (keywordHits.length > 0) {
      score += Math.min(config.weight, keywordHits.length * 0.25);
    }

    // Section matching (high-confidence boost)
    if (source && config.sections.some(s => source.toLowerCase().includes(s.toLowerCase()))) {
      score += 0.40;
    }

    scores[type] = Math.min(1.0, score);
  }

  // Pick the highest-scoring type
  const entries = Object.entries(scores);
  entries.sort((a, b) => b[1] - a[1]);

  const [bestType, bestScore] = entries[0];

  // If no strong signal, default to 'fact' with low confidence
  if (bestScore < 0.15) {
    return { type: 'fact', text, confidence: 0.3, evidence: [], source };
  }

  return {
    type: /** @type {InsightType} */ (bestType),
    text,
    confidence: Math.round(bestScore * 100) / 100,
    evidence: context.contentId ? [`entry:${context.contentId}`] : [],
    source,
  };
}

/**
 * Classify all bullet points from an AI summary into structured insights.
 *
 * Parses markdown sections and runs classifyInsight on each bullet.
 *
 * @param {string} summaryMarkdown  Full AI summary markdown
 * @param {string} [contentId]    Associated entry ID
 * @returns {ClassifiedInsight[]}
 */
export function classifySummaryInsights(summaryMarkdown, contentId) {
  if (!summaryMarkdown) return [];

  const insights = [];
  let currentSection = '';

  for (const line of summaryMarkdown.split('\n')) {
    const trimmed = line.trim();

    // Detect section headers
    const headerMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      currentSection = headerMatch[1].trim();
      continue;
    }

    // Detect bullet points or table rows
    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)/);
    const tableMatch = trimmed.match(/^\|(.+)\|$/);
    const content = bulletMatch?.[1] || (tableMatch ? tableMatch[1].split('|').map(c => c.trim()).filter(Boolean).join(' — ') : null);

    if (content && content.length > 5) {
      insights.push(classifyInsight(content, currentSection, { contentId }));
    }
  }

  return insights;
}

/**
 * Compute a risk score for unverified assumptions.
 *
 * Higher risk = more assumptions relative to verified facts,
 * especially when assumptions underpin decisions.
 *
 * @param {ClassifiedInsight[]} insights  All classified insights
 * @returns {{ score: number, riskLevel: 'low'|'medium'|'high', details: string }}
 */
export function computeAssumptionRisk(insights) {
  const assumptions = insights.filter(i => i.type === 'assumption');
  const facts = insights.filter(i => i.type === 'fact');
  const decisions = insights.filter(i => i.type === 'decision');
  const openQuestions = insights.filter(i => i.type === 'open_question');

  if (assumptions.length === 0) {
    return { score: 0, riskLevel: 'low', details: 'No unverified assumptions detected' };
  }

  // Risk factors
  let score = 0;

  // Ratio of assumptions to facts (high ratio = high risk)
  const ratio = facts.length > 0 ? assumptions.length / facts.length : assumptions.length;
  score += Math.min(40, ratio * 20);

  // Decisions without supporting facts (risky)
  const unsupportedDecisions = decisions.length > 0 && facts.length < decisions.length;
  if (unsupportedDecisions) score += 20;

  // Many open questions compound risk
  score += Math.min(20, openQuestions.length * 5);

  // High-confidence assumptions are more concerning
  const highConfAssumptions = assumptions.filter(a => a.confidence >= 0.6);
  score += Math.min(20, highConfAssumptions.length * 8);

  score = Math.min(100, Math.round(score));

  const riskLevel = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  const details = `${assumptions.length} assumption(s), ${facts.length} fact(s), ${decisions.length} decision(s), ${openQuestions.length} open question(s)`;

  return { score, riskLevel, details };
}

/**
 * Build a reasoning chain linking decisions to their supporting evidence.
 *
 * @param {ClassifiedInsight[]} insights  All classified insights
 * @returns {Array<{ decision: string, supportedBy: string[], gapCount: number }>}
 */
export function buildReasoningChain(insights) {
  const decisions = insights.filter(i => i.type === 'decision');
  const facts = insights.filter(i => i.type === 'fact');
  const reasoning = insights.filter(i => i.type === 'reasoning');

  return decisions.map(d => {
    const dLower = d.text.toLowerCase();

    // Find facts and reasoning that might support this decision
    const supporting = [...facts, ...reasoning].filter(f => {
      const fLower = f.text.toLowerCase();
      // Simple word overlap heuristic
      const dWords = new Set(dLower.split(/\W+/).filter(w => w.length > 3));
      const fWords = fLower.split(/\W+/).filter(w => w.length > 3);
      const overlap = fWords.filter(w => dWords.has(w)).length;
      return overlap >= 2;
    });

    return {
      decision: d.text,
      supportedBy: supporting.map(s => s.text),
      gapCount: supporting.length === 0 ? 1 : 0,
    };
  });
}
