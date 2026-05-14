// Tests for embeddings.js — pure helper functions
import { describe, it, expect } from 'vitest';
import { chunkTranscript, cosineSimilarity } from '../embeddings.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it('is symmetric', () => {
    const a = [3, 1, 4, 1, 5];
    const b = [2, 7, 1, 8, 2];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });

  it('is invariant to scaling', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    const aScaled = a.map(x => x * 100);
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(aScaled, b), 5);
  });
});

describe('chunkTranscript', () => {
  it('returns empty for null/empty/short text', () => {
    expect(chunkTranscript(null)).toEqual([]);
    expect(chunkTranscript('')).toEqual([]);
    expect(chunkTranscript('tiny')).toEqual([]);
  });

  it('returns a single chunk for medium text', () => {
    const text = 'a'.repeat(100);
    const chunks = chunkTranscript(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].end).toBe(100);
  });

  it('creates overlapping chunks for long text', () => {
    const text = 'a'.repeat(800);
    const chunks = chunkTranscript(text);
    expect(chunks.length).toBeGreaterThan(1);
    // Second chunk starts at 400-80=320
    expect(chunks[1].start).toBe(320);
  });

  it('chunks have correct text slices', () => {
    const text = 'abcdefghij'.repeat(50); // 500 chars
    const chunks = chunkTranscript(text);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(text.slice(chunk.start, chunk.end));
    }
  });

  it('last chunk reaches end of text', () => {
    const text = 'x'.repeat(500);
    const chunks = chunkTranscript(text);
    const last = chunks[chunks.length - 1];
    expect(last.end).toBe(500);
  });
});
