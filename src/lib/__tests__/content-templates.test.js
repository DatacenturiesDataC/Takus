// Takus — Recording Templates Tests
import { describe, it, expect } from 'vitest';
import {
  getTemplates, getTemplate, getTemplatesForType,
  applyTemplate, registerTemplate,
} from '../content-templates.js';

describe('Recording Templates', () => {
  describe('Built-in Templates', () => {
    it('has at least 8 built-in templates', () => {
      const templates = getTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(8);
    });

    it('each template has required fields', () => {
      for (const t of getTemplates()) {
        expect(t.id).toBeTruthy();
        expect(t.name).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.type).toBeTruthy();
        expect(t.icon).toBeTruthy();
        expect(t.steps).toBeInstanceOf(Array);
        expect(t.steps.length).toBeGreaterThan(0);
      }
    });

    it('has unique IDs', () => {
      const ids = getTemplates().map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('getTemplate', () => {
    it('retrieves a known template by ID', () => {
      const t = getTemplate('tmpl_standup');
      expect(t).toBeTruthy();
      expect(t.name).toBe('Daily Standup');
    });

    it('returns undefined for unknown ID', () => {
      expect(getTemplate('tmpl_nonexistent')).toBeUndefined();
    });
  });

  describe('getTemplatesForType', () => {
    it('filters templates by entry type', () => {
      const meetings = getTemplatesForType('meeting');
      expect(meetings.length).toBeGreaterThanOrEqual(4); // standup, planning, 1:1, brainstorm, interview
      expect(meetings.every(t => t.type === 'meeting')).toBe(true);
    });

    it('returns screen templates', () => {
      const screens = getTemplatesForType('screen');
      expect(screens.length).toBeGreaterThanOrEqual(2); // demo, bug report
    });

    it('returns empty for unknown type', () => {
      expect(getTemplatesForType('unknown_type')).toEqual([]);
    });
  });

  describe('applyTemplate', () => {
    it('returns steps and settings for valid template', () => {
      const result = applyTemplate('tmpl_standup');
      expect(result).toBeTruthy();
      expect(result.steps).toContain('ai_transcribe');
      expect(result.steps).toContain('ai_extract_tasks');
      expect(result.extraction.tasks).toBe(true);
      expect(result.extraction.analytics).toBe(false);
      expect(result.processing.autoTranscribe).toBe(true);
    });

    it('returns null for unknown template', () => {
      expect(applyTemplate('nonexistent')).toBeNull();
    });

    it('returns default extraction settings when not specified', () => {
      const result = applyTemplate('tmpl_planning');
      expect(result.extraction.tasks).toBe(true);
      expect(result.extraction.decisions).toBe(true);
      expect(result.extraction.contacts).toBe(true);
      expect(result.extraction.analytics).toBe(true);
    });

    it('returns copied arrays (no mutation)', () => {
      const r1 = applyTemplate('tmpl_standup');
      const r2 = applyTemplate('tmpl_standup');
      r1.steps.push('custom_step');
      expect(r2.steps).not.toContain('custom_step');
    });
  });

  describe('registerTemplate', () => {
    it('allows adding custom templates', () => {
      const before = getTemplates().length;
      registerTemplate({
        id: 'tmpl_test_custom',
        name: 'Test Custom',
        description: 'Custom template for testing',
        type: 'custom',
        icon: '🧪',
        steps: ['ai_transcribe'],
        defaults: {},
      });
      expect(getTemplates().length).toBe(before + 1);
      expect(getTemplate('tmpl_test_custom')).toBeTruthy();
    });
  });
});
