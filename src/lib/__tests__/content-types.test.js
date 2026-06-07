import { describe, it, expect } from 'vitest';
import {
  CONTENT_TYPES,
  getCaptureTypes, getDocumentTypes,
  typeLabel, typeAccent, typeIcon, getCategory,
} from '../content-types.js';

describe('content-types', () => {

  // ── CONTENT_TYPES registry ────────────────────────────────────────────────

  describe('CONTENT_TYPES', () => {
    it('exports a non-empty array', () => {
      expect(Array.isArray(CONTENT_TYPES)).toBe(true);
      expect(CONTENT_TYPES.length).toBeGreaterThan(0);
    });

    it('contains both entry and document categories', () => {
      const categories = new Set(CONTENT_TYPES.map(t => t.category));
      expect(categories.has('entry')).toBe(true);
      expect(categories.has('document')).toBe(true);
    });

    it('each type has required fields', () => {
      for (const t of CONTENT_TYPES) {
        expect(typeof t.id).toBe('string');
        expect(typeof t.category).toBe('string');
        expect(typeof t.label).toBe('string');
        expect(typeof t.icon).toBe('function');
        expect(typeof t.accent).toBe('string');
        expect(typeof t.accentDim).toBe('string');
        expect(typeof t.description).toBe('string');
      }
    });

    it('entry types have keyboard shortcut keys', () => {
      const entryTypes = CONTENT_TYPES.filter(t => t.category === 'entry');
      for (const t of entryTypes) {
        expect(typeof t.key).toBe('string');
        expect(t.key.length).toBe(1);
      }
    });

    it('has unique ids across all types', () => {
      const ids = CONTENT_TYPES.map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('has unique accent colors', () => {
      const accents = CONTENT_TYPES.map(t => t.accent);
      expect(new Set(accents).size).toBe(accents.length);
    });

    it('icon functions return SVG strings', () => {
      for (const t of CONTENT_TYPES) {
        const svg = t.icon(16);
        expect(typeof svg).toBe('string');
        expect(svg).toContain('svg');
      }
    });
  });


  // ── getCaptureTypes ─────────────────────────────────────────────────────

  describe('getCaptureTypes', () => {
    it('returns only entry types', () => {
      const types = getCaptureTypes();
      expect(types.length).toBeGreaterThan(0);
      expect(types.every(t => t.category === 'entry')).toBe(true);
    });

    it('includes meeting, screen, presentation, update', () => {
      const ids = getCaptureTypes().map(t => t.id);
      expect(ids).toContain('meeting');
      expect(ids).toContain('screen');
      expect(ids).toContain('presentation');
      expect(ids).toContain('update');
    });
  });

  // ── getDocumentTypes ────────────────────────────────────────────────────

  describe('getDocumentTypes', () => {
    it('returns only document types', () => {
      const types = getDocumentTypes();
      expect(types.length).toBeGreaterThan(0);
      expect(types.every(t => t.category === 'document')).toBe(true);
    });

    it('includes document, markdown, email, note, bookmark', () => {
      const ids = getDocumentTypes().map(t => t.id);
      expect(ids).toContain('document');
      expect(ids).toContain('markdown');
      expect(ids).toContain('email');
      expect(ids).toContain('note');
      expect(ids).toContain('bookmark');
    });
  });

  // ── typeLabel ─────────────────────────────────────────────────────────

  describe('typeLabel', () => {
    it('returns labels for entry types', () => {
      expect(typeLabel('meeting')).toBe('Meeting');
      expect(typeLabel('screen')).toBe('Screen Capture');
      expect(typeLabel('presentation')).toBe('Presentation');
      expect(typeLabel('update')).toBe('Status Update');
    });

    it('returns labels for document types', () => {
      expect(typeLabel('document')).toBe('Document');
      expect(typeLabel('email')).toBe('Email');
      expect(typeLabel('note')).toBe('Note');
      expect(typeLabel('bookmark')).toBe('Bookmark');
    });

    it('returns raw id for unknown types', () => {
      expect(typeLabel('custom')).toBe('custom');
    });

    it('returns "Content" for null/undefined', () => {
      expect(typeLabel(null)).toBe('Content');
      expect(typeLabel(undefined)).toBe('Content');
    });
  });

  // ── typeAccent ────────────────────────────────────────────────────────

  describe('typeAccent', () => {
    it('returns a color string for known types', () => {
      expect(typeAccent('meeting')).toBe('#7c3aed');
      expect(typeAccent('screen')).toBe('#0ea5e9');
      expect(typeAccent('email')).toBe('#ec4899');
    });

    it('returns fallback for unknown types', () => {
      expect(typeAccent('unknown')).toBe('var(--text-muted)');
    });
  });

  // ── typeIcon ──────────────────────────────────────────────────────────

  describe('typeIcon', () => {
    it('returns a function for known types', () => {
      const icon = typeIcon('meeting');
      expect(typeof icon).toBe('function');
      expect(icon(16)).toContain('svg');
    });

    it('returns fallback icon for unknown types', () => {
      const icon = typeIcon('unknown_xyz');
      expect(typeof icon).toBe('function');
    });
  });

  // ── getCategory ───────────────────────────────────────────────────────

  describe('getCategory', () => {
    it('returns "entry" for capture types', () => {
      expect(getCategory('meeting')).toBe('entry');
      expect(getCategory('screen')).toBe('entry');
    });

    it('returns "document" for document types', () => {
      expect(getCategory('document')).toBe('document');
      expect(getCategory('email')).toBe('document');
      expect(getCategory('bookmark')).toBe('document');
    });

    it('defaults to "entry" for unknown types', () => {
      expect(getCategory('unknown')).toBe('entry');
    });
  });
});
