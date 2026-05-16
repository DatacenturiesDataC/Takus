// Takus — Notification Preferences Tests (Phase 61)
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../storage.js', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  saveSetting: vi.fn(() => Promise.resolve()),
}));

import {
  getNotificationPrefs,
  updateNotificationPrefs,
  shouldNotify,
  shouldPlaySound,
  setDoNotDisturb,
  resetNotificationPrefs,
} from '../notification-prefs.js';

describe('Notification Preferences', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetNotificationPrefs();
  });

  describe('getNotificationPrefs', () => {
    it('returns defaults when no prefs are stored', async () => {
      const prefs = await getNotificationPrefs();
      expect(prefs.breaks.enabled).toBe(true);
      expect(prefs.tasks.level).toBe('important');
      expect(prefs.doNotDisturb).toBe(false);
      expect(prefs.quietHours).toBe(false);
    });
  });

  describe('updateNotificationPrefs', () => {
    it('merges partial updates', async () => {
      await updateNotificationPrefs({ breaks: { sound: true } });
      const prefs = await getNotificationPrefs();
      expect(prefs.breaks.sound).toBe(true);
      expect(prefs.breaks.enabled).toBe(true); // Preserved
    });

    it('updates scalar values', async () => {
      await updateNotificationPrefs({ doNotDisturb: true });
      const prefs = await getNotificationPrefs();
      expect(prefs.doNotDisturb).toBe(true);
    });
  });

  describe('shouldNotify', () => {
    it('allows important notifications by default', async () => {
      const result = await shouldNotify('tasks', 'important');
      expect(result).toBe(true);
    });

    it('blocks info-level for important-only channels', async () => {
      const result = await shouldNotify('tasks', 'info');
      expect(result).toBe(false);
    });

    it('blocks all notifications in DND mode', async () => {
      await setDoNotDisturb(true);
      const result = await shouldNotify('tasks', 'important');
      expect(result).toBe(false);
    });

    it('allows all levels for all-level channels', async () => {
      const result = await shouldNotify('uploads', 'info');
      expect(result).toBe(true);
    });

    it('blocks disabled channels', async () => {
      await updateNotificationPrefs({ tasks: { enabled: false } });
      const result = await shouldNotify('tasks', 'important');
      expect(result).toBe(false);
    });

    it('blocks none-level channels', async () => {
      await updateNotificationPrefs({ tasks: { enabled: true, level: 'none' } });
      const result = await shouldNotify('tasks', 'important');
      expect(result).toBe(false);
    });
  });

  describe('shouldPlaySound', () => {
    it('returns false by default', async () => {
      const result = await shouldPlaySound('tasks');
      expect(result).toBe(false);
    });

    it('returns true when sound is enabled', async () => {
      await updateNotificationPrefs({ tasks: { sound: true } });
      const result = await shouldPlaySound('tasks');
      expect(result).toBe(true);
    });

    it('returns false in DND mode even with sound enabled', async () => {
      await updateNotificationPrefs({ tasks: { sound: true } });
      await setDoNotDisturb(true);
      const result = await shouldPlaySound('tasks');
      expect(result).toBe(false);
    });
  });

  describe('setDoNotDisturb', () => {
    it('toggles DND on', async () => {
      const prefs = await setDoNotDisturb(true);
      expect(prefs.doNotDisturb).toBe(true);
    });

    it('toggles DND off', async () => {
      await setDoNotDisturb(true);
      const prefs = await setDoNotDisturb(false);
      expect(prefs.doNotDisturb).toBe(false);
    });
  });

  describe('resetNotificationPrefs', () => {
    it('restores all defaults', async () => {
      await updateNotificationPrefs({ doNotDisturb: true, breaks: { enabled: false } });
      const prefs = await resetNotificationPrefs();
      expect(prefs.doNotDisturb).toBe(false);
      expect(prefs.breaks.enabled).toBe(true);
    });
  });
});
