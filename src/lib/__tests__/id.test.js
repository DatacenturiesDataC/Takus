import { describe, it, expect } from 'vitest';
import { generateId } from '../id.js';

describe('generateId', () => {
  it('returns a string with the given prefix', () => {
    const id = generateId('rec');
    expect(id).toMatch(/^rec_/);
  });

  it('uses default prefix when none supplied', () => {
    const id = generateId();
    expect(id).toMatch(/^id_/);
  });

  it('includes a timestamp segment', () => {
    const before = Date.now();
    const id = generateId('test');
    const after = Date.now();
    const parts = id.split('_');
    const ts = parseInt(parts[1], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('includes a 6-char random suffix', () => {
    const id = generateId('x');
    const parts = id.split('_');
    expect(parts[2]).toBeDefined();
    expect(parts[2].length).toBeLessThanOrEqual(6);
    expect(parts[2].length).toBeGreaterThanOrEqual(4); // random can be shorter
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId('u')));
    expect(ids.size).toBe(100);
  });

  it('follows the format prefix_timestamp_random', () => {
    const id = generateId('contact');
    expect(id).toMatch(/^contact_\d+_[a-z0-9]+$/);
  });
});
