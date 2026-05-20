// Takus — Feature Flags Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../storage.js', () => {
  let _store = {};
  return {
    getSetting: vi.fn(async (key) => _store[key] ?? null),
    saveSetting: vi.fn(async (key, val) => { _store[key] = val; }),
    _reset: () => { _store = {}; },
  };
});

import { isEnabled, setFlag, getAllFlags, resetFlags } from '../feature-flags.js';
import { _reset } from '../storage.js';

beforeEach(() => {
  vi.clearAllMocks();
  _reset();
});

describe('isEnabled', () => {
  it('returns default value for stable flags', async () => {
    expect(await isEnabled('adaptiveAI')).toBe(true);
    expect(await isEnabled('blindSpots')).toBe(true);
  });

  it('returns false for experimental flags by default', async () => {
    expect(await isEnabled('autoRecord')).toBe(false);
  });

  it('returns true for archiveEngine (promoted to stable)', async () => {
    expect(await isEnabled('archiveEngine')).toBe(true);
  });

  it('returns false for unknown flags', async () => {
    expect(await isEnabled('nonexistent_flag')).toBe(false);
  });
});

describe('setFlag', () => {
  it('overrides a flag value', async () => {
    await setFlag('autoRecord', true);
    expect(await isEnabled('autoRecord')).toBe(true);
  });

  it('can disable a default-on flag', async () => {
    await setFlag('adaptiveAI', false);
    expect(await isEnabled('adaptiveAI')).toBe(false);
  });

  it('ignores unknown flag names', async () => {
    await setFlag('fake_flag', true);
    expect(await isEnabled('fake_flag')).toBe(false);
  });
});

describe('getAllFlags', () => {
  it('returns all flags with metadata', async () => {
    const flags = await getAllFlags();
    expect(flags.length).toBeGreaterThanOrEqual(5);

    const adaptive = flags.find(f => f.name === 'adaptiveAI');
    expect(adaptive.enabled).toBe(true);
    expect(adaptive.tier).toBe('stable');
    expect(adaptive.isDefault).toBe(true);
  });

  it('reflects overrides', async () => {
    await setFlag('autoRecord', true);
    const flags = await getAllFlags();
    const autoRec = flags.find(f => f.name === 'autoRecord');
    expect(autoRec.enabled).toBe(true);
    expect(autoRec.isDefault).toBe(false);
  });
});

describe('resetFlags', () => {
  it('restores all flags to defaults', async () => {
    await setFlag('autoRecord', true);
    await setFlag('adaptiveAI', false);
    await resetFlags();
    expect(await isEnabled('autoRecord')).toBe(false);
    expect(await isEnabled('adaptiveAI')).toBe(true);
  });
});
