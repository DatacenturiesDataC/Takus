// Takus — Lifecycle Manager Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  onLifecycle,
  emitLifecycle,
  emitLifecycleAll,
  getRegisteredApps,
  clearAppHooks,
  isPaused,
  initLifecycleMonitor,
  destroyLifecycleMonitor,
} from '../lifecycle-manager.js';

describe('Lifecycle Manager', () => {
  beforeEach(() => {
    destroyLifecycleMonitor();
  });

  afterEach(() => {
    destroyLifecycleMonitor();
  });

  describe('onLifecycle', () => {
    it('registers a hook for an app', () => {
      const handler = vi.fn();
      onLifecycle('test-app', 'activate', handler);
      expect(getRegisteredApps()).toContain('test-app');
    });

    it('returns an unsubscribe function', async () => {
      const handler = vi.fn();
      const unsub = onLifecycle('test-app', 'pause', handler);

      await emitLifecycle('test-app', 'pause');
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      await emitLifecycle('test-app', 'pause');
      expect(handler).toHaveBeenCalledTimes(1); // not called again
    });

    it('supports multiple handlers per event', async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      onLifecycle('app-a', 'resume', h1);
      onLifecycle('app-a', 'resume', h2);

      await emitLifecycle('app-a', 'resume');
      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
    });

    it('supports multiple events per app', async () => {
      const pause = vi.fn();
      const resume = vi.fn();
      onLifecycle('app-b', 'pause', pause);
      onLifecycle('app-b', 'resume', resume);

      await emitLifecycle('app-b', 'pause');
      expect(pause).toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();

      await emitLifecycle('app-b', 'resume');
      expect(resume).toHaveBeenCalled();
    });
  });

  describe('emitLifecycle', () => {
    it('calls registered handlers', async () => {
      const handler = vi.fn();
      onLifecycle('test-app', 'activate', handler);
      await emitLifecycle('test-app', 'activate');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('handles async handlers', async () => {
      const calls = [];
      onLifecycle('async-app', 'pause', async () => {
        await new Promise(r => setTimeout(r, 10));
        calls.push('paused');
      });

      await emitLifecycle('async-app', 'pause');
      expect(calls).toEqual(['paused']);
    });

    it('continues on handler failure', async () => {
      const h1 = vi.fn(() => { throw new Error('Crash'); });
      const h2 = vi.fn();
      onLifecycle('crash-app', 'resume', h1);
      onLifecycle('crash-app', 'resume', h2);

      await emitLifecycle('crash-app', 'resume');
      expect(h2).toHaveBeenCalled(); // h2 still runs despite h1 crash
    });

    it('is safe for unregistered apps', async () => {
      await expect(emitLifecycle('nonexistent', 'activate')).resolves.not.toThrow();
    });

    it('is safe for unregistered events', async () => {
      onLifecycle('app', 'activate', vi.fn());
      await expect(emitLifecycle('app', 'deactivate')).resolves.not.toThrow();
    });
  });

  describe('emitLifecycleAll', () => {
    it('emits to all registered apps', async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      onLifecycle('app-1', 'pause', h1);
      onLifecycle('app-2', 'pause', h2);

      await emitLifecycleAll('pause');
      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
    });
  });

  describe('clearAppHooks', () => {
    it('removes all hooks for an app', async () => {
      const handler = vi.fn();
      onLifecycle('clear-app', 'activate', handler);
      clearAppHooks('clear-app');

      await emitLifecycle('clear-app', 'activate');
      expect(handler).not.toHaveBeenCalled();
      expect(getRegisteredApps()).not.toContain('clear-app');
    });
  });

  describe('isPaused', () => {
    it('returns false by default', () => {
      expect(isPaused()).toBe(false);
    });
  });

  describe('initLifecycleMonitor', () => {
    it('initializes without errors', () => {
      expect(() => initLifecycleMonitor()).not.toThrow();
    });

    it('is idempotent', () => {
      initLifecycleMonitor();
      initLifecycleMonitor(); // should not double-bind
    });
  });

  describe('destroyLifecycleMonitor', () => {
    it('clears all state', () => {
      onLifecycle('destroy-app', 'activate', vi.fn());
      destroyLifecycleMonitor();
      expect(getRegisteredApps()).toHaveLength(0);
      expect(isPaused()).toBe(false);
    });
  });
});
