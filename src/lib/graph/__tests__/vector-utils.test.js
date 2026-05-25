// Takus — Vector Utils Tests
import { describe, it, expect } from 'vitest';

import { meanVector, averageEmbedding } from '../vector-utils.js';

describe('Vector Utils', () => {
  // ── meanVector ────────────────────────────────────────────────────────────

  describe('meanVector', () => {
    it('computes mean of a single chunk', () => {
      const result = meanVector([{ embedding: [2, 4, 6] }]);
      expect(result).toBeInstanceOf(Float32Array);
      expect(Array.from(result)).toEqual([2, 4, 6]);
    });

    it('computes mean of multiple chunks', () => {
      const result = meanVector([
        { embedding: [1, 2, 3] },
        { embedding: [3, 4, 5] },
      ]);
      expect(Array.from(result)).toEqual([2, 3, 4]);
    });

    it('returns null for empty array', () => {
      expect(meanVector([])).toBeNull();
    });

    it('returns null when no chunks have valid embeddings', () => {
      expect(meanVector([{ embedding: [] }, { embedding: null }])).toBeNull();
      expect(meanVector([{}, { text: 'no embedding' }])).toBeNull();
    });

    it('filters out chunks without valid embeddings', () => {
      const result = meanVector([
        { embedding: [10, 20] },
        { embedding: [] },           // invalid — empty
        { embedding: null },          // invalid — null
        {},                           // invalid — missing
        { embedding: [30, 40] },
      ]);
      // Mean of [10,20] and [30,40] = [20, 30]
      expect(Array.from(result)).toEqual([20, 30]);
    });

    it('returns Float32Array', () => {
      const result = meanVector([{ embedding: [1.5, 2.5] }]);
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('handles high-dimensional vectors', () => {
      const dim = 384;
      const vec1 = new Array(dim).fill(1);
      const vec2 = new Array(dim).fill(3);
      const result = meanVector([{ embedding: vec1 }, { embedding: vec2 }]);
      expect(result.length).toBe(dim);
      expect(result[0]).toBeCloseTo(2);
      expect(result[dim - 1]).toBeCloseTo(2);
    });

    it('handles floating-point values correctly', () => {
      const result = meanVector([
        { embedding: [0.1, 0.2, 0.3] },
        { embedding: [0.3, 0.4, 0.5] },
        { embedding: [0.5, 0.6, 0.7] },
      ]);
      expect(result[0]).toBeCloseTo(0.3);
      expect(result[1]).toBeCloseTo(0.4);
      expect(result[2]).toBeCloseTo(0.5);
    });
  });

  // ── averageEmbedding ──────────────────────────────────────────────────────

  describe('averageEmbedding', () => {
    it('computes average of a single chunk', () => {
      const result = averageEmbedding([{ embedding: [2, 4, 6] }]);
      expect(result).toEqual([2, 4, 6]);
    });

    it('computes average of multiple chunks', () => {
      const result = averageEmbedding([
        { embedding: [1, 2, 3] },
        { embedding: [3, 4, 5] },
      ]);
      expect(result).toEqual([2, 3, 4]);
    });

    it('returns null for empty array', () => {
      expect(averageEmbedding([])).toBeNull();
    });

    it('returns null when no chunks have valid embeddings', () => {
      expect(averageEmbedding([{ embedding: [] }, {}])).toBeNull();
    });

    it('filters out chunks without valid embeddings', () => {
      const result = averageEmbedding([
        { embedding: [10, 20] },
        { embedding: [] },
        { embedding: null },
        {},
        { embedding: [30, 40] },
      ]);
      expect(result).toEqual([20, 30]);
    });

    it('returns a plain Array (not Float32Array)', () => {
      const result = averageEmbedding([{ embedding: [1, 2] }]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).not.toBeInstanceOf(Float32Array);
    });

    it('handles high-dimensional vectors', () => {
      const dim = 384;
      const vec1 = new Array(dim).fill(2);
      const vec2 = new Array(dim).fill(4);
      const result = averageEmbedding([{ embedding: vec1 }, { embedding: vec2 }]);
      expect(result.length).toBe(dim);
      expect(result[0]).toBe(3);
      expect(result[dim - 1]).toBe(3);
    });

    it('handles floating-point precision', () => {
      const result = averageEmbedding([
        { embedding: [0.1, 0.2] },
        { embedding: [0.2, 0.4] },
      ]);
      expect(result[0]).toBeCloseTo(0.15);
      expect(result[1]).toBeCloseTo(0.3);
    });
  });

  // ── Cross-function consistency ────────────────────────────────────────────

  describe('meanVector vs averageEmbedding consistency', () => {
    it('produces equivalent values for the same input', () => {
      const chunks = [
        { embedding: [1, 2, 3, 4] },
        { embedding: [5, 6, 7, 8] },
        { embedding: [9, 10, 11, 12] },
      ];

      const mean = meanVector(chunks);
      const avg = averageEmbedding(chunks);

      expect(mean.length).toBe(avg.length);
      for (let i = 0; i < mean.length; i++) {
        expect(mean[i]).toBeCloseTo(avg[i]);
      }
    });

    it('both return null for identical invalid input', () => {
      const invalid = [{ embedding: [] }, {}];
      expect(meanVector(invalid)).toBeNull();
      expect(averageEmbedding(invalid)).toBeNull();
    });
  });
});
