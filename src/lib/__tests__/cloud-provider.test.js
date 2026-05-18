// Takus — Cloud Provider Tests
// Tests the CloudProviderManager's state management, provider switching,
// and listener lifecycle. Auth/storage calls are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGoogleAuth = {
  isConnected: false,
  connect: vi.fn(() => Promise.resolve()),
  disconnect: vi.fn(),
  onChange: vi.fn(() => () => {}),
};

const mockMicrosoftAuth = {
  isConnected: false,
  connect: vi.fn(() => Promise.resolve()),
  disconnect: vi.fn(),
  onChange: vi.fn(() => () => {}),
};

// Mock all cloud sub-modules with constructors
vi.mock('../google-auth.js', () => ({
  GoogleAuth: { getInstance: () => mockGoogleAuth },
}));

vi.mock('../google-drive.js', () => ({
  GoogleDrive: vi.fn(function() {
    this.uploadResumable = vi.fn();
    this.listFolderContents = vi.fn();
  }),
}));

vi.mock('../google-calendar.js', () => ({
  GoogleCalendar: vi.fn(function() {}),
}));

vi.mock('../google-docs.js', () => ({
  GoogleDocs: vi.fn(function() {}),
}));

vi.mock('../microsoft-auth.js', () => ({
  MicrosoftAuth: { getInstance: () => mockMicrosoftAuth },
}));

vi.mock('../microsoft-onedrive.js', () => ({
  MicrosoftOneDrive: vi.fn(function() {}),
}));

vi.mock('../microsoft-calendar.js', () => ({
  MicrosoftCalendar: vi.fn(function() {}),
}));

vi.mock('../microsoft-onenote.js', () => ({
  MicrosoftOneNote: vi.fn(function() {}),
}));

vi.mock('../storage.js', () => ({
  getEntries: vi.fn(() => Promise.resolve([])),
  saveEntry: vi.fn(() => Promise.resolve()),
  saveVaultSync: vi.fn(() => Promise.resolve()),
  getAllVaultSync: vi.fn(() => Promise.resolve([])),
  clearAllEntries: vi.fn(() => Promise.resolve()),
}));

vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

vi.mock('../events.js', () => ({
  VAULT_SYNC_COMPLETE: 'takus:vault-sync-complete',
  CLOUD_CONNECTED: 'takus:cloud-connected',
}));

import { CloudProviderManager } from '../cloud-provider.js';

