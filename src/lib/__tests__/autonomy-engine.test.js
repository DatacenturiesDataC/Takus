// Takus — Autonomy Engine Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the heavy browser-dependent imports
vi.mock('../storage.js', () => ({
  getRecordings: vi.fn(() => Promise.resolve([
    { id: 'r1', title: 'Meeting 1', aiTranscript: 'A long enough transcript to pass the 50 char check for auto embed processing test scenario here', date: Date.now(), type: 'meeting' },
    { id: 'r2', title: 'Meeting 2', aiTranscript: '', date: Date.now(), type: 'screen' },
  ])),
  getAllEmbeddings: vi.fn(() => Promise.resolve([
    { recordingId: 'r1', chunks: [{ embedding: [0.1, 0.2, 0.3], text: 'chunk1' }] },
  ])),
  saveEmbeddings: vi.fn(() => Promise.resolve()),
  getContacts: vi.fn(() => Promise.resolve([])),
  getAllInteractions: vi.fn(() => Promise.resolve([])),
  addEdge: vi.fn(() => Promise.resolve()),
}));

vi.mock('../settings-store.js', () => ({
  getSettings: vi.fn(() => ({
    aiProvider: 'openai',
    openaiKey: 'sk-test',
    geminiKey: '',
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
});
