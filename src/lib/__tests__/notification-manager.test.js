// Takus — Notification Manager Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock toast
vi.mock('../../components/toast.js', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  notifyEphemeral,
  notifyPersistent,
  notifyActionable,
  dismissNotification,
  getActiveNotifications,
  onNotification,
  pruneNotifications,
} from '../notification-manager.js';

import { toast } from '../../components/toast.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Clear active notifications by dismissing all
  for (const n of getActiveNotifications()) {
    dismissNotification(n.id);
  }
  pruneNotifications();
});

describe('Notification Manager', () => {
  describe('notifyEphemeral', () => {
    it('delegates to toast.info by default', () => {
      notifyEphemeral('Title', 'Body');
      expect(toast.info).toHaveBeenCalledWith('Title', 'Body');
    });

    it('delegates to the specified level', () => {
      notifyEphemeral('Warning', 'Msg', 'warning');
      expect(toast.warning).toHaveBeenCalledWith('Warning', 'Msg');
    });

    it('delegates to toast.error', () => {
      notifyEphemeral('Error', 'Msg', 'error');
      expect(toast.error).toHaveBeenCalledWith('Error', 'Msg');
    });
  });

  describe('notifyPersistent', () => {
    it('creates a persistent notification', () => {
      const id = notifyPersistent('Test', 'Body');
      expect(typeof id).toBe('string');
      const active = getActiveNotifications();
      expect(active.some(n => n.id === id)).toBe(true);
    });

    it('deduplicates by ID', () => {
      const id1 = notifyPersistent('Test', 'Body1', { id: 'dup-test' });
      const id2 = notifyPersistent('Test', 'Body2', { id: 'dup-test' });
      expect(id1).toBe(id2);
      const active = getActiveNotifications().filter(n => n.id === 'dup-test');
      expect(active).toHaveLength(1);
    });

    it('includes priority', () => {
      notifyPersistent('Urgent', 'Fix now', { id: 'urgent-1', priority: 3 });
      const notif = getActiveNotifications().find(n => n.id === 'urgent-1');
      expect(notif.priority).toBe(3);
    });
  });

  describe('notifyActionable', () => {
    it('creates an actionable notification with actions', () => {
      const action = vi.fn();
      const id = notifyActionable('Action', 'Do thing', [
        { label: 'Do it', action, primary: true },
        { label: 'Skip', action: vi.fn() },
      ]);
      const notif = getActiveNotifications().find(n => n.id === id);
      expect(notif.type).toBe('actionable');
      expect(notif.actions).toHaveLength(2);
      expect(notif.actions[0].label).toBe('Do it');
    });
  });

  describe('dismissNotification', () => {
    it('removes a notification from active list', () => {
      const id = notifyPersistent('Test', 'Body', { id: 'dismiss-test' });
      expect(getActiveNotifications().some(n => n.id === id)).toBe(true);
      dismissNotification(id);
      expect(getActiveNotifications().some(n => n.id === id)).toBe(false);
    });

    it('is safe to call with unknown ID', () => {
      expect(() => dismissNotification('nonexistent')).not.toThrow();
    });
  });

  describe('getActiveNotifications', () => {
    it('returns notifications sorted by priority (highest first)', () => {
      notifyPersistent('Low', '', { id: 'low', priority: 0 });
      notifyPersistent('High', '', { id: 'high', priority: 3 });
      notifyPersistent('Medium', '', { id: 'med', priority: 1 });
      const active = getActiveNotifications();
      expect(active[0].id).toBe('high');
      expect(active[active.length - 1].id).toBe('low');
    });
  });

  describe('onNotification', () => {
    it('emits added event', () => {
      const events = [];
      const unsub = onNotification((type, data) => events.push({ type, data }));
      notifyPersistent('Test', '', { id: 'evt-test' });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('added');
      unsub();
    });

    it('emits dismissed event', () => {
      const events = [];
      const id = notifyPersistent('Test', '', { id: 'evt-dismiss' });
      const unsub = onNotification((type) => events.push(type));
      dismissNotification(id);
      expect(events).toContain('dismissed');
      unsub();
    });

    it('unsubscribe stops events', () => {
      const events = [];
      const unsub = onNotification((type) => events.push(type));
      unsub();
      notifyPersistent('Test', '', { id: 'unsub-test' });
      expect(events).toHaveLength(0);
    });
  });

  describe('pruneNotifications', () => {
    it('removes dismissed notifications from memory', () => {
      const id = notifyPersistent('Test', '', { id: 'prune-test' });
      dismissNotification(id);
      pruneNotifications();
      // After prune, re-adding same ID should work (not deduplicated)
      const id2 = notifyPersistent('Test2', '', { id: 'prune-test' });
      expect(getActiveNotifications().some(n => n.id === 'prune-test')).toBe(true);
    });
  });
});
