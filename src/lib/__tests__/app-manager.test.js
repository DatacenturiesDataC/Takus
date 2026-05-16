// Takus — App Manager Tests
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerApp, registerApps, getApp, getAllApps, getActiveApps,
  isActive, activateApp, deactivateApp, initAppManager,
  getAppSetting, getAppSettings, setAppSetting, resetAppSettings,
  onAppEvent, getNavItems, getAutoRunPresets, getConfigPanelApps, _resetForTest,
} from '../app-manager.js';
import { validateAppManifest, createAppStub } from '../app-interface.js';

// ── Test Helpers ───────────────────────────────────────────────────────────

function makeApp(overrides = {}) {
  return createAppStub({
    id: overrides.id || 'test-app',
    name: overrides.name || 'Test App',
    icon: '🧪',
    description: 'A test app',
    ...overrides,
  });
}

// ── App Interface Validation ──────────────────────────────────────────────

describe('validateAppManifest', () => {
  it('accepts a valid manifest', () => {
    const app = makeApp();
    expect(() => validateAppManifest(app)).not.toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => validateAppManifest({})).toThrow('missing required field');
    expect(() => validateAppManifest({ id: 'x' })).toThrow('missing required field');
  });

  it('rejects missing required methods', () => {
    const broken = {
      id: 'test', name: 'Test', version: '1.0', description: 'x', icon: '🧪', category: 'built-in',
    };
    expect(() => validateAppManifest(broken)).toThrow('missing required method');
  });

  it('rejects invalid app IDs', () => {
    const app = makeApp({ id: 'Bad ID!' });
    expect(() => validateAppManifest(app)).toThrow('lowercase alphanumeric');
  });

  it('accepts hyphens and underscores in IDs', () => {
    expect(() => validateAppManifest(makeApp({ id: 'my-app_2' }))).not.toThrow();
  });
});

describe('createAppStub', () => {
  it('fills in defaults', () => {
    const stub = createAppStub({ id: 'minimal', name: 'Minimal', icon: '📦' });
    expect(stub.version).toBe('1.0.0');
    expect(stub.category).toBe('built-in');
    expect(stub.getNodeTypes()).toEqual([]);
    expect(stub.getStepTypes()).toEqual([]);
    expect(stub.getNavItem()).toBeNull();
  });
});

// ── App Manager ───────────────────────────────────────────────────────────