describe('CloudProviderManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleAuth.isConnected = false;
    mockMicrosoftAuth.isConnected = false;
    manager = new CloudProviderManager();
  });

  describe('construction', () => {
    it('initializes with no active provider', () => {
      expect(manager.activeId).toBeNull();
    });

    it('has google and microsoft provider objects', () => {
      expect(manager.google).toBeDefined();
      expect(manager.google.id).toBe('google');
      expect(manager.google.name).toBe('Google');
      expect(manager.microsoft).toBeDefined();
      expect(manager.microsoft.id).toBe('microsoft');
      expect(manager.microsoft.name).toBe('Microsoft');
    });

    it('isConnected returns false when no provider connected', () => {
      expect(manager.isConnected).toBe(false);
    });

    it('isConnected returns true when google is connected', () => {
      mockGoogleAuth.isConnected = true;
      expect(manager.isConnected).toBe(true);
    });

    it('isConnected returns true when microsoft is connected', () => {
      mockMicrosoftAuth.isConnected = true;
      expect(manager.isConnected).toBe(true);
    });
  });

  describe('getProvider', () => {
    it('returns null when no provider is active', () => {
      expect(manager.getProvider()).toBeNull();
    });

    it('returns google when active', () => {
      manager._activeId = 'google';
      expect(manager.getProvider()).toBe(manager.google);
    });

    it('returns microsoft when active', () => {
      manager._activeId = 'microsoft';
      expect(manager.getProvider()).toBe(manager.microsoft);
    });
  });

  describe('getProviderById', () => {
    it('returns google for "google"', () => {
      expect(manager.getProviderById('google')).toBe(manager.google);
    });

    it('returns microsoft for "microsoft"', () => {
      expect(manager.getProviderById('microsoft')).toBe(manager.microsoft);
    });

    it('returns null for unknown id', () => {
      expect(manager.getProviderById('dropbox')).toBeNull();
    });
  });

  describe('connect', () => {
    it('throws for unknown provider', async () => {
      await expect(manager.connect('dropbox')).rejects.toThrow('Unknown provider');
    });

    it('calls auth.connect on the google provider', async () => {
      await manager.connect('google');
      expect(mockGoogleAuth.connect).toHaveBeenCalled();
    });

    it('calls auth.connect on the microsoft provider', async () => {
      await manager.connect('microsoft');
      expect(mockMicrosoftAuth.connect).toHaveBeenCalled();
    });

    it('disconnects the other provider first', async () => {
      mockMicrosoftAuth.isConnected = true;
      await manager.connect('google');
      expect(mockMicrosoftAuth.disconnect).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('calls auth.disconnect on google', () => {
      manager._activeId = 'google';
      manager.disconnect('google');
      expect(mockGoogleAuth.disconnect).toHaveBeenCalled();
    });

    it('calls auth.disconnect on microsoft', () => {
      manager._activeId = 'microsoft';
      manager.disconnect('microsoft');
      expect(mockMicrosoftAuth.disconnect).toHaveBeenCalled();
    });

    it('is safe for unknown provider', () => {
      expect(() => manager.disconnect('dropbox')).not.toThrow();
    });
  });

  describe('disconnectAll', () => {
    it('clears the active provider', () => {
      manager._activeId = 'google';
      manager.disconnectAll();
      expect(manager._activeId).toBeNull();
    });

    it('disconnects both providers', () => {
      mockGoogleAuth.isConnected = true;
      mockMicrosoftAuth.isConnected = true;
      manager.disconnectAll();
      expect(mockGoogleAuth.disconnect).toHaveBeenCalled();
      expect(mockMicrosoftAuth.disconnect).toHaveBeenCalled();
    });
  });

  describe('onChange', () => {
    it('registers and fires listeners', () => {
      const listener = vi.fn();
      manager.onChange(listener);
      manager._emit();
      expect(listener).toHaveBeenCalledWith(null);
    });

    it('returns an unsubscribe function', () => {
      const listener = vi.fn();
      const unsub = manager.onChange(listener);
      unsub();
      manager._emit();
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not crash if listener throws', () => {
      manager.onChange(() => { throw new Error('Boom'); });
      expect(() => manager._emit()).not.toThrow();
    });

    it('passes activeId to listener', () => {
      const listener = vi.fn();
      manager._activeId = 'google';
      manager.onChange(listener);
      manager._emit();
      expect(listener).toHaveBeenCalledWith('google');
    });
  });

  describe('activeAuth', () => {
    it('returns null when no provider active', () => {
      expect(manager.activeAuth).toBeNull();
    });

    it('returns auth when google is active', () => {
      manager._activeId = 'google';
      expect(manager.activeAuth).toBe(manager.google.auth);
    });

    it('returns auth when microsoft is active', () => {
      manager._activeId = 'microsoft';
      expect(manager.activeAuth).toBe(manager.microsoft.auth);
    });
  });

  describe('syncVaultToLocal', () => {
    it('does not run when no provider is active', async () => {
      manager._activeId = null;
      await manager.syncVaultToLocal();
      // Should complete without error
    });

    it('guards against concurrent syncs', async () => {
      manager._syncInProgress = true;
      await manager.syncVaultToLocal();
      // Should return immediately
      expect(manager._syncInProgress).toBe(true);
    });

    it('resets syncInProgress after completion', async () => {
      manager._activeId = null;
      manager._syncInProgress = false;
      await manager.syncVaultToLocal();
      expect(manager._syncInProgress).toBe(false);
    });
  });

  describe('rebuildFromCloud', () => {
    it('returns error when no provider connected', async () => {
      manager.active = null;
      const result = await manager.rebuildFromCloud();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No cloud provider');
    });
  });

  describe('singleton', () => {
    it('getInstance returns same instance', () => {
      const a = CloudProviderManager.getInstance();
      const b = CloudProviderManager.getInstance();
      expect(a).toBe(b);
    });
  });
});
