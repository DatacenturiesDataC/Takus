// Tests for inbound-poller.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../storage.js', () => ({
  saveEntry: vi.fn(async () => {}),
  getEntries: vi.fn(async () => []),
}));

vi.mock('../id.js', () => ({
  generateId: vi.fn((prefix) => `${prefix}_poll_${Date.now()}`),
}));

vi.mock('../app-manager.js', () => ({
  getActiveApps: vi.fn(() => []),
}));

vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

import { startPolling, stopPolling, pollNow, getPollerStatus, onPollerEvent } from '../inbound-poller.js';
import { getActiveApps } from '../app-manager.js';
import { saveEntry, getEntries } from '../storage.js';

describe('inbound-poller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopPolling(); // Clean state
    // Ensure we're "online" and "visible"
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    stopPolling();
    vi.restoreAllMocks();
  });

  describe('getPollerStatus', () => {
    it('returns initial state', () => {
      const status = getPollerStatus();
      expect(status.running).toBe(false);
      expect(status.isPolling).toBe(false);
    });
  });

  describe('pollNow', () => {
    it('returns empty array when no apps implement pollInbound', async () => {
      getActiveApps.mockReturnValue([]);
      const items = await pollNow();
      expect(items).toEqual([]);
    });

    it('polls apps that implement pollInbound', async () => {
      const mockApp = {
        id: 'test-calendar',
        pollInbound: vi.fn(async () => [
          { sourceId: 'evt-1', title: 'Team standup', type: 'event', textContent: 'Daily standup meeting' },
          { sourceId: 'evt-2', title: 'Sprint review', type: 'event' },
        ]),
      };
      getActiveApps.mockReturnValue([mockApp]);
      getEntries.mockResolvedValue([]);

      const items = await pollNow();
      expect(mockApp.pollInbound).toHaveBeenCalledTimes(1);
      expect(items).toHaveLength(2);
      expect(saveEntry).toHaveBeenCalledTimes(2);
    });

    it('deduplicates items by sourceApp:sourceId', async () => {
      const mockApp = {
        id: 'test-app',
        pollInbound: vi.fn(async () => [
          { sourceId: 'msg-1', title: 'Hello' },
        ]),
      };
      getActiveApps.mockReturnValue([mockApp]);
      // Simulate existing entry with same sourceId
      getEntries.mockResolvedValue([{ id: 'e1', sourceId: 'msg-1', sourceApp: 'test-app' }]);

      const items = await pollNow();
      expect(items).toHaveLength(0);
      expect(saveEntry).not.toHaveBeenCalled();
    });

    it('isolates errors per app', async () => {
      const failApp = {
        id: 'fail-app',
        pollInbound: vi.fn(async () => { throw new Error('API down'); }),
      };
      const okApp = {
        id: 'ok-app',
        pollInbound: vi.fn(async () => [{ sourceId: 'ok-1', title: 'OK item' }]),
      };
      getActiveApps.mockReturnValue([failApp, okApp]);
      getEntries.mockResolvedValue([]);

      const items = await pollNow();
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('OK item');
    });
  });

  describe('onPollerEvent', () => {
    it('fires events on poll completion', async () => {
      const listener = vi.fn();
      const unsub = onPollerEvent(listener);

      getActiveApps.mockReturnValue([{
        id: 'test',
        pollInbound: vi.fn(async () => [{ sourceId: 's1', title: 'Item' }]),
      }]);
      getEntries.mockResolvedValue([]);

      await pollNow();

      const events = listener.mock.calls.map(c => c[0]);
      expect(events).toContain('poller:new_items');
      expect(events).toContain('poller:poll_complete');

      unsub();
    });

    it('unsubscribe stops events', async () => {
      const listener = vi.fn();
      const unsub = onPollerEvent(listener);
      unsub();

      getActiveApps.mockReturnValue([]);
      await pollNow();

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
