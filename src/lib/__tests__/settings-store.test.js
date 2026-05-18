import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage and cloud provider
vi.mock('../storage.js', () => ({
  saveSetting: vi.fn().mockResolvedValue(),
  getSetting: vi.fn().mockResolvedValue(null),
  batchRead: vi.fn().mockResolvedValue({ settings: [] }),
}));

vi.mock('../cloud-provider.js', () => ({
  CloudProviderManager: {
    getInstance: vi.fn(() => ({
      getProvider: vi.fn(() => null),
    })),
  },
}));

vi.mock('../events.js', () => ({
  CLOUD_CONNECTED: 'takus:cloudConnected',
}));

import { getSettings, getShortcuts, saveAndCache, getSettingCached, initSettings } from '../settings-store.js';
import { saveSetting, getSetting } from '../storage.js';

describe('settings-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSettings', () => {
    it('returns an object with all expected keys', () => {
      const s = getSettings();
      expect(s).toHaveProperty('videoQuality');
      expect(s).toHaveProperty('audioQuality');
      expect(s).toHaveProperty('watermarkText');
      expect(s).toHaveProperty('autoCopyLink');
      expect(s).toHaveProperty('aiProvider');
      expect(s).toHaveProperty('openaiKey');
      expect(s).toHaveProperty('geminiKey');
      expect(s).toHaveProperty('desktopNotifications');
      expect(s).toHaveProperty('shortcutRecord');
      expect(s).toHaveProperty('shortcutPause');
      expect(s).toHaveProperty('shortcutStop');
      expect(s).toHaveProperty('autoRuns');
    });

    it('returns sensible defaults before initSettings', () => {
      const s = getSettings();
      expect(s.videoQuality).toBe('720p');
      expect(s.audioQuality).toBe('medium');
      expect(s.aiProvider).toBe('openai');
      expect(s.autoCopyLink).toBe(true);
      expect(s.desktopNotifications).toBe(false);
    });

    it('does not expose removed autoReadRules alias', () => {
      const s = getSettings();
      expect(s.autoReadRules).toBeUndefined();
    });
  });

  describe('getShortcuts', () => {
    it('returns default keyboard mappings', async () => {
      const sc = await getShortcuts();
      expect(sc).toEqual({ record: 'r', pause: ' ', stop: 's' });
    });
  });

  describe('saveAndCache', () => {
    it('persists to IDB via saveSetting', () => {
      saveAndCache('videoQuality', '1080p');
      expect(saveSetting).toHaveBeenCalledWith('videoQuality', '1080p');
    });

    it('updates the in-memory cache', () => {
      saveAndCache('audioQuality', 'high');
      const s = getSettings();
      expect(s.audioQuality).toBe('high');
    });

    it('calls optional onSaved callback', () => {
      const cb = vi.fn();
      saveAndCache('watermarkText', 'test', cb);
      expect(cb).toHaveBeenCalled();
    });
  });

  describe('getSettingCached', () => {
    it('returns cached value for known keys', async () => {
      saveAndCache('aiProvider', 'gemini');
      const val = await getSettingCached('aiProvider');
      expect(val).toBe('gemini');
    });

    it('falls back to IDB for unknown keys', async () => {
      getSetting.mockResolvedValue('idb-value');
      const val = await getSettingCached('unknownKey');
      expect(getSetting).toHaveBeenCalledWith('unknownKey');
      expect(val).toBe('idb-value');
    });
  });

  describe('initSettings', () => {
    it('loads settings from IDB batch read', async () => {
      const { batchRead } = await import('../storage.js');
      batchRead.mockResolvedValue({
        settings: [
          { key: 'videoQuality', value: '4k' },
          { key: 'aiProvider', value: 'gemini' },
        ],
      });

      await initSettings();

      const s = getSettings();
      expect(s.videoQuality).toBe('4k');
      expect(s.aiProvider).toBe('gemini');
    });
  });
});
