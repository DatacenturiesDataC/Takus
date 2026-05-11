// Takus — Recording Analytics (Phase 4: Specialist Agents)
// Pure browser-side analysis of transcripts and AI summaries.
// No network calls — all computation is local.

// ── Filler-word analysis ──────────────────────────────────────────────────────

const FILLER_PATTERNS = [
  /\bum+\b/gi,
  /\buh+\b/gi,
  /\blike\b/gi,
  /\byou know\b/gi,
  /\bbasically\b/gi,
  /\bactually\b/gi,
  /\bliterally\b/gi,
  /\bright\?/gi,
  /\bso+\b/gi,
  /\bi mean\b/gi,
  /\bkind of\b/gi,
  /\bsort of\b/gi,
];

const FILLER_LABELS = [
  'um', 'uh', 'like', 'you know', 'basically', 'actually',
  'literally', 'right?', 'so', 'I mean', 'kind of', 'sort of',
];

/**
 * Count filler words in a transcript.
 * @param {string} transcript
 * @param {number} durationMs  recording duration in milliseconds
 * @returns {{
 *   total: number,
 *   perMinute: number,
 *   breakdown: { label:string, count:number }[],
 *   rating: 'excellent'|'good'|'fair'|'needs_work'
 * }}
 */
export function analyzeFillerWords(transcript, durationMs = 0) {
  if (!transcript) return { total: 0, perMinute: 0, breakdown: [], rating: 'excellent' };

  const breakdown = FILLER_PATTERNS.map((re, i) => ({
    label: FILLER_LABELS[i],
    count: (transcript.match(re) || []).length,
  })).filter(f => f.count > 0);

  const total      = breakdown.reduce((s, f) => s + f.count, 0);
  const minutes    = durationMs > 0 ? durationMs / 60000 : transcript.length / 600;
  const perMinute  = minutes > 0 ? Math.round((total / minutes) * 10) / 10 : 0;

  const rating =
    perMinute < 3  ? 'excellent' :
    perMinute < 8  ? 'good'      :
    perMinute < 15 ? 'fair'      : 'needs_work';

  return { total, perMinute, breakdown: breakdown.slice(0, 5), rating };
}

// ── Quality score ─────────────────────────────────────────────────────────────

/**
 * Compute a 0–100 quality score for a recording based on:
 * - Action density (tasks extracted per minute)
 * - Decision count (from AI summary)
 * - Filler word density (lower is better)
 * - Has AI summary
 * @param {{ duration:number, tasks:object, aiSummary:string, aiTranscript:string }} recording
 * @returns {{ score:number, label:string, color:string }}
 */
export function computeQualityScore(recording) {
  let score = 50; // baseline

  const minutes = (recording.duration || 0) / 60000 || 1;

  // +20 if AI summary exists
  if (recording.aiSummary) score += 20;

  // +15 for task density (up to 5 tasks/min = full points)
  const tasks = recording.tasks;
  const taskCount = (tasks?.takusTasks?.length || 0) + (tasks?.meTasks?.length || 0);
  score += Math.min(15, Math.round((taskCount / minutes) * 5));

  // +10 for decisions mentioned in summary
  const decisionMatches = (recording.aiSummary || '').match(/\bdecid|agreed|confirmed|resolved\b/gi) || [];
  score += Math.min(10, decisionMatches.length * 3);

  // −20 penalty for high filler word density
  const filler = analyzeFillerWords(recording.aiTranscript || '', recording.duration);
  if (filler.rating === 'needs_work') score -= 20;
  else if (filler.rating === 'fair')  score -= 10;
  else if (filler.rating === 'good')  score -= 3;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const label = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Needs work';
  const color =
    score >= 85 ? 'var(--color-success)' :
    score >= 70 ? '#10b981' :
    score >= 50 ? '#f59e0b' : '#ef4444';

  return { score, label, color };
}

// ── TL;DW extraction ──────────────────────────────────────────────────────────

/**
 * Extract up to 3 top-level bullet points from an AI summary for the TL;DW preview.
 * Prefers bullets from the first section (Summary / TL;DR).
 * @param {string} aiSummary
 * @returns {string[]}  up to 3 plain-text bullet strings
 */
