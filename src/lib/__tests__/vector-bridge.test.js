// Tests for vector-bridge.js — the Web Worker bridge for vector math
// Tests the fallback (main-thread) path since Workers aren't available in vitest.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The vector-bridge module will fall back to main-thread computation
// when Worker is not available (vitest environment).
// We test the exported functions to ensure correct behavior.

describe('vector-bridge (fallback path)', () => {
  let batchSimilarity, meanVector, rankChunks;

  beforeEach(async () => {
    const mod = await import('../vector-bridge.js');
    batchSimilarity = mod.batchSimilarity;
    meanVector = mod.meanVector;
    rankChunks = mod.rankChunks;
  });

  describe('batchSimilarity', () => {
    it('returns matching candidates above threshold', async () => {
      const target = [1, 0, 0];
      const candidates = [
        { id: 'a', embedding: [1, 0, 0] },     // similarity = 1.0
        { id: 'b', embedding: [0, 1, 0] },     // similarity = 0.0
        { id: 'c', embedding: [0.8, 0.6, 0] }, // similarity ≈ 0.8
      ];

      const results = await batchSimilarity(target, candidates, 0.5);
      expect(results.length).toBe(2);
      expect(results[0].id).toBe('a');
      expect(results[0].score).toBeCloseTo(1.0, 5);
      expect(results[1].id).toBe('c');
    });

    it('returns empty for no matches above threshold', async () => {
      const target = [1, 0, 0];
      const candidates = [
        { id: 'a', embedding: [0, 1, 0] },
        { id: 'b', embedding: [0, 0, 1] },
      ];

      const results = await batchSimilarity(target, candidates, 0.5);
      expect(results).toEqual([]);
    });

    it('handles empty candidates', async () => {
      const results = await batchSimilarity([1, 0], [], 0.5);
      expect(results).toEqual([]);
    });

    it('results are sorted by score descending', async () => {
      const target = [1, 0, 0];
      const candidates = [
        { id: 'low', embedding: [0.7, 0.7, 0] },
        { id: 'high', embedding: [1, 0, 0] },
        { id: 'mid', embedding: [0.9, 0.4, 0] },
      ];

      const results = await batchSimilarity(target, candidates, 0.0);
      expect(results[0].id).toBe('high');
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[1].score).toBeGreaterThan(results[2].score);
    });
  });

  describe('meanVector', () => {
    it('returns empty for empty input', async () => {
      const result = await meanVector([]);
      expect(result).toEqual([]);
    });

    it('returns the vector itself for single input', async () => {
      const result = await meanVector([[3, 6, 9]]);
      expect(result[0]).toBeCloseTo(3, 5);
      expect(result[1]).toBeCloseTo(6, 5);
      expect(result[2]).toBeCloseTo(9, 5);
    });

    it('computes correct mean of multiple vectors', async () => {
      const result = await meanVector([
        [2, 4, 6],
        [4, 6, 8],
      ]);
      expect(result[0]).toBeCloseTo(3, 5);
      expect(result[1]).toBeCloseTo(5, 5);
      expect(result[2]).toBeCloseTo(7, 5);
    });

    it('handles zero vectors', async () => {
      const result = await meanVector([
        [0, 0, 0],
        [0, 0, 0],
      ]);
      expect(result).toEqual([0, 0, 0]);
    });
  });

  describe('rankChunks', () => {
    it('ranks chunks by cosine similarity', async () => {
      const queryVec = [1, 0, 0];
      const chunks = [
        { contentId: 'c1', chunkIdx: 0, text: 'low', embedding: [0, 1, 0] },
        { contentId: 'c2', chunkIdx: 0, text: 'high', embedding: [1, 0, 0] },
        { contentId: 'c3', chunkIdx: 0, text: 'mid', embedding: [0.7, 0.7, 0] },
      ];

      const results = await rankChunks(queryVec, chunks, 2);
      expect(results.length).toBe(2);
      expect(results[0].text).toBe('high');
      expect(results[0].score).toBeCloseTo(1.0, 5);
    });

    it('respects topK limit', async () => {
      const queryVec = [1, 0];
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        contentId: `c${i}`,
        chunkIdx: 0,
        text: `chunk-${i}`,
        embedding: [Math.random(), Math.random()],
      }));

      const results = await rankChunks(queryVec, chunks, 3);
      expect(results.length).toBe(3);
    });

    it('skips chunks without embeddings', async () => {
      const queryVec = [1, 0];
      const chunks = [
        { contentId: 'c1', chunkIdx: 0, text: 'good', embedding: [1, 0] },
        { contentId: 'c2', chunkIdx: 0, text: 'empty', embedding: [] },
        { contentId: 'c3', chunkIdx: 0, text: 'null', embedding: null },
      ];

      const results = await rankChunks(queryVec, chunks, 5);
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('good');
    });

    it('returns empty for empty chunks', async () => {
      const results = await rankChunks([1, 0], [], 5);
      expect(results).toEqual([]);
    });
  });
});
