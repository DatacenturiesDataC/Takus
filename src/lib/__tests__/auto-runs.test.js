// Takus — Auto-Runs Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock settings store
let mockRules = '[]';
vi.mock('../settings-store.js', () => ({
  getSettings: vi.fn(() => ({ autoRuns: mockRules })),
  saveAndCache: vi.fn((key, value) => { if (key === 'autoRuns') mockRules = value; }),
}));

const {
  getAutoRuns, saveAutoRuns, addAutoRun,
  removeAutoRun, toggleAutoRun, evaluateAutoRuns,
  getAutoRunPresets,
  // Legacy aliases
  getAutoReadRules, shouldAutoProcess,
} = await import('../auto-runs.js');

beforeEach(() => { mockRules = '[]'; });

describe('getAutoRuns', () => {
  it('returns empty array for default settings', () => {
    expect(getAutoRuns()).toEqual([]);
  });

  it('parses stored rules', () => {
    mockRules = JSON.stringify([{ id: 'r1', field: 'type', operator: 'equals', value: 'meeting', enabled: true }]);
    const rules = getAutoRuns();
    expect(rules).toHaveLength(1);
    expect(rules[0].value).toBe('meeting');
  });

  it('handles malformed JSON gracefully', () => {
    mockRules = '{invalid json';
    expect(getAutoRuns()).toEqual([]);
  });
});

describe('addAutoRun', () => {
  it('creates a rule with generated ID', () => {
    const rule = addAutoRun({ field: 'type', operator: 'equals', value: 'meeting' });
    expect(rule.id).toMatch(/^ar_/);
    expect(rule.enabled).toBe(true);
    expect(getAutoRuns()).toHaveLength(1);
  });

  it('defaults field to type and operator to equals', () => {
    const rule = addAutoRun({ value: 'screen' });
    expect(rule.field).toBe('type');
    expect(rule.operator).toBe('equals');
  });

  it('supports appId field for traceability', () => {
    const rule = addAutoRun({ value: 'meeting', appId: 'recorder' });
    expect(rule.appId).toBe('recorder');
  });
});

describe('removeAutoRun', () => {
  it('removes a rule by ID', () => {
    const rule = addAutoRun({ value: 'meeting' });
    expect(getAutoRuns()).toHaveLength(1);
    removeAutoRun(rule.id);
    expect(getAutoRuns()).toHaveLength(0);
  });

  it('no-ops for non-existent ID', () => {
    addAutoRun({ value: 'meeting' });
    removeAutoRun('nonexistent');
    expect(getAutoRuns()).toHaveLength(1);
  });
});

describe('toggleAutoRun', () => {
  it('toggles enabled state', () => {
    const rule = addAutoRun({ value: 'meeting' });
    expect(getAutoRuns()[0].enabled).toBe(true);
    toggleAutoRun(rule.id);
    expect(getAutoRuns()[0].enabled).toBe(false);
    toggleAutoRun(rule.id);
    expect(getAutoRuns()[0].enabled).toBe(true);
  });
});

describe('evaluateAutoRuns', () => {
  it('returns false when no rules exist', () => {
    const result = evaluateAutoRuns({ type: 'meeting' });
    expect(result.shouldProcess).toBe(false);
  });

  it('matches type equals rule', () => {
    addAutoRun({ field: 'type', operator: 'equals', value: 'meeting' });
    expect(evaluateAutoRuns({ type: 'meeting' }).shouldProcess).toBe(true);
    expect(evaluateAutoRuns({ type: 'screen' }).shouldProcess).toBe(false);
  });

  it('matches title contains rule', () => {
    addAutoRun({ field: 'title', operator: 'contains', value: 'standup' });
    expect(evaluateAutoRuns({ title: 'Daily standup review' }).shouldProcess).toBe(true);
    expect(evaluateAutoRuns({ title: 'Team meeting' }).shouldProcess).toBe(false);
  });

  it('matches source equals rule', () => {
    addAutoRun({ field: 'source', operator: 'equals', value: 'auto-record' });
    expect(evaluateAutoRuns({ source: 'auto-record' }).shouldProcess).toBe(true);
    expect(evaluateAutoRuns({ source: 'manual' }).shouldProcess).toBe(false);
  });

  it('matches title startsWith rule', () => {
    addAutoRun({ field: 'title', operator: 'startsWith', value: 'sprint' });
    expect(evaluateAutoRuns({ title: 'Sprint Planning Q2' }).shouldProcess).toBe(true);
    expect(evaluateAutoRuns({ title: 'Weekly sprint review' }).shouldProcess).toBe(false);
  });

  it('skips disabled rules', () => {
    const rule = addAutoRun({ field: 'type', operator: 'equals', value: 'meeting' });
    toggleAutoRun(rule.id);
    expect(evaluateAutoRuns({ type: 'meeting' }).shouldProcess).toBe(false);
  });

  it('returns the matched rule', () => {
    addAutoRun({ field: 'type', operator: 'equals', value: 'meeting', label: 'Auto meetings' });
    const result = evaluateAutoRuns({ type: 'meeting' });
    expect(result.matchedRule?.label).toBe('Auto meetings');
  });

  it('is case-insensitive', () => {
    addAutoRun({ field: 'type', operator: 'equals', value: 'Meeting' });
    expect(evaluateAutoRuns({ type: 'meeting' }).shouldProcess).toBe(true);
  });

  it('matches first applicable rule', () => {
    addAutoRun({ field: 'type', operator: 'equals', value: 'screen', label: 'Rule A' });
    addAutoRun({ field: 'type', operator: 'equals', value: 'meeting', label: 'Rule B' });
    const result = evaluateAutoRuns({ type: 'meeting' });
    expect(result.matchedRule?.label).toBe('Rule B');
  });
});

describe('getAutoRunPresets (deprecated, returns [])', () => {
  it('returns empty array (presets now come from AppManager)', () => {
    const presets = getAutoRunPresets();
    expect(presets).toEqual([]);
  });
});

describe('backward compatibility aliases', () => {
  it('getAutoReadRules is an alias for getAutoRuns', () => {
    expect(getAutoReadRules).toBe(getAutoRuns);
  });

  it('shouldAutoProcess is an alias for evaluateAutoRuns', () => {
    expect(shouldAutoProcess).toBe(evaluateAutoRuns);
  });
});
