// Takus — Config Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to reset module state between tests since config.js uses module-level _config
let initConfig, getConfig, isGoogleConfigured, isMicrosoftConfigured;

describe('config', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Reset window config
    delete window.__TAKUS_CONFIG__;
    const mod = await import('../config.js');
    initConfig = mod.initConfig;
    getConfig = mod.getConfig;
    isGoogleConfigured = mod.isGoogleConfigured;
    isMicrosoftConfigured = mod.isMicrosoftConfigured;
  });

  describe('initConfig', () => {
    it('returns default config when no user config is set', () => {
      const config = initConfig();
      expect(config.recording.defaultVideoQuality).toBe('720p');
      expect(config.recording.frameRate).toBe(30);
      expect(config.drive.folderName).toBe('Takus Recordings');
    });

    it('deep merges user config with defaults', () => {
      window.__TAKUS_CONFIG__ = {
        google: { clientId: 'test-id-123' },
        recording: { frameRate: 60 },
      };
      const config = initConfig();
      expect(config.google.clientId).toBe('test-id-123');
      expect(config.recording.frameRate).toBe(60);
      // Other defaults still present
      expect(config.recording.defaultVideoQuality).toBe('720p');
      expect(config.google.scopes).toContain('openid');
    });

    it('logs validation warnings for placeholder client IDs', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      window.__TAKUS_CONFIG__ = {
        google: { clientId: 'YOUR_CLIENT_ID' },
      };
      initConfig();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('getConfig', () => {
    it('auto-initializes on first call', () => {
      const config = getConfig();
      expect(config).toBeDefined();
      expect(config.recording).toBeDefined();
    });
  });

  describe('isGoogleConfigured', () => {
    it('returns false with empty client ID', () => {
      initConfig();
      expect(isGoogleConfigured()).toBe(false);
    });

    it('returns false with placeholder client ID', () => {
      window.__TAKUS_CONFIG__ = { google: { clientId: 'YOUR_CLIENT_ID_HERE' } };
      initConfig();
      expect(isGoogleConfigured()).toBe(false);
    });

    it('returns true with a real client ID', () => {
      window.__TAKUS_CONFIG__ = { google: { clientId: '123456789.apps.googleusercontent.com' } };
      initConfig();
      expect(isGoogleConfigured()).toBe(true);
    });
  });

  describe('isMicrosoftConfigured', () => {
    it('returns false with no Microsoft config', () => {
      initConfig();
      expect(isMicrosoftConfigured()).toBe(false);
    });

    it('returns true with a real client ID', () => {
      window.__TAKUS_CONFIG__ = { microsoft: { clientId: 'azure-app-id-123' } };
      initConfig();
      expect(isMicrosoftConfigured()).toBe(true);
    });
  });
});
