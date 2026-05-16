// Takus — App Interface Tests (Phase 65)
// Tests the WordPress-model app platform foundation.
import { describe, it, expect } from 'vitest';
import { validateAppManifest, createAppStub } from '../app-interface.js';

describe('App Interface', () => {
  describe('createAppStub', () => {
    it('creates a valid app with minimal config', () => {
      const app = createAppStub({ id: 'test-app', name: 'Test', icon: '🧪' });
      expect(app.id).toBe('test-app');
      expect(app.name).toBe('Test');
      expect(app.icon).toBe('🧪');
      expect(app.version).toBe('1.0.0');
      expect(app.category).toBe('built-in');
      expect(app.requires).toEqual([]);
    });

    it('fills all required method defaults', () => {
      const app = createAppStub({ id: 'test', name: 'Test', icon: '🧪' });
      expect(typeof app.activate).toBe('function');
      expect(typeof app.deactivate).toBe('function');
      expect(typeof app.getSettingsSchema).toBe('function');
      expect(typeof app.getDefaultSettings).toBe('function');
      expect(typeof app.getNavItem).toBe('function');
      expect(typeof app.renderPanel).toBe('function');
      expect(typeof app.getNodeTypes).toBe('function');
      expect(typeof app.getEdgeTypes).toBe('function');
      expect(typeof app.getStepTypes).toBe('function');
    });

    it('defaults return empty arrays/objects', () => {
      const app = createAppStub({ id: 'test', name: 'T', icon: '🧪' });
      expect(app.getSettingsSchema()).toEqual([]);
      expect(app.getDefaultSettings()).toEqual({});
      expect(app.getNavItem()).toBeNull();
      expect(app.getNodeTypes()).toEqual([]);
      expect(app.getEdgeTypes()).toEqual([]);
      expect(app.getStepTypes()).toEqual([]);
      expect(app.getQuickActions()).toEqual([]);
      expect(app.getAutoRunPresets()).toEqual([]);
    });

    it('preserves overrides from partial', () => {
      const app = createAppStub({
        id: 'custom', name: 'Custom', icon: '🔧',
        version: '2.0.0', category: 'core',
        getNodeTypes: () => ['widget'],
      });
      expect(app.version).toBe('2.0.0');
      expect(app.category).toBe('core');
      expect(app.getNodeTypes()).toEqual(['widget']);
    });

    it('sets canProduceInboxItems default to false', () => {
      const app = createAppStub({ id: 'test', name: 'T', icon: '🧪' });
      expect(app.canProduceInboxItems).toBe(false);
    });

    it('allows canProduceInboxItems override', () => {
      const app = createAppStub({ id: 'test', name: 'T', icon: '🧪', canProduceInboxItems: true });
      expect(app.canProduceInboxItems).toBe(true);
    });

    it('activate and deactivate are async no-ops by default', async () => {
      const app = createAppStub({ id: 'test', name: 'T', icon: '🧪' });
      await expect(app.activate()).resolves.toBeUndefined();
      await expect(app.deactivate()).resolves.toBeUndefined();
    });
  });

  describe('validateAppManifest', () => {
    const validApp = () => createAppStub({
      id: 'test-app', name: 'Test App', version: '1.0.0',
      description: 'A test app', icon: '🧪', category: 'built-in',
    });

    it('validates a correct manifest', () => {
      const app = validApp();
      const result = validateAppManifest(app);
      expect(result).toBe(app);
    });

    it('throws for missing required fields', () => {
      const app = validApp();
      delete app.id;
      expect(() => validateAppManifest(app)).toThrow('id');
    });

    it('throws for missing name', () => {
      const app = validApp();
      app.name = '';
      expect(() => validateAppManifest(app)).toThrow('name');
    });

    it('throws for missing required methods', () => {
      const app = validApp();
      app.activate = 'not a function';
      expect(() => validateAppManifest(app)).toThrow('activate');
    });

    it('throws for invalid app ID format', () => {
      const app = validApp();
      app.id = 'INVALID ID';
      expect(() => validateAppManifest(app)).toThrow('lowercase');
    });

    it('accepts valid app ID formats', () => {
      const cases = ['recorder', 'my-app', 'app_v2', 'a123'];
      for (const id of cases) {
        const app = validApp();
        app.id = id;
        expect(() => validateAppManifest(app)).not.toThrow();
      }
    });

    it('rejects IDs starting with number', () => {
      const app = validApp();
      app.id = '123app';
      expect(() => validateAppManifest(app)).toThrow();
    });
  });
});
