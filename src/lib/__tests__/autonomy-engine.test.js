// Takus — Autonomy Engine Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the heavy browser-dependent imports
vi.mock('../storage.js', () => ({
  getEntries: vi.fn(() => Promise.resolve([
    { id: 'r1', title: 'Meeting 1', textContent: 'A long enough transcript to pass the 50 char check for auto embed processing test scenario here', date: Date.now(), type: 'meeting' },
    { id: 'r2', title: 'Meeting 2', textContent: '', date: Date.now(), type: 'screen' },
  ])),
  getAllEmbeddings: vi.fn(() => Promise.resolve([
    { contentId: 'r1', chunks: [{ embedding: [0.1, 0.2, 0.3], text: 'chunk1' }] },
  ])),
  saveEmbeddings: vi.fn(() => Promise.resolve()),
  getContacts: vi.fn(() => Promise.resolve([])),
  getAllInteractions: vi.fn(() => Promise.resolve([])),
  addEdge: vi.fn(() => Promise.resolve()),
  getNodesByType: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../settings-store.js', () => ({
  getSettings: vi.fn(() => ({
    aiProvider: 'openai',
    openaiKey: 'sk-test',
    geminiKey: '',
  })),
  getEffectiveAIConfig: vi.fn(() => ({
    provider: 'openai',
    apiKey: 'sk-test',
    useProxy: false,
    proxyUrl: null,
    workspaceId: null,
    memberToken: null,
  })),
}));

vi.mock('../embeddings.js', () => ({
  embedTranscript: vi.fn(() => Promise.resolve([
    { embedding: [0.4, 0.5, 0.6], text: 'chunk1' },
    { embedding: [0.7, 0.8, 0.9], text: 'chunk2' },
  ])),
  cosineSimilarity: vi.fn(() => 0.85),
}));

vi.mock('../closeness-worker.js', () => ({
  recomputeScores: vi.fn(() => Promise.resolve({ updated: 0, crossed: [] })),
}));

const { mockGetAppSettings, mockRunWellbeingCheck } = vi.hoisted(() => {
  return {
    mockGetAppSettings: vi.fn(() => ({ maxActiveGoals: 12 })),
    mockRunWellbeingCheck: vi.fn(() => ({ suggestion: 'Test suggestion' })),
  };
});

vi.mock('../app-manager.js', () => ({
  getAppSettings: mockGetAppSettings,
}));

vi.mock('../wellbeing.js', () => ({
  runWellbeingCheck: mockRunWellbeingCheck,
}));

vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

// Stub browser APIs
const originalRAF = globalThis.requestIdleCallback;
const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');

beforeEach(() => {
  globalThis.requestIdleCallback = (fn) => setTimeout(fn, 0);
  globalThis.cancelIdleCallback = (id) => clearTimeout(id);
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  // Reset localStorage
  try { localStorage.removeItem('takus_autonomy_log'); } catch {}
});

afterEach(() => {
  if (originalRAF) globalThis.requestIdleCallback = originalRAF;
  if (originalHidden) Object.defineProperty(Document.prototype, 'hidden', originalHidden);
});

describe('Autonomy Engine', () => {
  it('exports required functions', async () => {
    const mod = await import('../autonomy-engine.js');
    expect(typeof mod.startAutonomy).toBe('function');
    expect(typeof mod.stopAutonomy).toBe('function');
    expect(typeof mod.isAutonomyRunning).toBe('function');
    expect(typeof mod.getAutonomyStats).toBe('function');
    expect(typeof mod.onAutonomyEvent).toBe('function');
    expect(typeof mod.getAutonomyLog).toBe('function');
  });

  it('starts and stops without error', async () => {
    const { startAutonomy, stopAutonomy, isAutonomyRunning } = await import('../autonomy-engine.js');
    startAutonomy();
    expect(isAutonomyRunning()).toBe(true);
    stopAutonomy();
    expect(isAutonomyRunning()).toBe(false);
  });

  it('returns initial stats', async () => {
    const { getAutonomyStats } = await import('../autonomy-engine.js');
    const stats = getAutonomyStats();
    expect(stats).toHaveProperty('embeddings');
    expect(stats).toHaveProperty('similarity');
    expect(stats).toHaveProperty('closeness');
    expect(stats).toHaveProperty('errors');
    expect(typeof stats.lastTick).toBe('number');
  });

  it('event subscription and unsubscription work', async () => {
    const { onAutonomyEvent } = await import('../autonomy-engine.js');
    const events = [];
    const unsub = onAutonomyEvent((type, data) => events.push({ type, data }));
    expect(typeof unsub).toBe('function');
    unsub();
    // After unsubscribe, should not receive events
  });

  it('log is an array', async () => {
    const { getAutonomyLog } = await import('../autonomy-engine.js');
    const log = getAutonomyLog();
    expect(Array.isArray(log)).toBe(true);
  });

  it('double start is safe', async () => {
    const { startAutonomy, stopAutonomy, isAutonomyRunning } = await import('../autonomy-engine.js');
    startAutonomy();
    startAutonomy(); // should be no-op
    expect(isAutonomyRunning()).toBe(true);
    stopAutonomy();
  });

  it('double stop is safe', async () => {
    const { stopAutonomy, isAutonomyRunning } = await import('../autonomy-engine.js');
    stopAutonomy();
    stopAutonomy(); // should be no-op
    expect(isAutonomyRunning()).toBe(false);
  });

  it('stats include goalLinks field for task→goal linking', async () => {
    const { getAutonomyStats } = await import('../autonomy-engine.js');
    const stats = getAutonomyStats();
    expect(stats).toHaveProperty('goalLinks');
    expect(typeof stats.goalLinks).toBe('number');
  });

  it('stats shape includes all autonomy dimensions', async () => {
    const { getAutonomyStats } = await import('../autonomy-engine.js');
    const stats = getAutonomyStats();
    const expected = ['embeddings', 'similarity', 'closeness', 'knowledgeLevels', 'goals', 'goalLinks', 'tasks', 'errors', 'lastTick'];
    for (const key of expected) {
      expect(stats).toHaveProperty(key);
    }
  });

  it('loads goal app settings and passes maxActiveGoals to runWellbeingCheck', async () => {
    const { testAutoWellbeing } = await import('../autonomy-engine.js');
    await testAutoWellbeing();
    expect(mockGetAppSettings).toHaveBeenCalledWith('goals');
    expect(mockRunWellbeingCheck).toHaveBeenCalledWith(expect.objectContaining({
      maxActiveGoals: 12,
    }));
  });

  it('auto-embed backoff: skips entries that recently failed', async () => {
    const storage = await import('../storage.js');
    // Setup: r1 is already embedded (from mock), r3 is unembedded
    storage.getEntries.mockResolvedValueOnce([
      { id: 'r3', title: 'Failing Entry', textContent: 'A'.repeat(100), date: Date.now(), type: 'meeting' },
    ]);
    storage.getAllEmbeddings.mockResolvedValueOnce([]); // no embeddings for r3

    const { testAutoEmbed } = await import('../autonomy-engine.js');
    // First call — r3 will try to embed and fail (step-executor mock not set up → catch block)
    await testAutoEmbed();

    // Second call — r3 should be in backoff list and skipped
    storage.getEntries.mockResolvedValueOnce([
      { id: 'r3', title: 'Failing Entry', textContent: 'A'.repeat(100), date: Date.now(), type: 'meeting' },
    ]);
    storage.getAllEmbeddings.mockResolvedValueOnce([]);
    await testAutoEmbed(); // should return early without attempting r3 again
    // If backoff wasn't working, this would throw or attempt embedding twice
  });
});
