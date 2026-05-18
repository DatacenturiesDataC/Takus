// Takus — Settings Utils Tests
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/icons.js', () => ({
  icons: new Proxy({}, {
    get: () => (size) => `<svg size="${size}"></svg>`,
  }),
}));

vi.mock('../toast.js', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { feedbackIcon, ruleLabel } from '../settings-utils.js';

describe('Settings Utils', () => {
  describe('feedbackIcon', () => {
    it('returns bug emoji for bug', () => {
      expect(feedbackIcon('bug')).toBe('🐛');
    });

    it('returns sparkle for feature_request', () => {
      expect(feedbackIcon('feature_request')).toBe('✨');
    });

    it('returns palette for ux', () => {
      expect(feedbackIcon('ux')).toBe('🎨');
    });

    it('returns speech bubble for unknown', () => {
      expect(feedbackIcon('other')).toBe('💬');
      expect(feedbackIcon('')).toBe('💬');
    });
  });

  describe('ruleLabel', () => {
    it('generates label for type equals rule', () => {
      expect(ruleLabel({ field: 'type', operator: 'equals', value: 'meeting' }))
        .toBe('Type is "meeting"');
    });

    it('generates label for title contains rule', () => {
      expect(ruleLabel({ field: 'title', operator: 'contains', value: 'standup' }))
        .toBe('Title contains "standup"');
    });

    it('generates label for source startsWith rule', () => {
      expect(ruleLabel({ field: 'source', operator: 'startsWith', value: 'zoom' }))
        .toBe('Source starts with "zoom"');
    });

    it('falls back to raw values for unknown field/operator', () => {
      expect(ruleLabel({ field: 'custom', operator: 'matches', value: 'x' }))
        .toBe('custom matches "x"');
    });

    it('generates label for participant field', () => {
      expect(ruleLabel({ field: 'participant', operator: 'equals', value: 'alice' }))
        .toBe('Participant is "alice"');
    });
  });
});
