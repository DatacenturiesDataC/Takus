import { describe, it, expect } from 'vitest';
import { getSettings, getShortcuts } from '../settings-store.js';

describe('settings-store', () => {
  describe('getSettings', () => {
    it('returns an object with expected keys', () => {
      const s = getSettings();
      expect(s).toHaveProperty('videoQuality');
      expect(s).toHaveProperty('audioQuality');
      expect(s).toHaveProperty('watermarkText');
      expect(s).toHaveProperty('autoCopyLink');
      expect(s).toHaveProperty('aiProvider');
      expect(s).toHaveProperty('openaiKey');
      expect(s).toHaveProperty('geminiKey');
      expect(s).toHaveProperty('desktopNotifications');
    });

    it('returns sensible defaults before initSettings', () => {
      const s = getSettings();
      expect(s.videoQuality).toBe('720p');
      expect(s.audioQuality).toBe('medium');
      expect(s.aiProvider).toBe('openai');
      expect(s.autoCopyLink).toBe(true);
      expect(s.desktopNotifications).toBe(false);
    });
  });

  describe('getShortcuts', () => {
    it('returns default keyboard mappings', async () => {
      const sc = await getShortcuts();
      expect(sc).toEqual({ record: 'r', pause: ' ', stop: 's' });
    });
  });
});
