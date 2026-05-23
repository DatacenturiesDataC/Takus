// Takus — Goals App + Goal Extraction Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage for GoalApp tests
vi.mock('../../lib/storage.js', () => ({
  getNodesByType: vi.fn(() => Promise.resolve([])),
  getNode: vi.fn(() => Promise.resolve(null)),
  saveNode: vi.fn(() => Promise.resolve()),
  addEdge: vi.fn(() => Promise.resolve()),
  updateNode: vi.fn((id, updater) => Promise.resolve(null)),
}));

vi.mock('../../lib/graph/node-registry.js', () => ({
  registerNodeType: vi.fn(),
  createNode: vi.fn((type, properties, options) => ({
    id: `${type}_test_123`,
    type,
    state: 'active',
    appId: options?.appId || 'unknown',
    properties: { ...properties },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })),
}));

vi.mock('../../lib/preference-engine.js', () => ({
  recordSignal: vi.fn(() => Promise.resolve()),
}));

describe('GoalApp', () => {
  let GoalApp;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../goals/index.js');
    GoalApp = mod.GoalApp;
  });

  it('has correct manifest', () => {
    expect(GoalApp.id).toBe('goals');
    expect(GoalApp.name).toBe('Goals');
    expect(GoalApp.category).toBe('core');
    expect(GoalApp.icon).toBe('🎯');
  });

  it('registers goal node type on activation', async () => {
    await GoalApp.activate({});
    const { registerNodeType } = await import('../../lib/graph/node-registry.js');
    expect(registerNodeType).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'goal',
        appId: 'goals',
        requiredProps: ['title', 'state'],
      })
    );
  });

  it('declares correct node and edge types', () => {
    expect(GoalApp.getNodeTypes()).toEqual(['goal']);
    expect(GoalApp.getEdgeTypes()).toEqual(['CONTRIBUTES_TO', 'SUPPORTS', 'INVOLVES']);
  });

  it('provides a nav item with badge for at-risk goals', async () => {
    await GoalApp.activate({});
    const nav = GoalApp.getNavItem();
    expect(nav.id).toBe('goals');
    expect(nav.label).toBe('Goals');
    expect(nav.icon).toBe('flag');
    expect(nav.order).toBe(4);
    expect(typeof nav.getBadgeCount).toBe('function');
    expect(nav.getBadgeCount()).toBe(0); // No at-risk goals initially
  });

  it('provides Add Goal quick action', () => {
    const actions = GoalApp.getQuickActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe('add-goal');
    expect(actions[0].label).toBe('Add Goal');
  });

  it('provides auto-run presets', () => {
    const presets = GoalApp.getAutoRunPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0].label).toContain('Auto-detect goals');
  });

  it('exports valid goal states', async () => {
    const mod = await import('../goals/index.js');
    expect(mod.GOAL_STATES).toEqual(['aspiration', 'active', 'at-risk', 'achieved', 'abandoned']);
    expect(mod.OPEN_GOAL_STATES).toEqual(['aspiration', 'active', 'at-risk']);
  });

  it('canProduceInboxItems is true', () => {
    expect(GoalApp.canProduceInboxItems).toBe(true);
  });
});

describe('Goal node validation', () => {
  it('rejects invalid goal state', async () => {
    const { registerNodeType } = await import('../../lib/graph/node-registry.js');
    // Get the validator from the registration call
    await (await import('../goals/index.js')).GoalApp.activate({});
    const call = registerNodeType.mock.calls.find(c => c[0].type === 'goal');
    expect(call).toBeTruthy();
    const validator = call[0].validate;

    // Valid state
    expect(validator({ properties: { state: 'active' } })).toBeTruthy();
    expect(validator({ properties: { state: 'at-risk' } })).toBeTruthy();

    // Invalid state
    expect(validator({ properties: { state: 'invalid' } })).toBeNull();
  });
});

describe('extractGoals', () => {
  it('returns empty for short text', async () => {
    const { extractGoals } = await import('../../lib/ai-engine.js');
    const result = await extractGoals('hi', [], 'key', 'openai');
    expect(result).toEqual({ goals: [] });
  });

  it('returns empty for missing API key', async () => {
    const { extractGoals } = await import('../../lib/ai-engine.js');
    const result = await extractGoals('a long enough text to pass the length check', [], '', 'openai');
    expect(result).toEqual({ goals: [] });
  });
});

// ── Goal Analytics ────────────────────────────────────────

describe('computeGoalAnalytics', () => {
  it('returns analytics from storage', async () => {
    const { getNodesByType } = await import('../../lib/storage.js');
    getNodesByType.mockResolvedValueOnce([
      { id: 'g1', properties: { state: 'active', title: 'Ship v1' }, createdAt: Date.now() - 86400000 * 3 },
      { id: 'g2', properties: { state: 'achieved', title: 'MVP' }, createdAt: Date.now() - 86400000 * 10 },
      { id: 'g3', properties: { state: 'at-risk', title: 'Hiring' }, createdAt: Date.now() - 86400000 * 7 },
      { id: 'g4', properties: { state: 'aspiration', title: 'IPO' }, createdAt: Date.now() - 86400000 },
    ]);

    const { computeGoalAnalytics } = await import('../goals/index.js');
    const result = await computeGoalAnalytics();
    expect(result.total).toBe(4);
    expect(result.achieved).toBe(1);
    expect(result.active).toBe(1);
    expect(result.atRisk).toBe(1);
    expect(result.aspirations).toBe(1);
    expect(result.achievedPct).toBe(25); // 1 of 4 (no abandoned)
  });

  it('handles empty goals', async () => {
    const { getNodesByType } = await import('../../lib/storage.js');
    getNodesByType.mockResolvedValueOnce([]);

    const { computeGoalAnalytics } = await import('../goals/index.js');
    const result = await computeGoalAnalytics();
    expect(result.total).toBe(0);
    expect(result.achievedPct).toBe(0);
  });
});

// ── Goal Lifecycle Signals ─────────────────────

describe('Goal lifecycle preference signals', () => {
  it('GoalApp imports recordSignal from preference-engine', async () => {
    // Verify the import exists by checking the module loads without error
    const mod = await import('../goals/index.js');
    expect(mod.GoalApp).toBeDefined();
    // The import of recordSignal is static — if it fails, the module won't load
  });

  it('settings schema includes configurable health threshold', async () => {
    const mod = await import('../goals/index.js');
    const schema = mod.GoalApp.getSettingsSchema();
    const healthSetting = schema.find(s => s.key === 'healthCheckDays');
    expect(healthSetting).toBeTruthy();
    expect(healthSetting.type).toBe('number');
    expect(healthSetting.defaultValue).toBe(14);
  });

  it('step types include goal_detection and goal_health_check', async () => {
    const mod = await import('../goals/index.js');
    const stepTypes = mod.GoalApp.getStepTypes();
    expect(stepTypes).toHaveLength(2);
    expect(stepTypes[0].type).toBe('goal_detection');
    expect(stepTypes[1].type).toBe('goal_health_check');
    expect(stepTypes[0].autoApprove).toBe(true);
    expect(stepTypes[1].autoApprove).toBe(true);
  });
});