describe('AppManager', () => {
  beforeEach(() => {
    _resetForTest();
  });

  describe('registration', () => {
    it('registers a valid app', () => {
      registerApp(makeApp());
      expect(getApp('test-app')).toBeTruthy();
      expect(getApp('test-app').name).toBe('Test App');
    });

    it('returns null for unregistered app', () => {
      expect(getApp('nonexistent')).toBeNull();
    });

    it('replaces existing app on re-register', () => {
      registerApp(makeApp({ name: 'V1' }));
      registerApp(makeApp({ name: 'V2' }));
      expect(getApp('test-app').name).toBe('V2');
    });

    it('registers multiple apps', () => {
      registerApps([makeApp({ id: 'a' }), makeApp({ id: 'b' })]);
      expect(getAllApps()).toHaveLength(2);
    });
  });

  describe('activation', () => {
    it('activates an app', async () => {
      const activateSpy = vi.fn();
      registerApp(makeApp({ activate: activateSpy }));

      await activateApp('test-app');
      expect(isActive('test-app')).toBe(true);
      expect(activateSpy).toHaveBeenCalledTimes(1);
    });

    it('provides platform services on activation', async () => {
      let receivedServices = null;
      registerApp(makeApp({
        activate: async (services) => { receivedServices = services; },
      }));

      await activateApp('test-app');
      expect(receivedServices).toBeTruthy();
      expect(receivedServices.appId).toBe('test-app');
      expect(receivedServices.settings).toBeTruthy();
      expect(receivedServices.notifications).toBeTruthy();
      expect(receivedServices.events).toBeTruthy();
    });

    it('is idempotent — re-activating does nothing', async () => {
      const activateSpy = vi.fn();
      registerApp(makeApp({ activate: activateSpy }));

      await activateApp('test-app');
      await activateApp('test-app');
      expect(activateSpy).toHaveBeenCalledTimes(1);
    });

    it('throws for unregistered app', async () => {
      await expect(activateApp('ghost')).rejects.toThrow('not found');
    });

    it('activates dependencies first', async () => {
      const order = [];
      registerApp(makeApp({
        id: 'dep',
        activate: async () => { order.push('dep'); },
      }));
      registerApp(makeApp({
        id: 'main',
        requires: ['dep'],
        activate: async () => { order.push('main'); },
      }));

      await activateApp('main');
      expect(order).toEqual(['dep', 'main']);
      expect(isActive('dep')).toBe(true);
      expect(isActive('main')).toBe(true);
    });

    it('throws if dependency is not registered', async () => {
      registerApp(makeApp({
        id: 'orphan',
        requires: ['missing-dep'],
      }));
      await expect(activateApp('orphan')).rejects.toThrow('not registered');
    });
  });

  describe('deactivation', () => {
    it('deactivates an app', async () => {
      const deactivateSpy = vi.fn();
      registerApp(makeApp({ deactivate: deactivateSpy }));
      await activateApp('test-app');

      await deactivateApp('test-app');
      expect(isActive('test-app')).toBe(false);
      expect(deactivateSpy).toHaveBeenCalledTimes(1);
    });

    it('prevents deactivation of core apps', async () => {
      registerApp(makeApp({ category: 'core' }));
      await activateApp('test-app');

      await expect(deactivateApp('test-app')).rejects.toThrow('cannot be deactivated');
    });

    it('prevents deactivation if another app depends on it', async () => {
      registerApp(makeApp({ id: 'base' }));
      registerApp(makeApp({ id: 'dependent', requires: ['base'] }));
      await activateApp('dependent');

      await expect(deactivateApp('base')).rejects.toThrow('required by');
    });

    it('silently ignores deactivating an inactive app', async () => {
      registerApp(makeApp());
      await expect(deactivateApp('test-app')).resolves.not.toThrow();
    });
  });

  describe('settings', () => {
    it('returns default settings for a new app', async () => {
      registerApp(makeApp({
        getDefaultSettings: () => ({ color: 'blue', count: 5 }),
      }));
      await activateApp('test-app');

      expect(getAppSetting('test-app', 'color')).toBe('blue');
      expect(getAppSetting('test-app', 'count')).toBe(5);
    });

    it('persists setting changes', async () => {
      registerApp(makeApp({
        getDefaultSettings: () => ({ color: 'blue' }),
      }));
      await activateApp('test-app');

      await setAppSetting('test-app', 'color', 'red');
      expect(getAppSetting('test-app', 'color')).toBe('red');
    });

    it('getAppSettings merges defaults with overrides', async () => {
      registerApp(makeApp({
        getDefaultSettings: () => ({ a: 1, b: 2 }),
      }));
      await activateApp('test-app');
      await setAppSetting('test-app', 'b', 99);

      const all = getAppSettings('test-app');
      expect(all.a).toBe(1);
      expect(all.b).toBe(99);
    });

    it('resetAppSettings clears overrides', async () => {
      registerApp(makeApp({
        getDefaultSettings: () => ({ x: 'default' }),
      }));
      await activateApp('test-app');
      await setAppSetting('test-app', 'x', 'custom');
      expect(getAppSetting('test-app', 'x')).toBe('custom');

      await resetAppSettings('test-app');
      expect(getAppSetting('test-app', 'x')).toBe('default');
    });
  });

  describe('events', () => {
    it('emits activation events', async () => {
      const events = [];
      onAppEvent((type, data) => events.push({ type, ...data }));
      registerApp(makeApp());

      await activateApp('test-app');
      expect(events.some(e => e.type === 'app:activated' && e.appId === 'test-app')).toBe(true);
    });

    it('emits deactivation events', async () => {
      const events = [];
      registerApp(makeApp());
      await activateApp('test-app');

      onAppEvent((type, data) => events.push({ type, ...data }));
      await deactivateApp('test-app');
      expect(events.some(e => e.type === 'app:deactivated' && e.appId === 'test-app')).toBe(true);
    });

    it('emits settings change events', async () => {
      const events = [];
      registerApp(makeApp({ getDefaultSettings: () => ({ k: 'v' }) }));
      await activateApp('test-app');

      onAppEvent((type, data) => events.push({ type, ...data }));
      await setAppSetting('test-app', 'k', 'new');
      expect(events.some(e => e.type === 'app:settings_changed' && e.key === 'k')).toBe(true);
    });

    it('unsubscribe works', async () => {
      const events = [];
      const unsub = onAppEvent((type) => events.push(type));
      registerApp(makeApp());

      unsub();
      await activateApp('test-app');
      expect(events).toHaveLength(0);
    });
  });

  describe('nav items', () => {
    it('collects nav items from active apps', async () => {
      registerApp(makeApp({
        id: 'with-nav',
        getNavItem: () => ({ id: 'tab-1', label: 'My Tab', icon: '📌', order: 10 }),
      }));
      registerApp(makeApp({
        id: 'no-nav',
        getNavItem: () => null,
      }));
      await activateApp('with-nav');
      await activateApp('no-nav');

      const items = getNavItems();
      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('My Tab');
      expect(items[0].appId).toBe('with-nav');
    });

    it('sorts nav items by order', async () => {
      registerApp(makeApp({
        id: 'second',
        getNavItem: () => ({ id: 't2', label: 'Second', icon: '2️⃣', order: 20 }),
      }));
      registerApp(makeApp({
        id: 'first',
        getNavItem: () => ({ id: 't1', label: 'First', icon: '1️⃣', order: 5 }),
      }));
      await activateApp('second');
      await activateApp('first');

      const items = getNavItems();
      expect(items[0].label).toBe('First');
      expect(items[1].label).toBe('Second');
    });

    it('excludes nav items from inactive apps', async () => {
      registerApp(makeApp({
        id: 'inactive-nav',
        getNavItem: () => ({ id: 't', label: 'Hidden', icon: '👻' }),
      }));
      // Not activated
      expect(getNavItems()).toHaveLength(0);
    });
  });

  describe('getActiveApps / getAllApps', () => {
    it('returns all registered apps', () => {
      registerApps([makeApp({ id: 'a' }), makeApp({ id: 'b' })]);
      expect(getAllApps()).toHaveLength(2);
    });

    it('returns only active apps', async () => {
      registerApps([makeApp({ id: 'a' }), makeApp({ id: 'b' })]);
      await activateApp('a');
      expect(getActiveApps()).toHaveLength(1);
      expect(getActiveApps()[0].id).toBe('a');
    });
  });

  describe('Auto-Run presets', () => {
    it('aggregates presets from active apps', async () => {
      registerApp(makeApp({
        id: 'app-a',
        name: 'App A',
        icon: '🅰️',
        getAutoRunPresets: () => [
          { field: 'type', operator: 'equals', value: 'meeting', label: 'Auto meetings', description: 'Process meetings' },
        ],
      }));
      registerApp(makeApp({
        id: 'app-b',
        name: 'App B',
        icon: '🅱️',
        getAutoRunPresets: () => [
          { field: 'source', operator: 'equals', value: 'import', label: 'Auto import', description: 'Process imports' },
        ],
      }));
      await activateApp('app-a');
      await activateApp('app-b');

      const presets = getAutoRunPresets();
      expect(presets).toHaveLength(2);
      expect(presets[0].appId).toBe('app-a');
      expect(presets[0].appIcon).toBe('🅰️');
      expect(presets[0].appName).toBe('App A');
      expect(presets[1].appId).toBe('app-b');
    });

    it('returns empty array when no apps have presets', async () => {
      registerApp(makeApp({ id: 'no-presets' }));
      await activateApp('no-presets');
      expect(getAutoRunPresets()).toEqual([]);
    });

    it('excludes presets from inactive apps', async () => {
      registerApp(makeApp({
        id: 'inactive-preset',
        getAutoRunPresets: () => [
          { field: 'type', operator: 'equals', value: 'x', label: 'X', description: 'X' },
        ],
      }));
      // Not activated
      expect(getAutoRunPresets()).toEqual([]);
    });

    it('handles apps without getAutoRunPresets', async () => {
      const app = makeApp({ id: 'legacy' });
      delete app.getAutoRunPresets;
      registerApp(app);
      await activateApp('legacy');
      expect(getAutoRunPresets()).toEqual([]);
    });
  });

  describe('config panel apps', () => {
    it('returns apps that implement renderConfigPanel', async () => {
      const renderFn = vi.fn();
      registerApp(makeApp({
        id: 'has-config',
        renderConfigPanel: renderFn,
      }));
      registerApp(makeApp({
        id: 'no-config',
        renderConfigPanel: null,
      }));
      await activateApp('has-config');
      await activateApp('no-config');

      const apps = getConfigPanelApps();
      expect(apps).toHaveLength(1);
      expect(apps[0].id).toBe('has-config');
    });

    it('excludes inactive apps with renderConfigPanel', async () => {
      registerApp(makeApp({
        id: 'inactive-config',
        renderConfigPanel: vi.fn(),
      }));
      // Not activated
      expect(getConfigPanelApps()).toEqual([]);
    });

    it('returns empty when no apps have config panels', async () => {
      registerApp(makeApp({ id: 'plain' }));
      await activateApp('plain');
      expect(getConfigPanelApps()).toEqual([]);
    });
  });
});
