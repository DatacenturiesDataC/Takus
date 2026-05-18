// Takus — Search Engine Tests (Phase 50)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRecordings = [
  {
    id: 'rec_1', title: 'Sprint Planning Meeting', date: Date.now() - 86400000,
    type: 'meeting', textContent: 'We discussed the roadmap and decided to prioritize the search feature.',
    aiSummary: 'Sprint planning focused on search and onboarding.',
    tasks: {
      takusTasks: [
        { id: 't1', title: 'Implement search bar', action: 'TAKUS_TASK', status: 'pending' },
        { id: 't2', title: 'Log decision about API design', action: 'LOG_DECISION', status: 'done', payload: { decision: 'Use REST over GraphQL for simplicity' } },
      ],
      meTasks: [{ id: 'm1', title: 'Review pull request', status: 'pending' }],
    },
  },
  {
    id: 'rec_2', title: 'Bug Triage Session', date: Date.now() - 172800000,
    type: 'screen', textContent: 'Found a critical memory leak in the upload pipeline.',
    aiSummary: 'Memory leak identified in blob handling during upload.',
    tasks: { takusTasks: [{ id: 't3', title: 'Fix memory leak', action: 'CREATE_BUG_REPORT', status: 'pending' }], meTasks: [] },
  },
  {
    id: 'rec_3', title: 'Design Review', date: Date.now() - 259200000,
    type: 'meeting', textContent: 'The new onboarding flow looks great. We need to finalize colors.',
    aiSummary: 'Design review for onboarding UX.',
    tasks: { takusTasks: [], meTasks: [] },
  },
];

const mockTasks = [
  { id: 't1', title: 'Implement search bar', action: 'TAKUS_TASK', status: 'pending', _contentId: 'rec_1', objective: null },
  { id: 't2', title: 'Log decision about API design', action: 'LOG_DECISION', status: 'done', _contentId: 'rec_1', objective: null, output: 'Use REST over GraphQL for simplicity' },
  { id: 'm1', title: 'Review pull request', action: 'ME_TASK', status: 'pending', _contentId: 'rec_1', objective: null },
  { id: 't3', title: 'Fix memory leak', action: 'CREATE_BUG_REPORT', status: 'pending', _contentId: 'rec_2', objective: null },
];

vi.mock('../storage.js', () => ({
  getEntries: vi.fn(() => Promise.resolve([...mockRecordings])),
}));

vi.mock('../graph/task-store.js', () => ({
  getAllTasks: vi.fn(() => Promise.resolve([...mockTasks])),
}));

import { searchRecordings, getSearchSuggestions } from '../search-engine.js';

describe('Search Engine', () => {
  describe('searchRecordings', () => {
    it('returns empty for short queries', async () => {
      expect(await searchRecordings('')).toEqual([]);
      expect(await searchRecordings('a')).toEqual([]);
    });

    it('finds entries by title', async () => {
      const results = await searchRecordings('sprint planning');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('rec_1');
      expect(results[0].matchedFields).toContain('title');
    });

    it('finds entries by transcript content', async () => {
      const results = await searchRecordings('memory leak');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('rec_2');
      expect(results[0].matchedFields).toContain('transcript');
    });

    it('finds entries by task content', async () => {
      const results = await searchRecordings('search bar');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('rec_1');
      expect(results[0].matchedFields).toContain('tasks');
    });

    it('finds entries by decision content', async () => {
      const results = await searchRecordings('REST GraphQL');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('rec_1');
      expect(results[0].matchedFields).toContain('decisions');
    });

    it('returns snippets with context', async () => {
      const results = await searchRecordings('roadmap');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].snippet).toBeTruthy();
      expect(results[0].snippet.toLowerCase()).toContain('roadmap');
    });

    it('ranks title matches higher than transcript matches', async () => {
      // "design" appears in title of rec_3 and in transcript of rec_3
      const results = await searchRecordings('design review');
      expect(results[0].id).toBe('rec_3'); // title match weighted higher
    });

    it('filters by entry type', async () => {
      const results = await searchRecordings('planning', { type: 'screen' });
      // rec_1 is a meeting, not screen — should not match
      expect(results.every(r => r.type === 'screen')).toBe(true);
    });

    it('respects result limit', async () => {
      const results = await searchRecordings('the', { limit: 1 });
      // 'the' is a stop word, so should return empty
      expect(results.length).toBe(0);
    });

    it('returns scored results sorted by relevance', async () => {
      const results = await searchRecordings('onboarding');
      // Both rec_1 (summary) and rec_3 (transcript + summary) mention onboarding
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe('getSearchSuggestions', () => {
    it('returns frequent terms from titles', async () => {
      const suggestions = await getSearchSuggestions(5);
      expect(suggestions).toBeInstanceOf(Array);
    });

    it('returns at most the requested limit', async () => {
      const suggestions = await getSearchSuggestions(1);
      expect(suggestions.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Phase 80: Edge Cases ──────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('is case insensitive', async () => {
      const results = await searchRecordings('SPRINT PLANNING');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('rec_1');
    });

    it('finds entries by summary content', async () => {
      const results = await searchRecordings('onboarding');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const matched = results.find(r => r.matchedFields.includes('summary'));
      expect(matched).toBeTruthy();
    });

    it('handles special characters in query', async () => {
      const results = await searchRecordings('sprint!@# planning');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('handles query with only stop words', async () => {
      const results = await searchRecordings('the and or');
      expect(results).toEqual([]);
    });

    it('respects explicit limit option', async () => {
      const results = await searchRecordings('sprint', { limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('returns empty for entries with no content fields', async () => {
      const results = await searchRecordings('xyznonexistent');
      expect(results).toEqual([]);
    });
  });
});
