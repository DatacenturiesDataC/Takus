// Takus — Edge Types Tests
import { describe, it, expect } from 'vitest';
import { EDGE_TYPES, getEdgeTypeConfig, getEdgeTypeKeys } from '../edge-types.js';

describe('EDGE_TYPES', () => {
  it('has all expected edge types', () => {
    expect(EDGE_TYPES).toHaveProperty('PARTICIPATED_IN');
    expect(EDGE_TYPES).toHaveProperty('HAS_TASK');
    expect(EDGE_TYPES).toHaveProperty('SIMILAR_TO');
    expect(EDGE_TYPES).toHaveProperty('MENTIONED_IN');
  });

  it('each type has required fields', () => {
    for (const [key, config] of Object.entries(EDGE_TYPES)) {
      expect(config).toHaveProperty('icon');
      expect(config).toHaveProperty('label');
      expect(config).toHaveProperty('color');
      expect(config).toHaveProperty('cssVar');
      expect(typeof config.icon).toBe('string');
      expect(typeof config.label).toBe('string');
      expect(typeof config.color).toBe('string');
      expect(typeof config.cssVar).toBe('string');
    }
  });
});

describe('getEdgeTypeConfig', () => {
  it('returns config for known types', () => {
    const cfg = getEdgeTypeConfig('PARTICIPATED_IN');
    expect(cfg.icon).toBe('👤');
    expect(cfg.label).toBe('Participants');
    expect(cfg.color).toBe('#8b5cf6');
    expect(cfg.cssVar).toBe('var(--color-info)');
  });

  it('returns fallback for unknown types', () => {
    const cfg = getEdgeTypeConfig('CUSTOM_EDGE');
    expect(cfg.icon).toBe('·');
    expect(cfg.label).toBe('Custom Edge');
    expect(cfg.color).toBe('#6b7280');
    expect(cfg.cssVar).toBe('var(--color-text-muted)');
  });

  it('humanizes snake_case labels for unknown types', () => {
    expect(getEdgeTypeConfig('LINKED_BY_TAG').label).toBe('Linked By Tag');
    expect(getEdgeTypeConfig('RELATED_TO').label).toBe('Related To');
  });
});

describe('getEdgeTypeKeys', () => {
  it('returns an array of all type keys', () => {
    const keys = getEdgeTypeKeys();
    expect(Array.isArray(keys)).toBe(true);
    expect(keys).toContain('PARTICIPATED_IN');
    expect(keys).toContain('HAS_TASK');
    expect(keys).toContain('SIMILAR_TO');
    expect(keys).toContain('MENTIONED_IN');
    expect(keys).toContain('ASSIGNED_TO');
    expect(keys).toContain('DERIVED_FROM');
    expect(keys).toContain('NEXT_STEP');
    expect(keys).toContain('BLOCKS');
    expect(keys).toContain('MENTIONS');
    expect(keys).toContain('CONTRIBUTES_TO');
    expect(keys).toContain('SUPPORTS');
    expect(keys).toContain('INVOLVES');
    expect(keys).toContain('HAS_CONVERSATION');
    expect(keys.length).toBe(13);
  });
});
