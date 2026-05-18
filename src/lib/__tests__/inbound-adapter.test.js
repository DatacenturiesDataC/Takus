// Tests for InboundAdapter base class and AdapterRegistry
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock storage
vi.mock('../storage.js', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn().mockResolvedValue(undefined),
  saveEntry: vi.fn().mockResolvedValue(undefined),
}));

// Mock inbox
vi.mock('../inbox.js', () => ({
  submitToInbox: vi.fn().mockReturnValue({ action: 'hold', item: {} }),
}));

// Mock notification-manager
vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

// Mock content-pipeline's ingestContent
vi.mock('../content-pipeline.js', () => ({
  ingestContent: vi.fn().mockResolvedValue({ entry: { id: 'test_123' }, action: 'hold' }),
}));

import {
  InboundAdapter,
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  getAllAdapters,
  ingestFromAdapter,
  startPolling,
  stopPolling,
  isPolling,
  resetSeenKeys,
} from '../inbound-adapter.js';

import { ingestContent } from '../content-pipeline.js';

describe('InboundAdapter Base Class', () => {
  it('requires id and name', () => {
    expect(() => new InboundAdapter({})).toThrow('requires id and name');
    expect(() => new InboundAdapter({ id: 'test' })).toThrow('requires id and name');
  });

  it('creates adapter with defaults', () => {
    const adapter = new InboundAdapter({ id: 'test', name: 'Test' });
    expect(adapter.id).toBe('test');
    expect(adapter.name).toBe('Test');
    expect(adapter.icon).toBe('📥');
    expect(adapter.connected).toBe(false);
  });

  it('connect sets connected to true', async () => {
    const adapter = new InboundAdapter({ id: 'test', name: 'Test' });
    await adapter.connect({ token: 'abc' });
    expect(adapter.connected).toBe(true);
  });

  it('disconnect sets connected to false', async () => {
    const adapter = new InboundAdapter({ id: 'test', name: 'Test' });
    await adapter.connect({});
    await adapter.disconnect();
    expect(adapter.connected).toBe(false);
  });

  it('poll returns empty array by default', async () => {
    const adapter = new InboundAdapter({ id: 'test', name: 'Test' });
    const items = await adapter.poll();
    expect(items).toEqual([]);
  });

  it('normalize produces valid NormalizedContent', () => {
    const adapter = new InboundAdapter({ id: 'test', name: 'Test' });
    const result = adapter.normalize({ title: 'Hello', content: 'World' });
    expect(result.title).toBe('Hello');
    expect(result.content).toBe('World');
    expect(result.source).toBe('test');
    expect(result.sourceKey).toMatch(/^test:/);
    expect(result.type).toBe('document');
  });
});

describe('AdapterRegistry', () => {
  let adapter;

  beforeEach(() => {
    // Clear registry between tests
    for (const a of getAllAdapters()) {
      unregisterAdapter(a.id);
    }
    resetSeenKeys();

    adapter = new InboundAdapter({ id: 'mock', name: 'Mock Adapter' });
  });

  afterEach(() => {
    stopPolling('mock');
  });

  it('registers and retrieves adapters', () => {
    registerAdapter(adapter);
    expect(getAdapter('mock')).toBe(adapter);
    expect(getAllAdapters()).toHaveLength(1);
  });

  it('rejects non-InboundAdapter instances', () => {
    expect(() => registerAdapter({ id: 'fake' })).toThrow('InboundAdapter instance');
  });

  it('unregisters adapters', () => {
    registerAdapter(adapter);
    unregisterAdapter('mock');
    expect(getAdapter('mock')).toBeUndefined();
    expect(getAllAdapters()).toHaveLength(0);
  });

  it('ingestFromAdapter throws for unknown adapter', async () => {
    await expect(ingestFromAdapter('nonexistent')).rejects.toThrow('Unknown adapter');
  });

  it('ingestFromAdapter throws for disconnected adapter', async () => {
    registerAdapter(adapter);
    await expect(ingestFromAdapter('mock')).rejects.toThrow('not connected');
  });

  it('ingestFromAdapter polls and deduplicates', async () => {
    const customAdapter = new InboundAdapter({ id: 'dedup', name: 'Dedup Test' });
    customAdapter.poll = vi.fn().mockResolvedValue([
      { id: '1', title: 'Item 1', content: 'Content 1' },
      { id: '2', title: 'Item 2', content: 'Content 2' },
    ]);
    customAdapter.normalize = vi.fn().mockImplementation((item) => ({
      title: item.title,
      content: item.content,
      type: 'document',
      source: 'dedup',
      sourceKey: `dedup:${item.id}`,
      metadata: {},
      tags: [],
      timestamp: Date.now(),
    }));
    await customAdapter.connect({});
    registerAdapter(customAdapter);

    const result1 = await ingestFromAdapter('dedup');
    expect(result1.ingested).toBe(2);
    expect(result1.skipped).toBe(0);

    // Second poll — same items should be skipped
    const result2 = await ingestFromAdapter('dedup');
    expect(result2.ingested).toBe(0);
    expect(result2.skipped).toBe(2);

    unregisterAdapter('dedup');
  });

  it('tracks polling state', () => {
    registerAdapter(adapter);
    expect(isPolling('mock')).toBe(false);
    startPolling('mock', 60000);
    expect(isPolling('mock')).toBe(true);
    stopPolling('mock');
    expect(isPolling('mock')).toBe(false);
  });

  it('resetSeenKeys clears deduplication state', async () => {
    const customAdapter = new InboundAdapter({ id: 'reset', name: 'Reset Test' });
    customAdapter.poll = vi.fn().mockResolvedValue([
      { id: '1', title: 'Item 1', content: 'Content 1' },
    ]);
    customAdapter.normalize = vi.fn().mockImplementation((item) => ({
      title: item.title,
      content: item.content,
      type: 'document',
      source: 'reset',
      sourceKey: `reset:${item.id}`,
      metadata: {},
      tags: [],
      timestamp: Date.now(),
    }));
    await customAdapter.connect({});
    registerAdapter(customAdapter);

    await ingestFromAdapter('reset');
    resetSeenKeys();

    // After reset, same items should be ingested again
    const result = await ingestFromAdapter('reset');
    expect(result.ingested).toBe(1);

    unregisterAdapter('reset');
  });
});
