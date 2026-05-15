// Takus — Auto-Read Rules Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock settings store
let mockRules = '[]';
vi.mock('../settings-store.js', () => ({
  getSettings: vi.fn(() => ({ autoReadRules: mockRules })),
  saveAndCache: vi.fn((key, value) => { if (key === 'autoReadRules') mockRules = value; }),
}));

const {
  getAutoReadRules, saveAutoReadRules, addAutoReadRule,
  removeAutoReadRule, toggleAutoReadRule, shouldAutoProcess,
  getAutoReadPresets,
} = await import('../auto-read-rules.js');

beforeEach(() => { mockRules = '[]'; });

describe('getAutoReadRules', () => {
  it('returns empty array for default settings', () => {
    expect(getAutoReadRules()).toEqual([]);
  });

  it('parses stored rules', () => {
    mockRules = JSON.stringify([{ id: 'r1', field: 'type', operator: 'equals', value: 'meeting', enabled: true }]);
    const rules = getAutoReadRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].value).toBe('meeting');
  });

  it('handles malformed JSON gracefully', () => {
    mockRules = '{invalid json';
    expect(getAutoReadRules()).toEqual([]);
  });
});

describe('addAutoReadRule', () => {
  it('creates a rule with generated ID', () => {
    const rule = addAutoReadRule({ field: 'type', operator: 'equals', value: 'meeting' });
    expect(rule.id).toMatch(/^ar_/);
    expect(rule.enabled).toBe(true);
    expect(getAutoReadRules()).toHaveLength(1);
  });

  it('defaults field to type and operator to equals', () => {
    const rule = addAutoReadRule({ value: 'screen' });
    expect(rule.field).toBe('type');
    expect(rule.operator).toBe('equals');
  });
});

describe('removeAutoReadRule', () => {
  it('removes a rule by ID', () => {
    const rule = addAutoReadRule({ value: 'meeting' });
    expect(getAutoReadRules()).toHaveLength(1);
    removeAutoReadRule(rule.id);
    expect(getAutoReadRules()).toHaveLength(0);
  });

  it('no-ops for non-existent ID', () => {
    addAutoReadRule({ value: 'meeting' });
    removeAutoReadRule('nonexistent');
    expect(getAutoReadRules()).toHaveLength(1);
  });
});

describe('toggleAutoReadRule', () => {
  it('toggles enabled state', () => {
    const rule = addAutoReadRule({ value: 'meeting' });
    expect(getAutoReadRules()[0].enabled).toBe(true);
    toggleAutoReadRule(rule.id);
    expect(getAutoReadRules()[0].enabled).toBe(false);
    toggleAutoReadRule(rule.id);
    expect(getAutoReadRules()[0].enabled).toBe(true);
  });
});

describe('shouldAutoProcess', () => {
  it('returns false when no rules exist', () => {
    const result = shouldAutoProcess({ type: 'meeting' });
    expect(result.shouldProcess).toBe(false);
  });

  it('matches type equals rule', () => {
    addAutoReadRule({ field: 'type', operator: 'equals', value: 'meeting' });
    expect(shouldAutoProcess({ type: 'meeting' }).shouldProcess).toBe(true);
    expect(shouldAutoProcess({ type: 'screen' }).shouldProcess).toBe(false);
  });

  it('matches title contains rule', () => {
    addAutoReadRule({ field: 'title', operator: 'contains', value: 'standup' });
    expect(shouldAutoProcess({ title: 'Daily standup review' }).shouldProcess).toBe(true);
    expect(shouldAutoProcess({ title: 'Team meeting' }).shouldProcess).toBe(false);
  });

  it('matches source equals rule', () => {
    addAutoReadRule({ field: 'source', operator: 'equals', value: 'auto-record' });
    expect(shouldAutoProcess({ source: 'auto-record' }).shouldProcess).toBe(true);
    expect(shouldAutoProcess({ source: 'manual' }).shouldProcess).toBe(false);
  });

  it('matches title startsWith rule', () => {
    addAutoReadRule({ field: 'title', operator: 'startsWith', value: 'sprint' });
    expect(shouldAutoProcess({ title: 'Sprint Planning Q2' }).shouldProcess).toBe(true);
    expect(shouldAutoProcess({ title: 'Weekly sprint review' }).shouldProcess).toBe(false);
  });

  it('skips disabled rules', () => {
    const rule = addAutoReadRule({ field: 'type', operator: 'equals', value: 'meeting' });
    toggleAutoReadRule(rule.id);
    expect(shouldAutoProcess({ type: 'meeting' }).shouldProcess).toBe(false);
  });

  it('returns the matched rule', () => {
    addAutoReadRule({ field: 'type', operator: 'equals', value: 'meeting', label: 'Auto meetings' });
    const result = shouldAutoProcess({ type: 'meeting' });
    expect(result.matchedRule?.label).toBe('Auto meetings');
  });

  it('is case-insensitive', () => {
    addAutoReadRule({ field: 'type', operator: 'equals', value: 'Meeting' });
    expect(shouldAutoProcess({ type: 'meeting' }).shouldProcess).toBe(true);
  });

  it('matches first applicable rule', () => {
    addAutoReadRule({ field: 'type', operator: 'equals', value: 'screen', label: 'Rule A' });
    addAutoReadRule({ field: 'type', operator: 'equals', value: 'meeting', label: 'Rule B' });
    const result = shouldAutoProcess({ type: 'meeting' });
    expect(result.matchedRule?.label).toBe('Rule B');
  });
});

describe('getAutoReadPresets', () => {
  it('returns preset rules', () => {
    const presets = getAutoReadPresets();
    expect(presets.length).toBeGreaterThanOrEqual(3);
    expect(presets.every(p => p.field && p.operator && p.value)).toBe(true);
    expect(presets.every(p => p.description)).toBe(true);
  });
});