export function extractTLDW(aiSummary) {
  if (!aiSummary) return [];
  const bullets = [];

  for (const line of aiSummary.split('\n')) {
    const m = line.match(/^[*\-–]\s+(.+)/);
    if (m) {
      bullets.push(m[1].replace(/\*\*/g, '').trim());
      if (bullets.length === 3) break;
    }
  }

  // Fallback: first 3 non-empty, non-heading lines
  if (!bullets.length) {
    for (const line of aiSummary.split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#') && !t.startsWith('|') && t.length > 20) {
        bullets.push(t.replace(/\*\*/g, '').slice(0, 120));
        if (bullets.length === 3) break;
      }
    }
  }

  return bullets;
}

// ── Chapter parsing ───────────────────────────────────────────────────────────

/**
 * Parse a Chapter List from the AI summary of a presentation recording.
 * Matches patterns like:
 *   "1. [~00:02] Introduction"
 *   "2. [~05:30] Deep dive into..."
 *   "3. Introduction (~02:00)"
 * @param {string} aiSummary
 * @returns {Array<{title:string, seconds:number}>}
 */
export function parseChapters(aiSummary) {
  if (!aiSummary) return [];
  const chapters = [];

  // Pattern 1: [~HH:MM] or [~MM:SS]
  const re1 = /^\d+\.\s+\[~?(\d+):(\d+)\]\s+(.+)/gm;
  let m;
  while ((m = re1.exec(aiSummary)) !== null) {
    const mins = parseInt(m[1], 10);
    const secs = parseInt(m[2], 10);
    chapters.push({ title: m[3].trim().replace(/\*\*/g, ''), seconds: mins * 60 + secs });
  }

  // Pattern 2: (~MM:SS) at end of line
  if (!chapters.length) {
    const re2 = /^\d+\.\s+(.+?)\s+\(~?(\d+):(\d+)\)/gm;
    while ((m = re2.exec(aiSummary)) !== null) {
      const mins = parseInt(m[2], 10);
      const secs = parseInt(m[3], 10);
      chapters.push({ title: m[1].trim().replace(/\*\*/g, ''), seconds: mins * 60 + secs });
    }
  }

  return chapters;
}

// ── Urgency detection ─────────────────────────────────────────────────────────

const URGENCY_PATTERNS = [
  /\bblocked?\b/gi,
  /\bcritical\b/gi,
  /\burgent\b/gi,
  /\bescalat/gi,
  /\bshow[- ]stopper\b/gi,
  /\bP0\b/g,
  /\bblocker\b/gi,
];

/**
 * Returns true if the recording signals urgency that warrants an auto-post to Slack.
 * Only applies to 'update' type recordings.
 * @param {{ type:string, tasks:object, aiSummary:string }} recording
 * @returns {boolean}
 */
export function isUrgentUpdate(recording) {
  if (recording.type !== 'update') return false;

  // High-urgency me-task
  const hasUrgentTask = (recording.tasks?.meTasks || []).some(t => t.urgency === 'high');
  if (hasUrgentTask) return true;

  // Urgency keyword in summary
  const text = recording.aiSummary || '';
  return URGENCY_PATTERNS.some(re => re.test(text));
}

/**
 * Build a formatted Slack message for an urgent update auto-post.
 * @param {{ title:string, aiSummary:string, driveLink:string, tasks:object }} recording
 * @returns {{ text:string, blocks:object[] }}
 */
export function buildUrgentUpdateSlackPayload(recording) {
  const tldw  = extractTLDW(recording.aiSummary);
  const bullets = tldw.length
    ? tldw.map(b => `• ${b}`).join('\n')
    : recording.title;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🚨 *Urgent update: ${recording.title}*\n\n${bullets}`,
      },
    },
  ];

  const blockers = (recording.tasks?.meTasks || [])
    .filter(t => t.urgency === 'high')
    .map(t => `• ${t.note}`)
    .join('\n');

  if (blockers) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Blockers*\n${blockers}` },
    });
  }

  if (recording.driveLink) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Watch recording' },
        url: recording.driveLink,
      }],
    });
  }

  return { text: `Urgent update: ${recording.title}`, blocks };
}
