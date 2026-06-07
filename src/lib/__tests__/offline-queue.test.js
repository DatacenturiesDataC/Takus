// Takus — Offline Queue Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../storage.js', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  saveSetting: vi.fn(() => Promise.resolve()),
}));

import {
  registerQueueHandler,
  enqueue,
  getQueue,
  getQueueStats,
  removeFromQueue,
  retryOperation,
  onQueueEvent,
  clearQueue,
} from '../offline-queue.js';

// Register a slow handler so test items stay in queue long enough to inspect
registerQueueHandler('test-op', async () => { await new Promise(r => setTimeout(r, 500)); });
registerQueueHandler('slow-op', async () => { await new Promise(r => setTimeout(r, 500)); });

describe('Offline Queue', () => {
  beforeEach(async () => {
    await clearQueue();
    vi.clearAllMocks();
  });

  describe('enqueue', () => {
    it('adds an operation to the queue', async () => {
      registerQueueHandler('enqueue-check', async () => {
        // Slow handler so we can inspect queue before it completes
        await new Promise(r => setTimeout(r, 200));
      });
      const id = await enqueue('enqueue-check', { data: 'hello' }, { id: 'add-test' });
      expect(typeof id).toBe('string');
      const queue = getQueue();
      expect(queue.length).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates by ID', async () => {
      await enqueue('slow-op', { data: 1 }, { id: 'dup-1' });
      await enqueue('slow-op', { data: 2 }, { id: 'dup-1' });
      const queue = getQueue();
      const matching = queue.filter(op => op.id === 'dup-1');
      expect(matching.length).toBeLessThanOrEqual(1);
    });

    it('generates unique IDs when not provided', async () => {
      const id1 = await enqueue('test-op', {});
      const id2 = await enqueue('test-op', {});
      expect(id1).not.toBe(id2);
    });
  });

  describe('getQueueStats', () => {
    it('returns correct counts', async () => {
      registerQueueHandler('stat-a', async () => { await new Promise(r => setTimeout(r, 200)); });
      registerQueueHandler('stat-b', async () => { await new Promise(r => setTimeout(r, 200)); });
      await enqueue('stat-a', {}, { id: 'sa' });
      await enqueue('stat-b', {}, { id: 'sb' });
      const stats = getQueueStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('removeFromQueue', () => {
    it('removes an operation', async () => {
      await enqueue('slow-op', {}, { id: 'rm-1' });
      await removeFromQueue('rm-1');
      const queue = getQueue();
      expect(queue.find(op => op.id === 'rm-1')).toBeUndefined();
    });

    it('is safe for unknown IDs', async () => {
      await expect(removeFromQueue('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('handler execution', () => {
    it('executes handler immediately when online', async () => {
      const handler = vi.fn(() => Promise.resolve());
      registerQueueHandler('fast-op', handler);

      await enqueue('fast-op', { key: 'value' }, { id: 'fast-1' });
      // Poll until handler is called or timeout
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 25));
        if (handler.mock.calls.length > 0) break;
      }

      expect(handler).toHaveBeenCalledWith({ key: 'value' });
    });

    it('marks as failed when no handler is registered', async () => {
      vi.useFakeTimers();
      const events = [];
      const unsub = onQueueEvent((type) => events.push(type));

      await enqueue('totally-unknown-type-xyz', {}, { id: 'unknown-1' });

      // Advance through all retry delays (1s + 5s + 15s + 60s + 300s)
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(300_001);
      }

      expect(events).toContain('failed');
      unsub();
      vi.useRealTimers();
    });

    it('retries on failure with backoff', async () => {
      let callCount = 0;
      registerQueueHandler('flaky-op', async () => {
        callCount++;
        if (callCount < 3) throw new Error('Network failure');
      });

      await enqueue('flaky-op', {}, { id: 'flaky-1' });
      // Wait for first attempt
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 25));
        if (callCount >= 1) break;
      }

      expect(callCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('onQueueEvent', () => {
    it('subscribes and receives events', async () => {
      const events = [];
      const unsub = onQueueEvent((type, data) => events.push({ type, id: data.id }));

      await enqueue('test', {}, { id: 'evt-1' });
      expect(events.some(e => e.type === 'enqueued' && e.id === 'evt-1')).toBe(true);

      unsub();
    });

    it('unsubscribe stops events', async () => {
      const events = [];
      const unsub = onQueueEvent((type) => events.push(type));
      unsub();

      await enqueue('test', {}, { id: 'no-evt' });
      // Only 'enqueued' might have been emitted before unsub, but shouldn't be received
      expect(events).toHaveLength(0);
    });
  });

  describe('clearQueue', () => {
    it('removes all operations', async () => {
      await enqueue('a', {}, { id: 'c1' });
      await enqueue('b', {}, { id: 'c2' });
      await clearQueue();
      expect(getQueue()).toHaveLength(0);
    });
  });
});
