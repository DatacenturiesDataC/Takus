// Takus — Vector Utils Tests
import { describe, it, expect } from 'vitest';
import { meanVector, averageEmbedding } from '../graph/vector-utils.js';

describe('Vector Utils', () => {
  describe('meanVector', () => {
    it('computes mean of multiple chunk embeddings', () => {
      const chunks = [
        { embedding: [2, 4, 6] },
        { embedding: [4, 6, 8] },
      ];
      const result = meanVector(chunks);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result[0]).toBeCloseTo(3);
      expect(result[1]).toBeCloseTo(5);
      expect(result[2]).toBeCloseTo(7);
    });

    it('returns Float32Array', () => {
      const result = meanVector([{ embedding: [1, 2, 3] }]);
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('returns null for empty chunks', () => {
      expect(meanVector([])).toBeNull();
    });

    it('returns null for chunks without embeddings', () => {
      expect(meanVector([{ embedding: [] }, { text: 'no embedding' }])).toBeNull();
    });

    it('skips chunks with missing embedding', () => {
      const chunks = [
        { embedding: [2, 4] },
        { text: 'no embedding' },
        { embedding: [6, 8] },
      ];
      const result = meanVector(chunks);
      expect(result[0]).toBeCloseTo(4);
      expect(result[1]).toBeCloseTo(6);
    });

    it('handles single chunk', () => {
      const result = meanVector([{ embedding: [5, 10, 15] }]);
      expect(result[0]).toBeCloseTo(5);
      expect(result[1]).toBeCloseTo(10);
      expect(result[2]).toBeCloseTo(15);
    });
  });

  describe('averageEmbedding', () => {
    it('computes average of multiple chunk embeddings', () => {
      const chunks = [
        { embedding: [2, 4, 6] },
        { embedding: [4, 6, 8] },
      ];
      const result = averageEmbedding(chunks);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBeCloseTo(3);
      expect(result[1]).toBeCloseTo(5);
      expect(result[2]).toBeCloseTo(7);
    });

    it('returns regular Array (not Float32Array)', () => {
      const result = averageEmbedding([{ embedding: [1, 2, 3] }]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).not.toBeInstanceOf(Float32Array);
    });

    it('returns null for empty chunks', () => {
      expect(averageEmbedding([])).toBeNull();
    });

    it('returns null for chunks without embeddings', () => {
      expect(averageEmbedding([{ embedding: [] }, {}])).toBeNull();
    });

    it('skips chunks with missing embedding', () => {
      const chunks = [
        { embedding: [10, 20] },
        {},
        { embedding: [30, 40] },
      ];
      const result = averageEmbedding(chunks);
      expect(result[0]).toBeCloseTo(20);
      expect(result[1]).toBeCloseTo(30);
    });

    it('handles high-dimensional vectors', () => {
      const dim = 1536; // OpenAI embedding dimension
      const chunks = [
        { embedding: new Array(dim).fill(1) },
        { embedding: new Array(dim).fill(3) },
      ];
      const result = averageEmbedding(chunks);
      expect(result.length).toBe(dim);
      expect(result[0]).toBeCloseTo(2);
      expect(result[dim - 1]).toBeCloseTo(2);
    });
  });
});
