import { describe, it, expect } from 'vitest';
import { typeLabel, typeAccent, TYPES } from '../content-types.js';

describe('entry-types', () => {
  describe('TYPES', () => {
    it('exports a non-empty array', () => {
      expect(Array.isArray(TYPES)).toBe(true);
      expect(TYPES.length).toBeGreaterThan(0);
    });

    it('each type has required fields', () => {
      for (const t of TYPES) {
        expect(typeof t.id).toBe('string');
        expect(typeof t.key).toBe('string');
        expect(typeof t.label).toBe('string');
        expect(typeof t.icon).toBe('function');
        expect(typeof t.accent).toBe('string');
        expect(typeof t.accentDim).toBe('string');
        expect(typeof t.description).toBe('string');
      }
    });

    it('has unique ids', () => {
      const ids = TYPES.map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('typeLabel', () => {
    it('returns the label for known types', () => {
      expect(typeLabel('meeting')).toBe('Meeting');
      expect(typeLabel('screen')).toBe('Screen Recording');
      expect(typeLabel('presentation')).toBe('Presentation');
      expect(typeLabel('update')).toBe('Status Update');
    });

    it('returns the raw id for unknown types', () => {
      expect(typeLabel('custom')).toBe('custom');
    });

    it('returns "Content" for null/undefined', () => {
      expect(typeLabel(null)).toBe('Content');
      expect(typeLabel(undefined)).toBe('Content');
    });
  });

  describe('typeAccent', () => {
    it('returns a color string for known types', () => {
      expect(typeAccent('meeting')).toBe('#7c3aed');
      expect(typeAccent('screen')).toBe('#0ea5e9');
    });

    it('returns fallback for unknown types', () => {
      expect(typeAccent('unknown')).toBe('var(--color-text-muted)');
    });
  });
});
