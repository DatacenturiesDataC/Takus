// Takus — Search Engine (Knowledge OS)
// Full-text search across entry transcripts, summaries, and tasks.
// Pure client-side — no network calls. Uses normalized token matching.

import { getEntries } from './storage.js';

/**
 * Search entries by query string.
 * Searches across: title, transcript, summary, task titles, decision text.
 * Returns ranked results with highlighted snippets.
 *
 * @param {string} query - Search query
 * @param {object} [options]
 * @param {number} [options.limit=20] - Maximum results to return
 * @param {string} [options.type] - Filter by content type
 * @returns {Promise<SearchResult[]>}
 */
export async function searchContent(query, options = {}) {
  if (!query || query.trim().length < 2) return [];

  const { limit = 20, type } = options;
  const tokens = _tokenize(query);
  if (!tokens.length) return [];

  let entries = await getEntries().catch(() => []);
  if (type) entries = entries.filter(r => r.type === type);

  // Load task data from graph nodes (indexed by entry ID for fast lookup)
  const tasksByEntry = new Map();
  try {
    const { getAllTasks } = await import('./graph/task-store.js');
    const allTasks = await getAllTasks();
    for (const t of allTasks) {
      const entryId = t._contentId;
      if (!entryId) continue;
      if (!tasksByEntry.has(entryId)) tasksByEntry.set(entryId, []);
      tasksByEntry.get(entryId).push(t);
    }
  } catch { /* task store unavailable — search proceeds without task text */ }

  const results = [];

  for (const entry of entries) {
    const entryTasks = tasksByEntry.get(entry.id) || [];
    const fields = _extractSearchableFields(entry, entryTasks);
    const score = _scoreMatch(tokens, fields);
    if (score <= 0) continue;

    const snippet = _extractSnippet(tokens, fields);
    results.push({
      id: entry.id,
      title: entry.title || 'Untitled',
      type: entry.type || 'screen',
      date: entry.date,
      score,
      snippet,
      matchedFields: _getMatchedFields(tokens, fields),
    });
  }

  // Sort by relevance score descending, then by date descending
  results.sort((a, b) => b.score - a.score || b.date - a.date);
  return results.slice(0, limit);
}

/**
 * Get search suggestions based on existing entry content.
 * Returns frequently occurring terms that can serve as quick filters.
 *
 * @param {number} [limit=8]
 * @returns {Promise<string[]>}
 */
export async function getSearchSuggestions(limit = 8) {
  const entries = await getEntries().catch(() => []);
  const termCounts = {};

  for (const entry of entries) {
    const title = entry.title || '';
    const words = title.split(/\s+/).filter(w => w.length >= 4);
    for (const w of words) {
      const normalized = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalized.length >= 4 && !STOP_WORDS.has(normalized)) {
        termCounts[normalized] = (termCounts[normalized] || 0) + 1;
      }
    }
  }

  return Object.entries(termCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}

// ── Private Helpers ──────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'to', 'is', 'it', 'in', 'on', 'at', 'of', 'for', 'and',
  'or', 'but', 'we', 'you', 'they', 'will', 'was', 'that', 'this', 'with',
  'be', 'have', 'do', 'not', 'are', 'has', 'our', 'their', 'its', 'were',
  'been', 'from', 'about', 'which', 'when', 'what', 'there', 'then', 'than',
  'just', 'also', 'more', 'some', 'very', 'like', 'would', 'could', 'should',
]);

function _tokenize(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

function _extractSearchableFields(entry, tasks = []) {
  const fields = {};
  fields.title = entry.title || '';
  fields.transcript = entry.textContent || '';
  fields.summary = entry.aiSummary || '';

  // Task titles from graph nodes
  const taskTexts = [];
  const decisionTexts = [];
  for (const t of tasks) {
    taskTexts.push(t.title || '');
    if (t.objective) taskTexts.push(t.objective);
    if (t.action === 'LOG_DECISION' && t.output) {
      decisionTexts.push(t.output);
    }
  }
  fields.tasks = taskTexts.join(' ');
  fields.decisions = decisionTexts.join(' ');

  return fields;
}

/** Score how well tokens match the searchable fields (title weighted highest) */
function _scoreMatch(tokens, fields) {
  const WEIGHTS = { title: 10, decisions: 5, tasks: 4, summary: 3, transcript: 1 };
  let score = 0;

  for (const [fieldName, text] of Object.entries(fields)) {
    if (!text) continue;
    const lower = text.toLowerCase();
    const weight = WEIGHTS[fieldName] || 1;
    for (const token of tokens) {
      // Count occurrences
      let idx = 0, count = 0;
      while ((idx = lower.indexOf(token, idx)) !== -1) {
        count++;
        idx += token.length;
      }
      score += count * weight;
    }
  }

  return score;
}

/** Extract a snippet around the first match */
function _extractSnippet(tokens, fields) {
  // Prefer transcript > summary > tasks for snippets
  const sources = ['transcript', 'summary', 'tasks', 'decisions', 'title'];
  for (const source of sources) {
    const text = fields[source];
    if (!text) continue;
    const lower = text.toLowerCase();

    for (const token of tokens) {
      const idx = lower.indexOf(token);
      if (idx === -1) continue;

      // Extract ~120 chars around the match
      const start = Math.max(0, idx - 50);
      const end = Math.min(text.length, idx + token.length + 70);
      let snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
      return snippet.trim();
    }
  }

  return '';
}

/** Determine which fields matched */
function _getMatchedFields(tokens, fields) {
  const matched = [];
  for (const [fieldName, text] of Object.entries(fields)) {
    if (!text) continue;
    const lower = text.toLowerCase();
    if (tokens.some(t => lower.includes(t))) {
      matched.push(fieldName);
    }
  }
  return matched;
}
